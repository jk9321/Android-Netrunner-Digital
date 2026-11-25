/**
 * Sums count.ts's shard outputs into part 2's tables, one block per pool (the pools are never added together).
 *
 *   npx vite-node scripts/pricing-context/sum.ts -- IN=<dir of shard outputs> OUT=<file.md> [GRAPH=<static-graph json>]
 *
 * IN holds count.ts's JSON lines (any file name); GRAPH (default: built fresh by static-graph.ts) names the reads and the
 * setter calls by file and line.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const i = kv.indexOf('=');
  process.env[kv.slice(0, i)] = kv.slice(i + 1);
}
const IN = process.env.IN ?? '';
const OUT = process.env.OUT ?? '';
let GRAPH = process.env.GRAPH ?? '';
if (!GRAPH) {
  GRAPH = '/tmp/pricing-context-graph.json';
  execSync(`npx vite-node scripts/pricing-context/static-graph.ts -- OUT=${GRAPH}`, { stdio: 'ignore' });
}
const graph = JSON.parse(readFileSync(GRAPH, 'utf8'));
const READS: { what: string; field: string; file: string; line: number; unit: string; text: string }[] = graph.reads;
const SETS: { setter: string; file: string; line: number; fields: string[]; unit: string }[] = graph.scopes;

type Pool = {
  counts: Record<string, number>;
  maxes: Record<string, number>;
  timeIn: Record<string, Record<string, number>>;
  ms: { hooked: Record<string, number>; control: Record<string, number> };
  records: Record<string, unknown>[];
  sizes: Record<string, Record<string, number>>;
  evalMs: number;
  deals: number;
  same: number;
  differ: string[];
  errors: string[];
  shards: number;
};
const pools = new Map<string, Pool>();
const pool = (p: string): Pool => {
  let x = pools.get(p);
  if (!x) pools.set(p, (x = { counts: {}, maxes: {}, timeIn: {}, ms: { hooked: {}, control: {} }, records: [], sizes: {}, evalMs: 0, deals: 0, same: 0, differ: [], errors: [], shards: 0 }));
  return x;
};
const add = (a: Record<string, number>, b: Record<string, number>) => {
  for (const [k, v] of Object.entries(b ?? {})) a[k] = (a[k] ?? 0) + v;
};
for (const f of readdirSync(IN)) {
  for (const line of readFileSync(join(IN, f), 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const pl = o.pool ?? (o.kind === 'human' ? 'human' : '?');
    if (o.kind === 'deal' || o.kind === 'human') {
      const P = pool(pl);
      P.deals++;
      if (o.recordSame === false || o.diverged) P.differ.push(`${o.seed ?? o.file}${o.diverged ? ` (${o.diverged})` : ''}`);
      else P.same++;
    } else if (o.kind === 'counts') {
      const P = pool(pl);
      P.shards++;
      add(P.counts, o.counts);
      for (const [k, v] of Object.entries(o.maxes ?? {}) as [string, number][]) P.maxes[k] = Math.max(P.maxes[k] ?? 0, v);
      for (const [s, m] of Object.entries(o.timeIn ?? {}) as [string, Record<string, number>][]) add((P.timeIn[s] ??= {}), m);
      add(P.ms.hooked, o.ms?.hooked);
      add(P.ms.control, o.ms?.control);
      P.records.push(...(o.records ?? []));
      for (const [k, m] of Object.entries(o.sizes ?? {}) as [string, Record<string, number>][]) add((P.sizes[k] ??= {}), m);
      P.evalMs += o.evalMs ?? 0;
    } else if (o.kind === 'error') pool(pl).errors.push(`${o.seed ?? o.file}: ${String(o.error).slice(0, 160)}`);
  }
}

const fmt = (n: number) => n.toLocaleString('en-US');
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
const where = (r: { file: string; line: number }) => `${r.file.replace(/^src\//, '')}:${r.line}`;
const table = (head: string[], rows: (string | number)[][]) =>
  [`| ${head.join(' | ')} |`, `|${head.map((_, i) => (i ? '---:' : '---')).join('|')}|`, ...rows.map(r => `| ${r.map(x => (typeof x === 'number' ? fmt(x) : x)).join(' | ')} |`)].join('\n');
const parts = (k: string) => k.split('|');
const KINDS = ['decider', 'lookahead', 'reply', 'oracle', 'hard'];
const lines: string[] = [];
const out = (x: string) => lines.push(x);
out(`# Part 2: pricing.ts's context counted on the pools\n`);
out(`Inputs: ${IN}. Kinds: decider = the deciding agent's own code (outside any nested GameRunner and outside the planner's turn play-out), lookahead = inside planTurn (the Corp's turn planner play-out) or the Runner's own playouts, reply = a nested GameRunner (the other side answering inside a look-ahead), oracle and hard = those GameRunner scopes. "Corp decision" / "Runner decision" = the side whose top-level step it is.\n`);
for (const [name, P] of pools) {
  out(`\n## Pool ${name}: ${P.deals} games (${P.same} play identical to the base record${P.differ.length ? `; differ: ${P.differ.join(', ')}` : ''}), ${P.shards} shard outputs${P.errors.length ? `; errors: ${P.errors.join('; ')}` : ''}\n`);

  // 1. per guard
  out(`### 1. Per field: setter entries (changed / same value), reads that see it set and clear, deepest nesting\n`);
  const fields = [...new Set(READS.map(r => (r.field.startsWith('plan.') ? 'plan' : r.what === 'actingSide()' ? 'side' : r.field)).concat(['anchor', 'known.corp', 'known.runner', 'rezzingToUse']))].sort();
  const rowsG: (string | number)[][] = [];
  for (const f of fields) {
    let ch = 0;
    let sm = 0;
    const byKind: Record<string, number> = {};
    for (const [k, v] of Object.entries(P.counts)) {
      const p = parts(k);
      if (p[0] !== 'E') continue;
      const c = p[5].split(',').filter(Boolean);
      const s = p[6].split(',').filter(Boolean);
      const hit = (x: string[]) => x.includes(f) || (f === 'known' && x.some(y => y.startsWith('known.')));
      if (hit(c)) ch += v;
      if (hit(s)) sm += v;
      if (hit(c) || hit(s)) byKind[p[3]] = (byKind[p[3]] ?? 0) + v;
    }
    let set = 0;
    let clear = 0;
    for (const [k, v] of Object.entries(P.counts)) {
      const p = parts(k);
      if (p[0] !== 'R') continue;
      const r = READS[Number(p[1])];
      const rf = r.field.startsWith('plan.') ? 'plan' : r.what === 'actingSide()' ? 'side' : r.field;
      if (rf !== f && !(f.startsWith('known.') && rf === 'known')) continue;
      if (f.startsWith('known.')) continue;
      if (p[6] === 'set') set += v;
      else clear += v;
    }
    const deep = Math.max(0, ...Object.entries(P.maxes).filter(([k]) => k.startsWith(`M|${f}|`)).map(([, v]) => v));
    if (!ch && !sm && !set && !clear) continue;
    rowsG.push([f, ch, sm, KINDS.map(k => (byKind[k] ? `${k} ${fmt(byKind[k])}` : '')).filter(Boolean).join(', ') || '-', set, clear, deep || '-']);
  }
  out(table(['field', 'entries changing it', 'entries setting the same value', 'entries by kind', 'reads under a setter of it', 'reads with no setter of it on the stack', 'deepest nesting'], rowsG));

  // 2. per setter
  out(`\n### 2. Per setter call: calls, what they change, nesting\n`);
  const rowsS: (string | number)[][] = [];
  SETS.forEach((s, id) => {
    let calls = 0;
    let none = 0;
    const changed: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    for (const [k, v] of Object.entries(P.counts)) {
      const p = parts(k);
      if (p[0] !== 'E' || p[1] !== String(id)) continue;
      calls += v;
      byKind[p[3]] = (byKind[p[3]] ?? 0) + v;
      if (!p[5]) none += v;
      for (const c of p[5].split(',').filter(Boolean)) changed[c] = (changed[c] ?? 0) + v;
    }
    rowsS.push([`${s.setter} ${where(s)}`, calls, Object.entries(changed).map(([c, n]) => `${c} ${fmt(n)}`).join(', ') || '-', none ? `${fmt(none)} (${pct(none, calls)})` : '0', KINDS.map(k => (byKind[k] ? `${k} ${fmt(byKind[k])}` : '')).filter(Boolean).join(', ') || '-']);
  });
  const rz = Object.entries(P.counts).filter(([k]) => k.startsWith('E|rezzingToUse|')).reduce((a, [, v]) => a + v, 0);
  rowsS.push(['rezzingToUse add (rez.ts:405, outside the entry points)', rz, 'rezzingToUse', '-', '-']);
  out(table(['setter call', 'calls', 'fields changed (calls)', 'calls that change nothing', 'by kind'], rowsS));
  const depth: Record<string, { n: number; over1: number }> = {};
  for (const [k, v] of Object.entries(P.counts)) {
    const p = parts(k);
    if (p[0] !== 'D') continue;
    const d = (depth[p[1]] ??= { n: 0, over1: 0 });
    d.n += v;
    if (Number(p[2]) > 1) d.over1 += v;
  }
  out(
    '\n' +
      table(
        ['entry point', 'calls', 'max depth (same entry point)', 'calls nested in the same entry point', 'max depth (any entry point)'],
        Object.entries(depth).map(([s, d]) => [s, d.n, P.maxes[`MD|${s}`] ?? '-', `${fmt(d.over1)} (${pct(d.over1, d.n)})`, P.maxes[`MA|${s}`] ?? '-'])
      )
  );

  // 3 and 6. per reader
  out(`\n### 3 and 6. Per read: count by caller kind, reads with no setter of its field on the stack, reads with the whole stack empty (the default context at top level); split by deciding side and actingSide()\n`);
  const rowsR: (string | number)[][] = [];
  READS.forEach((r, id) => {
    let n = 0;
    let nodef = 0;
    let empty = 0;
    const byKind: Record<string, number> = {};
    const bySide: Record<string, number> = {};
    const states: Record<string, number> = {};
    for (const [k, v] of Object.entries(P.counts)) {
      const p = parts(k);
      if (p[0] !== 'R' || p[1] !== String(id)) continue;
      n += v;
      byKind[p[3]] = (byKind[p[3]] ?? 0) + v;
      bySide[`${p[2]}/${p[4]}`] = (bySide[`${p[2]}/${p[4]}`] ?? 0) + v;
      states[p[5]] = (states[p[5]] ?? 0) + v;
      if (p[6] === 'nodef') nodef += v;
      if (p[7] === 'empty') empty += v;
    }
    if (!n) return;
    rowsR.push([
      id,
      `${r.what === 'pricing()' ? r.field : r.what} ${where(r)}`,
      n,
      KINDS.map(k => (byKind[k] ? `${k} ${fmt(byKind[k])}` : '')).filter(Boolean).join(', '),
      Object.entries(bySide).map(([s, c]) => `${s} ${fmt(c)}`).join(', '),
      Object.entries(states).map(([s, c]) => `${s} ${fmt(c)}`).join(', '),
      nodef,
      empty,
    ]);
  });
  out(table(['#', 'read', 'reads', 'by kind', 'deciding side / actingSide()', 'value seen', 'no setter of it on the stack', 'stack empty'], rowsR));
  const unread = READS.map((r, id) => (rowsR.some(x => x[0] === id) ? null : `${id} ${r.what === 'pricing()' ? r.field : r.what} ${where(r)}`)).filter(Boolean);
  out(`\nReads never reached in this pool (${unread.length}): ${unread.join('; ')}\n`);

  // 4. guards by deciding side
  out(`\n### 4. Fields read under a Corp decision and under a Runner decision\n`);
  const reach: Record<string, Record<string, number>> = {};
  for (const [k, v] of Object.entries(P.counts)) {
    const p = parts(k);
    if (p[0] !== 'R') continue;
    const r = READS[Number(p[1])];
    const f = r.what === 'pricing()' ? r.field : r.what;
    (reach[f] ??= {})[p[2]] = (reach[f][p[2]] ?? 0) + v;
  }
  out(table(['field / reader', 'reads in a Corp decision', 'reads in a Runner decision'], Object.entries(reach).sort().map(([f, m]) => [f, m.corp ?? 0, m.runner ?? 0])));

  // 5. time
  out(`\n### 5. Time\n`);
  const tRows: (string | number)[][] = [];
  for (const s of ['corp', 'runner']) {
    const h = P.ms.hooked[s] ?? 0;
    const c = P.ms.control[s] ?? 0;
    const inside = P.timeIn[s] ?? {};
    tRows.push([`${s} decisions`, P.ms.hooked[`n${s[0].toUpperCase()}${s.slice(1)}`] ?? 0, fmt(Math.round(c)), fmt(Math.round(h)), Object.entries(inside).map(([k, v]) => `${k} ${v.toFixed(0)} ms (${pct(v, h)})`).join(', ')]);
  }
  out(table(['', 'decisions', 'control ms (no hooks)', 'hooked ms', 'inside the timed entry points (share of hooked time)'], tRows));

  // 6. stale reads
  out(`\n### 6. anchor and known reads by who noted the value (same = noted by the reading decision at the same kind and acting side; outer = noted by the deciding agent above this look-ahead or reply)\n`);
  const st: Record<string, number> = {};
  for (const [k, v] of Object.entries(P.counts)) {
    const p = parts(k);
    if (p[0] !== 'S') continue;
    const key = `${p[1]}|${p[3]}|${p[4]}|${p[6]}${p[7] ? ` (${p[7]})` : ''}`;
    st[key] = (st[key] ?? 0) + v;
  }
  out(table(['field', 'deciding side', 'kind', 'noted by', 'reads'], Object.entries(st).sort().map(([k, v]) => [...k.split('|'), v])));
  out(`\nAt each top-level decision's start, who noted the anchor and each known entry it starts with:\n`);
  const bo: Record<string, number> = {};
  for (const [k, v] of Object.entries(P.counts)) if (k.startsWith('B|')) bo[k.slice(2)] = (bo[k.slice(2)] ?? 0) + v;
  out(table(['field', 'deciding side', 'decision', 'last noted by', 'decisions'], Object.entries(bo).sort().map(([k, v]) => [...k.split('|'), v])));

  // 7. does a stale or unkeyed value change a number
  out(`\n### 7. Does a stale or unkeyed value change a number\n`);
  const a7 = Object.entries(P.counts).filter(([k]) => k.startsWith('A7a|'));
  out(`(a) Reads of anchor or known by a top-level decision before its own first note (decisionContext's own read of the last anchor excluded):\n`);
  out(a7.length ? table(['field', 'deciding side', 'the value against a fresh note', 'reads'], a7.map(([k, v]) => [...parts(k).slice(1), v])) : 'none');
  const q = Object.entries(P.counts).filter(([k]) => k.startsWith('Q|'));
  const qa = Object.entries(P.counts).filter(([k]) => k.startsWith('QA|'));
  out(`\n(b) Questions asked under an anchor or known entry noted elsewhere (all calls, by class):\n`);
  out(table(['question', 'deciding side', 'kind', 'acting', 'noted by', 'calls'], q.map(([k, v]) => [...parts(k).slice(1), v])));
  out(`\nRe-asked right after a fresh note of the reading decision's board, in a cache-free sandbox (at most CAP per question and class per shard), with a control re-ask under the same context:\n`);
  out(qa.length ? table(['question', 'deciding side', 'kind', 'noted by', 'answer against the fresh note', 'control', 're-asks'], qa.map(([k, v]) => [...parts(k).slice(1), v])) : 'none re-asked');
  const h = Object.entries(P.counts).filter(([k]) => k.startsWith('H|'));
  const ha = Object.entries(P.counts).filter(([k]) => k.startsWith('HA|'));
  out(`\n(c) Memo hits (valueModel.ts memos) by what differs between the fill and the hit:\n`);
  out(table(['differs at the hit', 'deciding side', 'kind', 'filled by', 'hits'], h.map(([k, v]) => [...parts(k).slice(1), v])));
  out(`\nRecomputed in the sandbox (containers not compared):\n`);
  out(ha.length ? table(['differs at the hit', 'memo', 'recomputed against the stored value', 'control (recomputed under the fill context)', 'hits'], ha.map(([k, v]) => [...parts(k).slice(1).concat(parts(k).length === 4 ? [''] : []), v])) : 'none recomputed');
  // 8. the incomplete-key caches
  out(`\n### 8. Hits of the caches whose key is known incomplete (AI-CACHE-HIDDEN-STATE), each worked out again on the asking board in the eval tree (every cache there serving nothing)\n`);
  const inc8: (string | number)[][] = [];
  for (const [k, v] of Object.entries(P.counts)) {
    const p = parts(k);
    if (p[0] !== 'I' || p[4] !== 'hit') continue;
    const cls = p.slice(1, 4).join('|');
    const dif = P.counts[`I|${cls}|differs`] ?? 0;
    const e = Object.entries(P.sizes[cls] ?? {}).map(([d, n]) => [Number(d), n] as [number, number]).sort((a, b) => a[0] - b[0]);
    const N = e.reduce((a, b) => a + b[1], 0);
    let c = 0;
    let med: number | string = '-';
    for (const [d, n] of e) {
      c += n;
      if (c >= N / 2) {
        med = d;
        break;
      }
    }
    inc8.push([...p.slice(1, 4), v, dif, pct(dif, v), med, e.length ? e[e.length - 1][0] : '-']);
  }
  inc8.sort((a, b) => String(a[0] + '' + a[1] + a[2]).localeCompare(String(b[0] + '' + b[1] + b[2])));
  out(inc8.length ? table(['cache', 'deciding side', 'kind', 'hits', 'differ by more than 0.001', 'share', 'median difference', 'largest'], inc8) : 'none (NO_EVAL=1)');
  out(`\nEval-tree time: ${fmt(Math.round(P.evalMs))} ms (left out of the hooked decision times above). For threats the difference is the larger of |burst| and |share|.\n`);
  if (P.records.length) {
    out(`\nRecords (up to five per class per shard; boards under each shard's boards/):\n`);
    for (const r of P.records.slice(0, 60)) out('- `' + JSON.stringify(r).slice(0, 600) + '`');
  }
}
// Value caches cleared whole at a size cap (static, this checkout's src)
out(`\n## Caches cleared at a size cap (static, src/ai)\n`);
const caps: (string | number)[][] = [];
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.ts') ? [join(d, e.name)] : []));
for (const f of walk('src')) readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
  const m = /if \((\w+)\.size > (\d+)\) \1\.clear\(\)/.exec(l);
  if (m) caps.push([m[1], `${f.replace(/^src\//, '')}:${i + 1}`, m[2], m[1] === 'deckAverage' || m[1] === 'threats' ? 'yes (AI-CACHE-HIDDEN-STATE)' : 'no']);
});
out(table(['cache', 'clear at', 'cap (entries)', 'key known incomplete'], caps));
const text = lines.join('\n') + '\n';
if (OUT) writeFileSync(OUT, text);
else console.log(text);
