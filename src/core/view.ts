/**
 * Per-player views (multiplayer phase 1). viewFor() turns the full GameState
 * into what one side is allowed to see, with card ids the other side cannot
 * decode. It is a pure function: the id map is passed in and a new one is
 * returned, and nothing is kept between calls (no module-level state).
 *
 * Every field is copied by whitelist: the classification tables below name
 * each key of the state types as public, own-side, redacted or dropped, so a
 * new state field fails the build until someone decides who may see it.
 *
 * Rules cited are the Comprehensive Rules v26.03.
 *
 * Ids. The engine numbers instances inst-N in decklist order before the
 * shuffle, so a real id would say which card is where. The view gives each
 * card the viewer can see an id of its own ('c1'... for the Corp, 'r1'...
 * for the Runner), minted the first time the viewer sees it and kept while
 * it stays in sight. A card that leaves the viewer's sight (back into a deck
 * or a hidden hand, facedown into Archives seen from the Runner) is a new
 * object when it comes back (rules 1.12.3) and gets a fresh id. Moving
 * between open positions (1.12.4) or turning facedown in place (1.12.5)
 * keeps it. viewFor must therefore be called on every state the viewer is
 * shown, so that a card's trip through a hidden place is noticed.
 */
import type { CardInstance, SideCode } from './types/card';
import type {
  CorpState,
  GameState,
  LogEntry,
  PriorityWindow,
  RunState,
  RunnerState,
  StopLevel,
  TurnStep,
  EncounterState,
  ServerState,
} from './types/state';
import type { GameAction } from './types/actions';
import type { Prompt, PromptChoice } from './types/prompts';
import { IllegalActionError } from './engine/errors';
import { actingSide } from './engine/priority';

// --- Types ------------------------------------------------------------------------

/** A viewer's id map. Plain JSON, so the server can store it with the game. */
export interface ViewIds {
  /** The number of the next id to mint. */
  next: number;
  /** Viewer id to real instance id. */
  real: Record<string, string>;
  /** Real instance id to viewer id. */
  view: Record<string, string>;
}

/**
 * A card as one viewer sees it. `cardCode` is missing when the viewer may see
 * where the card is but not what it is (an unrezzed Corp card seen by the
 * Runner, rules 4.6.2).
 */
export interface CardView {
  instanceId: string;
  cardCode?: string;
  isRezzed: boolean;
  faceUp?: boolean;
  advancementCounters: number;
  tokens: Record<string, number>;
  /** Hosted installed cards the viewer can see, by viewer id. */
  hostedCardIds: string[];
  /** All hosted installed cards, seen or not. */
  hostedCount: number;
  hostedOnId?: string;
  installedTurn?: string;
  flipped?: boolean;
  runnerKnows?: boolean;
  hostedCards?: CardView[];
  asAgendaPoints?: number;
  scoredTurn?: string;
  chosenSubtypes?: string[];
  cannotScoreTurn?: string;
}

/** A hand: the owner gets every card; the opponent gets the count and the names they know (rules 4.3.2, 4.3.4). */
export interface HandView {
  count: number;
  cards: CardView[];
  /** Cards the opponent has seen in this hand, by code only (see KnownHandCard). */
  known: string[];
}

/** R&D or the stack: hidden from both players, only the count is open (rules 4.2.2, 4.2.4). */
export interface DeckView {
  count: number;
  /** The Runner's view of R&D: cards they have seen there and where they may be now (rules 7.4.7a). */
  known?: { code: string; lo: number; hi: number; left?: 'hq' | 'other' }[];
}

export interface ServerView {
  id: string;
  name: string;
  isRemote: boolean;
  ice: CardView[];
  root: CardView[];
}

export interface CorpView {
  credits: number;
  clicks: number;
  maxClicks: number;
  badPublicity: number;
  handSizeLimit: number;
  scoreArea: CardView[];
  score: number;
  identity: CardView;
  hq: HandView;
  rd: DeckView;
  archives: { faceUp: CardView[]; faceDown: { count: number; cards: CardView[] } };
  servers: Record<string, ServerView>;
  remoteCounter: number;
  bonusClicksNextTurn?: number;
  meliesServer?: 'hq' | 'rd' | 'archives';
}

export interface RunnerView {
  credits: number;
  clicks: number;
  maxClicks: number;
  tags: number;
  coreDamage: number;
  memoryUnitsTotal: number;
  memoryUnitsUsed: number;
  handSizeLimit: number;
  scoreArea: CardView[];
  score: number;
  identity: CardView;
  grip: HandView;
  stack: DeckView;
  heap: CardView[];
  rig: { programs: CardView[]; hardware: CardView[]; resources: CardView[] };
  bonusClicksNextTurn?: number;
}

/**
 * A prompt waiting on the viewer. Card ids are viewer ids; `cards` holds every
 * card the prompt names, so a card the prompt lets the viewer look at (the top
 * of R&D, the card being accessed) is shown even though its zone is hidden.
 * The engine's `source.data` is never sent (it holds the Corp's Psi Game bid,
 * rules 10.14.1-2); what the UI needs from it is copied out as `installs`.
 */
export interface MyPromptView {
  id: string;
  kind: Prompt['kind'];
  side: SideCode;
  message: string;
  count?: number;
  cardInstanceId?: string;
  trashCost?: number | null;
  alternatives?: { id: string; label: string }[];
  options?: { id: string; label: string }[];
  candidateIds?: string[];
  min?: number;
  max?: number;
  source?: { cardCode: string; instanceId?: string; step: string };
  /** The prompt installs a card (source.data.install): the UI offers cards to trash first (rules 8.5.6). */
  installs?: boolean;
  /** The card it installs (source.data.cardId), by viewer id. */
  installCardId?: string;
  cards: CardView[];
}

export type PromptView = MyPromptView;

export interface LogEntryView {
  /**
   * The line's place in this viewer's log ('v0', 'v1', ...), not the engine's id: a line kept from the viewer
   * leaves no gap that would say a hidden card was an agenda (rules 4.2.2, 7.1.2). Stable across a viewer's
   * successive views, since which lines a viewer gets is fixed when they are written.
   */
  id: string;
  turnNumber: number;
  player: LogEntry['player'];
  message: string;
  cardCode?: string;
  event?: LogEntry['event'];
}

export interface EncounterView {
  iceId?: string;
  broken: boolean[];
  boosts: Record<string, number>;
  resolvingIndex: number | null;
  onEncounterPending?: boolean;
  iceStrengthModifier: number;
  grantedSubs?: { cardCode: string; index: number }[];
  fullyBroken?: boolean;
  brokenBy?: Record<number, string>;
  cannotEndRun?: boolean;
  flags?: Record<string, number>;
}

/** The run in progress. Card ids are viewer ids; cards the viewer cannot see are left out (the access queue is a count). */
export interface RunView {
  server: string;
  phase: RunState['phase'];
  icePosition: number | null;
  isSuccessful: boolean;
  isJackedOut: boolean;
  cannotJackOut: boolean;
  /** Cards still to be accessed in this breach (their ids are hidden: they may be R&D cards). */
  accessQueueCount: number;
  encounter: EncounterView | null;
  icePassed: number;
  cannotStealOrTrash: boolean;
  trashAtRunEnd: string[];
  runEffects: { cardCode: string; instanceId?: string }[];
  passing?: SideCode[];
  extraAccesses: number;
  accessedCount: number;
  stoleAgenda: boolean;
  iceRezCostIncrease: number;
  bonusCredits: number;
  persistentIds: string[];
  persistentServers: Record<string, string>;
  subroutineResolved: boolean;
  accessed: { id: string; inArchives: boolean }[];
  breached: boolean;
  breach?: { root: string[]; zone: 'hq' | 'rd' | 'archives' | null; zoneLeft: number; chosenCount: number };
  shredArmed: boolean;
  redirectToHq: boolean;
  eventCode: string | null;
  runBoosts: Record<string, number>;
  accessOnly: boolean;
  serverApproached?: boolean;
  badPublicityCredits?: number;
  creditHosts?: string[];
  poolLocked?: boolean;
  protectedTitles?: string[];
  iceStrengthBonus?: number;
  notDeclaredSuccessful?: boolean;
  bakerRedirect?: boolean;
  runFlags?: Record<string, number>;
  iceGains?: Record<string, { cardCode: string; index: number }[]>;
  iceRunStrength?: Record<string, number>;
  breachInstead?: RunState['breachInstead'];
  accessOnlyIds?: string[];
  noAccessIds?: string[];
  trashCreditHosts?: string[];
}

export interface PriorityView {
  step: PriorityWindow['step'];
  holder: SideCode;
  received: boolean;
  acted?: boolean;
  /** The active player's declared action (5.6.2b, 5.7.1f): only in the active player's own view. */
  intent?: GameAction;
}

export interface GameView {
  id: string;
  /** Whose view this is. */
  viewer: SideCode;
  /**
   * The viewer's own pending prompts only. The opponent's prompts are left out
   * altogether: whether one exists can tell what a hidden card is (an R&D card
   * the Runner may trash gets an access_trash prompt, 4.2.2, 7.1.2).
   */
  pendingPrompts: PromptView[];
  /** Who the game is waiting on (actingSide), so a client can say "waiting for the Runner". */
  waitingOn: SideCode | null;
  runsThisTurn: { server: string; successful: boolean }[];
  runnerLastTurnRuns: { server: string; successful: boolean }[];
  runnerLastTurnStoleOrTrashed?: boolean;
  turnFlags: Record<string, number>;
  removedFromGame: CardView[];
  turnStep?: TurnStep | null;
  priority?: PriorityView | null;
  stops?: Partial<Record<SideCode, StopLevel>>;
  turnNumber: number;
  activePlayer: SideCode;
  phase: GameState['phase'];
  corp: CorpView;
  runner: RunnerView;
  activeRun: RunView | null;
  winner: SideCode | null;
  winReason: string | null;
  log: LogEntryView[];
}

// --- Classification ---------------------------------------------------------------
//
// public: both sides see it as is. own: only its owner (or the side it names) sees it in full.
// redacted: built field by field below (ids remapped, hidden codes left out).
// dropped: engine internals no client gets.

type Vis = 'public' | 'own' | 'redacted' | 'dropped';

/** Top-level GameState keys. */
export const GAME_STATE_FIELDS = {
  id: 'redacted', // `game-<seed>` names the seed: replaced by the caller's game id
  rng: 'dropped', // the seed predicts every shuffle
  nextInstanceId: 'dropped',
  pendingPrompts: 'own', // only the prompted side gets it, whole but for source.data (10.14.2: Psi Game bids are secret); its existence can name a hidden card (7.1.2)
  nextPromptId: 'dropped',
  runsThisTurn: 'public',
  runnerLastTurnRuns: 'public',
  runnerLastTurnStoleOrTrashed: 'public',
  bareAssets: 'dropped', // the AI's read of the Runner; no client needs it
  whenSettled: 'dropped', // engine bookkeeping for "when you finish" triggers
  turnFlags: 'redacted', // keys naming a card the viewer can't see are left out, the rest remapped
  removedFromGame: 'public', // 4.9.6
  turnStep: 'public',
  priority: 'redacted', // the declared intent is the active player's own
  stops: 'public',
  turnNumber: 'public',
  activePlayer: 'public',
  phase: 'public',
  corp: 'redacted',
  runner: 'redacted',
  activeRun: 'redacted',
  winner: 'public',
  winReason: 'public',
  log: 'redacted', // LogEntry.secret; view-local ids (4.2.2, 7.1.2)
} as const satisfies Record<keyof GameState, Vis>;

export const CORP_STATE_FIELDS = {
  credits: 'public', // 1.10.2: credit pools are open
  clicks: 'public',
  maxClicks: 'public',
  badPublicity: 'public',
  handSizeLimit: 'public',
  scoreArea: 'public', // 4.5.2
  score: 'public',
  identity: 'public',
  hq: 'redacted', // 4.3.2: the Corp sees HQ; the Runner sees its count (4.3.4) and the cards they know
  rd: 'redacted', // 4.2.2: hidden from both; 4.2.4: the count is open
  archives: 'redacted', // 4.4.6c: faceup cards are open, facedown cards only to the Corp
  servers: 'redacted', // 4.6.2, 4.6.3
  remoteCounter: 'public',
  bonusClicksNextTurn: 'public',
  meliesServer: 'own', // 1.5.2b: secret until the identity flips
  knownToRunner: 'redacted', // shown as hq.known, codes only
  rdKnownToRunner: 'own', // the Runner's memory of R&D; names R&D accesses the Corp may not see (7.1.2)
  rdNotes: 'dropped',
} as const satisfies Record<keyof CorpState, Vis>;

export const RUNNER_STATE_FIELDS = {
  credits: 'public',
  clicks: 'public',
  maxClicks: 'public',
  tags: 'public',
  coreDamage: 'public',
  memoryUnitsTotal: 'public',
  memoryUnitsUsed: 'public',
  handSizeLimit: 'public',
  scoreArea: 'public',
  score: 'public',
  identity: 'public',
  grip: 'redacted', // 4.3.2, 4.3.4
  stack: 'redacted', // 4.2.2, 4.2.4
  heap: 'public', // 4.4.7b
  rig: 'public', // 4.6.4c: installed Runner cards are faceup (the engine has no facedown Runner installs)
  knownToCorp: 'redacted', // shown as grip.known
  bonusClicksNextTurn: 'public',
} as const satisfies Record<keyof RunnerState, Vis>;

/** CardInstance keys: 'public' is shown even on a card whose face is hidden; 'own' only with the face. */
export const CARD_FIELDS = {
  instanceId: 'redacted', // remapped
  cardCode: 'own', // 4.6.2: hidden while the card is facedown
  isRezzed: 'public',
  advancementCounters: 'public', // counters are on the table (4.6.2)
  tokens: 'public',
  hostedCardIds: 'redacted', // the ones the viewer can see, plus a count
  hostedOnId: 'redacted',
  installedTurn: 'public', // the install itself is open
  flipped: 'own',
  faceUp: 'public',
  runnerKnows: 'public', // the Corp saw the access too (7.1.2), except R&D accesses, which are never installed
  hostedCards: 'own', // hosted faceup (Bling, Madani); shown with the host's face
  asAgendaPoints: 'own',
  scoredTurn: 'own',
  chosenSubtypes: 'own',
  cannotScoreTurn: 'own',
} as const satisfies Record<keyof CardInstance, Vis>;

export const RUN_STATE_FIELDS = {
  server: 'public',
  phase: 'public',
  icePosition: 'public',
  isSuccessful: 'public',
  isJackedOut: 'public',
  cannotJackOut: 'public',
  accessQueue: 'redacted', // a count: queued R&D cards are hidden
  encounter: 'redacted',
  icePassed: 'public',
  cannotStealOrTrash: 'public',
  trashAtRunEnd: 'redacted',
  runEffects: 'redacted',
  passing: 'public',
  extraAccesses: 'public',
  accessedCount: 'public',
  stoleAgenda: 'public',
  iceRezCostIncrease: 'public',
  bonusCredits: 'public',
  persistentIds: 'redacted',
  persistentServers: 'redacted',
  subroutineResolved: 'public',
  accessed: 'redacted',
  breached: 'public',
  breach: 'redacted',
  shredArmed: 'public',
  redirectToHq: 'public',
  eventCode: 'public',
  runBoosts: 'redacted',
  accessOnly: 'public',
  serverApproached: 'public',
  badPublicityCredits: 'public',
  creditHosts: 'redacted',
  poolLocked: 'public',
  protectedTitles: 'public', // Perfect Recall reveals the card
  iceStrengthBonus: 'public',
  notDeclaredSuccessful: 'public',
  bakerRedirect: 'public',
  runFlags: 'redacted', // keys may name cards
  iceGains: 'redacted',
  iceRunStrength: 'redacted',
  breachInstead: 'public',
  accessOnlyIds: 'redacted',
  noAccessIds: 'redacted',
  trashCreditHosts: 'redacted',
} as const satisfies Record<keyof RunState, Vis>;

export const ENCOUNTER_FIELDS = {
  iceId: 'redacted',
  broken: 'public',
  boosts: 'redacted',
  resolvingIndex: 'public',
  onEncounterPending: 'public',
  iceStrengthModifier: 'public',
  grantedSubs: 'public',
  fullyBroken: 'public',
  brokenBy: 'redacted',
  cannotEndRun: 'public',
  flags: 'redacted', // keys may name cards
} as const satisfies Record<keyof EncounterState, Vis>;

export const PRIORITY_FIELDS = {
  step: 'public',
  holder: 'public',
  received: 'public',
  acted: 'public',
  intent: 'own',
} as const satisfies Record<keyof PriorityWindow, Vis>;

// --- Ids --------------------------------------------------------------------------

export function newViewIds(): ViewIds {
  return { next: 1, real: {}, view: {} };
}

const INST = /inst-\d+/g;

/** A viewer id: c<N> in the Corp's view, r<N> in the Runner's. */
const VIEW_ID = /\b[cr]\d+\b/g;

// --- viewFor ----------------------------------------------------------------------

/**
 * What `side` may see of `state`. `ids` is the viewer's id map from the
 * previous call (newViewIds() for the first); the returned map replaces it.
 * Neither `state` nor `ids` is changed.
 */
export function viewFor(state: GameState, side: SideCode, ids: ViewIds, gameId: string): { view: GameView; ids: ViewIds } {
  const prefix = side === 'corp' ? 'c' : 'r';
  const out: ViewIds = { next: ids.next, real: {}, view: {} };
  /** The viewer id of a card the viewer sees now: kept from before, or minted. */
  const mint = (realId: string): string => {
    const have = out.view[realId];
    if (have) return have;
    const id = ids.view[realId] ?? `${prefix}${out.next++}`;
    out.view[realId] = id;
    out.real[id] = realId;
    return id;
  };
  /** The viewer id of a card shown somewhere in this view, or undefined. Only valid after every card is shown. */
  const ref = (realId: string | undefined): string | undefined => (realId === undefined ? undefined : out.view[realId]);
  const refs = (list: readonly string[] | undefined): string[] => (list ?? []).map(ref).filter((x): x is string => !!x);
  const refKeys = <T>(rec: Record<string, T> | undefined): Record<string, T> => {
    const res: Record<string, T> = {};
    for (const [k, v] of Object.entries(rec ?? {})) {
      const id = ref(k);
      if (id) res[id] = v;
    }
    return res;
  };
  /** Replaces every inst-N in a string with its viewer id; undefined if one is a card the viewer can't see. */
  const refText = (text: string): string | undefined => {
    let ok = true;
    const res = text.replace(INST, m => ref(m) ?? ((ok = false), m));
    return ok ? res : undefined;
  };

  /** A flags record whose keys may name cards ("once:inst-5"): those keys remapped, or left out if the card is out of sight. */
  const flagKeys = (rec: Record<string, number>): Record<string, number> => {
    const res: Record<string, number> = {};
    for (const [k, n] of Object.entries(rec)) {
      const key = refText(k);
      if (key !== undefined) res[key] = n;
    }
    return res;
  };

  // Hosted-id fixups run once every card has its id
  const fixups: (() => void)[] = [];

  /** A card the viewer sees; `face`: and what it is. */
  const card = (c: CardInstance, face: boolean): CardView => {
    const v: CardView = {
      instanceId: mint(c.instanceId),
      isRezzed: c.isRezzed,
      advancementCounters: c.advancementCounters,
      tokens: { ...c.tokens },
      hostedCardIds: [],
      hostedCount: c.hostedCardIds.length,
      ...(c.faceUp && { faceUp: true }),
      ...(c.installedTurn !== undefined && { installedTurn: c.installedTurn }),
      ...(c.runnerKnows && { runnerKnows: true }),
    };
    if (face) {
      v.cardCode = c.cardCode;
      if (c.flipped !== undefined) v.flipped = c.flipped;
      if (c.hostedCards?.length) v.hostedCards = c.hostedCards.map(h => card(h, true));
      if (c.asAgendaPoints !== undefined) v.asAgendaPoints = c.asAgendaPoints;
      if (c.scoredTurn !== undefined) v.scoredTurn = c.scoredTurn;
      if (c.chosenSubtypes) v.chosenSubtypes = [...c.chosenSubtypes];
      if (c.cannotScoreTurn !== undefined) v.cannotScoreTurn = c.cannotScoreTurn;
    }
    fixups.push(() => {
      v.hostedCardIds = refs(c.hostedCardIds);
      const on = ref(c.hostedOnId);
      if (on) v.hostedOnId = on;
    });
    return v;
  };
  const open = (list: CardInstance[]) => list.map(c => card(c, true));
  /** An installed Corp card: its face only once rezzed, faceup or seen by the Runner (4.6.2, 4.6.3, 1.12.5). */
  const corpInstalled = (c: CardInstance) => card(c, side === 'corp' || c.isRezzed || !!c.faceUp || !!c.runnerKnows);

  // Every card in the state by real id, to show the cards a prompt names
  const all = new Map<string, CardInstance>();
  const index = (c: CardInstance) => {
    all.set(c.instanceId, c);
    for (const h of c.hostedCards ?? []) index(h);
  };
  const c = state.corp;
  const r = state.runner;
  for (const list of [
    [c.identity, r.identity],
    ...Object.values(c.servers).flatMap(s => [s.ice, s.root]),
    c.hq, c.rd, c.archives.faceUp, c.archives.faceDown, c.scoreArea,
    r.grip, r.stack, r.heap, r.rig.programs, r.rig.hardware, r.rig.resources, r.scoreArea,
    state.removedFromGame,
  ]) list.forEach(index);

  // Cards, in a fixed order so ids are minted the same way every time
  const identities = { corp: card(c.identity, true), runner: card(r.identity, true) };
  const servers: Record<string, ServerView> = {};
  for (const [key, s] of Object.entries(c.servers) as [string, ServerState][]) {
    servers[key] = { id: s.id, name: s.name, isRemote: s.isRemote, ice: s.ice.map(corpInstalled), root: s.root.map(corpInstalled) };
  }
  const corpScore = open(c.scoreArea);
  const faceUpArchives = open(c.archives.faceUp);
  const faceDownArchives = side === 'corp' ? open(c.archives.faceDown) : [];
  const hqCards = side === 'corp' ? open(c.hq) : [];
  const rig = { programs: open(r.rig.programs), hardware: open(r.rig.hardware), resources: open(r.rig.resources) };
  const heap = open(r.heap);
  const gripCards = side === 'runner' ? open(r.grip) : [];
  const runnerScore = open(r.scoreArea);
  const removed = open(state.removedFromGame);

  // The viewer's own prompts may name cards from hidden zones (the top of R&D, the accessed card)
  const promptCards = new Map<string, CardView[]>();
  for (const p of state.pendingPrompts) {
    if (p.side !== side) continue;
    const named = new Set<string>();
    if (p.kind === 'access_trash') named.add(p.cardInstanceId);
    if (p.kind === 'effect_cards') p.candidateIds.forEach(id => named.add(id));
    if (p.kind === 'effect_choice' || p.kind === 'effect_cards') {
      if (p.source.data?.install && typeof p.source.data.cardId === 'string') named.add(p.source.data.cardId);
    }
    if (p.kind === 'access_order' || p.kind === 'effect_choice') {
      for (const o of p.options) for (const m of o.id.match(INST) ?? []) named.add(m);
    }
    const cards: CardView[] = [];
    for (const id of named) {
      const found = all.get(id);
      if (found) cards.push(card(found, true));
    }
    promptCards.set(p.id, cards);
  }

  for (const f of fixups) f();

  // --- Everything else, now that every card shown has its id ---

  const hand = (cards: CardView[], count: number, known: { code: string }[] | undefined): HandView => ({
    count,
    cards,
    known: (known ?? []).map(e => e.code),
  });

  const corp: CorpView = {
    credits: c.credits,
    clicks: c.clicks,
    maxClicks: c.maxClicks,
    badPublicity: c.badPublicity,
    handSizeLimit: c.handSizeLimit,
    scoreArea: corpScore,
    score: c.score,
    identity: identities.corp,
    hq: hand(hqCards, c.hq.length, c.knownToRunner),
    rd: {
      count: c.rd.length,
      ...(side === 'runner' && c.rdKnownToRunner?.length && {
        known: c.rdKnownToRunner.map(k => ({ code: k.code, lo: k.lo, hi: k.hi, ...(k.left && { left: k.left }) })),
      }),
    },
    archives: { faceUp: faceUpArchives, faceDown: { count: c.archives.faceDown.length, cards: faceDownArchives } },
    servers,
    remoteCounter: c.remoteCounter,
    ...(c.bonusClicksNextTurn !== undefined && { bonusClicksNextTurn: c.bonusClicksNextTurn }),
    // 1.5.2b: the Runner learns the side when the identity flips
    ...(c.meliesServer && (side === 'corp' || c.identity.flipped) && { meliesServer: c.meliesServer }),
  };

  const runner: RunnerView = {
    credits: r.credits,
    clicks: r.clicks,
    maxClicks: r.maxClicks,
    tags: r.tags,
    coreDamage: r.coreDamage,
    memoryUnitsTotal: r.memoryUnitsTotal,
    memoryUnitsUsed: r.memoryUnitsUsed,
    handSizeLimit: r.handSizeLimit,
    scoreArea: runnerScore,
    score: r.score,
    identity: identities.runner,
    grip: hand(gripCards, r.grip.length, r.knownToCorp),
    stack: { count: r.stack.length },
    heap,
    rig,
    ...(r.bonusClicksNextTurn !== undefined && { bonusClicksNextTurn: r.bonusClicksNextTurn }),
  };

  const prompts: PromptView[] = state.pendingPrompts.filter(p => p.side === side).map(p => {
    const v: MyPromptView = { id: p.id, kind: p.kind, side: p.side, message: p.message, cards: promptCards.get(p.id) ?? [] };
    const opts = (list: { id: string; label: string }[]) =>
      list.map(o => ({ id: refText(o.id) ?? o.id.replace(INST, '?'), label: o.label.replace(INST, '?') }));
    switch (p.kind) {
      case 'discard':
        v.count = p.count;
        break;
      case 'access_trash':
        v.cardInstanceId = ref(p.cardInstanceId);
        v.trashCost = p.trashCost;
        if (p.alternatives) v.alternatives = p.alternatives.map(a => ({ id: ref(a.id) ?? '?', label: a.label }));
        break;
      case 'access_order':
        v.options = opts(p.options);
        break;
      case 'effect_choice':
      case 'effect_cards': {
        if (p.kind === 'effect_choice') v.options = opts(p.options);
        else {
          v.candidateIds = refs(p.candidateIds);
          v.min = p.min;
          v.max = p.max;
        }
        const src = ref(p.source.instanceId);
        v.source = { cardCode: p.source.cardCode, step: p.source.step, ...(src && { instanceId: src }) };
        if (p.source.data?.install) {
          v.installs = true;
          const id = typeof p.source.data.cardId === 'string' ? ref(p.source.data.cardId) : undefined;
          if (id) v.installCardId = id;
        }
        break;
      }
    }
    return v;
  });


  const log: LogEntryView[] = [];
  for (const e of state.log) {
    const hidden = e.secret?.from === side;
    if (hidden && !e.secret!.publicMessage) continue;
    log.push({
      id: `v${log.length}`,
      turnNumber: e.turnNumber,
      player: e.player,
      message: hidden ? e.secret!.publicMessage : e.message,
      ...(!hidden && e.cardCode !== undefined && { cardCode: e.cardCode }),
      ...(e.event && { event: e.event }),
    });
  }

  let priority: PriorityView | null | undefined = state.priority;
  if (state.priority) {
    const p = state.priority;
    priority = { step: p.step, holder: p.holder, received: p.received, ...(p.acted !== undefined && { acted: p.acted }) };
    // The intent is the active player's declared action; the opponent gets priority in the window before it (5.6.2a) and learns the action only when it is taken
    if (p.intent && p.intent.player === side) {
      const intent = mapAction(p.intent, ref);
      if (intent) priority.intent = intent;
    }
  }

  const view: GameView = {
    id: gameId,
    viewer: side,
    pendingPrompts: prompts,
    waitingOn: actingSide(state),
    runsThisTurn: state.runsThisTurn.map(x => ({ ...x })),
    runnerLastTurnRuns: state.runnerLastTurnRuns.map(x => ({ ...x })),
    ...(state.runnerLastTurnStoleOrTrashed !== undefined && { runnerLastTurnStoleOrTrashed: state.runnerLastTurnStoleOrTrashed }),
    turnFlags: flagKeys(state.turnFlags),
    removedFromGame: removed,
    ...(state.turnStep !== undefined && { turnStep: state.turnStep && { ...state.turnStep } }),
    ...(priority !== undefined && { priority }),
    ...(state.stops && { stops: { ...state.stops } }),
    turnNumber: state.turnNumber,
    activePlayer: state.activePlayer,
    phase: state.phase,
    corp,
    runner,
    activeRun: state.activeRun && runView(state.activeRun, ref, refs, refKeys, flagKeys),
    winner: state.winner,
    winReason: state.winReason,
    log,
  };
  return { view, ids: out };
}

function runView(
  run: RunState,
  ref: (id: string | undefined) => string | undefined,
  refs: (list: readonly string[] | undefined) => string[],
  refKeys: <T>(rec: Record<string, T> | undefined) => Record<string, T>,
  flagKeys: (rec: Record<string, number>) => Record<string, number>,
): RunView {
  const e = run.encounter;
  const encounter: EncounterView | null = e && {
    ...(ref(e.iceId) && { iceId: ref(e.iceId) }),
    broken: [...e.broken],
    boosts: refKeys(e.boosts),
    resolvingIndex: e.resolvingIndex,
    ...(e.onEncounterPending !== undefined && { onEncounterPending: e.onEncounterPending }),
    iceStrengthModifier: e.iceStrengthModifier,
    ...(e.grantedSubs && { grantedSubs: e.grantedSubs.map(g => ({ ...g })) }),
    ...(e.fullyBroken !== undefined && { fullyBroken: e.fullyBroken }),
    ...(e.brokenBy && {
      brokenBy: Object.fromEntries(Object.entries(e.brokenBy).map(([i, by]) => [i, by === 'other' ? 'other' : ref(by) ?? 'other'])),
    }),
    ...(e.cannotEndRun !== undefined && { cannotEndRun: e.cannotEndRun }),
    ...(e.flags && { flags: flagKeys(e.flags) }),
  };
  const opt = <K extends keyof RunState>(k: K) => (run[k] !== undefined ? { [k]: run[k] } : {});
  return {
    server: run.server,
    phase: run.phase,
    icePosition: run.icePosition,
    isSuccessful: run.isSuccessful,
    isJackedOut: run.isJackedOut,
    cannotJackOut: run.cannotJackOut,
    accessQueueCount: run.accessQueue.length,
    encounter,
    icePassed: run.icePassed,
    cannotStealOrTrash: run.cannotStealOrTrash,
    trashAtRunEnd: refs(run.trashAtRunEnd),
    runEffects: run.runEffects.map(x => ({ cardCode: x.cardCode, ...(ref(x.instanceId) && { instanceId: ref(x.instanceId) }) })),
    ...(run.passing && { passing: [...run.passing] }),
    extraAccesses: run.extraAccesses,
    accessedCount: run.accessedCount,
    stoleAgenda: run.stoleAgenda,
    iceRezCostIncrease: run.iceRezCostIncrease,
    bonusCredits: run.bonusCredits,
    persistentIds: refs(run.persistentIds),
    persistentServers: refKeys(run.persistentServers),
    subroutineResolved: run.subroutineResolved,
    accessed: run.accessed.flatMap(a => (ref(a.id) ? [{ id: ref(a.id)!, inArchives: a.inArchives }] : [])),
    breached: run.breached,
    ...(run.breach && {
      breach: { root: refs(run.breach.root), zone: run.breach.zone, zoneLeft: run.breach.zoneLeft, chosenCount: run.breach.chosen.length },
    }),
    shredArmed: run.shredArmed,
    redirectToHq: run.redirectToHq,
    eventCode: run.eventCode,
    runBoosts: refKeys(run.runBoosts),
    accessOnly: run.accessOnly,
    ...opt('serverApproached'),
    ...opt('badPublicityCredits'),
    ...(run.creditHosts && { creditHosts: refs(run.creditHosts) }),
    ...opt('poolLocked'),
    ...(run.protectedTitles && { protectedTitles: [...run.protectedTitles] }),
    ...opt('iceStrengthBonus'),
    ...opt('notDeclaredSuccessful'),
    ...opt('bakerRedirect'),
    ...(run.runFlags && { runFlags: flagKeys(run.runFlags) }),
    ...(run.iceGains && { iceGains: Object.fromEntries(Object.entries(refKeys(run.iceGains)).map(([k, v]) => [k, v.map(g => ({ ...g }))])) }),
    ...(run.iceRunStrength && { iceRunStrength: refKeys(run.iceRunStrength) }),
    ...opt('breachInstead'),
    ...(run.accessOnlyIds && { accessOnlyIds: refs(run.accessOnlyIds) }),
    ...(run.noAccessIds && { noAccessIds: refs(run.noAccessIds) }),
    ...(run.trashCreditHosts && { trashCreditHosts: refs(run.trashCreditHosts) }),
  };
}

// --- Actions ----------------------------------------------------------------------

/** Maps every card id in an action with `map`; null if one has no mapping. Option ids map the ids inside them. */
function mapAction(action: GameAction, map: (id: string) => string | undefined, pattern: RegExp = INST): GameAction | null {
  let ok = true;
  const one = (id: string): string => {
    const m = map(id);
    if (m === undefined) ok = false;
    return m ?? id;
  };
  const many = (list: string[]) => list.map(one);
  const text = (s: string) => s.replace(pattern, m => one(m));
  let res: GameAction;
  switch (action.type) {
    case 'INSTALL_CARD':
      res = {
        ...action,
        cardInstanceId: one(action.cardInstanceId),
        ...(action.hostInstanceId !== undefined && { hostInstanceId: one(action.hostInstanceId) }),
        ...(action.trashFirst && { trashFirst: many(action.trashFirst) }),
      };
      break;
    case 'PLAY_OPERATION_OR_EVENT':
    case 'ADVANCE_CARD':
    case 'SCORE_AGENDA':
    case 'REZ_CARD':
    case 'USE_ABILITY':
    case 'TRASH_RESOURCE':
      res = { ...action, cardInstanceId: one(action.cardInstanceId) };
      break;
    case 'BREAK_SUBROUTINE':
    case 'BOOST_BREAKER':
      res = { ...action, breakerInstanceId: one(action.breakerInstanceId) };
      break;
    case 'RESOLVE_PROMPT': {
      const ch = action.choice;
      let choice: PromptChoice;
      switch (ch.kind) {
        case 'discard':
          choice = { ...ch, cardInstanceIds: many(ch.cardInstanceIds) };
          break;
        case 'access_trash':
          choice = { ...ch, ...(ch.alternativeId !== undefined && { alternativeId: one(ch.alternativeId) }) };
          break;
        case 'access_order':
          choice = { ...ch, optionId: text(ch.optionId) };
          break;
        case 'effect_choice':
          choice = { ...ch, optionId: text(ch.optionId), ...(ch.trashFirst && { trashFirst: many(ch.trashFirst) }) };
          break;
        case 'effect_cards':
          choice = { ...ch, cardInstanceIds: many(ch.cardInstanceIds), ...(ch.trashFirst && { trashFirst: many(ch.trashFirst) }) };
          break;
        default:
          choice = { ...ch };
      }
      res = { ...action, choice };
      break;
    }
    default:
      res = { ...action };
  }
  return ok ? res : null;
}

/**
 * A client's action, in its viewer ids, as the engine's action. An id that is
 * not in the viewer's map (a card they cannot see, or a stale id) makes the
 * action illegal.
 */
export function toEngineAction(action: GameAction, ids: ViewIds): GameAction {
  const res = mapAction(action, id => ids.real[id], VIEW_ID);
  if (!res) throw new IllegalActionError('That card is not in your view');
  return res;
}

/** An engine action in a viewer's ids (their legal actions, their declared intent); null if it names a card they cannot see. */
export function fromEngineAction(action: GameAction, ids: ViewIds): GameAction | null {
  return mapAction(action, id => ids.view[id]);
}

