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
import { cards, choice, InstallData, prompts, psi } from '../../steps';
import { CardScript, EffectContext } from '../../types';
import { advanceableInstalled, takeFromRD } from '../../effects';
import {
  archivesCards,
  archivesToHQ,
  ids,
  installAmongQuestion,
  installAndRez,
  installAndRezOptions,
  isSelf,
  lycianIs,
  onceKey,
  placeAdvancement,
  placeAdvancementQuestion,
  title,
  trashTopOfRD,
  type,
  yesNo,
} from './helpers';
import { firstThisTurn } from '../../../engine/triggers';

/** "When you score this agenda": the handler runs only for this agenda. */
const onScore = (fn: (ctx: EffectContext) => void) => (ctx: EffectContext, e: { card: CardInstance }) => isSelf(ctx, e.card) && fn(ctx);

// Salvo Testing: Whenever you score an agenda (including this one), you may do 1 core damage.
const salvoFlow = prompts({
  damage: choice(({ state }, a) => {
    if (a.optionId === 'yes') dealCoreDamage(state, 1);
  }),
});

export const salvoTesting: CardScript = {
  triggers: {
    agenda_scored: ctx => salvoFlow.choice(ctx, 'damage', { side: 'corp', message: 'Salvo Testing: do 1 core damage?', options: yesNo('Do 1 core damage') }),
  },
  ...salvoFlow.script,
};

// Stegodon MK IV: Each run, as long as a piece of ice has been derezzed during that run, each
// installed icebreaker gets -2 strength. Once per turn -> When a run begins, you may derez 1
// piece of ice not protecting the attacked server to gain 1 credit.
const stegodonFlow = prompts({
  derez: cards((ctx, a) => {
    const { state } = ctx;
    const ice = installedIce(state).find(c => c.instanceId === a.ids[0]);
    if (!ice) return;
    useOncePerTurn(state, onceKey(ctx.card));
    derez(state, ice);
    gainFromCard(state, 'corp', 1, ctx.card);
    addLog(state, 'corp', `Corp derezzed ${title(ice)} and gained 1 [credit] (Stegodon MK IV).`);
  }),
});

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
      stegodonFlow.cards(ctx, 'derez', {
        side: 'corp',
        message: 'Stegodon MK IV: you may derez 1 piece of ice not protecting the attacked server to gain 1 [credit].',
        candidateIds: ids(ice),
        min: 0,
        max: 1,
      });
    },
  },
  ...stegodonFlow.script,
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
      runnerScoreAreaOnly: true,
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
const slashAndBurnFlow = prompts({
  place: cards<{ n: number }>(({ state }, a) => placeAdvancement(state, a.ids[0], 2, 'Slash and Burn Agriculture')),
});

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
        slashAndBurnFlow.askIf(ctx, 'place', placeAdvancementQuestion(ctx, 2), { n: 2 });
      },
    },
  ],
  ...slashAndBurnFlow.script,
};

// Lightning Laboratory: When you score this agenda, place 1 agenda counter on it. Whenever a run
// begins, you may remove 1 hosted agenda counter to rez up to 2 pieces of ice protecting the
// attacked server, ignoring all costs. When this turn ends, derez 2 pieces of ice protecting that server.
const lightningLabFlow = prompts({
  rez: cards<{ server: string }>(({ state, card }, a, data) => {
    if (a.ids.length === 0 || counters(card, 'agenda') === 0) return;
    removeCounters(card, 'agenda', 1);
    const index = Object.keys(state.corp.servers).indexOf(data.server);
    state.turnFlags[lightningKey(card)] = index + 1;
    for (const id of a.ids) {
      const ice = installedIce(state).find(c => c.instanceId === id);
      if (!ice || ice.isRezzed) continue;
      addLog(state, 'corp', `Corp rezzed ${title(ice)} for free (Lightning Laboratory).`, undefined, 'rez');
      rezForFree(state, ice);
    }
  }),
  derez: cards(({ state }, a) => {
    for (const id of a.ids) {
      const ice = installedIce(state).find(c => c.instanceId === id);
      if (ice) derez(state, ice);
    }
  }),
});

export const lightningLab: CardScript = {
  triggers: {
    agenda_scored: onScore(({ card }) => addCounters(card, 'agenda', 1)),
    run_begins: (ctx, e) => {
      const ice = ctx.state.corp.servers[e.server]?.ice.filter(c => !c.isRezzed) ?? [];
      if (counters(ctx.card, 'agenda') === 0 || ice.length === 0) return;
      lightningLabFlow.cards(
        ctx,
        'rez',
        {
          side: 'corp',
          message: 'Lightning Laboratory: remove 1 agenda counter to rez up to 2 pieces of ice protecting the attacked server for free?',
          candidateIds: ids(ice),
          min: 0,
          max: 2,
        },
        { server: e.server },
      );
    },
    discard_phase_ends: ctx => {
      const { state } = ctx;
      const server = state.corp.servers[String(turnFlagServer(state, ctx.card))];
      if (!server) return;
      delete state.turnFlags[lightningKey(ctx.card)];
      const rezzed = server.ice.filter(c => c.isRezzed);
      if (rezzed.length <= 2) rezzed.forEach(c => derez(state, c));
      else lightningLabFlow.cards(ctx, 'derez', { side: 'corp', message: 'Lightning Laboratory: derez 2 pieces of ice protecting that server.', candidateIds: ids(rezzed), min: 2, max: 2 });
    },
  },
  ...lightningLabFlow.script,
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
const sisyphusFlow = prompts({
  again: choice<{ iceId: string }>(({ state }, a, data) => {
    if (a.optionId === 'no') return;
    const run = state.activeRun;
    const server = run && state.corp.servers[run.server];
    const ice = server?.ice.find(c => c.instanceId === data.iceId);
    if (a.optionId === 'pay') spendCredits(state, 'corp', 1);
    else corpTrashFromHQ(state, [a.optionId]);
    if (!run || !server || !ice || !ice.isRezzed || run.phase !== 'movement') return;
    addLog(state, 'corp', `The Runner encounters ${title(ice)} again (Sisyphus Protocol).`);
    run.icePosition = server.ice.indexOf(ice);
    delete run.positionEmpty;
    run.icePassed = Math.max(0, run.icePassed - 1);
    beginEncounter(state, ice);
  }),
});

const passedRezzedGateOrSentry = (state: GameState, e: { ice: CardInstance }) =>
  e.ice.isRezzed && (lycianIs(state, e.ice, 'code gate') || lycianIs(state, e.ice, 'sentry'));

export const sisyphus: CardScript = {
  firstEachTurn: { ice_passed: passedRezzedGateOrSentry },
  triggers: {
    ice_passed: (ctx, e) => {
      const { state } = ctx;
      if (!passedRezzedGateOrSentry(state, e) || !firstThisTurn(state, ctx.card)) return;
      const options = [
        ...(availableCredits(state, 'corp') >= 1 ? [{ id: 'pay', label: 'Pay 1 [credit]' }] : []),
        ...state.corp.hq.map(c => ({ id: c.instanceId, label: `Trash ${title(c)} from HQ` })),
      ];
      if (options.length === 0) return;
      sisyphusFlow.choice(
        ctx,
        'again',
        {
          side: 'corp',
          message: `Sisyphus Protocol: pay 1 [credit] or trash 1 card from HQ to make the Runner encounter ${title(e.ice)} again?`,
          options: [...options, { id: 'no', label: 'No' }],
        },
        { iceId: e.ice.instanceId },
      );
    },
  },
  ...sisyphusFlow.script,
};

// Kingmaking (Research): When you score this agenda, draw up to 3 cards. You may add 1 agenda worth
// 1 or less agenda points from HQ to your score area.
const kingmakingFlow = prompts({
  draw: choice((ctx, a) => {
    const { state } = ctx;
    drawForEffect(state, 'corp', Number(a.optionId), 'Kingmaking');
    const small = state.corp.hq.filter(c => type(c) === 'agenda' && (cardDef(c).agenda_points ?? 0) <= 1);
    // Asked even with no such agenda in HQ when the Corp's stops are on ALL (4.3.2, see askEvenIfNone)
    kingmakingFlow.evenIfNone(
      ctx,
      'corp',
      small.length > 0,
      () =>
        kingmakingFlow.cards(ctx, 'add', {
          side: 'corp',
          message: 'Kingmaking: you may add 1 agenda worth 1 or less agenda points from HQ to your score area.',
          candidateIds: ids(small),
          min: 0,
          max: 1,
        }),
      'Kingmaking: no agenda worth 1 or less agenda points in HQ.',
    );
  }),
  add: cards(({ state }, a) => {
    const agenda = state.corp.hq.find(c => c.instanceId === a.ids[0]);
    if (!agenda) return;
    removeCard(state.corp.hq, agenda);
    agenda.isRezzed = true;
    agenda.scoredTurn = turnKey(state);
    state.corp.scoreArea.push(agenda);
    state.corp.score += agendaPoints(agenda);
    addLog(state, 'corp', `Corp added ${title(agenda)} to their score area (Kingmaking). Total: ${state.corp.score}`);
    checkAgendaVictory(state);
  }),
});

export const kingmaking: CardScript = {
  triggers: {
    agenda_scored: onScore(ctx => {
      const n = Math.min(3, ctx.state.corp.rd.length);
      kingmakingFlow.choice(ctx, 'draw', {
        side: 'corp',
        message: 'Kingmaking: draw how many cards?',
        options: [3, 2, 1, 0].filter(k => k <= n).map(k => ({ id: String(k), label: `Draw ${k}` })),
      });
    }),
  },
  ...kingmakingFlow.script,
};

// Stoke the Embers (Initiative): When you score this agenda, gain 3 credits and place 1
// advancement counter on an installed card. When you install this agenda from anywhere except HQ,
// you may reveal it. If you do, gain 2 credits and place 1 advancement counter on an installed card.
const stokeFlow = prompts({
  place: cards<{ n: number }>(({ state }, a) => placeAdvancement(state, a.ids[0], 1, 'Stoke the Embers')),
  reveal: choice((ctx, a) => {
    if (a.optionId !== 'yes') return;
    const { state } = ctx;
    ctx.card.runnerKnows = true;
    addLog(state, 'corp', 'Corp revealed Stoke the Embers as it was installed.', ctx.card.cardCode);
    gainFromCard(state, 'corp', 2, ctx.card);
    stokeFlow.askIf(ctx, 'place', placeAdvancementQuestion(ctx, 1, false), { n: 1 });
  }),
});

export const stokeTheEmbers: CardScript = {
  triggers: {
    agenda_scored: onScore(ctx => {
      gainFromCard(ctx.state, 'corp', 3, ctx.card);
      addLog(ctx.state, 'corp', 'Corp gained 3 [credit] (Stoke the Embers).');
      stokeFlow.askIf(ctx, 'place', placeAdvancementQuestion(ctx, 1, false), { n: 1 });
    }),
  },
  ...stokeFlow.script,
  // Inactive while installed unrezzed, so this runs from installCorpCardFrom on the card itself
  onCorpInstalled: (ctx, fromHQ) => {
    if (fromHQ) return;
    stokeFlow.choice(ctx, 'reveal', {
      side: 'corp',
      message: 'Stoke the Embers: reveal it to gain 2 [credit] and place 1 advancement counter on an installed card?',
      options: yesNo('Reveal it'),
    });
  },
};

// Eminent Domain (Expansion - Expendable): [click], 1 credit, reveal and trash this agenda from
// HQ: Install and rez 1 card from HQ, paying a total of 5 credits less. When you score this agenda,
// you may search R&D for 1 card. Install and rez that card, ignoring all costs.
const rezzable = (c: CardInstance) => type(c) !== 'operation' && type(c) !== 'agenda';

const eminentDomainFlow = prompts({
  hq: cards((ctx, a) => {
    const { state } = ctx;
    const id = a.ids[0];
    const card = id && state.corp.hq.find(c => c.instanceId === id);
    if (card) eminentDomainFlow.askIf(ctx, 'hq-server', installAmongQuestion(state, id, installAndRezOptions(state, card, 5)), { cardId: id, install: true });
  }),
  'hq-server': choice<InstallData>(({ state }, a, data) => installAndRez(state, data.cardId, a.optionId, 5)),
  search: cards((ctx, a) => {
    const { state } = ctx;
    const card = a.ids.length ? takeFromRD(state, a.ids[0]) : undefined;
    if (!card) return shuffleRD(state);
    state.corp.hq.push(card);
    eminentDomainFlow.askIf(ctx, 'rd-server', installAmongQuestion(state, card.instanceId, installAndRezOptions(state, card, 0, true)), { cardId: card.instanceId, install: true });
  }),
  'rd-server': choice<InstallData>(({ state }, a, data) => installAndRez(state, data.cardId, a.optionId, 0, true)),
});

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
        eminentDomainFlow.evenIfNone(
          ctx,
          'corp',
          cards.length > 0,
          () =>
            eminentDomainFlow.cards(ctx, 'hq', {
              side: 'corp',
              message: 'Eminent Domain: install and rez 1 card from HQ, paying 5 [credit] less in total.',
              candidateIds: ids(cards),
              min: 0,
              max: 1,
            }),
          'Eminent Domain: no card in HQ you can install and rez.',
        );
      },
    },
  ],
  triggers: {
    agenda_scored: onScore(ctx => {
      const cards = ctx.state.corp.rd.filter(rezzable);
      eminentDomainFlow.cards(ctx, 'search', {
        side: 'corp',
        message: 'Eminent Domain: you may search R&D for 1 card to install and rez, ignoring all costs.',
        candidateIds: ids(cards),
        min: 0,
        max: 1,
      });
    }),
  },
  ...eminentDomainFlow.script,
};

// The Basalt Spire: When the Runner steals this agenda, you may add 1 card from Archives to HQ.
// When you score this agenda, place 2 agenda counters on it. Once per turn -> Hosted agenda counter,
// trash the top card of R&D: Add 1 card from Archives to HQ.
const basaltFlow = prompts({
  archives: cards(({ state }, a) => archivesToHQ(state, a.ids[0], 'The Basalt Spire')),
});

const askArchivesToHQ = (ctx: EffectContext, optional: boolean) => {
  const cards = archivesCards(ctx.state);
  if (cards.length === 0) return;
  basaltFlow.cards(ctx, 'archives', {
    side: 'corp',
    message: `${title(ctx.card)}: ${optional ? 'you may add' : 'add'} 1 card from Archives to HQ.`,
    candidateIds: ids(cards),
    min: optional ? 0 : 1,
    max: 1,
  });
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
  ...basaltFlow.script,
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
