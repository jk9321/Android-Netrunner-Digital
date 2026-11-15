import { afterEach, describe, expect, it } from 'vitest';
import { ABLATE_FAMILIES, ablated, ablationList, applyAblate, asSide } from '../src/ai/pricing';
import { applyPlanOff } from '../src/ai/synergy';
import { cardSynergy, inferSynergy } from '../src/ai/synergyTags';
import { getCardDefinition } from '../src/core';
import '../src/ai/cards'; // sets the hand-written synergy table

/**
 * Step S-1 ablation switches (measurement only, branch ai-search-first; brief-step-s.md, families in
 * /mnt/project-files/netrunner-ai/audit-fixes/step-s/families.md). The registry: every family is off by default,
 * scoped by the side whose decision is at the root, and reachable through PLAN_OFF (ai-batch.yml's plan_off input).
 */
describe('Step S ablation registry', () => {
  afterEach(() => applyAblate(''));

  it('nothing is ablated by default, inside or outside a decision', () => {
    expect(ablationList()).toBe('');
    for (const f of ABLATE_FAMILIES) {
      expect(ablated(f)).toBe(false);
      expect(asSide('corp', () => ablated(f))).toBe(false);
      expect(asSide('runner', () => ablated(f))).toBe(false);
    }
  });

  it('a family ablated for the Corp is off in every evaluation of a Corp decision, the Runner reply inside it included', () => {
    applyAblate('corp:tagClock');
    expect(ablated('tagClock')).toBe(false); // outside a decision
    expect(asSide('corp', () => ablated('tagClock'))).toBe(true);
    expect(asSide('corp', () => asSide('runner', () => ablated('tagClock')))).toBe(true);
    expect(asSide('runner', () => ablated('tagClock'))).toBe(false);
    expect(asSide('runner', () => asSide('corp', () => ablated('tagClock')))).toBe(false);
    expect(asSide('corp', () => ablated('iceWorth'))).toBe(false);
  });

  it('a bare name is the Corp; runner: names the Runner; an unknown family throws', () => {
    applyAblate('iceWorth,runner:runRiders');
    expect(ablationList()).toBe('corp:iceWorth,runner:runRiders');
    expect(() => applyAblate('corp:noSuchFamily')).toThrow(/no ablation family/);
  });

  it('PLAN_OFF carries ablate: entries beside ordinary switches', () => {
    applyPlanOff('ablate:handByCard,ablate:runner:synergyTags');
    expect(ablationList()).toBe('corp:handByCard,runner:synergyTags');
  });

  it('B1: an ablated decision reads every card\'s synergy from its text', () => {
    const def = getCardDefinition('30003'); // Carnivore, hand-tagged
    expect(cardSynergy(def)).not.toEqual(inferSynergy(def));
    applyAblate('runner:synergyTags');
    expect(asSide('runner', () => cardSynergy(def))).toEqual(inferSynergy(def));
  });
});
