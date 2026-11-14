import { GameState } from '../src/core';

/**
 * Round 2 money ceiling (AI Coordinator 2026-11-08): +oracle.money in PLAN_OFF gives the Corp `credits` extra at the
 * start of each of its turns, as a fresh state object (a state is never edited after a legality query). Not a rule
 * (the Corp gains credits only through its basic actions, rules 5.2.6, and card abilities): a ceiling, never shipped.
 */
export function withOracleMoney(state: GameState, credits = 1): GameState {
  return { ...state, corp: { ...state.corp, credits: state.corp.credits + credits } };
}
