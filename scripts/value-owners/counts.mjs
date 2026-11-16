// Valuation V-A counts (brief-stage-va-owners.md rev 2): the numbers the checkpoint and every later audit recount.
//   hand-set literals in the valuation layer (scripts/value-owners/val-lits.mjs, the audit's method, copied unchanged)
//   owners per quantity (the summary table of docs/ai-priced-quantities.md's valuation section) and copies: since V-B B1
//   (recount VA-COPY-COUNT-BASELINE, ruling 13) one line per copy between <!-- copies:start/end -->, counted by its
//   `counted` cell (live, dead, not comparable, inside owner, reader, recorded); the copy count is the live lines
//   valuation exports with no reader (tests/codeHealth.test.ts DEAD_VALUATION_EXPORTS, the shrink-only allow-list)
//   lines of src/ai (counted as tests/codeHealth.test.ts counts them)
//   node scripts/value-owners/counts.mjs            print
//   node scripts/value-owners/counts.mjs --write    also put the table in the registry's "V-A counts" section
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const FILE = 'docs/ai-priced-quantities.md';
const text = readFileSync(FILE, 'utf8');
const section = text.slice(text.indexOf('<!-- valuation:start -->'), text.indexOf('<!-- valuation:end -->'));

const lits = execFileSync('node', ['scripts/value-owners/val-lits.mjs', '.'], { encoding: 'utf8' }).match(/TOTAL (\d+) table (\d+) scattered (\d+)/);
const summary = section.slice(section.indexOf('### Summary'), section.indexOf('### V1.'));
const rows = [...summary.matchAll(/^\| (V\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|/gm)];
const block = section.slice(section.indexOf('<!-- copies:start -->'), section.indexOf('<!-- copies:end -->'));
if (!block) throw new Error('no <!-- copies:start --> ... <!-- copies:end --> block in the valuation section');
const lines_ = [...block.matchAll(/^\| (V\d+) \| [^|]+ \| [^|]+ \| ([^|]+) \|/gm)].map(([, id, counted]) => ({ id, counted: counted.trim() }));
const kinds = {};
for (const l of lines_) kinds[l.counted] = (kinds[l.counted] ?? 0) + 1;
const copies = rows.map(([, id, quantity]) => ({ id, quantity: quantity.trim(), live: lines_.filter(l => l.id === id && l.counted === 'live').length }));
const dead = (readFileSync('tests/codeHealth.test.ts', 'utf8').match(/DEAD_VALUATION_EXPORTS[^{]*\{([\s\S]*?)\n {2}\};/)?.[1].match(/^\s+'[\w:]+':/gm) ?? []).length;
const ai = readdirSync('src/ai', { recursive: true }).filter(f => f.endsWith('.ts'));
const lines = ai.reduce((n, f) => n + readFileSync(`src/ai/${f}`, 'utf8').split('\n').length - 1, 0);

const out = [
  '| count | value |',
  '|---|--:|',
  `| hand-set literals in the valuation layer (val-lits.mjs: table + scattered) | ${lits[1]} (${lits[2]} + ${lits[3]}) |`,
  `| quantities with one named owner (V1 to V${rows.length}) | ${rows.length} |`,
  `| live copies, all quantities (the live lines of "Copy lines") | ${copies.reduce((n, c) => n + c.live, 0)} |`,
  `| other copy lines, by kind (not counted) | ${Object.entries(kinds).filter(([k]) => k !== 'live').map(([k, n]) => `${k} ${n}`).join(', ')} |`,
  `| valuation exports with no reader (allow-list) | ${dead} |`,
  `| lines of src/ai | ${lines} |`,
  '',
  'Live copies per quantity: ' + copies.map(c => `${c.id} ${c.live}`).join(', ') + '.',
].join('\n');
console.log(out);
if (process.argv.includes('--write')) {
  const head = '### Counts\n';
  const at = text.indexOf(head);
  const end = text.indexOf('<!-- valuation:end -->');
  writeFileSync(FILE, text.slice(0, at) + head + 'From `node scripts/value-owners/counts.mjs` (re-run it to recount; the copy counts may only go down).\n\n' + out + '\n' + text.slice(end));
}
