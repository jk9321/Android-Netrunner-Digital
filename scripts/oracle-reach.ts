/**
 * Reach of the round 2 oracles (AI Coordinator, 2026-11-08): how often an oracle had anything to say, so the Phase 2
 * addendum can read its batch result against its reach.
 *   safestRemote: share of Corp main-phase decisions where the oracle answered for an agenda being installed, and
 *     where its 0/1 moved the honest steal odds by half or more.
 *   grip: share of Corp decisions where the honest guessed grip (threatModel runnerView, oracle off) and the real grip
 *     differ by more than one icebreaker (by card code, either way).
 * Plays the first deal (as a games=1 batch) of every stride-th pairing, max deals in all, with PLAN_OFF as given.
 *
 *   PLAN_OFF=+oracle.safestRemote npx vite-node scripts/oracle-reach.ts -- [max deals]
 */
import { GameAction, GameState, createInitialGameState, getCardDefinition } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { Agent, GameRunner, HeuristicCorpAI, HeuristicRunnerAI } from '../src/ai';
import { applyPlanOff, asSide, tuning } from '../src/ai/synergy';
import { oracleStats } from '../src/ai/oracle';
import { runnerView } from '../src/ai/threatModel';
import { stealOdds } from '../src/ai/effectValues';
import { pricing } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';

applyPlanOff(process.env.PLAN_OFF ?? '');
const maxDeals = Number(process.argv.slice(2).filter(a => a !== '--')[0] ?? 20);
oracleStats.reach = true;
// The honest number for the same server (stealOdds itself never asks the oracle)
oracleStats.honest = (s, id) => stealOdds(s, id);

const isBreaker = (code: string) => /icebreaker/i.test(getCardDefinition(code).keywords ?? '');
const breakers = (cards: { cardCode: string }[]) => cards.map(c => c.cardCode).filter(isBreaker).sort();
function breakerGap(a: string[], b: string[]): number {
  const rest = [...b];
  let gap = 0;
  for (const code of a) {
    const i = rest.indexOf(code);
    if (i === -1) gap++;
    else rest.splice(i, 1);
  }
  return gap + rest.length;
}

let decisions = 0;
let gripGaps = 0;
const seenSets: object[] = [];

class Counting implements Agent {
  readonly side = 'corp' as const;
  constructor(private inner: HeuristicCorpAI) {}
  chooseAction(state: GameState): GameAction {
    const main = !state.pendingPrompts.length && !state.activeRun && state.activePlayer === 'corp';
    if (main) {
      decisions++;
      const saved = tuning.plan.oracle.grip;
      tuning.plan.oracle.grip = false;
      try {
        const guess = asSide('corp', () => {
          decisionContext(state, 'corp');
          return runnerView(state).runner.grip;
        });
        if (breakerGap(breakers(guess), breakers(state.runner.grip)) > 1) gripGaps++;
      } finally {
        tuning.plan.oracle.grip = saved;
      }
    }
    const action = this.inner.chooseAction(state);
    if (main && pricing().known.corp) seenSets.push(pricing().known.corp!);
    return action;
  }
  chooseRez(state: GameState, cards: Parameters<NonNullable<Agent['chooseRez']>>[1]) {
    return this.inner.chooseRez(state, cards);
  }
}

const corps = ALL_DECKS.filter(d => d.side === 'corp');
const runners = ALL_DECKS.filter(d => d.side === 'runner');
// Deals spread over the pairings (every stride-th), so every Corp deck is in the sample
const stride = Math.max(1, Math.floor((corps.length * runners.length) / maxDeals));
let pairing = 0;
let played = 0;
const t0 = Date.now();
for (const c of corps) {
  for (const r of runners) {
    pairing++;
    if (played >= maxDeals || (pairing - 1) % stride !== 0) continue;
    const seed = 1000 + (pairing - 1) * 10 + 1;
    const game = new GameRunner(createInitialGameState(deckGameSetup(seed, c, r)), { corp: new Counting(new HeuristicCorpAI()), runner: new HeuristicRunnerAI() });
    for (let i = 0; i < 4000 && game.state.turnNumber <= 80 && game.step(); i++);
    played++;
  }
}
const told = seenSets.filter(s => oracleStats.told.has(s)).length;
const flipped = seenSets.filter(s => oracleStats.flipped.has(s)).length;
console.log(JSON.stringify({
  plan: process.env.PLAN_OFF ?? '',
  deals: played,
  corpMainDecisions: decisions,
  safestRemoteTold: told,
  safestRemoteFlipped: flipped,
  gripGapOver1Breaker: gripGaps,
  shares: { told: +(told / decisions).toFixed(3), flipped: +(flipped / decisions).toFixed(3), gripGap: +(gripGaps / decisions).toFixed(3) },
  oracleTurns: oracleStats.turns,
  secs: Math.round((Date.now() - t0) / 1000),
}));
