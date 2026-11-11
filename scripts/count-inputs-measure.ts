/**
 * Count inputs F1 measurements (spec-count-inputs.md): over a set of deals (Normal v Normal), how many two-turn lines
 * the money floor after a line (countedScore.ts afterLineFloor) refuses, the Corp's credits at the two turn starts after each line begins, and how often a score
 * (scoreNow's or a line's) leaves the Corp under the same floor. (Measured with the temporary switches afterLine and runnerMoney, since deleted.)
 *
 *   DEALS=1001,1011 npx vite-node scripts/count-inputs-measure.ts
 */
import { GameState, cardDef, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { afterLineFloor, knownIncome, resetScoreInTwoStats, scoreInTwoStats } from '../src/ai/countedScore';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff } from '../src/ai/synergy';

applyPlanOff(process.env.PLAN_OFF ?? '');
const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const deals = (process.env.DEALS ?? '').split(',').filter(Boolean).map(Number);
const out = { games: 0, corpWins: 0, begun: 0, floorRefused: 0, unholdable: 0, after1: [] as number[], after2: [] as number[], scores: 0, underFloor: 0, lineScores: 0, lineUnder: 0, ms: [] as number[] };
for (const seed of deals) {
  const p = Math.floor((seed - 1001) / 10);
  const c = corpDecks[Math.floor(p / runnerDecks.length)];
  const r = runnerDecks[p % runnerDecks.length];
  valueLoops.clear();
  resetScoreInTwoStats();
  const corp = createAgent('corp', 'normal');
  // Timed in place (the agent is a class instance: its other methods, chooseRez among them, stay)
  const choose = corp.chooseAction.bind(corp);
  corp.chooseAction = (s: GameState) => {
    const t = performance.now();
    const a = choose(s);
    out.ms.push(performance.now() - t);
    return a;
  };
  const runner = new GameRunner(createInitialGameState(deckGameSetup(seed, c, r)), { corp, runner: createAgent('runner', 'normal') });
  const starts = new Map<number, number>();
  let lastTurn = -1;
  for (let i = 0; i < 6000; i++) {
    const s = runner.state;
    if (s.activePlayer === 'corp' && s.turnNumber !== lastTurn) {
      lastTurn = s.turnNumber;
      starts.set(s.turnNumber, s.corp.credits);
    }
    const finished = scoreInTwoStats.finished;
    if (!runner.step()) break;
    const after = runner.state;
    if (after.corp.scoreArea.length > s.corp.scoreArea.length && !after.winner) {
      const under = after.corp.credits + knownIncome(after) < afterLineFloor(after, '');
      out.scores++;
      if (under) out.underFloor++;
      if (scoreInTwoStats.finished > finished) {
        out.lineScores++;
        if (under) out.lineUnder++;
      }
    }
  }
  out.games++;
  if (runner.state.winner === 'corp') out.corpWins++;
  out.begun += scoreInTwoStats.begun;
  out.floorRefused += scoreInTwoStats.floorRefused;
  out.unholdable += scoreInTwoStats.unholdable;
  // A turn number is a round (turn.ts): the line's turn T, then T+1 and T+2 start the Corp's next two turns
  for (const l of scoreInTwoStats.lines) {
    const a = starts.get(l.turn + 1);
    const b = starts.get(l.turn + 2);
    if (a !== undefined) out.after1.push(a);
    if (b !== undefined) out.after2.push(b);
  }
  void cardDef;
}
const mean = (v: number[]) => (v.length ? +(v.reduce((x, y) => x + y, 0) / v.length).toFixed(2) : NaN);
const sorted = [...out.ms].sort((x, y) => x - y);
console.log(JSON.stringify({
  plan_off: process.env.PLAN_OFF ?? '', games: out.games, corpWins: out.corpWins, linesBegun: out.begun, floorRefusedTries: out.floorRefused,
  creditsNextTurnStart: mean(out.after1), creditsSecondTurnStart: mean(out.after2), under3Next: out.after1.filter(x => x < 3).length, n1: out.after1.length,
  scores: out.scores, scoresUnderFloor: out.underFloor, lineScores: out.lineScores, lineScoresUnderFloor: out.lineUnder,
  decisions: sorted.length, meanMs: mean(sorted), p95Ms: +(sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1),
}));
