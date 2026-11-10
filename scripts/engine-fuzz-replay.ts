/**
 * Reproduces one engine-fuzz game (scripts/engine-fuzz-check.ts) and prints what led to its first failure.
 *
 *   npx vite-node scripts/engine-fuzz-replay.ts -- fail-1234.json [--tail N] [--log N]
 *   npx vite-node scripts/engine-fuzz-replay.ts -- --seed 1234 --corp <deck id> --runner <deck id>
 *
 * Replays the game from its seed (the deal, the stops and the moves all come from it) and checks that the
 * saved action list, if given, is the one taken again (the engine must be deterministic). Prints the last
 * N actions (default 12; an AI game is replayed from its saved actions) and the last N log lines (default 25) before the failure. Exits 1 if it still fails.
 */
import { readFileSync } from 'node:fs';
import { FUZZ_DECKS, fuzzEngineGame, summaryLine, type EngineFuzzResult } from './engine-fuzz-check';
import { createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';

const args = process.argv.slice(2).filter(a => a !== '--');
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find(a => a.endsWith('.json'));
const saved: Partial<EngineFuzzResult> = file ? JSON.parse(readFileSync(file, 'utf8')) : {};
const seed = Number(opt('seed') ?? saved.seed);
const corpId = opt('corp') ?? saved.corp;
const runnerId = opt('runner') ?? saved.runner;
const tail = Number(opt('tail') ?? 12);
const logLines = Number(opt('log') ?? 25);
const deck = (id: string | undefined) => {
  const d = FUZZ_DECKS.find(x => x.id === id);
  if (!d) throw new Error(`Unknown deck ${id}`);
  return d;
};
if (!Number.isFinite(seed)) throw new Error('Give a fail-<seed>.json file or --seed, --corp and --runner');

// An AI game is replayed from its saved actions (the AI is not re-run); a random game from its seed alone
const ai = saved.players === 'ai';
if (ai && !saved.actions) throw new Error('An AI game needs its saved action list');
const res = fuzzEngineGame(seed, deck(corpId), deck(runnerId), { maxSteps: Number(opt('steps') ?? (ai ? saved.actions!.length : 1500)), ...(ai ? { actions: saved.actions, stops: saved.stops } : {}) });
console.log(summaryLine(res));
if (saved.actions && !ai) {
  const same = JSON.stringify(saved.actions) === JSON.stringify(res.actions);
  console.log(same ? 'saved action list taken again: the engine is deterministic' : 'WARNING: the replay took different actions than the saved list (nondeterminism, or the engine changed since)');
}
const f = res.failures[0];
if (!f) {
  console.log('no failure now: fixed, or the engine changed since the save');
  process.exit(0);
}
for (const x of res.failures) console.log(`  step ${x.step} ${x.check} (rule ${x.rule}): ${x.detail}`);
console.log(`\nlast ${tail} actions:`);
res.actions.slice(Math.max(0, f.step - tail), f.step).forEach((a, i) => console.log(`  ${f.step - Math.min(tail, f.step) + i + 1}: ${JSON.stringify(a)}`));

// Re-run the actions to show the log and state at the failure
let state = { ...createInitialGameState(deckGameSetup(seed, deck(corpId), deck(runnerId))), stops: res.stops };
let before = state;
for (let i = 0; i < f.step; i++) {
  before = state;
  try {
    state = executeAction(state, res.actions[i]);
  } catch {
    break;
  }
}
console.log(`\nlast ${logLines} log lines:`);
for (const e of state.log.slice(-logLines)) console.log(`  [t${e.turnNumber} ${e.player}] ${e.message}`);
const brief = (s: typeof state) => ({
  turn: s.turnNumber,
  active: s.activePlayer,
  phase: s.phase,
  turnStep: s.turnStep,
  priority: s.priority,
  prompts: s.pendingPrompts.map(p => `${p.side} ${p.kind}: ${p.message}`),
  run: s.activeRun && { server: s.activeRun.server, phase: s.activeRun.phase, icePosition: s.activeRun.icePosition, successful: s.activeRun.isSuccessful },
  corp: { credits: s.corp.credits, clicks: s.corp.clicks, hq: s.corp.hq.length, hand: s.corp.handSizeLimit },
  runner: { credits: s.runner.credits, clicks: s.runner.clicks, grip: s.runner.grip.length, hand: s.runner.handSizeLimit, mu: `${s.runner.memoryUnitsUsed}/${s.runner.memoryUnitsTotal}` },
});
console.log('\nbefore the failing action:', JSON.stringify(brief(before), null, 1));
console.log('after:', JSON.stringify(brief(state), null, 1));
process.exit(1);
