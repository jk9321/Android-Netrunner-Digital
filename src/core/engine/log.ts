import { GameState, LogEntry, LogEvent } from '../types/state';

export function addLog(
  state: GameState,
  player: LogEntry['player'],
  message: string,
  cardCode?: string,
  event?: LogEvent,
  secret?: LogEntry['secret'],
): void {
  // Frozen: states made by executeAction share log entries with the state before
  state.log.push(
    Object.freeze({
      id: `log-${state.log.length}`,
      turnNumber: state.turnNumber,
      player,
      message,
      cardCode,
      ...(event && { event }),
      ...(secret && { secret }),
    }),
  );
}
