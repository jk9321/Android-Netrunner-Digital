import { CardInstance, GameAction, GameState, SideCode, activePrompt, cardDef } from '../core';

/**
 * Installs that trash installed cards (rules 8.5.6: an agenda or asset
 * replacing one in a remote, cards chosen to trash first, a second console,
 * a second copy of a unique card) are confirmed first, naming each card.
 */

/** Does this action install a card: the install click, or answering an effect's install prompt? */
export function isInstallAction(state: GameState, action: GameAction): boolean {
  if (action.type === 'INSTALL_CARD') return true;
  if (action.type !== 'RESOLVE_PROMPT') return false;
  const prompt = activePrompt(state);
  return !!prompt && 'source' in prompt && !!prompt.source.data?.install;
}

function installedCards(state: GameState, side: SideCode): CardInstance[] {
  if (side === 'corp') return Object.values(state.corp.servers).flatMap(s => [...s.ice, ...s.root]);
  const { programs, hardware, resources } = state.runner.rig;
  return [...programs, ...hardware, ...resources];
}

/** The side's installed cards before the action that are no longer installed after it (as they were before). */
export function installedCardsLost(prev: GameState, next: GameState, side: SideCode): CardInstance[] {
  const still = new Set(installedCards(next, side).map(c => c.instanceId));
  return installedCards(prev, side).filter(c => !still.has(c.instanceId));
}

/** The side's cards installed by the action. */
export function installedCardsGained(prev: GameState, next: GameState, side: SideCode): CardInstance[] {
  const before = new Set(installedCards(prev, side).map(c => c.instanceId));
  return installedCards(next, side).filter(c => !before.has(c.instanceId));
}

/**
 * The confirm question for an install that trashes cards. Only the owner is
 * asked, so facedown cards are named too, marked unrezzed.
 */
export function replacementMessage(installed: CardInstance[], lost: CardInstance[]): string {
  const what = installed.length > 0 ? installed.map(c => cardDef(c).title).join(' and ') : 'this card';
  const names = lost.map(c => {
    const def = cardDef(c);
    const facedown = def.side_code === 'corp' && !c.isRezzed && !c.faceUp;
    return `• ${def.title}${facedown ? ' (unrezzed)' : ''}`;
  });
  return `Installing ${what} will trash ${lost.length === 1 ? 'this installed card' : `these ${lost.length} installed cards`}:\n${names.join('\n')}`;
}
