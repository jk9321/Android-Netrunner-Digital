import { CardDefinition } from '../core';

/**
 * Hand-written synergy tags for every card, used by the deck-aware nudges in
 * synergy.ts. A card "gives" a theme when it does that thing (an enabler:
 * Sure Gamble gives econ) and "wants" a theme when it pays off for it (a
 * payoff: Pennyshaver wants runs). Weights are about 1 for a typical card,
 * 2 for a card built around the theme.
 *
 * A new set needs entries here; tests/synergy.test.ts fails for any card
 * without one. Until then, inferSynergy() guesses from the card text.
 */

export const THEMES = [
  'econ', // gaining credits
  'draw', // drawing cards
  'runs', // making runs, successful runs
  'hq', // runs on HQ, accessing HQ
  'rd', // runs on R&D, accessing R&D
  'archives', // runs on Archives
  'trash', // the Runner trashing Corp cards
  'virus', // virus counters
  'discard', // filling the heap / Archives (or trashing from hand)
  'install', // extra, cheap or free installs
  'breakers', // icebreakers
  'tags', // tagging the Runner
  'damage', // net, meat and core damage
  'advance', // advancement counters
  'operations', // playing operations
  'bioroid', // bioroid cards
  'denial', // making the opponent lose or spend credits
  'ice', // installing ice
] as const;

export type Theme = (typeof THEMES)[number];
export type ThemeWeights = Partial<Record<Theme, number>>;

export interface CardSynergy {
  /** What the card does (enabler). */
  gives?: ThemeWeights;
  /** What the card rewards (payoff). */
  wants?: ThemeWeights;
}

export const SYNERGY: Record<string, CardSynergy> = {
  // ---- System Gateway: Runner ----
  '30001': { gives: { draw: 1, econ: 0.5 }, wants: { trash: 2 } }, // Loup
  '30002': { gives: { econ: 1, draw: 1 } }, // Wildcat Strike
  '30003': { gives: { trash: 2, discard: 1 }, wants: { draw: 1 } }, // Carnivore
  '30004': { gives: { virus: 1, breakers: 0.5 } }, // Botulus
  '30005': { gives: { breakers: 1 } }, // Buzzsaw
  '30006': { gives: { breakers: 1 } }, // Cleaver
  '30007': { gives: { virus: 1, econ: 1 } }, // Fermenter
  '30008': { gives: { virus: 1 }, wants: { runs: 1 } }, // Leech
  '30009': { wants: { virus: 2 } }, // Cookbook
  '30010': { gives: { econ: 0.5 }, wants: { hq: 1.5, rd: 1.5 } }, // Zahya
  '30011': { gives: { breakers: 1 }, wants: { runs: 0.5 } }, // Mutual Favor
  '30012': { gives: { runs: 1 } }, // Tread Lightly
  '30013': { wants: { hq: 2 } }, // Docklands Pass
  '30014': { gives: { econ: 1 }, wants: { runs: 2 } }, // Pennyshaver
  '30015': { gives: { breakers: 1 }, wants: { runs: 0.5 } }, // Carmen
  '30016': { gives: { breakers: 1 }, wants: { runs: 0.5 } }, // Marjanah
  '30017': { gives: { virus: 1 } }, // Tranquilizer
  '30018': { gives: { runs: 1, econ: 1, hq: 0.5, rd: 0.5, archives: 0.5 } }, // Red Team
  '30019': {}, // Tāo Salonga
  '30020': { gives: { econ: 1 } }, // Creative Commission
  '30021': { gives: { draw: 1.5 } }, // VRcation
  '30022': { gives: { install: 1 }, wants: { breakers: 0.5 } }, // DZMZ Optimizer
  '30023': { gives: { install: 0.5, econ: 0.5 }, wants: { runs: 0.5 } }, // Pantograph
  '30024': { gives: { rd: 2, runs: 1, virus: 1 }, wants: { rd: 1 } }, // Conduit
  '30025': { gives: { breakers: 1 }, wants: { breakers: 1 } }, // Echelon
  '30026': { gives: { breakers: 1 }, wants: { breakers: 1 } }, // Unity
  '30027': { gives: { econ: 1.5 } }, // Telework Contract
  '30028': { gives: { runs: 1, hq: 1, rd: 1, draw: 0.5 } }, // Jailbreak
  '30029': { gives: { runs: 1 } }, // Overclock
  '30030': { gives: { econ: 1.5 } }, // Sure Gamble
  '30031': { wants: { draw: 1 } }, // T400 Memory Diamond
  '30032': { gives: { breakers: 0.5 } }, // Mayfly
  '30033': { gives: { econ: 1 } }, // Smartware Distributor
  '30034': { gives: { draw: 1 }, wants: { draw: 1 } }, // Verbal Plasticity
  '30076': {}, // The Catalyst

  // ---- System Gateway: Corp ----
  '30035': { gives: { draw: 0.5 }, wants: { discard: 0.5 } }, // HB: Precision Design
  '30036': { gives: { advance: 0.5 } }, // Luminal Transubstantiation
  '30037': { gives: { econ: 2 } }, // Nico Campaign
  '30038': { gives: { bioroid: 1, ice: 1 } }, // Ansel 1.0
  '30039': { gives: { bioroid: 1, ice: 1 } }, // Brân 1.0
  '30040': { gives: { advance: 2 } }, // Seamless Launch
  '30041': { gives: { draw: 1.5 } }, // Sprint
  '30042': { gives: { denial: 1, ice: 0.5 } }, // Manegarm Skunkworks
  '30043': { gives: { econ: 0.5 }, wants: { discard: 1.5 } }, // Jinteki: Restoring Humanity
  '30044': { gives: { discard: 1 } }, // Longevity Serum
  '30045': { gives: { damage: 1.5 }, wants: { advance: 1 } }, // Urtica Cipher
  '30046': { gives: { ice: 1, damage: 0.5 } }, // Diviner
  '30047': { gives: { ice: 1, damage: 1 } }, // Karunā
  '30048': { gives: { econ: 2, discard: 1 } }, // Hansei Review
  '30049': { gives: { damage: 1.5 }, wants: { advance: 0.5 } }, // Neurospike
  '30050': { gives: { discard: 1, ice: 0.5 } }, // Anoetic Void
  '30051': { wants: { tags: 2 } }, // NBN: Reality Plus
  '30052': { gives: { tags: 1 } }, // Tomorrowʼs Headline
  '30053': { gives: { draw: 1 } }, // Spin Doctor
  '30054': { gives: { ice: 1, tags: 1, denial: 0.5 } }, // Funhouse
  '30055': { gives: { ice: 1, tags: 1 } }, // Ping
  '30056': { gives: { econ: 1, draw: 1 }, wants: { tags: 1 } }, // Predictive Planogram
  '30057': { gives: { tags: 1, denial: 0.5 } }, // Public Trail
  '30058': { gives: { tags: 1 } }, // AMAZE Amusements
  '30059': { wants: { advance: 2 } }, // Weyland: Built to Last
  '30060': { gives: { denial: 0.5 } }, // Above the Law
  '30061': { gives: { damage: 1 }, wants: { advance: 1 } }, // Clearinghouse
  '30062': { gives: { ice: 1 } }, // Ballista
  '30063': { gives: { ice: 1, tags: 0.5 }, wants: { advance: 0.5 } }, // Pharos
  '30064': { gives: { econ: 2 } }, // Government Subsidy
  '30065': { wants: { tags: 1.5 } }, // Retribution
  '30066': { gives: { draw: 0.5 } }, // Malapert Data Vault
  '30067': { gives: { econ: 1 } }, // Offworld Office
  '30068': { gives: { tags: 1, damage: 1 }, wants: { tags: 1 } }, // Orbital Superiority
  '30069': { gives: { ice: 0.5 } }, // Send a Message
  '30070': { gives: { draw: 1 } }, // Superconducting Hub
  '30071': { gives: { econ: 2 } }, // Regolith Mining License
  '30072': { gives: { ice: 1 } }, // Palisade
  '30073': { gives: { ice: 1, damage: 0.5, econ: 0.5 } }, // Tithe
  '30074': { gives: { ice: 1, denial: 1.5 } }, // Whitespace
  '30075': { gives: { econ: 1.5 } }, // Hedge Fund
  '30077': {}, // The Syndicate

  // ---- Elevation: Runner ----
  '35001': { gives: { denial: 0.5 }, wants: { runs: 1, hq: 0.5 } }, // Ryō "Phoenix" Ōno
  '35002': { gives: { install: 2 } }, // Topan
  '35003': { gives: { runs: 1, archives: 1, trash: 0.5 } }, // Charm Offensive
  '35004': { wants: { discard: 1.5 } }, // Scrounge
  '35005': { gives: { runs: 1, denial: 0.5 } }, // Shred
  '35006': { gives: { draw: 0.5 }, wants: { install: 2 } }, // Bling
  '35007': { gives: { trash: 1.5, draw: 0.5 } }, // Gourmand
  '35008': { gives: { breakers: 1, virus: 1 } }, // Hantu
  '35009': { gives: { breakers: 1 }, wants: { discard: 1 } }, // Rising Tide
  '35010': { gives: { denial: 1 }, wants: { trash: 2 } }, // Cacophony
  '35011': { gives: { econ: 1.5 } }, // Rent Rioters
  '35012': { gives: { install: 1.5 } }, // Baz Wong
  '35013': { gives: { draw: 1, breakers: 0.5 }, wants: { runs: 1 } }, // MuslihaT
  '35014': { gives: { runs: 1, econ: 1 } }, // Clean Getaway
  '35015': { gives: { draw: 1 } }, // Lie Low
  '35016': { gives: { runs: 1, hq: 1 } }, // Maintenance Access
  '35017': { gives: { runs: 1, hq: 1, econ: 1, denial: 1.5 } }, // Transfer of Wealth
  '35018': { wants: { hq: 1.5 } }, // Detente
  '35019': { wants: { hq: 1 } }, // Maglectric Rapid
  '35020': { gives: { breakers: 1 }, wants: { runs: 1 } }, // Sang Kancil
  '35021': { gives: { denial: 1 } }, // Fransofia Ward
  '35022': { gives: { econ: 1 } }, // Open Market
  '35023': { wants: { runs: 1.5, breakers: 0.5 } }, // Dewi Subrotoputri
  '35024': { gives: { install: 1 }, wants: { discard: 2, draw: 1 } }, // Magdalene Keino-Chemutai
  '35025': { gives: { runs: 1, rd: 1, install: 1 } }, // Illumination
  '35026': { gives: { draw: 1 } }, // Ritual
  '35027': { wants: { breakers: 1 } }, // GAMEDRAGON™ Pro
  '35028': { gives: { install: 1 }, wants: { breakers: 0.5 } }, // Madani
  '35029': { gives: { econ: 0.5 }, wants: { trash: 1 } }, // Azimat
  '35030': { gives: { breakers: 0.5 } }, // Chromatophores
  '35031': { wants: { rd: 1.5 } }, // Devadatta Drone
  '35032': { gives: { breakers: 1 }, wants: { breakers: 1 } }, // Principia
  '35033': { gives: { draw: 0.5, econ: 0.5, discard: 0.5 }, wants: { runs: 0.5 } }, // "Knickknack" O'Brian
  '35034': { gives: { econ: 0.5 }, wants: { runs: 1.5 } }, // Side Hustle

  // ---- Elevation: Corp ----
  '35035': { wants: { bioroid: 2 } }, // LEO Construction
  '35036': { gives: { install: 1 }, wants: { advance: 0.5 } }, // Poétrï Luxury Brands
  '35037': {}, // Aggressive Trendsetting
  '35038': { wants: { advance: 1, discard: 0.5 } }, // Project Ingatan
  '35039': { gives: { econ: 1, draw: 1, install: 1 } }, // Humanoid Resources
  '35040': { gives: { econ: 1.5 } }, // Otto Campaign
  '35041': { gives: { ice: 1, bioroid: 1, damage: 0.5 } }, // Bumi 1.0
  '35042': { gives: { ice: 1, install: 0.5 } }, // Scatter Field
  '35043': { gives: { advance: 1 } }, // Nanomanagement
  '35044': { gives: { draw: 1, install: 1 } }, // Top-Down Solutions
  '35045': { gives: { ice: 1, install: 0.5, bioroid: 1 } }, // Mercia B4LL4RD
  '35046': { wants: { damage: 2, discard: 1.5 } }, // AU Co.
  '35047': { gives: { advance: 1.5 } }, // PT Untaian
  '35048': {}, // Proprionegation
  '35049': { gives: { advance: 1 }, wants: { advance: 1 } }, // Sericulture Expansion
  '35050': { gives: { damage: 1.5, tags: 0.5 } }, // Byte!
  '35051': { gives: { damage: 1 } }, // Phật Gioan Baotixita
  '35052': { gives: { ice: 1, damage: 1, tags: 0.5, draw: 0.5 } }, // Empiricist
  '35053': { gives: { ice: 1 }, wants: { discard: 1 } }, // Mycoweb
  '35054': { gives: { ice: 1, damage: 1 } }, // Semak-samun
  '35055': { gives: { econ: 1.5 } }, // Peer Review
  '35056': { gives: { econ: 0.5, ice: 0.5 } }, // Mitra Aman
  '35057': { wants: { operations: 2 } }, // Nebula Talent Management
  '35058': { gives: { econ: 0.5 }, wants: { tags: 1.5 } }, // Synapse Global
  '35059': { wants: { advance: 1.5, operations: 0.5 } }, // Embedded Reporting
  '35060': { gives: { draw: 1 } }, // Next Big Thing
  '35061': { gives: { econ: 1, denial: 1.5 }, wants: { advance: 1 } }, // Idiosyncresis
  '35062': { gives: { econ: 1 } }, // Public Access Plaza
  '35063': { gives: { ice: 1, tags: 1, damage: 1 }, wants: { tags: 0.5 } }, // Doomscroll
  '35064': { gives: { ice: 1, denial: 0.5 } }, // N-Pot
  '35065': { gives: { denial: 1.5 }, wants: { tags: 1.5 } }, // Bigger Picture
  '35066': { wants: { tags: 1 } }, // IP Enforcement
  '35067': { gives: { advance: 2 } }, // Touch-ups
  '35068': { gives: { damage: 1, tags: 0.5 } }, // BANGUN
  '35069': { wants: { operations: 1.5 } }, // The Zwicky Group
  '35070': { gives: { econ: 1 } }, // Greenmail
  '35071': { gives: { install: 0.5 }, wants: { advance: 1 } }, // Off the Books
  '35072': { gives: { econ: 2, draw: 0.5 } }, // Anthill Excavation Contract
  '35073': { wants: { operations: 1.5, discard: 0.5 } }, // Plutus
  '35074': { gives: { ice: 1 } }, // Biawak
  '35075': { gives: { ice: 1 } }, // Kessleroid
  '35076': { gives: { ice: 1, advance: 1, denial: 0.5, damage: 0.5 } }, // Syailendra
  '35077': { gives: { advance: 1, econ: 0.5, ice: 0.5 } }, // Key Performance Indicators
  '35078': { gives: { damage: 1.5, denial: 0.5 } }, // Measured Response
  '35079': { gives: { ice: 1 } }, // Flyswatter
  '35080': { gives: { ice: 1, tags: 1 }, wants: { tags: 0.5 } }, // Lamplighter
  '35081': { gives: { econ: 1 } }, // Petty Cash
  '35082': { gives: { econ: 1 } }, // Mahkota Langit Grid
};

/** Text patterns for guessing a card's themes when it has no hand-written entry (a new set). */
const GIVES_PATTERNS: [RegExp, Theme][] = [
  [/gain \d+ ?(\[?credit|credits)/i, 'econ'],
  [/load \d+/i, 'econ'],
  [/draw \d+ cards?/i, 'draw'],
  [/\brun (any|hq|r&d|archives|a central)/i, 'runs'],
  [/virus counter/i, 'virus'],
  [/give the runner \d+ tag/i, 'tags'],
  [/(net|meat|core) damage/i, 'damage'],
  [/advancement counter/i, 'advance'],
  [/loses? \d+ ?(\[?credit|credits)/i, 'denial'],
  [/trash the card you are accessing|trash the non-agenda card/i, 'trash'],
];
const WANTS_PATTERNS: [RegExp, Theme][] = [
  [/whenever you make a successful run|if you made a successful run/i, 'runs'],
  [/runner is tagged|tag is removed|takes a tag/i, 'tags'],
  [/dividends/i, 'advance'],
  [/you trash a card you are accessing|steal or trash/i, 'trash'],
  [/from (your heap|archives)/i, 'discard'],
  [/play(ed)? an operation|transaction operation/i, 'operations'],
];

/** A best guess from the card's text, for cards not in SYNERGY yet. */
export function inferSynergy(def: CardDefinition): CardSynergy {
  const text = def.stripped_text ?? '';
  const gives: ThemeWeights = {};
  const wants: ThemeWeights = {};
  for (const [pattern, theme] of GIVES_PATTERNS) if (pattern.test(text)) gives[theme] = 1;
  for (const [pattern, theme] of WANTS_PATTERNS) if (pattern.test(text)) wants[theme] = 1;
  if (/icebreaker/i.test(def.keywords ?? '')) gives.breakers = 1;
  if (/bioroid/i.test(def.keywords ?? '')) gives.bioroid = 1;
  if (def.type_code === 'ice') gives.ice = 1;
  return { gives, wants };
}

/** The tags for a card: hand-written if there are any, otherwise guessed from its text. */
export function cardSynergy(def: CardDefinition): CardSynergy {
  return SYNERGY[def.code] ?? inferSynergy(def);
}
