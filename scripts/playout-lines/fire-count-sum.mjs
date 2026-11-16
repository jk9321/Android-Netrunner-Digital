// Sums scripts/playout-lines/fire-count.ts output: node scripts/playout-lines/fire-count-sum.mjs <dir or files...>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const walk = p => (statSync(p).isDirectory() ? readdirSync(p).flatMap(f => walk(join(p, f))) : p.endsWith('.txt') ? [p] : []);
const rows = process.argv.slice(2).flatMap(walk).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const games = new Set(rows.map(r => r.src)).size;
const changed = rows.filter(r => r.changed);
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mean = xs => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sum = (f, g) => { const o = {}; for (const r of rows) for (const [k, v] of Object.entries(r[f] ?? {})) o[k] = (o[k] ?? 0) + v; return g ? o[g] : o; };
const part = pre => { const rs = rows.filter(r => r.src.startsWith(pre)); const ch = rs.filter(r => r.changed).length; const g = new Set(rs.map(r => r.src)).size; return `${rs.length} decisions, ${ch} changed (${g} games, ${(ch / Math.max(1, g)).toFixed(2)} a game)`; };
console.log(`decisions ${rows.length} in ${games} games; picks changed ${changed.length} (${(changed.length / Math.max(1, games)).toFixed(2)} a game)`);
console.log(`  deals: ${part('deal:')}; human: ${part('human:')}`);
console.log(`  with a held line at the decision: ${rows.filter(r => r.held).length} decisions, ${changed.filter(r => r.held).length} changed`);
const pl = sum('pl');
console.log(`inside playouts ('on'): ${JSON.stringify(pl)}  (per game: Q5 asks ${(pl.q5Asks / games).toFixed(1)}, Q5 steps ${(pl.q5Steps / games).toFixed(1)}, vetoes ${(pl.q5Vetoes / games).toFixed(1)}, Q4 asks ${(pl.q4Asks / games).toFixed(1)}, Q4 takes ${(pl.q4Takes / games).toFixed(1)})`);
console.log(`  'off' arm playoutLine (expected all 0): ${JSON.stringify(sum('plOff'))}`);
console.log(`planner slots off: ${JSON.stringify(sum('slotsOff'))}`);
console.log(`planner slots on:  ${JSON.stringify(sum('slotsOn'))}`);
console.log(`scoreInTwo (deciding Corp + place() in the order, playouts included) off: ${JSON.stringify(sum('s2Off'))}`);
console.log(`scoreInTwo on: ${JSON.stringify(sum('s2On'))}`);
console.log(`check (a) planner OFF, corpDecide old vs new: same on ${rows.filter(r => r.aSame).length} of ${rows.length}`);
console.log(`check (b) Q4/Q5 alone, old inline vs lineAsk: same on ${rows.reduce((a, r) => a + r.bSame, 0)} of ${rows.reduce((a, r) => a + r.bAll, 0)}`);
const off = rows.map(r => r.msOff), on = rows.map(r => r.msOn);
console.log(`time mean off ${mean(off).toFixed(0)} ms, on ${mean(on).toFixed(0)} ms (x${(mean(on) / mean(off)).toFixed(3)}); p95 ${q(off, 0.95)} vs ${q(on, 0.95)} (x${(q(on, 0.95) / q(off, 0.95)).toFixed(3)})`);
console.log('\nChanged decisions (src, decision #, turn, clicks, held, off -> on):');
const short = a => { try { const x = JSON.parse(a); return `${x.type}${x.cardInstanceId ? ' ' + x.cardInstanceId : ''}${x.targetServerId ? '@' + x.targetServerId : x.asNewRemote ? '@new' : ''}`; } catch { return a; } };
const why = r => (r.pl.q5Steps ? 'agenda line step' : r.pl.assetSteps ? 'asset line step' : r.pl.q5Vetoes ? 'agenda line veto' : r.pl.assetVetoes ? 'asset line veto' : r.pl.scoreFirst ? 'score first' : 'none');
const tab = {};
for (const r of changed) tab[why(r)] = (tab[why(r)] ?? 0) + 1;
console.log(`what fired in the playouts of each changed decision (first of: agenda step, asset step, agenda veto, asset veto, score first): ${JSON.stringify(tab)}`);
const at = x => (x ? `L${x.line}${x.card ? ' ' + x.card : ''}` : '?');
for (const r of changed) console.log(`- ${r.src} #${r.i} T${r.T} clicks ${r.clicks}${r.held ? ' held' : ''} [${why(r)}] ${short(r.off)} (${at(r.offAt)}) -> ${short(r.on)} (${at(r.onAt)})`);

// Brief item (AI Coordinator 04:12Z): for each kind of change, what the line put in place of the playout's move, and
// whether the planner now values the old pick lower or the new pick higher (each candidate's playout value, both arms)
const val = (c, a) => { if (!c) return null; const i = c.actions.indexOf(a); return i < 0 ? null : c.values[i]; };
const groups = {};
for (const r of changed) {
  const g = (groups[why(r)] ??= { n: 0, takes: {}, oldDown: 0, newUp: 0, both: 0, noPlanner: 0, dOld: [], dNew: [], lines: {} });
  g.n++;
  for (const [k, v] of Object.entries(r.takes ?? {})) g.takes[k] = (g.takes[k] ?? 0) + v;
  const oOff = val(r.candsOff, r.off), oOn = val(r.candsOn, r.off), nOff = val(r.candsOff, r.on), nOn = val(r.candsOn, r.on);
  const lk = `${at(r.offAt)} -> ${at(r.onAt)}`;
  g.lines[lk] = (g.lines[lk] ?? 0) + 1;
  if (oOff === null || oOn === null || nOff === null || nOn === null) { g.noPlanner++; continue; }
  const down = oOn < oOff, up = nOn > nOff;
  if (down && up) g.both++; else if (down) g.oldDown++; else if (up) g.newUp++;
  g.dOld.push(oOn - oOff);
  g.dNew.push(nOn - nOff);
}
const med = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)].toFixed(2) : '-'; };
console.log('\nBy what fired (changed decisions):');
for (const [k, g] of Object.entries(groups)) {
  console.log(`  ${k}: ${g.n}; the old pick valued lower only ${g.oldDown}, the new pick higher only ${g.newUp}, both ${g.both}, a candidate missing from one arm ${g.noPlanner}; median change old pick ${med(g.dOld)}, new pick ${med(g.dNew)}`);
  console.log(`    playout steps changed (kind: order's pick -> played): ${JSON.stringify(Object.entries(g.takes).sort((a, b) => b[1] - a[1]).slice(0, 8))}`);
  console.log(`    lines of the order (old pick -> new pick): ${JSON.stringify(Object.entries(g.lines).sort((a, b) => b[1] - a[1]).slice(0, 10))}`);
}
