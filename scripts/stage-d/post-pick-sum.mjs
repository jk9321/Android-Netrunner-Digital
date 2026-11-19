// Stage D item 8 count: sums the shard outputs of scripts/stage-d/post-pick.ts.
//   node scripts/stage-d/post-pick-sum.mjs <dir with the shard .txt files> [> sum.txt]
// Kinds apart everywhere (self, humanRunner, humanCorp). SE: of the paired difference's mean (sd / sqrt(n)).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const files = [];
const walk = d => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.txt')) files.push(p);
  }
};
walk(dir);
const rows = [];
for (const f of files)
  for (const l of readFileSync(f, 'utf8').split('\n'))
    if (l.startsWith('{"kind"'))
      try {
        rows.push(JSON.parse(l));
      } catch {
        /* a cut line */
      }
const by = k => rows.filter(r => r.kind === k);
const WHO = ['self', 'humanRunner', 'humanCorp'];
const r2 = x => (Number.isFinite(x) ? Math.round(x * 100) / 100 : x);
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const se = xs => {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1) / xs.length);
};
const pm = xs => `${r2(mean(xs))} ± ${r2(se(xs))} (n ${xs.length})`;
const count = (xs, f) => {
  const m = new Map();
  for (const x of xs) {
    const k = f(x);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1]);
};
const top = (xs, n = 12) => xs.slice(0, n).map(([k, v]) => `${v} ${k}`).join('; ');
const p = s => console.log(s);
const kind = l => (l ?? 'none').split(' ').slice(0, 2).join(' ').replace(/:.*$/, '');
const kindT = l => (l ?? 'none').replace(/>.*$/, '');

const games = by('g');
const ds = by('d');
const cs = by('c');
p(`# Item 8 post-pick count: sum of ${files.length} shard files, ${rows.length} rows`);
p(`Games: ${games.length}; matching the batch's record (winner, cr, sc): ${games.filter(g => g.matchesBatch).length}; not matching: ${games.filter(g => !g.matchesBatch).map(g => g.src).join(', ') || 'none'}`);
p(`Human files: ${by('h').map(h => `${h.src.replace('human:', '')} ${h.who} ${h.decisions}${h.stopped ? ` STOPPED ${h.stopped}` : ''}`).join('; ')}`);
p(`Decision rows: ${ds.length}; asked with an error: ${ds.filter(d => d.errors).length}`);
const stops = ds.filter(d => d.controlDiffers);
p(`STOP check, control answer unlike beta's: ${stops.length}${stops.length ? ' ' + stops.slice(0, 10).map(d => `${d.src}#${d.i}`).join(', ') : ''}`);
p('');

// ---------------------------------------------------------------- A1
p('## A1. Fire');
for (const who of WHO) {
  const d = ds.filter(x => x.who === who);
  if (!d.length) continue;
  const nGames = who === 'self' ? games.length : new Set(d.map(x => x.src.split('#')[0])).size;
  p(`### ${who}: ${d.length} decisions with a click, ${nGames} games`);
  for (const c of ['M', 'T_', 'V']) {
    const f = d.filter(x => x[c]);
    p(`- ${c.replace('_', '')}: ${f.length} (${r2(f.length / nGames)} a game; ${r2((100 * f.length) / d.length)}% of decisions)`);
    if (c === 'M') {
      p(`  replaced (${count(f, x => x.baseFrom).map(([k, v]) => `${v} ${k}`).join(', ')}): ${top(count(f, x => kind(x.planned ?? x.r0)))}`);
      p(`  replaced, by card: ${top(count(f, x => kindT(x.planned ?? x.r0)), 10)}`);
      p(`  played: ${top(count(f, x => kindT(x.money)), 8)}`);
    }
    if (c === 'T_') {
      p(`  replaced: ${top(count(f, x => kindT(x.tReplaced)))}`);
      p(`  played: ${top(count(f, x => kindT(x.tPlayed)), 6)}`);
    }
    if (c === 'V') {
      p(`  replaced: ${top(count(f, x => kindT(x.vReplaced)))}`);
      p(`  line kind: ${top(count(f, x => x.lineKind))}`);
    }
  }
  const la = d.filter(x => x.lookahead);
  const ov = la.filter(x => x.overruled);
  p(`- Old definition (decision-time measurement number 2): the look-ahead returned a pick on ${la.length}; the action played is not it on ${ov.length} (${r2((100 * ov.length) / Math.max(1, la.length))}%): M ${ov.filter(x => x.M).length}, T ${ov.filter(x => x.T_).length}, V ${ov.filter(x => x.V).length}, other ${ov.filter(x => !x.M && !x.T_ && !x.V).length} (other: ${top(count(ov.filter(x => !x.M && !x.T_ && !x.V), x => (x.score ? 'score' : x.lineStep ? 'lineStep' : x.later ? 'later' : 'other')))})`);
  const mb = d.filter(x => x.mBefore);
  p(`- M asked with the order's first instead of the look-ahead's pick (fresh asks, moneyBefore's ask against beta's): differs on ${mb.filter(x => x.mBefore.differs).length} of ${mb.length}: ${top(count(mb.filter(x => x.mBefore.differs), x => `${kindT(x.mBefore.beta)} -> ${kindT(x.mBefore.before)}`), 8)}`);
  p(`- fresh beta Corp (no plan memory) plays the deciding Corp's action on ${d.filter(x => x.freshSame).length} of ${d.filter(x => 'freshSame' in x).length}`);
}
p('');

// ---------------------------------------------------------------- A2 + B continuations
const contTable = (what, title) => {
  p(`### ${title}`);
  p('| source | pairs | Corp wins a / b | Corp points a - b | points stolen a - b | Corp credits end of turn a / b | end of next turn a / b | errors |');
  p('|---|---|---|---|---|---|---|---|');
  const all = cs.filter(c => c.what === what);
  for (const who of [...WHO, 'all']) {
    let xs = all.filter(c => who === 'all' || c.who === who).filter(c => !c.ca.err && !c.cb.err);
    const errs = all.filter(c => (who === 'all' || c.who === who) && (c.ca.err || c.cb.err)).length;
    if (!xs.length && !errs) continue;
    xs.sort((a, b) => (a.src < b.src ? -1 : a.src > b.src ? 1 : a.i - b.i));
    let note = '';
    if (who !== 'all' && xs.length > 400) {
      const k = Math.ceil(xs.length / 400);
      xs = xs.filter((_, j) => j % k === 0);
      note = ` (every ${k}th)`;
    }
    const wa = xs.filter(c => c.ca.winner === 'corp').length;
    const wb = xs.filter(c => c.cb.winner === 'corp').length;
    const dc = xs.map(c => c.ca.cs - c.cb.cs);
    const dr = xs.map(c => c.ca.rs - c.cb.rs);
    const c1 = xs.filter(c => c.ca.cr1 != null && c.cb.cr1 != null);
    const c2 = xs.filter(c => c.ca.cr2 != null && c.cb.cr2 != null);
    p(`| ${who} | ${xs.length}${note} | ${wa} / ${wb} | ${pm(dc)} | ${pm(dr)} | ${r2(mean(c1.map(c => c.ca.cr1)))} / ${r2(mean(c1.map(c => c.cb.cr1)))} | ${r2(mean(c2.map(c => c.ca.cr2)))} / ${r2(mean(c2.map(c => c.cb.cr2)))} | ${errs} |`);
  }
  p(`a played: ${top(count(all, c => kindT(c.a)), 6)}. b played: ${top(count(all, c => kindT(c.b)), 6)}`);
  p('');
};
p('## A2. Was it right? (a = the correction\'s action, b = the pick it replaced; CAP per source per kind applied in the script)');
contTable('M', 'M, the money step');
contTable('T', 'T, tag first');
contTable('V', 'V, the spare-click veto');

// ---------------------------------------------------------------- A3
p('## A3. Deleted: whole-game arms against the beta copy (the source game)');
p('| arm | deals | differ | Corp wins arm / beta | paired win diff | Corp points diff | stolen diff | alarms arm / beta (stayed broke, went broke, stuck in HQ, tag not used) |');
p('|---|---|---|---|---|---|---|---|');
const AL = ['Corp stayed broke', 'Corp went broke', 'agenda stuck in HQ', 'tag not used'];
for (const arm of ['noM', 'noT', 'noV']) {
  const xs = by('a3').filter(r => r.arm === arm);
  if (!xs.length) continue;
  const w = xs.map(r => (r.winner === 'corp' ? 1 : 0) - (r.base.winner === 'corp' ? 1 : 0));
  const al = (k, side) => xs.reduce((n, r) => n + ((side === 'arm' ? r.alarms : r.base.alarms)[k] ?? 0), 0);
  p(`| ${arm} | ${xs.length} | ${xs.filter(r => r.differs).length} | ${xs.filter(r => r.winner === 'corp').length} / ${xs.filter(r => r.base.winner === 'corp').length} | ${pm(w.map(x => x * 100))} pts | ${pm(xs.map(r => r.cs - r.base.cs))} | ${pm(xs.map(r => r.rs - r.base.rs))} | ${AL.map(k => `${al(k, 'arm')}/${al(k, 'base')}`).join(', ')} |`);
}
p('');

// ---------------------------------------------------------------- B
const quant = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
p('## B (and C arms). Decisions changed against the fresh beta Corp, and time against control');
p('| arm | source | decisions | changed | a game | mean ms arm / control (ratio) | p95 ratio | decisions over 2x control at >= 0.5 s |');
p('|---|---|---|---|---|---|---|---|');
for (const arm of ['moneyBefore', 'vetoList', 'saveUpMoney', 'saveUpList', 'holdCand']) {
  for (const who of WHO) {
    const d = ds.filter(x => x.who === who && x.ms);
    if (!d.length) continue;
    const nGames = who === 'self' ? games.length : new Set(d.map(x => x.src.split('#')[0])).size;
    const ch = d.filter(x => x.changed && arm in x.changed);
    const ma = mean(d.map(x => x.ms[arm]));
    const mc = mean(d.map(x => x.ms.control));
    const q = p95 => r2(quant(d.map(x => x.ms[arm]), p95) / quant(d.map(x => x.ms.control), p95));
    const over = d.filter(x => x.ms[arm] >= 500 && x.ms[arm] > 2 * x.ms.control).length;
    p(`| ${arm} | ${who} | ${d.length} | ${ch.length} | ${r2(ch.length / nGames)} | ${r2(ma)} / ${r2(mc)} (${r2(ma / mc)}) | ${q(0.95)} | ${over} |`);
  }
}
p('');
for (const arm of ['moneyBefore', 'vetoList', 'saveUpMoney', 'saveUpList', 'holdCand']) {
  const ch = ds.filter(x => x.changed && arm in x.changed);
  p(`${arm} changed: beta played ${top(count(ch, x => kindT(x.betaFresh)), 6)}; the arm played ${top(count(ch, x => kindT(x.changed[arm])), 6)}`);
}
p('');
p('### Paired continuations at the changed decisions (a = the arm\'s action, b = beta\'s)');
for (const arm of ['moneyBefore', 'vetoList', 'saveUpMoney', 'saveUpList', 'holdCand']) contTable(arm, arm);
p(`vetoList: entries cut from the order on ${ds.filter(x => x.vetoCut).length} decisions (${ds.reduce((n, x) => n + (x.vetoCut ?? 0), 0)} entries)`);
p('');

// ---------------------------------------------------------------- T without the override
p('## T: does the look-ahead pick the trash without the override?');
for (const who of WHO) {
  const f = ds.filter(x => x.who === who && x.T_);
  const tagged = ds.filter(x => x.who === who && x.r0 && x.r0.startsWith('TRASH_RESOURCE') && x.tags > 0);
  if (!tagged.length) continue;
  p(`- ${who}: order's first is a resource trash with the Runner tagged on ${tagged.length} decisions; the look-ahead's own pick is that trash on ${tagged.filter(x => x.planned && x.planned === x.r0).length}, something else on ${tagged.filter(x => x.planned && x.planned !== x.r0).length}, no look-ahead on ${tagged.filter(x => !x.planned).length}; T fired (replaced the pick) on ${f.length}`);
}
p('');

// ---------------------------------------------------------------- C1
p('## C1. Row 35: econ operations held that this turn\'s or next turn\'s clicks would pay for');
for (const who of WHO) {
  const d = ds.filter(x => x.who === who);
  if (!d.length) continue;
  const srcOf = x => x.src.split('#')[0];
  const nGames = new Set(d.map(srcOf)).size;
  const reach = r => d.filter(x => (x.save ?? []).some(s => s.split(':')[1] === r));
  const now = reach('now');
  const next = reach('next');
  const classD = d.filter(x => (x.save ?? []).some(s => /:(now|next):/.test(s)));
  p(`### ${who}: ${classD.length} class boards (now ${now.length}, next ${next.length}) in ${new Set(classD.map(srcOf)).size} of ${nGames} games`);
  p(`- cards: ${top(count(classD.flatMap(x => x.save.filter(s => /:(now|next):/.test(s))), s => s.split(':')[0]), 8)}`);
  p(`- what the Corp did on class boards: ${top(count(classD, x => kind(x.final)), 8)}`);
  for (const [name, set] of [['now', now], ['next', next]]) {
    const tr = set.filter(x => x.saveTrace);
    p(`- trace (${name}): ${set.length} boards; a counted question had the click (no look-ahead) on ${set.filter(x => !x.lookahead).length}; look-ahead ran on ${tr.length}: the credit in its K on ${tr.filter(x => x.saveTrace.creditInK).length}, the credit's playout plays the operation on ${tr.filter(x => x.saveTrace.creditLinePlays).length}, any candidate's playout plays it on ${tr.filter(x => x.saveTrace.anyLinePlays).length}; credit's value - best when in K: ${pm(tr.filter(x => x.saveTrace.creditInK).map(x => x.saveTrace.creditV - x.saveTrace.bestV))}; credit's line ${top(count(tr, x => x.saveTrace.creditLine), 4)}`);
  }
}
const cls = by('cls');
if (cls.length) {
  const c = cls.filter(x => x.reach === 'now' || x.reach === 'next');
  p(`Self-play class cards followed: ${c.length} (${c.filter(x => x.how === 'played').length} played, ${c.filter(x => x.how && x.how !== 'played').length} left HQ otherwise, ${c.filter(x => !x.how).length} still in HQ at the end); turns unplayed: ${pm(c.map(x => x.unplayedTurns))}; 4+ turns: ${c.filter(x => x.unplayedTurns >= 4).length}`);
}
p('');

// ---------------------------------------------------------------- C2
p('## C2. Jeff\'s idea: "gain a credit" and "end the turn" among the compared candidates');
for (const who of WHO) {
  const d = ds.filter(x => x.who === who && x.cands);
  if (!d.length) continue;
  const h = ds.filter(x => x.who === who && x.hold);
  const addC = h.filter(x => x.hold.added.includes('GAIN_CREDIT'));
  const addE = h.filter(x => x.hold.added.includes('END_TURN'));
  const winC = addC.filter(x => x.hold.best === 'GAIN_CREDIT');
  p(`- ${who}: beta's look-ahead compared ${d.length} times: the credit among its candidates on ${d.filter(x => x.cands.credit).length}, the turn end on ${d.filter(x => x.cands.end).length}. holdCand added the credit on ${addC.length} (it won on ${winC.length}; its value - the best other: ${pm(addC.map(x => x.hold.credit - Math.max(...x.hold.others.filter(o => o[0] !== 'GAIN_CREDIT' || false).map(o => o[1]).filter(Number.isFinite))))}), the turn end on ${addE.length}`);
}
p('');

// ---------------------------------------------------------------- C3
p('## C3. Pin D3 #50 #252 and the report-50 Hedge Fund boards');
for (const r of by('pin')) p(`- ${r.src} move ${r.move} (${r.prompt}): recorded ${r.recorded.slice(0, 120)}; answers: ${Object.entries(r.answers).map(([k, v]) => `${k} ${v.includes('"cardInstanceIds":[]') ? 'declines' : v.slice(0, 80)}`).join('; ')}`);
for (const x of ds.filter(x => x.src.startsWith('human:report-50') && x.save)) p(`- ${x.src} T${x.T} ${x.clicks} clicks ${x.cr} cr ${x.save.join(',')}: beta ${x.betaFresh ?? x.final}${x.changed && Object.keys(x.changed).length ? `; changed ${JSON.stringify(x.changed)}` : ''}`);
