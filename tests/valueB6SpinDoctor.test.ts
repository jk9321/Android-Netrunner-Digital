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
    const card = 0.3 * cardRate(s, 'corp');
    const worth = [card, ...s.corp.archives.faceDown.map(() => agenda * archivedAgendaLoss(s, agendaPoints) + (1 - agenda) * card)].sort((a, b) => b - a);
    expect(Object.is(spent(s, 'runner', spin), 0.3 + worth[0] + worth[1])).toBe(true);
  });
});
