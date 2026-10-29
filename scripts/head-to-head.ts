/**
 * Old vs new AI on the same deals (Jeff, 2026-10-28): the value model on
 * this branch against the AI from before it, one side swapped at a time.
 * The old AI is loaded from a checkout of the old commit (OLD_AI, default
 * ./old), so both run on this tree's engine.
 *
 *   H2H=corp|runner|old SHARD=i/n npx vite-node scripts/head-to-head.ts -- [games per pairing] [normal|hard]
 *   node scripts/corp-losses-sum.mjs out/*.json
 *
 * H2H=corp: new Corp vs old Runner. runner: old Corp vs new Runner. old: old vs old.
 * Same seeds as corp-losses.ts, so new vs new is the ordinary self-play batch.
 */
import { resolve } from 'node:path';
import { createInitialGameState } from '../src/core';
import { DECKS, deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { GameRecord, playLogged } from './lossLog';
import { tuning } from '../src/ai/synergy';

const [gamesArg, levelArg] = process.argv.slice(2).filter(a => a !== '--');
const games = Number(gamesArg ?? 1);
const level = (levelArg ?? 'normal') as 'normal' | 'hard';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const mode = process.env.H2H ?? 'corp';
const old = (await import(resolve(process.env.OLD_AI ?? 'old', 'src/ai/index.ts'))) as { createAgent: typeof createAgent };
// PLAN_OFF switches reach only the new AI: the old one has its own copy of tuning
// A switch written +name turns it on instead (pieces that are off by default)
for (const key of (process.env.PLAN_OFF ?? '').split(',').filter(Boolean)) {
  const on = key.startsWith('+');
  const [name, side] = key.replace(/^\+/, '').split('.');
  const plan = tuning.plan as Record<string, unknown>;
  if (side) plan[name] = { ...(plan[name] as object), [side]: on };
  else plan[name] = on;
}
// REPLY_SAMPLES: Runner turns the Corp's planner plays out per candidate (plan.runnerReply)
if (process.env.REPLY_SAMPLES) (await import('../src/ai/runnerReply')).REPLY.samples = Number(process.env.REPLY_SAMPLES);
const newSide = mode === 'corp' ? 'corp' : mode === 'runner' ? 'runner' : null;

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
      try {
        records.push(playLogged(createInitialGameState(deckGameSetup(seed, c, r)), { corp: agent('corp'), runner: agent('runner') }, { corp: c.name, runner: r.name }));
      } catch (err) {
        console.error(`deal ${seed} ${c.name} vs ${r.name}: ${err}`);
      }
    }
  }
}
const { replyStats } = await import('../src/ai/runnerReply');
console.error(`reply naked agenda remotes: ${replyStats.nakedAgendaRuns}/${replyStats.nakedAgendaTurns} run`);
console.log(JSON.stringify(records));
