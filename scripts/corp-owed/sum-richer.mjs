// Sums corp-owed/richer.ts output (item 2, F116). Usage: node scripts/corp-owed/sum-richer.mjs <dir or files...>
// For each flagged decision (base e836f26 installs from HQ or rezzes, branch 49d0409 picks otherwise): the gap between
// the two picks in each tree's own leaf parts (base pick less branch pick, mean leaf over the line's reply samples), and
// the move of that gap from base to branch per part. The part that moves most is "the leaf term that moved".
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = process.argv.slice(2).flatMap(p => (statSync(p).isDirectory() ? readdirSync(p).filter(f => /\.(txt|jsonl|log)$/.test(f)).map(f => join(p, f)) : [p]));
const rows = files.flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
const PARTS = ['v', 'cCredits', 'cHand', 'cBoard', 'cRest', 'rCredits', 'rHand', 'rTags', 'rRig', 'rRest', 'rc', 'rt'];
const num = x => (x === 'Inf' ? Infinity : x === '-Inf' ? -Infinity : Number(x));
const ms = xs => { const n = xs.length; if (!n) return '-'; const m = xs.reduce((a, b) => a + b, 0) / n; const v = n > 1 ? xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1) : 0; return `${m.toFixed(2)} ± ${Math.sqrt(v / n).toFixed(2)} (${n})`; };

const games = rows.filter(r => r.kind === 'g');
const flags = rows.filter(r => r.kind === 'f');
const tot = {};
for (const g of games) for (const [k, v] of Object.entries(g.counts)) tot[k] = (tot[k] ?? 0) + v;
console.log(`games ${games.length} (matching their record ${games.filter(g => g.matches).length}); errors ${rows.filter(r => r.kind === 'err').length}; shards ${rows.filter(r => r.kind === 's').length}`);
console.log(`decisions: ${Object.entries(tot).sort().map(([k, v]) => `${k} ${v}`).join('; ')}\n`);
console.log(`flagged ${flags.length}: by kind ${JSON.stringify(flags.reduce((a, f) => ((a[f.dk] = (a[f.dk] ?? 0) + 1), a), {}))}; replay same pick: base ${flags.filter(f => f.replay.base).length}, branch ${flags.filter(f => f.replay.branch).length}; diag as base ${flags.filter(f => f.diag.asBase).length}, as branch ${flags.filter(f => f.diag.asBranch).length}\n`);

const what = w => `${w.type}${w.card ? ' ' + w.card : ''}${w.server ? ' ' + w.server : ''}`;
const pairs = {};
for (const f of flags) { const k = `${what(f.base.what)} -> ${what(f.branch.what).replace(/inst-\d+/, '')}`; pairs[k] = (pairs[k] ?? 0) + 1; }
console.log('Picks (base -> branch): ' + Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => `${k} ${n}`).join('; ') + '\n');

const moves = Object.fromEntries(PARTS.map(p => [p, []]));
const gapsBase = Object.fromEntries(PARTS.map(p => [p, []]));
const gapsBranch = Object.fromEntries(PARTS.map(p => [p, []]));
let read = 0;
const top = {};
const detail = [];
for (const f of flags) {
  const lb = f.leaves.base, lr = f.leaves.branch;
  const A = f.base.pick, B = f.branch.pick;
  if (!lb[A] || !lb[B] || !lr[A] || !lr[B]) continue;
  read++;
  let best = null;
  for (const p of PARTS) {
    const gb = num(lb[A][p]) - num(lb[B][p]);
    const gr = num(lr[A][p]) - num(lr[B][p]);
    if (![gb, gr].every(Number.isFinite)) continue;
    gapsBase[p].push(gb);
    gapsBranch[p].push(gr);
    moves[p].push(gr - gb);
    if (p !== 'v' && p !== 'rc' && p !== 'rt' && (!best || Math.abs(gr - gb) > Math.abs(best[1]))) best = [p, gr - gb];
  }
  if (best) top[best[0]] = (top[best[0]] ?? 0) + 1;
  detail.push({ seed: f.seed, T: f.T, deck: f.corpDeck, base: what(f.base.what), branch: what(f.branch.what), top: best && `${best[0]} ${best[1].toFixed(2)}` });
}
console.log(`Flags with both picks' leaves in both trees: ${read} of ${flags.length}\n`);
console.log('| part | gap in base (base pick less branch pick) | gap in branch | move (branch less base) |');
console.log('|---|---:|---:|---:|');
for (const p of PARTS) console.log(`| ${p} | ${ms(gapsBase[p])} | ${ms(gapsBranch[p])} | ${ms(moves[p])} |`);
console.log(`\nLargest-moving part per flag (value parts only): ${Object.entries(top).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('; ')}\n`);
console.log('| seed | T | deck | base pick | branch pick | top move |');
console.log('|---:|---:|---|---|---|---|');
for (const d of detail.slice(0, 60)) console.log(`| ${d.seed} | ${d.T} | ${d.deck} | ${d.base} | ${d.branch} | ${d.top} |`);
