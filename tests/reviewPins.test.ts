/**
 * Pins for the external review of the Corp AI of 2026-11-19 (/mnt/project-files/audits/2026-11-19-gemini-corp-review/
 * report.md; the AI Coordinator's check beside it, coordinator-check.md; brief netrunner-ai/review-fixes-1119/
 * brief-pins.md). Each claim's board is built here, reproduced on our side, and pinned known-failing (`it.fails`, the
 * RIGHT outcome asserted last) with a mirror that passes today and must keep passing after the fix. The truth for a hold
 * question is the engine oracle (scripts/stage-d/hold-oracle.ts: the Runner's turn or run played in the engine) or a game
 * played by GameRunner. Where the report's own board does not reproduce, the test says so and what was seen.
 *
 * Bundles (coordinator-check.md, "Ruling"): H the hold count's inputs (corp/hold.ts, runs.ts), R rez and rez money
 * (corp/rez.ts, corp/rezMoney.ts), P placement wiring (corp/placement.ts, corp/candidates.ts; counted before any fix).
 *
 * Rules (Comprehensive Rules v26.03, each checked in the PDF): 1.2.2 a "cannot" wins; 3.9.5b an icebreaker's strength
 * boost lasts the current encounter; 5.2.7 the Runner's basic actions (credit, draw, remove a tag for a click and 2
 * credits); 5.6.3d the Corp's turn ends ("when a turn ends" triggers: Lycian's derez); 6.4.3 and 6.9.2b the Corp rezzes
 * ice as it is approached; 6.5.8a-b a bypass happens at the start of an encounter, and then the subroutines neither break
 * nor resolve; 6.8.5 durations "until the end of the run" expire at 6.9.6d (Tread Lightly's rez cost); 6.9.3a-c the
 * encounter begins, its paid ability window, then its subroutines resolve; 10.4.4 more damage than the grip flatlines.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CardInstance, GameAction, GameState, activePrompt, cardDef, createCardInstance, executeAction, findCardAnywhere, getLegalActions } from '../src/core';
import { createAgent } from '../src/ai';
import { GameRunner, rezCandidates } from '../src/ai/playout';
import type { Agent } from '../src/ai/agent';
import { runStands, serverHold } from '../src/ai/corp/hold';
import { rezMoney } from '../src/ai/corp/rezMoney';
import { agendasUnseen } from '../src/ai/corp/pools';
import { countedRez, spendsKept } from '../src/ai/corp/rez';
import { corpCandidates } from '../src/ai/corp/candidates';
import { place, reservedForAgenda, scoringShort } from '../src/ai/corp/placement';
import { iceCreditNeed } from '../src/ai/runs';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';
import { oracleGetsIn } from '../scripts/stage-d/hold-oracle';
import { giveCard, installCorpForTest, installIceForTest, installProgramForTest, newGame, runIntoFirstIce, setIdentity, startRunnerTurn } from './helpers';

/**
 * Every rest-of-turn keep spendsKept asks (rezMoney with `restOfTurn`) is recorded with the Runner's credits it was
 * handed (AI-SPENDS-KEPT-FLOOR-NEED). The wrapper only records: every call goes on to the real rezMoney unchanged.
 */
const restCredits: number[] = [];
vi.mock('../src/ai/corp/rezMoney', async orig => {
  const m = await orig<typeof import('../src/ai/corp/rezMoney')>();
  return {
    ...m,
    rezMoney: (s: GameState, o?: Parameters<typeof m.rezMoney>[1]) => {
      if (o?.restOfTurn) restCredits.push(o.restOfTurn.runnerCredits);
      return m.rezMoney(s, o);
    },
  };
});

const C = {
  PALISADE: '30072', CLEAVER: '30006', LAMP: '35080', KNICKKNACK: '35033', LOBISOMEM: '34090', AUDREY: '34004',
  MALANDRAGEM: '34081', TREAD: '30012', SACI: '34017', AIRCHECK: '36018', PHAROS: '30063', MYCOWEB: '35053', LYCIAN: '34100',
  BALLISTA: '30062', WHITESPACE: '30074', SLEIPNIR: '36030', UNITY: '30026', LEO: '35035', RED_ROOM: '36045', BRAN: '30039',
  OFFWORLD: '30067', SAM: '30069', REGOLITH: '30071', MANEGARM: '30042',
};
const T = 120_000;

/** A Corp turn-7 board (as tests/holdWalk.test.ts): empty rig and HQ, the Runner at $0 and 4 clicks, the Corp at $20. */
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
const inCorp = <T>(s: GameState, f: () => T): T => asSide('corp', () => (decisionContext(s, 'corp'), f()));
const nextTurn = (s: GameState, server: string, corp = s.corp.credits) => inCorp(s, () => serverHold(s, server, { when: 'runnerTurn', corpCredits: corp }));
/** The oracle on the Runner's whole next turn (retries on: a failed run may be followed by another), rezzing `rez`. */
const turnTruth = (s: GameState, server: string, rez: string[] | null) => oracleGetsIn(s, server, 'runnerTurn', rez ?? [], undefined, undefined, true).answer;
const verdict = (s: GameState, server: string) => inCorp(s, () => runStands(s, server)!.verdict());
const resource = (s: GameState, code: string) => {
  const c = createCardInstance(s, code);
  c.isRezzed = true;
  s.runner.rig.resources.push(c);
};
const mk = (s: GameState, code: string, rez: boolean) => Object.assign(createCardInstance(s, code), { isRezzed: rez });
const toHq = (s: GameState, code: string) => {
  const c = createCardInstance(s, code);
  s.corp.hq.push(c);
  return c;
};
/** The engine answers the open prompt with the option `id`. */
const choose = (s: GameState, id: string): GameState => {
  const p = activePrompt(s)!;
  const a = getLegalActions(s, p.side).find(x => x.type === 'RESOLVE_PROMPT' && 'optionId' in x.choice && x.choice.optionId === id);
  expect(a).toBeDefined();
  return executeAction(s, a!);
};

describe('bundle H: the hold count\'s inputs (known-failing until the bundle H fix)', () => {
  // AI-HOLD-KNICKKNACK-MOVED. "Knickknack" O'Brian (35033): "The first time each turn a run begins, you may trash 1 of
  // your other installed cards. If you do, gain credits equal to its printed install cost and draw 1 card." The walk's
  // runBegins (corp/hold.ts) gains the credits without setting `moved`, so ended() cuts the retry after a failed first
  // run that was paid by Knickknack. Lamplighter (35080, sentry): "Give the Runner 1 tag unless they pay 3. / End the run
  // if the Runner is tagged."
  const knick = (program: string, withKnick = true) =>
    board(st => {
      installIceForTest(st, C.LAMP, 'remote1', true);
      if (withKnick) resource(st, C.KNICKKNACK);
      installProgramForTest(st, program);
      st.runner.tags = 1;
      st.runner.maxClicks = 3;
    });
  // The report's board ($0, 1 tag, 3 clicks, Cleaver printed 3) does NOT reproduce: its line (run: +3, ended; clear the
  // tag: $1; run) reaches Lamplighter's first subroutine with $1 against 3, is tagged and ended (5.2.7, 9.8.7). The walk
  // says holds and the engine agrees: there the cut costs nothing.
  it("Knickknack, the report's board (Cleaver, printed 3): holds, and the engine agrees (not reproduced as written)", { timeout: T }, () => {
    const s = knick(C.CLEAVER);
    expect(nextTurn(s, 'remote1').holds).toBe(true);
    expect(turnTruth(s, 'remote1', [])).toBe('holds');
  });
  // Reproduced with a larger card to trash: Lobisomem (34090, printed 8, a code gate breaker that cannot touch
  // Lamplighter). Run 1: Knickknack trashes it for 8, tagged, ended. Click 2: clear the tag (8 -> 6). Click 3: run, pay 3,
  // untagged, in. No line without the retry exists (3 clicks: two credits and a tag clear leave no click to run).
  it('Knickknack with Lobisomem (printed 8), $0, 1 tag, 3 clicks: does not hold (the engine gets in)', { timeout: T }, () => {
    const s = knick(C.LOBISOMEM);
    expect(turnTruth(s, 'remote1', [])).toBe('getsIn');
    expect(nextTurn(s, 'remote1').holds).toBe(false);
  });
  it('Knickknack mirror: the same board without Knickknack holds, and the engine agrees', { timeout: T }, () => {
    const s = knick(C.LOBISOMEM, false);
    expect(nextTurn(s, 'remote1').holds).toBe(true);
    expect(turnTruth(s, 'remote1', [])).toBe('holds');
  });

  // AI-HOLD-AUDREY-EMPTY-GRIP. Audrey v2 (34004): "Hosted virus counter: Break up to 2 subroutines. / Trash 1 card from
  // your grip: +3 strength." breakPlans (runs.ts) drops Audrey's plan when the grip is short now, so the walk never sees a
  // draw (5.2.7) made before the run. Rezzed Palisade on HQ (strength 2: one grip card for +3), 2 virus counters, 4 clicks.
  const audrey = (grip: number, stack: number) =>
    board(st => {
      installIceForTest(st, C.PALISADE, 'hq', true);
      const id = installProgramForTest(st, C.AUDREY);
      st.runner.rig.programs.find(c => c.instanceId === id)!.tokens = { virus: 2 };
      const cards = [...st.runner.grip, ...st.runner.stack];
      st.runner.grip = cards.slice(0, grip);
      st.runner.stack = cards.slice(grip, grip + stack);
    });
  it('Audrey v2, grip 0, 25 cards in the stack, 4 clicks: HQ does not hold (draw, then run)', { timeout: T }, () => {
    const s = audrey(0, 25);
    expect(turnTruth(s, 'hq', [])).toBe('getsIn');
    expect(nextTurn(s, 'hq').holds).toBe(false);
  });
  it('Audrey mirror: grip 0 and nothing to draw holds; grip 1 does not (the walk and the engine agree)', { timeout: T }, () => {
    const empty = audrey(0, 0);
    expect(nextTurn(empty, 'hq').holds).toBe(true);
    expect(turnTruth(empty, 'hq', [])).toBe('holds');
    const one = audrey(1, 25);
    expect(nextTurn(one, 'hq').holds).toBe(false);
    expect(turnTruth(one, 'hq', [])).toBe('getsIn');
  });

  // AI-HOLD-BOOST-LEAK. walkBoard (corp/hold.ts) prices every ice with the board as it stands, so the encounter's boosts
  // (run.encounter.boosts, read by breakerStrength) price the ice further in too; a boost lasts the encounter only
  // (3.9.5b). Two rezzed Palisades on remote1 (strength 4), Cleaver (3), $4: the Runner boosts once (2) and breaks (1)
  // the outer one, $1 left; the inner one asks 2 + 1 = 3. The engine state is played, not edited.
  const boosted = () => {
    const s0 = board(st => {
      installIceForTest(st, C.PALISADE, 'remote1', true);
      installIceForTest(st, C.PALISADE, 'remote1', true);
      installProgramForTest(st, C.CLEAVER);
      st.runner.credits = 4;
    });
    let s = runIntoFirstIce(s0, 'remote1');
    const cleaver = s.runner.rig.programs[0].instanceId;
    s = executeAction(s, { type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: cleaver });
    s = executeAction(s, { type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: cleaver, subroutineIndices: [0] });
    expect([s.activeRun?.phase, s.activeRun?.icePosition, s.runner.credits]).toEqual(['encounter_ice', 1, 1]);
    expect(s.activeRun!.encounter!.boosts).toEqual({ [cleaver]: 1 });
    return s;
  };
  it('boost leak: mid-encounter on the outer Palisade, boosted, $1 left: the run stands "out"', { timeout: T }, () => {
    const s = boosted();
    expect(oracleGetsIn(s, 'remote1', 'thisRun', []).answer).toBe('holds');
    expect(verdict(s, 'remote1')).toBe('out');
  });
  it('boost leak mirror: the same encounter with the boost taken off stands "out"', { timeout: T }, () => {
    const s = structuredClone(boosted());
    s.activeRun!.encounter!.boosts = {};
    expect(verdict(s, 'remote1')).toBe('out');
  });

  // AI-HOLD-RESOLVING-BYPASS. runQuestion (corp/hold.ts) asks bypassesAhead of the ice from the Runner's position inward,
  // the encountered ice included, so a rig bypass still on the table skips the ice being encountered. Malandragem
  // (34081): "Once per turn -> When you encounter a piece of ice, if its strength is 3 or less, you may remove 1 hosted
  // power counter to bypass it." It triggers as the encounter begins (6.9.3a; 6.5.8a-b: a bypass then means the
  // subroutines never break or resolve); declined, the encounter goes on to its paid ability window (6.9.3b) and its
  // subroutines (6.9.3c). Rezzed Palisade on HQ (strength 2), no breaker, $0. The engine state is played: the run, the
  // bypass prompt, "No".
  const declined = (withMalandragem = true) => {
    const s0 = board(st => {
      installIceForTest(st, C.PALISADE, 'hq', true);
      if (withMalandragem) installProgramForTest(st, C.MALANDRAGEM);
      st.runner.rig.programs.forEach(c => (c.tokens = { power: 2 }));
    });
    startRunnerTurn(s0);
    let s = executeAction(s0, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    s = executeAction(s, { type: 'CONTINUE_RUN', player: 'runner' });
    if (withMalandragem) {
      expect(JSON.stringify(activePrompt(s))).toContain(`"cardCode":"${C.MALANDRAGEM}"`);
      s = choose(s, 'no');
    }
    expect([s.activeRun?.phase, s.activeRun?.encounter?.resolvingIndex, activePrompt(s)]).toEqual(['encounter_ice', null, undefined]);
    return s;
  };
  it('resolving bypass: Malandragem declined, Palisade encountered and unbroken: the run stands "out"', { timeout: T }, () => {
    const s = declined();
    expect(oracleGetsIn(s, 'hq', 'thisRun', []).answer).toBe('holds');
    expect(verdict(s, 'hq')).toBe('out');
  });
  // The report's own state: the same, with the subroutine resolving (resolvingIndex 0, set by hand: Palisade's one
  // subroutine resolves at once in the engine, so the window is never open there)
  it("resolving bypass, the report's state (Palisade's subroutine resolving): \"out\"", { timeout: T }, () => {
    const s = structuredClone(declined());
    s.activeRun!.encounter!.resolvingIndex = 0;
    expect(verdict(s, 'hq')).toBe('out');
  });
  it('resolving bypass mirror: the same run without Malandragem stands "out"', { timeout: T }, () => {
    expect(verdict(declined(false), 'hq')).toBe('out');
  });

  // AI-HOLD-RUNNER-TURN-ACTIVERUN. serverHold strips the run under way (afterRun) for 'restOfTurn' only, so a
  // 'runnerTurn' question asked during a run reads this run's rez cost increase as next turn's. Tread Lightly (30012):
  // "Run any server. During that run, the rez cost of each piece of ice is increased by 3." (6.8.5: it expires with the
  // run.) Unrezzed Palisade on R&D (rez 3), a rezzed one on HQ; the Runner plays Tread Lightly on HQ.
  const treadRun = (tread: boolean) => {
    const s0 = board(st => {
      installIceForTest(st, C.PALISADE, 'rd', false);
      installIceForTest(st, C.PALISADE, 'hq', true);
      st.runner.credits = 1;
    });
    startRunnerTurn(s0);
    if (!tread) return executeAction(s0, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    const id = giveCard(s0, 'runner', C.TREAD);
    return choose(executeAction(s0, { type: 'PLAY_OPERATION_OR_EVENT', player: 'runner', cardInstanceId: id }), 'hq');
  };
  const nextTurnCosts = (s: GameState) => inCorp(s, () => [serverHold(s, 'rd', { when: 'runnerTurn', corpCredits: Infinity }).rezCost, rezMoney(s).keep]);
  it("run-turn rez cost: during Tread Lightly's run, next turn's R&D rez cost and keep are the board's after the run (3, 3)", { timeout: T }, () => {
    const s = treadRun(true);
    expect(s.activeRun?.iceRezCostIncrease).toBe(3);
    expect(nextTurnCosts({ ...s, activeRun: null })).toEqual([3, 3]);
    expect(nextTurnCosts(s)).toEqual([3, 3]);
  });
  it('run-turn rez cost mirror: during a plain run they are 3 and 3, as after it', { timeout: T }, () => {
    const s = treadRun(false);
    expect(s.activeRun?.iceRezCostIncrease).toBe(0);
    expect(nextTurnCosts(s)).toEqual([3, 3]);
    expect(nextTurnCosts({ ...s, activeRun: null })).toEqual([3, 3]);
  });

  // AI-HOLD-MINOR-GAPS (1), Saci with the pool locked. Saci (34017): "Whenever host ice is rezzed or derezzed, gain 3."
  // Aircheck (36018): "Place 4 on this event. While this event is active, you can spend hosted credits, and you cannot
  // lose or spend credits from your credit pool. Run HQ or R&D." (1.2.2: the "cannot" wins, so Saci's 3 go to a pool
  // that cannot be spent). Walk.approach subtracts Saci's pay from the need whatever the lock. Unrezzed Pharos on HQ
  // (strength 5; "Give the Runner 1 tag. / End the run. / End the run."; Cleaver 2 boosts for 4 and one break for 1 = 5
  // against Aircheck's 4), Saci on it; the Runner plays Aircheck on HQ and the Corp rezzes Pharos as it is approached.
  const aircheck = (withSaci: boolean) => {
    let pharos = '';
    const s0 = board(st => {
      pharos = installIceForTest(st, C.PHAROS, 'hq', false);
      installProgramForTest(st, C.CLEAVER);
      if (withSaci) {
        const c = createCardInstance(st, C.SACI);
        c.isRezzed = true;
        c.hostedOnId = pharos;
        st.runner.rig.programs.push(c);
      }
      st.runner.credits = 1;
    });
    startRunnerTurn(s0);
    const id = giveCard(s0, 'runner', C.AIRCHECK);
    const s = choose(executeAction(s0, { type: 'PLAY_OPERATION_OR_EVENT', player: 'runner', cardInstanceId: id }), 'hq');
    expect([s.activeRun?.phase, s.activeRun?.poolLocked, s.runner.credits]).toEqual(['approach_ice', true, 0]);
    return { s, pharos };
  };
  const thisRunWith = (s: GameState, rez: string) => inCorp(s, () => serverHold(s, 'hq', { when: 'thisRun', mustRez: [rez], further: false }));
  it('Saci with the pool locked (Aircheck): Pharos rezzed holds this run', { timeout: T }, () => {
    const { s, pharos } = aircheck(true);
    expect(oracleGetsIn(s, 'hq', 'thisRun', [pharos]).answer).toBe('holds');
    expect(thisRunWith(s, pharos).holds).toBe(true);
  });
  it('Saci mirror: no Saci, Pharos rezzed holds this run (the walk and the engine agree)', { timeout: T }, () => {
    const { s, pharos } = aircheck(false);
    expect(thisRunWith(s, pharos).holds).toBe(true);
    expect(oracleGetsIn(s, 'hq', 'thisRun', [pharos]).answer).toBe('holds');
  });

  // AI-HOLD-MINOR-GAPS (3), a lender derezzed at the turn's end. Mycoweb (35053): "Resolve 1 subroutine on a rezzed
  // sentry." lenderViews (corp/hold.ts) counts a lender on a server it does not walk as rezzed as it stands now. Lycian
  // Multi-Munition (34100), rezzed as sentry and barrier on HQ: "[subroutine] If this ice is a barrier, gain 1 and end
  // the run." and "When a turn ends, derez this ice": it is derezzed as the Corp's turn ends (5.6.3d), so on the Runner's
  // turn Mycoweb has nothing to borrow. Rezzed Mycoweb alone on remote1, Archives empty, the Runner with no program.
  const lender = (code: string | null) =>
    board(st => {
      installIceForTest(st, C.MYCOWEB, 'remote1', true);
      if (code) {
        const id = installIceForTest(st, code, 'hq', true);
        if (code === C.LYCIAN) st.corp.servers.hq.ice.find(c => c.instanceId === id)!.chosenSubtypes = ['sentry', 'barrier'];
      }
      st.corp.archives.faceUp = [];
      st.corp.archives.faceDown = [];
    });
  it('lender: Lycian (sentry, barrier) on HQ is derezzed by the Runner\'s turn: Mycoweb does not hold', { timeout: T }, () => {
    const s = lender(C.LYCIAN);
    expect(turnTruth(s, 'remote1', [])).toBe('getsIn');
    expect(nextTurn(s, 'remote1').holds).toBe(false);
  });
  it('lender mirror: Ballista (stays rezzed; "Trash 1 installed program or end the run", no program) lends: holds, and the engine agrees', { timeout: T }, () => {
    const s = lender(C.BALLISTA);
    expect(nextTurn(s, 'remote1').holds).toBe(true);
    expect(turnTruth(s, 'remote1', [])).toBe('holds');
  });
});

/** A Runner that plays `script` for its main-phase actions (null: the Normal Runner AI) and the Normal Runner AI otherwise (as tests/exploitPins.test.ts). */
function scripted(script: (s: GameState) => GameAction | null): Agent {
  const ai = createAgent('runner', 'normal');
  return new Proxy(ai, {
    get(t, p) {
      if (p === 'chooseAction') return (s: GameState) => (!s.activeRun && s.pendingPrompts.length === 0 && s.activePlayer === 'runner' && script(s)) || ai.chooseAction(s);
      const v = (t as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  }) as Agent;
}

describe('bundle R: rez and rez money (LEO and the empty R&D pass since ai-rez-fixes; the two Whitespace pins stay known-failing by Jeff\'s card of 2026-11-20 03:51Z)', () => {
  // AI-SPENDS-KEPT-FLOOR-NEED. spendsKept (corp/rez.ts) hands rezMoney the Runner's credits after the toll as
  // credits - toll.need, and toll.need is the least pool that gets through, not what the toll takes. Whitespace (30074):
  // "The Runner loses 3. / If the Runner has 6 or less, end the run." F1's board (tests/fixtures/adversarial/
  // stage-c-f1-hq-toll-rez.json: a run on HQ at its outer ice, Offworld Office in HQ, Send a Message in remote-1)
  // reshaped: the approached HQ ice is Whitespace (unrezzed), remote-1 is Sleipnir (inner, code gate) behind Palisade,
  // both unrezzed; Unity taken off (Cleaver only: nothing breaks Sleipnir); the Runner has 11, the Corp 5.
  const f1: GameState = JSON.parse(readFileSync(new URL('./fixtures/adversarial/stage-c-f1-hq-toll-rez.json', import.meta.url), 'utf8'));
  const tollBoard = (code: string) => {
    const s = structuredClone(f1);
    s.runner.rig.programs = s.runner.rig.programs.filter(c => c.cardCode !== C.UNITY);
    s.corp.servers.hq.ice[1] = mk(s, code, false);
    s.corp.servers['remote-1'].ice = [mk(s, C.SLEIPNIR, false), mk(s, C.PALISADE, false)];
    s.corp.credits = 5;
    s.runner.credits = 11;
    expect([s.activeRun?.server, s.activeRun?.icePosition, s.runner.clicks]).toEqual(['hq', 1, 3]);
    expect(s.corp.hq.some(c => c.cardCode === C.OFFWORLD)).toBe(true);
    return s;
  };
  /** The Runner's credits once the toll is paid, played in the engine: the Corp rezzes the ice, the Runner AI passes it. */
  const afterToll = (s0: GameState): number => {
    const ice = s0.corp.servers.hq.ice[1].instanceId;
    const corp = createAgent('corp', 'normal');
    const rezzing = new Proxy(corp, {
      get(t, p) {
        if (p === 'chooseRez') return (_s: GameState, cards: CardInstance[]) => (cards.some(c => c.instanceId === ice) ? { type: 'REZ_CARD', player: 'corp', cardInstanceId: ice } : null);
        const v = (t as unknown as Record<string | symbol, unknown>)[p];
        return typeof v === 'function' ? v.bind(t) : v;
      },
    }) as Agent;
    const g = new GameRunner(s0, { corp: rezzing, runner: createAgent('runner', 'normal') });
    for (let i = 0; i < 100 && g.state.activeRun?.server === 'hq' && g.state.activeRun.icePosition === 1 && !g.state.winner; i++) if (!g.step()) break;
    expect(findCardAnywhere(g.state, ice)?.isRezzed).toBe(true);
    expect(g.state.activeRun?.icePosition).toBe(0);
    return g.state.runner.credits;
  };
  const handed = (s: GameState) => {
    restCredits.length = 0;
    inCorp(s, () => spendsKept(s, s.corp.servers.hq.ice[1]));
    return restCredits[0];
  };
  // Counted and not built (bundle R's count and ruling, 2026-11-20, review-fixes-1119/rez-count/ruling.md, C1): known
  // debt on the rez money row of docs/ai-priced-quantities.md. In play the class is reached where a credit-threshold ice
  // is already rezzed further in, behind an approached ice with a break cost (deal 1131 turn 14: Palisade approached on
  // R&D, Whitespace rezzed further in; handed 17, real 24); on 259 sources the real number changes no spendsKept answer.
  // On this pin's board the decision is not spendsKept's (the next pin). Stays known-failing.
  it.fails("Whitespace toll: spendsKept hands rezMoney the Runner's real credits after the toll (11 - 3 = 8)", { timeout: T }, () => {
    const s = tollBoard(C.WHITESPACE);
    expect(afterToll(s)).toBe(8);
    expect(handed(s)).toBe(8);
  });
  it('mirror: a Palisade toll (Cleaver breaks it for 1): the credits handed are the real ones (10)', { timeout: T }, () => {
    const s = tollBoard(C.PALISADE);
    expect(afterToll(s)).toBe(10);
    expect(handed(s)).toBe(10);
  });
  // The decision on the same board. Today the Corp rezzes Whitespace (5 -> 3), the Runner pays through (11 -> 8) and
  // runs remote-1 with its next click: Palisade's toll is paid with Cleaver and Sleipnir cannot be rezzed: Send a Message
  // stolen. Passing (6.9.2b: the rez is the Corp's choice) keeps the 4 for Sleipnir, which nothing breaks.
  // NOTE (what the pin found): on this board the rez is not R3's. countedRez returns null before R3, because iceCreditNeed
  // prices Whitespace at 0 (the loss and the floor are no break cost), so the rez is modelRez's and spendsKept is never
  // asked for it. Fixing spendsKept's number alone will not turn this pin.
  const remoteRunAfter = (s: GameState) => {
    const g = new GameRunner(s, { corp: createAgent('corp', 'normal'), runner: scripted(st => (st.runner.clicks > 0 && st.corp.servers['remote-1'] ? ({ type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote-1' } as GameAction) : null)) });
    for (let i = 0; i < 600 && !g.state.winner && g.state.activePlayer === 'runner'; i++) if (!g.step()) break;
    return g.state;
  };
  // Counted and not built (ruling C2): 81 windows of the kind (a loss toll at countedRez's free gate) on 259 sources, 0
  // with the exploit in play; `keepPricedCentral` (F1's check asked of the priced rez under R3's or R4's conditions)
  // turns this pin with 0 changed decisions. Jeff's card of 2026-11-20 03:51Z: "Leave it as known debt" (the free gate's
  // two owners of "free" and the priced rez's horizon, registry debt; beta-to-main-step.md 1f). Stays known-failing.
  it.fails('Whitespace toll, the decision: the Corp keeps the money for Sleipnir and Send a Message is not stolen', { timeout: T }, () => {
    const s = tollBoard(C.WHITESPACE);
    expect(inCorp(s, () => countedRez(s, s.corp.servers.hq.ice[1]))).toBe(null);
    expect(iceCreditNeed({ ...s }, { ...s.corp.servers.hq.ice[1], isRezzed: true })).toBe(0);
    const end = remoteRunAfter(s);
    expect(end.runner.scoreArea.some(c => c.cardCode === C.SAM)).toBe(false);
  });
  it('Whitespace decision mirror: Palisade in its place: R3 passes the toll (F1) and Send a Message is not stolen', { timeout: T }, () => {
    const s = tollBoard(C.PALISADE);
    expect(inCorp(s, () => countedRez(s, s.corp.servers.hq.ice[1]))).toBe('pass');
    const end = remoteRunAfter(s);
    expect(end.runner.scoreArea.some(c => c.cardCode === C.SAM)).toBe(false);
  });

  // AI-RUN-STOPPER-LEO-BLOCKS-OTHERS. runStopper (corp/rez.ts) returns null as soon as LEO's trash is legal and not worth
  // it, and never reaches The Red Room. LEO Construction (35035): "Once per turn -> Trash 1 rezzed bioroid card in the
  // root of or protecting the attacked server: End the run." The Red Room (36045): "Hosted power counter: End the run.
  // Use this ability only during a run against another server." Rezzed Brân 1.0 on HQ (the Runner breaks its three
  // subroutines with its three clicks, "Lose [click]"), The Red Room on R&D with 1 counter; the window is the Corp's at
  // the approach to HQ (6.9.4e). Played in the engine.
  const atHq = (leo: boolean, hq: string[]) => {
    const s0 = board(st => {
      if (leo) setIdentity(st, 'corp', C.LEO);
      installIceForTest(st, C.BRAN, 'hq', true);
      const rr = installCorpForTest(st, C.RED_ROOM, 'rd', true);
      st.corp.servers.rd.root.find(c => c.instanceId === rr)!.tokens = { power: 1 };
      st.corp.hq = hq.map(code => createCardInstance(st, code));
    });
    startRunnerTurn(s0);
    let s = executeAction(s0, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    for (let i = 0; i < 30 && s.activeRun && !(s.activeRun.phase === 'approach_server' && s.priority?.holder === 'corp'); i++) {
      const p = activePrompt(s);
      const la = getLegalActions(s, p ? p.side : s.priority?.holder ?? 'runner');
      s = executeAction(s, la.find(x => x.type === 'BIOROID_BREAK') ?? la.find(x => x.type === 'CONTINUE_RUN') ?? la.find(x => x.type === 'PASS') ?? la[0]);
    }
    expect([s.activeRun?.phase, s.priority?.holder]).toEqual(['approach_server', 'corp']);
    return s;
  };
  const stopper = (s: GameState) => {
    const a = createAgent('corp', 'normal').chooseRez!(structuredClone(s), rezCandidates(s, 'approach_server')) as (GameAction & { cardInstanceId?: string }) | null;
    return a?.type === 'USE_ABILITY' ? findCardAnywhere(s, a.cardInstanceId!)?.cardCode ?? null : a?.type ?? null;
  };
  const REPORT_HQ = [C.OFFWORLD, C.OFFWORLD, C.PALISADE, C.PALISADE, C.PALISADE, C.PALISADE];
  it("LEO with The Red Room, the report's HQ (2 Offworld Office, 4 Palisade): the Corp fires The Red Room", { timeout: T }, () => {
    const s = atHq(true, REPORT_HQ);
    const usable = getLegalActions(s, 'corp').flatMap(a => (a.type === 'USE_ABILITY' ? [findCardAnywhere(s, a.cardInstanceId)?.cardCode] : []));
    expect(usable.sort()).toEqual([C.LEO, C.RED_ROOM].sort());
    expect(stopper(s)).toBe(C.RED_ROOM);
  });
  it("LEO mirror: HQ of three Send a Message (LEO's trash is worth it): the Corp uses LEO", { timeout: T }, () => {
    expect(stopper(atHq(true, [C.SAM, C.SAM, C.SAM]))).toBe(C.LEO);
  });
  it('LEO mirror: another identity on the report\'s board fires The Red Room', { timeout: T }, () => {
    expect(stopper(atHq(false, REPORT_HQ))).toBe(C.RED_ROOM);
  });

  // AI-STAKED-SERVERS-EMPTY-RD. stakedServers (corp/rezMoney.ts) lists R&D always, so rez money is kept for an R&D with
  // no agenda left in it by the Corp's own deck list (agendasUnseen 0; R4 in corp/rez.ts reads the same count). Unrezzed
  // Palisade on R&D, the Runner with no program, every agenda of the deck in Archives (face up).
  // Can it come up in play: yes, late, when every agenda left is in HQ, a remote, Archives or a score area while R&D's
  // ice is unrezzed (or does not hold without a rez); the coordinator's 12 deals had 8 such decisions and none kept money
  // (R&D's ice was rezzed or already held: byServer 0). Rare and small.
  const emptyRd = (left: number) =>
    board(st => {
      installIceForTest(st, C.PALISADE, 'rd', false);
      const agendas = st.corp.rd.filter(c => cardDef(c).type_code === 'agenda');
      const out = new Set(agendas.slice(left).map(c => c.instanceId));
      st.corp.archives.faceUp.push(...st.corp.rd.filter(c => out.has(c.instanceId)));
      st.corp.rd = st.corp.rd.filter(c => !out.has(c.instanceId));
    });
  it('empty R&D: no money is kept for R&D when no agenda is left in it', { timeout: T }, () => {
    const s = emptyRd(0);
    expect(inCorp(s, () => agendasUnseen(s))).toBe(0);
    expect(inCorp(s, () => rezMoney(s)).byServer).not.toHaveProperty('rd');
  });
  it('empty R&D mirror: one agenda left in R&D keeps the Palisade\'s 3', { timeout: T }, () => {
    const s = emptyRd(1);
    expect(inCorp(s, () => agendasUnseen(s))).toBe(1);
    expect(inCorp(s, () => rezMoney(s))).toMatchObject({ keep: 3, byServer: { rd: 3 } });
  });
});

describe('bundle P: placement wiring (counted before any fix; the pins say what is asserted)', () => {
  const candidates = (s: GameState) => inCorp(s, () => corpCandidates(s, getLegalActions(s, 'corp'), { held: null, freeExhausted: false }));
  const installs = (s: GameState, id: string) =>
    getLegalActions(s, 'corp').filter(a => a.type === 'INSTALL_CARD' && a.cardInstanceId === id) as (GameAction & { type: 'INSTALL_CARD'; targetServerId?: string; asNewRemote?: boolean })[];
  const dest = (a: GameAction) => ((a as { asNewRemote?: boolean }).asNewRemote ? 'new' : (a as { targetServerId?: string }).targetServerId);
  const ofCard = (s: GameState, id: string) => candidates(s).filter(c => (c.action as { cardInstanceId?: string }).cardInstanceId === id);

  // AI-SCORING-SHORT-DOUBLE-COUNT. scoringShort (corp/placement.ts) takes lineKeep (rezMoney's keep, which already holds
  // the scoring remote's own rez when an agenda sits in its root) off the money the Corp asks serverHold with, so the
  // remote's rez is paid twice. remote-1: unrezzed Palisade, Offworld Office in the root; R&D: a rezzed Palisade; the
  // Runner with no program; the Corp with 1 click.
  const shortBoard = (corp: number) =>
    board(st => {
      installIceForTest(st, C.PALISADE, 'remote-1', false);
      installCorpForTest(st, C.OFFWORLD, 'remote-1');
      installIceForTest(st, C.PALISADE, 'rd', true);
      st.corp.credits = corp;
      st.corp.clicks = 1;
    });
  // Fixed by bundle P fix 1 (lineKeep leaves the scoring remote out of the pools; tests/placementWiring.test.ts)
  it('scoringShort, Corp 5: remote-1 holds for its 3 (keep 3 is that same rez): not short', { timeout: T }, () => {
    const s = shortBoard(5);
    expect(nextTurn(s, 'remote-1', 5)).toMatchObject({ holds: true, rezCost: 3 });
    expect(inCorp(s, () => rezMoney(s))).toMatchObject({ keep: 3, byServer: { rd: 0, 'remote-1': 3 } });
    expect(inCorp(s, () => scoringShort(s))).toBe(null);
  });
  it('scoringShort mirror: Corp 2, one credit fewer than the holding rez: short, remote-1', { timeout: T }, () => {
    const s = shortBoard(2);
    expect(nextTurn(s, 'remote-1', 2).holds).toBe(false);
    expect(inCorp(s, () => scoringShort(s)?.id)).toBe('remote-1');
  });

  // 1b, the sibling reader (red team M3; found row 89 e and j): reservedForAgenda reads the same lineKeep and asks
  // serverHold of the same scoring remote, so the remote's own holding rez is counted twice there too. The correction
  // (the count's arm `reservedOnce`) was counted and NOT built: it changed one decision, this board's (an asset's bare
  // install in place of Funhouse on a new remote), and that one pair was worse on all four columns. Human file report-48,
  // move 59, turn 6, the AI Corp at 3 credits and 2 clicks, Witch Hunt in HQ: with the remote counted once (floor 4, not
  // 6) the line's horizon holds remote-1 and the remote is reserved; today it is not (null).
  it.fails('reservedForAgenda, report-48 move 59: with remote-1 counted once it is reserved for the agenda', { timeout: T }, () => {
    const s: GameState = JSON.parse(readFileSync(new URL('./fixtures/placement-wiring/report-48-59.json', import.meta.url), 'utf8'));
    expect(inCorp(s, () => reservedForAgenda(s)?.id)).toBe('remote-1');
  });

  // AI-ASSET-COVER-PLANNER-MISMATCH. placedInstalls (corp/candidates.ts) keeps the bare install for every assetCover
  // placement ("Q5 plays its ice first"), which is right for the ice-pair form only: in the waiting-remote form `place`
  // puts the asset on the iced remote and the candidate (and so the look-ahead's play of it) is a new remote. Regolith
  // Mining License in HQ; remote-1 a rezzed Palisade, empty root; no agenda in HQ; Corp 5 and 3 clicks.
  // Fixed by bundle P fix 2 (the waiting form's candidate is the install place gives; tests/placementWiring.test.ts)
  it('asset cover, the waiting remote: the candidate installs Regolith where place says (remote-1)', { timeout: T }, () => {
    const s = board(st => {
      installIceForTest(st, C.PALISADE, 'remote-1', true);
      st.corp.credits = 5;
    });
    const reg = toHq(s, C.REGOLITH);
    const fromNew = installs(s, reg.instanceId).find(a => a.asNewRemote)!;
    expect(inCorp(s, () => place(s, reg, { from: fromNew, held: null }))).toEqual([{ server: 'remote-1', reason: 'assetCover' }]);
    expect(ofCard(s, reg.instanceId).map(c => dest(c.action))).toEqual(['remote-1']);
  });
  it('asset cover mirror, the ice pair (Regolith and a Palisade in HQ, no remote): place pairs them on a new remote; the candidate is the asset\'s own install, as today', { timeout: T }, () => {
    const s = board(st => {
      st.corp.credits = 5;
    });
    const reg = toHq(s, C.REGOLITH);
    const ice = toHq(s, C.PALISADE);
    const fromNew = installs(s, reg.instanceId).find(a => a.asNewRemote)!;
    expect(inCorp(s, () => place(s, reg, { from: fromNew, held: null }))).toEqual([{ server: 'new', pairWith: ice.instanceId, reason: 'assetCover' }]);
    expect(ofCard(s, reg.instanceId).map(c => dest(c.action))).toEqual(['new']);
  });

  // AI-PLACED-INSTALLS-DROPS-SERVERS: NO failing pin. Today's behaviour is the approved order of authority (spec 1.3,
  // point 3, Jeff 2026-11-10: "when a counted placement rule applies, place returns one destination and the planner is
  // not shown the same card at another"). This states it on the report's two boards; a change is Jeff's decision after a
  // count (coordinator-check.md, claim 1).
  it("placed installs today: one destination where a counted rule applies (the report's two boards)", { timeout: T }, () => {
    // (1) Palisades on HQ, R&D and remote-1 (rezzed); Offworld Office and Whitespace in HQ; the Runner with Cleaver and 6:
    // remote-1 is the scoring remote and short, so the ice redirect sends Whitespace there and HQ/R&D ice is not offered
    const a = board(st => {
      for (const sv of ['hq', 'rd', 'remote-1']) installIceForTest(st, C.PALISADE, sv, true);
      installProgramForTest(st, C.CLEAVER);
      st.runner.credits = 6;
      st.corp.credits = 5;
    });
    toHq(a, C.OFFWORLD);
    const ws = toHq(a, C.WHITESPACE);
    expect(installs(a, ws.instanceId).map(dest)).toEqual(['new', 'hq', 'rd', 'archives', 'remote-1']);
    expect(inCorp(a, () => scoringShort(a)?.id)).toBe('remote-1');
    expect(ofCard(a, ws.instanceId).map(c => [dest(c.action), c.line])).toEqual([['remote-1', 2]]);
    // (2) Send a Message behind two rezzed Palisades on remote-1, a rezzed Palisade on an empty remote-2, Manegarm
    // Skunkworks in HQ, Corp 0 credits (with money the Corp's counted line advances Send a Message and place offers no
    // install of the upgrade at all): the asset partner sends it to remote-2 and no other server is offered
    const b = board(st => {
      installIceForTest(st, C.PALISADE, 'remote-1', true);
      installIceForTest(st, C.PALISADE, 'remote-1', true);
      installCorpForTest(st, C.SAM, 'remote-1');
      installIceForTest(st, C.PALISADE, 'remote-2', true);
      st.corp.credits = 0;
    });
    const mg = toHq(b, C.MANEGARM);
    expect(installs(b, mg.instanceId).map(dest)).toEqual(['new', 'hq', 'rd', 'archives', 'remote-1', 'remote-2']);
    expect(ofCard(b, mg.instanceId).map(c => dest(c.action))).toEqual(['remote-2']);
  });
});
