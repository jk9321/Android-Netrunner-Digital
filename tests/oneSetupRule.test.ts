import { describe, expect, it } from 'vitest';
import { cardDef } from '../src/core';
import { HeuristicCorpAI } from '../src/ai';
import { giveCard, installForTest, installIceForTest, newGame } from './helpers';

/**
 * The old plan.oneSetupRule (code audit cleanup item 8, 2026-11-06; folded in tuning pass 1): a play that lets this turn's clicks and credits finish an
 * agenda ranks with the advance that would (plan.finishSetup), whatever the card. Nanomanagement (+2 clicks) and
 * Touch-ups (2 advancements) had a bonus of their own besides (the score it leads to, on another scale); now
 * finishSetup ranks them like any other.
 */
describe('one rule for plays that let an agenda be finished', () => {
  const position = (code: string, clicks: number) => {
    const s = newGame();
    s.corp.clicks = clicks;
    s.corp.credits = 10;
    const id = installForTest(s, 'agenda', 'remote-1');
    installIceForTest(s, '30071', 'remote-1'); // a rezzed ice in front
    const agenda = s.corp.servers['remote-1'].root.find(c => c.instanceId === id)!;
    agenda.advancementCounters = Math.max(0, (cardDef(agenda).advancement_cost ?? 3) - 3);
    const op = giveCard(s, 'corp', code);
    return { s, op };
  };
  const top = (s: ReturnType<typeof position>['s']) => new HeuristicCorpAI({ planner: false }).rankMainActions(s)[0];

  it('Nanomanagement with 2 clicks left for 3 advances: its 2 clicks let the turn finish it, so it goes first', () => {
    const { s, op } = position('35043', 2);
    const best = top(s);
    expect(best.action.type === 'PLAY_OPERATION_OR_EVENT' && best.action.cardInstanceId).toBe(op);
    expect(best.score).toBeGreaterThanOrEqual(40);
  });
});
