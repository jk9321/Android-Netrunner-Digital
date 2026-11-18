#!/usr/bin/env node
/**
 * Found-list row 21's grouping (brief followup2-trash, section 2): each mutation drops one field from what the walk
 * reads of a rig card (rigReads, Walk.lossKey in src/ai/corp/hold.ts), runs the trash boards of
 * tests/holdWalkReference.test.ts against the ungrouped brute force, and reports whether they fail (they must: a field
 * the grouping can do without is not read). hold.ts is put back after each run, also on an error.
 *
 *   node scripts/stage-d/trash-mutations.mjs [name ...]      (default: every mutation; TRASH_BOARDS sets the boards)
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'src/ai/corp/hold.ts';
const MUTATIONS = {
  // The card's kind as its trash subroutines see it (RigFacts `type` and `breaker`, through `fits`)
  kind: ["type: read.kinds.map(k => (fits(r, k) ? 1 : 0)).join('')", "type: ''"],
  // The break plans it is the breaker or the counter source of
  plans: ['reads[i].push(`p:${key}:', 'void (`p:${key}:'],
  // Only as the breaker, not as the counter source
  counterSource: ['new Set([p.breaker, ...(p.counter ? [p.counter.idx] : [])])', 'new Set([p.breaker])'],
  // Botulus's host ice
  botulus: ['for (const i of ice.botulus) reads[i].push(`b:${ice.id}`);', ''],
  // A bypasser's host ice and terms
  bypassers: ['for (const b of ice.bypassers) reads[b.idx].push(`y:${ice.id}:${JSON.stringify({ ...b, idx: \'*\' })}`);', ''],
  // A granter's own group
  granters: ['for (const i of ice.granters) reads[i].push(`g:${i}`);', ''],
  // The walk state's counters on the card
  counters: ['return `${ws.virus[i]}|${ws.power[i]}|${ws.mayfly', 'return `${ws.mayfly'],
  // Mayfly's trash at the run's end
  mayfly: ['|${ws.mayfly.includes(i) ? 1 : 0}`;', '`;'],
  // What is ahead of a trash: with retries the whole target again (a run made again meets its outer ice)
  aheadRetry: ['j > at.j || this.retries ? t.ice : t.ice.slice(0, at.pos)', 'j > at.j ? t.ice : t.ice.slice(0, at.pos)'],
  // What is ahead of a trash: the later targets
  aheadLater: ['(j < at.j ? [] : j > at.j || this.retries', '(j !== at.j ? [] : this.retries'],
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MUTATIONS);
const original = readFileSync(FILE, 'utf8');
const results = [];
try {
  for (const name of names) {
    const [from, to] = MUTATIONS[name];
    if (original.split(from).length !== 2) throw new Error(`${name}: the text to mutate is not found exactly once`);
    writeFileSync(FILE, original.replace(from, to));
    let out = '';
    let failed = false;
    try {
      out = execSync('npx vitest run tests/holdWalkReference.test.ts -t "trashes an installed card" --silent=false', { encoding: 'utf8', stdio: 'pipe', env: process.env });
    } catch (e) {
      failed = true;
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
    const line = out.split('\n').find(l => l.startsWith('trash boards:')) ?? '(no summary)';
    results.push({ name, failed, line });
    console.log(`${name}: ${failed ? 'FAILS (the field is read)' : 'passes (NOT read by these boards)'}  ${line}`);
  }
} finally {
  writeFileSync(FILE, original);
}
if (results.filter(r => r.failed).length < 3) process.exitCode = 1;
