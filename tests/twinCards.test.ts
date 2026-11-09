import { describe, expect, it } from 'vitest';
import { GameAction, GameState, StopLevel, actingSide, createCardInstance, executeAction, getLegalActions, newViewIds, viewFor } from '../src/core';
import { twinCompare } from '../scripts/leak-check-twin';
import { installCorpForTest, newGame, setIdentity, startRunnerTurn } from './helpers';

// Card prompts that depend on a hidden card (multiplayer phase 2, chunk 2a-2). A "you may" follow-up offered only
// when a card hidden from the Runner qualifies lets the Runner read that card from who the game waits on (rules
// 4.2.2, 4.6.3). With the Corp's stops on ALL the question is always asked (askEvenIfNone); below that, the tell is
// accepted like the paid windows' AUTO tell (Jeff, 2026-11-08). Each case builds the state just before the action
// that would raise the prompt and checks the Runner's views with twinCompare (scripts/leak-check-twin.ts).

const BALANCED_COVERAGE = '34050';
const PT_UNTAIAN = '35047';
const ICE_WALL = '30072'; // Palisade (ice)
const HEDGE_FUND = '30075'; // operation
const OFFWORLD = '30067'; // agenda: can be advanced
const NICO = '30037'; // asset that can't be advanced

/** Plays the plain move (pass, continue, start or end the turn, first answer) until `until` holds for the state about to act. */
function driveTo(s: GameState, until: (s: GameState) => boolean): GameState {
  for (let i = 0; i < 80; i++) {
    if (until(s)) return s;
    const side = actingSide(s);
    if (!side) break;
    const legal = getLegalActions(s, side);
    const pick =
      legal.find(a => a.type === 'PASS' && !a.restOfRun) ??
      legal.find(a => a.type === 'START_TURN' || a.type === 'CONTINUE_RUN') ??
      legal.find(a => a.type === 'END_TURN') ??
      legal[0];
    s = executeAction(s, pick);
  }
  throw new Error('never got there');
}

/** The first step `driveTo` would take from `s`, with the state after it. */
function plainMove(s: GameState): { action: GameAction; next: GameState } {
  const side = actingSide(s)!;
  const legal = getLegalActions(s, side);
  const action = legal.find(a => a.type === 'PASS' && !a.restOfRun) ?? legal.find(a => a.type === 'START_TURN' || a.type === 'CONTINUE_RUN') ?? legal.find(a => a.type === 'END_TURN') ?? legal[0];
  return { action, next: executeAction(s, action) };
}

const prompted = (code: string, step?: string) => (s: GameState) => s.pendingPrompts.some(p => 'source' in p && p.source.cardCode === code && (!step || p.source.step === step));

function balancedCoverage(corpStops: StopLevel) {
  let s = newGame(5);
  s.stops = { corp: corpStops, runner: 'full' };
  installCorpForTest(s, BALANCED_COVERAGE, 'remote-1', true);
  s.corp.rd.unshift(createCardInstance(s, ICE_WALL), createCardInstance(s, HEDGE_FUND));
  startRunnerTurn(s);
  s.runner.clicks = 0;
  s = driveTo(s, prompted(BALANCED_COVERAGE, 'type'));
  const p = s.pendingPrompts[0];
  const action: GameAction = { type: 'RESOLVE_PROMPT', player: 'corp', promptId: p.id, choice: { kind: 'effect_choice', optionId: 'ice' } };
  const ids = viewFor(s, 'runner', newViewIds(), 'g').ids;
  return twinCompare(s, action, executeAction(s, action), ids, 'runner', s.corp.rd[0].instanceId, s.corp.rd[1].instanceId);
}

function ptUntaian(corpStops: StopLevel) {
  let s = newGame(5);
  s.stops = { corp: corpStops, runner: 'full' };
  setIdentity(s, 'corp', PT_UNTAIAN);
  s.corp.hq.splice(0, s.corp.hq.length, createCardInstance(s, NICO));
  const agenda = installCorpForTest(s, OFFWORLD, 'remote-1');
  s.corp.credits = 5;
  s.corp.clicks = 0;
  // The Corp's last move before its discard phase ends
  s = driveTo(s, st => prompted(PT_UNTAIAN)(plainMove(st).next) || st.activePlayer === 'runner');
  expect(s.activePlayer).toBe('corp');
  const { action, next } = plainMove(s);
  const ids = viewFor(s, 'runner', newViewIds(), 'g').ids;
  return twinCompare(s, action, next, ids, 'runner', agenda, s.corp.hq[0].instanceId);
}

describe('Card prompts that depend on a hidden card (4.2.2, 4.6.3)', () => {
  it('Balanced Coverage, Corp stops on ALL: the Runner can\'t tell whether the top of R&D matched the named type (4.2.2)', () => {
    expect(balancedCoverage('full')).toMatchObject({ kind: 'same' });
  });

  it('Balanced Coverage, Corp stops on AUTO: unchanged, the follow-up comes only on a match (accepted tell)', () => {
    expect(balancedCoverage('auto')).toMatchObject({ kind: 'differ' });
  });

  it('PT Untaian, Corp stops on ALL: the Runner can\'t tell whether a facedown card can be advanced (4.6.3)', () => {
    expect(ptUntaian('full')).toMatchObject({ kind: 'same' });
  });

  it('PT Untaian, Corp stops on AUTO: unchanged, the question comes only with a target (accepted tell)', () => {
    expect(ptUntaian('auto')).toMatchObject({ kind: 'differ' });
  });
});
