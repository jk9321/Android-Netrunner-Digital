// Sums scripts/stage-vc/grip-money-count.ts output into the count note's tables (V-C item 5 brief, Q1, Q2, Q4).
//   node scripts/stage-vc/grip-money-sum.mjs <files or dirs...>
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = process.argv.slice(2).flatMap(p => (statSync(p).isDirectory() ? walk(p) : [p]));
function walk(d) {
  return readdirSync(d).flatMap(f => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.txt') ? [p] : [];
  });
}
const lines = files.flatMap(f => readFileSync(f, 'utf8').split('\n')).filter(l => l.startsWith('{')).map(l => JSON.parse(l));
const srcs = lines.filter(l => l.kind === 'src');
const ms = lines.filter(l => l.kind === 'm');
const KINDS = ['self', 'humanRunner', 'humanCorp'];
const KN = { self: 'self-play', humanRunner: 'human Runner', humanCorp: 'human Corp (old AI Runner)' };
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');
const name = s => s.replace('human:', '').replace('.json', '');
const exKey = m => `${m.src}|${m.aid}|${m.T}`;
const errs = ms.filter(m => m.err);

console.log(`# grip-money count (V-C item 5): ${srcs.length} sources, ${ms.length} agenda moves into or in a remote, ${errs.length} measuring errors\n`);
for (const k of KINDS) {
  const s = srcs.filter(x => x.sk === k);
  console.log(`- ${KN[k]}: ${s.length} sources${k === 'self' ? `, ${s.filter(x => x.matchesRecord).length} match the g1 record (winner, cr, sc); differ: ${s.filter(x => !x.matchesRecord).map(x => name(x.src)).join(', ') || 'none'}` : `, stopped early: ${s.filter(x => x.stopped).length}`}`);
}
if (errs.length) console.log(`- errors: ${errs.slice(0, 5).map(m => `${name(m.src)} T${m.T}: ${m.err}`).join('; ')}`);

// Each move takes its exposure's outcome: the last move on that agenda that Corp turn
const exposure = new Map();
for (const m of ms) if (m.outcome !== 'superseded') exposure.set(exKey(m), m);
const ex = m => exposure.get(exKey(m)) ?? m;
/** The outcome class of a move's exposure. */
function outcomeOf(m) {
  const e = ex(m);
  if (e.outcome !== 'answered') return { k: 'gone: ' + e.outcome, e };
  if (e.atRunnerTurn && e.atRunnerTurn.at !== e.server) return { k: `gone: agenda ${e.atRunnerTurn.at} by the Runner turn`, e };
  if (!e.breached) return { k: 'out', e };
  if (e.atBreach?.rezSetUnrezzed) return { k: 'rez', e };
  const money = e.plays.filter(p => p.money);
  const other = e.plays.filter(p => !p.money);
  if (money.length && !other.length) return { k: 'money', e, two: money.length >= 2 };
  if (money.length) return { k: 'money+', e };
  if (other.length) return { k: other.some(p => p.breaker) ? 'hidden: breaker' : other.some(p => p.how === 'event') ? 'hidden: event' : 'hidden: install', e, drawn: other.some(p => p.drawn) };
  if (e.atRunnerTurn && e.atRunnerTurn.holds === false) return { k: 'none: the count at the Runner turn start says does not hold', e };
  return { k: 'none', e };
}
const bin = m => (m === null || m === undefined ? 'none gets in' : m <= 0 ? '0 or less' : m <= 1 ? '1' : m <= 2 ? '2' : m <= 4 ? '3 to 4' : '5 and over');
const BINS = ['0 or less', '1', '2', '3 to 4', '5 and over', 'none gets in'];

// ======================================================================================================= Q1
const commits = ms.filter(m => m.holds && !m.err).map(m => ({ m, o: outcomeOf(m) }));
console.log(`\n## Q1. Commits (holds after the move): ${commits.length}, on ${new Set(commits.map(x => exKey(x.m))).size} exposures\n`);
const COLS = ['commits', 'gone before the Runner turn', 'got in', 'stolen', 'F2: money event only', 'money and another hidden card', 'hidden: breaker', 'hidden: other event', 'hidden: other install', 'of hidden: drawn', 'rez: holding set left unrezzed', 'no hidden card'];
for (const k of KINDS) {
  const rows = commits.filter(x => x.m.sk === k);
  if (!rows.length) continue;
  console.log(`### ${KN[k]}\n\n| margin | ${COLS.join(' | ')} |\n|${'---|'.repeat(COLS.length + 1)}`);
  for (const b of [...BINS, 'all']) {
    const r = rows.filter(x => b === 'all' || bin(x.m.margin) === b);
    if (!r.length) continue;
    const c = f => r.filter(f).length;
    console.log(`| ${b} | ${[r.length, c(x => x.o.k.startsWith('gone')), c(x => x.o.e.breached && x.o.k !== 'out' && !x.o.k.startsWith('gone')), c(x => x.o.e.stolen), c(x => x.o.k === 'money'), c(x => x.o.k === 'money+'), c(x => x.o.k === 'hidden: breaker'), c(x => x.o.k === 'hidden: event'), c(x => x.o.k === 'hidden: install'), c(x => x.o.k.startsWith('hidden') && x.o.drawn), c(x => x.o.k === 'rez'), c(x => x.o.k.startsWith('none'))].join(' | ')} |`);
  }
  console.log('');
}
const uniq = xs => [...new Map(xs.map(x => [exKey(x.o.e), x])).values()];
const gotIn = uniq(commits.filter(x => x.o.e.breached && x.o.k !== 'out' && !x.o.k.startsWith('gone')));
console.log('Every commit exposure the Runner got in on (plays before the breach; $ money, (d) drawn that turn):');
for (const x of gotIn) console.log(`- ${name(x.o.e.src)} T${x.o.e.T} ${x.o.e.server} m${x.o.e.margin ?? 'none'} ${x.o.k} [${x.o.e.plays.map(p => p.title + (p.money ? '$' : '') + (p.drawn ? '(d)' : '')).join(', ')}]${x.o.e.stolen ? ' stolen' : ''}; paid: ${JSON.stringify(x.o.e.paid)}`);
const stops = gotIn.filter(x => x.o.k === 'none');
console.log(`\nNO HIDDEN CARD (the brief's stop): ${stops.length}${stops.length ? ': ' + stops.map(x => `${name(x.o.e.src)} T${x.o.e.T} move ${x.o.e.mi} (${x.o.e.act} ${x.o.e.agenda} in ${x.o.e.server}) atRunnerTurn ${JSON.stringify(x.o.e.atRunnerTurn)} paid ${JSON.stringify(x.o.e.paid)}`).join('; ') : ''}`);
// Opportunity: a money event really in the grip at the commit (HIDDEN READ, measuring only)
console.log('\nCommits whose recorded grip held a money event (measuring only), and what followed:');
for (const k of KINDS) {
  const r = commits.filter(x => x.m.sk === k && x.m.gripMoney.length);
  const e = uniq(r);
  console.log(`- ${KN[k]}: ${r.length} commits on ${e.length} exposures; ${e.map(x => `${name(x.o.e.src)} T${x.o.e.T} m${x.o.e.margin ?? 'none'} ${x.o.k}`).join('; ') || '-'}`);
}

// (i) (ii) (iii): the Runner rework coordinator's report-only columns
console.log('\n### Q1 extra columns (report only)\n');
for (const k of KINDS) {
  const e = uniq(commits.filter(x => x.m.sk === k && x.o.e.outcome === 'answered' && x.o.e.atRunnerTurn?.at === x.o.e.server));
  if (!e.length) continue;
  const rs = e.map(x => x.o.e.runScore).filter(Boolean);
  const pos = e.filter(x => x.o.e.runScore?.worth !== null && x.o.e.runScore?.worth !== undefined);
  const neg = e.filter(x => x.o.e.runScore && (x.o.e.runScore.worth === null || x.o.e.runScore.worth === undefined));
  const ran = xs => xs.filter(x => x.o.e.runs > 0).length;
  console.log(`- ${KN[k]}: ${e.length} exposures with the agenda there at the Runner's turn. (i) runScore worth finite ${pos.length} (ran there ${ran(pos)}; mean worth ${(pos.reduce((n, x) => n + x.o.e.runScore.worth, 0) / (pos.length || 1)).toFixed(1)}, mean credits its ice takes ${(pos.reduce((n, x) => n + (x.o.e.runScore.spend ?? 0), 0) / (pos.length || 1)).toFixed(1)}), not worth a run (-Infinity) ${neg.length} (ran there ${ran(neg)}); errors ${rs.filter(r => r.err).length}.`);
  const runsN = {};
  let firstHere = 0;
  for (const x of e) {
    const n = x.o.e.turn?.n ?? 0;
    runsN[n] = (runsN[n] ?? 0) + 1;
    if (x.o.e.turn?.first === x.o.e.server) firstHere++;
  }
  console.log(`  (iii) runs that turn: ${Object.entries(runsN).map(([n, c]) => `${n} runs ${c}`).join(', ')}; first run on this server ${firstHere}.`);
  const g = e.filter(x => x.o.e.breached);
  const by = {};
  const made = {};
  for (const x of g) {
    by[x.o.e.paid?.by ?? '?'] = (by[x.o.e.paid?.by ?? '?'] ?? 0) + 1;
    for (const [s, n] of Object.entries(x.o.e.paid?.madeBefore ?? {})) made[s] = (made[s] ?? 0) + n;
  }
  console.log(`  (ii) got in ${g.length}: run started by ${Object.entries(by).map(([b, c]) => `${b} ${c}`).join(', ') || '-'}; credits made before that run, by source (sum): ${Object.entries(made).map(([s, n]) => `${s} ${n}`).join(', ') || '-'}.`);
}

// ======================================================================================================= Q2
// Every agenda move (holds or not) whose exposure the Runner answered with the agenda still in that server
const q2 = ms.filter(m => !m.err).map(m => ({ m, o: outcomeOf(m) })).filter(x => !x.o.k.startsWith('gone'));
const SBINS = [
  ['0 to 0.1', p => p <= 0.1],
  ['0.1 to 0.25', p => p > 0.1 && p <= 0.25],
  ['0.25 to 0.5', p => p > 0.25 && p <= 0.5],
  ['0.5 to 0.75', p => p > 0.5 && p <= 0.75],
  ['over 0.75', p => p > 0.75],
];
const sb = p => SBINS.find(([, f]) => f(p))[0];
console.log(`\n## Q2. The two owners on the same boards: ${q2.length} moves (of the ${ms.length} agenda moves: ${ms.filter(m => !m.holds).length} 'does not hold' in all) whose exposure met the Runner's turn with the agenda in the server\n`);
for (const k of [...KINDS, 'all']) {
  const r = q2.filter(x => k === 'all' || x.m.sk === k);
  if (!r.length) continue;
  console.log(`### ${k === 'all' ? 'all sources' : KN[k]} (${r.length} moves, stolen ${r.filter(x => x.o.e.stolen).length})\n`);
  for (const [lab, f] of [['stealOdds', x => x.m.steal], ['stealOdds, credits only (iceCreditNeed in passOdds; measuring only)', x => x.m.stealCr]]) {
    console.log(`Real steal rate by ${lab} bin:\n\n| bin | moves | mean predicted | stolen | real rate |\n|---|---|---|---|---|`);
    for (const [b] of SBINS) {
      const rr = r.filter(x => sb(f(x)) === b);
      if (rr.length) console.log(`| ${b} | ${rr.length} | ${(rr.reduce((n, x) => n + f(x), 0) / rr.length).toFixed(3)} | ${rr.filter(x => x.o.e.stolen).length} | ${pct(rr.filter(x => x.o.e.stolen).length, rr.length)} |`);
    }
    console.log('');
  }
  console.log(`Real steal rate by owner 1 (serverHold) answer and margin bin:\n\n| answer | margin | moves | stolen | real rate |\n|---|---|---|---|---|`);
  for (const h of [true, false])
    for (const b of BINS) {
      const rr = r.filter(x => x.m.holds === h && bin(x.m.margin) === b);
      if (rr.length) console.log(`| ${h ? 'holds' : 'does not hold'} | ${b} | ${rr.length} | ${rr.filter(x => x.o.e.stolen).length} | ${pct(rr.filter(x => x.o.e.stolen).length, rr.length)} |`);
    }
  console.log(`\nCross table (cell: moves, stolen, real rate):\n\n| owner 1 | ${SBINS.map(([b]) => b).join(' | ')} |\n|${'---|'.repeat(SBINS.length + 1)}`);
  for (const h of [true, false])
    console.log(`| ${h ? 'holds' : 'does not hold'} | ${SBINS.map(([b]) => {
      const rr = r.filter(x => x.m.holds === h && sb(x.m.steal) === b);
      return rr.length ? `${rr.length}, ${rr.filter(x => x.o.e.stolen).length}, ${pct(rr.filter(x => x.o.e.stolen).length, rr.length)}` : '-';
    }).join(' | ')} |`);
  const c1 = r.filter(x => x.m.holds && x.m.steal > 0.5);
  const c2 = r.filter(x => !x.m.holds && x.m.steal < 0.1);
  const loose = r.filter(x => (x.m.holds && x.m.steal > 0.25) || (!x.m.holds && x.m.steal <= 0.25));
  console.log(`\nDisagreeing corners: holds with stealOdds over 0.5: ${c1.length}; does not hold with stealOdds under 0.1: ${c2.length}; together ${c1.length + c2.length} of ${r.length} moves (${pct(c1.length + c2.length, r.length)}). Looser split at 0.25 (holds over 0.25, does not hold at or under 0.25): ${loose.length} (${pct(loose.length, r.length)}).`);
  if (k === 'all') {
    const show = (xs, risky) =>
      xs.slice(0, 20).map(x => `- ${name(x.m.src)} T${x.m.T} move ${x.m.mi} ${x.m.act} ${x.m.agenda} ${x.m.server}: holds ${x.m.holds} m${x.m.margin ?? 'none'}, stealOdds ${x.m.steal} (credits only ${x.m.stealCr}), Runner ${x.m.rCredits} cr; ${x.o.e.stolen ? 'STOLEN' : x.o.e.breached ? 'got in, not stolen' : 'not stolen'}: right ${x.o.e.stolen === risky ? 'stealOdds' : 'serverHold'}`).join('\n');
    console.log(`\nCorner 1, holds with stealOdds over 0.5 (at most 20):\n${show(c1, true) || '- none'}`);
    console.log(`\nCorner 2, does not hold with stealOdds under 0.1 (at most 20):\n${show(c2, false) || '- none'}`);
    // Per-exposure check: the last move of each exposure only
    const last = r.filter(x => x.m.outcome !== 'superseded');
    const l1 = last.filter(x => x.m.holds && x.m.steal > 0.5).length;
    const l2 = last.filter(x => !x.m.holds && x.m.steal < 0.1).length;
    console.log(`\nLast move of each exposure only: ${last.length} exposures, corners ${l1} + ${l2} (${pct(l1 + l2, last.length)}).`);
  }
  console.log('');
}

// ======================================================================================================= Q4
console.log('## Q4. Grip cards the Corp has seen (state.runner.knownToCorp, still in the grip) at the agenda moves\n');
for (const k of KINDS) {
  const r = ms.filter(m => m.sk === k);
  const c = r.filter(m => m.holds);
  console.log(`- ${KN[k]}: moves with a known grip card ${r.filter(m => m.known > 0).length} of ${r.length}; commits with a known MONEY event ${c.filter(m => m.knownMoney > 0).length} of ${c.length}${c.filter(m => m.knownMoney > 0).length ? ': ' + c.filter(m => m.knownMoney > 0).map(m => `${name(m.src)} T${m.T} [${(m.knownCodes ?? []).join(' ')}] ${outcomeOf(m).k}`).join(', ') : ''}`);
}
