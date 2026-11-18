// Sums grip-money-fire.ts output (`d` Corp decisions, `c` commits) into the count note's tables (brief Q1 to Q4).
//   node scripts/stage-d/grip-money-sum.mjs <files or dirs...>
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
const ds = lines.filter(l => l.kind === 'd');
const cs = lines.filter(l => l.kind === 'c');
const add = (o, k, n = 1) => (o[k] = (o[k] ?? 0) + n);
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');
const ARMS = ['f2max', 'f2odds', 'playable', 'commit', 'commitLine'];
const self = l => l.src.startsWith('deal:');
const srcName = s => s.replace('human:', '').replace('.json', '');
/** Who ran: self-play (this tree's Runner), the old AI Runner of a human-Corp game, a human Runner. */
const runnerClass = c => (c.src.startsWith('deal:') ? 'self-play' : c.runnerSide === 'human' ? 'human Runner' : 'human Corp (old AI Runner)');
const CLASSES = ['self-play', 'human Runner', 'human Corp (old AI Runner)'];
const sources = new Set(ds.map(d => d.src));
const games = sources.size || new Set(cs.map(c => c.src)).size;

// ======================================================================================================= Q1
// Each commit takes the outcome of its exposure: the last commit on that agenda that Corp turn (the later ones replace it)
const exposure = new Map();
for (const c of cs) if (c.outcome !== 'superseded') exposure.set(`${c.src}|${c.aid}|${c.T}`, c);
const bin = m => (m === null ? '5 and over (none gets in)' : m <= 1 ? '1' : m <= 2 ? '2' : m <= 4 ? '3 to 4' : '5 and over');
const BINS = ['1', '2', '3 to 4', '5 and over', '5 and over (none gets in)'];
/** The class of a commit's answered Runner turn. */
function outcomeOf(c) {
  const e = exposure.get(`${c.src}|${c.aid}|${c.T}`) ?? c;
  if (e.outcome !== 'answered') return { k: e.outcome, e };
  if (e.atRunnerTurn && e.atRunnerTurn.at !== e.server) return { k: `agenda ${e.atRunnerTurn.at} by the Runner's turn`, e };
  if (!e.breached) return { k: 'out', e };
  // The count assumed the Corp rezzes its holding set; where the Corp left some of it unrezzed, that is the cause first
  if (e.atBreach?.rezSetUnrezzed?.length) return { k: 'rez: the Corp left ice of the holding set unrezzed', e, money: e.plays.some(p => p.money) };
  const money = e.plays.filter(p => p.money);
  const other = e.plays.filter(p => !p.money);
  if (money.length && !other.length) return { k: 'money', e, two: money.length >= 2 };
  if (money.length) return { k: 'money and another hidden card', e, two: money.length >= 2 };
  if (other.length) return { k: other.some(p => p.breaker) ? 'hidden: breaker installed' : other.some(p => p.how === 'event') ? 'hidden: non-money event' : 'hidden: other install', e, drawn: other.some(p => p.drawn) };
  // No hidden card: the board the Runner met, the Corp's rezzes, else the count
  if (e.atRunnerTurn && e.atRunnerTurn.holds === false) return { k: 'none: the count at the Runner turn start says does not hold (the Corp moves after the commit)', e };
  return { k: 'none: STOP (the public count)', e };
}
const outs = cs.map(c => ({ c, o: outcomeOf(c) }));
console.log(`# grip-money count: ${games} sources, ${ds.length} Corp decisions, ${cs.length} commits (${exposure.size} exposures: the last commit on an agenda in a Corp turn)\n`);
console.log('## Q1. Commits by margin (each commit takes its exposure\'s Runner turn)\n');
const Q1COLS = ['commits', 'gone before the Runner turn', 'Runner got in', 'stolen', 'got in: money event only (F2)', 'of which two events', 'got in: money and another hidden card', 'got in: breaker installed', 'got in: non-money event', 'got in: other install', 'of the hidden: drawn that turn', 'got in: the Corp left the holding set unrezzed', 'got in: no hidden card'];
for (const cls of CLASSES) {
  const rows = outs.filter(x => runnerClass(x.c) === cls);
  if (!rows.length) continue;
  console.log(`### ${cls} (${new Set(rows.map(x => x.c.src)).size} sources)\n`);
  console.log(`| margin | ${Q1COLS.join(' | ')} |`);
  console.log(`|${'---|'.repeat(Q1COLS.length + 1)}`);
  for (const b of [...BINS, 'all']) {
    const r = rows.filter(x => b === 'all' || bin(x.c.margin) === b);
    if (!r.length) continue;
    const k = x => x.o.k;
    const got = r.filter(x => x.o.e.breached && x.o.k !== 'out');
    const v = [
      r.length,
      r.filter(x => /^agenda|game over|source end/.test(k(x))).length,
      got.length,
      r.filter(x => x.o.e.stolen).length,
      r.filter(x => k(x) === 'money').length,
      r.filter(x => k(x) === 'money' && x.o.two).length,
      r.filter(x => k(x) === 'money and another hidden card').length,
      r.filter(x => k(x) === 'hidden: breaker installed').length,
      r.filter(x => k(x) === 'hidden: non-money event').length,
      r.filter(x => k(x) === 'hidden: other install').length,
      r.filter(x => k(x).startsWith('hidden') && x.o.drawn).length,
      r.filter(x => k(x).startsWith('rez:')).length,
      r.filter(x => k(x).startsWith('none')).length,
    ];
    console.log(`| ${b} | ${v.join(' | ')} |`);
  }
  console.log('');
}
const none = outs.filter(x => x.o.k.startsWith('none'));
console.log('No hidden card, by cause: ' + (Object.entries(none.reduce((o, x) => (add(o, x.o.k), o), {})).map(([k, n]) => `${k} ${n}`).join('; ') || 'none'));
const stops = [...new Map(none.filter(x => x.o.k.includes('STOP')).map(x => [`${x.o.e.src}|${x.o.e.aid}|${x.o.e.T}`, x.o.e])).values()];
console.log(`STOP cases (exposures): ${stops.length}`);
for (const e of stops) console.log(`- ${e.src} T${e.T} decision ${e.ci} ${e.act} ${e.agenda} in ${e.server}, margin ${e.margin}, at the Runner turn ${JSON.stringify(e.atRunnerTurn)}, at the breach ${JSON.stringify(e.atBreach)}, runs ${e.runs}`);
const both = [...new Map(outs.filter(x => x.o.k.startsWith('money') || x.o.k.startsWith('rez:') || x.o.k.startsWith('hidden') || x.o.k.startsWith('none')).map(x => [`${x.o.e.src}|${x.o.e.aid}|${x.o.e.T}`, x])).values()];
console.log(`\nEvery exposure the Runner got in on (plays before the breach; $ a money event): ${both.map(x => `${srcName(x.o.e.src)} T${x.o.e.T} m${x.o.e.margin === null ? 'none' : x.o.e.margin} ${x.o.k.split(':')[0]} [${x.o.e.plays.map(p => p.code + (p.money ? '$' : '') + (p.drawn ? '(drawn)' : '')).join(' ')}]${x.o.e.stolen ? ' stolen' : ''}`).join('; ') || 'none'}`);
// Opportunity (the AI Coordinator, 15:20Z): a covering money event really in the grip (measuring only), used or not
console.log('\nOpportunity: commits whose recorded grip held a covering money event (measuring only), and whether the Runner got in with one:');
for (const cls of CLASSES) {
  const rows = outs.filter(x => runnerClass(x.c) === cls && x.c.truth.gripCovering > 0);
  const used = rows.filter(x => x.o.e.breached && x.o.e.plays.some(p => x.c.covering.includes(p.code)));
  const ex = new Set(rows.map(x => `${x.c.src}|${x.c.aid}|${x.c.T}`));
  console.log(`- ${cls}: ${rows.length} commits (${ex.size} exposures), got in with it ${used.length}, did NOT use it to get in ${rows.length - used.length}${rows.length ? ': ' + [...new Map(rows.map(x => [`${x.c.src}|${x.c.aid}|${x.c.T}`, x])).values()].map(x => `${srcName(x.c.src)} T${x.c.T} m${x.c.margin} grip$ [${x.c.truth.gripMoney.join(' ')}] ${x.o.k}`).join('; ') : ''}`);
}
// Found row 70: Madani with hosted programs
const ms = lines.filter(l => l.kind === 'm');
if (ms.length) {
  console.log('\nMadani with a hosted program (public; found row 70):');
  for (const cls of CLASSES) {
    const srcs = ms.filter(m => runnerClass(m) === cls);
    const withM = srcs.filter(m => m.madaniDecisions > 0);
    const com = outs.filter(x => runnerClass(x.c) === cls && x.c.madaniHosted?.length);
    const kinds = {};
    for (const x of com) add(kinds, x.c.madaniHosted.some(h => h.endsWith(':ice') || h.endsWith(':breaker')) ? 'changes the ice met or the breakers' : 'does not');
    console.log(`- ${cls}: ${withM.length} of ${srcs.length} sources (${withM.map(m => `${srcName(m.src)} ${m.madaniDecisions} Corp actions [${m.madaniHosted.join(' ')}]`).join('; ') || 'none'}); commits on such boards ${com.length} (${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ') || '-'}); of them the Runner got in ${com.filter(x => x.o.e.breached && x.o.k !== 'out').length}`);
  }
}
const diff = cs.filter(c => c.truth.deckVsGripStack || c.truth.deckVsSetup);
console.log(`\nDeck list less public cards vs grip + stack / vs the setup deck list less public: ${diff.length} commits differ${diff.length ? ': ' + diff.slice(0, 10).map(c => `${srcName(c.src)} T${c.T} (${c.truth.deckVsGripStack}, ${c.truth.deckVsSetup})`).join('; ') : ''}`);

// ======================================================================================================= Q2 vs Q1
console.log('\n## Q2 against Q1: commits each arm turns to "does not hold"\n');
console.log('| arm | source | commits turned | of them F2 (money only) | money and another card | got in another way | Runner did not get in | gone before | F2 cases | F2 missed (arm still holds) |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const a of ARMS)
  for (const cls of CLASSES) {
    const rows = outs.filter(x => runnerClass(x.c) === cls);
    if (!rows.length) continue;
    const turned = rows.filter(x => x.c.arms[a] === false);
    const f2 = rows.filter(x => x.o.k === 'money');
    const got = x => x.o.e.breached && x.o.k !== 'out';
    console.log(`| ${a} | ${cls} | ${turned.length} | ${turned.filter(x => x.o.k === 'money').length} | ${turned.filter(x => x.o.k === 'money and another hidden card').length} | ${turned.filter(x => got(x) && !x.o.k.startsWith('money')).length} | ${turned.filter(x => x.o.k === 'out').length} | ${turned.filter(x => !got(x) && x.o.k !== 'out').length} | ${f2.length} | ${f2.filter(x => x.c.arms[a] !== false).length} |`);
  }

// ======================================================================================================= Q3
console.log('\n## Q3. The chance p (deck list less public cards, the grip\'s size; an event "covers" when playable\'s count with it alone does not hold)\n');
const pbin = p => (p === 0 ? '0' : p <= 0.25 ? 'up to 0.25' : p <= 0.5 ? 'to 0.5' : p <= 0.75 ? 'to 0.75' : 'over 0.75');
console.log('| Runner | p | commits | mean p | grip held a covering event (recorded grip: measuring only) | Runner got in with one (played before the breach) |');
console.log('|---|---|---|---|---|---|');
for (const cls of CLASSES) {
  const rows = outs.filter(x => runnerClass(x.c) === cls);
  if (!rows.length) continue;
  for (const b of ['0', 'up to 0.25', 'to 0.5', 'to 0.75', 'over 0.75']) {
    const r = rows.filter(x => pbin(x.c.p) === b);
    if (!r.length) continue;
    const mean = r.reduce((s, x) => s + x.c.p, 0) / r.length;
    const held = r.filter(x => x.c.truth.gripCovering > 0).length;
    const used = r.filter(x => x.o.e.breached && x.o.e.plays.some(p => x.c.covering.includes(p.code))).length;
    console.log(`| ${cls} | ${b} | ${r.length} | ${mean.toFixed(3)} | ${held} (${pct(held, r.length)}) | ${used} |`);
  }
}

// ======================================================================================================= Q2 fire
console.log(`\n## Q2. Fire count (${ds.length} Corp decisions, ${games} sources)\n`);
console.log('| arm | changed | a game | self-play | human | errors | control differs from beta |');
console.log('|---|---|---|---|---|---|---|');
for (const a of [...ARMS, 'control']) {
  const ch = ds.filter(d => d.changed.includes(a));
  console.log(`| ${a} | ${ch.length} | ${(ch.length / games).toFixed(2)} | ${ch.filter(self).length} | ${ch.filter(d => !self(d)).length} | ${ch.filter(d => String(d.picks?.[a]).startsWith('error')).length} | ${a === 'control' ? ch.length : ''} |`);
}
const lineName = l => (l === null || l === undefined ? 'none' : l.error ? 'error' : l.line === null ? 'not in the order' : `${l.line}${l.behind ? 'b' : ''}${l.pos === 0 ? '' : ' (not first)'}`);
console.log('\nBy line (beta pick -> arm pick; "not first": a counted question or the look-ahead, not the order\'s first; b: behind):');
for (const a of ARMS) {
  const by = {};
  for (const d of ds.filter(x => x.changed.includes(a))) add(by, d.dk === 'main' ? `${lineName(d.lines?.beta)} -> ${lineName(d.lines?.[a])}` : d.dk);
  console.log(`- ${a}: ${Object.entries(by).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k}: ${n}`).join('; ') || 'none'}`);
}
console.log('\nBy source: ' + ARMS.map(a => `${a}: ${Object.entries(ds.filter(d => d.changed.includes(a)).reduce((o, d) => (add(o, srcName(d.src)), o), {})).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`).join('\n- '));

// What the arm's Corp did instead (beta's pick moves an agenda): where that agenda is at the end of the Corp turn
console.log('\n### What the arm\'s Corp did instead (changed decisions where beta\'s pick installs or advances an agenda; the agenda at the end of that Corp turn in the arm\'s continuation)\n');
const insteadOf = (d, a) => {
  const b = d.betaAgenda;
  const p = d.cont?.[a]?.placed;
  if (!p) return 'no continuation';
  if (p.at === b.server) return p.ice !== null && b.iceThen !== null && p.ice > b.iceThen ? 'ice first, the agenda in the same server that turn' : 'the agenda in the same server, no new ice';
  if (p.at === 'hq') return 'agenda kept in HQ';
  if (p.at === 'scored') return 'scored that turn';
  if (/^remote|^hq|^rd|^archives/.test(p.at) && p.at !== b.server) return b.server === null || b.server === undefined ? `into ${p.at}` : 'agenda into another server';
  return `other (${p.at})`;
};
console.log('| arm | changed, beta moves an agenda | of them beta\'s count holds (commits) | ' + ['ice first, the agenda in the same server that turn', 'the agenda in the same server, no new ice', 'agenda kept in HQ', 'agenda into another server', 'scored that turn', 'other'].join(' | ') + ' |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const a of ARMS) {
  const r = ds.filter(d => d.changed.includes(a) && d.betaAgenda);
  const by = {};
  for (const d of r) add(by, insteadOf(d, a));
  const known = ['ice first, the agenda in the same server that turn', 'the agenda in the same server, no new ice', 'agenda kept in HQ', 'agenda into another server', 'scored that turn'];
  const other = Object.entries(by).filter(([k]) => !known.includes(k));
  console.log(`| ${a} | ${r.length} | ${r.filter(d => d.betaAgenda.holds).length} | ${known.map(k => by[k] ?? 0).join(' | ')} | ${other.map(([k, n]) => `${k} ${n}`).join(', ') || 0} |`);
}

// Continuations
console.log('\n### Continuations (the arm\'s Corp against beta\'s Runner from each changed decision; points gained since it. R1 = the end of the Runner\'s next turn, C2 = the Corp turn after, R2 = the second Runner turn, the two-turn window; End = the game\'s end, one game each, not a win rate)\n');
const at = (c, which) => {
  // marks: [0] the Corp turn under way ends, [1] R1, [2] C2, [3] R2 (a decision in the Runner's turn: [0] is R0)
  const rs = c.marks.filter(m => m.ended === 'runner');
  const cps = c.marks.filter(m => m.ended === 'corp');
  const m = which === 'R1' ? rs[0] : which === 'R2' ? rs[1] : which === 'C2' ? cps[1] ?? cps[0] : null;
  const end = c.end;
  const pt = m ?? end;
  return { corp: pt.corp - c.start.corp, runner: pt.runner - c.start.runner };
};
console.log('| arm | source | changed with a continuation | Runner points by R1: beta / arm | Corp points by C2: beta / arm | by R2, Corp: beta / arm | by R2, Runner: beta / arm | two-turn net (Corp less Runner, arm less beta) | game end, Corp points: beta / arm | game end, Runner points: beta / arm | Corp wins at the end: beta / arm |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
const contRow = (a, rows, label) => {
  const s = { r1b: 0, r1a: 0, c2b: 0, c2a: 0, cb: 0, ca: 0, rb: 0, ra: 0, ecb: 0, eca: 0, erb: 0, era: 0, wb: 0, wa: 0 };
  for (const d of rows) {
    const b = d.cont.beta;
    const x = d.cont[a];
    s.r1b += at(b, 'R1').runner;
    s.r1a += at(x, 'R1').runner;
    s.c2b += at(b, 'C2').corp;
    s.c2a += at(x, 'C2').corp;
    s.cb += at(b, 'R2').corp;
    s.ca += at(x, 'R2').corp;
    s.rb += at(b, 'R2').runner;
    s.ra += at(x, 'R2').runner;
    s.ecb += b.end.corp - b.start.corp;
    s.eca += x.end.corp - x.start.corp;
    s.erb += b.end.runner - b.start.runner;
    s.era += x.end.runner - x.start.runner;
    s.wb += b.winner === 'corp' ? 1 : 0;
    s.wa += x.winner === 'corp' ? 1 : 0;
  }
  const net = s.ca - s.cb - (s.ra - s.rb);
  console.log(`| ${a} | ${label} | ${rows.length} | ${s.r1b} / ${s.r1a} | ${s.c2b} / ${s.c2a} | ${s.cb} / ${s.ca} | ${s.rb} / ${s.ra} | ${net >= 0 ? '+' : ''}${net} | ${s.ecb} / ${s.eca} | ${s.erb} / ${s.era} | ${s.wb} / ${s.wa} |`);
};
for (const a of ARMS) {
  const rows = ds.filter(d => d.changed.includes(a) && d.cont?.[a]);
  contRow(a, rows.filter(self), 'self-play');
  const hum = rows.filter(d => !self(d));
  contRow(a, hum, 'human sources');
  for (const [src, n] of Object.entries(hum.reduce((o, d) => (add(o, d.src), o), {}))) if (n >= 10) contRow(a, hum.filter(d => d.src === src), `${srcName(src)} (10 or more)`);
}

// ======================================================================================================= Q4
console.log('\n## Q4. Corp decision time against the control arm (the bar\'s measure: ratio of totals, ratio of the p95s)\n');
const p95 = xs => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(0.95 * s.length))];
};
console.log('| tree | source | decisions | total x control | p95 x control | mean ms (control) | over 2x of a control decision of 0.5 s or more (the stop; medians of 3) | 3 s or more slower (the stop) | under 0.5 s in control, over 0.5 s and 2x in the arm (not a stop) | slowest |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const t of ['beta', ...ARMS])
  for (const [label, f] of [['self-play', self], ['human', d => !self(d)], ['all', () => true]]) {
    const r = ds.filter(f).filter(d => d.ms[t] !== undefined && d.ms.control !== undefined);
    if (!r.length) continue;
    const sum = k => r.reduce((s, d) => s + d.ms[k], 0);
    const over = r.filter(d => d.ms.control >= 500 && d.ms[t] > 2 * d.ms.control);
    const jump = r.filter(d => d.ms.control < 500 && d.ms[t] >= 500 && d.ms[t] > 2 * d.ms.control);
    const slow = r.filter(d => d.ms[t] >= d.ms.control + 3000);
    const top = [...r].sort((x, y) => y.ms[t] - x.ms[t])[0];
    console.log(`| ${t} | ${label} | ${r.length} | ${(sum(t) / sum('control')).toFixed(3)} | ${(p95(r.map(d => d.ms[t])) / p95(r.map(d => d.ms.control))).toFixed(3)} | ${(sum(t) / r.length).toFixed(0)} (${(sum('control') / r.length).toFixed(0)}) | ${over.length}${over.length ? ' (' + over.slice(0, 4).map(d => `${srcName(d.src)}#${d.i} ${d.ms.control}->${d.ms[t]}`).join(', ') + ')' : ''} | ${slow.length}${slow.length ? ' (' + slow.slice(0, 4).map(d => `${srcName(d.src)}#${d.i} ${d.ms.control}->${d.ms[t]}`).join(', ') + ')' : ''} | ${jump.length} | ${srcName(top.src)}#${top.i} ${top.ms[t]} (control ${top.ms.control}) |`);
  }
const re = ds.filter(d => d.retimed);
console.log(`\nRe-timed decisions (a first reading over a stop): ${re.length}${re.length ? ': ' + re.slice(0, 12).map(d => `${srcName(d.src)}#${d.i} ${d.retimed.join(' ')}`).join('; ') : ''}`);
