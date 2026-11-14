import { describe, expect, it } from 'vitest';
import { GameState, createInitialGameState, getCardDefinition, isLegalAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS as DECKS } from '../scripts/nsg-sample-decks';
import { SearchAI, playAIGame } from '../src/ai';
import { determinize } from '../src/ai/search';

const corpDeck = DECKS.find(d => d.side === 'corp')!;
const runnerDeck = DECKS.find(d => d.side === 'runner')!;

/** A position some turns into an AI-vs-AI game, with installed cards on both sides. */
function midGame(): GameState {
  const { state } = playAIGame(createInitialGameState(deckGameSetup(4, corpDeck, runnerDeck)), 3000, 2);
  expect(state.winner).toBeNull();
  return state;
}

const codes = (cards: { cardCode: string }[]) => cards.map(c => c.cardCode).sort();
const corpHidden = (s: GameState) => [
  ...s.corp.hq,
  ...s.corp.rd,
  ...s.corp.archives.faceDown,
  ...Object.values(s.corp.servers).flatMap(sv => [...sv.ice, ...sv.root]).filter(c => !c.isRezzed),
];
let n = 0;
const random = () => ((n = (n * 9301 + 49297) % 233280), n / 233280);

describe('search AI', () => {
  it("re-deals only what the Runner can't see", () => {
    const state = midGame();
    const world = determinize(state, 'runner', random);
    // Same cards overall, same zone sizes
    expect(codes(corpHidden(world))).toEqual(codes(corpHidden(state)));
    expect(world.corp.hq.length).toBe(state.corp.hq.length);
    expect(world.corp.rd.length).toBe(state.corp.rd.length);
    // Rezzed cards and the Runner's own cards are untouched; unrezzed ice is still ice
    for (const [id, server] of Object.entries(state.corp.servers)) {
      server.ice.forEach((ice, i) => {
        const guess = world.corp.servers[id].ice[i];
        if (ice.isRezzed) expect(guess.cardCode).toBe(ice.cardCode);
        else expect(getCardDefinition(guess.cardCode).type_code).toBe('ice');
      });
    }
    expect(codes(world.runner.grip)).toEqual(codes(state.runner.grip));
  });

  it("re-deals only what the Corp can't see", () => {
    const state = midGame();
    const world = determinize(state, 'corp', random);
    expect(world.runner.grip.length).toBe(state.runner.grip.length);
    expect(codes([...world.runner.grip, ...world.runner.stack])).toEqual(codes([...state.runner.grip, ...state.runner.stack]));
    expect(codes(world.corp.hq)).toEqual(codes(state.corp.hq));
    expect(codes(world.runner.heap)).toEqual(codes(state.runner.heap));
  });

  it('picks legal moves for both sides', () => {
    const state = midGame();
    for (const side of ['corp', 'runner'] as const) {
      const s = structuredClone(state);
      s.activePlayer = side;
      s.phase = side === 'corp' ? 'corp_turn' : 'runner_turn';
      s[side].clicks = side === 'corp' ? 3 : 4;
      s.pendingPrompts = [];
      s.activeRun = null;
      s.turnStep = null; // midGame() can stop at the start of a Corp turn, in its paid ability window
      s.priority = undefined;
      const ai = new SearchAI(side, { samples: 1, candidates: 3, seed: 1 });
      expect(isLegalAction(s, ai.chooseAction(s))).toBe(true);
    }
  });
});
