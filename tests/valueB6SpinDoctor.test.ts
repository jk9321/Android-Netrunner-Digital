// V-B B6 review M1 (review-stage-vb-b6-rest.md; ruling at the end of stage-vb/labels.md): a rezzed Spin Doctor's spent
// worth (its entry's `spent`, read by corpCardValue for both viewers) prices Archives as the viewer knows it. The Runner
// prices a facedown card by its agenda odds (unchanged); the Corp knows its own cards (an agenda at its Archives loss,
// anything else at 0.3 x a card) and, as every asset since V-B B3, holds the option at one turn's measured risk where
// the card sits (assetRisk).
import { describe, expect, it } from 'vitest';
import '../src/ai/corpAI';
import { cardDef, CardInstance, GameState } from '../src/core';
import { createCardInstance } from '../src/core/engine/gameState';
import { CARDS } from '../src/ai/cards';
import { archivedAgendaLoss, evaluate, hiddenCardOdds } from '../src/ai/evaluate';
import { assetRisk } from '../src/ai/cardProfiles';
import { cardRate } from '../src/ai/valueModel';
import { newGame } from './helpers';
import { inDecision } from './helpers/pricing';

const SPIN = '30053';
const withSpin = (ice: string[] = []): { s: GameState; spin: CardInstance } => {
  const s = structuredClone(newGame());
  const spin = createCardInstance(s, SPIN);
  spin.isRezzed = true;
  s.corp.servers['remote-1'] = { id: 'remote-1', name: 'remote-1', isRemote: true, ice: ice.map(c => createCardInstance(s, c)), root: [spin] };
  return { s, spin };
};
const spent = (s: GameState, viewer: 'corp' | 'runner', spin: CardInstance) => CARDS[SPIN].spent!(s, viewer, spin);

describe('V-B B6: a spent Spin Doctor prices Archives as the viewer knows it', () => {
  it('a known non-agenda discard to facedown Archives does not raise the Corp\'s evaluate', () => {
    const at = (k: number) => {
      const { s } = withSpin();
      const junk = s.corp.hq.filter(c => cardDef(c).type_code !== 'agenda').slice(0, k);
      expect(junk.length).toBe(k);
      s.corp.hq = s.corp.hq.filter(c => !junk.includes(c));
      s.corp.archives.faceDown.push(...junk);
      return evaluate(s, 'corp');
    };
    const [e0, e1, e2] = [at(0), at(1), at(2)];
    expect(e1).toBeLessThanOrEqual(e0);
    expect(e2).toBeLessThanOrEqual(e1);
  });

  it('a real facedown agenda: worth its Archives loss at the bare risk to the Corp', () => {
    const { s, spin } = withSpin();
    const agenda = createCardInstance(s, '30069');
    s.corp.archives.faceDown.push(agenda);
    expect(spent(s, 'corp', spin)).toBeCloseTo(0.3 + (1 - assetRisk(s, false)) * archivedAgendaLoss(s, cardDef(agenda).agenda_points ?? 1), 12);
  });

  it('with a real agenda in Archives, a bare Spin Doctor is worth less than an iced one', () => {
    const worth = (ice: string[]) => {
      const { s, spin } = withSpin(ice);
      s.corp.archives.faceDown.push(createCardInstance(s, '30069'));
      return spent(s, 'corp', spin);
    };
    expect(worth([])).toBeLessThan(worth(['30072']));
  });

  it('the Corp\'s evaluate with the agenda in Archives is below the same board without it', () => {
    const board = (archived: boolean) => {
      const { s } = withSpin();
      const agenda = createCardInstance(s, '30069');
      if (archived) s.corp.archives.faceDown.push(agenda);
      else s.corp.rd.push(agenda);
      return evaluate(s, 'corp');
    };
    expect(board(true)).toBeLessThan(board(false));
  });

  it('the Runner\'s view is the agenda odds on every facedown card, as before (to the bit)', () => {
    const { s, spin } = withSpin();
    s.corp.archives.faceDown.push(createCardInstance(s, '30069'), ...s.corp.hq.splice(0, 2));
    s.corp.archives.faceUp.push(s.corp.hq.splice(0, 1)[0]);
    const { agenda, agendaPoints } = hiddenCardOdds(s);
    const card = 0.3 * cardRate(s, 'corp', 'later');
    const worth = [card, ...s.corp.archives.faceDown.map(() => agenda * archivedAgendaLoss(s, agendaPoints) + (1 - agenda) * card)].sort((a, b) => b - a);
    expect(Object.is(spent(s, 'runner', spin), 0.3 + worth[0] + worth[1])).toBe(true);
  });
});

// V-B B6 review M1b: inside a noted decision, the cards the Corp cannot know are those in R&D at the decision's root;
// everything else in Archives (already there, or discarded from a hand) it prices by what it is.
describe('V-B B6 M1b: a spent Spin Doctor inside a decision', () => {
  const known = (s: GameState, c: CardInstance) => (cardDef(c).type_code === 'agenda' ? archivedAgendaLoss(s, cardDef(c).agenda_points ?? 1) : 0.3 * cardRate(s, 'corp', 'later'));
  const odds = (s: GameState) => {
    const { agenda, agendaPoints } = hiddenCardOdds(s);
    return agenda * archivedAgendaLoss(s, agendaPoints) + (1 - agenda) * 0.3 * cardRate(s, 'corp', 'later');
  };
  const top2 = (xs: number[]) => xs.sort((a, b) => b - a).slice(0, 2).reduce((a, b) => a + b, 0);

  it('Archives already holding two junk cards and an agenda at the root: priced as known', () => {
    const { s, spin } = withSpin();
    const junk = s.corp.hq.filter(c => cardDef(c).type_code !== 'agenda').slice(0, 2);
    s.corp.hq = s.corp.hq.filter(c => !junk.includes(c));
    s.corp.archives.faceDown.push(...junk, createCardInstance(s, '30069'));
    const want = 0.3 + (1 - assetRisk(s, false)) * top2(s.corp.archives.faceDown.map(c => known(s, c)));
    expect(inDecision(s, 'corp', () => spent(s, 'corp', spin))).toBeCloseTo(want, 12);
  });

  it('a look-ahead board with a root-R&D card facedown in Archives: priced by the odds', () => {
    const { s: root, spin } = withSpin();
    const child = structuredClone(root);
    const milled = child.corp.rd.shift()!;
    child.corp.archives.faceDown.push(milled);
    const want = 0.3 + (1 - assetRisk(child, false)) * odds(child);
    expect(inDecision(root, 'corp', () => spent(child, 'corp', spin))).toBeCloseTo(want, 12);
  });

  it('a card discarded from the starting hand on a look-ahead board: known', () => {
    const { s: root, spin } = withSpin();
    const child = structuredClone(root);
    const card = child.corp.hq.shift()!;
    child.corp.archives.faceDown.push(card);
    const want = 0.3 + (1 - assetRisk(child, false)) * known(child, card);
    expect(inDecision(root, 'corp', () => spent(child, 'corp', spin))).toBeCloseTo(want, 12);
  });

  it('the discard table inside a decision: evaluate does not rise', () => {
    const board = (root: GameState, k: number) => {
      const s = structuredClone(root);
      const junk = s.corp.hq.filter(c => cardDef(c).type_code !== 'agenda').slice(0, k);
      expect(junk.length).toBe(k);
      s.corp.hq = s.corp.hq.filter(c => !junk.includes(c));
      s.corp.archives.faceDown.push(...junk);
      return s;
    };
    const { s: start } = withSpin();
    // each board as its own decision's root (the junk already in Archives)
    const own = [0, 1, 2].map(k => { const b = board(start, k); return inDecision(b, 'corp', () => evaluate(b, 'corp')); });
    // each board as a look-ahead from the board before the discards
    const ahead = [0, 1, 2].map(k => inDecision(start, 'corp', () => evaluate(board(start, k), 'corp')));
    for (const e of [own, ahead]) {
      expect(e[1]).toBeLessThanOrEqual(e[0]);
      expect(e[2]).toBeLessThanOrEqual(e[1]);
    }
  });
});
