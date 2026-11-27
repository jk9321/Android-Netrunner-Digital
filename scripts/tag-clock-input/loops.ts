/**
 * F114 + F110 phase A step 8 (brief tag-clock-input rev 2): loops and keys, on a few boards (local; minutes).
 * (a) No part re-enters the clock: on each board, under each arm, evaluate in both views and one Corp decision, with the
 *     value-loop count (valueModel valueLoops: the guard's flat answers) read before and after.
 * (b) The memo: tagClock keeps tagLoss on the state object (valueModel memo: the board's fingerprint, and the pricing
 *     frame's key: the deciding side, its plan, the guards up). For each field C1 reads, two boards that differ only in
 *     it, and the same board object asked under the other deciding side, each against a fresh clone's value.
 *   DEALS=1401 POOL=batch npx vite-node scripts/tag-clock-input/loops.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { loadTree, makeTree } from '../corp-owed/trees';
import { ARMS, MERGE_BASE, armPatches, setArm, treeRoot } from './trees';

const BOARDS = Number(process.env.BOARDS ?? 3);
const out = (x: unknown) => console.log(JSON.stringify(x));
const r3 = (x: number) => Math.round(x * 1000) / 1000;

async function main() {
  const root = treeRoot(99);
  const S: any = await loadTree('S', makeTree(join(root, 'S'), { ref: MERGE_BASE }));
  const B: any = await loadTree('B', makeTree(join(root, 'B'), { ref: MERGE_BASE, patches: armPatches('B') }));
  const pool = [...ALL_DECKS, ...NRDB_TEST_DECKS] as any[];
  const deals: Record<string, string> = { batch: '45830886377', nrdb: '45834898534' };
  const want = (process.env.DEALS ?? '1401').split(',');
  const boards: GameState[] = [];
  for (const [p, run] of Object.entries(deals)) {
    for (const rec of JSON.parse(readFileSync(`scripts/corp-owed/deals-${run}.json`, 'utf8'))) {
      if (!want.includes(String(rec.seed)) || boards.length >= BOARDS) continue;
      const c = pool.find(d => d.side === 'corp' && d.name === rec.corpDeck);
      const r = pool.find(d => d.side === 'runner' && d.name === rec.runnerDeck);
      const g = new S.po.GameRunner(S.core.createInitialGameState(S.decks.deckGameSetup(rec.seed, c, r)), { corp: S.ai.createAgent('corp', 'normal'), runner: S.ai.createAgent('runner', 'normal') });
      for (let n = 0; n < 8000 && !g.state.winner && boards.length < BOARDS; n++) {
        const s = g.state;
        const main = !s.pendingPrompts.length && !s.activeRun && s.activePlayer === 'corp' && S.core.actingSide(s) === 'corp' && !(s.priority && s.priority.holder !== s.activePlayer);
        if (main && s.runner.tags > 0 && s.corp.credits >= 2 && s.runner.rig.resources.length > 0 && s.corp.clicks >= 1) boards.push(structuredClone(s));
        if (!g.step()) break;
      }
      out({ deal: `${p}:${rec.seed}`, boards: boards.length });
    }
  }
  const ctx = (st: GameState, side: 'corp' | 'runner', f: () => number) => B.pricing.asSide(side, () => B.hv.inDecision(st, side, f));
  for (const [i, b0] of boards.entries()) {
    // (a) loops
    for (const arm of ARMS) {
      setArm('B', arm);
      B.clear();
      B.vm.valueLoops.clear();
      const st = structuredClone(b0);
      const ec = ctx(st, 'corp', () => B.ev.evaluate(st, 'corp'));
      const er = ctx(structuredClone(b0), 'runner', () => B.ev.evaluate(structuredClone(b0), 'runner'));
      const a = B.ai.createAgent('corp', 'normal').chooseAction(structuredClone(b0));
      out({ board: i, T: b0.turnNumber, arm, evalCorp: r3(ec), evalRunner: r3(er), pick: a.type, loops: Object.fromEntries(B.vm.valueLoops) });
    }
    // (b) keys: under C1, each field C1 reads changed alone; the clock read through the memo on one object against a fresh clone
    setArm('B', 'c1');
    const variants: Record<string, (s: GameState) => void> = {
      'corp credits +1': s => void (s.corp.credits += 1),
      'a money operation in HQ (Hedge Fund for the first card)': s => {
        if (s.corp.hq.length) s.corp.hq[0] = { ...s.corp.hq[0], cardCode: '30075' };
      },
      'a facedown ice swapped (code of the first unrezzed ice)': s => {
        for (const sv of Object.values(s.corp.servers)) {
          const ice = (sv as any).ice.find((x: any) => !x.isRezzed);
          if (ice) return void (ice.cardCode = ice.cardCode === '30038' ? '30046' : '30038');
        }
      },
    };
    for (const viewer of ['corp', 'runner'] as const) {
      for (const side of ['corp', 'runner'] as const) {
        B.clear();
        const one = structuredClone(b0);
        const first = ctx(one, side, () => B.ev.tagsWorth(one, viewer));
        const other = side === 'corp' ? 'runner' : 'corp';
        const again = ctx(one, other, () => B.ev.tagsWorth(one, viewer));
        B.clear();
        const fresh = (() => {
          const c = structuredClone(b0);
          return ctx(c, other, () => B.ev.tagsWorth(c, viewer));
        })();
        out({ board: i, check: 'deciding side on one object', viewer, first: side, then: other, firstValue: r3(first), memoValue: r3(again), freshValue: r3(fresh), same: again === fresh });
        for (const [name, f] of Object.entries(variants)) {
          B.clear();
          const a = structuredClone(b0);
          const va = ctx(a, side, () => B.ev.tagsWorth(a, viewer));
          const bb = structuredClone(b0);
          f(bb);
          const vb = ctx(bb, side, () => B.ev.tagsWorth(bb, viewer));
          // the same field changed IN PLACE on the object already asked (tests do this; play never does)
          f(a);
          const vInPlace = ctx(a, side, () => B.ev.tagsWorth(a, viewer));
          out({ board: i, check: name, viewer, side, base: r3(va), changed: r3(vb), inPlaceThroughMemo: r3(vInPlace), memoServesStale: vInPlace !== vb });
        }
      }
    }
    setArm('B', 'base');
  }
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
