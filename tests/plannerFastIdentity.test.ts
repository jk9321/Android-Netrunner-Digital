import { describe, expect, it } from 'vitest';
import { CardInstance, GameState, actingSide, cardDef, createInitialGameState, createRng, executeAction, getLegalActions } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { pairing, pickAction } from '../scripts/engine-fuzz-check';
import { fingerprint } from '../src/ai/valueModel';
import { breakerTypeWorth, deckIceShare, iceTypeOdds } from '../src/ai/iceValues';

// Planner speed 1+2 (ai-planner-fast, redesign/planner-fast-step1.md): pure rewrites that must give the same values
// bit for bit. Checked against the code they replaced, copied here, on every state of random legal games.

/** fingerprint as it was before the rewrite (array join). */
function oldFingerprint(state: GameState): string {
  const { corp, runner } = state;
  const ids = (cards: CardInstance[]) => cards.map(c => c.instanceId + (c.isRezzed ? 'r' : '') + (c.hostedCards?.length ?? '')).join(',');
  const servers = Object.values(corp.servers).map(s => s.id + ':' + ids(s.ice) + '/' + ids(s.root)).join(';');
  return [
    state.turnNumber, state.activePlayer, corp.credits, corp.clicks, corp.score, corp.hq.length, corp.rd.length, corp.archives.faceUp.length, corp.archives.faceDown.length,
    runner.credits, runner.clicks, runner.score, runner.tags, runner.grip.length, runner.stack.length, ids(runner.rig.programs), ids(runner.rig.hardware), ids(runner.rig.resources), servers,
  ].join('|');
}

const ICE_TYPES = ['barrier', 'code gate', 'sentry'] as const;
/** iceTypeOdds as it was before the rewrite (keywords read on every call). */
function oldIceTypeOdds(state: GameState): Record<string, number> {
  const deck = deckIceShare(state);
  const shown = [
    ...Object.values(state.corp.servers).flatMap(s => s.ice).filter(c => c.isRezzed),
    ...state.corp.archives.faceUp.filter(c => cardDef(c).type_code === 'ice'),
  ];
  const count: Record<string, number> = Object.fromEntries(ICE_TYPES.map(t => [t, 3 * deck[t]]));
  for (const ice of shown) {
    const keywords = (cardDef(ice).keywords ?? '').toLowerCase();
    for (const t of ICE_TYPES) if (keywords.includes(t)) count[t]++;
  }
  const total = ICE_TYPES.reduce((n, t) => n + count[t], 0);
  return Object.fromEntries(ICE_TYPES.map(t => [t, count[t] / total]));
}

/** Every state of a few random legal games (seeded), with rezzed ice now and then so the odds move. */
function randomStates(games: number, steps: number): GameState[] {
  const out: GameState[] = [];
  for (let g = 0; g < games; g++) {
    const { corp, runner } = pairing(g);
    const rng = createRng(4242 + g);
    let state = createInitialGameState(deckGameSetup(900 + g, corp, runner));
    out.push(state);
    for (let i = 0; i < steps && !state.winner; i++) {
      const side = actingSide(state);
      if (!side) break;
      const action = pickAction(getLegalActions(state, side), rng);
      if (!action) break;
      state = executeAction(state, action);
      out.push(state);
    }
  }
  return out;
}

describe('planner speed 1+2: same values as the code replaced', () => {
  const states = randomStates(12, 220);

  it('fingerprint gives the same string as the array join', () => {
    let rezzed = 0;
    for (const s of states) {
      expect(fingerprint(s)).toBe(oldFingerprint(s));
      if (Object.values(s.corp.servers).some(v => v.ice.some(c => c.isRezzed))) rezzed++;
    }
    expect(states.length).toBeGreaterThan(1000);
    expect(rezzed).toBeGreaterThan(0);
  });

  it('iceTypeOdds and breakerTypeWorth (with the odds passed in or not) are unchanged, bit for bit', () => {
    for (const s of states) {
      const odds = iceTypeOdds(s);
      expect(odds).toEqual(oldIceTypeOdds(s));
      for (const t of ICE_TYPES) expect(breakerTypeWorth(s, t, odds)).toBe(breakerTypeWorth(s, t));
    }
  });
});
