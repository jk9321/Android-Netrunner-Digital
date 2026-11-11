/**
 * Planner speed P2 (coordinator 2026-11-11): does play depend on call history? Plays a deal twice, once plain and once
 * with an extra evaluate() for the deciding side at every main-phase decision (as the 'valuation not a number' alarm
 * does), and finds the first Corp/Runner action that differs. CLEAR_AT=k (with the plain run) empties the threat caches
 * just before action k, to see whether that alone gives the other run's pick.
 *   SEEDS=1001,1011 [CAP=1] npx vite-node scripts/cache-history.ts
 */
import { GameAction, GameState, actingSide, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { tuning } from '../src/ai/synergy';
import { evaluate } from '../src/ai/evaluate';
import { asSide } from '../src/ai/pricing';
import { clearThreatCaches, threatAudit } from '../src/ai/threatModel';

const t = tuning.plan as Record<string, unknown>;
t.plannerSkip = false;
t.threatHqKey = false;
t.threatCacheCap = process.env.CAP === '1';
t.threatRdKey = Number(process.env.RDKEY ?? 0);
t.threatHqKey = process.env.HQKEY === '1';

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
    console.log(JSON.stringify({ seed, winner: r.winner, checked: threatAudit.checked, mismatches: threatAudit.mismatches, orderMatters: threatAudit.orderMatters, archivesMatter: threatAudit.archivesMatter, rdMatters: threatAudit.rdMatters, paths: [...new Set(threatAudit.paths.map(x => x.replace(/inst-\d+/g, 'inst-N')))].slice(0, 12) }));
  }
  process.exit(0);
}
for (const seed of (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number)) {
  const plain = play(seed, false);
  const withEval = play(seed, true);
  const k = plain.actions.findIndex((a, i) => a !== withEval.actions[i]);
  const out: Record<string, unknown> = { seed, cap: t.threatCacheCap, actions: plain.actions.length, firstDiff: k, winners: [plain.winner, withEval.winner] };
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
