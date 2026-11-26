// R-14h fix, step 0.2's Corp list (and the Runner's beside it): the first changed pick of each deal (lockstep PICKS=1,
// commit 3's draft against commit 2), joined to step 0's record of that decision (last-credits-fix-step0.ts): the rows
// whose 'later' value moved there under the form. A 'now' row cannot move in commit 3 (drawMoney answers 'now' with the
// credits; tests/cardRateClass.test.ts holds every row's class), so step 0's 'now' fires (what a 'later' class WOULD move)
// are not read here.
//   node scripts/runner-rework/last-credits-fix-picks-sum.mjs FORM=k1 <step0 dir> <picks dir>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const FORM = (args.find(a => a.startsWith('FORM=')) ?? 'FORM=k1').slice(5);
// MOVED=runner: only that deck's money moved in the draft (rev 4: the Corp at today's credits), so only its rows count
const MOVED = (args.find(a => a.startsWith('MOVED=')) ?? 'MOVED=runner,corp').slice(6).split(',');
const [step0Dir, picksDir] = args.filter(a => !a.includes('='));
const lines = dir => (statSync(dir).isDirectory() ? readdirSync(dir, { recursive: true }).map(f => join(dir, String(f))).filter(f => statSync(f).isFile()) : [dir]).flatMap(f => readFileSync(f, 'utf8').split('\n')).filter(l => l.startsWith('{')).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const decs = new Map();
for (const r of lines(step0Dir)) if (r.kind === 'dec') decs.set(`${r.pool}|${r.seed}|${r.step}`, r);
const deals = lines(picksDir).filter(r => r.kind === 'deal');
const EMBEDDED = 'cards/elevation.ts:74';
const p = (...x) => console.log(...x);
p(`# R-14h step 0.2: first changed pick per deal (form ${FORM} on the ${MOVED.join(' and ')} deck)\n`);
p(`Deals: ${deals.length}; with a changed pick: ${deals.filter(d => d.diff).length}; control differing: ${deals.filter(d => d.diff?.control).length}; errors: ${lines(picksDir).filter(r => r.kind === 'error').length}.\n`);
for (const side of ['corp', 'runner']) {
  const rows = deals.filter(d => d.diff && d.diff.side === side);
  p(`## ${side}: ${rows.length} deals whose first changed pick is the ${side}'s\n`);
  p(`| pool | seed | T | step | part | rows whose 'later' value moved there | base pick | draft pick |`);
  p(`|---|---:|---:|---:|---|---|---|---|`);
  const parts = {};
  // which deck the moved rows read: the Corp's own, the Runner's (a Runner-deck 'later' read inside the Corp's look-ahead), both
  const byDeck = { own: {}, other: {}, both: {}, neither: {} };
  let unexplained = 0, embedded = 0;
  for (const d of rows) {
    const r = decs.get(`${d.pool}|${d.seed}|${d.diff.step}`);
    const fired = r ? Object.keys(r.fires).filter(k => k.startsWith(`${FORM}|later|`) && MOVED.includes(k.split('|')[2])).map(k => k.split('|').slice(2).join(' ')) : null;
    if (!fired?.length) unexplained++;
    if (fired?.some(f => f.endsWith(EMBEDDED))) embedded++;
    const decks = new Set((fired ?? []).map(f => f.split(' ')[0]));
    const other = side === 'corp' ? 'runner' : 'corp';
    const which = decks.has(side) && decks.has(other) ? 'both' : decks.has(side) ? 'own' : decks.has(other) ? 'other' : 'neither';
    byDeck[which][d.diff.kind] = (byDeck[which][d.diff.kind] ?? 0) + 1;
    parts[d.diff.kind] = (parts[d.diff.kind] ?? 0) + 1;
    const cell = x => String(x).replace(/\|/g, '/').slice(0, 90);
    p(`| ${d.pool} | ${d.seed} | ${d.diff.T} | ${d.diff.step} | ${d.diff.kind} | ${fired ? fired.join('; ') || '(none)' : '(no step 0 record)'} | ${cell(d.diff.picks?.base)} | ${cell(d.diff.picks?.branch)} |`);
  }
  const list = o => Object.entries(o).map(([k, n]) => `${k} ${n}`).join(', ') || '-';
  p(`\nBy the deck the moved rows read, per part: own deck only: ${list(byDeck.own)}; the other side's deck only: ${list(byDeck.other)}; both: ${list(byDeck.both)}; no row: ${list(byDeck.neither)}.`);
  p(`\nBy part: ${Object.entries(parts).map(([k, n]) => `${k} ${n}`).join(', ') || '-'}. No 'later' row moved at the decision: ${unexplained}. Embedded Reporting's row moved: ${embedded}.\n`);
}
