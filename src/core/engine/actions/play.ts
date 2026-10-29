import { PlayOperationOrEventAction } from '../../types/actions';
import { CardInstance, SideCode } from '../../types/card';
import { GameState } from '../../types/state';
import { cardDef } from '../../cards';
import { getCardScript } from '../../scripts';
import { NotImplementedError } from '../errors';
import { addLog } from '../log';
import { illegal, removeCard, requireActionPhase, requireClicks } from '../helpers';
import { runnerHandZone } from './install';
import { bumpTurnFlag, TurnFlag } from '../cardEffects';
import { activeCards, fireTrigger } from '../triggers';
import { effectResolved, effectResolving } from '../uncommitted';

/**
 * Basic action: spend a click and the play cost, move the card to the
 * discard pile (face up), then resolve its scripted effect.
 */
export function playOperationOrEvent(state: GameState, action: PlayOperationOrEventAction): void {
  const side = action.player;
  requireActionPhase(state, side);
  const card = playableCard(state, side, action.cardInstanceId);
  const extra = Math.max(0, (getCardScript(card.cardCode)?.extraClicks ?? 0) - playClickDiscount(state, side, card));
  requireClicks(state, side, 1 + extra);
  const zone = side === 'corp' ? state.corp.hq : runnerHandZone(state, card.instanceId)!;
  const blocker = playBlocker(state, side, card, true);
  if (blocker) illegal(blocker);
  state[side].clicks -= 1 + extra;
  playCardFrom(state, side, card, zone, { fromHand: true, clicksSpent: 1 + extra });
}

/** Clicks off a double's play action (Synchrocyclotron). */
function playClickDiscount(state: GameState, side: SideCode, card: CardInstance): number {
  return activeCards(state, side).reduce((n, c) => n + (getCardScript(c.cardCode)?.modifiers?.playClickDiscount?.(state, c, card) ?? 0), 0);
}

/** An operation's or event's play cost right now (Tailgate: 1 less for each ice protecting HQ). */
export function playCost(state: GameState, card: CardInstance): number {
  const cost = (cardDef(card).cost || 0) + (getCardScript(card.cardCode)?.playCostModifier?.(state, card) ?? 0);
  return Math.max(0, cost);
}

function playableCard(state: GameState, side: SideCode, instanceId: string): CardInstance {
  const zone = side === 'corp' ? state.corp.hq : runnerHandZone(state, instanceId);
  const card = zone?.find(c => c.instanceId === instanceId);
  if (!card) illegal(side === 'corp' ? 'Card not in HQ' : 'Card not in Grip');
  return card;
}

/** Why this operation or event can't be played now (type, script, restrictions, cost), or null. */
export function playBlocker(state: GameState, side: SideCode, card: CardInstance, fromHand: boolean): string | null {
  const def = cardDef(card);
  const playable = side === 'corp' ? 'operation' : 'event';
  if (def.type_code !== playable) return `Only ${playable}s can be played`;
  const script = getCardScript(card.cardCode);
  if (!script?.onPlay) throw new NotImplementedError(`${def.title} (card effect)`);
  const restriction = script.canPlay?.({ state, card, side, playedFromHand: fromHand });
  if (restriction) return restriction;
  const cost = playCost(state, card);
  if (state[side].credits < cost) return `Need ${cost} credits to play ${def.title}`;
  return null;
}

export interface PlayOptions {
  /** Played from HQ or the grip (Petty Cash gains a click otherwise). */
  fromHand: boolean;
  /** Clicks the play action spent, for the log. */
  clicksSpent?: number;
  /** "After it resolves, remove it from the game" (Petty Cash, Plutus). */
  removeAfter?: boolean;
}

/**
 * Plays an operation or event from any zone: pays its play cost, moves it to
 * the discard pile and resolves it. Clicks are the caller's business.
 */
export function playCardFrom(state: GameState, side: SideCode, card: CardInstance, zone: CardInstance[], options: PlayOptions): void {
  const blocker = playBlocker(state, side, card, options.fromHand);
  if (blocker) illegal(blocker);
  const def = cardDef(card);
  const script = getCardScript(card.cardCode)!;
  const cost = playCost(state, card);
  state[side].credits -= cost;
  removeCard(zone, card);
  card.isRezzed = true;
  if (side === 'corp') state.corp.archives.faceUp.push(card);
  else state.runner.heap.push(card);

  const clicks = options.clicksSpent ? `${'[click]'.repeat(options.clicksSpent)} and ` : '';
  addLog(state, side, `${side === 'corp' ? 'Corp' : 'Runner'} spent ${clicks}${cost} [credit] to play ${def.title}.`, card.cardCode);
  if (side === 'corp') {
    bumpTurnFlag(state, TurnFlag.operationsPlayed);
    if (/\bdouble\b/i.test(def.keywords ?? '')) bumpTurnFlag(state, TurnFlag.doublesPlayed);
    fireTrigger(state, { type: 'operation_played', card });
  } else {
    fireTrigger(state, { type: 'event_played', card });
  }
  effectResolving(state);
  script.onPlay!({ state, card, side, playedFromHand: options.fromHand });
  effectResolved(state);
  if (options.removeAfter) {
    const pile = side === 'corp' ? state.corp.archives.faceUp : state.runner.heap;
    if (removeCard(pile, card)) {
      state.removedFromGame.push(card);
      addLog(state, side, `${def.title} was removed from the game.`);
    }
  }
}
