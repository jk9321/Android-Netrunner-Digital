/**
 * Seed search for a fuzz invariant (R-109; required before the hand-off of an R-B brief that touches hidden-zone
 * knowledge, rework coordinator 2026-11-27). Plays random-move fuzz games (scripts/engine-fuzz-check.ts) on seeds
 * [from, to), each up to `steps` actions, and prints every game whose first failure is `check` (default
 * known-hidden-certain), plus any other failure. Tier 1's 40 games of 250 steps reach a rare path seldom (R-109: 26 of
 * 3,000 seeds hit it, 3 by step 250); 3,000 seeds of 3,000 steps take about 3.5 minutes on 4 cores, run as 4 shards:
 *
 *   for i in 0 1 2 3; do npx vite-node scripts/runner-rework/seed-search.ts -- $((1+i*750)) $((1+(i+1)*750)) 3000 > seek-$i.txt & done; wait
 *
 * Run it on the base and on the branch: the branch should show no hit and no new failure. A hit's seed, decks and step
 * go in tests/engineFuzz.test.ts as a fixed seed.
 */
import { FUZZ_CORPS, FUZZ_RUNNERS, fuzzEngineGame } from '../engine-fuzz-check';

const args = process.argv.slice(2).filter(a => a !== '--');
const [from, to, steps] = [Number(args[0] ?? 1), Number(args[1] ?? 751), Number(args[2] ?? 3000)];
const check = args[3] ?? 'known-hidden-certain';
const t0 = Date.now();
let hits = 0;
for (let seed = from; seed < to; seed++) {
  const corp = FUZZ_CORPS[seed % FUZZ_CORPS.length];
  const runner = FUZZ_RUNNERS[Math.floor(seed / FUZZ_CORPS.length) % FUZZ_RUNNERS.length];
  const res = fuzzEngineGame(seed, corp, runner, { maxSteps: steps });
  const f = res.failures[0];
  if (!f) continue;
  if (f.check === check) hits++;
  console.log(f.check === check ? 'HIT' : 'OTHER', seed, corp.id, runner.id, f.step, f.check, f.detail.split('\n')[0].slice(0, 200));
}
console.log(`done ${from}-${to - 1}: ${hits} hit ${check}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
