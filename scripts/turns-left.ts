/**
 * How many turns a game really has left (Jeff, 2026-11-05, thread "Find why AI card valuation misses cards"): the
 * payoff report showed cards staying installed 7.1 turns where turnsLeft (cardProfiles.ts) forecast 5.8. For each
 * side's turn start in self-play, the turns that side still got before the game ended, by the score at that moment.
 *
 *   SHARD=i/n npx vite-node scripts/turns-left.ts -- [games per pairing] > out.json
 *   node scripts/turns-left-sum.mjs out*.json
 * On GitHub Actions: AI batch, script turns-left. Decks and PLAN_OFF as in scripts/card-usage.ts.
 */
import { createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { IDENTITY_TEST_DECKS } from '../src/data/testDecks/identityDecks';
import { NRDB_TEST_DECKS } from './nrdb-test-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { tuning } from '../src/ai/synergy';
import { turnsLeft } from '../src/ai/cardProfiles';

for (const key of (process.env.PLAN_OFF ?? '').split(',').filter(Boolean)) {
  const [name, side] = key.split('.');
  const plan = tuning.plan as Record<string, unknown>;
  if (side) plan[name] = { ...(plan[name] as object), [side]: false };
  else plan[name] = false;
}
const games = Number(process.argv.slice(2).filter(a => a !== '--')[0] ?? 1);
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const prefixes = (process.env.DECKS ?? '').split(',').filter(Boolean);
const seen = new Set<string>();
const pool = [...ALL_DECKS, ...IDENTITY_TEST_DECKS, ...NRDB_TEST_DECKS].filter(d => !seen.has(d.id) && seen.add(d.id) && (prefixes.length === 0 || prefixes.some(p => d.id.startsWith(p))));

/** By key "side|corp score|runner score|own turn": [samples, sum of turns left, sum of turnsLeft's forecast, sum of squares of turns left]. */
const cells: Record<string, number[]> = {};
let played = 0, crashed = 0, unfinished = 0, seed = 9000, deal = 0;
for (const c of pool.filter(d => d.side === 'corp')) for (const r of pool.filter(d => d.side === 'runner')) for (let g = 0; g < games; g++) {
  seed++;
  if (deal++ % shards !== shard) continue;
  const gr = new GameRunner(createInitialGameState(deckGameSetup(seed, c, r)), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  const starts: { side: string; corp: number; runner: number; own: number; forecast: number }[] = [];
  const count = { corp: 0, runner: 0 };
  try {
    for (let steps = 0; steps < 4000 && gr.state.turnNumber <= 80; steps++) {
      const before = gr.state;
      if (!gr.step()) break;
      const after = gr.state;
      if (after.activePlayer !== before.activePlayer || steps === 0) {
        const side = after.activePlayer as 'corp' | 'runner';
        count[side]++;
        starts.push({ side, corp: after.corp.score, runner: after.runner.score, own: count[side], forecast: turnsLeft(after) });
      }
    }
  } catch (err) {
    crashed++;
    console.error(`deal ${seed}: ${err}`);
    continue;
  }
  if (!gr.state.winner) { unfinished++; continue; }
  played++;
  for (const s of starts) {
    const left = count[s.side as 'corp' | 'runner'] - s.own + 1; // this turn and the side's turns after it
    const key = `${s.side}|${s.corp}|${s.runner}|${Math.min(s.own, 20)}`;
    const cell = (cells[key] ??= [0, 0, 0, 0]);
    cell[0]++; cell[1] += left; cell[2] += s.forecast; cell[3] += left * left;
  }
}
console.log(JSON.stringify({ games: played, crashed, unfinished, cells }));
