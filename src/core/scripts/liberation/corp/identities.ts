import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { corpSeesRd, noteRdPrivate } from '../../../engine/rdKnowledge';
import { addLog } from '../../../engine/log';
import { findInstalledCorpCard, turnKey } from '../../../engine/helpers';
import { installedRunnerCards, trashInstalledRunnerCard } from '../../../engine/damage';
import { endTheRun } from '../../../engine/runEnd';
import { grantRunSubroutines } from '../../../engine/ice';
import { addCounters, useOncePerTurn } from '../../../engine/cardEffects';
import { CardScript, EffectContext } from '../../types';
import { corpInstallOptions, installCorpChoice } from '../../effects';
import { cards, cardsQuestion, choice, choiceQuestion, InstallData, prompts } from '../../steps';
import { hasKeyword, ids, installable, installAmongQuestion, onceKey, serverOf, title, trashTopOfRD, type } from './helpers';

// A Teia: IP Recovery: Limit 2 remote servers. The first time each turn you install a card in the
// root of or protecting a remote server, you may install 1 card from HQ in the root of or
// protecting another remote server, ignoring all costs. You cannot score the second card this turn.
const aTeiaFlow = prompts({
  pick: cards<{ from: string }>((ctx, a, data) => {
    const { state } = ctx;
    const id = a.ids[0];
    const card = id && state.corp.hq.find(c => c.instanceId === id);
    if (card) aTeiaFlow.askIf(ctx, 'server', installAmongQuestion(state, id, aTeiaOptions(state, card, data.from)), { cardId: id, install: true });
  }),
  server: choice<InstallData>(({ state }, a, data, source) => {
    const serverId = installCorpChoice(state, source, a.raw, { ignoreCosts: true });
    const card = serverId && findInstalledCorpCard(state, data.cardId)?.card;
    if (card) card.cannotScoreTurn = turnKey(state);
  }),
});

export const aTeia: CardScript = {
  maxRemotes: 2,
  triggers: {
    installed: (ctx, e) => {
      const { state } = ctx;
      if (cardDef(e.card).side_code !== 'corp' || state.activePlayer !== 'corp') return;
      const server = serverOf(state, e.card);
      if (!server?.isRemote || !useOncePerTurn(state, onceKey(ctx.card))) return;
      const cards = state.corp.hq.filter(c => type(c) !== 'operation' && aTeiaOptions(state, c, server.id).length > 0);
      // Asked even with nothing to install when the Corp's stops are on ALL (4.3.2, see askEvenIfNone)
      aTeiaFlow.evenIfNone(
        ctx,
        'corp',
        cards.length > 0,
        () =>
          aTeiaFlow.ask(
            ctx,
            'pick',
            cardsQuestion('corp', 'A Teia: you may install 1 card from HQ in or protecting another remote server, ignoring all costs.', ids(cards), 0, 1),
            { from: server.id },
          ),
        'A Teia: no card in HQ you can install in another remote server.',
      );
    },
  },
  ...aTeiaFlow.script,
};

/** Another remote server (an existing one or, within the limit, a new one). */
const aTeiaOptions = (state: GameState, card: CardInstance, from: string) =>
  corpInstallOptions(state, card, { ignoreCosts: true }).filter(o => o.id !== from && (o.id === 'new' || state.corp.servers[o.id]?.isRemote));

// Epiphany Analytica: Nations Undivided: The first time each turn the Runner steals or trashes a
// Corp card, place 1 power counter on this identity. [click], hosted power counter: Look at the
// top 3 cards of R&D. You may install 1 of those cards.
const epiphanyCounter = (ctx: EffectContext) => {
  if (useOncePerTurn(ctx.state, onceKey(ctx.card))) {
    addCounters(ctx.card, 'power', 1);
    addLog(ctx.state, 'corp', 'Epiphany Analytica gained 1 power counter.');
  }
};

const epiphanyFlow = prompts({
  pick: cards((ctx, a) => {
    if (a.ids[0]) epiphanyFlow.corpInstall(ctx, a.ids[0], 'server');
  }),
  server: choice<InstallData>((ctx, a, _d, source) => void installCorpChoice(ctx.state, source, a.raw)),
});

export const epiphany: CardScript = {
  triggers: { agenda_stolen: epiphanyCounter, runner_trashed_corp_card: epiphanyCounter },
  abilities: [
    {
      label: 'Look at the top 3 cards of R&D. You may install 1 of them.',
      clicks: 1,
      counters: { type: 'power', count: 1 },
      resolve: ctx => {
        const top = ctx.state.corp.rd.slice(0, 3);
        noteRdPrivate(ctx.state, top.length);
        corpSeesRd(ctx.state, top); // the Corp looks at them (10.2.2b)
        const cards = installable(ctx.state, top);
        addLog(ctx.state, 'corp', 'Corp looked at the top 3 cards of R&D (Epiphany Analytica).');
        if (cards.length > 0) epiphanyFlow.ask(ctx, 'pick', cardsQuestion('corp', 'Epiphany Analytica: you may install 1 of the top 3 cards of R&D.', ids(cards), 0, 1));
      },
    },
  ],
  ...epiphanyFlow.script,
};

// Thunderbolt Armaments: Peace Through Power: Whenever you rez a piece of AP or destroyer ice
// during a run, that ice gets +1 strength and gains "End the run unless the Runner trashes 1 of
// their installed cards." after its other subroutines for the remainder of that run.
const THUNDERBOLT = '34096';

const thunderboltFlow = prompts({
  etr: choice(({ state }, a) => {
    const target = installedRunnerCards(state).find(c => c.instanceId === a.optionId);
    if (!target) return endTheRun(state);
    trashInstalledRunnerCard(state, target);
    addLog(state, 'runner', `Runner trashed ${title(target)} (Thunderbolt Armaments).`);
  }),
});

export const thunderbolt: CardScript = {
  grantedSubroutines: [
    {
      label: 'End the run unless the Runner trashes 1 of their installed cards.',
      resolve: ({ state }) => {
        const mine = installedRunnerCards(state);
        if (mine.length === 0) return endTheRun(state);
        const ctx = { state, card: state.corp.identity, side: 'corp' as const };
        thunderboltFlow.ask(
          ctx,
          'etr',
          choiceQuestion('runner', 'Thunderbolt Armaments: trash 1 of your installed cards, or the run ends.', [
            ...mine.map(c => ({ id: c.instanceId, label: `Trash ${title(c)}` })),
            { id: 'end', label: 'End the run' },
          ]),
        );
      },
    },
  ],
  triggers: {
    rezzed: ({ state }, e) => {
      const run = state.activeRun;
      if (!run || run.accessOnly || type(e.card) !== 'ice' || !(hasKeyword(e.card, 'ap') || hasKeyword(e.card, 'destroyer'))) return;
      run.iceRunStrength ??= {};
      run.iceRunStrength[e.card.instanceId] = (run.iceRunStrength[e.card.instanceId] ?? 0) + 1;
      grantRunSubroutines(state, e.card, THUNDERBOLT, 0);
      addLog(state, 'corp', `${title(e.card)} gets +1 strength and a subroutine for this run (Thunderbolt Armaments).`);
    },
  },
  ...thunderboltFlow.script,
};

// Nuvem SA: Law of the Land: Whenever you finish resolving an operation or an action on an
// expendable card, look at the top card of R&D. You may trash that card. The first time you trash
// a card from R&D during each of your turns, gain 2 credits.
const nuvemFlow = prompts({
  look: choice<{ topId: string }>(({ state }, a, data) => {
    if (a.optionId === 'trash' && state.corp.rd[0]?.instanceId === data.topId) trashTopOfRD(state, 'Nuvem SA');
  }),
});

const nuvemLook = (ctx: EffectContext) => {
  const top = ctx.state.corp.rd[0];
  if (!top) return;
  noteRdPrivate(ctx.state, 1);
  corpSeesRd(ctx.state, [top]); // the Corp looks at it (10.2.2b)
  nuvemFlow.ask(
    ctx,
    'look',
    choiceQuestion('corp', `Nuvem SA: the top card of R&D is ${title(top)}. Trash it?`, [
      { id: 'trash', label: `Trash ${title(top)}` },
      { id: 'no', label: 'Leave it' },
    ]),
    { topId: top.instanceId },
  );
};

export const nuvem: CardScript = {
  triggers: {
    operation_finished: ctx => nuvemLook(ctx),
    expendable_action_finished: ctx => nuvemLook(ctx),
  },
  ...nuvemFlow.script,
};

export const liberationCorpIdentitiesScripts: Record<string, CardScript> = {
  '34039': aTeia,
  '34048': epiphany,
  '34096': thunderbolt,
  '34121': nuvem,
};
