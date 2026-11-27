/**
 * The hold count's gathering against the engine (bundle H, netrunner-ai/review-fixes-1119/hold-inputs/brief.md, fix 7).
 * The brute-force reference (tests/holdWalkReference.test.ts) shares the walk's gathering (walkStart, walkIce,
 * walkBoard, runQuestion), so a fact gathered wrongly is wrong in both and the reference agrees. Here the walk's answer
 * is compared with the engine played out instead (scripts/stage-d/hold-oracle.ts, the oracle's method: the Runner's turn
 * or run searched in the engine, every card's own text firing), on boards built for each step the fixes sit in. Boards
 * are played in the engine where they can be, not edited.
 *
 * Rules (Comprehensive Rules v26.03, each checked in the PDF): 1.2.2 a "cannot" wins; 3.9.5b a breaker's strength boost
 * lasts the current encounter; 5.6.3d and 5.7.2d "when a turn ends" (Lycian's derez) at the end of the Corp's and of the
 * Runner's turn; 6.5.8a-c a bypass aborts the Encounter Ice Phase, most at the encounter's beginning; 6.8.5 and 6.9.6d
 * run durations end with the run; 6.9.3a-c the encounter begins, its paid ability window, its subroutines resolve.
 */
import { describe, expect, it } from 'vitest';
import { GameState, activePrompt, createCardInstance, executeAction, getLegalActions } from '../src/core';
import { RunQuestion, runStands, serverHold } from '../src/ai/corp/hold';
import { rezMoney } from '../src/ai/corp/rezMoney';
import { iceCost } from '../src/ai/runs';
import { asSide } from '../src/ai/pricing';
import { inDecision } from '../src/ai/handValues';
import { oracleGetsIn } from '../scripts/stage-d/hold-oracle';
import { installIceForTest, installProgramForTest, newGame, startRunnerTurn } from './helpers';
import '../src/ai'; // the keep port (corpPorts.keep) is filled by corpAI: the tag clock's trash cost reads it (F110 part C)

const C = {
  PALISADE: '30072', MALANDRAGEM: '34081', FLYSWATTER: '35079', PHYSARUM: '34082', PHAROS: '30063', CLEAVER: '30006',
  FRANSOFIA: '35021', LAMP: '35080', LASER: '34016', WHITESPACE: '30074', MYCOWEB: '35053', FUNHOUSE: '30054',
  BALLISTA: '30062', TRANQUILIZER: '30017', OFFWORLD: '30067',
};
const T = 120_000;

/** A Corp turn-7 board (as tests/reviewPins.test.ts): empty rig and HQ, the Runner at $0 and 4 clicks, the Corp at $20. */
function board(setup: (s: GameState) => void): GameState {
  const s = newGame(3);
  s.corp.hq = [];
  s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  s.runner.credits = 0;
  s.corp.credits = 20;
  s.turnNumber = 7;
  setup(s);
  return s;
}
const inCorp = <T>(s: GameState, f: () => T): T => asSide('corp', () => inDecision(s, 'corp', () => f()));
const nextTurn = (s: GameState, server: string) => inCorp(s, () => serverHold(s, server, { when: 'runnerTurn', corpCredits: s.corp.credits }));
const turnTruth = (s: GameState, server: string, rez: string[] = []) => oracleGetsIn(s, server, 'runnerTurn', rez, undefined, undefined, true).answer;
/** The walk on the run under way as it stands (runStands, the run term's reader), and the engine's answer, nothing rezzed. */
const stands = (s: GameState, server: string) => inCorp(s, () => runStands(s, server)!.verdict());
const runTruth = (s: GameState, server: string) => oracleGetsIn(s, server, 'thisRun', []).answer;
/** The question(s) runStands gathered (its key is their JSON): what the search reads, to compare gatherings. */
const gathered = (s: GameState, server: string): RunQuestion[] => JSON.parse(inCorp(s, () => runStands(s, server)!.key));
/** A rig card hosted on an ice (Physarum Entangler, Tranquilizer). */
const hostOn = (s: GameState, code: string, host: string, tokens: Record<string, number> = {}) => {
  const c = createCardInstance(s, code);
  c.isRezzed = true;
  c.hostedOnId = host;
  c.tokens = tokens;
  s.runner.rig.programs.push(c);
  return c.instanceId;
};
const resource = (s: GameState, code: string) => {
  const c = createCardInstance(s, code);
  c.isRezzed = true;
  s.runner.rig.resources.push(c);
  return c.instanceId;
};
/** The run on `server` played in the engine up to its first encounter's opening (the Runner's encounter triggers asked). */
const runToFirstEncounter = (s0: GameState, server: string): GameState => {
  startRunnerTurn(s0);
  const s = executeAction(s0, { type: 'INITIATE_RUN', player: 'runner', targetServerId: server });
  return executeAction(s, { type: 'CONTINUE_RUN', player: 'runner' });
};
/** The engine answers the open prompt with the option `id`. */
const choose = (s: GameState, id: string): GameState => {
  const p = activePrompt(s)!;
  const a = getLegalActions(s, p.side).find(x => x.type === 'RESOLVE_PROMPT' && 'optionId' in x.choice && x.choice.optionId === id);
  expect(a).toBeDefined();
  return executeAction(s, a!);
};

describe('fix 5b: next turn reads the Runner cards\' once-per-turn uses as unused', () => {
  // Malandragem (34081): "Once per turn -> When you encounter a piece of ice, if its strength is 3 or less, you may remove
  // 1 hosted power counter to bypass it." Rezzed Palisade on HQ (strength 2, "End the run."), no breaker, Runner $0. The
  // Runner uses Malandragem on a run this turn (the engine's flag once:<id>:0 set), the run ends; asked during its turn,
  // the Runner's next turn has the ability again (turn flags reset as the turn passes), with 1 counter left.
  const used = () => {
    const s0 = board(st => {
      installIceForTest(st, C.PALISADE, 'hq', true);
      installProgramForTest(st, C.MALANDRAGEM);
      st.runner.rig.programs[0].tokens = { power: 2 };
    });
    startRunnerTurn(s0);
    let s = executeAction(s0, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    s = executeAction(s, { type: 'CONTINUE_RUN', player: 'runner' });
    s = choose(s, 'counter');
    while (s.activeRun) {
      const p = activePrompt(s);
      if (p) s = executeAction(s, getLegalActions(s, p.side).find(a => a.type === 'RESOLVE_PROMPT')!);
      else s = executeAction(s, getLegalActions(s, 'runner').find(a => a.type === 'CONTINUE_RUN')!);
    }
    const id = s.runner.rig.programs[0].instanceId;
    expect([s.activePlayer, s.turnFlags[`once:${id}:0`], s.runner.rig.programs[0].tokens.power]).toEqual(['runner', 1, 1]);
    return s;
  };
  it('Malandragem used this turn, 1 counter left: HQ does not hold next turn (the engine gets in)', { timeout: T }, () => {
    const s = used();
    expect(turnTruth(s, 'hq')).toBe('getsIn');
    expect(nextTurn(s, 'hq').holds).toBe(false);
  });
  it('mirror: no counter left, HQ holds next turn (the engine agrees)', { timeout: T }, () => {
    const s = structuredClone(used());
    s.runner.rig.programs[0].tokens = { power: 0 };
    expect(turnTruth(s, 'hq')).toBe('holds');
    expect(nextTurn(s, 'hq').holds).toBe(true);
  });
});

describe('fix 4: a bypass is gone once the encounter is past its beginning (WalkIce.begun; 6.5.8a-c, 6.9.3a-c)', () => {
  // Red team S1, the hosted bypasser in Walk.encounter. Physarum Entangler (34082): "Whenever you encounter host ice, if it
  // is not a barrier, you may pay 1 for each subroutine it has. If you do, bypass that ice." Flyswatter (35079, code gate,
  // "End the run.") rezzed on HQ with Physarum on it, no breaker. Declined, it is gone for this encounter (6.5.8b): the
  // break window (6.9.3b) and the subroutine (6.9.3c) follow.
  const physarum = (credits: number) => {
    let fly = '';
    const s0 = board(st => {
      fly = installIceForTest(st, C.FLYSWATTER, 'hq', true);
      hostOn(st, C.PHYSARUM, fly);
      st.runner.credits = credits;
    });
    const s = runToFirstEncounter(s0, 'hq');
    expect(JSON.stringify(activePrompt(s))).toContain(`"cardCode":"${C.PHYSARUM}"`);
    return s;
  };
  for (const credits of [1, 3]) {
    it(`Physarum declined on Flyswatter, $${credits}: the run stands "out" (the engine holds)`, { timeout: T }, () => {
      const s = choose(physarum(credits), 'no');
      expect([s.activeRun?.phase, s.activeRun?.encounter?.resolvingIndex, s.activeRun?.encounter?.onEncounterPending, activePrompt(s)]).toEqual(['encounter_ice', null, false, undefined]);
      expect(runTruth(s, 'hq')).toBe('holds');
      expect(stands(s, 'hq')).toBe('out');
    });
  }
  it('mirror: the offer open (the engine gets in), and as settledStand reads it with the prompt stripped, "in"', { timeout: T }, () => {
    const s = physarum(1);
    expect(runTruth(s, 'hq')).toBe('getsIn');
    const stripped = { ...s, pendingPrompts: [] };
    expect(stripped.activeRun?.encounter?.onEncounterPending).toBe(true);
    expect(stands(stripped, 'hq')).toBe('in');
  });

  // Red team M3, the order: the encountered ice is left out of runBypasses' list before it chooses, never filtered out of
  // its result. Two rezzed Lamplighters on remote1 (35080, sentry - observer: "Give the Runner 1 tag unless they pay 3. /
  // End the run if the Runner is tagged."), Laser Pointer (34016: "Whenever you encounter a piece of AP, destroyer, or
  // observer ice, you may trash this program to bypass that ice."), $3. Declined on the outer one: pay 3 there, then
  // trash Laser Pointer to bypass the inner one.
  it('two Lamplighters, Laser Pointer declined on the outer one, $3: the run stands "in" (the engine gets in)', { timeout: T }, () => {
    const s0 = board(st => {
      installIceForTest(st, C.LAMP, 'remote1', true);
      installIceForTest(st, C.LAMP, 'remote1', true);
      installProgramForTest(st, C.LASER);
      st.runner.credits = 3;
    });
    let s = runToFirstEncounter(s0, 'remote1');
    expect(JSON.stringify(activePrompt(s))).toContain(`"cardCode":"${C.LASER}"`);
    s = choose(s, 'no');
    expect([s.activeRun?.icePosition, s.activeRun?.encounter?.onEncounterPending, activePrompt(s)]).toEqual([1, false, undefined]);
    expect(runTruth(s, 'remote1')).toBe('getsIn');
    expect(stands(s, 'remote1')).toBe('in');
    // The gathered bypass list: the inner Lamplighter, not the encountered one
    const inner = s.corp.servers.remote1.ice[0].instanceId;
    expect(gathered(s, 'remote1')[0].sets.map(x => x.skipped)).toEqual([[inner]]);
  });
});

describe('fix 3: the encounter\'s boosts stay with the encountered ice (3.9.5b)', () => {
  // Red team S2. Two rezzed Pharos on remote1 (30063, barrier, strength 5: "Give the Runner 1 tag. / End the run. / End
  // the run."), Cleaver (30006, strength 3: "1: Break up to 2 barrier subroutines. / 2: +1 strength."), Fransofia Ward
  // (35021: "Whenever you encounter a piece of ice, if the Corp has 15 or more, you may trash this resource to bypass that
  // ice."), the Corp at $20, the Runner at $5: Fransofia declined on the outer Pharos, Cleaver boosted twice and both
  // "End the run" broken, $0 left. The inner Pharos is met in an encounter of its own: its plans and its price for the
  // bypass ranking are the board's without this encounter's boosts. No verdict flips on this board (the engine gets in by
  // trashing Fransofia on the inner one; the walk does not model that bypass because runBypasses keeps a rig bypass only
  // where it saves more than its price: found row 88, red team M4, not bundle H), so the test states the gathering.
  const boosted = () => {
    const s0 = board(st => {
      installIceForTest(st, C.PHAROS, 'remote1', true);
      installIceForTest(st, C.PHAROS, 'remote1', true);
      installProgramForTest(st, C.CLEAVER);
      resource(st, C.FRANSOFIA);
      st.runner.credits = 5;
    });
    let s = runToFirstEncounter(s0, 'remote1');
    s = choose(s, 'no');
    const cleaver = s.runner.rig.programs[0].instanceId;
    s = executeAction(s, { type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: cleaver });
    s = executeAction(s, { type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: cleaver });
    s = executeAction(s, { type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: cleaver, subroutineIndices: [1, 2] });
    expect([s.activeRun?.phase, s.activeRun?.icePosition, s.runner.credits, s.activeRun?.encounter?.boosts[cleaver]]).toEqual(['encounter_ice', 1, 0, 2]);
    return s;
  };
  it('the inner Pharos is priced and planned as without the encounter (iceCost 6, not 2)', { timeout: T }, () => {
    const s = boosted();
    const run = s.activeRun!;
    const inner = s.corp.servers.remote1.ice[0];
    const outside: GameState = { ...s, activeRun: { ...run, encounter: null } };
    expect([inCorp(s, () => iceCost(s, inner)), inCorp(s, () => iceCost(outside, inner))]).toEqual([2, 6]);
    // What the walk gathers for the inner Pharos is the same with the boosts as with them taken off
    const unboosted = structuredClone(s);
    unboosted.activeRun!.encounter!.boosts = {};
    const innerOf = (q: RunQuestion) => [Object.entries(q.board!.plans).filter(([k]) => k.startsWith(`${inner.instanceId}|`)), q.sets.map(x => x.skipped)];
    expect(gathered(s, 'remote1').map(innerOf)).toEqual(gathered(unboosted, 'remote1').map(innerOf));
    // Cleaver's plan for the inner Pharos's two "End the run": 2 boosts (4) and a break (1)
    expect(gathered(s, 'remote1')[0].board!.plans[`${inner.instanceId}|2||`].map(p => p.credits)).toEqual([5]);
  });
});

describe('fix 5: next turn\'s count reads the board after the run (6.8.5, 6.9.6d)', () => {
  // Red team S3: keep's reach (keepFor -> reachQuestion) never goes through serverHold. Two staked servers: R&D (an
  // unrezzed Whitespace, 30074, code gate: "The Runner loses 3. / If the Runner has 6 or less, end the run.", rez 2) and
  // HQ with an agenda (a rezzed Pharos outside an unrezzed Palisade, rez 3). The Runner, Cleaver, runs HQ with $6:
  // boosts twice on Pharos (4), $2 left. Next turn (4 clicks, $2): HQ alone gets in past Pharos (2 boosts and a break, 5)
  // unless Palisade is rezzed (byServer 3); R&D alone unless Whitespace is (2); both in one turn (2 runs, 2 clicks to
  // earn: $4) does not reach past Pharos. With this encounter's boosts read as next turn's, Pharos would cost 1 and the
  // pair would be reached (keep 5, not 3).
  const twoServers = () => {
    const s0 = board(st => {
      installIceForTest(st, C.WHITESPACE, 'rd', false);
      installIceForTest(st, C.PALISADE, 'hq', false);
      installIceForTest(st, C.PHAROS, 'hq', true);
      st.corp.hq = [createCardInstance(st, C.OFFWORLD)];
      installProgramForTest(st, C.CLEAVER);
      st.runner.credits = 6;
    });
    let s = runToFirstEncounter(s0, 'hq');
    const cleaver = s.runner.rig.programs[0].instanceId;
    s = executeAction(s, { type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: cleaver });
    s = executeAction(s, { type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: cleaver });
    expect([s.activeRun?.phase, s.runner.credits, s.activeRun?.encounter?.boosts[cleaver]]).toEqual(['encounter_ice', 2, 2]);
    return s;
  };
  it('two staked servers mid-encounter: keep and byServer are the board\'s after the run (3; R&D 2, HQ 3)', { timeout: T }, () => {
    const s = twoServers();
    const after = { ...s, activeRun: null };
    const money = (t: GameState) => inCorp(t, () => {
      const m = rezMoney(t);
      return [m.keep, m.byServer];
    });
    expect(money(after)).toEqual([3, { rd: 2, hq: 3 }]);
    expect(money(s)).toEqual(money(after));
  });
  it('the truths: HQ and R&D each get in next turn with nothing more rezzed, and are held by their holding rez', { timeout: T }, () => {
    const s = twoServers();
    const after = { ...s, activeRun: null };
    const [palisade, whitespace] = [s.corp.servers.hq.ice[0].instanceId, s.corp.servers.rd.ice[0].instanceId];
    expect([turnTruth(after, 'hq'), turnTruth(after, 'hq', [palisade]), turnTruth(after, 'rd'), turnTruth(after, 'rd', [whitespace])]).toEqual(['getsIn', 'holds', 'getsIn', 'holds']);
  });
});

describe('fix 6: the lenders read the walk\'s start (5.7.1d; 5.6.3d, 5.7.2d)', () => {
  // The board of tests/holdWalkReference.test.ts's review R6 test: Funhouse (30054) inside Mycoweb (35053) on remote1;
  // Ballista (30062, "Trash 1 installed program or end the run") rezzed on HQ with Tranquilizer (30017) at 2 counters:
  // the Runner's turn start puts the third and derezzes it, so Mycoweb's sentry borrow finds only the Lamplighter outside
  // it. $3, 2 clicks, the Corp at $0 (with money Mycoweb's "You may rez 1 installed piece of ice, paying 2 less" rezzes
  // Ballista again, a Corp-side subroutine the walk does not carry).
  it('Ballista derezzed by Tranquilizer at the turn start lends nothing: remote1 does not hold (the engine gets in)', { timeout: T }, () => {
    const s = board(st => {
      installIceForTest(st, C.FUNHOUSE, 'remote1', true);
      installIceForTest(st, C.MYCOWEB, 'remote1', true);
      const ballista = installIceForTest(st, C.BALLISTA, 'hq', true);
      installIceForTest(st, C.LAMP, 'hq', true);
      hostOn(st, C.TRANQUILIZER, ballista, { virus: 2 });
      st.runner.credits = 3;
      st.runner.maxClicks = 2;
      st.corp.credits = 0;
      st.corp.archives.faceUp = [];
      st.corp.archives.faceDown = [];
    });
    expect(turnTruth(s, 'remote1')).toBe('getsIn');
    expect(nextTurn(s, 'remote1').holds).toBe(false);
  });
});
