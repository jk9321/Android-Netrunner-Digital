import { CardDefinition, SideCode } from '../core/types/card';
import { ALL_CARDS, CARD_SETS } from '../core/cards';
import { validateDeck } from '../core/deckValidation';
import { DeckList, deckCodes } from './decks';
import { newCustomDeckId } from './customDecks';

/**
 * Deck import from NetrunnerDB.
 *
 * Accepts what NetrunnerDB hands out: the plain-text export ("3x Sure Gamble
 * (System Gateway)" lines under the deck name and identity), its Markdown
 * and BBCode copies, the OCTGN .o8d file, jinteki.net style "3 Sure Gamble"
 * lists, and a link to a decklist or shared deck, which is fetched from
 * NetrunnerDB's public API. Cards are matched by title against our pool
 * (CARD_SETS); cards we don't have are reported and left out, with their set
 * when known (see deckPlayability.ts).
 */

export interface ImportEntry {
  title: string;
  count: number;
  /** The set the card comes from, when the export or NetrunnerDB names it ("Midnight Sun"). */
  set?: string;
}

/** A decklist as written in the export, before matching it to our cards. */
export interface ParsedDeck {
  name?: string;
  /** The identity as written, when the export names one. */
  identity?: string;
  /** The identity's set, when the export names it. */
  identitySet?: string;
  entries: ImportEntry[];
}

export interface ImportResult {
  /** The deck to save; null when nothing in the import could be used. */
  deck: DeckList | null;
  /** Cards (and possibly the identity) the export lists that aren't in our pool. */
  missing: ImportEntry[];
  /** Notes about what the import changed, e.g. a picked identity. */
  notes: string[];
  /** Deck-building problems from the validator; the deck still saves, but can't start a game. */
  problems: string[];
  /** Every card in the import is in this game (nothing left out). */
  playable: boolean;
}

/** Title key that ignores case, accents, punctuation and curly quotes ("Brân 1.0" = "Bran 1.0"). */
export function normalizeTitle(title: string): string {
  return title
    .replace(/[™®]/g, '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const BY_KEY = new Map<string, CardDefinition>(ALL_CARDS.map(c => [normalizeTitle(c.title), c]));
const BY_CODE = new Map<string, CardDefinition>(ALL_CARDS.map(c => [c.code, c]));

export function findCardByTitle(title: string): CardDefinition | undefined {
  return BY_KEY.get(normalizeTitle(title));
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return XML_ENTITIES[e.toLowerCase()] ?? m;
  });

/** OCTGN .o8d: <section name="Identity"> and <card qty="3" id="…">Sure Gamble</card>. */
function parseO8d(xml: string): ParsedDeck {
  const parsed: ParsedDeck = { entries: [] };
  const sections = [...xml.matchAll(/<section\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/section>/gi)];
  const bodies = sections.length > 0 ? sections.map(m => [m[1], m[2]] as const) : [['', xml] as const];
  for (const [section, body] of bodies) {
    for (const m of body.matchAll(/<card\b([^>]*)>([\s\S]*?)<\/card>/gi)) {
      const qty = /qty="(\d+)"/i.exec(m[1]);
      const title = decodeXml(m[2]).trim();
      if (!title) continue;
      if (/identity/i.test(section)) parsed.identity = title;
      else parsed.entries.push({ title, count: qty ? Number(qty[1]) : 1 });
    }
  }
  const notes = /<notes>([\s\S]*?)<\/notes>/i.exec(xml);
  if (notes && notes[1].trim()) parsed.name = decodeXml(notes[1]).trim().split('\n')[0].trim();
  return parsed;
}

/** Removes Markdown/BBCode decoration and NetrunnerDB's influence dots. */
function cleanLine(line: string): string {
  return line
    .replace(/\[url=[^\]]*\]([^[]*)\[\/url\]/gi, '$1') // BBCode links
    .replace(/\[\/?(?:b|i|u|s|size|color|quote|list|center|\*)(?:=[^\]]*)?\]/gi, '') // other BBCode tags
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // Markdown links
    .replace(/^\s*(?:[-*+•]\s+|#+\s*)/, '') // bullets and headings
    .replace(/\*\*|__|(?<!\w)[*_]|[*_](?!\w)/g, '') // bold and italics
    .replace(/[●○•◦·★☆]+/g, ' ') // influence dots
    .replace(/\s+/g, ' ')
    .trim();
}

/** Drops NetrunnerDB's trailing set name: "Sure Gamble (System Gateway)". */
const stripSet = (line: string) => line.replace(/\s*\([^()]*\)$/, '').trim();
/** That trailing set name, if there is one. */
const setOf = (line: string) => /\(([^()]*)\)$/.exec(line)?.[1].trim() || undefined;

/** Section headers ("Event (14)", "Ice:") and NetrunnerDB's summary lines, which aren't cards. */
const HEADER = /^(?:agendas?|assets?|upgrades?|operations?|ice|events?|hardware|resources?|programs?|identity|barrier|code gate|sentry|other|icebreakers?|mixed)\s*(?:\(\d+\))?:?$/i;
const SUMMARY = /^(?:\d+\s+(?:cards?|influence|agenda points?)\b|cards up to\b|decklist published\b|deck built\b|total\b|influence\b|agenda points\b|standard\b|startup\b|eternal\b|mwl\b)/i;

/** Text exports: NetrunnerDB plain text / Markdown / BBCode, and "3 Sure Gamble" lists. */
export function parseDeckText(text: string): ParsedDeck {
  if (/<deck\b[\s\S]*<card\b/i.test(text)) return parseO8d(text);
  const parsed: ParsedDeck = { entries: [] };
  let seenCard = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = cleanLine(raw);
    if (!line || HEADER.test(line) || SUMMARY.test(line)) continue;
    const counted = /^(\d+)\s*[x×]?\s+(.+)$/i.exec(line) ?? /^(.+?)\s+[x×](\d+)$/i.exec(line);
    if (counted) {
      const [count, written] = /^\d/.test(counted[1]) ? [Number(counted[1]), counted[2]] : [Number(counted[2]), counted[1]];
      const title = stripSet(written);
      const card = findCardByTitle(title);
      if (card?.type_code === 'identity') parsed.identity = title.trim();
      // The set only matters for cards we lack, to say where they come from.
      else if (count > 0) parsed.entries.push({ title: title.trim(), count, ...(!card && setOf(written) && { set: setOf(written) }) });
      seenCard = true;
      continue;
    }
    // A line without a count: the deck name first, then the identity.
    const title = stripSet(line);
    const card = findCardByTitle(title);
    if (card?.type_code === 'identity') parsed.identity = title;
    else if (card) parsed.entries.push({ title, count: 1 });
    else if (parsed.name === undefined && !seenCard && !parsed.identity) parsed.name = line;
    else if (parsed.identity === undefined && !seenCard && title.includes(':')) {
      parsed.identity = title;
      parsed.identitySet = setOf(line);
    }
  }
  return parsed;
}

/** Matches a parsed list against our card pool and builds a custom deck from it. */
export function resolveImport(parsed: ParsedDeck): ImportResult {
  const missing: ImportEntry[] = [];
  const notes: string[] = [];
  const cards: Record<string, number> = {};
  let identity: CardDefinition | undefined;

  if (parsed.identity) {
    identity = findCardByTitle(parsed.identity);
    if (identity?.type_code !== 'identity') {
      identity = undefined;
      missing.push({ title: parsed.identity, count: 1, ...(parsed.identitySet && { set: parsed.identitySet }) });
    }
  }
  const sides = new Map<SideCode, number>();
  for (const { title, count, set } of parsed.entries) {
    const card = findCardByTitle(title);
    if (!card) {
      missing.push({ title, count, ...(set && { set }) });
      continue;
    }
    if (card.type_code === 'identity') {
      identity ??= card;
      continue;
    }
    cards[card.title] = (cards[card.title] ?? 0) + count;
    sides.set(card.side_code, (sides.get(card.side_code) ?? 0) + count);
  }

  const side: SideCode | undefined =
    identity?.side_code ?? ((sides.get('corp') ?? 0) >= (sides.get('runner') ?? 0) && sides.size > 0 ? 'corp' : sides.size > 0 ? 'runner' : undefined);
  if (!side) return { deck: null, missing, notes: [`No cards from ${CARD_SETS.map(s => s.name).join(', ')} were found in the import.`], problems: [], playable: false };
  if (!identity) {
    identity = ALL_CARDS.find(c => c.side_code === side && c.type_code === 'identity')!;
    notes.push(
      parsed.identity
        ? `${parsed.identity} isn't in this game, so the deck uses ${identity.title}. Change it in the deckbuilder.`
        : `The import has no identity, so the deck uses ${identity.title}. Change it in the deckbuilder.`
    );
  }
  // Cards for the other side can't go in this deck.
  for (const title of Object.keys(cards)) {
    const card = findCardByTitle(title)!;
    if (card.side_code !== side) {
      notes.push(`Left out ${cards[title]}x ${title}, a ${card.side_code} card.`);
      delete cards[title];
    }
  }

  const deck: DeckList = {
    id: newCustomDeckId(),
    name: parsed.name?.trim() || identity.title,
    side,
    identity: identity.title,
    cards,
    source: 'custom',
    ...(missing.length > 0 && { missing }),
  };
  return { deck, missing, notes, problems: validateDeck(deckCodes(deck)), playable: missing.length === 0 };
}

/** Parses and resolves a pasted export or file in one step. */
export function importDeckText(text: string): ImportResult {
  return resolveImport(parseDeckText(text));
}

/** A NetrunnerDB decklist (published) or deck (shared private) link. */
export function parseNetrunnerDbUrl(text: string): { kind: 'decklist' | 'deck'; id: string } | null {
  const m = /^\s*(?:https?:\/\/)?(?:www\.)?netrunnerdb\.com\/(?:[a-z]{2}\/)?(decklist|deck\/view)\/([0-9a-f-]+)/i.exec(text);
  if (!m) return null;
  return { kind: m[1].toLowerCase() === 'decklist' ? 'decklist' : 'deck', id: m[2] };
}

const NRDB_API = 'https://netrunnerdb.com/api/2.0/public';

interface NrdbDeck {
  name: string;
  cards: Record<string, number>;
}

/**
 * Fetches a deck from NetrunnerDB's public API (it allows cross-origin
 * requests). The API lists card codes; codes outside our pool (reprints in
 * later sets, or other cards) are looked up by title so a reprinted Gateway
 * card still matches, and anything else is reported as missing.
 */
export async function fetchNetrunnerDbDeck(url: string, fetchFn: typeof fetch = fetch): Promise<ParsedDeck> {
  const ref = parseNetrunnerDbUrl(url);
  if (!ref) throw new Error('That is not a NetrunnerDB deck link.');
  const getJson = async (path: string) => {
    const res = await fetchFn(`${NRDB_API}/${path}`);
    if (!res.ok) throw new Error(`NetrunnerDB answered ${res.status}`);
    const body = (await res.json()) as { data?: unknown[] };
    if (!body.data?.length) throw new Error('NetrunnerDB has no such deck.');
    return body.data;
  };
  let deck: NrdbDeck;
  try {
    deck = (await getJson(`${ref.kind}/${ref.id}`))[0] as NrdbDeck;
  } catch (e) {
    if (ref.kind === 'deck') {
      throw new Error(
        `${(e as Error).message}. A private deck can only be fetched when it is shared ("Share your decks" in your NetrunnerDB account settings). You can also paste its text export.`
      );
    }
    throw e;
  }
  const parsed: ParsedDeck = { name: deck.name, entries: [] };
  let packNames: Map<string, string> | undefined;
  const packName = async (code: string) => {
    if (!packNames) {
      try {
        packNames = new Map(((await getJson('packs')) as { code: string; name: string }[]).map(p => [p.code, p.name]));
      } catch {
        packNames = new Map();
      }
    }
    return packNames.get(code);
  };
  for (const [code, count] of Object.entries(deck.cards ?? {})) {
    let title = BY_CODE.get(code)?.title;
    let set: string | undefined;
    if (!title) {
      try {
        const card = (await getJson(`card/${code}`))[0] as { title: string; pack_code?: string };
        title = card.title;
        if (card.pack_code && !findCardByTitle(title)) set = await packName(card.pack_code);
      } catch {
        title = `Card ${code}`;
      }
    }
    if (findCardByTitle(title)?.type_code === 'identity') parsed.identity = title;
    else parsed.entries.push({ title, count, ...(set && { set }) });
  }
  return parsed;
}
