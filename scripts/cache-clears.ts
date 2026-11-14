/**
 * Audit Step 2 (AI-CACHE-HIDDEN-STATE): the AI's module maps that outlive a game, by name, for scripts/cache-bisect.ts
 * (CLEAR=name,name empties them between the earlier games and the one compared). evaluate.ts (scoreEffectWorth's
 * effectCache and lastEffect) and oracle.ts (playedOut) have none here: those files were outside this step's spec.
 */
import { clearThreatCaches } from '../src/ai/threatModel';
import { clearHandCaches } from '../src/ai/handValues';
import { clearDamageThreats } from '../src/ai/effectValues';
import { clearDeckShares } from '../src/ai/iceValues';
import { clearBuildTargets } from '../src/ai/valueModel';
import { holdPricing } from '../src/ai/pricing';

export const aiCacheClears: Record<string, () => void> = {
  threat: clearThreatCaches,
  hand: clearHandCaches,
  damageThreats: clearDamageThreats,
  deckShares: clearDeckShares,
  buildTargets: clearBuildTargets,
  // the decision notes (known hands, anchor) that stay in the pricing context until the next decision
  known: () => void holdPricing({ known: { corp: null, runner: null }, anchor: null }),
};
