import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { runnerSeesRd } from '../../../engine/rdKnowledge';
import { addLog } from '../../../engine/log';
import { findInstalledCorpCard, removeCard, turnKey } from '../../../engine/helpers';
import { dealNetDamage, giveTags, uninstallRunnerCard } from '../../../engine/damage';
import { endTheRun } from '../../../engine/runEnd';
import {
  addCounters,
  availableCredits,
  corpTrashFromHQ,
  counters,
  derez,
  drawForEffect,
  gainFromCard,
  removeTags,
  spendCredits,
  takeHostedCredits,
  useOncePerTurn,
} from '../../../engine/cardEffects';
import { choice, prompts } from '../../steps';
import { CardScript, EffectContext } from '../../types';
import { advanceableInstalled, arrangeNext, arrangeTop, askCards, askChoice, askCorpInstall, installCorpChoice } from '../../effects';
import { archivesCards, askPlaceAdvancement, ids, installable, installedCorpCards, picked, placeAdvancement, returnInstalledToHQ, said, serverOf, title, type, yesNo } from './helpers';

const isUnprotected = (state: GameState, card: CardInstance) => (serverOf(state, card)?.ice.length ?? 0) === 0;

// Wage Workers: Whenever you finish taking an action, if you have taken that action exactly 3
// times this turn, gain [click].
export const wageWorkers: CardScript = {
  triggers: {
    action_finished: ({ state }, e) => {
      if (e.side !== 'corp' || e.count !== 3 || state.activePlayer !== 'corp') return;
      state.corp.clicks += 1;
      addLog(state, 'corp', 'Corp gained [click] (Wage Workers).');
    },
  },
};

// Front Company: Rez only during your turn. The first run each turn cannot be made against a
// remote server. The first time each turn a run on Archives begins, if this server is not
// protected by ice, do 2 net damage.
export const frontCompany: CardScript = {
  rezBlocker: (state, card, cost) => {
    if (state.activePlayer !== 'corp') return 'Rez only during your turn';
    return availableCredits(state, 'corp', { kind: 'rez', card }) < cost ? 'Not enough credits to rez' : null;
  },
  modifiers: {
    runBlocker: (state, _self, serverId) =>
      state.runsThisTurn.length === 0 && state.corp.servers[serverId]?.isRemote ? 'The first run each turn cannot be made against a remote server (Front Company)' : null,
  },
  triggers: {
    run_begins: (ctx, e) => {
      if (e.server !== 'archives' || !useOncePerTurn(ctx.state, `front-archives:${ctx.card.instanceId}`)) return;
      if (isUnprotected(ctx.state, ctx.card)) dealNetDamage(ctx.state, 2);
    },
  },
};

// Balanced Coverage: When your turn begins, you may choose a card type to look at the top card of
// R&D. If that card has the chosen type, you may reveal it and gain 2 credits.
const CORP_TYPES = ['agenda', 'asset', 'upgrade', 'operation', 'ice'];

const balancedFlow = prompts({
  type: choice((ctx, a) => {
    const { state } = ctx;
    const top = state.corp.rd[0];
    if (!top || a.optionId === 'no') return;
    addLog(state, 'corp', `Corp named ${a.optionId} and looked at the top card of R&D (Balanced Coverage).`);
    // Asked even on a miss when the Corp's stops are on ALL, so the wait doesn't tell the Runner the type matched (4.2.2)
    balancedFlow.evenIfNone(
      ctx,
      'corp',
      type(top) === a.optionId,
      () =>
        balancedFlow.choice(ctx, 'reveal', {
          side: 'corp',
          message: `Balanced Coverage: the top card is ${title(top)}. Reveal it to gain 2 [credit]?`,
          options: yesNo('Reveal and gain 2 [credit]'),
        }),
      `Balanced Coverage: the top card is ${title(top)}, not the type you named.`,
    );
  }),
  reveal: choice((ctx, a) => {
    const { state } = ctx;
    const top = state.corp.rd[0];
    if (!top || a.optionId !== 'yes') return;
    runnerSeesRd(state, top);
    gainFromCard(state, 'corp', 2, ctx.card);
    addLog(state, 'corp', `Corp revealed ${title(top)} from the top of R&D and gained 2 [credit] (Balanced Coverage).`, top.cardCode);
  }),
});

export const balancedCoverage: CardScript = {
  triggers: {
    turn_begins: (ctx, e) => {
      if (e.side !== 'corp' || ctx.state.corp.rd.length === 0) return;
      balancedFlow.choice(ctx, 'type', {
        side: 'corp',
        message: 'Balanced Coverage: choose a card type to look at the top card of R&D?',
        options: [...CORP_TYPES.map(t => ({ id: t, label: t[0].toUpperCase() + t.slice(1) })), { id: 'no', label: 'Do not look' }],
      });
    },
  },
  ...balancedFlow.script,
};

// Behold! (Ambush): While the Runner is accessing this asset in R&D, they must reveal it. When the
// Runner accesses this asset anywhere except in Archives, you may pay 4 credits to give them 2 tags.
export const behold: CardScript = {
  revealedOnRdAccess: true,
  onAccessed: (ctx, where) => {
    if (where === 'archives') return;
    if (availableCredits(ctx.state, 'corp') < 4) {
      addLog(ctx.state, 'corp', 'Behold!: the Corp has less than 4 [credit], so it cannot give the Runner 2 tags.');
      return;
    }
    askChoice(ctx, 'corp', 'Behold!: pay 4 [credit] to give the Runner 2 tags?', yesNo('Pay 4 [credit]'), 'tags');
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (!said(answer) || availableCredits(state, 'corp') < 4) return;
    spendCredits(state, 'corp', 4);
    giveTags(state, 2);
  },
};

// Federal Fundraising: When your turn begins, you may look at the top 3 cards of R&D and arrange
// them in any order. Then, if this server is not protected by ice, you may draw 1 card.
export const federalFundraising: CardScript = {
  triggers: {
    turn_begins: (ctx, e) => {
      if (e.side !== 'corp') return;
      if (ctx.state.corp.rd.length > 0) {
        askChoice(ctx, 'corp', 'Federal Fundraising: look at the top 3 cards of R&D and arrange them?', yesNo('Look and arrange'), 'look');
      } else fundraisingDraw(ctx);
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'look') {
      if (said(answer)) {
        addLog(state, 'corp', 'Corp looked at the top 3 cards of R&D (Federal Fundraising).');
        arrangeTop(ctx, ids(state.corp.rd.slice(0, 3)), 'arrange');
      }
      if (!arranging(ctx)) fundraisingDraw(ctx);
    } else if (source.step === 'arrange' && answer.kind === 'effect_cards') {
      arrangeNext(ctx, source.data, answer.cardInstanceIds[0], 'arrange');
      if (!arranging(ctx)) fundraisingDraw(ctx);
    } else if (source.step === 'draw' && said(answer)) {
      drawForEffect(state, 'corp', 1, 'Federal Fundraising');
    }
  },
};

const arranging = (ctx: EffectContext) => ctx.state.pendingPrompts.some(p => 'source' in p && p.source.instanceId === ctx.card.instanceId && p.source.step === 'arrange');

function fundraisingDraw(ctx: EffectContext): void {
  if (isUnprotected(ctx.state, ctx.card) && ctx.state.corp.rd.length > 0) askChoice(ctx, 'corp', 'Federal Fundraising: draw 1 card?', yesNo('Draw 1 card'), 'draw');
}

// Cybersand Harvester: Whenever you rez a piece of ice, place 2 credits on this asset. You can
// spend hosted credits to pay install costs. [trash]: Take all credits from this asset.
export const cybersandHarvester: CardScript = {
  triggers: {
    rezzed: (ctx, e) => {
      if (type(e.card) !== 'ice') return;
      addCounters(ctx.card, 'credit', 2);
      addLog(ctx.state, 'corp', 'Cybersand Harvester: 2 [credit] placed on it.');
    },
  },
  paysFor: (_state, _self, purpose) => purpose.kind === 'install',
  abilities: [
    {
      label: 'Take all credits from this asset.',
      trashSelf: true,
      resolve: ({ state, card }) => void takeHostedCredits(state, card, counters(card, 'credit')),
    },
  ],
};

// B-1001 (Bioroid - Enforcer): Remove 1 tag: End the run. Use this ability only during a run
// against another server.
export const b1001: CardScript = {
  abilities: [
    {
      label: 'Remove 1 tag: end the run.',
      canUse: ({ state, card }) => {
        const run = state.activeRun;
        if (!run || run.accessOnly || serverOf(state, card)?.id === run.server) return 'Use this only during a run against another server';
        return state.runner.tags > 0 ? null : 'The Runner has no tag to remove';
      },
      resolve: ({ state }) => {
        removeTags(state, 1);
        endTheRun(state);
      },
    },
  ],
};

// --- Rebellion Without Rehearsal ---------------------------------------------------

// Warm Reception: When your turn begins, you may install 1 card from HQ. You cannot score that card
// this turn. If this server is not protected by ice, you may derez this asset to derez another installed card.
export const warmReception: CardScript = {
  triggers: {
    turn_begins: (ctx, e) => {
      if (e.side !== 'corp') return;
      const cards = installable(ctx.state, ctx.state.corp.hq);
      if (cards.length > 0) askCards(ctx, 'corp', 'Warm Reception: you may install 1 card from HQ (you cannot score it this turn).', ids(cards), 0, 1, 'pick');
      else warmDerez(ctx);
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'pick') {
      const id = picked(answer)[0];
      if (!id || !askCorpInstall(ctx, id, 'server')) warmDerez(ctx);
    } else if (source.step === 'server') {
      const serverId = installCorpChoice(state, source, answer);
      const card = serverId && findInstalledCorpCard(state, source.data?.cardId as string)?.card;
      if (card) card.cannotScoreTurn = turnKey(state);
      warmDerez(ctx);
    } else if (source.step === 'derez') {
      const target = installedCorpCards(state).find(c => c.instanceId === picked(answer)[0]);
      if (!target || !ctx.card.isRezzed) return;
      derez(state, ctx.card);
      derez(state, target);
    }
  },
};

function warmDerez(ctx: EffectContext): void {
  const { state, card } = ctx;
  if (!card.isRezzed || !isUnprotected(state, card)) return;
  const others = installedCorpCards(state).filter(c => c.isRezzed && c.instanceId !== card.instanceId);
  if (others.length > 0) askCards(ctx, 'corp', 'Warm Reception: you may derez it to derez another installed card.', ids(others), 0, 1, 'derez');
}

// Working Prototype (Hostile): Whenever you rez a card (including this asset), place 1 power
// counter on this asset. [click], hosted power counter: Gain 3 credits. [click], 5 hosted power
// counters: Gain 6 credits. Add 1 installed resource to the top of the stack.
export const workingPrototype: CardScript = {
  triggers: {
    rezzed: (ctx, e) => {
      if (cardDef(e.card).side_code === 'corp') addCounters(ctx.card, 'power', 1);
    },
  },
  abilities: [
    {
      label: 'Gain 3 [credit].',
      clicks: 1,
      counters: { type: 'power', count: 1 },
      resolve: ({ state, card }) => {
        gainFromCard(state, 'corp', 3, card);
        addLog(state, 'corp', 'Corp gained 3 [credit] (Working Prototype).');
      },
    },
    {
      label: 'Gain 6 [credit]. Add 1 installed resource to the top of the stack.',
      clicks: 1,
      counters: { type: 'power', count: 5 },
      resolve: ctx => {
        const { state, card } = ctx;
        gainFromCard(state, 'corp', 6, card);
        addLog(state, 'corp', 'Corp gained 6 [credit] (Working Prototype).');
        const resources = state.runner.rig.resources;
        if (resources.length > 0) askCards(ctx, 'corp', 'Working Prototype: add 1 installed resource to the top of the stack.', ids(resources), 1, 1, 'resource');
      },
    },
  ],
  onPromptAnswer: ({ state }, _source, answer) => {
    const resource = state.runner.rig.resources.find(c => c.instanceId === picked(answer)[0]);
    if (!resource) return;
    uninstallRunnerCard(state, resource, 'stackTop');
    addLog(state, 'corp', `Corp added ${title(resource)} to the top of the stack (Working Prototype).`);
  },
};

// Charlotte Caçador (Clone): You can advance this asset. When your turn begins, you may remove 1
// hosted advancement counter to gain 4 credits and draw 1 card. [trash], hosted advancement
// counter: Gain 3 credits.
export const charlotte: CardScript = {
  triggers: {
    turn_begins: (ctx, e) => {
      if (e.side !== 'corp' || ctx.card.advancementCounters === 0) return;
      askChoice(ctx, 'corp', 'Charlotte Caçador: remove 1 advancement counter to gain 4 [credit] and draw 1 card?', yesNo('Remove 1 counter'), 'use');
    },
  },
  abilities: [
    {
      label: 'Hosted advancement counter: gain 3 [credit].',
      trashSelf: true,
      canUse: ({ card }) => (card.advancementCounters > 0 ? null : 'Needs a hosted advancement counter'),
      resolve: ({ state, card }) => {
        card.advancementCounters -= 1;
        gainFromCard(state, 'corp', 3, card);
        addLog(state, 'corp', 'Corp gained 3 [credit] (Charlotte Caçador).');
      },
    },
  ],
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (!said(answer) || card.advancementCounters === 0) return;
    card.advancementCounters -= 1;
    gainFromCard(state, 'corp', 4, card);
    addLog(state, 'corp', 'Corp gained 4 [credit] (Charlotte Caçador).');
    drawForEffect(state, 'corp', 1, 'Charlotte Caçador');
  },
};

// Cohort Guidance Program (Clone): When your turn begins, you may resolve 1 of the following:
// Trash 1 card from HQ. If you do, gain 2 credits and draw 1 card. / Turn 1 facedown card in
// Archives faceup. If you do, place 1 advancement counter on an installed card.
export const cohortGuidance: CardScript = {
  triggers: {
    turn_begins: (ctx, e) => {
      const { state } = ctx;
      if (e.side !== 'corp') return;
      const options = [
        ...(state.corp.hq.length > 0 ? [{ id: 'trash', label: 'Trash 1 card from HQ: gain 2 [credit] and draw 1' }] : []),
        ...(state.corp.archives.faceDown.length > 0 && installedCorpCards(state).length > 0 ? [{ id: 'flip', label: 'Turn a facedown Archives card faceup: place 1 advancement counter' }] : []),
      ];
      if (options.length > 0) askChoice(ctx, 'corp', 'Cohort Guidance Program: choose one, or neither.', [...options, { id: 'no', label: 'Neither' }], 'mode');
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'mode' && said(answer, 'trash')) {
      askCards(ctx, 'corp', 'Cohort Guidance Program: trash 1 card from HQ.', ids(state.corp.hq), 1, 1, 'hq');
    } else if (source.step === 'mode' && said(answer, 'flip')) {
      askCards(ctx, 'corp', 'Cohort Guidance Program: turn 1 facedown card in Archives faceup.', ids(state.corp.archives.faceDown), 1, 1, 'flip');
    } else if (source.step === 'hq' && corpTrashFromHQ(state, picked(answer)).length > 0) {
      gainFromCard(state, 'corp', 2, ctx.card);
      addLog(state, 'corp', 'Corp gained 2 [credit] (Cohort Guidance Program).');
      drawForEffect(state, 'corp', 1, 'Cohort Guidance Program');
    } else if (source.step === 'flip') {
      const card = state.corp.archives.faceDown.find(c => c.instanceId === picked(answer)[0]);
      if (!card) return;
      removeCard(state.corp.archives.faceDown, card);
      state.corp.archives.faceUp.push(card);
      addLog(state, 'corp', `Corp turned ${title(card)} faceup in Archives (Cohort Guidance Program).`);
      askPlaceAdvancement(ctx, 1, 'place', false);
    } else if (source.step === 'place') {
      placeAdvancement(state, picked(answer)[0], 1, 'Cohort Guidance Program');
    }
  },
};

// Janaína "JK" Dumont Kindelán (Academic - Clone): When your turn begins, place 3 credits on this
// asset. [click], add this asset to HQ: Take all credits from this asset. You may install 1 card from HQ.
export const janaina: CardScript = {
  triggers: {
    turn_begins: (ctx, e) => {
      if (e.side !== 'corp') return;
      addCounters(ctx.card, 'credit', 3);
      addLog(ctx.state, 'corp', 'Janaína "JK" Dumont Kindelán: 3 [credit] placed on it.');
    },
  },
  abilities: [
    {
      label: 'Add this asset to HQ: take all credits from it. You may install 1 card from HQ.',
      clicks: 1,
      resolve: ctx => {
        const { state, card } = ctx;
        const credits = counters(card, 'credit');
        returnInstalledToHQ(state, card);
        gainFromCard(state, 'corp', credits, card);
        addLog(state, 'corp', `Corp added Janaína "JK" Dumont Kindelán to HQ and took ${credits} [credit].`);
        const cards = installable(state, state.corp.hq);
        if (cards.length > 0) askCards(ctx, 'corp', 'Janaína "JK" Dumont Kindelán: you may install 1 card from HQ.', ids(cards), 0, 1, 'pick');
      },
    },
  ],
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'pick') {
      const id = picked(answer)[0];
      if (id) askCorpInstall(ctx, id, 'server');
    } else if (source.step === 'server') installCorpChoice(ctx.state, source, answer);
  },
};

// Hearts and Minds (Political): When your turn begins, you may move 1 advancement counter from an
// installed card to an installed card you can advance. If this server is not protected by ice, you
// may also place 1 advancement counter on an installed card you can advance.
export const heartsAndMinds: CardScript = {
  triggers: {
    turn_begins: (ctx, e) => {
      if (e.side !== 'corp') return;
      const sources = installedCorpCards(ctx.state).filter(c => c.advancementCounters > 0);
      if (sources.length > 0 && advanceableInstalled(ctx.state).length > 0) {
        askCards(ctx, 'corp', 'Hearts and Minds: you may move 1 advancement counter from an installed card...', ids(sources), 0, 1, 'from');
      } else heartsPlace(ctx);
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'from') {
      const from = picked(answer)[0];
      const targets = advanceableInstalled(state).filter(c => c.instanceId !== from);
      if (from && targets.length > 0) askCards(ctx, 'corp', 'Hearts and Minds: ...to an installed card you can advance.', ids(targets), 1, 1, 'to', { from });
      else heartsPlace(ctx);
    } else if (source.step === 'to') {
      const from = findInstalledCorpCard(state, source.data?.from as string)?.card;
      const to = findInstalledCorpCard(state, picked(answer)[0])?.card;
      if (from && to && from.advancementCounters > 0) {
        from.advancementCounters -= 1;
        to.advancementCounters += 1;
        addLog(state, 'corp', 'Corp moved 1 advancement counter (Hearts and Minds).');
      }
      heartsPlace(ctx);
    } else if (source.step === 'place') {
      placeAdvancement(state, picked(answer)[0], 1, 'Hearts and Minds');
    }
  },
};

function heartsPlace(ctx: EffectContext): void {
  const cards = advanceableInstalled(ctx.state);
  if (isUnprotected(ctx.state, ctx.card) && cards.length > 0) {
    askCards(ctx, 'corp', 'Hearts and Minds: you may also place 1 advancement counter on an installed card you can advance.', ids(cards), 0, 1, 'place');
  }
}

// The Powers That Be (Ritzy): Whenever you score an agenda, you may install 1 card from HQ or
// Archives, ignoring all costs.
export const powersThatBe: CardScript = {
  triggers: {
    agenda_scored: ctx => {
      const cards = installable(ctx.state, [...ctx.state.corp.hq, ...archivesCards(ctx.state)], { ignoreCosts: true });
      if (cards.length > 0) askCards(ctx, 'corp', 'The Powers That Be: you may install 1 card from HQ or Archives, ignoring all costs.', ids(cards), 0, 1, 'pick');
    },
  },
  onPromptAnswer: (ctx, source, answer) => {
    if (source.step === 'pick') {
      const id = picked(answer)[0];
      if (id) askCorpInstall(ctx, id, 'server', { ignoreCosts: true });
    } else if (source.step === 'server') installCorpChoice(ctx.state, source, answer, { ignoreCosts: true });
  },
};

export const liberationCorpAssetsScripts: Record<string, CardScript> = {
  '34033': wageWorkers,
  '34041': frontCompany,
  '34050': balancedCoverage,
  '34051': behold,
  '34052': federalFundraising,
  '34058': cybersandHarvester,
  '34065': b1001,
  '34098': warmReception,
  '34099': workingPrototype,
  '34107': charlotte,
  '34108': cohortGuidance,
  '34115': janaina,
  '34124': heartsAndMinds,
  '34130': powersThatBe,
};
