import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { shuffleInPlace } from '../../../rng';
import { addLog } from '../../../engine/log';
import { findInstalledCorpCard, removeCard } from '../../../engine/helpers';
import { startRun, trashAccessedCard, cannotStealOrTrash } from '../../../engine/actions/run';
import {
  addCounters,
  counters,
  drawForEffect,
  installedIce,
  removeCounters,
  spendCredits,
  stealthCredits,
  swapIce,
} from '../../../engine/cardEffects';
import { approachServer, encounteredIce, iceSubtypes } from '../../../engine/ice';
import { CardScript, EffectContext } from '../../types';
import { gainCredits, iceLabel } from '../../effects';
import { cards, cardsQuestion, choice, choiceQuestion, prompts } from '../../steps';
import { ids, isInstalled, isSelf } from './helpers';
import { firstThisTurn } from '../../../engine/triggers';

/** True while the Runner is encountering ice and can still break (before subroutines fire). */
function inBreakWindow(state: GameState): boolean {
  const encounter = state.activeRun?.encounter;
  return Boolean(encounter && encounter.resolvingIndex === null && state.activeRun?.phase === 'encounter_ice' && !encounter.onEncounterPending);
}

// Corsair (Icebreaker - Fracter): Interface -> 1 credit: Break 1 barrier subroutine.
// 1 credit: The barrier you are encountering gets -3 strength for the remainder of this
// encounter. Spend credits only from stealth cards to use this ability.
export const corsair: CardScript = {
  breaker: { breaks: 'barrier', breakMax: 1, breakCost: () => 1, boostCost: 0, boostAmount: () => 0 },
  abilities: [
    {
      label: 'The barrier you are encountering gets -3 strength for this encounter (stealth credits only).',
      credits: 1,
      stealthOnly: true,
      canUse: ({ state }) => {
        if (!inBreakWindow(state)) return 'Only while encountering ice, before subroutines fire';
        const ice = encounteredIce(state);
        return ice && iceSubtypes(ice, state).includes('barrier') ? null : 'Only while encountering a barrier';
      },
      resolve: ({ state }) => {
        state.activeRun!.encounter!.iceStrengthModifier -= 3;
        addLog(state, 'runner', `${cardDef(encounteredIce(state)!).title} gets -3 strength for this encounter (Corsair).`);
      },
    },
  ],
};

// Lampades: When you install this program, place 3 power counters on it. Access -> Hosted
// power counter, pay the printed rez or play cost of the card you are accessing: Trash that
// card. Spend credits only from stealth cards to use this ability.
const printedCost = (card: CardInstance) => (['agenda'].includes(cardDef(card).type_code) ? null : cardDef(card).cost ?? null);

export const lampades: CardScript = {
  triggers: {
    installed: (ctx, e) => isSelf(ctx, e.card) && addCounters(ctx.card, 'power', 3),
  },
  accessAbility: {
    label: 'hosted power counter and its printed cost in stealth credits: trash it',
    canUse: ({ state, card }, accessed) => {
      const cost = printedCost(accessed);
      return counters(card, 'power') > 0 && cost !== null && stealthCredits(state) >= cost && !cannotStealOrTrash(state, accessed);
    },
    use: ({ state, card }, accessed) => {
      const cost = printedCost(accessed) ?? 0;
      removeCounters(card, 'power', 1);
      spendCredits(state, 'runner', cost, { kind: 'stealth' });
      addLog(state, 'runner', `Runner used Lampades (${cost} [credit]) to trash ${cardDef(accessed).title}.`);
      trashAccessedCard(state, accessed);
    },
  },
};

// Baker: Once per turn -> click: Run Archives. When you would approach Archives (after passing
// all ice), you may pay 1 credit to instead change the attacked server to HQ or R&D and
// approach that server. Spend credits only from stealth cards to pay this cost.
const bakerFlow = prompts({
  redirect: choice(({ state }, a) => {
    const run = state.activeRun;
    if (!run) return;
    if (a.optionId !== 'no' && stealthCredits(state) >= 1) {
      spendCredits(state, 'runner', 1, { kind: 'stealth' });
      run.server = a.optionId;
      const last = state.runsThisTurn[state.runsThisTurn.length - 1];
      if (last) last.server = a.optionId;
      addLog(state, 'runner', `The attacked server changed to ${state.corp.servers[a.optionId].name} (Baker).`);
    }
    approachServer(state);
  }),
});

export const baker: CardScript = {
  abilities: [
    {
      label: 'Run Archives (you may pay 1 stealth credit to approach HQ or R&D instead).',
      clicks: 1,
      oncePerTurn: true,
      resolve: ({ state, card }) => startRun(state, 'archives', { source: { cardCode: card.cardCode, instanceId: card.instanceId }, bakerRedirect: true }),
    },
  ],
  onWouldApproachServer: ctx => {
    const { state } = ctx;
    if (state.activeRun?.server !== 'archives' || stealthCredits(state) < 1) return false;
    bakerFlow.choice(ctx, 'redirect', choiceQuestion('runner', 'Baker: pay 1 stealth credit to approach HQ or R&D instead of Archives?', [
      { id: 'hq', label: 'Pay 1: approach HQ' },
      { id: 'rd', label: 'Pay 1: approach R&D' },
      { id: 'no', label: 'Approach Archives' },
    ]));
    return true;
  },
  ...bakerFlow.script,
};

// Read-Write Share: Limit 4 hosted cards. When you install this program and when your turn
// begins, you may host 1 card from your grip facedown on this program to draw 1 card.
// trash: Shuffle all hosted cards into your stack.
const askReadWrite = (ctx: EffectContext) => {
  const hosted = ctx.card.hostedCards ?? [];
  if (hosted.length >= 4 || ctx.state.runner.grip.length === 0) return;
  readWriteFlow.cards(ctx, 'host', cardsQuestion('runner', 'Read-Write Share: you may host 1 card from your grip facedown to draw 1 card.', ids(ctx.state.runner.grip), 0, 1));
};

const readWriteFlow = prompts({
  host: cards(({ state, card }, a) => {
    if (a.ids.length === 0 || !isInstalled(state, card)) return;
    const hosted = state.runner.grip.find(c => c.instanceId === a.ids[0]);
    if (!hosted) return;
    removeCard(state.runner.grip, hosted);
    card.hostedCards = [...(card.hostedCards ?? []), hosted];
    drawForEffect(state, 'runner', 1, 'Read-Write Share');
  }),
});

export const readWriteShare: CardScript = {
  hostedFaceDown: true,
  triggers: {
    installed: (ctx, e) => isSelf(ctx, e.card) && askReadWrite(ctx),
    turn_begins: (ctx, e) => e.side === 'runner' && askReadWrite(ctx),
  },
  abilities: [
    {
      label: 'Shuffle all hosted cards into your stack.',
      trashSelf: true,
      resolve: ({ state, card }) => {
        const hosted = card.hostedCards ?? [];
        state.runner.stack.push(...hosted);
        card.hostedCards = [];
        shuffleInPlace(state.rng, state.runner.stack);
        addLog(state, 'runner', `Runner shuffled ${hosted.length} hosted card(s) into their stack (Read-Write Share).`);
      },
    },
  ],
  ...readWriteFlow.script,
};

// Sipa: The first time each turn you pass the outermost piece of ice protecting a server
// after fully breaking it, you may swap it with another installed piece of ice.
const sipaFlow = prompts({
  swap: choice<{ iceId: string }>(({ state }, a, data) => {
    if (a.optionId === 'no') return;
    swapIce(state, String(data.iceId), a.optionId);
  }),
});

export const sipa: CardScript = {
  firstEachTurn: { ice_passed: (_state, e) => e.fullyBroken && e.outermost },
  triggers: {
    ice_passed: (ctx, e) => {
      const { state } = ctx;
      if (!e.fullyBroken || !e.outermost || !firstThisTurn(state, ctx.card)) return;
      const others = installedIce(state).filter(c => c.instanceId !== e.ice.instanceId);
      if (others.length === 0) return;
      sipaFlow.choice(ctx, 'swap', choiceQuestion('runner', `Sipa: you may swap ${cardDef(e.ice).title} with another installed piece of ice.`, [
        ...others.map(c => ({ id: c.instanceId, label: iceLabel(state, c) })),
        { id: 'no', label: 'No swap' },
      ]), { iceId: e.ice.instanceId });
    },
  },
  ...sipaFlow.script,
};

// Stowaway (Trojan): Install only on a piece of ice. Whenever you make a successful run on
// this server, gain 2 credits.
export const stowaway: CardScript = {
  installsOnIce: true,
  triggers: {
    successful_run: (ctx, e) => {
      const host = ctx.card.hostedOnId ? findInstalledCorpCard(ctx.state, ctx.card.hostedOnId) : null;
      if (host?.server.id !== e.server) return;
      gainCredits(ctx.state, 'runner', 2);
      addLog(ctx.state, 'runner', 'Runner gained 2 [credit] (Stowaway).');
    },
  },
};

// --- Resources --------------------------------------------------------------

export const vantageRunnerProgramsScripts: Record<string, CardScript> = {
  '36004': corsair,
  '36005': lampades,
  '36015': baker,
  '36022': readWriteShare,
  '36023': sipa,
  '36024': stowaway,
};
