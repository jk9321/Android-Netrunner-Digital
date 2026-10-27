/**
 * The AI's exchange rates, in credits: what a click, a card, a credit, a
 * counter, a point, a tag and the like are worth, in one place, so every
 * part of the AI prices them the same way.
 *
 * Step 1 of the value model (plan: https://claude.ai/artifact/FRSCNV6bvpe1iExG7VmNod)
 * only gathers the numbers the board evaluation already used, so play is
 * unchanged. Later steps replace them with the curves in the plan (the
 * credit slide against a need, clicks set by the best play, points and
 * damage clocks), each behind its own tuning.plan switch.
 */
export const RATES = {
  /** A click left this turn. */
  click: 1,
  /** Extra worth of each credit while a side is short of them, up to `creditShortUntil` credits. */
  creditShortBonus: 0.6,
  creditShortUntil: 6,
  /** Each of the first `handCore` cards in hand. */
  handCore: 2,
  handCoreCards: 3,
  /** A card in hand beyond the first few, up to the limit (with plan.drawValue on, and off). */
  drawnCard: 1.6,
  drawnCardOff: 0.8,
  /** An agenda point in a score area. */
  point: 8,
  /** A tag, to the Corp and against the Runner (plus tagThreat with the deck-aware AI). */
  tagForCorp: 1.5,
  tagAgainstRunner: 3,
  /** Each point of core damage taken. */
  coreDamage: 4,
  /** Installed ice: unrezzed, and rezzed (plus a share of its rez cost). */
  ice: 1,
  rezzedIceCostShare: 0.6,
  /** Being able to break an ice type, and owning any "break any" breaker. */
  iceTypeCoverage: 8,
  anyBreaker: 2,
  /** An installed icebreaker, and the multiplier on other rig cards' CARD_VALUES worth. */
  icebreaker: 2,
  rigCardScale: 2,
  /** An advancement counter on an installed agenda, and an agenda ready to score. */
  advancement: 1.5,
  scoreableAgenda: 6,
  /** Counters, by what they do on the card (Jeff: never by counter type alone). */
  counters: {
    /** A hosted credit (Regolith, Azimat...). */
    hostedCredit: 0.6,
    /** Smartware Distributor's hosted credits: they pay out 1 a turn. */
    smartwareCredit: 0.25,
    /** A virus counter, and one on Fermenter (2 credits each when it is trashed). */
    virus: 0.7,
    fermenterVirus: 1.5,
    /** Dividends and Next Big Thing agenda counters in the score area. */
    scoredAgenda: 1.5,
    /** AU Co. power counters on the identity. */
    identityPower: 0.8,
  },
  /** A card hosted to play later (Bling, Madani). */
  hostedCard: 0.8,
  /** Each card a card draws, added to its CARD_VALUES worth while plan.drawValue is on. */
  cardDrawn: 0.5,
  /** Cards with no CARD_VALUES entry: Corp asset or upgrade, upgrade [scoring remote, HQ or R&D], Runner rig card. */
  defaultKeep: 1,
  defaultUpgrade: [1, 0.5] as [number, number],
  defaultRig: 2,
} as const;

/** Credits are worth more while a side is short of them. */
export function creditValue(credits: number): number {
  return credits + RATES.creditShortBonus * Math.min(Math.max(credits, 0), RATES.creditShortUntil);
}
