// F119 phase A, after the record: a read-only look at what drives the U bar (not a bar). Usage: node scripts/f119-punisher-field/drivers.mjs <record out dir>
// Part 1: by deck, the Corp-view trash and use inputs at the unit against the record's trash and take lines. Part 2: by take card, uses after more tags were given in the leg, and uses the clock had as a candidate at the unit.
import { readFileSync, readdirSync } from 'node:fs';
const dir = process.argv[2];
const d = dir; const by = {};
for (const f of readdirSync(d).filter(f => f.endsWith('.txt'))) for (const l of readFileSync(d + '/' + f, 'utf8').split('\n')) {
  if (!l.includes('"kind":"u"')) continue; const u = JSON.parse(l); const k = u.pool + ' ' + u.corpDeck;
  const b = (by[k] ??= { n: 0, bt: 0, bu: 0, uu: 0, rt: 0, rk: 0, rg: 0, cards: {} }); b.n++;
  b.bt += u.beside.base.c.trash; b.bu += u.beside.base.c.use; b.uu += u.beside.U.c.use;
  for (const leg of u.legs) for (const x of leg.uses) { const s = x.swing / u.legs.length; if (x.line === 'trash') b.rt += s; else if (x.line === 'take') { b.rk += s; b.cards[x.card] = (b.cards[x.card] ?? 0) + s; } else if (x.line === 'gain') b.rg += s; }
}
for (const [k, b] of Object.entries(by)) if (b.bu || b.uu || b.rk) console.log(k, b.n, 'trash in/rec', (b.bt / b.n).toFixed(2), (b.rt / b.n).toFixed(2), '| base punisher', (b.bu / b.n).toFixed(2), 'U use', (b.uu / b.n).toFixed(2), 'rec take', (b.rk / b.n).toFixed(2), JSON.stringify(Object.fromEntries(Object.entries(b.cards).map(([c, v]) => [c, +(v / b.n).toFixed(2)]))));
const d2 = dir; const rows = {};
for (const f of readdirSync(d2).filter(f => f.endsWith('.txt'))) for (const l of readFileSync(d2 + "/" + f, 'utf8').split('\n')) {
  if (!l.includes('"kind":"u"')) continue; const u = JSON.parse(l);
  for (const leg of u.legs) for (const x of leg.uses) if (x.line === 'take') {
    const k = x.card; const r = (rows[k] ??= { n: 0, more: 0, cand: 0, ut: [], xt: [] }); r.n++;
    if (x.tags > u.beside.tags) r.more++;
    const code = { 'IP Enforcement': '35066', 'Orbital Superiority': '30068', 'Bigger Picture': '35065', Retribution: '30065' }[k];
    if ((u.beside.candC ?? []).some(c => c.code === code)) r.cand++;
    r.ut.push(u.beside.tags); r.xt.push(x.tags);
  }
}
for (const [k, r] of Object.entries(rows)) console.log(k, 'uses', r.n, 'tags at use > tags at unit', r.more, 'card a Corp-view candidate at the unit', r.cand, 'unit tags', r.ut.join(','), 'use tags', r.xt.join(','));
