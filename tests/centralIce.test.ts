import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { centralIce, centralStake } from '../src/ai/countedScore';
import { rdAgendaOdds } from '../src/ai/rezModel';
import { pointGain } from '../src/ai/valueModel';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';

/**
 * Central ice (spec-central-ice.md variant (6), bars/central-ice-bare.md): the Corp's own remote ice pick goes to
 * a central with no ice first. States are Jeff's games replayed to the move; the pick is the move the AI Corp made there.
 */
const report = (n: number) => JSON.parse(readFileSync(new URL(`./fixtures/human-games/report-${n}.json`, import.meta.url), 'utf8'));
const at = (n: number, move: number): { s: GameState; pick: GameAction } => {
  const r = report(n);
  let s: GameState = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  for (const m of (r.moves as GameAction[]).slice(0, move)) s = executeAction(s, m);
  return { s, pick: r.moves[move] };
};
const ask = (s: GameState, pick: GameAction) => asSide('corp', () => (decisionContext(s, 'corp'), centralIce(s, pick)));

describe('central ice: remote ice to a central with no ice', () => {
  // #51 #23 and #33 (Jeff: R&D bare turns 1-5 on 13-17 credits, "just put a light ice in the way so it's not a free run")
  it('#51 #23: Funhouse goes to R&D', () => {
    const { s, pick } = at(51, 23);
    expect(ask(s, pick)).toMatchObject({ type: 'INSTALL_CARD', targetServerId: 'rd' });
  });

  it('#51 #33: Tithe goes to R&D', () => {
    const { s, pick } = at(51, 33);
    expect(ask(s, pick)).toMatchObject({ type: 'INSTALL_CARD', targetServerId: 'rd' });
  });

  it('#48 #2: Ping goes to HQ', () => {
    const { s, pick } = at(48, 2);
    expect(ask(s, pick)).toMatchObject({ type: 'INSTALL_CARD', targetServerId: 'hq' });
  });

  it('#50 #15: Ablative Barrier goes to R&D', () => {
    const { s, pick } = at(50, 15);
    expect(ask(s, pick)).toMatchObject({ type: 'INSTALL_CARD', targetServerId: 'rd' });
  });

  // #52 #2, Corp turn 1, every server bare, 2 agendas in HQ: the planner put Doomscroll on a new remote and the Runner
  // took Orbital Superiority from HQ. HQ's stake (its agendas over the cards left) is above R&D's (unseen agendas over R&D)
  it('#52 #2: Doomscroll goes to HQ', () => {
    const { s, pick } = at(52, 2);
    expect(ask(s, pick)).toMatchObject({ type: 'INSTALL_CARD', targetServerId: 'hq' });
  });

  // Both centrals already have ice: the pick stands
  it('#49 #82 and #50 #253: no redirect', () => {
    for (const [n, m] of [[49, 82], [50, 253]]) {
      const { s, pick } = at(n, m);
      expect(ask(s, pick)).toBeNull();
    }
  });

  // Hidden information (10.2.2a): the Corp counts the deck list, never R&D's order or the grip's contents
  it('#51 #33: R&D order and grip contents do not change the answer', () => {
    const { s, pick } = at(51, 33);
    const t = structuredClone(s);
    t.corp.rd.reverse();
    t.runner.grip = t.runner.grip.map(c => ({ ...c, cardCode: '30030' }));
    expect(ask(t, pick)).toEqual(ask(s, pick));
  });
});

// Audit Step 0b (spec-step0-small-fixes.md; review-central-ice S2): R&D's stake reads the Corp's one R&D pool (rezModel
// rdAgendaOdds: odds and those agendas' mean points), not the count from one pool and the points from the deck-wide one
describe("central ice: R&D's stake by the Corp's own list", () => {
  it("#51 #23: R&D's stake is rdAgendaOdds' odds times the pointGain of its points, whatever R&D's order (10.2.2a)", () => {
    const { s, pick } = at(51, 23);
    const leaving = (pick as { cardInstanceId: string }).cardInstanceId;
    const rd = rdAgendaOdds(s);
    expect(rd.odds).toBeGreaterThan(0);
    expect(centralStake(s, leaving).rd).toBeCloseTo(rd.odds * pointGain(s.runner.score, rd.points), 9);
    const flipped = structuredClone(s);
    flipped.corp.rd.reverse();
    expect(centralStake(flipped, leaving)).toEqual(centralStake(s, leaving));
  });
});
