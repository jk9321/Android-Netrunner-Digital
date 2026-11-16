/**
 * Item 4 diagnostics (plan.plannerSearch): plays a few self-play games and prints how often the order's agenda and build
 * slots were among the planner's candidates and how often they won, with the time per Corp and Runner decision.
 *
 *   PLAN_OFF=+plannerSearch npx vite-node scripts/planner-stats.ts -- [games] [normal|hard]
 */
import { actingSide, createInitialGameState } from '../src/core';
import { GameRunner } from '../src/ai/playout';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { applyPlanOff } from '../src/ai/synergy';
import { installDiagnostics } from '../src/ai/diagnostics';
const diag = installDiagnostics();

const [gamesArg, levelArg] = process.argv.slice(2).filter(a => a !== '--');
const games = Number(gamesArg ?? 4);
const level = (levelArg ?? 'normal') as 'normal' | 'hard';
applyPlanOff(process.env.PLAN_OFF ?? '');
const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const time = { corp: { ms: 0, n: 0, max: 0 }, runner: { ms: 0, n: 0, max: 0 } };
let corpWins = 0;
for (let g = 0; g < games; g++) {
  const seed = 5000 + g;
  const c = corpDecks[g % corpDecks.length];
  const r = runnerDecks[(g * 7) % runnerDecks.length];
  const agents = { corp: createAgent('corp', level, level === 'hard' ? { samples: 6, candidates: 3, seed } : {}), runner: createAgent('runner', level, level === 'hard' ? { samples: 6, candidates: 3, seed } : {}) };
  const gr = new GameRunner(createInitialGameState(deckGameSetup(seed, c, r)), agents);
  for (let i = 0; i < 6000 && !gr.state.winner; i++) {
    const side = actingSide(gr.state);
    if (!side) break;
    const t = Date.now();
    if (!gr.step()) break;
    const ms = Date.now() - t;
    time[side].ms += ms;
    time[side].n++;
    time[side].max = Math.max(time[side].max, ms);
  }
  const s = gr.state;
  if (s.winner === 'corp') corpWins++;
}
// The planner's own builders and their added/addedWins counts went with the ranking (Step 4 Stage C7): the order's two slots
const stats = { decisions: diag.planner.decisions, agendaSlot: diag.planner.agendaSlot, agendaSlotWins: diag.planner.agendaSlotWins, buildSlot: diag.planner.buildSlot, buildSlotWins: diag.planner.buildSlotWins };
console.log(JSON.stringify({ games, corpWins, ...stats, corpMs: +(time.corp.ms / time.corp.n).toFixed(1), corpMax: time.corp.max, runnerMs: +(time.runner.ms / time.runner.n).toFixed(1), runnerMax: time.runner.max }));
