import { CardInstance } from '../types/card';
import { GameState } from '../types/state';
import { cardDef } from '../cards';
import { shuffleInPlace } from '../rng';
import { addLog } from '../engine/log';
import { drawCards, findInstalledCorpCard, removeCard, turnKey } from '../engine/helpers';
import { runnerSeesRd } from '../engine/rdKnowledge';
import { runnerTrashInstalledCorpCard, startRun, trashAccessedCard, cannotStealOrTrash } from '../engine/actions/run';
import { giveTags, installedRunnerCards, dealNetDamage, trashInstalledRunnerCard, uninstallRunnerCard } from '../engine/damage';
import {
  addCounters,
  counters,
  drawForEffect,
  installedIce,
  removeCounters,
  removeTags,
  spendCredits,
  stealthCredits,
  swapIce,
  takeBadPublicity,
  turnFlag,
  TurnFlag,
  useOncePerTurn,
} from '../engine/cardEffects';
import { approachServer, encounteredIce, grantSubroutine, iceStrength, iceSubtypes } from '../engine/ice';
import { fireTrigger } from '../engine/triggers';
import { CardScript, EffectContext } from './types';
import { askCards, askChoice, askRunnerInstall, gainCredits, iceLabel, installRunnerChoice, installRunnerHostChoice } from './effects';

/** Runner cards from Vantage Point. */

const isSelf = (ctx: EffectContext, card: CardInstance) => card.instanceId === ctx.card.instanceId;
const keywords = (card: CardInstance) => cardDef(card).keywords ?? '';
const ids = (cards: CardInstance[]) => cards.map(c => c.instanceId);
const onceKey = (card: CardInstance) => `once:${card.instanceId}`;
const runSource = (ctx: EffectContext) => ({ cardCode: ctx.card.cardCode, instanceId: ctx.card.instanceId });
const installedCorpCards = (state: GameState) => Object.values(state.corp.servers).flatMap(s => [...s.ice, ...s.root]);
const isInstalled = (state: GameState, card: CardInstance) => installedRunnerCards(state).some(c => c.instanceId === card.instanceId);

/** True while the Runner is encountering ice and can still break (before subroutines fire). */
function inBreakWindow(state: GameState): boolean {
  const encounter = state.activeRun?.encounter;
  return Boolean(encounter && encounter.resolvingIndex === null && state.activeRun?.phase === 'encounter_ice' && !encounter.onEncounterPending);
}

/** "Remove this event from the game" once its run is over. */
function removeEventFromGame(state: GameState, card: CardInstance): void {
  if (!removeCard(state.runner.heap, card)) return;
  card.tokens = {};
  state.removedFromGame.push(card);
  addLog(state, 'runner', `${cardDef(card).title} was removed from the game.`);
}

/** Asks which of these servers a run event runs. */
function askServer(ctx: EffectContext, title: string, serverIds: string[]): void {
  const options = serverIds.map(id => ({ id, label: ctx.state.corp.servers[id].name }));
  askChoice(ctx, 'runner', `${title}: run which server?`, options, 'run');
}

// --- Identities -------------------------------------------------------------

// Virtual Intelligence, P.I.: Once per turn -> click, 1 credit: Draw 1 card and remove 1 tag.
const vic: CardScript = {
  abilities: [
    {
      label: 'Draw 1 card and remove 1 tag.',
      clicks: 1,
      credits: 1,
      oncePerTurn: true,
      resolve: ({ state }) => {
        drawForEffect(state, 'runner', 1, 'Virtual Intelligence, P.I.');
        if (removeTags(state, 1) > 0) addLog(state, 'runner', 'Runner removed 1 tag (Virtual Intelligence, P.I.).');
      },
    },
  ],
};

// Hiram "0mission" Svensson: Whenever you install or trash a piece of hardware (from any
// location), look at the top card of R&D.
const hiramLook = (state: GameState) => {
  const top = state.corp.rd[0];
  if (!top) return;
  // Only the Runner looks (the Corp doesn't know the order of R&D either)
  addLog(state, 'runner', `Runner looked at the top card of R&D: ${cardDef(top).title} (Hiram "0mission" Svensson).`, top.cardCode, undefined, {
    from: 'corp',
    publicMessage: 'Runner looked at the top card of R&D (Hiram "0mission" Svensson).',
  });
  runnerSeesRd(state, top);
};
const hiram: CardScript = {
  triggers: {
    installed: (ctx, e) => cardDef(e.card).type_code === 'hardware' && cardDef(e.card).side_code === 'runner' && hiramLook(ctx.state),
    hardware_trashed: ctx => hiramLook(ctx.state),
  },
};

// --- Events -----------------------------------------------------------------

// Chain Reaction: Play only if you made a successful run on HQ, R&D, and Archives this
// turn. Trash 2 installed Corp cards. The Corp trashes 1 installed Runner card.
const chainReactionCorpTrash = (ctx: EffectContext) => {
  const mine = installedRunnerCards(ctx.state);
  if (mine.length > 0) askCards(ctx, 'corp', 'Chain Reaction: trash 1 installed Runner card.', ids(mine), 1, 1, 'corp');
};
const chainReaction: CardScript = {
  canPlay: ({ state }) =>
    ['hq', 'rd', 'archives'].every(server => state.runsThisTurn.some(r => r.server === server && r.successful))
      ? null
      : 'Play only if you made a successful run on HQ, R&D and Archives this turn',
  onPlay: ctx => {
    const targets = installedCorpCards(ctx.state);
    if (targets.length === 0) {
      chainReactionCorpTrash(ctx);
      return;
    }
    const n = Math.min(2, targets.length);
    askCards(ctx, 'runner', 'Chain Reaction: trash 2 installed Corp cards.', ids(targets), n, n, 'trash');
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (answer.kind !== 'effect_cards') return;
    if (source.step === 'trash') {
      for (const id of answer.cardInstanceIds) {
        const found = findInstalledCorpCard(state, id);
        if (found) runnerTrashInstalledCorpCard(state, found.card);
      }
      chainReactionCorpTrash(ctx);
    } else if (source.step === 'corp') {
      const card = installedRunnerCards(state).find(c => c.instanceId === answer.cardInstanceIds[0]);
      if (!card) return;
      trashInstalledRunnerCard(state, card);
      addLog(state, 'corp', `Corp trashed ${cardDef(card).title} (Chain Reaction).`);
    }
  },
};

// Take a Dive: Run HQ or R&D. If successful, and if a subroutine resolved during this run,
// give the Corp 1 bad publicity. Remove this event from the game.
const takeADive: CardScript = {
  onPlay: ctx => askServer(ctx, 'Take a Dive', ['hq', 'rd']),
  onPromptAnswer: (ctx, _source, answer) => {
    if (answer.kind === 'effect_choice') startRun(ctx.state, answer.optionId, { source: runSource(ctx), eventCode: ctx.card.cardCode });
  },
  onRunSuccessful: ({ state }) => {
    if (state.activeRun?.subroutineResolved) takeBadPublicity(state, 1);
  },
  onRunEnds: ({ state, card }) => removeEventFromGame(state, card),
};

// Kompromat: Run a server protected by ice. When that run ends, if it was successful, give
// the Corp 1 bad publicity unless they derez 1 piece of ice protecting the attacked server.
// Remove this event from the game.
const iceProtected = (state: GameState) => Object.values(state.corp.servers).filter(s => s.ice.length > 0).map(s => s.id);
const kompromat: CardScript = {
  canPlay: ({ state }) => (iceProtected(state).length > 0 ? null : 'No server is protected by ice'),
  onPlay: ctx => askServer(ctx, 'Kompromat', iceProtected(ctx.state)),
  onRunEnds: (ctx, run) => {
    const { state, card } = ctx;
    removeEventFromGame(state, card);
    if (!run.isSuccessful) return;
    const rezzed = (state.corp.servers[run.server]?.ice ?? []).filter(c => c.isRezzed);
    if (rezzed.length === 0) {
      takeBadPublicity(state, 1);
      return;
    }
    askChoice(ctx, 'corp', 'Kompromat: derez 1 piece of ice protecting the server, or take 1 bad publicity.', [
      ...rezzed.map(c => ({ id: c.instanceId, label: `Derez ${cardDef(c).title}` })),
      { id: 'bp', label: 'Take 1 bad publicity' },
    ], 'derez', { server: run.server });
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state } = ctx;
    if (answer.kind !== 'effect_choice') return;
    if (source.step === 'run') {
      startRun(state, answer.optionId, { source: runSource(ctx), eventCode: ctx.card.cardCode });
    } else if (source.step === 'derez') {
      const ice = findInstalledCorpCard(state, answer.optionId)?.card;
      if (ice?.isRezzed) {
        ice.isRezzed = false;
        addLog(state, 'corp', `Corp derezzed ${cardDef(ice).title} (Kompromat).`);
      } else {
        takeBadPublicity(state, 1);
      }
    }
  },
};

// Sell Out: As an additional cost to play this event, trash 1 installed resource.
// Gain 4 credits and draw 2 cards.
const sellOut: CardScript = {
  canPlay: ({ state }) => (state.runner.rig.resources.length > 0 ? null : 'Needs an installed resource to trash'),
  onPlay: ctx => askCards(ctx, 'runner', 'Sell Out: trash 1 installed resource.', ids(ctx.state.runner.rig.resources), 1, 1, 'trash'),
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_cards') return;
    const resource = state.runner.rig.resources.find(c => c.instanceId === answer.cardInstanceIds[0]);
    if (!resource) return;
    trashInstalledRunnerCard(state, resource);
    gainCredits(state, 'runner', 4);
    const drawn = drawCards(state, 'runner', 2);
    addLog(state, 'runner', `Runner trashed ${cardDef(resource).title}, gained 4 [credit] and drew ${drawn} card(s) (Sell Out).`);
  },
};

// Tailgate: The play cost of this event is lowered by 1 credit for each piece of ice
// protecting HQ. Run HQ. If successful, access 2 additional cards when you breach HQ.
const tailgate: CardScript = {
  playCostModifier: state => -state.corp.servers.hq.ice.length,
  liveValue: state => `Costs ${Math.max(0, 3 - state.corp.servers.hq.ice.length)}[credit] now`,
  onPlay: ctx => startRun(ctx.state, 'hq', { source: runSource(ctx), eventCode: ctx.card.cardCode }),
  onRunSuccessful: ({ state }) => {
    if (state.activeRun?.server === 'hq') state.activeRun.extraAccesses += 2;
  },
};

// Aircheck (Run - Stealth): Place 4 credits on this event. While this event is active, you
// can spend hosted credits, and you cannot lose or spend credits from your credit pool.
// Run HQ or R&D. When that run ends, if it was successful, you may run a remote server.
const AIRCHECK_SECOND = 'aircheck-second';
const aircheckRun = (ctx: EffectContext, serverId: string) =>
  startRun(ctx.state, serverId, { source: runSource(ctx), eventCode: ctx.card.cardCode, creditHosts: [ctx.card.instanceId], poolLocked: true });
const aircheck: CardScript = {
  onPlay: ctx => {
    ctx.card.tokens = { credit: 4 };
    addLog(ctx.state, 'runner', 'Aircheck: 4 [credit] placed on it.');
    askServer(ctx, 'Aircheck', ['hq', 'rd']);
  },
  onRunEnds: (ctx, run) => {
    const { state, card } = ctx;
    const remotes = Object.values(state.corp.servers).filter(s => s.isRemote);
    if (!card.tokens[AIRCHECK_SECOND] && run.isSuccessful && remotes.length > 0) {
      card.tokens[AIRCHECK_SECOND] = 1;
      askChoice(ctx, 'runner', 'Aircheck: you may run a remote server.', [...remotes.map(s => ({ id: s.id, label: s.name })), { id: 'no', label: 'No' }], 'remote');
      return;
    }
    // The event is done: its hosted credits go back to the bank
    card.tokens = {};
  },
  onPromptAnswer: (ctx, source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    if (source.step === 'remote' && answer.optionId === 'no') {
      ctx.card.tokens = {};
      return;
    }
    aircheckRun(ctx, answer.optionId);
  },
};

// Beta Build: Search your stack for 1 non-virus program. Install it, ignoring all costs.
// Run any server. When that run ends, if that program has not been uninstalled, add it to
// the top of your stack.
const betaBuildRun = (ctx: EffectContext) => askServer(ctx, 'Beta Build', Object.keys(ctx.state.corp.servers));
const betaBuild: CardScript = {
  onPlay: ctx => {
    const { state } = ctx;
    const programs = state.runner.stack.filter(c => cardDef(c).type_code === 'program' && !/\bvirus\b/i.test(keywords(c)));
    if (programs.length === 0) {
      shuffleInPlace(state.rng, state.runner.stack);
      addLog(state, 'runner', 'Runner searched their stack but found no non-virus program (Beta Build).');
      betaBuildRun(ctx);
      return;
    }
    askRunnerInstall(ctx, 'Beta Build: install 1 non-virus program from your stack, ignoring all costs.', ids(programs), 1, 1, 'install');
  },
  onPromptAnswer: (ctx, source, answer) => {
    const { state, card } = ctx;
    if (source.step === 'install' && answer.kind === 'effect_cards') {
      const id = answer.cardInstanceIds[0];
      card.hostedCardIds = [id];
      const installed = installRunnerChoice(ctx, id, 'host', 99, {}, answer.trashFirst);
      shuffleInPlace(state.rng, state.runner.stack);
      if (installed || !state.pendingPrompts.length) betaBuildRun(ctx);
    } else if (source.step === 'host') {
      installRunnerHostChoice(state, source, answer);
      shuffleInPlace(state.rng, state.runner.stack);
      betaBuildRun(ctx);
    } else if (source.step === 'run' && answer.kind === 'effect_choice') {
      startRun(state, answer.optionId, { source: runSource(ctx), eventCode: card.cardCode });
    }
  },
  onRunEnds: ({ state, card }) => {
    const program = state.runner.rig.programs.find(c => c.instanceId === card.hostedCardIds[0]);
    card.hostedCardIds = [];
    if (!program) return;
    // Back to the top of the stack (uninstalled: what it hosted is trashed)
    uninstallRunnerCard(state, program, 'stackTop');
    addLog(state, 'runner', `${cardDef(program).title} was added to the top of the stack (Beta Build).`);
  },
};

// --- Hardware ---------------------------------------------------------------

// The Tungsten Tailor: Each piece of ice gets -1 strength. The first time each turn you
// break a subroutine on a piece of ice with 0 or less strength, gain 1 credit.
const tungstenTailor: CardScript = {
  modifiers: { iceStrength: () => -1 },
  triggers: {
    subroutines_broken: (ctx, e) => {
      if (iceStrength(ctx.state, e.ice) > 0 || !useOncePerTurn(ctx.state, onceKey(ctx.card))) return;
      gainCredits(ctx.state, 'runner', 1);
      addLog(ctx.state, 'runner', 'Runner gained 1 [credit] (The Tungsten Tailor).');
    },
  },
};

// Borrowed Goods: +1 MU. When you install this hardware, if you are not tagged, take 1 tag.
const borrowedGoods: CardScript = {
  modifiers: { memory: 1 },
  triggers: {
    installed: (ctx, e) => {
      if (isSelf(ctx, e.card) && ctx.state.runner.tags === 0) giveTags(ctx.state, 1);
    },
  },
};

// Rotary: +1 MU. Whenever you breach HQ or R&D, you may take 1 tag to access 1 additional
// card. click, 2 credits: Trash this hardware. Only the Corp can use this ability, and only
// if the Runner is tagged. Limit 1 console per player.
const rotary: CardScript = {
  modifiers: { memory: 1 },
  triggers: {
    breach_server: (ctx, e) => {
      if (e.server !== 'hq' && e.server !== 'rd') return;
      askChoice(ctx, 'runner', 'Rotary: take 1 tag to access 1 additional card?', [
        { id: 'tag', label: 'Take 1 tag: access 1 more card' },
        { id: 'no', label: 'No' },
      ], 'breach');
    },
  },
  abilities: [
    {
      label: 'Trash Rotary (Corp only, while the Runner is tagged).',
      anyPlayer: true,
      clicks: 1,
      credits: 2,
      trashSelf: true,
      canUse: ({ state, side }) => (side !== 'corp' ? 'Only the Corp can use this ability' : state.runner.tags > 0 ? null : 'Only while the Runner is tagged'),
      resolve: ({ state }) => addLog(state, 'corp', 'Corp trashed Rotary.'),
    },
  ],
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_choice' || answer.optionId !== 'tag' || !state.activeRun) return;
    giveTags(state, 1);
    state.activeRun.extraAccesses += 1;
    addLog(state, 'runner', 'Runner took 1 tag to access 1 additional card (Rotary).');
  },
};

// Methuselah (Console - Stealth): +1 MU. Whenever a run begins, you may trash 1 piece of
// hardware from your grip to place 2 credits on this hardware. You can spend hosted credits
// during runs. Limit 1 console per player.
const methuselah: CardScript = {
  modifiers: { memory: 1 },
  paysDuringRuns: true,
  triggers: {
    run_begins: ctx => {
      const hardware = ctx.state.runner.grip.filter(c => cardDef(c).type_code === 'hardware');
      if (hardware.length > 0) {
        askCards(ctx, 'runner', 'Methuselah: you may trash 1 piece of hardware from your grip to place 2 [credit] on it.', ids(hardware), 0, 1, 'trash');
      }
    },
  },
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind !== 'effect_cards' || answer.cardInstanceIds.length === 0) return;
    const hardware = state.runner.grip.find(c => c.instanceId === answer.cardInstanceIds[0]);
    if (!hardware) return;
    removeCard(state.runner.grip, hardware);
    state.runner.heap.push(hardware);
    addCounters(card, 'credit', 2);
    addLog(state, 'runner', `Runner trashed ${cardDef(hardware).title} from their grip to place 2 [credit] on Methuselah.`);
    fireTrigger(state, { type: 'hardware_trashed', card: hardware });
  },
};

// Touchstone (Stealth): The first time each turn you play an event, place 1 credit on this
// hardware. You can spend hosted credits during runs.
const touchstone: CardScript = {
  paysDuringRuns: true,
  triggers: {
    event_played: ctx => {
      if (!useOncePerTurn(ctx.state, onceKey(ctx.card))) return;
      addCounters(ctx.card, 'credit', 1);
      addLog(ctx.state, 'runner', 'Touchstone: 1 [credit] placed on it.');
    },
  },
};

// --- Programs ---------------------------------------------------------------

// Corsair (Icebreaker - Fracter): Interface -> 1 credit: Break 1 barrier subroutine.
// 1 credit: The barrier you are encountering gets -3 strength for the remainder of this
// encounter. Spend credits only from stealth cards to use this ability.
const corsair: CardScript = {
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
const lampades: CardScript = {
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
const baker: CardScript = {
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
    askChoice(ctx, 'runner', 'Baker: pay 1 stealth credit to approach HQ or R&D instead of Archives?', [
      { id: 'hq', label: 'Pay 1: approach HQ' },
      { id: 'rd', label: 'Pay 1: approach R&D' },
      { id: 'no', label: 'Approach Archives' },
    ], 'redirect');
    return true;
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    const run = state.activeRun;
    if (answer.kind !== 'effect_choice' || !run) return;
    if (answer.optionId !== 'no' && stealthCredits(state) >= 1) {
      spendCredits(state, 'runner', 1, { kind: 'stealth' });
      run.server = answer.optionId;
      const last = state.runsThisTurn[state.runsThisTurn.length - 1];
      if (last) last.server = answer.optionId;
      addLog(state, 'runner', `The attacked server changed to ${state.corp.servers[answer.optionId].name} (Baker).`);
    }
    approachServer(state);
  },
};

// Read-Write Share: Limit 4 hosted cards. When you install this program and when your turn
// begins, you may host 1 card from your grip facedown on this program to draw 1 card.
// trash: Shuffle all hosted cards into your stack.
const askReadWrite = (ctx: EffectContext) => {
  const hosted = ctx.card.hostedCards ?? [];
  if (hosted.length >= 4 || ctx.state.runner.grip.length === 0) return;
  askCards(ctx, 'runner', 'Read-Write Share: you may host 1 card from your grip facedown to draw 1 card.', ids(ctx.state.runner.grip), 0, 1, 'host');
};
const readWriteShare: CardScript = {
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
  onPromptAnswer: ({ state, card }, _source, answer) => {
    if (answer.kind !== 'effect_cards' || answer.cardInstanceIds.length === 0 || !isInstalled(state, card)) return;
    const hosted = state.runner.grip.find(c => c.instanceId === answer.cardInstanceIds[0]);
    if (!hosted) return;
    removeCard(state.runner.grip, hosted);
    card.hostedCards = [...(card.hostedCards ?? []), hosted];
    drawForEffect(state, 'runner', 1, 'Read-Write Share');
  },
};

// Sipa: The first time each turn you pass the outermost piece of ice protecting a server
// after fully breaking it, you may swap it with another installed piece of ice.
const sipa: CardScript = {
  triggers: {
    ice_passed: (ctx, e) => {
      const { state } = ctx;
      if (!e.fullyBroken || !e.outermost || !useOncePerTurn(state, onceKey(ctx.card))) return;
      const others = installedIce(state).filter(c => c.instanceId !== e.ice.instanceId);
      if (others.length === 0) return;
      askChoice(ctx, 'runner', `Sipa: you may swap ${cardDef(e.ice).title} with another installed piece of ice.`, [
        ...others.map(c => ({ id: c.instanceId, label: iceLabel(state, c) })),
        { id: 'no', label: 'No swap' },
      ], 'swap', { iceId: e.ice.instanceId });
    },
  },
  onPromptAnswer: ({ state }, source, answer) => {
    if (answer.kind !== 'effect_choice' || answer.optionId === 'no') return;
    swapIce(state, String(source.data?.iceId), answer.optionId);
  },
};

// Stowaway (Trojan): Install only on a piece of ice. Whenever you make a successful run on
// this server, gain 2 credits.
const stowaway: CardScript = {
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

// Hackerspace (Location): You can install unique companion resources and unique connection
// resources onto this resource. Each resource installed this way costs 1 credit less to
// install. While this resource has a hosted companion and a hosted connection, you get +2
// maximum hand size.
const hostedOn = (state: GameState, host: CardInstance) => state.runner.rig.resources.filter(c => c.hostedOnId === host.instanceId);
const hackerspace: CardScript = {
  hostsInstalled: (_state, _self, card) =>
    cardDef(card).type_code === 'resource' && !!cardDef(card).uniqueness && /\b(companion|connection)\b/i.test(keywords(card)),
  hostedInstallDiscount: 1,
  modifiers: {
    handSize: (state, self) => {
      const hosted = hostedOn(state, self);
      const has = (k: RegExp) => hosted.some(c => k.test(keywords(c)));
      return has(/\bcompanion\b/i) && has(/\bconnection\b/i) ? 2 : 0;
    },
  },
};

// Nurse Hạnh (Connection): Whenever 2 or more facedown cards in Archives are turned faceup, draw 2 cards.
const nurseHanh: CardScript = {
  triggers: {
    archives_turned_faceup: (ctx, e) => e.count >= 2 && drawForEffect(ctx.state, 'runner', 2, 'Nurse Hạnh'),
  },
};

// Stick and Poke (Companion - Virtual): The first time each turn you encounter a piece of
// ice, it gains "[subroutine] Do 1 net damage. The Runner draws 1 card.", before its other
// subroutines, for the remainder of that encounter.
const stickAndPoke: CardScript = {
  grantedSubroutines: [
    {
      label: 'Do 1 net damage. The Runner draws 1 card.',
      resolve: ({ state }) => {
        dealNetDamage(state, 1);
        if (!state.winner) drawForEffect(state, 'runner', 1, 'Stick and Poke');
      },
    },
  ],
  triggers: {
    encounter_ice: ctx => {
      if (!useOncePerTurn(ctx.state, onceKey(ctx.card))) return;
      grantSubroutine(ctx.state, ctx.card.cardCode, 0);
      addLog(ctx.state, 'runner', 'The encountered ice gains "Do 1 net damage. The Runner draws 1 card." (Stick and Poke).');
    },
  },
};

// Underdome Irregulars (Connection): When your action phase ends, if a piece of ice was
// rezzed this turn, draw 2 cards or remove 1 tag. If no ice was rezzed this turn, trash this resource.
const underdome: CardScript = {
  triggers: {
    action_phase_ends: (ctx, e) => {
      const { state, card } = ctx;
      if (e.side !== 'runner') return;
      if (turnFlag(state, TurnFlag.iceRezzed) === 0) {
        trashInstalledRunnerCard(state, card);
        addLog(state, 'runner', 'No ice was rezzed this turn: Underdome Irregulars was trashed.');
        return;
      }
      if (state.runner.tags === 0) {
        drawForEffect(state, 'runner', 2, 'Underdome Irregulars');
        return;
      }
      askChoice(ctx, 'runner', 'Underdome Irregulars: draw 2 cards or remove 1 tag?', [
        { id: 'draw', label: 'Draw 2 cards' },
        { id: 'tag', label: 'Remove 1 tag' },
      ], 'choose');
    },
  },
  onPromptAnswer: ({ state }, _source, answer) => {
    if (answer.kind !== 'effect_choice') return;
    if (answer.optionId === 'draw') drawForEffect(state, 'runner', 2, 'Underdome Irregulars');
    else if (removeTags(state, 1) > 0) addLog(state, 'runner', 'Runner removed 1 tag (Underdome Irregulars).');
  },
};

// Word on the Street: As an additional cost to score an agenda the Corp installed this turn,
// they must add this resource to their score area as an agenda worth -1 agenda points with
// "You cannot forfeit this agenda.". When the Corp scores an agenda they did not install this
// turn, trash this resource, gain 4 credits, and draw 1 card.
const wordOnTheStreet: CardScript = {
  payScoreCost: ({ state, card }, agenda) => {
    if (agenda.installedTurn !== turnKey(state) || !isInstalled(state, card)) return;
    removeCard(state.runner.rig.resources, card);
    card.asAgendaPoints = -1;
    state.corp.scoreArea.push(card);
    state.corp.score -= 1;
    addLog(state, 'corp', 'Word on the Street was added to the Corp\'s score area as an agenda worth -1 point.');
  },
  triggers: {
    agenda_scored: (ctx, e) => {
      const { state, card } = ctx;
      if (e.card.installedTurn === turnKey(state) || !isInstalled(state, card)) return;
      trashInstalledRunnerCard(state, card);
      gainCredits(state, 'runner', 4);
      const drawn = drawCards(state, 'runner', 1);
      addLog(state, 'runner', `Word on the Street was trashed: Runner gained 4 [credit] and drew ${drawn} card(s).`);
    },
  },
};

export const vantageRunnerScripts: Record<string, CardScript> = {
  '36001': chainReaction,
  '36002': takeADive,
  '36003': tungstenTailor,
  '36004': corsair,
  '36005': lampades,
  '36006': hackerspace,
  '36007': nurseHanh,
  '36008': stickAndPoke,
  '36009': vic,
  '36010': kompromat,
  '36011': sellOut,
  '36012': tailgate,
  '36013': borrowedGoods,
  '36014': rotary,
  '36015': baker,
  '36016': underdome,
  '36017': hiram,
  '36018': aircheck,
  '36019': betaBuild,
  '36020': methuselah,
  '36021': touchstone,
  '36022': readWriteShare,
  '36023': sipa,
  '36024': stowaway,
  '36025': wordOnTheStreet,
};
