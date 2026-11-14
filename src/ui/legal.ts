import { GameAction, GameState } from '../core';

/** Runner play and install actions for cards hosted faceup on hardware (Bling, Madani), not in the grip; `legal` is the seat's Runner actions. */
export function hostedCardActions(state: GameState, legal: GameAction[]): GameAction[] {
  const grip = new Set(state.runner.grip.map(c => c.instanceId));
  return legal.filter(
    a => (a.type === 'INSTALL_CARD' || a.type === 'PLAY_OPERATION_OR_EVENT') && !grip.has(a.cardInstanceId),
  );
}
