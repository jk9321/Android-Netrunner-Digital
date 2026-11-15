/**
 * Step 4 Stage C1: the placement fallback (spec 1.8 ice rule 3, corp/placement.ts iceFallback) against the ranking's
 * server, on the recorded states (scripts/stage-a/harness.ts). At each Corp main-phase decision where the old Corp
 * (plan.corpCore off, the recorded path) installs a card, `place` is asked again with plan.corpCore on; the two
 * servers are compared by card type and by the reason place gives. Output: one JSON line of counts and examples.
 *   SHARD=0/4 npx vite-node scripts/stage-c/c1-fallback.ts > c1-0.json
 */
import { GameAction, cardDef, findCardAnywhere } from '../../src/core';
import { asSide, plan, withPricing } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { place } from '../../src/ai/corp/placement';
import { isCorpMain } from '../../src/ai/corp/lines';
import { forEachRecorded } from '../stage-a/harness';

const out = { installs: {} as Record<string, number>, same: {} as Record<string, number>, differ: {} as Record<string, number>, byReason: {} as Record<string, number>, toServer: {} as Record<string, number>, examples: [] as string[] };
const inc = (t: Record<string, number>, k: string) => (t[k] = (t[k] ?? 0) + 1);
const where = (a: GameAction & { targetServerId?: string; asNewRemote?: boolean }) => (a.asNewRemote ? 'new' : a.targetServerId ?? 'new');
const kindOf = (s: string) => (s === 'new' ? 'new remote' : ['hq', 'rd', 'archives'].includes(s) ? s : 'remote');

forEachRecorded({
  decision: d => {
    const s = d.state;
    const a = d.action as (GameAction & { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean }) | null;
    if (d.kind !== 'action' || !a || a.type !== 'INSTALL_CARD' || !isCorpMain(s)) return;
    const card = findCardAnywhere(s, a.cardInstanceId!);
    if (!card || !s.corp.hq.some(c => c.instanceId === card.instanceId)) return;
    const type = cardDef(card).type_code;
    const p = asSide('corp', () => (decisionContext(s, 'corp'), withPricing({ plan: { ...plan(), corpCore: true } }, () => place(s, card, { from: a, held: (d.before?.heldLine ?? null) as never }))))[0];
    inc(out.installs, type);
    if (!p) return inc(out.byReason, `${type}:none`);
    inc(out.byReason, `${type}:${p.reason}`);
    if (p.server === where(a)) return inc(out.same, type);
    inc(out.differ, type);
    inc(out.toServer, `${type} ${kindOf(where(a))} -> ${kindOf(p.server)} (${p.reason})`);
    if (out.examples.length < 40) out.examples.push(`${d.src} T${s.turnNumber} ${cardDef(card).title}: ${where(a)} -> ${p.server} (${p.reason}), credits ${s.corp.credits}, clicks ${s.corp.clicks}`);
  },
});
console.log(JSON.stringify(out));
