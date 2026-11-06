import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, cardDef, executeAction } from '../src/core';
import { createAgent } from '../src/ai';
import { tuning } from '../src/ai/synergy';

/**
 * Bug report #18 (Jeff's Corp game 2, 2026-11-05): on turn 7 Project Ingatan sat in Remote 1 behind rezzed Tatu-Bola
 * and Manegarm Skunkworks with 5 credits and 3 clicks to score it. The AI installed Vovô Ozetti and Nico Campaign and
 * left it for the Runner: the advances still needed were priced at the flat click rate (1.25), while a click spent
 * installing earns the model several times that, so building now and scoring next turn always looked better.
 * plan.agendaClicks prices the remaining advances at AGENDA_CLICK.
 *
 * Position: the start of the Corp's turn 7 main phase, rebuilt from the report.
 */
function position(): GameState {
  return JSON.parse(readFileSync(new URL('./fixtures/bug-report-18-turn7.json', import.meta.url), 'utf8'));
}

function playTurn(s: GameState): GameState {
  const corp = createAgent('corp', 'normal');
  const runner = createAgent('runner', 'normal');
  const turn = s.turnNumber;
  for (let i = 0; i < 30 && s.activePlayer === 'corp' && s.turnNumber === turn; i++) {
    const side = s.pendingPrompts[0]?.side ?? (s.priority && !s.pendingPrompts.length ? s.priority.holder : s.activePlayer);
    s = executeAction(s, (side === 'runner' ? runner : corp).chooseAction(s));
  }
  return s;
}

const scoredIngatan = (s: GameState) => s.corp.scoreArea.some(c => cardDef(c).title === 'Project Ingatan');

describe('a protected agenda the Corp can finish is scored this turn (plan.agendaClicks)', () => {
  it('scores Project Ingatan on turn 7', () => {
    expect(scoredIngatan(playTurn(position()))).toBe(true);
  }, 30_000);

  it('either plan alone scores it (plan.finishSetup ranks the Seamless Launch that lets the turn finish it)', () => {
    for (const off of ['agendaClicks', 'finishSetup'] as const) {
      tuning.plan[off] = false;
      try {
        expect(scoredIngatan(playTurn(position())), off).toBe(true);
      } finally {
        tuning.plan[off] = true;
      }
    }
  }, 60_000);

  it('without both it built instead', () => {
    tuning.plan.agendaClicks = false;
    tuning.plan.finishSetup = false;
    // and on the old turns-left horizon (plan.measuredTurnsLeft, 2026-11-05), which this position was found on: on the
    // measured one the Corp scores it here even without both
    tuning.plan.measuredTurnsLeft = false;
    // and on the flat 8 credits for ice the Runner can't break yet (plan.breakerReach, 2026-11-06)
    tuning.plan.breakerReach = false;
    try {
      expect(scoredIngatan(playTurn(position()))).toBe(false);
    } finally {
      tuning.plan.agendaClicks = true;
      tuning.plan.finishSetup = true;
      tuning.plan.measuredTurnsLeft = true;
      tuning.plan.breakerReach = true;
    }
  }, 30_000);
});
