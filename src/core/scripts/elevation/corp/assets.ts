import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { addLog } from '../../../engine/log';
import { completeRez } from '../../../engine/actions/corp';
import { playCardFrom } from '../../../engine/actions/play';
import { dealNetDamage, giveTags } from '../../../engine/damage';
import {
  addCounters,
  availableCredits,
  corpTrashFromHQ,
  counters,
  drawForEffect,
  forfeitable,
  forfeitAgenda,
  loadCredits,
  removeCounters,
  spendCredits,
  takeHostedCredits,
  threatLevel,
  trashInstalledCard,
  useOncePerTurn,
} from '../../../engine/cardEffects';
import { CardScript, EffectContext } from '../../types';
import { askCards, askChoice, gainCredits } from '../../effects';
import { archivesCards, askInstallFromHQ, ids, installFromHQ, isSelf, keywords, onceKey, safePlayBlockerFrom, serverOf, type } from './helpers';

export const humanoidResources: CardScript = {
  abilities: [
    {
      label: 'Gain 4 credits and draw 3 cards; install up to 2 cards from HQ; you may play 1 operation.',
      clicks: 3,
      trashSelf: true,
      resolve: ctx => {
        gainCredits(ctx.state, 'corp', 4);
        drawForEffect(ctx.state, 'corp', 3, 'Humanoid Resources');
        if (!ctx.state.winner) askInstallFromHQ(ctx, 2, 'operation');
      },
    },
  ],
  ...installFromHQ.script,
};

// Otto Campaign: When you rez this asset, load 6 credits onto it. When it is empty,
// trash it and gain click click. When your turn begins, take 2 credits from this asset.
export const ottoCampaign: CardScript = {
  trashWhenEmpty: true,
  onEmptied: ({ state }) => {
    state.corp.clicks += 2;
    addLog(state, 'corp', 'Corp gained [click][click] (Otto Campaign).');
  },
  triggers: {
    rezzed: (ctx, e) => isSelf(ctx, e.card) && loadCredits(ctx.state, ctx.card, 6),
    turn_begins: ({ state, card }, e) => e.side === 'corp' && takeHostedCredits(state, card, 2),
  },
};

// Byte!: While the Runner is accessing this asset in R&D, they must reveal it. When the
// Runner accesses this asset anywhere except in Archives, you may pay 4 credits. If you
// do, give the Runner 1 tag and do 3 net damage.
export const byte: CardScript = {
  revealedOnRdAccess: true,
  onAccessed: (ctx, where) => {
    if (where === 'archives' || ctx.state.corp.credits < 4) return;
    askChoice(ctx, 'corp', 'Byte!: pay 4 credits to give the Runner 1 tag and do 3 net damage?', [
      { id: 'pay', label: 'Pay 4: 1 tag and 3 net damage' },
      { id: 'no', label: 'No' },
    ], 'pay');
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_choice' || answer.optionId !== 'pay' || state.corp.credits < 4) return;
    state.corp.credits -= 4;
    giveTags(state, 1);
    dealNetDamage(state, 3);
  },
};

// Phật Gioan Baotixita: When your discard phase ends, place 1 power counter on this asset.
// The first time each turn an agenda is scored or stolen, you may remove up to 2 hosted
// power counters. Do 1 net damage plus 1 net damage for each power counter removed this way.
const phatMaxRemoved = (card: CardInstance) => Math.min(2, counters(card, 'power'));

const phatTrigger = (ctx: EffectContext) => {
  if (!useOncePerTurn(ctx.state, onceKey(ctx.card))) return;
  const max = phatMaxRemoved(ctx.card);
  const options = Array.from({ length: max + 1 }, (_, n) => ({ id: String(n), label: `Remove ${n} power counter(s): ${n + 1} net damage` }));
  askChoice(ctx, 'corp', 'Phật Gioan Baotixita: remove power counters for extra net damage.', options, 'damage');
};

export const phat: CardScript = {
  liveValue: (_state, card) => `Next score or steal: up to ${1 + phatMaxRemoved(card)} net damage`,
  triggers: {
    discard_phase_ends: ({ card }, e) => e.side === 'corp' && addCounters(card, 'power', 1),
    agenda_scored: phatTrigger,
    agenda_stolen: phatTrigger,
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    const n = Math.min(Number(answer.optionId), counters(card, 'power'));
    removeCounters(card, 'power', n);
    dealNetDamage(state, 1 + n);
  },
};

// Idiosyncresis: You can advance this asset. When your turn begins, you may trash this
// asset. If you do, for each hosted advancement counter, gain 3 credits and the Runner loses 2.
export const idiosyncresis: CardScript = {
  liveValue: (_state, card) => `Trash now: gain ${3 * card.advancementCounters}[credit], Runner loses ${2 * card.advancementCounters}[credit]`,
  triggers: {
    turn_begins: (ctx, e) => {
      const n = ctx.card.advancementCounters;
      if (e.side !== 'corp' || n === 0) return;
      askChoice(ctx, 'corp', `Idiosyncresis: trash it to gain ${3 * n} credits and make the Runner lose ${2 * n}?`, [
        { id: 'trash', label: `Trash it: gain ${3 * n}, Runner loses ${2 * n}` },
        { id: 'no', label: 'Keep it' },
      ], 'trash');
    },
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind !== 'effect_choice' || answer.optionId !== 'trash' || !serverOf(state, card)) return;
    const n = card.advancementCounters;
    trashInstalledCard(state, card);
    gainCredits(state, 'corp', 3 * n);
    state.runner.credits = Math.max(0, state.runner.credits - 2 * n);
    addLog(state, 'corp', `Corp trashed Idiosyncresis: gained ${3 * n} [credit], the Runner lost ${2 * n} [credit].`);
  },
};

// Public Access Plaza: When your turn begins, gain 1 credit. Threat 2 -> When the Runner
// trashes this asset (while it is rezzed), give them 1 tag.
export const publicAccessPlaza: CardScript = {
  triggers: {
    turn_begins: ({ state }, e) => {
      if (e.side !== 'corp') return;
      gainCredits(state, 'corp', 1);
      addLog(state, 'corp', 'Corp gained 1 [credit] (Public Access Plaza).');
    },
    runner_trashed_corp_card: (ctx, e) => {
      if (isSelf(ctx, e.card) && e.wasRezzed && threatLevel(ctx.state) >= 2) giveTags(ctx.state, 1);
    },
  },
};

// Anthill Excavation Contract: When you rez this asset, load 8 credits onto it. When it is
// empty, trash it. When your turn begins, take 4 credits from this asset and draw 1 card.
export const anthill: CardScript = {
  trashWhenEmpty: true,
  triggers: {
    rezzed: (ctx, e) => isSelf(ctx, e.card) && loadCredits(ctx.state, ctx.card, 8),
    turn_begins: ({ state, card }, e) => {
      if (e.side !== 'corp') return;
      takeHostedCredits(state, card, 4);
      drawForEffect(state, 'corp', 1, 'Anthill Excavation Contract');
    },
  },
};

// Plutus: As an additional cost to rez this asset, forfeit 1 agenda or reveal and trash 3
// cards from HQ. When your turn begins, you may play 1 transaction operation from Archives.
// After it resolves, remove it from the game.
const plutusOperations = (state: GameState) =>
  archivesCards(state).filter(c => type(c) === 'operation' && /transaction/i.test(keywords(c)) && !safePlayBlockerFrom(state, c));

export const plutus: CardScript = {
  rezBlocker: (state, card, cost) => {
    if (availableCredits(state, 'corp', { kind: 'rez', card }) < cost) return 'Not enough credits to rez';
    return forfeitable(state).length > 0 || state.corp.hq.length >= 3 ? null : 'Needs an agenda to forfeit or 3 cards in HQ';
  },
  payRez: (ctx, cost) => {
    const { state } = ctx;
    askChoice(ctx, 'corp', 'Plutus: forfeit 1 agenda or trash 3 cards from HQ to rez it.', [
      ...forfeitable(state).map(a => ({ id: a.instanceId, label: `Forfeit ${cardDef(a).title}` })),
      ...(state.corp.hq.length >= 3 ? [{ id: 'hq', label: 'Reveal and trash 3 cards from HQ' }] : []),
    ], 'rez_cost', { cost });
  },
  triggers: {
    turn_begins: (ctx, e) => {
      const ops = plutusOperations(ctx.state);
      if (e.side !== 'corp' || ops.length === 0) return;
      askCards(ctx, 'corp', 'Plutus: you may play 1 transaction operation from Archives (then remove it from the game).', ids(ops), 0, 1, 'play');
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state, card } = ctx;
    const cost = Number(source.data?.cost ?? 0);
    if (source.step === 'rez_cost' && answer.kind === 'effect_choice') {
      if (answer.optionId === 'hq') {
        askCards(ctx, 'corp', 'Plutus: reveal and trash 3 cards from HQ.', ids(state.corp.hq), 3, 3, 'rez_trash', { cost });
        return;
      }
      const agenda = forfeitable(state).find(a => a.instanceId === answer.optionId);
      if (!agenda) return;
      forfeitAgenda(state, agenda);
      spendCredits(state, 'corp', cost, { kind: 'rez', card });
      completeRez(state, card);
    } else if (source.step === 'rez_trash' && answer.kind === 'effect_cards') {
      const trashed = corpTrashFromHQ(state, answer.cardInstanceIds, true);
      addLog(state, 'corp', `Corp revealed and trashed ${trashed.map(c => cardDef(c).title).join(', ')} (Plutus).`);
      spendCredits(state, 'corp', cost, { kind: 'rez', card });
      completeRez(state, card);
    } else if (source.step === 'play' && answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) {
      const op = archivesCards(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!op) return;
      const zone = state.corp.archives.faceUp.includes(op) ? state.corp.archives.faceUp : state.corp.archives.faceDown;
      playCardFrom(state, 'corp', op, zone, { fromHand: false, removeAfter: true });
    }
  },
};

// --- Ice ----------------------------------------------------------------------

export const elevationCorpAssetsScripts: Record<string, CardScript> = {
  '35039': humanoidResources,
  '35040': ottoCampaign,
  '35050': byte,
  '35051': phat,
  '35061': idiosyncresis,
  '35062': publicAccessPlaza,
  '35072': anthill,
  '35073': plutus,
};
