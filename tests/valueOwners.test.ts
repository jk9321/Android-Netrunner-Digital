// Valuation V-A, known-answer check 2 (red-team ruling 9; brief-stage-va-owners.md rev 2): the cost-once column the
// disagreement log (scripts/value-owners/log.ts) reports for the Corp formula cards reproduces the valuation audit's P3
// (audits/2026-11-16-ai-valuation/probes/v-probes.test.ts, finding VAL-CORP-FORMULA-COST): worth unrezzed less worth
// rezzed, plus the rez cost, is the cost a formula leaves out. 15 cards leave some of it out; the other 33 take it off
// exactly once. The column is f(0) - cost (ruling 10): the formula's worth rezzed, less the cost once. These are the
// numbers V-B's cost correction starts from; when V-B fixes the 15, this table goes to all zeros in the same branch.
import { describe, expect, it } from 'vitest';
import { getCardDefinition } from '../src/core';
import '../src/ai/corpAI';
import { asSide } from '../src/ai/synergy';
import { corpEffect } from '../src/ai/effectValues';
import { EFFECT_CODES } from '../src/ai/cards';
import { corpKeepValue, isEconAsset } from '../src/ai/cardValues';
import { CARDS, CARD_VALUES } from '../src/ai/cards';
import { newGame } from './helpers';

/** The audit's P3 gaps, by title (report VAL-CORP-FORMULA-COST). Every other Corp formula card: 0. */
// V-B B2: the 10 linear ones take their cost off in their entries (ruling 18: gap = cost on every board; upgrade slots
// too, whose one reader, corp/rez.ts upgradeValue, clamps at 0). Left, ruled no change (stage-vb/labels.md B2): Hype
// Machine, priced for the free-rez window only (free to rez after an agenda, so its 6 is not taken off); and four
// clamps on the tuning list, each taking its cost off once inside Math.max(0.3, ...) where the 0.3 floor swallows part
const P3_GAPS: Record<string, number> = {
  'Hype Machine': 6,
  Synchrocyclotron: 3,
  'Nihilo Agent': 1,
  'Isaac Liberdade': 2.3,
  'B-1001': 0.8,
};

/**
 * Not in the audit's list, found by this check: Vovô Ozetti takes its cost off once, but inside Math.max(0.3, ...)
 * (cards/liberation.ts), so on newGame(3) at score 0 the unrezzed worth sits on the 0.3 floor and the gap is the part of
 * the cost the floor swallowed. A clamp, not a missing subtraction: the non-linear case of ruling 10, which the log's
 * linearity column reports per card. At score 4 the floor is not reached.
 */
/*
 * V-B B3 (ruling 5): the asset formulas read the measured risk (bareAssetRisk, 0.268 at the prior, for 0.06), so four
 * more assets that take their cost off once inside Math.max(0.3, ...) sit on the same floor unrezzed on this board:
 * Wage Workers, Cybersand Harvester and Hearts and Minds at both scores, Magistrate Revontulet at score 4. The same
 * clamp, not a missing subtraction; on the tuning list with the other floor cases.
 */
const FLOORED: Record<number, Record<string, number>> = {
  0: { 'Vovô Ozetti': 0.23, 'Wage Workers': 0.61, 'Cybersand Harvester': 0.51, 'Hearts and Minds': 0.09 },
  4: { 'Wage Workers': 0.79, 'Cybersand Harvester': 0.69, 'Hearts and Minds': 0.21, 'Magistrate Revontulet': 0.05 },
};

describe('valuation V-A known answers', () => {
  const corpCodes = EFFECT_CODES.filter(c => getCardDefinition(c).side_code === 'corp');

  it('has the 48 Corp formula cards the audit measured', () => {
    expect(corpCodes.length).toBe(48);
    const titles = new Set(corpCodes.map(c => getCardDefinition(c).title));
    for (const t of Object.keys(P3_GAPS)) expect(titles, t).toContain(t);
  });

  for (const score of [0, 4]) {
    it(`reproduces the P3 cost gaps at score ${score} (5 cards, 0.00 for the other 43)`, () => {
      const s = structuredClone(newGame(3));
      s.corp.score = score;
      const got: Record<string, number> = {};
      for (const code of corpCodes) {
        const def = getCardDefinition(code);
        const unrezzed = asSide('corp', () => corpKeepValue(code, s));
        const rezzed = asSide('corp', () => corpEffect(s, code, true)?.keep ?? NaN);
        got[def.title] = Math.round((unrezzed - rezzed + (def.cost ?? 0)) * 100) / 100;
      }
      const want = Object.fromEntries(Object.keys(got).map(t => [t, P3_GAPS[t] ?? 0]));
      Object.assign(want, FLOORED[score]);
      // the audit printed two decimals and rounded Isaac Liberdade and B-1001 to one in the report
      for (const t of Object.keys(got)) expect(got[t], t).toBeCloseTo(want[t], 1);
      expect(Object.values(got).filter(g => Math.abs(g) >= 0.05).length).toBe(5 + Object.keys(FLOORED[score]).length);
    });
  }

  // V-B B2 (ruling 3): econValue's readers only asked whether it was defined. isEconAsset gives the same answer on every
  // Corp card with an AI entry: these 15, the set econValue was defined for on 15 boards of deals 1001, 2181 and 1641
  // (never 0, never varying by board), measured before econValue was deleted
  it('isEconAsset is true for exactly the 15 cards econValue priced', () => {
    const codes = [...new Set([...Object.keys(CARDS), ...Object.keys(CARD_VALUES)])].filter(c => getCardDefinition(c)?.side_code === 'corp');
    expect(codes.filter(isEconAsset).sort()).toEqual(['30037', '30053', '30071', '34033', '34050', '34058', '34099', '34107', '34108', '34115', '35039', '35040', '35062', '35072', '36057']);
  });
});
