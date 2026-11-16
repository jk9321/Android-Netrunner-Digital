// Valuation V-A counts (brief-stage-va-owners.md rev 2): the numbers the checkpoint and every later audit recount.
//   hand-set literals in the valuation layer (scripts/value-owners/val-lits.mjs, the audit's method, copied unchanged)
//   owners and live copies per quantity (the summary table of docs/ai-priced-quantities.md's valuation section)
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
const rows = [...section.matchAll(/^\| (V\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|/gm)];
const copies = rows.map(([, id, quantity, , live]) => {
  const nums = (live.match(/\d+/g) ?? []).map(Number);
  return { id, quantity: quantity.trim(), live: /HQ \d+, grip \d+/.test(live) ? nums[0] + nums[1] : nums[0] ?? 0 };
});
const dead = (readFileSync('tests/codeHealth.test.ts', 'utf8').match(/DEAD_VALUATION_EXPORTS[^{]*\{([\s\S]*?)\n {2}\};/)?.[1].match(/^\s+'[\w:]+':/gm) ?? []).length;
const ai = readdirSync('src/ai', { recursive: true }).filter(f => f.endsWith('.ts'));
const lines = ai.reduce((n, f) => n + readFileSync(`src/ai/${f}`, 'utf8').split('\n').length - 1, 0);

const out = [
  '| count | value |',
  '|---|--:|',
  `| hand-set literals in the valuation layer (val-lits.mjs: table + scattered) | ${lits[1]} (${lits[2]} + ${lits[3]}) |`,
  `| quantities with one named owner (V1 to V${rows.length}) | ${rows.length} |`,
  `| live copies, all quantities (each row's first number; HQ + grip for V3) | ${copies.reduce((n, c) => n + c.live, 0)} |`,
  `| valuation exports with no reader (allow-list) | ${dead} |`,
  `| lines of src/ai | ${lines} |`,
  '',
  'Live copies per quantity: ' + copies.map(c => `${c.id} ${c.live}`).join(', ') + '.',
].join('\n');
console.log(out);
if (process.argv.includes('--write')) {
  const head = '### V-A counts\n';
  const at = text.indexOf(head);
  const end = text.indexOf('<!-- valuation:end -->');
  writeFileSync(FILE, text.slice(0, at) + head + 'From `node scripts/value-owners/counts.mjs` (re-run it to recount; the copy counts may only go down).\n\n' + out + '\n' + text.slice(end));
}
