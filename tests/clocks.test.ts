import { describe, expect, it } from 'vitest';
import { damageThreat, damageWorth, flatlineOdds } from '../src/ai/effectValues';
import { tagsWorth } from '../src/ai/evaluate';
import { tagCost } from '../src/ai/runs';
import { CLICK, cardRate, flatlineWorth } from '../src/ai/valueModel';
import { createCardInstance } from '../src/core';
import { newGame } from './helpers';

describe('the damage clock (Jeff, 2026-10-28; plan.damageClock)', () => {
  it('reads the Corp’s biggest hit and its share of damage cards from the decklist', () => {
    const { burst, share } = damageThreat(newGame());
    expect(burst).toBeGreaterThan(0);
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(1);
  });

  it('flatline odds rise as the grip falls toward the Corp’s biggest hit', () => {
    const s = newGame();
    const odds = [0, 1, 2, 3, 4, 5, 6].map(g => flatlineOdds(s, g));
    for (let g = 1; g < odds.length; g++) expect(odds[g]).toBeLessThan(odds[g - 1]);
  });

  it('a card lost is worth more the closer the grip is to a flatline (rule 10.4.4: flatlined on damage beyond the grip)', () => {
    const s = newGame();
    s.runner.grip = s.runner.grip.slice(0, 5);
    const roomy = damageWorth(s, 1);
    s.runner.grip = s.runner.grip.slice(0, 3);
    expect(damageWorth(s, 1)).toBeGreaterThan(roomy);
    expect(roomy).toBeGreaterThan(cardRate(s, 'runner'));
    s.runner.grip = s.runner.grip.slice(0, 1);
    expect(damageWorth(s, 2)).toBe(flatlineWorth(s));
  });

  it('cards over the hand limit are no life against damage: they are discarded first', () => {
    const s = newGame();
    s.runner.grip = [...s.runner.grip.slice(0, 5), ...s.runner.stack.slice(0, 3)];
    expect(damageWorth(s, 1)).toBeCloseTo(cardRate(s, 'runner'));
  });

  it('no damage in the Corp’s deck: no clock', () => {
    const s = newGame();
    const palisade = createCardInstance(s, '30072');
    s.corp.rd = s.corp.rd.map(() => ({ ...palisade }));
    s.corp.hq = [];
    for (const server of Object.values(s.corp.servers)) server.ice = server.root = [];
    // Unique key: the threat cache is by game, Archives and score areas
    s.id = 'no-damage';
    expect(flatlineOdds(s, 0)).toBe(0);
  });
});

describe('the tag clock (Jeff, 2026-10-28; plan.tagClock)', () => {
  it('no tags, no worth; never more than clearing them', () => {
    const s = newGame();
    expect(tagsWorth(s, 'runner')).toBe(0);
    s.runner.tags = 2;
    expect(tagsWorth(s, 'runner')).toBeLessThanOrEqual(2 * (CLICK + 2));
  });

  it('a tag costs more with a resource worth trashing in play', () => {
    const s = newGame();
    s.runner.tags = 1;
    s.corp.credits = 10;
    const bare = tagsWorth(s, 'runner');
    s.runner.rig.resources = [createCardInstance(s, '35011')]; // Rent Rioters
    s.runner.rig.resources.push(createCardInstance(s, '30034')); // Verbal Plasticity
    expect(tagsWorth(s, 'runner')).toBeGreaterThanOrEqual(bare);
  });

  it('the cost of taking a tag is what one more tag adds', () => {
    const s = newGame();
    expect(tagCost(s)).toBeCloseTo(tagsWorth(s, 'runner', 1));
  });
});
