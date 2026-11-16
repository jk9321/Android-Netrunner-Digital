// ai-breaker-guard-key (brief rev 2, phase 1): sums fire-count.ts output into the tables of results.md.
//   node scripts/breaker-guard-key/fire-count-sum.mjs out/fc-*.txt > sum.md
import { readFileSync } from 'node:fs';

const lines = process.argv.slice(2).flatMap(f =>
  readFileSync(f, 'utf8')
    .split('\n')
    .filter(l => l.startsWith('{'))
    .map(l => JSON.parse(l)),
);
const fx = lines.filter(l => l.src.startsWith('fixture:'));
const all = lines.filter(l => !l.src.startsWith('fixture:'));
const TREES = ['K', 'K2', 'R'];
const NAME = { K: 'K', K2: "K'", R: 'R' };
const out = [];
const p = s => out.push(s);
const f2 = x => (Number.isFinite(x) ? x.toFixed(2) : String(x));
const f3 = x => (Number.isFinite(x) ? x.toFixed(3) : String(x));
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
const games = rows => new Set(rows.map(l => l.src)).size;
const sides = [['corp', all.filter(l => l.side === 'corp')], ['runner', all.filter(l => l.side === 'runner')], ['both', all]];

p(`Decisions: ${all.length} (Corp ${sides[0][1].length}, Runner ${sides[1][1].length}) in ${games(all)} games (${games(all.filter(l => l.src.startsWith('deal:')))} local deals, ${games(all.filter(l => l.src.startsWith('human:')))} of Jeff's games), plus ${fx.length} saved decisions.`);
const errs = lines.filter(l => Object.values(l.picks ?? {}).some(a => String(a).startsWith('error')));
p(`Engine or AI errors in a pick: ${errs.length}${errs.length ? ': ' + errs.map(l => `${l.src}#${l.i}`).join(', ') : ''}.`);
p(`Audit trees' picks against their timed tree: aB differs from beta in ${lines.filter(l => !l.aB.same).length}, aK2 from K' in ${lines.filter(l => !l.aK2.same).length}.`);
p('');

// --- 1. Crossings -----------------------------------------------------------------------------------------------
const STORE_FIELDS = ['up2down', 'down2up', 'entries', 'differE', 'differ', 'guardE', 'guard', 'capped', 'capped2', 'errors', 'skipped', 'unmarked', 'nonNumeric'];
function crossings(tree, rows, label) {
  const stores = {};
  const names = {};
  for (const l of rows) {
    for (const [st, v] of Object.entries(l[tree].t)) {
      const s = (stores[st] ??= { decisions: 0, hits: 0, maxDiff: 0, maxGuardDiff: 0, ctrl: [0, 0, 0], ...Object.fromEntries(STORE_FIELDS.map(k => [k, 0])) });
      s.hits += v.hits ?? 0;
      if ((v.up2down ?? 0) + (v.down2up ?? 0) > 0) s.decisions++;
      for (const k of STORE_FIELDS) s[k] += v[k] ?? 0;
      s.maxDiff = Math.max(s.maxDiff, v.maxDiff ?? 0);
      s.maxGuardDiff = Math.max(s.maxGuardDiff, v.maxGuardDiff ?? 0);
      if (v.ctrl) for (let i = 0; i < 3; i++) s.ctrl[i] += v.ctrl[i];
      for (const [nm, r] of Object.entries(v.names ?? {})) {
        const n = (names[`${st}:${nm}`] ??= [0, 0, 0, 0, 0]);
        for (let i = 0; i < 4; i++) n[i] += r[i];
        if (r[0]) n[4]++;
      }
    }
  }
  p(`**${label}**`);
  p('');
  p('| store | hits | decisions crossing | reads up→down | reads down→up | entries worked out | differ (entries / reads) | the guard\'s (entries / reads) | max diff | max guard diff | capped (1st / 2nd) | past limits (reads) | errors | background: recomputed / differ / capped |');
  p('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [st, s] of Object.entries(stores).sort()) {
    p(`| ${st} | ${s.hits} | ${s.decisions} | ${s.up2down} | ${s.down2up} | ${s.entries} | ${s.differE} / ${s.differ} | ${s.guardE} / ${s.guard} | ${f3(s.maxDiff)} | ${f3(s.maxGuardDiff)} | ${s.capped} / ${s.capped2} | ${s.skipped} | ${s.errors} | ${s.ctrl.join(' / ')} |`);
  }
  p('');
  p('By key name (reads): crossings, of them up→down, differ, the guard\'s; decisions.');
  p('');
  p('| store:key | crossings | up→down | differ | guard\'s | decisions |');
  p('|---|---|---|---|---|---|');
  for (const [k, r] of Object.entries(names).sort((a, b) => b[1][0] - a[1][0]).slice(0, 20)) p(`| ${k} | ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} | ${r[4]} |`);
  p('');
}
p('## 1. Crossings in every store keyed by pricingKey');
p('');
for (const [side, rows] of sides.slice(0, 2)) {
  crossings('aB', rows, `beta, ${side} decisions (${rows.length})`);
  crossings('aK2', rows, `K', ${side} decisions (${rows.length}): what K' leaves open`);
}
const dB = l => l.aB.guard;
p(`Decisions with a crossing whose difference is the guard's, beta: ${all.filter(l => dB(l) > 0).length} (Corp ${sides[0][1].filter(l => dB(l) > 0).length}, Runner ${sides[1][1].filter(l => dB(l) > 0).length}); with any differing crossing: ${all.filter(l => l.aB.differ > 0).length}. K': guard's ${all.filter(l => l.aK2.guard > 0).length}, any ${all.filter(l => l.aK2.differ > 0).length}.`);
p('');

// --- 2. Fire count ------------------------------------------------------------------------------------------------
p('## 2. Fire count (decisions changed against beta)');
p('');
p('| side | tree | decisions | games | changed | per game | changed with 0 / 1 / 2+ guard-differing crossings on beta | changed with 0 / 1+ differing crossings (any cause) |');
p('|---|---|---|---|---|---|---|---|');
for (const [side, rows] of sides) {
  const g = games(rows);
  for (const t of TREES) {
    const ch = rows.filter(l => l.ch[t]);
    const by = [ch.filter(l => dB(l) === 0).length, ch.filter(l => dB(l) === 1).length, ch.filter(l => dB(l) > 1).length];
    const any = [ch.filter(l => l.aB.differ === 0).length, ch.filter(l => l.aB.differ > 0).length];
    p(`| ${side} | ${NAME[t]} | ${rows.length} | ${g} | ${ch.length} | ${f3(ch.length / g)} | ${by.join(' / ')} | ${any.join(' / ')} |`);
  }
}
p('');
const coldRows = lines.filter(l => l.cold);
if (coldRows.length) {
  p('Changed picks with no guard difference on beta, asked again cold (finding 4):');
  p('');
  p('| decision | tree | first picks beta / tree | cold picks agree | beta cold = first | loops beta / tree | audits checked / mismatches beta, tree | reading |');
  p('|---|---|---|---|---|---|---|---|');
  for (const l of coldRows) {
    for (const t of ['K', 'K2']) {
      const c = l.cold[t];
      if (!c) continue;
      const b = l.cold.beta;
      const agree = b.a === c.a;
      const loops = JSON.stringify(b.loops) !== JSON.stringify(c.loops);
      const audit = b.mismatches + c.mismatches > 0;
      const reading = agree ? 'cache order (cold picks agree)' : loops ? 'value-loop order (loops differ)' : audit ? 'cache side effect (audit mismatch)' : 'UNEXPLAINED: stop';
      p(`| ${l.src}#${l.i} ${l.side} T${l.T} | ${NAME[t]} | ${l.picks.beta.slice(0, 60)} / ${l.picks[t].slice(0, 60)} | ${agree} | ${b.a === l.picks.beta} | ${Object.keys(b.loops).length} / ${Object.keys(c.loops).length} | ${b.checked}/${b.mismatches}, ${c.checked}/${c.mismatches} | ${reading} |`);
    }
  }
  p('');
}

// --- 3. Time ----------------------------------------------------------------------------------------------------
const q = (xs, f) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(f * s.length))];
};
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
p('## 3. Time per decision (ms; saved decisions apart)');
p('');
p('| side | tree | mean | p95 | max | mean / beta | p95 / beta | max / beta | deck prices worked out (sum) |');
p('|---|---|---|---|---|---|---|---|---|');
for (const [side, rows] of sides.slice(0, 2)) {
  const ms = t => rows.map(l => l.ms[t]);
  const b = ms('beta');
  for (const t of ['beta', ...TREES]) {
    const x = ms(t);
    const pr = rows.reduce((n, l) => n + (l.priced?.[t] ?? 0), 0);
    p(`| ${side} | ${t === 'beta' ? 'beta' : NAME[t]} | ${f2(mean(x))} | ${q(x, 0.95)} | ${Math.max(...x)} | ${f3(mean(x) / mean(b))} | ${f3(q(x, 0.95) / q(b, 0.95))} | ${f3(Math.max(...x) / Math.max(...b))} | ${pr} |`);
  }
}
p('');
p('Saved decisions (each timed in every tree, median of the reps):');
p('');
p('| decision | beta | K | K\' | R | K / beta | K\' / beta | R / beta | picks changed | crossings beta (key: reads up→down / down→up, differ) | crossings K\' |');
p('|---|---|---|---|---|---|---|---|---|---|---|');
const med = xs => (Array.isArray(xs) ? q(xs, 0.5) : xs);
const cx = t => Object.entries(t).flatMap(([st, v]) => Object.entries(v.names ?? {}).map(([nm, r]) => `${st}:${nm} ${r[1]}/${r[0] - r[1]}, ${r[2]}`)).join('; ');
for (const l of fx) {
  const m = Object.fromEntries(['beta', ...TREES].map(t => [t, med(l.ms[t])]));
  p(`| ${l.src} ${l.side} T${l.T} | ${m.beta} | ${m.K} | ${m.K2} | ${m.R} | ${f3(m.K / m.beta)} | ${f3(m.K2 / m.beta)} | ${f3(m.R / m.beta)} | ${TREES.filter(t => l.ch[t]).map(t => NAME[t]).join(', ') || 'none'} | ${cx(l.aB.t)} | ${cx(l.aK2.t)} |`);
}
p('');
p('All reps (ms):');
for (const l of fx) p(`- ${l.src}: ${JSON.stringify(l.ms)}`);
p('');

// --- 4. Tree R's hosted breakers --------------------------------------------------------------------------------
const cards = {};
let boards = 0;
for (const l of lines) {
  if (!Array.isArray(l.hosted)) continue;
  boards++;
  for (const [code, normal, rule] of l.hosted) {
    const c = (cards[code] ??= { n: 0, normal: 0, rule: 0, maxAbs: 0, up: 0, down: 0 });
    c.n++;
    c.normal += normal;
    c.rule += rule;
    c.maxAbs = Math.max(c.maxAbs, Math.abs(rule - normal));
    if (rule > normal) c.up++;
    if (rule < normal) c.down++;
  }
}
p(`## 4. Tree R: hosted breakers, held worth as beta prices it and rule-based (${boards} boards with one)`);
p('');
p('| card | boards | mean beta | mean rule-based | mean change | max abs change | higher / lower |');
p('|---|---|---|---|---|---|---|');
for (const [code, c] of Object.entries(cards).sort((a, b) => b[1].n - a[1].n)) p(`| ${code} | ${c.n} | ${f3(c.normal / c.n)} | ${f3(c.rule / c.n)} | ${f3((c.rule - c.normal) / c.n)} | ${f3(c.maxAbs)} | ${c.up} / ${c.down} |`);
const hostErr = lines.filter(l => typeof l.hosted === 'string');
if (hostErr.length) p(`\nHosted pricing errors: ${hostErr.length}.`);
console.log(out.join('\n'));
