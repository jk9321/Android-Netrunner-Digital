/**
 * Old vs new AI on the same deals (Jeff, 2026-10-28): the value model on
 * this branch against the AI from before it, one side swapped at a time.
 * The old AI is loaded from a checkout of the old commit (OLD_AI, default
 * ./old), so both run on this tree's engine.
 *
 *   H2H=corp|runner|old SHARD=i/n npx vite-node scripts/head-to-head.ts -- [games per pairing] [normal|hard]
 *   node scripts/corp-losses-sum.mjs out/*.json [--base other/*.json]
 *
 * H2H=corp: new Corp vs old Runner. runner: old Corp vs new Runner. old: old vs old.
 * Same seeds as corp-losses.ts, so new vs new is the ordinary self-play batch.
 */
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS as DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import type { GameRecord } from './lossLog';
import { applyPlanOff } from '../src/ai/synergy';
import { installDiagnostics } from '../src/ai/diagnostics';
const diag = installDiagnostics();

const [gamesArg, levelArg] = process.argv.slice(2).filter(a => a !== '--');
const games = Number(gamesArg ?? 1);
const level = (levelArg ?? 'normal') as 'normal' | 'hard';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const mode = process.env.H2H ?? 'corp';
const old = (await import(resolve(process.env.OLD_AI ?? 'old', 'src/ai/index.ts'))) as { createAgent: typeof createAgent };
// R-37 (R-C1 Part 0; B0 Part T, deal 2211): the loss log's own readings (lossLog.ts and its trackers call src/ai's
// pricing, which fills that graph's caches) ran in the new tree's module graph, so they shared value caches with the new
// side only: with the Corp under H2H=corp, with the Runner under H2H=runner (found row 90's class plus this asymmetry).
// The log now loads from a third copy of this tree (src and the five logger scripts), shared with neither agent, so both
// modes log alike. H2H_LOG=shared keeps the old harness (to compare with pairs played before this fix).
async function logModule(): Promise<typeof import('./lossLog')> {
  // SEARCH_AUDIT=1 reads the Corp planner's search through the logger's diagnostics, which only the shared graph sees
  if (process.env.H2H_LOG === 'shared' || process.env.SEARCH_AUDIT === '1') {
    if (process.env.H2H_LOG !== 'shared') console.error('SEARCH_AUDIT=1: the loss log shares the new tree\'s module graph (H2H_LOG=shared)');
    return import('./lossLog');
  }
  const dir = resolve('node_modules/.cache/h2h-log', `${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  cpSync('src', join(dir, 'src'), { recursive: true });
  for (const f of ['lossLog.ts', 'alarms.ts', 'spend-audit.ts', 'opening-audit.ts', 'search-audit.ts']) cpSync(join('scripts', f), join(dir, 'scripts', f));
  // The graph's entry first, as the scratch trees load it (a circular graph entered from lossLog's imports fails to settle)
  await import(/* @vite-ignore */ join(dir, 'src', 'ai', 'index.ts'));
  return (await import(/* @vite-ignore */ join(dir, 'scripts', 'lossLog.ts'))) as typeof import('./lossLog');
}
const { playLogged } = await logModule();
// PLAN_OFF switches reach only the new AI: the old one has its own copy of tuning
applyPlanOff(process.env.PLAN_OFF ?? '');
// REPLY_SAMPLES: Runner turns the Corp's planner plays out per candidate (plan.runnerReply)
if (process.env.REPLY_SAMPLES) (await import('../src/ai/runnerReply')).REPLY.samples = Number(process.env.REPLY_SAMPLES);
const newSide = mode === 'corp' ? 'corp' : mode === 'runner' ? 'runner' : null;
// R-109's safety net, on each tree's own module (B4c part 4): the Runner's deals redone without its knowledge
const { dealFallbacks } = await import('../src/ai/runnerReply');
// An old tree from before R-109 has no count (or no runnerReply.ts): it adds nothing
const oldFallbacks = await import(resolve(process.env.OLD_AI ?? 'old', 'src/ai/runnerReply.ts')).then(
  m => (m as { dealFallbacks?: { count: number } }).dealFallbacks,
  () => undefined
);
const fallbacksNow = () => dealFallbacks.count + (oldFallbacks && oldFallbacks !== dealFallbacks ? oldFallbacks.count : 0);

const records: GameRecord[] = [];
const from = Number(process.env.GAME_FROM ?? 0);
const stride = Math.max(10, games);
let pairing = 0;
let deal = 0;
for (const c of DECKS.filter(d => d.side === 'corp')) {
  for (const r of DECKS.filter(d => d.side === 'runner')) {
    pairing++;
    for (let g = from; g < games; g++) {
      const seed = 1000 + (pairing - 1) * stride + g + 1;
      if (deal++ % shards !== shard) continue;
      const agent = (side: 'corp' | 'runner') =>
        (side === newSide ? createAgent : old.createAgent)(side, level, level === 'hard' ? { samples: 6, candidates: 3, seed } : {});
      const before = fallbacksNow();
      try {
        const rec = playLogged(createInitialGameState(deckGameSetup(seed, c, r)), { corp: agent('corp'), runner: agent('runner') }, { corp: c.name, runner: r.name });
        const fellBack = fallbacksNow() - before;
        records.push({ ...rec, seed, ...(fellBack > 0 ? { dealFallbacks: fellBack } : {}) });
      } catch (err) {
        console.error(`deal ${seed} ${c.name} vs ${r.name}: ${err}`);
      }
    }
  }
}
console.error(`reply naked agenda remotes: ${diag.reply.nakedAgendaRuns}/${diag.reply.nakedAgendaTurns} run`);
console.error(`DEAL FALLBACKS (Runner deals redone without its knowledge, both trees): ${fallbacksNow()} in ${records.filter(r => r.dealFallbacks).length} games`);
console.log(JSON.stringify(records));
