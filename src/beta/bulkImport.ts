import { ImportResult, ParsedDeck, findCardByTitle, parseNetrunnerDbUrl, resolveImport } from '../data/deckImport';

/**
 * Bulk NetrunnerDB import, a beta-only testing tool (compiled out of main
 * builds by __BETA_TOOLS__). Fetches many decklists at once, from a pasted
 * list of links/ids or from every decklist published in a date range, and
 * resolves each against our card pool the same way the single import does.
 *
 * NetrunnerDB's public API allows cross-origin requests, so the browser
 * calls it directly. The full card and pack lists are fetched once per page
 * load, so each deck costs one request (or none, for a date range).
 */

const API = 'https://netrunnerdb.com/api/2.0/public';

export interface NrdbDecklist {
  id: number | string;
  uuid?: string;
  name: string;
  date_creation?: string;
  user_name?: string;
  mwl_code?: string | null;
  cards: Record<string, number>;
}

interface NrdbCard {
  code: string;
  title: string;
  pack_code: string;
  type_code: string;
}

export interface NrdbIndex {
  cards: Map<string, NrdbCard>;
  packs: Map<string, string>;
}

/** A published decklist (numeric id) or a shared private deck (uuid). */
export interface DeckRef {
  kind: 'decklist' | 'deck';
  id: string;
}

export interface BulkCandidate {
  ref: DeckRef;
  /** NetrunnerDB's link to the list. */
  url: string;
  author?: string;
  date?: string;
  mwl?: string | null;
  result: ImportResult;
}

type FetchFn = typeof fetch;

async function getJson<T>(fetchFn: FetchFn, path: string): Promise<T[]> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(`${API}/${path}`);
    if (res.ok) return ((await res.json()) as { data?: T[] }).data ?? [];
    if (attempt >= 2 || res.status === 404 || res.status === 403) throw new Error(`NetrunnerDB answered ${res.status}`);
    await new Promise(r => setTimeout(r, 800 * 2 ** attempt));
  }
}

let indexPromise: Promise<NrdbIndex> | null = null;

/** Every NetrunnerDB card and pack, fetched once and kept for the page's lifetime. */
export function loadNrdbIndex(fetchFn: FetchFn = fetch): Promise<NrdbIndex> {
  indexPromise ??= Promise.all([getJson<NrdbCard>(fetchFn, 'cards'), getJson<{ code: string; name: string }>(fetchFn, 'packs')])
    .then(([cards, packs]) => ({ cards: new Map(cards.map(c => [c.code, c])), packs: new Map(packs.map(p => [p.code, p.name])) }))
    .catch(e => {
      indexPromise = null; // let a later try fetch again
      throw e;
    });
  return indexPromise;
}

/** Test hook: forget the cached index. */
export function resetNrdbIndex(): void {
  indexPromise = null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every deck link or bare id in the text (one per line, or separated by spaces/commas), without repeats. */
export function extractDeckRefs(text: string): DeckRef[] {
  const refs: DeckRef[] = [];
  const seen = new Set<string>();
  for (const token of text.split(/[\s,;]+/)) {
    if (!token) continue;
    let ref: DeckRef | null = parseNetrunnerDbUrl(token);
    if (!ref && /^\d+$/.test(token)) ref = { kind: 'decklist', id: token };
    if (!ref && UUID.test(token)) ref = { kind: 'deck', id: token };
    if (!ref) continue;
    const key = `${ref.kind}/${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
}

/** Turns NetrunnerDB's card codes into titles; cards we lack keep the set they come from. */
export function nrdbToParsed(deck: NrdbDecklist, index: NrdbIndex): ParsedDeck {
  const parsed: ParsedDeck = { name: deck.name, entries: [] };
  for (const [code, count] of Object.entries(deck.cards ?? {})) {
    const card = index.cards.get(code);
    const title = card?.title ?? `Card ${code}`;
    const ours = findCardByTitle(title);
    if (card?.type_code === 'identity') {
      parsed.identity = title;
      if (!ours && card.pack_code) parsed.identitySet = index.packs.get(card.pack_code);
      continue;
    }
    const set = !ours && card?.pack_code ? index.packs.get(card.pack_code) : undefined;
    parsed.entries.push({ title, count, ...(set && { set }) });
  }
  return parsed;
}

export function deckUrl(ref: DeckRef): string {
  return ref.kind === 'decklist' ? `https://netrunnerdb.com/en/decklist/${ref.id}` : `https://netrunnerdb.com/en/deck/view/${ref.id}`;
}

export function toCandidate(ref: DeckRef, deck: NrdbDecklist, index: NrdbIndex): BulkCandidate {
  const result = resolveImport(nrdbToParsed(deck, index));
  if (result.deck && deck.user_name) result.deck.credit = deck.user_name;
  return { ref, url: deckUrl(ref), author: deck.user_name, date: deck.date_creation?.slice(0, 10), mwl: deck.mwl_code, result };
}

/** Fetches the listed decks a few at a time; a deck that fails is reported, not fatal. */
export async function fetchDecks(
  refs: DeckRef[],
  onProgress: (done: number, total: number) => void = () => {},
  fetchFn: FetchFn = fetch,
): Promise<{ candidates: BulkCandidate[]; errors: string[] }> {
  const index = await loadNrdbIndex(fetchFn);
  const candidates: (BulkCandidate | null)[] = new Array(refs.length).fill(null);
  const errors: string[] = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < refs.length) {
      const i = next++;
      const ref = refs[i];
      try {
        const [deck] = await getJson<NrdbDecklist>(fetchFn, `${ref.kind}/${ref.id}`);
        if (!deck) throw new Error('no such deck');
        candidates[i] = toCandidate(ref, deck, index);
      } catch (e) {
        errors.push(`${deckUrl(ref)}: ${(e as Error).message}${ref.kind === 'deck' ? ' (private decks must be shared in NetrunnerDB settings)' : ''}`);
      }
      onProgress(++done, refs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, refs.length) }, worker));
  return { candidates: candidates.filter((c): c is BulkCandidate => c !== null), errors };
}

/** Each day from `from` to `to` (YYYY-MM-DD, inclusive). */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return days;
  for (const d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
  return days;
}

export const MAX_DAYS = 120;

/** Every decklist published from `from` to `to`; one request per day. */
export async function fetchDecksByDate(
  from: string,
  to: string,
  onProgress: (done: number, total: number) => void = () => {},
  fetchFn: FetchFn = fetch,
): Promise<{ candidates: BulkCandidate[]; errors: string[] }> {
  const days = daysBetween(from, to);
  if (days.length === 0) throw new Error('Pick a start date on or before the end date.');
  if (days.length > MAX_DAYS) throw new Error(`That is ${days.length} days; pick at most ${MAX_DAYS}.`);
  const index = await loadNrdbIndex(fetchFn);
  const candidates: BulkCandidate[] = [];
  const errors: string[] = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < days.length) {
      const day = days[next++];
      try {
        for (const deck of await getJson<NrdbDecklist>(fetchFn, `decklists/by_date/${day}`)) {
          candidates.push(toCandidate({ kind: 'decklist', id: String(deck.id) }, deck, index));
        }
      } catch (e) {
        errors.push(`${day}: ${(e as Error).message}`);
      }
      onProgress(++done, days.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, days.length) }, worker));
  candidates.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  return { candidates, errors };
}

export interface BulkFilter {
  side?: 'corp' | 'runner';
  playableOnly?: boolean;
  legalOnly?: boolean;
  /** Only decklists tagged with a Startup ban list on NetrunnerDB. */
  startupOnly?: boolean;
  /** Text to find in the deck name, identity or author. */
  text?: string;
}

export function filterCandidates(candidates: BulkCandidate[], f: BulkFilter): BulkCandidate[] {
  const text = f.text?.trim().toLowerCase();
  return candidates.filter(c => {
    const d = c.result.deck;
    if (!d) return false;
    if (f.side && d.side !== f.side) return false;
    if (f.playableOnly && !c.result.playable) return false;
    if (f.legalOnly && c.result.problems.length > 0) return false;
    if (f.startupOnly && !c.mwl?.startsWith('startup')) return false;
    if (text && ![d.name, d.identity, c.author ?? ''].some(s => s.toLowerCase().includes(text))) return false;
    return true;
  });
}

/** Same name and identity as a deck already saved: likely imported before. */
export function isAlreadySaved(c: BulkCandidate, saved: { name: string; identity: string }[]): boolean {
  const d = c.result.deck;
  return !!d && saved.some(s => s.name === d.name && s.identity === d.identity);
}
