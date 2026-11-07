/**
 * The tuning.plan switch table (review item 6, piece 4): one row per switch
 * with its default, the sides it is off for (sideOff), whether it is parked
 * (codeHealth OFF_SWITCHES), whether main had it before the 2026-11-01 beta
 * promotion, the first batch-log row that names it, the date it came in,
 * how many reads it has in src/ai, and what the fold rule says.
 *
 *   npx vite-node scripts/plan-switches.ts > table.md
 *
 * Fold rule (spec): ON by default, has a batch row or was on main before
 * 2026-11-01, not in OFF_SWITCHES, no open question in its comment -> fold
 * the ON path into the code and delete the switch. Anything else stays.
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { sideOff, tuning } from '../src/ai/synergy';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const synergy = read('src/ai/synergy.ts');
const health = read('tests/codeHealth.test.ts');
const log = read('docs/ai-batch-log.md').split('\n').filter(l => l.startsWith('| 20'));
const offSwitches = new Set([...(health.match(/const OFF_SWITCHES[^]*?\n};/)?.[0] ?? '').matchAll(/^\s+'?([\w.]+)'?:/gm)].map(m => m[1]));
// main as it is: AI tuning on main stopped at the 2026-11-01 promotion (bugfixes only since)
let mainSynergy = '';
try {
  mainSynergy = execSync('git show origin/main:src/ai/synergy.ts', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch {
  console.error('origin/main not fetched: "on main" left blank');
}
const mainPlan = mainSynergy.slice(mainSynergy.indexOf('  plan: {'));
const planSrc = synergy.slice(synergy.indexOf('  plan: {'), synergy.indexOf('\nexport const sideOff'));

const srcFiles = (dir: string): string[] =>
  (readdirSync(new URL(dir, root), { recursive: true }) as string[]).filter(f => f.endsWith('.ts')).map(f => dir + f);
const src = srcFiles('src/ai/').filter(f => !f.endsWith('synergy.ts')).map(read).join('\n');

/** The doc comment just above `name:` in the plan, flattened. */
function commentOf(name: string): string {
  const at = planSrc.search(new RegExp(`\\n {4}${name}:`));
  if (at < 0) return '';
  const before = planSrc.slice(0, at);
  const m = before.match(/\/\*\*?((?:(?!\*\/)[^])*)\*\/\s*$/);
  return m ? m[1].replace(/\s*\n\s*\*\s?/g, ' ').trim() : '';
}

/** Words that mark a switch as still under question (kept by the rule). */
const OPEN = /\b(experiment|unverified|open question|re-?test|revisit|for now|TODO|not yet|until|parked|measur(?:e|ing) switch)\b|\?/i;

function addedOn(name: string): string {
  try {
    const out = execSync(`git log --reverse --date=short --format=%ad -S "    ${name}:" -- src/ai/synergy.ts`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n')[0] ?? '';
  } catch {
    return '';
  }
}

const rows: string[][] = [];
for (const [name, value] of Object.entries(tuning.plan)) {
  const parts = value && typeof value === 'object' ? Object.entries(value as Record<string, unknown>) : null;
  const def = parts ? parts.map(([k, v]) => `${k}:${v ? 'on' : 'off'}`).join(' ') : value ? 'on' : 'off';
  const on = parts ? parts.some(([, v]) => !!v) : !!value;
  const sides = (['corp', 'runner'] as const).filter(s => sideOff[s].includes(name)).map(s => `off for ${s}`).join(', ');
  const parked = offSwitches.has(name) || (parts ?? []).some(([k]) => offSwitches.has(`${name}.${k}`));
  const onMain = mainPlan ? new RegExp(`\\n {4}${name}:`).test(mainPlan) : false;
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  const row = log.find(l => l.includes(name) || l.toLowerCase().includes(words));
  const batch = row ? row.split('|')[1].trim() + ' ' + row.split('|')[2].trim().slice(0, 50) : '';
  const comment = commentOf(name);
  const open = OPEN.test(comment);
  const reads = (src.match(new RegExp(`plan\\(\\)\\.${name}\\b|plan\\(\\)\\[['"]${name}['"]\\]`, 'g')) ?? []).length;
  const mixed = parts ? parts.some(([, v]) => !v) && on : false;
  let verdict: string;
  if (!on) verdict = parked ? 'stays (parked)' : 'stays (off)';
  else if (parked) verdict = 'stays (part parked)';
  else if (sides) verdict = 'stays (side switch)';
  else if (mixed) verdict = 'stays (on one side only)';
  else if (open) verdict = 'stays (open question)';
  else if (!row && !onMain) verdict = 'stays (no batch row, not on main)';
  else verdict = 'FOLD';
  rows.push([name, def, sides, parked ? 'yes' : '', onMain ? 'yes' : '', batch, addedOn(name), String(reads), verdict, open ? comment.slice(0, 90) : '']);
}

const header = ['switch', 'default', 'sideOff', 'parked', 'on main', 'first batch row', 'added', 'reads', 'rule says', 'open-question text'];
console.log(`| ${header.join(' | ')} |`);
console.log(`| ${header.map(() => '---').join(' | ')} |`);
for (const r of rows) console.log(`| ${r.map(c => c.replace(/\|/g, '/')).join(' | ')} |`);
const fold = rows.filter(r => r[8] === 'FOLD').length;
console.log(`\n${rows.length} switches; the rule folds ${fold}, keeps ${rows.length - fold}.`);
