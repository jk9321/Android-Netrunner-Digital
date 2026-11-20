/**
 * V-C item 1 build (brief stage-vc/item1-breaker-double-count/build/brief.md, Tests 2 and 4): records the Corp prompt
 * boards of deal 1601 that the count named (count-note.md, "Every changed decision", and the fallback's #395), from the
 * game the count and the batch play: a plain GameRunner from dealState(1601), Normal v Normal (as
 * scripts/stage-vc/breaker-once.ts plays its source games). Run it on beta's tree (the source game is beta's):
 *   npx vite-node scripts/stage-vc/run-term-once-fixtures.ts
 * Writes tests/fixtures/run-answers/<name>.json (the state at the Corp's prompt) for the prompts in WANT (by turn and
 * the prompt's card), and prints each board's prompt, programs, root and beta's answer.
 */
import { writeFileSync } from 'node:fs';
import { GameState, activePrompt, cardDef } from '../../src/core';
import { createAgent } from '../../src/ai';
import { GameRunner } from '../../src/ai/playout';
import { dealState } from '../stage-a/harness';

/** `<turn>:<card code>` of the Corp's prompt -> file name (the first such prompt of that turn). */
const WANT: Record<string, string> = { '6:30062': 'deal-1601-t6-30062', '7:30062': 'deal-1601-t7b-30062', '22:30065': 'deal-1601-t22-30065' };
const OUT = process.env.OUT ?? 'tests/fixtures/run-answers';

const g = new GameRunner(dealState(1601), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
const done = new Set<string>();
for (let n = 0; n < 5000 && !g.state.winner; n++) {
  const s: GameState = g.state;
  const p = activePrompt(s);
  const at = p && p.side === 'corp' && 'source' in p ? `${s.turnNumber}:${p.source.cardCode}` : null;
  const copy = at && WANT[at] && !done.has(at) ? structuredClone(s) : null;
  if (!g.step()) break;
  if (!copy || !at) continue;
  done.add(at);
  const server = copy.activeRun?.server;
  // HIDDEN-READ (measuring script): the root's cards, to name the board
  const root = server ? copy.corp.servers[server]?.root.map(c => cardDef(c).title) : [];
  console.log(`${WANT[at]}: T${copy.turnNumber} ${p && 'source' in p ? p.source.step : ''} run ${server ?? '-'} root [${root}] programs [${copy.runner.rig.programs.map(c => `${cardDef(c).title} ${c.instanceId}`)}] Corp ${copy.corp.credits} Runner ${copy.runner.credits}: ${JSON.stringify(g.last)}`);
  writeFileSync(`${OUT}/${WANT[at]}.json`, JSON.stringify(copy));
}
console.log(`deal 1601: ${g.state.winner} T${g.state.turnNumber} ${g.state.corp.score}-${g.state.runner.score}`);
