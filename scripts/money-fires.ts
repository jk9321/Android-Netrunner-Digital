/**
 * Money step M1 (incomeLine.ts): how often the counted money pick fires per game. One JSON line per deal, with the
 * time taken.
 *
 *   SEEDS=1001,1011 npx vite-node scripts/money-fires.ts
 */
import { createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff } from '../src/ai/synergy';
import { moneyStats } from '../src/ai/incomeLine';

applyPlanOff(process.env.PLAN_OFF ?? '');
const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
for (const seed of seeds) {
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  const p = Math.floor((seed - 1001) / 10);
  valueLoops.clear();
  Object.assign(moneyStats, { ops: 0 });
  const start = createInitialGameState(deckGameSetup(seed, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length]));
  const t0 = Date.now();
  const game = new GameRunner(start, { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  for (let i = 0; i < 6000 && game.step(); i++);
  console.log(JSON.stringify({ seed, winner: game.state.winner ?? null, turns: game.state.turnNumber, ...moneyStats, ms: Date.now() - t0 }));
}
