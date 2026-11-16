import { describe, expect, it } from 'vitest';
import { getCardDefinition } from '../src/core';
import { CARDS } from '../src/ai/cards';
import { PAYOUT_RISK, assetRisk, bareAssetRisk } from '../src/ai/cardProfiles';
import { corpEffect, perTurn } from '../src/ai/effectValues';
import { newGame } from './helpers';

/**
 * V-B B3 (brief rev 2, ruling 5 and the mechanism ruling in stage-vb/labels.md): a Corp asset's formula reads the measured
 * risk (assetRisk: bare before install), every other Corp card keeps PAYOUT_RISK.corpBare until Stage V-C measures one, and
 * the hosted credits of Nico Campaign, Otto Campaign and Anthill Excavation Contract read the risk where the card sits.
 */
describe('V-B B3: the measured risk for Corp assets', () => {
  it("perTurn at the number corpBare is perTurn at 'corp'", () => {
    const state = newGame();
    for (const [x, min, max] of [[1, 0, Infinity], [2.5, 0, 3], [0.7, 2, 4]] as const)
      expect(perTurn(state, x, PAYOUT_RISK.corpBare, min, max)).toBe(perTurn(state, x, 'corp', min, max));
  });

  it('the risk is the owner: payoutWait reads assetRisk, bare moves with the game record', () => {
    const state = newGame();
    expect(assetRisk(state, true)).toBe(PAYOUT_RISK.moneyIced);
    expect(assetRisk(state, false)).toBe(bareAssetRisk(state));
    state.bareAssets = { exposed: 2, trashed: 2 };
    expect(assetRisk(state, false)).toBeCloseTo((3 * PAYOUT_RISK.moneyBare + 2) / 5, 12);
  });

  it("every Corp asset formula that pays over time reads the measured risk, other Corp cards don't", () => {
    const state = newGame();
    const formulas = Object.keys(CARDS).filter(code => CARDS[code].corp);
    // With the bare risk set to corpBare, every formula prices as it did before B3: only the assets' risk moved
    const moved: string[] = [];
    for (const code of formulas) {
      const now = corpEffect(state, code)?.keep;
      const at = structuredClone(state);
      // exposed n, trashed k with (3 * 0.268 + k) / (3 + n) = 0.06: k = 0.06 * (3 + n) - 0.804, n = 100: k = 5.376
      at.bareAssets = { exposed: 100, trashed: 0.06 * 103 - 3 * PAYOUT_RISK.moneyBare };
      expect(bareAssetRisk(at)).toBeCloseTo(PAYOUT_RISK.corpBare, 12);
      const before = corpEffect(at, code)?.keep;
      if (Math.abs((now ?? 0) - (before ?? 0)) > 1e-9) moved.push(getCardDefinition(code).type_code);
    }
    expect(moved.length).toBeGreaterThan(10);
    expect(new Set(moved)).toEqual(new Set(['asset']));
  });
});
