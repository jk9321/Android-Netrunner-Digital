/**
 * Same-seed identity check: plays the shipped AI against itself on a spread
 * of deck pairings and prints one line per game with a hash of every action
 * taken. Two commits that print the same lines played the same games, move
 * for move (a refactor's local proof before the paired batch; review item 6).
 *
 *   npx vite-node scripts/same-seed.ts -- [games] [normal|hard] > out.txt
 *
 * SHARD=i/n plays every n-th game starting at i. TRACE_SEED=n prints that
 * game's actions, one per line, to stderr (to find where two runs part).
 * PLAN_OFF as in corp-losses.ts.
 */
import { createHash } from 'node:crypto';
import { createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { applyPlanOff } from '../src/ai/synergy';

const [gamesArg, levelArg] = process.argv.slice(2).filter(a => a !== '--');
const games = Number(gamesArg ?? 20);
const level = (levelArg ?? 'normal') as 'normal' | 'hard';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const traceSeed = Number(process.env.TRACE_SEED ?? 0);
applyPlanOff(process.env.PLAN_OFF ?? '');

const corps = ALL_DECKS.filter(d => d.side === 'corp');
const runners = ALL_DECKS.filter(d => d.side === 'runner');
for (let g = 0; g < games; g++) {
  if (g % shards !== shard) continue;
  // Walk the pairings with coprime strides so a short run still meets many decks
  const c = corps[(g * 7) % corps.length];
  const r = runners[(g * 5 + 3) % runners.length];
  const seed = 5000 + g;
  const agent = (side: 'corp' | 'runner') => createAgent(side, level, level === 'hard' ? { samples: 6, candidates: 3, seed } : {});
  const runner = new GameRunner(createInitialGameState(deckGameSetup(seed, c, r)), { corp: agent('corp'), runner: agent('runner') });
  const hash = createHash('sha1');
  let actions = 0;
  let error = '';
  try {
    while (actions < 4000 && runner.step()) {
      const line = JSON.stringify(runner.last);
      hash.update(line);
      if (seed === traceSeed) console.error(`${actions} t${runner.state.turnNumber} ${line}`);
      actions++;
    }
  } catch (err) {
    error = ` CRASH ${`${err}`.slice(0, 80)}`;
  }
  console.log(`${seed} ${c.id} ${r.id} ${actions} ${runner.state.winner ?? '-'} ${hash.digest('hex').slice(0, 16)}${error}`);
}
