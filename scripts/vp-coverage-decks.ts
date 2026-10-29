import type { DeckList } from '../src/data/decks';

/**
 * Test-only decks for AI diagnostics (not in the deck picker, not legal):
 * the 27 Vantage Point cards that none of the NetrunnerDB sample decks
 * play, so self-play can check the AI uses them.
 *   COVERAGE=1 npx vite-node scripts/behaviour.ts -- 2 normal
 */
export const VP_COVERAGE_DECKS: DeckList[] = [
  {
    id: 'cov-vp-corp',
    name: 'VP coverage (Corp)',
    side: 'corp',
    identity: 'Editorial Division: Ad Nihilum',
    source: 'custom',
    cards: {
      'Let Them Dream': 3, 'Méliès City Luxury Line': 3, 'Lotus Haze': 2, 'Myōshu': 2,
      'Magistrate Revontulet': 2, 'Nihilo Agent': 2, 'Esca': 2, 'Synchrocyclotron': 1,
      'Flagship': 1, 'Shackleton Grid': 2, 'Perfect Recall': 2,
      'realloc()': 2, 'Retirement Plan': 1, 'Flood the Market': 2, 'Scapegoat': 1, 'Unleash': 2, 'Hedge Fund': 3,
      'Reverb': 2, 'Vertigo': 2, 'ezaM': 2, 'Vicsek': 2, 'Lethe': 1, 'Paywall': 3, 'Grubber': 2, 'Palisade': 2,
    },
  },
  {
    id: 'cov-vp-runner',
    name: 'VP coverage (Runner)',
    side: 'runner',
    identity: 'Hiram “0mission” Svensson: Shadow of the Past',
    source: 'custom',
    cards: {
      'Corsair': 3, 'Lampades': 2, 'Hackerspace': 2, 'Nurse Hạnh': 2, 'Stick and Poke': 1, 'Sell Out': 2, 'Beta Build': 2, 'Sipa': 2,
      'Methuselah': 2, 'Touchstone': 3, 'Aircheck': 3, 'Sure Gamble': 3, 'Creative Commission': 3,
      'Echelon': 2, 'Unity': 2, 'Principia': 3, 'Telework Contract': 3, 'DZMZ Optimizer': 2,
    },
  },
];
