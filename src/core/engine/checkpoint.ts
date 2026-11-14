import { CardInstance } from '../types/card';
import { GameState } from '../types/state';
import { cardDef } from '../cards';
import { memoryLimit } from './cardEffects';
import { trashInstalledRunnerCard } from './damage';
import { illegal } from './helpers';
import { pushPrompt } from './prompts';
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

/** Step of the prompt below; prompt.ts resolves it (no card script owns it). */
export const MEMORY_LIMIT_STEP = 'memory-limit';

/**
 * Over the memory limit for a reason other than an install (a console or MU hardware trashed, Botulus...), the Runner
 * trashes programs at the next checkpoint until the rest fit (rules 3.9.3c, 10.3.1e). Only an "appropriate set" is
 * trashed: one that fits and from which no program could be left out. With several such sets the Runner chooses one;
 * with one it is trashed. Like the server check, this waits while a decision is pending.
 */
export function trashOverMemoryLimit(state: GameState): void {
  if (state.pendingPrompts.length > 0) return;
  const over = state.runner.memoryUnitsUsed - memoryLimit(state);
  if (over <= 0) return;
  const programs = state.runner.rig.programs.filter(c => (cardDef(c).memory_cost ?? 0) > 0);
  const sets = appropriateSets(programs, over);
  if (sets.length === 0) return;
  if (sets.length === 1) {
    trashForMemory(state, sets[0]);
    return;
  }
  const first = sets[0][0];
  pushPrompt(state, {
    kind: 'effect_choice',
    side: 'runner',
    message: `Over your memory limit by ${over} MU: choose programs to trash (rules 3.9.3c).`,
    options: sets.map(set => ({ id: set.map(c => c.instanceId).join(','), label: `Trash ${set.map(c => cardDef(c).title).join(', ')}` })),
    source: { cardCode: first.cardCode, instanceId: first.instanceId, step: MEMORY_LIMIT_STEP },
  });
}

/** The minimal sets of programs whose memory cost covers `over`. */
function appropriateSets(programs: CardInstance[], over: number): CardInstance[][] {
  const mu = (c: CardInstance) => cardDef(c).memory_cost ?? 0;
  const list = programs.slice(0, 12);
  const sets: CardInstance[][] = [];
  for (let mask = 1; mask < 1 << list.length; mask++) {
    const set = list.filter((_, i) => mask & (1 << i));
    const total = set.reduce((n, c) => n + mu(c), 0);
    if (total >= over && set.every(c => total - mu(c) < over)) sets.push(set);
  }
  return sets;
}

/** Trashes the chosen programs (the answer to the prompt above). */
export function trashForMemory(state: GameState, set: CardInstance[]): void {
  for (const card of set) trashInstalledRunnerCard(state, card);
  addLog(state, 'runner', `Over the memory limit: the Runner trashed ${set.map(c => cardDef(c).title).join(', ')}.`);
}

/** Resolves the Runner's choice of set; any option still offered must still be an appropriate set. */
export function answerMemoryLimit(state: GameState, optionId: string): void {
  const over = state.runner.memoryUnitsUsed - memoryLimit(state);
  const sets = appropriateSets(state.runner.rig.programs.filter(c => (cardDef(c).memory_cost ?? 0) > 0), over);
  const set = sets.find(s => s.map(c => c.instanceId).join(',') === optionId);
  if (!set) illegal('Choose one of the sets of programs offered');
  trashForMemory(state, set);
}
