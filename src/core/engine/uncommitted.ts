import { GameAction } from '../types/actions';
import { SideCode } from '../types/card';
import { Prompt } from '../types/prompts';
import { GameState } from '../types/state';
import { executeAction } from './gameEngine';

/**
 * Taking back a choice made before an action does anything.
 *
 * The rules pay an ability's or a card's costs first and only then announce
 * the targets of its first instruction (rules 9.5.7b-c for paid abilities,
 * 8.6.7b-f and 9.7.2a for events and operations), so a player decides on
 * Red Team's server only after spending the click. A player at a real table
 * makes that decision before announcing the ability, though, and can still
 * change their mind while nothing has happened. The UI gives that back: when
 * the first thing a card does after its costs is ask its own player to choose
 * (no instruction has resolved, nothing new has been seen), the person may
 * cancel the choice and the action is never sent.
 */

/** Set while uncommittedChoice() watches an action: the state just before and just after the card's effect runs. */
let watch: { depth: number; promptsBefore?: number; before?: string; after?: string } | null = null;

/** The state as far as the effect is concerned: everything but the log and the prompts it may queue. */
function snapshot(state: GameState): string {
  return JSON.stringify({ ...state, log: null, pendingPrompts: null, nextPromptId: null });
}

/** Called just before an ability's effect or an event's or operation's play abilities resolve (costs already paid). */
export function effectResolving(state: GameState): void {
  if (!watch) return;
  if (watch.depth++ === 0 && watch.before === undefined) {
    watch.promptsBefore = state.pendingPrompts.length;
    watch.before = snapshot(state);
  }
}

/** Called right after that effect returns, before any trash-this cost is carried out. */
export function effectResolved(state: GameState): void {
  if (!watch) return;
  if (--watch.depth === 0 && watch.after === undefined) watch.after = snapshot(state);
}

/** Cards the side may not look at: the other side's hand, both decks, and for the Runner facedown Archives. */
function hiddenFrom(state: GameState, side: SideCode): Set<string> {
  const { corp, runner } = state;
  const zones = side === 'runner' ? [corp.hq, corp.rd, corp.archives.faceDown, runner.stack] : [runner.grip, runner.stack, corp.rd];
  return new Set(zones.flat().map(c => c.instanceId));
}

/**
 * If `action` (a player's ability or event/operation) only pays its costs and
 * then asks that player to choose for the card's first instruction, returns
 * the state with that prompt waiting; otherwise null. Cancelling the prompt
 * then means never applying the action. Not when the choice shows a card the
 * player couldn't see before (searching the stack, cards in R&D), when another
 * effect or the other player acts first, or when part of the card already
 * resolved.
 */
export function uncommittedChoice(state: GameState, action: GameAction): { next: GameState; prompt: Prompt } | null {
  if (action.type !== 'USE_ABILITY' && action.type !== 'PLAY_OPERATION_OR_EVENT') return null;
  if (state.pendingPrompts.length > 0 || state.winner) return null;
  const seen = { depth: 0 } as NonNullable<typeof watch>;
  watch = seen;
  let next: GameState;
  try {
    next = executeAction(state, action);
  } catch {
    return null;
  } finally {
    watch = null;
  }
  if (seen.before === undefined || seen.before !== seen.after || seen.promptsBefore !== 0) return null;
  if (next.pendingPrompts.length !== 1) return null;
  const prompt = next.pendingPrompts[0];
  if (prompt.kind !== 'effect_choice' && prompt.kind !== 'effect_cards') return null;
  if (prompt.side !== action.player || prompt.source.instanceId !== action.cardInstanceId) return null;
  const hidden = hiddenFrom(state, action.player);
  const shown = prompt.kind === 'effect_cards' ? prompt.candidateIds : prompt.options.map(o => o.id);
  if (shown.some(id => hidden.has(id))) return null;
  return { next, prompt };
}
