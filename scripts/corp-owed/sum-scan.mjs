// Sums corp-owed/scan.ts output (items 5 and 6). Usage: node scripts/corp-owed/sum-scan.mjs <dir or files...>
// Item 5 (F109): per root card whose rez changes an access, its rez windows (approach to the server, unrezzed), how often
// it was payable (legal rez), rezzed, and what the access that followed was. Item 6 (F107): per card, the entry's worth
// (Corp view) at Corp turn starts against the state inputs, by rezzed or not and by turns left; and the Runner's access
// answers on it.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = process.argv.slice(2).flatMap(p => (statSync(p).isDirectory() ? readdirSync(p).filter(f => /\.(txt|jsonl|log)$/.test(f)).map(f => join(p, f)) : [p]));
const rows = files.flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
const num = x => (x === 'Inf' ? Infinity : x === '-Inf' ? -Infinity : Number(x));
const ms = xs => { xs = xs.filter(Number.isFinite); const n = xs.length; if (!n) return '-'; const m = xs.reduce((a, b) => a + b, 0) / n; const v = n > 1 ? xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1) : 0; return `${m.toFixed(2)} ± ${Math.sqrt(v / n).toFixed(2)} (${n})`; };
const by = (xs, f) => xs.reduce((a, x) => ((a[f(x)] ??= []).push(x), a), {});
const games = rows.filter(r => r.kind === 'g');
console.log(`games ${games.length} (matching their record ${games.filter(g => g.matches).length}); errors ${rows.filter(r => r.kind === 'err').length}; shards ${rows.filter(r => r.kind === 's').length}\n`);

// Item 5
const wins = rows.filter(r => r.kind === 'r').flatMap(r => r.rows.map(x => ({ ...x, pool: r.pool, end: r.end, success: r.success })));
console.log('## Item 5: rez windows at the approach to the server, card unrezzed in the root\n');
console.log('| card | windows | payable (legal) | offered | rezzed | accessed | of those, Runner trashed | run ended before access | agenda in root | cost (mean) | Corp credits (mean) |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const [card, xs] of Object.entries(by(wins, x => x.card)).sort((a, b) => b[1].length - a[1].length)) {
  const acc = xs.filter(x => x.access);
  console.log(`| ${card} | ${xs.length} | ${xs.filter(x => x.legal).length} | ${xs.filter(x => x.offered).length} | ${xs.filter(x => x.rezzed).length} | ${acc.length} | ${acc.filter(x => x.access.answer === 'trash').length} | ${xs.filter(x => !x.access && !x.success).length} | ${xs.filter(x => x.agendaInRoot).length} | ${ms(xs.map(x => num(x.cost)))} | ${ms(xs.map(x => x.credits))} |`);
}
const answers = by(wins.filter(x => x.legal), x => x.answer ?? 'null');
console.log(`\nThe scorer's answer in payable windows: ${Object.entries(answers).map(([k, v]) => `${k} ${v.length}`).join('; ')}\n`);

// Item 6
const w = rows.filter(r => r.kind === 'w');
console.log('## Item 6: entry worth (Corp view) at Corp turn starts\n');
console.log('| card | reads | rezzed | worth, rezzed | worth, unrezzed | runnerLeft view | hosted credits (mean) | turns left (mean) | worth by turns left: <=3 / 4-8 / >8 |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---|');
for (const [card, xs] of Object.entries(by(w, x => x.card)).sort((a, b) => b[1].length - a[1].length)) {
  const rz = xs.filter(x => x.rezzed), un = xs.filter(x => !x.rezzed);
  const tl = x => num(x.inputs.turnsLeft);
  console.log(`| ${card} | ${xs.length} | ${rz.length} | ${ms(rz.map(x => num(x.worth.corp)))} | ${ms(un.map(x => num(x.worth.corp)))} | ${ms(xs.map(x => num(x.worth.runnerLeft)))} | ${ms(xs.map(x => x.inputs.hosted))} | ${ms(xs.map(tl))} | ${ms(rz.filter(x => tl(x) <= 3).map(x => num(x.worth.corp)))} / ${ms(rz.filter(x => tl(x) > 3 && tl(x) <= 8).map(x => num(x.worth.corp)))} / ${ms(rz.filter(x => tl(x) > 8).map(x => num(x.worth.corp)))} |`);
}
// worth against one state input per card: the correlation of the rezzed worth with each input
const corr = (a, b) => { const n = a.length; if (n < 5) return NaN; const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n; let s = 0, sa = 0, sb = 0; for (let i = 0; i < n; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return sa && sb ? s / Math.sqrt(sa * sb) : NaN; };
const INPUTS = ['turnsLeft', 'hosted', 'corpScore', 'runnerScore', 'corpCredits', 'advNeed', 'advanceableInRoot', 'assetsInRoot', 'archives', 'iced'];
console.log(`\nCorrelation of the rezzed worth with each state input (n >= 5; blank where the worth or input never moves):\n`);
console.log(`| card | ${INPUTS.join(' | ')} |`);
console.log(`|---|${INPUTS.map(() => '---:').join('|')}|`);
for (const [card, xs] of Object.entries(by(w.filter(x => x.rezzed && Number.isFinite(num(x.worth.corp))), x => x.card))) {
  const v = xs.map(x => num(x.worth.corp));
  console.log(`| ${card} | ${INPUTS.map(k => { const c = corr(v, xs.map(x => num(x.inputs[k]))); return Number.isFinite(c) ? c.toFixed(2) : ''; }).join(' | ')} |`);
}
const a = rows.filter(r => r.kind === 'a');
console.log('\nAccesses on these cards (the Runner\'s trash answer):\n');
for (const [card, xs] of Object.entries(by(a, x => x.card))) console.log(`- ${card}: ${xs.length} accesses; trash ${xs.filter(x => x.answer === 'trash').length}, keep ${xs.filter(x => x.answer === 'keep').length}; rezzed ${xs.filter(x => x.rezzed).length}; trash cost ${ms(xs.map(x => num(x.trashCost)))}; Runner credits ${ms(xs.map(x => x.runnerCredits))}`);
