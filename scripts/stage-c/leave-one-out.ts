/**
 * Step 4 Stage C7: leave-one-out on recorded decisions (spec section 5). At each recorded Corp main-phase decision
 * (local deals and human games, split by SHARD), a fresh Normal Corp of the new core (corpCore, rolloutLines) decides
 * with nothing left out, recording which carried-over rules applied anywhere in the decision (look-ahead included:
 * corp/candidates.ts `leaveOut.fired`). Then, for each rule that applied, it decides again with that rule left out. A
 * rule that did not apply cannot change the decision (the decision is deterministic), so it is not re-run.
 * One JSON line per decision; sum with leave-one-out-sum.mjs. ARGS: a comma list of arms to try (default all).
 *   SHARD=0/64 npx vite-node scripts/stage-c/leave-one-out.ts > loo-0.txt
 */
import { GameAction, GameState, cardDef, findCardAnywhere } from '../../src/core';
import { createAgent } from '../../src/ai';
import { plan, withPricing } from '../../src/ai/pricing';
import { isCorpMain } from '../../src/ai/corp/lines';
import { leaveOut } from '../../src/ai/corp/candidates';
import { clearCaches, forEachRecorded } from '../stage-a/harness';

export const ARMS = [
  ...Array.from({ length: 9 }, (_, k) => `line${k + 1}`),
  'isPettyCash', 'tagsBeforeScore', 'overAdvance', 'tagFirst', 'trapAdvanceCap', 'assetAdvance', 'advancesAsIce', 'hqTrashCost', 'pettyCashFirst', 'tagFirstPick',
];
const want = (process.env.ARGS ?? '').split(',').filter(Boolean);
const arms = want.length ? ARMS.filter(a => want.includes(a)) : ARMS;

const name = (s: GameState, a: GameAction) => {
  const id = 'cardInstanceId' in a ? (a.cardInstanceId as string) : undefined;
  const c = id ? findCardAnywhere(s, id) : undefined;
  const to = 'targetServerId' in a && a.targetServerId ? '@' + a.targetServerId : a.type === 'INSTALL_CARD' ? '@new' : '';
  return `${a.type}${c ? ' ' + cardDef(c).title : ''}${to}`;
};
const decide = (s: GameState, off: string[]) =>
  withPricing({ plan: { ...plan(), corpCore: true, rolloutLines: true } }, () => {
    leaveOut.off = new Set(off);
    leaveOut.fired = new Set();
    clearCaches();
    const t = performance.now();
    const a = createAgent('corp', 'normal').chooseAction(structuredClone(s));
    const ms = performance.now() - t;
    const fired = [...leaveOut.fired];
    leaveOut.off = new Set();
    return { move: name(s, a), fired, ms: Math.round(ms) };
  });

forEachRecorded({
  decision: d => {
    if (d.kind !== 'action' || !isCorpMain(d.state)) return;
    const s = d.state;
    const base = decide(s, []);
    const changed: Record<string, string> = {};
    for (const arm of arms.filter(a => base.fired.includes(a))) {
      const r = decide(s, [arm]);
      if (r.move !== base.move) changed[arm] = r.move;
    }
    console.log(JSON.stringify({ src: d.src, i: d.i, T: s.turnNumber, clicks: s.corp.clicks, credits: s.corp.credits, base: base.move, fired: base.fired.filter(a => arms.includes(a)), changed, ms: base.ms }));
  },
});
