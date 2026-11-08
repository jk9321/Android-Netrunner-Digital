/**
 * Reach of the round 2 oracles (AI Coordinator, 2026-11-08): how often an oracle had anything to say, so the Phase 2
 * addendum can read its batch result against its reach.
 *   safestRemote: share of Corp main-phase decisions where the oracle answered for an agenda being installed, and
 *     where its 0/1 moved the honest steal odds by half or more.
 *   grip: share of Corp decisions where the honest guessed grip (threatModel runnerView, oracle off) and the real grip
 *     differ by more than one icebreaker (by card code, either way), and the share where the guess holds the wrong
 *     number of each kind (fracters, decoders, killers, run events, economy).
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
import { cardSynergy } from '../src/ai/synergyTags';

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

/**
 * Kinds of grip card (AI Coordinator 2026-11-08: split what the grip reveals): breakers by the ice type they break
 * (an AI breaker counts for all three), run events, and economy (the AI's own econ tag, as evaluate.ts isEcon).
 */
const kw = (code: string) => getCardDefinition(code).keywords ?? '';
const breaks = (type: string) => (code: string) => isBreaker(code) && (new RegExp(type, 'i').test(kw(code)) || /\bAI\b/.test(kw(code)));
const KINDS: Record<string, (code: string) => boolean> = {
  fracter: breaks('Fracter'),
  decoder: breaks('Decoder'),
  killer: breaks('Killer'),
  runEvent: code => getCardDefinition(code).type_code === 'event' && /\brun\b/i.test(getCardDefinition(code).text ?? ''),
  econ: code => (cardSynergy(getCardDefinition(code)).gives?.econ ?? 0) >= 0.5,
};
const kindGaps: Record<string, number> = {};

/** Per game: the Corp turn (1 = its first) its first HQ ice went down, or null if never (AI Coordinator's control for ORACLE_ICE hq). */
const firstHqIce: (number | null)[] = [];
let corpTurn = 0;
let lastTurn = -1;
let hqIcedAt: number | null = null;

let decisions = 0;
let gripGaps = 0;
const seenSets: object[] = [];

class Counting implements Agent {
  readonly side = 'corp' as const;
  constructor(private inner: HeuristicCorpAI) {}
  chooseAction(state: GameState): GameAction {
    const main = !state.pendingPrompts.length && !state.activeRun && state.activePlayer === 'corp';
    if (state.activePlayer === 'corp' && state.turnNumber !== lastTurn) {
      lastTurn = state.turnNumber;
      corpTurn++;
    }
    if (hqIcedAt === null && state.corp.servers.hq.ice.length > 0) hqIcedAt = corpTurn;
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
        // What the honest guess got wrong, by kind: a kind counts when the guess holds a different number of them
        for (const [kind, is] of Object.entries(KINDS)) {
          const n = (cards: { cardCode: string }[]) => cards.filter(c => is(c.cardCode)).length;
          if (n(guess) !== n(state.runner.grip)) kindGaps[kind] = (kindGaps[kind] ?? 0) + 1;
        }
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
    corpTurn = 0;
    lastTurn = -1;
    hqIcedAt = null;
    for (let i = 0; i < 4000 && game.state.turnNumber <= 80 && game.step(); i++);
    firstHqIce.push(hqIcedAt);
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
  gripKindMissed: Object.fromEntries(Object.entries(kindGaps).map(([k, n]) => [k, +(n / decisions).toFixed(3)])),
  shares: { told: +(told / decisions).toFixed(3), flipped: +(flipped / decisions).toFixed(3), gripGap: +(gripGaps / decisions).toFixed(3) },
  // hqIcedAt is read at the next Corp decision, so ice installed on Corp turn t shows as t+1 at most (or t, mid-turn)
  firstHqIce: {
    byCorpTurn3: +(firstHqIce.filter(t => t !== null && t <= 3).length / firstHqIce.length).toFixed(3),
    never: firstHqIce.filter(t => t === null).length,
    meanTurn: +(firstHqIce.filter((t): t is number => t !== null).reduce((a, b) => a + b, 0) / Math.max(1, firstHqIce.filter(t => t !== null).length)).toFixed(2),
  },
  oracleTurns: oracleStats.turns,
  secs: Math.round((Date.now() - t0) / 1000),
}));
