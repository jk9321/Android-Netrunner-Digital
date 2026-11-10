import { CardInstance, SideCode } from '../types/card';
import { EffectSource } from '../types/prompts';
import { GameState } from '../types/state';
import { cardDef } from '../cards';
import { noteRdPrivate, runnerSeesRd, shuffleRD } from '../engine/rdKnowledge';
import { pushPrompt } from '../engine/prompts';
import { addLog } from '../engine/log';
import { findCardAnywhere, isAdvanceable, removeCard } from '../engine/helpers';
import { availableCredits, corpTrashFromHQ, corpTrashFromRD, installedIce, spendCredits } from '../engine/cardEffects';
import {
  chosenToTrashFirst,
  corpInstallBlocker,
  corpInstallCost,
  freedMemory,
  iceTrashedDiscount,
  installCorpCardFrom,
  installRunnerCardFrom,
  runnerInstallBlocker,
  trashFirst,
  trashableFirst,
} from '../engine/actions/install';
import { getCardScript } from './index';
import { EffectAnswer, EffectContext, NOTHING_QUALIFIES_STEP } from './types';

/** Helpers shared by card scripts. */

export function gainCredits(state: GameState, side: SideCode, amount: number): void {
  state[side].credits += amount;
}

/** "If you have any [click] remaining, lose [click]." */
export function loseClickIfAny(state: GameState, side: SideCode): void {
  if (state[side].clicks > 0) state[side].clicks -= 1;
}

export function source(ctx: EffectContext, step: string, data?: EffectSource['data']): EffectSource {
  return { cardCode: ctx.card.cardCode, instanceId: ctx.card.instanceId, step, data };
}

export function askChoice(
  ctx: EffectContext,
  side: SideCode,
  message: string,
  options: { id: string; label: string }[],
  step: string,
  data?: EffectSource['data']
): void {
  pushPrompt(ctx.state, { kind: 'effect_choice', side, message, options, source: source(ctx, step, data) });
}

/**
 * A "you may" follow-up that is offered only when a card hidden from the opponent qualifies (the top of R&D has the
 * named type, an installed card is advanceable). Asking only then would let the opponent read the hidden card from
 * who the game waits on (rules 4.2.2, 4.6.3). Jeff's policy (2026-11-08, as for paid windows and the R&D access
 * step): the side the tell would hurt, the asked side, chooses with its stops. At 'full' the question is always
 * asked, with only `declineLabel` when nothing qualifies; at every other level nothing changes.
 * Returns whether a prompt was pushed.
 */
export function askEvenIfNone(ctx: EffectContext, side: SideCode, qualifies: boolean, ask: () => void, noneMessage: string, declineLabel = 'OK'): boolean {
  if (qualifies) {
    ask();
    return true;
  }
  // stopLevel() from engine/priority.ts, read directly: importing priority.ts here closes an import cycle
  if ((ctx.state.stops?.[side] ?? 'ai') !== 'full') return false;
  askChoice(ctx, side, noneMessage, [{ id: 'no', label: declineLabel }], NOTHING_QUALIFIES_STEP);
  return true;
}

export function askCards(
  ctx: EffectContext,
  side: SideCode,
  message: string,
  candidateIds: string[],
  min: number,
  max: number,
  step: string,
  data?: EffectSource['data']
): void {
  pushPrompt(ctx.state, { kind: 'effect_cards', side, message, candidateIds, min, max, source: source(ctx, step, data) });
}

// --- Installing chosen cards --------------------------------------------------

export interface CorpInstallChoice {
  /** Install ignoring all costs. */
  ignoreCosts?: boolean;
  /** Credits off the install cost (Mercia B4LL4RD). */
  discount?: number;
  /** Only the root of a remote server (Peer Review, IP Enforcement). */
  remoteRootOnly?: boolean;
  /** The card was revealed to the Runner just before, so they know it once installed (Synapse Global, Off the Books). */
  revealed?: boolean;
}

/** The zone a Corp card is in, among those effects install from (HQ, R&D, Archives, the Runner's score area). */
export function corpZoneOf(state: GameState, instanceId: string): CardInstance[] | undefined {
  const { hq, rd, archives } = state.corp;
  return [hq, rd, archives.faceUp, archives.faceDown, state.runner.scoreArea].find(z => z.some(c => c.instanceId === instanceId));
}

/** Where the Corp could install this card: 'new' (a new remote) and server ids. */
export function corpInstallOptions(state: GameState, card: CardInstance, opts: CorpInstallChoice = {}): { id: string; label: string }[] {
  const ignore = !!opts.ignoreCosts;
  const options: { id: string; label: string }[] = [];
  if (!corpInstallBlocker(state, card, null, ignore, opts.discount)) options.push({ id: 'new', label: 'New remote server' });
  for (const server of Object.values(state.corp.servers)) {
    if (opts.remoteRootOnly && !server.isRemote) continue;
    const cost = corpInstallCost(state, card, server.id, ignore, opts.discount);
    if (corpInstallBlocker(state, card, server.id, ignore, opts.discount)) {
      // Trashing ice there first (rules 8.5.6b) may bring the cost within reach
      const all = iceTrashedDiscount(card, trashableFirst(state, card, server.id));
      if (all === 0 || corpInstallBlocker(state, card, server.id, ignore, (opts.discount ?? 0) + all)) continue;
      options.push({ id: server.id, label: `${server.name} (${cost}c, or trash ice there first)` });
      continue;
    }
    options.push({ id: server.id, label: cost > 0 ? `${server.name} (${cost}c)` : server.name });
  }
  return options;
}

/**
 * Asks the Corp where to install a card an effect chose. The script's
 * onPromptAnswer then calls installCorpChoice() for `step`. Returns false if
 * the card can't be installed anywhere.
 */
export function askCorpInstall(ctx: EffectContext, cardId: string, step: string, opts: CorpInstallChoice = {}, data: EffectSource['data'] = {}): boolean {
  const card = findCardAnywhere(ctx.state, cardId);
  if (!card) return false;
  const options = corpInstallOptions(ctx.state, card, opts);
  if (options.length === 0) {
    addLog(ctx.state, 'corp', 'Corp could not install the card: there is nowhere to put it.');
    return false;
  }
  askChoice(ctx, 'corp', `Install ${cardDef(card).title} where?`, options, step, { ...data, cardId, install: true });
  return true;
}

/** Installs the card from askCorpInstall() in the chosen server. Returns the server id, or null if it failed. */
export function installCorpChoice(state: GameState, source: EffectSource, answer: EffectAnswer, opts: CorpInstallChoice = {}): string | null {
  if (answer.kind !== 'effect_choice') return null;
  const cardId = source.data?.cardId as string;
  const card = findCardAnywhere(state, cardId);
  const zone = corpZoneOf(state, cardId);
  if (!card || !zone) return null;
  const serverId = answer.optionId === 'new' ? null : answer.optionId;
  const trash = chosenToTrashFirst(state, card, serverId, answer.trashFirst ?? []);
  const discount = (opts.discount ?? 0) + iceTrashedDiscount(card, trash);
  if (corpInstallBlocker(state, card, serverId, !!opts.ignoreCosts, discount)) return null;
  trashFirst(state, trash);
  const before = new Set(Object.keys(state.corp.servers));
  card.advancementCounters = 0;
  card.tokens = {};
  card.isRezzed = false;
  installCorpCardFrom(state, card, zone, serverId, !!opts.ignoreCosts, { discount, revealed: opts.revealed });
  return serverId ?? Object.keys(state.corp.servers).find(id => !before.has(id)) ?? null;
}

/** The zone a Runner card is in, among those effects install from (grip, heap, stack, cards hosted faceup). */
export function runnerZoneOf(state: GameState, instanceId: string): CardInstance[] | undefined {
  const { grip, heap, stack, rig } = state.runner;
  const hosted = [...rig.programs, ...rig.hardware, ...rig.resources].flatMap(c => (c.hostedCards ? [c.hostedCards] : []));
  return [grip, heap, stack, ...hosted].find(z => z.some(c => c.instanceId === instanceId));
}

/**
 * Runner cards in `cards` that could be installed now (with a discount). Trojans need some ice.
 * `hostId`: a non-trojan card is installed on that card (Muse), so it can't be trashed to make room.
 */
export function installableRunnerCards(state: GameState, cards: CardInstance[], discount = 0, hostId?: string): CardInstance[] {
  const ice = installedIce(state);
  // A program may fit once installed programs are trashed to make room (rules 8.5.6c)
  const freeable = freedMemory(state.runner.rig.programs);
  const freeableKeepingHost = freedMemory(state.runner.rig.programs.filter(c => c.instanceId !== hostId));
  return cards.filter(c => {
    if (!['program', 'hardware', 'resource'].includes(cardDef(c).type_code)) return false;
    if (getCardScript(c.cardCode)?.installsOnIce) return ice.some(i => !runnerInstallBlocker(state, c, i.instanceId, discount, freeable));
    return !runnerInstallBlocker(state, c, undefined, discount, freeableKeepingHost);
  });
}

/**
 * The installed cards the Runner may trash to install `card` for an effect (rules 8.5.6c). An effect
 * that installs the card on one of their programs (Muse, data.hostId) can't trash that host, unless
 * the card is a trojan going on ice instead (NSG ruling on Muse).
 */
export function effectTrashableFirst(state: GameState, card: CardInstance, data: EffectSource['data'] = {}): CardInstance[] {
  const keep = getCardScript(card.cardCode)?.installsOnIce ? undefined : data?.hostId;
  return trashableFirst(state, card, null).filter(c => c.instanceId !== keep);
}

/** askCards() for a Runner card to install: the answer may name programs to trash first (rules 8.5.6c). */
export function askRunnerInstall(
  ctx: EffectContext,
  message: string,
  candidateIds: string[],
  min: number,
  max: number,
  step: string,
  data: EffectSource['data'] = {}
): void {
  askCards(ctx, 'runner', message, candidateIds, min, max, step, { ...data, install: true });
}

/**
 * Installs a Runner card from `zone` for an effect, first trashing the
 * installed programs the player chose (rules 8.5.6c). Returns false, doing
 * nothing, if the install isn't possible that way.
 */
export function installRunnerTrashing(
  state: GameState,
  card: CardInstance,
  zone: CardInstance[],
  hostInstanceId: string | undefined,
  discount: number,
  trashIds: string[]
): boolean {
  const trash = chosenToTrashFirst(state, card, null, trashIds);
  if (runnerInstallBlocker(state, card, hostInstanceId, discount, freedMemory(trash))) return false;
  trashFirst(state, trash);
  installRunnerCardFrom(state, card, zone, hostInstanceId, discount);
  return true;
}

/**
 * Installs a Runner card an effect chose (paying its cost less `discount`).
 * Programs that install on ice first ask which ice, under `hostStep`; the
 * script's onPromptAnswer then calls installRunnerHostChoice(). Returns true
 * if the card was installed now.
 */
export function installRunnerChoice(
  ctx: EffectContext,
  cardId: string,
  hostStep: string,
  discount = 0,
  data: EffectSource['data'] = {},
  trashIds: string[] = []
): boolean {
  const { state } = ctx;
  const card = findCardAnywhere(state, cardId);
  const zone = runnerZoneOf(state, cardId);
  if (!card || !zone) return false;
  if (getCardScript(card.cardCode)?.installsOnIce) {
    const freed = freedMemory(chosenToTrashFirst(state, card, null, trashIds));
    const hosts = installedIce(state).filter(i => !runnerInstallBlocker(state, card, i.instanceId, discount, freed));
    if (hosts.length === 0) return false;
    askChoice(ctx, 'runner', `Install ${cardDef(card).title} on which ice?`, hosts.map(i => ({ id: i.instanceId, label: iceLabel(state, i) })), hostStep, {
      ...data,
      cardId,
      discount,
      trashIds,
    });
    return false;
  }
  return installRunnerTrashing(state, card, zone, undefined, discount, trashIds);
}

/** Finishes installRunnerChoice() once the host ice is chosen. */
export function installRunnerHostChoice(state: GameState, source: EffectSource, answer: EffectAnswer): boolean {
  if (answer.kind !== 'effect_choice') return false;
  const cardId = source.data?.cardId as string;
  const card = findCardAnywhere(state, cardId);
  const zone = runnerZoneOf(state, cardId);
  const discount = Number(source.data?.discount ?? 0);
  if (!card || !zone) return false;
  return installRunnerTrashing(state, card, zone, answer.optionId, discount, (source.data?.trashIds as string[] | undefined) ?? []);
}

/** "Rezzed Ice in Remote Server 1" style label for a piece of ice the other player may not see. */
export function iceLabel(state: GameState, ice: CardInstance): string {
  const server = Object.values(state.corp.servers).find(s => s.ice.includes(ice));
  const name = ice.isRezzed ? cardDef(ice).title : 'Unrezzed ice';
  return server ? `${name} (${server.name}, position ${server.ice.indexOf(ice) + 1})` : name;
}

/** Installed Corp cards that can be advanced. */
export function advanceableInstalled(state: GameState): CardInstance[] {
  return Object.values(state.corp.servers)
    .flatMap(s => [...s.ice, ...s.root])
    .filter(isAdvanceable);
}

// --- Sabotage ---------------------------------------------------------------------

/**
 * "Sabotage X": the Corp trashes X cards of their choice from HQ and/or the
 * top of R&D. The Corp picks the HQ cards; the rest come from the top of
 * R&D. The script's onPromptAnswer calls resolveSabotage() for `step`.
 */
export function sabotage(ctx: EffectContext, x: number, step: string): void {
  const { state } = ctx;
  const hq = state.corp.hq;
  const min = Math.max(0, x - state.corp.rd.length);
  const max = Math.min(x, hq.length);
  addLog(state, 'runner', `Sabotage ${x}: the Corp trashes ${x} card(s) from HQ and/or the top of R&D.`);
  if (max === 0) {
    resolveSabotage(state, x, []);
    return;
  }
  askCards(ctx, 'corp', `Sabotage ${x}: choose cards from HQ to trash (the rest come from the top of R&D).`, hq.map(c => c.instanceId), min, max, step, { x });
}

export function resolveSabotage(state: GameState, x: number, hqIds: string[]): void {
  const fromHq = corpTrashFromHQ(state, hqIds).length;
  const fromRd = corpTrashFromRD(state, x - fromHq);
  addLog(state, 'corp', `Corp trashed ${fromHq} card(s) from HQ and ${fromRd} from the top of R&D.`);
}

// --- Searching ----------------------------------------------------------------------

/** Takes a card out of R&D after a search, reveals it and shuffles R&D. */
export function takeFromRD(state: GameState, instanceId: string): CardInstance | undefined {
  const card = state.corp.rd.find(c => c.instanceId === instanceId);
  if (!card) return undefined;
  removeCard(state.corp.rd, card);
  shuffleRD(state);
  addLog(state, 'corp', `Corp revealed ${cardDef(card).title} and shuffled R&D.`);
  return card;
}

// --- Arranging R&D -------------------------------------------------------------------

/**
 * Arranges cards on top of R&D in the order a player picks: one prompt per
 * position, top first (rules 8.3.3). The cards must already be the top
 * `ids.length` cards of R&D. The script's onPromptAnswer calls arrangeNext() for `step`.
 * The Corp arranges in secret; when the Runner arranges (Cataloguer) they know where each card is.
 */
export function arrangeTop(ctx: EffectContext, cardIds: string[], step: string, placed: string[] = [], side: SideCode = 'corp'): void {
  const { state } = ctx;
  const left = cardIds.filter(id => !placed.includes(id));
  if (left.length <= 1) {
    const order = [...placed, ...left];
    const cards = order.flatMap(id => state.corp.rd.find(c => c.instanceId === id) ?? []);
    for (const card of cards) removeCard(state.corp.rd, card);
    state.corp.rd.unshift(...cards);
    if (side === 'corp') {
      // Arranged in secret: the Runner only knows the cards are among these (rules 8.3.3)
      noteRdPrivate(state, cards.length);
    } else {
      for (const card of cards) runnerSeesRd(state, card);
    }
    if (cards.length > 1) addLog(state, side, `${side === 'corp' ? 'Corp' : 'Runner'} arranged the top ${cards.length} cards of R&D.`);
    return;
  }
  const title = cardDef(ctx.card).title;
  askCards(ctx, side, `${title}: choose the card to put ${placed.length === 0 ? 'on top of R&D' : `in position ${placed.length + 1}`}.`, left, 1, 1, step, {
    ids: cardIds,
    placed,
    side,
  });
}
export const arrangeNext = (ctx: EffectContext, data: Record<string, unknown> | undefined, picked: string, step: string) =>
  arrangeTop(ctx, (data?.ids as string[]) ?? [], step, [...((data?.placed as string[]) ?? []), picked], (data?.side as SideCode | undefined) ?? 'corp');

// --- Psi games ---------------------------------------------------------------------

/** Steps of the two bidding prompts of a Psi Game; the card's own step follows the colon. */
const PSI_CORP = 'psi-corp:';
const PSI_RUNNER = 'psi-runner:';

const bidOptions = (state: GameState, side: SideCode) =>
  [0, 1, 2].filter(n => n === 0 || availableCredits(state, side) >= n).map(n => ({ id: String(n), label: `Bid ${n} [credit]` }));

/**
 * Plays a Psi Game (rules 10.14.6): both players secretly bid 0, 1 or 2
 * credits (no more than they can spend, 10.14.3), then reveal and spend their
 * bids. The Corp bids first, unseen by the Runner; the Runner then bids. The
 * script's onPromptAnswer passes both answers to answerPsiGame(), which calls
 * back with whether the bids matched.
 */
export function playPsiGame(ctx: EffectContext, step: string, data: EffectSource['data'] = {}): void {
  askChoice(ctx, 'corp', `${cardDef(ctx.card).title}: Psi Game. Secretly bid 0, 1 or 2 [credit].`, bidOptions(ctx.state, 'corp'), PSI_CORP + step, data);
}

/** Is this prompt one of a Psi Game's bids? */
export const isPsiStep = (step: string) => step.startsWith(PSI_CORP) || step.startsWith(PSI_RUNNER);

/**
 * Handles a Psi Game bid. After the Runner's bid, both bids are revealed and
 * spent, and `done` runs with the outcome and the card's own step. Returns
 * false if the answer wasn't a Psi Game bid.
 */
export function answerPsiGame(
  ctx: EffectContext,
  source: EffectSource,
  answer: EffectAnswer,
  done: (match: boolean, step: string, data: EffectSource['data']) => void
): boolean {
  if (answer.kind !== 'effect_choice' || !isPsiStep(source.step)) return false;
  const { state } = ctx;
  if (source.step.startsWith(PSI_CORP)) {
    const step = source.step.slice(PSI_CORP.length);
    askChoice(ctx, 'runner', `${cardDef(ctx.card).title}: Psi Game. The Corp has bid in secret. Secretly bid 0, 1 or 2 [credit].`, bidOptions(state, 'runner'), PSI_RUNNER + step, {
      ...(source.data ?? {}),
      corpBid: Number(answer.optionId),
    });
    return true;
  }
  const step = source.step.slice(PSI_RUNNER.length);
  const { corpBid, ...data } = source.data ?? {};
  const corp = Math.min(Number(corpBid ?? 0), availableCredits(state, 'corp'));
  const runner = Math.min(Number(answer.optionId), availableCredits(state, 'runner'));
  spendCredits(state, 'corp', corp);
  spendCredits(state, 'runner', runner);
  const match = corp === runner;
  addLog(state, 'corp', `Psi Game (${cardDef(ctx.card).title}): the Corp bid ${corp} [credit], the Runner bid ${runner} [credit]. The bids ${match ? 'match' : 'differ'}.`);
  done(match, step, data);
  return true;
}
