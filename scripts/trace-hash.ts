/**
 * Same-seed trace hashes, to prove a refactor changes no play (typed card prompts, file splits).
 * Plays fixed-seed games (random legal moves on every deck, plus Normal AI games) and prints one hash per
 * game of every action taken and the last state, then one hash of them all. Run it before and after the
 * change: the totals must match.
 *
 *   npx vite-node scripts/trace-hash.ts -- [randomGames=400] [aiGames=24] [--list]
 */
import { createHash } from 'node:crypto';
import { fuzzEngineGame, pairing } from './engine-fuzz-check';

const args = process.argv.slice(2).filter(a => a !== '--');
const nums = args.filter(a => /^\d+$/.test(a)).map(Number);
const randomGames = nums[0] ?? 400;
const aiGames = nums[1] ?? 24;
const list = args.includes('--list');

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const all = createHash('sha256');
const games: [string, number, 'random' | 'ai', number][] = [];
for (let g = 0; g < randomGames; g++) games.push([`r${g}`, 9000 + g, 'random', 400]);
for (let g = 0; g < aiGames; g++) games.push([`a${g}`, 7000 + g, 'ai', 2500]);

const start = Date.now();
for (const [name, seed, players, maxSteps] of games) {
  const { corp, runner } = pairing(Number(name.slice(1)));
  const res = fuzzEngineGame(seed, corp, runner, { maxSteps, players, keepState: true, stopAtFirst: false });
  const h = sha(JSON.stringify(res.actions) + JSON.stringify(res.finalState));
  all.update(h);
  if (list) console.log(`${name} seed ${seed} ${corp.id} vs ${runner.id}: ${res.steps} steps, ${h}${res.failures.length ? ` (${res.failures.length} failures)` : ''}`);
}
console.log(`${games.length} games (${randomGames} random, ${aiGames} AI) in ${((Date.now() - start) / 1000).toFixed(0)} s: ${all.digest('hex').slice(0, 16)}`);
