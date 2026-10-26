/**
 * The AI's per-card numbers, by card code. Every Corp asset and upgrade and
 * every Runner program, hardware and resource that isn't an icebreaker needs
 * an entry (tests/aiCardValues.test.ts lists any that are missing), so a new
 * set's cards are valued on purpose rather than falling to a default.
 * Card behaviour the AI special-cases (Urtica, Funhouse, LEO, run
 * events...) stays with the logic that uses it.
 */
export interface CardValue {
  /** Corp asset or upgrade: its worth installed, to the Corp keeping it and the Runner trashing it. */
  keep?: number;
  /** Corp econ asset: worth installing in its own remote and rezzing for money or cards. */
  econ?: number;
  /** Corp upgrade: [worth in a scoring remote, worth on HQ or R&D]. */
  upgrade?: [number, number];
  /** Runner program, hardware or resource (not an icebreaker): its worth installed beyond icebreaker coverage. */
  rig?: number;
}

export const CARD_VALUES: Record<string, CardValue> = {
  // Corp
  '30037': { keep: 5, econ: 3.5 }, // Nico Campaign
  '30042': { keep: 4, upgrade: [2.5, 2] }, // Manegarm Skunkworks
  '30045': { keep: 2 }, // Urtica Cipher: a trap, worth keeping for trap decks
  '30050': { keep: 3, upgrade: [1.5, 0.8] }, // Anoetic Void
  '30053': { keep: 2, econ: 1.5 }, // Spin Doctor
  '30058': { keep: 2, upgrade: [1.5, 0] }, // AMAZE Amusements
  '30061': { keep: 2 }, // Clearinghouse: meat damage once advanced
  '30066': { keep: 2, upgrade: [1.5, 0] }, // Malapert Data Vault
  '30071': { keep: 6, econ: 4 }, // Regolith Mining License
  '35039': { keep: 3, econ: 2 }, // Humanoid Resources
  '35040': { keep: 4, econ: 3.5 }, // Otto Campaign
  '35045': { keep: 2, upgrade: [1, 1] }, // Mercia B4LL4RD
  '35050': { keep: 1.5 }, // Byte!: a trap, but costs 4 to fire
  '35051': { keep: 2 }, // Phật Gioan Baotixita
  '35056': { keep: 2, upgrade: [1.5, 1.2] }, // Mitra Aman
  '35061': { keep: 2.5 }, // Idiosyncresis: 3 credits for the Corp and -2 for the Runner per counter
  '35062': { keep: 3, econ: 2.5 }, // Public Access Plaza
  '35072': { keep: 5, econ: 4 }, // Anthill Excavation Contract
  '35073': { keep: 1.5 }, // Plutus: replays transactions, but costly to rez
  '35082': { keep: 3, upgrade: [2, 0.5] }, // Mahkota Langit Grid
  // Runner
  '30003': { rig: 3 }, // Carnivore
  '30004': { rig: 2 }, // Botulus
  '30007': { rig: 1 }, // Fermenter
  '30008': { rig: 2.5 }, // Leech
  '30009': { rig: 0.5 }, // Cookbook
  '30013': { rig: 2.5 }, // Docklands Pass
  '30014': { rig: 3.5 }, // Pennyshaver
  '30017': { rig: 2.5 }, // Tranquilizer
  '30018': { rig: 1 }, // Red Team
  '30022': { rig: 2.5 }, // DZMZ Optimizer
  '30023': { rig: 2.5 }, // Pantograph
  '30024': { rig: 4 }, // Conduit
  '30027': { rig: 1.5 }, // Telework Contract
  '30031': { rig: 2 }, // T400 Memory Diamond
  '30033': { rig: 2.5 }, // Smartware Distributor
  '30034': { rig: 3.5 }, // Verbal Plasticity
  '35006': { rig: 3.5 }, // Bling
  '35007': { rig: 2.5 }, // Gourmand: trash and draw, once
  '35010': { rig: 4 }, // Cacophony
  '35011': { rig: 3 }, // Rent Rioters: 9 credits waiting
  '35018': { rig: 3.5 }, // Detente
  '35019': { rig: 1.5 }, // Maglectric Rapid (748 Mod): one derez
  '35021': { rig: 2 }, // Fransofia Ward: taxes every rez
  '35022': { rig: 2.5 }, // Open Market
  '35027': { rig: 2 }, // GAMEDRAGON™ Pro: a breaker boost that lasts the run
  '35028': { rig: 2.5 }, // Madani: free program installs (hosted cards count too)
  '35029': { rig: 2.5 }, // Azimat: 2 recurring credits for trashing
  '35030': { rig: 2 }, // Chromatophores: any breaker can break its host ice
  '35031': { rig: 2.5 }, // Devadatta Drone: 2 extra R&D accesses
  '35033': { rig: 2 }, // “Knickknack” O’Brian: credits and a card for spent installs
  '35034': { rig: 2.5 }, // Side Hustle
};

/** Worth of an installed Corp asset or upgrade (1 if not listed). */
export const corpKeepValue = (code: string): number => CARD_VALUES[code]?.keep ?? 1;
/** Worth of an econ asset in its own remote (undefined: not an econ asset). */
export const econValue = (code: string): number | undefined => CARD_VALUES[code]?.econ;
/** An upgrade's worth in a scoring remote and on HQ or R&D. */
export const upgradeValue = (code: string): [number, number] => CARD_VALUES[code]?.upgrade ?? [1, 0.5];
/** Worth of an installed Runner card beyond icebreaker coverage (2 if not listed). */
export const runnerCardValue = (code: string): number => CARD_VALUES[code]?.rig ?? 2;
