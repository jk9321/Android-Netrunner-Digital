import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GameAction, GameState, activePrompt, createCardInstance, executeAction, findCardAnywhere } from '../src/core';
import { createAgent } from '../src/ai';
import { FreeActionGuard } from '../src/ai/agent';
import { HeuristicRunnerAI, readWriteFullShuffle } from '../src/ai/runnerAI';
import type { RunnerContext } from '../src/ai/runner/core';
import { applyPlanOff, tuning } from '../src/ai/synergy';
import { asSide, plan, pricing } from '../src/ai/pricing';
import { giveCard, installCorpForTest, installIceForTest, installProgramForTest, newGame, passTurn, putInHand, runIntoFirstIce, runnerInstall, startRunnerTurn } from './helpers';

/**
 * R-B B1 bar 3 (brief netrunner-ai/runner-rework/briefs/b1-core.md rev 1): what one decision of each Runner caller does,
 * counted, RECORDED ON THE BASE (beta ff04f60, before runner/core.ts existed) and equal on the branch. Per caller kind
 * (table (a) of the step 1 file): the calls of `remember`, the decision context (live, or skipped because frozen), the
 * loop guard's start and its note (notePlayed), and the ranking, each by the role of the Runner instance that made it.
 * The guard of a Corp agent is not counted.
 */
const calls = vi.hoisted(() => ({ live: 0, frozen: 0, pricing: null as null | (() => { frozen?: boolean }) }));
vi.mock('../src/ai/handValues', async importOriginal => {
  const m = await importOriginal<typeof import('../src/ai/handValues')>();
  return {
    ...m,
    inDecision: <T,>(...a: Parameters<typeof m.inDecision<T>>) => {
      if (calls.pricing?.().frozen) calls.frozen++;
      else calls.live++;
      return m.inDecision(...a);
    },
  };
});

// The branch half (added after the base record): every context the order is handed, as handed, with its memory's size then
const contexts = vi.hoisted(() => ({ on: false, seen: [] as { kind: 'decide' | 'off'; ctx: import('../src/ai/runner/core').RunnerContext; size: number }[] }));
vi.mock('../src/ai/runner/core', async importOriginal => {
  const m = await importOriginal<typeof import('../src/ai/runner/core')>();
  const keep = (kind: 'decide' | 'off', ctx: import('../src/ai/runner/core').RunnerContext) => contexts.on && contexts.seen.push({ kind, ctx, size: ctx.memory.size });
  return {
    ...m,
    runnerDecide: (...a: Parameters<typeof m.runnerDecide>) => (keep('decide', a[1]), m.runnerDecide(...a)),
    runnerOffTurn: (...a: Parameters<typeof m.runnerOffTurn>) => (keep('off', a[1]), m.runnerOffTurn(...a)),
  };
});

type Role = string;
type Count = { instances: number; remember: number; rank: number; start: number; played: number };
const seen = new Map<HeuristicRunnerAI, Role>();
const tally = new Map<HeuristicRunnerAI, Omit<Count, 'instances'>>();
let roleOf: (r: HeuristicRunnerAI) => Role = () => 'other';
const bump = (r: HeuristicRunnerAI, k: keyof Omit<Count, 'instances'>) => {
  if (!seen.has(r)) seen.set(r, roleOf(r));
  const t = tally.get(r) ?? { remember: 0, rank: 0, start: 0, played: 0 };
  t[k]++;
  tally.set(r, t);
};
const P = HeuristicRunnerAI.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
const originals: Record<string, (...a: unknown[]) => unknown> = {};
const guardStart = FreeActionGuard.prototype.start;

beforeAll(() => {
  calls.pricing = pricing;
  for (const [name, k] of [['remember', 'remember'], ['rankMainActions', 'rank'], ['notePlayed', 'played']] as const) {
    originals[name] = P[name];
    P[name] = function (this: HeuristicRunnerAI, ...a: unknown[]) {
      bump(this, k);
      return originals[name].apply(this, a);
    };
  }
  FreeActionGuard.prototype.start = function (this: FreeActionGuard, ...a: Parameters<FreeActionGuard['start']>) {
    for (const r of seen.keys()) if ((r as unknown as { freeActions: FreeActionGuard }).freeActions === this) bump(r, 'start');
    return guardStart.apply(this, a);
  };
});
afterAll(() => {
  for (const name of Object.keys(originals)) P[name] = originals[name];
  FreeActionGuard.prototype.start = guardStart;
});

/** One decision: `ask` runs it; `role` names each Runner instance met (the asked one is 'decider'). */
function count(decider: unknown, ask: () => unknown, role: (r: HeuristicRunnerAI) => Role) {
  seen.clear();
  tally.clear();
  calls.live = calls.frozen = 0;
  roleOf = r => (r === decider ? 'decider' : role(r));
  // the asked instance is seen first, so a guard start before its first counted method is attributed
  if (decider instanceof HeuristicRunnerAI) seen.set(decider, 'decider');
  const answer = ask();
  const byRole: Record<Role, Count> = {};
  for (const [r, role] of seen) {
    const t = tally.get(r);
    if (!t) continue;
    const c = (byRole[role] ??= { instances: 0, remember: 0, rank: 0, start: 0, played: 0 });
    c.instances++;
    for (const k of ['remember', 'rank', 'start', 'played'] as const) c[k] += t[k];
  }
  return { answer: JSON.stringify(answer), live: calls.live, frozen: calls.frozen, byRole };
}
const planOf = (r: HeuristicRunnerAI) => ((r as unknown as { planner: boolean }).planner ? 'plannerOn' : 'plannerOff');

// ---------------------------------------------------------------------------------------------- unit states
const mainState = () => {
  const s = newGame(1);
  startRunnerTurn(s);
  return s;
};
/** The Runner at the end of its turn over its hand size: the discard prompt. */
const promptState = () => {
  let s = mainState();
  for (let i = 0; i < 4; i++) s.runner.grip.push(s.runner.stack.shift()!);
  s.runner.clicks = 0;
  s = executeAction(s, { type: 'END_TURN', player: 'runner' });
  return s;
};
const runState = () => {
  const s = newGame(1);
  installIceForTest(s, '30047', 'hq', true);
  return runIntoFirstIce(s, 'hq');
};
const READ_WRITE_SHARE = '36022';
const fullShare = (s: GameState) => {
  const id = installProgramForTest(s, READ_WRITE_SHARE);
  s.runner.rig.programs.find(p => p.instanceId === id)!.hostedCards = s.runner.stack.splice(0, 4);
  return id;
};
/** A Corp turn out of clicks with Madani hosting a Cleaver the Runner can afford (tests/aiOffTurn.test.ts): the off-turn window. */
const offTurnState = () => {
  let [s, madani] = runnerInstall(newGame(), '35028');
  const cleaver = giveCard(s, 'runner', '30006');
  const card = s.runner.grip.find(c => c.instanceId === cleaver)!;
  s.runner.grip = s.runner.grip.filter(c => c !== card);
  findCardAnywhere(s, madani)!.hostedCards = [card];
  s = passTurn(s);
  s.runner.credits = 5;
  s.corp.clicks = 0;
  return executeAction(s, { type: 'END_TURN', player: 'corp' });
};
const corpMain = () => newGame(1);

describe('one decision of each Runner caller (bar 3, recorded on the base)', () => {
  it('the Normal Runner, main phase (the planner rollout inside it)', () => {
    const ai = createAgent('runner', 'normal');
    const got = count(ai, () => ai.chooseAction(mainState()), () => 'rollout');
    check('normalMain', got);
  });
  it('the Normal Runner, a prompt', () => {
    const ai = createAgent('runner', 'normal');
    const s = promptState();
    expect(activePrompt(s)?.kind).toBe('discard');
    check('normalPrompt', count(ai, () => ai.chooseAction(s), () => 'rollout'));
  });
  it('the Normal Runner, a run under way', () => {
    const ai = createAgent('runner', 'normal');
    const s = runState();
    expect(s.activeRun).toBeTruthy();
    check('normalRun', count(ai, () => ai.chooseAction(s), () => 'rollout'));
  });
  it('the Normal Runner, off-turn (chooseOffTurn)', () => {
    const ai = createAgent('runner', 'normal');
    const s = offTurnState();
    expect(s.priority).toMatchObject({ step: 'corp_action', holder: 'runner' });
    check('normalOff', count(ai, () => ai.chooseOffTurn!(s), () => 'rollout'));
  });
  it('the Normal Runner, a full Read-Write Share (noted)', () => {
    const ai = createAgent('runner', 'normal');
    const s = mainState();
    fullShare(s);
    check('normalShare', count(ai, () => ai.chooseAction(s), () => 'rollout'));
  });
  it('a full Read-Write Share with a run under way is not answered with its ability (finding 1)', () => {
    const s0 = newGame(1);
    installIceForTest(s0, '30047', 'hq', true);
    const id = fullShare(s0);
    const s = runIntoFirstIce(s0, 'hq');
    expect(s.activeRun).toBeTruthy();
    for (const ai of [createAgent('runner', 'normal'), createAgent('runner', 'hard', { seed: 1, samples: 1, candidates: 2 })]) {
      const a = ai.chooseAction(s) as GameAction;
      expect(a.type === 'USE_ABILITY' && a.cardInstanceId === id).toBe(false);
    }
  });
  it('the Hard Runner, main phase (its search playouts inside it)', () => {
    const ai = createAgent('runner', 'hard', { seed: 1, samples: 1, candidates: 2 });
    const base = (ai as unknown as { base: HeuristicRunnerAI }).base;
    const got = count(ai, () => ai.chooseAction(mainState()), r => (r === base ? 'base' : 'playout'));
    check('hardMain', got);
  });
  it('the Hard Runner, a prompt and a run under way (the base answers them)', () => {
    for (const [s, key] of [[promptState(), 'hardPrompt'], [runState(), 'hardRun']] as const) {
      const ai = createAgent('runner', 'hard', { seed: 1, samples: 1, candidates: 2 });
      const base = (ai as unknown as { base: HeuristicRunnerAI }).base;
      check(key, count(ai, () => ai.chooseAction(s), r => (r === base ? 'base' : 'playout')));
    }
  });
  it('the Hard Runner, a full Read-Write Share (not noted)', () => {
    const ai = createAgent('runner', 'hard', { seed: 1, samples: 1, candidates: 2 });
    const base = (ai as unknown as { base: HeuristicRunnerAI }).base;
    const s = mainState();
    fullShare(s);
    check('hardShare', count(ai, () => ai.chooseAction(s), r => (r === base ? 'base' : 'playout')));
  });
  it('the Hard Runner, off-turn', () => {
    const ai = createAgent('runner', 'hard', { seed: 1, samples: 1, candidates: 2 });
    const base = (ai as unknown as { base: HeuristicRunnerAI }).base;
    check('hardOff', count(ai, () => ai.chooseOffTurn!(offTurnState()), r => (r === base ? 'base' : 'playout')));
  });
  it("the Hard Corp's search playout Runners (no memory)", () => {
    const ai = createAgent('corp', 'hard', { seed: 1, samples: 1, candidates: 2 });
    check('hardCorp', count(ai, () => ai.chooseAction(corpMain()), () => 'playout'));
  });
  it("the Normal Corp's reply Runners", () => {
    const ai = createAgent('corp', 'normal');
    check('reply', count(ai, () => ai.chooseAction(corpMain()), r => `reply.${planOf(r)}`));
  });
  it("the oracle playout's Runner (plan.oracle.safestRemote on)", () => {
    const was = tuning.plan;
    try {
      applyPlanOff('+oracle.safestRemote');
      const s = corpMain();
      // an agenda in HQ and one click: a line that installs it in a remote ends the turn, and the oracle is asked about it
      putInHand(s, 'corp', 'agenda');
      s.corp.clicks = 1;
      const ai = createAgent('corp', 'normal');
      check('oracle', count(ai, () => ai.chooseAction(s), r => `nested.${planOf(r)}`));
    } finally {
      tuning.plan = was;
    }
  });
});

describe('the Runner agent as callers and scripts see it', () => {
  // Red team finding 11 (a), the pin of the agent's own fields: moved to tests/codeHealth.test.ts (brief point 7)
  it("a fresh instance's off-turn state is null and false, its own", () => {
    const [a, b] = [new HeuristicRunnerAI(), new HeuristicRunnerAI()] as unknown as { savingFor: string | null; digForBreakers: boolean; memory: Map<string, string> }[];
    expect([a.savingFor, a.digForBreakers]).toEqual([null, false]);
    expect(a.memory).not.toBe(b.memory);
  });
  it('knownCards() is the live map: a write through it is read by the next ranking (search.ts:117)', () => {
    const s = mainState();
    const agenda = createCardInstance(s, '30066'); // an agenda, facedown in a new remote
    s.corp.servers['remote-x'] = { id: 'remote-x', name: 'Remote X', isRemote: true, ice: [], root: [agenda] } as GameState['corp']['servers'][string];
    const runScoreOf = (ai: HeuristicRunnerAI) => asSide('runner', () => ai.rankMainActions(s)).find(r => r.action.type === 'INITIATE_RUN' && r.action.targetServerId === 'remote-x')!.score;
    const plain = new HeuristicRunnerAI({ planner: false });
    const told = new HeuristicRunnerAI({ planner: false });
    told.knownCards().set(agenda.instanceId, agenda.cardCode);
    expect(told.knownCards()).toBe(told.knownCards());
    expect(runScoreOf(told)).not.toBe(runScoreOf(plain));
  });
  it('the ranking outside asSide reads tuning.plan; inside asSide the Runner plan (red team finding 4)', () => {
    const plans: unknown[] = [];
    const scoreMain = P.scoreMain;
    P.scoreMain = function (this: HeuristicRunnerAI, ...a: unknown[]) {
      plans.push(plan());
      return scoreMain.apply(this, a);
    };
    try {
      const ai = new HeuristicRunnerAI({ planner: false });
      ai.rankMainActions(mainState());
      expect(plans.length).toBeGreaterThan(0);
      expect(plans.every(p => p === tuning.plan)).toBe(true);
      plans.length = 0;
      asSide('runner', () => ai.rankMainActions(mainState()));
      expect(plans.every(p => p !== tuning.plan)).toBe(true);
    } finally {
      P.scoreMain = scoreMain;
    }
  });
});

/**
 * The context each caller builds (step 1 table (a), the branch half of bar 3): its fields, read off the context the
 * order was handed, against the caller's own fields. B2 deleted the four context fields no src code read (synergy,
 * guard, planMemory, offTurnState) and the run callback (runAction is called directly); the two it kept, view and memory,
 * are checked here: read by B3's prompt answer, and until then this table's handle. The agent's own fields the deleted
 * ones copied are read off the agent itself.
 */
describe('the context each caller hands the order (table (a))', () => {
  const own = (r: unknown) => r as { synergy: boolean; planner: boolean; debug: boolean; memory: Map<string, string>; freeActions: FreeActionGuard; planMemory: unknown; savingFor: string | null; digForBreakers: boolean };
  const record = (ask: () => unknown) => {
    contexts.seen.length = 0;
    contexts.on = true;
    try {
      ask();
    } finally {
      contexts.on = false;
    }
    return [...contexts.seen];
  };
  /** The context an agent builds is the agent's own fields, not copies. */
  const isOwn = (ctx: RunnerContext, r: HeuristicRunnerAI) => {
    const o = own(r);
    expect(ctx.view).toBe(o.planner ? 'dealt' : 'given');
    expect(ctx.memory).toBe(r.knownCards());
    expect(ctx.counted).toBe(readWriteFullShuffle);
    expect(ctx.debug).toBe(o.debug);
  };

  it('the Normal Runner: dealt view, the planner, notes the counted pick; its rollout: given view, no look-ahead, no debug, a copy of the map', () => {
    const ai = new HeuristicRunnerAI({ debug: false });
    const seen = record(() => ai.chooseAction(mainState()));
    const mine = seen.filter(x => x.ctx.memory === ai.knownCards());
    expect(mine).toHaveLength(1);
    isOwn(mine[0].ctx, ai);
    expect([mine[0].ctx.view, !!mine[0].ctx.lookahead, mine[0].ctx.noteCounted, !!mine[0].ctx.base]).toEqual(['dealt', true, true, false]);
    // the rollout answers prompts only, so on this state it is never handed the order; its context is built the same way
    const rollout = new HeuristicRunnerAI({ synergy: true, planner: false });
    const ctx = rollout.runnerContext();
    isOwn(ctx, rollout);
    expect([ctx.view, !!ctx.lookahead, ctx.debug]).toEqual(['given', false, false]);
  });
  it('the Normal Runner off-turn: the same context, its own off-turn state as left (fresh: null and false)', () => {
    const ai = new HeuristicRunnerAI();
    const seen = record(() => ai.chooseOffTurn(offTurnState()));
    expect(seen.map(x => x.kind)).toEqual(['off']);
    isOwn(seen[0].ctx, ai);
    expect([own(ai).savingFor, own(ai).digForBreakers]).toEqual([null, false]);
  });
  it("the Hard Runner: the base's context with base, observe, an un-noted counted pick and the search; its playouts: fresh agents holding the Hard Runner's map", () => {
    const ai = createAgent('runner', 'hard', { seed: 1, samples: 1, candidates: 2 });
    const base = (ai as unknown as { base: HeuristicRunnerAI }).base;
    base.knownCards().set('inst-zz', '30066');
    const seen = record(() => ai.chooseAction(mainState()));
    const hard = seen.filter(x => x.ctx.memory === base.knownCards());
    expect(hard).toHaveLength(1);
    const ctx = hard[0].ctx;
    expect([ctx.view, own(base).synergy, ctx.noteCounted, !!ctx.base, !!ctx.lookahead, ctx.debug]).toEqual(['given', true, false, true, true, false]);
    const playouts = seen.filter(x => x !== hard[0]);
    expect(playouts.length).toBeGreaterThan(0);
    for (const p of playouts) {
      expect([p.ctx.view, !!p.ctx.lookahead, p.ctx.noteCounted, !!p.ctx.base, p.ctx.memory === base.knownCards()]).toEqual(['given', false, true, false, false]);
      expect(p.ctx.memory.get('inst-zz')).toBe('30066');
    }
  });
  it("the Hard Corp's playout Runners: an empty map at their first decision", () => {
    const ai = createAgent('corp', 'hard', { seed: 1, samples: 1, candidates: 2 });
    const seen = record(() => ai.chooseAction(corpMain()));
    const firsts = new Map<unknown, number>();
    for (const x of seen) if (!firsts.has(x.ctx.memory)) firsts.set(x.ctx.memory, x.size);
    expect(firsts.size).toBeGreaterThan(0);
    expect([...firsts.values()].every(n => n === 0)).toBe(true);
    expect(seen.every(x => x.ctx.view === 'given' && !x.ctx.lookahead)).toBe(true);
  });
  it("the reply's Runners: given view, no look-ahead, one map per sample starting empty", () => {
    const seen = record(() => createAgent('corp', 'normal').chooseAction(corpMain()));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(x => x.ctx.view === 'given' && !x.ctx.lookahead && x.ctx.noteCounted && !x.ctx.debug)).toBe(true);
    const firsts = new Map<unknown, number>();
    for (const x of seen) if (!firsts.has(x.ctx.memory)) firsts.set(x.ctx.memory, x.size);
    expect(firsts.size).toBeGreaterThan(1);
    expect([...firsts.values()].every(n => n === 0)).toBe(true);
  });
  it("the oracle playout's Runner: synergy, the dealt view and the planner", () => {
    const was = tuning.plan;
    // The agent that built each context: synergy is the agent's own field since B2 deleted the context's copy
    const agentOf = new WeakMap<object, HeuristicRunnerAI>();
    const build = HeuristicRunnerAI.prototype.runnerContext;
    const spy = vi.spyOn(HeuristicRunnerAI.prototype, 'runnerContext').mockImplementation(function (this: HeuristicRunnerAI) {
      const ctx = build.call(this);
      agentOf.set(ctx, this);
      return ctx;
    });
    try {
      applyPlanOff('+oracle.safestRemote');
      const s = newGame(2); // not the position the call-count test played out: oracle.ts keeps played-out positions
      putInHand(s, 'corp', 'agenda');
      s.corp.clicks = 1;
      const seen = record(() => createAgent('corp', 'normal').chooseAction(s));
      const oracle = seen.filter(x => x.ctx.view === 'dealt');
      expect(oracle.length).toBeGreaterThan(0);
      expect(oracle.every(x => own(agentOf.get(x.ctx)).synergy && !!x.ctx.lookahead && x.ctx.noteCounted && !x.ctx.base)).toBe(true);
    } finally {
      spy.mockRestore();
      tuning.plan = was;
    }
  });
});

/**
 * Bar 2 (red team finding 7): each fault planted by scripts/runner-rework/core-faults.ts, emulated here on a unit state,
 * changes what the order or a body reads, before the lockstep is asked whether it shows.
 */
describe('bar 2: each planted fault changes its input', () => {
  const guardOf = (r: HeuristicRunnerAI) => (r as unknown as { freeActions: { count: number; key: string } }).freeActions;
  it("rolloutGuard: a rollout ranking with the decider's guard resets the decider's count", () => {
    const s = mainState();
    const run = (shared: boolean) => {
      const ai = new HeuristicRunnerAI();
      asSide('runner', () => ai.rankMainActions(s)); // starts the guard at this turn and click count
      for (let i = 0; i < 3; i++) ai.notePlayed({ type: 'GAIN_CREDIT', player: 'runner' });
      const rollout = new HeuristicRunnerAI({ planner: false });
      if (shared) (rollout as unknown as { freeActions: unknown }).freeActions = guardOf(ai);
      const later = { ...s, runner: { ...s.runner, clicks: s.runner.clicks - 1 } }; // a playout state, a click on
      asSide('runner', () => rollout.rankMainActions(later));
      return guardOf(ai).count;
    };
    expect([run(false), run(true)]).toEqual([3, 0]);
  });
  it("replyMemory: a reply Runner's map keeps a card it saw that is no longer installed, so a shared map carries it to the next sample", () => {
    const s = mainState();
    const asset = createCardInstance(s, '30054');
    asset.isRezzed = true;
    s.corp.servers['remote-x'] = { id: 'remote-x', name: 'Remote X', isRemote: true, ice: [], root: [asset] } as GameState['corp']['servers'][string];
    const ai = new HeuristicRunnerAI({ planner: false });
    ai.observe(s);
    const gone = structuredClone(s);
    delete gone.corp.servers['remote-x'];
    ai.observe(gone);
    expect(ai.knownCards().get(asset.instanceId)).toBe('30054');
    expect(new HeuristicRunnerAI({ planner: false }).knownCards().size).toBe(0);
  });
  it("playoutMemory: the Hard search's playout Runners hold the Hard Runner's map (see the table (a) test), which the fault drops", () => {
    const ai = createAgent('runner', 'hard', { seed: 1, samples: 1, candidates: 2 });
    (ai as unknown as { base: HeuristicRunnerAI }).base.knownCards().set('inst-zz', '30066');
    contexts.seen.length = 0;
    contexts.on = true;
    try {
      ai.chooseAction(mainState());
    } finally {
      contexts.on = false;
    }
    const playouts = contexts.seen.filter(x => !x.ctx.base);
    expect(playouts.length).toBeGreaterThan(0);
    expect(playouts.every(x => x.ctx.memory.has('inst-zz'))).toBe(true);
  });
  it("offTurnHolder: the off-turn scores read the holder's savingFor (a fresh holder's null scores Madani's install otherwise)", () => {
    const s = offTurnState();
    const scores = (saving: string | null) => {
      const ai = new HeuristicRunnerAI();
      (ai as unknown as { savingFor: string | null }).savingFor = saving;
      return asSide('runner', () => ai.runnerContext().offTurnRank(s)).map(x => x.score);
    };
    expect(scores('hq')).not.toEqual(scores(null));
  });
  it("oraclePlanner: the oracle's Runner with its planner off reads the given state and has no look-ahead", () => {
    const on = new HeuristicRunnerAI({}).runnerContext();
    const off = new HeuristicRunnerAI({ planner: false }).runnerContext();
    expect([on.view, !!on.lookahead]).toEqual(['dealt', true]);
    expect([off.view, !!off.lookahead]).toEqual(['given', false]);
  });
});

/**
 * Bar 2 (b), the coordinator's ruling of 2026-11-24 23:03Z: for a fault the lockstep's pools cannot show (the count arm,
 * core-faults.ts `count`, says why), a built state on which the fault does change a rank list, RECORDED ON THE BASE
 * (ff04f60, with base APIs only: rankMainActions, chooseOffTurn, knownCards, the agent's fields) and equal on the
 * branch, so the difference between callers the lockstep cannot see is held here. Each fault is simulated as in the
 * input tests above (the field it changes is set by hand).
 */
describe('bar 2 (b): a built state on which each unseen fault changes a rank list (recorded on the base)', () => {
  type Ranked = { action: GameAction; score: number }[];
  const listOf = (r: Ranked) => r.map(x => [JSON.stringify(x.action), x.score === -Infinity ? '-Inf' : +x.score.toFixed(6)]);
  /** Madani hosting a Cleaver: its install ability (1) costs no click, so the loop guard and the free-action floor read it. */
  const madaniBoard = () => {
    const [s, madani] = runnerInstall(newGame(), '35028');
    const id = giveCard(s, 'runner', '30006');
    const card = s.runner.grip.find(c => c.instanceId === id)!;
    s.runner.grip = s.runner.grip.filter(c => c !== card);
    findCardAnywhere(s, madani)!.hostedCards = [card];
    return s;
  };
  it("rolloutGuard: after 6 free plays at this click count, a rollout ranking with the decider's guard lifts the decider's free-action floor", () => {
    const s = madaniBoard();
    s.runner.credits = 9;
    const lists = (shared: boolean) => {
      const ai = new HeuristicRunnerAI();
      asSide('runner', () => ai.rankMainActions(s));
      for (let i = 0; i < 6; i++) ai.notePlayed({ type: 'USE_ABILITY', player: 'runner' } as GameAction);
      const rollout = new HeuristicRunnerAI({ planner: false });
      if (shared) (rollout as unknown as { freeActions: unknown }).freeActions = (ai as unknown as { freeActions: unknown }).freeActions;
      asSide('runner', () => rollout.rankMainActions({ ...s, runner: { ...s.runner, clicks: s.runner.clicks - 1 } }));
      return listOf(asSide('runner', () => ai.rankMainActions(s)));
    };
    const today = lists(false);
    check('bar2RolloutGuard', today);
    expect(lists(true)).not.toEqual(today);
  });
  it("replyMemory: a reply Runner's map carrying another sample's entry for an R&D card changes its rank list (runs.ts unseenTraps)", () => {
    const s = newGame(1);
    startRunnerTurn(s);
    installCorpForTest(s, '30045', 'remote-1', false);
    const trap = s.corp.rd.find(c => c.cardCode === '30061')!;
    const lists = (carried: boolean) => {
      const ai = new HeuristicRunnerAI({ planner: false });
      if (carried) ai.knownCards().set(trap.instanceId, trap.cardCode);
      return listOf(asSide('runner', () => ai.rankMainActions(s)));
    };
    const today = lists(false);
    check('bar2ReplyMemory', today);
    expect(lists(true)).not.toEqual(today);
  });
  it("offTurnHolder: the Normal Runner's off-turn scores with its holder's savingFor, against a fresh holder's", () => {
    const scores = (saving: string | null) => {
      const ai = new HeuristicRunnerAI();
      (ai as unknown as { savingFor: string | null }).savingFor = saving;
      const got: [string, number][] = [];
      const scoreMain = P.scoreMain;
      P.scoreMain = function (this: HeuristicRunnerAI, ...a: unknown[]) {
        const v = scoreMain.apply(this, a) as number;
        if (this === ai) got.push([JSON.stringify(a[1]), v]);
        return v;
      };
      let answer: GameAction | null | undefined;
      try {
        answer = ai.chooseOffTurn!(offTurnState());
      } finally {
        P.scoreMain = scoreMain;
      }
      return { answer: JSON.stringify(answer), list: got.map(([a, v]) => [a, v === -Infinity ? '-Inf' : +v.toFixed(6)]) };
    };
    const today = scores('hq');
    check('bar2OffTurnHolder', today);
    expect(scores(null).list).not.toEqual(today.list);
  });
});

// Recorded on the base (beta ff04f60) by this file with RECORD=1, unchanged since; reply's frozen 232 to 229 and remember 126 to 123 with F108
// (2026-11-25: a reply playout reaches a tagged board, where a Runner card is now priced at the untagged rate)
// B1b (2026-11-26): hardMain's live 45 to 44 and hardCorp's 55 to 54: the search's re-note after its look-ahead is gone
// (search.ts; the brief's N2: one frame per decision); the answers and every other count are unchanged
const RECORDED: Record<string, unknown> = {
  normalMain: {"answer": "{\"type\":\"GAIN_CREDIT\",\"player\":\"runner\"}", "live": 2, "frozen": 12, "byRole": {"decider": {"instances": 1, "remember": 1, "rank": 1, "start": 1, "played": 1}, "rollout": {"instances": 1, "remember": 0, "rank": 12, "start": 12, "played": 0}}},
  normalPrompt: {"answer": "{\"type\":\"RESOLVE_PROMPT\",\"player\":\"runner\",\"promptId\":\"prompt-3\",\"choice\":{\"kind\":\"discard\",\"cardInstanceIds\":[\"inst-43\",\"inst-50\",\"inst-42\",\"inst-55\"]}}", "live": 1, "frozen": 0, "byRole": {"decider": {"instances": 1, "remember": 1, "rank": 0, "start": 0, "played": 0}}},
  normalRun: {"answer": "{\"type\":\"CONTINUE_RUN\",\"player\":\"runner\"}", "live": 1, "frozen": 0, "byRole": {"decider": {"instances": 1, "remember": 1, "rank": 0, "start": 0, "played": 0}}},
  normalOff: {"answer": "{\"type\":\"USE_ABILITY\",\"player\":\"runner\",\"cardInstanceId\":\"inst-63\",\"abilityIndex\":1}", "live": 1, "frozen": 0, "byRole": {"decider": {"instances": 1, "remember": 1, "rank": 0, "start": 1, "played": 1}}},
  normalShare: {"answer": "{\"type\":\"USE_ABILITY\",\"player\":\"runner\",\"cardInstanceId\":\"inst-63\",\"abilityIndex\":0}", "live": 1, "frozen": 0, "byRole": {"decider": {"instances": 1, "remember": 1, "rank": 0, "start": 0, "played": 1}}},
  hardMain: {"answer": "{\"type\":\"INSTALL_CARD\",\"player\":\"runner\",\"cardInstanceId\":\"inst-46\"}", "live": 44, "frozen": 0, "byRole": {"base": {"instances": 1, "remember": 1, "rank": 1, "start": 1, "played": 1}, "playout": {"instances": 2, "remember": 18, "rank": 8, "start": 8, "played": 8}}},
  hardPrompt: {"answer": "{\"type\":\"RESOLVE_PROMPT\",\"player\":\"runner\",\"promptId\":\"prompt-3\",\"choice\":{\"kind\":\"discard\",\"cardInstanceIds\":[\"inst-43\",\"inst-50\",\"inst-42\",\"inst-55\"]}}", "live": 2, "frozen": 0, "byRole": {"base": {"instances": 1, "remember": 1, "rank": 0, "start": 0, "played": 0}}},
  hardRun: {"answer": "{\"type\":\"CONTINUE_RUN\",\"player\":\"runner\"}", "live": 2, "frozen": 0, "byRole": {"base": {"instances": 1, "remember": 1, "rank": 0, "start": 0, "played": 0}}},
  hardShare: {"answer": "{\"type\":\"USE_ABILITY\",\"player\":\"runner\",\"cardInstanceId\":\"inst-63\",\"abilityIndex\":0}", "live": 1, "frozen": 0, "byRole": {"base": {"instances": 1, "remember": 1, "rank": 0, "start": 0, "played": 0}}},
  hardOff: {"answer": "{\"type\":\"USE_ABILITY\",\"player\":\"runner\",\"cardInstanceId\":\"inst-63\",\"abilityIndex\":1}", "live": 1, "frozen": 0, "byRole": {"base": {"instances": 1, "remember": 1, "rank": 0, "start": 1, "played": 1}}},
  hardCorp: {"answer": "{\"type\":\"PLAY_OPERATION_OR_EVENT\",\"player\":\"corp\",\"cardInstanceId\":\"inst-14\"}", "live": 54, "frozen": 0, "byRole": {"playout": {"instances": 2, "remember": 28, "rank": 10, "start": 10, "played": 10}}},
  reply: {"answer": "{\"type\":\"INSTALL_CARD\",\"player\":\"corp\",\"cardInstanceId\":\"inst-13\",\"targetServerId\":\"rd\"}", "live": 2, "frozen": 229, "byRole": {"reply.plannerOff": {"instances": 10, "remember": 123, "rank": 50, "start": 50, "played": 50}}},
  oracle: {"answer": "{\"type\":\"INSTALL_CARD\",\"player\":\"corp\",\"cardInstanceId\":\"inst-13\",\"targetServerId\":\"rd\"}", "live": 61, "frozen": 239, "byRole": {"nested.plannerOff": {"instances": 16, "remember": 117, "rank": 92, "start": 92, "played": 49}, "nested.plannerOn": {"instances": 3, "remember": 37, "rank": 15, "start": 15, "played": 15}}},
  bar2RolloutGuard: [["{\"type\":\"INSTALL_CARD\",\"player\":\"runner\",\"cardInstanceId\":\"inst-46\"}",3.247935],["{\"type\":\"INITIATE_RUN\",\"player\":\"runner\",\"targetServerId\":\"hq\"}",2.36461],["{\"type\":\"INITIATE_RUN\",\"player\":\"runner\",\"targetServerId\":\"rd\"}",2.36461],["{\"type\":\"GAIN_CREDIT\",\"player\":\"runner\"}",-0.524186],["{\"type\":\"INSTALL_CARD\",\"player\":\"runner\",\"cardInstanceId\":\"inst-48\"}",-1.396076],["{\"type\":\"DRAW_CARD\",\"player\":\"runner\"}",-1.571263],["{\"type\":\"USE_ABILITY\",\"player\":\"runner\",\"cardInstanceId\":\"inst-63\",\"abilityIndex\":0}",-1.79539],["{\"type\":\"INSTALL_CARD\",\"player\":\"runner\",\"cardInstanceId\":\"inst-43\"}",-2.174497],["{\"type\":\"INSTALL_CARD\",\"player\":\"runner\",\"cardInstanceId\":\"inst-45\"}",-3.142751],["{\"type\":\"PLAY_OPERATION_OR_EVENT\",\"player\":\"runner\",\"cardInstanceId\":\"inst-50\"}",-4.689202],["{\"type\":\"USE_ABILITY\",\"player\":\"runner\",\"cardInstanceId\":\"inst-63\",\"abilityIndex\":1}","-Inf"],["{\"type\":\"INITIATE_RUN\",\"player\":\"runner\",\"targetServerId\":\"archives\"}","-Inf"]],
  bar2ReplyMemory: [["{\"type\":\"INSTALL_CARD\",\"player\":\"runner\",\"cardInstanceId\":\"inst-46\"}",4.485045],["{\"type\":\"INITIATE_RUN\",\"player\":\"runner\",\"targetServerId\":\"remote-1\"}",3.230573],["{\"type\":\"INITIATE_RUN\",\"player\":\"runner\",\"targetServerId\":\"hq\"}",1.991889],["{\"type\":\"INITIATE_RUN\",\"player\":\"runner\",\"targetServerId\":\"rd\"}",1.991889],["{\"type\":\"GAIN_CREDIT\",\"player\":\"runner\"}",-0.277551],["{\"type\":\"DRAW_CARD\",\"player\":\"runner\"}",-0.845008],["{\"type\":\"INSTALL_CARD\",\"player\":\"runner\",\"cardInstanceId\":\"inst-43\"}",-2.778999],["{\"type\":\"PLAY_OPERATION_OR_EVENT\",\"player\":\"runner\",\"cardInstanceId\":\"inst-50\"}",-2.982879],["{\"type\":\"INSTALL_CARD\",\"player\":\"runner\",\"cardInstanceId\":\"inst-48\"}",-3.211405],["{\"type\":\"INSTALL_CARD\",\"player\":\"runner\",\"cardInstanceId\":\"inst-45\"}",-3.651142],["{\"type\":\"INITIATE_RUN\",\"player\":\"runner\",\"targetServerId\":\"archives\"}","-Inf"]],
  bar2OffTurnHolder: {"answer":"{\"type\":\"USE_ABILITY\",\"player\":\"runner\",\"cardInstanceId\":\"inst-63\",\"abilityIndex\":1}","list":[["{\"type\":\"USE_ABILITY\",\"player\":\"runner\",\"cardInstanceId\":\"inst-63\",\"abilityIndex\":1}",1.229044]]},
};
function check(key: string, got: unknown) {
  if (process.env.RECORD) return void writeFileSync(`node_modules/.cache/runner-core-${key}.json`, JSON.stringify(got));
  expect(got).toEqual(RECORDED[key]);
}
