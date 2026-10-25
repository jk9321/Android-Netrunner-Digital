import { GameState, LogEntry } from '../types/state';

export function addLog(state: GameState, player: LogEntry['player'], message: string, cardCode?: string): void {
  // Frozen: states made by executeAction share log entries with the state before
  state.log.push(
    Object.freeze({
      id: `log-${state.log.length}`,
      turnNumber: state.turnNumber,
      player,
      message,
      cardCode,
    }),
  );
}
