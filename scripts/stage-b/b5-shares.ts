/**
 * Stage B5 per-ice log (AI Coordinator 17:44Z): on recorded Corp main-phase states, each waiting ice whose rez-budget
 * share (iceValues rezBudget, as the Corp prices it) differs between plan.b5RezOwner on and off, by kind (old share to
 * new share, and whether the ice is in the owner's holding rezzes), with the boardNeed (old count against keep) beside.
 * One JSON line per changed ice, then a summary line.
 *
 *   [DEALS=1001] [HUMAN=report-49] npx vite-node scripts/stage-b/b5-shares.ts > b5-shares.jsonl
 */
import { GameState, cardDef } from '../../src/core';
import { asSide, plan, withPricing } from '../../src/ai/pricing';
import { planWith } from '../../src/ai/synergy';
import { decisionContext } from '../../src/ai/handValues';
import { rezBudget } from '../../src/ai/iceValues';
import { boardNeed } from '../../src/ai/valueModel';
import { rezMoney } from '../../src/ai/corp/rezMoney';
import { clearCaches, forEachRecorded } from '../stage-a/harness';

const kinds: Record<string, number> = {};
let states = 0;
let changedStates = 0;
let needDiff = 0;
forEachRecorded({
  decision: d => {
    const s: GameState = d.state;
    if (d.kind !== 'action' || s.activePlayer !== 'corp' || s.activeRun || s.pendingPrompts.length || s.corp.clicks <= 0) return;
    if (!Object.values(s.corp.servers).some(v => v.ice.some(c => !c.isRezzed))) return;
    states++;
    asSide('corp', () => {
      decisionContext(s, 'corp');
      const on = rezBudget(structuredClone(s));
      const needOn = boardNeed(structuredClone(s), 'corp');
      const off = withPricing({ plan: planWith(plan(), ['b5RezOwner']) }, () => rezBudget(structuredClone(s)));
      const needOff = withPricing({ plan: planWith(plan(), ['b5RezOwner']) }, () => boardNeed(structuredClone(s), 'corp'));
      if (needOn !== needOff) needDiff++;
      const holding = new Set(Object.values(rezMoney(s).rezIds).flat());
      let any = false;
      for (const v of Object.values(s.corp.servers))
        for (const ice of v.ice) {
          if (ice.isRezzed) continue;
          const a = off.get(ice.instanceId) ?? 0;
          const b = on.get(ice.instanceId) ?? 0;
          if (a === b) continue;
          any = true;
          const kind = `${a}->${b} ${holding.has(ice.instanceId) ? 'holding' : 'not holding'}`;
          kinds[kind] = (kinds[kind] ?? 0) + 1;
          console.log(JSON.stringify({ at: `${d.src} #${d.i} T${d.turn}`, server: v.id, ice: cardDef(ice).title, kind, credits: s.corp.credits, keep: needOn, oldNeed: needOff, holding: [...holding] }));
        }
      if (any) changedStates++;
    });
    clearCaches();
  },
});
console.log(JSON.stringify({ summary: true, states, changedStates, needDiff, kinds }));
