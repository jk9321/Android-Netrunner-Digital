import { CardInstance, SideCode } from '../types/card';
import { GameState, ServerState } from '../types/state';
import { cardDef } from '../cards';
import { IllegalActionError } from './errors';
import { addLog } from './log';

export const WINNING_SCORE = 7;

export function illegal(message: string): never {
  throw new IllegalActionError(message);
}

/** Identifies the current turn, e.g. "3-corp". */
export function turnKey(state: GameState): string {
  return `${state.turnNumber}-${state.activePlayer}`;
}

export function madeSuccessfulRunThisTurn(state: GameState): boolean {
  return state.runsThisTurn.some(r => r.successful);
}

export function requireClicks(state: GameState, side: SideCode, count = 1): void {
  if (state[side].clicks < count) illegal('Not enough clicks');
}

/**
 * Click actions (and ending the turn) are only available to the active
 * player during their own action phase, never during a run.
 */
export function requireActionPhase(state: GameState, side: SideCode): void {
  if (state.activePlayer !== side) illegal(`It is not the ${side === 'corp' ? 'Corp' : 'Runner'}'s turn`);
  if (state.activeRun) illegal('Not allowed during a run');
  if (state.turnStep?.kind === 'corp_turn_start') illegal('Start your turn (mandatory draw) first');
}

export function createRemoteServer(state: GameState): ServerState {
  state.corp.remoteCounter += 1;
  const id = `remote-${state.corp.remoteCounter}`;
  const server: ServerState = {
    id,
    name: `Remote Server ${state.corp.remoteCounter}`,
    isRemote: true,
    ice: [],
    root: [],
  };
  state.corp.servers[id] = server;
  return server;
}

/** Finds an installed Corp card (ice or root) by instance id. */
export function findInstalledCorpCard(
  state: GameState,
  instanceId: string
): { card: CardInstance; server: ServerState; location: 'ice' | 'root' } | null {
  for (const server of Object.values(state.corp.servers)) {
    const ice = server.ice.find(c => c.instanceId === instanceId);
    if (ice) return { card: ice, server, location: 'ice' };
    const root = server.root.find(c => c.instanceId === instanceId);
    if (root) return { card: root, server, location: 'root' };
  }
  return null;
}

/** Finds a Corp card anywhere the Runner can access it (servers, HQ, R&D, Archives). */
export function locateCorpCard(
  state: GameState,
  instanceId: string
): { card: CardInstance; zone: CardInstance[]; inArchives: boolean } | null {
  const zones: [CardInstance[], boolean][] = [
    ...Object.values(state.corp.servers).flatMap(s => [[s.root, false], [s.ice, false]] as [CardInstance[], boolean][]),
    [state.corp.hq, false],
    [state.corp.rd, false],
    [state.corp.archives.faceUp, true],
    [state.corp.archives.faceDown, true],
  ];
  for (const [zone, inArchives] of zones) {
    const card = zone.find(c => c.instanceId === instanceId);
    if (card) return { card, zone, inArchives };
  }
  return null;
}

/** Finds any card in any zone of either player, for effects and UI. */
export function findCardAnywhere(state: GameState, instanceId: string): CardInstance | undefined {
  const corp = locateCorpCard(state, instanceId);
  if (corp) return corp.card;
  const r = state.runner;
  const zones = [r.grip, r.stack, r.heap, r.rig.programs, r.rig.hardware, r.rig.resources, r.scoreArea, state.corp.scoreArea, state.removedFromGame, [r.identity, state.corp.identity]];
  const hosted = [...r.rig.programs, ...r.rig.hardware, ...r.rig.resources].flatMap(c => c.hostedCards ?? []);
  return [...zones.flat(), ...hosted].find(c => c.instanceId === instanceId);
}

/**
 * Draws up to `count` cards. A Corp draw from an empty R&D loses the game;
 * the Runner simply draws as many as the Stack holds.
 */
export function drawCards(state: GameState, side: SideCode, count: number): number {
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    const deck = side === 'corp' ? state.corp.rd : state.runner.stack;
    if (deck.length === 0) {
      if (side === 'corp') {
        state.winner = 'runner';
        state.winReason = 'Corp decked out (R&D is empty)';
        addLog(state, 'system', 'Runner wins: Corp had to draw from an empty R&D.');
      }
      break;
    }
    (side === 'corp' ? state.corp.hq : state.runner.grip).push(deck.shift()!);
    drawn++;
  }
  return drawn;
}

/** Removes a card from an array by instance id. Returns true if it was there. */
export function removeCard(cards: CardInstance[], card: CardInstance): boolean {
  const idx = cards.findIndex(c => c.instanceId === card.instanceId);
  if (idx === -1) return false;
  cards.splice(idx, 1);
  return true;
}

/**
 * Trashes an installed Corp card to Archives (faceup if it was rezzed or faceup).
 * Runner programs hosted on it (Botulus, Tranquilizer) are trashed too.
 */
export function trashInstalledCorpCard(state: GameState, server: ServerState, card: CardInstance): void {
  removeCard(server.root, card) || removeCard(server.ice, card);
  for (const hostedId of card.hostedCardIds) {
    const hosted = state.runner.rig.programs.find(c => c.instanceId === hostedId);
    if (!hosted) continue;
    removeCard(state.runner.rig.programs, hosted);
    state.runner.memoryUnitsUsed -= cardDef(hosted).memory_cost || 0;
    hosted.hostedOnId = undefined;
    hosted.tokens = {};
    state.runner.heap.push(hosted);
    addLog(state, 'runner', `${cardDef(hosted).title} was trashed along with its host.`);
  }
  card.hostedCardIds = [];
  card.tokens = {};
  delete card.runnerKnows;
  // Faceup if the Runner could see it (rezzed, or an agenda installed faceup with BANGUN): rules 4.4.6b
  const visible = card.isRezzed || !!card.faceUp;
  card.isRezzed = false;
  delete card.faceUp;
  card.advancementCounters = 0;
  if (visible) {
    state.corp.archives.faceUp.push(card);
  } else {
    state.corp.archives.faceDown.push(card);
  }
}

/** True if the card can receive advancement counters via the advance action. */
export function isAdvanceable(card: CardInstance): boolean {
  const def = cardDef(card);
  return def.type_code === 'agenda' || /you can advance this/i.test(def.stripped_text ?? def.text ?? '');
}

/** Ends the game if either side has reached the winning score. */
export function checkAgendaVictory(state: GameState): void {
  if (state.winner) return;
  if (state.corp.score >= WINNING_SCORE) {
    state.winner = 'corp';
    state.winReason = `Corp scored ${WINNING_SCORE} agenda points!`;
    addLog(state, 'system', `Victory: Corp has reached ${WINNING_SCORE} agenda points!`);
  } else if (state.runner.score >= WINNING_SCORE) {
    state.winner = 'runner';
    state.winReason = `Runner scored ${WINNING_SCORE} agenda points!`;
    addLog(state, 'system', `Victory: Runner reached ${WINNING_SCORE} agenda points!`);
  }
}
