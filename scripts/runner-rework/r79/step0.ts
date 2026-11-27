/**
 * R-79 step 0 (brief netrunner-ai/runner-rework/briefs/r79-alarm-after-game.md): does the batch driver (lossLog.ts
 * playLogged) play the same games as a plain GameRunner? Each shard plays its g1 deals (shard k of n: deal indexes
 * k, k+n, ..., as corp-losses.ts SHARD=k/n with games 1) in four arms, each in its own process (no module map shared):
 *
 *   logged          playLogged as the batch runs it (alarm evaluate on, opening audit on)
 *   noalarm         playLogged with NO_EVAL_ALARM=1 (the alarm's evaluate left out)
 *   noalarm-noopen  playLogged with NO_EVAL_ALARM=1 and OPENING=0 (the opening audit's rankings left out too)
 *   plain           a plain GameRunner, same step and turn limits
 *
 * ARMS=logged,plain plays only those (bar 1 on the fixed tree: there NO_EVAL_ALARM is gone, so noalarm = logged).
 *
 * and records every agent answer (chooseAction, chooseRez, chooseOffTurn: turn, side, method, answer). A deal is
 * compared arm against plain (and logged against noalarm) by its first differing answer. The last shard also plays g3
 * shard 28's first two deals in order (1092, then 1303: deal index 92), the O1a bar 6 deal.
 *
 *   SHARD=0/64 npx vite-node scripts/runner-rework/r79/step0.ts            (one JSON line per deal and arm pair)
 *   ARGS="SEEDS=1303 PRE=1092" npx vite-node scripts/runner-rework/r79/step0.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execFileSync } from 'node:child_process';
import { createInitialGameState } from '../../../src/core';
import { deckGameSetup } from '../../../src/data/decks';
import { ALL_DECKS } from '../../nsg-sample-decks';
import { createAgent, GameRunner } from '../../../src/ai';
import { valueLoops } from '../../../src/ai/valueModel';
import { playLogged } from '../../lossLog';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const i = kv.indexOf('=');
  process.env[kv.slice(0, i)] = kv.slice(i + 1);
}
const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
/** A deal as corp-losses.ts seeds it (stride 10): seed 1000 + (pairing - 1) * 10 + game + 1. */
const decksOf = (seed: number) => {
  const p = Math.floor((seed - 1001) / 10);
  return { c: corpDecks[Math.floor(p / runnerDecks.length)], r: runnerDecks[p % runnerDecks.length] };
};
const ALL_ARMS = ['logged', 'noalarm', 'noalarm-noopen', 'plain'] as const;
type Arm = (typeof ALL_ARMS)[number];
// ARMS=logged,plain (R-79 bar 1, on the fixed tree, where NO_EVAL_ALARM no longer exists): only those arms
const ARMS = ALL_ARMS.filter(a => (process.env.ARMS ?? ALL_ARMS.join(',')).split(',').includes(a));
interface Game {
  seed: number;
  answers: string[];
  winner: string | null;
  turns: number;
  nanAlarms: number;
  alarms: number;
  ms: number;
}

function play(seed: number, arm: Arm): Game {
  const { c, r } = decksOf(seed);
  const answers: string[] = [];
  const wrap = (agent: any) =>
    new Proxy(agent, {
      get(t, p) {
        const f = t[p];
        if (typeof f !== 'function' || !['chooseAction', 'chooseRez', 'chooseOffTurn'].includes(String(p))) return f;
        return (state: any, ...rest: any[]) => {
          const a = f.call(t, state, ...rest);
          answers.push(`${state.turnNumber}|${agent.side}|${String(p)}|${JSON.stringify(a ?? null)}`);
          return a;
        };
      },
    });
  const t0 = Date.now();
  // As corp-losses.ts: fresh agents and value loops per game
  valueLoops.clear();
  const start = createInitialGameState(deckGameSetup(seed, c, r));
  const agents = { corp: wrap(createAgent('corp', 'normal', {})), runner: wrap(createAgent('runner', 'normal', {})) };
  if (arm === 'plain') {
    const g = new GameRunner(start, agents);
    for (let steps = 0; steps < 4000 && g.state.turnNumber <= 80; steps++) if (!g.step()) break;
    return { seed, answers, winner: g.state.winner ?? null, turns: g.state.turnNumber, nanAlarms: 0, alarms: 0, ms: Date.now() - t0 };
  }
  const rec = playLogged(start, agents, { corp: c.name, runner: r.name });
  return { seed, answers, winner: rec.winner, turns: rec.turns, nanAlarms: rec.alarms.filter(a => a.kind === 'valuation not a number').length, alarms: rec.alarms.length, ms: Date.now() - t0 };
}

if (process.env.CHILD) {
  const arm = process.env.CHILD as Arm;
  const games = (process.env.CHILD_SEEDS ?? '').split(',').filter(Boolean).map(Number).map(s => play(s, arm));
  process.stdout.write('\n@@' + JSON.stringify(games));
} else {
  const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
  const pairings = corpDecks.length * runnerDecks.length;
  // Sequences of deals, each played in order in one process per arm; `report` are the seeds compared
  const jobs: { name: string; seeds: number[]; report: number[] }[] = [];
  if (process.env.SEEDS) {
    const seeds = process.env.SEEDS.split(',').map(Number);
    const pre = (process.env.PRE ?? '').split(',').filter(Boolean).map(Number);
    jobs.push({ name: 'listed', seeds: [...pre, ...seeds], report: seeds });
  } else {
    const g1: number[] = [];
    for (let d = shard; d < pairings; d += shards) g1.push(1001 + 10 * d);
    jobs.push({ name: 'g1', seeds: g1, report: g1 });
    if (shard === shards - 1) jobs.push({ name: 'g3-shard28', seeds: [1092, 1303], report: [1303] });
  }
  const child = (arm: Arm, seeds: number[]): Game[] => {
    const env: Record<string, string | undefined> = { ...process.env, CHILD: arm, CHILD_SEEDS: seeds.join(','), ARGS: '' };
    delete env.NO_EVAL_ALARM;
    delete env.OPENING;
    if (arm === 'noalarm' || arm === 'noalarm-noopen') env.NO_EVAL_ALARM = '1';
    if (arm === 'noalarm-noopen') env.OPENING = '0';
    const out = execFileSync('npx', ['vite-node', 'scripts/runner-rework/r79/step0.ts'], { env: env as NodeJS.ProcessEnv, maxBuffer: 1 << 30, encoding: 'utf8' });
    return JSON.parse(out.slice(out.lastIndexOf('@@') + 2));
  };
  const firstDiff = (a: string[], b: string[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i;
    return -1;
  };
  for (const job of jobs) {
    const byArm = {} as Record<Arm, Game[]>;
    const armMs = {} as Record<Arm, number>;
    for (const arm of ARMS) {
      const t0 = Date.now();
      byArm[arm] = child(arm, job.seeds);
      armMs[arm] = Date.now() - t0;
    }
    for (const seed of job.report) {
      const g = Object.fromEntries(ARMS.map(a => [a, byArm[a].find(x => x.seed === seed)!])) as Record<Arm, Game>;
      const cmp = (a: Arm, b: Arm) => {
        if (!g[a] || !g[b]) return undefined;
        const k = firstDiff(g[a].answers, g[b].answers);
        return k < 0 ? null : { at: k, of: g[b].answers.length, [a]: g[a].answers[k]?.slice(0, 300) ?? 'end', [b]: g[b].answers[k]?.slice(0, 300) ?? 'end' };
      };
      console.log(
        JSON.stringify({
          job: job.name,
          shard,
          seed,
          answers: g.plain.answers.length,
          winners: Object.fromEntries(ARMS.map(a => [a, `${g[a].winner} T${g[a].turns}`])),
          nanAlarms: Object.fromEntries(ARMS.filter(a => a !== 'plain').map(a => [a, g[a].nanAlarms])),
          alarms: Object.fromEntries(ARMS.filter(a => a !== 'plain').map(a => [a, g[a].alarms])),
          ms: Object.fromEntries(ARMS.map(a => [a, g[a].ms])),
          loggedVsPlain: cmp('logged', 'plain'),
          noalarmVsPlain: cmp('noalarm', 'plain'),
          noopenVsPlain: cmp('noalarm-noopen', 'plain'),
          loggedVsNoalarm: cmp('logged', 'noalarm'),
        })
      );
    }
    console.error(`${job.name}: ${job.seeds.length} deals, arm ms ${JSON.stringify(armMs)}`);
  }
}
