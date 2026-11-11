import { CardInstance } from '../types/card';
import { CorpState, GameState, RunnerRig, RunnerState, ServerState } from '../types/state';
import { createRng, shuffleInPlace } from '../rng';
import { getCardDefinition } from '../cards';

export interface GameSetup {
  /** Seed for all randomness in the game. Same seed + same actions = same game. */
  seed: number;
  corpIdentity: string;
  corpDeck: string[];
  runnerIdentity: string;
  runnerDeck: string[];
}

/** Creates a new card instance with a deterministic id drawn from the state's counter. */
export function createCardInstance(state: Pick<GameState, 'nextInstanceId'>, cardCode: string): CardInstance {
  getCardDefinition(cardCode); // fail fast on unknown codes
  return {
    instanceId: `inst-${state.nextInstanceId++}`,
    cardCode,
    isRezzed: false,
    advancementCounters: 0,
    tokens: {},
    hostedCardIds: [],
  };
}

export function createInitialGameState(setup: GameSetup): GameState {
  const rng = createRng(setup.seed);
  const ids = { nextInstanceId: 1 };

  const corpIdentity = createCardInstance(ids, setup.corpIdentity);
  corpIdentity.isRezzed = true;

  const runnerIdentity = createCardInstance(ids, setup.runnerIdentity);
  runnerIdentity.isRezzed = true;

  // Build Central Servers
  const servers: Record<string, ServerState> = {
    hq: { id: 'hq', name: 'HQ', isRemote: false, ice: [], root: [] },
    rd: { id: 'rd', name: 'R&D', isRemote: false, ice: [], root: [] },
    archives: { id: 'archives', name: 'Archives', isRemote: false, ice: [], root: [] },
  };

  // Instantiate cards and shuffle decks
  const shuffledCorpDeck = shuffleInPlace(rng, setup.corpDeck.map(code => createCardInstance(ids, code)));
  const shuffledRunnerDeck = shuffleInPlace(rng, setup.runnerDeck.map(code => createCardInstance(ids, code)));

  // Corp draws opening hand of 5 cards. The turn-1 mandatory draw happens
  // when the Corp's first turn begins, after both players decide on mulligans.
  const corpHand = shuffledCorpDeck.splice(0, 5);
  const corpState: CorpState = {
    credits: 5,
    clicks: 0, // gained when the first turn begins
    maxClicks: 3,
    badPublicity: 0,
    handSizeLimit: 5,
    scoreArea: [],
    score: 0,
    identity: corpIdentity,
    hq: corpHand,
    rd: shuffledCorpDeck,
    archives: { faceUp: [], faceDown: [] },
    servers,
    remoteCounter: 0,
  };

  // Runner draws opening hand of 5 cards
  const runnerHand = shuffledRunnerDeck.splice(0, 5);
  const runnerRig: RunnerRig = {
    programs: [],
    hardware: [],
    resources: [],
  };

  const runnerState: RunnerState = {
    credits: 5,
    clicks: 0, // gained when the Runner's turn begins
    maxClicks: 4,
    tags: 0,
    coreDamage: 0,
    memoryUnitsTotal: 4,
    memoryUnitsUsed: 0,
    handSizeLimit: 5,
    scoreArea: [],
    score: 0,
    identity: runnerIdentity,
    grip: runnerHand,
    stack: shuffledRunnerDeck,
    heap: [],
    rig: runnerRig,
  };

  return {
    id: `game-${rng.seed}`,
    rng,
    nextInstanceId: ids.nextInstanceId,
    pendingPrompts: [
      { id: 'prompt-1', side: 'corp', kind: 'mulligan', message: 'Corp: keep your opening hand or mulligan?' },
      { id: 'prompt-2', side: 'runner', kind: 'mulligan', message: 'Runner: keep your opening hand or mulligan?' },
    ],
    nextPromptId: 3,
    runsThisTurn: [],
    runnerLastTurnRuns: [],
    turnFlags: {},
    removedFromGame: [],
    turnStep: null,
    turnNumber: 1,
    activePlayer: 'corp', // Corp always goes first in Netrunner
    phase: 'corp_turn',
    corp: corpState,
    runner: runnerState,
    activeRun: null,
    winner: null,
    winReason: null,
    log: [
      {
        id: 'log-0',
        turnNumber: 1,
        player: 'system',
        message: `Game started. Both players may mulligan, then the Corp takes the first turn.`,
      },
    ],
  };
}
