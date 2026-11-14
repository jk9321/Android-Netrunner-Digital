/**
 * Spec-search S6 measurement (plan.hiddenDraws): plays self-play games with the switch OFF (the planner's playouts draw
 * the real top of R&D) and, at every Corp planner decision, counts the candidate lines that drew from R&D; every
 * decision is decided again with the switch ON (a fresh Corp AI, R&D guessed) and the
 * two picks compared (decisions with no drawing line are the control).
 *
 *   npx vite-node scripts/hidden-draws.ts -- [games] [first seed]
 */
import { GameAction, createInitialGameState } from '../src/core';
import { GameRunner } from '../src/ai/playout';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { applyPlanOff, tuning } from '../src/ai/synergy';
import { installDiagnostics } from '../src/ai/diagnostics';

const [gamesArg, seedArg] = process.argv.slice(2).filter(a => a !== '--');
const games = Number(gamesArg ?? 4);
applyPlanOff(process.env.PLAN_OFF ?? '');
tuning.plan.hiddenDraws = false;
const n = { decisions: 0, withDraw: 0, drawLines: 0, lines: 0, flips: 0, compared: 0, noDrawFlips: 0, noDrawCompared: 0 };
let inner = false;
const same = (a: GameAction | null, b: GameAction | null) => JSON.stringify(a) === JSON.stringify(b);
installDiagnostics().onDraws = (state, drawLines, lines, pick) => {
  if (inner) return;
  n.decisions++;
  n.lines += lines;
  n.drawLines += drawLines;
  if (drawLines) n.withDraw++;
  inner = true;
  tuning.plan.hiddenDraws = true;
  try {
    const other = createAgent('corp').chooseAction(structuredClone(state));
    // decisions with no drawing line: the control (only the rest of the guess, the grip and the rng, differs)
    if (drawLines) {
      n.compared++;
      if (!same(other, pick)) n.flips++;
    } else {
      n.noDrawCompared++;
      if (!same(other, pick)) n.noDrawFlips++;
    }
  } finally {
    tuning.plan.hiddenDraws = false;
    inner = false;
  }
};
const corp = ALL_DECKS.filter(d => d.side === 'corp');
const runner = ALL_DECKS.filter(d => d.side === 'runner');
for (let g = 0; g < games; g++) {
  const seed = Number(seedArg ?? 1001) + 10 * g;
  const pairing = (seed - 1001) / 10;
  const c = corp[Math.floor(pairing / runner.length) % corp.length];
  const r = runner[pairing % runner.length];
  const gr = new GameRunner(createInitialGameState(deckGameSetup(seed, c, r)), { corp: createAgent('corp'), runner: createAgent('runner') });
  for (let i = 0; i < 6000 && !gr.state.winner && gr.state.turnNumber <= 80; i++) if (!gr.step()) break;
}
console.log(JSON.stringify({ games, ...n, drawDecisionShare: +(n.withDraw / Math.max(1, n.decisions)).toFixed(3), flipShare: +(n.flips / Math.max(1, n.compared)).toFixed(3), controlFlipShare: +(n.noDrawFlips / Math.max(1, n.noDrawCompared)).toFixed(3) }));
