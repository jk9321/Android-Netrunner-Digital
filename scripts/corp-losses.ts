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
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff, tuning } from '../src/ai/synergy';

const [gamesArg, levelArg] = process.argv.slice(2).filter(a => a !== '--');
const games = Number(gamesArg ?? 1);
const level = (levelArg ?? 'normal') as 'normal' | 'hard';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);

// PLAN_OFF=a,b switches off planning terms; CORP_DECKS / RUNNER_DECKS=name,name play only those decks
applyPlanOff(process.env.PLAN_OFF ?? '');
if (process.env.BLUFF === '0') tuning.bluff = false;
const only = (process.env.CORP_DECKS ?? '').split(',').filter(Boolean);
// DECKS=vp-,core- plays only decks whose id starts with one of the prefixes; corp=x / runner=x narrow one side only
// (DECKS=runner=vp-sourdough: one Runner deck against every Corp deck)
const entries = (process.env.DECKS ?? '').split(',').filter(Boolean);
const sidePrefixes = (side: 'corp' | 'runner') => {
  const own = entries.filter(e => e.startsWith(side + '=')).map(e => e.slice(side.length + 1));
  return own.length ? own : entries.filter(e => !e.includes('='));
};
const inSidePool = (side: 'corp' | 'runner', id: string) => {
  const prefixes = sidePrefixes(side);
  return prefixes.length === 0 || prefixes.some(p => id.startsWith(p));
};
const corpDecks = DECKS.filter(d => d.side === 'corp' && inSidePool('corp', d.id) && (only.length === 0 || only.includes(d.name)));
const onlyRunner = (process.env.RUNNER_DECKS ?? '').split(',').filter(Boolean);
const runnerDecks = DECKS.filter(d => d.side === 'runner' && inSidePool('runner', d.id) && (onlyRunner.length === 0 || onlyRunner.includes(d.name)));
const records: GameRecord[] = [];
// GAME_FROM=k plays only games k.. of each pairing, so a short batch can be topped up later with fresh deals.
// Each pairing's deals are seeded 10 apart (as a 10-a-pairing batch always was), so a topped-up batch plays the same games.
const from = Number(process.env.GAME_FROM ?? 0);
const stride = Math.max(10, games);
// SEED=n plays only that deal (to look into one game)
const onlySeed = Number(process.env.SEED ?? 0);
let pairing = 0;
let deal = 0;
for (const c of corpDecks) {
  for (const r of runnerDecks) {
    pairing++;
    for (let g = from; g < games; g++) {
      const seed = 1000 + (pairing - 1) * stride + g + 1;
      if (onlySeed && seed !== onlySeed) {
        deal++;
        continue;
      }
      if (deal++ % shards !== shard) continue;
      const agent = (side: 'corp' | 'runner') =>
        createAgent(side, level, level === 'hard' ? { samples: 6, candidates: 3, seed } : {});
      const started = Date.now();
      if (process.env.TRACE) console.error(`start deal ${seed} ${c.name} vs ${r.name}`);
      valueLoops.clear();
      try {
        const record = playLogged(createInitialGameState(deckGameSetup(seed, c, r)), { corp: agent('corp'), runner: agent('runner') }, { corp: c.name, runner: r.name });
        // Value loops met in the game (valueModel.ts guardLoop): played on with flat values, listed in the summary to fix
        records.push(valueLoops.size ? { ...record, loops: Object.fromEntries(valueLoops) } : record);
      } catch (err) {
        // A crashed game is listed in the summary, not dropped silently
        records.push({ crashed: `${err}`.slice(0, 200), seed, corpDeck: c.name, runnerDeck: r.name } as unknown as GameRecord);
        console.error(`deal ${seed} ${c.name} vs ${r.name}: ${err}`);
        if (process.env.STACK) console.error((err as Error).stack?.split('\n').slice(0, 60).join('\n'));
      }
      // A game far slower than the rest holds up its whole shard: name it
      const secs = (Date.now() - started) / 1000;
      if (secs > 60) console.error(`slow deal ${seed} ${c.name} vs ${r.name}: ${secs.toFixed(0)} s`);
    }
  }
}
console.log(JSON.stringify(records));
