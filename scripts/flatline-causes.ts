/**
 * Runner flatlines by cause on chosen batch deals (ai-runner-fixes review R1): plays each deal as corp-losses.ts seeds it
 * (Normal v Normal) and, when the Corp wins by flatline, names the step that did it: in a run's access (a steal's or an
 * accessed card's damage), in an encounter (ice), on the Corp's turn (with the grip the Runner began that turn on), or
 * other. Deals: a JSON list of { seed, corp, runner } (deck names, as a batch's .deals.json has them).
 *
 *   npx vite-node scripts/flatline-causes.ts -- deals.json out.jsonl [shard i/n]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { GameState, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';

const [dealsFile, out, shardArg] = process.argv.slice(2).filter(a => a !== '--');
const [shard, shards] = (shardArg ?? '0/1').split('/').map(Number);
const deals: { seed: number; corp: string; runner: string }[] = JSON.parse(readFileSync(dealsFile, 'utf8'));
const rows: string[] = [];
deals.forEach((d, i) => {
  if (i % shards !== shard) return;
  const c = ALL_DECKS.find(x => x.side === 'corp' && x.name === d.corp)!;
  const r = ALL_DECKS.find(x => x.side === 'runner' && x.name === d.runner)!;
  valueLoops.clear();
  const gr = new GameRunner(createInitialGameState(deckGameSetup(d.seed, c, r)), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  let cause = '';
  let corpTurnGrip = -1;
  let lastRunGrip = -1;
  for (let k = 0; k < 6000 && !gr.state.winner && gr.state.turnNumber <= 80; k++) {
    const before: GameState = gr.state;
    if (!gr.step()) break;
    const after = gr.state;
    if (before.activeRun && !after.activeRun && after.activePlayer === 'runner') lastRunGrip = after.runner.grip.length;
    if (before.activePlayer === 'runner' && after.activePlayer === 'corp') corpTurnGrip = after.runner.grip.length;
    if (after.winner === 'corp' && /flatline/i.test(after.winReason ?? '')) {
      const run = before.activeRun;
      cause = before.activePlayer === 'corp' && !run ? 'corpTurn' : run?.encounter ? 'ice' : run && (run.phase === 'access' || run.breached) ? 'access' : 'other';
    }
  }
  rows.push(JSON.stringify({ seed: d.seed, corp: d.corp, runner: d.runner, winner: gr.state.winner ?? null, reason: gr.state.winReason, cause, corpTurnGrip, lastRunGrip, turn: gr.state.turnNumber }));
  console.error(`${d.seed} ${gr.state.winner} ${cause}`);
});
writeFileSync(out, rows.join('\n') + '\n');
