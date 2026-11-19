/**
 * Stage D item 7, the test's fixtures (brief: /mnt/project-files/netrunner-ai/stage-d/item7-agenda-discard/test-brief.md):
 * plays the g1 base deals that hold an inverted discard board (the count's found 1: a non-agenda priced above an agenda;
 * outputs/rows-44428011462.jsonl) by a plain GameRunner, Normal v Normal as the batch, and writes the state at each
 * listed Corp discard prompt to tests/fixtures/agenda-discard/deal-<seed>-t<turn>.json. The log is emptied (it is
 * display text, read by no rule) to keep the files small. Every game is checked against the g1 record (winner, cr, sc).
 *   npx vite-node scripts/stage-d/agenda-discard-fixtures.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { activePrompt, type GameState } from '../../src/core';
import { createAgent } from '../../src/ai';
import { GameRunner } from '../../src/ai/playout';
import { dealState } from '../stage-a/harness';

const ONLY = (process.env.DEALS ?? '').split(',').filter(Boolean).map(Number);
const BOARDS0: [number, number][] = [
  [1141, 21], [1241, 11], [1241, 12], [1431, 6], [2521, 16], [2371, 6], [2441, 3], [1671, 12],
  [1371, 17], [2331, 10], [1071, 3], [2351, 19], [2351, 20], [1421, 10], [2511, 2],
];
const BOARDS = BOARDS0.filter(b => !ONLY.length || ONLY.includes(b[0]));
const record: { seed: number; winner: string | null; cr: number[]; sc: number[] }[] = JSON.parse(readFileSync('scripts/stage-d/agenda-discard-deals.json', 'utf8'));
const dir = 'tests/fixtures/agenda-discard';
mkdirSync(dir, { recursive: true });
let total = 0;
for (const seed of [...new Set(BOARDS.map(b => b[0]))]) {
  const turns = BOARDS.filter(b => b[0] === seed).map(b => b[1]);
  const g = new GameRunner(dealState(seed), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  const saved: number[] = [];
  for (let n = 0; n < 4000; n++) {
    const s: GameState = g.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    const p = activePrompt(s);
    if (p?.kind === 'discard' && p.side === 'corp' && turns.includes(s.turnNumber) && !saved.includes(s.turnNumber)) {
      const text = JSON.stringify({ ...structuredClone(s), log: [] });
      writeFileSync(`${dir}/deal-${seed}-t${s.turnNumber}.json`, text + '\n');
      saved.push(s.turnNumber);
      total += text.length;
    }
    if (!g.step()) break;
  }
  const rec = record.find(r => r.seed === seed)!;
  const same = (g.state.winner ?? null) === rec.winner && JSON.stringify(cr) === JSON.stringify(rec.cr) && JSON.stringify(sc) === JSON.stringify(rec.sc);
  console.log(JSON.stringify({ seed, saved, matchesBatch: same }));
  if (!same || saved.length !== turns.length) throw new Error(`deal ${seed}: matches ${same}, saved ${saved} of ${turns}`);
}
console.log(`total ${Math.round(total / 1024)} KB`);
