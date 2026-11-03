import { CardInstance, SideCode } from '../types/card';
import { GameState } from '../types/state';
import { cardDef } from '../cards';
import { getCardScript } from '../scripts';
import { TriggerEvent, TriggerHandlers } from '../scripts/types';
import { findCardAnywhere } from './helpers';

/**
 * Cards whose abilities are active: identities, rezzed Corp cards in
 * servers, agendas in the Corp's score area, and installed Runner cards.
 * (Agendas in the Runner's score area are inactive.)
 */
export function activeCards(state: GameState, side?: SideCode): CardInstance[] {
  const corp = (): CardInstance[] => [
    state.corp.identity,
    // Agendas whose printed text installs them faceup are active while installed (rules 3.2.3a)
    ...Object.values(state.corp.servers)
      .flatMap(s => [...s.ice, ...s.root])
      .filter(c => c.isRezzed || (c.faceUp && getCardScript(c.cardCode)?.installFaceUpOnly)),
    // Runner cards added to the Corp's score area as agendas (Word on the Street) are not the Corp's to use
    ...state.corp.scoreArea.filter(c => cardDef(c).side_code === 'corp'),
  ];
  const runner = (): CardInstance[] => {
    const { programs, hardware, resources } = state.runner.rig;
    return [state.runner.identity, ...programs, ...hardware, ...resources];
  };
  if (side === 'corp') return corp();
  if (side === 'runner') return runner();
  return [...corp(), ...runner()];
}

/**
 * Lets every active card react to an event, Corp cards first. `extra` adds
 * cards whose ability applies although they are inactive (a stolen agenda's
 * "when stolen", a persistent card trashed during the run).
 */
export function fireTrigger(state: GameState, event: TriggerEvent, extra: CardInstance[] = []): void {
  const seen = new Set<string>();
  // The run event whose run is in progress reacts to that run's events (S-Dobrado, Window of Opportunity)
  const runEvents = runEventCards(state);
  const cards = [...activeCards(state), ...extra, ...runEvents].filter(c => !seen.has(c.instanceId) && seen.add(c.instanceId));
  for (const card of cards) {
    if (state.winner) return;
    const handler = (getCardScript(card.cardCode)?.triggers as TriggerHandlers | undefined)?.[event.type] as
      | ((ctx: { state: GameState; card: CardInstance; side: SideCode }, e: TriggerEvent) => void)
      | undefined;
    if (!handler) continue;
    // Skip cards that left play while earlier handlers resolved, unless explicitly included.
    if (!extra.includes(card) && !runEvents.includes(card) && !isStillActive(state, card)) continue;
    handler({ state, card, side: cardDef(card).side_code }, event);
  }
  // Cards that react from the heap (Jeitinho)
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
