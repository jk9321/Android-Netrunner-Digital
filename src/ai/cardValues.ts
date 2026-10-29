import { CardInstance, GameState, getCardDefinition } from '../core';
import { ECON_SCALE, unrezzedWorth } from './cardProfiles';
import { corpEffect, effectsOn, runnerEffect } from './effectValues';
import { tuning } from './synergy';
import { RATES } from './valueModel';

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
  /** Cards it draws (a turn, or once): adds to keep, econ and rig worth while plan.drawValue is on. */
  draws?: number;
}

export const CARD_VALUES: Record<string, CardValue> = {
  // Corp
  '30037': { keep: 5, econ: 3.5, draws: 1 }, // Nico Campaign
  '30042': { keep: 4, upgrade: [2.5, 2] }, // Manegarm Skunkworks
  '30045': { keep: 2 }, // Urtica Cipher: a trap, worth keeping for trap decks
  '30050': { keep: 3, upgrade: [1.5, 0.8] }, // Anoetic Void
  '30053': { keep: 2, econ: 1.5, draws: 2 }, // Spin Doctor
  '30058': { keep: 2, upgrade: [1.5, 0] }, // AMAZE Amusements
  '30061': { keep: 2 }, // Clearinghouse: meat damage once advanced
  '30066': { keep: 2, upgrade: [1.5, 0] }, // Malapert Data Vault
  '30071': { keep: 6, econ: 4 }, // Regolith Mining License
  '35039': { keep: 3, econ: 2, draws: 3 }, // Humanoid Resources
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
  '36027': { keep: 1.5 }, // Synchrocyclotron: a click back on the first double each turn
  '36035': { keep: 2, upgrade: [2, 1] }, // Perfect Recall: power counters that protect a card for a run
  '36038': { keep: 1 }, // Esca: a credit and a net damage on a tagged Runner, on access
  '36045': { keep: 2, upgrade: [0, 2] }, // The Red Room: central only, ends runs elsewhere after agendas
  '36048': { keep: 3 }, // Magistrate Revontulet: 3 more to steal, and 3 off the Runner on each score
  '36049': { keep: 2 }, // Nihilo Agent: a tag each turn for 3 turns
  '36055': { keep: 1.5, upgrade: [1.5, 0] }, // Hype Machine: a free advancement counter after an agenda
  '36057': { keep: 3, econ: 2 }, // Luana Campos: 3 credits and a card for each bad publicity it hosts
  '36064': { keep: 2, upgrade: [0, 2] }, // Flagship: HQ or R&D only, 1 access and no successful runs there
  '36065': { keep: 1.5, upgrade: [1.5, 1] }, // Shackleton Grid: 4 meat damage when the Runner spends hosted credits
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
  '30034': { rig: 3.5, draws: 1 }, // Verbal Plasticity
  '35006': { rig: 3.5 }, // Bling
  '35007': { rig: 2.5, draws: 1 }, // Gourmand: trash and draw, once
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
  '35033': { rig: 2, draws: 0.5 }, // “Knickknack” O’Brian: credits and a card for spent installs
  '35034': { rig: 2.5 }, // Side Hustle
  '36003': { rig: 2 }, // The Tungsten Tailor
  '36005': { rig: 1.5 }, // Lampades: three paid trashes, with stealth credits
  '36006': { rig: 1.5 }, // Hackerspace
  '36007': { rig: 1 }, // Nurse Hạnh
  '36008': { rig: 0.5 }, // Stick and Poke
  '36013': { rig: 1 }, // Borrowed Goods: +1 MU for a tag
  '36014': { rig: 2.5 }, // Rotary
  '36015': { rig: 2 }, // Baker
  '36016': { rig: 1.5, draws: 1 }, // Underdome Irregulars
  '36020': { rig: 2.5 }, // Methuselah
  '36021': { rig: 1.5 }, // Touchstone
  '36022': { rig: 1, draws: 1 }, // Read-Write Share
  '36023': { rig: 1 }, // Sipa
  '36024': { rig: 1.5 }, // Stowaway
  '36025': { rig: 2 }, // Word on the Street
};

/** Extra worth of the cards a card draws, now that a card in hand is worth about a credit. */
const drawBonus = (code: string): number => (tuning.plan.drawValue?.[getCardDefinition(code).side_code] ? RATES.cardDrawn * (CARD_VALUES[code]?.draws ?? 0) : 0);

/** Worth of an installed Corp asset or upgrade (1 if not listed). With a game state, a card profile (step 4) prices it instead. */
export const corpKeepValue = (code: string, state?: GameState): number =>
  (state ? unrezzedWorth(state, code) ?? effect(state, code)?.keep : undefined) ?? (CARD_VALUES[code]?.keep ?? RATES.defaultKeep) + drawBonus(code);
/** A card's worth from what it does (effectValues.ts), while plan.effectValues is on. */
const effect = (state: GameState, code: string) => (effectsOn() ? corpEffect(state, code) : undefined);
/** Worth of an econ asset in its own remote (undefined: not an econ asset). */
export const econValue = (code: string, state?: GameState): number | undefined => {
  const profiled = state ? unrezzedWorth(state, code) : undefined;
  if (profiled !== undefined) return ECON_SCALE * profiled;
  const fx = state ? effect(state, code) : undefined;
  if (fx) return fx.econ === undefined ? undefined : ECON_SCALE * fx.econ;
  const econ = CARD_VALUES[code]?.econ;
  return econ === undefined ? undefined : econ + drawBonus(code);
};
/** An upgrade's worth in a scoring remote and on HQ or R&D. */
export const upgradeValue = (code: string, state?: GameState): [number, number] => {
  const fx = state ? effect(state, code)?.upgrade : undefined;
  return fx ? [ECON_SCALE * fx[0], ECON_SCALE * fx[1]] : CARD_VALUES[code]?.upgrade ?? RATES.defaultUpgrade;
};
/** Worth of an installed Runner card beyond icebreaker coverage (2 if not listed). */
export const runnerCardValue = (code: string, state?: GameState, card?: CardInstance): number => {
  // Effect formulas give credits; rig worth is on the board at RATES.rigCardScale per point
  const fx = state && effectsOn() ? runnerEffect(state, code, card) : undefined;
  return fx !== undefined ? fx / RATES.rigCardScale : (CARD_VALUES[code]?.rig ?? RATES.defaultRig) + drawBonus(code);
};
