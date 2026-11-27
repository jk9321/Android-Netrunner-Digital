/**
 * Audit Step 2 (AI-CACHE-HIDDEN-STATE): the AI's module maps that outlive a game, by name, for scripts/cache-bisect.ts
 * (CLEAR=name,name empties them between the earlier games and the one compared). oracle.ts (playedOut) has none here:
 * it was outside Step 2's spec (evaluate.ts's effectCache and lastEffect went with plan.oneCurrency in Step 3).
 */
import { clearHandCaches } from '../src/ai/handValues';
import { clearDamageThreats } from '../src/ai/effectValues';
import { clearDeckShares } from '../src/ai/iceValues';
import { clearBuildTargets } from '../src/ai/valueModel';
import { installTop } from '../src/ai/pricing';

export const aiCacheClears: Record<string, () => void> = {
  hand: clearHandCaches,
  damageThreats: clearDamageThreats,
  deckShares: clearDeckShares,
  buildTargets: clearBuildTargets,
  // a script's top-level known hands and anchor (B1b: a decision's own frame goes as it returns; installTop throws inside a scope)
  known: () => installTop({ known: { corp: null, runner: null }, anchor: null }),
};
