/**
 * plan.payoutRisk (Jeff, 2026-10-28): money that arrives on its own when the
 * turn begins can't be hoarded, so it keeps its full worth less the real
 * risk of losing the card. Money taken with a click keeps a small wait, so
 * the AI cashes it rather than banking it (the step 3 Smartware lesson);
 * the click it costs is counted against each payout as well.
 */
export const PAYOUT_RISK = {
  /** Taken with a click: worth this much per turn it waits. */
  clickWait: 0.93,
  /** A Corp card trashed by the Runner, per turn: in a remote with ice, and without (other per-turn effects). */
  corpIced: 0.03,
  corpBare: 0.06,
  /**
   * A money asset (CARD_PROFILES) trashed by the Runner, per Runner turn: in a remote with ice, and
   * without. Measured (scripts/lossLog.ts assetRisk, 2,210 self-play games at 5f827e6): 7.8% of 1,660
   * turns behind ice, 26.8% of 6,507 bare (the guesses were corpIced and corpBare).
   */
  moneyIced: 0.078,
  moneyBare: 0.268,
  /** A Runner resource: trashed by the Corp only while the Runner is tagged. */
  runnerTagged: 0.25,
  runnerUntagged: 0.02,
};
