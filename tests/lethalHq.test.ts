import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, executeAction } from '../src/core';
import { createAgent } from '../src/ai';
import { lethalHqAgenda } from '../src/ai/corpAI';
import { tuning } from '../src/ai/synergy';


/**
 * Jeff's bug report (issue #4, 2026-11-02; Jinteki: Restoring Humanity vs René Arcemont, Hard Corp):
 * with the Runner on 4 points and Send a Message (3 points) in HQ, the Corp iced a remote holding a
 * Clearinghouse and played Hansei Review, trashing the Palisade from HQ. The Runner got through HQ's
 * two ice for 2 credits with Buzzsaw and won by stealing Send a Message.
 *
 * The fixture is that game rebuilt at the start of the Corp's turn 13 (Corp 7 credits, Runner 6; HQ
 * Palisade, Hansei Review, Tithe x2, Send a Message). Trashing the agenda is no answer: it would land
 * in unprotected Archives, where the Runner steals it as well.
 */
const turn13 = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/bug-report-4-turn13.json', import.meta.url), 'utf8'));

function playTurn(s: GameState, corp = createAgent('corp', 'normal')): GameState {
  for (let i = 0; i < 20 && s.activePlayer === 'corp' && !s.winner; i++) {
    const action = corp.chooseAction(s);
    s = executeAction(s, action);
    if (action.type === 'END_TURN') break;
  }
  return s;
}

const hqIce = (s: GameState) => s.corp.servers.hq.ice.length;

describe('an agenda in HQ that would win the Runner the game (plan.lethalHq, bug report #4)', () => {
  it('is spotted while HQ is within the Runner’s reach', () => {
    const s = turn13();
    expect(lethalHqAgenda(s)).toBe(true);
    const safe = { ...s, runner: { ...s.runner, score: 3 } };
    expect(lethalHqAgenda(safe)).toBe(false);
  });

  it('gets HQ another layer of ice, and no HQ ice is trashed (Normal and Hard)', () => {
    for (const agent of [createAgent('corp', 'normal'), createAgent('corp', 'hard', { samples: 6, seed: 1 })]) {
      const s = playTurn(turn13(), agent);
      // plan.plannerSearch (item 4): Normal may lay a fourth layer (plannerBuild tries the ice on a central the threat runs); at least one more is the point
      expect(hqIce(s)).toBeGreaterThanOrEqual(3);
      expect(s.corp.servers.hq.ice.filter(c => c.isRezzed).map(c => c.cardCode).sort()).toEqual(['30046', '30074']) // Diviner, Whitespace;
    }
  }, 120_000);

  it('the one-currency Corp gets HQ its layer too', () => {
    // (plan.lethalHq folded in item 6: the gate is always on; this pinned that oneCurrency didn't need it)
    const one = tuning.plan.oneCurrency;
    const threat = tuning.plan.threatModel;
    tuning.plan.oneCurrency = true;
    tuning.plan.threatModel = false; // item 1 as built, on the old threat (oneCurrency.test.ts)
    // plan.ownIceKnown (2026-11-09) pinned off in this non-default pairing, as in oneCurrency.test.ts: with it the
    // one-currency Corp prices HQ's unrezzable ice as passed and spends the turn otherwise (not the bug pinned here)
    tuning.plan.ownIceKnown = false;
    try {
      expect(hqIce(playTurn(turn13()))).toBe(3);
    } finally {
      tuning.plan.oneCurrency = one;
      tuning.plan.threatModel = threat;
      tuning.plan.ownIceKnown = true;
    }
  }, 120_000);
});
