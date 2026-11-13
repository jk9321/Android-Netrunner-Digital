import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, cardDef, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { assetPartner, discardRescue } from '../src/ai/countedScore';
import { keep } from '../src/ai/prompts';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';
import { tuning } from '../src/ai/synergy';

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
  // its floor may still save the ice when the install is affordable (arm A', plan.discardRescueUnder: 1 credit on R&D, 8.5.11a)
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

  it('off with plan.discardRescue off', () => {
    const { s, pick } = at(50, 94);
    tuning.plan.discardRescue = false;
    try {
      expect(ask(s, pick)).toBeNull();
    } finally {
      tuning.plan.discardRescue = true;
    }
  });
});

/**
 * Ice discard arm B: the scoring remote stays reserved for an agenda in HQ while it is the only remote with ice, though no
 * counted line holds it (3.3.1: one agenda or asset per root). #53 T5 #76: remote-5 (1 ice) was the only iced remote with
 * 4 agenda points in HQ, and a second Balanced Coverage went into its root.
 */
describe('only iced remote: kept for the agendas in HQ', () => {
  const newRemote = { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: 'inst-21', asNewRemote: true } as GameAction;
  const partner = (s: GameState) => asSide('corp', () => (decisionContext(s, 'corp'), assetPartner(s, newRemote)));

  it('#53 #76: an asset for a new remote is not moved into remote-5', () => {
    const { s } = at(53, 76);
    expect(partner(s)).toBeNull();
  });

  it('#53 #76 with plan.onlyRemoteHold off: it is (the reservation releases on a null holdCost)', () => {
    const { s } = at(53, 76);
    tuning.plan.onlyRemoteHold = false;
    try {
      expect(partner(s)).toMatchObject({ type: 'INSTALL_CARD', targetServerId: 'remote-5' });
    } finally {
      tuning.plan.onlyRemoteHold = true;
    }
  });
});
