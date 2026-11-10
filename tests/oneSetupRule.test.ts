import { describe, expect, it } from 'vitest';
import { GameState, actingSide, cardDef, executeAction } from '../src/core';
import { createAgent } from '../src/ai';
import { giveCard, installForTest, installIceForTest, newGame } from './helpers';

/**
 * The old plan.oneSetupRule (code audit cleanup item 8, 2026-11-06; folded in tuning pass 1): a play that lets this turn's
 * clicks and credits finish an agenda ranked with the advance that would (plan.finishSetup), whatever the card. Counted
 * scoring (plan.scoreNow) now finds the line by counting, and step 2 deleted the rank (+0.3 ± 0.4 at games=3,
 * spec-step2-delete-redundant.md): the Corp still plays Nanomanagement first. Rules: 1.17.3a scoring needs counters at
 * the requirement; 5.2.6f an advance is a click and a credit.
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
  /** The Normal Corp plays the rest of its turn. */
  const turn = (state: GameState) => {
    let s = state;
    const corp = createAgent('corp', 'normal', {});
    const runner = createAgent('runner', 'normal', {});
    for (let i = 0; i < 30 && s.activePlayer === 'corp' && !s.winner; i++) s = executeAction(s, (actingSide(s) === 'corp' ? corp : runner).chooseAction(s));
    return s;
  };

  it('Nanomanagement with 2 clicks left for 3 advances: its 2 clicks let the turn finish it, and the Corp does', () => {
    const { s, op } = position('35043', 2);
    const agenda = s.corp.servers['remote-1'].root[0].instanceId;
    const after = turn(s);
    expect(after.corp.scoreArea.map(c => c.instanceId)).toContain(agenda);
    expect([...after.corp.archives.faceUp, ...after.corp.archives.faceDown].map(c => c.instanceId)).toContain(op);
  }, 30_000); // plays a whole Corp turn through the exact score search: ~6 s on CI
});
