import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { HeuristicRunnerAI } from '../src/ai';
import { serverValue } from '../src/ai/runs';
import { tuning } from '../src/ai/synergy';
import { newGame, startRunnerTurn } from './helpers';

/**
 * Jeff's bug report (issue #5, 2026-11-02): the Runner ran Archives after nearly every Corp discard. The
 * odds it gave each facedown card were the deck's share of agendas, as if the Corp discarded at random.
 * A Corp chooses its discards, and into an Archives with no ice it rarely chooses an agenda.
 */
function discarded(cards: number): GameState {
  const s = newGame();
  startRunnerTurn(s);
  s.corp.archives.faceDown.push(...s.corp.rd.splice(0, cards));
  return s;
}

const withPlan = <T>(on: boolean, fn: () => T): T => {
  const was = { ...tuning.plan };
  tuning.plan.archivesChosen = on;
  try {
    return fn();
  } finally {
    Object.assign(tuning.plan, was);
  }
};

/** The Archives run's score over a click for a credit. */
const archivesOverCredit = (s: GameState) => {
  const ranked = new HeuristicRunnerAI({ synergy: true, planner: false }).rankMainActions(s);
  const archives = ranked.find(r => r.action.type === 'INITIATE_RUN' && r.action.targetServerId === 'archives')!.score;
  return archives - ranked.find(r => r.action.type === 'GAIN_CREDIT')!.score;
};

describe('a facedown card in an Archives with no ice (plan.archivesChosen, bug report #5)', () => {
  it('is worth a third of a random card', () => {
    const s = discarded(1);
    const on = withPlan(true, () => serverValue(s, 'archives'));
    const off = withPlan(false, () => serverValue(s, 'archives'));
    expect(on).toBeCloseTo(off * 0.3, 5);
  });

  it('one discard is no longer worth a click; a pile of them still is', () => {
    expect(withPlan(false, () => archivesOverCredit(discarded(1)))).toBeGreaterThan(0);
    expect(withPlan(true, () => archivesOverCredit(discarded(1)))).toBeLessThan(0);
    expect(withPlan(true, () => archivesOverCredit(discarded(3)))).toBeGreaterThan(0);
  });
});
