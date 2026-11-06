import { CardInstance } from '../types/card';
import { GameState } from '../types/state';
import { cardDef } from '../cards';
import { nextInt } from '../rng';
import { addLog } from './log';
import { findCardAnywhere, noteTrashedFromHand, removeCard } from './helpers';
import { getCardScript } from '../scripts';
import { bumpTurnFlag, TurnFlag } from './cardEffects';
import { fireTrigger } from './triggers';
import { interruptPrompt } from './prompts';

export type DamageType = 'net' | 'meat' | 'core';

/** What happens to the cards a damage trashed, once it resolves (Diviner). */
type DamageFollowUp = (state: GameState, trashed: CardInstance[]) => void;
const FOLLOW_UPS: Record<string, DamageFollowUp> = {};
export function registerDamageFollowUp(id: string, fn: DamageFollowUp): void {
  FOLLOW_UPS[id] = fn;
}

export interface DamageOptions {
  /** A registered follow-up that needs the trashed cards (it runs even if the damage waits on a prevention prompt). */
  then?: string;
  /** The Runner already chose whether to prevent it. */
  preventionAsked?: boolean;
}

/**
 * Deals damage to the Runner: each point trashes a random card from the
 * grip. Core damage also lowers the Runner's maximum hand size by 1 per
 * point. Taking more damage than the grip holds flatlines the Runner and the
 * Corp wins. Returns the trashed cards.
 *
 * If an installed card can prevent it (AirbladeX), the Runner is asked first
 * (an interrupt, so the prompt goes ahead of any others): the damage then
 * resolves once they answer, and this returns no cards.
 */
export function dealDamage(state: GameState, type: DamageType, amount: number, byCorp = true, options: DamageOptions = {}): CardInstance[] {
  if (amount > 0 && !options.preventionAsked && !state.winner) {
    for (const card of installedRunnerCards(state)) {
      const max = getCardScript(card.cardCode)?.canPreventDamage?.(state, card, type, amount) ?? 0;
      if (max <= 0) continue;
      const choices = Array.from({ length: max + 1 }, (_, i) => max - i);
      interruptPrompt(state, {
        kind: 'effect_choice',
        side: 'runner',
        message: `${cardDef(card).title}: prevent how much of ${amount} ${type} damage?`,
        options: choices.map(n => ({ id: String(n), label: n === 0 ? 'Prevent none' : `Prevent ${n}` })),
        source: { cardCode: card.cardCode, instanceId: card.instanceId, step: 'prevent_damage', data: { damageType: type, amount, byCorp, then: options.then ?? '' } },
      });
      return [];
    }
  }
  const trashed: CardInstance[] = [];
  if (type === 'core') state.runner.coreDamage += amount;
  for (let i = 0; i < amount; i++) {
    if (state.runner.grip.length === 0) {
      flatline(state);
      break;
    }
    const card = state.runner.grip[nextInt(state.rng, state.runner.grip.length)];
    removeCard(state.runner.grip, card);
    state.runner.heap.push(card);
    trashed.push(card);
  }
  for (const card of trashed) if (cardDef(card).type_code === 'hardware') fireTrigger(state, { type: 'hardware_trashed', card });
  noteTrashedFromHand(state, trashed);
  const what = trashed.length > 0 ? `, trashing ${trashed.map(c => cardDef(c).title).join(', ')}` : '';
  addLog(state, byCorp ? 'corp' : 'runner', byCorp ? `Corp did ${amount} ${type} damage${what}.` : `Runner suffered ${amount} ${type} damage${what}.`, undefined, amount > 0 ? 'damage' : undefined);
  if (amount > 0 && !state.winner) fireTrigger(state, { type: 'damage_dealt', damage: type, amount, byCorp });
  if (options.then) FOLLOW_UPS[options.then]?.(state, trashed);
  return trashed;
}

export const dealNetDamage = (state: GameState, amount: number) => dealDamage(state, 'net', amount);
export const dealMeatDamage = (state: GameState, amount: number) => dealDamage(state, 'meat', amount);
export const dealCoreDamage = (state: GameState, amount: number) => dealDamage(state, 'core', amount);

/** The Runner is flatlined: the Corp wins. */
export function flatline(state: GameState): void {
  if (state.winner) return;
  state.winner = 'corp';
  state.winReason = 'Runner flatlined';
  addLog(state, 'system', 'Corp wins: the Runner was flatlined.');
}

/** Gives the Runner tags and fires "whenever the Runner takes a tag" abilities. */
export function giveTags(state: GameState, count: number): void {
  if (count <= 0) return;
  state.runner.tags += count;
  addLog(state, 'corp', `The Runner took ${count} tag(s) (now ${state.runner.tags}).`);
  bumpTurnFlag(state, TurnFlag.tagEvents);
  fireTrigger(state, { type: 'tags_taken', count });
}

/** All installed Runner cards. */
export function installedRunnerCards(state: GameState): CardInstance[] {
  const { programs, hardware, resources } = state.runner.rig;
  return [...programs, ...hardware, ...resources];
}

/** Trashes an installed Runner card to the heap, freeing its memory if it is a program. */
export function trashInstalledRunnerCard(state: GameState, card: CardInstance): void {
  uninstallRunnerCard(state, card, 'heap');
  if (cardDef(card).type_code === 'hardware') fireTrigger(state, { type: 'hardware_trashed', card });
}

/**
 * Takes an installed Runner card out of play to the heap, the grip (Lethe),
 * the top or bottom of the stack (Beta Build, Scapegoat) or out of the game
 * (Malandragem), freeing its memory (rules 3.9.3a). What it hosted is trashed (rules 1.13).
 */
export function uninstallRunnerCard(state: GameState, card: CardInstance, to: 'heap' | 'grip' | 'stackTop' | 'stack' | 'removed'): void {
  const { rig } = state.runner;
  if (removeCard(rig.programs, card)) {
    state.runner.memoryUnitsUsed -= cardDef(card).memory_cost || 0;
  } else {
    removeCard(rig.hardware, card) || removeCard(rig.resources, card);
  }
  if (card.hostedOnId) {
    const host = findCardAnywhere(state, card.hostedOnId);
    if (host) host.hostedCardIds = host.hostedCardIds.filter(id => id !== card.instanceId);
    card.hostedOnId = undefined;
  }
  card.tokens = {};
  if (to === 'heap') state.runner.heap.push(card);
  else if (to === 'grip') state.runner.grip.push(card);
  else if (to === 'stackTop') state.runner.stack.unshift(card);
  else if (to === 'removed') state.removedFromGame.push(card);
  else state.runner.stack.push(card);
  // Cards hosted faceup on it (Bling, Madani, Detente) go to their owners' discard piles
  for (const hosted of card.hostedCards ?? []) {
    if (cardDef(hosted).side_code === 'corp') state.corp.archives.faceUp.push(hosted);
    else state.runner.heap.push(hosted);
  }
  card.hostedCards = [];
  // Installed cards hosted on it (GAMEDRAGON™ Pro on an icebreaker) are trashed too
  for (const other of installedRunnerCards(state).filter(c => c.hostedOnId === card.instanceId)) {
    trashInstalledRunnerCard(state, other);
  }
}
