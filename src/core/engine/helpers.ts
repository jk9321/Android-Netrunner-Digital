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
  let known = knownList(state, owner);
  // Seen again: certain again (no card has left unseen since). The entry keeps its place in the list.
  if (known.some(e => e.lost && cards.some(c => c.instanceId === e.id))) known = known.map(e => (e.lost && cards.some(c => c.instanceId === e.id) ? { id: e.id, code: e.code } : e));
  const add = cards.filter(c => !known.some(e => e.id === c.instanceId)).map(c => ({ id: c.instanceId, code: c.cardCode }));
  setKnownList(state, owner, add.length > 0 ? [...known, ...add] : known);
}

/** The other side saw these known cards leave the hand for a hidden place (Touch-ups' shuffle). */
export function forgetInHand(state: GameState, owner: SideCode, cards: CardInstance[]): void {
  const known = knownList(state, owner);
  if (known.length > 0) setKnownList(state, owner, known.filter(e => !cards.some(c => c.instanceId === e.id)));
}

/** Cards anyone can see (rezzed or faceup installed cards, discard piles, score areas, the rig), by id to code. */
export function publicCards(state: GameState): Map<string, string> {
  const cards = new Map<string, string>();
  const add = (list: CardInstance[]) => {
    for (const c of list) {
      cards.set(c.instanceId, c.cardCode);
      for (const h of c.hostedCards ?? []) cards.set(h.instanceId, h.cardCode);
    }
  };
  for (const server of Object.values(state.corp.servers)) {
    add([...server.root, ...server.ice].filter(c => c.isRezzed || c.faceUp || c.runnerKnows));
  }
  const r = state.runner;
  add(state.corp.archives.faceUp);
  add(state.corp.scoreArea);
  add(r.scoreArea);
  add(r.heap);
  add([...r.rig.programs, ...r.rig.hardware, ...r.rig.resources]);
  add(state.removedFromGame);
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

/** Every entry of `list` saw these unseen departures after it was seen. */
function addLosses(list: KnownHandCard[], kinds: LossKind[]): KnownHandCard[] {
  if (kinds.length === 0) return list;
  return list.map(e => {
    const lost: KnownLosses = { ...e.lost };
    for (const k of kinds) lost[k] = (lost[k] ?? 0) + 1;
    return { ...e, lost };
  });
}

/** The departures since `e` was seen that could have been a card of type `type`. */
function lossesFor(e: KnownHandCard, type: string): number {
  const l = e.lost;
  if (!l) return 0;
  const root = type === 'agenda' || type === 'asset' || type === 'upgrade';
  return (l.any ?? 0) + (type === 'ice' ? (l.ice ?? 0) : 0) + (root ? (l.root ?? 0) : 0) + (type === 'upgrade' ? (l.upgrade ?? 0) : 0);
}

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

/**
 * Facedown Archives: a card the Runner knew (in the open, or seen exactly in R&D) that goes facedown into Archives is
 * one it knows is there (rules 4.4.6b, 10.2.2b); a card that leaves unseen is a departure it cannot tell (1.12.3); one
 * that turns up in the open is no longer hidden.
 */
function updateArchivesKnowledge(prev: GameState, state: GameState): void {
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
      known = addLosses(
        known.filter(e => nowIds.has(e.id) || !open.has(e.id)),
        departed.filter(c => !open.has(c.instanceId)).map(c => lossKind(state, c.instanceId))
      );
    }
  }
  if (arrivals.length > 0) {
    const openBefore = publicCards(prev);
    const exactInRd = new Set((prev.corp.rdKnownToRunner ?? []).filter(e => e.lo === e.hi && !e.left).map(e => e.id));
    for (const c of arrivals) if ((openBefore.has(c.instanceId) || exactInRd.has(c.instanceId)) && !known.some(e => e.id === c.instanceId)) known = [...known, { id: c.instanceId, code: c.cardCode }];
  }
  known = known.slice(Math.max(0, known.length - now.length));
  if (known.length > 0 || state.corp.archKnownToRunner) state.corp.archKnownToRunner = known;
}

/**
 * A card that was in the open and goes back to a hand (a rezzed or known ice returned to HQ: Descent, Hermes, Tatu-Bola;
 * a heap card taken back to the grip) is one the other side saw go there (10.2.2b, 10.2.3a): it joins the list. Step 0
 * gap 3. A card drawn from R&D or the stack is left to updateRdKnowledge (the Runner's R&D marks).
 */
function noteOpenArrivals(prev: GameState, state: GameState): void {
  let open: Map<string, string> | undefined;
  for (const owner of ['corp', 'runner'] as const) {
    const was = owner === 'corp' ? prev.corp.hq : prev.runner.grip;
    const now = owner === 'corp' ? state.corp.hq : state.runner.grip;
    if (now.length === 0) continue;
    const wasIds = new Set(was.map(c => c.instanceId));
    const deck = owner === 'corp' ? prev.corp.rd : prev.runner.stack;
    const arrivals = now.filter(c => !wasIds.has(c.instanceId) && !deck.some(d => d.instanceId === c.instanceId));
    if (arrivals.length === 0) continue;
    open ??= publicCards(prev);
    const seen = arrivals.filter(c => open!.has(c.instanceId));
    if (seen.length > 0) revealInHand(state, owner, seen);
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
export function updateHandKnowledge(prev: GameState, state: GameState): void {
  updateRootKinds(prev, state);
  updateArchivesKnowledge(prev, state);
  noteOpenArrivals(prev, state);
  if (knownList(state, 'corp').length === 0 && knownList(state, 'runner').length === 0) return;
  const before = publicCards(prev);
  const after = publicCards(state);
  // A found card waits set aside first (rules 4.8.3: it still counts as coming from its deck)
  const fromDeck = new Set([...prev.corp.rd, ...prev.runner.stack, ...setAsideFrom(prev, 'rd', 'stack')].map(c => c.instanceId));
  const surfaced = [...after].filter(([id]) => !before.has(id) && !fromDeck.has(id));
  for (const owner of ['corp', 'runner'] as const) {
    let known = knownList(state, owner);
    if (known.length === 0) continue;
    const hand = owner === 'corp' ? state.corp.hq : state.runner.grip;
    const inHand = new Set(hand.map(c => c.instanceId));
    // A card the Runner followed from HQ into R&D (an effect showed it there: it is marked in R&D) is no departure it
    // cannot tell, and it is no longer in HQ (step 0 gap 1: Pivot, The Holo Man, Cohort Guidance Program)
    const followed = owner === 'corp' ? new Set((state.corp.rdKnownToRunner ?? []).map(e => e.id)) : undefined;
    const departed = (owner === 'corp' ? prev.corp.hq : prev.runner.grip).filter(c => !inHand.has(c.instanceId) && !after.has(c.instanceId) && !followed?.has(c.instanceId));
    if (followed?.size) known = known.filter(e => inHand.has(e.id) || !followed.has(e.id));
    known = addLosses(
      known,
      departed.map(c => lossKind(state, c.instanceId))
    );
    for (const [id, code] of surfaced) {
      const same = known.findIndex(e => e.id === id);
      const i = same >= 0 ? same : known.findIndex(e => e.code === code);
      if (i >= 0) known = known.filter((_, j) => j !== i);
    }
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
  // shows what it was; the cards that sat beside it and are still there are upgrades (#66b)
  const open = publicCards(state);
  for (const [id, sv] of Object.entries(prev.corp.servers)) {
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
