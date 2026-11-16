/**
 * ai-breaker-price-depth: times the Corp's first decision on the saved state of deal 3061 turn 16 (Madani hosting
 * Echelon and three Mayfly), cut down to K hosted breakers (default all four), and prints the pick.
 *   K=4 npx vite-node scripts/breaker-price-depth/time-state.ts
 */
import { hangState } from './time-state-lib';
import { createAgent } from '../../src/ai';
import { clearHandCaches } from '../../src/ai/handValues';
import { clearDamageThreats } from '../../src/ai/effectValues';
import { clearBuildTargets } from '../../src/ai/valueModel';
import { clearDeckShares } from '../../src/ai/iceValues';

const k = Number(process.env.K ?? 4);
const reps = Number(process.env.REPS ?? 1);
for (let r = 0; r < reps; r++) {
  clearHandCaches();
  clearDamageThreats();
  clearBuildTargets();
  clearDeckShares();
  const t = performance.now();
  const a = createAgent('corp', 'normal').chooseAction(structuredClone(hangState(k)));
  console.log(JSON.stringify({ k, depth: process.env.BPD ?? 'beta', ms: Math.round(performance.now() - t), pick: a }));
}
