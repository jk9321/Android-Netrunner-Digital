/**
 * Stage B5 memo audit (AI Coordinator 22:22Z): plays batch deals Normal v Normal with corp/rezMoney.ts's on-hit audit on
 * (every memoised rezMoney and holdingRezIds answer worked out again on the asking board) and prints how many differ.
 *
 *   SEEDS=2181,1421 npx vite-node scripts/stage-b/rezmoney-audit.ts
 */
import { createInitialGameState } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { ALL_DECKS } from '../nsg-sample-decks';
import { createAgent } from '../../src/ai';
import { GameRunner } from '../../src/ai/playout';
import { valueLoops } from '../../src/ai/valueModel';
import { rezMoneyAudit } from '../../src/ai/corp/rezMoney';

const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
rezMoneyAudit.on = true;
for (const seed of (process.env.SEEDS ?? '2181,1421').split(',').map(Number)) {
  const p = Math.floor((seed - 1001) / 10);
  valueLoops.clear();
  rezMoneyAudit.checked = 0;
  rezMoneyAudit.mismatches = 0;
  const game = new GameRunner(createInitialGameState(deckGameSetup(seed, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length])), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  let n = 0;
  for (; n < 4000 && game.step(); n++);
  console.log(`deal ${seed}: ${n} actions, turn ${game.state.turnNumber}, winner ${game.state.winner ?? '-'}; rez money memo checked ${rezMoneyAudit.checked}, wrong ${rezMoneyAudit.mismatches}`);
}
