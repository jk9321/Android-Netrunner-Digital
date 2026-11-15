import { addLog } from '../../../engine/log';
import { dealNetDamage, giveTags } from '../../../engine/damage';
import {
  addCounters,
  counters,
  drawForEffect,
  gainFromCard,
  loseCredits,
  removeBadPublicity,
  removeCounters,
  removeTags,
  takeBadPublicity,
  trashInstalledCard,
  turnFlag,
  TurnFlag,
} from '../../../engine/cardEffects';
import { CardScript } from '../../types';
import { askChoice } from '../../effects';
import { isSelf, keywords, type } from './helpers';

// Synchrocyclotron (Facility): The first double operation you play each turn costs click less to play.
export const synchrocyclotron: CardScript = {
  modifiers: {
    playClickDiscount: (state, _self, playing) =>
      type(playing) === 'operation' && /\bdouble\b/i.test(keywords(playing)) && turnFlag(state, TurnFlag.doublesPlayed) === 0 ? 1 : 0,
  },
};

// Esca (Ambush): While the Runner is accessing this asset in R&D, they must reveal it. When
// the Runner accesses this asset, they lose 1 credit. If they are tagged, do 1 net damage.
export const esca: CardScript = {
  revealedOnRdAccess: true,
  onAccessed: ({ state }) => {
    const lost = loseCredits(state, 'runner', 1);
    addLog(state, 'corp', `Esca: the Runner lost ${lost} [credit].`);
    if (state.runner.tags > 0) dealNetDamage(state, 1);
  },
};

// Magistrate Revontulet (Executive): As an additional cost to steal an agenda, the Runner must
// pay 3 credits. Whenever you score an agenda, the Runner loses 3 credits.
export const magistrate: CardScript = {
  stealCost: () => ({ credits: 3 }),
  triggers: {
    agenda_scored: ({ state }) => {
      const lost = loseCredits(state, 'runner', 3);
      addLog(state, 'corp', `The Runner lost ${lost} [credit] (Magistrate Revontulet).`);
    },
  },
};

// Nihilo Agent (Enforcer - Liability): When you rez this asset, load 3 power counters onto it.
// When it is empty, trash it. When your turn begins, remove 1 tag and 1 bad publicity. When
// your discard phase ends, give the Runner 1 tag, take 1 bad publicity, and remove 1 hosted power counter.
export const nihiloAgent: CardScript = {
  triggers: {
    rezzed: (ctx, e) => isSelf(ctx, e.card) && addCounters(ctx.card, 'power', 3),
    turn_begins: ({ state }, e) => {
      if (e.side !== 'corp') return;
      const tags = removeTags(state, 1);
      const bp = removeBadPublicity(state, 1);
      addLog(state, 'corp', `Nihilo Agent removed ${tags} tag(s) and ${bp} bad publicity.`);
    },
    discard_phase_ends: (ctx, e) => {
      const { state, card } = ctx;
      if (e.side !== 'corp') return;
      giveTags(state, 1);
      takeBadPublicity(state, 1);
      removeCounters(card, 'power', 1);
      if (counters(card, 'power') === 0) {
        trashInstalledCard(state, card);
        addLog(state, 'corp', 'Nihilo Agent is empty and was trashed.');
      }
    },
  },
};

// Luana Campos (Executive - Liability): When your turn begins, you may host 1 of your bad
// publicity counters on this asset. If you do, gain 3 credits and draw 1 card.
// Interrupt -> When this asset would be uninstalled, take all hosted bad publicity.
const HOSTED_BP = 'badPublicity';

export const luana: CardScript = {
  triggers: {
    turn_begins: (ctx, e) => {
      if (e.side !== 'corp' || ctx.state.corp.badPublicity === 0) return;
      askChoice(ctx, 'corp', 'Luana Campos: host 1 bad publicity on it to gain 3 credits and draw 1 card?', [
        { id: 'host', label: 'Host 1 bad publicity: gain 3, draw 1' },
        { id: 'no', label: 'No' },
      ], 'host');
    },
  },
  onUninstall: ({ state, card }) => {
    const hosted = card.tokens[HOSTED_BP] ?? 0;
    card.tokens[HOSTED_BP] = 0;
    takeBadPublicity(state, hosted);
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind !== 'effect_choice' || answer.optionId !== 'host' || state.corp.badPublicity === 0) return;
    state.corp.badPublicity -= 1;
    card.tokens[HOSTED_BP] = (card.tokens[HOSTED_BP] ?? 0) + 1;
    gainFromCard(state, 'corp', 3, card);
    drawForEffect(state, 'corp', 1, 'Luana Campos');
    addLog(state, 'corp', 'Corp hosted 1 bad publicity on Luana Campos and gained 3 [credit].');
  },
};

// --- Ice --------------------------------------------------------------------

export const vantageCorpAssetsScripts: Record<string, CardScript> = {
  '36027': synchrocyclotron,
  '36038': esca,
  '36048': magistrate,
  '36049': nihiloAgent,
  '36057': luana,
};
