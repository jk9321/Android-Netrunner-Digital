/**
 * Builds scripts/stage-d/madani-hosted-arms.json (the arms as text patches on copies of src/, runner-money-trees.ts makeTrees)
 * from an edited copy of the files: `node scripts/stage-d/madani-hosted-arms.mjs <arm dir>`, where <arm dir>/src/... holds
 * the arm's versions of the files it changes. Each diff hunk becomes one [file, beta text, arm text] patch, with enough
 * context lines to match once.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const files = ['ai/corp/hold.ts', 'ai/cards/types.ts', 'ai/cards/elevation.ts'];
const patches = [];
for (const f of files) {
  const base = readFileSync(join('src', f), 'utf8');
  let out = '';
  try {
    execFileSync('diff', ['-U6', join('src', f), join(dir, 'src', f)], { encoding: 'utf8' });
  } catch (e) {
    out = e.stdout;
  }
  const hunks = out.split('\n').slice(2).join('\n').split(/^@@[^\n]*@@\n/m).slice(1);
  for (const h of hunks) {
    const lines = h.replace(/\n$/, '').split('\n').filter(l => !l.startsWith('\\'));
    const from = lines.filter(l => !l.startsWith('+')).map(l => l.slice(1)).join('\n');
    const to = lines.filter(l => !l.startsWith('-')).map(l => l.slice(1)).join('\n');
    if (base.split(from).length !== 2) throw new Error(`${f}: a hunk does not match once: ${from.slice(0, 80)}`);
    patches.push([f, from, to]);
  }
}
// The probe (measuring only): beta recording every serverHold question, its board, answer and caller
const probeFrom = "export function serverHold(state: GameState, server: string, opts: HoldOptions): Hold {\n  if (opts.when === 'thisRun') return walkThisRun(state, server, opts);";
const probeTo = "export function serverHold(state: GameState, server: string, opts: HoldOptions): Hold {\n  // madani-hosted probe (measuring only): every question asked, with its board, answer and caller\n  const probe = (globalThis as { __holdProbe?: unknown[] }).__holdProbe;\n  const h = serverHoldAsked(state, server, opts);\n  if (probe) probe.push({ state, server, opts, h, stack: new Error().stack });\n  return h;\n}\n\nfunction serverHoldAsked(state: GameState, server: string, opts: HoldOptions): Hold {\n  if (opts.when === 'thisRun') return walkThisRun(state, server, opts);";
if (readFileSync('src/ai/corp/hold.ts', 'utf8').split(probeFrom).length !== 2) throw new Error('probe patch does not match once');
writeFileSync('scripts/stage-d/madani-hosted-arms.json', JSON.stringify({ hosted: patches, probe: [['ai/corp/hold.ts', probeFrom, probeTo]], _arms: { beta: [], control: [], hosted: ['hosted'], probe: ['probe'] } }, null, 1) + '\n');
console.log(`${patches.length} patches`);
