import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { nextInt, shuffleInPlace } from '../../../rng';
import { shuffleRD } from '../../../engine/rdKnowledge';
import { addLog } from '../../../engine/log';
import { findInstalledCorpCard, removeCard, revealInHand } from '../../../engine/helpers';
import { playBlocker, playCardFrom } from '../../../engine/actions/play';
import { dealNetDamage, giveTags, installedRunnerCards } from '../../../engine/damage';
import {
  availableCredits,
  counters,
  drawForEffect,
  gainFromCard,
  removeTags,
  spendCredits,
  threatLevel,
  turnFlag,
  TurnFlag,
} from '../../../engine/cardEffects';
import { CardScript, EffectContext } from '../../types';
import { advanceableInstalled, installCorpChoice, takeFromRD } from '../../effects';
import { cards, cardsQuestion, choice, choiceQuestion, InstallData, prompts } from '../../steps';
import { archivesCards, archivesToHQ, faceUpTypes, hasKeyword, ids, installable, installedCorpCards, placeAdvancement, title, type, yesNo } from './helpers';

/** "Play only if the Runner stole or trashed a Corp card during their last turn." */
const stoleOrTrashedLastTurn = (state: GameState) =>
  state.runnerLastTurnStoleOrTrashed ? null : 'The Runner did not steal or trash a Corp card during their last turn';

// Greasing the Palm: Gain 5 credits. You may install 1 card from HQ. You may remove 1 tag to
// place 1 advancement counter on that card.
const greasingFlow = prompts({
  pick: cards((ctx, a) => {
    if (a.ids[0]) greasingFlow.corpInstall(ctx, a.ids[0], 'server');
  }),
  server: choice<InstallData>((ctx, a, data, source) => {
    const { state } = ctx;
    const serverId = installCorpChoice(state, source, a.raw);
    const cardId = data.cardId;
    if (!serverId || state.runner.tags === 0 || !findInstalledCorpCard(state, cardId)) return;
    greasingFlow.ask(ctx, 'tag', choiceQuestion('corp', 'Greasing the Palm: remove 1 tag to place 1 advancement counter on the installed card?', yesNo('Remove 1 tag')), { cardId });
  }),
  tag: choice<{ cardId: string }>(({ state }, a, data) => {
    if (a.optionId !== 'yes' || state.runner.tags === 0) return;
    removeTags(state, 1);
    placeAdvancement(state, data.cardId, 1, 'Greasing the Palm');
  }),
});

export const greasingThePalm: CardScript = {
  onPlay: ctx => {
    const { state } = ctx;
    gainFromCard(state, 'corp', 5, ctx.card);
    addLog(state, 'corp', 'Corp gained 5 [credit] (Greasing the Palm).');
    const cards = installable(state, state.corp.hq);
    if (cards.length > 0) greasingFlow.ask(ctx, 'pick', cardsQuestion('corp', 'Greasing the Palm: you may install 1 card from HQ.', ids(cards), 0, 1));
  },
  ...greasingFlow.script,
};

// Mindscaping: Resolve 1 of the following: Gain 4 credits and draw 2 cards. Add 1 card from HQ
// to the top of R&D. / Do X net damage. X is equal to the number of tags the Runner has, up to 3.
const mindscapingFlow = prompts({
  mode: choice((ctx, a) => {
    const { state } = ctx;
    if (a.optionId !== 'gain') return void dealNetDamage(state, Math.min(3, state.runner.tags));
    gainFromCard(state, 'corp', 4, ctx.card);
    drawForEffect(state, 'corp', 2, 'Mindscaping');
    addLog(state, 'corp', 'Corp gained 4 [credit] (Mindscaping).');
    if (state.corp.hq.length > 0) mindscapingFlow.ask(ctx, 'top', cardsQuestion('corp', 'Mindscaping: add 1 card from HQ to the top of R&D.', ids(state.corp.hq), 1, 1));
  }),
  top: cards(({ state }, a) => {
    const card = state.corp.hq.find(c => c.instanceId === a.ids[0]);
    if (!card) return;
    removeCard(state.corp.hq, card);
    state.corp.rd.unshift(card);
    addLog(state, 'corp', 'Corp added 1 card from HQ to the top of R&D (Mindscaping).');
  }),
});

export const mindscaping: CardScript = {
  onPlay: ctx =>
    mindscapingFlow.ask(
      ctx,
      'mode',
      choiceQuestion('corp', 'Mindscaping: choose one.', [
        { id: 'gain', label: 'Gain 4 [credit], draw 2, put 1 card from HQ on top of R&D' },
        { id: 'damage', label: `Do ${Math.min(3, ctx.state.runner.tags)} net damage` },
      ]),
    ),
  ...mindscapingFlow.script,
};

// Oppo Research (Terminal - Gray Ops): Play only if the Runner stole or trashed a Corp card during
// their last turn. After you resolve this operation, your action phase ends. Give the Runner 2 tags.
// Threat 3 -> You may pay 5 credits to give the Runner 2 tags.
const oppoFlow = prompts({
  more: choice(({ state }, a) => {
    if (a.optionId !== 'yes' || availableCredits(state, 'corp') < 5) return;
    spendCredits(state, 'corp', 5);
    giveTags(state, 2);
  }),
});

export const oppoResearch: CardScript = {
  terminal: true,
  canPlay: ({ state }) => stoleOrTrashedLastTurn(state),
  onPlay: ctx => {
    giveTags(ctx.state, 2);
    if (threatLevel(ctx.state) >= 3 && availableCredits(ctx.state, 'corp') >= 5) {
      oppoFlow.ask(ctx, 'more', choiceQuestion('corp', 'Oppo Research: pay 5 [credit] to give the Runner 2 more tags?', yesNo('Pay 5 [credit]')));
    }
  },
  ...oppoFlow.script,
};

// Your Digital Life (Transaction): Gain 1 credit for each card in HQ.
export const yourDigitalLife: CardScript = {
  liveValue: state => `${state.corp.hq.length - 1} [credit] (cards in HQ once it is played)`,
  onPlay: ({ state, card }) => {
    const n = state.corp.hq.length;
    gainFromCard(state, 'corp', n, card);
    addLog(state, 'corp', `Corp gained ${n} [credit] (Your Digital Life).`);
  },
};

// Armed Asset Protection (Transaction): Gain 3 credits. Gain 1 credit for each card type among
// faceup cards in Archives. If any of those cards are agendas, gain another 2 credits.
const aapGain = (state: GameState, self: CardInstance) => {
  const types = faceUpTypes(state, self);
  return 3 + types.size + (types.has('agenda') ? 2 : 0);
};

export const armedAssetProtection: CardScript = {
  liveValue: (state, card) => `${aapGain(state, card)} [credit]`,
  onPlay: ({ state, card }) => {
    // While it resolves the operation itself is not yet in Archives (rules 8.6.4)
    const n = aapGain(state, card);
    gainFromCard(state, 'corp', n, card);
    addLog(state, 'corp', `Corp gained ${n} [credit] (Armed Asset Protection).`);
  },
};

// Pivot (Double): As an additional cost to play this operation, spend [click]. Search R&D for 1
// operation or agenda and reveal it. Add that card to HQ. Threat 3 -> You may play or install 1
// card from HQ.
const playableFromHQ = (state: GameState, card: CardInstance) => {
  if (type(card) !== 'operation') return installable(state, [card]).length > 0;
  try {
    return !playBlocker(state, 'corp', card, true);
  } catch {
    return false;
  }
};

const pivotFlow = prompts({
  search: cards((ctx, a) => {
    const { state } = ctx;
    const card = a.ids.length ? takeFromRD(state, a.ids[0]) : undefined;
    if (!card) shuffleRD(state);
    else {
      state.corp.hq.push(card);
      revealInHand(state, 'corp', [card]);
    }
    const options = state.corp.hq.filter(c => playableFromHQ(state, c));
    // Asked even with nothing playable when the Corp's stops are on ALL (4.3.2, see askEvenIfNone)
    if (threatLevel(state) >= 3)
      pivotFlow.evenIfNone(
        ctx,
        'corp',
        options.length > 0,
        () => pivotFlow.ask(ctx, 'use', cardsQuestion('corp', 'Pivot: you may play or install 1 card from HQ.', ids(options), 0, 1)),
        'Pivot: no card in HQ you can play or install.',
      );
  }),
  use: cards((ctx, a) => {
    const { state } = ctx;
    const card = state.corp.hq.find(c => c.instanceId === a.ids[0]);
    if (!card) return;
    if (type(card) === 'operation') playCardFrom(state, 'corp', card, state.corp.hq, { fromHand: true });
    else pivotFlow.corpInstall(ctx, card.instanceId, 'server');
  }),
  server: choice<InstallData>((ctx, a, _d, source) => void installCorpChoice(ctx.state, source, a.raw)),
});

export const pivot: CardScript = {
  extraClicks: 1,
  onPlay: ctx => {
    const cards = ctx.state.corp.rd.filter(c => type(c) === 'operation' || type(c) === 'agenda');
    // A search with criteria may fail to find even when a match exists (rules 8.7.2e); asked even with none, so no tell
    pivotFlow.ask(ctx, 'search', cardsQuestion('corp', 'Pivot: you may search R&D for 1 operation or agenda.', ids(cards), 0, 1));
  },
  ...pivotFlow.script,
};

// Active Policing (Terminal - Gray Ops): Play only if the Runner stole or trashed a Corp card
// during their last turn. After you resolve this operation, your action phase ends. You may install
// 1 card from HQ. The Runner gets -1 allotted [click] for their next turn. Threat 3 -> You may pay
// 2 credits. If you do, the Runner gets -1 allotted [click] for their next turn.
const fewerClicks = (state: GameState) => {
  state.runner.bonusClicksNextTurn = (state.runner.bonusClicksNextTurn ?? 0) - 1;
  addLog(state, 'corp', 'The Runner gets -1 allotted [click] for their next turn.');
};

const activePolicingFlow = prompts({
  pick: cards((ctx, a) => {
    const id = a.ids[0];
    if (id && activePolicingFlow.corpInstall(ctx, id, 'server')) return;
    fewerClicks(ctx.state);
    activePolicingThreat(ctx);
  }),
  server: choice<InstallData>((ctx, a, _d, source) => {
    installCorpChoice(ctx.state, source, a.raw);
    fewerClicks(ctx.state);
    activePolicingThreat(ctx);
  }),
  threat: choice(({ state }, a) => {
    if (a.optionId !== 'yes' || availableCredits(state, 'corp') < 2) return;
    spendCredits(state, 'corp', 2);
    fewerClicks(state);
  }),
});

const activePolicingThreat = (ctx: EffectContext) => {
  if (threatLevel(ctx.state) >= 3 && availableCredits(ctx.state, 'corp') >= 2) {
    activePolicingFlow.ask(ctx, 'threat', choiceQuestion('corp', 'Active Policing: pay 2 [credit] for the Runner to get another -1 allotted [click]?', yesNo('Pay 2 [credit]')));
  }
};

export const activePolicing: CardScript = {
  terminal: true,
  canPlay: ({ state }) => stoleOrTrashedLastTurn(state),
  onPlay: ctx => {
    const cards = installable(ctx.state, ctx.state.corp.hq);
    if (cards.length > 0) activePolicingFlow.ask(ctx, 'pick', cardsQuestion('corp', 'Active Policing: you may install 1 card from HQ.', ids(cards), 0, 1));
    else {
      fewerClicks(ctx.state);
      activePolicingThreat(ctx);
    }
  },
  ...activePolicingFlow.script,
};

// Corporate Hospitality (Double - Transaction): As an additional cost to play this operation,
// spend [click]. Gain 6 credits and draw 2 cards. Add 1 card from Archives to HQ.
const hospitalityFlow = prompts({
  archives: cards(({ state }, a) => archivesToHQ(state, a.ids[0], 'Corporate Hospitality')),
});

export const corporateHospitality: CardScript = {
  extraClicks: 1,
  onPlay: ctx => {
    const { state, card } = ctx;
    gainFromCard(state, 'corp', 6, card);
    addLog(state, 'corp', 'Corp gained 6 [credit] (Corporate Hospitality).');
    drawForEffect(state, 'corp', 2, 'Corporate Hospitality');
    const archives = archivesCards(state).filter(c => c.instanceId !== card.instanceId);
    if (archives.length > 0) hospitalityFlow.ask(ctx, 'archives', cardsQuestion('corp', 'Corporate Hospitality: add 1 card from Archives to HQ.', ids(archives), 1, 1));
  },
  ...hospitalityFlow.script,
};

// Bring Them Home (Terminal - Black Ops): Play only if the Runner stole or trashed a Corp card
// during their last turn. After you resolve this operation, your action phase ends. Reveal and add
// 2 cards at random from the grip to the top of the stack. Threat 3 -> You may pay 2 credits to
// reveal 1 card in the grip at random. The Runner shuffles it into the stack.
const randomGripCard = (state: GameState) => state.runner.grip[nextInt(state.rng, state.runner.grip.length)];

const bringThemHomeFlow = prompts({
  threat: choice(({ state }, a) => {
    if (a.optionId !== 'yes' || state.runner.grip.length === 0 || availableCredits(state, 'corp') < 2) return;
    spendCredits(state, 'corp', 2);
    const card = randomGripCard(state);
    removeCard(state.runner.grip, card);
    state.runner.stack.push(card);
    shuffleInPlace(state.rng, state.runner.stack);
    addLog(state, 'corp', `Corp revealed ${title(card)} from the grip; the Runner shuffled it into the stack (Bring Them Home).`, card.cardCode);
  }),
});

export const bringThemHome: CardScript = {
  terminal: true,
  canPlay: ({ state }) => stoleOrTrashedLastTurn(state),
  onPlay: ctx => {
    const { state } = ctx;
    for (let i = 0; i < 2 && state.runner.grip.length > 0; i++) {
      const card = randomGripCard(state);
      removeCard(state.runner.grip, card);
      state.runner.stack.unshift(card);
      addLog(state, 'corp', `Corp revealed ${title(card)} from the grip and added it to the top of the stack (Bring Them Home).`, card.cardCode);
    }
    if (threatLevel(state) >= 3 && state.runner.grip.length > 0 && availableCredits(state, 'corp') >= 2) {
      bringThemHomeFlow.ask(ctx, 'threat', choiceQuestion('corp', 'Bring Them Home: pay 2 [credit] to shuffle 1 random card from the grip into the stack?', yesNo('Pay 2 [credit]')));
    }
  },
  ...bringThemHomeFlow.script,
};

// Sudden Commandment (Mandate): Draw 2 cards. You may play 1 non-terminal operation from HQ.
// Threat 3 -> If this operation is the first mandate you played this turn, you may pay 3 credits
// to gain [click].
const suddenFlow = prompts({
  play: cards((ctx, a) => {
    const { state } = ctx;
    const op = state.corp.hq.find(c => c.instanceId === a.ids[0]);
    if (op) playCardFrom(state, 'corp', op, state.corp.hq, { fromHand: true });
    suddenThreat(ctx);
  }),
  click: choice(({ state }, a) => {
    if (a.optionId !== 'yes' || availableCredits(state, 'corp') < 3) return;
    spendCredits(state, 'corp', 3);
    state.corp.clicks += 1;
    addLog(state, 'corp', 'Corp paid 3 [credit] to gain [click] (Sudden Commandment).');
  }),
});

const suddenThreat = (ctx: EffectContext) => {
  const { state } = ctx;
  if (threatLevel(state) >= 3 && turnFlag(state, TurnFlag.mandatesPlayed) === 1 && turnFlag(state, `sudden-first:${ctx.card.instanceId}`) > 0 && availableCredits(state, 'corp') >= 3) {
    suddenFlow.ask(ctx, 'click', choiceQuestion('corp', 'Sudden Commandment: pay 3 [credit] to gain [click]?', yesNo('Pay 3 [credit]')));
  }
};

export const suddenCommandment: CardScript = {
  onPlay: ctx => {
    const { state, card } = ctx;
    if (turnFlag(state, TurnFlag.mandatesPlayed) === 1) state.turnFlags[`sudden-first:${card.instanceId}`] = 1;
    drawForEffect(state, 'corp', 2, 'Sudden Commandment');
    const ops = state.corp.hq.filter(c => type(c) === 'operation' && !hasKeyword(c, 'terminal') && playableFromHQ(state, c));
    // Asked even with no operation to play when the Corp's stops are on ALL (4.3.2, see askEvenIfNone); the one answer
    // goes on to the Threat question like a decline
    const asked = suddenFlow.evenIfNone(
      ctx,
      'corp',
      ops.length > 0,
      () => suddenFlow.ask(ctx, 'play', cardsQuestion('corp', 'Sudden Commandment: you may play 1 non-terminal operation from HQ.', ids(ops), 0, 1)),
      'Sudden Commandment: no non-terminal operation in HQ you can play.',
      'OK',
      { step: 'play' },
    );
    if (!asked) suddenThreat(ctx);
  },
  ...suddenFlow.script,
};

// Business As Usual (Gray Ops): Resolve 1 of the following: Place 1 advancement counter on each of
// up to 2 installed cards you can advance. / Remove all virus counters from 1 installed card.
// Threat 3 -> You may also resolve the other mode.
/** The mode still to resolve after this one ('' for none). */
type BauNext = { next: string };

const bauFlow = prompts({
  mode: choice((ctx, a) => {
    if (a.optionId === 'virus') bauVirus(ctx, '');
    else bauAdvance(ctx, a.optionId === 'both' ? 'virus' : '');
  }),
  advance: cards<BauNext>((ctx, a, data) => {
    for (const id of a.ids) placeAdvancement(ctx.state, id, 1, 'Business As Usual');
    bauNext(ctx, data.next);
  }),
  virus: cards<BauNext>((ctx, a, data) => {
    const { state } = ctx;
    const card = [...installedCorpCards(state), ...installedRunnerCards(state)].find(c => c.instanceId === a.ids[0]);
    if (card) {
      addLog(state, 'corp', `Corp removed ${counters(card, 'virus')} virus counter(s) from ${title(card)} (Business As Usual).`);
      card.tokens.virus = 0;
    }
    bauNext(ctx, data.next);
  }),
});

const bauAdvance = (ctx: EffectContext, next: string) => {
  const cards = advanceableInstalled(ctx.state);
  if (cards.length > 0)
    bauFlow.ask(ctx, 'advance', cardsQuestion('corp', 'Business As Usual: place 1 advancement counter on each of up to 2 installed cards you can advance.', ids(cards), 0, 2), { next });
  else bauNext(ctx, next);
};

const bauVirus = (ctx: EffectContext, next: string) => {
  const cards = [...installedCorpCards(ctx.state), ...installedRunnerCards(ctx.state)].filter(c => counters(c, 'virus') > 0);
  if (cards.length > 0) bauFlow.ask(ctx, 'virus', cardsQuestion('corp', 'Business As Usual: remove all virus counters from 1 installed card.', ids(cards), 1, 1), { next });
  else bauNext(ctx, next);
};

const bauNext = (ctx: EffectContext, next: string) => {
  if (next === 'virus') bauVirus(ctx, '');
  else if (next === 'advance') bauAdvance(ctx, '');
};

export const businessAsUsual: CardScript = {
  onPlay: ctx => {
    const both = threatLevel(ctx.state) >= 3;
    bauFlow.ask(
      ctx,
      'mode',
      choiceQuestion('corp', 'Business As Usual: choose a mode.', [
        { id: 'advance', label: 'Place advancement counters on up to 2 cards' },
        { id: 'virus', label: 'Remove all virus counters from 1 card' },
        ...(both ? [{ id: 'both', label: 'Both (threat 3)' }] : []),
      ]),
    );
  },
  ...bauFlow.script,
};

export const liberationCorpOperationsScripts: Record<string, CardScript> = {
  '34037': greasingThePalm,
  '34045': mindscaping,
  '34055': oppoResearch,
  '34056': yourDigitalLife,
  '34061': armedAssetProtection,
  '34062': pivot,
  '34102': activePolicing,
  '34103': corporateHospitality,
  '34112': bringThemHome,
  '34119': suddenCommandment,
  '34128': businessAsUsual,
};
