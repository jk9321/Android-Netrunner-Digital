/**
 * Leak fuzzer (multiplayer phase 1): plays games and checks after every
 * action that neither player's view (src/core/view.ts) holds anything that
 * side may not see. Checks in scripts/leak-check.ts.
 *
 *   npx vite-node scripts/leak-fuzz.ts -- [games] [seed] [ai|random|both] [--recon]
 *
 * Games walk the deck pairings like same-seed.ts, over every test deck
 * (starters, NSG samples, NRDB lists, one per identity). 'both' alternates AI
 * self-play (the shipped normal AI) and random legal moves. SHARD=i/n plays
 * every n-th game starting at i; SEEDS=a,b plays only those seeds. Prints one line per game and every failure
 * with its step, viewer, check and the JSON path where it appeared; exits 1
 * on any failure.
 */
import { ALL_DECKS } from './nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../src/data/testDecks/nrdb';
import { IDENTITY_TEST_DECKS } from '../src/data/testDecks/identityDecks';
import { fuzzGame } from './leak-check';

const args = process.argv.slice(2).filter(a => a !== '--');
// --recon adds the chunk 2 checks (the screen's reconstructions and seats, leak-check-recon.ts)
const recon = args.includes('--recon');
const [gamesArg, seedArg, playersArg] = args.filter(a => a !== '--recon');
const games = Number(gamesArg ?? 20);
const seed0 = Number(seedArg ?? 9000);
const mode = (playersArg ?? 'both') as 'ai' | 'random' | 'both';
const only = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);

// Every deck we have, so every set's cards (and their log lines) get played
const pool = [...new Map([...ALL_DECKS, ...NRDB_TEST_DECKS, ...IDENTITY_TEST_DECKS].map(d => [d.id, d])).values()];
const corps = pool.filter(d => d.side === 'corp');
const runners = pool.filter(d => d.side === 'runner');
let failed = 0;
let steps = 0;
let probes = 0;
let shapes = 0;
let disagreements = 0;
for (let g = 0; g < games; g++) {
  if (g % shards !== shard || (only.length > 0 && !only.includes(seed0 + g))) continue;
  const c = corps[(g * 7) % corps.length];
  const r = runners[(g * 5 + 3) % runners.length];
  const players = mode === 'both' ? (g % 2 === 0 ? 'ai' : 'random') : mode;
  const res = fuzzGame(seed0 + g, c, r, players, players === 'ai' ? 4000 : 1500, recon);
  steps += res.steps;
  probes += res.stats.probes;
  shapes += res.stats.uiShapes;
  for (const d of res.stats.probeDisagreements) console.log(`  probe disagreement: ${d}`);
  disagreements += res.stats.probeDisagreements.length;
  console.log(`${res.seed} ${players} ${res.corp} ${res.runner} ${res.steps} ${res.winner ?? '-'} ${res.failures.length === 0 ? 'ok' : `FAIL ${res.failures.length}`}`);
  for (const f of res.failures) console.log(`  step ${f.step} ${f.viewer} ${f.check}: ${f.detail}${f.path ? ` at ${f.path}` : ''}`);
  if (res.failures.length) failed++;
}
console.log(`${failed} of ${Math.ceil((games - shard) / shards)} games failed; ${steps} steps checked`);
if (recon) console.log(`recon: ${shapes} screen actions compared, ${probes} own-side probes, ${disagreements} probe disagreements`);
process.exit(failed ? 1 : 0);
