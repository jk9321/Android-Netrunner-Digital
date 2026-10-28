import { describe, expect, it } from 'vitest';
import { PETTY_CASH_REPLAY, iceAdvanceWorth, placedCounterWorth, rezEffectWorth, rezzedWorth, topDownWorth } from '../src/ai/effectValues';
import { CLICK, RATES } from '../src/ai/valueModel';
import { createCardInstance } from '../src/core/engine/gameState';
import { newGame } from './helpers';

describe('value hacks replaced by the model (Jeff, 2026-10-28; plan.modelHacks)', () => {
  it('Ping: its rez tag is worth a tag', () => {
    const s = newGame();
    expect(rezEffectWorth(createCardInstance(s, '30055'), 3)).toBe(3);
    expect(rezEffectWorth(createCardInstance(s, '30072'), 3)).toBe(0); // Palisade: nothing on rez
  });

  it('Idiosyncresis and Clearinghouse are worth rezzing only with counters on them', () => {
    const s = newGame();
    const idio = createCardInstance(s, '35061');
    expect(rezzedWorth(s, idio, 1)).toBeLessThan(0);
    idio.advancementCounters = 2;
    expect(rezzedWorth(s, idio, 1)).toBe(9);
    const clearing = createCardInstance(s, '30061');
    expect(rezzedWorth(s, clearing, 0)).toBeLessThan(0);
  });

  it('Pharos: an advance is worth its share of the +5 strength at 3 counters, nothing once there', () => {
    const s = newGame();
    const pharos = createCardInstance(s, '30063');
    pharos.advancementCounters = 2;
    const at = (n: number) => (n >= 3 ? 8 : 2);
    expect(iceAdvanceWorth(s, pharos, at)).toBe(6);
    pharos.advancementCounters = 3;
    expect(iceAdvanceWorth(s, pharos, at)).toBe(0);
  });

  it('a placed counter: on an agenda behind ice, its share of the points; on a bare trap, the bluff and the damage', () => {
    const s = newGame();
    const agenda = createCardInstance(s, '30069');
    expect(placedCounterWorth(s, agenda, true)).toBeGreaterThan(placedCounterWorth(s, agenda, false));
    const urtica = createCardInstance(s, '30045');
    expect(placedCounterWorth(s, urtica, false)).toBeGreaterThan(1);
  });

  it('Petty Cash replays for its net 2 credits; Top-Down Solutions is 2 cards and free installs', () => {
    expect(PETTY_CASH_REPLAY).toBeCloseTo(1.7);
    expect(topDownWorth(2)).toBeCloseTo(2 * RATES.drawnCard + CLICK);
    expect(topDownWorth(0)).toBeCloseTo(2 * RATES.drawnCard - CLICK);
  });
});
