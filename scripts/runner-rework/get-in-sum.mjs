// Runner rework R0 count 3: sums get-in.ts output (JSON lines, any number of files) into the tables of the brief:
// G (three voices, disagreements by kind), L (the lines on the record, per game, by source; traces; openings),
// Q (each arm: time, picks changed, flip rate, the people's lines held, paired continuations). Sources apart:
// self (self-play, our Normal Runner), humanRunner (a person as the Runner; report-33 apart: against the Hard Corp),
// humanCorp (our Runner against a person).
//   node scripts/runner-rework/get-in-sum.mjs out/*.jsonl > sum.txt
import { readFileSync } from 'node:fs';

const rows = process.argv
  .slice(2)
  .flatMap(f => readFileSync(f, 'utf8').split('\n'))
  .filter(l => l.startsWith('{'))
  .map(l => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter(Boolean);
const P = (...a) => console.log(...a);
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const se = a => (a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - mean(a)) ** 2, 0) / (a.length - 1) / a.length) : NaN);
const f2 = x => (Number.isFinite(x) ? x.toFixed(2) : '-');
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');
const q95 = a => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(0.95 * (s.length - 1))] : NaN;
};

// sources: game id (report-40b, 40c are cuts of 40), kind; report-33 is read apart
const skOf = new Map();
for (const r of rows) if (r.kind === 'h') skOf.set(r.src, r.sk);
const kindOf = src => {
  if (src.startsWith('deal:')) return 'self';
  const sk = skOf.get(src.split('#')[0]) ?? rows.find(r => r.src === src && r.sk)?.sk;
  if (src.includes('report-33')) return 'humanRunner33';
  return sk ?? '?';
};
const gameOf = src => src.replace(/#.*$/, '').replace(/(report-40)[bc]/, '$1');
const KINDS = ['self', 'humanRunner', 'humanRunner33', 'humanCorp'];
const games = Object.fromEntries(KINDS.map(k => [k, new Set()]));
for (const r of rows) if (r.kind === 'turn') games[kindOf(r.src)]?.add(gameOf(r.src));
const notMatched = rows.filter(r => r.kind === 'g' && !r.matchesBatch);
P(`# Count 3 sums\nsources: ${KINDS.map(k => `${k} ${games[k].size} games`).join(', ')}; self-play games not matching the batch: ${notMatched.length} ${notMatched.map(r => r.src).join(' ')}`);

// ------------------------------------------------------------------------------------------------ turns
const turns = rows.filter(r => r.kind === 'turn');
const turnKey = (src, T) => `${gameOf(src)}|${src}|${T}`;
const turnBy = new Map(turns.map(t => [turnKey(t.src, t.T), t]));

// ------------------------------------------------------------------------------------------------ L: the lines
const MONEY = /^(GAIN_CREDIT|PLAY_OPERATION_OR_EVENT|USE_ABILITY)/;
function lines(t) {
  const L = {};
  const runs = t.runs;
  const servers = new Set(runs.map(r => r.server));
  if (runs.length >= 2 && servers.size >= 2) L.secondOther = true;
  runs.forEach((r, i) => {
    const before = runs.slice(0, i);
    const prevSame = [...before].reverse().find(b => b.server === r.server);
    if (prevSame && prevSame.ok === false) {
      L.returnFailed = true;
      const between = t.acts.slice(prevSame.at + 1, r.at);
      const what = [];
      if (between.some(a => a.a.startsWith('INSTALL_CARD'))) what.push('install');
      if (between.some(a => a.rc1 > a.rc0)) what.push('money');
      if (between.some(a => a.a.startsWith('DRAW_CARD'))) what.push('draw');
      (L.returnFailedWhat ??= []).push(what.join('+') || 'nothing');
    }
    if (prevSame && prevSame.ok === true) {
      const kind = r.server.startsWith('remote') ? 'remote' : r.server;
      (L.returnOk ??= []).push(kind);
    }
    if (r.by !== 'click') (L.cardRun ??= []).push(r.by);
    // money made this turn before the run, and spent in it: the run spent more than the credits the Runner had at the
    // run's start less the money made before it
    const made = t.acts.slice(0, Math.max(0, r.at)).reduce((n, a) => n + Math.max(0, a.rc1 - a.rc0), 0);
    const atStart = r.at >= 0 && t.acts[r.at] ? t.acts[r.at].rc0 : t.rc0;
    if (made > 0 && r.spent > 0 && r.spent > atStart - made) L.moneyRun = true;
    // a bait run (HIDDEN-READ min rez): an earlier run this turn made the Corp rez and spend; this run's server had unrezzed
    // ice it then could not afford (minRez above the Corp's credits at this run's start, at or below them before the earlier run)
    for (const b of before) {
      if (b.server === r.server || !b.rezzed.length || b.cc1 >= b.cc0) continue;
      if (r.unrez > 0 && r.minRez !== null && r.minRez > r.cc0 && r.minRez <= b.cc0) L.bait = true;
    }
  });
  const feeds = ['Side Hustle', 'Knickknack'];
  if (L.cardRun && t.rig) L.cardRunFed = feeds.filter(() => false); // rig codes are listed in the note by hand
  return L;
}
const LINE_KEYS = ['secondOther', 'returnFailed', 'returnOk', 'cardRun', 'moneyRun', 'bait'];
P('\n## L. Lines on the record (turns with the line; games with it at least once; turns per game)');
for (const k of KINDS) {
  const ts = turns.filter(t => kindOf(t.src) === k);
  if (!ts.length) continue;
  const g = games[k].size;
  P(`\n### ${k}: ${ts.length} Runner turns, ${g} games`);
  for (const key of LINE_KEYS) {
    const withIt = ts.filter(t => lines(t)[key]);
    const gs = new Set(withIt.map(t => gameOf(t.src)));
    P(`- ${key}: ${withIt.length} turns (${f2(withIt.length / g)} a game) in ${gs.size} of ${g} games`);
  }
  const what = ts.flatMap(t => lines(t).returnFailedWhat ?? []);
  if (what.length) P(`  return after a failed run, what changed between: ${JSON.stringify(count(what))}`);
  const ok = ts.flatMap(t => lines(t).returnOk ?? []);
  if (ok.length) P(`  return after a successful run, by server: ${JSON.stringify(count(ok))}`);
  const cr = ts.flatMap(t => lines(t).cardRun ?? []);
  if (cr.length) P(`  runs a card started, by card code: ${JSON.stringify(count(cr))}`);
}
function count(a) {
  const o = {};
  for (const x of a) o[x] = (o[x] ?? 0) + 1;
  return Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
}

// ------------------------------------------------------------------------------------------------ G: three voices
P('\n## G. Three voices at each board (turn start and before each run): per server');
const vs = rows.filter(r => r.kind === 'v');
for (const k of KINDS) {
  const vk = vs.filter(v => kindOf(v.src) === k);
  if (!vk.length) continue;
  const tally = {};
  const add = (n, x = 1) => (tally[n] = (tally[n] ?? 0) + x);
  for (const v of vk) {
    const t = turnBy.get(turnKey(v.src, v.T));
    if (!t) continue;
    const from = (v.runs ?? []).length;
    const later = t.runs.slice(from);
    for (const sv of v.servers) {
      add('serverBoards');
      const mine = later.filter(r => r.server === sv.id);
      const ran = mine.length > 0;
      const gotIn = mine.some(r => r.ok);
      const out = sv.score === null; // runScore -Infinity: priced out
      if (ran) add('ran');
      if (gotIn) add('gotIn');
      if (out && gotIn) {
        add('A runner priced out, got in');
        const r0 = mine.find(r => r.ok);
        const pre = t.acts.slice(v.where === 'start' ? 0 : Math.max(0, t.runs[from]?.at ?? 0), r0.at);
        if (pre.some(a => a.rc1 > a.rc0)) add('A  .. money made before');
        if (r0.by !== 'click') add('A  .. run a card started');
      }
      if (sv.hold?.holds && gotIn) {
        add('B walk holds, got in');
        const r0 = mine.find(r => r.ok);
        const pre = t.acts.slice(0, Math.max(0, r0.at));
        const causes = [];
        if (r0.by !== 'click' || pre.some(a => /PLAY_OPERATION_OR_EVENT|INSTALL_CARD/.test(a.a))) causes.push('grip');
        if (pre.some(a => a.rc1 > a.rc0)) causes.push('money');
        if (r0.unrez > 0 && r0.rezzed.length < r0.unrez) causes.push('rezNotMade');
        if (v.cls?.length) causes.push('holdFault:' + v.cls.join('+'));
        add(`B  .. ${causes.join('+') || 'none named'}`);
      }
      if (sv.hold && !sv.hold.holds && ran && !gotIn) add('B2 walk does not hold, ran and failed');
      if (sv.score !== null && sv.score > 0 && ran && mine.some(r => r.ok === false)) {
        add('C runner worth it, run failed');
        const r0 = mine.find(r => r.ok === false);
        add(`C  .. ${r0.rezzed.length ? 'ice rezzed in the run' : r0.unrez ? 'unrezzed ice left unrezzed' : 'no unrezzed ice (rezzed ice, upgrade, jack out)'}`);
      }
      if (!out && sv.hold?.holds) add('D runner prices in, walk holds');
      if (out && sv.hold && !sv.hold.holds) add('E runner prices out, walk does not hold');
    }
  }
  P(`\n### ${k}: ${vk.length} boards`);
  for (const [n, x] of Object.entries(tally).sort()) P(`- ${n}: ${x}`);
}

// ------------------------------------------------------------------------------------------------ traces at the people's runs
P('\n## Traces: the deciding Runner at the board before each run (played move), by line');
for (const k of KINDS) {
  const vk = vs.filter(v => kindOf(v.src) === k && v.trace && !v.trace.err);
  if (!vk.length) continue;
  const byLine = {};
  for (const v of vk) {
    const t = turnBy.get(turnKey(v.src, v.T));
    const run = t?.runs[(v.runs ?? []).length];
    if (!run) continue;
    const before = t.runs.slice(0, (v.runs ?? []).length);
    const prevSame = [...before].reverse().find(b => b.server === run.server);
    const line = prevSame ? (prevSame.ok ? 'returnOk' : 'returnFailed') : before.length ? 'secondOther' : 'first';
    (byLine[line] ??= []).push(v.trace.cause);
  }
  P(`### ${k}`);
  for (const [l, c] of Object.entries(byLine)) P(`- ${l} (${c.length}): ${JSON.stringify(count(c))}`);
}

// ------------------------------------------------------------------------------------------------ openings (self-play)
const os = rows.filter(r => r.kind === 'o');
if (os.length) {
  P('\n## Openings in self-play: a return legal, priced by a repeat rule');
  const g = games.self.size || 1;
  for (const rule of [...new Set(os.map(o => o.rule))]) {
    const o = os.filter(x => x.rule === rule);
    const notTaken = o.filter(x => !x.taken);
    const pairs = notTaken.filter(x => x.ca && x.cb && !x.ca.err && !x.cb.err);
    const dr = pairs.map(x => x.ca.rs - x.cb.rs);
    const dw = pairs.map(x => (x.ca.w === 'runner' ? 1 : 0) - (x.cb.w === 'runner' ? 1 : 0));
    P(`- ${rule}: ${o.length} boards (${f2(o.length / g)} a game), not taken ${notTaken.length}; paired return-first minus control: Runner points ${f2(mean(dr))} ± ${f2(se(dr))}, Runner wins ${f2(mean(dw))} ± ${f2(se(dw))} (n=${pairs.length})`);
  }
}

// ------------------------------------------------------------------------------------------------ Q
const qs = rows.filter(r => r.kind === 'q');
const arms = [...new Set(qs.flatMap(q => Object.keys(q.res)))].filter(a => a !== 'control');
P('\n## Q. The options (arms of the deciding Runner)');
for (const k of KINDS) {
  const qk = qs.filter(q => kindOf(q.src) === k);
  if (!qk.length) continue;
  P(`\n### ${k}: ${qk.length} decisions`);
  const ctlMs = qk.map(q => q.res.control.ms);
  P(`- control: ms mean ${f2(mean(ctlMs))}, p95 ${q95(ctlMs)}`);
  const flipBase = flipRate(qk, 'control');
  P(`- control flip rate: ${flipBase.txt}`);
  for (const a of arms) {
    const ms = qk.map(q => q.res[a]?.ms).filter(x => x != null);
    const changed = qk.filter(q => q.res[a] && q.res[a].a !== q.res.control.a);
    const g = new Set(qk.map(q => gameOf(q.src))).size;
    const fr = flipRate(qk, a);
    const base = a === 'runsPlayed8' ? flipRate(qk, 'control', new Set(qk.filter(q => q.res.runsPlayed8?.seeds).sort((x, y) => x.h - y.h).slice(0, 50).map(q => `${q.src}#${q.i}`))) : flipBase;
    const errs = qk.filter(q => q.res[a]?.err).length;
    P(`- ${a}: ms mean ${f2(mean(ms))} (${f2(mean(ms) / mean(ctlMs))}x), p95 ${q95(ms)} (${f2(q95(ms) / q95(ctlMs))}x); picks changed ${changed.length} (${f2(changed.length / g)} a game); flip ${fr.txt} (vs control ${f2(100 * (fr.rate - base.rate))} points on the same decisions); errors ${errs}`);
  }
}
function flipRate(qk, a, only) {
  let f = qk.filter(q => q.flip && q.res[a]?.seeds && q.res[a].planned);
  // (c, 8 deals): the fixed seeded sample, the first 50 by hash (step 0 ruling 1); control read on the same decisions
  if (a === 'runsPlayed8') f = f.sort((x, y) => x.h - y.h).slice(0, 50);
  if (only) f = f.filter(q => only.has(`${q.src}#${q.i}`));
  let diff = 0;
  let n = 0;
  let any = 0;
  for (const q of f) {
    const s = q.res[a].seeds;
    let d = 0;
    for (const x of s.slice(1)) d += x !== s[0] ? 1 : 0;
    diff += d;
    n += s.length - 1;
    any += d > 0 ? 1 : 0;
  }
  return { rate: n ? diff / n : NaN, txt: `${pct(diff, n)} of seed asks (${any} of ${f.length} planned decisions change at some seed)` };
}

// (iii): the people's turns holding a line: at the person's board before the line's run, does the arm's pick or plan hold it?
P('\n## Q (iii). At the people\'s boards before a line\'s run: the run in the pick or the plan (arm vs control)');
for (const k of ['humanRunner', 'humanRunner33']) {
  const hold = {};
  for (const q of qs.filter(q => kindOf(q.src) === k && q.played?.startsWith('RUN:'))) {
    const t = turnBy.get(turnKey(q.src, q.T));
    if (!t) continue;
    const server = q.played.slice(4);
    const idx = t.runs.findIndex((r, i) => r.server === server && t.runs.slice(0, i).length >= 0 && r.rk0 === q.rk);
    if (idx < 0) continue;
    const before = t.runs.slice(0, idx);
    const prevSame = [...before].reverse().find(b => b.server === server);
    const line = prevSame ? (prevSame.ok ? 'returnOk' : 'returnFailed') : before.length ? 'secondOther' : null;
    if (!line) continue;
    for (const a of ['control', ...arms]) {
      const r = q.res[a];
      if (!r) continue;
      const holds = r.a === q.played || (r.plan ?? []).includes(q.played);
      ((hold[line] ??= {})[a] ??= []).push(holds ? 1 : 0);
    }
  }
  for (const [line, byArm] of Object.entries(hold)) {
    const c = byArm.control ?? [];
    P(`- ${k} ${line} (${c.length} boards${c.length < 10 ? ', TOO THIN' : ''}): ` + Object.entries(byArm).map(([a, v]) => `${a} ${v.reduce((x, y) => x + y, 0)}/${v.length}` + (a === 'control' ? '' : ` (paired ${f2(mean(v.map((x, i) => x - c[i])))} ± ${f2(se(v.map((x, i) => x - c[i])))})`)).join('; '));
  }
}

// (iv): paired continuations
const cs = rows.filter(r => r.kind === 'c');
P('\n## Q (iv). Paired continuations (self-play boards where the arm\'s pick differs): arm-first minus control-first');
for (const a of arms) {
  const c = cs.filter(x => x.arm === a && x.ca && x.cb && !x.ca.err && !x.cb.err);
  const dr = c.map(x => x.ca.rs - x.cb.rs);
  const dw = c.map(x => (x.ca.w === 'runner' ? 1 : 0) - (x.cb.w === 'runner' ? 1 : 0));
  P(`- ${a}: n=${c.length}; Runner points ${f2(mean(dr))} ± ${f2(se(dr))}; Runner wins ${f2(mean(dw))} ± ${f2(se(dw))}`);
}
