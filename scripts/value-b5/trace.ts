/**
 * B5 caller trace (the Corp coordinator's ruling on b5-retime/report.md, 2026-11-27): which callers ask the Runner-view
 * tag clock on boards it never priced before. LOCAL only, src unchanged (a probe patch in the scratch trees only).
 * Trees (scripts/corp-owed/trees.ts makeTree; RULE-SCRIPT-RULES: S plays and is never asked or cleared):
 *   S       beta at BASE, plays each deal;
 *   base    beta at BASE with the probe, asked;
 *   branch  this checkout's src (the replay) with the probe, asked.
 * The probe sits in tagLossPerTurn, which runs only when the clock's memo (valueModel memo: the state object and the
 * pricing frame's key) misses: each call is one clock price. Per price: viewer, the stack, the pricing frame key, and
 * whether the same board was already priced in this ask (a) on the same object under another frame key, (b) on another
 * object with the same content key (valueModel fingerprint + skip + viewer), or (c) never.
 * A price is B5's when its stack holds one of the six formulas (cards/liberation.ts, cards/vantagePoint.ts) calling
 * tagTaken/tagRemoved; the card is named from the formula's line. For those, the chain of callers above the formula.
 *   npx vite-node scripts/value-b5/trace.ts -- POOL=nrdb DEALS=1651 BASE=<beta sha>
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
const BASE = process.env.BASE ?? '5daabf13';
const POOL = process.env.POOL ?? 'nrdb';
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/value-b5-trace');
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const G = globalThis as any;
Error.stackTraceLimit = 300;

const PROBE: Patch[] = [
  ['ai/evaluate.ts', "import { CARDS } from './cards';\n", "import { CARDS } from './cards';\nimport { frameKeys as __fk } from './pricing';\nimport { fingerprint as __fp } from './valueModel';\n"],
  [
    'ai/evaluate.ts',
    '  return withPricing({ pricingTagLoss: true }, () => tagLoss({ ...state }, viewer, skip));\n}',
    '  const __v = withPricing({ pricingTagLoss: true }, () => tagLoss({ ...state }, viewer, skip));\n  (globalThis as any).__b5tr?.(state, viewer, skip, __fk().pricing, __fp(state), new Error().stack, __v);\n  return __v;\n}',
  ],
];
const CARD_AT: Record<string, string> = {
  'liberation.ts:46': 'Solidarity Badge',
  'liberation.ts:74': 'Eru Ayase-Pessoa',
  'liberation.ts:86': 'Hannah Wheels Pilintra',
  'liberation.ts:474': 'Arruaceiras Crew',
  'liberation.ts:488': 'Friend of a Friend',
  'vantagePoint.ts:127': 'Borrowed Goods',
};

interface T {
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
];
async function load(dir: string): Promise<T> {
  const entry = join(dir, 'src', '__b5t.ts');
  writeFileSync(entry, MODULES.map(([n, p]) => `export * as ${n} from '${p}';`).join('\n') + '\n');
  const m: any = await import(/* @vite-ignore */ entry);
  const { fx, iv, tm, hv, vm } = m;
  return {
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
  return t.core.createInitialGameState(t.decks.deckGameSetup(rec.seed, c, r));
}
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
type Tally = Record<string, number>;
const inc = (t: Tally, k: string, n = 1) => void (t[k] = (t[k] ?? 0) + n);

/** Frames as "fn file:line" (src files only, the probe's own frame and tagsWorth's plumbing dropped). */
function frames(stack: string): { fn: string; at: string }[] {
  const fs: { fn: string; at: string }[] = [];
  for (const l of stack.split('\n').slice(1)) {
    const m = l.match(/at (?:(\S+) \()?(?:.*\/src\/)([^:)]+):(\d+)/);
    if (!m) continue;
    fs.push({ fn: (m[1] ?? '<anon>').replace(/^Object\./, ''), at: `${m[2].replace(/^ai\//, '')}:${m[3]}` });
  }
  return fs;
}
const PLUMB = /^(tagLossPerTurn|tagClock|tagsWorth|guardLoop|logValue|memo|tagTaken|tagRemoved|withPricing|asSide|<anon>)$/;

let S: T;
const TT: Record<string, T> = {};
function traceDeal(rec: Rec) {
  const t0 = Date.now();
  const n: Tally = {};
  const prices: Tally = {}; // `${tree} ${k} ${viewer} ${b5|other} ${where}`
  const byCard: Tally = {};
  const chains: Tally = {};
  const firstAbove: Tally = {};
  const exact: Tally = {};
  const frameDiffs: Tally = {};
  const lastKey = new WeakMap<object, Record<string, string>>();
  let i = 0;
  const decide = (side: 'corp' | 'runner', method: string, s: GameState, agent: any, own: () => unknown) => {
    const kind = method === 'chooseRez' ? 'rez' : method === 'chooseOffTurn' ? 'off' : s.pendingPrompts.length ? 'prompt' : s.activeRun ? 'run' : 'main';
    const k = `${side}:${kind}`;
    inc(n, k);
    for (const tree of ['base', 'branch']) {
      const t = TT[tree];
      const objs = new WeakMap<object, Map<string, number>>();
      const contents = new Map<string, number>();
      const narrowOf = new WeakMap<object, Map<string, { v: number; fkey: string }>>();
      G.__b5tr = (st: GameState, viewer: string, skip: number, fkey: string, print: string, stack: string, v: number) => {
        const ok = `${viewer}:${skip}`;
        const fs = frames(stack);
        const ci = fs.findIndex(f => CARD_AT[f.at.replace(/^cards\//, '')]);
        const b5 = ci >= 0;
        let seen = objs.get(st);
        const ck = `${viewer}:${skip}:${print}`;
        const prev = seen?.get(ok);
        const where = prev !== undefined ? 'sameObjOtherFrame' : contents.has(ck) ? 'sameContentOtherObj' : 'new';
        // exactness: the value a narrower key would have served (the earlier price of this board) against this one
        const served = prev !== undefined ? prev : contents.get(ck);
        if (served !== undefined) inc(exact, `${tree} ${viewer} ${b5 ? 'b5' : 'other'} ${where} ${Object.is(served, v) ? 'equal' : 'DIFFERS'}`);
        if (prev !== undefined && !Object.is(prev, v) && tree === 'branch') inc(frameDiffs, `${lastKey.get(st)?.[ok] ?? '?'} -> ${fkey}`);
        if (!seen) objs.set(st, (seen = new Map()));
        seen.set(ok, v);
        lastKey.set(st, { ...(lastKey.get(st) ?? {}), [ok]: fkey });
        contents.set(ck, v);
        // narrower memo keys on the same object (the lever's exactness): N1 keeps the frame's averaging and pricingIce
        // fields, N2 every head field but the sides, the leaves and the breaker guard
        const parts = fkey.split(':');
        for (const [nk, keepAt] of [['N1', [4, 7]], ['N2', [4, 5, 7, 8, 9, 10]]] as const) {
          const narrow = `${nk}:${ok}:${keepAt.map(j => parts[j]).join(':')}`;
          let m = narrowOf.get(st);
          if (!m) narrowOf.set(st, (m = new Map()));
          const hit = m.get(narrow);
          if (hit && hit.fkey !== fkey) inc(exact, `${tree} ${viewer} ${b5 ? 'b5' : 'other'} ${nk}-served ${Object.is(hit.v, v) ? 'equal' : 'DIFFERS'}`);
          if (!hit) m.set(narrow, { v, fkey });
        }
        inc(prices, `${tree} ${k} ${viewer} ${b5 ? 'b5' : 'other'} ${where}`);
        if (!b5 || tree !== 'branch' || viewer !== 'runner') return;
        const card = CARD_AT[fs[ci].at.replace(/^cards\//, '')];
        inc(byCard, `${k} ${card} ${where}`);
        inc(byCard, `tags ${card} ${st.runner.tags > 0 ? "tagged" : "untagged"}`);
        const above = fs.slice(ci + 1).filter(f => !PLUMB.test(f.fn));
        const chain: string[] = [];
        for (const f of above) if (chain[chain.length - 1] !== f.fn) chain.push(f.fn);
        inc(firstAbove, `${k} ${above[0] ? `${above[0].fn} ${above[0].at}` : '?'}`);
        inc(chains, `${k} ${chain.slice(0, 7).join(' < ')}`);
      };
      t.clear();
      const a: any = t.ai.createAgent(side, 'normal');
      copySnap(fieldsOf(agent), a);
      const st = structuredClone(s);
      try {
        a[method](...(method === 'chooseRez' ? [st, t.po.rezCandidates(st, st.priority?.step)] : [st]));
      } catch (e) {
        inc(prices, `error ${tree} ${(e as Error).message.slice(0, 60)}`);
      }
      G.__b5tr = undefined;
    }
    i++;
    return own();
  };
  const watched = (side: 'corp' | 'runner', agent: any) =>
    new Proxy(agent, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (prop !== 'chooseAction' && prop !== 'chooseRez' && prop !== 'chooseOffTurn') return v;
        return (s: GameState, ...rest: unknown[]) => decide(side, prop as string, s, target, () => v.apply(target, [s, ...rest]));
      },
    });
  S.clear();
  const g = new S.po.GameRunner(dealState(S, rec), { corp: watched('corp', S.ai.createAgent('corp', 'normal')), runner: watched('runner', S.ai.createAgent('runner', 'normal')) });
  for (let j = 0; j < 4000; j++) if (!g.step()) break;
  out({ kind: 'trace', seed: rec.seed, corpDeck: rec.corpDeck, runnerDeck: rec.runnerDeck, decisions: i, n, prices, byCard, firstAbove, chains, exact, frameDiffs, wall: Date.now() - t0 });
}

async function main() {
  S = await load(makeTree(join(root, 'S'), { ref: BASE }));
  TT.base = await load(makeTree(join(root, 'base'), { ref: BASE, patches: PROBE }));
  TT.branch = await load(makeTree(join(root, 'branch'), { patches: PROBE }));
  const recs: Rec[] = JSON.parse(readFileSync(`scripts/corp-owed/deals-${RUNS[POOL]}.json`, 'utf8'));
  for (const r of recs.filter(r => DEALS.includes(String(r.seed)))) {
    try {
      traceDeal(r);
    } catch (err) {
      out({ kind: 'err', seed: r.seed, error: (err as Error).stack?.slice(0, 500) });
    }
  }
}
main().catch(err => {
  console.error(err);
  process.exit(1);
});
