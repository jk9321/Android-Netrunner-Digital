/**
 * Fire count for ai-runner-draws (plan.hiddenDraws for the Runner, Jeff 2026-11-14: "AI runner should not see its own
 * draws"; rule 10.2.2a). Plays the local deals (seeds 1001 + 40k, Normal v Normal) as on the base, the Runner's planner
 * playing from its real stack order (hiddenDraws in sideOff.runner, as before this branch). At every Runner planner
 * decision (after the game's step returns) a fresh Runner AI decides the same state twice, with the old real-stack playouts and with the new guessed
 * stack (runnerReply.ts guessRunnerView), and the two picks are compared, split by whether any candidate line drew from
 * the stack (the rest is the control: only the reseeded shuffler differs). Also the time per decision both ways.
 *
 *   npx vite-node scripts/runner-hidden-draws.ts -- [deals] [first k]
 */
import { GameAction, GameState, createInitialGameState } from '../src/core';
import { GameRunner } from '../src/ai/playout';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { applyPlanOff, sideOff } from '../src/ai/synergy';
import { installDiagnostics } from '../src/ai/diagnostics';

const [dealsArg, fromArg] = process.argv.slice(2).filter(a => a !== '--');
const deals = Number(dealsArg ?? 56);
const from = Number(fromArg ?? 0);
applyPlanOff(process.env.PLAN_OFF ?? '');
const shipped = [...sideOff.runner];
const realStack = () => (sideOff.runner = [...shipped, 'hiddenDraws']);
const guessed = () => (sideOff.runner = [...shipped]);
realStack();
const n = { decisions: 0, withDraw: 0, flips: 0, noDraw: 0, noDrawFlips: 0, msReal: 0, msGuess: 0 };
const perDeal: Record<number, { decisions: number; flips: number }> = {};
let seed = 0;
let inner = false;
const same = (a: GameAction | null, b: GameAction | null) => JSON.stringify(a) === JSON.stringify(b);
// The states are kept and decided after the game's own step returns: deciding inside the hook would run inside the
// playing decision's pricing context (frozen, its seed), not as a decision of its own.
let pending: { state: GameState; drawLines: number }[] = [];
installDiagnostics().onDraws = (state, drawLines) => {
  if (inner || state.activePlayer !== 'runner') return;
  pending.push({ state: structuredClone(state), drawLines });
};
function decide({ state, drawLines }: { state: GameState; drawLines: number }) {
  n.decisions++;
  inner = true;
  try {
    let t = performance.now();
    const real = createAgent('runner').chooseAction(structuredClone(state));
    n.msReal += performance.now() - t;
    guessed();
    t = performance.now();
    const guess = createAgent('runner').chooseAction(structuredClone(state));
    n.msGuess += performance.now() - t;
    const flip = !same(real, guess);
    const d = (perDeal[seed] ??= { decisions: 0, flips: 0 });
    d.decisions++;
    if (flip) d.flips++;
    if (drawLines) {
      n.withDraw++;
      if (flip) n.flips++;
    } else {
      n.noDraw++;
      if (flip) n.noDrawFlips++;
    }
  } finally {
    realStack();
    inner = false;
  }
}
const corp = ALL_DECKS.filter(d => d.side === 'corp');
const runner = ALL_DECKS.filter(d => d.side === 'runner');
for (let k = from; k < from + deals; k++) {
  seed = 1001 + 40 * k;
  const pairing = (seed - 1001) / 10;
  const c = corp[Math.floor(pairing / runner.length) % corp.length];
  const r = runner[pairing % runner.length];
  const gr = new GameRunner(createInitialGameState(deckGameSetup(seed, c, r)), { corp: createAgent('corp'), runner: createAgent('runner') });
  for (let i = 0; i < 6000 && !gr.state.winner && gr.state.turnNumber <= 80; i++) {
    const stepped = gr.step();
    for (const p of pending) decide(p);
    pending = [];
    if (!stepped) break;
  }
  console.error(`deal ${seed} ${c.name} v ${r.name}: ${JSON.stringify(perDeal[seed] ?? {})}`);
}
console.log(
  JSON.stringify({
    deals,
    ...n,
    drawDecisionShare: +(n.withDraw / Math.max(1, n.decisions)).toFixed(3),
    flipShare: +(n.flips / Math.max(1, n.withDraw)).toFixed(3),
    controlFlipShare: +(n.noDrawFlips / Math.max(1, n.noDraw)).toFixed(3),
    flipsPerGame: +((n.flips + n.noDrawFlips) / deals).toFixed(2),
    timeRatio: +(n.msGuess / Math.max(1, n.msReal)).toFixed(3),
  }),
);
