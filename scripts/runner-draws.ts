/**
 * Phase 2 K (measured for plan.reach's RUNNER_TURN_DRAWS, 1.6; both deleted in audit Step 3): how many cards the Runner AI takes from its stack per
 * turn in self-play (draw clicks, rule 5.2.7c, plus card draws and tutors: every card that leaves the stack), counted
 * from one Runner turn start to the next. Plays the batch's deals (Normal AI, shipped decks) with every switch as on beta.
 *
 *   npx vite-node scripts/runner-draws.ts -- [deals] [first deal]
 */
import { createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';

const [nArg, fromArg] = process.argv.slice(2).filter(a => a !== '--');
const deals = Number(nArg ?? 20);
const from = Number(fromArg ?? 0);
const corps = ALL_DECKS.filter(d => d.side === 'corp');
const runners = ALL_DECKS.filter(d => d.side === 'runner');
const pairs = corps.flatMap(c => runners.map(r => ({ c, r })));
let turns = 0;
let taken = 0;
const perTurn: number[] = [];
for (let k = from; k < from + deals; k++) {
  // Deal k: pairing k mod the pairings, game k div them, seeded as corp-losses seeds that game
  const i = k % pairs.length;
  const g = Math.floor(k / pairs.length);
  const { c, r } = pairs[i];
  const seed = 1000 + i * 10 + g + 1;
  const game = new GameRunner(createInitialGameState(deckGameSetup(seed, c, r)), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  let stackAtStart: number | null = null;
  let wasRunner = false;
  for (let step = 0; step < 6000 && !game.state.winner; step++) {
    if (!game.step()) break;
    const s = game.state;
    const runnerTurn = s.activePlayer === 'runner' && !s.activeRun;
    if (runnerTurn && !wasRunner) {
      if (stackAtStart !== null) {
        const n = Math.max(0, stackAtStart - s.runner.stack.length);
        perTurn.push(n);
        taken += n;
        turns++;
      }
      stackAtStart = s.runner.stack.length;
    }
    wasRunner = s.activePlayer === 'runner';
  }
  console.error(`deal ${k} seed ${seed} ${c.name} vs ${r.name}: ${turns} turns so far, ${(taken / Math.max(1, turns)).toFixed(2)} a turn`);
}
const hist = perTurn.reduce<Record<number, number>>((h, n) => ((h[n] = (h[n] ?? 0) + 1), h), {});
console.log(JSON.stringify({ deals, turns, perTurn: +(taken / Math.max(1, turns)).toFixed(3), histogram: hist }));
