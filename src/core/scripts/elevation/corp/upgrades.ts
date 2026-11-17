import { GameState } from '../../../types/state';
import { addLog } from '../../../engine/log';
import { findInstalledCorpCard, removeCard } from '../../../engine/helpers';
import { trashInstalledRunnerCard } from '../../../engine/damage';
import { trashInstalledCard } from '../../../engine/cardEffects';
import { CardScript } from '../../types';
import { gainCredits, installCorpChoice } from '../../effects';
import { cards, cardsQuestion, choice, choiceQuestion, InstallData, prompts } from '../../steps';
import { archivesCards, ids, installable, serverOf, type } from './helpers';

// Mercia B4LL4RD: When your action phase ends, you may install 1 piece of ice from HQ,
// paying 1 credit less. If you do, move this upgrade to the root of the server that piece of ice is protecting.
const merciaTargets = (state: GameState) => installable(state, state.corp.hq.filter(c => type(c) === 'ice'), { discount: 1 });

const merciaFlow = prompts({
  pick: cards((ctx, a) => {
    if (a.ids.length > 0) merciaFlow.corpInstall(ctx, a.ids[0], 'server', { discount: 1 });
  }),
  server: choice<InstallData>(({ state, card }, a, _d, source) => {
    const serverId = installCorpChoice(state, source, a.raw, { discount: 1 });
    const from = serverOf(state, card);
    if (!serverId || !from || from.id === serverId) return;
    removeCard(from.root, card);
    state.corp.servers[serverId].root.push(card);
    addLog(state, 'corp', `Mercia B4LL4RD moved to ${state.corp.servers[serverId].name}.`);
  }),
});

export const mercia: CardScript = {
  triggers: {
    action_phase_ends: (ctx, e) => {
      if (e.side !== 'corp') return;
      const ice = merciaTargets(ctx.state);
      // Asked even with no ice in HQ when the Corp's stops are on ALL (4.3.2, see askEvenIfNone)
      merciaFlow.evenIfNone(
        ctx,
        'corp',
        ice.length > 0,
        () => merciaFlow.ask(ctx, 'pick', cardsQuestion('corp', 'Mercia B4LL4RD: you may install 1 ice from HQ, paying 1 credit less.', ids(ice), 0, 1)),
        'Mercia B4LL4RD: no ice in HQ you can install.',
      );
    },
  },
  ...merciaFlow.script,
};

// Mitra Aman: Whenever the Runner approaches a piece of ice protecting this server, you may
// trash this upgrade. If you do, gain 3 credits and you may swap the ice being approached
// with a piece of ice from Archives or HQ.
type MitraData = { iceId: string };

const mitraFlow = prompts({
  trash: choice<MitraData>((ctx, a, { iceId }) => {
    const { state, card } = ctx;
    if (a.optionId !== 'trash' || !serverOf(state, card)) return;
    trashInstalledCard(state, card);
    gainCredits(state, 'corp', 3);
    addLog(state, 'corp', 'Corp trashed Mitra Aman and gained 3 [credit].');
    const swaps = [...state.corp.hq, ...archivesCards(state)].filter(c => type(c) === 'ice');
    // Asked even with no ice in HQ or Archives when the Corp's stops are on ALL (4.3.2, 4.4.6c, see askEvenIfNone)
    mitraFlow.evenIfNone(
      ctx,
      'corp',
      swaps.length > 0,
      () => mitraFlow.ask(ctx, 'swap', cardsQuestion('corp', 'Mitra Aman: you may swap the approached ice with ice from HQ or Archives.', ids(swaps), 0, 1), { iceId }),
      'Mitra Aman: no ice in HQ or Archives to swap in.',
    );
  }),
  swap: cards<MitraData>(({ state }, a, { iceId }) => {
    if (a.ids.length > 0) swapWithInstalled(state, iceId, a.ids[0]);
  }),
});

export const mitraAman: CardScript = {
  triggers: {
    approach_ice: (ctx, e) => {
      if (serverOf(ctx.state, ctx.card)?.id !== e.server) return;
      mitraFlow.ask(
        ctx,
        'trash',
        choiceQuestion('corp', 'Mitra Aman: trash it to gain 3 credits (and you may swap the approached ice)?', [
          { id: 'trash', label: 'Trash Mitra Aman' },
          { id: 'no', label: 'No' },
        ]),
        { iceId: e.ice.instanceId },
      );
    },
  },
  ...mitraFlow.script,
};

/** Swaps an installed ice with a piece of ice in HQ or Archives (Mitra Aman). */
function swapWithInstalled(state: GameState, installedId: string, otherId: string): void {
  const found = findInstalledCorpCard(state, installedId);
  const zone = [state.corp.hq, state.corp.archives.faceUp, state.corp.archives.faceDown].find(z => z.some(c => c.instanceId === otherId));
  if (!found || found.location !== 'ice' || !zone) return;
  const other = zone.find(c => c.instanceId === otherId)!;
  const index = found.server.ice.indexOf(found.card);
  // Programs hosted on the outgoing ice are trashed with it leaving play
  for (const hostedId of found.card.hostedCardIds) {
    const hosted = state.runner.rig.programs.find(p => p.instanceId === hostedId);
    if (hosted) trashInstalledRunnerCard(state, hosted);
  }
  const outgoing = found.card;
  outgoing.hostedCardIds = [];
  outgoing.isRezzed = false;
  outgoing.advancementCounters = 0;
  outgoing.tokens = {};
  zone[zone.indexOf(other)] = outgoing;
  other.isRezzed = false;
  delete other.installedTurn;
  found.server.ice[index] = other;
  addLog(state, 'corp', `Corp swapped the approached ice with a piece of ice from ${zone === state.corp.hq ? 'HQ' : 'Archives'}.`);
}

// Mahkota Langit Grid (Region): 2 recurring credits. You can spend hosted credits to rez
// assets in the root of this server and ice protecting this server. Persistent -> The trash
// cost of each asset in the root of this server is increased by 2 credits. Limit 1 region per server.
export const mahkota: CardScript = {
  recurringCredits: 2,
  persistent: true,
  paysFor: (state, self, purpose) => {
    if (purpose.kind !== 'rez') return false;
    const server = serverOf(state, self);
    if (!server) return false;
    return server.ice.includes(purpose.card) || (server.root.includes(purpose.card) && type(purpose.card) === 'asset');
  },
  modifiers: {
    trashCost: (state, self, trashing, serverId) => {
      const own = serverOf(state, self)?.id ?? state.activeRun?.persistentServers[self.instanceId];
      return type(trashing) === 'asset' && own !== undefined && own === serverId ? 2 : 0;
    },
  },
};

export const elevationCorpUpgradesScripts: Record<string, CardScript> = {
  '35045': mercia,
  '35056': mitraAman,
  '35082': mahkota,
};
