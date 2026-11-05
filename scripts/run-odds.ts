/**
 * Run odds against the model (Jeff, 2026-11-05, thread "Find why AI card valuation misses cards"): the payoff report
 * showed Runner cards forecast 2.5 times the successful HQ runs they saw. For every run in self-play: its server, the
 * model's pass odds when it started (effectValues.ts runSuccess) and whether it succeeded; and per Runner turn, the runs
 * made, next to PACE.runs and the PACE shares.
 *
 *   SHARD=i/n npx vite-node scripts/run-odds.ts -- [games per pairing] > out.json
 *   node scripts/run-odds-sum.mjs out*.json
 * On GitHub Actions: AI batch, script run-odds. Decks and PLAN_OFF as in scripts/card-usage.ts.
 */
import { createInitialGameState, GameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { IDENTITY_TEST_DECKS } from '../src/data/testDecks/identityDecks';
import { NRDB_TEST_DECKS } from './nrdb-test-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { asSide, tuning } from '../src/ai/synergy';
import { runSuccess } from '../src/ai/effectValues';

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

const kind = (id: string) => (id === 'hq' || id === 'rd' || id === 'archives' ? id : 'remote');
/** By server kind: [runs, forecast pass odds summed, successes]; also each server kind's odds at every Runner turn start (a run that wasn't made too). */
const runs: Record<string, number[]> = {};
const asked: Record<string, number[]> = {};
let turns = 0, played = 0, crashed = 0, seed = 9000, deal = 0;
for (const c of pool.filter(d => d.side === 'corp')) for (const r of pool.filter(d => d.side === 'runner')) for (let g = 0; g < games; g++) {
  seed++;
  if (deal++ % shards !== shard) continue;
  const gr = new GameRunner(createInitialGameState(deckGameSetup(seed, c, r)), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  // The run log (state.runsThisTurn) says which runs succeeded; a run can start and end in one step, so the odds are
  // noted as each run is logged and matched to the log when the turn passes
  let odds: number[] = [];
  const settle = (log: { server: string; successful: boolean }[]) => {
    log.forEach((run, i) => {
      const r2 = (runs[kind(run.server)] ??= [0, 0, 0]);
      r2[0]++; r2[1] += odds[i] ?? 0; r2[2] += run.successful ? 1 : 0;
    });
    odds = [];
  };
  try {
    for (let steps = 0; steps < 4000 && gr.state.turnNumber <= 80; steps++) {
      const before: GameState = gr.state;
      if (!gr.step()) break;
      const after = gr.state;
      if (after.activePlayer === 'runner' && before.activePlayer !== 'runner') {
        turns++;
        for (const id of ['hq', 'rd', 'archives']) { const a = (asked[id] ??= [0, 0]); a[0]++; a[1] += asSide('runner', () => runSuccess(after, id)); }
      }
      if (after.runsThisTurn.length < before.runsThisTurn.length) settle(before.runsThisTurn);
      else for (let i = before.runsThisTurn.length; i < after.runsThisTurn.length; i++) odds.push(asSide('runner', () => runSuccess(before, after.runsThisTurn[i].server)));
    }
    settle(gr.state.runsThisTurn);
  } catch (err) {
    crashed++;
    console.error(`deal ${seed}: ${err}`);
    continue;
  }
  played++;
}
console.log(JSON.stringify({ games: played, crashed, turns, runs, asked }));
