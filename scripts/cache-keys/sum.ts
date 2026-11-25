/**
 * F3 / R-80 count: sums count.ts's JSON lines (every shard's stdout) into the tables A to E as markdown, per pool and
 * group (each group's arms are read against that group's own ctl, asked beside them in the same process).
 *
 *   npx vite-node scripts/cache-keys/sum.ts -- IN=<dir or file>[,<more>] [OUT=<file.md>] [RECORDS=5]
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const i = kv.indexOf('=');
  process.env[kv.slice(0, i)] = kv.slice(i + 1);
}
const RECORDS = Number(process.env.RECORDS ?? 5);
const files: string[] = [];
const walk = (p: string) => {
  if (statSync(p).isDirectory()) for (const f of readdirSync(p)) walk(join(p, f));
  else if (/\.(txt|jsonl)$/.test(p)) files.push(p);
};
for (const p of (process.env.IN ?? '').split(',').filter(Boolean)) walk(p);

type Cell = { counts: Map<string, number>; records: any[]; deals: any[]; timedeals: any[]; evalMs: number };
const cells = new Map<string, Cell>(); // pool|group
const cellOf = (pool: string, group: string) => {
  const k = `${pool}|${group}`;
  if (!cells.has(k)) cells.set(k, { counts: new Map(), records: [], deals: [], timedeals: [], evalMs: 0 });
  return cells.get(k)!;
};
const drivers: any[] = [];
const errors: any[] = [];
let startLines = 0;
for (const f of files)
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    let x: any;
    try {
      x = JSON.parse(line);
    } catch {
      continue;
    }
    if (x.kind === 'counts') {
      const p = cellOf(x.pool, x.group);
      for (const [k, v] of Object.entries(x.counts)) p.counts.set(k, (p.counts.get(k) ?? 0) + (v as number));
      p.records.push(...x.records);
      p.evalMs += x.evalMs;
    } else if (x.kind === 'deal') cellOf(x.pool, x.group).deals.push(x);
    else if (x.kind === 'timedeal') cellOf(x.pool, x.group).timedeals.push(x);
    else if (x.kind === 'driver') drivers.push(x);
    else if (x.kind === 'error' || x.kind === 'stopped') errors.push(x);
    else if (x.kind === 'start') startLines++;
  }

const lines: string[] = [];
const say = (s = '') => lines.push(s);
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(a && a / b < 0.001 ? 3 : 1)}%` : '-');
const n0 = (x: number | undefined) => Math.round(x ?? 0).toLocaleString('en-US');
const ratio = (a: number, b: number) => (b ? `x${(a / b).toFixed(3)}` : '-');
const MAPS = ['threats', 'deckAverage', 'clickCache'];
const ARM_MAPS: Record<string, string[]> = { t: ['threats'], d: ['deckAverage'], c: ['clickCache'], all: MAPS, b: MAPS, all4: MAPS };
const mapsOf = (tree: string) => (tree === 'ctl' ? MAPS : tree === 'f.threat' ? ['threats'] : tree === 'f.deck' ? ['deckAverage'] : ARM_MAPS[tree.split('.')[0]]);
const sortTrees = (ts: string[]) => [...new Set(ts)].sort((a, b) => (a === 'ctl' ? -1 : b === 'ctl' ? 1 : a.localeCompare(b)));

say(`# F3 / R-80 count: tables`);
say();
say(`Inputs: ${files.length} files, ${startLines} processes. Errors and stops: ${errors.length}.`);
for (const e of errors.slice(0, 10)) say(`- ${JSON.stringify(e).slice(0, 400)}`);
say();

const order = [...cells.keys()].sort();
for (const cellKey of order) {
  const [pool, group] = cellKey.split('|');
  const P = cells.get(cellKey)!;
  const c = P.counts;
  const keys = [...c.keys()];
  const g = (k: string) => c.get(k) ?? 0;
  const sumOf = (re: RegExp) => keys.filter(k => re.test(k)).reduce((n, k) => n + c.get(k)!, 0);
  const trees = sortTrees(keys.filter(k => /^(N|MS)\|/.test(k)).map(k => k.split('|')[1]));
  const kinds = [...new Set(keys.filter(k => /^D\|/.test(k) && k.endsWith('|n')).map(k => k.split('|').slice(1, 3).join('|')))].sort();
  say(`## ${pool}, group ${group}`);
  say();
  const deals = P.deals;
  say(`**Bars.** Deals ${deals.length}; the source game equals the record on ${deals.filter(d => d.recordSame).length}${deals.some(d => !d.recordSame) ? ` (not: ${deals.filter(d => !d.recordSame).map(d => d.seed).join(', ')})` : ''}. ctl's answer differs from the source's on ${n0(sumOf(/^CH\|ctl\|/))} of ${n0(sumOf(/^D\|.*\|n$/))} decisions (time pass: ${n0(sumOf(/^time:CH\|ctl\|/))} of ${n0(sumOf(/^time:D\|.*\|n$/))}). Ask errors: ${n0(sumOf(/ERR\|/))}.`);
  say();

  // A
  say(`### A. Wrong hits (on-hit audit, tracked entries)`);
  say();
  say(`"key": right on its own board when stored, served to another board. "fill": already wrong when stored (something read inside it was another board's). Off arms have no entries: every value they work out is checked as a fill.`);
  say();
  say(`| tree | map | hits checked | wrong (key) | wrong (fill) | of which > 0.001 | fills checked | fills wrong | eval s |`);
  say(`|---|---|--:|--:|--:|--:|--:|--:|--:|`);
  for (const tree of trees)
    for (const map of mapsOf(tree) ?? []) {
      const pre = `\\|${tree.replace(/\./g, '\\.')}\\|${map}\\|[^|]+\\|[^|]+\\|`;
      say(
        `| ${tree} | ${map} | ${n0(sumOf(new RegExp(`^A${pre}checked$`)))} | ${n0(sumOf(new RegExp(`^A${pre}wrong\\|key$`)))} | ${n0(sumOf(new RegExp(`^A${pre}wrong\\|fill$`)))} | ${n0(sumOf(new RegExp(`^A${pre}wrong>0.001\\|`)))} | ${n0(sumOf(new RegExp(`^F${pre}checked$`)))} | ${n0(sumOf(new RegExp(`^F${pre}wrong$`)))} | ${tree === 'ctl' ? n0(g(`EV|${map}`) / 1000) : ''} |`
      );
    }
  say();
  say(`By caller class (side, kind), wrong hits only:`);
  say();
  say(`| tree | map | side | kind | hits checked | wrong (key) | wrong (fill) |`);
  say(`|---|---|---|---|--:|--:|--:|`);
  const classes = [...new Set(keys.filter(k => k.startsWith('A|')).map(k => k.split('|').slice(1, 5).join('|')))].sort();
  for (const cls of classes) {
    const [tree, map] = cls.split('|');
    if (!mapsOf(tree)?.includes(map)) continue;
    const wk = g(`A|${cls}|wrong|key`);
    const wf = g(`A|${cls}|wrong|fill`);
    if (wk + wf) say(`| ${cls.split('|').join(' | ')} | ${n0(g(`A|${cls}|checked`))} | ${n0(wk)} | ${n0(wf)} |`);
  }
  say();

  // B
  say(`### B. Hits, misses and time`);
  say();
  say(`| tree | map | calls | hits | misses | hit rate | hits kept of ctl's | cap clears |`);
  say(`|---|---|--:|--:|--:|--:|--:|--:|`);
  const N = (tree: string, map: string, what: string) => sumOf(new RegExp(`^N\\|${tree.replace(/\./g, '\\.')}\\|${map}\\|[^|]+\\|${what}$`));
  for (const tree of trees)
    for (const map of MAPS) {
      if (tree !== 'ctl' && !mapsOf(tree)?.includes(map)) continue;
      const hits = N(tree, map, 'hit');
      const miss = N(tree, map, 'miss');
      say(`| ${tree} | ${map} | ${n0(N(tree, map, 'call'))} | ${n0(hits)} | ${n0(miss)} | ${pct(hits, hits + miss)} | ${tree === 'ctl' ? '' : pct(hits, N('ctl', map, 'hit'))} | ${n0(N(tree, map, 'capClear'))} |`);
    }
  say();
  for (const pass of ['time:', '']) {
    if (!keys.some(k => k.startsWith(`${pass}MS|`))) continue;
    say(pass ? `Decision time against ctl, the time pass (no hook at all; "slow": decisions where ctl took over a second):` : `Decision time against ctl, the audit pass (hooks and the audit's bookkeeping in; the eval tree's time taken off; for reference only):`);
    say();
    const tk = [...new Set(keys.filter(k => k.startsWith(`${pass}D|`) && k.endsWith('|n')).map(k => k.slice(pass.length).split('|').slice(1, 3).join('|')))].sort();
    say(`| tree | ${tk.map(k => `${k}`).join(' | ')} | ${tk.map(k => `${k} slow`).join(' | ')} | Corp | Runner | Corp slow | Runner slow |`);
    say(`|---|${tk.map(() => '--:').join('|')}|${tk.map(() => '--:').join('|')}|--:|--:|--:|--:|`);
    say(`| decisions | ${tk.map(k => n0(g(`${pass}D|${k}|n`))).join(' | ')} | ${tk.map(k => n0(g(`${pass}D|${k}|slow`))).join(' | ')} | | | | |`);
    const side = (tree: string, s: string, slow: boolean) => sumOf(new RegExp(`^${pass}${slow ? 'MSslow' : 'MS'}\\|${tree.replace(/\./g, '\\.')}\\|${s}\\|`));
    for (const tree of trees) {
      if (tree === 'ctl') {
        say(`| ctl ms | ${tk.map(k => n0(g(`${pass}MS|ctl|${k}`))).join(' | ')} | ${tk.map(k => n0(g(`${pass}MSslow|ctl|${k}`))).join(' | ')} | ${n0(side('ctl', 'corp', false))} | ${n0(side('ctl', 'runner', false))} | ${n0(side('ctl', 'corp', true))} | ${n0(side('ctl', 'runner', true))} |`);
        continue;
      }
      say(
        `| ${tree} | ${tk.map(k => ratio(g(`${pass}MS|${tree}|${k}`), g(`${pass}MS|ctl|${k}`))).join(' | ')} | ${tk.map(k => ratio(g(`${pass}MSslow|${tree}|${k}`), g(`${pass}MSslow|ctl|${k}`))).join(' | ')} | ${ratio(side(tree, 'corp', false), side('ctl', 'corp', false))} | ${ratio(side(tree, 'runner', false), side('ctl', 'runner', false))} | ${ratio(side(tree, 'corp', true), side('ctl', 'corp', true))} | ${ratio(side(tree, 'runner', true), side('ctl', 'runner', true))} |`
      );
    }
    say();
  }
  const playTrees = sortTrees(deals.flatMap(d => Object.keys(d.plays ?? {})));
  if (playTrees.includes('ctl')) {
    say(`Whole-game time of each tree's own play against ctl's own play (no hook), on the deals where its record equals the base record:`);
    say();
    for (const tree of playTrees.filter(t => t !== 'ctl')) {
      const ds = deals.filter(d => d.plays?.[tree]?.same && d.plays?.ctl);
      say(`- ${tree}: ${ratio(ds.reduce((n, d) => n + d.plays[tree].ms, 0), ds.reduce((n, d) => n + d.plays.ctl.ms, 0))} over ${ds.length} deals`);
    }
    say();
  }

  // C
  say(`### C. Picks that change`);
  say();
  say(`| tree | ${kinds.join(' | ')} | all |`);
  say(`|---|${kinds.map(() => '--:').join('|')}|--:|`);
  say(`| decisions | ${kinds.map(k => n0(g(`D|${k}|n`))).join(' | ')} | ${n0(kinds.reduce((n, k) => n + g(`D|${k}|n`), 0))} |`);
  for (const tree of trees) say(`| ${tree} | ${kinds.map(k => n0(g(`CH|${tree}|${k}`))).join(' | ')} | ${n0(kinds.reduce((n, k) => n + g(`CH|${tree}|${k}`), 0))} |`);
  say();
  say(`Own play: deals whose record differs from the base record, and where the winner went.`);
  say();
  say(`| tree | deals | record differs | winner moved | to Corp | to Runner |`);
  say(`|---|--:|--:|--:|--:|--:|`);
  for (const tree of playTrees) {
    const ps = deals.filter(d => d.plays?.[tree]).map(d => ({ d, p: d.plays[tree] }));
    const moved = ps.filter(x => x.p.winner !== x.d.recWinner);
    say(`| ${tree} | ${ps.length} | ${ps.filter(x => !x.p.same).length} | ${moved.length} | ${moved.filter(x => x.p.winner === 'corp').length} | ${moved.filter(x => x.p.winner === 'runner').length} |`);
  }
  say();
  const diffs = deals.flatMap(d => (d.diffs ?? []).map((x: any) => ({ seed: d.seed, ...x })));
  if (diffs.length) {
    say(`Differing decisions (first ${Math.min(RECORDS * 6, diffs.length)} of ${diffs.length} listed by the shards):`);
    say();
    for (const x of diffs.slice(0, RECORDS * 6)) say(`- ${x.seed} ${x.tree} ${x.side} ${x.kind} T${x.T} #${x.decision}: ${x.answer.slice(0, 110)} / source ${x.source.slice(0, 110)}${x.ctlWrong?.length ? `; ctl's wrong hits in that decision: ${x.ctlWrong.map((w: any) => `${w.map} ${w.kind} served ${JSON.stringify(w.served)} own ${JSON.stringify(w.own)}`).join('; ')}` : ''}`);
    say();
  }

  // E
  const oKeys = keys.filter(k => k.startsWith('O|'));
  if (oKeys.length) {
    say(`### E. The other maps (hits worked out again in the eval tree)`);
    say();
    say(`| tree | map | hits checked | wrong | wrong by class |`);
    say(`|---|---|--:|--:|---|`);
    const tm = [...new Set(oKeys.map(k => k.split('|').slice(1, 3).join('|')))].sort();
    for (const x of tm) {
      const cls = [...new Set(oKeys.filter(k => k.startsWith(`O|${x}|`)).map(k => k.split('|').slice(3, 5).join(' ')))];
      const by = cls.map(k => [k, g(`O|${x}|${k.replace(' ', '|')}|wrong`)] as const).filter(([, n]) => n);
      say(`| ${x.split('|').join(' | ')} | ${n0(sumOf(new RegExp(`^O\\|${x.replace(/\./g, '\\.').replace('|', '\\|')}\\|.*\\|checked$`)))} | ${n0(sumOf(new RegExp(`^O\\|${x.replace(/\./g, '\\.').replace('|', '\\|')}\\|.*\\|wrong$`)))} | ${by.map(([k, n]) => `${k} ${n}`).join(', ')} |`);
    }
    say();
  }
  if (P.records.length) {
    say(`### Records (up to ${RECORDS} per class)`);
    say();
    const seen = new Map<string, number>();
    for (const r of P.records) {
      if ((seen.get(r.cls) ?? 0) >= RECORDS) continue;
      seen.set(r.cls, (seen.get(r.cls) ?? 0) + 1);
      say(`- ${JSON.stringify(r).slice(0, 400)}`);
    }
    say();
  }
}

if (drivers.length) {
  say(`## D. The batch driver against plain play (g3 deals)`);
  say();
  say(`| group | tree | seed | plain = logged | logged = g3 record | plain = g3 record |`);
  say(`|---|---|--:|---|---|---|`);
  for (const d of drivers) say(`| ${d.group} | ${d.tree} | ${d.seed} | ${d.plainEqualsLogged ? 'yes' : '**no**'} | ${d.loggedEqualsRecord ? 'yes' : 'no'} | ${d.plainEqualsRecord ? 'yes' : 'no'} |`);
  say();
}

const text = lines.join('\n') + '\n';
if (process.env.OUT) writeFileSync(process.env.OUT, text);
else console.log(text);
