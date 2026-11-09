/**
 * Spec-search S2 diagnostics (plan.searchLines): plays self-play games with the switch on and counts the held lines
 * the planner played, how many stood, and how many beat their rule line by more than SEARCH.margin without building a
 * window (the hoarding plannerHold produced). With a dump dir, those positions are written there as JSON (fixtures).
 *
 *   npx vite-node scripts/search-holds.ts -- [games] [dump dir] [first seed]
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
const n = { held: 0, accepted: 0, noWindow: 0, small: 0 };
let dumped = 0;
let seed = 0;
plannerStats.onHold = (state, action, h) => {
  n.held++;
  if (h.accepted) n.accepted++;
  else if (h.gain > SEARCH.margin) {
    n.noWindow++;
    if (dump && dumped < 20) writeFileSync(`${dump}/hold-no-window-${++dumped}.json`, JSON.stringify({ seed, gain: h.gain, action, state }));
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
  for (let i = 0; i < 6000 && !gr.state.winner && gr.state.turnNumber <= 80; i++) if (!gr.step()) break;
}
console.log(JSON.stringify({ games, ...n }));
