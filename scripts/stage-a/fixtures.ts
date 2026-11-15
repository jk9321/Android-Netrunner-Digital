/**
 * Writes the recorded state tests/corpOwners.test.ts reads, so the test does not play a deal (fast gate, 5 s line):
 *  - tests/fixtures/stage-a-held-asset-1921-18.json: deal 1921's Corp decision #18 (scripts/stage-a/harness.ts), the
 *    state and the held asset line, where place once returned "a counted line takes the click".
 *
 *   npx vite-node scripts/stage-a/fixtures.ts
 */
import { writeFileSync } from 'node:fs';
import { playDeal } from './harness';

let saved = false;
playDeal(1921, {
  decision: d => {
    if (d.i !== 18 || saved) return;
    writeFileSync('tests/fixtures/stage-a-held-asset-1921-18.json', JSON.stringify({ state: d.state, held: d.before?.heldLine ?? null, played: d.action }));
    saved = true;
  },
});
console.log(`1921 #18 ${saved ? 'saved' : 'MISSING'}`);
