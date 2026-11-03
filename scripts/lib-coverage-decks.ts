import type { DeckList } from '../src/data/decks';

/**
 * Test-only decks for AI diagnostics (not in the deck picker, not legal):
 * the 51 Liberation cards that none of the Liberation-era NetrunnerDB decks
 * (src/data/testDecks/nrdb.ts, ids lib-) play, so self-play can check the AI
 * uses them. The Corp decks run Thunderbolt Armaments and Nuvem SA.
 *   COVERAGE=1 DECKS=cov-lib npx vite-node scripts/behaviour.ts -- 2 normal
 */
export const LIB_COVERAGE_DECKS: DeckList[] = [
  {
    id: 'cov-lib-corp-hb',
    name: 'Liberation coverage (Thunderbolt)',
    side: 'corp',
    identity: 'Thunderbolt Armaments: Peace Through Power',
    source: 'custom',
    cards: {
      'Stegodon MK IV': 3, 'Lightning Laboratory': 3, 'Sisyphus Protocol': 2, 'Oracle Thinktank': 3, 'Send a Message': 2,
      'Jaguarundi': 3, 'Lycian Multi-Munition': 2, 'Tributary': 2, 'Starlit Knight': 2, 'Capacitor': 2, 'Piranhas': 2, 'Seraph': 2,
      'Brasília Government Grid': 2, 'Daniela Jorge Inácio': 2, 'Front Company': 2,
      'Greasing the Palm': 3, 'Bring Them Home': 2, 'Hedge Fund': 3, 'Your Digital Life': 3,
    },
  },
  {
    id: 'cov-lib-corp-nuvem',
    name: 'Liberation coverage (Nuvem SA)',
    side: 'corp',
    identity: 'Nuvem SA: Law of the Land',
    source: 'custom',
    cards: {
      'See How They Run': 3, 'Kingmaking': 3, 'Send a Message': 2, 'Above the Law': 2,
      'Virtual Service Agent': 3, 'Valentão': 3, 'Piranhas': 1, 'Starlit Knight': 1, 'Descent': 2, 'Logjam': 2,
      'Cybersand Harvester': 2, 'Angelique Garza Correa': 2, 'Janaína “JK” Dumont Kindelán': 3, 'Hearts and Minds': 2, 'Isaac Liberdade': 2,
      'Sudden Commandment': 3, 'Your Digital Life': 2, 'Hedge Fund': 3, 'Business As Usual': 2, 'Bring Them Home': 2,
    },
  },
  {
    id: 'cov-lib-runner-arissana',
    name: 'Liberation coverage (Arissana)',
    side: 'runner',
    identity: 'Arissana Rocha Nahu: Street Artist',
    source: 'custom',
    cards: {
      'Banner': 1, 'Monkeywrench': 2, 'Boi-tatá': 2, 'Living Mural': 2, 'Umbrella': 2, 'Lobisomem': 1, 'Pressure Spike': 1, 'Unity': 2,
      'Pichação': 2, 'Urban Art Vernissage': 2, 'Heliamphora': 1, 'AirbladeX (JSRF Ed.)': 1, 'The Wizard’s Chest': 1, 'Coalescence': 2,
      'The Price': 2, 'Joy Ride': 2, 'Spree': 2, 'Ashen Epilogue': 1, 'Strike Fund': 3, 'Friend of a Friend': 2,
      'Sure Gamble': 3, 'Creative Commission': 3,
    },
  },
  {
    id: 'cov-lib-runner-mercury',
    name: 'Liberation coverage (Mercury)',
    side: 'runner',
    identity: 'Mercury: Chrome Libertador',
    source: 'custom',
    cards: {
      'Shibboleth': 3, 'Curupira': 2, 'Carmen': 2, 'Capybara': 2, 'Laser Pointer': 2, 'Physarum Entangler': 2, 'Malandragem': 1, 'Saci': 2,
      'Chrysopoeian Skimming': 2, 'S-Dobrado': 3, 'Window of Opportunity': 2, 'Meeting of Minds': 1,
      'Debbie "Downtown" Moreira': 2, 'Jeitinho': 3, 'Amelia Earhart': 2, 'Juli Moreira Lee': 2, 'Alarm Clock': 2,
      'Sure Gamble': 3, 'Creative Commission': 3,
    },
  },
];
