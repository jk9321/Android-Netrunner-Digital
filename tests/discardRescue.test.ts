import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, cardDef, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { discardRescue } from '../src/ai/countedScore';
import { keep } from '../src/ai/prompts';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';

/**
 * Discard rescue (spec ice-discard arm A, bars/ice-discard.md): a credit or draw click (5.2.6a-b) while a discard is
 * certain at the end of the turn (4.3.6, 5.5.3, 5.6.3a) installs an ice from HQ on a central that does not hold instead.
 * States are Jeff's games replayed to the move; the pick is the move the AI Corp made there.
 */
const report = (n: number) => JSON.parse(readFileSync(new URL(`./fixtures/human-games/report-${n}.json`, import.meta.url), 'utf8'));
const at = (n: number, move: number): { s: GameState; pick: GameAction } => {
  const r = report(n);
  let s: GameState = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  for (const m of (r.moves as GameAction[]).slice(0, move)) s = executeAction(s, m);
  return { s, pick: r.moves[move] };
};
const ask = (s: GameState, pick: GameAction) => asSide('corp', () => (decisionContext(s, 'corp'), discardRescue(s, pick, c => keep(s, c, true))));
const title = (s: GameState, a: GameAction | null) => {
  const id = (a as { cardInstanceId?: string } | null)?.cardInstanceId;
  const c = s.corp.hq.find(x => x.instanceId === id);
  return c ? cardDef(c).title : undefined;
};

describe('discard rescue: an ice the discard would throw away goes on a central instead', () => {
  // #50 T6: last click for a credit with 6 cards in HQ (5 allowed); Ablative Barrier was then discarded
  it('#50 #94: Ablative Barrier is installed on a central, not discarded', () => {
    const { s, pick } = at(50, 94);
    expect(pick.type).toBe('GAIN_CREDIT');
    const r = ask(s, pick);
    expect(r).toMatchObject({ type: 'INSTALL_CARD' });
    expect(['hq', 'rd']).toContain((r as { targetServerId?: string }).targetServerId);
    expect(title(s, r)).toBe('Ablative Barrier');
  });

  // #50 T8: the same with Bumi 1.0
  it('#50 #133: Bumi 1.0 is installed on a central, not discarded', () => {
    const { s, pick } = at(50, 133);
    const r = ask(s, pick);
    expect(r).toMatchObject({ type: 'INSTALL_CARD' });
    expect(title(s, r)).toBe('Bumi 1.0');
  });

  // #48 T8: 7 cards in HQ, 2 clicks, 1 credit against afterLineFloor 4; Funhouse was then discarded. A Corp already under
  // its floor may still save the ice when the install is affordable (arm A': 1 credit on R&D, 8.5.11a)
  it('#48 #93: Funhouse is installed on a central though the Corp is under its floor', () => {
    const { s, pick } = at(48, 93);
    const r = ask(s, pick);
    expect(r).toMatchObject({ type: 'INSTALL_CARD', targetServerId: 'rd' });
    expect(title(s, r)).toBe('Funhouse');
  });

  it('no rescue while the hand fits after the clicks left (#50 #93: one click left could still play a card)', () => {
    const { s, pick } = at(50, 93);
    expect(ask(s, pick)).toBeNull();
  });

  it('only a credit or draw click is redirected', () => {
    const { s } = at(50, 94);
    expect(ask(s, { type: 'END_TURN', player: 'corp' } as GameAction)).toBeNull();
  });
});

