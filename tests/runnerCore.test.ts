import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GameAction, GameState, activePrompt, createCardInstance, executeAction, findCardAnywhere } from '../src/core';
import { createAgent } from '../src/ai';
import { FreeActionGuard } from '../src/ai/agent';
import { HeuristicRunnerAI } from '../src/ai/runnerAI';
import { applyPlanOff, tuning } from '../src/ai/synergy';
import { asSide, plan, pricing } from '../src/ai/pricing';
import { giveCard, installIceForTest, installProgramForTest, newGame, passTurn, putInHand, runIntoFirstIce, runnerInstall, startRunnerTurn } from './helpers';

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
    decisionContext: (...a: Parameters<typeof m.decisionContext>) => {
      if (calls.pricing?.().frozen) calls.frozen++;
      else calls.live++;
      return m.decisionContext(...a);
    },
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
  // Red team finding 11 (a): scripts snapshot and cast the agent's own fields; they stay, under today's names
  it("keeps its own fields, under today's names, in today's order", () => {
    expect(Object.keys(new HeuristicRunnerAI())).toEqual(['side', 'freeActions', 'memory', 'digForBreakers', 'savingFor', 'synergy', 'debug', 'planner', 'planMemory']);
  });
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

// Recorded on the base (beta ff04f60) by this file with RECORD=1, unchanged since
const RECORDED: Record<string, unknown> = {
  normalMain: {"answer": "{\"type\":\"GAIN_CREDIT\",\"player\":\"runner\"}", "live": 2, "frozen": 12, "byRole": {"decider": {"instances": 1, "remember": 1, "rank": 1, "start": 1, "played": 1}, "rollout": {"instances": 1, "remember": 0, "rank": 12, "start": 12, "played": 0}}},
  normalPrompt: {"answer": "{\"type\":\"RESOLVE_PROMPT\",\"player\":\"runner\",\"promptId\":\"prompt-3\",\"choice\":{\"kind\":\"discard\",\"cardInstanceIds\":[\"inst-43\",\"inst-50\",\"inst-42\",\"inst-55\"]}}", "live": 1, "frozen": 0, "byRole": {"decider": {"instances": 1, "remember": 1, "rank": 0, "start": 0, "played": 0}}},
  normalRun: {"answer": "{\"type\":\"CONTINUE_RUN\",\"player\":\"runner\"}", "live": 1, "frozen": 0, "byRole": {"decider": {"instances": 1, "remember": 1, "rank": 0, "start": 0, "played": 0}}},
  normalOff: {"answer": "{\"type\":\"USE_ABILITY\",\"player\":\"runner\",\"cardInstanceId\":\"inst-63\",\"abilityIndex\":1}", "live": 1, "frozen": 0, "byRole": {"decider": {"instances": 1, "remember": 1, "rank": 0, "start": 1, "played": 1}}},
  normalShare: {"answer": "{\"type\":\"USE_ABILITY\",\"player\":\"runner\",\"cardInstanceId\":\"inst-63\",\"abilityIndex\":0}", "live": 1, "frozen": 0, "byRole": {"decider": {"instances": 1, "remember": 1, "rank": 0, "start": 0, "played": 1}}},
  hardMain: {"answer": "{\"type\":\"INSTALL_CARD\",\"player\":\"runner\",\"cardInstanceId\":\"inst-46\"}", "live": 45, "frozen": 0, "byRole": {"base": {"instances": 1, "remember": 1, "rank": 1, "start": 1, "played": 1}, "playout": {"instances": 2, "remember": 18, "rank": 8, "start": 8, "played": 8}}},
  hardPrompt: {"answer": "{\"type\":\"RESOLVE_PROMPT\",\"player\":\"runner\",\"promptId\":\"prompt-3\",\"choice\":{\"kind\":\"discard\",\"cardInstanceIds\":[\"inst-43\",\"inst-50\",\"inst-42\",\"inst-55\"]}}", "live": 2, "frozen": 0, "byRole": {"base": {"instances": 1, "remember": 1, "rank": 0, "start": 0, "played": 0}}},
  hardRun: {"answer": "{\"type\":\"CONTINUE_RUN\",\"player\":\"runner\"}", "live": 2, "frozen": 0, "byRole": {"base": {"instances": 1, "remember": 1, "rank": 0, "start": 0, "played": 0}}},
  hardShare: {"answer": "{\"type\":\"USE_ABILITY\",\"player\":\"runner\",\"cardInstanceId\":\"inst-63\",\"abilityIndex\":0}", "live": 1, "frozen": 0, "byRole": {"base": {"instances": 1, "remember": 1, "rank": 0, "start": 0, "played": 0}}},
  hardOff: {"answer": "{\"type\":\"USE_ABILITY\",\"player\":\"runner\",\"cardInstanceId\":\"inst-63\",\"abilityIndex\":1}", "live": 1, "frozen": 0, "byRole": {"base": {"instances": 1, "remember": 1, "rank": 0, "start": 1, "played": 1}}},
  hardCorp: {"answer": "{\"type\":\"PLAY_OPERATION_OR_EVENT\",\"player\":\"corp\",\"cardInstanceId\":\"inst-14\"}", "live": 55, "frozen": 0, "byRole": {"playout": {"instances": 2, "remember": 28, "rank": 10, "start": 10, "played": 10}}},
  reply: {"answer": "{\"type\":\"INSTALL_CARD\",\"player\":\"corp\",\"cardInstanceId\":\"inst-13\",\"targetServerId\":\"rd\"}", "live": 2, "frozen": 232, "byRole": {"reply.plannerOff": {"instances": 10, "remember": 126, "rank": 50, "start": 50, "played": 50}}},
  oracle: {"answer": "{\"type\":\"INSTALL_CARD\",\"player\":\"corp\",\"cardInstanceId\":\"inst-13\",\"targetServerId\":\"rd\"}", "live": 61, "frozen": 239, "byRole": {"nested.plannerOff": {"instances": 16, "remember": 117, "rank": 92, "start": 92, "played": 49}, "nested.plannerOn": {"instances": 3, "remember": 37, "rank": 15, "start": 15, "played": 15}}},
};
function check(key: string, got: unknown) {
  if (process.env.RECORD) return void writeFileSync(`node_modules/.cache/runner-core-${key}.json`, JSON.stringify(got));
  expect(got).toEqual(RECORDED[key]);
}
