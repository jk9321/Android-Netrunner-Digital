import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { answerPrompt } from '../src/ai/prompts';
import { tuning } from '../src/ai/synergy';
import { cont, installCorpForTest, newGame, rezForTest, run, startRunnerTurn } from './helpers';

/**
 * Jeff's bug report (issue #5, 2026-11-02; BANGUN vs MuslihaT, Hard Runner): on turn 1 the Runner paid
 * 2 of its 5 credits to trash a Spin Doctor that had already drawn its 2 cards, with nothing in Archives
 * to shuffle back, and late in games it hardly ever trashed one. Its worth counted the draw it had
 * already made. A rezzed Spin Doctor is worth only what it can still shuffle back from Archives.
 */
const SPIN = '30053';

function accessSpinDoctor(archived: number): GameState {
  let s = newGame();
  const id = installCorpForTest(s, SPIN, 'remote-1');
  s = rezForTest(s, id);
  for (let i = 0; i < archived; i++) {
    const card = s.corp.rd.shift()!;
    s.corp.archives.faceDown.push(card);
  }
  startRunnerTurn(s);
  s.runner.credits = 5;
  s = cont(run(s, 'remote-1'));
  return s;
}

const trashes = (s: GameState, synergy: boolean): boolean => {
  const action = answerPrompt(s, 'runner', undefined, synergy);
  if (action.type !== 'RESOLVE_PROMPT') return false;
  return action.choice.kind === 'access_trash' && action.choice.trash;
};

describe('a spent Spin Doctor (plan.spentSpinDoctor, bug report #5)', () => {
  it('is left alone with Archives empty', () => {
    for (const synergy of [false, true]) expect(trashes(accessSpinDoctor(0), synergy)).toBe(false);
  });

  it('is trashed once Archives holds cards it could shuffle back', () => {
    expect(trashes(accessSpinDoctor(6), true)).toBe(true);
  });

  it('the old way (plan off) trashed it on an empty Archives', () => {
    const was = { ...tuning.plan };
    tuning.plan.spentSpinDoctor = false;
    tuning.plan.rezBudget = false; // added after the report: the Runner's view of the board changed with it
    tuning.plan.drawWorthCredits = false; // and the draw average keyed by the position (2026-11-06)
    try {
      expect(trashes(accessSpinDoctor(0), true)).toBe(true);
    } finally {
      Object.assign(tuning.plan, was);
    }
  });
});
