/**
 * F108 count, two follow-ups the Corp-side coordinator asked after step 0 (2026-11-25 06:56Z). Counts only.
 *
 * (1) Whose clear: at every Runner decision of the source game that took REMOVE_TAG, a fresh Normal Runner of the base
 *     tree (the source agent's own fields copied, caches cleared) ranks the main actions (rankMainActions: the flat
 *     REMOVE_TAG score of runnerAI.ts:204 against every other move's score) and decides (chooseAction). 'flat': the
 *     ranking's top is REMOVE_TAG; 'planner': the top is another move and the decision is REMOVE_TAG (the planner
 *     overruled the ranking). Also every tagged main decision with a click and 2 credits that the source did not clear,
 *     the same two reads (the ranking's top was REMOVE_TAG and the planner overruled it, or not).
 * (2) The clock's input by arm and view: on every Runner main decision board with a resource installed, tagLossPerTurn
 *     (evaluate.ts:408, skip 0) under base, resOnly and owner, each view: on the board as it is (tagged boards), and on an
 *     untagged board with one tag added (the clock as tagCost reads it).
 *
 *   SHARD=0/64 npx vite-node scripts/tag-owner/views.ts   (POOL=batch,nrdb, DEALS=...)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { TreeName, makeTrees } from './trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const POOLS = (process.env.POOL ?? 'batch,nrdb').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/tag-owner-views', String(shard));
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r3 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : String(x));
const RUNS: Record<string, string> = { batch: '45553599707', nrdb: '45555227992' };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
const key = (a: unknown) => JSON.stringify(a ?? null);

interface T {
  ai: any;
  po: any;
  core: any;
  decks: any;
  ev: any;
  hv: any;
  pricing: any;
  clear: () => void;
}
async function loadTree(dir: string): Promise<T> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const files = ['ai/index.ts', 'ai/playout.ts', 'core/index.ts', 'data/decks.ts', 'ai/evaluate.ts', 'ai/handValues.ts', 'ai/valueModel.ts', 'ai/effectValues.ts', 'ai/iceValues.ts', 'ai/threatModel.ts', 'ai/pricing.ts'];
  const mods: any[] = [];
  for (const p of files) mods.push(await m(p));
  const [ai, po, core, decks, ev, hv, vm, fx, iv, tm, pricing] = mods;
  return {
    ai,
    po,
    core,
    decks,
    ev,
    hv,
    pricing,
    clear: () => {
      hv.clearHandCaches();
      fx.clearDamageThreats();
      tm.clearThreatCaches?.();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}
const TREES = ['base', 'resOnly', 'owner'] as const;
let S: T;
const A = {} as Record<(typeof TREES)[number], T>;

const classInstance = (v: any) => v && typeof v === 'object' && !(v instanceof Map) && !(v instanceof Set) && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype;
/** A snapshot of the source agent's fields into a fresh agent: a field that is a class instance there gets the snapshot's fields. */
function copyFields(from: any, to: any) {
  for (const k of Object.keys(from)) {
    const v = structuredClone(from[k]);
    if (classInstance(to[k]) && v && typeof v === 'object') Object.assign(to[k], v);
    else to[k] = v;
  }
}
/** (1): the base tree's ranking top and decision on a copy, with the source agent's fields. */
function whose(s: GameState, from: any) {
  const t = A.base;
  t.clear();
  const ag: any = t.ai.createAgent('runner', 'normal');
  copyFields(from, ag);
  const st = structuredClone(s);
  const ranked = t.pricing.asSide('runner', () => ag.rankMainActions(st));
  t.clear();
  const ag2: any = t.ai.createAgent('runner', 'normal');
  copyFields(from, ag2);
  const pick = ag2.chooseAction(structuredClone(s));
  const tagScore = ranked.find((x: any) => x.action.type === 'REMOVE_TAG')?.score;
  return { top: ranked[0]?.action.type, topScore: r3(ranked[0]?.score), tagScore: tagScore === undefined ? null : r3(tagScore), second: ranked[1]?.action.type, pick: pick?.type };
}
function loss(t: T, s: GameState, v: 'corp' | 'runner'): number {
  t.clear();
  const st = structuredClone(s);
  return t.pricing.asSide(v, () => {
    t.hv.decisionContext(st, v);
    return t.ev.tagLossPerTurn(st, v, 0) as number;
  });
}
const losses = (s: GameState) => Object.fromEntries(TREES.flatMap(a => (['runner', 'corp'] as const).map(v => [`${a}.${v}`, r3(loss(A[a], s, v))])));

function deal(pool: string, rec: any) {
  S.clear();
  const src = `${pool}:${rec.seed}`;
  const c = DECK_POOL.find(d => d.side === 'corp' && d.name === rec.corpDeck)!;
  const r = DECK_POOL.find(d => d.side === 'runner' && d.name === rec.runnerDeck)!;
  const ag = { corp: S.ai.createAgent('corp', 'normal'), runner: S.ai.createAgent('runner', 'normal') };
  const run = new S.po.GameRunner(S.core.createInitialGameState(S.decks.deckGameSetup(rec.seed, c, r)), ag);
  const cr: number[] = [];
  const sc: number[] = [];
  let last = -1;
  let boards = 0;
  for (let n = 0; n < 4000; n++) {
    const s: GameState = run.state;
    if (s.turnNumber !== last && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      last = s.turnNumber;
    }
    const main = S.core.actingSide(s) === 'runner' && s.activePlayer === 'runner' && !s.pendingPrompts.length && !s.activeRun && !(s.priority && s.priority.holder !== s.activePlayer);
    // The source agent's fields before it decides (copied; the source agent is never asked by this script)
    const fields = main && s.runner.tags > 0 && s.runner.clicks >= 1 && s.runner.credits >= 2 ? structuredClone(Object.fromEntries(Object.entries(ag.runner).filter(([, v]) => typeof v !== 'function').map(([k, v]) => [k, classInstance(v) ? { ...(v as object) } : v]))) : null;
    const board = main ? structuredClone(s) : null;
    if (!run.step()) break;
    if (board && fields) {
      out({ kind: 'w', pool, src, T: board.turnNumber, tags: board.runner.tags, clicks: board.runner.clicks, res: board.runner.rig.resources.length, srcPick: (run.last as any).type, ...whose(board, fields) });
    }
    if (board && board.runner.rig.resources.length > 0) {
      boards++;
      if (board.runner.tags > 0) out({ kind: 'l', pool, src, tagged: true, tags: board.runner.tags, ...losses(board) });
      else {
        const one = structuredClone(board);
        one.runner.tags = 1;
        out({ kind: 'l', pool, src, tagged: false, tags: 1, ...losses(one) });
      }
    }
  }
  const matches = (run.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
  out({ kind: 'g', pool, src, boards, matchesBatch: matches });
}

async function main() {
  const names: TreeName[] = ['source', ...TREES];
  const dirs = makeTrees(root, names);
  S = await loadTree(dirs.source);
  for (const a of TREES) A[a] = await loadTree(dirs[a]);
  const sources: { pool: string; rec: any }[] = [];
  for (const pool of POOLS) for (const r of JSON.parse(readFileSync(`scripts/tag-owner/deals-${RUNS[pool]}.json`, 'utf8'))) if (!DEALS.length || DEALS.includes(String(r.seed))) sources.push({ pool, rec: r });
  const t0 = Date.now();
  for (const [k, x] of sources.entries()) {
    if (k % shards !== shard) continue;
    try {
      deal(x.pool, x.rec);
    } catch (e) {
      out({ kind: 'err', pool: x.pool, src: x.rec.seed, error: (e as Error).stack?.slice(0, 400) });
    }
  }
  out({ kind: 's', shard, ms: Date.now() - t0 });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
