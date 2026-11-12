/**
 * Click price cache on-hit audit (ai-click-cache): plays deals Normal v Normal with clickAudit on, so every cache hit in
 * handValues clickWorth is priced again with the cache bypassed and compared with the value served. One JSON line per
 * deal: checked, mismatches, examples, and the time taken.
 *
 *   SEEDS=1001,1563 npx vite-node scripts/click-cache-audit.ts
 */
import { createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff } from '../src/ai/synergy';
import { clearClickCache, clickAudit } from '../src/ai/handValues';

applyPlanOff(process.env.PLAN_OFF ?? '');
clickAudit.on = process.env.AUDIT !== '0';

function playDeal(seed: number) {
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  const p = Math.floor((seed - 1001) / 10);
  valueLoops.clear();
  clearClickCache();
  Object.assign(clickAudit, { checked: 0, mismatches: 0, examples: [] });
  const t0 = Date.now();
  const start = createInitialGameState(deckGameSetup(seed, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length]));
  const game = new GameRunner(start, { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  for (let i = 0; i < 6000 && game.step(); i++);
  return { seed, winner: game.state.winner ?? null, turns: game.state.turnNumber, ms: Date.now() - t0, checked: clickAudit.checked, mismatches: clickAudit.mismatches, examples: clickAudit.examples };
}

const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
for (const seed of seeds) console.log(JSON.stringify(playDeal(seed)));
