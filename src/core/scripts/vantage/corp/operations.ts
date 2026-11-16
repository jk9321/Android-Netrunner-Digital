import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { shuffleInPlace } from '../../../rng';
import { addLog } from '../../../engine/log';
import { checkAgendaVictory, findInstalledCorpCard, removeCard } from '../../../engine/helpers';
import { corpSeesRd, noteRdPrivate } from '../../../engine/rdKnowledge';
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
import { advanceableInstalled, corpInstallOptions, installCorpChoice } from '../../effects';
import { ArrangeData, cards, cardsQuestion, choice, choiceQuestion, InstallData, prompts } from '../../steps';
import { archivesCards, ids, keywords, title, type } from './helpers';

// Caveat Emptor (Transaction): Resolve 1 of the following: Gain 6 credits. The Runner gets -1
// allotted click for their next turn. / Gain 10 credits. The Runner gets +1 allotted click for their next turn.
const caveatFlow = prompts({
  mode: choice(({ state, card }, a) => {
    const six = a.optionId === 'six';
    gainFromCard(state, 'corp', six ? 6 : 10, card);
    state.runner.bonusClicksNextTurn = (state.runner.bonusClicksNextTurn ?? 0) + (six ? -1 : 1);
    addLog(state, 'corp', `Corp gained ${six ? 6 : 10} [credit]; the Runner gets ${six ? '-1' : '+1'} [click] next turn (Caveat Emptor).`);
  }),
});

export const caveatEmptor: CardScript = {
  onPlay: ctx =>
    caveatFlow.choice(ctx, 'mode', choiceQuestion('corp', 'Caveat Emptor: choose one.', [
      { id: 'six', label: 'Gain 6 [credit]; the Runner gets -1 [click] next turn' },
      { id: 'ten', label: 'Gain 10 [credit]; the Runner gets +1 [click] next turn' },
    ])),
  ...caveatFlow.script,
};

// realloc() (Double): As an additional cost to play this operation, spend click. Choose 2
// rezzed pieces of ice. For each chosen piece of ice, gain credits equal to its printed rez
// cost, then derez it.
const rezzedIce = (state: GameState) => installedIce(state).filter(c => c.isRezzed);

const reallocFlow = prompts({
  ice: cards(({ state, card }, a) => {
    for (const id of a.ids) {
      const ice = rezzedIce(state).find(c => c.instanceId === id);
      if (!ice) continue;
      gainFromCard(state, 'corp', cardDef(ice).cost ?? 0, card);
      ice.isRezzed = false;
      addLog(state, 'corp', `Corp gained ${cardDef(ice).cost ?? 0} [credit] and derezzed ${title(ice)} (realloc()).`);
    }
  }),
});

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
    reallocFlow.cards(ctx, 'ice', cardsQuestion('corp', 'realloc(): choose 2 rezzed pieces of ice to derez for their printed rez cost.', ids(ice), n, n));
  },
  ...reallocFlow.script,
};

// Retirement Plan (Double): As an additional cost to play this operation, spend click. Install
// 1 agenda, asset, or piece of ice from Archives.
const retirementTargets = (state: GameState) =>
  archivesCards(state).filter(c => ['agenda', 'asset', 'ice'].includes(type(c)) && corpInstallOptions(state, c).length > 0);

const retirementFlow = prompts({
  pick: cards((ctx, a) => void retirementFlow.corpInstall(ctx, a.ids[0], 'server')),
  server: choice<InstallData>((ctx, a, _d, source) => void installCorpChoice(ctx.state, source, a.raw)),
});

export const retirementPlan: CardScript = {
  extraClicks: 1,
  canPlay: ({ state }) => (retirementTargets(state).length > 0 ? null : 'No agenda, asset or ice in Archives to install'),
  onPlay: ctx => retirementFlow.cards(ctx, 'pick', cardsQuestion('corp', 'Retirement Plan: install 1 agenda, asset or piece of ice from Archives.', ids(retirementTargets(ctx.state)), 1, 1)),
  ...retirementFlow.script,
};

// Cultivate: Look at the top 5 cards of R&D. Trash 1 of those cards, add 1 of them to HQ, and
// arrange the rest in any order.
const cultivateFlow = prompts({
  trash: cards<{ ids: string[] }>((ctx, a, data) => {
    const { state } = ctx;
    const set = data.ids ?? [];
    const card = state.corp.rd.find(c => c.instanceId === a.ids[0]);
    if (card) {
      removeCard(state.corp.rd, card);
      state.corp.archives.faceDown.push(card);
      noteRdPrivate(state, set.length); // which of them is not declared (rules 8.3.3b)
    }
    const rest = set.filter(id => id !== a.ids[0] && state.corp.rd.some(c => c.instanceId === id));
    if (rest.length === 0) return;
    cultivateFlow.cards(ctx, 'hq', cardsQuestion('corp', 'Cultivate: add 1 of the cards to HQ.', rest, 1, 1), { ids: rest });
  }),
  hq: cards<{ ids: string[] }>((ctx, a, data) => {
    const { state } = ctx;
    const set = data.ids ?? [];
    const card = state.corp.rd.find(c => c.instanceId === a.ids[0]);
    if (card) {
      removeCard(state.corp.rd, card);
      state.corp.hq.push(card);
      noteRdPrivate(state, set.length);
    }
    addLog(state, 'corp', 'Corp trashed 1 card and added 1 card to HQ (Cultivate).');
    cultivateFlow.arrangeTop(ctx, 'arrange', set.filter(id => id !== a.ids[0]));
  }),
  arrange: cards<ArrangeData>((ctx, a, data) => cultivateFlow.arrangeNext(ctx, 'arrange', data, a.ids[0])),
});

export const cultivate: CardScript = {
  canPlay: ({ state }) => (state.corp.rd.length > 0 ? null : 'R&D is empty'),
  onPlay: ctx => {
    corpSeesRd(ctx.state, ctx.state.corp.rd.slice(0, 5)); // the Corp looks at them (8.3.3b)
    cultivateFlow.cards(ctx, 'trash', cardsQuestion('corp', 'Cultivate: trash 1 of the top 5 cards of R&D.', ids(ctx.state.corp.rd.slice(0, 5)), 1, 1), { ids: ids(ctx.state.corp.rd.slice(0, 5)) });
  },
  ...cultivateFlow.script,
};

// Unleash (Gray Ops): As an additional cost to play this operation, remove 1 tag. Rez 1
// installed piece of ice, ignoring all costs. You may resolve 1 subroutine on that ice.
const unrezzedIce = (state: GameState) => installedIce(state).filter(c => !c.isRezzed);

const unleashFlow = prompts({
  rez: cards((ctx, a) => {
    const { state } = ctx;
    const ice = unrezzedIce(state).find(c => c.instanceId === a.ids[0]);
    if (!ice) return;
    addLog(state, 'corp', `Corp rezzed ${title(ice)} (Unleash).`, undefined, 'rez');
    completeRez(state, ice);
    const subs = iceSubroutines(state, ice);
    if (subs.length === 0) return;
    unleashFlow.choice(ctx, 'sub', choiceQuestion('corp', `Unleash: you may resolve 1 subroutine on ${title(ice)}.`, [
      ...subs.map((s, i) => ({ id: String(i), label: s.label })),
      { id: 'none', label: 'None' },
    ]), { iceId: ice.instanceId });
  }),
  sub: choice<{ iceId: string }>(({ state }, a, data) => {
    if (a.optionId === 'none') return;
    const ice = findInstalledCorpCard(state, String(data.iceId))?.card;
    const sub = ice ? iceSubroutines(state, ice)[Number(a.optionId)] : undefined;
    if (!ice || !sub) return;
    addLog(state, 'corp', `Unleash resolves ${title(ice)}'s subroutine: ${sub.label}`);
    sub.resolve({ state, card: ice, side: 'corp' });
  }),
});

export const unleash: CardScript = {
  canPlay: ({ state }) => {
    if (state.runner.tags === 0) return 'The Runner has no tag to remove';
    return unrezzedIce(state).length > 0 ? null : 'No unrezzed ice';
  },
  onPlay: ctx => {
    removeTags(ctx.state, 1);
    addLog(ctx.state, 'corp', 'Corp removed 1 tag (Unleash).');
    unleashFlow.cards(ctx, 'rez', cardsQuestion('corp', 'Unleash: rez 1 installed piece of ice, ignoring all costs.', ids(unrezzedIce(ctx.state)), 1, 1));
  },
  ...unleashFlow.script,
};

// Flood the Market (Double): As an additional cost to play this operation, spend click. Choose
// 1 installed card you can advance. Place 1 advancement counter on that card for each remote
// server that has a card in its root and is protected by ice.
const floodCount = (state: GameState) => Object.values(state.corp.servers).filter(s => s.isRemote && s.root.length > 0 && s.ice.length > 0).length;

const floodFlow = prompts({
  target: cards(({ state }, a) => {
    const card = advanceableInstalled(state).find(c => c.instanceId === a.ids[0]);
    if (!card) return;
    const n = floodCount(state);
    card.advancementCounters += n;
    addLog(state, 'corp', `Corp placed ${n} advancement counter(s) (Flood the Market).`);
  }),
});

export const floodTheMarket: CardScript = {
  extraClicks: 1,
  canPlay: ({ state }) => (advanceableInstalled(state).length > 0 ? null : 'No installed card you can advance'),
  liveValue: state => `${floodCount(state)} advancement counter(s) now`,
  onPlay: ctx => floodFlow.cards(ctx, 'target', cardsQuestion('corp', `Flood the Market: place ${floodCount(ctx.state)} advancement counter(s) on 1 card you can advance.`, ids(advanceableInstalled(ctx.state)), 1, 1)),
  ...floodFlow.script,
};

// Scapegoat (Gray Ops): Resolve 1 of the following of the Runner's choice: Remove 2 bad
// publicity. / Choose 1 installed Runner card. The Runner shuffles it into the stack.
const scapegoatFlow = prompts({
  mode: choice((ctx, a) => {
    const { state } = ctx;
    if (a.optionId === 'bp') {
      removeBadPublicity(state, 2);
      return;
    }
    const cards = installedRunnerCards(state);
    if (cards.length > 0) scapegoatFlow.cards(ctx, 'card', cardsQuestion('corp', 'Scapegoat: choose 1 installed Runner card to shuffle into the stack.', ids(cards), 1, 1));
  }),
  card: cards(({ state }, a) => {
    const card = installedRunnerCards(state).find(c => c.instanceId === a.ids[0]);
    if (!card) return;
    uninstallRunnerCard(state, card, 'stack');
    shuffleInPlace(state.rng, state.runner.stack);
    addLog(state, 'corp', `The Runner shuffled ${title(card)} into the stack (Scapegoat).`);
  }),
});

export const scapegoat: CardScript = {
  onPlay: ctx =>
    scapegoatFlow.choice(ctx, 'mode', choiceQuestion('runner', 'Scapegoat: choose what the Corp gets.', [
      { id: 'bp', label: 'The Corp removes 2 bad publicity' },
      { id: 'shuffle', label: 'The Corp chooses 1 installed Runner card to shuffle into the stack' },
    ])),
  ...scapegoatFlow.script,
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

const reanimationFlow = prompts({
  ice: cards((ctx, a) => {
    const { state } = ctx;
    const ice = archivesCards(state).find(c => c.instanceId === a.ids[0]);
    if (!ice) return;
    const options = reanimationServers(state, ice).map(id => ({
      id: id ?? 'new',
      label: `${id ? state.corp.servers[id].name : 'New remote server'} (${reanimationTotal(state, ice, id)}[credit])`,
    }));
    reanimationFlow.choice(ctx, 'server', choiceQuestion('corp', `Reanimation Protocol: install ${title(ice)} where?`, options), { cardId: ice.instanceId });
  }),
  server: choice<{ cardId: string }>(({ state }, a, data) => {
    const ice = archivesCards(state).find(c => c.instanceId === data.cardId);
    if (!ice) return;
    const serverId = a.optionId === 'new' ? null : a.optionId;
    const total = reanimationTotal(state, ice, serverId);
    if (total > state.corp.credits) return;
    const zone = state.corp.archives.faceUp.includes(ice) ? state.corp.archives.faceUp : state.corp.archives.faceDown;
    installCorpCardFrom(state, ice, zone, serverId, true);
    state.corp.credits -= total;
    addLog(state, 'corp', `Corp installed and rezzed ${title(ice)} for ${total} [credit] (Reanimation Protocol).`, undefined, 'rez');
    rezForFree(state, ice);
    if (!/\bliability\b/i.test(keywords(ice))) takeBadPublicity(state, 1);
  }),
});

export const reanimationProtocol: CardScript = {
  canPlay: ({ state }) => (archivesCards(state).some(c => type(c) === 'ice') ? null : 'No ice in Archives'),
  onPlay: ctx => {
    const targets = reanimationTargets(ctx.state);
    if (targets.length > 0) reanimationFlow.cards(ctx, 'ice', cardsQuestion('corp', 'Reanimation Protocol: install and rez 1 piece of ice from Archives, paying 10 credits less.', ids(targets), 1, 1));
  },
  ...reanimationFlow.script,
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
