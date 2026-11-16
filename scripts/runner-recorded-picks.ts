/**
 * Runner AI picks on recorded states (ai-runner-fixes): replays every human-games fixture and, at each state where the
 * Runner acts (a Runner prompt, or the Runner's main phase), asks a fresh Runner AI for its pick. Run on two heads and
 * diff the outputs to count the picks a branch changes, split by prompt kind (or "main"). SIDE=corp does the same for
 * the Corp (a branch that must leave the Corp's play unchanged).
 *
 *   npx vite-node scripts/runner-recorded-picks.ts -- out.jsonl [dir]
 *   node -e (diff two outputs: see the hand-off)
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GameAction, GameState, actingSide, activePrompt, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';

const [out, dirArg] = process.argv.slice(2).filter(a => a !== '--');
const dir = dirArg ?? 'tests/fixtures/human-games';
const side = (process.env.SIDE ?? 'runner') as 'corp' | 'runner';
const rows: string[] = [];
for (const file of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  const report = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  if (!report.moves?.length) continue;
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  for (const [i, move] of (report.moves as GameAction[]).entries()) {
    if (!s.winner && move.player === side && actingSide(s) === side) {
      const prompt = activePrompt(s);
      const kind = prompt?.side === side ? prompt.kind : s.activeRun ? 'run' : s.activePlayer === side ? 'main' : 'otherTurn';
      const pick = createAgent(side, 'normal').chooseAction(structuredClone(s));
      rows.push(JSON.stringify({ file, i, turn: s.turnNumber, kind, message: prompt?.message ?? '', pick }));
    }
    try {
      s = executeAction(s, move);
    } catch {
      break;
    }
  }
  console.error(`${file}: ${rows.length}`);
}
writeFileSync(out, rows.join('\n') + '\n');
