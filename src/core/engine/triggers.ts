import { CardInstance, SideCode } from '../types/card';
import { GameState, SettledEvent } from '../types/state';
import { cardDef } from '../cards';
import { getCardScript, scriptedCardCodes } from '../scripts';
import { TriggerEvent, TriggerHandlers, TriggerMatchers } from '../scripts/types';
import { findCardAnywhere } from './helpers';

/**
 * Cards whose abilities are active: identities, rezzed Corp cards in
 * servers, agendas in the Corp's score area, and installed Runner cards.
 * (Agendas in the Runner's score area are inactive.)
 */
export function activeCards(state: GameState, side?: SideCode): CardInstance[] {
  const out: CardInstance[] = [];
  eachActiveCard(state, side, c => {
    out.push(c);
  });
  return out;
}

/**
 * Visits the active cards in activeCards' order (Corp first) without building a list: the strength helpers
 * (ice.ts) ask on every board the AI prices, and the lists were a few percent of its time (planner speed 2026-11-12).
 */
export function eachActiveCard(state: GameState, side: SideCode | undefined, visit: (card: CardInstance) => void): void {
  if (side !== 'runner') {
    visit(state.corp.identity);
    for (const server of Object.values(state.corp.servers)) {
      // Agendas whose printed text installs them faceup are active while installed (rules 3.2.3a)
      for (const c of server.ice) if (c.isRezzed || (c.faceUp && getCardScript(c.cardCode)?.installFaceUpOnly)) visit(c);
      for (const c of server.root) if (c.isRezzed || (c.faceUp && getCardScript(c.cardCode)?.installFaceUpOnly)) visit(c);
    }
    // Runner cards added to the Corp's score area as agendas (Word on the Street) are not the Corp's to use
    for (const c of state.corp.scoreArea) if (cardDef(c).side_code === 'corp') visit(c);
  }
  if (side !== 'corp') {
    const { programs, hardware, resources } = state.runner.rig;
    visit(state.runner.identity);
    for (const c of programs) visit(c);
    for (const c of hardware) visit(c);
    for (const c of resources) visit(c);
  }
}

/**
 * Lets every active card react to an event. `extra` adds cards whose ability applies although they are inactive (a
 * stolen agenda's "when stolen", a persistent card trashed during the run).
 *
 * Abilities that trigger together resolve in a reaction window that gives the active player priority first, and each
 * ability is fully resolved before another is chosen (rules 9.2.8b, 9.2.8d). So the active player's cards react first;
 * if one of them asks a question, the other player's abilities wait until every question is answered (Above the Law
 * may trash Word on the Street before it pays out). The other player's then resolve, cards reacting from the heap last.
 */
export function fireTrigger(state: GameState, event: TriggerEvent, extra: CardInstance[] = []): void {
  countFirsts(state, event);
  const seen = new Set<string>();
  // The run event whose run is in progress reacts to that run's events (S-Dobrado, Window of Opportunity)
  const runEvents = runEventCards(state);
  const cards = [...activeCards(state), ...extra, ...runEvents].filter(c => !seen.has(c.instanceId) && seen.add(c.instanceId));
  const forced = new Set([...extra, ...runEvents].map(c => c.instanceId));
  const active = state.activePlayer;
  const mine = cards.filter(c => cardDef(c).side_code === active);
  const theirs = cards.filter(c => cardDef(c).side_code !== active);
  const asked = state.pendingPrompts.length;
  runHandlers(state, event, mine, forced);
  if (active === 'runner') runHeapHandlers(state, event);
  if (state.pendingPrompts.length > asked) {
    // The active player's abilities are still resolving: the other player's wait (rules 9.2.8d)
    const resume: SettledEvent = { type: 'trigger_rest', event, cardIds: theirs.map(c => c.instanceId), forced: [...forced], heap: active !== 'runner' };
    (state.whenSettled ??= []).unshift(resume);
    return;
  }
  runHandlers(state, event, theirs, forced);
  if (active !== 'runner') runHeapHandlers(state, event);
}

let firstWatchers: [string, TriggerMatchers][] | undefined;
const firstKey = (cardCode: string) => `first:${cardCode}`;

/**
 * Counts this turn's occurrences of every "first time each turn" condition (CardScript.firstEachTurn), in play or not:
 * the turn's first X is the first in the game, not the first the card saw (rules 9.3.2b, 9.6.5b, 10.11.5 example).
 */
function countFirsts(state: GameState, event: TriggerEvent): void {
  firstWatchers ??= scriptedCardCodes().flatMap(code => {
    const matchers = getCardScript(code)?.firstEachTurn;
    return matchers ? [[code, matchers] as [string, TriggerMatchers]] : [];
  });
  for (const [code, matchers] of firstWatchers) {
    const matches = matchers[event.type] as ((s: GameState, e: TriggerEvent) => boolean) | undefined;
    if (matches?.(state, event)) state.turnFlags[firstKey(code)] = (state.turnFlags[firstKey(code)] ?? 0) + 1;
  }
}

/** True while the event being handled is the turn's first occurrence of `card`'s "first time each turn" condition. */
export function firstThisTurn(state: GameState, card: CardInstance): boolean {
  return state.turnFlags[firstKey(card.cardCode)] === 1;
}

/** Resumes a fireTrigger the active player's questions paused (see above), with its cards looked up again. */
export function resumeTrigger(state: GameState, rest: Extract<SettledEvent, { type: 'trigger_rest' }>): void {
  const event = rehydrate(state, rest.event) as TriggerEvent;
  const cards = rest.cardIds.flatMap(id => {
    const card = findCardAnywhere(state, id);
    return card ? [card] : [];
  });
  runHandlers(state, event, cards, new Set(rest.forced));
  if (rest.heap) runHeapHandlers(state, event);
}

/**
 * Once the active player's questions are answered, the other player's paused abilities resolve before the game goes
 * on (rules 9.2.8d: every pending ability resolves before the window closes), not after the run or step they belong to.
 */
export function resumeTriggers(state: GameState): void {
  while (!state.pendingPrompts.length && !state.winner && state.whenSettled?.[0]?.type === 'trigger_rest') {
    resumeTrigger(state, state.whenSettled.shift() as Extract<SettledEvent, { type: 'trigger_rest' }>);
  }
}

/** The event's cards as they are now: a paused event was saved with copies (every action works on a copy of the state). */
function rehydrate(state: GameState, value: unknown): unknown {
  if (Array.isArray(value)) return value.map(v => rehydrate(state, v));
  if (value && typeof value === 'object') {
    const id = (value as { instanceId?: unknown }).instanceId;
    if (typeof id === 'string' && 'cardCode' in value) return findCardAnywhere(state, id) ?? value;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rehydrate(state, v)]));
  }
  return value;
}

function runHandlers(state: GameState, event: TriggerEvent, cards: CardInstance[], forced: Set<string>): void {
  for (const card of cards) {
    if (state.winner) return;
    const handler = (getCardScript(card.cardCode)?.triggers as TriggerHandlers | undefined)?.[event.type] as
      | ((ctx: { state: GameState; card: CardInstance; side: SideCode }, e: TriggerEvent) => void)
      | undefined;
    if (!handler) continue;
    // Skip cards that left play while earlier handlers resolved, unless explicitly included.
    if (!forced.has(card.instanceId) && !isStillActive(state, card)) continue;
    handler({ state, card, side: cardDef(card).side_code }, event);
  }
}

/** Cards that react from the heap (Jeitinho). */
function runHeapHandlers(state: GameState, event: TriggerEvent): void {
  for (const card of [...state.runner.heap]) {
    if (state.winner) return;
    const handler = (getCardScript(card.cardCode)?.heapTriggers as TriggerHandlers | undefined)?.[event.type] as
      | ((ctx: { state: GameState; card: CardInstance; side: SideCode }, e: TriggerEvent) => void)
      | undefined;
    if (handler && state.runner.heap.includes(card)) handler({ state, card, side: 'runner' }, event);
  }
}

function isStillActive(state: GameState, card: CardInstance): boolean {
  return activeCards(state).some(c => c.instanceId === card.instanceId);
}

/** The run events whose run is in progress: their abilities apply during it (S-Dobrado, Eye for an Eye, Spree). */
export function runEventCards(state: GameState): CardInstance[] {
  const run = state.activeRun;
  if (!run || run.accessOnly || run.runEffects.length === 0) return [];
  return run.runEffects.flatMap(r => {
    const card = findCardAnywhere(state, r.instanceId);
    return card && cardDef(card).type_code === 'event' ? [card] : [];
  });
}

/** Looks up a card by id in any zone (used for run effects and persistent cards). */
export function cardById(state: GameState, instanceId: string): CardInstance | undefined {
  return findCardAnywhere(state, instanceId);
}
