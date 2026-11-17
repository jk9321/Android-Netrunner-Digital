/**
 * Two wins the win-now search could not reach (Stage D, found-list rows 24 and 26; brief
 * stage-d/small-fixes/win-now-reach.md).
 *
 * Row 24, part A (Jeff's game #56, turn 12): Measured Response (35078) "Play only if the threat level is 4 or greater,
 * and only if the Runner made a successful run during their last turn. Do 4 meat damage unless the Runner pays 8
 * credits." The Runner held 2 cards and 6 credits: playing it flatlines the Runner (rules 1.7.2b, 10.4.4: flatlined
 * by more damage than cards in the grip). winNowAction answered null: its bound counted agenda points only.
 *
 * The kill side reads ownTurnDamage (registry V20), so its facts are tied to the engine here too: Neurospike (30049)
 * "Do X net damage, where X is equal to the sum of the printed agenda points on agendas you scored this turn", and
 * Mindscaping (34045) "Do X net damage. X is equal to the number of tags the Runner has, up to 3".
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_CARDS, GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction } from '../src/core';
import { TurnFlag } from '../src/core/engine/cardEffects';
import { deckGameSetup } from '../src/data/decks';
import { ownTurnDamage } from '../src/ai/effectValues';
import { scoreNowPlan, steps, winNowAction, winNowBound } from '../src/ai/winNow';
import { answer, giveCard, installCorpForTest, installIceForTest, newGame, play } from './helpers';
import { inDecision } from './helpers/pricing';

const MEASURED_RESPONSE = '35078';
const TOUCH_UPS = '35067';
const SEND_A_MESSAGE = '30069'; // agenda, 5 to advance, 3 points
const SURE_GAMBLE = '30030'; // event
const PENNYSHAVER = '30014'; // hardware

/** Jeff's game (bug report `n`) replayed to the Corp's first main-phase decision of turn `turn` (as tests/winNow.test.ts). */
function corpTurn(n: number, turn: number): GameState {
  const report = JSON.parse(readFileSync(new URL(`./fixtures/human-games/report-${n}.json`, import.meta.url), 'utf8'));
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  for (const m of report.moves as GameAction[]) {
    if (s.turnNumber === turn && s.activePlayer === 'corp' && s.corp.clicks > 0 && actingSide(s) === 'corp' && !s.pendingPrompts.length && m.type !== 'START_TURN') break;
    s = executeAction(s, m);
  }
  return s;
}

const winNow = (s: GameState) => inDecision(s, 'corp', () => winNowAction(s));
/** win-now with its bound switched off (test-only): every line searched. */
const uncut = (s: GameState) => {
  winNowBound.uncut = true;
  try {
    return winNow(s);
  } finally {
    winNowBound.uncut = false;
  }
};
const playedCode = (s: GameState, a: GameAction | null) => {
  const id = (a as { cardInstanceId?: string } | null)?.cardInstanceId;
  return id ? [...s.corp.hq, ...Object.values(s.corp.servers).flatMap(v => v.root)].find(c => c.instanceId === id)?.cardCode : undefined;
};

/**
 * Measured Response's kill, built: threat 4 (the Runner's 4 points), a successful run last turn, the Runner on 2 cards
 * and 6 credits, the Corp with 3 clicks and 8 credits, no agenda anywhere (so the points side of the bound says no).
 */
function mrBoard(): GameState {
  const s = structuredClone(newGame(1));
  s.corp.rd.push(...s.corp.hq.splice(0));
  s.runner.stack.push(...s.runner.grip.splice(0));
  s.corp.clicks = 3;
  s.corp.credits = 8;
  s.runner.score = 4;
  s.runner.credits = 6;
  s.runnerLastTurnRuns = [{ server: 'hq', successful: true }] as GameState['runnerLastTurnRuns'];
  giveCard(s, 'corp', MEASURED_RESPONSE);
  giveCard(s, 'runner', SURE_GAMBLE);
  giveCard(s, 'runner', PENNYSHAVER);
  return s;
}

describe('win-now sees a kill by damage (row 24; rules 1.7.2b, 10.4.4)', () => {
  it("Jeff's game #56, turn 12, three clicks: win-now plays Measured Response, and it wins", () => {
    const s = corpTurn(56, 12);
    expect(s.corp.clicks).toBe(3);
    expect(s.runner.grip.length).toBe(2);
    const pick = winNow(s);
    expect(pick?.type).toBe('PLAY_OPERATION_OR_EVENT');
    expect(playedCode(s, pick)).toBe(MEASURED_RESPONSE);
    const after = executeAction(structuredClone(s), pick!);
    expect(after.winner).toBe('corp');
  });

  it('the built board: win-now plays Measured Response, and it flatlines the Runner', () => {
    const s = mrBoard();
    const pick = winNow(s);
    expect(playedCode(s, pick)).toBe(MEASURED_RESPONSE);
    expect(executeAction(structuredClone(s), pick!).winner).toBe('corp');
  });

  it('mirror: the Runner has exactly 8 credits, so paying is its choice: no win', () => {
    const s = mrBoard();
    s.runner.credits = 8;
    expect(winNow(s)).toBeNull();
  });

  it('mirror: a grip of 4 survives 4 damage (10.4.4: more damage than cards): no win', () => {
    const s = mrBoard();
    giveCard(s, 'runner', SURE_GAMBLE);
    giveCard(s, 'runner', SURE_GAMBLE);
    expect(s.runner.grip.length).toBe(4);
    expect(winNow(s)).toBeNull();
  });

  it('mirror: threat 3: Measured Response cannot be played: no win', () => {
    const s = mrBoard();
    s.runner.score = 3;
    expect(winNow(s)).toBeNull();
  });

  it('mirror: no successful run last turn: no win', () => {
    const s = mrBoard();
    s.runnerLastTurnRuns = [{ server: 'hq', successful: false }] as GameState['runnerLastTurnRuns'];
    expect(winNow(s)).toBeNull();
  });

  it('mirror: the Corp has 4 credits and one click, so it cannot pay 5: no win (with a second click it takes a credit first)', () => {
    const s = mrBoard();
    s.corp.credits = 4;
    s.corp.clicks = 1;
    expect(winNow(s)).toBeNull();
    s.corp.clicks = 2;
    expect(winNow(s)?.type).toBe('GAIN_CREDIT');
  });
});

describe("the kill side's cards", () => {
  it('every Corp card that can deal damage on its own turn (read at its most), as canStillKill counts it once a turn', () => {
    // A board at the turn's most: tags and points scored this turn as high as they go. A new card here needs its uses
    // a turn checked against canStillKill's comment (winNow.ts) before it joins this list.
    const s = structuredClone(newGame(1));
    s.runner.tags = 99;
    s.turnFlags[TurnFlag.agendaPointsScored] = 7;
    const found = ALL_CARDS
      .filter(c => c.side_code === 'corp' && c.type_code !== 'ice' && c.type_code !== 'identity')
      .filter(c => ownTurnDamage(s, c.code) > 0)
      .map(c => `${c.code} ${c.title}: ${ownTurnDamage(s, c.code)}`)
      .sort();
    expect(found).toEqual([
      '30049 Neurospike: 7',
      '30061 Clearinghouse: 1',
      '30068 Orbital Superiority: 4',
      '34031 Salvo Testing: 1',
      '34040 Fujii Asset Retrieval: 2',
      '34045 Mindscaping: 3',
      '34063 Angelique Garza Correa: 1',
      '34105 See How They Run: 1',
      '35051 Phật Gioan Baotixita: 1', // 1 + its counters (none on this board), up to 3
      '35078 Measured Response: 4',
    ]);
  });
});

/**
 * Touch-ups (35067): "Place 2 advancement counters on 1 installed card you can advance. If you do, choose a card type
 * and reveal the grip. Choose up to 2 revealed cards of that type. The Runner shuffles those cards into the stack." The
 * search plays moves in the real engine, so on a line through Touch-ups it would name the type knowing the grip. A kill
 * counts only on a line that took no unseen grip card other than by damage (the AI Coordinator's ruling, 19:02Z).
 */
describe('win-now does not plan a kill through the hidden grip (Touch-ups)', () => {
  /** Measured Response's 4 damage against 5 cards (2 events): a kill only if Touch-ups shuffles the 2 events away first. */
  function touchUpsBoard(): GameState {
    const s = mrBoard();
    s.corp.credits = 20;
    s.runner.credits = 0;
    giveCard(s, 'runner', SURE_GAMBLE);
    giveCard(s, 'runner', PENNYSHAVER);
    giveCard(s, 'runner', PENNYSHAVER);
    installCorpForTest(s, SEND_A_MESSAGE, 'remote-1');
    giveCard(s, 'corp', TOUCH_UPS);
    return s;
  }

  it('with the grip unseen: no win, and none with the bound off either (the line names the type knowing the grip)', () => {
    const s = touchUpsBoard();
    expect(s.runner.grip.length).toBe(5);
    expect(winNow(s)).toBeNull();
    expect(uncut(s)).toBeNull();
  });

  it('with the grip seen (the Corp knows every card) the searched line is Touch-ups; the bound does not count it (row 27)', () => {
    const s = touchUpsBoard();
    s.runner.knownToCorp = s.runner.grip.map(c => ({ id: c.instanceId, code: c.cardCode }));
    expect(playedCode(s, uncut(s))).toBe(TOUCH_UPS);
    // The named limit: the kill side compares damage with the grip as it is, and Touch-ups is no damage
    expect(winNow(s)).toBeNull();
  });

  it('after Touch-ups has been played and the events shuffled away, win-now sees the kill on the smaller grip', () => {
    let s = touchUpsBoard();
    const target = s.corp.servers['remote-1'].root[0].instanceId;
    s = play(s, 'corp', s.corp.hq.find(c => c.cardCode === TOUCH_UPS)!.instanceId);
    s = answer(s, { kind: 'effect_cards', cardInstanceIds: [target] });
    s = answer(s, { kind: 'effect_choice', optionId: 'event' });
    s = answer(s, { kind: 'effect_cards', cardInstanceIds: s.runner.grip.filter(c => cardDef(c).type_code === 'event').map(c => c.instanceId) });
    expect(s.runner.grip.length).toBe(3);
    expect(s.corp.clicks).toBe(1);
    const pick = winNow(s);
    expect(playedCode(s, pick)).toBe(MEASURED_RESPONSE);
    expect(executeAction(structuredClone(s), pick!).winner).toBe('corp');
  });
});

/**
 * Row 26, part B (Jeff's game #42, turn 16, 6-6, three clicks): install Embedded Reporting into remote-1 (an empty root
 * behind 2 ice), play Flood the Market (36053: "Place 1 advancement counter on that card for each remote server that
 * has a card in its root and is protected by ice"), score: 8-6. The search installed agendas only into a new remote, so
 * win-now and score-now answered null. Rule 1.17.3a: an agenda is scored at its advancement requirement.
 */
describe('win-now installs into an empty iced remote while a card counts iced remotes (row 26)', () => {
  const FLOOD = '36053';
  const HYPE = '36055'; // Hype Machine, an upgrade: a card in a root that is not an agenda
  const ICE = '30072'; // Palisade
  const TOMORROWS_HEADLINE = '30052'; // agenda, 3 to advance, 2 points

  /** win-now plays the rest of the turn (each pick re-asked on the board it leads to). */
  function followWinNow(s: GameState): GameState {
    for (let i = 0; i < 20 && !s.winner; i++) {
      const pick = winNow(s);
      if (!pick) break;
      s = executeAction(s, pick);
    }
    return s;
  }

  it("Jeff's game #42, turn 16, three clicks: win-now installs into the empty iced remote, and its line wins", () => {
    const s = corpTurn(42, 16);
    expect(s.corp.clicks).toBe(3);
    expect(s.corp.score).toBe(6);
    const pick = winNow(s) as { type: string; targetServerId?: string; asNewRemote?: boolean } | null;
    expect(pick?.type).toBe('INSTALL_CARD');
    expect(pick?.asNewRemote).toBeFalsy();
    const server = s.corp.servers[pick!.targetServerId!];
    expect(server.root.length).toBe(0);
    expect(server.ice.length).toBeGreaterThan(0);
    const end = followWinNow(structuredClone(s));
    expect(end.winner).toBe('corp');
    expect(end.corp.score).toBeGreaterThanOrEqual(7);
  });

  /** An empty iced remote, an agenda in HQ, 3 clicks; Flood the Market in HQ only when `flood`. */
  function icedBoard(flood: boolean): GameState {
    const s = structuredClone(newGame(1));
    s.corp.rd.push(...s.corp.hq.splice(0));
    s.corp.clicks = 3;
    s.corp.credits = 10;
    installIceForTest(s, ICE, 'remote-1');
    giveCard(s, 'corp', TOMORROWS_HEADLINE);
    if (flood) giveCard(s, 'corp', FLOOD);
    return s;
  }
  const installs = (s: GameState) =>
    inDecision(s, 'corp', () => steps(s))
      .filter(a => a.type === 'INSTALL_CARD')
      .map(a => ((a as { asNewRemote?: boolean }).asNewRemote ? 'new' : (a as { targetServerId?: string }).targetServerId));

  it('with no usable card holding the fact the move list is as before: one install, into a new remote', () => {
    expect(installs(icedBoard(false))).toEqual(['new']);
  });

  it('with Flood the Market in HQ the list also offers the empty iced remote, once', () => {
    expect(installs(icedBoard(true))).toEqual(['new', 'remote-1']);
  });

  it('two installs then two copies (6 clicks): the bound, widened by k - 1 a copy, still finds the line', () => {
    // n = 1 (Hype Machine behind ice in remote-3), two empty iced remotes, two 3-to-advance agendas in HQ, need 4 points.
    // Install both (n = 3), then each Flood places 3: both scored. Counted without the widening: 6 clicks + 2 x (n - 1) =
    // 6 against 2 x (3 + 1) = 8, a cut of a real line.
    const s = structuredClone(newGame(1));
    s.corp.rd.push(...s.corp.hq.splice(0));
    s.corp.clicks = 6;
    s.corp.credits = 20;
    s.corp.score = 3;
    installCorpForTest(s, HYPE, 'remote-3');
    for (const id of ['remote-1', 'remote-2', 'remote-3']) installIceForTest(s, ICE, id);
    giveCard(s, 'corp', TOMORROWS_HEADLINE);
    giveCard(s, 'corp', TOMORROWS_HEADLINE);
    giveCard(s, 'corp', FLOOD);
    giveCard(s, 'corp', FLOOD);
    expect(uncut(s)).not.toBeNull();
    expect(winNow(s)).not.toBeNull();
    expect(followWinNow(structuredClone(s)).winner).toBe('corp');
  });
});

/**
 * The soundness of both bounds, the test that matters (brief: "wherever the uncut search finds a win or a score, the cut
 * search finds one too"): built boards varied by clicks, credits, grip, tags, hand and remotes, some with damage cards,
 * some with Flood the Market, most with no win. The bound only prunes, so a line it cuts that wins is a bound too low.
 */
describe('soundness: the cut search finds every win and score the uncut search finds', () => {
  const AGENDAS = ['30052', '30060', '30069', '30068', '34040', '30070']; // 3/2, 3/2, 5/3, 4/2, 5/3, 3/1
  const OPERATIONS = [MEASURED_RESPONSE, '30049', '34045', '36053', '36053', '30075', '30040', TOUCH_UPS]; // + Neurospike, Mindscaping, Flood x2, Hedge Fund, Seamless Launch
  const ROOTS = ['36055', '35051']; // Hype Machine, Phật Gioan Baotixita
  const ICE = '30072';
  const RUNNER = [SURE_GAMBLE, PENNYSHAVER, '30020', '30031'];

  function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function board(seed: number): GameState {
    const r = rng(seed);
    const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
    const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const s = structuredClone(newGame(1));
    s.corp.rd.push(...s.corp.hq.splice(0));
    s.runner.stack.push(...s.runner.grip.splice(0));
    s.corp.clicks = int(1, 4);
    s.corp.credits = int(0, 15);
    s.corp.score = int(2, 6);
    s.runner.score = int(0, 6);
    s.runner.credits = int(0, 10);
    s.runner.tags = r() < 0.6 ? 0 : int(1, 3);
    s.runnerLastTurnRuns = (r() < 0.5 ? [{ server: 'hq', successful: true }] : []) as GameState['runnerLastTurnRuns'];
    for (let i = int(0, 5); i > 0; i--) giveCard(s, 'runner', pick(RUNNER));
    const remotes = int(0, 4);
    for (let i = 1; i <= remotes; i++) {
      const id = `remote-${i}`;
      const what = r();
      if (what < 0.4) {
        const card = installCorpForTest(s, pick(AGENDAS), id);
        const c = s.corp.servers[id].root.find(x => x.instanceId === card)!;
        c.advancementCounters = int(0, Math.max(0, (cardDef(c).advancement_cost ?? 0) - 1));
      } else if (what < 0.7) installCorpForTest(s, pick(ROOTS), id, r() < 0.5);
      else s.corp.servers[id] = { id, name: id, isRemote: true, ice: [], root: [] } as GameState['corp']['servers'][string];
      if (r() < 0.6) installIceForTest(s, ICE, id);
    }
    for (let i = int(1, 4); i > 0; i--) giveCard(s, 'corp', r() < 0.4 ? pick(AGENDAS) : pick(OPERATIONS));
    return s;
  }

  // SWEEP_BOARDS=n widens the sweep for a one-off local run
  const BOARDS = Number(process.env.SWEEP_BOARDS ?? 400);
  it(`over ${BOARDS} built boards (wins and scores counted, kills among them)`, () => {
    let wins = 0;
    let kills = 0;
    let scores = 0;
    const misses: string[] = [];
    const uncutScore = (s: GameState) => {
      winNowBound.uncut = true;
      try {
        return inDecision(s, 'corp', () => scoreNowPlan(s));
      } finally {
        winNowBound.uncut = false;
      }
    };
    for (let seed = 1; seed <= BOARDS; seed++) {
      const s = board(seed);
      const open = uncut(s);
      if (open) {
        wins++;
        // A kill: the line ends with the Runner flatlined, not 7 points (followed with the uncut search)
        let t = structuredClone(s);
        for (let i = 0; i < 20 && !t.winner; i++) {
          const a = uncut(t);
          if (!a) break;
          t = executeAction(t, a);
        }
        if (t.winner === 'corp' && t.corp.score < 7) kills++;
        if (!winNow(s)) misses.push(`win ${seed}`);
      }
      const openScore = uncutScore(s);
      if (openScore) {
        scores++;
        if (!inDecision(s, 'corp', () => scoreNowPlan(s))) misses.push(`score ${seed}`);
      }
    }
    console.log(`soundness sweep: ${BOARDS} boards, ${wins} with a win (${kills} by a kill), ${scores} with a score`);
    expect(misses).toEqual([]);
    expect(wins).toBeGreaterThan(20);
    expect(kills).toBeGreaterThan(5);
    expect(scores).toBeGreaterThan(50);
  }, 300_000);
});
