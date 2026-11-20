/**
 * Rules 1.10.3c: "Abilities can also allow players to spend credits hosted on their cards under certain conditions.
 * If any such abilities apply, the player chooses how to divide the credits they are spending from among the allowed
 * locations." The default order spends hosted credits first; SET_CREDIT_HOLD keeps one card's credits for last.
 */
import { describe, expect, it } from 'vitest';
import { executeAction, findCardAnywhere, getLegalActions } from '../src/core';
import { spendCredits } from '../src/core/engine/cardEffects';
import { newGame, runnerInstall } from './helpers';

const AZIMAT = '35029'; // 2 recurring credits, pay trash costs
const TRASH = { kind: 'trash' } as const;

function setup() {
  const [state, azimat] = runnerInstall(newGame(), AZIMAT);
  state.runner.credits = 5;
  return { state, azimat };
}

describe('Holding hosted credits for last (rules 1.10.3c)', () => {
  it('by default the hosted credits pay first', () => {
    const { state, azimat } = setup();
    spendCredits(state, 'runner', 3, TRASH as never);
    expect(findCardAnywhere(state, azimat)!.tokens.credit ?? 0).toBe(0);
    expect(state.runner.credits).toBe(4);
  });

  it('held: the pool pays first and the card keeps its credits', () => {
    const { state, azimat } = setup();
    const held = executeAction(state, { type: 'SET_CREDIT_HOLD', player: 'runner', cardInstanceId: azimat, hold: true });
    spendCredits(held, 'runner', 3, TRASH as never);
    expect(findCardAnywhere(held, azimat)!.tokens.credit).toBe(2);
    expect(held.runner.credits).toBe(2);
  });

  it('held: the card still covers what the pool cannot (holding never changes what can be paid)', () => {
    const { state, azimat } = setup();
    state.runner.credits = 1;
    const held = executeAction(state, { type: 'SET_CREDIT_HOLD', player: 'runner', cardInstanceId: azimat, hold: true });
    spendCredits(held, 'runner', 3, TRASH as never);
    expect(held.runner.credits).toBe(0);
    expect(findCardAnywhere(held, azimat)!.tokens.credit ?? 0).toBe(0);
  });

  it('can be undone, is never offered as a legal action, and only on own active cards', () => {
    const { state, azimat } = setup();
    const held = executeAction(state, { type: 'SET_CREDIT_HOLD', player: 'runner', cardInstanceId: azimat, hold: true });
    const back = executeAction(held, { type: 'SET_CREDIT_HOLD', player: 'runner', cardInstanceId: azimat, hold: false });
    expect(findCardAnywhere(back, azimat)!.holdCredits).toBeUndefined();
    for (const side of ['corp', 'runner'] as const) expect(getLegalActions(state, side).some(a => a.type === 'SET_CREDIT_HOLD')).toBe(false);
    expect(() => executeAction(state, { type: 'SET_CREDIT_HOLD', player: 'corp', cardInstanceId: azimat, hold: true })).toThrow();
  });
});
