// Sums scripts/stage-d/rez-keep-windows.ts output: node scripts/stage-d/rez-keep-windows-sum.mjs <files or dirs...>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = process.argv.slice(2).flatMap(p => (statSync(p).isDirectory() ? readdirSync(p).filter(f => f.endsWith('.txt')).map(f => join(p, f)) : [p]));
const rows = files.flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const ws = rows.filter(r => r.kind === 'window');
const ends = rows.filter(r => r.kind === 'end');
const srcs = new Set(ws.map(w => w.src));
const fires = ws.filter(w => w.fires);
const ms = ws.map(w => w.ms).sort((a, b) => a - b);
console.log(`Deals played to the end ${ends.length}; sources with an R3/R4 toll window ${srcs.size}; toll windows ${ws.length} (R3t ${ws.filter(w => w.rule === 'R3t').length}, R4t ${ws.filter(w => w.rule === 'R4t').length})`);
console.log(`spendsKept fires (the window is passed by the counted rule) ${fires.length}; the agent's picks at those windows: ${JSON.stringify(fires.reduce((o, w) => ((o[w.pick] = (o[w.pick] ?? 0) + 1), o), {}))}`);
console.log(`ask time: mean ${(ms.reduce((a, b) => a + b, 0) / (ms.length || 1)).toFixed(1)} ms, median ${ms[Math.floor(ms.length / 2)] ?? '-'} ms, max ${ms[ms.length - 1] ?? '-'} ms`);
for (const w of fires) console.log(`  FIRES ${w.src} T${w.T} ${w.server} ${w.rule} ${w.title} corp ${w.corp} cost ${w.cost} runner ${w.runner} clicks ${w.clicks} pick ${w.pick}`);
