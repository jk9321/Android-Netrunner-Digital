#!/usr/bin/env node
/**
 * R-B B2 bar 3 (brief netrunner-ai/runner-rework/briefs/b2-run.md rev 1, part 1; B1 red team 2026-11-24 finding 6 b):
 * the move of the decision during a run is a move. Takes runAction, encounterAction and approachClickReserve, each with
 * the comment lines just above it, from the BASE commit's src/ai/runnerAI.ts, applies the rename map and nothing else,
 * and diffs the result against the same three bodies in this checkout's src/ai/runner/run.ts. The bar is 0 lines.
 *
 * The map (the only text that may change):
 *   `private runAction(`        -> `export function runAction(`
 *   `private encounterAction(`  -> `function encounterAction(`
 *   `this.encounterAction(`     -> `encounterAction(`
 *   `export function approachClickReserve(` stays
 *   the two class methods lose two spaces of indentation (approachClickReserve is top level already)
 *   (the import lines are not part of any body: printed apart, for the hand-off)
 *
 *   node scripts/runner-rework/core-move-check.mjs                  check (exit 1 on any line)
 *   node scripts/runner-rework/core-move-check.mjs --print          the map applied to the base, as run.ts must hold it
 *   node scripts/runner-rework/core-move-check.mjs --base <sha>     another base (default beta 57b02d6)
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const at = args.indexOf('--base');
const BASE = at >= 0 ? args[at + 1] : '57b02d6fe816fdeaf778954f2f09539e50c105a7';
const PRINT = args.includes('--print');

const comment = l => /^\s*(\/\*\*|\*|\/\/)/.test(l);
/** The lines of the declaration that starts at the line matching `start`, with the comment lines just above it, to `end`. */
function segment(lines, start, end, what) {
  const i = lines.findIndex(l => start.test(l));
  if (i < 0 || lines.slice(i + 1).some(l => start.test(l))) throw new Error(`${what}: not found exactly once`);
  let from = i;
  while (from > 0 && comment(lines[from - 1])) from--;
  const to = lines.findIndex((l, k) => k > i && end.test(l));
  if (to < 0) throw new Error(`${what}: no end`);
  return lines.slice(from, to + 1);
}
const dedent = l => (l.startsWith('  ') ? l.slice(2) : l === '' ? l : (() => { throw new Error(`a method line with less than two spaces: ${l}`); })());

const base = execSync(`git show ${BASE}:src/ai/runnerAI.ts`, { encoding: 'utf8' }).split('\n');
/** The map, the same on every line of the three bodies. */
const map = l => l.replace('private runAction(', 'export function runAction(').replace('private encounterAction(', 'function encounterAction(').replaceAll('this.encounterAction(', 'encounterAction(');
const mapped = [
  segment(base, /^  private runAction\(/, /^  }$/, 'base runAction').map(l => dedent(map(l))),
  segment(base, /^  private encounterAction\(/, /^  }$/, 'base encounterAction').map(l => dedent(map(l))),
  segment(base, /^export function approachClickReserve\(/, /^}$/, 'base approachClickReserve').map(map),
];
// The bodies read no field of the agent: any `this.` left after the map would be one
const left = mapped.flat().filter(l => /\bthis\./.test(l));
if (left.length) throw new Error(`a body reads the agent: ${left.join(' | ')}`);

if (PRINT) {
  console.log(mapped.map(s => s.join('\n')).join('\n\n'));
  process.exit(0);
}

const runFile = 'src/ai/runner/run.ts';
if (!existsSync(runFile)) throw new Error(`${runFile}: not in this checkout`);
const run = readFileSync(runFile, 'utf8').split('\n');
const moved = [
  segment(run, /^export function runAction\(/, /^}$/, 'run.ts runAction'),
  segment(run, /^function encounterAction\(/, /^}$/, 'run.ts encounterAction'),
  segment(run, /^export function approachClickReserve\(/, /^}$/, 'run.ts approachClickReserve'),
];
const dir = mkdtempSync(join(tmpdir(), 'move-check-'));
let lines = 0;
const names = ['runAction', 'encounterAction', 'approachClickReserve'];
try {
  for (const [k, name] of names.entries()) {
    writeFileSync(join(dir, 'a'), mapped[k].join('\n') + '\n');
    writeFileSync(join(dir, 'b'), moved[k].join('\n') + '\n');
    let out = '';
    try {
      execSync(`git diff --no-index --no-color -U0 ${join(dir, 'a')} ${join(dir, 'b')}`, { encoding: 'utf8' });
    } catch (e) {
      out = e.stdout ?? '';
    }
    const changed = out.split('\n').filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));
    lines += changed.length;
    console.log(`${name}: ${mapped[k].length} base lines (map applied), ${moved[k].length} in run.ts, ${changed.length} lines differ`);
    for (const l of changed) console.log(`  ${l}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
// Moved, not copied: runnerAI.ts keeps none of the three
const agent = readFileSync('src/ai/runnerAI.ts', 'utf8');
const kept = names.filter(n => new RegExp(`\\b${n}\\(`).test(agent));
console.log(`runnerAI.ts still names: ${kept.length ? kept.join(', ') : 'none of the three'}`);
console.log('run.ts imports:');
for (const l of run.filter(l => /^import /.test(l))) console.log(`  ${l}`);
console.log(`move check: ${lines} lines`);
process.exit(lines === 0 && kept.length === 0 ? 0 : 1);
