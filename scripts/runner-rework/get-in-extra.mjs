// Runner rework R0 count 3: the extra tables of the note, from get-in.ts output (beside get-in-sum.mjs):
//  - people's card-started runs and money-then-run turns: does each arm's pick or plan hold the line (Q iii for them);
//  - the trace at the people's card-started runs (was the card's play a candidate);
//  - (d)'s changed picks: what its plan held (runs, second run's server, the control pick it replaced);
//  - Side Hustle / Knickknack in the rig on turns with a card-started run (what it fed).
//   node scripts/runner-rework/get-in-extra.mjs out/*.jsonl
import { readFileSync } from 'node:fs';

const rows = process.argv
  .slice(2)
  .flatMap(f => readFileSync(f, 'utf8').split('\n'))
  .filter(l => l.startsWith('{'))
  .map(l => JSON.parse(l));
const P = (...a) => console.log(...a);
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const se = a => (a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - mean(a)) ** 2, 0) / (a.length - 1) / a.length) : NaN);
const f2 = x => (Number.isFinite(x) ? x.toFixed(2) : '-');
const skOf = new Map();
for (const r of rows) if (r.kind === 'h') skOf.set(r.src, r.sk);
const kind = src => (src.startsWith('deal:') ? 'self' : src.includes('report-33') ? 'humanRunner33' : skOf.get(src) ?? '?');
const turns = new Map(rows.filter(r => r.kind === 'turn').map(t => [`${t.src}|${t.T}`, t]));
const qs = rows.filter(r => r.kind === 'q');
const arms = ['control', 'repeatRepaired', 'runsPriced', 'runsPlayed', 'runsPlayed8', 'icePlayed'];
const SIDE_HUSTLE = '35034';
const KNICKKNACK = '35033';

// people's decisions grouped by turn, in order
const byTurn = new Map();
for (const q of qs) {
  const k = `${q.src}|${q.T}`;
  if (!byTurn.has(k)) byTurn.set(k, []);
  byTurn.get(k).push(q);
}

P('## Q (iii) for the card-started runs and money-then-run turns (people as the Runner)');
for (const sk of ['humanRunner', 'humanRunner33', 'humanCorp']) {
  const card = {};
  const money = {};
  for (const [k, list] of byTurn) {
    const t = turns.get(k);
    if (!t || kind(t.src) !== sk) continue;
    // the decision whose played move started each run: matched by the act index (acts are the main-phase moves in order)
    const mainQs = list.filter(q => q.played);
    for (const r of t.runs) {
      if (r.at < 0) continue;
      const q = mainQs[r.at];
      if (!q || q.played !== t.acts[r.at]?.a) continue;
      if (r.by !== 'click') for (const a of arms) if (q.res[a]) ((card[a] ??= [])).push(q.res[a].a === q.played || (q.res[a].plan ?? []).includes(q.played) ? 1 : 0);
      // money then run: at the turn's first decision, does the plan hold a money move the person made before the run and then the run's move?
      const made = t.acts.slice(0, r.at).filter(x => x.rc1 > x.rc0).map(x => x.a);
      const atStart = r.at >= 0 && t.acts[r.at] ? t.acts[r.at].rc0 : t.rc0;
      const spentMade = made.length && r.spent > 0 && r.spent > atStart - t.acts.slice(0, r.at).reduce((n, x) => n + Math.max(0, x.rc1 - x.rc0), 0);
      if (spentMade && mainQs[0]) {
        const q0 = mainQs[0];
        for (const a of arms) {
          if (!q0.res[a]) continue;
          const plan = [q0.res[a].a, ...(q0.res[a].plan ?? []).slice(1)];
          const mi = plan.findIndex(x => made.includes(x));
          const ri = plan.findIndex(x => x === t.acts[r.at].a);
          (money[a] ??= []).push(mi >= 0 && ri > mi ? 1 : 0);
        }
      }
    }
  }
  for (const [name, m] of [['cardRun (the card play in the pick or plan, at the board before)', card], ['moneyRun (a money move the person made, then the run, in the plan at the turn start)', money]]) {
    const c = m.control ?? [];
    if (!c.length) continue;
    P(`- ${sk} ${name} (${c.length} boards${c.length < 10 ? ', TOO THIN' : ''}): ` + arms.filter(a => m[a]).map(a => `${a} ${m[a].reduce((x, y) => x + y, 0)}/${m[a].length}` + (a === 'control' ? '' : ` (paired ${f2(mean(m[a].map((x, i) => x - c[i])))} ± ${f2(se(m[a].map((x, i) => x - c[i])))})`)).join('; '));
  }
}

P('\n## Trace at the people\'s card-started runs (beta\'s ranking at the board before; the card\'s play)');
for (const sk of ['humanRunner', 'humanRunner33', 'humanCorp', 'self']) {
  const c = {};
  for (const v of rows.filter(r => r.kind === 'v' && kind(r.src) === sk && r.trace && !r.trace.err)) {
    const t = turns.get(`${v.src}|${v.T}`);
    const run = t?.runs[(v.runs ?? []).length];
    if (!run || run.by === 'click') continue;
    const key = `${run.by}:${v.trace.cause}`;
    c[key] = (c[key] ?? 0) + 1;
  }
  const byCause = {};
  for (const [k, n] of Object.entries(c)) byCause[k.split(':')[1]] = (byCause[k.split(':')[1]] ?? 0) + n;
  if (Object.keys(c).length) P(`- ${sk}: ${JSON.stringify(byCause)}; by card ${JSON.stringify(Object.fromEntries(Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 12)))}`);
}

P('\n## What card-started runs fed (Side Hustle, Knickknack in the rig at the turn start)');
for (const sk of ['self', 'humanRunner', 'humanRunner33', 'humanCorp']) {
  const ts = [...turns.values()].filter(t => kind(t.src) === sk && t.runs.some(r => r.by !== 'click'));
  const sh = ts.filter(t => t.rig?.includes(SIDE_HUSTLE)).length;
  const kk = ts.filter(t => t.rig?.includes(KNICKKNACK)).length;
  P(`- ${sk}: ${ts.length} turns with a card-started run; Side Hustle installed ${sh}, Knickknack installed ${kk}`);
}

P('\n## (d) runsPriced: the changed picks (self-play), by its plan');
for (const sk of ['self', 'humanRunner', 'humanCorp']) {
  const ch = qs.filter(q => kind(q.src) === sk && q.res.runsPriced && q.res.runsPriced.a !== q.res.control.a);
  const tally = {};
  const add = n => (tally[n] = (tally[n] ?? 0) + 1);
  for (const q of ch) {
    const d = q.res.runsPriced;
    const plan = d.plan ?? [d.a];
    const runs = plan.filter(x => x.startsWith('RUN:'));
    const servers = new Set(runs.map(x => x.slice(4)));
    add(`plan runs ${runs.length}${runs.length >= 2 ? ` (${servers.size} servers)` : ''}`);
    if (runs.length >= 2) {
      const second = runs[1].slice(4);
      add(`  second run on ${second.startsWith('remote') ? 'a remote' : second}`);
    }
    const ctlRun = q.res.control.a.startsWith('RUN:');
    if (ctlRun && !d.a.startsWith('RUN:')) add(`control ran (${q.res.control.a}), (d) did not run first`);
    if (ctlRun && !(plan ?? []).includes(q.res.control.a)) add(`control's run not in (d)'s plan at all`);
    if (!ctlRun && d.a.startsWith('RUN:')) add('(d) runs first where control did not');
    add(`pick kind ${d.a.split(':')[0]} (control ${q.res.control.a.split(':')[0]})`);
  }
  P(`### ${sk}: ${ch.length} changed`);
  for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) P(`- ${k}: ${n}`);
}
