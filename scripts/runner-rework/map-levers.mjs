/**
 * R0 count 1, part B (brief /mnt/project-files/netrunner-ai/runner-rework/r0/count1-audit-map/brief.md): the Runner AI's
 * levers, listed by name from the source text. Read-only; prints JSON lines (one per lever) and a summary.
 *
 *   node scripts/runner-rework/map-levers.mjs > levers.jsonl
 *
 * Kinds:
 *  - number: a numeric literal other than 0 and 1 (and other than an index or a rule number in a comment) in code;
 *  - card: a card code ('3xxxx') named in the Runner's code (a card-number case), or a constant holding one;
 *  - switch: a `plan().<name>` or `tuning.<name>` read, or `searchPiece('<name>')`;
 *  - nudge: synergy.ts nudge rules (one per tag rule) reached by the Runner (`side === 'runner'` blocks).
 * Scope: the files and line ranges that are the Runner's (SCOPE below). prompts.ts is read only inside blocks that test
 * `side === 'runner'` or `side !== 'corp'` (and the shared fallback), runs.ts whole (it is the Runner's run model; the
 * Corp's readers are listed in the note), runnerAI.ts and runnerReply.ts whole, search.ts whole (the Hard Runner's half
 * is marked by line), handValues.ts and synergy.ts where a line names the Runner.
 * Each lever carries the enclosing function (the nearest `function name`, `name(` method or `const name =` above it).
 */
import { readFileSync } from 'node:fs';

const SCOPE = [
  { file: 'src/ai/runnerAI.ts', all: true },
  { file: 'src/ai/runs.ts', all: true },
  { file: 'src/ai/runnerReply.ts', all: true },
  { file: 'src/ai/search.ts', all: true },
  { file: 'src/ai/prompts.ts', runnerBlocks: true },
  { file: 'src/ai/synergy.ts', runnerLines: true },
  { file: 'src/ai/handValues.ts', runnerLines: true },
  { file: 'src/ai/iceValues.ts', all: true },
  { file: 'src/ai/turnPlanner.ts', runnerLines: true },
];

const fnRe = /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)|^\s*(?:export\s+)?const\s+(\w+)\s*=|^\s{2}(?:private\s+|readonly\s+|static\s+)*(\w+)\s*\([^)]*\)\s*(?::\s*[^={]+)?\{\s*$/;

function enclosing(lines, i) {
  for (let j = i; j >= 0; j--) {
    const m = lines[j].match(fnRe);
    if (m) return m[1] ?? m[2] ?? m[3];
  }
  return '?';
}

/** Lines inside `if (... side === 'runner' ...) {` blocks (brace-matched), plus lines that mention side 'runner'. */
function runnerBlockLines(lines) {
  const keep = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (!/side === 'runner'|side !== 'corp'|'runner'\)/.test(lines[i])) continue;
    keep.add(i);
    if (!/\{\s*$/.test(lines[i])) continue;
    let depth = 0;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j].replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '')) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
      }
      keep.add(j);
      if (depth <= 0 && j > i) break;
    }
  }
  return keep;
}

const out = [];
for (const s of SCOPE) {
  const text = readFileSync(s.file, 'utf8');
  const lines = text.split('\n');
  const keep = s.runnerBlocks ? runnerBlockLines(lines) : null;
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('/*')) inComment = true;
    if (inComment) {
      if (trimmed.includes('*/')) inComment = false;
      continue;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    if (s.runnerBlocks && !keep.has(i)) continue;
    if (s.runnerLines && !/runner/i.test(line)) continue;
    line = line.replace(/\/\/.*$/, '');
    const fn = enclosing(lines, i);
    const at = `${s.file}:${i + 1}`;
    // card codes
    for (const m of line.matchAll(/'(3\d{4})'/g)) out.push({ kind: 'card', at, fn, code: m[1], text: trimmed.slice(0, 160) });
    // switches
    for (const m of line.matchAll(/plan\(\)\.(\w+)|tuning\.(\w+)|searchPiece\('(\w+)'\)/g)) out.push({ kind: 'switch', at, fn, name: m[1] ?? m[2] ?? m[3], text: trimmed.slice(0, 160) });
    // numbers (strings and regexes stripped)
    const code = line.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''").replace(/\/(?:\\.|[^/\n])+\/[gimsuy]*/g, '//');
    for (const m of code.matchAll(/(?<![\w.$])(\d+(?:\.\d+)?|\.\d+)(?![\w$])/g)) {
      const v = Number(m[1]);
      if (v === 0 || v === 1) continue;
      // index-like: [2], slice(0, 2), .length - 2 are still listed (a cut is a lever); 1e3-style timings skipped
      out.push({ kind: 'number', at, fn, value: v, text: trimmed.slice(0, 160) });
    }
  }
}
for (const o of out) console.log(JSON.stringify(o));
const by = {};
for (const o of out) {
  const f = o.at.replace(/:\d+$/, '');
  by[f] ??= { number: 0, card: 0, switch: 0 };
  by[f][o.kind]++;
}
console.log(JSON.stringify({ kind: 'summary', byFile: by, total: out.length }));
