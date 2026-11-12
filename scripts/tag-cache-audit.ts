/**
 * Tag cache on-hit audit (ai-tag-cache): plays deals Normal v Normal with tagRigAudit on, so every cache hit in tagLoss is
 * priced again and compared with the value served. One JSON line per deal: calls, hits, checked, mismatches, examples.
 *
 *   SEEDS=1001,2493 npx vite-node scripts/tag-cache-audit.ts
 */
import { createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff } from '../src/ai/synergy';
import { clearTagRigCache, tagRigAudit, tagRigStats } from '../src/ai/evaluate';

applyPlanOff(process.env.PLAN_OFF ?? '');
tagRigAudit.on = true;

function playDeal(seed: number) {
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  const p = Math.floor((seed - 1001) / 10);
  valueLoops.clear();
  clearTagRigCache();
  Object.assign(tagRigStats, { calls: 0, hits: 0 });
  Object.assign(tagRigAudit, { checked: 0, mismatches: 0, near: 0, examples: [] });
  const start = createInitialGameState(deckGameSetup(seed, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length]));
  const game = new GameRunner(start, { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  for (let i = 0; i < 6000 && game.step(); i++);
  return { seed, winner: game.state.winner ?? null, ...tagRigStats, checked: tagRigAudit.checked, mismatches: tagRigAudit.mismatches, near: tagRigAudit.near, examples: tagRigAudit.examples };
}

const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
for (const seed of seeds) console.log(JSON.stringify(playDeal(seed)));
