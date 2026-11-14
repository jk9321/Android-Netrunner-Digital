/**
 * Writes the state before move N of a report-format game (moves replayed from its config) as a test fixture.
 *   FIX=game.json AT=126 OUT=tests/fixtures/x.json npx vite-node scripts/fixture-at.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { GameAction, GameState, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';

const report = JSON.parse(readFileSync(process.env.FIX!, 'utf8'));
let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
if (report.startStops) s = { ...s, stops: report.startStops };
const at = Number(process.env.AT);
for (const [i, move] of (report.moves as GameAction[]).entries()) {
  if (i === at) break;
  s = executeAction(s, move);
}
writeFileSync(process.env.OUT!, JSON.stringify(s));
console.log(`move ${at}: turn ${s.turnNumber}, ${process.env.OUT}; the move: ${JSON.stringify(report.moves[at])}`);
