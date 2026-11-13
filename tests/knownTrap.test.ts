import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { knownTrap, placedCounterWorth } from '../src/ai/effectValues';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';

/**
 * Part D (spec-jeff-games-48-50.md): a trap the Runner has accessed (card.runnerKnows) is known to it (7.1.2: both sides
 * see an accessed installed card; 10.2.2b: the Runner learned it through a rule), so advancing it buys no bluff and
 * nothing from being accessed again. Games: play test round 2 G2, round 3 G1 (moves only) and Jeff's #51.
 */
const game = (file: string) => JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'));
const at = (file: string, move: number): { s: GameState; played: GameAction } => {
  const r = game(file);
  let s: GameState = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  for (const m of (r.moves as GameAction[]).slice(0, move)) s = executeAction(s, m);
  return { s, played: r.moves[move] };
};
const trapOf = (s: GameState, a: GameAction) => Object.values(s.corp.servers).flatMap(v => v.root).find(c => c.instanceId === (a as { cardInstanceId?: string }).cardInstanceId)!;

describe('Part D: a trap the Runner has accessed', () => {
  // The game's own move was ADVANCE_CARD on an Urtica Cipher the Runner had accessed; a fresh Normal Corp no longer advances it
  for (const [file, move] of [['known-trap-r2g2.json', 155], ['known-trap-r2g2.json', 178], ['known-trap-r3g1.json', 187], ['human-games/report-51.json', 143]] as const) {
    it(`${file} #${move}: no advance on the known trap`, () => {
      const { s, played } = at(file, move);
      expect(played.type).toBe('ADVANCE_CARD');
      expect(knownTrap(trapOf(s, played))).toBe(true);
      const pick = createAgent('corp', 'normal').chooseAction(structuredClone(s)) as GameAction & { cardInstanceId?: string };
      expect(pick.type === 'ADVANCE_CARD' && pick.cardInstanceId === (played as { cardInstanceId?: string }).cardInstanceId).toBe(false);
    }, 60_000);
  }

  // Hidden information: unaccessed, the same Urtica keeps today's price (the bluff and its extra net damage)
  it('r2g2 #155: the counter is worth 0 known and today\'s price unknown', () => {
    const { s, played } = at('known-trap-r2g2.json', 155);
    const card = trapOf(s, played);
    const price = (c: typeof card) => asSide('corp', () => (decisionContext(s, 'corp'), placedCounterWorth(s, c, true)));
    expect(price(card)).toBe(0);
    const unknown = { ...card, runnerKnows: false };
    expect(knownTrap(unknown)).toBe(false);
    expect(price(unknown)).toBeGreaterThan(0);
  });
});

describe('advancePayload flag', () => {
  // A trap whose counters work when the Corp's turn begins (not on access) keeps its counters' worth once known
  it('is set on exactly the advanceable traps that do not fire on access', async () => {
    const { ALL_CARDS } = await import('../src/core/cards');
    const { advancePayloadOf } = await import('../src/ai/cards');
    const { isTrap } = await import('../src/ai/runs');
    const traps = ALL_CARDS.filter(c => c.type_code === 'asset' && isTrap(c.code));
    const byText = traps.filter(c => /you can advance this asset/i.test(c.stripped_text ?? '') && !/when the runner accesses this/i.test(c.stripped_text ?? '')).map(c => c.code).sort();
    expect(traps.filter(c => advancePayloadOf(c.code)).map(c => c.code).sort()).toEqual(byText);
    expect(byText.length).toBeGreaterThan(0);
  });
});
