/**
 * Issues #69 to #72: plays the Runner's reported turn again on the current tree. Measurement only.
 * Usage: npx vite-node scripts/runner-rework/issues-69-72-probe.ts -- <issue> <move>
 * Replays the saved game to <move> with a fresh Normal Runner that observes every board (its own memory only, rules 1.12,
 * 10.2.2a), then lets the current Normal Runner and Corp play to the end of that turn and prints the Runner's moves.
 */
import { readFileSync } from 'node:fs';
import { GameAction, GameState, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';

interface Saved { config: { seed: number; corpDeck: never; runnerDeck: never }; startStops?: GameState['stops']; moves: GameAction[] }
const args = process.argv.slice(2).filter(a => a !== '--');
const [n, at] = args.map(Number);
const d: Saved = JSON.parse(readFileSync(new URL(`../../tests/fixtures/runner-issues/issue-${n}.json`, import.meta.url), 'utf8'));
let s = createInitialGameState(deckGameSetup(d.config.seed, d.config.corpDeck, d.config.runnerDeck));
if (d.startStops) s = { ...s, stops: d.startStops };
const runner = createAgent('runner', 'normal') as Agent & { observe?: (s: GameState) => void };
for (let i = 0; i < at; i++) { runner.observe?.(s); s = executeAction(s, d.moves[i]); }
runner.observe?.(s);
const turn = s.turnNumber;
console.log(`#${n} move ${at}: T${turn} ${s.activePlayer} clicks ${s.runner.clicks} credits ${s.runner.credits} tags ${s.runner.tags}`);
const g = new GameRunner(s, { runner, corp: createAgent('corp', 'normal') });
for (let k = 0; k < 3000 && g.state.turnNumber === turn && !g.state.winner; k++) {
  const before = g.state;
  runner.observe?.(before);
  if (!g.step()) break;
  const m = g.last!;
  const id = (m as { cardInstanceId?: string }).cardInstanceId;
  const c = id ? findCardAnywhere(before, id) : undefined;
  if (m.player === 'runner' && m.type !== 'CONTINUE_RUN' && m.type !== 'PASS')
    console.log(`  runner ${m.type} ${[(m as { targetServerId?: string }).targetServerId, c ? cardDef(c).title : '', m.type === 'RESOLVE_PROMPT' ? JSON.stringify(m.choice) : ''].filter(Boolean).join(' ')} | cl ${before.runner.clicks} cr ${before.runner.credits}`);
  for (const l of g.state.log.slice(before.log.length)) {
    const msg = (l as { message?: string }).message ?? '';
    if (/run|encounter|subroutine|access|tag|damage|jack|trash|rez/i.test(msg)) console.log(`      ${msg}`);
  }
}
