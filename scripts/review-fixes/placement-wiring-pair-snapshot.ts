/**
 * Bundle P build (review-fixes-1119/placement-build/brief.md, test 4): the order on boards with an asset cover's ice-pair
 * placement, written from the merge base (daffc389) so tests/placementWiring.test.ts can assert the branch gives the same
 * candidates, values and order there (the pair form is not touched by fix 2).
 *   OUT=tests/fixtures/placement-wiring/pair-candidates.json npx vite-node scripts/review-fixes/placement-wiring-pair-snapshot.ts
 */
import { writeFileSync } from 'node:fs';
import { GameState, getLegalActions } from '../../src/core';
import '../../src/ai';
import { corpCandidates } from '../../src/ai/corp/candidates';
import { asSide } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { pairBoards } from '../../tests/fixtures/placement-wiring/boards';

const inCorp = <X>(s: GameState, f: () => X): X => asSide('corp', () => (decisionContext(s, 'corp'), f()));
const out: Record<string, unknown> = {};
for (const [name, make] of Object.entries(pairBoards)) {
  const s = make();
  out[name] = inCorp(s, () => corpCandidates(s, getLegalActions(s, 'corp'), { held: null, freeExhausted: false })).map(c => ({ action: c.action, line: c.line, behind: c.behind, keys: c.keys, card: c.card ?? null }));
}
writeFileSync(process.env.OUT ?? 'tests/fixtures/placement-wiring/pair-candidates.json', JSON.stringify(out, null, 1) + '\n');
console.log(Object.keys(out).join(', '));
