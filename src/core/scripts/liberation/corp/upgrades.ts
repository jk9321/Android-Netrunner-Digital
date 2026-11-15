import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { shuffleRD } from '../../../engine/rdKnowledge';
import { addLog } from '../../../engine/log';
import { removeCard } from '../../../engine/helpers';
import { dealMeatDamage } from '../../../engine/damage';
import { availableCredits, corpTrashFromHQ, derez, installedIce, moveUpgrade, spendCredits, threatLevel, turnFlag, TurnFlag, upgradeAllowedIn, useOncePerTurn } from '../../../engine/cardEffects';
import { CardScript, EffectContext } from '../../types';
import { answerPsiGame, askCards, askChoice, playPsiGame, takeFromRD } from '../../effects';
import { askInstallAmong, askPlaceAdvancement, ids, installAndRez, installAndRezOptions, onceKey, picked, placeAdvancement, runOnServerOf, said, serverOf, title, type, yesNo } from './helpers';

/** "When your turn ends, you may move this upgrade to the root of another server." */
function askMoveUpgrade(ctx: EffectContext, step = 'move'): void {
  const from = serverOf(ctx.state, ctx.card);
  if (!from) return;
  const targets = Object.values(ctx.state.corp.servers).filter(s => s.id !== from.id && upgradeAllowedIn(ctx.state, ctx.card, s.id));
  if (targets.length === 0) return;
  askChoice(ctx, 'corp', `${title(ctx.card)}: move it to the root of another server?`, [...targets.map(s => ({ id: s.id, label: s.name })), { id: 'no', label: 'Stay' }], step);
}

const corpTurnEnds = (e: { side: string }) => e.side === 'corp';

// --- The Automata Initiative ------------------------------------------------------

// Vovô Ozetti (Sysop): The rez cost of each piece of ice protecting this server is lowered by 2.
// Threat 4 -> The rez cost of each card in the root of this server is lowered by 2. When your
// turn ends, you may move this upgrade to the root of another server.
export const vovo: CardScript = {
  modifiers: {
    rezCost: (state, self, rezzing) => {
      const server = serverOf(state, self);
      if (!server) return 0;
      if (server.ice.includes(rezzing)) return -2;
      if (server.root.includes(rezzing) && threatLevel(state) >= 4) return -2;
      return 0;
    },
  },
  triggers: { discard_phase_ends: (ctx, e) => corpTurnEnds(e) && askMoveUpgrade(ctx) },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind === 'effect_choice' && answer.optionId !== 'no') moveUpgrade(state, card, answer.optionId);
  },
};

// Adrian Seis (Psi - Clone - Sysop): Whenever the Runner makes a successful run on this server,
// play a Psi Game. If the bids differ, the Runner cannot access cards other than this upgrade
// for the remainder of that run. If the bids match, the Runner cannot access this upgrade for the
// remainder of that run. When your turn ends, you may move this upgrade to the root of another server.
export const adrianSeis: CardScript = {
  triggers: {
    successful_run: (ctx, e) => {
      if (serverOf(ctx.state, ctx.card)?.id === e.server) playPsiGame(ctx, 'psi');
    },
    discard_phase_ends: (ctx, e) => corpTurnEnds(e) && askMoveUpgrade(ctx),
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state, card } = ctx;
    if (
      answerPsiGame(ctx, source, answer, match => {
        const run = state.activeRun;
        if (!run) return;
        if (match) {
          run.noAccessIds = [...(run.noAccessIds ?? []), card.instanceId];
          addLog(state, 'corp', 'Adrian Seis: the Runner cannot access it this run.');
        } else {
          run.accessOnlyIds = [card.instanceId];
          addLog(state, 'corp', 'Adrian Seis: the Runner cannot access cards other than Adrian Seis this run.');
        }
      })
    )
      return;
    if (source.step === 'move' && answer.kind === 'effect_choice' && answer.optionId !== 'no') moveUpgrade(state, card, answer.optionId);
  },
};

// Daniela Jorge Inácio (Sysop): As an additional cost to trash this upgrade, the Runner must add 2
// cards from the grip at random to the bottom of the stack. Persistent -> As an additional cost to
// steal an agenda from this server or its root, the Runner must add 2 cards from the grip at random
// to the bottom of the stack.
export const daniela: CardScript = {
  trashGripCost: 2,
  persistent: true,
  stealCost: (state, self) => {
    const run = state.activeRun;
    if (!run || run.accessOnly) return null;
    const where = serverOf(state, self)?.id ?? run.persistentServers[self.instanceId];
    return where === run.server ? { gripToBottom: 2 } : null;
  },
};

// Angelique Garza Correa (Ambush - Enforcer - Expendable): Threat 3 -> [click], 1 credit, reveal
// and trash this upgrade from HQ: Do 1 meat damage. When the Runner accesses this upgrade while it
// is rezzed, you may pay 2 credits to do 2 meat damage.
export const angelique: CardScript = {
  abilities: [
    {
      label: 'Reveal and trash this upgrade from HQ: do 1 meat damage.',
      fromHQ: true,
      clicks: 1,
      credits: 1,
      canUse: ({ state }) => (threatLevel(state) >= 3 ? null : 'The threat level must be 3 or greater'),
      resolve: ({ state, card }) => {
        corpTrashFromHQ(state, [card.instanceId], true);
        addLog(state, 'corp', 'Corp revealed and trashed Angelique Garza Correa from HQ.');
        dealMeatDamage(state, 1);
      },
    },
  ],
  onAccessed: (ctx, where) => {
    if (where !== 'installed' || !ctx.card.isRezzed || availableCredits(ctx.state, 'corp') < 2) return;
    askChoice(ctx, 'corp', 'Angelique Garza Correa: pay 2 [credit] to do 2 meat damage?', yesNo('Pay 2 [credit]'), 'damage');
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (!said(answer) || availableCredits(state, 'corp') < 2) return;
    spendCredits(state, 'corp', 2);
    dealMeatDamage(state, 2);
  },
};

const tucanaServer = (state: GameState, self: CardInstance) =>
  serverOf(state, self)?.id ?? state.activeRun?.persistentServers[self.instanceId];

const tucanaSearch = (ctx: EffectContext) => {
  const ice = ctx.state.corp.rd.filter(c => type(c) === 'ice');
  askCards(ctx, 'corp', 'Tucana: you may search R&D for 1 piece of ice to install and rez, paying 3 [credit] less in total.', ids(ice), 0, 1, 'search');
};

export const tucana: CardScript = {
  installOnly: 'remote',
  persistent: true,
  triggers: {
    agenda_scored: (ctx, e) => e.serverId === tucanaServer(ctx.state, ctx.card) && tucanaSearch(ctx),
    agenda_stolen: (ctx, e) => !!e.serverId && e.serverId === tucanaServer(ctx.state, ctx.card) && tucanaSearch(ctx),
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (source.step === 'search') {
      const ice = picked(answer).length ? takeFromRD(state, picked(answer)[0]) : undefined;
      if (!ice) return shuffleRD(state);
      state.corp.rd.unshift(ice); // set aside where takeFromRD left it: back on top while the server is chosen
      const options = installAndRezOptions(state, ice, 3);
      if (!askInstallAmong(ctx, ice.instanceId, 'server', options)) {
        removeCard(state.corp.rd, ice);
        state.corp.rd.push(ice);
        shuffleRD(state);
      }
    } else if (source.step === 'server' && answer.kind === 'effect_choice') {
      installAndRez(state, source.data?.cardId as string, answer.optionId, 3);
      shuffleRD(state);
    }
  },
};

// Brasília Government Grid (Region): Once per turn -> When you rez a piece of ice during a run
// against this server, you may derez another installed piece of ice. If you do, the rezzed ice
// gets +3 strength for the remainder of that run.
export const brasilia: CardScript = {
  triggers: {
    rezzed: (ctx, e) => {
      const { state } = ctx;
      if (type(e.card) !== 'ice' || !runOnServerOf(state, ctx.card) || turnFlag(state, onceKey(ctx.card)) > 0) return;
      const others = installedIce(state).filter(c => c.isRezzed && c.instanceId !== e.card.instanceId);
      if (others.length > 0) askCards(ctx, 'corp', `Brasília Government Grid: you may derez another piece of ice to give ${title(e.card)} +3 strength this run.`, ids(others), 0, 1, 'derez', { iceId: e.card.instanceId });
    },
  },
  onPromptAnswer: ({ state, card }, source, answer) => {
    const other = installedIce(state).find(c => c.instanceId === picked(answer)[0]);
    const run = state.activeRun;
    if (!other || !run) return;
    useOncePerTurn(state, onceKey(card));
    derez(state, other);
    const iceId = source.data?.iceId as string;
    run.iceRunStrength ??= {};
    run.iceRunStrength[iceId] = (run.iceRunStrength[iceId] ?? 0) + 3;
    addLog(state, 'corp', 'The rezzed ice gets +3 strength for this run (Brasília Government Grid).');
  },
};

// The Holo Man (Academic - Executive - Sysop): When your turn begins, you may move this upgrade to
// the root of another server. Once per turn -> [click], 4 credits: Place 2 advancement counters on
// 1 card in the root of or protecting this server. If you have not installed any cards from HQ this
// turn, instead place 3 advancement counters on that card.
const holoManCount = (state: GameState) => (turnFlag(state, TurnFlag.installedFromHQ) > 0 ? 2 : 3);

export const holoMan: CardScript = {
  triggers: { turn_begins: (ctx, e) => e.side === 'corp' && askMoveUpgrade(ctx) },
  liveValue: state => `${holoManCount(state)} advancement counters`,
  abilities: [
    {
      label: 'Place 2 advancement counters on 1 card in or protecting this server (3 if you installed no card from HQ this turn).',
      clicks: 1,
      credits: 4,
      oncePerTurn: true,
      canUse: ({ state, card }) => ((serverOf(state, card)?.root.length ?? 0) + (serverOf(state, card)?.ice.length ?? 0) > 1 ? null : 'No other card in or protecting this server'),
      resolve: ctx => {
        const server = serverOf(ctx.state, ctx.card);
        if (!server) return;
        const n = holoManCount(ctx.state);
        askPlaceAdvancement(ctx, n, 'place', false, [...server.root, ...server.ice].filter(c => c.instanceId !== ctx.card.instanceId));
      },
    },
  ],
  onPromptAnswer: ({ state, card }, source, answer) => {
    if (source.step === 'move' && answer.kind === 'effect_choice' && answer.optionId !== 'no') moveUpgrade(state, card, answer.optionId);
    else if (source.step === 'place') placeAdvancement(state, picked(answer)[0], Number(source.data?.n ?? 2), 'The Holo Man');
  },
};

// Isaac Liberdade (Bioroid - Sysop): Each advanced piece of ice protecting this server gets +2
// strength. Whenever this upgrade moves to the root of a server, you may place 1 advancement counter
// on a piece of ice protecting that server that has no advancement counters. When your turn ends,
// you may move this upgrade to the root of another server.
const isaacPlace = (ctx: EffectContext) => {
  const ice = serverOf(ctx.state, ctx.card)?.ice.filter(c => c.advancementCounters === 0) ?? [];
  if (ice.length > 0) askCards(ctx, 'corp', 'Isaac Liberdade: you may place 1 advancement counter on a piece of ice protecting this server that has none.', ids(ice), 0, 1, 'place');
};

export const isaac: CardScript = {
  modifiers: {
    iceStrength: (state, self, ice) => (ice.advancementCounters > 0 && serverOf(state, self)?.ice.includes(ice) ? 2 : 0),
  },
  triggers: { discard_phase_ends: (ctx, e) => corpTurnEnds(e) && askMoveUpgrade(ctx) },
  onPromptAnswer: (ctx, source, answer) => {
    const { state, card } = ctx;
    if (source.step === 'move' && answer.kind === 'effect_choice' && answer.optionId !== 'no') {
      if (moveUpgrade(state, card, answer.optionId)) isaacPlace(ctx);
    } else if (source.step === 'place') placeAdvancement(state, picked(answer)[0], 1, 'Isaac Liberdade');
  },
};

export const liberationCorpUpgradesScripts: Record<string, CardScript> = {
  '34038': vovo,
  '34046': adrianSeis,
  '34047': daniela,
  '34063': angelique,
  '34064': tucana,
  '34104': brasilia,
  '34120': holoMan,
  '34129': isaac,
};
