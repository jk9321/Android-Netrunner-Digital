/**
 * Speed pass G0, memory (ruling-rev0.md "Lever G red team, ruled" 4; findings 4c and 4d): one tree, lever G on or off
 * (scripts/speed-pass/g-patches.ts; off builds every board and stores none), run with --expose-gc. Per top-level decision:
 * the boards G holds, the real peak heapUsed over the decision (polled every 32 board asks), the heap after a gc at the
 * NEXT decision's start (the leak check against the off arm), and the G boards still alive then (FinalizationRegistry).
 *   ARM=on|off  BOARD=<saved state .json> (one decision)   or   POOL=batch|nrdb DEAL=<seed> [FROM=<step>] [TO=<step>]
 *   node --expose-gc node_modules/vite-node/dist/cli.mjs scripts/speed-pass/g0-heap.ts -- ARM=on BOARD=tests/fixtures/tag-loss-time/t18-corp.json
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeHeapSnapshot } from 'node:v8';
import type { GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { HOOKS, applyPatches } from '../runner-rework/core-hooks';
import { loadTree } from '../runner-rework/facts-trees';
import { gPatches } from './g-patches';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const ARM = process.env.ARM ?? 'on';
const gc = (globalThis as any).gc as (() => void) | undefined;
if (!gc) throw new Error('run with node --expose-gc');
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const mb = (b: number) => Math.round(b / 1e5) / 10;
const tick = () => new Promise(r => setTimeout(r, 0));

async function settle(): Promise<number> {
  // Finalization callbacks run between turns of the event loop: gc, wait, gc again
  for (let i = 0; i < 3; i++) {
    gc!();
    await tick();
  }
  return process.memoryUsage().heapUsed;
}

async function main() {
  const dir = resolve('node_modules/.cache/g0-heap', ARM);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync('src', resolve(dir, 'src'), { recursive: true });
  const read = (p: string) => readFileSync(p, 'utf8');
  const write = (p: string, t: string) => writeFileSync(p, t);
  // Only the two hooks whose lines G's patches match (the discard answer's name, the oracle's scope label)
  applyPatches(dir, HOOKS.filter(([, , to]) => to.includes('__ans') || to.includes("__lkScope: 'oracle'")), 'hooks', read, write);
  applyPatches(dir, gPatches(ARM === 'off'), `G ${ARM}`, read, write);
  const t = (await loadTree(ARM, dir)) as any;
  const G = globalThis as any;
  let peak = 0;
  G.__g0heap = () => {
    const h = process.memoryUsage().heapUsed;
    if (h > peak) peak = h;
  };
  const agents = { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') };
  // The script holds no board: only the runner does (a held root would keep its G tree alive)
  const start = (): GameState => {
    if (process.env.BOARD) return JSON.parse(readFileSync(process.env.BOARD, 'utf8'));
    else {
      const pools: Record<string, string> = { batch: 'scripts/f117/recs/deals-45940481387.json', nrdb: 'scripts/runner-rework/facts-deals-45458221138.json' };
      const deals = JSON.parse(readFileSync(pools[process.env.POOL ?? 'batch'], 'utf8')) as { seed: number; corpDeck: string; runnerDeck: string }[];
      const d = deals.find(x => String(x.seed) === process.env.DEAL);
      if (!d) throw new Error(`no deal ${process.env.DEAL}`);
      const pool = [...ALL_DECKS, ...NRDB_TEST_DECKS];
      const c = pool.find(x => x.side === 'corp' && x.name === d.corpDeck);
      const r = pool.find(x => x.side === 'runner' && x.name === d.runnerDeck);
      return t.core.createInitialGameState(t.decks.deckGameSetup(d.seed, c, r));
    }
  };
  const g = new t.GameRunner(start(), agents);
  // BOARD: the decision asked once with its root held, so the heap after a gc shows what G's tree holds (finding 4's probe)
  if (process.env.BOARD) {
    const before = await settle();
    const side = t.core.actingSide(g.state);
    agents[side as 'corp' | 'runner'].chooseAction(g.state);
    const held = await settle();
    out({ kind: 'held', arm: ARM, beforeMb: mb(before), rootHeldMb: mb(held), aboveMb: mb(held - before), aliveG: G.__g0?.alive ?? 0 });
  }
  const FROM = Number(process.env.FROM ?? 0);
  const TO = process.env.BOARD ? 1 : Number(process.env.TO ?? 4000);
  let base = await settle();
  let worst = { held: 0, peakMb: 0, at: -1 };
  let leakMax = 0;
  let liveMax = 0;
  let snaps = 0;
  for (let i = 0; i < TO; i++) {
    const s0 = G.__g0 ? { ...G.__g0 } : null;
    // The boards G stores in this step, by WeakRef: the FinalizationRegistry count can lag a gc, a WeakRef cannot
    const refs: WeakRef<object>[] = (G.__gRefs = []);
    peak = 0;
    const startHeap = await settle();
    const t0 = performance.now();
    const more = g.step();
    const ms = performance.now() - t0;
    G.__g0heap();
    const held = (G.__g0?.held ?? 0) + (G.__g0?.heldTotal ?? 0) - ((s0?.held ?? 0) + (s0?.heldTotal ?? 0));
    // The next decision's start: the move is made, the old root is gone from the runner; what G still holds is a leak
    const after = await settle();
    const alive = G.__g0?.alive ?? 0;
    let live = refs.filter(r => r.deref()).length;
    // A board still alive gets three more gc rounds: one that dies then was gc timing, not a holder (liveFirst counts both)
    const liveFirst = live;
    if (live) {
      await settle();
      live = refs.filter(r => r.deref()).length;
    }
    G.__gRefs = null;
    // SNAP=<n>: up to n heap snapshots when a board of this step outlives the move (who holds it: its retainers in DevTools)
    if (live && snaps++ < Number(process.env.SNAP ?? 0)) {
      // The boards still alive, under one global name, so the snapshot's reader finds them and their other retainers
      G.__leaked = refs.map(r => r.deref()).filter(Boolean);
      out({ kind: 'snap', i, file: writeHeapSnapshot() });
      G.__leaked = null;
    }
    if (i >= FROM) {
      if (held > worst.held) worst = { held, peakMb: mb(peak - startHeap), at: i };
      leakMax = Math.max(leakMax, alive);
      liveMax = Math.max(liveMax, live);
      if (process.env.EVERY || process.env.BOARD || held > 500 || alive || liveFirst) out({ kind: 'step', arm: ARM, i, T: g.state.turnNumber, ms: Math.round(ms), held, peakAboveStartMb: mb(peak - startHeap), peakMb: mb(peak), afterGcMb: mb(after), aliveG: alive, liveFirst, liveG: live });
    }
    base = after;
    if (!more || g.state.winner) break;
  }
  out({ kind: 'done', arm: ARM, worst, leakMax, liveMax, finalHeapMb: mb(base), g0: G.__g0 ? { hits: G.__g0.hits, miss: G.__g0.miss, heldPeak: G.__g0.heldPeak, noAnchor: G.__g0.noAnchor } : null });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
