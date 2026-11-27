// F114 + F110 phase B, bars 2 and 7: sums of count.ts MODE=lock. node scripts/tag-clock-input/sum-lock.mjs <out dir>
// Bar 2: the branch's answer against the arm's (ruledn1), every decision; one difference is a stop.
// Bar 7: time per caller kind, branch against base, with a by-game jackknife error of the ratio, beside ctl against base
// (the asking's own noise); and N1's fallback: clock prices by the cost they read (flat inside a hold count, or C1), by
// caller kind and view, on the arm's tree (the build as patches).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const files = [];
const walk = d => readdirSync(d).forEach(f => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : /\.(txt|jsonl)$/.test(f) && !/done-/.test(f) && files.push(join(d, f))));
walk(dir);
const rows = [];
for (const f of files) for (const l of readFileSync(f, 'utf8').split('\n')) if (l.startsWith('{')) try { rows.push(JSON.parse(l)); } catch {}
const T = rows.filter(r => r.kind === 'time');
const errs = rows.filter(r => r.kind === 'err');
const sum = a => a.reduce((n, v) => n + v, 0);
const mean = a => sum(a) / a.length;
const f3 = x => (Number.isFinite(x) ? x.toFixed(3) : String(x));
const out = [];
const say = s => out.push(s);
const pools = [...new Set(T.map(r => r.pool))];
say(`# MODE=lock: ${T.length} games (${pools.map(p => `${p} ${T.filter(r => r.pool === p).length}`).join(', ')}), ${errs.length} errors, ${T.reduce((n, r) => n + r.decisions, 0)} decisions`);
for (const e of errs) say(`  error ${e.pool}:${e.src}: ${String(e.error).slice(0, 200)}`);

// bar 2
const diffs = T.flatMap(r => (r.inout ?? []).map(x => ({ pool: r.pool, seed: r.seed, ...x })));
const byKind = {};
for (const r of T) for (const [k, v] of Object.entries(r.differ)) if (k.startsWith('arm-vs-branch')) byKind[k] = (byKind[k] ?? 0) + v;
say(`\n## Bar 2: branch against the arm's tree (ruledn1): ${diffs.length} differences${diffs.length ? ' (A STOP)' : ''}`);
for (const [k, v] of Object.entries(byKind)) say(`  ${k}: ${v}`);
for (const d of diffs.slice(0, 20)) say(`  ${d.pool}:${d.seed} i${d.i} T${d.T} ${d.k} tags ${d.tags} cc ${d.cc}: branch ${d.branch} | arm ${d.arm}`);

// bar 7
const kinds = [...new Set(T.flatMap(r => Object.keys(r.n)).filter(k => !k.includes('tagged')))].sort();
const ms = (r, a, k) => r.ms[`${a} ${k}`] ?? 0;
/** sum over games of a / sum of b, with its by-game jackknife error */
function ratio(games, a, b) {
  const v = sum(games.map(a)) / sum(games.map(b));
  const loo = games.map((_, i) => sum(games.filter((_, j) => j !== i).map(a)) / sum(games.filter((_, j) => j !== i).map(b)));
  const m = mean(loo);
  return { v, se: Math.sqrt(((games.length - 1) / games.length) * sum(loo.map(x => (x - m) ** 2))) };
}
say('\n## Bar 7: time per caller kind (seconds over the games; ratio with its by-game jackknife error)');
say('  caller: decisions | base / ctl / branch / arm | branch/base | ctl/base | arm/branch');
for (const k of kinds) {
  const n = sum(T.map(r => r.n[k] ?? 0));
  const s = a => sum(T.map(r => ms(r, a, k))) / 1000;
  const g = T.filter(r => (r.n[k] ?? 0) > 0);
  const br = ratio(g, r => ms(r, 'branch', k), r => ms(r, 'base', k));
  const cb = ratio(g, r => ms(r, 'ctl', k), r => ms(r, 'base', k));
  const ab = ratio(g, r => ms(r, 'arm', k), r => ms(r, 'branch', k));
  say(`  ${k}: ${n} | ${['base', 'ctl', 'branch', 'arm'].map(a => s(a).toFixed(1)).join(' / ')} | ${f3(br.v)} ± ${f3(br.se)} | ${f3(cb.v)} ± ${f3(cb.se)} | ${f3(ab.v)} ± ${f3(ab.se)}`);
}
const moved = {};
for (const r of T) for (const [k, v] of Object.entries(r.differ)) if (k.startsWith('branch ') || k.startsWith('ctl ')) moved[k] = (moved[k] ?? 0) + v;
say('  decisions that move against base: ' + Object.entries(moved).sort().map(([k, v]) => `${k} ${v}`).join(', '));

// N1's fallback
const fall = {};
for (const r of T) for (const [k, v] of Object.entries(r.work)) if (k.startsWith('cost ')) fall[k] = (fall[k] ?? 0) + v;
say('\n## N1: clock prices by the cost they read (arm tree; cost <flat|c1> <view> arm <caller>)');
const views = ['corp', 'runner'];
for (const k of kinds) {
  const c = v => fall[`cost c1 ${v} arm ${k}`] ?? 0;
  const fl = v => fall[`cost flat ${v} arm ${k}`] ?? 0;
  say(`  ${k}: ` + views.map(v => `${v} view flat ${fl(v)} of ${fl(v) + c(v)} (${fl(v) + c(v) ? ((100 * fl(v)) / (fl(v) + c(v))).toFixed(1) : '-'}%)`).join(', '));
}
const tf = v => sum(kinds.map(k => fall[`cost flat ${v} arm ${k}`] ?? 0));
const tc = v => sum(kinds.map(k => fall[`cost c1 ${v} arm ${k}`] ?? 0));
say('  all: ' + views.map(v => `${v} view flat ${tf(v)} of ${tf(v) + tc(v)} (${((100 * tf(v)) / Math.max(1, tf(v) + tc(v))).toFixed(1)}%)`).join(', '));
console.log(out.join('\n'));
