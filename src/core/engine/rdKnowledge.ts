import { CardInstance } from '../types/card';
import { GameState, RdCorpKnownCard, RdKnownCard, RdNotes } from '../types/state';
import { shuffleInPlace } from '../rng';
import { NO_RD_WALK, publicCards, RdWalk, updateHandKnowledge } from './helpers';

/**
 * The Runner's memory of R&D. A card the Runner accesses or looks at in R&D
 * stays where it is (rules 7.4.7a: R&D is accessed from the top down), so the
 * Runner remembers it and follows it as cards are drawn from the top (1.8.5),
 * added to the top or bottom, or taken from places they can see. When the
 * Corp secretly acts on the top cards (looks at them and installs one,
 * Cultivate, arranges them "in any order", 8.3.3, 1.12.3) the Runner only
 * knows the card is somewhere among them. A shuffle forgets where each card
 * is (4.2.2, 8.7.3) but not that it is in R&D (10.2.2b): each mark becomes a
 * share of the whole deck (RdKnownCard.n0). A card follows to HQ only once it
 * has certainly been drawn.
 *
 * Effects call shuffleRD(), noteRdPrivate() and runnerSeesRd() while an
 * action resolves; updateRdKnowledge() then works out the rest from how R&D
 * changed, without using anything the Runner could not see.
 */

const notes = (state: GameState): RdNotes => (state.corp.rdNotes ??= {});

/**
 * For the engine fuzzer only (scripts/engine-fuzz-check.ts): how many times R&D has been shuffled, and the cards
 * the Corp has looked at since the last shuffle. Read by nothing in the game. Only real actions count: a trial run
 * on a copy (isLegalAction, also reached from the engine's own auto-pass probe, and the check of a declared action
 * that waits for the opponent's priority) raises `trial` and is not recorded, or a shuffle the game never made
 * would make the check flag a memory the Corp rightly kept.
 */
export const rdShuffleProbe = { shuffles: 0, corpSeenSince: new Set<string>(), trial: 0 };

/**
 * Shuffles R&D. Neither player knows where any card in it is any more (rules 4.2.2, 8.7.3), but the Runner still knows
 * which cards it saw there (10.2.2b): each mark of a card that is surely still in R&D becomes a share of the whole deck,
 * 1 / n0 per place (a uniform shuffle). A mark that may already have left R&D is dropped, as before. The Corp's own
 * memory of R&D is about places only, so it is emptied.
 */
export function shuffleRD(state: GameState): void {
  shuffleInPlace(state.rng, state.corp.rd);
  const seenBefore = notes(state).seen ?? [];
  notes(state).shuffled = true;
  notes(state).seen = [];
  notes(state).corpSeen = [];
  const n0 = state.corp.rd.length;
  const share = (id: string, code: string) => ({ id, code, lo: 0, hi: Math.max(0, n0 - 1), n0 });
  const marks = (state.corp.rdKnownToRunner ?? []).filter(e => !e.left).map(e => share(e.id, e.code));
  // A card the Runner saw in R&D earlier in this action, before the shuffle, is in R&D too (step 0 gap 4)
  for (const id of seenBefore) {
    const card = state.corp.rd.find(c => c.instanceId === id);
    if (card && !marks.some(e => e.id === id)) marks.push(share(id, card.cardCode));
  }
  state.corp.rdKnownToRunner = marks;
  state.corp.rdKnownToCorp = [];
  if (rdShuffleProbe.trial === 0) {
    rdShuffleProbe.shuffles++;
    rdShuffleProbe.corpSeenSince.clear();
  }
}

/**
 * The Corp looked at these R&D cards (Poétrï, Epiphany Analytica, Balanced Coverage, Méliès U, ezaM, Nuvem SA, an
 * arrange "in any order", 8.3.3), or put them there after a search that revealed them: it knows where they are
 * at the end of the action. A card the Runner accesses in R&D is not one of them: the Corp may not look at it (7.1.2).
 */
export function corpSeesRd(state: GameState, cards: CardInstance[]): void {
  const seen = (notes(state).corpSeen ??= []);
  for (const card of cards) {
    seen.push(card.instanceId);
    if (rdShuffleProbe.trial === 0) rdShuffleProbe.corpSeenSince.add(card.instanceId);
  }
  // Also written at once: a look made while the action settles (a trigger after the action, Nuvem SA) comes after
  // updateRdKnowledge, and the decision that follows must already know it. The next update follows it from here.
  const known = new Map(knownToCorpInRd(state).map(e => [e.id, e]));
  for (const card of cards) {
    const at = state.corp.rd.findIndex(c => c.instanceId === card.instanceId);
    if (at >= 0) known.set(card.instanceId, { id: card.instanceId, at });
  }
  state.corp.rdKnownToCorp = [...known.values()].sort((x, y) => x.at - y.at);
}

/** The Runner arranged these R&D cards in secret (Cataloguer): the Corp may not look at them (8.3.3a), so it forgets where they are. */
export function corpLosesRd(state: GameState, cards: CardInstance[]): void {
  const lost = cards.map(c => c.instanceId);
  (notes(state).corpForgets ??= []).push(...lost);
  if (state.corp.rdKnownToCorp) state.corp.rdKnownToCorp = state.corp.rdKnownToCorp.filter(e => !lost.includes(e.id));
}

/** The R&D cards the Corp knows the place of, top first. */
export function knownToCorpInRd(state: GameState): RdCorpKnownCard[] {
  return state.corp.rdKnownToCorp ?? [];
}

/**
 * Brings the Corp's memory of R&D up to date after an action. The Corp sees every card it puts into R&D (they come
 * from HQ, Archives, its play area or a score area: 4.3.2, 4.4.6c), every card it draws or trashes from the top and
 * every card the Runner steals or trashes there, so a card it knows keeps its place in its memory as the cards
 * around it come and go (4.2.3), with three exceptions: a shuffle forgets everything (4.2.2, 8.7.3); the cards the
 * Runner arranged in secret are forgotten (8.3.3a); and the cards the Runner merely accesses tell it nothing (7.1.2).
 */
function updateCorpRdKnowledge(prev: GameState, state: GameState, note: RdNotes | undefined): void {
  const had = state.corp.rdKnownToCorp;
  const seen = note?.corpSeen ?? [];
  const before = prev.corp.rd;
  const after = state.corp.rd;
  // Cheap way out (this runs after every action of every playout): nothing known, nothing seen, nothing came in
  if (!had?.length && seen.length === 0 && (note?.shuffled || !after.some((c, i) => before[i]?.instanceId !== c.instanceId))) return;
  const ids = new Set<string>();
  if (!note?.shuffled) {
    for (const e of had ?? []) ids.add(e.id);
    const was = new Set(before.map(c => c.instanceId));
    for (const c of after) if (!was.has(c.instanceId)) ids.add(c.instanceId);
  }
  for (const id of seen) ids.add(id);
  for (const id of note?.corpForgets ?? []) ids.delete(id);
  const known: RdCorpKnownCard[] = [];
  after.forEach((c, at) => ids.has(c.instanceId) && known.push({ id: c.instanceId, at }));
  if (known.length > 0 || had) state.corp.rdKnownToCorp = known;
}

/** The Corp secretly acted on the top `count` cards of R&D: which ones moved where is hidden (rules 8.3.3b). */
export function noteRdPrivate(state: GameState, count: number): void {
  notes(state).privateTop = Math.max(notes(state).privateTop ?? 0, count);
}

/** The Runner saw this card in R&D (accessed it, looked at it, or it was revealed and put there). */
export function runnerSeesRd(state: GameState, card: CardInstance): void {
  (notes(state).seen ??= []).push(card.instanceId);
}

/** The R&D cards the Runner remembers the place of, top first (not the shares a shuffle left: rdSharesKnownToRunner). */
export function knownInRd(state: GameState): RdKnownCard[] {
  const all = state.corp.rdKnownToRunner ?? [];
  return all.some(e => e.n0) ? all.filter(e => !e.n0) : all;
}

/** The R&D cards the Runner knows are in R&D since a shuffle, each with share 1 / n0 per place between `lo` and `hi`. */
export function rdSharesKnownToRunner(state: GameState): RdKnownCard[] {
  return (state.corp.rdKnownToRunner ?? []).filter(e => e.n0);
}

/**
 * B4d (a), the audit's AI-RD-MARK-LEFT-READ-CERTAIN: the Runner's R&D marks still certain (knownInRd, then the shares),
 * the R&D side of certainCounts' rule for HQ (B4a, R-100): a mark whose card may already have left R&D (`left`) is not
 * one, so its places count as unseen. The one reader of "what the Runner surely knows is in R&D": the R&D price
 * (rdWorth), the trap pool (unseenTraps), the deal's keeps and its exact places (knownRdSlots) read it, each with its own
 * further test. Rules 10.2.2b, 1.12.3.
 */
export function certainRdMarks(state: GameState): RdKnownCard[] {
  return [...knownInRd(state), ...rdSharesKnownToRunner(state)].filter(e => !e.left);
}

/**
 * The Runner's R&D marks (knownInRd, then the shares) as the Corp can place them: `corpAt` is the place of the mark's
 * card where the Corp knows that card is there (rdKnownToCorp; 4.2.3), else undefined. Ids stay in the engine (brief
 * b4-hidden-zones ruling 5): the Corp's deal names a card for every other mark by code and place only.
 */
export function runnerRdMarksForCorp(state: GameState): { mark: RdKnownCard; corpAt?: number }[] {
  const at = new Map(knownToCorpInRd(state).filter(e => state.corp.rd[e.at]?.instanceId === e.id).map(e => [e.id, e.at]));
  return [...knownInRd(state), ...rdSharesKnownToRunner(state)].map(mark => ({ mark, corpAt: at.get(mark.id) }));
}

/** Ids of `after` that kept their relative order from `before` (longest increasing run of old positions). */
function keptInOrder(before: string[], after: string[]): Set<string> {
  const oldPos = new Map(before.map((id, i) => [id, i]));
  const seq = after.filter(id => oldPos.has(id));
  const tails: number[] = []; // index into seq of the smallest tail of each run length
  const prevIdx: number[] = [];
  seq.forEach((id, i) => {
    const p = oldPos.get(id)!;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (oldPos.get(seq[tails[mid]])! < p) lo = mid + 1;
      else hi = mid;
    }
    prevIdx[i] = lo > 0 ? tails[lo - 1] : -1;
    tails[lo] = i;
  });
  const kept = new Set<string>();
  for (let i = tails.length > 0 ? tails[tails.length - 1] : -1; i >= 0; i = prevIdx[i]) kept.add(seq[i]);
  return kept;
}

/**
 * The marks after an action that shuffled R&D (step 0 gaps 2 and 4). shuffleRD turned the marks of the last action's end
 * into shares; the rest of the action is applied here, from how R&D changed and what is open:
 * - a card that left R&D in the open, or was seen in HQ in this action (B4d (b): RdNotes.handSeen, revealInHand's
 *   sightings; not the list of cards known in HQ, whose ids are labels since B4c and outlive a card's stay), is followed:
 *   one share of its code goes, by code and count, never by id (RT3: the Runner cannot tell which copy left; rules
 *   10.2.2b, 1.12.3). The shares of one code are alike: shuffleRD makes every share at once with this shuffle's `n0`,
 *   and so does the last loop below (RT15; a change to either keeps that true). A sighting in HQ is taken as the
 *   departed card's own: right where the reveal is of the card that moved (a tutor: Pivot, Editorial Division); no
 *   card in the pool moves an unseen card from R&D to HQ and reveals another HQ card in a shuffling action (RT9);
 * - any other card that left R&D this action could have been a marked one (1.12.3), so every share may have left;
 * - a card that was in the open and went into R&D (Spin Doctor, Longevity Serum, Sleipnir shuffle Archives in) is one
 *   the Runner saw go in (10.2.2b): it gets a share of the deck too (4.2.2, 8.7.3).
 * Cards the Runner sees after the shuffle are placed by step 6 as usual.
 */
function afterShuffle(prev: GameState, state: GameState, known: RdKnownCard[], note: RdNotes | undefined): RdKnownCard[] {
  const inRd = new Set(state.corp.rd.map(c => c.instanceId));
  const departed = prev.corp.rd.filter(c => !inRd.has(c.instanceId));
  const open = publicCards(state);
  const inHq = new Set(state.corp.hq.map(c => c.instanceId));
  const seenInHq = new Set((note?.handSeen ?? []).filter(g => g.owner === 'corp').flatMap(g => g.ids).filter(id => inHq.has(id)));
  const followed = departed.filter(c => open.has(c.instanceId) || seenInHq.has(c.instanceId));
  const unseen = departed.length > followed.length;
  let out = known;
  for (const card of followed) {
    const code = open.get(card.instanceId) ?? card.cardCode;
    const i = out.findIndex(e => e.n0 && e.code === code);
    if (i >= 0) out = out.filter((_, j) => j !== i);
  }
  out = out.map(e => (unseen && e.n0 && !e.left ? { ...e, left: 'other' as const } : e));
  const wasInRd = new Set(prev.corp.rd.map(c => c.instanceId));
  const openBefore = publicCards(prev);
  const n0 = state.corp.rd.length;
  for (const c of state.corp.rd)
    if (!wasInRd.has(c.instanceId) && openBefore.has(c.instanceId) && !out.some(e => e.id === c.instanceId)) out = [...out, { id: c.instanceId, code: c.cardCode, lo: 0, hi: Math.max(0, n0 - 1), n0 }];
  return out;
}

/**
 * The cheap way out of updateRdKnowledge (B4 tracker R-103; it runs after every action of every playout). It applies
 * when nothing the Runner knows of R&D can have changed: no shuffle, no secret look at the top and nothing seen, and
 * every card in the same place (rules 4.2.3: a deck's order holds unless a rule or ability changes it). It also needs
 * every mark already settled the way the full walk would leave it: none that may have left R&D (`left`), each within
 * R&D and sorted, and each mark's card in R&D inside its range. A card in R&D is in no open zone (rules 1.12.1: a card
 * is an object in one zone), so the walk's step 5 (a card that turns up in the open) removes nothing. The walk would
 * then return the list unchanged, so this skip does not change play.
 */
function unchangedRd(prev: GameState, state: GameState, note: RdNotes | undefined, known: RdKnownCard[]): boolean {
  // A Corp draw with R&D the same after it put a card back where it was (B4c part 3: step 0 forgets it)
  if (note?.shuffled || note?.privateTop || note?.seen?.length || note?.drawn?.some(d => d.owner === 'corp')) return false;
  const before = prev.corp.rd;
  const after = state.corp.rd;
  if (before.length !== after.length) return false;
  for (let i = 0; i < after.length; i++) if (before[i].instanceId !== after[i].instanceId) return false;
  for (let k = 0; k < known.length; k++) {
    const e = known[k];
    if (e.left || e.lo < 0 || e.lo > e.hi || e.hi > after.length - 1) return false;
    if (k > 0 && (known[k - 1].lo > e.lo || (known[k - 1].lo === e.lo && known[k - 1].hi > e.hi))) return false;
    let found = false;
    for (let i = e.lo; i <= e.hi && !found; i++) found = after[i].instanceId === e.id;
    if (!found) return false;
  }
  return true;
}

const mergeLeft = (a:RdKnownCard['left'], b: 'hq' | 'other'): 'hq' | 'other' => (a === undefined || a === b ? b : 'other');
const isExact = (e: RdKnownCard) => e.lo === e.hi && !e.left;

/** Both knowledge walks after an action, in order: R&D first, then the hands and Archives with what it handed over (RdWalk). */
export function updateKnowledge(prev: GameState, state: GameState): void {
  updateHandKnowledge(prev, state, updateRdKnowledge(prev, state));
}

/**
 * Brings the Runner's memory of R&D up to date after an action. Runs after
 * every action, before updateHandKnowledge(), and returns what that walk
 * needs from this one (RdWalk: a card certainly drawn joins the cards known
 * in HQ).
 */
export function updateRdKnowledge(prev: GameState, state: GameState): RdWalk {
  const note = state.corp.rdNotes;
  delete state.corp.rdNotes;
  updateCorpRdKnowledge(prev, state, note);
  let known = state.corp.rdKnownToRunner ?? [];
  const seen = note?.seen ?? [];
  const idle: RdWalk = note?.handSeen || note?.drawn ? { ...NO_RD_WALK, seen: note.handSeen ?? [], drawn: note.drawn ?? [] } : NO_RD_WALK;
  if (known.length === 0 && seen.length === 0 && !note?.shuffled) return idle;
  if (unchangedRd(prev, state, note, known)) return idle;

  const before = prev.corp.rd.map(c => c.instanceId);
  const after = state.corp.rd.map(c => c.instanceId);
  const afterPos = new Map(after.map((id, i) => [id, i]));
  const gone: RdKnownCard[] = [];
  // Cards the Runner followed out of an exact place (step 2): the only R&D cards whose next zone it can know
  const followed: string[] = [];
  const drawnIds = new Set((note?.drawn ?? []).filter(d => d.owner === 'corp').map(d => d.id));

  if (!note?.shuffled && known.length > 0) {
    const beforePos = new Map(before.map((id, i) => [id, i]));
    const kept = keptInOrder(before, after);
    const inHq = new Set(state.corp.hq.map(c => c.instanceId));
    const destOf = (id: string): 'hq' | 'other' => (inHq.has(id) ? 'hq' : 'other');
    let top = note?.privateTop ?? 0;
    const hiddenRemovals = before.map((id, p) => ({ id, p })).filter(x => x.p < top && !kept.has(x.id) && !afterPos.has(x.id)).length;
    // A card the Corp moved within the cards it acted on in secret is just part of that secret
    const movedWithinTop = (id: string) => beforePos.get(id)! < top && afterPos.has(id) && afterPos.get(id)! < top - hiddenRemovals;

    // 0. A card drawn and back in R&D in the same action went by HQ, hidden among its cards: the Runner can't follow it
    // (1.12.3; B4c part 3)
    if (drawnIds.size > 0) known = known.filter(e => !(drawnIds.has(e.id) && afterPos.has(e.id)));

    // 1. Cards the Corp acted on in secret could now be anywhere among them (rules 8.3.3)
    if (top > 0) known = known.map(e => (e.lo < top ? { ...e, lo: 0, hi: Math.max(e.hi, top - 1) } : e));

    // 2. Cards the Runner saw leave from a known place, bottom first so the places above stay put
    const carried = new Map<string, RdKnownCard>();
    const leftFrom = before.map((id, p) => ({ id, p })).filter(x => !kept.has(x.id) && !movedWithinTop(x.id));
    for (const { id, p } of [...leftFrom].reverse()) {
      if (p < top) continue;
      const moved = afterPos.has(id);
      const next: RdKnownCard[] = [];
      for (const e of known) {
        if (isExact(e) && e.lo === p) {
          if (moved) carried.set(id, e);
          else {
            gone.push({ ...e, left: destOf(id) });
            followed.push(id);
          }
        } else if (e.lo <= p && p <= e.hi) next.push({ ...e, hi: e.hi - 1, left: mergeLeft(e.left, moved ? 'other' : destOf(id)) });
        else if (e.lo > p) next.push({ ...e, lo: e.lo - 1, hi: e.hi - 1 });
        else next.push(e);
      }
      known = next;
    }

    // 3. Cards that left from among the secret ones: the Runner can't tell which
    for (const { id, p } of leftFrom) {
      if (p >= top) continue;
      const dest = afterPos.has(id) ? 'other' : destOf(id);
      known = known.map(e => (e.lo < top ? { ...e, hi: e.hi - 1, left: mergeLeft(e.left, dest) } : { ...e, lo: e.lo - 1, hi: e.hi - 1 }));
      top -= 1;
    }

    // 4. Cards added (or moved) to a place the Runner can see, top first
    const publicBefore = publicCards(prev);
    const added = after.map((id, q) => ({ id, q })).filter(x => !beforePos.has(x.id) || (!kept.has(x.id) && !movedWithinTop(x.id)));
    for (const { id, q } of added) {
      known = known.map(e => (e.lo >= q ? { ...e, lo: e.lo + 1, hi: e.hi + 1 } : e.hi >= q ? { ...e, hi: e.hi + 1 } : e));
      const carry = carried.get(id);
      const code = carry?.code ?? publicBefore.get(id);
      if (code) known.push({ id, code, lo: q, hi: q });
    }

    // 5. A card that turns up in the open may be one the Runner thought could have left R&D
    const surfaced = [...publicCards(state)].filter(([id]) => !publicBefore.has(id));
    for (const [id, code] of surfaced) {
      const same = known.findIndex(e => e.id === id);
      // Its own mark if it has one; else it may be any copy of its title the Runner thought could have left (10.2.2b),
      // so the mark that could make the strongest claim goes (B4c, brief rev 1 item 4): one that may be in HQ ('hq')
      // before one gone elsewhere, and a mark with a place before a shuffled share
      const rank = (e: RdKnownCard) => (e.left === 'hq' ? 0 : 2) + (e.n0 ? 1 : 0);
      let i = same;
      if (i < 0) known.forEach((e, j) => { if (e.left && e.code === code && (i < 0 || rank(e) < rank(known[i]))) i = j; });
      if (i >= 0) known = known.filter((_, j) => j !== i);
    }
  }

  // After a shuffle: the action's other moves, and the cards the Runner saw go in
  if (note?.shuffled) known = afterShuffle(prev, state, known, note);

  // 6. Cards seen during this action are exactly where they are now. B4d (b): a shuffle's share is matched by code, not
  // by id (as afterShuffle's departures, RT3): the card seen may be any share's card of its title (10.2.2b, 1.12.3), so
  // one share of that code goes, the one that claims the most first (a share still certain before one that may have left)
  for (const id of seen) {
    const q = afterPos.get(id);
    if (q === undefined) continue;
    const code = state.corp.rd[q].cardCode;
    const sameCode = known.filter(e => e.n0 && e.code === code);
    const share = sameCode.find(e => !e.left && e.id === id) ?? sameCode.find(e => !e.left) ?? sameCode.find(e => e.id === id) ?? sameCode[0];
    // A share kept under the seen card's id takes the dropped share's label (a share's id names no copy), so no two marks share an id
    const relabel = (e: RdKnownCard) => (share && e.n0 && e.id === id ? { ...e, id: share.id } : e);
    known = known
      .filter(e => e !== share && (e.n0 || e.id !== id))
      .map(e => relabel(isExact(e) ? e : { ...e, lo: e.lo === q ? e.lo + 1 : e.lo, hi: e.hi === q ? e.hi - 1 : e.hi }));
    known.push({ id, code, lo: q, hi: q });
  }

  // 7. Cards that have certainly left: drawn ones join the cards known in HQ
  for (const e of known) if (e.lo > e.hi) gone.push(e);
  known = known.filter(e => e.lo <= e.hi);
  // A drawn card is not seen in HQ (rules 1.8.5): it joins with the unseen HQ departures since it may have been drawn
  const joined = gone.filter(e => e.left === 'hq').map(e => ({ id: e.id, code: e.code, ...(e.lost ? { lost: e.lost } : {}) }));

  const last = state.corp.rd.length - 1;
  state.corp.rdKnownToRunner = known
    .map(e => ({ ...e, hi: Math.min(e.hi, last) }))
    .sort((a, b) => a.lo - b.lo || a.hi - b.hi);
  return { joined, seen: note?.handSeen ?? [], followed, drawn: note?.drawn ?? [] };
}
