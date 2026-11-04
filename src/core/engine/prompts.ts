import { SideCode } from '../types/card';
import { Prompt } from '../types/prompts';
import { GameState } from '../types/state';

type NewPrompt = Prompt extends infer P ? (P extends Prompt ? Omit<P, 'id'> : never) : never;

/** Queues a decision. Prompts resolve in the order they were added. */
export function pushPrompt(state: GameState, prompt: NewPrompt): void {
  state.pendingPrompts.push({ ...prompt, id: `prompt-${state.nextPromptId++}` } as Prompt);
}

/** Puts a decision ahead of the queue: an interrupt that must be answered before anything already waiting (AirbladeX preventing damage). */
export function interruptPrompt(state: GameState, prompt: NewPrompt): void {
  state.pendingPrompts.unshift({ ...prompt, id: `prompt-${state.nextPromptId++}` } as Prompt);
}

export function activePrompt(state: GameState): Prompt | undefined {
  return state.pendingPrompts[0];
}

export function sideName(side: SideCode): string {
  return side === 'corp' ? 'Corp' : 'Runner';
}
