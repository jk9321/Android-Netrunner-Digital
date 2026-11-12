// Summarizes scripts/asset-rez-trace.ts output: econ assets' rez chances and rezzes, Jeff against the Corp AI, by card.
//   node scripts/asset-rez-trace-sum.mjs rez.jsonl
import { readFileSync } from 'node:fs';

const rows = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const sides = ['jeff', 'ai'];
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : '-');
const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const copies = Object.fromEntries(sides.map(w => [w, rows.filter(r => r.who === w).flatMap(r => r.copies)]));
const ownTurn = c => c.step === 'corp_draw' || c.step === 'corp_action' || c.step === 'corp_discard';
const inRun = c => ['run_initiation', 'approach_ice', 'move_inward', 'approach_server'].includes(c.step);

console.log(`games: Jeff ${rows.filter(r => r.who === 'jeff').length}, AI ${rows.filter(r => r.who === 'ai').length}; econ asset copies installed: Jeff ${copies.jeff.length}, AI ${copies.ai.length}\n`);
const titles = [...new Set(sides.flatMap(w => copies[w].map(c => c.title)))].sort((a, b) => copies.ai.filter(c => c.title === b).length - copies.ai.filter(c => c.title === a).length);
for (const t of titles) {
  console.log(`${t}`);
  for (const w of sides) {
    const cs = copies[w].filter(c => c.title === t);
    if (!cs.length) continue;
    const c0 = cs[0];
    const rez = cs.filter(c => c.rezzed);
    const affordable = cs.filter(c => c.chances.some(x => x.credits >= c.cost));
    const ownAsked = cs.flatMap(c => c.chances.filter(x => ownTurn(x) && x.asked && x.credits >= c.cost));
    const blocked = ownAsked.filter(x => x.score === null);
    const scored = ownAsked.filter(x => typeof x.score === 'number');
    const firstOwn = cs.map(c => c.chances.find(x => ownTurn(x) && x.credits >= c.cost)).filter(Boolean);
    const waits = rez.map(c => c.rezzed.turn - c.installed);
    const steps = Object.entries(Object.groupBy(rez, c => c.rezzed.step)).map(([k, v]) => `${k} ${v.length}`).join(', ');
    const trashed = cs.filter(c => c.trashed);
    const trashedUnrezzed = trashed.filter(c => !c.rezzed || c.rezzed.turn > c.trashed.turn);
    const pb = cs.map(c => c.payback).filter(x => typeof x === 'number');
    console.log(`  ${w.padEnd(4)} n ${String(cs.length).padStart(3)} cost ${c0.cost} ${c0.every} pay ${c0.pay} load ${c0.load} | rezzed ${pct(rez.length, cs.length)} (${steps || '-'}), turns to rez ${f(mean(waits))} | an affordable chance ${pct(affordable.length, cs.length)}, own-turn chances asked & affordable ${ownAsked.length}: rez blocked (-Infinity) ${pct(blocked.length, ownAsked.length)}, scored ${scored.length} (rez minus best ${f(mean(scored.map(x => x.score - x.best)), 2)})`);
    console.log(`       first own-turn affordable chance: credits ${f(mean(firstOwn.map(x => x.credits)))}, took ${Object.entries(Object.groupBy(firstOwn, x => x.took ?? '-')).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);
    console.log(`       trashed ${pct(trashed.length, cs.length)} (unrezzed ${trashedUnrezzed.length}; by a run with a rez window for it ${trashed.filter(c => c.trashed.rezWindowInRun).length}) | in-run rez windows offered ${cs.reduce((n, c) => n + c.chances.filter(inRun).length, 0)}, Runner-turn windows ${cs.reduce((n, c) => n + c.chances.filter(x => x.step.startsWith('runner')).length, 0)} | counted payback at first affordable chance ${pb.length ? f(mean(pb)) : '- (click asset)'}`);
  }
}
