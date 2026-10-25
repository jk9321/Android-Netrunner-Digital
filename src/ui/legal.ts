import { GameAction, GameState, executeAction, getLegalActions } from '../core';

/** The engine's reason an action is illegal right now, or null if it is legal. */
export function illegalReason(state: GameState, action: GameAction): string | null {
  try {
    executeAction(state, action);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Illegal action';
  }
}

/** Runner play and install actions for cards hosted faceup on hardware (Bling, Madani), not in the grip. */
export function hostedCardActions(state: GameState): GameAction[] {
  const grip = new Set(state.runner.grip.map(c => c.instanceId));
  return getLegalActions(state, 'runner').filter(
    a => (a.type === 'INSTALL_CARD' || a.type === 'PLAY_OPERATION_OR_EVENT') && !grip.has(a.cardInstanceId),
  );
}
