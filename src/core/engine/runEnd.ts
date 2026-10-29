import { GameState } from '../types/state';
import { cardDef } from '../cards';
import { getCardScript } from '../scripts';
import { addLog } from './log';
import { trashInstalledRunnerCard } from './damage';
import { fireTrigger } from './triggers';
import { findCardAnywhere } from './helpers';
import { pushPrompt } from './prompts';

/** Ends the active run (successful or not) and cleans up run-scoped effects. */
export function endRun(state: GameState): void {
  const run = state.activeRun;
  if (!run) return;
  for (const id of run.trashAtRunEnd) {
    const card = state.runner.rig.programs.find(c => c.instanceId === id);
    if (card) {
      trashInstalledRunnerCard(state, card);
      addLog(state, 'runner', `${cardDef(card).title} was trashed as the run ended.`);
    }
  }
  state.activeRun = null;
  state.phase = state.activePlayer === 'corp' ? 'corp_turn' : 'runner_turn';
  if (run.accessOnly) return; // Detente: accessing outside a run
  // The encounter in progress ends with the run (Knowledge Seeker)
  const encountered = run.encounter && state.corp.servers[run.server]?.ice.find(c => c.instanceId === run.encounter!.iceId);
  if (encountered?.isRezzed) getCardScript(encountered.cardCode)?.ice?.onEncounterEnds?.({ state, card: encountered, side: 'corp' });
  for (const source of run.runEffects) {
    const card = findCardAnywhere(state, source.instanceId);
    if (card) getCardScript(source.cardCode)?.onRunEnds?.({ state, card, side: 'runner' }, run);
  }
  const persistent = run.persistentIds.flatMap(id => findCardAnywhere(state, id) ?? []);
  fireTrigger(
    state,
    {
      type: 'run_ends',
      server: run.server,
      successful: run.isSuccessful,
      accessedCount: run.accessedCount,
      stoleAgenda: run.stoleAgenda,
    },
    persistent
  );
}

/** Card code of Shred, whose script answers the prompt below. */
const SHRED = '35005';

/**
 * "End the run": the run ends unsuccessfully. The first time the Corp would
 * end a Shred run, they must instead trash X cards from HQ at random (X =
 * cards in the attacked server's root), or the run goes on.
 */
export function endTheRun(state: GameState): void {
  const run = state.activeRun;
  if (!run) return;
  if (run.shredArmed) {
    run.shredArmed = false;
    const x = state.corp.servers[run.server]?.root.length ?? 0;
    if (state.corp.hq.length >= x) {
      const shred = run.runEffects.find(r => r.cardCode === SHRED);
      pushPrompt(state, {
        kind: 'effect_choice',
        side: 'corp',
        message: `Shred: reveal and trash ${x} card(s) from HQ at random to end the run?`,
        options: [
          { id: 'trash', label: `Trash ${x} random card(s) from HQ and end the run` },
          { id: 'no', label: 'Let the run continue' },
        ],
        source: { cardCode: SHRED, instanceId: shred?.instanceId ?? '', step: 'shred', data: { x } },
      });
    } else {
      addLog(state, 'runner', 'Shred: the Corp cannot trash enough cards from HQ, so the run continues.');
    }
    return;
  }
  addLog(state, 'corp', 'The run was ended.');
  endRun(state);
}
