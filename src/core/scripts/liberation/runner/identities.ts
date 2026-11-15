import { GameState } from '../../../types/state';
import { addLog } from '../../../engine/log';
import { runFlag, RunFlag, turnFlag, useOncePerTurn } from '../../../engine/cardEffects';
import { CardScript } from '../../types';
import {
  askChoice,
  askEvenIfNone,
  askRunnerInstall,
  installableRunnerCards,
  installRunnerChoice,
  installRunnerHostChoice,
} from '../../effects';
import { hasKeyword, ids, onceKey, picked, said, type, yesNo } from './helpers';

// Mercury: Chrome Libertador: Once per turn -> When you breach HQ or R&D during a run, if you did
// not break any subroutines during that run, you may access 1 additional card.
export const mercury: CardScript = {
  triggers: {
    breach_server: (ctx, e) => {
      const { state } = ctx;
      if ((e.server !== 'hq' && e.server !== 'rd') || state.activeRun?.accessOnly) return;
      if (runFlag(state, RunFlag.subsBroken) > 0 || turnFlag(state, onceKey(ctx.card)) > 0) return;
      askChoice(ctx, 'runner', 'Mercury: access 1 additional card?', yesNo('Access 1 more'), 'access');
    },
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (!said(answer) || !state.activeRun || !useOncePerTurn(state, onceKey(card))) return;
    state.activeRun.extraAccesses += 1;
    addLog(state, 'runner', 'Runner will access 1 additional card (Mercury).');
  },
};

// Arissana Rocha Nahu: Street Artist: Once per turn -> 0 credits: Install 1 program from your grip
// (paying its install cost). Use this ability only during a run. When that run ends, trash that
// program if it is not a trojan.
export const arissana: CardScript = {
  abilities: [
    {
      label: 'Install 1 program from your grip (only during a run; trashed when the run ends unless a trojan).',
      oncePerTurn: true,
      canUse: ({ state }) => {
        if (!state.activeRun || state.activeRun.accessOnly) return 'Use this only during a run';
        return installableRunnerCards(state, state.runner.grip.filter(c => type(c) === 'program')).length > 0 ? null : 'No program in the grip can be installed';
      },
      resolve: ctx => {
        const programs = installableRunnerCards(ctx.state, ctx.state.runner.grip.filter(c => type(c) === 'program'));
        askRunnerInstall(ctx, 'Arissana Rocha Nahu: install 1 program from your grip.', ids(programs), 1, 1, 'install');
      },
    },
  ],
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    let id: string | undefined;
    if (source.step === 'install' && picked(answer).length > 0) {
      id = picked(answer)[0];
      if (!installRunnerChoice(ctx, id, 'host', 0, {}, answer.kind === 'effect_cards' ? answer.trashFirst : [])) return;
    } else if (source.step === 'host') {
      id = source.data?.cardId as string;
      if (!installRunnerHostChoice(state, source, answer)) return;
    }
    const program = id && state.runner.rig.programs.find(c => c.instanceId === id);
    if (program && !hasKeyword(program, 'trojan') && state.activeRun) state.activeRun.trashAtRunEnd.push(program.instanceId);
  },
};

// Sebastião Souza Pessoa: Activist Organizer: Whenever you take 1 or more tags, if you had no tags,
// you may install 1 connection resource from your grip, paying 2 credits less. As an additional
// cost to trash a connection resource with the basic action, the Corp must trash 1 card from HQ.
const connectionsInGrip = (state: GameState) => installableRunnerCards(state, state.runner.grip.filter(c => type(c) === 'resource' && hasKeyword(c, 'connection')), 2);

export const sebastiao: CardScript = {
  triggers: {
    tags_taken: (ctx, e) => {
      if (ctx.state.runner.tags !== e.count) return; // had tags before
      const options = connectionsInGrip(ctx.state);
      // Asked even with no connection to install when the Runner's stops are on ALL (4.3.2, see askEvenIfNone)
      askEvenIfNone(
        ctx,
        'runner',
        options.length > 0,
        () => askRunnerInstall(ctx, 'Sebastião Souza Pessoa: you may install 1 connection resource from your grip, paying 2 [credit] less.', ids(options), 0, 1, 'install'),
        'Sebastião Souza Pessoa: no connection resource in your grip you can install.',
      );
    },
  },
  modifiers: { resourceTrashHqCost: (_state, _self, resource) => (hasKeyword(resource, 'connection') ? 1 : 0) },
  onPromptAnswer: (ctx, _source, answer) => {
    if (picked(answer).length > 0) installRunnerChoice(ctx, picked(answer)[0], 'host', 2);
  },
};

export const liberationRunnerIdentitiesScripts: Record<string, CardScript> = {
  '34010': mercury,
  '34020': arissana,
  '34066': sebastiao,
};
