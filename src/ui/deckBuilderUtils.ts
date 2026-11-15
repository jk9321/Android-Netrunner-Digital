import { CardDefinition, CardInstance, CardTypeCode, SideCode } from '../core/types/card';
import { getCardScript } from '../core/scripts';
import { ALL_CARDS } from '../data/cards';

export const TYPE_ORDER: Record<SideCode, CardTypeCode[]> = {
  corp: ['agenda', 'asset', 'upgrade', 'operation', 'ice'],
  runner: ['event', 'hardware', 'resource', 'program'],
};

export const TYPE_LABEL: Partial<Record<CardTypeCode, string>> = {
  agenda: 'Agendas',
  asset: 'Assets',
  upgrade: 'Upgrades',
  operation: 'Operations',
  ice: 'Ice',
  event: 'Events',
  hardware: 'Hardware',
  resource: 'Resources',
  program: 'Programs',
};

export const byTitle = new Map(ALL_CARDS.map(c => [c.title, c]));

/** Elevation cards whose abilities aren't in the engine yet (every System Gateway card is). */
export const unscripted = (c: CardDefinition) => c.pack_code !== 'sg' && !!c.text && !getCardScript(c.code);

export const typeRank = (c: CardDefinition) => TYPE_ORDER[c.side_code].indexOf(c.type_code);

/** A faceup stand-in for a card in the pool, for the popout and the inspect window. */
export const asInstance = (code: string): CardInstance => ({
  instanceId: `deckbuilder-${code}`,
  cardCode: code,
  isRezzed: true,
  advancementCounters: 0,
  tokens: {},
  hostedCardIds: [],
});

export const sortCards = (a: CardDefinition, b: CardDefinition) => typeRank(a) - typeRank(b) || a.title.localeCompare(b.title);
