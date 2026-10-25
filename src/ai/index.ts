import { GameState, SideCode } from '../core';
import { Agent } from './agent';
import { HeuristicCorpAI } from './corpAI';
import { HeuristicRunnerAI } from './runnerAI';
import { SearchAI, SearchOptions } from './search';
import { GameRunner } from './playout';

export type { Agent } from './agent';
export { HeuristicCorpAI } from './corpAI';
export { HeuristicRunnerAI } from './runnerAI';
export { SearchAI } from './search';
export { GameRunner } from './playout';
export { setSynergyDebug } from './synergy';

/** Normal: the rule-based AI. Hard: the rule-based AI plus Monte Carlo look-ahead. */
export type Difficulty = 'normal' | 'hard';

export function createAgent(side: SideCode, difficulty: Difficulty = 'normal', search: Partial<SearchOptions> = {}): Agent {
  if (difficulty === 'hard') return new SearchAI(side, search);
  const options = { synergy: search.synergy, debug: search.debug };
  return side === 'corp' ? new HeuristicCorpAI(options) : new HeuristicRunnerAI(options);
}

export interface AIGameResult {
  state: GameState;
  steps: number;
}

/** Plays a game with the computer on both sides (tests and balancing). */
export function playAIGame(
  start: GameState,
  maxSteps = 3000,
  maxTurns = 80,
  agents: Record<SideCode, Agent> = { corp: createAgent('corp'), runner: createAgent('runner') }
): AIGameResult {
  const runner = new GameRunner(start, agents);
  let steps = 0;
  while (steps < maxSteps && runner.state.turnNumber <= maxTurns && runner.step()) steps++;
  return { state: runner.state, steps };
}
