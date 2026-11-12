/**
 * Money step flow: the Corp's cumulative income (every rise in its credits, on either side's turn: rule 1.10) by the
 * end of Corp turns 5 and 10, and its credits at each Corp turn start. Normal v Normal, one JSON line per deal; pair
 * two runs (base and arm, same seeds) with scripts/money-flow-sum.mjs.
 *
 *   SEEDS=1001,1011 [PLAN_OFF=...] npx vite-node scripts/money-flow.ts
 */
import { createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff } from '../src/ai/synergy';

applyPlanOff(process.env.PLAN_OFF ?? '');
const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
for (const seed of seeds) {
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  const p = Math.floor((seed - 1001) / 10);
  valueLoops.clear();
  const t0 = Date.now();
  const game = new GameRunner(createInitialGameState(deckGameSetup(seed, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length])), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  let prev = game.state;
  let income = 0;
  const byTurn: number[] = []; // cumulative income at the end of each Corp turn (index = turn - 1)
  const start: number[] = []; // credits at each Corp turn start
  let decisions = 0;
  if (prev.activePlayer === 'corp') start[prev.turnNumber - 1] = prev.corp.credits;
  for (let i = 0; i < 6000 && game.step(); i++) {
    const s = game.state;
    if (s.corp.credits > prev.corp.credits) income += s.corp.credits - prev.corp.credits;
    if (s.activePlayer === 'corp' && (prev.activePlayer !== 'corp' || s.turnNumber !== prev.turnNumber)) start[s.turnNumber - 1] = s.corp.credits;
    if (prev.activePlayer === 'corp' && s.activePlayer === 'runner') byTurn[prev.turnNumber - 1] = income;
    if (prev.activePlayer === 'corp') decisions++;
    prev = s;
  }
  console.log(JSON.stringify({ seed, winner: game.state.winner ?? null, turns: game.state.turnNumber, ms: Date.now() - t0, corpSteps: decisions, byTurn, start }));
}
