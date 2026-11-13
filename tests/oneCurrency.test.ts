import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameAction, GameState, cardDef, executeAction, findCardAnywhere } from '../src/core';
import { createAgent } from '../src/ai';
import { HeuristicCorpAI } from '../src/ai/corpAI';
import { centralExposure, evaluate } from '../src/ai/evaluate';
import { simulate } from '../src/ai/prompts';
import { tuning } from '../src/ai/synergy';
import { giveCard, installIceForTest, newGame } from './helpers';
import { inDecision } from './helpers/pricing';

// The switch is off by default since the 2026-11-07 stop rule; these tests pin the one-currency behaviour itself.
const oneCurrencyDefault = tuning.plan.oneCurrency;
const threatDefault = tuning.plan.threatModel;
// Item 1 (parked) as it was built: on the old threat (PACE shares, STEAL.run, the Runner reply). The threat model
// (item 3) inside its one-step evaluate deltas is untried; the combination is batched at the end of the list
beforeEach(() => { tuning.plan.oneCurrency = true; tuning.plan.threatModel = false; });
afterEach(() => { tuning.plan.oneCurrency = oneCurrencyDefault; tuning.plan.threatModel = threatDefault; });

/**
 * plan.oneCurrency (structural review item 1, Jeff approved 2026-11-06; spec "Item 1 spec" of the AI code review doc):
 * the Corp ranks every main-phase action by the change in evaluate(state, 'corp') once it and its own prompts resolve.
 * These pin what installScore, advanceScore, the reserve penalties and the override layer (pettyCashFirst, tagFirst)
 * used to force, now from the value model alone.
 */

const PALISADE = '30072';
const TITHE = '30073';
const BRAN = '30039';
const HEDGE_FUND = '30075';
const SEAMLESS_LAUNCH = '30040';
const NANOMANAGEMENT = '35043';
const OFFWORLD_OFFICE = '30067';

/** The Corp's turn 1 of a starter game with an empty HQ (cards given per test) and `credits`. */
function corpTurn(credits = 8): GameState {
  const s = newGame();
  s.corp.hq = [];
  s.corp.credits = credits;
  s.corp.remoteCounter = 5; // new remotes don't take the ids the tests give their own
  return s;
}

const ranked = (s: GameState) => inDecision(s, 'corp', () => new HeuristicCorpAI({ planner: false }).rankMainActions(s));
const scoreOf = (s: GameState, match: (a: GameAction) => boolean): number => {
  const hit = ranked(s).find(r => match(r.action));
  if (!hit) throw new Error('no such action');
  return hit.score;
};
const install = (id: string, server: string | 'new') => (a: GameAction) =>
  a.type === 'INSTALL_CARD' && a.cardInstanceId === id && (server === 'new' ? !!a.asNewRemote : a.targetServerId === server) && !a.trashFirst?.length;
const playOf = (id: string) => (a: GameAction) => a.type === 'PLAY_OPERATION_OR_EVENT' && a.cardInstanceId === id;

/** An agenda installed in `server` on an earlier turn (Seamless Launch can't target a card installed this turn). */
function agendaIn(s: GameState, server: string, code = OFFWORLD_OFFICE, counters = 0): string {
  const id = giveCard(s, 'corp', code);
  const card = s.corp.hq.find(c => c.instanceId === id)!;
  s.corp.hq = s.corp.hq.filter(c => c.instanceId !== id);
  if (!s.corp.servers[server]) s.corp.servers[server] = { id: server, name: server, isRemote: true, ice: [], root: [] };
  card.advancementCounters = counters;
  card.installedTurn = undefined as unknown as typeof card.installedTurn;
  s.corp.servers[server].root.push(card);
  return id;
}

describe('one currency: scores are evaluate deltas (plan.oneCurrency)', () => {
  it('a click for a credit and an ice install score exactly their change in evaluate', () => {
    const s = corpTurn();
    const ice = giveCard(s, 'corp', PALISADE);
    const before = inDecision(s, 'corp', () => evaluate(s, 'corp'));
    for (const action of [{ type: 'GAIN_CREDIT', player: 'corp' } as GameAction, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: ice, targetServerId: 'rd' } as GameAction]) {
      const after = simulate(s, action)!;
      const delta = inDecision(after, 'corp', () => evaluate(after, 'corp')) - before;
      expect(scoreOf(s, a => JSON.stringify(a) === JSON.stringify(action))).toBeCloseTo(delta, 6);
    }
  });
});

describe('central exposure prices where ice goes', () => {
  it('ice on a bare R&D beats the same ice on a new remote by a clear margin', () => {
    const s = corpTurn();
    expect(s.corp.rd.filter(c => cardDef(c).type_code === 'agenda').length).toBeGreaterThanOrEqual(3);
    const ice = giveCard(s, 'corp', PALISADE);
    expect(scoreOf(s, install(ice, 'rd')) - scoreOf(s, install(ice, 'new'))).toBeGreaterThan(1.5);
  });

  it('with R&D behind 2 rezzed ice, the remote holding an agenda gets the ice', () => {
    const s = corpTurn();
    installIceForTest(s, PALISADE, 'rd');
    installIceForTest(s, PALISADE, 'rd');
    agendaIn(s, 'remote-1');
    const ice = giveCard(s, 'corp', PALISADE);
    expect(scoreOf(s, install(ice, 'remote-1'))).toBeGreaterThan(scoreOf(s, install(ice, 'rd')));
  });

  it('ice keeps an R&D run from taking agendas: exposure falls when R&D is iced', () => {
    const s = corpTurn();
    const bare = centralExposure(s, 'corp');
    installIceForTest(s, PALISADE, 'rd');
    expect(centralExposure(s, 'corp')).toBeLessThan(bare);
  });

  it('a card drawn in a look-ahead tells the Corp nothing: the exposure is the same whatever it is', () => {
    const s = corpTurn();
    // Seen as the decision starts: an empty HQ; then two different cards arrive unseen
    inDecision(s, 'corp', () => ranked(s));
    const withAgenda = structuredClone(s);
    const withIce = structuredClone(s);
    const agenda = withAgenda.corp.rd.findIndex(c => cardDef(c).type_code === 'agenda');
    withAgenda.corp.hq.push(...withAgenda.corp.rd.splice(agenda, 1));
    const other = withIce.corp.rd.findIndex(c => cardDef(c).type_code !== 'agenda');
    withIce.corp.hq.push(...withIce.corp.rd.splice(other, 1));
    expect(centralExposure(withAgenda, 'corp')).toBeCloseTo(centralExposure(withIce, 'corp'), 6);
  });
});

describe('a remote identity without oneRemote', () => {
  it('an agenda goes into the iced empty remote, not a new bare one', () => {
    const s = corpTurn();
    installIceForTest(s, PALISADE, 'remote-1');
    const agenda = giveCard(s, 'corp', OFFWORLD_OFFICE);
    expect(scoreOf(s, install(agenda, 'remote-1'))).toBeGreaterThan(scoreOf(s, install(agenda, 'new')));
  });

  it('an agenda in HQ is worth installing behind a rezzed Palisade (it doesn’t wait in HQ)', () => {
    const s = corpTurn();
    installIceForTest(s, PALISADE, 'remote-1');
    const agenda = giveCard(s, 'corp', OFFWORLD_OFFICE);
    expect(scoreOf(s, install(agenda, 'remote-1'))).toBeGreaterThan(0);
  });

  it('ice goes onto the remote holding an agenda rather than a new remote', () => {
    const s = corpTurn();
    agendaIn(s, 'remote-1');
    const ice = giveCard(s, 'corp', PALISADE);
    expect(scoreOf(s, install(ice, 'remote-1'))).toBeGreaterThan(scoreOf(s, install(ice, 'new')));
  });
});

describe('plays that finish an agenda this turn (what finishSetup and operationBonus forced)', () => {
  it('Seamless Launch beats Hedge Fund when its 2 counters let the turn score Offworld Office', () => {
    const s = corpTurn(5);
    installIceForTest(s, PALISADE, 'remote-1');
    agendaIn(s, 'remote-1');
    const seamless = giveCard(s, 'corp', SEAMLESS_LAUNCH);
    const hedge = giveCard(s, 'corp', HEDGE_FUND);
    expect(scoreOf(s, playOf(seamless))).toBeGreaterThan(scoreOf(s, playOf(hedge)));
  });

  it('...and is worth less when it can’t (2 clicks: Seamless Launch and one advance leave it a counter short)', () => {
    // Two counters for a click and a credit are worth having either way (about Hedge Fund's +4); the finish is what
    // lifts it. (Once agendaWorth priced Offworld's 7 credits on score before the finish too, the short case rose to
    // about Hedge Fund's level, so the comparison is between the two positions)
    const at = (clicks: number) => {
      const s = corpTurn(5);
      s.corp.clicks = clicks;
      installIceForTest(s, PALISADE, 'remote-1');
      agendaIn(s, 'remote-1');
      return scoreOf(s, playOf(giveCard(s, 'corp', SEAMLESS_LAUNCH)));
    };
    expect(at(3)).toBeGreaterThan(at(2) + 2);
  });

  it('Nanomanagement beats Hedge Fund when its 2 clicks finish the agenda', () => {
    const s = corpTurn(8);
    s.corp.clicks = 2;
    installIceForTest(s, PALISADE, 'remote-1');
    agendaIn(s, 'remote-1', OFFWORLD_OFFICE, 1);
    const nano = giveCard(s, 'corp', NANOMANAGEMENT);
    const hedge = giveCard(s, 'corp', HEDGE_FUND);
    expect(scoreOf(s, playOf(nano))).toBeGreaterThan(scoreOf(s, playOf(hedge)));
  });

  it('...and not with no agenda to finish', () => {
    const s = corpTurn(8);
    s.corp.clicks = 2;
    const nano = giveCard(s, 'corp', NANOMANAGEMENT);
    const hedge = giveCard(s, 'corp', HEDGE_FUND);
    expect(scoreOf(s, playOf(nano))).toBeLessThan(scoreOf(s, playOf(hedge)));
  });
});

describe('an agenda the turn can finish is priced as scored', () => {
  /** Offworld Office at 1 of 4 behind an unrezzed Palisade: 3 clicks and 4 credits finish it, leaving 1 (short of the rez). */
  function finishable(): GameState {
    const s = corpTurn(4);
    installIceForTest(s, PALISADE, 'remote-1', false);
    agendaIn(s, 'remote-1', OFFWORLD_OFFICE, 1);
    return s;
  }

  it('each advance toward the finish is about 0, and a click spent elsewhere shows what the finish loses', () => {
    const s = finishable();
    const advance = scoreOf(s, a => a.type === 'ADVANCE_CARD');
    expect(Math.abs(advance)).toBeLessThan(0.01);
    expect(scoreOf(s, a => a.type === 'GAIN_CREDIT')).toBeLessThan(advance - 3);
  });

  it('the Corp scores it this turn, though the advances use up its rez money', () => {
    let s = finishable();
    const corp = createAgent('corp', 'normal');
    const turn = s.turnNumber;
    for (let i = 0; i < 10 && s.activePlayer === 'corp' && s.turnNumber === turn; i++) s = executeAction(s, corp.chooseAction(s));
    expect(s.corp.scoreArea.map(c => cardDef(c).title)).toContain('Offworld Office');
  }, 60_000);
});

describe('advanced traps (what advanceScore and trapBluff priced)', () => {
  it('an advancement counter on Urtica Cipher is worth something to the Corp', () => {
    const s = corpTurn();
    const id = giveCard(s, 'corp', '30045');
    const urtica = s.corp.hq.pop()!;
    s.corp.servers['remote-1'] = { id: 'remote-1', name: 'remote-1', isRemote: true, ice: [], root: [urtica] };
    const bare = inDecision(s, 'corp', () => evaluate(s, 'corp'));
    const advanced = structuredClone(s);
    advanced.corp.servers['remote-1'].root[0].advancementCounters = 1;
    expect(inDecision(advanced, 'corp', () => evaluate(advanced, 'corp'))).toBeGreaterThan(bare + 0.3);
    expect(id).toBe(urtica.instanceId);
  });
});

describe('a broke Corp and the credit slide', () => {
  it('installs the ice it can rez, not the one it can’t', () => {
    const s = corpTurn(2);
    const tithe = giveCard(s, 'corp', TITHE);
    const bran = giveCard(s, 'corp', BRAN);
    const best = ranked(s).find(r => r.action.type === 'INSTALL_CARD');
    expect(best && 'cardInstanceId' in best.action && best.action.cardInstanceId).toBe(tithe);
    expect(scoreOf(s, install(tithe, 'rd'))).toBeGreaterThan(scoreOf(s, install(bran, 'rd')));
  });
});

/** Plays the Corp's turn from a fixture with the Normal AI. */
function playFixture(name: string, steps = 15): GameState {
  let s: GameState = JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
  s.log = [];
  const corp = createAgent('corp', 'normal');
  for (let i = 0; i < steps && s.activePlayer === 'corp'; i++) s = executeAction(s, corp.chooseAction(s));
  return s;
}

describe('no override layer needed', () => {
  it('Petty Cash is played first in the turn without plan.pettyCashFirst', () => {
    tuning.plan.pettyCashFirst = false;
    // OPEN (item 4, 2026-11-07): with plan.plannerSearch the one-currency Corp without pettyCashFirst clicks for a credit
    // here (a non-default pairing: oneCurrency is off); pinned to the planner before the search was widened until item 6
    tuning.plan.plannerSearch = false;
    // plan.ownIceKnown (2026-11-09) pinned off too: with it the one-currency Corp prices the Ansel it can't rez as passed and
    // takes the turn's last click as a credit instead of icing HQ with it, after Petty Cash's window has gone (not the bug)
    tuning.plan.ownIceKnown = false;
    // plan.hiddenDraws (S6) pinned off too: on one guess of R&D the Bumi-in-a-new-remote line (Spin Doctor then draws two
    // guessed cards) outreads Petty Cash and the turn ends on a click for a credit (pettyCashFirst.test.ts; S6 hand-off gap)
    tuning.plan.hiddenDraws = false;
    try {
      // The one-step ranking puts it first (its net 2 credits now and its replay from Archives, PETTY_CASH_REPLAY, on
      // the card there). The planned turn may still open a remote first: its greedy rollout after Petty Cash ices HQ and
      // never tries the remote (structural review item 4, the planner). Either way no click goes to a credit while Petty
      // Cash is in HQ (the bug). With plan.rdOwnOdds (spec-match-point-rez.md E2) the turn's last click, after Petty Cash,
      // goes to a credit instead of the remote install: the turn's end, not the bug
      const start: GameState = JSON.parse(readFileSync(new URL('./fixtures/petty-cash-first.json', import.meta.url), 'utf8'));
      const [top] = new HeuristicCorpAI({ planner: false }).rankMainActions(start);
      expect(top.action.type === 'PLAY_OPERATION_OR_EVENT' && cardDef(findCardAnywhere(start, top.action.cardInstanceId)!).title).toBe('Petty Cash');
      const s = playFixture('petty-cash-first.json', 12);
      const log = s.log.map(l => l.message);
      const petty = log.findIndex(m => m.includes('to play Petty Cash'));
      expect(petty).toBeGreaterThanOrEqual(0);
      expect(log.slice(0, petty)).not.toContain('Corp spent [click] to gain 1 credit.');
    } finally {
      tuning.plan.pettyCashFirst = true;
      tuning.plan.plannerSearch = true;
      tuning.plan.ownIceKnown = true;
      tuning.plan.hiddenDraws = true;
    }
  }, 60_000);

  it('a tagged Runner’s Side Hustle is trashed without plan.tagFirst', () => {
    tuning.plan.tagFirst = false;
    try {
      expect(playFixture('tag-first-side-hustle.json').runner.rig.resources.map(c => cardDef(c).title)).not.toContain('Side Hustle');
    } finally {
      tuning.plan.tagFirst = true;
    }
  }, 60_000);
});
