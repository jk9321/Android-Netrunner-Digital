import { CardInstance } from '../types/card';
import { GameState } from '../types/state';
import { cardDef } from '../cards';
import { shuffleInPlace } from '../rng';
import { addLog } from '../engine/log';
import { findInstalledCorpCard, removeCard } from '../engine/helpers';
import { rezForFree } from '../engine/actions/corp';
import { dealMeatDamage, dealNetDamage, giveTags } from '../engine/damage';
import { endTheRun } from '../engine/runEnd';
import {
  availableCredits,
  drawForEffect,
  installedIce,
  loadCredits,
  spendCredits,
  takeHostedCredits,
  trashInstalledCard,
  turnFlag,
  TurnFlag,
} from '../engine/cardEffects';
import { CardScript, EffectContext } from './types';
import { askCards, askChoice, gainCredits } from './effects';

/** Corp identities, agendas, assets and upgrades from System Gateway. */

const isSelf = (ctx: EffectContext, card: CardInstance) => card.instanceId === ctx.card.instanceId;
const archivesCards = (state: GameState) => [...state.corp.archives.faceUp, ...state.corp.archives.faceDown];

/** Moves cards from Archives (either pile) into R&D and shuffles. */
function shuffleArchivesIntoRD(state: GameState, ids: string[]): void {
  for (const id of ids) {
    const card = archivesCards(state).find(c => c.instanceId === id);
    if (!card) continue;
    removeCard(state.corp.archives.faceUp, card) || removeCard(state.corp.archives.faceDown, card);
    card.isRezzed = false;
    state.corp.rd.push(card);
  }
  shuffleInPlace(state.rng, state.corp.rd);
  addLog(state, 'corp', `Corp shuffled ${ids.length} card(s) from Archives into R&D.`);
}

/** Trashes cards from HQ (facedown into Archives). */
function trashFromHQ(state: GameState, ids: string[]): void {
  for (const id of ids) {
    const card = state.corp.hq.find(c => c.instanceId === id);
    if (!card) continue;
    removeCard(state.corp.hq, card);
    state.corp.archives.faceDown.push(card);
  }
}

/** The server a Corp card is installed in, if it is installed. */
const serverOf = (state: GameState, card: CardInstance) => findInstalledCorpCard(state, card.instanceId)?.server.id;

// --- Identities -------------------------------------------------------------

// Haas-Bioroid: Precision Design: You get +1 maximum hand size. Whenever you
// score an agenda, you may add 1 card from Archives to HQ.
const precisionDesign: CardScript = {
  modifiers: { handSize: 1 },
  triggers: {
    agenda_scored: ctx => {
      const cards = archivesCards(ctx.state);
      if (cards.length === 0) return;
      askCards(ctx, 'corp', 'Precision Design: you may add 1 card from Archives to HQ.', cards.map(c => c.instanceId), 0, 1, 'archives');
    },
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards' || answer.cardInstanceIds.length === 0) return;
    const card = archivesCards(state).find(c => c.instanceId === answer.cardInstanceIds[0])!;
    removeCard(state.corp.archives.faceUp, card) || removeCard(state.corp.archives.faceDown, card);
    card.isRezzed = false;
    state.corp.hq.push(card);
    addLog(state, 'corp', 'Corp added 1 card from Archives to HQ (Precision Design).');
  },
};

// Jinteki: Restoring Humanity: When your discard phase ends, if there is a
// facedown card in Archives, gain 1 credit.
const restoringHumanity: CardScript = {
  triggers: {
    discard_phase_ends: ({ state }, e) => {
      if (e.side !== 'corp' || state.corp.archives.faceDown.length === 0) return;
      gainCredits(state, 'corp', 1);
      addLog(state, 'corp', 'Corp gained 1 [credit] (Restoring Humanity).');
    },
  },
};

// NBN: Reality Plus: The first time each turn the Runner takes a tag, gain 2 credits or draw 2 cards.
const realityPlus: CardScript = {
  triggers: {
    tags_taken: ctx => {
      if (turnFlag(ctx.state, TurnFlag.tagEvents) !== 1) return;
      askChoice(ctx, 'corp', 'Reality Plus: gain 2 credits or draw 2 cards?', [
        { id: 'credits', label: 'Gain 2 credits' },
        { id: 'draw', label: 'Draw 2 cards' },
      ], 'choice');
    },
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    if (answer.optionId === 'credits') {
      gainCredits(state, 'corp', 2);
      addLog(state, 'corp', 'Corp gained 2 [credit] (Reality Plus).');
    } else {
      drawForEffect(state, 'corp', 2, 'Reality Plus');
    }
  },
};

// Weyland Consortium: Built to Last: Whenever you advance a card, gain 2
// credits if it had no advancement counters.
const builtToLast: CardScript = {
  triggers: {
    advanced: ({ state }, e) => {
      if (e.hadCounters) return;
      gainCredits(state, 'corp', 2);
      addLog(state, 'corp', 'Corp gained 2 [credit] (Built to Last).');
    },
  },
};

// --- Agendas ----------------------------------------------------------------

// Luminal Transubstantiation: When you score this agenda, gain 3 clicks. You
// cannot score agendas for the remainder of the turn.
const luminalTransubstantiation: CardScript = {
  triggers: {
    agenda_scored: (ctx, e) => {
      if (!isSelf(ctx, e.card)) return;
      ctx.state.corp.clicks += 3;
      ctx.state.turnFlags[TurnFlag.cannotScore] = 1;
      addLog(ctx.state, 'corp', 'Corp gained 3 [click] and cannot score agendas for the rest of the turn.');
    },
  },
};

// Longevity Serum: When you score this agenda, trash any number of cards from
// HQ. Shuffle up to 3 cards from Archives into R&D.
const askLongevityShuffle = (ctx: EffectContext) => {
  const cards = archivesCards(ctx.state);
  if (cards.length === 0) return;
  askCards(ctx, 'corp', 'Longevity Serum: shuffle up to 3 cards from Archives into R&D.', cards.map(c => c.instanceId), 0, Math.min(3, cards.length), 'shuffle');
};
const longevitySerum: CardScript = {
  triggers: {
    agenda_scored: (ctx, e) => {
      if (!isSelf(ctx, e.card)) return;
      const hq = ctx.state.corp.hq;
      if (hq.length === 0) return askLongevityShuffle(ctx);
      askCards(ctx, 'corp', 'Longevity Serum: trash any number of cards from HQ.', hq.map(c => c.instanceId), 0, hq.length, 'trash');
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    if (answer.kind !== 'effect_cards') return;
    if (source.step === 'trash') {
      trashFromHQ(ctx.state, answer.cardInstanceIds);
      addLog(ctx.state, 'corp', `Corp trashed ${answer.cardInstanceIds.length} card(s) from HQ.`);
      askLongevityShuffle(ctx);
    } else if (answer.cardInstanceIds.length > 0) {
      shuffleArchivesIntoRD(ctx.state, answer.cardInstanceIds);
    }
  },
};

// Tomorrow's Headline: When this agenda is scored or stolen, give the Runner 1 tag.
const headline = (ctx: EffectContext, e: { card: CardInstance }) => isSelf(ctx, e.card) && giveTags(ctx.state, 1);
const tomorrowsHeadline: CardScript = { triggers: { agenda_scored: headline, agenda_stolen: headline } };

// Above the Law: When you score this agenda, you may trash 1 installed resource.
const aboveTheLaw: CardScript = {
  triggers: {
    agenda_scored: (ctx, e) => {
      const resources = ctx.state.runner.rig.resources;
      if (!isSelf(ctx, e.card) || resources.length === 0) return;
      askCards(ctx, 'corp', 'Above the Law: you may trash 1 installed resource.', resources.map(c => c.instanceId), 0, 1, 'trash');
    },
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards' || answer.cardInstanceIds.length === 0) return;
    const card = state.runner.rig.resources.find(c => c.instanceId === answer.cardInstanceIds[0])!;
    trashInstalledCard(state, card);
    addLog(state, 'corp', `Corp trashed ${cardDef(card).title} (Above the Law).`);
  },
};

// Offworld Office: When you score this agenda, gain 7 credits.
const offworldOffice: CardScript = {
  triggers: {
    agenda_scored: (ctx, e) => {
      if (!isSelf(ctx, e.card)) return;
      gainCredits(ctx.state, 'corp', 7);
      addLog(ctx.state, 'corp', 'Corp gained 7 [credit] (Offworld Office).');
    },
  },
};

// Send a Message: When this agenda is scored or stolen, you may rez 1 installed
// piece of ice, ignoring all costs.
const sendAMessageTrigger = (ctx: EffectContext, e: { card: CardInstance }) => {
  const unrezzed = installedIce(ctx.state).filter(c => !c.isRezzed);
  if (!isSelf(ctx, e.card) || unrezzed.length === 0) return;
  askCards(ctx, 'corp', 'Send a Message: you may rez 1 installed piece of ice, ignoring all costs.', unrezzed.map(c => c.instanceId), 0, 1, 'rez');
};
const sendAMessage: CardScript = {
  triggers: { agenda_scored: sendAMessageTrigger, agenda_stolen: sendAMessageTrigger },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards' || answer.cardInstanceIds.length === 0) return;
    const ice = installedIce(state).find(c => c.instanceId === answer.cardInstanceIds[0])!;
    addLog(state, 'corp', `Corp rezzed ${cardDef(ice).title}, ignoring all costs (Send a Message).`, undefined, 'rez');
    rezForFree(state, ice);
  },
};

// Orbital Superiority: When you score this agenda, if the Runner is tagged, do
// 4 meat damage; otherwise, give the Runner 1 tag.
const orbitalSuperiority: CardScript = {
  triggers: {
    agenda_scored: (ctx, e) => {
      if (!isSelf(ctx, e.card)) return;
      if (ctx.state.runner.tags > 0) dealMeatDamage(ctx.state, 4);
      else giveTags(ctx.state, 1);
    },
  },
};

// Superconducting Hub: When you score this agenda, you may draw 2 cards. You get +2 maximum hand size.
const superconductingHub: CardScript = {
  modifiers: { handSize: 2 },
  triggers: {
    agenda_scored: (ctx, e) => {
      if (!isSelf(ctx, e.card)) return;
      askChoice(ctx, 'corp', 'Superconducting Hub: draw 2 cards?', [
        { id: 'draw', label: 'Draw 2 cards' },
        { id: 'no', label: 'Do not draw' },
      ], 'draw');
    },
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind === 'effect_choice' && answer.optionId === 'draw') drawForEffect(state, 'corp', 2, 'Superconducting Hub');
  },
};

// --- Assets -----------------------------------------------------------------

// Nico Campaign: When you rez this asset, load 9 credits onto it. When it is
// empty, trash it and draw 1 card. When your turn begins, take 3 credits from this asset.
const nicoCampaign: CardScript = {
  trashWhenEmpty: true,
  onEmptied: ({ state }) => drawForEffect(state, 'corp', 1, 'Nico Campaign'),
  triggers: {
    rezzed: (ctx, e) => isSelf(ctx, e.card) && loadCredits(ctx.state, ctx.card, 9),
    turn_begins: ({ state, card }, e) => e.side === 'corp' && takeHostedCredits(state, card, 3),
  },
};

// Spin Doctor: When you rez this asset, draw 2 cards. Remove this asset from
// the game: Shuffle up to 2 cards from Archives into R&D.
const spinDoctor: CardScript = {
  triggers: { rezzed: (ctx, e) => isSelf(ctx, e.card) && drawForEffect(ctx.state, 'corp', 2, 'Spin Doctor') },
  abilities: [
    {
      label: 'Remove from the game: shuffle up to 2 cards from Archives into R&D.',
      removeSelfFromGame: true,
      resolve: ctx => {
        const cards = archivesCards(ctx.state);
        if (cards.length === 0) return;
        askCards(ctx, 'corp', 'Spin Doctor: shuffle up to 2 cards from Archives into R&D.', cards.map(c => c.instanceId), 0, Math.min(2, cards.length), 'shuffle');
      },
    },
  ],
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) shuffleArchivesIntoRD(state, answer.cardInstanceIds);
  },
};

// Regolith Mining License: When you rez this asset, load 15 credits onto it.
// When it is empty, trash it. click: Take 3 credits from this asset.
const regolithMiningLicense: CardScript = {
  trashWhenEmpty: true,
  triggers: { rezzed: (ctx, e) => isSelf(ctx, e.card) && loadCredits(ctx.state, ctx.card, 15) },
  abilities: [{ label: 'Take 3 credits from this asset.', clicks: 1, resolve: ({ state, card }) => void takeHostedCredits(state, card, 3) }],
};

// Urtica Cipher: You can advance this asset. When the Runner accesses this
// asset while it is installed, do 2 net damage plus 1 net damage for each
// hosted advancement counter. (Works while unrezzed: it triggers on access.)
const urticaDamage = (card: CardInstance) => 2 + card.advancementCounters;
const urticaCipher: CardScript = {
  onAccessed: ({ state, card }) => void dealNetDamage(state, urticaDamage(card)),
  liveValue: (_state, card) => `On access now: ${urticaDamage(card)} net damage`,
};

// Clearinghouse: You can advance this asset. When your turn begins, you may
// trash this asset to do 1 meat damage for each hosted advancement counter.
const clearinghouse: CardScript = {
  liveValue: (_state, card) => `Trash now: ${card.advancementCounters} meat damage`,
  triggers: {
    turn_begins: (ctx, e) => {
      if (e.side !== 'corp' || ctx.card.advancementCounters === 0) return;
      const n = ctx.card.advancementCounters;
      askChoice(ctx, 'corp', `Clearinghouse: trash it to do ${n} meat damage?`, [
        { id: 'yes', label: `Trash it: ${n} meat damage` },
        { id: 'no', label: 'Keep it' },
      ], 'trash');
    },
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind !== 'effect_choice' || answer.optionId !== 'yes') return;
    if (!serverOf(state, card)) return; // no longer installed
    const damage = card.advancementCounters;
    trashInstalledCard(state, card);
    dealMeatDamage(state, damage);
  },
};

// --- Upgrades ---------------------------------------------------------------

// Manegarm Skunkworks: Whenever the Runner approaches this server, end the run
// unless they either spend 2 clicks or pay 5 credits.
const manegarmSkunkworks: CardScript = {
  triggers: {
    approach_server: (ctx, e) => {
      if (serverOf(ctx.state, ctx.card) !== e.server) return;
      const options = [
        ...(ctx.state.runner.clicks >= 2 ? [{ id: 'clicks', label: 'Spend 2 clicks' }] : []),
        ...(availableCredits(ctx.state, 'runner') >= 5 ? [{ id: 'pay', label: 'Pay 5 credits' }] : []),
        { id: 'end', label: 'End the run' },
      ];
      askChoice(ctx, 'runner', 'Manegarm Skunkworks: spend 2 clicks or pay 5 credits, or the run ends.', options, 'approach');
    },
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    if (answer.optionId === 'clicks') {
      state.runner.clicks -= 2;
      addLog(state, 'runner', 'Runner spent 2 [click] (Manegarm Skunkworks).');
    } else if (answer.optionId === 'pay') {
      spendCredits(state, 'runner', 5);
      addLog(state, 'runner', 'Runner paid 5 [credit] (Manegarm Skunkworks).');
    } else {
      endTheRun(state);
    }
  },
};

// Anoetic Void: Whenever the Runner approaches this server, you may pay 2
// credits and trash 2 cards from HQ. If you do, end the run.
const anoeticVoid: CardScript = {
  triggers: {
    approach_server: (ctx, e) => {
      if (serverOf(ctx.state, ctx.card) !== e.server) return;
      if (ctx.state.corp.credits < 2 || ctx.state.corp.hq.length < 2) return;
      askChoice(ctx, 'corp', 'Anoetic Void: pay 2 credits and trash 2 cards from HQ to end the run?', [
        { id: 'yes', label: 'Pay and end the run' },
        { id: 'no', label: 'Do nothing' },
      ], 'approach');
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'approach' && answer.kind === 'effect_choice' && answer.optionId === 'yes') {
      askCards(ctx, 'corp', 'Anoetic Void: choose 2 cards from HQ to trash.', state.corp.hq.map(c => c.instanceId), 2, 2, 'trash');
    } else if (source.step === 'trash' && answer.kind === 'effect_cards') {
      state.corp.credits -= 2;
      trashFromHQ(state, answer.cardInstanceIds);
      addLog(state, 'corp', 'Corp paid 2 [credit] and trashed 2 cards from HQ (Anoetic Void).');
      endTheRun(state);
    }
  },
};

// AMAZE Amusements: Persistent -> Whenever a run on this server ends, if the
// Runner stole any agendas during that run, give the Runner 2 tags.
const amazeAmusements: CardScript = {
  persistent: true,
  triggers: {
    run_ends: ({ state, card }, e) => {
      const server = serverOf(state, card);
      // Not installed any more: it was trashed during this run and is still persistent.
      if (server !== undefined && server !== e.server) return;
      if (e.stoleAgenda) giveTags(state, 2);
    },
  },
};

// Malapert Data Vault: Whenever you score an agenda from the root of this
// server, you may search R&D for 1 non-agenda card and reveal it. (Shuffle R&D
// after searching it.) Add that card to HQ.
const malapertDataVault: CardScript = {
  triggers: {
    agenda_scored: (ctx, e) => {
      if (serverOf(ctx.state, ctx.card) !== e.serverId) return;
      const options = ctx.state.corp.rd.filter(c => cardDef(c).type_code !== 'agenda');
      if (options.length === 0) return;
      askCards(ctx, 'corp', 'Malapert Data Vault: you may search R&D for 1 non-agenda card.', options.map(c => c.instanceId), 0, 1, 'search');
    },
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards' || answer.cardInstanceIds.length === 0) return;
    const card = state.corp.rd.find(c => c.instanceId === answer.cardInstanceIds[0])!;
    removeCard(state.corp.rd, card);
    state.corp.hq.push(card);
    shuffleInPlace(state.rng, state.corp.rd);
    addLog(state, 'corp', `Corp revealed ${cardDef(card).title}, added it to HQ and shuffled R&D (Malapert Data Vault).`);
  },
};

export const corpCardScripts: Record<string, CardScript> = {
  '30035': precisionDesign,
  '30036': luminalTransubstantiation,
  '30037': nicoCampaign,
  '30042': manegarmSkunkworks,
  '30043': restoringHumanity,
  '30044': longevitySerum,
  '30045': urticaCipher,
  '30050': anoeticVoid,
  '30051': realityPlus,
  '30052': tomorrowsHeadline,
  '30053': spinDoctor,
  '30058': amazeAmusements,
  '30059': builtToLast,
  '30060': aboveTheLaw,
  '30061': clearinghouse,
  '30066': malapertDataVault,
  '30067': offworldOffice,
  '30068': orbitalSuperiority,
  '30069': sendAMessage,
  '30070': superconductingHub,
  '30071': regolithMiningLicense,
};
