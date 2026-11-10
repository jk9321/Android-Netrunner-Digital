/**
 * The room fuzzer (multiplayer phase 2, chunk 2b): two scripted clients play
 * full games through the game server's room logic and every message they get
 * is checked (scripts/leak-check-room.ts: leak checks, the room's own rules,
 * persistence, and the twin check at the message level).
 *
 *   npx vite-node scripts/room-fuzz.ts -- [games] [seed] [random|ai|both]
 *
 * 'both' alternates random clients and AI clients. --wake also times whole
 * Durable Object wakes (load, move, save) on a copy. SHARD=i/n and SEEDS=a,b as
 * in leak-fuzz.ts. Exits 1 on any failure; prints message sizes, time per
 * move and the largest stored values at the end.
 */
import { fuzzRoomGame, roomPairing, summarize, type RoomFuzzResult } from './leak-check-room';

// --wake: also time a whole Durable Object wake per move on a copy (sampled), for the CPU budget
const wake = process.argv.includes('--wake');
const args = process.argv.slice(2).filter(a => a !== '--' && a !== '--wake');
const games = Number(args[0] ?? 20);
const seed0 = Number(args[1] ?? 9000);
const mode = (args[2] ?? 'both') as 'random' | 'ai' | 'both';
const only = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const results: RoomFuzzResult[] = [];
let failed = 0;
for (let g = 0; g < games; g++) {
  if (g % shards !== shard || (only.length > 0 && !only.includes(seed0 + g))) continue;
  const [c, r] = roomPairing(g);
  const players = mode === 'both' ? (g % 2 === 0 ? 'random' : 'ai') : mode;
  const res = fuzzRoomGame(seed0 + g, c, r, players, { wake });
  results.push(res);
  console.log(`${res.seed} ${players} ${res.format} ${res.corp} ${res.runner} ${res.moves} ${res.winner ?? '-'} ${res.failures.length === 0 ? 'ok' : `FAIL ${res.failures.length}`}`);
  for (const f of res.failures) console.log(`  step ${f.step} ${f.viewer} ${f.check}: ${f.detail}${f.path ? ` at ${f.path}` : ''}`);
  if (res.failures.length) failed++;
}
console.log(`${failed} of ${results.length} games failed`);
console.log(summarize(results));
process.exit(failed ? 1 : 0);
