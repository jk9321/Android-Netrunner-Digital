/**
 * Counted scoring C2, plan.scoreInTwo (spec /mnt/project-files/netrunner-ai/redesign/spec-counted-scoring.md): when the
 * count says an agenda can be scored by the end of the Corp's next turn behind a server that holds in between, the Corp
 * plays that line (countedScore.ts scoreInTwoPick), keeps it in the agent's own memory, and finishes it next turn.
 * Stage 0b measured the forced two-turn half at +3.0 ± 1.8. Hand-built positions (System Gateway and Elevation cards)
 * shaped on the stage 0 misses (deal 1641 turn 7, deal 1681 turn 6): the recorded deals replay to other boards on
 * today's engine, so these are built from the stage 0 boards.
 *
 * Rules (Comprehensive Rules v26.03):
 *  - 1.17.3a "The Corp can only score an agenda that has advancement counters on it greater than or equal to its
 *    advancement requirement." 1.17.3b-c: the Corp may score it when it has priority in its own turn; scoring is not
 *    an action and costs no click.
 *  - 1.18.1 advancement counters are placed by advancing; 5.2.6f the basic action "[click], 1[credit]: Advance 1
 *    installed card"; 5.2.6a "[click]: Gain 1[credit]".
 *  - 8.5.11a the install cost of a piece of ice is 1 credit for each piece of ice already protecting the server.
 *  - 3.4.3a ice is rezzed when the Corp chooses, 6.9.2b as it is approached; 6.9.2c unrezzed ice is passed. So the hold
 *    is judged with the Corp's rez money as it ends its turn, against what the Runner could pay to break.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { GameAction, GameState, actingSide, executeAction, getLegalActions } from '../src/core';
import { createAgent } from '../src/ai';
import { tuning } from '../src/ai/synergy';
import { scoreInTwoPick } from '../src/ai/corp/placement';
import { knownIncome, scoreInTwo } from '../src/ai/corp/lines';
import { giveCard, installCorpForTest, installIceForTest, installProgramForTest, newGame } from './helpers';
import { inDecision } from './helpers/pricing';

const SEND_A_MESSAGE = '30069'; // agenda 5/3
const OFFWORLD_OFFICE = '30067'; // agenda 4/2
const PHAROS = '30063'; // rez 7
const WHITESPACE = '30074'; // code gate: the Runner loses 3 credits; End the run if the Runner has 6 credits or fewer
const PALISADE = '30072'; // barrier, strength 2, +2 strength protecting a remote; End the run
const CLEAVER = '30006'; // fracter, strength 3: 1 credit breaks up to 2 barrier subroutines, 2 credits +1 strength
const BUMI = '35041'; // Bumi 1.0, bioroid
const KESSLEROID = '35075'; // End the run, End the run
const FLYSWATTER = '35079';

const was = tuning.plan.scoreInTwo;
afterEach(() => {
  tuning.plan.scoreInTwo = was;
});

/** Corp turn 1 of a starter game with an empty HQ and the given credits (a copy). */
function corpMain(credits: number, clicks = 3): GameState {
  const s = structuredClone(newGame(1));
  s.corp.rd.push(...s.corp.hq.splice(0));
  s.corp.credits = credits;
  s.corp.clicks = clicks;
  return s;
}

/** Normal against Normal from the Corp's decision to the end of its next turn. */
function throughNextCorpTurn(s: GameState): { state: GameState; corpMoves: GameAction[][] } {
  const corp = createAgent('corp', 'normal', {});
  const runner = createAgent('runner', 'normal', {});
  const corpMoves: GameAction[][] = [[]];
  let corpTurns = 1;
  for (let i = 0; i < 150 && !s.winner; i++) {
    const side = actingSide(s);
    const a = (side === 'corp' ? corp : runner).chooseAction(s);
    if (side === 'corp' && s.activePlayer === 'corp') corpMoves[corpMoves.length - 1].push(a);
    const before = s.activePlayer;
    s = executeAction(s, a);
    if (before === 'runner' && s.activePlayer === 'corp') {
      corpTurns++;
      corpMoves.push([]);
    }
    if (corpTurns === 2 && before === 'corp' && s.activePlayer === 'runner') break;
  }
  return { state: s, corpMoves };
}

const credit = (s: GameState) => getLegalActions(s, 'corp').find(a => a.type === 'GAIN_CREDIT')!;
const pick = (s: GameState, p: GameAction, held: Parameters<typeof scoreInTwoPick>[2] = null) => inDecision(s, 'corp', () => scoreInTwoPick(s, p, held));

describe('plan.scoreInTwo: the Corp scores over two turns when the count holds (1.17.3a, 1.18.1, 5.2.6f, 3.4.3a, 6.9.2b-c)', () => {
  it('deal 1641 turn 7 shape: Send a Message into the standing iced remote and advanced twice, not Pharos first; scored next turn', () => {
    // 15 credits, 3 clicks; Send a Message and Pharos in HQ; remote-1 behind two Whitespace; the Runner on 1 credit, no breakers
    const build = () => {
      const s = corpMain(15);
      s.corp.score = 2;
      giveCard(s, 'corp', SEND_A_MESSAGE);
      giveCard(s, 'corp', PHAROS);
      installIceForTest(s, WHITESPACE, 'remote-1', true);
      installIceForTest(s, WHITESPACE, 'remote-1', false);
      s.runner.credits = 1;
      return s;
    };
    tuning.plan.scoreInTwo = false;
    const off = throughNextCorpTurn(build());
    expect(off.state.corp.score).toBe(2);
    tuning.plan.scoreInTwo = true;
    const s = build();
    expect(inDecision(s, 'corp', () => scoreInTwo(s))).toMatchObject({ agenda: 'Send a Message', server: 'remote-1', form: 'install', advanceNow: 2, advanceNext: 3 });
    const on = throughNextCorpTurn(s);
    expect(on.corpMoves[0].map(a => a.type)).toEqual(['INSTALL_CARD', 'ADVANCE_CARD', 'ADVANCE_CARD', 'END_TURN']);
    expect(on.state.corp.score).toBe(5);
  }, 60000);

  it('deal 1681 turn 6 shape: the finishing money is not spent on a third ice (8.5.11a)', () => {
    // 4 credits; Send a Message +1 in remote-1 behind Bumi 1.0 and Kessleroid (rezzed); Flyswatter in HQ
    tuning.plan.scoreInTwo = true;
    let s = corpMain(4);
    const agenda = installCorpForTest(s, SEND_A_MESSAGE, 'remote-1');
    s.corp.servers['remote-1'].root[0].advancementCounters = 1;
    installIceForTest(s, BUMI, 'remote-1', true);
    installIceForTest(s, KESSLEROID, 'remote-1', true);
    const fly = giveCard(s, 'corp', FLYSWATTER);
    // The line: advance once now, the two clicks left for credits (5 at the turn's end), three advances next turn
    const first = pick(s, credit(s));
    expect(first.action).toMatchObject({ type: 'ADVANCE_CARD', cardInstanceId: agenda });
    expect(first.held?.line).toMatchObject({ form: 'installed', advanceNow: 1, advanceNext: 3, rez: 0 });
    s = executeAction(s, first.action);
    // A third ice on remote-1 costs 2: the turn would end on 2 credits, one short of the three advances
    const third = getLegalActions(s, 'corp').find(a => a.type === 'INSTALL_CARD' && a.cardInstanceId === fly && (a as { targetServerId?: string }).targetServerId === 'remote-1')!;
    expect(third).toBeDefined();
    const vetoed = pick(s, third, first.held);
    expect(vetoed.action.type).toBe('GAIN_CREDIT');
    expect(vetoed.held).toBe(first.held);
    // A click for a credit keeps the line: the Corp's own pick stands
    const c = credit(s);
    expect(pick(s, c, first.held).action).toBe(c);
  });

  it('the count fails (a Runner with Cleaver and money breaks the remote): no line is begun and the pick stands', () => {
    tuning.plan.scoreInTwo = true;
    const s = corpMain(4);
    giveCard(s, 'corp', OFFWORLD_OFFICE);
    giveCard(s, 'corp', PALISADE);
    installProgramForTest(s, CLEAVER);
    s.runner.credits = 10;
    expect(inDecision(s, 'corp', () => scoreInTwo(s))).toBeNull();
    const c = credit(s);
    expect(pick(s, c)).toEqual({ action: c, held: null });
  });

  it("a new remote's ice is read at its real strength: Palisade protecting a remote is strength 4, 3 credits for Cleaver", () => {
    // Printed strength 2 is under Cleaver's 3 (1 credit to break); protecting a remote it is 4 (2 credits for +1, 1 to break)
    const build = (runnerCredits: number) => {
      const s = corpMain(8);
      giveCard(s, 'corp', OFFWORLD_OFFICE);
      giveCard(s, 'corp', PALISADE);
      installProgramForTest(s, CLEAVER);
      s.runner.credits = runnerCredits;
      s.runner.maxClicks = 1; // no spare clicks for credits: the budget is the Runner's credits
      return s;
    };
    tuning.plan.scoreInTwo = true;
    const two = build(2);
    expect(inDecision(two, 'corp', () => scoreInTwo(two))).toMatchObject({ agenda: 'Offworld Office', server: 'new remote', form: 'install+ice', rez: 3 });
    const three = build(3);
    expect(inDecision(three, 'corp', () => scoreInTwo(three))).toBeNull();
  });

  it('next turn, a Dividends agenda at its requirement is left to the Corp (it may over-advance it); another is scored', () => {
    tuning.plan.scoreInTwo = true;
    for (const [code, dividends] of [['35038', true], ['30060', false]] as const) {
      const s = corpMain(5);
      s.turnNumber = 3;
      const id = installCorpForTest(s, code, 'remote-1'); // Project Ingatan (Dividends 1) or Above the Law, both 3 to advance
      s.corp.servers['remote-1'].root[0].advancementCounters = 3;
      installIceForTest(s, PALISADE, 'remote-1', true);
      const held = { game: s.id, turn: 2, line: { agenda: '', agendaId: id, server: 'remote-1', form: 'installed' as const, advanceNow: 1, advanceNext: 1, rez: 0 }, server: 'remote-1', counters: 2 };
      const c = credit(s);
      const r = pick(s, c, held);
      expect(r.held).toBeNull();
      expect(r.action).toEqual(dividends ? c : expect.objectContaining({ type: 'SCORE_AGENDA', cardInstanceId: id }));
    }
  });

  it("next turn's income: the card entry's turnIncome of rezzed cards, a campaign no more than it holds", () => {
    const s = corpMain(4);
    const nico = installCorpForTest(s, '30037', 'remote-1', true); // Nico Campaign: when your turn begins, take 3 credits from this asset
    installCorpForTest(s, '35062', 'remote-2', true); // Public Access Plaza: when your turn begins, gain 1 credit
    installCorpForTest(s, '35062', 'remote-3'); // unrezzed: pays nothing
    const at = (id: string) => Object.values(s.corp.servers).flatMap(v => v.root).find(c => c.instanceId === id)!;
    at(nico).tokens = { credit: 9 };
    expect(knownIncome(s)).toBe(4);
    at(nico).tokens = { credit: 2 };
    expect(knownIncome(s)).toBe(3);
  });

  it('each income card pays through its entry: Otto 2, Nico 3, Anthill 4 (no more than they hold), Public Access Plaza 1', () => {
    for (const [code, pays] of [['35040', 2], ['30037', 3], ['35072', 4], ['35062', 1]] as const) {
      const s = corpMain(4);
      const id = installCorpForTest(s, code, 'remote-1', true);
      const card = s.corp.servers['remote-1'].root.find(c => c.instanceId === id)!;
      card.tokens = { credit: 9 };
      expect(knownIncome(s)).toBe(pays);
      card.tokens = { credit: 1 };
      expect(knownIncome(s)).toBe(1); // a campaign holding 1 pays 1; the Plaza pays 1 regardless
      card.isRezzed = false;
      expect(knownIncome(s)).toBe(0);
    }
  });

  it("a line held for another game is not this game's: it is dropped", () => {
    tuning.plan.scoreInTwo = true;
    const s = corpMain(4);
    const c = credit(s);
    const stale = { game: 'another game', turn: s.turnNumber, line: { agenda: 'Send a Message', agendaId: 'inst-1', server: 'remote-1', form: 'installed' as const, advanceNow: 1, advanceNext: 3, rez: 0 }, server: 'remote-1', counters: 1 };
    expect(pick(s, c, stale)).toEqual({ action: c, held: null });
  });

  it('switched off: the pick stands', () => {
    tuning.plan.scoreInTwo = false;
    const s = corpMain(8);
    giveCard(s, 'corp', OFFWORLD_OFFICE);
    giveCard(s, 'corp', PALISADE);
    const c = credit(s);
    expect(pick(s, c)).toEqual({ action: c, held: null });
  });
});

