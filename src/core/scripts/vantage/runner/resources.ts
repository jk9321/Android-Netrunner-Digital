import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { addLog } from '../../../engine/log';
import { drawCards, removeCard, turnKey } from '../../../engine/helpers';
import { dealNetDamage, trashInstalledRunnerCard } from '../../../engine/damage';
import { drawForEffect, removeTags, turnFlag, TurnFlag, useOncePerTurn } from '../../../engine/cardEffects';
import { grantSubroutine } from '../../../engine/ice';
import { CardScript } from '../../types';
import { gainCredits } from '../../effects';
import { choice, choiceQuestion, prompts } from '../../steps';
import { isInstalled, keywords, onceKey } from './helpers';

// Hackerspace (Location): You can install unique companion resources and unique connection
// resources onto this resource. Each resource installed this way costs 1 credit less to
// install. While this resource has a hosted companion and a hosted connection, you get +2
// maximum hand size.
const hostedOn = (state: GameState, host: CardInstance) => state.runner.rig.resources.filter(c => c.hostedOnId === host.instanceId);

export const hackerspace: CardScript = {
  hostsInstalled: (_state, _self, card) =>
    cardDef(card).type_code === 'resource' && !!cardDef(card).uniqueness && /\b(companion|connection)\b/i.test(keywords(card)),
  hostedInstallDiscount: 1,
  modifiers: {
    handSize: (state, self) => {
      const hosted = hostedOn(state, self);
      const has = (k: RegExp) => hosted.some(c => k.test(keywords(c)));
      return has(/\bcompanion\b/i) && has(/\bconnection\b/i) ? 2 : 0;
    },
  },
};

// Nurse Hạnh (Connection): Whenever 2 or more facedown cards in Archives are turned faceup, draw 2 cards.
export const nurseHanh: CardScript = {
  triggers: {
    archives_turned_faceup: (ctx, e) => e.count >= 2 && drawForEffect(ctx.state, 'runner', 2, 'Nurse Hạnh'),
  },
};

// Stick and Poke (Companion - Virtual): The first time each turn you encounter a piece of
// ice, it gains "[subroutine] Do 1 net damage. The Runner draws 1 card.", before its other
// subroutines, for the remainder of that encounter.
export const stickAndPoke: CardScript = {
  grantedSubroutines: [
    {
      label: 'Do 1 net damage. The Runner draws 1 card.',
      resolve: ({ state }) => {
        dealNetDamage(state, 1);
        if (!state.winner) drawForEffect(state, 'runner', 1, 'Stick and Poke');
      },
    },
  ],
  triggers: {
    encounter_ice: ctx => {
      if (!useOncePerTurn(ctx.state, onceKey(ctx.card))) return;
      grantSubroutine(ctx.state, ctx.card.cardCode, 0);
      addLog(ctx.state, 'runner', 'The encountered ice gains "Do 1 net damage. The Runner draws 1 card." (Stick and Poke).');
    },
  },
};

// Underdome Irregulars (Connection): When your action phase ends, if a piece of ice was
// rezzed this turn, draw 2 cards or remove 1 tag. If no ice was rezzed this turn, trash this resource.
const underdomeFlow = prompts({
  choose: choice(({ state }, a) => {
    if (a.optionId === 'draw') drawForEffect(state, 'runner', 2, 'Underdome Irregulars');
    else if (removeTags(state, 1) > 0) addLog(state, 'runner', 'Runner removed 1 tag (Underdome Irregulars).');
  }),
});

export const underdome: CardScript = {
  triggers: {
    action_phase_ends: (ctx, e) => {
      const { state, card } = ctx;
      if (e.side !== 'runner') return;
      if (turnFlag(state, TurnFlag.iceRezzed) === 0) {
        trashInstalledRunnerCard(state, card);
        addLog(state, 'runner', 'No ice was rezzed this turn: Underdome Irregulars was trashed.');
        return;
      }
      if (state.runner.tags === 0) {
        drawForEffect(state, 'runner', 2, 'Underdome Irregulars');
        return;
      }
      underdomeFlow.choice(ctx, 'choose', choiceQuestion('runner', 'Underdome Irregulars: draw 2 cards or remove 1 tag?', [
        { id: 'draw', label: 'Draw 2 cards' },
        { id: 'tag', label: 'Remove 1 tag' },
      ]));
    },
  },
  ...underdomeFlow.script,
};

// Word on the Street: As an additional cost to score an agenda the Corp installed this turn,
// they must add this resource to their score area as an agenda worth -1 agenda points with
// "You cannot forfeit this agenda.". When the Corp scores an agenda they did not install this
// turn, trash this resource, gain 4 credits, and draw 1 card.
export const wordOnTheStreet: CardScript = {
  payScoreCost: ({ state, card }, agenda) => {
    if (agenda.installedTurn !== turnKey(state) || !isInstalled(state, card)) return;
    removeCard(state.runner.rig.resources, card);
    card.asAgendaPoints = -1;
    state.corp.scoreArea.push(card);
    state.corp.score -= 1;
    addLog(state, 'corp', 'Word on the Street was added to the Corp\'s score area as an agenda worth -1 point.');
  },
  triggers: {
    agenda_scored: (ctx, e) => {
      const { state, card } = ctx;
      if (e.card.installedTurn === turnKey(state) || !isInstalled(state, card)) return;
      trashInstalledRunnerCard(state, card);
      gainCredits(state, 'runner', 4);
      const drawn = drawCards(state, 'runner', 1);
      addLog(state, 'runner', `Word on the Street was trashed: Runner gained 4 [credit] and drew ${drawn} card(s).`);
    },
  },
};

export const vantageRunnerResourcesScripts: Record<string, CardScript> = {
  '36006': hackerspace,
  '36007': nurseHanh,
  '36008': stickAndPoke,
  '36016': underdome,
  '36025': wordOnTheStreet,
};
