/**
 * Planner speed (planner-fast-rigloss-sizing.md): the tag clock (evaluate.ts rigLosses) reuses an installed Runner card's
 * worth on the board without one of the resources, unless the card's entry says it reads the rig (CardAI readsRig). The
 * flag is not trusted: here every installable Runner card the AI prices (each sample deck's rig, then every other card in
 * src/ai/cards on a sample board) is priced with and without each resource, and a card whose worth changes must carry
 * the flag. A game-length on-hit audit then checks every reused term in play.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CardInstance, GameState, createCardInstance, createInitialGameState, getCardDefinition } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from '../scripts/nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { CARDS, readsRigOf } from '../src/ai/cards';
import { rigCardTerms, rigTermAudit } from '../src/ai/evaluate';
import { valueLoops } from '../src/ai/valueModel';
import { clearThreatCaches } from '../src/ai/threatModel';
import { isIcebreaker } from '../src/core/engine/ice';
import { inDecision } from './helpers/pricing';

const INSTALLABLE = new Set(['program', 'hardware', 'resource']);
const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');

/** A Runner deck's game with one copy of each of its installable non-breaker cards (and `extra`) in the rig. */
function rigBoard(deckIndex: number, extra: string[] = []): GameState {
  const s = createInitialGameState(deckGameSetup(1001 + 10 * deckIndex, corpDecks[0], runnerDecks[deckIndex]));
  const r = s.runner;
  r.credits = 12;
  const seen = new Set<string>();
  const pool = [...r.grip, ...r.stack];
  const take = pool.filter(c => {
    const d = getCardDefinition(c.cardCode);
    if (!INSTALLABLE.has(d.type_code) || isIcebreaker(c) || seen.has(c.cardCode)) return false;
    seen.add(c.cardCode);
    return true;
  });
  const moved = new Set(take.map(c => c.instanceId));
  r.grip = r.grip.filter(c => !moved.has(c.instanceId));
  r.stack = r.stack.filter(c => !moved.has(c.instanceId));
  const all = [...take, ...extra.filter(code => !seen.has(code)).map(code => createCardInstance(s, code))];
  for (const c of all) {
    const t = getCardDefinition(c.cardCode).type_code;
    (t === 'program' ? r.rig.programs : t === 'hardware' ? r.rig.hardware : r.rig.resources).push(c);
  }
  return s;
}

/** Cards on `s` whose terms change when a resource is taken out (each with a resource that moves it). */
function readers(s: GameState): Map<string, string> {
  const rig = s.runner.rig;
  const cards: CardInstance[] = [...rig.programs, ...rig.hardware, ...rig.resources];
  const out = new Map<string, string>();
  inDecision(s, 'corp', () => {
    const full = cards.map(c => rigCardTerms(s, c));
    for (const r of rig.resources) {
      const without = { ...s, runner: { ...s.runner, rig: { ...rig, resources: rig.resources.filter(c => c !== r) } } };
      cards.forEach((c, i) => {
        if (c === r || out.has(c.cardCode)) return;
        const t = rigCardTerms(without, c);
        if (t.some((v, j) => v !== full[i][j])) out.set(c.cardCode, r.cardCode);
      });
    }
  });
  return out;
}

const title = (code: string) => `${getCardDefinition(code).title} (${code})`;

describe('rig-loss terms: a card whose worth changes without a resource carries readsRig', () => {
  it('every sample deck rig, then every other Runner card in src/ai/cards', () => {
    const found = new Map<string, string>();
    const covered = new Set<string>();
    runnerDecks.forEach((_, i) => {
      const s = rigBoard(i);
      for (const c of [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources]) covered.add(c.cardCode);
      for (const [code, by] of readers(s)) found.set(code, by);
    });
    const rest = Object.keys(CARDS).filter(code => {
      const d = getCardDefinition(code);
      return d?.side_code === 'runner' && INSTALLABLE.has(d.type_code) && !covered.has(code);
    });
    // The rest a few at a time, on each sample board in turn
    for (let i = 0; i < rest.length; i += 6) {
      const s = rigBoard((i / 6) % runnerDecks.length, rest.slice(i, i + 6));
      for (const [code, by] of readers(s)) found.set(code, by);
    }
    const missing = [...found].filter(([code]) => !readsRigOf(code)).map(([code, by]) => `${title(code)} changes without ${title(by)}`);
    expect(missing, "add readsRig: true to these cards' entries").toEqual([]);
    expect(covered.size + rest.length).toBeGreaterThan(100);
  }, 300_000);
});

describe('rig-loss terms: every reused term in play is the term of its board (on-hit audit)', () => {
  afterEach(() => {
    rigTermAudit.on = false;
  });
  for (const [seed, actions] of [
    [1141, 400],
    [1441, 400],
  ] as const) {
    it(`deal ${seed}, first ${actions} actions`, () => {
      const p = Math.floor((seed - 1001) / 10);
      valueLoops.clear();
      clearThreatCaches();
      Object.assign(rigTermAudit, { on: true, checked: 0, mismatches: 0, cards: {} });
      const game = new GameRunner(createInitialGameState(deckGameSetup(seed, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length])), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
      for (let i = 0; i < actions && game.step(); i++);
      rigTermAudit.on = false;
      expect(rigTermAudit.checked).toBeGreaterThan(1000);
      expect(Object.keys(rigTermAudit.cards).map(title)).toEqual([]);
    }, 300_000);
  }
});
