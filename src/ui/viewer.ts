import { CardInstance, GameAction, GameState, SideCode, activePrompt, getLegalActions, isLegalAction } from '../core';

/** Whose eyes are on the screen: one side, or both (open table, for testing). */
export type Viewer = SideCode | 'both';

/** How the screen chooses its viewer. Pass and play follows whoever has to act. */
export type ViewMode = 'open' | 'hotseat' | SideCode;

export const canSeeCorpSecrets = (viewer: Viewer) => viewer !== 'runner';
export const canSeeRunnerSecrets = (viewer: Viewer) => viewer !== 'corp';
export const canActAs = (viewer: Viewer, side: SideCode) => viewer === 'both' || viewer === side;

/**
 * The Corp's chance to rez during a run: the approached ice, or the unrezzed
 * cards in the attacked server's root before the Runner approaches the server.
 * The engine lets the Corp rez whenever it is legal; this names the moments
 * the UI stops to ask, so pass and play can hand the screen over.
 *
 * Whether a window opens depends only on what the Runner can see (an
 * unrezzed card in that position), never on whether the Corp can rez it:
 * otherwise a missing handoff or AI pause would tell the Runner the card is
 * an agenda, or more than the Corp can afford (rules 4.6.3).
 */
export interface RezWindow {
  /** Identifies this window so a "no rez" answer is remembered. */
  key: string;
  cards: CardInstance[];
  /** Corp abilities usable now (LEO Construction, Proprionegation), offered with the rez buttons. */
  abilities: Extract<GameAction, { type: 'USE_ABILITY' }>[];
}

export function corpRezWindow(state: GameState, runSerial: number): RezWindow | null {
  const run = state.activeRun;
  if (!run || state.winner || activePrompt(state)) return null;
  const server = state.corp.servers[run.server];
  if (!server) return null;
  const rezzable = (c: CardInstance) =>
    !c.isRezzed && isLegalAction(state, { type: 'REZ_CARD', player: 'corp', cardInstanceId: c.instanceId });

  let unrezzed: CardInstance[] = [];
  if (run.phase === 'approach_ice' && run.icePosition !== null) {
    const ice = server.ice[run.icePosition];
    if (ice && !ice.isRezzed) unrezzed = [ice];
  } else if (run.phase === 'approach_server' && !run.serverApproached) {
    unrezzed = server.root.filter(c => !c.isRezzed);
  }
  const cards = unrezzed.filter(rezzable);
  // Abilities alone open a window only before the Runner approaches the server, so
  // pass and play doesn't hand the screen over at every piece of ice
  const abilities =
    unrezzed.length > 0 || (run.phase === 'approach_server' && !run.serverApproached)
      ? getLegalActions(state, 'corp').filter((a): a is RezWindow['abilities'][number] => a.type === 'USE_ABILITY')
      : [];
  if (unrezzed.length === 0 && abilities.length === 0) return null;
  // The server is part of the key: Proprionegation moves the Runner to another server mid-run
  return { key: `${state.turnNumber}|${runSerial}|${run.server}|${run.phase}|${run.icePosition}`, cards, abilities };
}

/**
 * The computer Runner's chance to use paid abilities on the Corp's turn
 * (Madani's install): the last paid ability window of the Corp's action
 * phase, once the Corp has spent its clicks (rules 5.6.2a-b, 9.2.7a). It
 * opens only when the Runner has an ability it could use. Returns the
 * window's key, or null.
 */
export function runnerOffTurnWindow(state: GameState): string | null {
  if (state.winner || state.activePlayer !== 'corp' || state.activeRun || state.turnStep || activePrompt(state)) return null;
  if (state.corp.clicks > 0) return null;
  if (!getLegalActions(state, 'runner').some(a => a.type === 'USE_ABILITY')) return null;
  return `off|${state.turnNumber}`;
}

/** The side the game is waiting on, or null when the game is over. */
export function actingSide(state: GameState, rezWindowOpen: boolean, offTurnOpen = false): SideCode | null {
  if (state.winner) return null;
  const prompt = activePrompt(state);
  if (prompt) return prompt.side;
  if (rezWindowOpen) return 'corp';
  if (offTurnOpen) return 'runner';
  if (state.activeRun) return 'runner';
  return state.activePlayer;
}
