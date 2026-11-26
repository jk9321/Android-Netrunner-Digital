/**
 * Issues #69 to #72 (Jeff's saved games after the Runner fixes landed). Measurement only.
 * Usage: npx vite-node scripts/runner-rework/issues-69-72.ts -- <issue> [fromTurn]
 * Replays the saved game on the current tree (engine errors, log length against the recording) and prints the
 * Runner's moves of each turn from fromTurn with the log lines each produced.
 */
import { readFileSync } from 'node:fs';
import { GameAction, GameState, createInitialGameState, executeAction, findCardAnywhere, cardDef } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';

interface Saved { config: { seed: number; corpDeck: never; runnerDeck: never }; startStops?: GameState['stops']; moves: GameAction[]; endLogLength: number }
const n = Number(process.argv[2] === '--' ? process.argv[3] : process.argv[2]);
const from = Number((process.argv[2] === '--' ? process.argv[4] : process.argv[3]) ?? 1);
const d: Saved = JSON.parse(readFileSync(new URL(`../../tests/fixtures/runner-issues/issue-${n}.json`, import.meta.url), 'utf8'));
let s = createInitialGameState(deckGameSetup(d.config.seed, d.config.corpDeck, d.config.runnerDeck));
if (d.startStops) s = { ...s, stops: d.startStops };
let errors = 0;
d.moves.forEach((m, i) => {
  const before = s;
  try { s = executeAction(s, m); } catch (e) { errors++; console.log(`  engine error at ${i}: ${(e as Error).message}`); return; }
  if (before.turnNumber < from) return;
  const id = (m as { cardInstanceId?: string }).cardInstanceId;
  const c = id ? findCardAnywhere(before, id) : undefined;
  const extra = [(m as { targetServerId?: string }).targetServerId, c ? cardDef(c).title : '', m.type === 'RESOLVE_PROMPT' ? JSON.stringify(m.choice) : ''].filter(Boolean).join(' ');
  console.log(`${i} T${before.turnNumber} ${m.player} ${m.type} ${extra} | cl ${before.runner.clicks} cr ${before.runner.credits} tags ${before.runner.tags}`);
  for (const l of s.log.slice(before.log.length)) console.log(`      ${(l as { message?: string }).message ?? JSON.stringify(l)}`);
});
console.log(`#${n}: ${d.moves.length} moves, ${errors} errors, log ${s.log.length} (recorded ${d.endLogLength}) ${errors === 0 && s.log.length === d.endLogLength ? 'OK' : 'MISMATCH'}`);
