import { afterEach, describe, expect, it } from 'vitest';
import { cardDef, createCardInstance } from '../src/core';
import { accessWorth, agendaOdds, coreDamageWorth, coreSlotWorth, damageWorth, flatlineOdds } from '../src/ai/effectValues';
import { playedWorth } from '../src/ai/handValues';
import { tuning } from '../src/ai/synergy';
import { CLICK, RATES, cardRate, flatlineWorth, pointGain, pointValue } from '../src/ai/valueModel';
import { newGame } from './helpers';

const saved = { ...tuning.plan.flatRates };
afterEach(() => (tuning.plan.flatRates = { ...saved }));
const off = (key: string) => (tuning.plan.flatRates = { ...tuning.plan.flatRates, [key]: false });

describe('the last flat rates from the model (Jeff, 2026-10-28; plan.flatRates)', () => {
  it('a card drawn or lost is worth the deck’s average card, not a flat 1.6', () => {
    const s = newGame();
    const runner = cardRate(s, 'runner');
    expect(runner).not.toBe(RATES.drawnCard);
    expect(runner).toBeGreaterThan(0.5);
    expect(runner).toBeLessThan(4);
    // Damage at a roomy grip loses about one average card
    s.runner.grip = [...s.runner.grip.slice(0, 5), ...s.runner.stack.slice(0, 3)];
    expect(damageWorth(s, 1)).toBeCloseTo(cardRate(s, 'runner'));
    off('cards');
    expect(cardRate(s, 'runner')).toBe(RATES.drawnCard);
  });

  it('accesses are priced on the point clock: a point near the win is worth more', () => {
    const s = newGame();
    const early = accessWorth(s);
    s.runner.score = 5;
    expect(accessWorth(s)).toBeGreaterThan(early);
    const { odds, points } = agendaOdds(s);
    expect(accessWorth(s)).toBeCloseTo(odds * pointGain(5, points));
    expect(pointGain(5, 1.5)).toBeCloseTo(15 + 0.5 * 15);
    expect(pointGain(0, 2)).toBe(pointValue(2));
    off('points');
    expect(pointGain(5, 2)).toBe(2 * RATES.point);
  });

  it('a flatline is worth the whole game: the Corp’s points to come and the Runner’s lost', () => {
    const s = newGame();
    expect(flatlineWorth(s)).toBe(pointValue(7));
    s.corp.score = 3;
    s.runner.score = 3;
    expect(flatlineWorth(s)).toBe(pointValue(7));
    s.runner.grip = s.runner.grip.slice(0, 1);
    expect(damageWorth(s, 2)).toBe(flatlineWorth(s));
    off('flatline');
    expect(flatlineWorth(s)).toBe(4 * RATES.point);
  });

  it('core damage: a hand slot for the rest of the game, more against a damage deck (rule 5.5.3b)', () => {
    const s = newGame();
    const limit = s.runner.handSizeLimit ?? 5;
    const clock = Math.max(0, flatlineOdds(s, limit - 1) - flatlineOdds(s, limit));
    expect(coreSlotWorth(s)).toBeCloseTo(0.5 * cardRate(s, 'runner'));
    expect(coreDamageWorth(s)).toBeCloseTo(coreSlotWorth(s) + flatlineWorth(s) * clock);
    off('coreDamage');
    expect(coreDamageWorth(s)).toBe(RATES.coreDamage);
  });

  it('a breaker in hand is worth what it adds to the rig: nothing more for a type already covered', () => {
    const s = newGame();
    s.runner.rig.programs = [createCardInstance(s, '30006')]; // Cleaver installed
    const second = createCardInstance(s, '30006');
    expect(playedWorth(s, second)).toBeCloseTo(-(cardDef(second).cost ?? 0) - CLICK);
    const buzzsaw = createCardInstance(s, '30005'); // Buzzsaw, a decoder: a new type
    expect(playedWorth(s, buzzsaw)).toBeGreaterThan(playedWorth(s, second));
  });

  it('a breaker hosted on Bling is priced once, not again inside the rig it joins', () => {
    const s = newGame();
    const bling = createCardInstance(s, '35006');
    const hosted = createCardInstance(s, '30006');
    bling.hostedCards = [hosted];
    s.runner.rig.hardware = [bling];
    expect(Number.isFinite(playedWorth(s, hosted))).toBe(true);
  });
});
