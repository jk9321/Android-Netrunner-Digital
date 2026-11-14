/**
 * Runner decision time (ai-runner-draws stop: no more than 1.15x the base): plays the local deals (seeds 1001 + 40k,
 * Normal v Normal) and sums the Runner AI's chooseAction time. REAL_STACK=1 plays as the base did (the Runner planner
 * from its real stack: hiddenDraws in sideOff.runner). Run both ways, alone on the machine, and compare ms per decision.
 *
 *   [REAL_STACK=1] npx vite-node scripts/runner-decision-time.ts -- [deals] [first k]
 */
import { GameState, createInitialGameState } from '../src/core';
import { GameRunner } from '../src/ai/playout';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { Agent, createAgent } from '../src/ai';
import { sideOff } from '../src/ai/synergy';
import { installDiagnostics } from '../src/ai/diagnostics';

const [dealsArg, fromArg] = process.argv.slice(2).filter(a => a !== '--');
const deals = Number(dealsArg ?? 8);
const from = Number(fromArg ?? 0);
if (process.env.REAL_STACK) sideOff.runner.push('hiddenDraws');
const t = { ms: 0, decisions: 0, planned: 0, turns: 0, max: 0, gameMs: 0 };
// Runner planner decisions (a line kept from the last plan is not one)
installDiagnostics().onCandidates = side => {
  if (side === 'runner') t.planned++;
};
function timed(agent: Agent): Agent {
  const choose = agent.chooseAction.bind(agent);
  agent.chooseAction = (s: GameState) => {
    const start = performance.now();
    const a = choose(s);
    const d = performance.now() - start;
    t.ms += d;
    t.max = Math.max(t.max, d);
    t.decisions++;
    return a;
  };
  return agent;
}
const corp = ALL_DECKS.filter(d => d.side === 'corp');
const runner = ALL_DECKS.filter(d => d.side === 'runner');
for (let k = from; k < from + deals; k++) {
  const seed = 1001 + 40 * k;
  const pairing = (seed - 1001) / 10;
  const c = corp[Math.floor(pairing / runner.length) % corp.length];
  const r = runner[pairing % runner.length];
  const g0 = performance.now();
  const gr = new GameRunner(createInitialGameState(deckGameSetup(seed, c, r)), { corp: createAgent('corp'), runner: timed(createAgent('runner')) });
  for (let i = 0; i < 6000 && !gr.state.winner && gr.state.turnNumber <= 80; i++) if (!gr.step()) break;
  t.turns += gr.state.turnNumber;
  t.gameMs += performance.now() - g0;
}
console.log(JSON.stringify({ realStack: !!process.env.REAL_STACK, deals, decisions: t.decisions, planned: t.planned, turns: t.turns, msPerDecision: +(t.ms / Math.max(1, t.decisions)).toFixed(2), runnerMs: Math.round(t.ms), maxMs: Math.round(t.max), gameMs: Math.round(t.gameMs) }));
