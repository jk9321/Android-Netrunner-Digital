import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { addLog } from '../../../engine/log';
import { noteRdPrivate } from '../../../engine/rdKnowledge';
import { dealMeatDamage, giveTags } from '../../../engine/damage';
import { endTheRun } from '../../../engine/runEnd';
import {
  addCounters,
  counters,
  drawForEffect,
  flipIdentity,
  removeCounters,
  removeTags,
  trashInstalledCard,
  turnFlag,
  TurnFlag,
  useOncePerTurn,
} from '../../../engine/cardEffects';
import { CardScript, EffectContext } from '../../types';
import { advanceableInstalled, askCards, askEvenIfNone, askChoice, askCorpInstall, gainCredits, installCorpChoice } from '../../effects';
import { ids, installable, keywords, onceKey, type } from './helpers';

// LEO Construction: Once per turn -> Trash 1 rezzed bioroid card in the root of or
// protecting the attacked server: End the run.
const leoTargets = (state: GameState) => {
  const run = state.activeRun;
  const server = run && !run.accessOnly ? state.corp.servers[run.server] : undefined;
  return server ? [...server.ice, ...server.root].filter(c => c.isRezzed && /bioroid/i.test(keywords(c))) : [];
};

export const leo: CardScript = {
  abilities: [
    {
      label: 'Trash 1 rezzed bioroid card in or protecting the attacked server: end the run.',
      oncePerTurn: true,
      canUse: ({ state }) => (leoTargets(state).length > 0 ? null : 'No rezzed bioroid card in or protecting the attacked server'),
      resolve: ctx => askCards(ctx, 'corp', 'LEO Construction: trash 1 rezzed bioroid card to end the run.', ids(leoTargets(ctx.state)), 1, 1, 'trash'),
    },
  ],
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards') return;
    const target = leoTargets(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
    if (!target) return;
    trashInstalledCard(state, target);
    addLog(state, 'corp', `Corp trashed ${cardDef(target).title} (LEO Construction).`);
    endTheRun(state);
  },
};

// Poétrï Luxury Brands: Whenever you score an agenda, look at the top 3 cards of R&D.
// You may install 1 non-agenda card from among them. Whenever an agenda is stolen,
// you may install 1 non-agenda card from HQ.
export const poetri: CardScript = {
  triggers: {
    agenda_scored: ctx => {
      const top = installable(ctx.state, ctx.state.corp.rd.slice(0, 3).filter(c => type(c) !== 'agenda'));
      addLog(ctx.state, 'corp', 'Corp looked at the top 3 cards of R&D (Poétrï Luxury Brands).');
      // Asked even with nothing to install when the Corp's stops are on ALL, so the wait doesn't tell the Runner what R&D holds (4.2.2)
      askEvenIfNone(ctx, 'corp', top.length > 0, () => askCards(ctx, 'corp', 'Poétrï: you may install 1 non-agenda card from the top 3 of R&D.', ids(top), 0, 1, 'pick'), 'Poétrï: no non-agenda card in the top 3 of R&D you can install.');
    },
    agenda_stolen: ctx => {
      const cards = installable(ctx.state, ctx.state.corp.hq.filter(c => type(c) !== 'agenda'));
      // Likewise for HQ (4.3.2: HQ is hidden from the Runner)
      askEvenIfNone(ctx, 'corp', cards.length > 0, () => askCards(ctx, 'corp', 'Poétrï: you may install 1 non-agenda card from HQ.', ids(cards), 0, 1, 'pick'), 'Poétrï: no non-agenda card in HQ you can install.');
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'pick' && answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) {
      askCorpInstall(ctx, answer.cardInstanceIds[0], 'server');
    } else if (source.step === 'server') {
      // Installed facedown from among the top 3: the Runner can't tell which (rules 8.3.3b)
      if (ctx.state.corp.rd.some(c => c.instanceId === source.data?.cardId)) noteRdPrivate(ctx.state, 3);
      installCorpChoice(ctx.state, source, answer);
    }
  },
};

// AU Co.: Whenever you do damage or trash 1 or more cards from HQ, place 1 power counter
// on this identity. When your turn begins, you may remove 2 hosted power counters to look
// at the top 3 cards of R&D. Trash 1 of those cards and add the rest to HQ.
const auCoCounter = (ctx: EffectContext) => {
  addCounters(ctx.card, 'power', 1);
};

export const auCo: CardScript = {
  triggers: {
    damage_dealt: (ctx, e) => e.byCorp && auCoCounter(ctx),
    hq_trashed: auCoCounter,
    turn_begins: (ctx, e) => {
      if (e.side !== 'corp' || counters(ctx.card, 'power') < 2 || ctx.state.corp.rd.length === 0) return;
      askChoice(ctx, 'corp', 'AU Co.: remove 2 power counters to look at the top 3 cards of R&D?', [
        { id: 'use', label: 'Look at the top 3 of R&D' },
        { id: 'no', label: 'No' },
      ], 'use');
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'use' && answer.kind === 'effect_choice' && answer.optionId === 'use') {
      removeCounters(ctx.card, 'power', 2);
      askCards(ctx, 'corp', 'AU Co.: trash 1 of the top 3 cards of R&D; the rest go to HQ.', ids(state.corp.rd.slice(0, 3)), 1, 1, 'trash');
    } else if (source.step === 'trash' && answer.kind === 'effect_cards') {
      const top = state.corp.rd.splice(0, 3);
      noteRdPrivate(state, top.length); // which one was trashed is not declared
      for (const card of top) {
        if (card.instanceId === answer.cardInstanceIds[0]) state.corp.archives.faceDown.push(card);
        else state.corp.hq.push(card);
      }
      addLog(state, 'corp', `Corp trashed 1 card and added ${top.length - 1} to HQ (AU Co.).`);
    }
  },
};

// PT Untaian: When your discard phase ends, if there are 3 or fewer cards in HQ, you
// may pay 1 credit to place 1 advancement counter on an unrezzed card you can advance.
const untaianTargets = (state: GameState) => advanceableInstalled(state).filter(c => !c.isRezzed);

export const ptUntaian: CardScript = {
  triggers: {
    discard_phase_ends: (ctx, e) => {
      const { state } = ctx;
      if (e.side !== 'corp' || state.corp.hq.length > 3 || state.corp.credits < 1) return;
      const targets = untaianTargets(state);
      // Asked even with no target when the Corp's stops are on ALL, so the wait doesn't tell the Runner whether an
      // unrezzed card can be advanced (4.6.3)
      askEvenIfNone(
        ctx,
        'corp',
        targets.length > 0,
        () => askCards(ctx, 'corp', 'PT Untaian: you may pay 1 credit to place 1 advancement counter on an unrezzed card.', ids(targets), 0, 1, 'advance'),
        'PT Untaian: no unrezzed card you can advance.',
      );
    },
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards' || answer.cardInstanceIds.length === 0) return;
    const target = untaianTargets(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
    if (!target || state.corp.credits < 1) return;
    state.corp.credits -= 1;
    target.advancementCounters += 1;
    addLog(state, 'corp', 'Corp paid 1 [credit] to place 1 advancement counter (PT Untaian).');
  },
};

// Nebula Talent Management: When your action phase ends, if you played an operation this
// turn, gain 1 credit and flip this identity. Flip side: The first time each turn you
// play an operation, gain click. When the Runner makes a successful run on HQ or R&D, flip.
export const nebula: CardScript = {
  triggers: {
    action_phase_ends: ({ state, card }, e) => {
      if (e.side !== 'corp' || card.flipped || turnFlag(state, TurnFlag.operationsPlayed) === 0) return;
      gainCredits(state, 'corp', 1);
      addLog(state, 'corp', 'Corp gained 1 [credit] (Nebula Talent Management).');
      flipIdentity(state, 'corp');
    },
    operation_played: ({ state, card }) => {
      if (!card.flipped || turnFlag(state, TurnFlag.operationsPlayed) !== 1) return;
      state.corp.clicks += 1;
      addLog(state, 'corp', 'Corp gained [click] (Nebula Talent Management).');
    },
    successful_run: ({ state, card }, e) => {
      if (card.flipped && (e.server === 'hq' || e.server === 'rd')) flipIdentity(state, 'corp');
    },
  },
};

// Synapse Global: The first time each turn a tag is removed, you may reveal and install
// 1 card from HQ, ignoring all costs. click, remove 1 tag: Gain 2 credits.
export const synapse: CardScript = {
  triggers: {
    tags_removed: ctx => {
      if (!useOncePerTurn(ctx.state, onceKey(ctx.card))) return;
      const cards = installable(ctx.state, ctx.state.corp.hq, { ignoreCosts: true });
      if (cards.length === 0) return;
      askCards(ctx, 'corp', 'Synapse Global: you may reveal and install 1 card from HQ, ignoring all costs.', ids(cards), 0, 1, 'pick');
    },
  },
  abilities: [
    {
      label: 'Remove 1 tag: gain 2 credits.',
      clicks: 1,
      canUse: ({ state }) => (state.runner.tags > 0 ? null : 'The Runner has no tags'),
      resolve: ({ state }) => {
        removeTags(state, 1);
        gainCredits(state, 'corp', 2);
        addLog(state, 'corp', 'Corp removed 1 tag and gained 2 [credit] (Synapse Global).');
      },
    },
  ],
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'pick' && answer.kind === 'effect_cards' && answer.cardInstanceIds.length > 0) {
      const card = ctx.state.corp.hq.find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (card) addLog(ctx.state, 'corp', `Corp revealed ${cardDef(card).title} (Synapse Global).`);
      askCorpInstall(ctx, answer.cardInstanceIds[0], 'server', { ignoreCosts: true, revealed: true });
    } else if (source.step === 'server') {
      installCorpChoice(ctx.state, source, answer, { ignoreCosts: true, revealed: true });
    }
  },
};

// BANGUN: You may install agendas faceup. Whenever the Runner accesses a faceup
// installed agenda, do 2 meat damage and give the Runner 1 tag.
export const bangun: CardScript = {
  agendasFaceUp: true,
  triggers: {
    card_accessed: ({ state }, e) => {
      if (e.where !== 'installed' || type(e.card) !== 'agenda' || !e.card.faceUp) return;
      dealMeatDamage(state, 2);
      if (!state.winner) giveTags(state, 1);
    },
  },
};

// The Zwicky Group: The first time each turn you gain credits through an ability on an
// agenda or operation, you may draw 1 card.
export const zwicky: CardScript = {
  triggers: {
    credits_gained: (ctx, e) => {
      if (e.side !== 'corp' || !['agenda', 'operation'].includes(type(e.source))) return;
      if (!useOncePerTurn(ctx.state, onceKey(ctx.card))) return;
      askChoice(ctx, 'corp', 'The Zwicky Group: draw 1 card?', [
        { id: 'draw', label: 'Draw 1 card' },
        { id: 'no', label: 'No' },
      ], 'draw');
    },
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind === 'effect_choice' && answer.optionId === 'draw') drawForEffect(state, 'corp', 1, 'The Zwicky Group');
  },
};

// --- Agendas ----------------------------------------------------------------

export const elevationCorpIdentitiesScripts: Record<string, CardScript> = {
  '35035': leo,
  '35036': poetri,
  '35046': auCo,
  '35047': ptUntaian,
  '35057': nebula,
  '35058': synapse,
  '35068': bangun,
  '35069': zwicky,
};
