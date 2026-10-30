import { CardInstance } from '../types/card';
import { GameState, RdKnownCard, RdNotes } from '../types/state';
import { shuffleInPlace } from '../rng';
import { publicCards, revealInHand } from './helpers';

/**
 * The Runner's memory of R&D. A card the Runner accesses or looks at in R&D
 * stays where it is (rules 7.4.7a: R&D is accessed from the top down), so the
 * Runner remembers it and follows it as cards are drawn from the top (1.8.5),
 * added to the top or bottom, or taken from places they can see. When the
 * Corp secretly acts on the top cards (looks at them and installs one,
 * Cultivate, arranges them "in any order", 8.3.3, 1.12.3) the Runner only
 * knows the card is somewhere among them. A shuffle forgets everything.
 * A card follows to HQ only once it has certainly been drawn.
 *
 * Effects call shuffleRD(), noteRdPrivate() and runnerSeesRd() while an
 * action resolves; updateRdKnowledge() then works out the rest from how R&D
 * changed, without using anything the Runner could not see.
 */

const notes = (state: GameState): RdNotes => (state.corp.rdNotes ??= {});

/** Shuffles R&D. The Runner no longer knows where any card in it is. */
export function shuffleRD(state: GameState): void {
  shuffleInPlace(state.rng, state.corp.rd);
  notes(state).shuffled = true;
  notes(state).seen = [];
  state.corp.rdKnownToRunner = [];
}

/** The Corp secretly acted on the top `count` cards of R&D: which ones moved where is hidden (rules 8.3.3b). */
export function noteRdPrivate(state: GameState, count: number): void {
  notes(state).privateTop = Math.max(notes(state).privateTop ?? 0, count);
}

/** The Runner saw this card in R&D (accessed it, looked at it, or it was revealed and put there). */
export function runnerSeesRd(state: GameState, card: CardInstance): void {
  (notes(state).seen ??= []).push(card.instanceId);
}

/** The R&D cards the Runner remembers, top first. */
export function knownInRd(state: GameState): RdKnownCard[] {
  return state.corp.rdKnownToRunner ?? [];
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

const mergeLeft = (a: RdKnownCard['left'], b: 'hq' | 'other'): 'hq' | 'other' => (a === undefined || a === b ? b : 'other');
const isExact = (e: RdKnownCard) => e.lo === e.hi && !e.left;

/**
 * Brings the Runner's memory of R&D up to date after an action. Runs after
 * every action, before updateHandKnowledge() (a card certainly drawn joins
 * the cards known in HQ).
 */
export function updateRdKnowledge(prev: GameState, state: GameState): void {
  const note = state.corp.rdNotes;
  delete state.corp.rdNotes;
  let known = knownInRd(state);
  const seen = note?.seen ?? [];
  if (known.length === 0 && seen.length === 0) return;

  const before = prev.corp.rd.map(c => c.instanceId);
  const after = state.corp.rd.map(c => c.instanceId);
  const afterPos = new Map(after.map((id, i) => [id, i]));
  const gone: RdKnownCard[] = [];

  if (!note?.shuffled && known.length > 0) {
    const beforePos = new Map(before.map((id, i) => [id, i]));
    const kept = keptInOrder(before, after);
    const inHq = new Set(state.corp.hq.map(c => c.instanceId));
    const destOf = (id: string): 'hq' | 'other' => (inHq.has(id) ? 'hq' : 'other');
    let top = note?.privateTop ?? 0;
    const hiddenRemovals = before.map((id, p) => ({ id, p })).filter(x => x.p < top && !kept.has(x.id) && !afterPos.has(x.id)).length;
    // A card the Corp moved within the cards it acted on in secret is just part of that secret
    const movedWithinTop = (id: string) => beforePos.get(id)! < top && afterPos.has(id) && afterPos.get(id)! < top - hiddenRemovals;

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
          else gone.push({ ...e, left: destOf(id) });
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
      const i = same >= 0 ? same : known.findIndex(e => e.left && e.code === code);
      if (i >= 0) known = known.filter((_, j) => j !== i);
    }
  }

  // 6. Cards seen during this action are exactly where they are now
  for (const id of seen) {
    const q = afterPos.get(id);
    if (q === undefined) continue;
    const code = state.corp.rd[q].cardCode;
    known = known.filter(e => e.id !== id).map(e => (isExact(e) ? e : { ...e, lo: e.lo === q ? e.lo + 1 : e.lo, hi: e.hi === q ? e.hi - 1 : e.hi }));
    known.push({ id, code, lo: q, hi: q });
  }

  // 7. Cards that have certainly left: drawn ones join the cards known in HQ
  for (const e of known) if (e.lo > e.hi) gone.push(e);
  known = known.filter(e => e.lo <= e.hi);
  const drawn = gone.filter(e => e.left === 'hq').map(e => state.corp.hq.find(c => c.instanceId === e.id) ?? ({ instanceId: e.id, cardCode: e.code } as CardInstance));
  if (drawn.length > 0) revealInHand(state, 'corp', drawn);

  const last = state.corp.rd.length - 1;
  state.corp.rdKnownToRunner = known
    .map(e => ({ ...e, hi: Math.min(e.hi, last) }))
    .sort((a, b) => a.lo - b.lo || a.hi - b.hi);
}
