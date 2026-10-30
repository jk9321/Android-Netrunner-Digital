import { CARD_SETS } from '../core/cards';
import { ImportEntry, normalizeTitle } from './deckImport';

/**
 * Deck playability: whether an imported decklist can be played with the cards
 * this game has implemented, and which unimplemented sets would fill the gaps.
 * Used by the import screen and by scripts/deck-playability.ts, which new-set
 * threads run to filter NetrunnerDB sample decks and to pick the next set.
 */

/** A NetrunnerDB pack, as /api/2.0/public/packs lists it. */
export interface PackInfo {
  code: string;
  name: string;
  date_release: string | null;
}

/** Normalized card title -> pack codes it is printed in (every printing). */
export type PrintingIndex = Map<string, Set<string>>;

/** Builds the printing index from NetrunnerDB's full card list. */
export function buildPrintingIndex(cards: { title: string; pack_code: string }[]): PrintingIndex {
  const index: PrintingIndex = new Map();
  for (const c of cards) {
    const key = normalizeTitle(c.title);
    if (!index.has(key)) index.set(key, new Set());
    index.get(key)!.add(c.pack_code);
  }
  return index;
}

/** Pack codes of the sets in our card pool. */
export const IMPLEMENTED_PACKS = new Set(CARD_SETS.map(s => s.code));

export interface MissingBySet {
  /** Set name; "Unknown set" when neither the export nor the printing index says. */
  set: string;
  cards: ImportEntry[];
  copies: number;
}

/** Groups missing cards by set, the set with the most missing copies first. */
export function groupMissingBySet(missing: ImportEntry[]): MissingBySet[] {
  const groups = new Map<string, ImportEntry[]>();
  for (const m of missing) {
    const set = m.set ?? 'Unknown set';
    groups.set(set, [...(groups.get(set) ?? []), m]);
  }
  return [...groups]
    .map(([set, cards]) => ({ set, cards, copies: cards.reduce((n, c) => n + c.count, 0) }))
    .sort((a, b) => b.copies - a.copies || a.set.localeCompare(b.set));
}

/** One deck's missing card titles, for set ranking. */
export interface DeckGap {
  id: string;
  missing: ImportEntry[];
}

export interface SetStep {
  pack: string;
  /** Decks this set makes fully playable, on top of the sets before it. */
  unlocked: string[];
  /** Missing copies across all still-incomplete decks this set supplies. */
  copies: number;
  /** Fully playable decks after adding this set and the ones before it. */
  playableAfter: number;
}

export interface SetRanking {
  /** Decks already fully playable with our sets. */
  playableNow: string[];
  /** Per candidate set: decks it alone would make fully playable. */
  alone: { pack: string; unlocked: string[]; copies: number }[];
  /** Greedy order: each step adds the set that unlocks the most remaining decks. */
  order: SetStep[];
  /** Decks with a card no candidate set prints (e.g. only in rotated packs). */
  unreachable: string[];
}

/** Packs that print a title, limited to the candidates. */
const printedIn = (index: PrintingIndex, title: string, candidates: Set<string>) =>
  [...(index.get(normalizeTitle(title)) ?? [])].filter(p => candidates.has(p));

/**
 * Ranks candidate sets by how many decks they would make fully playable.
 * A card printed in several sets counts for each of them, since adding any
 * one of those sets brings the card in. `packOrder` breaks ties (earlier
 * first), e.g. release order for an oldest-first plan.
 */
export function rankSetsToUnlock(
  decks: DeckGap[],
  index: PrintingIndex,
  candidates: string[],
  packOrder: string[] = candidates
): SetRanking {
  const cand = new Set(candidates);
  const rank = (p: string) => (packOrder.indexOf(p) + 1 || Infinity);
  const playableNow = decks.filter(d => d.missing.length === 0).map(d => d.id);
  const unreachable = decks
    .filter(d => d.missing.some(m => printedIn(index, m.title, cand).length === 0))
    .map(d => d.id);
  const open = decks.filter(d => d.missing.length > 0 && !unreachable.includes(d.id));

  const score = (added: Set<string>, pack: string, pending: DeckGap[]) => {
    const withPack = new Set([...added, pack]);
    const covered = (m: ImportEntry) => printedIn(index, m.title, cand).some(p => withPack.has(p));
    const unlocked = pending.filter(d => d.missing.every(covered)).map(d => d.id);
    const copies = pending.reduce(
      (n, d) => n + d.missing.filter(m => !printedIn(index, m.title, cand).some(p => added.has(p)) && covered(m)).reduce((k, m) => k + m.count, 0),
      0
    );
    return { pack, unlocked, copies };
  };
  const better = (a: ReturnType<typeof score>, b: ReturnType<typeof score>) =>
    b.unlocked.length - a.unlocked.length || b.copies - a.copies || rank(a.pack) - rank(b.pack);

  const alone = candidates.map(p => score(new Set(), p, open)).sort(better);

  const order: SetStep[] = [];
  const added = new Set<string>();
  let pending = open;
  let playable = playableNow.length;
  while (pending.length > 0) {
    const best = candidates.filter(p => !added.has(p)).map(p => score(added, p, pending)).sort(better)[0];
    if (!best || best.copies === 0) break;
    added.add(best.pack);
    pending = pending.filter(d => !best.unlocked.includes(d.id));
    playable += best.unlocked.length;
    order.push({ ...best, playableAfter: playable });
  }
  return { playableNow, alone, order, unreachable };
}

/** Pack name from a code, for messages. */
export function packName(packs: PackInfo[], code: string): string {
  return packs.find(p => p.code === code)?.name ?? code;
}
