import { GameSetup } from '../core/engine/gameState';
import { SideCode } from '../core/types/card';
import { ALL_CARDS } from './cards';
import { DeckSpec, validateDeck } from '../core/deckValidation';
import { FormatId } from '../core/formats';

/**
 * Playable System Gateway decks.
 *
 * The two starter decks are the official lists from the System Gateway box
 * (Null Signal Games product page). The seven faction decks are the
 * "System Gateway-only" lists from NSG's Getting Started sample decklists
 * (https://nullsignal.games/players/getting-started-sample-decklists/,
 * decks by Grey "CritHitD20" Tongue): 44-card Corp decks, 40-card Runner decks.
 * The `core-*` decks are the "NSG Core Sets (System Gateway + Elevation)" lists
 * from the same page, designed by Phi aka Girometics (see CORE_SETS_CREDIT).
 */

export const CORE_SETS_CREDIT =
  'The System Gateway + Elevation decks were designed by Phi aka Girometics, Game Development and Startup Curation Teams member (Null Signal Games).';

export interface DeckList {
  id: string;
  name: string;
  side: SideCode;
  /** Identity title. */
  identity: string;
  /** Card title -> copies. */
  cards: Record<string, number>;
  /** Where the list comes from: NSG starter, NSG sample, or built by the player. */
  source: 'official starter' | 'official sample' | 'custom';
  /** Who designed the list, for official samples that name a designer. */
  credit?: string;
  /** Play format the deck is built for; casual (any card) when left out. */
  format?: FormatId;
}

export const DECKS: DeckList[] = [
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
  {
    id: 'hb-precision-design',
    name: 'Discretion Advised',
    side: 'corp',
    identity: 'Haas-Bioroid: Precision Design',
    source: 'official sample',
    cards: {
      'Luminal Transubstantiation': 1, 'Offworld Office': 3, 'Send a Message': 3, 'Superconducting Hub': 1,
      'Nico Campaign': 3, 'Urtica Cipher': 3,
      'Government Subsidy': 3, 'Hedge Fund': 3, 'Predictive Planogram': 3, 'Seamless Launch': 2, 'Sprint': 2,
      'Manegarm Skunkworks': 2,
      'Brân 1.0': 2, 'Palisade': 3, 'Pharos': 1, 'Whitespace': 3, 'Ansel 1.0': 3, 'Tithe': 3,
    },
  },
  {
    id: 'jinteki-restoring-humanity',
    name: 'Advanced Yomi',
    side: 'corp',
    identity: 'Jinteki: Restoring Humanity',
    source: 'official sample',
    cards: {
      'Longevity Serum': 1, 'Offworld Office': 3, 'Orbital Superiority': 2, 'Send a Message': 2,
      'Clearinghouse': 3, 'Regolith Mining License': 3, 'Spin Doctor': 3, 'Urtica Cipher': 3,
      'Hansei Review': 3, 'Hedge Fund': 3,
      'Anoetic Void': 2,
      'Palisade': 3, 'Diviner': 3, 'Whitespace': 3, 'Ansel 1.0': 1, 'Karunā': 3, 'Tithe': 3,
    },
  },
  {
    id: 'nbn-reality-plus',
    name: 'Hyper Velocity',
    side: 'corp',
    identity: 'NBN: Reality Plus',
    source: 'official sample',
    cards: {
      'Orbital Superiority': 3, 'Send a Message': 3, 'Superconducting Hub': 1, 'Tomorrowʼs Headline': 1,
      'Spin Doctor': 3,
      'Hansei Review': 3, 'Hedge Fund': 3, 'Neurospike': 2, 'Predictive Planogram': 3, 'Public Trail': 3,
      'AMAZE Amusements': 2, 'Manegarm Skunkworks': 2,
      'Palisade': 3, 'Ping': 3, 'Funhouse': 3, 'Whitespace': 3, 'Tithe': 3,
    },
  },
  {
    id: 'weyland-built-to-last',
    name: 'Quick and Dirty',
    side: 'corp',
    identity: 'Weyland Consortium: Built to Last',
    source: 'official sample',
    cards: {
      'Above the Law': 1, 'Offworld Office': 3, 'Orbital Superiority': 2, 'Send a Message': 2,
      'Government Subsidy': 3, 'Hedge Fund': 3, 'Predictive Planogram': 3, 'Public Trail': 3, 'Retribution': 3, 'Sprint': 2,
      'Malapert Data Vault': 2,
      'Palisade': 3, 'Pharos': 3, 'Funhouse': 2, 'Whitespace': 3, 'Ballista': 3, 'Tithe': 3,
    },
  },
  {
    id: 'rene-arcemont',
    name: 'Party Hard',
    side: 'runner',
    identity: 'René “Loup” Arcemont: Party Animal',
    source: 'official sample',
    cards: {
      'Overclock': 3, 'Sure Gamble': 3, 'Wildcat Strike': 3,
      'Carnivore': 3, 'Docklands Pass': 2, 'DZMZ Optimizer': 3,
      'Cookbook': 3, 'Smartware Distributor': 3, 'Verbal Plasticity': 3,
      'Buzzsaw': 2, 'Carmen': 2, 'Cleaver': 2, 'Botulus': 3, 'Fermenter': 3, 'Leech': 2,
    },
  },
  {
    id: 'zahya-sadeghi',
    name: 'Stolen Goods',
    side: 'runner',
    identity: 'Zahya Sadeghi: Versatile Smuggler',
    source: 'official sample',
    cards: {
      'Jailbreak': 3, 'Mutual Favor': 2, 'Overclock': 3, 'Sure Gamble': 3, 'Tread Lightly': 3, 'VRcation': 3,
      'Docklands Pass': 2, 'Pennyshaver': 3, 'T400 Memory Diamond': 1,
      'Red Team': 3, 'Smartware Distributor': 3, 'Verbal Plasticity': 2,
      'Buzzsaw': 2, 'Carmen': 2, 'Marjanah': 2, 'Conduit': 1, 'Leech': 2,
    },
  },
  {
    id: 'tao-salonga',
    name: 'Planning Ahead',
    side: 'runner',
    identity: 'Tāo Salonga: Telepresence Magician',
    source: 'official sample',
    cards: {
      'Creative Commission': 3, 'Jailbreak': 3, 'Sure Gamble': 3, 'Tread Lightly': 2, 'VRcation': 3,
      'DZMZ Optimizer': 3, 'Pantograph': 2,
      'Smartware Distributor': 3, 'Telework Contract': 3, 'Verbal Plasticity': 2,
      'Cleaver': 2, 'Echelon': 2, 'Mayfly': 2, 'Unity': 2, 'Conduit': 2, 'Tranquilizer': 3,
    },
  },
  {
    id: 'core-bowel-movements',
    name: 'Bowel Movements',
    side: 'runner',
    identity: 'René “Loup” Arcemont: Party Animal',
    source: 'official sample',
    credit: CORE_SETS_CREDIT,
    cards: {
      'Maintenance Access': 2, 'Ritual': 2, 'Scrounge': 3, 'Sure Gamble': 3, 'Carnivore': 3, 'Docklands Pass': 1,
      'DZMZ Optimizer': 1, 'Cacophony': 3, 'Cookbook': 2, 'Rent Rioters': 2, 'Verbal Plasticity': 2, 'Azimat': 1,
      'Botulus': 2, 'Buzzsaw': 1, 'Fermenter': 3, 'Gourmand': 3, 'Hantu': 1, 'Leech': 2, 'Rising Tide': 3,
    },
  },
  {
    id: 'core-dashing-mad',
    name: 'Dashing Mad',
    side: 'runner',
    identity: 'Ryō “Phoenix” Ōno: Out of the Ashes',
    source: 'official sample',
    credit: CORE_SETS_CREDIT,
    cards: {
      'Charm Offensive': 2, 'Jailbreak': 3, 'Lie Low': 3, 'Overclock': 2, 'Scrounge': 2, 'Shred': 3, 'Sure Gamble': 3,
      'Detente': 2, 'Rent Rioters': 3, 'Side Hustle': 3, 'Smartware Distributor': 2, 'Verbal Plasticity': 2,
      'Botulus': 3, 'Carmen': 2, 'Fermenter': 3, 'Leech': 2, 'Rising Tide': 3, 'Unity': 2,
    },
  },
  {
    id: 'core-prick-thyself',
    name: 'Prick Thyself',
    side: 'runner',
    identity: 'Topan: Ormas Leader',
    source: 'official sample',
    credit: CORE_SETS_CREDIT,
    cards: {
      'Charm Offensive': 1, 'Illumination': 1, 'Scrounge': 3, 'Shred': 2, 'Sure Gamble': 3, 'Tread Lightly': 1,
      'VRcation': 3, 'Bling': 3, 'DZMZ Optimizer': 1, 'Rent Rioters': 3, 'Side Hustle': 3, 'Smartware Distributor': 3,
      'Verbal Plasticity': 3, 'Botulus': 3, 'Echelon': 1, 'Fermenter': 3, 'Gourmand': 2, 'Leech': 2, 'Rising Tide': 3,
      'Unity': 1,
    },
  },
  {
    id: 'core-tickets-please',
    name: 'Tickets, please',
    side: 'runner',
    identity: 'Zahya Sadeghi: Versatile Smuggler',
    source: 'official sample',
    credit: CORE_SETS_CREDIT,
    cards: {
      'Clean Getaway': 3, 'Jailbreak': 3, 'Lie Low': 3, 'Maintenance Access': 2, 'Mutual Favor': 2, 'Ritual': 1,
      'Scrounge': 1, 'Sure Gamble': 3, 'Tread Lightly': 2, 'Docklands Pass': 2, 'GAMEDRAGON™ Pro': 1,
      'Pennyshaver': 2, 'Open Market': 3, 'Side Hustle': 3, 'Carmen': 1, 'Conduit': 1, 'Leech': 2, 'Marjanah': 3,
      'Rising Tide': 1, 'Unity': 1,
    },
  },
  {
    id: 'core-shootin-n-lootin',
    name: 'Shootin’ ‘n’ Lootin’',
    side: 'runner',
    identity: 'MuslihaT: Multifarious Marketeer',
    source: 'official sample',
    credit: CORE_SETS_CREDIT,
    cards: {
      'Clean Getaway': 3, 'Jailbreak': 3, 'Maintenance Access': 2, 'Mutual Favor': 1, 'Overclock': 3, 'Ritual': 3,
      'Shred': 2, 'Sure Gamble': 3, 'Transfer of Wealth': 3, 'Tread Lightly': 2, 'Docklands Pass': 1,
      'Pennyshaver': 2, 'Open Market': 3, 'Side Hustle': 3, 'Azimat': 1, 'Echelon': 2, 'Leech': 2, 'Marjanah': 3,
      'Rising Tide': 1, 'Sang Kancil': 2,
    },
  },
  {
    id: 'core-professional-opportunities',
    name: 'Professional Opportunities',
    side: 'runner',
    identity: 'Barry “Baz” Wong: Tri-Maf Veteran',
    source: 'official sample',
    credit: CORE_SETS_CREDIT,
    cards: {
      'Clean Getaway': 3, 'Lie Low': 3, 'Mutual Favor': 2, 'Overclock': 3, 'Sure Gamble': 3, 'Docklands Pass': 1,
      'DZMZ Optimizer': 1, 'Madani': 2, 'Maglectric Rapid (748 Mod)': 3, 'Fransofia Ward': 2, 'Open Market': 3,
      'Red Team': 3, 'Side Hustle': 3, 'Carmen': 2, 'Chromatophores': 2, 'Leech': 1, 'Marjanah': 3, 'Rising Tide': 1,
      'Sang Kancil': 2, 'Tranquilizer': 2,
    },
  },
  {
    id: 'core-flow-and-ebb',
    name: 'Flow and Ebb',
    side: 'runner',
    identity: 'Tāo Salonga: Telepresence Magician',
    source: 'official sample',
    credit: CORE_SETS_CREDIT,
    cards: {
      'Creative Commission': 3, 'Jailbreak': 3, 'Mutual Favor': 1, 'Overclock': 2, 'Ritual': 3, 'Sure Gamble': 3,
      'Tread Lightly': 2, 'DZMZ Optimizer': 1, 'GAMEDRAGON™ Pro': 1, 'Pennyshaver': 2, 'Side Hustle': 3,
      'Telework Contract': 3, 'Verbal Plasticity': 2, 'Buzzsaw': 2, 'Chromatophores': 2, 'Conduit': 1, 'Echelon': 2,
      'Leech': 2, 'Principia': 2,
    },
  },
  {
    id: 'core-enthusiasm',
    name: 'Enthusiasm',
    side: 'runner',
    identity: 'Dewi Subrotoputri: Pedagogical Dhalang',
    source: 'official sample',
    credit: CORE_SETS_CREDIT,
    cards: {
      'Creative Commission': 3, 'Illumination': 2, 'Ritual': 3, 'Scrounge': 1, 'Sure Gamble': 3, 'DZMZ Optimizer': 2,
      'GAMEDRAGON™ Pro': 1, 'Madani': 2, '“Knickknack” O’Brian': 3, 'Open Market': 2, 'Red Team': 2, 'Side Hustle': 3,
      'Telework Contract': 3, 'Azimat': 1, 'Chromatophores': 2, 'Devadatta Drone': 3, 'Echelon': 1, 'Fermenter': 3,
      'Mayfly': 3, 'Principia': 1, 'Unity': 1,
    },
  },
  {
    id: 'core-sabbatical',
    name: 'Sabbatical',
    side: 'runner',
    identity: 'Magdalene Keino-Chemutai: Cryptarchitect',
    source: 'official sample',
    credit: CORE_SETS_CREDIT,
    cards: {
      'Creative Commission': 3, 'Overclock': 1, 'Ritual': 3, 'Scrounge': 2, 'Sure Gamble': 3, 'Tread Lightly': 3,
      'VRcation': 3, 'DZMZ Optimizer': 2, 'GAMEDRAGON™ Pro': 1, 'Pantograph': 2, 'Smartware Distributor': 3,
      'Telework Contract': 3, 'Verbal Plasticity': 2, 'Azimat': 1, 'Botulus': 2, 'Devadatta Drone': 3, 'Echelon': 2,
      'Fermenter': 2, 'Principia': 2, 'Unity': 2,
    },
  },
  {
    id: 'core-brutal-efficiency',
    name: 'Brutal Efficiency',
    side: 'corp',
    identity: 'Haas-Bioroid: Precision Design',
    source: 'official sample',
    credit: CORE_SETS_CREDIT,
    cards: {
      'Luminal Transubstantiation': 1, 'Offworld Office': 3, 'Project Ingatan': 2, 'Send a Message': 2,
      'Humanoid Resources': 2, 'Regolith Mining License': 2, 'Spin Doctor': 3, 'Anoetic Void': 2,
      'Mahkota Langit Grid': 2, 'Manegarm Skunkworks': 3, 'Mercia B4LL4RD': 2, 'Hedge Fund': 3,
      'Predictive Planogram': 1, 'Seamless Launch': 3, 'Ansel 1.0': 1, 'Brân 1.0': 2, 'Bumi 1.0': 3, 'Flyswatter': 2,
      'Kessleroid': 3, 'Scatter Field': 2,
    },
  },
  {
    id: 'core-agency',
    name: 'Agency',
    side: 'corp',
    identity: 'LEO Construction: Labor Solutions',
    source: 'official sample',
    credit: CORE_SETS_CREDIT,
    cards: {
      'Luminal Transubstantiation': 1, 'Offworld Office': 3, 'Project Ingatan': 3, 'Send a Message': 2,
      'Otto Campaign': 3, 'Regolith Mining License': 1, 'Spin Doctor': 3, 'Mahkota Langit Grid': 2,
      'Manegarm Skunkworks': 3, 'Mercia B4LL4RD': 3, 'Hedge Fund': 3, 'Nanomanagement': 1, 'Petty Cash': 3,
      'Seamless Launch': 1, 'Sprint': 1, 'Ansel 1.0': 2, 'Brân 1.0': 3, 'Bumi 1.0': 3, 'Flyswatter': 1,
      'Scatter Field': 1, 'Semak-samun': 3, 'Syailendra': 3,
    },
  },
  {
    id: 'core-fashion-lab',
    name: 'Fashion Lab',
    side: 'corp',
    identity: 'Poétrï Luxury Brands: All the Rage',
    source: 'official sample',
    credit: CORE_SETS_CREDIT,
    cards: {
      'Aggressive Trendsetting': 3, 'Luminal Transubstantiation': 1, 'Project Ingatan': 3, 'Send a Message': 3,
      'Anthill Excavation Contract': 3, 'Humanoid Resources': 3, 'Nico Campaign': 3, 'Otto Campaign': 3,
      'Spin Doctor': 3, 'Mahkota Langit Grid': 2, 'Manegarm Skunkworks': 1, 'Mercia B4LL4RD': 2, 'Hedge Fund': 2,
      'Nanomanagement': 2, 'Predictive Planogram': 1, 'Seamless Launch': 1, 'Top-Down Solutions': 1, 'Ansel 1.0': 1,
      'Brân 1.0': 1, 'Bumi 1.0': 3, 'Kessleroid': 3, 'Mycoweb': 1, 'Scatter Field': 3,
    },
  },
  {
    id: 'core-hidden-funds',
    name: 'Hidden Funds',
    side: 'corp',
    identity: 'Jinteki: Restoring Humanity',
    source: 'official sample',
    credit: CORE_SETS_CREDIT,
    cards: {
      'Proprionegation': 3, 'Send a Message': 2, 'Sericulture Expansion': 3, 'Regolith Mining License': 3,
      'Spin Doctor': 3, 'Anoetic Void': 2, 'Mitra Aman': 1, 'Hansei Review': 3, 'Hedge Fund': 3, 'Peer Review': 2,
      'Petty Cash': 3, 'Brân 1.0': 3, 'Doomscroll': 3, 'Empiricist': 3, 'Flyswatter': 3, 'Mycoweb': 2,
      'Semak-samun': 2,
    },
  },
  {
    id: 'core-peculiarity',
    name: 'Peculiarity',
    side: 'corp',
    identity: "PT Untaian: Life's Building Blocks",
    source: 'official sample',
    credit: CORE_SETS_CREDIT,
    cards: {
      'Longevity Serum': 1, 'Proprionegation': 3, 'Send a Message': 2, 'Sericulture Expansion': 3, 'Clearinghouse': 3,
      'Spin Doctor': 3, 'Urtica Cipher': 2, 'Anoetic Void': 2, 'Manegarm Skunkworks': 1, 'Mitra Aman': 2,
      'Hansei Review': 3, 'Hedge Fund': 2, 'Peer Review': 3, 'Petty Cash': 3, 'Empiricist': 2, 'Flyswatter': 1,
      'Karunā': 3, 'Mycoweb': 2, 'Palisade': 2, 'Semak-samun': 3, 'Whitespace': 3,
    },
  },
  {
    id: 'core-glyph-of-warding',
    name: 'Glyph of Warding',
    side: 'corp',
    identity: 'AU Co.: The Gold Standard in Clones',
    source: 'official sample',
    credit: CORE_SETS_CREDIT,
    cards: {
      'Longevity Serum': 1, 'Offworld Office': 3, 'Orbital Superiority': 3, 'Sericulture Expansion': 3, 'Byte!': 2,
      'Phật Gioan Baotixita': 3, 'Regolith Mining License': 3, 'Spin Doctor': 3, 'Anoetic Void': 2,
      'Hansei Review': 3, 'Hedge Fund': 3, 'Measured Response': 3, 'Petty Cash': 3, 'Empiricist': 2, 'Flyswatter': 1,
      'Lamplighter': 3, 'Semak-samun': 3, 'Tithe': 3, 'Whitespace': 2,
    },
  },
  {
    id: 'core-fine-print',
    name: 'Fine Print',
    side: 'corp',
    identity: 'NBN: Reality Plus',
    source: 'official sample',
    credit: CORE_SETS_CREDIT,
    cards: {
      'Embedded Reporting': 3, 'Next Big Thing': 2, 'Offworld Office': 2, 'Tomorrowʼs Headline': 1, 'Byte!': 2,
      'Idiosyncresis': 2, 'Otto Campaign': 3, 'Public Access Plaza': 3, 'Regolith Mining License': 2,
      'Spin Doctor': 3, 'AMAZE Amusements': 2, 'Mahkota Langit Grid': 2, 'Bigger Picture': 2, 'IP Enforcement': 1,
      'Predictive Planogram': 3, 'Public Trail': 2, 'Doomscroll': 3, 'Funhouse': 2, 'Ping': 3, 'Scatter Field': 1,
    },
  },
  {
    id: 'core-not-so-subtle',
    name: 'Not so subtle',
    side: 'corp',
    identity: 'Nebula Talent Management: Making Stars',
    source: 'official sample',
    credit: CORE_SETS_CREDIT,
    cards: {
      'Embedded Reporting': 3, 'Next Big Thing': 2, 'Offworld Office': 3, 'Tomorrowʼs Headline': 1, 'Plutus': 2,
      'Regolith Mining License': 1, 'Spin Doctor': 3, 'Mahkota Langit Grid': 2, 'Bigger Picture': 1, 'Hedge Fund': 3,
      'Peer Review': 3, 'Petty Cash': 3, 'Predictive Planogram': 3, 'Touch-ups': 2, 'Doomscroll': 3, 'Flyswatter': 1,
      'Lamplighter': 2, 'N-Pot': 3, 'Ping': 3, 'Semak-samun': 3, 'Tithe': 2,
    },
  },
  {
    id: 'core-gimbatul',
    name: 'Gimbatul',
    side: 'corp',
    identity: 'Synapse Global: Faster than Thought',
    source: 'official sample',
    credit: CORE_SETS_CREDIT,
    cards: {
      'Embedded Reporting': 3, 'Next Big Thing': 2, 'Orbital Superiority': 3, 'Tomorrowʼs Headline': 1,
      'Regolith Mining License': 3, 'Spin Doctor': 3, 'AMAZE Amusements': 2, 'Malapert Data Vault': 2,
      'Manegarm Skunkworks': 2, 'Bigger Picture': 1, 'Hedge Fund': 3, 'IP Enforcement': 1, 'Neurospike': 1,
      'Predictive Planogram': 3, 'Public Trail': 1, 'Touch-ups': 3, 'Doomscroll': 3, 'Funhouse': 2, 'Lamplighter': 1,
      'N-Pot': 3, 'Ping': 3, 'Tithe': 3,
    },
  },
  {
    id: 'core-brick-stack',
    name: 'Brick Stack',
    side: 'corp',
    identity: 'Weyland Consortium: Built to Last',
    source: 'official sample',
    credit: CORE_SETS_CREDIT,
    cards: {
      'Above the Law': 1, 'Off the Books': 2, 'Offworld Office': 3, 'Send a Message': 2, 'Idiosyncresis': 2,
      'Regolith Mining License': 2, 'Spin Doctor': 3, 'Anoetic Void': 1, 'Government Subsidy': 2, 'Hedge Fund': 3,
      'Key Performance Indicators': 3, 'Petty Cash': 3, 'Sprint': 1, 'Ballista': 2, 'Bumi 1.0': 3, 'Flyswatter': 2,
      'Kessleroid': 3, 'Pharos': 3, 'Syailendra': 3,
    },
  },
  {
    id: 'core-pork-chops',
    name: 'Pork Chops',
    side: 'corp',
    identity: 'BANGUN: When Disaster Strikes',
    source: 'official sample',
    credit: CORE_SETS_CREDIT,
    cards: {
      'Above the Law': 1, 'Off the Books': 3, 'Offworld Office': 3, 'Orbital Superiority': 3,
      'Anthill Excavation Contract': 3, 'Byte!': 2, 'Clearinghouse': 1, 'Regolith Mining License': 2,
      'Spin Doctor': 3, 'Mahkota Langit Grid': 2, 'Government Subsidy': 1, 'Hedge Fund': 3, 'Measured Response': 3,
      'Petty Cash': 3, 'Retribution': 1, 'Touch-ups': 1, 'Biawak': 1, 'Bumi 1.0': 2, 'Flyswatter': 1, 'Pharos': 2,
      'Semak-samun': 3, 'Syailendra': 3, 'Tithe': 2,
    },
  },
  {
    id: 'core-quick-returns',
    name: 'Quick Returns',
    side: 'corp',
    identity: 'The Zwicky Group: Invisible Hands',
    source: 'official sample',
    credit: CORE_SETS_CREDIT,
    cards: {
      'Above the Law': 1, 'Greenmail': 3, 'Off the Books': 3, 'Offworld Office': 3, 'Send a Message': 1, 'Plutus': 3,
      'Spin Doctor': 3, 'Malapert Data Vault': 2, 'Government Subsidy': 1, 'Hedge Fund': 3,
      'Key Performance Indicators': 3, 'Peer Review': 2, 'Petty Cash': 3, 'Seamless Launch': 1, 'Biawak': 2,
      'Brân 1.0': 3, 'Flyswatter': 2, 'Kessleroid': 3, 'Syailendra': 3, 'Tithe': 3,
    },
  },
];

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
