import { getCardDefinition } from './cards';
import { CardDefinition } from './types/card';
import { FormatId, getFormat, validateFormat } from './formats';

/** A deck: an identity and the codes of its cards (one entry per copy). */
export interface DeckSpec {
  identity: string;
  cards: string[];
  /** Format whose card pool and ban list apply; casual (no limits) when left out. */
  format?: FormatId;
}

/**
 * Agenda points a Corp deck needs: 2 for every 5 cards, plus 2, and it may
 * have 1 point more (40-44 cards: 18 or 19).
 */
export function requiredAgendaPoints(deckSize: number): [number, number] {
  const min = 2 * Math.floor(deckSize / 5) + 2;
  return [min, min + 1];
}

/** Influence a card costs in a deck with this identity (0 for in-faction and neutral cards). */
export function influenceCost(identity: CardDefinition, card: CardDefinition): number {
  if (card.faction_code === identity.faction_code || card.faction_code.startsWith('neutral')) return 0;
  return card.faction_cost ?? 0;
}

/**
 * Copies over the deck limit: 3 per card, or the card's own limit. Counted by
 * name, so reprints from different sets share one limit (rule 1.4.7).
 */
export function copyLimitProblems(cards: CardDefinition[]): string[] {
  const byTitle = new Map<string, { def: CardDefinition; count: number }>();
  for (const def of cards) {
    const entry = byTitle.get(def.title) ?? { def, count: 0 };
    entry.count++;
    byTitle.set(def.title, entry);
  }
  const problems: string[] = [];
  for (const { def, count } of byTitle.values()) {
    const limit = def.deck_limit ?? 3;
    if (count > limit) problems.push(`${count} copies of ${def.title} (limit ${limit})`);
  }
  return problems;
}

/**
 * Checks deck-building rules: identity and card sides, minimum deck size,
 * copies per card (deck limit), influence, out-of-faction agendas, and
 * agenda points, then the format's card pool, ban list and extra rules.
 * Returns a list of problems; empty means the deck is legal.
 */
export function validateDeck(deck: DeckSpec): string[] {
  const problems: string[] = [];
  let identity: CardDefinition;
  try {
    identity = getCardDefinition(deck.identity);
  } catch {
    return [`Unknown identity ${deck.identity}`];
  }
  if (identity.type_code !== 'identity') return [`${identity.title} is not an identity`];

  const defs: CardDefinition[] = [];
  for (const code of deck.cards) {
    try {
      defs.push(getCardDefinition(code));
    } catch {
      problems.push(`Unknown card ${code}`);
    }
  }

  const minSize = identity.minimum_deck_size ?? 0;
  if (defs.length < minSize) problems.push(`Deck has ${defs.length} cards; ${identity.title} needs at least ${minSize}`);

  for (const def of new Map(defs.map(d => [d.code, d])).values()) {
    if (def.type_code === 'identity') problems.push(`${def.title} is an identity and cannot be in a deck`);
    if (def.side_code !== identity.side_code) problems.push(`${def.title} is a ${def.side_code} card`);
  }
  problems.push(...copyLimitProblems(defs));

  if (identity.influence_limit != null) {
    const influence = defs.reduce((n, d) => n + influenceCost(identity, d), 0);
    if (influence > identity.influence_limit) problems.push(`Uses ${influence} influence (limit ${identity.influence_limit})`);
  }

  if (identity.side_code === 'corp') {
    const agendas = defs.filter(d => d.type_code === 'agenda');
    for (const d of new Map(agendas.map(a => [a.code, a])).values()) {
      if (d.faction_code !== identity.faction_code && !d.faction_code.startsWith('neutral')) {
        problems.push(`${d.title} is an out-of-faction agenda`);
      }
    }
    const points = agendas.reduce((n, d) => n + (d.agenda_points ?? 0), 0);
    const [min, max] = requiredAgendaPoints(defs.length);
    if (points < min || points > max) problems.push(`Has ${points} agenda points; a ${defs.length}-card deck needs ${min} or ${max}`);
  }
  problems.push(...validateFormat(getFormat(deck.format), identity, defs));
  return problems;
}
