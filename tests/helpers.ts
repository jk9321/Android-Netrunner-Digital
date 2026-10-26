import { createInitialGameState, createCardInstance, cardDef, executeAction, getLegalActions, GameState, CardTypeCode, SideCode } from '../src/core';
import { GameSetup } from '../src/core/engine/gameState';
import { sampleGameSetup } from './sampleDecks';

/** A starter-deck game still waiting on both mulligan decisions. */
export function newGameAtSetup(seed = 1): GameState {
  return createInitialGameState(sampleGameSetup(seed));
}

/** A fresh starter-deck game where both players kept, at the start of Corp turn 1. */
export function newGame(seed = 1): GameState {
  let state = newGameAtSetup(seed);
  while (state.pendingPrompts.length > 0) {
    const p = state.pendingPrompts[0];
    state = executeAction(state, {
      type: 'RESOLVE_PROMPT',
      player: p.side,
      promptId: p.id,
      choice: { kind: 'mulligan', mulligan: false },
    });
  }
  return state;
}

/** Answers the active prompt (test shorthand). */
export function answer(state: GameState, choice: import('../src/core').PromptChoice): GameState {
  const p = state.pendingPrompts[0];
  if (!p) throw new Error('No prompt pending');
  return executeAction(state, { type: 'RESOLVE_PROMPT', player: p.side, promptId: p.id, choice });
}

/**
 * Moves the first card of the given type from a side's deck into its hand
 * (test setup only) and returns its instance id.
 */
export function putInHand(state: GameState, side: 'corp' | 'runner', type: CardTypeCode): string {
  const deck = side === 'corp' ? state.corp.rd : state.runner.stack;
  const hand = side === 'corp' ? state.corp.hq : state.runner.grip;
  const idx = deck.findIndex(c => cardDef(c).type_code === type);
  if (idx === -1) throw new Error(`No ${type} left in ${side} deck`);
  const [card] = deck.splice(idx, 1);
  hand.push(card);
  return card.instanceId;
}

/** Hands the turn to the Runner without going through actions (test setup only). */
export function startRunnerTurn(state: GameState): void {
  state.activePlayer = 'runner';
  state.phase = 'runner_turn';
  state.runner.clicks = state.runner.maxClicks;
}

/** Moves a specific card (by type) from the Corp deck into a server root or ice, bypassing costs (test setup only). */
export function installForTest(
  state: GameState,
  type: CardTypeCode,
  serverId: string,
  where: 'root' | 'ice' = type === 'ice' ? 'ice' : 'root'
): string {
  const idx = state.corp.rd.findIndex(c => cardDef(c).type_code === type);
  if (idx === -1) throw new Error(`No ${type} left in R&D`);
  const [card] = state.corp.rd.splice(idx, 1);
  if (!state.corp.servers[serverId]) {
    state.corp.servers[serverId] = { id: serverId, name: serverId, isRemote: true, ice: [], root: [] };
  }
  state.corp.servers[serverId][where].push(card);
  return card.instanceId;
}

/** Creates a new copy of a card (by code) directly in a player's hand (test setup only). */
export function giveCard(state: GameState, side: 'corp' | 'runner', code: string): string {
  const card = createCardInstance(state, code);
  (side === 'corp' ? state.corp.hq : state.runner.grip).push(card);
  return card.instanceId;
}

/** Plays a card from hand (test shorthand). */
export function play(state: GameState, side: 'corp' | 'runner', cardInstanceId: string): GameState {
  return keepGoing(executeAction(state, { type: 'PLAY_OPERATION_OR_EVENT', player: side, cardInstanceId }));
}

/** Installs a specific ice (by code) as the outermost ice on a server, rezzed by default (test setup only). */
export function installIceForTest(state: GameState, code: string, serverId: string, rezzed = true): string {
  const card = createCardInstance(state, code);
  card.isRezzed = rezzed;
  if (!state.corp.servers[serverId]) {
    state.corp.servers[serverId] = { id: serverId, name: serverId, isRemote: true, ice: [], root: [] };
  }
  state.corp.servers[serverId].ice.push(card);
  return card.instanceId;
}

/** Puts a specific program into the Runner's rig, bypassing costs (test setup only). */
export function installProgramForTest(state: GameState, code: string): string {
  const card = createCardInstance(state, code);
  card.isRezzed = true;
  state.runner.rig.programs.push(card);
  state.runner.memoryUnitsUsed += cardDef(card).memory_cost || 0;
  return card.instanceId;
}

/** Starts the Runner's turn, runs the server and continues once (into the first encounter). */
export function runIntoFirstIce(state: GameState, serverId: string): GameState {
  startRunnerTurn(state);
  const s = executeAction(state, { type: 'INITIATE_RUN', player: 'runner', targetServerId: serverId });
  return cont(s);
}

/** One CONTINUE_RUN, stopping in the Movement Phase (where the Runner may jack out). */
export const step = (state: GameState) => executeAction(state, { type: 'CONTINUE_RUN', player: 'runner' });

/**
 * Keeps going through the Movement Phase, where the Runner declines to jack
 * out, and through breach-order choices, taking candidates as listed (root first).
 */
export const keepGoing = (state: GameState): GameState => {
  const p = state.pendingPrompts[0];
  if (p?.kind === 'access_order') {
    return keepGoing(executeAction(state, { type: 'RESOLVE_PROMPT', player: 'runner', promptId: p.id, choice: { kind: 'access_order', optionId: p.options[0].id } }));
  }
  return state.activeRun?.phase === 'movement' && !p ? step(state) : state;
};

/** Continues the run, and declines to jack out when that lands in the Movement Phase. */
export const cont = (state: GameState) => keepGoing(step(state));

/** Gives the Runner a card and installs it with the install action (on the Runner's turn, with spare credits). */
export function runnerInstall(state: GameState, code: string, hostInstanceId?: string): [GameState, string] {
  if (state.activePlayer !== 'runner') startRunnerTurn(state);
  const id = giveCard(state, 'runner', code);
  state.runner.credits += 20;
  state.runner.clicks += 1;
  const next = executeAction(state, { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: id, hostInstanceId });
  next.runner.credits -= 20;
  return [next, id];
}

/** Puts a specific Corp card (by code) into a server root, optionally rezzed, bypassing costs (test setup only). */
export function installCorpForTest(state: GameState, code: string, serverId: string, rezzed = false): string {
  const card = createCardInstance(state, code);
  if (!state.corp.servers[serverId]) {
    state.corp.servers[serverId] = { id: serverId, name: serverId, isRemote: true, ice: [], root: [] };
  }
  state.corp.servers[serverId].root.push(card);
  if (rezzed) card.isRezzed = true;
  return card.instanceId;
}

/** Rezzes a Corp card with the rez action, giving the Corp the credits for it. */
export function rezForTest(state: GameState, instanceId: string): GameState {
  state.corp.credits += 20;
  const next = executeAction(state, { type: 'REZ_CARD', player: 'corp', cardInstanceId: instanceId });
  next.corp.credits -= 20;
  return next;
}

/** Installs a fully advanced agenda (by code) in a new remote and scores it on the Corp's turn. */
export function scoreForTest(state: GameState, code: string, serverId = 'remote-score'): GameState {
  const id = installCorpForTest(state, code, serverId);
  const card = state.corp.servers[serverId].root.find(c => c.instanceId === id)!;
  card.advancementCounters = cardDef(card).advancement_cost ?? 0;
  if (state.activePlayer !== 'corp') {
    state.activePlayer = 'corp';
    state.phase = 'corp_turn';
  }
  return executeAction(state, { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: id });
}

/** Replaces a side's identity (test setup only). */
export function setIdentity(state: GameState, side: 'corp' | 'runner', code: string): void {
  const card = createCardInstance(state, code);
  card.isRezzed = true;
  state[side].identity = card;
}

/** Uses an ability by index on a card (test shorthand). */
export function useAbility(state: GameState, side: 'corp' | 'runner', cardInstanceId: string, abilityIndex = 0): GameState {
  return keepGoing(executeAction(state, { type: 'USE_ABILITY', player: side, cardInstanceId, abilityIndex }));
}

/** Starts a run with the basic action on the Runner's turn. */
export function run(state: GameState, serverId: string): GameState {
  if (state.activePlayer !== 'runner') startRunnerTurn(state);
  if (state.runner.clicks < 1) state.runner.clicks = 1;
  return keepGoing(executeAction(state, { type: 'INITIATE_RUN', player: 'runner', targetServerId: serverId }));
}

/** Ends the current turn, spending leftover clicks and declining any discard (test shorthand). */
export function passTurn(state: GameState): GameState {
  const side = state.activePlayer;
  state[side].clicks = 0;
  let s = executeAction(state, { type: 'END_TURN', player: side });
  while (s.pendingPrompts[0]?.kind === 'discard') {
    const p = s.pendingPrompts[0];
    const hand = p.side === 'corp' ? s.corp.hq : s.runner.grip;
    s = answer(s, { kind: 'discard', cardInstanceIds: hand.slice(0, p.kind === 'discard' ? p.count : 0).map(c => c.instanceId) });
  }
  return s;
}

/**
 * Plays whole games by picking random legal actions, to check that the
 * engine never offers an action it then rejects, never gets stuck with no
 * legal action, and never throws an unexpected error.
 */
export function playout(seed: number, maxSteps: number, setup: GameSetup = sampleGameSetup(seed)): GameState {
  let state = createInitialGameState(setup);
  let rand = seed;
  const next = () => {
    rand = (rand * 1103515245 + 12345) % 2147483648;
    return rand / 2147483648;
  };
  for (let step = 0; step < maxSteps && !state.winner; step++) {
    const sides: SideCode[] = state.pendingPrompts.length > 0 ? [state.pendingPrompts[0].side] : [state.activePlayer];
    let actions = sides.flatMap(side => getLegalActions(state, side));
    // During a run the Corp may also rez; give it a turn sometimes.
    if (state.activeRun && state.pendingPrompts.length === 0 && next() < 0.3) {
      const corp = getLegalActions(state, 'corp');
      if (corp.length > 0) actions = corp;
    }
    if (actions.length === 0) throw new Error(`Seed ${seed}: no legal actions at step ${step}`);
    const action = actions[Math.floor(next() * actions.length)];
    state = executeAction(state, action);
  }
  return state;
}

