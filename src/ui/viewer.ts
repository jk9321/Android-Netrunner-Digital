import { CardInstance, GameAction, SideCode, WindowStep, actingSide, activePrompt } from '../core';
import type { Seat } from './seatLegality';

/** Whose eyes are on the screen: one side, or both (open table, for testing). */
export type Viewer = SideCode | 'both';

/** How the screen chooses its viewer. Pass and play follows whoever has to act. */
export type ViewMode = 'open' | 'hotseat' | SideCode;

export const canSeeCorpSecrets = (viewer: Viewer) => viewer !== 'runner';
export const canSeeRunnerSecrets = (viewer: Viewer) => viewer !== 'corp';
export const canActAs = (viewer: Viewer, side: SideCode) => viewer === 'both' || viewer === side;

/** What the Corp may do in the run window it holds priority in: rez the approached ice or the attacked server's root, or use abilities. */
export interface RezWindow {
  cards: CardInstance[];
  /** Corp abilities usable now (LEO Construction, Proprionegation), offered with the rez buttons. */
  abilities: Extract<GameAction, { type: 'USE_ABILITY' }>[];
}

/**
 * The Corp's priority in a paid ability window during a run (rules
 * 6.9.2b, 6.9.4e and, with full control, the others): the cards it can rez
 * there and its usable abilities. Null when the Corp doesn't hold priority.
 * Whether the Corp gets this window depends only on what the Runner can see
 * (an unrezzed card in that position), never on whether it can pay (rules 4.6.3).
 */
export function corpRezWindow(seat: Seat): RezWindow | null {
  const { state } = seat;
  const run = state.activeRun;
  const w = state.priority;
  if (!run || !w || w.holder !== 'corp' || state.winner || activePrompt(state)) return null;
  const server = state.corp.servers[run.server];
  if (!server) return null;
  const at =
    w.step === 'approach_ice' && run.icePosition !== null
      ? [server.ice[run.icePosition]].filter(Boolean)
      : w.step === 'approach_server' || w.step === 'move_inward' || w.step === 'run_initiation'
        ? server.root
        : [];
  const cards = at.filter(c => !c.isRezzed && seat.can({ type: 'REZ_CARD', player: 'corp', cardInstanceId: c.instanceId }));
  const abilities = seat.legal.filter((a): a is RezWindow['abilities'][number] => a.type === 'USE_ABILITY' && a.player === 'corp');
  return { cards, abilities };
}

/** What each paid ability window is, for the bar that offers Pass (rules 5.6, 5.7, 6.9). */
export function windowLabel(step: WindowStep, holder: SideCode, active: SideCode): string {
  const theirs = holder !== active;
  switch (step) {
    case 'corp_draw':
      return 'Before the Corp\'s turn begins';
    case 'corp_action':
      return theirs ? 'Before the Corp\'s next action' : 'Corp action phase';
    case 'runner_action':
      return theirs ? 'Before the Runner\'s next action' : 'Runner action phase';
    case 'corp_discard':
      return 'After the Corp discards, before its turn ends';
    case 'runner_turn_start':
      return 'Before the Runner\'s turn begins';
    case 'runner_discard':
      return 'After the Runner discards, before its turn ends';
    case 'run_initiation':
      return 'The run has begun';
    case 'approach_ice':
      return 'The Runner approaches ice';
    case 'encounter':
      return 'The Runner encounters ice';
    case 'movement':
      return 'The Runner passed ice';
    case 'move_inward':
      return 'The Runner moves inward';
    case 'approach_server':
      return 'Before the Runner approaches the server';
  }
}

/** The side the game is waiting on, or null when the game is over. */
export { actingSide };
