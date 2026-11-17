// V-B B6 (stage-vb/labels.md, AI Coordinator's ruling 22:15Z, Q3): `lifeCards` (the board clock, evaluate.ts) and the
// first-three extra in the grip's owner (`ownHandValue`, handValues.ts) are an exact cancel pair (VAL-CANCEL-TERMS):
// the owner adds min(grip, handCoreCards) x (handCore - drawnCard) to the Runner's hand and the board clock takes the
// same amount back. Label only in V-B; the hand rework (B4 / V-C) deletes both together. This pins that the two terms
// stay the same expression on the same grip, so a change to one without the other fails here.
import { describe, expect, it } from 'vitest';
import '../src/ai/corpAI';
import { sideStrength } from '../src/ai/evaluate';
import { heldWorth, ownHandValue } from '../src/ai/handValues';
import { withDiagnostics } from '../src/ai/diagnostics';
import { newGame } from './helpers';

describe('V-B B6: lifeCards and the owner\'s first-three extra cancel', () => {
  for (const size of [0, 1, 2, 3, 4, 5]) {
    it(`on a grip of ${size}`, () => {
      const s = structuredClone(newGame(3));
      s.runner.stack.push(...s.runner.grip.splice(size));
      while (s.runner.grip.length < size) s.runner.grip.push(s.runner.stack.shift()!);
      expect(s.runner.grip.length).toBe(size);
      // The owner's extra: its hand price less the cards' own worths (no card over the limit at 5 or fewer)
      const extra = ownHandValue(s, 'runner') - s.runner.grip.reduce((n, c) => n + heldWorth(s, c, 'runner'), 0);
      const taken = withDiagnostics(d => {
        let got: number | undefined;
        d.onValue = (_q, site, _st, value) => {
          if (site === 'lifeCards') got = value;
        };
        sideStrength(s, 'runner');
        return got;
      });
      expect(taken).toBeDefined();
      expect(taken!).toBeCloseTo(extra, 9);
    });
  }
});
