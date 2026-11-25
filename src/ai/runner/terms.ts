/**
 * R-B B2 (runner-rework briefs/b2-run.md rev 1, part 2; R0 count 2's ruling, r0/count2-rank-cost/ruling.md section 3):
 * the flat numbers of the Runner's ranking (runnerAI.ts scoreMain, rankMainActions, saveUpTarget), named so that R-C2
 * replaces named things. Each is HAND-PICKED (no source in the game state or a recorded rate) and is REPLACED IN R-C2;
 * none is a learnable setting yet and none may be adjusted for win rate (docs/ai-process.md, numbers and switches).
 * They are move scores and thresholds of the ranking, not prices of a quantity (docs/ai-priced-quantities.md, ruling 11),
 * so they are not in RATES. One key per site: the same number stands for different terms (1.2 twice, 0.3 three times),
 * and each key is read at exactly one place in src (tests/codeHealth.test.ts). Each value is the literal it replaced,
 * the same double; savingSpend is stored negative and added (x + -0.4 is x - 0.4 bit for bit, IEEE 754).
 */
const terms = {
  // Scores (added to a move's score, or the score itself)
  /** END_TURN's score (scoreMain): a flat for ending the turn. Hand-picked; replaced in R-C2. */
  endTurn: -0.5,
  /** REMOVE_TAG's score with a resource installed (scoreMain). Hand-picked; replaced in R-C2. */
  tagRemovalResource: 1.2,
  /** REMOVE_TAG's score with no resource installed (scoreMain). Hand-picked; replaced in R-C2. */
  tagRemovalNoResource: 0.3,
  /** A run card's bonus on top of the run's score and the card's spend (scoreMain, a run started from the main phase). Hand-picked; replaced in R-C2. */
  runCard: 0.3,
  /** A draw when needsBiggerHand says the grip is too small for a trap run (scoreMain). Hand-picked; replaced in R-C2. */
  bigHandDraw: 1.5,
  /** A draw while digging for breakers (scoreMain, digForBreakers). Hand-picked; replaced in R-C2. */
  digDraw: 1.2,
  /** Saving up for a run (savingFor): a move that gains credits (scoreMain). Hand-picked; replaced in R-C2. */
  savingGain: 0.8,
  /** Saving up for a run: a move that spends more than savingSpendFloor (scoreMain; stored negative and added). Hand-picked; replaced in R-C2. */
  savingSpend: -0.4,
  /** A free action (no click spent) is played only above this score (scoreMain). Hand-picked; replaced in R-C2. */
  freeActionCut: 0.3,
  // Thresholds (compared with a count of the board)
  /** Clicks left at which a big-hand draw counts with the grip at its limit (scoreMain: a trap run still to make). Hand-picked; replaced in R-C2. */
  bigHandClicks: 2,
  /** Cards the stack must hold for the dig-for-breakers draw (scoreMain). Hand-picked; replaced in R-C2. */
  digStackFloor: 5,
  /** The credit change below which a move counts as spending while saving up (scoreMain: more than 1 spent). Hand-picked; replaced in R-C2. */
  savingSpendFloor: -1,
  /** The least worth of a server to save up for (saveUpTarget). Hand-picked; replaced in R-C2. */
  saveUpWorthFloor: 4,
  /** The most credits short a server may be to save up for, about two turns of money (saveUpTarget). Hand-picked; replaced in R-C2. */
  saveUpShortfallCap: 7,
};
/** The table, frozen; typed as plain numbers, so a reader holds a number, not the literal's type. */
export const RUNNER_TERMS: Readonly<typeof terms> = Object.freeze(terms);
