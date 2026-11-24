/**
 * Issues #67 and #68 (Runner rework R-B, tracker R-27; brief runner-rework/briefs/i67-i68-pins-count.md). Measurement only.
 * Usage: npx vite-node scripts/runner-rework/issues-67-68.ts
 *
 * Part 1: both saved games replay on beta move for move (0 engine errors, the recorded log length).
 * Part 3: issue #67 at T8 move 130: what the Runner's turn planner counted for the run on Remote 1, against the flat ranking,
 * the access answer, and the same Runner with the planner off.
 * Part 2's pins are tests/runnerIssues67to68.test.ts; Part 4's count is scripts/runner-rework/host-prompts.ts.
 *
 * Hidden reads (the measuring script only; no AI below is handed anything it would not see, rule 10.2.2a): the card titles
 * printed for the Corp's root and ice (marked HIDDEN READ) say what was true. The planner's playouts are run on the
 * Runner's own decision view (runnerDecisionView with its memory), exactly as planTurn builds it.
 */
import { readFileSync } from 'node:fs';
import { GameAction, GameState, activePrompt, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { createAgent } from '../../src/ai';
import { HeuristicRunnerAI } from '../../src/ai/runnerAI';
import { PLANNER, Line, decisionSeedFor, playout, runnerDecisionView, PlannerAI } from '../../src/ai/turnPlanner';
import { creditCost, runClick, runCreditSpend, runScore, serverValue } from '../../src/ai/runs';
import { corpCardValue } from '../../src/ai/evaluate';
import { answerPrompt, runEventOptions, scoreOutcome, simulate } from '../../src/ai/prompts';
import { asSide, tuning } from '../../src/ai/synergy';
import { withPricing } from '../../src/ai/pricing';
import { installDiagnostics } from '../../src/ai/diagnostics';
import { GameRunner } from '../../src/ai/playout';

interface Saved {
  config: { seed: number; corpDeck: never; runnerDeck: never };
  startStops?: GameState['stops'];
  moves: GameAction[];
  endLogLength: number;
}
const load = (n: number): Saved => JSON.parse(readFileSync(new URL(`../../tests/fixtures/runner-issues/issue-${n}.json`, import.meta.url), 'utf8'));
const r3 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x);
const start = (d: Saved) => {
  const s = createInitialGameState(deckGameSetup(d.config.seed, d.config.corpDeck, d.config.runnerDeck));
  return d.startStops ? { ...s, stops: d.startStops } : s;
};
const titleOf = (s: GameState, a: GameAction): string => {
  const id = (a as { cardInstanceId?: string }).cardInstanceId;
  const c = id ? findCardAnywhere(s, id) : undefined;
  return c ? cardDef(c).title : '';
};
const show = (s: GameState, a: GameAction): string =>
  [a.type, (a as { targetServerId?: string }).targetServerId ?? '', titleOf(s, a), a.type === 'RESOLVE_PROMPT' ? JSON.stringify(a.choice) : ''].filter(Boolean).join(' ');

// ------------------------------------------------------------------------------------------------ Part 1
console.log('== Part 1: replay');
for (const n of [67, 68]) {
  const d = load(n);
  let s = start(d);
  let errors = 0;
  for (const move of d.moves) {
    try {
      s = executeAction(s, move);
    } catch (e) {
      errors++;
      console.log(`  #${n} engine error at a move: ${(e as Error).message}`);
    }
  }
  console.log(`  #${n}: ${d.moves.length} moves, ${errors} engine errors, log length ${s.log.length} (recorded ${d.endLogLength}) ${s.log.length === d.endLogLength && errors === 0 ? 'OK' : 'MISMATCH'}`);
}

// ------------------------------------------------------------------------------------------------ Part 3
console.log('\n== Part 3: #67 at T8, move 130');
const d = load(67);
let s = start(d);
const runner = createAgent('runner', 'normal') as HeuristicRunnerAI;
const AT = 130;
for (let i = 0; i < AT; i++) {
  runner.observe(s);
  s = executeAction(s, d.moves[i]);
}
runner.observe(s);
const board = s;
const memory = new Map(runner.knownCards());
console.log(`  board: T${board.turnNumber} clicks ${board.runner.clicks} credits ${board.runner.credits} tags ${board.runner.tags}; recorded move ${AT}: ${show(board, d.moves[AT])}`);
console.log('  recorded rest of T8:', d.moves.slice(AT).filter((_, k) => k < 40).map((m, k) => `${AT + k}:${m.player}:${m.type}${(m as { targetServerId?: string }).targetServerId ? ' ' + (m as { targetServerId?: string }).targetServerId : ''}${m.type === 'RESOLVE_PROMPT' ? ' ' + JSON.stringify(m.choice) : ''}`).join(' | '));

// The decision as the live agent makes it, with the diagnostics sink recording the planner's candidates and their values
const sink = installDiagnostics();
let seen: { values: number[]; actions: GameAction[] } | null = null;
sink.onCandidates = (side, values, actions) => {
  if (side === 'runner' && !seen) seen = { values, actions };
};
const probe = createAgent('runner', 'normal') as HeuristicRunnerAI;
{
  // A second copy of the same Runner (same memory, empty plan), so the live `runner` is left as it was for the forward play
  let t = start(d);
  for (let i = 0; i < AT; i++) {
    probe.observe(t);
    t = executeAction(t, d.moves[i]);
  }
  probe.observe(t);
}
const live = probe.chooseAction(structuredClone(board));
console.log(`  live agent plays: ${show(board, live)}`);
const flat = runner.rankMainActions(structuredClone(board));
console.log('  flat ranking (rankMainActions, best first):');
flat.slice(0, 8).forEach((r, k) => console.log(`    ${k + 1}. ${r.score === -Infinity ? '-Inf' : r.score.toFixed(3)} ${show(board, r.action)}`));
if (seen) {
  const got = seen as { values: number[]; actions: GameAction[] };
  console.log(`  planner candidates (the first ${PLANNER.candidates} of the flat ranking; diagnostics onCandidates, as played):`);
  got.actions.forEach((a, k) => console.log(`    ${show(board, a)}: ${r3(got.values[k])}`));
} else console.log('  planner did not run at this decision (no onCandidates)');

// The same playouts, rebuilt as runnerAI.ts plan() builds them (runnerAI.ts:226-236), to read each line and its run bonus
asSide('runner', () => {
  const rollout = new HeuristicRunnerAI({ synergy: true, planner: false });
  (rollout as unknown as { memory: Map<string, string> }).memory = new Map(memory);
  const options = { memory, wary: tuning.wary };
  const runs: { server: string; worth: number; credits: number; click: number }[] = [];
  const ai: PlannerAI = {
    rank: x => rollout.rankMainActions(x),
    answer: x => rollout.chooseAction(x),
    runWorth: (x, id, code) => {
      const w = runScore(x, id, code ? { ...runEventOptions(code, x), ...options } : options);
      runs.push({ server: id, worth: w, credits: 0, click: runClick(x) });
      return w;
    },
    runCredits: (x, id, code) => {
      const c = runCreditSpend(x, id, code ? runEventOptions(code, x) : {});
      if (runs.length) runs[runs.length - 1].credits = c;
      return c;
    },
    memory: { line: [] },
    known: memory,
  };
  const candidates = flat.filter(r => r.score > -Infinity && r.action.type !== 'END_TURN').slice(0, PLANNER.candidates);
  const seed = decisionSeedFor(board, 'runner');
  withPricing({ frozen: true, decisionSeed: seed }, () => {
    const root = runnerDecisionView(board, memory);
    console.log('  playouts rebuilt (value = leaf evaluate at the end of the turn + run bonus; bonus = runWorth + runClick, run not played out):');
    for (const c of candidates) {
      runs.length = 0;
      const line: Line = [];
      const ends: { state?: GameState; bonus?: number } = {};
      const value = playout(root, 'runner', c.action, ai, line, ends);
      const leaf = value - (ends.bonus ?? 0);
      console.log(`    first ${show(board, c.action)}: value ${r3(value)} = leaf ${r3(leaf)} + bonus ${r3(ends.bonus ?? 0)}`);
      console.log(`      line after it: ${line.map(l => show(root, l.action)).join(' -> ') || '(none recorded; a line after a run is not recorded, turnPlanner.ts:256)'}`);
      for (const r of runs) console.log(`      run ${r.server}: runWorth ${r3(r.worth)}, runClick ${r3(r.click)}, credits it expects to spend ${r3(r.credits)}`);
      if (ends.state) {
        const e = ends.state;
        console.log(`      end of turn: clicks ${e.runner.clicks} credits ${e.runner.credits} grip ${e.runner.grip.map(x => cardDef(x).title).join(', ')} | rig ${[...e.runner.rig.programs, ...e.runner.rig.hardware, ...e.runner.rig.resources].map(x => cardDef(x).title).join(', ')}`);
        console.log(`      playout log: ${e.log.slice(root.log.length).map(x => (typeof x === 'string' ? x : (x as { text?: string; message?: string }).text ?? (x as { message?: string }).message ?? JSON.stringify(x))).join(' / ')}`);
      }
    }
  });
  const b1001 = board.corp.servers['remote-1'].root[0]; // HIDDEN READ? no: rezzed and known to the Runner (memory has it)
  console.log(`  remote-1 root: ${cardDef(b1001).title} rezzed ${b1001.isRezzed} in memory ${memory.has(b1001.instanceId)}; trash cost ${cardDef(b1001).trash_cost}; corpCardValue(left) ${r3(corpCardValue(b1001, board, 'runner', true))}; creditCost(3) ${r3(creditCost(board, 3))}; serverWorth's rezzed-card term max(0.5, value - creditCost) = ${r3(Math.max(0.5, corpCardValue(b1001, board, 'runner', true) - creditCost(board, 3)))} (runs.ts:1174)`);
  console.log(`  spendCost(1) on the board: ${r3(creditCost(board, 1))} (the R&D run's credit, inside runWorth), and the same credit again in the leaf through runCredits (turnPlanner.ts:210-211)`);
  console.log(`  runScore pieces on the real board: remote-1 runScore ${r3(runScore(board, 'remote-1', options))}, serverValue ${r3(serverValue(board, 'remote-1', 0, memory))}, runClick ${r3(runClick(board))}, runCreditSpend ${r3(runCreditSpend(board, 'remote-1'))}`);
});

// The rollout's answer at the access prompt against the live answer: play the recorded game to move 138 (the access) and ask both
{
  let t = board;
  const watcher = createAgent('runner', 'normal') as HeuristicRunnerAI;
  let u = start(d);
  for (let i = 0; i < d.moves.length; i++) {
    watcher.observe(u);
    const p = activePrompt(u);
    if (i >= AT && p?.kind === 'access_trash') {
      t = u;
      break;
    }
    u = executeAction(u, d.moves[i]);
  }
  const p = activePrompt(t)!;
  const mem = new Map(watcher.knownCards());
  const rollout = new HeuristicRunnerAI({ synergy: true, planner: false });
  (rollout as unknown as { memory: Map<string, string> }).memory = new Map(mem);
  asSide('runner', () => {
    for (const trash of [true, false]) {
      const act = { type: 'RESOLVE_PROMPT', player: 'runner', promptId: p.id, choice: { kind: 'access_trash', trash } } as GameAction;
      const after = simulate(t, act);
      console.log(`  access prompt (${(p as { message?: string }).message}) scoreOutcome trash=${trash}: ${after ? scoreOutcome(t, after, 'runner', mem, true).toFixed(4) : 'illegal'}`);
    }
    console.log(`  answerPrompt (live, synergy on): ${JSON.stringify((answerPrompt(t, 'runner', mem, true) as { choice?: unknown }).choice)}`);
  });
  console.log(`  rollout copy (planner off) answers: ${JSON.stringify((rollout.chooseAction(structuredClone(t)) as { choice?: unknown }).choice)}; live agent answers: ${JSON.stringify((watcher.chooseAction(structuredClone(t)) as { choice?: unknown }).choice)}`);
}

// The same Runner with the planner off: its pick at move 130, and the turn played forward by GameRunner with a Normal Corp
{
  const off = new HeuristicRunnerAI({ synergy: true, planner: false });
  (off as unknown as { memory: Map<string, string> }).memory = new Map(memory);
  console.log(`  planner off, pick at move 130: ${show(board, off.chooseAction(structuredClone(board)))}`);
  for (const [name, agent] of [['planner on (as played)', runner], ['planner off', off]] as const) {
    const g = new GameRunner(structuredClone(board), { runner: agent, corp: createAgent('corp', 'normal') });
    const acts: string[] = [];
    for (let k = 0; k < 400 && g.state.turnNumber === board.turnNumber && !g.state.winner; k++) {
      const before = g.state;
      g.step();
      if (g.last?.player === 'runner') acts.push(show(before, g.last));
    }
    console.log(`  T8 played forward, ${name}: ${acts.join(' | ')}`);
  }
}
