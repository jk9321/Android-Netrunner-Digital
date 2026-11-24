/**
 * R-A A-log: writes the golden values A-move is proven against (spec r-a.md, "The golden values"). The boards and
 * readers live in facts-golden-lib.ts (split out for A-move's test, tests/runnerFacts.test.ts; output unchanged).
 *
 *   npx vite-node scripts/runner-rework/facts-golden.ts [-- out=tests/fixtures/runner-facts/golden.json]
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { L11, golden, stops } from './facts-golden-lib';

const OUT = (process.argv.slice(2).find(a => a.startsWith('out=')) ?? 'out=tests/fixtures/runner-facts/golden.json').slice(4);
// The commit the values are read at: the src tree, and the last beta commit that changed src when beta's src is this tree
// (so a later commit of docs or of this file does not change the golden file)
const git = (c: string) => execSync(`git ${c}`).toString().trim();
const SRC_TREE = git('rev-parse HEAD:src');
const BETA_SRC = git('rev-list -1 origin/beta -- src');
const BASE = { srcTree: SRC_TREE, betaCommit: git(`rev-parse ${BETA_SRC}:src`) === SRC_TREE ? BETA_SRC : null };

const doc = {
  base: BASE,
  made: 'scripts/runner-rework/facts-golden.ts',
  note: 'Golden values for R-A A-move: every reader on one built board per branch; `live` names the readers that differ from the twin (the twin rule). L11: card entries against the engine.',
  boards: golden,
  l11: L11,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n');
console.log(`${golden.length} boards, ${L11.length} L11 checks (${L11.filter(c => !c.agrees).length} disagree) -> ${OUT}`);
for (const g of golden) console.log(`${g.live.length ? 'live' : 'DEAD'} ${g.case} / ${g.branch}: ${g.live.join(', ') || g.reason}`);
for (const c of L11) console.log(`L11 ${c.agrees ? 'agrees ' : 'DIFFERS'} ${c.card} ${c.field} [${c.state}] entry ${JSON.stringify(c.entry)} engine ${JSON.stringify(c.engine)}`);
if (stops.length) {
  console.error(`STOP (twin rule): ${stops.length} board(s) whose twin does not differ:\n${stops.join('\n')}`);
  process.exit(1);
}
