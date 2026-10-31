import { STARTER_DECKS, type DeckList } from '../src/data/decks';
import { NSG_SAMPLE_DECKS } from '../src/data/testDecks/nsgSamples';

export { NSG_SAMPLE_DECKS };

/** The starters plus the NSG sample decks: the pool for AI batches and tests (whatever the build flag). */
export const ALL_DECKS: DeckList[] = [...STARTER_DECKS, ...NSG_SAMPLE_DECKS];
