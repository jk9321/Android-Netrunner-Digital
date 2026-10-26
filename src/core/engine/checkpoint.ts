import { GameState } from '../types/state';
import { addLog } from './log';
import { endRun } from './runEnd';

/**
 * Remote servers with nothing in their root and no ice protecting them cease
 * to exist (rules 4.6.8e, 8.5.8). Runs after every action, as the checkpoint.
 *
 * - While a decision is pending the check waits, so a server mid-install
 *   (rule 8.5.9) or named in a prompt's options is never removed under it.
 * - A run on the server ends, neither successful nor unsuccessful, unless it
 *   was already declared successful: then the breach finishes first and the
 *   server goes once the run ends.
 * - Server ids are never reused (remoteCounter only grows), so anything that
 *   remembers an old id (run history, AI memory) just no longer finds it.
 */
export function removeEmptyRemotes(state: GameState): void {
  if (state.pendingPrompts.length > 0) return;
  for (const server of Object.values(state.corp.servers)) {
    if (!server.isRemote || server.root.length > 0 || server.ice.length > 0) continue;
    const run = state.activeRun;
    if (run && run.server === server.id) {
      if (run.isSuccessful) continue;
      addLog(state, 'corp', `${server.name} no longer exists, so the run ends.`);
      delete state.corp.servers[server.id];
      endRun(state);
      continue;
    }
    addLog(state, 'corp', `${server.name} no longer exists.`);
    delete state.corp.servers[server.id];
  }
}
