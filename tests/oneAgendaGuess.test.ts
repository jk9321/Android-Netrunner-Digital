import { afterEach, describe, expect, it } from 'vitest';
import { cardDef } from '../src/core';
import { hiddenCardOdds, sideStrength } from '../src/ai/evaluate';
import { remoteAgendaOdds } from '../src/ai/runs';
import { tuning } from '../src/ai/synergy';
import { installForTest, newGame } from './helpers';

/**
 * plan.oneAgendaGuess (code audit cleanup item 9, 2026-11-06): the Runner guessed a facedown remote card two ways. Its
 * run choice (runs.ts remoteAgendaOdds) read an advanced card as an agenda unless a trap, and a card behind ice as
 * likelier one; its board score (evaluate corpBoardValue) gave every facedown card the deck's flat odds. A run could
 * look worth making while the board said the card wasn't worth stealing. Now both use the run choice's guess.
 */
describe('one guess for a facedown remote card (plan.oneAgendaGuess)', () => {
  // On by default since tuning pass 1: the old-way test switches it off
  afterEach(() => { tuning.plan.oneAgendaGuess = true; });
  const position = () => {
    const s = newGame();
    const id = installForTest(s, 'asset', 'remote-1');
    const card = s.corp.servers['remote-1'].root.find(c => c.instanceId === id)!;
    card.advancementCounters = 2;
    return { s, card };
  };

  it('the run choice starts from the board odds, plus the ice in front', () => {
    const { s, card } = position();
    expect(remoteAgendaOdds(s, s.corp.servers['remote-1'], card, 1 / 3)).toBeCloseTo(2 / 3); // advanced: an agenda unless a trap
    card.advancementCounters = 0;
    expect(remoteAgendaOdds(s, s.corp.servers['remote-1'], card, 1 / 3)).toBeCloseTo(hiddenCardOdds(s).agenda);
    installForTest(s, 'ice', 'remote-1');
    expect(remoteAgendaOdds(s, s.corp.servers['remote-1'], card, 1 / 3)).toBeGreaterThan(hiddenCardOdds(s).agenda);
  });

  it('an advanced facedown card looks like an agenda on the Runner\'s board too', () => {
    const { s, card } = position();
    expect(cardDef(card).type_code).toBe('asset'); // what it is doesn't matter: the Runner can't see it
    expect(hiddenCardOdds(s).agenda).toBeLessThan(2 / 3);
    const on = sideStrength(s, 'corp', 'runner');
    tuning.plan.oneAgendaGuess = false;
    try {
      expect(on).toBeGreaterThan(sideStrength(s, 'corp', 'runner'));
    } finally {
      tuning.plan.oneAgendaGuess = true;
    }
  });
});
