/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-expressions -- a measurement script around a temporary globalThis hook */
/**
 * ai-decision-time (brief-decision-time.md rev 2, rulings 1 and 11, measurement before any build): for each Corp
 * decision, the tag clock's per-turn prices (tagLossPerTurn computations, the memo misses that do the work) grouped
 * three ways, and the money step / tagFirst against the planner's pick (ruling 2). Needs the uncommitted
 * instrumentation in scripts/decision-time/instrument.patch (globalThis.__dt hooks in evaluate.ts, corp/hold.ts,
 * corp/core.ts): `git apply scripts/decision-time/instrument.patch` first, `git checkout src` after.
 *   MODE=state K=0 npx vite-node scripts/decision-time/measure.ts      (the saved hang state, Corp's first decision)
 *   MODE=deals SHARD=0/4 npx vite-node scripts/decision-time/measure.ts > deals-0.tsv   (every Corp decision, 56 deals)
 * Grouping of one computation:
 *  - hold: inside holdRunnerTurn, the key the ruling's memo would use (the input board object, the part of the count
 *    (an ice id priced by iceNeed, or a bypass mask), viewer, skip, the priced copy's Runner clicks, pricingKey).
 *    A repeat = a computation whose key was already computed in the same decision: what that memo would serve.
 *  - content: a hash of the whole priced board (JSON) + viewer + skip + pricingKey: the upper bound for any memo.
 *  - hold repeats whose content differs from the first computation of their key would be unsafe (counted: must be 0).
 */
import { createHash } from 'node:crypto';
import { CardInstance, GameState } from '../../src/core';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { valueLoops } from '../../src/ai/valueModel';
import { pricingKey } from '../../src/ai/pricing';
import { clearHandCaches } from '../../src/ai/handValues';
import { clearDamageThreats } from '../../src/ai/effectValues';
import { clearThreatCaches } from '../../src/ai/threatModel';
import { clearBuildTargets } from '../../src/ai/valueModel';
import { clearDeckShares } from '../../src/ai/iceValues';
import { dealState, deals } from '../stage-a/harness';
import { hangState } from '../breaker-price-depth/time-state-lib';

interface Stats {
  clock: number; rig: number; prices: number; inHold: number; holdRepeat: number; holdRepeatRig: number; holdRepeatMs: number;
  contentRepeat: number; contentRepeatRig: number; contentRepeatMs: number; unsafe: number; priceRig: number; priceMs: number;
  planned: number; money: number; moneySame: number; tagFirst: number; tagFirstSame: number; overruled: number; overruledBy: Record<string, number>;
}
const fresh = (): Stats => ({ clock: 0, rig: 0, prices: 0, inHold: 0, holdRepeat: 0, holdRepeatRig: 0, holdRepeatMs: 0, contentRepeat: 0, contentRepeatRig: 0, contentRepeatMs: 0, unsafe: 0, priceRig: 0, priceMs: 0, planned: 0, money: 0, moneySame: 0, tagFirst: 0, tagFirstSame: 0, overruled: 0, overruledBy: {} });
const ids = new WeakMap<object, number>();
let nextId = 0;
const idOf = (o: object) => ids.get(o) ?? (ids.set(o, ++nextId), nextId);
const hash = (s: string) => createHash('sha1').update(s).digest('hex');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

let st = fresh();
let holdSeen = new Map<string, string>();
let contentSeen = new Set<string>();
let depth = 0;
const dt = {
  rig: 0, clock: 0, stack: [] as { input: GameState; part: string }[], planned: null as unknown, lastChoose: null as any,
  price(state: GameState, viewer: string, skip: number, work: () => number): number {
    const top = this.stack.at(-1);
    const pk = pricingKey();
    const content = hash(JSON.stringify(state)) + `|${viewer}|${skip}|${pk}`;
    const holdKey = top ? `${idOf(top.input)}|${top.part}|${viewer}|${skip}|c${state.runner.clicks}|${pk}` : null;
    const rig0 = this.rig;
    const t = performance.now();
    depth++;
    const v = work();
    depth--;
    const ms = performance.now() - t;
    const rig = this.rig - rig0;
    if (depth > 0) return v; // a price nested inside another price: counted in the outer one
    st.prices++;
    st.priceRig += rig;
    st.priceMs += ms;
    if (contentSeen.has(content)) (st.contentRepeat++, st.contentRepeatRig += rig, st.contentRepeatMs += ms);
    else contentSeen.add(content);
    if (holdKey) {
      st.inHold++;
      const first = holdSeen.get(holdKey);
      if (first !== undefined) {
        st.holdRepeat++; st.holdRepeatRig += rig; st.holdRepeatMs += ms;
        if (first !== content) st.unsafe++;
      } else holdSeen.set(holdKey, content);
    }
    return v;
  },
  choose(c: { planned: unknown; money: unknown; tagFirst: unknown; chosen: unknown; lineFirst: unknown }) {
    this.lastChoose = c;
  },
  final(action: unknown) {
    const c = this.lastChoose;
    this.planned = null;
    this.lastChoose = null;
    if (!c) return;
    st.planned++;
    if (c.money) (st.money++, same(c.money, c.planned) && st.moneySame++);
    if (c.tagFirst) (st.tagFirst++, same(c.tagFirst, c.planned) && st.tagFirstSame++);
    if (!same(action, c.planned)) {
      st.overruled++;
      const by = c.lineFirst ? 'lineFirst' : c.money ? 'money' : c.tagFirst && !same(c.chosen, c.planned) ? 'tagFirst' : !same(action, c.chosen) ? 'scoreInTwoPick' : 'other';
      st.overruledBy[by] = (st.overruledBy[by] ?? 0) + 1;
    }
  },
};
(globalThis as any).__dt = dt;

function begin() {
  st = fresh();
  holdSeen = new Map();
  contentSeen = new Set();
  dt.rig = 0; dt.clock = 0; dt.planned = null; dt.lastChoose = null;
}
function end(): Stats {
  st.rig = dt.rig;
  st.clock = dt.clock;
  return st;
}
const clearAll = () => { clearHandCaches(); clearDamageThreats(); clearThreatCaches(); clearBuildTargets(); clearDeckShares(); };

if ((process.env.MODE ?? 'state') === 'state') {
  const k = Number(process.env.K ?? 0);
  clearAll();
  begin();
  const t = performance.now();
  const a = createAgent('corp', 'normal').chooseAction(structuredClone(hangState(k)));
  const ms = performance.now() - t;
  console.log(JSON.stringify({ k, ms: Math.round(ms), pick: a, ...end() }));
} else {
  const watched = (src: string, side: 'corp' | 'runner'): Agent => {
    const inner = createAgent(side, 'normal');
    let i = 0;
    const time = <T>(kind: string, turn: number, f: () => T): T => {
      clearAll();
      begin();
      const t = performance.now();
      const a = f();
      const ms = performance.now() - t;
      const s = end();
      if (side === 'corp') process.stdout.write(`${src}\t${i}\t${kind}\t${turn}\t${ms.toFixed(1)}\t${JSON.stringify(s)}\t${JSON.stringify(a ?? null)}\n`);
      i++;
      return a;
    };
    const out: Partial<Agent> & { side: string } = { side, chooseAction: (s: GameState) => time('action', s.turnNumber, () => inner.chooseAction(s)) };
    if (inner.chooseRez) out.chooseRez = (s: GameState, cards: CardInstance[]) => time('rez', s.turnNumber, () => inner.chooseRez!(s, cards));
    if (inner.chooseOffTurn) out.chooseOffTurn = (s: GameState) => time('off', s.turnNumber, () => inner.chooseOffTurn!(s));
    return out as Agent;
  };
  const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
  deals().forEach((seed, k) => {
    if (k % shards !== shard) return;
    valueLoops.clear();
    const src = `deal:${seed}`;
    const game = new GameRunner(dealState(seed), { corp: watched(src, 'corp'), runner: watched(src, 'runner') });
    for (let n = 0; n < 4000 && game.step(); n++);
  });
}
