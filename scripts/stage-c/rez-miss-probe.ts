/**
 * Stage C coverage miss (c2-coverage.md, deal 1601 T5): at each recorded main-phase decision where the old Corp rezzed
 * a root card, whether the order offers the rez and the tests behind it: the timing test, the credits, the rez cost
 * and keep (rezMoney), the server's root.
 *   DEALS=1601 HUMAN=none npx vite-node scripts/stage-c/rez-miss-probe.ts
 */
import { cardDef, findCardAnywhere, getLegalActions } from '../../src/core';
import { rezCost } from '../../src/core/engine/cardEffects';
import { asSide, plan, withPricing } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { corpCandidates } from '../../src/ai/corp/candidates';
import { isCorpMain } from '../../src/ai/corp/lines';
import { rezMoney } from '../../src/ai/corp/rezMoney';
import { rezTimingBlocked } from '../../src/ai/corp/rez';
import { forEachRecorded } from '../stage-a/harness';

forEachRecorded({
  decision: d => {
    const s = d.state;
    const a = d.action;
    if (d.kind !== 'action' || !a || a.type !== 'REZ_CARD' || !isCorpMain(s)) return;
    withPricing({ plan: { ...plan(), corpCore: true, rolloutLines: true } }, () =>
      asSide('corp', () => {
        decisionContext(s, 'corp');
        const card = findCardAnywhere(s, a.cardInstanceId)!;
        const server = Object.entries(s.corp.servers).find(([, v]) => v.root.some(c => c.instanceId === card.instanceId));
        const list = corpCandidates(s, getLegalActions(s, 'corp'), { held: null, freeExhausted: false });
        const offered = list.some(c => c.action.type === 'REZ_CARD' && 'cardInstanceId' in c.action && c.action.cardInstanceId === card.instanceId);
        const keep = rezMoney(s).keep;
        const cost = rezCost(s, card);
        console.log(
          `${d.src} T${s.turnNumber} c${s.corp.clicks} $${s.corp.credits}: rez ${cardDef(card).title} (${cardDef(card).type_code}) at ${server?.[0]} ` +
            `[root ${server?.[1].root.map(c => cardDef(c).title).join(', ')}; ice ${server?.[1].ice.length}]; offered ${offered}; ` +
            `timingBlocked ${rezTimingBlocked(s, card)}; cost ${cost}; keep ${keep.toFixed(2)}; credits after ${s.corp.credits - cost}`,
        );
      }),
    );
  },
});
