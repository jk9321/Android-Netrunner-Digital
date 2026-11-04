import { describe, expect, it } from 'vitest';
import { createCardInstance, executeAction } from '../src/core';
import { runEventOptions } from '../src/ai/prompts';
import { runScore } from '../src/ai/runs';
import { HeuristicRunnerAI } from '../src/ai/runnerAI';
import { giveCard, installIceForTest, newGame, startRunnerTurn } from './helpers';

const MAINTENANCE_ACCESS = '35016';
const PALISADE = '30072'; // barrier: End the run
const AGENDA = '30067'; // Offworld Office

/**
 * Jeff (2026-11-04): with nothing in Archives the Runner AI never played
 * Maintenance Access, though it gets into HQ past HQ's ice. It priced the run
 * as a breach of (empty) Archives.
 */
describe('Maintenance Access (Runner AI)', () => {
  function setup() {
    const s = newGame();
    startRunnerTurn(s);
    installIceForTest(s, PALISADE, 'hq'); // no breaker: HQ and R&D are shut
    installIceForTest(s, PALISADE, 'rd');
    s.corp.hq = Array.from({ length: 5 }, () => createCardInstance(s, AGENDA)); // what the Runner sees: 5 unknown cards
    s.runner.grip = [];
    for (let i = 0; i < 5; i++) giveCard(s, 'runner', MAINTENANCE_ACCESS); // a full grip, so no reason to draw instead
    s.runner.credits = 5;
    return s;
  }

  it('prices the run as an HQ breach behind Archives\' ice', () => {
    const s = setup();
    expect(runScore(s, 'archives')).toBe(-Infinity); // Archives is empty
    expect(runScore(s, 'archives', runEventOptions(MAINTENANCE_ACCESS, s))).toBeGreaterThan(0);
  });

  it('plays it to reach HQ when HQ\'s own ice keeps it out and any agenda wins the game', () => {
    const s = setup();
    s.runner.score = 5;
    // It may draw first (it has the clicks for both); by the end of the turn it has played it
    const ai = new HeuristicRunnerAI();
    let state = s;
    for (let i = 0; i < 30 && state.activePlayer === 'runner' && !state.winner; i++) state = executeAction(state, ai.chooseAction(state));
    expect(state.runner.heap.some(c => c.cardCode === MAINTENANCE_ACCESS)).toBe(true);
    expect(state.winner).toBe('runner');
  });
});
