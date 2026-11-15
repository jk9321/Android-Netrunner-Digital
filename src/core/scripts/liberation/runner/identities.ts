import { GameState } from '../../../types/state';
import { addLog } from '../../../engine/log';
import { runFlag, RunFlag, turnFlag, useOncePerTurn } from '../../../engine/cardEffects';
import { CardScript } from '../../types';
import { installableRunnerCards, installRunnerHostChoice } from '../../effects';
import { cards, choice, choiceQuestion, prompts, RunnerHostData } from '../../steps';
import { hasKeyword, ids, onceKey, type, yesNo } from './helpers';

// Mercury: Chrome Libertador: Once per turn -> When you breach HQ or R&D during a run, if you did
// not break any subroutines during that run, you may access 1 additional card.
const mercuryFlow = prompts({
  access: choice(({ state, card }, a) => {
    if (a.optionId !== 'yes' || !state.activeRun || !useOncePerTurn(state, onceKey(card))) return;
    state.activeRun.extraAccesses += 1;
    addLog(state, 'runner', 'Runner will access 1 additional card (Mercury).');
  }),
});

export const mercury: CardScript = {
  triggers: {
    breach_server: (ctx, e) => {
      const { state } = ctx;
      if ((e.server !== 'hq' && e.server !== 'rd') || state.activeRun?.accessOnly) return;
      if (runFlag(state, RunFlag.subsBroken) > 0 || turnFlag(state, onceKey(ctx.card)) > 0) return;
      mercuryFlow.ask(ctx, 'access', choiceQuestion('runner', 'Mercury: access 1 additional card?', yesNo('Access 1 more')));
    },
  },
  ...mercuryFlow.script,
};

// Arissana Rocha Nahu: Street Artist: Once per turn -> 0 credits: Install 1 program from your grip
// (paying its install cost). Use this ability only during a run. When that run ends, trash that
// program if it is not a trojan.
/** Arissana: the program installed during the run is trashed when it ends, unless it's a trojan. */
const arissanaInstalled = (state: GameState, id: string | undefined) => {
  const program = id && state.runner.rig.programs.find(c => c.instanceId === id);
  if (program && !hasKeyword(program, 'trojan') && state.activeRun) state.activeRun.trashAtRunEnd.push(program.instanceId);
};

const arissanaFlow = prompts({
  install: cards((ctx, a) => {
    const id = a.ids[0];
    if (id && !arissanaFlow.installRunner(ctx, id, 'host', 0, a.trashFirst)) return;
    arissanaInstalled(ctx.state, id);
  }),
  host: choice<RunnerHostData>((ctx, a, data, source) => {
    if (installRunnerHostChoice(ctx.state, source, a.raw)) arissanaInstalled(ctx.state, data.cardId);
  }),
});

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
        arissanaFlow.runnerInstall(ctx, 'install', { message: 'Arissana Rocha Nahu: install 1 program from your grip.', candidateIds: ids(programs), min: 1, max: 1 });
      },
    },
  ],
  ...arissanaFlow.script,
};

// Sebastião Souza Pessoa: Activist Organizer: Whenever you take 1 or more tags, if you had no tags,
// you may install 1 connection resource from your grip, paying 2 credits less. As an additional
// cost to trash a connection resource with the basic action, the Corp must trash 1 card from HQ.
const connectionsInGrip = (state: GameState) => installableRunnerCards(state, state.runner.grip.filter(c => type(c) === 'resource' && hasKeyword(c, 'connection')), 2);

const sebastiaoFlow = prompts({
  // The answer's cards to trash first are not passed on (as before the typed steps)
  install: cards((ctx, a) => {
    if (a.ids.length > 0) sebastiaoFlow.installRunner(ctx, a.ids[0], 'host', 2, []);
  }),
  host: choice<RunnerHostData>((ctx, a, _d, source) => void installRunnerHostChoice(ctx.state, source, a.raw)),
});

export const sebastiao: CardScript = {
  triggers: {
    tags_taken: (ctx, e) => {
      if (ctx.state.runner.tags !== e.count) return; // had tags before
      const options = connectionsInGrip(ctx.state);
      // Asked even with no connection to install when the Runner's stops are on ALL (4.3.2, see askEvenIfNone)
      sebastiaoFlow.evenIfNone(
        ctx,
        'runner',
        options.length > 0,
        () =>
          sebastiaoFlow.runnerInstall(ctx, 'install', {
            message: 'Sebastião Souza Pessoa: you may install 1 connection resource from your grip, paying 2 [credit] less.',
            candidateIds: ids(options),
            min: 0,
            max: 1,
          }),
        'Sebastião Souza Pessoa: no connection resource in your grip you can install.',
      );
    },
  },
  modifiers: { resourceTrashHqCost: (_state, _self, resource) => (hasKeyword(resource, 'connection') ? 1 : 0) },
  ...sebastiaoFlow.script,
};

export const liberationRunnerIdentitiesScripts: Record<string, CardScript> = {
  '34010': mercury,
  '34020': arissana,
  '34066': sebastiao,
};
