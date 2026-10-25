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

const [gamesArg, levelArg] = process.argv.slice(2).filter(a => a !== '--');
const games = Number(gamesArg ?? 1);
const level = (levelArg ?? 'normal') as 'normal' | 'hard';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);

const corpDecks = DECKS.filter(d => d.side === 'corp');
const runnerDecks = DECKS.filter(d => d.side === 'runner');
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
