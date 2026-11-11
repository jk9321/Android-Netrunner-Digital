/**
 * How the Corp AI loses: plays the shipped AI against itself on every deck
 * pairing and logs each game (see lossLog.ts).
 *
 *   npx vite-node scripts/corp-losses.ts -- [games per pairing] [normal|hard|corp-hard|runner-hard]
 *
 * SHARD=i/n plays every n-th deal starting at i. scripts/corp-losses.sh runs
 * four shards and prints the breakdown. ai-match.sh logs its new-Corp games
 * the same way.
 */
import { createHash } from 'node:crypto';
import { threatStats } from '../src/ai/threatModel';
import { createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS as SHIPPED_DECKS } from './nsg-sample-decks';
import { NRDB_TEST_DECKS } from './nrdb-test-decks';
import { createAgent } from '../src/ai';
import { GameRecord, playLogged } from './lossLog';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff, tuning } from '../src/ai/synergy';
import { batchTokens, placeOracleIce } from './oracle-ice';
import { withOracleMoney } from './oracle-money';
import { measuring, startMeasure, stage0bMeasure } from './score-ceiling-measure';

const [gamesArg, levelArg] = process.argv.slice(2).filter(a => a !== '--');
const games = Number(gamesArg ?? 1);
// normal | hard (both sides) | corp-hard | runner-hard (one side's Hard AI against the other's Normal: is Hard still
// ahead of Normal after the planner work? Jeff 2026-11-09)
const level = (levelArg ?? 'normal') as 'normal' | 'hard' | 'corp-hard' | 'runner-hard';
const levelOf = (side: 'corp' | 'runner'): 'normal' | 'hard' => (level === 'hard' || level === `${side}-hard` ? 'hard' : 'normal');
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);

// PLAN_OFF=a,b switches off planning terms; CORP_DECKS / RUNNER_DECKS=name,name play only those decks
// Round 2 oracle 3 (spec-round2.md): +oracle.ice.hq|archives|remote in PLAN_OFF is a board setup read here, not a
// plan switch (the ai-batch workflow has no other input for it): taken out before applyPlanOff
// +oracle.money (the money ceiling): +1 credit at the start of every Corp turn, read here too (scripts/oracle-money.ts)
const { ice: iceOracle, money: moneyOracle, plan: planSwitches } = batchTokens(process.env.PLAN_OFF ?? '');
applyPlanOff(planSwitches);
if (process.env.BLUFF === '0') tuning.bluff = false;
const only = (process.env.CORP_DECKS ?? '').split(',').filter(Boolean);
// DECKS=vp-,core- plays only decks whose id starts with one of the prefixes; corp=x / runner=x narrow one side only
// (DECKS=runner=vp-sourdough: one Runner deck against every Corp deck)
// NRDB=1 adds the test-only NetrunnerDB decks of scripts/nrdb-test-decks.ts (ids vp-...)
const DECKS = [...SHIPPED_DECKS, ...(process.env.NRDB ? NRDB_TEST_DECKS : [])];
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
        createAgent(side, levelOf(side), levelOf(side) === 'hard' ? { samples: 6, candidates: 3, seed } : {});
      const started = Date.now();
      if (process.env.TRACE) console.error(`start deal ${seed} ${c.name} vs ${r.name}`);
      valueLoops.clear();
      try {
        const start = createInitialGameState(deckGameSetup(seed, c, r));
        const iced = iceOracle ? placeOracleIce(start, iceOracle) : undefined;
        const agents = { corp: agent('corp'), runner: agent('runner') };
        // Counted scoring (spec-counted-scoring.md): a batch naming plan.scoreNow or plan.scoreInTwo also records the moves
        if (measuring) startMeasure(agents);
        const record = playLogged(start, agents, { corp: c.name, runner: r.name }, moneyOracle ? s => withOracleMoney(s) : undefined);
        // Value loops met in the game (valueModel.ts guardLoop): played on with flat values, listed in the summary to fix
        // ORACLE_ICE: every game names the setup; one whose R&D held no ice played without it (counted in the summary)
        const tagged0 = iceOracle ? { ...record, seed, oracleIce: iceOracle, oracleIceSkipped: iced === false } : { ...record, seed };
        const tagged = measuring ? { ...tagged0, stage0b: stage0bMeasure(seed, c, r) } : tagged0;
        records.push(valueLoops.size ? { ...tagged, loops: Object.fromEntries(valueLoops) } : tagged);
        // THREAT_STATS=1 (planner speed: do the threat-key switches reach a batch game?): the threat cache's work per game
        if (process.env.THREAT_STATS) {
          const h = createHash('sha1').update(JSON.stringify(record)).digest('hex').slice(0, 12);
          console.error(JSON.stringify({ seed, calls: threatStats.calls, keyed: threatStats.keyed, budgeted: threatStats.budgeted, hits: threatStats.keyed - threatStats.budgeted, record: h }));
        }
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
