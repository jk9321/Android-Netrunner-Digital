import { GameSetup } from '../src/core/engine/gameState';
import { ALL_CARDS } from '../src/data/cards';

/**
 * A sample pairing with one copy of (nearly) every card per side, used by
 * tests because it puts every card type within reach. It is not a legal
 * deck; the playable decks are in src/data/decks.ts.
 */

export const SAMPLE_CORP_IDENTITY = '30077'; // The Syndicate
export const SAMPLE_RUNNER_IDENTITY = '30076'; // The Catalyst

export function getSampleCorpDeck(): string[] {
  return ALL_CARDS.filter(c => c.pack_code === 'sg' && c.side_code === 'corp' && c.type_code !== 'identity')
    .slice(0, 30)
    .map(c => c.code);
}

export function getSampleRunnerDeck(): string[] {
  return ALL_CARDS.filter(c => c.pack_code === 'sg' && c.side_code === 'runner' && c.type_code !== 'identity')
    .slice(0, 30)
    .map(c => c.code);
}

/** Setup for a game between the two sample decks (tests). */
export function sampleGameSetup(seed: number): GameSetup {
  return {
    seed,
    corpIdentity: SAMPLE_CORP_IDENTITY,
    corpDeck: getSampleCorpDeck(),
    runnerIdentity: SAMPLE_RUNNER_IDENTITY,
    runnerDeck: getSampleRunnerDeck(),
  };
}
