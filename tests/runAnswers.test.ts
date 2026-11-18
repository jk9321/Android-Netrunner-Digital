/**
 * Stage D item 1 follow-up 3 (found-list row 13; followup3-run-answers/design-answer.md sections 3, 7.6 and 8.6): the
 * Corp's answers to its own prompts during a run, priced with the run under way (prompts.ts runAnswer: the hold owner's
 * run stand, runStands in corp/hold.ts, says whether the Runner gets in after each answer; runLoss prices the access).
 * Rules: 1.14.5 (the Corp, the ice's controller, makes the choices of its subroutines), 6.9.3c and 9.8.7b-c (subroutines
 * resolve in order; the end of the encounter stops the rest), 6.9.4 (Movement Phase), 6.9.2b (rez on approach), 1.7.2a
 * (7 points wins). Card texts (src/data): Ballista 30062 "Trash 1 installed program or end the run."; Shred 35005 "The
 * first time the Corp would end that run, prevent the run from ending unless the Corp reveals and trashes X cards from
 * HQ at random."; Boto 34109 "You may trash 1 card from HQ to end the run."; Anoetic Void 30050 "Whenever the Runner
 * approaches this server, you may pay 2 credits and trash 2 cards from HQ. If you do, end the run."; Lycian
 * Multi-Munition 34100 (choose subtypes on rez); Lightning Laboratory 34097 ("rez up to 2 pieces of ice protecting the
 * attacked server, ignoring all costs"); Cloud Eater 34110 "Trash 1 installed Runner card."
 * Each pin says whether it fails on beta 333c16e (the fix) or is a mirror that passes on both.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, activePrompt, executeAction, getLegalActions } from '../src/core';
import { createCardInstance } from '../src/core/engine/gameState';
import { createAgent } from '../src/ai';
import { answerPrompt, runTermStats, scoreOutcome, settledStand } from '../src/ai/prompts';
import { runStands, serverHold } from '../src/ai/corp/hold';
import { runRestWorth } from '../src/ai/runs';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';
import { approachIce, beginEncounter, enterMovement } from '../src/core/engine/ice';
import { trashInstalledCorpCard } from '../src/core/engine/helpers';
import { oracleGetsIn } from '../scripts/stage-d/hold-oracle';
import { clearCaches } from '../scripts/stage-a/harness';
import { installIceForTest, installProgramForTest, newGame, scoreForTest, startRunnerTurn } from './helpers';

const fixture = (name: string): GameState => JSON.parse(readFileSync(`tests/fixtures/run-answers/${name}.json`, 'utf8'));
/** The Normal Corp's move on a copy of the board. */
const corpMove = (s: GameState): GameAction => {
  clearCaches();
  return createAgent('corp', 'normal').chooseAction(structuredClone(s));
};
const pick = (a: GameAction): string | string[] => (a.type !== 'RESOLVE_PROMPT' ? a.type : a.choice.kind === 'effect_choice' ? a.choice.optionId : a.choice.kind === 'effect_cards' ? a.choice.cardInstanceIds : '?');
const title = (s: GameState, id: string) => [...s.runner.rig.programs, ...s.corp.hq].find(c => c.instanceId === id)?.cardCode;

describe('the run term: Ballista, Boto, Shred, Anoetic Void (recorded boards)', () => {
  it('deal 1601 T12, Ballista under Shred on a remote with an agenda: ends the run (fails on beta: trashes Marjanah)', () => {
    expect(pick(corpMove(fixture('deal-1601-t12-30062')))).toBe('end');
  });

  it('mirror: the same board with the agenda moved out of the root (nothing staked) keeps the program trash (both)', () => {
    const s = fixture('deal-1601-t12-30062');
    const sv = s.corp.servers[s.activeRun!.server];
    s.corp.hq.push(...sv.root.splice(0, sv.root.length));
    expect(pick(corpMove(s))).not.toBe('end');
  });

  it('deal 1601 T7, Ballista: ends the run (fails on beta)', () => {
    expect(pick(corpMove(fixture('deal-1601-t7-30062')))).toBe('end');
  });

  // Known-failing (ruling 5, found-list row 48, valuation): the Corp's board prices a lone barrier breaker at 20.8
  // against a 16 steal, so it trades the steal for the breaker. Tuning, not this branch.
  it.fails('deal 2873 T8, Ballista with Bumi behind: ends the run (known-failing: row 48)', () => {
    expect(pick(corpMove(fixture('deal-2873-t8-30062')))).toBe('end');
  });

  it('mirror: deal 1641 T21, every answer keeps the Runner out by the walk: the program trash stands (both)', () => {
    const s = fixture('deal-1641-t21-30062');
    const p = pick(corpMove(s));
    expect(p).not.toBe('end');
  });

  it("human report-39 T7, Boto's last subroutine on remote-1 with an agenda: trashes an HQ card to end the run (fails on beta: no trash)", () => {
    const p = pick(corpMove(fixture('report-39-t7-34109-108')));
    expect(Array.isArray(p) && p.length).toBe(1);
  });

  it("mirror: the same encounter's first Boto subroutine, with the second to come (the settle follows it): no trash yet (both)", () => {
    expect(pick(corpMove(fixture('report-39-t7-34109-107')))).toEqual([]);
  });

  it('mirror: human report-39 T1, Boto on R&D (little staked): no HQ trash (both)', () => {
    expect(pick(corpMove(fixture('report-39-t1-34109-16')))).toEqual([]);
  });

  it('mirror: deal 1841 T9, Shred on a remote with no agenda (runLoss 0): the Corp does not pay (both)', () => {
    expect(pick(corpMove(fixture('deal-1841-t9-35005')))).toBe('no');
  });

  it("mirror: deal 2241 T13, Anoetic Void at runLoss 0 keeps today's answer (both; found row 59 is its own item)", () => {
    const s = fixture('deal-2241-t13-30050');
    expect(pick(corpMove(s))).toBe(pick(answerPrompt(structuredClone(s), 'corp', undefined, true)));
    expect(pick(corpMove(s))).toBe('no');
  });

  it("Shred's reveal is chance: the same board under two RNG states gives the same answer (ruling 3)", () => {
    // Deal 1601 T12: Ballista's "end" opens Shred's question
    const s = fixture('deal-1601-t12-30062');
    const p = activePrompt(s)!;
    const ended = executeAction(s, { type: 'RESOLVE_PROMPT', player: 'corp', promptId: p.id, choice: { kind: 'effect_choice', optionId: 'end' } });
    const q = activePrompt(ended)!;
    expect('source' in q && q.source.cardCode).toBe('35005');
    const boards = [1, 2, 3, 4, 5, 6].map(k => {
      const t = structuredClone(ended);
      t.rng = { ...t.rng, state: (k * 2654435761) >>> 0 };
      return t;
    });
    // The RNG states do pick different cards (the pin would say nothing otherwise)
    const trashed = boards.map(t => {
      const a = executeAction(t, { type: 'RESOLVE_PROMPT', player: 'corp', promptId: q.id, choice: { kind: 'effect_choice', optionId: 'trash' } });
      return t.corp.hq.filter(c => !a.corp.hq.some(h => h.instanceId === c.instanceId)).map(c => c.instanceId).sort().join();
    });
    expect(new Set(trashed).size).toBeGreaterThan(1);
    const answers = boards.map(t => {
      clearCaches();
      return pick(answerPrompt(t, 'corp', undefined, true));
    });
    expect(new Set(answers).size).toBe(1);
    // Fails on beta on the answer ('no' on every RNG state): the run term ends the run
    expect(answers[0]).toBe('trash');
  });
});

describe("Shred's reveal priced as chance (ruling 3; review R1)", () => {
  /**
   * Deal 1601 T12 with its server's root, HQ and the Runner's score set, then Ballista's "end": Shred's question, X = the
   * cards in the root (Shred 35005: "reveals and trashes X cards from HQ at random. X is equal to the number of cards in
   * the root of the attacked server").
   */
  function shred(root: string[], hq: string[], score: number): GameState {
    const s = fixture('deal-1601-t12-30062');
    // A game of its own: the value caches are kept per game id and read hand cards by instance id, which these boards
    // reuse for other cards
    s.id = `${s.id}:${root}:${hq}`;
    s.runner.score = score;
    s.corp.servers[s.activeRun!.server].root = root.map(c => createCardInstance(s, c));
    s.corp.hq = hq.map(c => createCardInstance(s, c));
    const p = activePrompt(s)!;
    const ended = executeAction(s, { type: 'RESOLVE_PROMPT', player: 'corp', promptId: p.id, choice: { kind: 'effect_choice', optionId: 'end' } });
    const q = activePrompt(ended)!;
    expect('source' in q && q.source.cardCode).toBe('35005');
    return ended;
  }
  /** The board under 8 RNG states: the cards each state's reveal trashes, and the Corp's answer on it. */
  function underRng(e: GameState) {
    const q = activePrompt(e)!;
    return [1, 2, 3, 4, 5, 6, 7, 8].map(k => {
      const t = structuredClone(e);
      t.rng = { ...t.rng, state: (k * 2654435761) >>> 0 };
      const a = executeAction(t, { type: 'RESOLVE_PROMPT', player: 'corp', promptId: q.id, choice: { kind: 'effect_choice', optionId: 'trash' } });
      const gone = t.corp.hq.filter(c => !a.corp.hq.some(h => h.instanceId === c.instanceId)).map(c => c.cardCode);
      const decided = runTermStats.decided;
      // Through the agent's decision, which notes what the Corp knows (its own HQ) for this board
      const answer = pick(corpMove(t));
      return { gone, answer, decided: runTermStats.decided - decided };
    });
  }

  it('the cards the reveal takes do not decide: Send a Message among three cheap cards, Orbital Superiority staked (fails with the trash priced by its simulated board)', () => {
    // X = 1. Each RNG state trashes one card; on some it is Send a Message (30069). A board on which the reveal took it
    // loses a 3-point agenda and scores far under "no" less runLoss (16). The agent decides on its decision view, whose
    // RNG is a seed of its own (the real one is dropped, src/core/view.ts), so a pick priced by the simulated board prices
    // one fixed reveal on every state, which on some of the four HQ orders below is Send a Message's: there it says "no"
    // throughout. Priced as chance, the expectation over the four cards says "trash" on every order and state
    for (const hq of [['30069', '30065', '30065', '30054'], ['30065', '30069', '30065', '30054'], ['30065', '30065', '30069', '30054'], ['30065', '30065', '30054', '30069']]) {
      const runs = underRng(shred(['30068'], hq, 0));
      expect(runs.map(r => r.gone.join())).toContain('30069');
      expect(runs.some(r => r.gone.join() !== '30069')).toBe(true);
      expect(runs.map(r => r.answer), hq.join()).toEqual(Array(8).fill('trash'));
      expect(runs.every(r => r.decided === 1)).toBe(true);
    }
  });

  it("the expected loss decides: four Urtica Cipher in HQ, three cards in the root, a 1-point agenda staked: the Corp does not pay (fails with the expected loss not charged)", () => {
    // X = 3 (Superconducting Hub, Manegarm Skunkworks, AMAZE Amusements): any reveal trashes three of the four Urticas.
    // runLoss is 8; the expected loss of three of the hand's four cards by its owner is more, so "no" (the Runner gets in)
    // beats "trash" (out). Without the loss charged, "trash" is the dearer board's better score
    const e = shred(['30070', '30042', '30058'], ['30045', '30045', '30045', '30045'], 0);
    const server = e.activeRun!.server;
    const q = activePrompt(e)!;
    const stand = (optionId: string) => {
      clearCaches();
      return settledStand(executeAction(structuredClone(e), { type: 'RESOLVE_PROMPT', player: 'corp', promptId: q.id, choice: { kind: 'effect_choice', optionId } }), server)?.verdict();
    };
    expect([stand('trash'), stand('no')]).toEqual(['out', 'in']);
    const runs = underRng(e);
    expect(runs.map(r => r.answer)).toEqual(Array(8).fill('no'));
    expect(runs.every(r => r.decided === 1)).toBe(true);
  });

  it('past 70 sets of cards (nine in HQ, X = 3: 84 sets), the expectation is x times a single card\'s mean: the same answer on every RNG state, and the loss still decides (fails with the loss not charged)', () => {
    // hqChanceLoss's second branch (sets past 70). The nine cards differ in worth, so the reveals differ by state
    const runs = underRng(shred(['30070', '30042', '30058'], ['30045', '30061', '30064', '30075', '30048', '30057', '30065', '30054', '30041'], 0));
    expect(new Set(runs.map(r => r.gone.slice().sort().join())).size).toBeGreaterThan(1);
    expect(runs.map(r => r.answer)).toEqual(Array(8).fill('no'));
    expect(runs.every(r => r.decided === 1)).toBe(true);
  });
});

/** A remote with an agenda in the root, the Runner's turn, no Corp hand (test boards). */
function board(setup: (s: GameState) => void): GameState {
  const s = newGame(3);
  s.corp.hq = [];
  s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  s.corp.credits = 12;
  s.turnNumber = 7;
  setup(s);
  s.corp.servers.remote1?.root.push(createCardInstance(s, '30036'));
  return s;
}
/** Steps the run (the Runner continues, breaks nothing; the Corp passes) until `until` holds. */
function runTo(s: GameState, until: (s: GameState) => boolean): GameState {
  for (let k = 0; k < 30 && !until(s); k++) {
    const p = activePrompt(s);
    const side = p ? p.side : s.priority?.holder ?? s.activePlayer;
    const legal = getLegalActions(s, side) as GameAction[];
    const a = p ? (legal.find(x => x.type === 'RESOLVE_PROMPT') as GameAction) : (legal.find(x => x.type === 'CONTINUE_RUN') ?? legal.find(x => x.type === 'PASS'))!;
    s = executeAction(s, a);
  }
  return s;
}

describe('the run term ahead of the per-card blocks (ruling 8.1)', () => {
  it('row 58: Carmen + Marjanah at $3 with 1 click, Tatu-Bola inside Lycian: barrier or barrier + code gate (fails on beta: code gate)', () => {
    let s = board(st => {
      installIceForTest(st, '34044', 'remote1', false);
      installIceForTest(st, '34100', 'remote1', false);
      installProgramForTest(st, '30015');
      installProgramForTest(st, '30016');
    });
    const lycian = s.corp.servers.remote1.ice[1].instanceId;
    startRunnerTurn(s);
    s.runner.credits = 3;
    s.runner.clicks = 1;
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote1' });
    s = runTo(s, x => x.priority?.holder === 'corp' && x.activeRun?.phase === 'approach_ice');
    s = executeAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: lycian });
    const p = activePrompt(s)!;
    expect('source' in p && p.source.step).toBe('subtypes');
    expect(['barrier', 'barrier+code gate']).toContain(pick(corpMove(s)));
  });

  it("Lightning Laboratory: one unrezzed Kessleroid on HQ, the Corp at $0, a Runner without breakers: rezzes it (fails on beta: the block's 3-credit floor)", () => {
    let s = scoreForTest(newGame(3), '34097');
    for (const sv of Object.values(s.corp.servers)) sv.ice = [];
    s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
    s.corp.hq = [createCardInstance(s, '30036')];
    s.turnNumber = 7;
    installIceForTest(s, '35075', 'hq', false);
    startRunnerTurn(s);
    s.corp.credits = 0;
    s.runner.credits = 5;
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    const p = activePrompt(s)!;
    expect('source' in p && p.source.cardCode).toBe('34097');
    expect(pick(corpMove(s))).toHaveLength(1);
  });

  it('mirror: the same board with the Corp at $5 (it can rez Kessleroid itself): the block answers as today (both)', () => {
    let s = scoreForTest(newGame(3), '34097');
    for (const sv of Object.values(s.corp.servers)) sv.ice = [];
    s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
    s.corp.hq = [createCardInstance(s, '30036')];
    s.turnNumber = 7;
    installIceForTest(s, '35075', 'hq', false);
    startRunnerTurn(s);
    s.corp.credits = 5;
    s.runner.credits = 5;
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    expect(pick(corpMove(s))).toEqual([]);
  });

  it("mirror: the Corp at $0 with no agenda in HQ (runLoss 0): the term is not asked and the block's answer stands, though its priced pick would rez (both; fails with the runLoss 0 gate removed; review R2)", () => {
    // HQ holds one Retribution (30065), so the run stakes nothing. Kessleroid's free rez keeps the Runner out and is the
    // better one-step board (freeRezSaving), so a term asked here would rez it: the gate is what keeps today's answer
    let s = scoreForTest(newGame(3), '34097');
    for (const sv of Object.values(s.corp.servers)) sv.ice = [];
    s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
    s.corp.hq = [createCardInstance(s, '30065')];
    s.turnNumber = 7;
    installIceForTest(s, '35075', 'hq', false);
    startRunnerTurn(s);
    s.corp.credits = 0;
    s.runner.credits = 5;
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    const p = activePrompt(s)!;
    expect('source' in p && p.source.cardCode).toBe('34097');
    const asked = runTermStats.asked;
    expect(pick(corpMove(s))).toEqual([]);
    expect(runTermStats.asked).toBe(asked);
  });

  it("a tie goes to today's answer: Lycian alone, a Runner with only a decoder (Buzzsaw): barrier and barrier + sentry keep it out at the same price, and the block's barrier + sentry is the pick (review R4)", () => {
    // Lycian's block names the subtypes the Runner has no breaker for (barrier + sentry). The run term's best answers are
    // barrier and barrier + sentry (out, equal one-step boards: the subtypes change no score); options list barrier first
    let s = board(st => {
      installIceForTest(st, '34100', 'remote1', false);
      installProgramForTest(st, '30005');
    });
    const lycian = s.corp.servers.remote1.ice[0].instanceId;
    startRunnerTurn(s);
    s.runner.credits = 3;
    s.runner.clicks = 1;
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote1' });
    s = runTo(s, x => x.priority?.holder === 'corp' && x.activeRun?.phase === 'approach_ice');
    s = executeAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: lycian });
    const p = activePrompt(s)!;
    expect('source' in p && p.source.step).toBe('subtypes');
    const after = (optionId: string) => executeAction(s, { type: 'RESOLVE_PROMPT', player: 'corp', promptId: p.id, choice: { kind: 'effect_choice', optionId } });
    const stands = Object.fromEntries(
      ['barrier', 'code gate', 'sentry', 'barrier+code gate', 'barrier+sentry', 'code gate+sentry', 'all'].map(id => {
        clearCaches();
        return [id, settledStand(after(id), 'remote1')?.verdict()];
      })
    );
    expect(stands).toEqual({ barrier: 'out', 'code gate': 'in', sentry: 'in', 'barrier+code gate': 'in', 'barrier+sentry': 'out', 'code gate+sentry': 'in', all: 'in' });
    clearCaches();
    expect(scoreOutcome(s, after('barrier'), 'corp', undefined, true)).toBe(scoreOutcome(s, after('barrier+sentry'), 'corp', undefined, true));
    const decided = runTermStats.decided;
    expect(pick(corpMove(s))).toBe('barrier+sentry');
    expect(runTermStats.decided).toBe(decided + 1);
  });
});

describe('the trash target (ruling 7.5, red team rt-sweep)', () => {
  /** Cloud Eater rezzed outside an unrezzed Tatu-Bola, Carmen (killer) and Marjanah (fracter), the Runner at `credits`. */
  function cloudEater(credits: number): GameState {
    let s = board(st => {
      installIceForTest(st, '34044', 'remote1', false);
      installIceForTest(st, '34110', 'remote1', true);
      installProgramForTest(st, '30015');
      installProgramForTest(st, '30016');
    });
    startRunnerTurn(s);
    s.runner.credits = credits;
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote1' });
    return runTo(s, x => {
      const p = activePrompt(x);
      return !!p && p.side === 'corp' && 'source' in p && p.source.cardCode === '34110';
    });
  }

  it('a poor Runner: the Corp trashes the card whose loss keeps it out (Marjanah, the fracter for Tatu-Bola) (fails on beta)', () => {
    const s = cloudEater(2);
    expect(activePrompt(s)?.side).toBe('corp');
    const p = pick(corpMove(s));
    expect([p].flat().map(id => title(s, id))).toEqual(['30016']);
  });

  it("mirror: a Runner too poor for Tatu-Bola either way: every trash leaves the same verdict and today's answer stands (both)", () => {
    const s = cloudEater(0);
    clearCaches();
    expect(pick(corpMove(s))).toEqual(pick(answerPrompt(structuredClone(s), 'corp', undefined, true)));
  });
});

describe("the hold owner's run stand (ruling 4: the 'thisRun' walk from where the run stands)", () => {
  it('a run over: in when it was successful on the server, out otherwise; a game over by its winner', () => {
    const s = newGame(3);
    s.runsThisTurn = [{ server: 'hq', successful: true } as GameState['runsThisTurn'][number]];
    expect(runStands(s, 'hq')?.verdict()).toBe('in');
    expect(runStands(s, 'rd')?.verdict()).toBe('out');
    expect(runStands({ ...s, winner: 'corp' }, 'hq')?.verdict()).toBe('out');
    // The Runner has won (1.7.2a): in, on a server where the run over would read "out" (review R6)
    expect(runStands({ ...s, winner: 'runner' }, 'rd')?.verdict()).toBe('in');
  });

  it("the server's approach is in: the ice passed unrezzed is not met again (6.9.4e, 6.9.5; review R6: walked from the outermost ice, the Corp's rez of Tatu-Bola would read out)", () => {
    let s = board(st => {
      installIceForTest(st, '34044', 'remote1', false);
    });
    startRunnerTurn(s);
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote1' });
    // The Corp passes at the approach (no rez), the Runner goes on
    s = runTo(s, x => x.activeRun?.phase === 'approach_server');
    expect(s.activeRun?.phase).toBe('approach_server');
    expect(s.corp.servers.remote1.ice[0].isRezzed).toBe(false);
    expect(runStands(s, 'remote1')?.verdict()).toBe('in');
  });

  it("a run in its 'complete' phase short of the server is out (6.9.6; review R6). No engine path sets the phase today (src/core/types/state.ts RunPhase, read by the UI's PhaseTracker): the line reads that phase as 6.9.6 does, pinned on a hand-set board", () => {
    // 5ab4376 added it with the brute-force reference, from the phase's type, not from a recorded board: the 3,000 runs
    // stop at the approach, an encounter, after resolved subroutines and the Movement Phase, never at 'complete'
    let s = board(st => {
      st.corp.servers.remote1 = { id: 'remote1', name: 'remote1', isRemote: true, ice: [], root: [] };
    });
    startRunnerTurn(s);
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote1' });
    const t = structuredClone(s);
    t.activeRun = { ...t.activeRun!, phase: 'complete' };
    // With no ice on the server a walk from the approach would read "in"
    expect(runStands(t, 'remote1')?.verdict()).toBe('out');
  });

  it("no bypass while the subroutines resolve: Physarum Entangler on Flyswatter bypasses it at the encounter, not once its subroutine resolves (6.9.3c, 6.5.8a; review R6)", () => {
    let s = board(st => {
      const ice = installIceForTest(st, '35079', 'remote1', true);
      const physarum = installProgramForTest(st, '34082');
      st.runner.rig.programs.find(c => c.instanceId === physarum)!.hostedOnId = ice;
    });
    startRunnerTurn(s);
    s.runner.credits = 5;
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote1' });
    s = runTo(s, x => x.activeRun?.phase === 'encounter_ice');
    // Physarum's own question at the encounter ("pay 1 credit a subroutine to bypass?"): the Runner declines it here
    const p = activePrompt(s)!;
    expect(p.side === 'runner' && 'source' in p && p.source.cardCode).toBe('34082');
    s = executeAction(s, { type: 'RESOLVE_PROMPT', player: 'runner', promptId: p.id, choice: { kind: 'effect_choice', optionId: 'no' } });
    const run = s.activeRun!;
    expect(run.phase).toBe('encounter_ice');
    expect(activePrompt(s)).toBeFalsy();
    // Its subroutine resolving (the break and bypass windows over, 6.9.3c): End the run, out. The walk's bypass, if
    // tried here, would pay the credit and read "in"
    const t = structuredClone(s);
    t.activeRun = { ...run, encounter: { ...run.encounter!, resolvingIndex: 0 } };
    clearCaches();
    expect(runStands(t, 'remote1')?.verdict()).toBe('out');
  });

  it('nothing holds (no keep-out answer): a Boto encounter with HQ empty offers no end, and the answer is today\'s', () => {
    let s = board(st => {
      installIceForTest(st, '34109', 'remote1', true);
    });
    startRunnerTurn(s);
    s.runner.credits = 0;
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote1' });
    s = runTo(s, x => {
      const p = activePrompt(x);
      return !x.activeRun || (!!p && p.side === 'corp');
    });
    const p = activePrompt(s);
    if (p && p.side === 'corp') expect(pick(corpMove(s))).toEqual(pick(answerPrompt(structuredClone(s), 'corp', undefined, true)));
    else expect(s.activeRun).toBeFalsy();
  });
});

describe('the run stand against the engine oracle (ruling 4: scenario boards from where a run stands)', () => {
  /** The oracle's truth: some set of the server's unrezzed ice, rezzed as approached, keeps the Runner out (scripts/stage-d/hold-oracle.ts, 'thisRun'). */
  function oracleOut(s: GameState, server: string): boolean {
    const open = s.corp.servers[server].ice.filter(c => !c.isRezzed).map(c => c.instanceId);
    for (let mask = 0; mask < 1 << open.length; mask++) {
      const rez = open.filter((_, i) => mask & (1 << i));
      if (oracleGetsIn(s, server, 'thisRun', rez, undefined, 200_000).answer === 'holds') return true;
    }
    return false;
  }
  /** Each answer of the Corp's prompt: the walk's verdict on the settled board and the oracle's, on the same board. */
  function both(s: GameState, server: string) {
    const p = activePrompt(s)!;
    return (getLegalActions(s, 'corp') as GameAction[])
      .filter(a => a.type === 'RESOLVE_PROMPT' && a.promptId === p.id)
      .map(a => {
        const after = executeAction(s, a);
        const stand = runStands(after, server);
        return { answer: pick(a), walk: stand?.verdict() ?? null, oracle: after.activeRun ? (oracleOut(after, server) ? 'out' : 'in') : stand?.verdict() };
      });
  }

  it('Cloud Eater: after each trash, in the Movement Phase before an unrezzed Tatu-Bola (6.9.4d, 6.9.2b): the walk agrees with the oracle', () => {
    for (const credits of [0, 2]) {
      let s = board(st => {
        installIceForTest(st, '34044', 'remote1', false);
        installIceForTest(st, '34110', 'remote1', true);
        installProgramForTest(st, '30015');
        installProgramForTest(st, '30016');
      });
      startRunnerTurn(s);
      s.runner.credits = credits;
      s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote1' });
      s = runTo(s, x => {
        const p = activePrompt(x);
        return !!p && p.side === 'corp' && 'source' in p && p.source.cardCode === '34110';
      });
      for (const r of both(s, 'remote1')) expect(r.walk, JSON.stringify(r)).toBe(r.oracle);
    }
  });

  it('Vicsek trashing itself between two ice, ice outward of it, a Runner who can break the inner Palisade: the walk agrees with the oracle at every step of the run (6.2.4, 6.2.6b, 8.5.10; ice leaving the server under the run)', () => {
    // Vicsek 36042: "Give the Runner 1 tag. Trash this ice." Remote 1, innermost first: Palisade (rezzed), Vicsek
    // (rezzed), Palisade (unrezzed, outermost). Marjanah breaks Palisade with the credits the Runner has
    for (const credits of [0, 10]) {
      let s = board(st => {
        installIceForTest(st, '30072', 'remote1', true);
        installIceForTest(st, '36042', 'remote1', true);
        installIceForTest(st, '30072', 'remote1', false);
        installProgramForTest(st, '30016');
      });
      startRunnerTurn(s);
      s.runner.credits = credits;
      s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote1' });
      let after = 0;
      for (let k = 0; k < 40 && s.activeRun; k++) {
        const p = activePrompt(s);
        if (!(p && p.side === 'corp')) {
          clearCaches();
          const walk = runStands(s, 'remote1')?.verdict();
          expect(walk, `step ${k} $${credits} ${s.activeRun.phase} pos ${s.activeRun.icePosition}`).toBe(oracleOut(s, 'remote1') ? 'out' : 'in');
          if (!s.corp.servers.remote1.ice.some(c => c.cardCode === '36042')) after++;
        }
        // One step: the Runner continues and breaks nothing, the Corp passes and rezzes nothing (runTo's moves)
        const side = p ? p.side : s.priority?.holder ?? s.activePlayer;
        const legal = getLegalActions(s, side) as GameAction[];
        s = executeAction(s, (p ? legal.find(x => x.type === 'RESOLVE_PROMPT') : (legal.find(x => x.type === 'CONTINUE_RUN') ?? legal.find(x => x.type === 'PASS')))!);
      }
      // Vicsek did trash itself, and the stand was asked with it gone
      expect(after).toBeGreaterThan(0);
    }
  });

  it("Lycian's subtypes at the approach (rezzed, the encounter to come): the walk agrees with the oracle on every choice", () => {
    for (const credits of [3, 4]) {
      let s = board(st => {
        installIceForTest(st, '34044', 'remote1', false);
        installIceForTest(st, '34100', 'remote1', false);
        installProgramForTest(st, '30015');
        installProgramForTest(st, '30016');
      });
      const lycian = s.corp.servers.remote1.ice[1].instanceId;
      startRunnerTurn(s);
      s.runner.credits = credits;
      s.runner.clicks = 1;
      s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote1' });
      s = runTo(s, x => x.priority?.holder === 'corp' && x.activeRun?.phase === 'approach_ice');
      s = executeAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: lycian });
      // A sentry choice gives Lycian "Trash 1 installed program", which the walk carries as inert (hold.ts INERT; the
      // trashed-breaker count was parked for good by Jeff, 2026-11-18): there the walk may say "in" where the oracle's
      // Corp trashes the fracter, toward letting the Runner in (the safe side for this term: it never picks such an answer as a keep-out)
      for (const r of both(s, 'remote1')) {
        if (String(r.answer).includes('sentry') || r.answer === 'all') {
          if (r.walk !== r.oracle) expect([r.walk, r.oracle], JSON.stringify(r)).toEqual(['in', 'out']);
        } else expect(r.walk, JSON.stringify(r)).toBe(r.oracle);
      }
    }
  });
});

describe("the settle: the Corp's follow-up prompts as its choice (ruling 10, option A)", () => {
  type V = 'in' | 'out' | null;
  /** Each legal answer of the open Corp prompt, played by the engine (an answer it refuses is no answer). */
  const next = (s: GameState): GameState[] => {
    const p = activePrompt(s)!;
    return (getLegalActions(s, 'corp') as GameAction[])
      .filter(a => a.type === 'RESOLVE_PROMPT' && a.promptId === p.id)
      .flatMap(a => {
        try {
          return [executeAction(s, a)];
        } catch {
          return [];
        }
      });
  };
  const followUp = (s: GameState, server: string) => {
    const p = activePrompt(s);
    return !!p && p.side === 'corp' && s.activeRun?.server === server && !s.winner;
  };
  /** The brute force by the engine: at a Corp follow-up of the run, `node` combines its answers' stands; elsewhere the walk reads the board. */
  function brute(s: GameState, server: string, node: (vs: V[]) => V, depth = 0): V {
    if (followUp(s, server) && depth < 8) {
      const vs = next(s).map(x => brute(x, server, node, depth + 1));
      if (vs.length) return vs.includes(null) ? null : node(vs);
      return runStands({ ...s, pendingPrompts: [] }, server)?.verdict() ?? null;
    }
    return runStands(s, server)?.verdict() ?? null;
  }
  const or = (vs: V[]): V => (vs.includes('out') ? 'out' : 'in');
  const and = (vs: V[]): V => (vs.every(v => v === 'out') ? 'out' : 'in');
  const first = (vs: V[]): V => vs[0];

  it('equals an OR over the answers by the engine on every answer of the recorded run prompts; AND and first-answer-only differ somewhere', () => {
    const names = ['deal-1601-t12-30062', 'deal-1601-t7-30062', 'deal-2873-t8-30062', 'deal-1641-t21-30062', 'deal-1841-t9-35005', 'report-39-t7-34109-107', 'report-39-t7-34109-108', 'report-39-t1-34109-16'];
    let nodes = 0;
    let andDiffers = 0;
    let firstDiffers = 0;
    for (const name of names) {
      const s = fixture(name);
      const server = s.activeRun!.server;
      for (const after of next(s)) {
        clearCaches();
        const got = settledStand(after, server)?.verdict() ?? null;
        expect(got, `${name}`).toBe(brute(after, server, or));
        if (!followUp(after, server)) continue;
        nodes++;
        if (brute(after, server, and) !== got) andDiffers++;
        if (brute(after, server, first) !== got) firstDiffers++;
      }
    }
    // The boards hold Corp follow-ups (Shred's reveal after Ballista's end, Boto's second subroutine) where the reading matters
    expect(nodes).toBeGreaterThanOrEqual(3);
    expect(andDiffers).toBeGreaterThan(0);
    expect(firstDiffers).toBeGreaterThan(0);
  });

  it('past the cap (3 Corp follow-ups) the verdict is not known, and a follow-up with an answer not known is not known; one short of that it is followed (ruling 12)', () => {
    // Boto's first subroutine with the second to come: its "trash" answer ends the run ("out"), its "no trash" answer
    // opens the second subroutine, a Corp follow-up whose answers separate (one ends the run)
    const s = fixture('report-39-t7-34109-107');
    const server = s.activeRun!.server;
    const before = runTermStats.capped;
    const past = settledStand(s, server, false, 3);
    expect(runTermStats.capped).toBe(before + 1);
    expect(past?.key).toBe('not known');
    expect(past?.verdict()).toBe('not known');
    // At depth 2 the second subroutine's prompt is past the cap: not known, and so is this follow-up, though its "trash"
    // answer is a known "out" (no "out" beside a "not known": the Corp will not decide that follow-up by this rule)
    const at = settledStand(s, server, false, 2);
    expect(at?.key).toBe('not known');
    expect(at?.verdict()).toBe('not known');
    expect(runTermStats.capped).toBe(before + 2);
    // One shallower, the second subroutine's prompt is at the cap's last level: followed, a choice node, "out"
    const followed = settledStand(s, server, false, 1);
    expect(followed?.key.startsWith('["or"')).toBe(true);
    expect(followed?.verdict()).toBe('out');
    expect(runTermStats.capped).toBe(before + 2);
  });

  it("deals 2111 T7 and 2051 T8, Mycoweb's rez step (a chain longer than the cap): one answer known, another not known, so the run term does not decide and the pick is beta's (fails on d1b15d2: 2111 rezzed nothing, 2051 another ice)", () => {
    for (const [name, beta] of [['deal-2111-t7-35053', 'inst-35'], ['deal-2051-t8-35053', 'inst-34']] as const) {
      const s = fixture(name);
      const server = s.activeRun!.server;
      const p = activePrompt(s)!;
      const stands = (getLegalActions(s, 'corp') as GameAction[])
        .filter(a => a.type === 'RESOLVE_PROMPT' && a.promptId === p.id)
        .map(a => {
          clearCaches();
          return settledStand(executeAction(s, a), server)?.verdict();
        });
      expect(stands, name).toContain('not known');
      expect(stands.some(v => v === 'in' || v === 'out'), name).toBe(true);
      const decided = runTermStats.decided;
      expect(pick(corpMove(s)), name).toEqual([beta]);
      expect(runTermStats.decided, name).toBe(decided);
    }
  });

  it("ruling 12.2 at the answered prompt: a known in, a known out and a not known is not decided, not decided among the known two (review R3; fails when the not-known answer is skipped)", () => {
    // Deal 2111 T7 with R&D's Flyswatter swapped for a rezzed Virtual Service Agent (34054, a code gate whose subroutine
    // ends nothing), the Corp at $4 and the Runner at $4 with 2 clicks. Rezzing nothing: Mycoweb's code-gate subroutine
    // resolves Virtual Service Agent's and the Runner gets past the one rezzed Brân inside, in; rezzing the second Brân
    // (inst-32, 4 credits after Mycoweb's discount; 6 on its approach, which the Corp cannot pay): out; rezzing Doomscroll
    // on HQ (inst-35) opens the sentry and code-gate subroutines' choices, 4 follow-ups deep: not known
    const s = fixture('deal-2111-t7-35053');
    const gate = createCardInstance(s, '34054');
    gate.isRezzed = true;
    s.corp.servers.rd.ice = [gate];
    s.runner.credits = 4;
    s.runner.clicks = 2;
    s.corp.credits = 4;
    const server = s.activeRun!.server;
    const p = activePrompt(s)!;
    const stands = Object.fromEntries(
      (getLegalActions(s, 'corp') as GameAction[])
        .filter(a => a.type === 'RESOLVE_PROMPT' && a.promptId === p.id)
        .map(a => {
          clearCaches();
          return [String(pick(a)), settledStand(executeAction(s, a), server)?.verdict()];
        })
    );
    expect(stands).toEqual({ '': 'in', 'inst-35': 'not known', 'inst-32': 'out' });
    const asked = runTermStats.asked;
    const decided = runTermStats.decided;
    // Beta 0137d5f's pick on this board (checked there), today's answer
    expect(pick(corpMove(s))).toEqual(['inst-35']);
    expect(runTermStats.asked).toBeGreaterThan(asked);
    expect(runTermStats.decided).toBe(decided);
  });

  it("a Runner prompt that is not a subroutine's choice is the Runner's side, and counted", () => {
    // Funhouse's encounter ability (end the run unless the Runner takes 1 tag) is the ice's, not a subroutine's choice
    let s = board(st => {
      installIceForTest(st, '30054', 'remote1', true);
    });
    startRunnerTurn(s);
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote1' });
    s = runTo(s, x => activePrompt(x)?.side === 'runner');
    const p = activePrompt(s)!;
    expect('source' in p && p.source.cardCode).toBe('30054');
    const before = runTermStats.runnerOther;
    expect(settledStand(s, 'remote1')?.verdict()).toBe('in');
    expect(runTermStats.runnerOther).toBe(before + 1);
  });

  it("human report-49 T12, Lycian's trash under Thunderbolt Armaments: the granted subroutine's prompt is the ice's own, and the answers' stands separate (fails on 14e22de: all \"in\")", () => {
    // Thunderbolt Armaments 34096 grants the encountered ice "End the run unless the Runner trashes 1 of their installed
    // cards" after its other subroutines; its prompt names the identity as source. Only ice has subroutines (9.8.1), and a
    // subroutine gained from an ability that adds it after the others is ordered among the ice's own (9.8.3e): the walk
    // reads the prompt as the subroutine still ahead (ruling 11.2), not as a card's trigger it cannot read
    const s = fixture('report-49-t12-34100-87');
    const server = s.activeRun!.server;
    const p = activePrompt(s)!;
    const before = runTermStats.runnerOther;
    const stands = (getLegalActions(s, 'corp') as GameAction[])
      .filter(a => a.type === 'RESOLVE_PROMPT' && a.promptId === p.id)
      .map(a => {
        const after = executeAction(s, a);
        const q = activePrompt(after)!;
        expect(q.side === 'runner' && 'source' in q && q.source.cardCode).toBe('34096');
        clearCaches();
        return settledStand(after, server)?.verdict();
      });
    // Trashing the one program that leaves the Runner unable to pay the granted subroutine and break on: out; the others in
    expect(stands).toEqual(['in', 'out', 'in']);
    expect(runTermStats.runnerOther).toBe(before);
  });
});

describe('the run reads of the audit of 2026-11-18 (AI-RUN-POSITION-EMPTY, AI-SOLVERUN-CHEAPEST-UNPINNED)', () => {
  const inCorp = <T>(s: GameState, f: () => T): T => asSide('corp', () => (decisionContext(s, 'corp'), f()));

  // The audit's board (probes/position-empty.ts). remote1, innermost first: Palisade (unrezzed, the Corp at 0: it cannot
  // be rezzed), Kessleroid (rezzed, the Runner's position), Kessleroid (rezzed, outermost, passed). No breaker, an agenda
  // in the root. The Runner's own ice leaves (as Vicsek's or Arruaceiras Crew's trash): the position stays, empty (rules
  // 6.2.4, 8.5.10), and server.ice[icePosition] is the passed ice outward of it (6.2.6b). The truth is the engine's next
  // state from there, the Movement Phase before the next ice inward
  const emptied = (phase: 'approach_ice' | 'encounter_ice' | 'movement') => {
    const s0 = newGame(3);
    s0.runner.rig = { ...s0.runner.rig, programs: [], hardware: [], resources: [] };
    installIceForTest(s0, '30072', 'remote1', false);
    installIceForTest(s0, '35075', 'remote1', true);
    installIceForTest(s0, '35075', 'remote1', true);
    s0.corp.servers.remote1.root.push(createCardInstance(s0, '30036'));
    startRunnerTurn(s0);
    s0.runner.credits = 5;
    const s = executeAction(s0, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote1' });
    s.corp.credits = 0;
    approachIce(s, 1);
    const mid = s.corp.servers.remote1.ice[1];
    if (phase !== 'approach_ice') beginEncounter(s, mid);
    if (phase === 'movement') {
      s.activeRun!.encounter = null;
      enterMovement(s);
    }
    trashInstalledCorpCard(s, s.corp.servers.remote1, mid);
    expect(s.activeRun).toMatchObject({ phase, positionEmpty: true, icePosition: 1 });
    const truth = structuredClone(s);
    truth.activeRun!.phase = 'movement';
    truth.activeRun!.encounter = null;
    clearCaches();
    return { s, truth };
  };

  for (const phase of ['approach_ice', 'encounter_ice', 'movement'] as const) {
    it(`runStands with the Runner's position empty in the ${phase} phase starts from the next ice inward: in, as the Movement Phase reads it (fails on beta 173bc26 in approach and encounter: out)`, () => {
      const { s, truth } = emptied(phase);
      expect(inCorp(truth, () => runStands(truth, 'remote1')?.verdict())).toBe('in');
      expect(inCorp(s, () => runStands(s, 'remote1')?.verdict())).toBe('in');
    });
  }

  it("runRestWorth with the Runner's position empty at an approach leaves out the passed ice outward of it: the Movement Phase's worth (fails on beta 173bc26: 0, Kessleroid priced as a block)", () => {
    for (const phase of ['approach_ice', 'encounter_ice', 'movement'] as const) {
      const { s, truth } = emptied(phase);
      const worth = runRestWorth(truth);
      expect(worth).toBeGreaterThan(0);
      expect(runRestWorth(s)).toBeCloseTo(worth, 6);
    }
  });

  it("solveRun picks the cheapest set that holds: Kessleroid for 2, not both ice for 5 (audit probes/cheapest-set.ts; fails with the review's mutation H20, the line 'set.cost >= best' removed)", () => {
    // remote1, innermost first: Kessleroid (rez 2), Palisade (rez 3), Palisade (outermost); all unrezzed. The Runner has
    // no breaker and $0 and approaches the outermost; the Corp at $20. Each of {Kessleroid} and {inner Palisade} holds alone
    const s0 = newGame(3);
    s0.runner.rig = { ...s0.runner.rig, programs: [], hardware: [], resources: [] };
    s0.corp.credits = 20;
    const kess = installIceForTest(s0, '35075', 'remote1', false);
    const pal = installIceForTest(s0, '30072', 'remote1', false);
    installIceForTest(s0, '30072', 'remote1', false);
    startRunnerTurn(s0);
    s0.runner.credits = 0;
    const s = executeAction(s0, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote1' });
    clearCaches();
    const ask = (opts: Parameters<typeof serverHold>[2]) => inCorp(s, () => serverHold(s, 'remote1', opts));
    expect(ask({ when: 'thisRun', mustRez: [kess], further: false, from: s.activeRun!.icePosition! - 2 }).holds).toBe(true);
    expect(ask({ when: 'thisRun', mustRez: [pal], further: false, from: s.activeRun!.icePosition! - 1 }).holds).toBe(true);
    expect(ask({ when: 'thisRun', mustRez: [], further: true })).toMatchObject({ holds: true, rez: [kess], rezCost: 2 });
  });
});
