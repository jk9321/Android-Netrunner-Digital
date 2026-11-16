// Valuation V-A: adds up the disagreement log's shards (scripts/value-owners/log.ts, one value-log.json per shard) into
// one markdown report: asks per site and where they were asked, known-answer check 1 (the owner's number again equals
// the number play got, n of n), each copy against its owner as the registry states the comparison, and the Corp formula
// columns (cost once: f(0) - cost, with linearity in the cost; perTurn's risk at 0.06 against the measured risks).
//   node scripts/value-owners/sum.mjs <dir holding the shards' value-log.json, at any depth> > report.md
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? '.';
const files = [];
const walk = d => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f === 'value-log.json') files.push(p);
  }
};
walk(dir);
if (!files.length) {
  console.error(`no value-log.json under ${dir}`);
  process.exit(1);
}

const TAGS = ['root', 'leaf', 'playout', 'reply', 'outside'];
const asks = {};
const known = {};
const pairs = {};
const formulas = {};
const errors = [];
const examples = {};
const JEFF = /human:report-(4[89]|5[0-4])\.json$/;
let sources = 0;
let playMs = 0;
let passMs = 0;
let formulaBoards = 0;
for (const f of files) {
  const j = JSON.parse(readFileSync(f, 'utf8'));
  sources += j.sources;
  playMs += j.playMs;
  passMs += j.passMs;
  formulaBoards += j.formulaBoards;
  errors.push(...j.errors);
  for (const [site, e] of Object.entries(j.examples ?? {})) if (!examples[site] || (!JEFF.test(examples[site].src) && JEFF.test(e.src))) examples[site] = e;
  for (const [site, c] of Object.entries(j.asks)) {
    const a = (asks[site] ??= Object.fromEntries(TAGS.map(t => [t, 0])));
    for (const t of TAGS) a[t] += c[t] ?? 0;
  }
  for (const [site, e] of Object.entries(j.known)) {
    const k = (known[site] ??= { n: 0, equal: 0, worst: 0, examples: [] });
    k.n += e.n;
    k.equal += e.equal;
    k.worst = Math.max(k.worst, e.worst);
    k.examples.push(...e.examples);
  }
  for (const [name, e] of Object.entries(j.pairs)) (pairs[name] ??= { q: e.q, pairs: [] }).pairs.push(...e.pairs);
  for (const [code, r] of Object.entries(j.formulas)) {
    const row = (formulas[code] ??= { title: r.title, cost: r.cost, n: 0, gap: [], slopes: [], today: [], bare: [], iced: [] });
    row.n += r.n;
    row.gap.push(...r.gap);
    row.slopes.push(...r.slopes);
    row.today.push(...r.risk.today);
    row.bare.push(...r.risk.bare);
    row.iced.push(...r.risk.iced);
  }
}

const f2 = x => (Number.isFinite(x) ? x.toFixed(2) : String(x));
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (xs, p) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const SAME = 1e-6;
const out = [];
const w = s => out.push(s);

w(`# Valuation V-A disagreement log`);
w('');
w(`${files.length} shards, ${sources} sources (deals and Jeff's games), play ${(playMs / 60000).toFixed(1)} min, pass ${(passMs / 60000).toFixed(1)} min (summed over shards).`);
w('');
w('## Asks per site, by where in the decision');
w('Counted only at the hook sites in the eight valuation files (ruling 4a). root: the decision itself; leaf: a planner leaf; playout: a frozen play-out; reply: a reply board; outside: no deciding side.');
w('');
w('| quantity site | root | leaf | playout | reply | outside | total |');
w('|---|--:|--:|--:|--:|--:|--:|');
for (const [site, a] of Object.entries(asks).sort((x, y) => sum(y[1]) - sum(x[1]))) w(`| ${site} | ${TAGS.map(t => a[t]).join(' | ')} | ${sum(a)} |`);
w('');
function sum(a) {
  return TAGS.reduce((n, t) => n + a[t], 0);
}

w('## Known-answer check 1: the owner priced again equals what play got');
w('Each sample priced again in its own pass, its pricing context restored and the incomplete-key caches cleared.');
w('');
w('| site | n | equal | worst gap | examples |');
w('|---|--:|--:|--:|---|');
let kn = 0;
let ke = 0;
for (const [site, k] of Object.entries(known).sort()) {
  kn += k.n;
  ke += k.equal;
  w(`| ${site} | ${k.n} | ${k.equal} | ${f2(k.worst)} | ${k.examples.slice(0, 2).join('; ')} |`);
}
w(`| **all** | **${kn}** | **${ke}** | | |`);
w('');

w('## Copies against their owners');
w('d = copy - owner, on the sampled boards. "differ" counts |d| over 1e-6.');
w('');
w('| quantity | comparison | n | differ | mean d | mean abs d | p10 / p50 / p90 d | max abs d | largest (note, where) |');
w('|---|---|--:|--:|--:|--:|---|--:|---|');
for (const [name, e] of Object.entries(pairs).sort((x, y) => x[1].q.localeCompare(y[1].q) || x[0].localeCompare(y[0]))) {
  const ds = e.pairs.map(p => p.d);
  const abs = ds.map(Math.abs);
  const differ = abs.filter(a => a > SAME).length;
  const top = [...e.pairs].sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 2).map(p => `${f2(p.copy)} vs ${f2(p.owner)}${p.note ? ` (${p.note})` : ''} ${p.src} t${p.turn} ${p.tag}`);
  w(`| ${e.q} | ${name} | ${ds.length} | ${differ} (${((100 * differ) / Math.max(1, ds.length)).toFixed(0)}%) | ${f2(mean(ds))} | ${f2(mean(abs))} | ${f2(pct(ds, 0.1))} / ${f2(pct(ds, 0.5))} / ${f2(pct(ds, 0.9))} | ${f2(Math.max(...abs))} | ${differ ? top.join('; ') : ''} |`);
}
w('');

w('## Corp formula cards: cost once, linearity, payout risk');
w(`${formulaBoards} Corp boards. gap = worth today - (f(0) - cost): 0 when the formula takes its rez cost off exactly once (the audit's P3). linear: f(c) - f(0) is c times one slope on every board, for c = 1, 2, 3, 5. Risk: the formula's worth with PAYOUT_RISK.corpBare at 0.06 (today) against bareAssetRisk on the board and moneyIced. Profiled cards are outside these columns (their unrezzedWorth path takes the printed cost off itself).`);
w('');
w('| card | cost | boards | gap mean (min..max) | f(c) - f(0) per credit | linear | worth today | at bare risk | at iced risk |');
w('|---|--:|--:|---|---|---|--:|--:|--:|');
for (const [code, r] of Object.entries(formulas).sort((x, y) => Math.abs(mean(y[1].gap)) - Math.abs(mean(x[1].gap)) || x[1].title.localeCompare(y[1].title))) {
  const per = r.slopes.flatMap(s => s.map((v, i) => v / [1, 2, 3, 5][i]));
  const lo = Math.min(...per);
  const hi = Math.max(...per);
  const linear = hi - lo <= 1e-6;
  w(`| ${r.title} (${code}) | ${r.cost} | ${r.n} | ${f2(mean(r.gap))} (${f2(Math.min(...r.gap))}..${f2(Math.max(...r.gap))}) | ${linear ? f2(lo) : `${f2(lo)}..${f2(hi)}`} | ${linear ? 'yes' : 'no'} | ${f2(mean(r.today))} | ${f2(mean(r.bare))} | ${f2(mean(r.iced))} |`);
}
w('');
w('## One example per site (root asks; Jeff\'s games #48 to #54 first, else a deal)');
w('');
w('| site | where | value | asked with |');
w('|---|---|--:|---|');
for (const [site, e] of Object.entries(examples).sort()) w(`| ${site} | ${e.src} turn ${e.turn} | ${f2(e.value)} | ${e.args} |`);
w('');
if (errors.length) {
  w(`## Errors (${errors.length})`);
  for (const e of errors.slice(0, 40)) w(`- ${e}`);
}
console.log(out.join('\n'));
