/**
 * Planner speed, step 1 (ai-planner-fast): where the AI's decision time goes over WHOLE batch games.
 *
 * Plays batch deals (the same seeds and deck pairings as scripts/corp-losses.ts, shipped decks, Normal v Normal)
 * with the V8 sampling profiler running for the whole game, and splits the samples by the decision they fall in
 * (Corp main decisions, Corp rez, Runner decisions, the engine between decisions). Per bucket it sums each
 * function's self and inclusive time, so the average decision and the slow tail can be compared.
 *
 *   DEALS=1001,1141 OUT=prof-0.json npx vite-node scripts/planner-profile.ts
 *   npx vite-node scripts/planner-profile.ts -- --sum prof-*.json       (merge shards, print the tables)
 * NOPROF=1 times the decisions without the profiler (a timing pair); RAW=prefix also writes each game's .cpuprofile.
 *
 * Play is unchanged: the wrappers only read the clock around each call.
 */
import { Session } from 'node:inspector';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { GameState, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { valueLoops } from '../src/ai/valueModel';
import { playLogged } from './lossLog';

type Bucket = 'corpAll' | 'corpUnder1s' | 'corp1to5s' | 'corpOver5s' | 'corpOver10s' | 'corpRez' | 'runner' | 'other';
interface Agg { ms: number; self: Record<string, number>; incl: Record<string, number> }
interface Out {
  games: number;
  wallMs: number;
  decisions: { seed: number; turn: number; ms: number }[];
  runnerMs: number;
  rezMs: number;
  buckets: Partial<Record<Bucket, Agg>>;
  records: Record<number, string>;
}

const nowUs = () => Number(process.hrtime.bigint() / 1000n);

function post<T>(s: Session, method: string, params?: object): Promise<T> {
  return new Promise((res, rej) => s.post(method, params ?? {}, (e, r) => (e ? rej(e) : res(r as T))));
}

interface ProfNode { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }
interface Profile { nodes: ProfNode[]; startTime: number; endTime: number; samples: number[]; timeDeltas: number[] }

async function profileDeals(deals: number[]): Promise<Out> {
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  const session = new Session();
  session.connect();
  await post(session, 'Profiler.enable');
  await post(session, 'Profiler.setSamplingInterval', { interval: 500 });
  const out: Out = { games: 0, wallMs: 0, decisions: [], runnerMs: 0, rezMs: 0, buckets: {}, records: {} };
  for (const seed of deals) {
    const p = Math.floor((seed - 1001) / 10);
    const c = corpDecks[Math.floor(p / runnerDecks.length)];
    const r = runnerDecks[p % runnerDecks.length];
    valueLoops.clear();
    const corp = createAgent('corp', 'normal');
    const runner = createAgent('runner', 'normal');
    // decision windows in CLOCK_MONOTONIC microseconds (the clock the profile's sample times use)
    const windows: { from: number; to: number; kind: 'corp' | 'rez' | 'runner'; ms: number }[] = [];
    const wrap = <A extends unknown[], R>(f: (...a: A) => R, kind: 'corp' | 'rez' | 'runner', onDone?: (ms: number, a: A) => void) =>
      (...a: A): R => {
        const from = nowUs();
        const v = f(...a);
        const to = nowUs();
        windows.push({ from, to, kind, ms: (to - from) / 1000 });
        onDone?.((to - from) / 1000, a);
        return v;
      };
    corp.chooseAction = wrap(corp.chooseAction.bind(corp), 'corp', (ms, [s]) => out.decisions.push({ seed, turn: (s as GameState).turnNumber, ms }));
    if (corp.chooseRez) corp.chooseRez = wrap(corp.chooseRez.bind(corp), 'rez');
    runner.chooseAction = wrap(runner.chooseAction.bind(runner), 'runner');
    if (runner.chooseOffTurn) runner.chooseOffTurn = wrap(runner.chooseOffTurn.bind(runner), 'runner');
    if (!process.env.NOPROF) await post(session, 'Profiler.start');
    const t0 = performance.now();
    const record = playLogged(createInitialGameState(deckGameSetup(seed, c, r)), { corp, runner }, { corp: c.name, runner: r.name });
    const wall = performance.now() - t0;
    const profile = process.env.NOPROF ? undefined : (await post<{ profile: Profile }>(session, 'Profiler.stop')).profile;
    out.records[seed] = createHash('sha1').update(JSON.stringify({ ...record, seed })).digest('hex').slice(0, 12);
    out.games++;
    out.wallMs += wall;
    if (profile) attribute(profile, windows, out);
    if (profile && process.env.RAW) writeFileSync(`${process.env.RAW}-${seed}.cpuprofile`, JSON.stringify(profile));
    const corpMs = windows.filter(w => w.kind === 'corp').reduce((a, w) => a + w.ms, 0);
    console.error(`deal ${seed} ${c.name} v ${r.name}: ${(wall / 1000).toFixed(0)} s, corp ${(corpMs / 1000).toFixed(0)} s, record ${out.records[seed]}`);
  }
  return out;
}

function attribute(profile: Profile, windows: { from: number; to: number; kind: string; ms: number }[], out: Out) {
  const byId = new Map<number, ProfNode>();
  const parent = new Map<number, number>();
  for (const n of profile.nodes) byId.set(n.id, n);
  for (const n of profile.nodes) for (const ch of n.children ?? []) parent.set(ch, n.id);
  const keyOf = (n: ProfNode) => {
    const f = n.callFrame;
    const file = f.url.split('/').pop()?.split('?')[0] ?? '';
    return `${f.functionName || '(anon)'} ${file}:${f.lineNumber + 1}`;
  };
  const stackCache = new Map<number, string[]>();
  const stackOf = (id: number): string[] => {
    let s = stackCache.get(id);
    if (s) return s;
    const keys = new Set<string>();
    for (let cur: number | undefined = id; cur !== undefined; cur = parent.get(cur)) keys.add(keyOf(byId.get(cur)!));
    s = [...keys];
    stackCache.set(id, s);
    return s;
  };
  for (const w of windows) {
    if (w.kind === 'rez') out.rezMs += w.ms;
    if (w.kind === 'runner') out.runnerMs += w.ms;
  }
  const sorted = [...windows].sort((a, b) => a.from - b.from);
  let wi = 0;
  let t = profile.startTime;
  for (let i = 0; i < profile.samples.length; i++) {
    t += profile.timeDeltas[i];
    // the sample covers the interval up to the next sample
    const dt = (i + 1 < profile.timeDeltas.length ? profile.timeDeltas[i + 1] : 0) / 1000;
    if (dt <= 0) continue;
    while (wi < sorted.length && sorted[wi].to < t) wi++;
    const w = wi < sorted.length && sorted[wi].from <= t ? sorted[wi] : undefined;
    const buckets: Bucket[] = [];
    if (!w) buckets.push('other');
    else if (w.kind === 'runner') buckets.push('runner');
    else if (w.kind === 'rez') buckets.push('corpRez');
    else {
      buckets.push('corpAll');
      buckets.push(w.ms < 1000 ? 'corpUnder1s' : w.ms < 5000 ? 'corp1to5s' : 'corpOver5s');
      if (w.ms >= 10000) buckets.push('corpOver10s');
    }
    const node = byId.get(profile.samples[i])!;
    const self = keyOf(node);
    const stack = stackOf(node.id);
    for (const b of buckets) {
      const agg = (out.buckets[b] ??= { ms: 0, self: {}, incl: {} });
      agg.ms += dt;
      agg.self[self] = (agg.self[self] ?? 0) + dt;
      for (const k of stack) agg.incl[k] = (agg.incl[k] ?? 0) + dt;
    }
  }
}

function merge(files: string[]): Out {
  const all: Out = { games: 0, wallMs: 0, decisions: [], runnerMs: 0, rezMs: 0, buckets: {}, records: {} };
  for (const f of files) {
    const o = JSON.parse(readFileSync(f, 'utf8')) as Out;
    all.games += o.games;
    all.wallMs += o.wallMs;
    all.runnerMs += o.runnerMs;
    all.rezMs += o.rezMs;
    all.decisions.push(...o.decisions);
    Object.assign(all.records, o.records);
    for (const [b, agg] of Object.entries(o.buckets) as [Bucket, Agg][]) {
      const into = (all.buckets[b] ??= { ms: 0, self: {}, incl: {} });
      into.ms += agg.ms;
      for (const [k, v] of Object.entries(agg.self)) into.self[k] = (into.self[k] ?? 0) + v;
      for (const [k, v] of Object.entries(agg.incl)) into.incl[k] = (into.incl[k] ?? 0) + v;
    }
  }
  return all;
}

function report(o: Out) {
  const ms = o.decisions.map(d => d.ms).sort((a, b) => a - b);
  const sum = ms.reduce((a, b) => a + b, 0);
  const q = (p: number) => Math.round(ms[Math.min(ms.length - 1, Math.floor(ms.length * p))]);
  const per100 = (n: number) => +((n * 100) / o.games).toFixed(1);
  const lines: string[] = [];
  lines.push(`games ${o.games}, wall ${(o.wallMs / 1000).toFixed(0)} s; Corp main decisions ${ms.length}, ${(sum / 1000).toFixed(0)} s (${((100 * sum) / o.wallMs).toFixed(0)}% of wall); Corp rez ${(o.rezMs / 1000).toFixed(0)} s; Runner ${(o.runnerMs / 1000).toFixed(0)} s`);
  lines.push(`Corp decision ms: mean ${Math.round(sum / ms.length)}, p50 ${q(0.5)}, p90 ${q(0.9)}, p99 ${q(0.99)}, max ${Math.round(ms[ms.length - 1])}; over 5 s ${per100(ms.filter(x => x > 5000).length)}/100 games, over 10 s ${per100(ms.filter(x => x > 10000).length)}, over 20 s ${per100(ms.filter(x => x > 20000).length)}`);
  const share = (lo: number, hi: number) => ms.filter(x => x >= lo && x < hi).reduce((a, b) => a + b, 0);
  lines.push(`Corp time by decision length: <1 s ${((100 * share(0, 1000)) / sum).toFixed(0)}%, 1-5 s ${((100 * share(1000, 5000)) / sum).toFixed(0)}%, 5-10 s ${((100 * share(5000, 10000)) / sum).toFixed(0)}%, >=10 s ${((100 * share(10000, Infinity)) / sum).toFixed(0)}%`);
  const top = (rec: Record<string, number>, total: number, n: number) =>
    Object.entries(rec).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `  ${((100 * v) / total).toFixed(1).padStart(5)}%  ${(v / 1000).toFixed(1).padStart(7)} s  ${k}`);
  for (const b of ['corpAll', 'corpUnder1s', 'corp1to5s', 'corpOver5s', 'corpOver10s', 'runner', 'other'] as Bucket[]) {
    const agg = o.buckets[b];
    if (!agg) continue;
    lines.push('', `== ${b}: ${(agg.ms / 1000).toFixed(0)} s sampled ==`, ' inclusive:', ...top(agg.incl, agg.ms, b.startsWith('corp') ? 60 : 25), ' self:', ...top(agg.self, agg.ms, 25));
  }
  return lines.join('\n');
}

const args = process.argv.slice(2).filter(a => a !== '--');
if (args[0] === '--sum') {
  const o = merge(args.slice(1));
  console.log(report(o));
  console.log('\nrecords ' + JSON.stringify(o.records));
} else {
  const deals = (process.env.DEALS ?? '').split(',').filter(Boolean).map(Number);
  profileDeals(deals).then(o => {
    if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(o));
    else console.log(report(o));
  });
}
