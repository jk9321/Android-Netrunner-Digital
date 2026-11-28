/**
 * B5 arm F move reads (the red team's finding 6 a): every decision where the branch answers otherwise than beta, with a
 * compact board (both sides' clicks, credits, score, tags, the rig, the grip, the Corp's servers), from scripts/value-b5/retime.ts.
 * Two asking trees, base (beta, BASE) and branch (this checkout); S plays as beta. Local only.
 *   npx vite-node scripts/value-b5/moves.ts -- POOL=nrdb DEALS=1651 BASE=<beta sha>
 *
 * (from) B5 re-time (ai-value-b5-retime: V-B B5, a tag's worth in six Runner formulas, replayed on beta). LOCAL timing only, no
 * CI run (the Corp coordinator's brief, 2026-11-27). Trees (scripts/corp-owed/trees.ts makeTree; RULE-SCRIPT-RULES: the
 * tree that plays the source game is never asked or cleared):
 *   S       plays each deal: beta at BASE, as it is;
 *   base    beta at BASE, asked;
 *   ctl     beta at BASE again, asked: the time control (the asking's own noise) and a check that base reproduces;
 *   branch  this checkout's src (the replay), asked.
 * base, ctl and branch carry one probe patch (identical in both srcs): each tag clock price (a tagLossPerTurn work-out,
 * the count b5-fire-count.md read as 2.5x) is counted by viewer with its milliseconds.
 * At every decision of S each asking tree decides on a structuredClone with a fresh Normal agent given the playing
 * agent's fields, caches cleared, in an order that rotates. Per caller kind (side: main / run / prompt / off / rez): ms of
 * each ask, the answers that differ from base's, clock prices by view.
 *   SHARD=0/4 npx vite-node scripts/value-b5/retime.ts -- POOL=batch,nrdb PER_POOL=10 SPREAD=1 MAX_MS=500000
 * Summed by scripts/value-b5/retime-sum.mjs <out files>.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { makeTree, Patch } from '../corp-owed/trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const BASE = process.env.BASE ?? '5daabf13';
const POOLS = (process.env.POOL ?? 'batch,nrdb').split(',');
const PER_POOL = Number(process.env.PER_POOL ?? 10);
const SKIP = Number(process.env.SKIP ?? 0);
const MAX_MS = Number(process.env.MAX_MS ?? Infinity);
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/value-b5-retime', String(shard));
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const G = globalThis as any;

const PROBE: Patch[] = [
  [
    'ai/evaluate.ts',
    '  return withPricing({ pricingTagLoss: true }, () => tagLoss({ ...state }, viewer, skip));\n}',
    '  const probe = globalThis as { __b5tl?: (v: string, ms: number) => void };\n  const t0 = performance.now();\n  try {\n    return withPricing({ pricingTagLoss: true }, () => tagLoss({ ...state }, viewer, skip));\n  } finally {\n    probe.__b5tl?.(viewer, performance.now() - t0);\n  }\n}',
  ],
];

interface T {
  name: string;
  ai: any;
  po: any;
  core: any;
  decks: any;
  clear: () => void;
}
const MODULES: [string, string][] = [
  ['ai', './ai/index'],
  ['po', './ai/playout'],
  ['core', './core/index'],
  ['decks', './data/decks'],
  ['fx', './ai/effectValues'],
  ['iv', './ai/iceValues'],
  ['tm', './ai/threatModel'],
  ['hv', './ai/handValues'],
  ['vm', './ai/valueModel'],
  ['ev', './ai/evaluate'],
];
/** One entry file, static imports in order (scripts/corp-owed/trees.ts loadTree: one module instance per file). */
async function load(name: string, dir: string): Promise<T> {
  const entry = join(dir, 'src', '__b5.ts');
  writeFileSync(entry, MODULES.map(([n, p]) => `export * as ${n} from '${p}';`).join('\n') + '\n');
  const m: any = await import(/* @vite-ignore */ entry);
  const { fx, iv, tm, hv, vm } = m;
  return {
    name,
    ...m,
    clear: () => {
      hv.clearHandCaches?.();
      fx.clearDamageThreats?.();
      tm.clearThreatCaches?.();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}

type Rec = { seed: number; corpDeck: string; runnerDeck: string };
const DECK_POOL: any[] = [...ALL_DECKS, ...NRDB_TEST_DECKS];
const RUNS: Record<string, string> = { batch: '45830886377', nrdb: '45834898534' };
function dealState(t: T, rec: Rec): GameState {
  const c = DECK_POOL.find(d => d.side === 'corp' && d.name === rec.corpDeck);
  const r = DECK_POOL.find(d => d.side === 'runner' && d.name === rec.runnerDeck);
  if (!c || !r) throw new Error(`deal ${rec.seed}: deck not found (${rec.corpDeck} v ${rec.runnerDeck})`);
  return t.core.createInitialGameState(t.decks.deckGameSetup(rec.seed, c, r));
}
const SIX = ['Solidarity Badge', 'Eru Ayase-Pessoa', 'Hannah "Wheels" Pilintra', 'Arruaceiras Crew', 'Friend of a Friend', 'Borrowed Goods'];
const sixIn = (rec: Rec) => SIX.filter(x => x in (DECK_POOL.find(d => d.side === 'runner' && d.name === rec.runnerDeck)?.cards ?? {}));
const key = (a: unknown) => JSON.stringify(a ?? null);
const classInstance = (v: any) => v && typeof v === 'object' && !(v instanceof Map) && !(v instanceof Set) && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype;
function fieldsOf(agent: any): any {
  const o: any = {};
  for (const k of Object.keys(agent ?? {})) {
    const v = agent[k];
    if (typeof v === 'function') continue;
    o[k] = classInstance(v) ? { ...v } : v;
  }
  return structuredClone(o);
}
function copySnap(from: any, to: any) {
  for (const k of Object.keys(from ?? {})) {
    const v = structuredClone(from[k]);
    if (classInstance(to[k]) && v && typeof v === 'object') Object.assign(to[k], v);
    else to[k] = v;
  }
}


const title = (s: GameState, id?: string) => {
  const c = id ? S.core.findCardAnywhere(s, id) : undefined;
  return c ? `${S.core.cardDef(c).title}` : id ?? '';
};
const ids = (s: GameState, cs: any[]) => cs.map(c => `${S.core.cardDef(c).title}${c.rezzed === false ? '(u)' : ''}`).join(', ');
function boardOf(s: GameState) {
  const r = s.runner;
  const c = s.corp;
  return {
    runner: `${r.clicks}c ${r.credits}cr ${r.score}pt tags ${r.tags}; rig: ${ids(s, [...r.rig.programs, ...r.rig.hardware, ...r.rig.resources])}; grip: ${ids(s, r.grip)}`,
    corp: `${c.clicks}c ${c.credits}cr ${c.score}pt hq ${c.hq.length}; ` + Object.values(c.servers).map((sv: any) => `${sv.id}: ice [${sv.ice.map((x: any) => `${S.core.cardDef(x).title}${x.rezzed ? '' : '(u)'}`).join(', ')}] root [${sv.root.map((x: any) => `${S.core.cardDef(x).title}${x.rezzed ? '' : '(u)'}${x.advancementCounters ? '+' + x.advancementCounters : ''}`).join(', ')}]`).join('; '),
    run: s.activeRun ? `${s.activeRun.server} ice ${s.activeRun.icePosition}` : undefined,
    prompts: s.pendingPrompts.length ? s.pendingPrompts.map((p: any) => p.type ?? p.kind).join(',') : undefined,
  };
}
const named = (s: GameState, a: string) => a.replace(/"cardInstanceId":"(inst-\d+)"/g, (_m, id) => `"card":"${title(s, id)}"`);
/** The board's own tag against the flat 3 (the branch tree's owner, read as the Runner): what the six formulas read on the board. */
function tagRead(s: GameState) {
  const t = TT.branch;
  t.clear();
  const st = structuredClone(s);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return { flat: t.vm.RATES.tagAgainstRunner, taken: r2(t.ev.tagTaken(st)), removed: st.runner.tags > 0 ? r2(t.ev.tagRemoved(st)) : null };
}
type Tally = Record<string, number>;
const inc = (t: Tally, k: string, n = 1) => void (t[k] = (t[k] ?? 0) + n);
type Method = 'chooseAction' | 'chooseRez' | 'chooseOffTurn';
/** FULL=<sha>: a fourth asking tree, full B5's src at that commit (arm F's count: moves against base and against full B5). */
const FULL = process.env.FULL ?? '';
const ASKS: string[] = ['base', 'branch'];
let S: T;
const TT: Record<string, T> = {};
function ask(t: T, side: 'corp' | 'runner', method: Method, s: GameState, from: any): string {
  t.clear();
  const agent: any = t.ai.createAgent(side, 'normal');
  copySnap(fieldsOf(from), agent);
  const st = structuredClone(s);
  const args = method === 'chooseRez' ? [st, t.po.rezCandidates(st, st.priority?.step)] : [st];
  try {
    return key(agent[method](...args));
  } catch (e) {
    return `error: ${(e as Error).message.slice(0, 100)}`;
  }
}

function timeDeal(pool: string, rec: Rec) {
  const t0 = Date.now();
  const ms: Tally = {};
  const n: Tally = {};
  const differ: Tally = {};
  const clock: Tally = {};
  const first: Record<string, any> = {};
  let i = 0;
  const decide = (side: 'corp' | 'runner', method: Method, s: GameState, agent: any, own: () => unknown) => {
    const kind = method === 'chooseRez' ? 'rez' : method === 'chooseOffTurn' ? 'off' : s.pendingPrompts.length ? 'prompt' : s.activeRun ? 'run' : 'main';
    const k = `${side}:${kind}`;
    const answers: Record<string, string> = {};
    for (let j = 0; j < ASKS.length; j++) {
      const a = ASKS[(j + i) % ASKS.length];
      G.__b5tl = (v: string, d: number) => {
        inc(clock, `${a} ${k} ${v}`);
        inc(clock, `${a} ${k} ${v}ms`, d);
      };
      const ts = performance.now();
      answers[a] = ask(TT[a], side, method, s, agent);
      inc(ms, `${a} ${k}`, performance.now() - ts);
      G.__b5tl = undefined;
    }
    inc(n, k);
    if (answers.branch !== answers.base) out({ kind: 'move', seed: rec.seed, i, T: s.turnNumber, k, active: s.activePlayer, board: boardOf(s), tag: tagRead(s), base: named(s, answers.base), branch: named(s, answers.branch) });
    for (const a of ASKS.slice(1))
      if (answers[a] !== answers.base) {
        inc(differ, `${a} ${k}`);
        if (!first[a]) first[a] = { i, T: s.turnNumber, k, tags: s.runner.tags, base: answers.base.slice(0, 160), [a]: answers[a].slice(0, 160) };
      }
    if (FULL && answers.branch !== answers.full) {
      inc(differ, `branchVsFull ${k}`);
      if (!first.branchVsFull) first.branchVsFull = { i, T: s.turnNumber, k, tags: s.runner.tags, full: answers.full.slice(0, 160), branch: answers.branch.slice(0, 160) };
    }
    i++;
    return own();
  };
  const watched = (side: 'corp' | 'runner', agent: any) =>
    new Proxy(agent, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (prop !== 'chooseAction' && prop !== 'chooseRez' && prop !== 'chooseOffTurn') return v;
        return (s: GameState, ...rest: unknown[]) => decide(side, prop as Method, s, target, () => v.apply(target, [s, ...rest]));
      },
    });
  S.clear();
  const g = new S.po.GameRunner(dealState(S, rec), { corp: watched('corp', S.ai.createAgent('corp', 'normal')), runner: watched('runner', S.ai.createAgent('runner', 'normal')) });
  for (let j = 0; j < 4000; j++) if (!g.step()) break;
  const r1 = (t: Tally) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v * 10) / 10]));
  out({ kind: 'time', pool, seed: rec.seed, corpDeck: rec.corpDeck, runnerDeck: rec.runnerDeck, six: sixIn(rec), decisions: i, winner: g.state.winner ?? null, T: g.state.turnNumber, n, ms: r1(ms), differ, clock: r1(clock), first, wall: Date.now() - t0 });
}

async function main() {
  const started = Date.now();
  S = await load('S', makeTree(join(root, 'S'), { ref: BASE }));
  TT.base = await load('base', makeTree(join(root, 'base'), { ref: BASE, patches: PROBE }));
  TT.branch = await load('branch', makeTree(join(root, 'branch'), { patches: PROBE }));
  const sources: { pool: string; rec: Rec }[] = [];
  for (const pool of POOLS) {
    const recs: Rec[] = JSON.parse(readFileSync(`scripts/corp-owed/deals-${RUNS[pool]}.json`, 'utf8'));
    const picked = recs.filter(r => !DEALS.length || DEALS.includes(String(r.seed)));
    // SPREAD=1: PER_POOL deals spread evenly through the pool's file (its decks in order), SKIP=k shifts the pick by k
    const step = process.env.SPREAD === '1' ? Math.max(1, Math.floor(picked.length / PER_POOL)) : 1;
    for (const r of picked.filter((_, j) => (j - SKIP) % step === 0 && j >= SKIP).slice(0, PER_POOL)) sources.push({ pool, rec: r });
  }
  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    if (Date.now() - started > MAX_MS) break;
    try {
      timeDeal(src.pool, src.rec);
    } catch (err) {
      out({ kind: 'err', pool: src.pool, seed: src.rec.seed, error: (err as Error).stack?.slice(0, 500) });
    }
  }
  out({ kind: 's', shard, base: BASE, ms: Date.now() - started });
}
main().catch(err => {
  console.error(err);
  process.exit(1);
});
