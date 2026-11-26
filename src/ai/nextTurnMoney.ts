import { CardInstance, GameState } from '../core';
import { counters } from '../core/engine/cardEffects';
import { CARDS, clickMoneyOf, turnIncomeOf } from './cards';

/**
 * The money a side has on its next turn (R-14h, brief runner-rework/briefs/r14h-last-credits-fix.md commit 1): moved here
 * from corp/hold.ts (the Runner's: TurnFrom, nextTurn, hosted, counterCredits, runnerEarnings) and corp/lines.ts (the
 * Corp's: knownIncome, nextClicks, nextTurnCredits), bodies unchanged, so the valuation layer can read the same owners
 * (handValues.ts, a card that arrives on a later turn) without importing corp/.
 */

/**
 * Where a turn's walk starts (Stage D item 3, F1). The Runner's next turn (`rest` false): its turn begins (5.7.1: the
 * turn-start money and counters), every click (maxClicks), its credits now. The rest of the turn under way once its run
 * is over (`rest` true): the clicks it has left, the credits it is left with (`credits`), nothing of the turn's start
 * again; a once-per-turn click ability already used this turn is counted again (toward a richer Runner).
 */
export interface TurnFrom {
  rest: boolean;
  clicks: number;
  credits: number;
}
export const nextTurn = (s: GameState): TurnFrom => ({ rest: false, clicks: Math.max(0, s.runner.maxClicks), credits: s.runner.credits });

export const hosted = (c: CardInstance) => counters(c, 'credit');

/**
 * The credits a Runner card's hosted counters pay, no click, during the Runner's turn (HoldFacts.counterCredits,
 * Coalescence: "Hosted power counter: Gain 2 credits. Use this ability only during your turn."; 9.5.1, 1.10.3a). The
 * counters as they stand: a used one is gone, so a turn's start and the rest of a turn read them alike.
 */
export const counterCredits = (c: CardInstance): number => {
  const f = CARDS[c.cardCode]?.holdFacts?.counterCredits;
  return f ? f.credits * counters(c, f.counter) : 0;
};

/**
 * What k earning clicks make on the Runner's next turn, for k = 0 .. maxClicks (runnerMoney is k = maxClicks - 1): each
 * installed card's turn-start payment (no more than it holds), then the best set of its paying click abilities within
 * the k clicks (one use each), the other clicks 1 credit each (5.2.7a). The hold walk splits the turn's clicks between
 * earning and the rest (brief 5.3) and reads this for both. From the rest of a turn (`from.rest`): k = 0 .. its clicks left,
 * with no turn-start payment or turn-start counter (paid or placed already this turn).
 */
export function runnerEarnings(s: GameState, from: TurnFrom = nextTurn(s)): number[] {
  const rig = [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources];
  let drip = 0;
  const uses: { clicks: number; credits: number }[] = [];
  for (const c of rig) {
    const pay = turnIncomeOf(c.cardCode);
    if (pay && !from.rest) drip += pay.hosted ? Math.min(pay.credits, hosted(c)) : pay.credits;
    drip += counterCredits(c);
    const m = clickMoneyOf(c.cardCode);
    if (!m) continue;
    let credits = m.credits;
    if (m.hosted === 'cap') credits = Math.min(credits, hosted(c));
    if (m.hosted === 'add') credits += hosted(c);
    if (m.perVirus) credits += m.perVirus.credits * (counters(c, 'virus') + (from.rest ? 0 : m.perVirus.turnStart));
    if (credits > m.clicks) uses.push({ clicks: m.clicks, credits });
  }
  const max = from.clicks;
  const n = Math.min(uses.length, 10);
  const out: number[] = [];
  for (let clicks = 0; clicks <= max; clicks++) {
    let best = clicks;
    for (let mask = 1; mask < 1 << n; mask++) {
      let k = 0;
      let got = 0;
      for (let i = 0; i < n; i++) if (mask & (1 << i)) {
        k += uses[i].clicks;
        got += uses[i].credits;
      }
      if (k <= clicks) best = Math.max(best, got + clicks - k);
    }
    out.push(drip + best);
  }
  return out;
}

/**
 * Credits the Corp can count on next turn: rezzed cards that pay it as its turn begins (the card entry's turnIncome;
 * a campaign pays no more than the credits it holds). The card-text match this replaced never matched ("take 3
 * credits" has no [credit] symbol in the stripped text), so it counted nothing.
 */
export function knownIncome(state: GameState): number {
  let n = 0;
  for (const c of Object.values(state.corp.servers).flatMap(v => v.root)) {
    const pay = c.isRezzed ? turnIncomeOf(c.cardCode) : undefined;
    if (pay) n += pay.hosted ? Math.min(pay.credits, counters(c, 'credit')) : pay.credits;
  }
  return n;
}

/** The clicks the Corp has on its next turn (5.2.6; bonus clicks given for it). */
export const nextClicks = (state: GameState) => state.corp.maxClicks + (state.corp.bonusClicksNextTurn ?? 0);

/**
 * A two-turn line's money on its next turn: what the Corp ends this turn on, less the rez spend that holds the server
 * through the Runner's turn, plus its known income and the next turn's clicks the line does not spend (r) as credits
 * (5.2.6a). scoreInTwo, lineHolds and reservedForAgenda read it, so their horizons cannot drift.
 */
export const nextTurnCredits = (state: GameState, end: number, rez: number, r: number) => end - rez + knownIncome(state) + (nextClicks(state) - r);
