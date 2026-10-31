import type { ImportEntry } from './deckImport';
import { GameSetup } from '../core/engine/gameState';
import { SideCode } from '../core/types/card';
import { ALL_CARDS } from './cards';
import { DeckSpec, validateDeck } from '../core/deckValidation';
import { FormatId } from '../core/formats';
import { NSG_SAMPLE_DECKS } from './testDecks/nsgSamples';
import { NRDB_TEST_DECKS } from './testDecks/nrdb';

/**
 * Premade decks that ship with the game: only the two official System Gateway
 * starter decks (Null Signal Games product page). Other people's lists (NSG's
 * sample decklists, NetrunnerDB decks) are in src/data/testDecks and listed only in
 * beta builds (__ALL_DECKS__, set in vite.config.ts); main builds list the starters alone.
 */

export interface DeckList {
  id: string;
  name: string;
  side: SideCode;
  /** Identity title. */
  identity: string;
  /** Card title -> copies. */
  cards: Record<string, number>;
  /** Where the list comes from: NSG starter, NSG sample, a published NetrunnerDB decklist, or built by the player. */
  source: 'official starter' | 'official sample' | 'netrunnerdb' | 'custom';
  /** Who designed the list, for official samples that name a designer. */
  credit?: string;
  /** Play format the deck is built for; casual (any card) when left out. */
  format?: FormatId;  /** Cards an imported list had that aren't in this game, so the import left them out. */
  missing?: ImportEntry[];
}

export const STARTER_DECKS: DeckList[] = [
  {
    id: 'syndicate-starter',
    name: 'The Syndicate (starter)',
    side: 'corp',
    identity: 'The Syndicate: Profit over Principle',
    source: 'official starter',
    cards: {
      'Offworld Office': 3, 'Send a Message': 2, 'Superconducting Hub': 2,
      'Nico Campaign': 2, 'Urtica Cipher': 2, 'Regolith Mining License': 2, 'Manegarm Skunkworks': 1,
      'Brân 1.0': 2, 'Diviner': 2, 'Karunā': 2, 'Palisade': 3, 'Tithe': 2, 'Whitespace': 2,
      'Seamless Launch': 2, 'Government Subsidy': 2, 'Hedge Fund': 3,
    },
  },
  {
    id: 'catalyst-starter',
    name: 'The Catalyst (starter)',
    side: 'runner',
    identity: 'The Catalyst: Convention Breaker',
    source: 'official starter',
    cards: {
      'Tread Lightly': 2, 'Creative Commission': 2, 'VRcation': 2, 'Overclock': 2, 'Jailbreak': 3, 'Sure Gamble': 3,
      'Docklands Pass': 1, 'Pennyshaver': 1,
      'Cleaver': 2, 'Carmen': 2, 'Unity': 2, 'Mayfly': 2,
      'Red Team': 1, 'Telework Contract': 2, 'Smartware Distributor': 2, 'Verbal Plasticity': 1,
    },
  },
];

/** The decks the picker lists: the starters, plus every test deck in beta builds. */
export const DECKS: DeckList[] = __ALL_DECKS__ ? [...STARTER_DECKS, ...NSG_SAMPLE_DECKS, ...NRDB_TEST_DECKS] : STARTER_DECKS;

const codeByTitle = new Map(ALL_CARDS.map(c => [c.title, c.code]));

function codeOf(title: string): string {
  const code = codeByTitle.get(title);
  if (!code) throw new Error(`Unknown card title in decklist: ${title}`);
  return code;
}

/** A built-in deck, or one of `extra` (the player's custom decks). */
export function getDeck(id: string, extra: DeckList[] = []): DeckList {
  const deck = [...DECKS, ...extra].find(d => d.id === id);
  if (!deck) throw new Error(`Unknown deck ${id}`);
  return deck;
}

/** The identity code and the card codes (one entry per copy) of a decklist. */
export function deckCodes(deck: DeckList): DeckSpec {
  return {
    format: deck.format,
    identity: codeOf(deck.identity),
    cards: Object.entries(deck.cards).flatMap(([title, n]) => Array<string>(n).fill(codeOf(title))),
  };
}

/** Decks the Random deck button can pick for a side: legal, and not one of the starter decks. */
export function randomDeckPool(decks: DeckList[], side: SideCode): DeckList[] {
  return decks.filter(d => {
    if (d.side !== side || d.source === 'official starter') return false;
    try {
      return validateDeck(deckCodes(d)).length === 0;
    } catch {
      return false;
    }
  });
}

/** A random deck from the pool, avoiding `currentId` when there is anything else to pick. */
export function pickRandomDeck(
  decks: DeckList[],
  side: SideCode,
  currentId: string,
  random: () => number = Math.random,
): DeckList | null {
  const pool = randomDeckPool(decks, side);
  const others = pool.filter(d => d.id !== currentId);
  const choices = others.length > 0 ? others : pool;
  return choices.length > 0 ? choices[Math.floor(random() * choices.length)] : null;
}

export const DEFAULT_CORP_DECK = 'syndicate-starter';
export const DEFAULT_RUNNER_DECK = 'catalyst-starter';

/** Game setup for two decklists (built-in deck ids, or the decks themselves). */
export function deckGameSetup(seed: number, corpDeck: string | DeckList, runnerDeck: string | DeckList): GameSetup {
  const corp = deckCodes(typeof corpDeck === 'string' ? getDeck(corpDeck) : corpDeck);
  const runner = deckCodes(typeof runnerDeck === 'string' ? getDeck(runnerDeck) : runnerDeck);
  return { seed, corpIdentity: corp.identity, corpDeck: corp.cards, runnerIdentity: runner.identity, runnerDeck: runner.cards };
}
