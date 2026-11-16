/** ai-breaker-price-depth: the saved state of deal 3061 turn 16 (Madani hosting Echelon and three Mayfly), cut down to k hosted breakers. */
import { readFileSync } from 'node:fs';
import { GameState } from '../../src/core';

/** Madani's hosted breakers in the order the red team removed them last-first (Mayfly 92, Echelon 88, Mayfly 94, Mayfly 93). */
export const HOSTED_BREAKERS = ['inst-92', 'inst-88', 'inst-94', 'inst-93'];

export function hangState(k = 4): GameState {
  const s = JSON.parse(readFileSync('tests/fixtures/breaker-price-depth/hang-deal3061-T16-corp.json', 'utf8')) as GameState;
  const keep = new Set(HOSTED_BREAKERS.slice(0, k));
  const madani = s.runner.rig.hardware.find(c => c.cardCode === '35028')!;
  madani.hostedCards = (madani.hostedCards ?? []).filter(h => !HOSTED_BREAKERS.includes(h.instanceId) || keep.has(h.instanceId));
  return s;
}

