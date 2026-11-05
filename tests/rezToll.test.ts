import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { HeuristicCorpAI } from '../src/ai/corpAI';
import { tuning } from '../src/ai/synergy';

/**
 * Jeff (2026-11-05): the Corp never banks money. Over 40 self-play games 40% of everything it spent went on rezzing
 * ice in the Runner's runs, and about a quarter of that on ice the Runner could pay its way through and did: the run
 * went on, the Corp only took a toll (rule 6.4.3: the Corp may rez the approached ice in the approach ice paid ability window).
 * plan.rezToll: outside a server holding an agenda, breakable ice is rezzed only when its toll is worth the rez.
 *
 * Position: a self-play game (the loop-trace deals from 1100), turn 8, the Runner (1 credit) approaching Palisade on R&D; the Corp has 3
 * credits. Rezzing it costs all 3 for a 1-credit toll.
 */
function position(): { state: GameState; cards: string[] } {
  return JSON.parse(readFileSync(new URL('./fixtures/rez-toll.json', import.meta.url), 'utf8'));
}
const choose = () => {
  const { state, cards } = position();
  const ice = cards.map(id => Object.values(state.corp.servers).flatMap(s => s.ice).find(c => c.instanceId === id)!);
  return new HeuristicCorpAI({ synergy: true }).chooseRez(state, ice);
};

describe('breakable ice is rezzed only when its toll is worth it (plan.rezToll)', () => {
  it('keeps its 3 credits rather than rez Palisade for a 1-credit toll', () => {
    expect(choose()).toBeNull();
  });

  it('without the plan it rezzes', () => {
    tuning.plan.rezToll = false;
    try {
      expect(choose()?.type).toBe('REZ_CARD');
    } finally {
      tuning.plan.rezToll = true;
    }
  });
});
