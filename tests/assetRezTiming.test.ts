import { describe, expect, it } from 'vitest';
import { HeuristicCorpAI } from '../src/ai/corpAI';
import { installCorpForTest, newGame } from './helpers';

const NICO = '30037';

describe('money assets wait for the window before the Corp’s turn (rules 5.6.1b-d; plan.assetRezTiming)', () => {
  const rezScore = (turnStart: boolean) => {
    const s = newGame();
    s.activePlayer = 'corp';
    s.corp.credits = 10;
    const id = installCorpForTest(s, NICO, 'remote-1');
    if (turnStart) s.turnStep = { kind: 'corp_turn_start' };
    const ranked = new HeuristicCorpAI({ planner: false }).rankMainActions(s);
    return ranked.find(r => r.action.type === 'REZ_CARD' && r.action.cardInstanceId === id)?.score;
  };

  it('in the action phase, Nico Campaign is not rezzed (the Runner would trash it full)', () => {
    expect(rezScore(false) ?? -Infinity).toBe(-Infinity);
  });

  it('just before the turn begins, it is rezzed and pays at once', () => {
    expect(rezScore(true)).toBeGreaterThan(0);
  });
});
