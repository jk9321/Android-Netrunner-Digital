/**
 * Engine-invariant fuzzer, long runs (tiers 2 and 3; tier 1 is tests/engineFuzz.test.ts).
 * Checks in scripts/engine-fuzz-check.ts.
 *
 *   npx vite-node scripts/engine-fuzz.ts -- [--games N] [--seed S] [--minutes M] [--steps K] [--ai A] [--out DIR]
 *
 * Plays game g = 0, 1, 2, ... with seed S + g on pairing(g) (every deck, both sides) until N games or M minutes,
 * whichever comes first. --ai A makes every A-th game the Normal AI on both sides instead of random moves. SHARD=i/n plays every n-th game starting at i (the deep run's parallel jobs).
 * Each failing game is written to DIR/fail-<seed>.json (seed, decks, stops, broken invariant, action list),
 * which scripts/engine-fuzz-replay.ts reproduces. Exits 1 on any failure.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FUZZ_CORPS, FUZZ_RUNNERS, fuzzEngineGame, pairing, summaryLine } from './engine-fuzz-check';

const args = process.argv.slice(2).filter(a => a !== '--');
const opt = (name: string, dflt: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : 'engine-fuzz-out';
const games = opt('games', 1e9);
const seed0 = opt('seed', 1);
const minutes = opt('minutes', games === 1e9 ? 10 : 1e9);
const maxSteps = opt('steps', 1500);
// --ai N: every N-th game is the Normal AI on both sides (0 = never); it reaches deeper states but plays slower
const aiEvery = opt('ai', 0);
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);

const deadline = Date.now() + minutes * 60_000;
console.log(`engine fuzz: ${FUZZ_CORPS.length} Corp and ${FUZZ_RUNNERS.length} Runner decks, seeds from ${seed0}, shard ${shard}/${shards}, up to ${minutes === 1e9 ? '-' : minutes} min`);
let played = 0;
let failed = 0;
let steps = 0;
let checks = 0;
const byCheck = new Map<string, number>();
for (let g = shard; g < games && Date.now() < deadline; g += shards) {
  const { corp, runner } = pairing(g);
  const players = aiEvery > 0 && g % aiEvery === aiEvery - 1 ? 'ai' : 'random';
  const res = fuzzEngineGame(seed0 + g, corp, runner, { maxSteps: players === 'ai' ? Math.max(maxSteps, 4000) : maxSteps, players });
  played++;
  steps += res.steps;
  checks += res.checks;
  if (res.failures.length) {
    failed++;
    const f = res.failures[0];
    byCheck.set(f.check, (byCheck.get(f.check) ?? 0) + 1);
    console.log(summaryLine(res));
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, `fail-${res.seed}.json`), JSON.stringify({ ...res, failures: res.failures.slice(0, 20) }, null, 1));
  } else if (played % 50 === 0) console.log(`  ${played} games, ${steps} steps, ${failed} failed`);
}
console.log(`${failed} of ${played} games failed; ${steps} actions, ${checks} invariant checks`);
for (const [c, n] of [...byCheck].sort((a, b) => b[1] - a[1])) console.log(`  ${c}: ${n}`);
process.exit(failed ? 1 : 0);
