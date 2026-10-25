/**
 * New-vs-old AI batches: the deck-aware AI (synergy nudges on) against the
 * AI as it was before them, on the same deals.
 *
 *   npx vite-node scripts/ai-match.ts -- [games per pairing] [normal|hard] [synergyWeight] [counterWeight]
 *
 * Every Corp deck meets every Runner deck. For each deal it plays old vs
 * old, new Corp vs old Runner, and old Corp vs new Runner, and reports
 * each side's win rate against the baseline.
 *
 * SHARD=i/n plays every n-th deal starting at i and prints raw counts as
 * JSON (scripts/ai-match.sh runs four shards side by side and adds them up).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInitialGameState } from '../src/core';
import { DECKS, deckGameSetup } from '../src/data/decks';
import { createAgent, playAIGame } from '../src/ai';
import { tuning } from '../src/ai/synergy';

const [gamesArg, levelArg, synArg, ctrArg] = process.argv.slice(2).filter(a => a !== '--');
const games = Number(gamesArg ?? 1);
const level = (levelArg ?? 'normal') as 'normal' | 'hard';
// Weights given here apply to both sides; leave them out to test the shipped weights
if (synArg !== undefined) tuning.synergy = { corp: Number(synArg), runner: Number(synArg) };
if (ctrArg !== undefined) tuning.counter = { corp: Number(ctrArg), runner: Number(ctrArg) };
// More knobs for ablations: KEEP=0 turns off the keep-in-hand synergy, DIVIDENDS=0 the over-advancing
if (process.env.KEEP) tuning.keep = { corp: Number(process.env.KEEP), runner: Number(process.env.KEEP) };
tuning.dividends = process.env.DIVIDENDS !== '0';
tuning.wary = process.env.WARY !== '0';
tuning.bluff = process.env.BLUFF !== '0';
tuning.purge = process.env.PURGE !== '0';
// PLAN_OFF=urgency,saveUp switches off planning terms (see tuning.plan)
for (const key of (process.env.PLAN_OFF ?? '').split(',').filter(Boolean)) (tuning.plan as Record<string, boolean>)[key] = false;

const corpDecks = DECKS.filter(d => d.side === 'corp');
const runnerDecks = DECKS.filter(d => d.side === 'runner');
const agent = (side: 'corp' | 'runner', synergy: boolean, seed: number) =>
  createAgent(side, level, level === 'hard' ? { synergy, samples: 6, candidates: 3, seed } : { synergy });

type Tally = { corp: number; runner: number; draw: number };
const tally = (): Tally => ({ corp: 0, runner: 0, draw: 0 });
const results = { base: tally(), newCorp: tally(), newRunner: tally() };
const byCorpDeck = new Map<string, { base: number; newCorp: number; n: number }>();
const byRunnerDeck = new Map<string, { base: number; newRunner: number; n: number }>();

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
// The old-vs-old games don't change while the new AI is tuned: BASE_CACHE=dir keeps their results
const cacheFile = process.env.BASE_CACHE ? `${process.env.BASE_CACHE}/base-${level}-${games}-${shard}of${shards}.json` : null;
const baseCache: Record<string, string> = cacheFile && existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
let seed = 1000;
let deal = 0;
const t0 = Date.now();
// DIAGONAL=1: each Corp deck meets just one Runner deck (quick Hard AI checks)
const diagonal = !!process.env.DIAGONAL;
for (const [ci, c] of corpDecks.entries()) {
  for (const [ri, r] of runnerDecks.entries()) {
    if (diagonal && ri !== ci % runnerDecks.length) continue;
    for (let g = 0; g < games; g++) {
      seed++;
      if (deal++ % shards !== shard) continue;
      const play = (newCorp: boolean, newRunner: boolean) => {
        try {
          const start = createInitialGameState(deckGameSetup(seed, c, r));
          const { state } = playAIGame(start, 4000, 80, { corp: agent('corp', newCorp, seed), runner: agent('runner', newRunner, seed) });
          return state.winner ?? 'draw';
        } catch (err) {
          console.error(`deal ${seed} ${c.name} vs ${r.name}: ${err}`); // an engine bug: count it as unfinished
          return 'draw';
        }
      };
      const key = `${seed}|${c.id}|${r.id}`;
      const base = (baseCache[key] ??= play(false, false)) as 'corp' | 'runner' | 'draw';
      // SIDE=corp or SIDE=runner tests only that side's new AI (the other line repeats the baseline)
      const nc = process.env.SIDE === 'runner' ? base : play(true, false);
      const nr = process.env.SIDE === 'corp' ? base : play(false, true);
      results.base[base]++;
      results.newCorp[nc]++;
      results.newRunner[nr]++;
      const cd = byCorpDeck.get(c.name) ?? { base: 0, newCorp: 0, n: 0 };
      cd.base += base === 'corp' ? 1 : 0;
      cd.newCorp += nc === 'corp' ? 1 : 0;
      cd.n++;
      byCorpDeck.set(c.name, cd);
      const rd = byRunnerDeck.get(r.name) ?? { base: 0, newRunner: 0, n: 0 };
      rd.base += base === 'runner' ? 1 : 0;
      rd.newRunner += nr === 'runner' ? 1 : 0;
      rd.n++;
      byRunnerDeck.set(r.name, rd);
    }
  }
}
if (cacheFile) writeFileSync(cacheFile, JSON.stringify(baseCache));
if (process.env.SHARD) {
  console.log(JSON.stringify({ results, byCorpDeck: [...byCorpDeck], byRunnerDeck: [...byRunnerDeck] }));
  process.exit(0);
}
const n = (diagonal ? corpDecks.length : corpDecks.length * runnerDecks.length) * games;
const pct = (x: number) => `${((100 * x) / n).toFixed(1)}%`;
console.log(`${level}, ${n} deals per matchup, weights ${synArg ?? 1}/${ctrArg ?? 1}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(`old Corp vs old Runner: Corp wins ${pct(results.base.corp)}, Runner ${pct(results.base.runner)}, unfinished ${pct(results.base.draw)}`);
console.log(`NEW Corp vs old Runner: Corp wins ${pct(results.newCorp.corp)} (${results.newCorp.corp - results.base.corp >= 0 ? '+' : ''}${results.newCorp.corp - results.base.corp} games)`);
console.log(`old Corp vs NEW Runner: Runner wins ${pct(results.newRunner.runner)} (${results.newRunner.runner - results.base.runner >= 0 ? '+' : ''}${results.newRunner.runner - results.base.runner} games)`);
if (process.env.DETAIL) {
  for (const [name, d] of byCorpDeck) console.log(`  corp ${name}: ${d.base}/${d.n} -> ${d.newCorp}/${d.n}`);
  for (const [name, d] of byRunnerDeck) console.log(`  runner ${name}: ${d.base}/${d.n} -> ${d.newRunner}/${d.n}`);
}
