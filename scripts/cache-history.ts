/**
 * Planner speed P2 (coordinator 2026-11-11): does play depend on call history? Plays a deal twice, once plain and once
 * with an extra evaluate() for the deciding side at every main-phase decision (as the 'valuation not a number' alarm
 * does), and finds the first Corp/Runner action that differs (BISECT=1: also with the threat caches emptied just before
 * it, to see whether that alone gives the other run's pick). AUDIT=1 instead plays each deal once with the threat cache's
 * on-hit audit (threatModel.ts threatAudit) and prints its count of wrong values served (STOP=k: the first k actions).
 *   SEEDS=1001,1011 [AUDIT=1] npx vite-node scripts/cache-history.ts
 */
import { GameAction, GameState, actingSide, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { evaluate } from '../src/ai/evaluate';
import { asSide } from '../src/ai/pricing';
import { clearThreatCaches, threatAudit } from '../src/ai/threatModel';


function play(seed: number, extra: boolean, clearAt = -1): { actions: string[]; winner: string | null } {
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  const p = Math.floor((seed - 1001) / 10);
  valueLoops.clear();
  clearThreatCaches();
  const game = new GameRunner(createInitialGameState(deckGameSetup(seed, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length])), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  const actions: string[] = [];
  for (let i = 0; i < 6000; i++) {
    if (actions.length === clearAt) clearThreatCaches();
    const before: GameState = game.state;
    if (!game.step()) break;
    const a = game.last as GameAction | null;
    if (!a) continue;
    actions.push(JSON.stringify(a));
    const side = actingSide(before);
    if (extra && side && (!process.env.EXTRA_SIDE || process.env.EXTRA_SIDE === side) && a.player === side && !before.activeRun && !before.pendingPrompts.length) asSide(side, () => evaluate(before, side));
  }
  return { actions, winner: game.state.winner ?? null };
}

if (process.env.AUDIT === '1') {
  threatAudit.on = true;
  for (const seed of (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number)) {
    const r = play(seed, false, Number(process.env.STOP ?? -1));
    console.log(JSON.stringify({ seed, winner: r.winner, checked: threatAudit.checked, mismatches: threatAudit.mismatches, near: threatAudit.near, examples: threatAudit.examples }));
  }
  process.exit(0);
}
for (const seed of (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number)) {
  const plain = play(seed, false);
  const withEval = play(seed, true);
  const k = plain.actions.findIndex((a, i) => a !== withEval.actions[i]);
  const out: Record<string, unknown> = { seed, actions: plain.actions.length, firstDiff: k, winners: [plain.winner, withEval.winner] };
  if (k >= 0) {
    out.plainPick = plain.actions[k];
    out.evalPick = withEval.actions[k];
    if (process.env.BISECT === '1') {
      const cleared = play(seed, false, k);
      out.clearedThreatPick = cleared.actions[k];
      out.clearGivesEvalPick = cleared.actions[k] === withEval.actions[k];
    }
  }
  console.log(JSON.stringify(out));
}
