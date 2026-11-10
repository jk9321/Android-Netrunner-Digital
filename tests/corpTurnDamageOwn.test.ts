/**
 * Bug report #44 (Jeff's Runner test game 12 vs the Normal Corp, 2026-11-09): "a curious play early where the corp ICEd R&D
 * despite having an agenda in hand". Turn 2: three agendas in HQ (Send a Message among them) and no ice on HQ; the rule
 * ranking put Tithe on HQ first, the planner put it on a new remote and drew twice, and Send a Message was stolen.
 *
 * The planner's whole gap was its Runner reply's end position: the reply Runner ran the new remote into Tithe (net damage)
 * and ended its turn on 1 card, and the leaf's damage clock (effectValues.ts damageThreat on the Corp's turn) counted a
 * 4-damage burst from Orbital Superiority ("if the Runner is tagged, do 4 meat damage", and it had no tag) and Urtica
 * Cipher (damage when the Runner accesses it: rules 7.1.3, 7.2.1, only in the Runner's runs). That flatline worth (about
 * 33 points) outweighed a 2-point steal. plan.corpTurnDamageOwn reads what each card can deal on the Corp's own turn from
 * its card entry (CardAI corpTurnDamage). The Runner's own read of on-access damage (corpTurn false) is unchanged.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { damageThreat, flatlineOdds } from '../src/ai/effectValues';
import { tuning } from '../src/ai/synergy';

/** Game 12 replayed to the Corp's first main-phase decision of turn `turn`. */
function corpTurn(turn: number): GameState {
  const r = JSON.parse(readFileSync(new URL('./fixtures/human-games/report-44.json', import.meta.url), 'utf8'));
  let s: GameState = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  for (const m of r.moves as GameAction[]) {
    if (s.turnNumber === turn && s.activePlayer === 'corp' && s.corp.clicks > 0 && actingSide(s) === 'corp' && !s.pendingPrompts.length && m.type !== 'START_TURN') break;
    s = executeAction(s, m);
  }
  return s;
}

const withSwitch = <T>(on: boolean, work: () => T): T => {
  const was = tuning.plan.corpTurnDamageOwn;
  tuning.plan.corpTurnDamageOwn = on;
  try {
    return work();
  } finally {
    tuning.plan.corpTurnDamageOwn = was;
  }
};

/** A fresh copy (damageThreat caches by the game's id and what is gone) with the Runner on `tags` tags. */
const tagged = (s: GameState, tags: number): GameState => ({ ...structuredClone(s), id: `${s.id}-tags-${tags}`, runner: { ...structuredClone(s.runner), tags } });

describe('game 12 (bug report #44): the damage clock counts only damage the Corp can deal on its own turn', () => {
  it('turn 2: Urtica Cipher and an untagged Runner’s Orbital Superiority are no Corp-turn burst', () => {
    const s = corpTurn(2);
    const titles = [...s.corp.rd, ...s.corp.hq].map(c => cardDef(c).title);
    expect(titles).toContain('Orbital Superiority');
    expect(titles).toContain('Urtica Cipher');
    const on = withSwitch(true, () => damageThreat(tagged(s, 0), true));
    const off = withSwitch(false, () => damageThreat(tagged(s, 0), true));
    expect(off.burst).toBe(4);
    expect(on.burst).toBeLessThan(4);
    expect(withSwitch(true, () => flatlineOdds(tagged(s, 0), 1, true))).toBeLessThan(0.1);
  });

  it('a tagged Runner on 1-2 cards still faces Orbital Superiority’s 4 meat damage', () => {
    const s = tagged(corpTurn(2), 1);
    expect(withSwitch(true, () => damageThreat(s, true)).burst).toBe(4);
    // A real kill line: the odds stay several times the untagged Runner's (0.21 vs under 0.1 here)
    const untagged = withSwitch(true, () => flatlineOdds(tagged(corpTurn(2), 0), 1, true));
    expect(withSwitch(true, () => flatlineOdds(s, 1, true))).toBeGreaterThan(Math.max(0.15, 3 * untagged));
  });

  it('the Runner’s read (runs, on access) still counts Urtica Cipher', () => {
    const s = tagged(corpTurn(2), 0);
    expect(withSwitch(true, () => damageThreat(s, false)).burst).toBe(4);
  });

  it('turn 2: Tithe goes on HQ, not on a new remote (Normal)', { timeout: 120_000 }, () => {
    const s = corpTurn(2);
    expect(s.corp.servers.hq.ice).toHaveLength(0);
    expect(s.corp.hq.filter(c => cardDef(c).type_code === 'agenda').length).toBeGreaterThanOrEqual(2);
    const pick = withSwitch(true, () => createAgent('corp', 'normal').chooseAction(s));
    expect(pick.type).toBe('INSTALL_CARD');
    expect(pick.type === 'INSTALL_CARD' && cardDef(findCardAnywhere(s, pick.cardInstanceId)!).title).toBe('Tithe');
    expect(pick.type === 'INSTALL_CARD' && pick.targetServerId).toBe('hq');
  });
});
