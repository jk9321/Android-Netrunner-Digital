import { CardInstance, GameAction, GameState, SideCode, activePrompt, cardDef, getCardScript } from '../core';

/**
 * Installs that trash installed cards (rules 8.5.6: an agenda or asset
 * replacing one in a remote, cards chosen to trash first, a second console,
 * a second copy of a unique card) are confirmed first, naming each card.
 * Cards that trash themselves solely because their hosted credits were spent
 * to pay for the install (Open Market) are excluded — the log records them.
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

function emptiedTitles(prev: GameState, next: GameState, side: SideCode): Map<string, number> {
  const counts = new Map<string, number>();
  const suffix = ' is empty and was trashed.';
  for (const entry of next.log.slice(prev.log.length)) {
    if (entry.player !== side || !entry.message.endsWith(suffix)) continue;
    const title = entry.message.slice(0, -suffix.length);
    counts.set(title, (counts.get(title) ?? 0) + 1);
  }
  return counts;
}

/**
 * The side's installed cards before the action that are no longer installed after it (as they were before),
 * excluding cards that trashed themselves because their hosted credits were emptied by paying for the install.
 */
export function installedCardsLost(prev: GameState, next: GameState, side: SideCode): CardInstance[] {
  const still = new Set(installedCards(next, side).map(c => c.instanceId));
  const emptied = emptiedTitles(prev, next, side);
  const lost: CardInstance[] = [];
  for (const card of installedCards(prev, side)) {
    if (still.has(card.instanceId)) continue;
    const title = cardDef(card).title;
    const n = emptied.get(title) ?? 0;
    if (n > 0 && getCardScript(card.cardCode)?.trashWhenEmpty) {
      emptied.set(title, n - 1);
      continue;
    }
    lost.push(card);
  }
  return lost;
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
