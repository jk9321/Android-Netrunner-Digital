/**
 * Spec-search S2 diagnostics (plan.searchLines): plays self-play games with the switch on and counts the held lines
 * the planner played, how many stood, and how many beat their rule line by more than SEARCH.margin without building a
 * window (the hoarding plannerHold produced). With a dump dir, those positions are written there as JSON (fixtures).
 *
 *   npx vite-node scripts/search-holds.ts -- [games] [dump dir] [first seed]
 *
 * DUMP=accepted writes the held lines that stood instead (for the 8-sample robustness check, scripts/search-robust.ts).
 * SAMPLES=1 also turns plan.searchSamples (S3) on and prints its close calls, flips and the Corp's time per decision.
 */
import { writeFileSync } from 'node:fs';
import { createInitialGameState } from '../src/core';
import { GameRunner } from '../src/ai/playout';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { applyPlanOff, tuning } from '../src/ai/synergy';
import { SEARCH, plannerStats } from '../src/ai/turnPlanner';

const [gamesArg, dump, seedArg] = process.argv.slice(2).filter(a => a !== '--');
const games = Number(gamesArg ?? 4);
applyPlanOff(process.env.PLAN_OFF ?? '');
tuning.plan.searchLines = true;
if (process.env.SAMPLES === '1') tuning.plan.searchSamples = true;
const time = { ms: 0, n: 0 };
const n = { held: 0, accepted: 0, noWindow: 0, small: 0 };
let dumped = 0;
let seed = 0;
plannerStats.onHold = (state, action, h) => {
  n.held++;
  if (h.accepted) {
    n.accepted++;
    if (dump && process.env.DUMP === 'accepted' && dumped < 200) writeFileSync(`${dump}/hold-accepted-${seed}-${++dumped}.json`, JSON.stringify({ seed, gain: h.gain, action, state }));
  } else if (h.gain > SEARCH.margin) {
    n.noWindow++;
    if (dump && process.env.DUMP !== 'accepted' && dumped < 20) writeFileSync(`${dump}/hold-no-window-${++dumped}.json`, JSON.stringify({ seed, gain: h.gain, action, state }));
  } else n.small++;
};
const corp = ALL_DECKS.filter(d => d.side === 'corp');
const runner = ALL_DECKS.filter(d => d.side === 'runner');
for (let g = 0; g < games; g++) {
  seed = Number(seedArg ?? 1001) + 10 * g;
  const pairing = (seed - 1001) / 10;
  const c = corp[Math.floor(pairing / runner.length) % corp.length];
  const r = runner[pairing % runner.length];
  const gr = new GameRunner(createInitialGameState(deckGameSetup(seed, c, r)), { corp: createAgent('corp'), runner: createAgent('runner') });
  for (let i = 0; i < 6000 && !gr.state.winner && gr.state.turnNumber <= 80; i++) {
    const corp = gr.state.activePlayer === 'corp';
    const t = performance.now();
    if (!gr.step()) break;
    if (corp) {
      time.ms += performance.now() - t;
      time.n++;
    }
  }
}
console.log(JSON.stringify({ games, ...n, decisions: plannerStats.decisions, closeCalls: plannerStats.closeCalls ?? 0, closeFlips: plannerStats.closeFlips ?? 0, closeToHold: plannerStats.closeToHold ?? 0, closeFromHold: plannerStats.closeFromHold ?? 0, corpMs: +(time.ms / Math.max(1, time.n)).toFixed(1) }));
