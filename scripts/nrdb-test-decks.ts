import type { DeckList } from '../src/data/decks';

/**
 * Test-only decks for AI diagnostics (not in the deck picker): Startup decklists
 * with Vantage Point cards published on NetrunnerDB, each crediting its author and
 * linking the list. Only official NSG decks ship in the game, so these live here.
 *   NRDB=1 npx vite-node scripts/behaviour.ts -- 2 normal
 */
export const NRDB_TEST_DECKS: DeckList[] = [
  // Startup decks with Vantage Point cards, from NetrunnerDB (NSG published no Vantage Point
  // sample decks): well-rated lists and tournament winners, imported as they were published.
  {
    id: 'vp-reflections-on-the-past',
    name: "Reflections on the Past",
    side: 'corp',
    identity: "Méliès U: Only the Brightest",
    source: 'netrunnerdb',
    credit: "By tzeentchling on NetrunnerDB: Reflections on the Past (1st at Berkeley Startup CTK) (netrunnerdb.com/en/decklist/96643)",
    format: 'startup',
    cards: { "Longevity Serum": 1, "Lotus Haze": 3, "Proprionegation": 3, "Send a Message": 2, "Regolith Mining License": 2, "Spin Doctor": 3, "Anoetic Void": 3, "Manegarm Skunkworks": 2, "Mitra Aman": 2, "Cultivate": 2, "Hansei Review": 3, "Hedge Fund": 3, "Petty Cash": 3, "Brân 1.0": 3, "Empiricist": 1, "Flyswatter": 2, "Knowledge Seeker": 2, "Lionsmane": 3, "Mycoweb": 1, "Semak-samun": 3, "Tithe": 2 },
  },
  {
    id: 'vp-totes-undefeated-leo',
    name: "Totes Undefeated Leo",
    side: 'corp',
    identity: "LEO Construction: Labor Solutions",
    source: 'netrunnerdb',
    credit: "By SkoolKnight4 on NetrunnerDB: Totes Undefeated Leo (2026 Worlds Startup 1st Place) 🥇 (netrunnerdb.com/en/decklist/99152)",
    format: 'startup',
    cards: { "Luminal Transubstantiation": 1, "Méliès City Luxury Line": 3, "Project Ingatan": 3, "Send a Message": 1, "Anthill Excavation Contract": 1, "Humanoid Resources": 3, "Regolith Mining License": 3, "Spin Doctor": 3, "Anoetic Void": 1, "Mahkota Langit Grid": 1, "Manegarm Skunkworks": 2, "The Red Room": 2, "Caveat Emptor": 2, "Hedge Fund": 3, "Nanomanagement": 2, "Petty Cash": 3, "Ansel 1.0": 2, "Ansel 2.0": 1, "Brân 1.0": 3, "Bumi 1.0": 3, "Flyswatter": 2, "Scatter Field": 1, "Sleipnir": 3 },
  },
  {
    id: 'vp-de-profundis',
    name: "De Profundis",
    side: 'corp',
    identity: "Weyland Consortium: Built to Last",
    source: 'netrunnerdb',
    credit: "By MissPlay on NetrunnerDB: [Startup] De Profundis (3-0 Worlds 2026) (netrunnerdb.com/en/decklist/98905)",
    format: 'startup',
    cards: { "Above the Law": 1, "Off the Books": 2, "Sacrifice Zone Expansion": 3, "Send a Message": 2, "Anthill Excavation Contract": 1, "Clearinghouse": 1, "Humanoid Resources": 1, "Spin Doctor": 3, "Manegarm Skunkworks": 2, "Hedge Fund": 3, "Key Performance Indicators": 2, "Measured Response": 3, "Petty Cash": 3, "Reanimation Protocol": 3, "Event Horizon": 3, "Flyswatter": 1, "Kessleroid": 2, "Pharos": 3, "Sleipnir": 2, "Tocsin": 3 },
  },
  {
    id: 'vp-zwift-deth',
    name: "Zwift Deth",
    side: 'corp',
    identity: "The Zwicky Group: Invisible Hands",
    source: 'netrunnerdb',
    credit: "By Hellnas on NetrunnerDB: Zwift Deth 1st@Uppsala CTK Startup (netrunnerdb.com/en/decklist/96080)",
    format: 'startup',
    cards: { "Above the Law": 1, "Greenmail": 3, "Sacrifice Zone Expansion": 3, "Send a Message": 3, "Anthill Excavation Contract": 3, "Clearinghouse": 2, "Spin Doctor": 3, "Mitra Aman": 2, "Hansei Review": 2, "Hedge Fund": 3, "Key Performance Indicators": 2, "Measured Response": 3, "Petty Cash": 2, "Predictive Planogram": 2, "Biawak": 2, "Brân 1.0": 2, "Event Horizon": 3, "Flyswatter": 1, "Flywheel": 2, "Pharos": 2, "Syailendra": 1, "Tocsin": 2 },
  },
  {
    id: 'vp-tempo-ed',
    name: "Tempo ED",
    side: 'corp',
    identity: "Editorial Division: Ad Nihilum",
    source: 'netrunnerdb',
    credit: "By LLBlumire on NetrunnerDB: Tempo ED (netrunnerdb.com/en/decklist/98274)",
    format: 'startup',
    cards: { "Embedded Reporting": 3, "Send a Message": 2, "Tomorrowʼs Headline": 1, "Witch Hunt": 3, "Luana Campos": 2, "Public Access Plaza": 2, "Regolith Mining License": 2, "Spin Doctor": 3, "AMAZE Amusements": 1, "Hype Machine": 3, "Mahkota Langit Grid": 1, "IP Enforcement": 3, "Predictive Planogram": 3, "Public Trail": 2, "Retribution": 1, "Touch-ups": 1, "Vulture Fund": 3, "Doomscroll": 3, "Funhouse": 2, "Grubber": 3, "Ping": 3, "Sleipnir": 2 },
  },
  {
    id: 'vp-sourdough-starter',
    name: "Sourdough Starter",
    side: 'runner',
    identity: "Hiram “0mission” Svensson: Shadow of the Past",
    source: 'netrunnerdb',
    credit: "By LLBlumire on NetrunnerDB: [Startup] Old Man is Proud of his Sourdough Starter (netrunnerdb.com/en/decklist/94187)",
    format: 'startup',
    cards: { "Aircheck": 3, "Clean Getaway": 1, "Creative Commission": 3, "Ritual": 3, "Scrounge": 2, "Sure Gamble": 3, "DZMZ Optimizer": 3, "Maglectric Rapid (748 Mod)": 3, "Methuselah": 3, "Touchstone": 3, "Telework Contract": 3, "Verbal Plasticity": 2, "“Knickknack” O’Brian": 2, "Azimat": 1, "Baker": 1, "Echelon": 2, "Principia": 3, "Read-Write Share": 3, "Rising Tide": 1, "Unity": 2 },
  },
  {
    id: 'vp-rats-and-cigarettes',
    name: "Rats & Cigarettes",
    side: 'runner',
    identity: "Ryō “Phoenix” Ōno: Out of the Ashes",
    source: 'netrunnerdb',
    credit: "By Tomathor on NetrunnerDB: Rats & Cigarettes, 1st & 6-1-1 @ NRO//TEST 2 Startup League (netrunnerdb.com/en/decklist/98209)",
    format: 'startup',
    cards: { "Chain Reaction": 3, "Charm Offensive": 2, "Creative Commission": 2, "Ritual": 3, "Scrounge": 2, "Sure Gamble": 3, "Take a Dive": 3, "Detente": 2, "The Tungsten Tailor": 1, "Rent Rioters": 2, "Stick and Poke": 3, "Verbal Plasticity": 2, "Botulus": 3, "Buzzsaw": 2, "Echelon": 1, "Fermenter": 3, "Gourmand": 3, "Leech": 2, "Rising Tide": 3 },
  },
  {
    id: 'vp-vic',
    name: "V.I.C.: Vantagepoint Is Cool",
    side: 'runner',
    identity: "Virtual Intelligence, P.I.: “You Can Call Me Vic”",
    source: 'netrunnerdb',
    credit: "By Mattchu on NetrunnerDB: V.I.C.: Vantagepoint Is Cool (netrunnerdb.com/en/decklist/95399)",
    format: 'startup',
    cards: { "Clean Getaway": 3, "Kompromat": 3, "Lie Low": 2, "Maintenance Access": 2, "Mutual Favor": 3, "Sure Gamble": 3, "Transfer of Wealth": 3, "Wildcat Strike": 2, "Borrowed Goods": 2, "Docklands Pass": 2, "Maglectric Rapid (748 Mod)": 2, "Rotary": 3, "Word on the Street": 1, "Carmen": 2, "Conduit": 1, "Leech": 2, "Marjanah": 2, "Mayfly": 2, "Sang Kancil": 1, "Stowaway": 2, "Unity": 2 },
  },
  {
    id: 'vp-negative-marketing-campaign',
    name: "Negative Marketing Campaign",
    side: 'runner',
    identity: "MuslihaT: Multifarious Marketeer",
    source: 'netrunnerdb',
    credit: "By LLBlumire on NetrunnerDB: [Startup] Negative Marketing Campaign (netrunnerdb.com/en/decklist/94203)",
    format: 'startup',
    cards: { "Clean Getaway": 3, "Jailbreak": 3, "Kompromat": 3, "Lie Low": 3, "Mutual Favor": 1, "Overclock": 3, "Sure Gamble": 3, "Tailgate": 3, "Take a Dive": 3, "Transfer of Wealth": 3, "Tread Lightly": 3, "Maglectric Rapid (748 Mod)": 3, "Underdome Irregulars": 3, "Carmen": 1, "Echelon": 1, "Marjanah": 3, "Rising Tide": 1, "Sang Kancil": 2 },
  },
  {
    id: 'vp-they-are-huge-with-it',
    name: "They Are Huge With It",
    side: 'runner',
    identity: "Topan: Ormas Leader",
    source: 'netrunnerdb',
    credit: "By LLBlumire on NetrunnerDB: [Startup] They Are Huge With It (netrunnerdb.com/en/decklist/94190)",
    format: 'startup',
    cards: { "Chain Reaction": 3, "Scrounge": 3, "Sure Gamble": 3, "Bling": 3, "DZMZ Optimizer": 3, "The Tungsten Tailor": 3, "Cookbook": 3, "Verbal Plasticity": 3, "Botulus": 3, "Buzzsaw": 3, "Echelon": 3, "Fermenter": 3, "Gourmand": 3, "Leech": 3, "Read-Write Share": 3, "Rising Tide": 3 },
  },
];
