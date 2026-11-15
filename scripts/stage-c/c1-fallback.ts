/**
 * Step 4 Stage C1: the placement fallback (spec 1.8 ice rule 3, corp/placement.ts iceFallback) against the ranking's
 * server, on the recorded states (scripts/stage-a/harness.ts). At each Corp main-phase decision where the old Corp
 * (plan.corpCore off, the recorded path) installs a card, `place` is asked again with plan.corpCore on; the two
 * servers are compared by card type and by the reason place gives. Output: one JSON line of counts and examples.
 *   SHARD=0/4 npx vite-node scripts/stage-c/c1-fallback.ts > c1-0.json
 */
import { GameAction, GameState, cardDef, findCardAnywhere } from '../../src/core';
import { rezMoney } from '../../src/ai/corp/rezMoney';
import { centralStake } from '../../src/ai/corp/pools';
import { asSide, plan, withPricing } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { place } from '../../src/ai/corp/placement';
import { isCorpMain } from '../../src/ai/corp/lines';
import { forEachRecorded } from '../stage-a/harness';
import { needsOldTree } from './old-tree';
needsOldTree('scripts/stage-c/c1-fallback.ts');

const out = { installs: {} as Record<string, number>, same: {} as Record<string, number>, differ: {} as Record<string, number>, byReason: {} as Record<string, number>, toServer: {} as Record<string, number>, examples: [] as string[], byKind: {} as Record<string, string[]> };
const inc = (t: Record<string, number>, k: string) => (t[k] = (t[k] ?? 0) + 1);
const where = (a: GameAction & { targetServerId?: string; asNewRemote?: boolean }) => (a.asNewRemote ? 'new' : a.targetServerId ?? 'new');
const kindOf = (s: string) => (s === 'new' ? 'new remote' : ['hq', 'rd', 'archives'].includes(s) ? s : 'remote');

/** The board as a label needs it: credits, clicks, keep, each server's ice (* rezzed) and root, the central stakes. */
function board(s: GameState, leaving: string): string {
  const keep = withPricing({ plan: { ...plan(), corpCore: true } }, () => asSide('corp', () => rezMoney(s).keep));
  const stakes = asSide('corp', () => centralStake(s, leaving));
  const servers = Object.values(s.corp.servers)
    .map(v => `${v.id}[${v.ice.map(c => cardDef(c).title + (c.isRezzed ? '*' : '')).join(',')}|${v.root.map(c => cardDef(c).type_code).join(',')}]`)
    .join(' ');
  const hqAgendas = s.corp.hq.filter(c => cardDef(c).type_code === 'agenda').length;
  return `$${s.corp.credits} c${s.corp.clicks} keep ${keep} stake hq ${stakes.hq.toFixed(2)} rd ${stakes.rd.toFixed(2)} hqAgendas ${hqAgendas} runner $${s.runner.credits}; ${servers}`;
}

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
    const k = `${type} ${kindOf(where(a))} -> ${kindOf(p.server)} (${p.reason})`;
    const list = (out.byKind[k] ??= []);
    if (list.length < 3) list.push(`${d.src} T${s.turnNumber} ${cardDef(card).title} ${where(a)} -> ${p.server}; ${board(s, card.instanceId)}`);
    if (out.examples.length < 40) out.examples.push(`${d.src} T${s.turnNumber} ${cardDef(card).title}: ${where(a)} -> ${p.server} (${p.reason}), credits ${s.corp.credits}, clicks ${s.corp.clicks}`);
  },
});
console.log(JSON.stringify(out));
