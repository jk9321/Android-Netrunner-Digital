import { CardInstance, SideCode } from '../types/card';
import { EffectSource } from '../types/prompts';
import { GameState } from '../types/state';
import { cardDef } from '../cards';
import { shuffleRD } from '../engine/rdKnowledge';
import { pushPrompt } from '../engine/prompts';
import { addLog } from '../engine/log';
import { findCardAnywhere, isAdvanceable, removeCard } from '../engine/helpers';
import { corpTrashFromHQ, corpTrashFromRD, installedIce } from '../engine/cardEffects';
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
import { EffectAnswer, EffectContext } from './types';

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

/** Runner cards in `cards` that could be installed now (with a discount). Trojans need some ice. */
export function installableRunnerCards(state: GameState, cards: CardInstance[], discount = 0): CardInstance[] {
  const ice = installedIce(state);
  // A program may fit once installed programs are trashed to make room (rules 8.5.6c)
  const freeable = freedMemory(state.runner.rig.programs);
  return cards.filter(c => {
    if (!['program', 'hardware', 'resource'].includes(cardDef(c).type_code)) return false;
    if (getCardScript(c.cardCode)?.installsOnIce) return ice.some(i => !runnerInstallBlocker(state, c, i.instanceId, discount, freeable));
    return !runnerInstallBlocker(state, c, undefined, discount, freeable);
  });
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
