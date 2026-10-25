/// <reference lib="webworker" />
import { Agent, Difficulty, createAgent, setSynergyDebug } from './index';
import { CardInstance, GameState, SideCode } from '../core';

/**
 * Runs the computer player off the main thread, so the board stays
 * responsive while the Hard AI thinks. One worker serves one game.
 */
export type AIRequest =
  | { type: 'init'; side: SideCode; difficulty: Difficulty; debug?: boolean }
  | { type: 'action'; id: number; state: GameState }
  | { type: 'rez'; id: number; state: GameState; cards: CardInstance[] };

export type AIResponse = { id: number; action: import('../core').GameAction | null; error?: string };

let agent: Agent | null = null;

self.onmessage = (event: MessageEvent<AIRequest>) => {
  const msg = event.data;
  if (msg.type === 'init') {
    setSynergyDebug(!!msg.debug);
    agent = createAgent(msg.side, msg.difficulty, { debug: msg.debug });
    return;
  }
  try {
    if (!agent) throw new Error('AI worker not initialised');
    const action = msg.type === 'action' ? agent.chooseAction(msg.state) : agent.chooseRez?.(msg.state, msg.cards) ?? null;
    (self as unknown as Worker).postMessage({ id: msg.id, action } satisfies AIResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: msg.id, action: null, error: String(err) } satisfies AIResponse);
  }
};
