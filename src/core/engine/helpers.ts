import { CardInstance, SideCode } from '../types/card';
import { GameState, KnownHandCard, KnownLosses, ServerState, SetAsideOrigin } from '../types/state';
import { cardDef, getCardDefinition } from '../cards';
import { IllegalActionError } from './errors';
import { addLog } from './log';
import { getCardScript } from '../scripts';

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
  if (state.turnStep) illegal('Not during the action phase');
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

/**
 * Sets aside a card a search found (rules 8.7.2, 4.8.4), noting where it was. The effect then acts on it from the
 * set-aside zone, and the card counts as moving from `from` (4.8.3): call `fromSetAside` to take it back out.
 */
export function setAside(state: GameState, card: CardInstance, from: SetAsideOrigin): void {
  (state.setAside ??= []).push(card);
  (state.setAsideFrom ??= {})[card.instanceId] = from;
}

/** The set-aside zone, to install from (installs read it as neither HQ nor the stack: rules 4.8.3). */
export function setAsideZone(state: GameState): CardInstance[] {
  return (state.setAside ??= []);
}

/** Drops the set-aside zone and its origins once they are empty (and origins of cards no longer set aside). */
export function tidySetAside(state: GameState): void {
  if (state.setAsideFrom) {
    const held = new Set((state.setAside ?? []).map(c => c.instanceId));
    for (const id of Object.keys(state.setAsideFrom)) if (!held.has(id)) delete state.setAsideFrom[id];
    if (Object.keys(state.setAsideFrom).length === 0) delete state.setAsideFrom;
  }
  if (state.setAside && state.setAside.length === 0) delete state.setAside;
}

/** Takes a card out of the set-aside zone (to put it in a hand, say). */
export function fromSetAside(state: GameState, card: CardInstance): boolean {
  const removed = !!state.setAside && removeCard(state.setAside, card);
  tidySetAside(state);
  return removed;
}

/**
 * The candidates a card prompt may still be answered with: a card another effect has set aside is out of reach (rules
 * 4.8.3: "An ability cannot see the set-aside zone unless it specifically sets objects aside or refers to set-aside
 * objects"). A prompt refers to a set-aside card when its data names it (its own flow's next step).
 */
export function offeredCandidates(state: GameState, candidateIds: string[], data: unknown): string[] {
  if (!state.setAside?.length) return candidateIds;
  const text = JSON.stringify(data ?? {});
  const away = new Set(state.setAside.map(c => c.instanceId).filter(id => !new RegExp(`\\b${id}\\b`).test(text)));
  return away.size ? candidateIds.filter(id => !away.has(id)) : candidateIds;
}

/** Set-aside cards that came from `from` (rules 4.8.3). */
export function setAsideFrom(state: GameState, ...from: SetAsideOrigin[]): CardInstance[] {
  return (state.setAside ?? []).filter(c => from.includes(state.setAsideFrom?.[c.instanceId] as SetAsideOrigin));
}

/** Finds any card in any zone of either player, for effects and UI. */
export function findCardAnywhere(state: GameState, instanceId: string): CardInstance | undefined {
  const corp = locateCorpCard(state, instanceId);
  if (corp) return corp.card;
  const r = state.runner;
  const zones = [r.grip, r.stack, r.heap, r.rig.programs, r.rig.hardware, r.rig.resources, r.scoreArea, state.corp.scoreArea, state.removedFromGame, state.setAside ?? [], [r.identity, state.corp.identity]];
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
    const card = deck.shift()!;
    (side === 'corp' ? state.corp.hq : state.runner.grip).push(card);
    ((state.corp.rdNotes ??= {}).drawn ??= []).push({ owner: side, id: card.instanceId, code: card.cardCode });
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
  beforeCorpCardUninstalled(state, card);
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

/** Runner cards just trashed from the grip or the stack: "when this is trashed from your grip or stack" (Strike Fund). */
export function noteTrashedFromHand(state: GameState, cards: CardInstance[]): void {
  for (const card of cards) {
    if (state.winner) return;
    if (!state.runner.heap.includes(card)) continue;
    getCardScript(card.cardCode)?.onTrashedFromHand?.({ state, card, side: 'runner' });
  }
}

/** "When this card would be uninstalled" interrupts on a rezzed Corp card (Luana Campos), before it leaves play. */
export function beforeCorpCardUninstalled(state: GameState, card: CardInstance): void {
  if (card.isRezzed) getCardScript(card.cardCode)?.onUninstall?.({ state, card, side: 'corp' });
  iceLeavingPosition(state, card);
}

/**
 * The Runner's position is an element of the server's positions, not an index (rules 6.2.6): when a piece of ice
 * inward of it leaves, the index of the Runner's position drops by one (6.2.6b); when the ice in the Runner's own
 * position leaves, that position stays, empty, until the Runner moves on (6.2.4, 8.5.10). Call before removing it.
 */
function iceLeavingPosition(state: GameState, card: CardInstance): void {
  const run = state.activeRun;
  if (!run || run.icePosition === null) return;
  const index = state.corp.servers[run.server]?.ice.indexOf(card) ?? -1;
  if (index < 0) return;
  // While the position is empty, server.ice[icePosition] is the ice just outward of it
  if (index < run.icePosition) run.icePosition -= 1;
  else if (index === run.icePosition && !run.positionEmpty) run.positionEmpty = true;
}

/** Ice was just put at `index` of `server.ice` (Brân 1.0, Tatu-Bola): positions inward of the Runner shift theirs (rules 6.2.6b). */
export function iceInsertedAt(state: GameState, server: ServerState, index: number): void {
  const run = state.activeRun;
  if (!run || run.server !== server.id || run.icePosition === null) return;
  // A swap from HQ fills the Runner's emptied position itself (rules 6.2.2f: no new position)
  if (run.positionEmpty && index === run.icePosition) run.positionEmpty = false;
  else if (index <= run.icePosition) run.icePosition += 1;
}

/** The ice in the Runner's current position, if there is one (none while that position is empty, rules 6.2.4). */
export function iceAtPosition(state: GameState): CardInstance | undefined {
  const run = state.activeRun;
  if (!run || run.icePosition === null || run.positionEmpty) return undefined;
  return state.corp.servers[run.server]?.ice[run.icePosition];
}

/** True if the card can receive advancement counters via the advance action. */
/**
 * Whether the Runner knows which card the Corp is installing from `zone`:
 * they accessed it in this breach (rules 7.3.1a), it comes from faceup
 * Archives or a score area, or it is moving within the play area as the same
 * object (rules 1.12.4) that they already knew.
 */
export function runnerSawBeforeInstall(state: GameState, card: CardInstance, zone: CardInstance[]): boolean {
  const run = state.activeRun;
  if (run?.breached && run.accessed.some(a => a.id === card.instanceId)) return true;
  if (zone === state.corp.archives.faceUp || zone === state.corp.scoreArea || zone === state.runner.scoreArea) return true;
  const inPlay = Object.values(state.corp.servers).some(s => s.root === zone || s.ice === zone);
  return inPlay && !!card.runnerKnows;
}

/**
 * Cards that went back to HQ or R&D, or facedown into Archives, are new
 * objects the Runner no longer tracks (rules 1.12.3). Runs after every action.
 */
export function forgetHiddenCards(state: GameState): void {
  for (const zone of [state.corp.hq, state.corp.rd, state.corp.archives.faceDown]) {
    for (const card of zone) delete card.runnerKnows;
  }
}

// --- Cards known in a hand ---------------------------------------------------------

const knownList = (state: GameState, owner: SideCode): KnownHandCard[] =>
  // Saves from before entries had codes held bare ids: drop those
  ((owner === 'corp' ? state.corp.knownToRunner : state.runner.knownToCorp) ?? []).filter(e => typeof e === 'object');

function setKnownList(state: GameState, owner: SideCode, list: KnownHandCard[]): void {
  if (owner === 'corp') state.corp.knownToRunner = list;
  else state.runner.knownToCorp = list;
}

/**
 * The other side has seen these cards in `owner`'s hand (revealed, rules
 * 1.21.3, or accessed in HQ). Revealing does not turn a card faceup (1.21.3a),
 * so the cards stay hidden and the other side only remembers them.
 */
export function revealInHand(state: GameState, owner: SideCode, cards: CardInstance[]): void {
  if (cards.length > 0) ((state.corp.rdNotes ??= {}).handSeen ??= []).push({ owner, ids: cards.map(c => c.instanceId) });
  addSeen(state, owner, cards);
}

/** revealInHand's list change, with no record of a sighting (the hand walk's own arrivals, noteOpenArrivals). */
function addSeen(state: GameState, owner: SideCode, cards: CardInstance[]): void {
  let known = knownList(state, owner);
  // Seen again: certain again (no card has left unseen since). The entry keeps its place in the list.
  if (known.some(e => e.lost && cards.some(c => c.instanceId === e.id))) known = known.map(e => (e.lost && cards.some(c => c.instanceId === e.id) ? { id: e.id, code: e.code } : e));
  const add = cards.filter(c => !known.some(e => e.id === c.instanceId)).map(c => ({ id: c.instanceId, code: c.cardCode }));
  setKnownList(state, owner, add.length > 0 ? [...known, ...add] : known);
}

/**
 * What the R&D walk (updateRdKnowledge) hands the hand walk for one action. `joined`: the Runner's R&D marks certainly
 * drawn into HQ, each with the unseen HQ departures since it may have arrived (RdKnownCard.lost, rules 1.12.3); a draw
 * is not a sighting (1.8.5). Passed by argument, not kept on the state; a call without it joins nothing (the safe
 * default: the Runner forgets the drawn card).
 */
export interface RdWalk {
  joined: KnownHandCard[];
  /** This action's sightings in a hand (RdNotes.handSeen), taken from the notes before the R&D walk drops them. */
  seen: { owner: SideCode; ids: string[] }[];
  /**
   * R&D cards the Runner followed out of an exact place this action (the R&D walk's step 2), by instance id. Only these
   * can join facedown Archives as known (B4c part 2); a card that left from among cards the Corp acted on in secret
   * (step 3, RdNotes.privateTop: Cultivate, AU Co.) may be any of them (8.3.3b, 1.12.3).
   */
  followed: string[];
  /** Cards drawn into a hand this action (RdNotes.drawn): one that left again went unseen (B4c part 3). */
  drawn: { owner: SideCode; id: string; code: string }[];
}
export const NO_RD_WALK: RdWalk = { joined: [], seen: [], followed: [], drawn: [] };

/** The other side saw these known cards leave the hand for a hidden place (Touch-ups' shuffle). */
export function forgetInHand(state: GameState, owner: SideCode, cards: CardInstance[]): void {
  const known = knownList(state, owner);
  if (known.length > 0) setKnownList(state, owner, known.filter(e => !cards.some(c => c.instanceId === e.id)));
}

/** An installed card anyone can see: rezzed, faceup, or one the Runner knows (rules 1.12.1, 10.2.3a). */
export const openInstalled = (c: CardInstance): boolean => !!(c.isRezzed || c.faceUp || c.runnerKnows);

/**
 * The open zones other than the servers, in publicCards' order: faceup Archives, both score areas, the heap, the rig
 * and the cards removed from the game. Every card in them is open, and so is each card's hosted cards; a server's root
 * and ice are open card by card (openInstalled), with their hosted cards. publicCards and the upkeep skip (sameOpen,
 * noneSurfaced) both read the open zones from here, so a zone added later is in both or in neither (R-105 red team 4).
 */
function openLists(state: GameState): CardInstance[][] {
  const r = state.runner;
  return [state.corp.archives.faceUp, state.corp.scoreArea, r.scoreArea, r.heap, r.rig.programs, r.rig.hardware, r.rig.resources, state.removedFromGame];
}

/** Cards anyone can see (rezzed or faceup installed cards, discard piles, score areas, the rig), by id to code. */
export function publicCards(state: GameState): Map<string, string> {
  const cards = new Map<string, string>();
  const add = (c: CardInstance) => {
    cards.set(c.instanceId, c.cardCode);
    for (const h of c.hostedCards ?? []) cards.set(h.instanceId, h.cardCode);
  };
  for (const server of Object.values(state.corp.servers)) {
    for (const c of server.root) if (openInstalled(c)) add(c);
    for (const c of server.ice) if (openInstalled(c)) add(c);
  }
  for (const list of openLists(state)) for (const c of list) add(c);
  return cards;
}

type LossKind = keyof KnownLosses;

/**
 * What the other side can tell about a card that left a hidden zone unseen, from where it went: installed protecting a
 * server it is ice (rules 4.6.6d), in a remote root an agenda, asset or upgrade, in a central root an upgrade (4.6.6e).
 * Where a card is installed is open information (4.6.6a, f, 10.2.3a). Anywhere else it could be any card.
 */
function lossKind(state: GameState, id: string): LossKind {
  for (const server of Object.values(state.corp.servers)) {
    if (server.ice.some(c => c.instanceId === id)) return 'ice';
    if (server.root.some(c => c.instanceId === id)) return server.isRemote ? 'root' : 'upgrade';
  }
  return 'any';
}

/** `lost` with these unseen departures added. */
function withLosses(was: KnownLosses | undefined, kinds: LossKind[]): KnownLosses {
  const lost: KnownLosses = { ...was };
  for (const k of kinds) lost[k] = (lost[k] ?? 0) + 1;
  return lost;
}

/** Every entry of `list` saw these unseen departures after it was seen. */
function addLosses(list: KnownHandCard[], kinds: LossKind[]): KnownHandCard[] {
  if (kinds.length === 0) return list;
  return list.map(e => ({ ...e, lost: withLosses(e.lost, kinds) }));
}

/** The departures since `e` was seen that could have been a card of type `type`. */
function lossesFor(e: KnownHandCard, type: string): number {
  const l = e.lost;
  if (!l) return 0;
  const root = type === 'agenda' || type === 'asset' || type === 'upgrade';
  return (l.any ?? 0) + (type === 'ice' ? (l.ice ?? 0) : 0) + (root ? (l.root ?? 0) : 0) + (type === 'upgrade' ? (l.upgrade ?? 0) : 0);
}

/**
 * The index of the surest entry of `code` (the fewest departures since it was seen that could have been it), ties to
 * the entry with id `prefer`, then the oldest; -1 if none. Which copy of a title an entry is, the viewer cannot tell
 * (rules 10.2.2b), so a sighting refreshes and a card that surfaces forgets the surest one: of all the entries of that
 * code, forgetting it lowers certainCounts the most (every count term past it drops by one), so what is left is the
 * weakest claim (B4c red team, "what holds").
 */
function surestIndex(list: KnownHandCard[], code: string, prefer?: string, skip?: (e: KnownHandCard) => boolean): number {
  const type = getCardDefinition(code)?.type_code ?? '';
  let best = -1;
  let bestL = Infinity;
  list.forEach((e, i) => {
    if (e.code !== code || skip?.(e)) return;
    const l = lossesFor(e, type);
    const tie = l === bestL ? lossOrder(e.lost, list[best].lost) : 1;
    if (l < bestL || tie < 0 || (tie === 0 && e.id === prefer && list[best]?.id !== prefer)) {
      best = i;
      bestL = l;
    }
  });
  return best;
}

/**
 * Orders two entries' losses kind by kind (any, ice, root, upgrade), fewer first; 0 when they are the same. surestIndex
 * breaks a tie in the departures that count for the code with this before it looks at `prefer` (rd-fuzz-fixes class 4):
 * the id preferred is the seen card's, a label (10.2.2b), so two entries alike for the code but apart in the other kinds
 * (an operation's ice losses) must not be told apart by which copy the list names.
 */
function lossOrder(a: KnownLosses | undefined, b: KnownLosses | undefined): number {
  for (const k of LOSS_KINDS) {
    const d = (a?.[k] ?? 0) - (b?.[k] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The list without its surest entry of `code` (surestIndex), when it has one. */
function forgetSurest(list: KnownHandCard[], code: string, prefer?: string): KnownHandCard[] {
  const i = surestIndex(list, code, prefer);
  return i < 0 ? list : list.filter((_, j) => j !== i);
}

const LOSS_KINDS: (keyof KnownLosses)[] = ['any', 'ice', 'root', 'upgrade'];
const sameLost = (a: KnownLosses | undefined, b: KnownLosses | undefined): boolean => LOSS_KINDS.every(k => (a?.[k] ?? 0) === (b?.[k] ?? 0));

/**
 * By code, how many of a list's cards are certainly still in their zone: the entries less the most of them the unseen
 * departures could have been. A departure can be at most one card, of a kind its place allows, seen before it left
 * (rules 1.12.3: a card gone to a hidden place is not followed). Taking the newest `j` entries of a code, the departures
 * after the oldest of them can account for at most that many, so `j - departures` of them are certainly there; the
 * count is the best such `j` (Hall's theorem: the departures after each entry are nested). Never below 0; a lower
 * bound, never false certainty.
 */
export function certainCounts(list: KnownHandCard[]): [string, number][] {
  const byCode = new Map<string, number[]>();
  for (const e of list) {
    const type = getCardDefinition(e.code)?.type_code ?? '';
    const ls = byCode.get(e.code) ?? [];
    ls.push(lossesFor(e, type));
    byCode.set(e.code, ls);
  }
  const out: [string, number][] = [];
  for (const [code, ls] of byCode) {
    ls.sort((a, b) => a - b);
    let best = 0;
    ls.forEach((l, j) => (best = Math.max(best, j + 1 - l)));
    if (best > 0) out.push([code, best]);
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** By code and count, the cards of `owner`'s hand the other side knows are still there. */
export function certainInHand(state: GameState, owner: SideCode): [string, number][] {
  return certainCounts(knownList(state, owner));
}

/**
 * The instances of `owner`'s hand a reader may treat as known: for each code the other side surely knows is there
 * (certainInHand), that many of the hand's cards with the code, first in hand order. Chosen by code and count, not by
 * the list's ids (brief b4-hidden-zones ruling 5): which copy is the seen one is not the reader's to know.
 */
export function certainHandCards(state: GameState, owner: SideCode): CardInstance[] {
  const hand = owner === 'corp' ? state.corp.hq : state.runner.grip;
  return certainInHand(state, owner).flatMap(([code, n]) => hand.filter(c => c.cardCode === code).slice(0, n));
}

/** The facedown Archives cards the Runner saw go in, oldest first (rules 4.4.6b, c: facedown cards stay hidden). */
export function archivesKnownToRunner(state: GameState): KnownHandCard[] {
  return state.corp.archKnownToRunner ?? [];
}

/** By code and count, the facedown Archives cards the Runner knows are still there. */
export function certainInArchives(state: GameState): [string, number][] {
  return certainCounts(archivesKnownToRunner(state));
}

// --- The upkeep's skip (tracker R-105) -----------------------------------------------------------------------------

/**
 * updateHandKnowledge runs after every action, the AI's simulated ones included, so it is skipped where its inputs show
 * it would write nothing. Each walk has its own test, and every test reads only `prev` and `state` (like unchangedRd in
 * rdKnowledge.ts), so its proof is local to the pair. Anything not exactly matched falls through to the walk as it is;
 * a miss costs a little time and never changes play. Why each walk would return its input:
 *  - Archives (archivesIdle): the same facedown cards in the same order, so no card went in or left unseen (rules
 *    4.4.6b, 1.12.3), and the list is no longer than the pile, so the closing cut keeps it whole.
 *  - Open arrivals, per hand (noteOpenArrivals): the same cards in the hand, so no card came to it from the open
 *    (10.2.2b, 10.2.3a).
 *  - The main walk (handWalkIdle): both hands the same, so no card left either one (no departure for 1.12.3, and
 *    addLosses with no kinds returns its list); no card newly open (sameOpen, else noneSurfaced), so none surfaced
 *    and nothing is forgotten by name; no card left HQ, so none was followed into R&D (10.2.2a, b); every entry a full
 *    entry (no bare id for knownList to drop) and each list no longer than its hand, so the closing cut keeps it whole.
 *    Since B4c the walk places sightings and joined marks by copy from the lists in `prev` (placeSightings), so the main
 *    walk is skipped only when no mark joined, nothing was seen in a hand and both lists are as they were in `prev`.
 */
type UpkeepSkip = 'archives' | 'arrivals' | 'main';
type UpkeepField = 'knownToRunner' | 'knownToCorp' | 'archKnownToRunner' | 'rdKnownToRunner';

/**
 * The skip's test-only check (R-105 rev 1 rulings 1 and 2; off in play, on in the tests, the fuzzer and the lockstep's
 * CHECK leg): with it on, updateHandKnowledge runs with its skips, puts the fields it writes back (the three lists and, since R-109, the R&D marks), runs again with no skip
 * and compares. `checked` counts the skips taken that were compared, by walk; each field that differs is recorded in
 * `failures` (which skips were taken, the field, both values) before the throw, so a catch in the look-ahead that
 * swallows the throw cannot hide it. Not a play switch: it changes no decision, on or off.
 */
/**
 * B4c part 4 (red team finding 4): each deal of the Runner's guess that found no code for a slot (runnerReply.ts
 * dealRunnerUnknowns), recorded before it is rethrown (tests, fuzzer) or dealt again without the Runner's knowledge
 * (play), so a catch in a play-out can't hide it. tests/setup.ts and the fuzzer's AI-mode games assert it stays empty.
 * Kept here, not in runnerReply.ts, so tests/setup.ts can read it without loading the AI (module order, R-109).
 */
export const dealTripwire = { failures: [] as string[] };

export const handUpkeepCheck = {
  on: false,
  checked: { archives: 0, arrivals: 0, main: 0 } as Record<UpkeepSkip, number>,
  failures: [] as { skips: string; field: UpkeepField; skipped: string; walked: string }[],
};

function sameIds(a: CardInstance[], b: CardInstance[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].instanceId !== b[i].instanceId) return false;
  return true;
}

/** The same cards in the same order, each with the same hosted cards and (for installed cards) the same openness. */
function sameCards(a: CardInstance[], b: CardInstance[], installed: boolean): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = b[i];
    if (p.instanceId !== q.instanceId || (installed && openInstalled(p) !== openInstalled(q))) return false;
    const x = p.hostedCards ?? [];
    const y = q.hostedCards ?? [];
    if (!sameIds(x, y)) return false;
  }
  return true;
}

/** publicCards(prev) and publicCards(state) hold the same cards, shown without building either: the same open zones. */
function sameOpen(prev: GameState, state: GameState): boolean {
  const ps = prev.corp.servers;
  const ss = state.corp.servers;
  let n = 0;
  for (const k in ss) {
    const p = ps[k];
    if (!p || !sameCards(p.root, ss[k].root, true) || !sameCards(p.ice, ss[k].ice, true)) return false;
    n++;
  }
  for (const k in ps) if (ps[k]) n--;
  if (n !== 0) return false;
  const pl = openLists(prev);
  const sl = openLists(state);
  for (let i = 0; i < sl.length; i++) if (!sameCards(pl[i], sl[i], false)) return false;
  return true;
}

/** No card open in `state` that was not open in `prev` (the looser test, taken when sameOpen fails): nothing surfaced. */
function noneSurfaced(prev: GameState, state: GameState): boolean {
  const before = publicCards(prev);
  const known = (c: CardInstance): boolean => {
    if (!before.has(c.instanceId)) return false;
    for (const h of c.hostedCards ?? []) if (!before.has(h.instanceId)) return false;
    return true;
  };
  for (const server of Object.values(state.corp.servers)) {
    for (const c of server.root) if (openInstalled(c) && !known(c)) return false;
    for (const c of server.ice) if (openInstalled(c) && !known(c)) return false;
  }
  for (const list of openLists(state)) for (const c of list) if (!known(c)) return false;
  return true;
}

function archivesIdle(prev: GameState, state: GameState): boolean {
  const now = state.corp.archives.faceDown;
  return sameIds(prev.corp.archives.faceDown, now) && (state.corp.archKnownToRunner?.length ?? 0) <= now.length;
}

/** Every entry a full entry, and the list no longer than the hand. */
function listFits(list: KnownHandCard[] | undefined, hand: CardInstance[]): boolean {
  if (!list) return true;
  if (list.length > hand.length) return false;
  for (let i = 0; i < list.length; i++) if (typeof list[i] !== 'object') return false;
  return true;
}

/** The list as it was before the action: nothing seen (revealInHand) during it, so the walk has no sighting to place. */
function listUnchanged(was: KnownHandCard[] | undefined, now: KnownHandCard[] | undefined): boolean {
  if ((was?.length ?? 0) !== (now?.length ?? 0)) return false;
  for (let i = 0; i < (now?.length ?? 0); i++) if (was![i].id !== now![i].id || !sameLost(was![i].lost, now![i].lost)) return false;
  return true;
}

function handWalkIdle(prev: GameState, state: GameState, walk: RdWalk): boolean {
  const hq = state.corp.hq;
  const grip = state.runner.grip;
  if (walk.joined.length > 0 || walk.seen.length > 0 || passedThrough(prev, state, walk).length > 0) return false;
  if (!sameIds(prev.corp.hq, hq) || !sameIds(prev.runner.grip, grip)) return false;
  const corp = state.corp.knownToRunner;
  if (!listFits(corp, hq) || !listFits(state.runner.knownToCorp, grip)) return false;
  if (!listUnchanged(prev.corp.knownToRunner, corp) || !listUnchanged(prev.runner.knownToCorp, state.runner.knownToCorp)) return false;
  return sameOpen(prev, state) || noneSurfaced(prev, state);
}

// The fields the upkeep writes: the three lists, and the R&D marks whose card may be in HQ (R-109: their HQ losses)
const UPKEEP_FIELDS: UpkeepField[] = ['knownToRunner', 'knownToCorp', 'archKnownToRunner', 'rdKnownToRunner'];
const holder = (state: GameState, f: UpkeepField): Record<string, unknown> => (f === 'knownToCorp' ? state.runner : state.corp) as unknown as Record<string, unknown>;
const shown = (state: GameState, f: UpkeepField): string => (f in holder(state, f) ? String(JSON.stringify(holder(state, f)[f])) : 'absent');

/** handUpkeepCheck: the upkeep with its skips, then again from the same fields with none; the two must agree. */
function checkedUpkeep(prev: GameState, state: GameState, walk: RdWalk): void {
  const saved = UPKEEP_FIELDS.map(f => {
    const h = holder(state, f);
    return { has: f in h, value: Array.isArray(h[f]) ? (h[f] as unknown[]).slice() : h[f] };
  });
  const took: UpkeepSkip[] = [];
  keepHandKnowledge(prev, state, walk, true, took);
  if (took.length === 0) return;
  const skipped = UPKEEP_FIELDS.map(f => shown(state, f));
  UPKEEP_FIELDS.forEach((f, i) => {
    const h = holder(state, f);
    if (saved[i].has) h[f] = saved[i].value;
    else delete h[f];
  });
  keepHandKnowledge(prev, state, walk, false);
  for (const t of took) handUpkeepCheck.checked[t]++;
  const bad = UPKEEP_FIELDS.flatMap((f, i) => (shown(state, f) === skipped[i] ? [] : [{ skips: took.join('+'), field: f, skipped: skipped[i], walked: shown(state, f) }]));
  if (bad.length === 0) return;
  handUpkeepCheck.failures.push(...bad);
  throw new Error(`R-105 upkeep skip changed ${bad.map(b => b.field).join(', ')} (skips ${bad[0].skips})`);
}

/**
 * Facedown Archives: a card the Runner knew (in the open, or seen exactly in R&D) that goes facedown into Archives is
 * one it knows is there (rules 4.4.6b, 10.2.2b); a card that leaves unseen is a departure it cannot tell (1.12.3); one
 * that turns up in the open is no longer hidden.
 */
function updateArchivesKnowledge(prev: GameState, state: GameState, walk: RdWalk): void {
  const was = prev.corp.archives.faceDown;
  const now = state.corp.archives.faceDown;
  let known = archivesKnownToRunner(state);
  const wasIds = new Set(was.map(c => c.instanceId));
  const arrivals = now.filter(c => !wasIds.has(c.instanceId));
  if (known.length === 0 && arrivals.length === 0) return;
  if (known.length > 0) {
    const nowIds = new Set(now.map(c => c.instanceId));
    const departed = was.filter(c => !nowIds.has(c.instanceId));
    if (departed.length > 0) {
      const open = publicCards(state);
      // A facedown card that turns up in the open may be any known one of its title (10.2.2b): the surest goes (B4c part 1)
      for (const c of departed) if (open.has(c.instanceId)) known = forgetSurest(known, c.cardCode, c.instanceId);
      known = addLosses(
        known,
        departed.filter(c => !open.has(c.instanceId)).map(c => lossKind(state, c.instanceId))
      );
    }
  }
  if (arrivals.length > 0) {
    const openBefore = publicCards(prev);
    // An R&D card counts only if the R&D walk followed it out of an exact place this action (B4c part 2), not every card
    // exactly placed before it: one picked from among cards the Corp looked at in secret is not followed (8.3.3b)
    // A card that passed through HQ in the action left it hidden among its cards: not followed (B4c part 3, C2)
    const viaHq = new Set(walk.drawn.filter(d => d.owner === 'corp').map(d => d.id));
    const followed = new Set(walk.followed.filter(id => !viaHq.has(id)));
    for (const c of arrivals) if ((openBefore.has(c.instanceId) || followed.has(c.instanceId)) && !known.some(e => e.id === c.instanceId)) known = [...known, { id: c.instanceId, code: c.cardCode }];
  }
  known = known.slice(Math.max(0, known.length - now.length));
  if (known.length > 0 || state.corp.archKnownToRunner) state.corp.archKnownToRunner = known;
}

/**
 * A card that was in the open and goes back to a hand (a rezzed or known ice returned to HQ: Descent, Hermes, Tatu-Bola;
 * a heap card taken back to the grip) is one the other side saw go there (10.2.2b, 10.2.3a): it joins the list. Step 0
 * gap 3. A card drawn from R&D or the stack is left to updateRdKnowledge (the Runner's R&D marks).
 */
function noteOpenArrivals(prev: GameState, state: GameState, skips: boolean, took?: UpkeepSkip[]): void {
  let open: Map<string, string> | undefined;
  for (const owner of ['corp', 'runner'] as const) {
    const was = owner === 'corp' ? prev.corp.hq : prev.runner.grip;
    const now = owner === 'corp' ? state.corp.hq : state.runner.grip;
    if (now.length === 0) continue;
    // The skip (R-105): the same cards in the hand, so nothing arrived
    if (skips && sameIds(was, now)) {
      took?.push('arrivals');
      continue;
    }
    const wasIds = new Set(was.map(c => c.instanceId));
    const deck = owner === 'corp' ? prev.corp.rd : prev.runner.stack;
    const arrivals = now.filter(c => !wasIds.has(c.instanceId) && !deck.some(d => d.instanceId === c.instanceId));
    if (arrivals.length === 0) continue;
    open ??= publicCards(prev);
    const seen = arrivals.filter(c => open!.has(c.instanceId));
    // addSeen, not revealInHand: this runs after the R&D walk has taken this action's notes (an arrival needs none)
    if (seen.length > 0) addSeen(state, owner, seen);
  }
}

/**
 * Keeps each side's memory of the other's hand honest after an action. A
 * known card that leaves the hand unseen stays on the list, since the viewer
 * cannot tell it from the other cards that might have left (rules 1.12.3);
 * every entry counts the departure (KnownHandCard.lost), by the kinds of card
 * its place allows, so certainInHand() can say which seen cards are surely
 * still there. When a card with the same name turns up in the open from
 * somewhere the viewer could not follow (not straight from R&D or the stack),
 * it may be the one they knew, so one entry of that name is forgotten. The
 * list never holds more cards than the hand does. Facedown Archives is kept
 * by the same rule (updateArchivesKnowledge).
 */
export function updateHandKnowledge(prev: GameState, state: GameState, walk: RdWalk = NO_RD_WALK): void {
  // B4b's root kinds are kept on every action, outside R-105's skips (they read the servers, not the hands)
  updateRootKinds(prev, state);
  if (handUpkeepCheck.on) checkedUpkeep(prev, state, walk);
  else keepHandKnowledge(prev, state, walk, true);
}

/**
 * The list after an action, with each card seen during it placed by copy, not by instance id (B4c part 1, brief rev 1
 * findings 1, 2, 10): the viewer cannot tell two copies of a title apart (rules 10.2.2b). revealInHand added or refreshed
 * entries by id while the action resolved; this rebuilds them from the list as it was in `prev`:
 *  - a card seen that was in the hand before the action is an in-place sighting: it refreshes the surest entry of its
 *    title (surestIndex), which takes the seen card's id, loses its losses and moves to the end (newest). The k cards of
 *    one sighting refresh up to k distinct entries and only the rest are added (one reveal, 1.21.3, or one breach). A
 *    breach is many actions: an entry whose id is in the run's accesses before this action was matched this breach
 *    already (7.4.3, 7.3.4a; a card that left and came back is a new object with a loss, 7.4.5, 7.4.6b);
 *  - a card seen that was not in the hand is an arrival (Malapert, Tocsin, Pivot, an open card returned): a new card the
 *    viewer saw go in (1.12.3), always its own entry;
 *  - an R&D mark drawn into HQ (`joined`) may be the card behind an X entry, so it merges with the surest X entry, keeping
 *    the fewer losses (red team 4b; brief rev 1 item 4b). A mark that may already have been in HQ before the action
 *    (left 'hq') may be any X entry seen since. One drawn this action was in R&D until now: it can only be an X entry
 *    that may have gone from HQ to R&D since its sighting (an unseen departure to anywhere, an 'any' loss: shuffled in
 *    or put back, 1.12.3); any other X entry is still in HQ or on a server, another card, and the mark joins beside it.
 */
function placeSightings(prev: GameState, state: GameState, owner: SideCode, walk: RdWalk): KnownHandCard[] {
  const was = knownList(prev, owner);
  const now = knownList(state, owner);
  const wasById = new Map(was.map(e => [e.id, e]));
  const codeOf = new Map(now.map(e => [e.id, e.code]));
  const prevHand = new Set((owner === 'corp' ? prev.corp.hq : prev.runner.grip).map(c => c.instanceId));
  // The action's sightings, one group per reveal or access (RdNotes.handSeen); an entry added or refreshed with no
  // record (a caller that set the list itself) is a group of its own
  const groups = walk.seen.filter(g => g.owner === owner).map(g => [...new Set(g.ids)].filter(id => codeOf.has(id)));
  const inGroup = new Set(groups.flat());
  let base: KnownHandCard[] = [];
  for (const e of now) {
    const old = wasById.get(e.id);
    if (old && sameLost(old.lost, e.lost) && !inGroup.has(e.id)) base.push(e);
    else {
      if (old) base.push(old);
      if (!inGroup.has(e.id)) groups.push([e.id]);
    }
  }
  if (owner === 'corp') {
    const pendingBefore = new Set((prev.corp.rdKnownToRunner ?? []).filter(m => m.left === 'hq').map(m => m.id));
    for (const j of walk.joined) {
      const type = getCardDefinition(j.code)?.type_code ?? '';
      // A mark drawn this action was in R&D until now, so it is only an X entry that may have gone from HQ to R&D since
      // it was seen: one with a departure to a place the Runner could not see (an 'any' loss; one installed as ice or in
      // a root went to a server, 4.6.6a, not to R&D). An X with none is still in HQ, another card (rework ruling 24)
      const notIt = pendingBefore.has(j.id) ? undefined : (e: KnownHandCard) => e.id !== j.id && !(e.lost?.any ?? 0);
      const i = surestIndex(base, j.code, j.id, notIt);
      if (i < 0) {
        base.push(j);
        continue;
      }
      const merged = lossesFor(j, type) < lossesFor(base[i], type) ? j : { ...base[i], id: j.id };
      // No two entries share an id: one still under the drawn card's id takes the merged entry's old one
      const at = base.findIndex((e, k) => k !== i && e.id === j.id);
      if (at >= 0) base[at] = { ...base[at], id: base[i].id };
      base[i] = merged;
    }
  }
  if (groups.length === 0) return base;
  const accessedBefore = new Set(owner === 'corp' ? (prev.activeRun?.accessed ?? []).map(a => a.id) : []);
  const arrivals: KnownHandCard[] = [];
  for (const g of groups) {
    const matched = new Set<KnownHandCard>();
    const refreshed: KnownHandCard[] = [];
    for (const id of g) {
      const code = codeOf.get(id)!;
      const at = base.findIndex(e => e.id === id);
      if (!prevHand.has(id)) {
        // An arrival is its own entry, once (Méliès U's card from Archives, then accessed in the same breach); a stale
        // entry under its id is that card's earlier sighting, and goes with it
        if (arrivals.some(a => a.id === id)) continue;
        if (at >= 0) base.splice(at, 1);
        arrivals.push({ id, code });
        continue;
      }
      const i = surestIndex(base, code, id, e => matched.has(e) || accessedBefore.has(e.id));
      if (i >= 0) {
        matched.add(base[i]);
        // The labels are not the viewer's to know (10.2.2b): a weaker entry still under the seen card's id takes the
        // refreshed entry's old one, so no two entries share an id
        if (at >= 0 && at !== i && !matched.has(base[at])) base[at] = { ...base[at], id: base[i].id };
      } else if (at >= 0) base.splice(at, 1);
      refreshed.push({ id, code });
    }
    base = [...base.filter(e => !matched.has(e)), ...refreshed];
  }
  return [...base, ...arrivals];
}

/**
 * Cards drawn into a hand during the action that are no longer in it: they left it unseen within the action, as any hand
 * card can (1.12.3; B4c part 3, red team C1, C2). A card drawn before the action (at setup) was in the hand in `prev`.
 */
function passedThrough(prev: GameState, state: GameState, walk: RdWalk): { owner: SideCode; id: string; code: string }[] {
  if (walk.drawn.length === 0) return [];
  const hand = (s: GameState, o: SideCode) => (o === 'corp' ? s.corp.hq : s.runner.grip);
  return walk.drawn.filter(d => !hand(prev, d.owner).some(c => c.instanceId === d.id) && !hand(state, d.owner).some(c => c.instanceId === d.id));
}

/** updateHandKnowledge's three walks; with `skips` the walks that would write nothing are skipped (R-105), listed in `took`. */
function keepHandKnowledge(prev: GameState, state: GameState, walk: RdWalk, skips: boolean, took?: UpkeepSkip[]): void {
  if (skips && archivesIdle(prev, state)) took?.push('archives');
  else updateArchivesKnowledge(prev, state, walk);
  noteOpenArrivals(prev, state, skips, took);
  // An R&D mark that may already be in HQ (left 'hq') counts the HQ departures too (RdKnownCard.lost)
  const marks = state.corp.rdKnownToRunner ?? [];
  const mayBeInHq = marks.some(e => e.left === 'hq');
  // Today's return stays here, after noteOpenArrivals, which can add the first entry to an empty list (red team 7)
  if (knownList(state, 'corp').length === 0 && knownList(state, 'runner').length === 0 && !mayBeInHq && walk.joined.length === 0) return;
  if (skips && handWalkIdle(prev, state, walk)) {
    took?.push('main');
    return;
  }
  const before = publicCards(prev);
  const after = publicCards(state);
  // A found card waits set aside first (rules 4.8.3: it still counts as coming from its deck). A card drawn and played in
  // one action came by the hand, hidden among its cards: it surfaces from the hand (B4c part 3)
  const passed = passedThrough(prev, state, walk);
  const viaHand = new Set(passed.map(d => d.id));
  const fromDeck = new Set([...prev.corp.rd, ...prev.runner.stack, ...setAsideFrom(prev, 'rd', 'stack')].map(c => c.instanceId).filter(id => !viaHand.has(id)));
  const surfaced = [...after].filter(([id]) => !before.has(id) && !fromDeck.has(id));
  // A card seen in the hand this action that was open before and is open again, and not in the hand either side of it
  // (rd-fuzz-fixes class 5: The Basalt Spire adds an agenda from Archives to HQ, the breach steals it): placeSightings
  // lists it as an arrival, and the Runner saw it go into the open again, so it surfaces from the hand like any other
  // (one entry of its title goes, the surest; rules 1.12.3, 10.2.2b). surfaced leaves it out (it was open before).
  const handIds = (s: GameState, o: SideCode) => new Set((o === 'corp' ? s.corp.hq : s.runner.grip).map(c => c.instanceId));
  const throughHand = (o: SideCode): [string, string][] => {
    const was = handIds(prev, o);
    const now = handIds(state, o);
    const ids = new Set(walk.seen.filter(g => g.owner === o).flatMap(g => g.ids));
    return [...ids].filter(id => before.has(id) && after.has(id) && !was.has(id) && !now.has(id)).map(id => [id, after.get(id)!]);
  };
  for (const owner of ['corp', 'runner'] as const) {
    let known = placeSightings(prev, state, owner, walk);
    const listed = known.length > 0;
    const pending = owner === 'corp' && mayBeInHq;
    if (!listed && !pending) continue;
    const hand = owner === 'corp' ? state.corp.hq : state.runner.grip;
    const inHand = new Set(hand.map(c => c.instanceId));
    // A card the Runner followed from HQ into R&D (an effect showed it there: it is marked in R&D) is no departure it
    // cannot tell (step 0 gap 1: Pivot, The Holo Man, Cohort Guidance Program); it may be any seen card of its title, so
    // the surest goes (10.2.2b; B4c red team 4a). A mark that may have left R&D (`left`) is not followed: its card may be
    // the one leaving HQ unseen (rules 1.12.3, 4.6.6d).
    const followed = owner === 'corp' ? new Set(marks.filter(e => !e.left).map(e => e.id)) : undefined;
    const out = (owner === 'corp' ? prev.corp.hq : prev.runner.grip)
      .filter(c => !inHand.has(c.instanceId) && !after.has(c.instanceId))
      .map(c => ({ instanceId: c.instanceId, cardCode: c.cardCode }));
    for (const d of passed) if (d.owner === owner && !after.has(d.id)) out.push({ instanceId: d.id, cardCode: d.code });
    const departed = out.filter(c => !followed?.has(c.instanceId));
    for (const c of out) if (followed?.has(c.instanceId)) known = forgetSurest(known, c.cardCode, c.instanceId);
    const kinds = departed.map(c => lossKind(state, c.instanceId));
    known = addLosses(known, kinds);
    if (pending && kinds.length > 0) state.corp.rdKnownToRunner = marks.map(e => (e.left === 'hq' ? { ...e, lost: withLosses(e.lost, kinds) } : e));
    if (known.length === 0) {
      if (listed || knownList(state, owner).length > 0) setKnownList(state, owner, known);
      continue;
    }
    // A card that turns up in the open may be any seen card of its title: the surest goes (B4c part 1)
    for (const [id, code] of [...surfaced, ...throughHand(owner)]) known = forgetSurest(known, code, id);
    // A hand card set aside by a search (Let Them Dream searching HQ) is still the viewer's to remember
    setKnownList(state, owner, known.slice(Math.max(0, known.length - hand.length - setAsideFrom(state, owner === 'corp' ? 'hq' : 'grip').length)));
  }
}

// --- What the Runner knows of a facedown root card's kind (B4b, brief b4-hidden-zones ruling 9) ---------------------

export type RootKind = 'agenda' | 'asset' | 'upgrade';
const ROOT_KINDS: RootKind[] = ['agenda', 'asset', 'upgrade'];
const hiddenRoot = (c: CardInstance) => !c.isRezzed && !c.faceUp && !c.runnerKnows;
/** An agenda or asset in this root the Runner knows: rezzed, faceup or accessed (rules 10.2.3a, 7.3.1a). */
const knownAgendaOrAsset = (root: CardInstance[]) => root.some(c => !hiddenRoot(c) && ['agenda', 'asset'].includes(cardDef(c).type_code));

/**
 * Keeps `corp.rootUpgradesKnownToRunner` by one diff after each action (ruling 2): a facedown card in a remote root
 * beside an agenda or asset the Runner knows is an upgrade (rules 3.2.1, 3.3.1, 4.6.6e: a remote root holds one agenda
 * or asset; installing another trashes the first in the same action, 8.5.6a, so the diff sees only the one left), and the
 * Runner keeps knowing it while the card stays installed in a root (4.6.6b, 10.2.2b); one that leaves play is a new
 * object (1.12.3) and its mark goes.
 */
function updateRootKinds(prev: GameState, state: GameState): void {
  const rootIds = (s: GameState) => new Set(Object.values(s.corp.servers).flatMap(sv => sv.root.filter(hiddenRoot).map(c => c.instanceId)));
  const now = rootIds(state);
  const was = rootIds(prev);
  let marks = (state.corp.rootUpgradesKnownToRunner ?? []).filter(id => now.has(id) && was.has(id));
  const mark = (c: CardInstance) => {
    if (hiddenRoot(c) && !marks.includes(c.instanceId)) marks = [...marks, c.instanceId];
  };
  for (const sv of Object.values(state.corp.servers)) if (sv.isRemote && knownAgendaOrAsset(sv.root)) sv.root.forEach(mark);
  // A facedown agenda or asset that left its root in the open (scored, stolen, trashed faceup: 4.5.2, 4.4.6c, 10.2.3a)
  // shows what it was; the cards that sat beside it and are still there are upgrades (#66b). Only a hidden root card
  // gone from the roots (or no longer hidden) can have; publicCards is built only then (B4b review note N2)
  const open = [...was].some(id => !now.has(id)) ? publicCards(state) : undefined;
  if (open) for (const [id, sv] of Object.entries(prev.corp.servers)) {
    if (!sv.isRemote || !sv.root.some(c => hiddenRoot(c) && ['agenda', 'asset'].includes(cardDef(c).type_code) && open.has(c.instanceId))) continue;
    const beside = new Set(sv.root.map(c => c.instanceId));
    for (const c of state.corp.servers[id]?.root ?? []) if (beside.has(c.instanceId)) mark(c);
  }
  if (marks.length) state.corp.rootUpgradesKnownToRunner = marks;
  else delete state.corp.rootUpgradesKnownToRunner;
}

/**
 * The kinds a facedown root card can be, from open information only (where a card is installed and what the Runner saw
 * beside it: rules 4.6.6e, f, 10.2.3a), for the Runner's guess; undefined for a card the Runner knows. The four cases
 * (brief b4-hidden-zones ruling 9): (i) a central root holds only upgrades (3.6.1, 4.6.6e); (ii) a card beside an
 * agenda or asset the Runner knows is an upgrade (3.2.1, 3.3.1); (iii) so is one that sat beside one that has left
 * (corp.rootUpgradesKnownToRunner); (iv) the facedown cards of one remote root hold at most one agenda or asset
 * (`joint`: the other cards of the same root that can be an agenda or asset, so a deal gives at most one of them one).
 */
export function runnerRootKinds(state: GameState, card: CardInstance): { kinds: RootKind[]; joint: CardInstance[] } | undefined {
  if (!hiddenRoot(card)) return undefined;
  const server = Object.values(state.corp.servers).find(sv => sv.root.includes(card));
  if (!server) return undefined;
  const upgradeOnly = { kinds: ['upgrade' as RootKind], joint: [] };
  const marked = new Set(state.corp.rootUpgradesKnownToRunner ?? []);
  const open = (c: CardInstance) => hiddenRoot(c) && !marked.has(c.instanceId);
  if (!server.isRemote || knownAgendaOrAsset(server.root) || !open(card)) return upgradeOnly;
  return { kinds: ROOT_KINDS, joint: server.root.filter(c => c !== card && open(c)) };
}

/** Cards the other side knows are (or may still be) in `owner`'s hand, oldest first, by name only. */
export function knownInHand(state: GameState, owner: SideCode): KnownHandCard[] {
  return knownList(state, owner);
}

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
