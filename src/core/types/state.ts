import { CardInstance, SideCode } from './card';
import { RngState } from '../rng';
import { Prompt } from './prompts';

export type CentralServerType = 'hq' | 'rd' | 'archives';
export type ServerType = CentralServerType | string; // remote names like "remote-1"

export interface ServerState {
  id: string; // 'hq', 'rd', 'archives', or 'remote-1', 'remote-2'
  name: string;
  isRemote: boolean;
  ice: CardInstance[]; // Array of installed ice, index 0 is innermost (closest to server root)
  root: CardInstance[]; // Cards installed in the root of the server (assets, agendas, upgrades)
}

export interface CorpState {
  credits: number;
  clicks: number;
  maxClicks: number;
  badPublicity: number;
  handSizeLimit: number;
  scoreArea: CardInstance[];
  score: number;
  identity: CardInstance;
  hq: CardInstance[]; // Cards in hand
  rd: CardInstance[]; // Draw deck (top of deck is index 0)
  archives: {
    faceUp: CardInstance[];
    faceDown: CardInstance[];
  };
  servers: Record<string, ServerState>;
  remoteCounter: number;
  /** Extra clicks for the Corp's next turn (Aggressive Trendsetting). */
  bonusClicksNextTurn?: number;
}

export interface RunnerRig {
  programs: CardInstance[];
  hardware: CardInstance[];
  resources: CardInstance[];
}

export interface RunnerState {
  credits: number;
  clicks: number;
  maxClicks: number;
  tags: number;
  coreDamage: number;
  memoryUnitsTotal: number;
  memoryUnitsUsed: number;
  handSizeLimit: number;
  scoreArea: CardInstance[];
  score: number;
  identity: CardInstance;
  grip: CardInstance[]; // Hand
  stack: CardInstance[]; // Draw deck (top of deck is index 0)
  heap: CardInstance[]; // Discard pile (face up)
  rig: RunnerRig;
}

export type RunPhase =
  | 'initiation'
  | 'approach_ice'
  | 'encounter_ice'
  | 'pass_ice'
  | 'approach_server'
  | 'access'
  | 'complete';

/** The Runner's current encounter with a piece of ice. */
export interface EncounterState {
  iceId: string;
  /** One entry per subroutine on the ice: has it been broken? */
  broken: boolean[];
  /** Strength added to each icebreaker (by instance id) for this encounter. */
  boosts: Record<string, number>;
  /** Index of the next unbroken subroutine to resolve, once resolution has started. */
  resolvingIndex: number | null;
  /** The ice's own "when encountered" ability still has to resolve (after the Runner's, e.g. Fransofia Ward). */
  onEncounterPending?: boolean;
  /** Strength change to the encountered ice for this encounter only (e.g. Leech). */
  iceStrengthModifier: number;
}

/** A card whose "if successful" effect is attached to this run (Red Team, Jailbreak, Conduit). */
export interface RunEffectSource {
  cardCode: string;
  instanceId: string;
}

export interface RunState {
  server: string;
  phase: RunPhase;
  icePosition: number | null; // index into server.ice (outermost down to 0)
  isSuccessful: boolean;
  isJackedOut: boolean;
  cannotJackOut: boolean;
  /** Instance ids still to be accessed during the breach, in order. */
  accessQueue: string[];
  /** The encounter in progress, if the Runner is encountering ice. */
  encounter: EncounterState | null;
  /** Number of pieces of ice the Runner has passed (jacking out needs at least 1). */
  icePassed: number;
  /** Set by Ansel 1.0: the Runner cannot steal or trash Corp cards this run. */
  cannotStealOrTrash: boolean;
  /** Programs to trash when the run ends (e.g. Mayfly after using its ability). */
  trashAtRunEnd: string[];
  /** Cards whose run-scoped effects apply (see CardScript.onRunSuccessful). */
  runEffects: RunEffectSource[];
  /** Extra cards to access when breaching the attacked server (Jailbreak, Conduit). */
  extraAccesses: number;
  /** Cards accessed so far this run (Zahya). */
  accessedCount: number;
  /** Did the Runner steal an agenda this run (AMAZE Amusements)? */
  stoleAgenda: boolean;
  /** Added to the rez cost of each piece of ice during this run (Tread Lightly). */
  iceRezCostIncrease: number;
  /** Credits the Runner can spend only during this run, spent before their pool (Overclock). */
  bonusCredits: number;
  /** Persistent cards trashed during this run whose abilities still apply until it ends (AMAZE). */
  persistentIds: string[];
  /** The server each persistent card was in when it was trashed. */
  persistentServers: Record<string, string>;
  /** Has a subroutine resolved during this run (Ryō "Phoenix" Ōno)? */
  subroutineResolved: boolean;
  /** Instance ids of the cards accessed this run, and where (Charm Offensive). */
  accessed: { id: string; inArchives: boolean }[];
  /** Has the breach queued its cards yet? (Breach abilities like Devadatta Drone resolve first.) */
  breached: boolean;
  /** The first time the Corp would end this run, it must trash cards from HQ or the run goes on (Shred). */
  shredArmed: boolean;
  /** At Archives, the Runner approaches HQ instead (Maintenance Access). */
  redirectToHq: boolean;
  /** The run event that started this run, if any (Sang Kancil). */
  eventCode: string | null;
  /** Strength added to icebreakers for the rest of the run, by instance id (GAMEDRAGON™ Pro). */
  runBoosts: Record<string, number>;
  /** Not a run: the Runner is only accessing cards (Detente). No run abilities apply. */
  accessOnly: boolean;
}

/** The end of a turn or the Corp's draw, paused while players answer prompts (see engine/actions/turn.ts). */
export type TurnStep =
  | { kind: 'end_turn'; side: SideCode; stage: 'action_ended' | 'discarding' | 'discarded' | 'handover' }
  /** The paid ability window before the Corp's turn formally begins (rules 5.6.1b): rez, score, use paid abilities. */
  | { kind: 'corp_turn_start' }
  | { kind: 'corp_draw' };

export type TurnPlayer = SideCode;

export type GamePhase =
  | 'corp_turn'
  | 'runner_turn'
  | 'run'
  | 'game_over';

/** What a log line records, for the UI (sounds, the accessed-cards panel) so it never reads the wording. */
export type LogEvent = 'access' | 'damage' | 'rez' | 'install';

export interface LogEntry {
  id: string;
  turnNumber: number;
  player: SideCode | 'system';
  message: string;
  cardCode?: string;
  event?: LogEvent;
}

export interface GameState {
  id: string;
  /** Seeded RNG; all randomness in the engine must go through this. */
  rng: RngState;
  /** Counter for deterministic card instance ids. */
  nextInstanceId: number;
  /** Decisions the game is waiting on; the first one must be resolved next. */
  pendingPrompts: Prompt[];
  /** Counter for deterministic prompt ids. */
  nextPromptId: number;
  /** Runs made during the current turn (reset when the turn passes). */
  runsThisTurn: { server: string; successful: boolean }[];
  /** Runs the Runner made during their most recent turn (Public Trail). */
  runnerLastTurnRuns: { server: string; successful: boolean }[];
  /**
   * Counters and "once per turn" flags for the current turn, reset when the
   * turn passes. Keys are listed in engine/turnFlags.ts.
   */
  turnFlags: Record<string, number>;
  /** Cards removed from the game (Spin Doctor). */
  removedFromGame: CardInstance[];
  /** A turn transition waiting on prompts or the Corp (end of turn, start of the Corp's turn, mandatory draw). */
  turnStep?: TurnStep | null;
  turnNumber: number;
  activePlayer: TurnPlayer;
  phase: GamePhase;
  corp: CorpState;
  runner: RunnerState;
  activeRun: RunState | null;
  winner: SideCode | null;
  winReason: string | null;
  log: LogEntry[];
}
