import { CardInstance, GameAction, GameState, SideCode } from '../core';
import type { Agent, Difficulty } from './index';
import type { AIRequest, AIResponse } from './worker';
import { logReloadEvent } from '../ui/reloadReason';

/** `?aidebug` in the address: log why the computer made each move (browser console). */
const aiDebug = () => typeof location !== 'undefined' && new URLSearchParams(location.search).has('aidebug');

type Question = { type: 'action'; state: GameState } | { type: 'rez'; state: GameState; cards: CardInstance[] } | { type: 'offturn'; state: GameState };

/**
 * The game's handle on the computer player: asks a background worker for
 * moves, or (where workers aren't available) computes them in place. The AI
 * code for thinking in place is only downloaded if the worker fails.
 */
export class AIClient {
  private worker: Worker | null = null;
  private local: Promise<Agent> | null = null;
  private nextId = 1;
  private pending = new Map<number, { msg: Question; resolve: (r: AIResponse) => void }>();

  constructor(
    private side: SideCode,
    private difficulty: Difficulty
  ) {
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<AIResponse>) => {
        this.pending.get(e.data.id)?.resolve(e.data);
        this.pending.delete(e.data.id);
      };
      // A worker that fails to load or crashes (or that the browser kills
      // while the tab sits in the background) would leave the AI thinking
      // forever, so answer from the main thread from then on.
      this.worker.onerror = e => {
        console.error('AI worker failed; the computer will think on the main thread', e);
        logReloadEvent(`AI worker failed (${e.message || 'no message'}); the AI moved to the main thread`);
        this.fallBackToLocal();
      };
      this.worker.postMessage({ type: 'init', side, difficulty, debug: aiDebug() } satisfies AIRequest);
    } catch {
      this.fallBackToLocal();
    }
  }

  private fallBackToLocal() {
    this.worker?.terminate();
    this.worker = null;
    this.local ??= import('./index').then(ai => {
      ai.setSynergyDebug(aiDebug());
      return ai.createAgent(this.side, this.difficulty, { debug: aiDebug() });
    });
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const { msg, resolve } of waiting) {
      this.answerLocally(msg).then(
        action => resolve({ id: 0, action }),
        err => resolve({ id: 0, action: null, error: String(err) }),
      );
    }
  }

  private async answerLocally(msg: Question): Promise<GameAction | null> {
    const agent = await this.local!;
    if (msg.type === 'action') return agent.chooseAction(msg.state);
    if (msg.type === 'rez') return agent.chooseRez?.(msg.state, msg.cards) ?? null;
    return agent.chooseOffTurn?.(msg.state) ?? null;
  }

  private ask(msg: Question): Promise<GameAction | null> {
    if (!this.worker) return this.answerLocally(msg);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { msg, resolve: r => (r.error ? reject(new Error(r.error)) : resolve(r.action)) });
      this.worker!.postMessage({ ...msg, id } as AIRequest);
    });
  }

  chooseAction(state: GameState): Promise<GameAction> {
    return this.ask({ type: 'action', state }) as Promise<GameAction>;
  }

  chooseRez(state: GameState, cards: CardInstance[]): Promise<GameAction | null> {
    return this.ask({ type: 'rez', state, cards });
  }

  chooseOffTurn(state: GameState): Promise<GameAction | null> {
    return this.ask({ type: 'offturn', state });
  }

  dispose() {
    if (this.worker) this.worker.onerror = null;
    this.worker?.terminate();
    this.pending.clear();
  }
}
