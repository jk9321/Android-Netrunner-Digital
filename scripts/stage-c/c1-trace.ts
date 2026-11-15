/**
 * Stage C1 labels: the trace of one recorded ice install through place (plan.corpCore on): the count where it was
 * proposed (iceCount), keep, each central's ice, stake and paid test, the scoring remote, and place's answer.
 *   DEAL=1561 TURN=1 TITLE=Palisade npx vite-node scripts/stage-c/c1-trace.ts
 */
import { GameAction, cardDef, executeAction, findCardAnywhere, rezCostOf } from '../../src/core';
import { asSide, plan, withPricing } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { iceCount, place } from '../../src/ai/corp/placement';
import { rezMoney } from '../../src/ai/corp/rezMoney';
import { centralStake } from '../../src/ai/corp/pools';
import { isCorpMain, scoringRemote } from '../../src/ai/corp/lines';
import { playDeal, replayHuman } from '../stage-a/harness';
import { iceCreditNeed, runBypasses } from '../../src/ai/runs';
import { runnerBudget } from '../../src/ai/corp/hold';

const want = { turn: Number(process.env.TURN), title: process.env.TITLE ?? '' };
let shown = 0;
const hooks = {
  decision: (d: Parameters<NonNullable<Parameters<typeof playDeal>[1]['decision']>>[0]) => {
    const s = d.state;
    const a = d.action as (GameAction & { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean }) | null;
    if (shown || d.kind !== 'action' || !a || a.type !== 'INSTALL_CARD' || !isCorpMain(s) || s.turnNumber !== want.turn) return;
    const card = findCardAnywhere(s, a.cardInstanceId ?? '');
    if (!card || cardDef(card).title !== want.title) return;
    shown++;
    withPricing({ plan: { ...plan(), corpCore: true } }, () =>
      asSide('corp', () => {
        decisionContext(s, 'corp');
        const keep = rezMoney(s).keep;
        const after = executeAction(s, a as never);
        const count = iceCount(s, a as never, card, after);
        const stakes = centralStake(s, card.instanceId);
        console.log(`${d.src} T${s.turnNumber} ${want.title} proposed ${a.asNewRemote ? 'new' : a.targetServerId}; credits ${s.corp.credits}, clicks ${s.corp.clicks}, keep ${keep}, rez ${rezCostOf(s, card)}, runner credits ${s.runner.credits}`);
        console.log('count where proposed', JSON.stringify(count && { ...count, was: { holds: count.was.holds, entries: count.was.entries, margin: count.was.margin }, now: { holds: count.now.holds, entries: count.now.entries, margin: count.now.margin } }));
        for (const id of ['hq', 'rd'] as const) console.log(id, 'ice', s.corp.servers[id].ice.length, 'stake', stakes[id], 'paid', s.corp.credits - s.corp.servers[id].ice.length - rezCostOf(s, card) >= keep);
        console.log('scoring remote', scoringRemote(s)?.id ?? 'none');
        console.log('place', JSON.stringify(place(s, card, { from: a, held: (d.before?.heldLine ?? null) as never })));
        console.log('board', Object.values(s.corp.servers).map(v => `${v.id}[${v.ice.map(c => cardDef(c).title + (c.isRezzed ? '*' : '')).join(',')}|${v.root.map(c => cardDef(c).title).join(',')}]`).join(' '));
        console.log('hq', s.corp.hq.map(c => cardDef(c).title).join(', '));
        // The hold count's inputs where proposed: each ice's credit need rezzed, the bypasses, the Runner's budget
        const id = a.targetServerId;
        if (process.env.DETAIL && id && after) {
          for (const [label, st] of [['before', s], ['after', after]] as const) {
            const ice = st.corp.servers[id].ice;
            const needs = ice.map(c => `${cardDef(c).title}${c.isRezzed ? '*' : ''}=${iceCreditNeed(st, { ...c, isRezzed: true })}`);
            const up = { ...st, corp: { ...st.corp, servers: { ...st.corp.servers, [id]: { ...st.corp.servers[id], ice: ice.map(c => ({ ...c, isRezzed: true })) } } } };
            const by = runBypasses(up, id);
            console.log(label, 'needs', needs.join(' '), 'bypassed (all rezzed)', [...by.ids].map(x => cardDef(findCardAnywhere(st, x)!).title).join(','), 'price', by.price, 'budget', runnerBudget(st), 'runner clicks', st.runner.clicks, st.runner.maxClicks);
          }
          console.log('rig', [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources].map(c => cardDef(c).title).join(', '));
        }
      }),
    );
    process.exit(0);
  },
};
if (process.env.HUMANFILE) replayHuman(process.env.HUMANFILE, hooks);
else playDeal(Number(process.env.DEAL), hooks);
