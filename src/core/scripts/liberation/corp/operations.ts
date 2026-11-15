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
import { askCards, askChoice, askEvenIfNone, askCorpInstall, installCorpChoice, takeFromRD } from '../../effects';
import { archivesCards, archivesToHQ, bauAdvance, bauNext, bauVirus, faceUpTypes, hasKeyword, ids, installable, installedCorpCards, picked, placeAdvancement, said, title, type, yesNo } from './helpers';

/** "Play only if the Runner stole or trashed a Corp card during their last turn." */
const stoleOrTrashedLastTurn = (state: GameState) =>
  state.runnerLastTurnStoleOrTrashed ? null : 'The Runner did not steal or trash a Corp card during their last turn';

// Greasing the Palm: Gain 5 credits. You may install 1 card from HQ. You may remove 1 tag to
// place 1 advancement counter on that card.
export const greasingThePalm: CardScript = {
  onPlay: ctx => {
    const { state } = ctx;
    gainFromCard(state, 'corp', 5, ctx.card);
    addLog(state, 'corp', 'Corp gained 5 [credit] (Greasing the Palm).');
    const cards = installable(state, state.corp.hq);
    if (cards.length > 0) askCards(ctx, 'corp', 'Greasing the Palm: you may install 1 card from HQ.', ids(cards), 0, 1, 'pick');
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'pick') {
      const id = picked(answer)[0];
      if (id) askCorpInstall(ctx, id, 'server');
    } else if (source.step === 'server') {
      const serverId = installCorpChoice(state, source, answer);
      const cardId = source.data?.cardId as string;
      if (!serverId || state.runner.tags === 0 || !findInstalledCorpCard(state, cardId)) return;
      askChoice(ctx, 'corp', 'Greasing the Palm: remove 1 tag to place 1 advancement counter on the installed card?', yesNo('Remove 1 tag'), 'tag', { cardId });
    } else if (source.step === 'tag' && said(answer) && state.runner.tags > 0) {
      removeTags(state, 1);
      placeAdvancement(state, source.data?.cardId as string, 1, 'Greasing the Palm');
    }
  },
};

// Mindscaping: Resolve 1 of the following: Gain 4 credits and draw 2 cards. Add 1 card from HQ
// to the top of R&D. / Do X net damage. X is equal to the number of tags the Runner has, up to 3.
export const mindscaping: CardScript = {
  onPlay: ctx =>
    askChoice(ctx, 'corp', 'Mindscaping: choose one.', [
      { id: 'gain', label: 'Gain 4 [credit], draw 2, put 1 card from HQ on top of R&D' },
      { id: 'damage', label: `Do ${Math.min(3, ctx.state.runner.tags)} net damage` },
    ], 'mode'),
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'mode' && said(answer, 'gain')) {
      gainFromCard(state, 'corp', 4, ctx.card);
      drawForEffect(state, 'corp', 2, 'Mindscaping');
      addLog(state, 'corp', 'Corp gained 4 [credit] (Mindscaping).');
      if (state.corp.hq.length > 0) askCards(ctx, 'corp', 'Mindscaping: add 1 card from HQ to the top of R&D.', ids(state.corp.hq), 1, 1, 'top');
    } else if (source.step === 'mode') {
      dealNetDamage(state, Math.min(3, state.runner.tags));
    } else if (source.step === 'top') {
      const card = state.corp.hq.find(c => c.instanceId === picked(answer)[0]);
      if (!card) return;
      removeCard(state.corp.hq, card);
      state.corp.rd.unshift(card);
      addLog(state, 'corp', 'Corp added 1 card from HQ to the top of R&D (Mindscaping).');
    }
  },
};

// Oppo Research (Terminal - Gray Ops): Play only if the Runner stole or trashed a Corp card during
// their last turn. After you resolve this operation, your action phase ends. Give the Runner 2 tags.
// Threat 3 -> You may pay 5 credits to give the Runner 2 tags.
export const oppoResearch: CardScript = {
  terminal: true,
  canPlay: ({ state }) => stoleOrTrashedLastTurn(state),
  onPlay: ctx => {
    giveTags(ctx.state, 2);
    if (threatLevel(ctx.state) >= 3 && availableCredits(ctx.state, 'corp') >= 5) {
      askChoice(ctx, 'corp', 'Oppo Research: pay 5 [credit] to give the Runner 2 more tags?', yesNo('Pay 5 [credit]'), 'more');
    }
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (!said(answer) || availableCredits(state, 'corp') < 5) return;
    spendCredits(state, 'corp', 5);
    giveTags(state, 2);
  },
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

export const pivot: CardScript = {
  extraClicks: 1,
  onPlay: ctx => {
    const cards = ctx.state.corp.rd.filter(c => type(c) === 'operation' || type(c) === 'agenda');
    // A search with criteria may fail to find even when a match exists (rules 8.7.2e); asked even with none, so no tell
    askCards(ctx, 'corp', 'Pivot: you may search R&D for 1 operation or agenda.', ids(cards), 0, 1, 'search');
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'search') {
      const card = picked(answer).length ? takeFromRD(state, picked(answer)[0]) : undefined;
      if (!card) shuffleRD(state);
      else {
        state.corp.hq.push(card);
        revealInHand(state, 'corp', [card]);
      }
      const options = state.corp.hq.filter(c => playableFromHQ(state, c));
      // Asked even with nothing playable when the Corp's stops are on ALL (4.3.2, see askEvenIfNone)
      if (threatLevel(state) >= 3)
        askEvenIfNone(ctx, 'corp', options.length > 0, () => askCards(ctx, 'corp', 'Pivot: you may play or install 1 card from HQ.', ids(options), 0, 1, 'use'), 'Pivot: no card in HQ you can play or install.');
    } else if (source.step === 'use') {
      const card = state.corp.hq.find(c => c.instanceId === picked(answer)[0]);
      if (!card) return;
      if (type(card) === 'operation') playCardFrom(state, 'corp', card, state.corp.hq, { fromHand: true });
      else askCorpInstall(ctx, card.instanceId, 'server');
    } else if (source.step === 'server') installCorpChoice(state, source, answer);
  },
};

// Active Policing (Terminal - Gray Ops): Play only if the Runner stole or trashed a Corp card
// during their last turn. After you resolve this operation, your action phase ends. You may install
// 1 card from HQ. The Runner gets -1 allotted [click] for their next turn. Threat 3 -> You may pay
// 2 credits. If you do, the Runner gets -1 allotted [click] for their next turn.
const fewerClicks = (state: GameState) => {
  state.runner.bonusClicksNextTurn = (state.runner.bonusClicksNextTurn ?? 0) - 1;
  addLog(state, 'corp', 'The Runner gets -1 allotted [click] for their next turn.');
};

const activePolicingThreat = (ctx: EffectContext) => {
  if (threatLevel(ctx.state) >= 3 && availableCredits(ctx.state, 'corp') >= 2) {
    askChoice(ctx, 'corp', 'Active Policing: pay 2 [credit] for the Runner to get another -1 allotted [click]?', yesNo('Pay 2 [credit]'), 'threat');
  }
};

export const activePolicing: CardScript = {
  terminal: true,
  canPlay: ({ state }) => stoleOrTrashedLastTurn(state),
  onPlay: ctx => {
    const cards = installable(ctx.state, ctx.state.corp.hq);
    if (cards.length > 0) askCards(ctx, 'corp', 'Active Policing: you may install 1 card from HQ.', ids(cards), 0, 1, 'pick');
    else {
      fewerClicks(ctx.state);
      activePolicingThreat(ctx);
    }
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'pick') {
      const id = picked(answer)[0];
      if (id && askCorpInstall(ctx, id, 'server')) return;
      fewerClicks(state);
      activePolicingThreat(ctx);
    } else if (source.step === 'server') {
      installCorpChoice(state, source, answer);
      fewerClicks(state);
      activePolicingThreat(ctx);
    } else if (source.step === 'threat' && said(answer) && availableCredits(state, 'corp') >= 2) {
      spendCredits(state, 'corp', 2);
      fewerClicks(state);
    }
  },
};

// Corporate Hospitality (Double - Transaction): As an additional cost to play this operation,
// spend [click]. Gain 6 credits and draw 2 cards. Add 1 card from Archives to HQ.
export const corporateHospitality: CardScript = {
  extraClicks: 1,
  onPlay: ctx => {
    const { state, card } = ctx;
    gainFromCard(state, 'corp', 6, card);
    addLog(state, 'corp', 'Corp gained 6 [credit] (Corporate Hospitality).');
    drawForEffect(state, 'corp', 2, 'Corporate Hospitality');
    const archives = archivesCards(state).filter(c => c.instanceId !== card.instanceId);
    if (archives.length > 0) askCards(ctx, 'corp', 'Corporate Hospitality: add 1 card from Archives to HQ.', ids(archives), 1, 1, 'archives');
  },
  onPromptAnswer: ({ state }, _source, answer) => archivesToHQ(state, picked(answer)[0], 'Corporate Hospitality'),
};

// Bring Them Home (Terminal - Black Ops): Play only if the Runner stole or trashed a Corp card
// during their last turn. After you resolve this operation, your action phase ends. Reveal and add
// 2 cards at random from the grip to the top of the stack. Threat 3 -> You may pay 2 credits to
// reveal 1 card in the grip at random. The Runner shuffles it into the stack.
const randomGripCard = (state: GameState) => state.runner.grip[nextInt(state.rng, state.runner.grip.length)];

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
      askChoice(ctx, 'corp', 'Bring Them Home: pay 2 [credit] to shuffle 1 random card from the grip into the stack?', yesNo('Pay 2 [credit]'), 'threat');
    }
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (!said(answer) || state.runner.grip.length === 0 || availableCredits(state, 'corp') < 2) return;
    spendCredits(state, 'corp', 2);
    const card = randomGripCard(state);
    removeCard(state.runner.grip, card);
    state.runner.stack.push(card);
    shuffleInPlace(state.rng, state.runner.stack);
    addLog(state, 'corp', `Corp revealed ${title(card)} from the grip; the Runner shuffled it into the stack (Bring Them Home).`, card.cardCode);
  },
};

// Sudden Commandment (Mandate): Draw 2 cards. You may play 1 non-terminal operation from HQ.
// Threat 3 -> If this operation is the first mandate you played this turn, you may pay 3 credits
// to gain [click].
const suddenThreat = (ctx: EffectContext) => {
  const { state } = ctx;
  if (threatLevel(state) >= 3 && turnFlag(state, TurnFlag.mandatesPlayed) === 1 && turnFlag(state, `sudden-first:${ctx.card.instanceId}`) > 0 && availableCredits(state, 'corp') >= 3) {
    askChoice(ctx, 'corp', 'Sudden Commandment: pay 3 [credit] to gain [click]?', yesNo('Pay 3 [credit]'), 'click');
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
    const asked = askEvenIfNone(
      ctx,
      'corp',
      ops.length > 0,
      () => askCards(ctx, 'corp', 'Sudden Commandment: you may play 1 non-terminal operation from HQ.', ids(ops), 0, 1, 'play'),
      'Sudden Commandment: no non-terminal operation in HQ you can play.',
      'OK',
      { step: 'play' },
    );
    if (!asked) suddenThreat(ctx);
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'play') {
      const op = state.corp.hq.find(c => c.instanceId === picked(answer)[0]);
      if (op) playCardFrom(state, 'corp', op, state.corp.hq, { fromHand: true });
      suddenThreat(ctx);
    } else if (source.step === 'click' && said(answer) && availableCredits(state, 'corp') >= 3) {
      spendCredits(state, 'corp', 3);
      state.corp.clicks += 1;
      addLog(state, 'corp', 'Corp paid 3 [credit] to gain [click] (Sudden Commandment).');
    }
  },
};

export const businessAsUsual: CardScript = {
  onPlay: ctx => {
    const both = threatLevel(ctx.state) >= 3;
    askChoice(ctx, 'corp', 'Business As Usual: choose a mode.', [
      { id: 'advance', label: 'Place advancement counters on up to 2 cards' },
      { id: 'virus', label: 'Remove all virus counters from 1 card' },
      ...(both ? [{ id: 'both', label: 'Both (threat 3)' }] : []),
    ], 'mode');
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    const next = String(source.data?.next ?? '');
    if (source.step === 'mode' && answer.kind === 'effect_choice') {
      if (answer.optionId === 'virus') bauVirus(ctx, '');
      else bauAdvance(ctx, answer.optionId === 'both' ? 'virus' : '');
    } else if (source.step === 'advance') {
      for (const id of picked(answer)) placeAdvancement(state, id, 1, 'Business As Usual');
      bauNext(ctx, next);
    } else if (source.step === 'virus') {
      const card = [...installedCorpCards(state), ...installedRunnerCards(state)].find(c => c.instanceId === picked(answer)[0]);
      if (card) {
        addLog(state, 'corp', `Corp removed ${counters(card, 'virus')} virus counter(s) from ${title(card)} (Business As Usual).`);
        card.tokens.virus = 0;
      }
      bauNext(ctx, next);
    }
  },
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
