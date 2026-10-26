/**
 * How the Corp AI loses: plays the shipped AI against itself on every deck
 * pairing and logs each game (see lossLog.ts).
 *
 *   npx vite-node scripts/corp-losses.ts -- [games per pairing] [normal|hard]
 *
 * SHARD=i/n plays every n-th deal starting at i. scripts/corp-losses.sh runs
 * four shards and prints the breakdown. ai-match.sh logs its new-Corp games
 * the same way.
 */
import { createInitialGameState } from '../src/core';
import { DECKS, deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { GameRecord, playLogged } from './lossLog';
import { tuning } from '../src/ai/synergy';

const [gamesArg, levelArg] = process.argv.slice(2).filter(a => a !== '--');
const games = Number(gamesArg ?? 1);
const level = (levelArg ?? 'normal') as 'normal' | 'hard';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);

// PLAN_OFF=a,b switches off planning terms; CORP_DECKS / RUNNER_DECKS=name,name play only those decks
for (const key of (process.env.PLAN_OFF ?? '').split(',').filter(Boolean)) (tuning.plan as Record<string, boolean>)[key] = false;
if (process.env.BLUFF === '0') tuning.bluff = false;
const only = (process.env.CORP_DECKS ?? '').split(',').filter(Boolean);
const corpDecks = DECKS.filter(d => d.side === 'corp' && (only.length === 0 || only.includes(d.name)));
const onlyRunner = (process.env.RUNNER_DECKS ?? '').split(',').filter(Boolean);
const runnerDecks = DECKS.filter(d => d.side === 'runner' && (onlyRunner.length === 0 || onlyRunner.includes(d.name)));
const records: GameRecord[] = [];
let seed = 1000;
let deal = 0;
for (const c of corpDecks) {
  for (const r of runnerDecks) {
    for (let g = 0; g < games; g++) {
      seed++;
      if (deal++ % shards !== shard) continue;
      const agent = (side: 'corp' | 'runner') =>
        createAgent(side, level, level === 'hard' ? { samples: 6, candidates: 3, seed } : {});
      try {
        records.push(playLogged(createInitialGameState(deckGameSetup(seed, c, r)), { corp: agent('corp'), runner: agent('runner') }, { corp: c.name, runner: r.name }));
      } catch (err) {
        console.error(`deal ${seed} ${c.name} vs ${r.name}: ${err}`);
      }
    }
  }
}
console.log(JSON.stringify(records));
