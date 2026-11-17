// A fresh Normal agent's decision time on named recorded decisions of the human games (fire count numbering: the first
// Corp decision at or after index i), caches cleared before each, REPS repetitions (medians). TREE labels the line.
//   PICKS="report-28:288,report-36:130" REPS=3 TREE=branch npx vite-node scripts/stage-d/time-decision.ts
import { readFileSync } from 'node:fs';
import { GameAction, GameState, actingSide, createInitialGameState, executeAction } from '../../src/core';
import { createAgent } from '../../src/ai';
import { deckGameSetup } from '../../src/data/decks';
import { clearCaches } from '../stage-a/harness';
import { clearBuildTargets, valueLoops } from '../../src/ai/valueModel';
import { clearDeckShares } from '../../src/ai/iceValues';

const picks = (process.env.PICKS ?? '').split(',').filter(Boolean).map(p => {
  const [file, i] = p.split(':');
  return { file, i: Number(i) };
});
const reps = Number(process.env.REPS ?? 3);

function stateAt(file: string, want: number): GameState | null {
  const report = JSON.parse(readFileSync(`tests/fixtures/human-games/${file}.json`, 'utf8'));
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  let i = 0;
  for (const move of report.moves as GameAction[]) {
    if (actingSide(s) === move.player && !(s.priority && s.priority.holder === 'corp' && s.activePlayer === 'runner')) {
      if (i >= want && actingSide(s) === 'corp') return s;
      i++;
    }
    s = executeAction(s, move);
  }
  return null;
}

const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
for (const { file, i } of picks) {
  const s = stateAt(file, i);
  if (!s) {
    console.log(JSON.stringify({ file, i, error: 'not found' }));
    continue;
  }
  const ms: number[] = [];
  let pick = '';
  for (let r = 0; r < reps; r++) {
    clearCaches();
    clearBuildTargets();
    clearDeckShares();
    valueLoops?.clear();
    const t = performance.now();
    pick = JSON.stringify(createAgent('corp', 'normal').chooseAction(structuredClone(s))).slice(0, 80);
    ms.push(performance.now() - t);
  }
  console.log(JSON.stringify({ tree: process.env.TREE, file, i, T: s.turnNumber, ms: Math.round(med(ms)), all: ms.map(Math.round), pick }));
}
