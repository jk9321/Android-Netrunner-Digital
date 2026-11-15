import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { shuffleInPlace } from '../../../rng';
import { addLog } from '../../../engine/log';
import { checkAgendaVictory, findInstalledCorpCard, removeCard } from '../../../engine/helpers';
import { noteRdPrivate } from '../../../engine/rdKnowledge';
import { completeRez, rezForFree } from '../../../engine/actions/corp';
import { installCorpCardFrom } from '../../../engine/actions/install';
import { installedRunnerCards, uninstallRunnerCard } from '../../../engine/damage';
import { iceSubroutines } from '../../../engine/ice';
import {
  gainFromCard,
  installedIce,
  removeBadPublicity,
  removeTags,
  rezCost,
  takeBadPublicity,
  turnFlag,
  TurnFlag,
} from '../../../engine/cardEffects';
import { corpInstallCost } from '../../../engine/actions/install';
import { CardScript } from '../../types';
import {
  advanceableInstalled,
  arrangeNext,
  arrangeTop,
  askCards,
  askChoice,
  askCorpInstall,
  corpInstallOptions,
  installCorpChoice,
} from '../../effects';
import { archivesCards, ids, keywords, title, type } from './helpers';

// Caveat Emptor (Transaction): Resolve 1 of the following: Gain 6 credits. The Runner gets -1
// allotted click for their next turn. / Gain 10 credits. The Runner gets +1 allotted click for their next turn.
export const caveatEmptor: CardScript = {
  onPlay: ctx =>
    askChoice(ctx, 'corp', 'Caveat Emptor: choose one.', [
      { id: 'six', label: 'Gain 6 [credit]; the Runner gets -1 [click] next turn' },
      { id: 'ten', label: 'Gain 10 [credit]; the Runner gets +1 [click] next turn' },
    ], 'mode'),
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    const six = answer.optionId === 'six';
    gainFromCard(state, 'corp', six ? 6 : 10, card);
    state.runner.bonusClicksNextTurn = (state.runner.bonusClicksNextTurn ?? 0) + (six ? -1 : 1);
    addLog(state, 'corp', `Corp gained ${six ? 6 : 10} [credit]; the Runner gets ${six ? '-1' : '+1'} [click] next turn (Caveat Emptor).`);
  },
};

// realloc() (Double): As an additional cost to play this operation, spend click. Choose 2
// rezzed pieces of ice. For each chosen piece of ice, gain credits equal to its printed rez
// cost, then derez it.
const rezzedIce = (state: GameState) => installedIce(state).filter(c => c.isRezzed);

export const realloc: CardScript = {
  extraClicks: 1,
  canPlay: ({ state }) => (rezzedIce(state).length > 0 ? null : 'No rezzed ice'),
  liveValue: state => {
    const best = rezzedIce(state).map(c => cardDef(c).cost ?? 0).sort((a, b) => b - a);
    return `Up to ${(best[0] ?? 0) + (best[1] ?? 0)}[credit] now`;
  },
  onPlay: ctx => {
    const ice = rezzedIce(ctx.state);
    const n = Math.min(2, ice.length);
    askCards(ctx, 'corp', 'realloc(): choose 2 rezzed pieces of ice to derez for their printed rez cost.', ids(ice), n, n, 'ice');
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind !== 'effect_cards') return;
    for (const id of answer.cardInstanceIds) {
      const ice = rezzedIce(state).find(c => c.instanceId === id);
      if (!ice) continue;
      gainFromCard(state, 'corp', cardDef(ice).cost ?? 0, card);
      ice.isRezzed = false;
      addLog(state, 'corp', `Corp gained ${cardDef(ice).cost ?? 0} [credit] and derezzed ${title(ice)} (realloc()).`);
    }
  },
};

// Retirement Plan (Double): As an additional cost to play this operation, spend click. Install
// 1 agenda, asset, or piece of ice from Archives.
const retirementTargets = (state: GameState) =>
  archivesCards(state).filter(c => ['agenda', 'asset', 'ice'].includes(type(c)) && corpInstallOptions(state, c).length > 0);

export const retirementPlan: CardScript = {
  extraClicks: 1,
  canPlay: ({ state }) => (retirementTargets(state).length > 0 ? null : 'No agenda, asset or ice in Archives to install'),
  onPlay: ctx => askCards(ctx, 'corp', 'Retirement Plan: install 1 agenda, asset or piece of ice from Archives.', ids(retirementTargets(ctx.state)), 1, 1, 'pick'),
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'pick' && answer.kind === 'effect_cards') askCorpInstall(ctx, answer.cardInstanceIds[0], 'server');
    else if (source.step === 'server') installCorpChoice(ctx.state, source, answer);
  },
};

// Cultivate: Look at the top 5 cards of R&D. Trash 1 of those cards, add 1 of them to HQ, and
// arrange the rest in any order.
export const cultivate: CardScript = {
  canPlay: ({ state }) => (state.corp.rd.length > 0 ? null : 'R&D is empty'),
  onPlay: ctx => askCards(ctx, 'corp', 'Cultivate: trash 1 of the top 5 cards of R&D.', ids(ctx.state.corp.rd.slice(0, 5)), 1, 1, 'trash', { ids: ids(ctx.state.corp.rd.slice(0, 5)) }),
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (answer.kind !== 'effect_cards') return;
    const set = (source.data?.ids as string[]) ?? [];
    if (source.step === 'trash') {
      const card = state.corp.rd.find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (card) {
        removeCard(state.corp.rd, card);
        state.corp.archives.faceDown.push(card);
        noteRdPrivate(state, set.length); // which of them is not declared (rules 8.3.3b)
      }
      const rest = set.filter(id => id !== answer.cardInstanceIds[0] && state.corp.rd.some(c => c.instanceId === id));
      if (rest.length === 0) return;
      askCards(ctx, 'corp', 'Cultivate: add 1 of the cards to HQ.', rest, 1, 1, 'hq', { ids: rest });
    } else if (source.step === 'hq') {
      const card = state.corp.rd.find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (card) {
        removeCard(state.corp.rd, card);
        state.corp.hq.push(card);
        noteRdPrivate(state, set.length);
      }
      addLog(state, 'corp', 'Corp trashed 1 card and added 1 card to HQ (Cultivate).');
      arrangeTop(ctx, set.filter(id => id !== answer.cardInstanceIds[0]), 'arrange');
    } else if (source.step === 'arrange') {
      arrangeNext(ctx, source.data, answer.cardInstanceIds[0], 'arrange');
    }
  },
};

// Unleash (Gray Ops): As an additional cost to play this operation, remove 1 tag. Rez 1
// installed piece of ice, ignoring all costs. You may resolve 1 subroutine on that ice.
const unrezzedIce = (state: GameState) => installedIce(state).filter(c => !c.isRezzed);

export const unleash: CardScript = {
  canPlay: ({ state }) => {
    if (state.runner.tags === 0) return 'The Runner has no tag to remove';
    return unrezzedIce(state).length > 0 ? null : 'No unrezzed ice';
  },
  onPlay: ctx => {
    removeTags(ctx.state, 1);
    addLog(ctx.state, 'corp', 'Corp removed 1 tag (Unleash).');
    askCards(ctx, 'corp', 'Unleash: rez 1 installed piece of ice, ignoring all costs.', ids(unrezzedIce(ctx.state)), 1, 1, 'rez');
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'rez' && answer.kind === 'effect_cards') {
      const ice = unrezzedIce(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!ice) return;
      addLog(state, 'corp', `Corp rezzed ${title(ice)} (Unleash).`, undefined, 'rez');
      completeRez(state, ice);
      const subs = iceSubroutines(state, ice);
      if (subs.length === 0) return;
      askChoice(ctx, 'corp', `Unleash: you may resolve 1 subroutine on ${title(ice)}.`, [
        ...subs.map((s, i) => ({ id: String(i), label: s.label })),
        { id: 'none', label: 'None' },
      ], 'sub', { iceId: ice.instanceId });
    } else if (source.step === 'sub' && answer.kind === 'effect_choice' && answer.optionId !== 'none') {
      const ice = findInstalledCorpCard(state, String(source.data?.iceId))?.card;
      const sub = ice ? iceSubroutines(state, ice)[Number(answer.optionId)] : undefined;
      if (!ice || !sub) return;
      addLog(state, 'corp', `Unleash resolves ${title(ice)}'s subroutine: ${sub.label}`);
      sub.resolve({ state, card: ice, side: 'corp' });
    }
  },
};

// Flood the Market (Double): As an additional cost to play this operation, spend click. Choose
// 1 installed card you can advance. Place 1 advancement counter on that card for each remote
// server that has a card in its root and is protected by ice.
const floodCount = (state: GameState) => Object.values(state.corp.servers).filter(s => s.isRemote && s.root.length > 0 && s.ice.length > 0).length;

export const floodTheMarket: CardScript = {
  extraClicks: 1,
  canPlay: ({ state }) => (advanceableInstalled(state).length > 0 ? null : 'No installed card you can advance'),
  liveValue: state => `${floodCount(state)} advancement counter(s) now`,
  onPlay: ctx => askCards(ctx, 'corp', `Flood the Market: place ${floodCount(ctx.state)} advancement counter(s) on 1 card you can advance.`, ids(advanceableInstalled(ctx.state)), 1, 1, 'target'),
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards') return;
    const card = advanceableInstalled(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
    if (!card) return;
    const n = floodCount(state);
    card.advancementCounters += n;
    addLog(state, 'corp', `Corp placed ${n} advancement counter(s) (Flood the Market).`);
  },
};

// Scapegoat (Gray Ops): Resolve 1 of the following of the Runner's choice: Remove 2 bad
// publicity. / Choose 1 installed Runner card. The Runner shuffles it into the stack.
export const scapegoat: CardScript = {
  onPlay: ctx =>
    askChoice(ctx, 'runner', 'Scapegoat: choose what the Corp gets.', [
      { id: 'bp', label: 'The Corp removes 2 bad publicity' },
      { id: 'shuffle', label: 'The Corp chooses 1 installed Runner card to shuffle into the stack' },
    ], 'mode'),
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'mode' && answer.kind === 'effect_choice') {
      if (answer.optionId === 'bp') {
        removeBadPublicity(state, 2);
        return;
      }
      const cards = installedRunnerCards(state);
      if (cards.length > 0) askCards(ctx, 'corp', 'Scapegoat: choose 1 installed Runner card to shuffle into the stack.', ids(cards), 1, 1, 'card');
    } else if (source.step === 'card' && answer.kind === 'effect_cards') {
      const card = installedRunnerCards(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!card) return;
      uninstallRunnerCard(state, card, 'stack');
      shuffleInPlace(state.rng, state.runner.stack);
      addLog(state, 'corp', `The Runner shuffled ${title(card)} into the stack (Scapegoat).`);
    }
  },
};

// Myōshu: Play only if you scored an agenda this turn that you did not install this turn. Add
// this operation to your score area as an agenda worth 2 agenda points.
export const myoshu: CardScript = {
  canPlay: ({ state }) => (turnFlag(state, TurnFlag.scoredNotInstalledThisTurn) > 0 ? null : 'Play only if you scored an agenda this turn that you did not install this turn'),
  onPlay: ({ state, card }) => {
    if (!removeCard(state.corp.archives.faceUp, card)) return;
    card.asAgendaPoints = 2;
    state.corp.scoreArea.push(card);
    state.corp.score += 2;
    addLog(state, 'corp', `Myōshu was added to the Corp's score area as an agenda worth 2 points. Total: ${state.corp.score}`);
    checkAgendaVictory(state);
  },
};

// Reanimation Protocol (Liability): Install and rez 1 piece of ice from Archives, paying a
// total of 10 credits less. If you rezzed a piece of non-liability ice this way, take 1 bad publicity.
const reanimationTotal = (state: GameState, ice: CardInstance, serverId: string | null) =>
  Math.max(0, corpInstallCost(state, ice, serverId, false) + rezCost(state, ice) - 10);

const reanimationServers = (state: GameState, ice: CardInstance) =>
  [null, ...Object.keys(state.corp.servers)].filter(id => reanimationTotal(state, ice, id) <= state.corp.credits);

const reanimationTargets = (state: GameState) => archivesCards(state).filter(c => type(c) === 'ice' && reanimationServers(state, c).length > 0);

export const reanimationProtocol: CardScript = {
  canPlay: ({ state }) => (archivesCards(state).some(c => type(c) === 'ice') ? null : 'No ice in Archives'),
  onPlay: ctx => {
    const targets = reanimationTargets(ctx.state);
    if (targets.length > 0) askCards(ctx, 'corp', 'Reanimation Protocol: install and rez 1 piece of ice from Archives, paying 10 credits less.', ids(targets), 1, 1, 'ice');
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'ice' && answer.kind === 'effect_cards') {
      const ice = archivesCards(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!ice) return;
      const options = reanimationServers(state, ice).map(id => ({
        id: id ?? 'new',
        label: `${id ? state.corp.servers[id].name : 'New remote server'} (${reanimationTotal(state, ice, id)}[credit])`,
      }));
      askChoice(ctx, 'corp', `Reanimation Protocol: install ${title(ice)} where?`, options, 'server', { cardId: ice.instanceId });
    } else if (source.step === 'server' && answer.kind === 'effect_choice') {
      const ice = archivesCards(state).find(c => c.instanceId === source.data?.cardId);
      if (!ice) return;
      const serverId = answer.optionId === 'new' ? null : answer.optionId;
      const total = reanimationTotal(state, ice, serverId);
      if (total > state.corp.credits) return;
      const zone = state.corp.archives.faceUp.includes(ice) ? state.corp.archives.faceUp : state.corp.archives.faceDown;
      installCorpCardFrom(state, ice, zone, serverId, true);
      state.corp.credits -= total;
      addLog(state, 'corp', `Corp installed and rezzed ${title(ice)} for ${total} [credit] (Reanimation Protocol).`, undefined, 'rez');
      rezForFree(state, ice);
      if (!/\bliability\b/i.test(keywords(ice))) takeBadPublicity(state, 1);
    }
  },
};

// Vulture Fund (Transaction - Liability): Gain 14 credits and take 1 bad publicity.
export const vultureFund: CardScript = {
  onPlay: ({ state, card }) => {
    gainFromCard(state, 'corp', 14, card);
    addLog(state, 'corp', 'Corp gained 14 [credit] (Vulture Fund).');
    takeBadPublicity(state, 1);
  },
};

// --- Upgrades ---------------------------------------------------------------

export const vantageCorpOperationsScripts: Record<string, CardScript> = {
  '36032': caveatEmptor,
  '36033': realloc,
  '36034': retirementPlan,
  '36043': cultivate,
  '36044': unleash,
  '36053': floodTheMarket,
  '36054': scapegoat,
  '36061': myoshu,
  '36062': reanimationProtocol,
  '36063': vultureFund,
};
