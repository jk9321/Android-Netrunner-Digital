import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { shuffleRD } from '../../../engine/rdKnowledge';
import { addLog } from '../../../engine/log';
import { checkAgendaVictory, removeCard, turnKey } from '../../../engine/helpers';
import { rezForFree } from '../../../engine/actions/corp';
import { dealCoreDamage, dealNetDamage, giveTags } from '../../../engine/damage';
import { beginEncounter, isIcebreaker } from '../../../engine/ice';
import {
  addCounters,
  agendaPoints,
  availableCredits,
  corpTrashFromHQ,
  counters,
  derez,
  drawForEffect,
  gainFromCard,
  installedIce,
  removeCounters,
  removeTags,
  runFlag,
  RunFlag,
  spendCredits,
  turnFlag,
  useOncePerTurn,
} from '../../../engine/cardEffects';
import { prompts, psi } from '../../steps';
import { CardScript, EffectContext } from '../../types';
import { advanceableInstalled, askCards, askChoice, askEvenIfNone, takeFromRD } from '../../effects';
import { archivesCards, archivesToHQ, askInstallAmong, askPlaceAdvancement, ids, installAndRez, installAndRezOptions, isSelf, lycianIs, onceKey, picked, placeAdvancement, said, title, trashTopOfRD, type, yesNo } from './helpers';

/** "When you score this agenda": the handler runs only for this agenda. */
const onScore = (fn: (ctx: EffectContext) => void) => (ctx: EffectContext, e: { card: CardInstance }) => isSelf(ctx, e.card) && fn(ctx);

// Salvo Testing: Whenever you score an agenda (including this one), you may do 1 core damage.
export const salvoTesting: CardScript = {
  triggers: {
    agenda_scored: ctx => askChoice(ctx, 'corp', 'Salvo Testing: do 1 core damage?', yesNo('Do 1 core damage'), 'damage'),
  },
  onPromptAnswer: ({ state }, source, answer) => {
    if (source.step === 'damage' && said(answer)) dealCoreDamage(state, 1);
  },
};

// Stegodon MK IV: Each run, as long as a piece of ice has been derezzed during that run, each
// installed icebreaker gets -2 strength. Once per turn -> When a run begins, you may derez 1
// piece of ice not protecting the attacked server to gain 1 credit.
export const stegodon: CardScript = {
  modifiers: {
    breakerStrength: (state, _self, breaker) => (runFlag(state, RunFlag.iceDerezzed) > 0 && isIcebreaker(breaker) ? -2 : 0),
  },
  triggers: {
    run_begins: (ctx, e) => {
      const { state } = ctx;
      if (turnFlag(state, onceKey(ctx.card)) > 0) return;
      const ice = Object.values(state.corp.servers).filter(s => s.id !== e.server).flatMap(s => s.ice).filter(c => c.isRezzed);
      if (ice.length === 0) return;
      askCards(ctx, 'corp', 'Stegodon MK IV: you may derez 1 piece of ice not protecting the attacked server to gain 1 [credit].', ids(ice), 0, 1, 'derez');
    },
  },
  onPromptAnswer: (ctx, _source, answer) => {
    const { state } = ctx;
    const ice = installedIce(state).find(c => c.instanceId === picked(answer)[0]);
    if (!ice) return;
    useOncePerTurn(state, onceKey(ctx.card));
    derez(state, ice);
    gainFromCard(state, 'corp', 1, ctx.card);
    addLog(state, 'corp', `Corp derezzed ${title(ice)} and gained 1 [credit] (Stegodon MK IV).`);
  },
};

// Fujii Asset Retrieval: When this agenda is scored or stolen, do 2 net damage.
export const fujii: CardScript = {
  triggers: {
    agenda_scored: onScore(({ state }) => void dealNetDamage(state, 2)),
    agenda_stolen: (ctx, e) => isSelf(ctx, e.card) && void dealNetDamage(ctx.state, 2),
  },
};

// Oracle Thinktank: When the Runner steals this agenda, give them 1 tag. [click], remove 1 tag:
// Shuffle this agenda into R&D. The Corp can use this ability only if this agenda is in the
// Runner's score area.
export const oracleThinktank: CardScript = {
  triggers: { agenda_stolen: (ctx, e) => isSelf(ctx, e.card) && giveTags(ctx.state, 1) },
  abilities: [
    {
      label: 'Remove 1 tag: shuffle this agenda into R&D.',
      clicks: 1,
      fromRunnerScoreArea: true,
      canUse: ({ state }) => (state.runner.tags > 0 ? null : 'The Runner has no tag to remove'),
      resolve: ({ state, card }) => {
        removeTags(state, 1);
        if (!removeCard(state.runner.scoreArea, card)) return;
        state.runner.score -= agendaPoints(card);
        delete card.asAgendaPoints;
        card.isRezzed = false;
        state.corp.rd.push(card);
        shuffleRD(state);
        addLog(state, 'corp', 'Corp removed 1 tag and shuffled Oracle Thinktank into R&D.');
      },
    },
  ],
};

// Slash and Burn Agriculture (Expansion - Expendable): [click], 1 credit, reveal and trash this
// agenda from HQ: Place 2 advancement counters on 1 installed card that you can advance.
export const slashAndBurn: CardScript = {
  abilities: [
    {
      label: 'Reveal and trash this agenda from HQ: place 2 advancement counters on 1 installed card you can advance.',
      fromHQ: true,
      clicks: 1,
      credits: 1,
      canUse: ({ state }) => (advanceableInstalled(state).length > 0 ? null : 'No installed card can be advanced'),
      resolve: ctx => {
        corpTrashFromHQ(ctx.state, [ctx.card.instanceId], true);
        addLog(ctx.state, 'corp', 'Corp revealed and trashed Slash and Burn Agriculture from HQ.');
        askPlaceAdvancement(ctx, 2, 'place');
      },
    },
  ],
  onPromptAnswer: ({ state }, _source, answer) => placeAdvancement(state, picked(answer)[0], 2, 'Slash and Burn Agriculture'),
};

// Lightning Laboratory: When you score this agenda, place 1 agenda counter on it. Whenever a run
// begins, you may remove 1 hosted agenda counter to rez up to 2 pieces of ice protecting the
// attacked server, ignoring all costs. When this turn ends, derez 2 pieces of ice protecting that server.
export const lightningLab: CardScript = {
  triggers: {
    agenda_scored: onScore(({ card }) => addCounters(card, 'agenda', 1)),
    run_begins: (ctx, e) => {
      const ice = ctx.state.corp.servers[e.server]?.ice.filter(c => !c.isRezzed) ?? [];
      if (counters(ctx.card, 'agenda') === 0 || ice.length === 0) return;
      askCards(ctx, 'corp', 'Lightning Laboratory: remove 1 agenda counter to rez up to 2 pieces of ice protecting the attacked server for free?', ids(ice), 0, 2, 'rez', {
        server: e.server,
      });
    },
    discard_phase_ends: ctx => {
      const { state } = ctx;
      const server = state.corp.servers[String(turnFlagServer(state, ctx.card))];
      if (!server) return;
      delete state.turnFlags[lightningKey(ctx.card)];
      const rezzed = server.ice.filter(c => c.isRezzed);
      if (rezzed.length <= 2) rezzed.forEach(c => derez(state, c));
      else askCards(ctx, 'corp', 'Lightning Laboratory: derez 2 pieces of ice protecting that server.', ids(rezzed), 2, 2, 'derez');
    },
  },
  onPromptAnswer: ({ state, card }, source, answer) => {
    if (source.step === 'rez' && picked(answer).length > 0 && counters(card, 'agenda') > 0) {
      removeCounters(card, 'agenda', 1);
      const serverId = source.data?.server as string;
      const index = Object.keys(state.corp.servers).indexOf(serverId);
      state.turnFlags[lightningKey(card)] = index + 1;
      for (const id of picked(answer)) {
        const ice = installedIce(state).find(c => c.instanceId === id);
        if (!ice || ice.isRezzed) continue;
        addLog(state, 'corp', `Corp rezzed ${title(ice)} for free (Lightning Laboratory).`, undefined, 'rez');
        rezForFree(state, ice);
      }
    } else if (source.step === 'derez') {
      for (const id of picked(answer)) {
        const ice = installedIce(state).find(c => c.instanceId === id);
        if (ice) derez(state, ice);
      }
    }
  },
};

const lightningKey = (card: CardInstance) => `lightning:${card.instanceId}`;

/** The server Lightning Laboratory rezzed ice on this turn (stored as its position in the server list, plus 1). */
const turnFlagServer = (state: GameState, card: CardInstance) => Object.keys(state.corp.servers)[turnFlag(state, lightningKey(card)) - 1];

// See How They Run (Psi - Security): When you score this agenda, give the Runner 1 tag. Play a Psi
// Game. If the bids differ, do 1 core damage. If the bids match, do 1 net damage.
const seeHowTheyRunFlow = prompts({
  psi: psi((ctx, match) => {
    if (match) dealNetDamage(ctx.state, 1);
    else dealCoreDamage(ctx.state, 1);
  }),
});

export const seeHowTheyRun: CardScript = {
  triggers: {
    agenda_scored: onScore(ctx => {
      giveTags(ctx.state, 1);
      seeHowTheyRunFlow.psiGame(ctx, 'psi');
    }),
  },
  ...seeHowTheyRunFlow.script,
};

// Sisyphus Protocol: The first time each turn the Runner passes a rezzed code gate or sentry, you
// may pay 1 credit or trash 1 card from HQ. If you do, the Runner encounters that ice again.
export const sisyphus: CardScript = {
  triggers: {
    ice_passed: (ctx, e) => {
      const { state } = ctx;
      if (!e.ice.isRezzed || !(lycianIs(state, e.ice, 'code gate') || lycianIs(state, e.ice, 'sentry'))) return;
      if (!useOncePerTurn(state, onceKey(ctx.card))) return;
      const options = [
        ...(availableCredits(state, 'corp') >= 1 ? [{ id: 'pay', label: 'Pay 1 [credit]' }] : []),
        ...state.corp.hq.map(c => ({ id: c.instanceId, label: `Trash ${title(c)} from HQ` })),
      ];
      if (options.length === 0) return;
      askChoice(ctx, 'corp', `Sisyphus Protocol: pay 1 [credit] or trash 1 card from HQ to make the Runner encounter ${title(e.ice)} again?`, [...options, { id: 'no', label: 'No' }], 'again', {
        iceId: e.ice.instanceId,
      });
    },
  },
  onPromptAnswer: ({ state }, source, answer) => {
    if (answer.kind !== 'effect_choice' || answer.optionId === 'no') return;
    const run = state.activeRun;
    const iceId = source.data?.iceId as string;
    const server = run && state.corp.servers[run.server];
    const ice = server?.ice.find(c => c.instanceId === iceId);
    if (answer.optionId === 'pay') spendCredits(state, 'corp', 1);
    else corpTrashFromHQ(state, [answer.optionId]);
    if (!run || !server || !ice || !ice.isRezzed || run.phase !== 'movement') return;
    addLog(state, 'corp', `The Runner encounters ${title(ice)} again (Sisyphus Protocol).`);
    run.icePosition = server.ice.indexOf(ice);
    run.icePassed = Math.max(0, run.icePassed - 1);
    beginEncounter(state, ice);
  },
};

// Kingmaking (Research): When you score this agenda, draw up to 3 cards. You may add 1 agenda worth
// 1 or less agenda points from HQ to your score area.
export const kingmaking: CardScript = {
  triggers: {
    agenda_scored: onScore(ctx => {
      const n = Math.min(3, ctx.state.corp.rd.length);
      askChoice(ctx, 'corp', 'Kingmaking: draw how many cards?', [3, 2, 1, 0].filter(k => k <= n).map(k => ({ id: String(k), label: `Draw ${k}` })), 'draw');
    }),
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'draw' && answer.kind === 'effect_choice') {
      drawForEffect(state, 'corp', Number(answer.optionId), 'Kingmaking');
      const small = state.corp.hq.filter(c => type(c) === 'agenda' && (cardDef(c).agenda_points ?? 0) <= 1);
      // Asked even with no such agenda in HQ when the Corp's stops are on ALL (4.3.2, see askEvenIfNone)
      askEvenIfNone(
        ctx,
        'corp',
        small.length > 0,
        () => askCards(ctx, 'corp', 'Kingmaking: you may add 1 agenda worth 1 or less agenda points from HQ to your score area.', ids(small), 0, 1, 'add'),
        'Kingmaking: no agenda worth 1 or less agenda points in HQ.',
      );
    } else if (source.step === 'add') {
      const agenda = state.corp.hq.find(c => c.instanceId === picked(answer)[0]);
      if (!agenda) return;
      removeCard(state.corp.hq, agenda);
      agenda.isRezzed = true;
      agenda.scoredTurn = turnKey(state);
      state.corp.scoreArea.push(agenda);
      state.corp.score += agendaPoints(agenda);
      addLog(state, 'corp', `Corp added ${title(agenda)} to their score area (Kingmaking). Total: ${state.corp.score}`);
      checkAgendaVictory(state);
    }
  },
};

// Stoke the Embers (Initiative): When you score this agenda, gain 3 credits and place 1
// advancement counter on an installed card. When you install this agenda from anywhere except HQ,
// you may reveal it. If you do, gain 2 credits and place 1 advancement counter on an installed card.
export const stokeTheEmbers: CardScript = {
  triggers: {
    agenda_scored: onScore(ctx => {
      gainFromCard(ctx.state, 'corp', 3, ctx.card);
      addLog(ctx.state, 'corp', 'Corp gained 3 [credit] (Stoke the Embers).');
      askPlaceAdvancement(ctx, 1, 'place', false);
    }),
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'place') placeAdvancement(state, picked(answer)[0], 1, 'Stoke the Embers');
    else if (source.step === 'reveal' && said(answer)) {
      ctx.card.runnerKnows = true;
      addLog(state, 'corp', 'Corp revealed Stoke the Embers as it was installed.', ctx.card.cardCode);
      gainFromCard(state, 'corp', 2, ctx.card);
      askPlaceAdvancement(ctx, 1, 'place', false);
    }
  },
  // Inactive while installed unrezzed, so this runs from installCorpCardFrom on the card itself
  onCorpInstalled: (ctx, fromHQ) => {
    if (fromHQ) return;
    askChoice(ctx, 'corp', 'Stoke the Embers: reveal it to gain 2 [credit] and place 1 advancement counter on an installed card?', yesNo('Reveal it'), 'reveal');
  },
};

// Eminent Domain (Expansion - Expendable): [click], 1 credit, reveal and trash this agenda from
// HQ: Install and rez 1 card from HQ, paying a total of 5 credits less. When you score this agenda,
// you may search R&D for 1 card. Install and rez that card, ignoring all costs.
const rezzable = (c: CardInstance) => type(c) !== 'operation' && type(c) !== 'agenda';

export const eminentDomain: CardScript = {
  abilities: [
    {
      label: 'Reveal and trash this agenda from HQ: install and rez 1 card from HQ, paying 5 [credit] less in total.',
      fromHQ: true,
      clicks: 1,
      credits: 1,
      resolve: ctx => {
        const { state, card } = ctx;
        corpTrashFromHQ(state, [card.instanceId], true);
        addLog(state, 'corp', 'Corp revealed and trashed Eminent Domain from HQ.');
        const cards = state.corp.hq.filter(c => rezzable(c) && installAndRezOptions(state, c, 5).length > 0);
        // Asked even with nothing to install and rez when the Corp's stops are on ALL (4.3.2, see askEvenIfNone)
        askEvenIfNone(
          ctx,
          'corp',
          cards.length > 0,
          () => askCards(ctx, 'corp', 'Eminent Domain: install and rez 1 card from HQ, paying 5 [credit] less in total.', ids(cards), 0, 1, 'hq'),
          'Eminent Domain: no card in HQ you can install and rez.',
        );
      },
    },
  ],
  triggers: {
    agenda_scored: onScore(ctx => {
      const cards = ctx.state.corp.rd.filter(rezzable);
      askCards(ctx, 'corp', 'Eminent Domain: you may search R&D for 1 card to install and rez, ignoring all costs.', ids(cards), 0, 1, 'search');
    }),
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'hq') {
      const id = picked(answer)[0];
      const card = id && state.corp.hq.find(c => c.instanceId === id);
      if (card) askInstallAmong(ctx, id, 'hq-server', installAndRezOptions(state, card, 5));
    } else if (source.step === 'hq-server' && answer.kind === 'effect_choice') {
      installAndRez(state, source.data?.cardId as string, answer.optionId, 5);
    } else if (source.step === 'search') {
      const card = picked(answer).length ? takeFromRD(state, picked(answer)[0]) : undefined;
      if (!card) return shuffleRD(state);
      state.corp.hq.push(card);
      if (!askInstallAmong(ctx, card.instanceId, 'rd-server', installAndRezOptions(state, card, 0, true))) return;
    } else if (source.step === 'rd-server' && answer.kind === 'effect_choice') {
      installAndRez(state, source.data?.cardId as string, answer.optionId, 0, true);
    }
  },
};

// The Basalt Spire: When the Runner steals this agenda, you may add 1 card from Archives to HQ.
// When you score this agenda, place 2 agenda counters on it. Once per turn -> Hosted agenda counter,
// trash the top card of R&D: Add 1 card from Archives to HQ.
const askArchivesToHQ = (ctx: EffectContext, optional: boolean) => {
  const cards = archivesCards(ctx.state);
  if (cards.length > 0) askCards(ctx, 'corp', `${title(ctx.card)}: ${optional ? 'you may add' : 'add'} 1 card from Archives to HQ.`, ids(cards), optional ? 0 : 1, 1, 'archives');
};

export const basaltSpire: CardScript = {
  triggers: {
    agenda_stolen: (ctx, e) => isSelf(ctx, e.card) && askArchivesToHQ(ctx, true),
    agenda_scored: onScore(({ card }) => addCounters(card, 'agenda', 2)),
  },
  abilities: [
    {
      label: 'Hosted agenda counter, trash the top card of R&D: add 1 card from Archives to HQ.',
      counters: { type: 'agenda', count: 1 },
      oncePerTurn: true,
      canUse: ({ state }) => (state.corp.rd.length > 0 ? null : 'R&D is empty'),
      resolve: ctx => {
        trashTopOfRD(ctx.state, 'The Basalt Spire');
        askArchivesToHQ(ctx, false);
      },
    },
  ],
  onPromptAnswer: ({ state }, _source, answer) => archivesToHQ(state, picked(answer)[0], 'The Basalt Spire'),
};

export const liberationCorpAgendasScripts: Record<string, CardScript> = {
  '34031': salvoTesting,
  '34032': stegodon,
  '34040': fujii,
  '34049': oracleThinktank,
  '34057': slashAndBurn,
  '34097': lightningLab,
  '34105': seeHowTheyRun,
  '34106': sisyphus,
  '34113': kingmaking,
  '34114': stokeTheEmbers,
  '34122': eminentDomain,
  '34123': basaltSpire,
};
