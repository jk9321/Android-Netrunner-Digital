// Stage D exploit F3 count: sums the rows of scripts/stage-d/bait-run.ts (every shard's stdout, JSON lines) into the
// note's tables. Usage: node scripts/stage-d/bait-run-sum.mjs <rows.jsonl | dir of .txt> [out.md] [changed.md]
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ASKED = ['beta', 'control', 'stopOverTurn', 'outOverTurn', 'both', 'outSettled'];
const ARMS = ASKED.slice(2);
const STOP = ['R2', 'R3s', 'R4s', 'MPrez'];
const KINDS = ['self', 'humanRunner', 'humanCorp'];

const input = process.argv[2];
const files = statSync(input).isDirectory()
  ? readdirSync(input, { recursive: true })
      .filter(f => /\.(txt|jsonl)$/.test(f))
      .map(f => join(input, f))
  : [input];
const rows = [];
for (const f of files)
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* a cut line */
    }
  }
const D = rows.filter(r => r.kind === 'd');
const C = rows.filter(r => r.kind === 'c');
const games = rows.filter(r => r.kind === 'g');
const hs = rows.filter(r => r.kind === 'h');
const nGames = {
  self: games.length,
  humanRunner: hs.filter(h => h.sk === 'humanRunner').length,
  humanCorp: hs.filter(h => h.sk === 'humanCorp').length,
};
const L = [];
const p = s => L.push(s);
const r2 = x => (Number.isFinite(x) ? Math.round(x * 100) / 100 : x);
const r3 = x => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x);
const per = (n, k) => (nGames[k] ? r3(n / nGames[k]) : '-');
const mse = xs => {
  if (!xs.length) return { m: NaN, se: NaN, n: 0 };
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.length > 1 ? xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1) : 0;
  return { m, se: Math.sqrt(v / xs.length), n: xs.length };
};
const fmt = ({ m, se, n }) => (n ? `${r2(m)} ± ${r2(se)} (${n})` : '-');

// ---------------------------------------------------------------------------------------------- stops
p(`# Bait-run count: summed tables\n`);
p(
  `Sources: ${nGames.self} self-play games (${games.filter(g => g.matchesBatch).length} match the batch record), ${nGames.humanRunner} human-Runner files, ${nGames.humanCorp} human-Corp files; ${D.length} decisions asked of ${ASKED.join(', ')}.`,
);
const stopped = hs.filter(h => h.stopped);
p(`Human files that stop replaying: ${stopped.map(h => `${h.src} (${h.stopped})`).join('; ') || 'none'}.`);
p(
  `Stops: control differs ${D.filter(d => d.controlDiffers).length}; measuring ask differs from beta ${D.filter(d => d.measureDiffers).length}; ask errors ${D.filter(d => d.errors).length}; self-play decisions where fresh beta agents play the source's move ${D.filter(d => d.sk === 'self' && d.fresh).length} of ${D.filter(d => d.sk === 'self' && d.fresh !== undefined).length}.\n`,
);

// ---------------------------------------------------------------------------------------------- A1
p(`## A1. Counted stop rezzes (beta, the deciding Corp's own rez windows)\n`);
p(
  `A window counts once per stop-rule rez answer. "clicks" = the Runner has clicks left after this run. Class = clicks left, the rez world does not hold over the rest of the turn, the pass world does. "arm rule" = stopOverTurn's three conditions (spendsKept's, own server included) say pass.\n`,
);
p(`| kind | rule | stop rezzes | clicks left | rez world holds | pass world holds | class | class a game | arm rule passes | pass world: Runner in on this run |`);
p(`| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`);
const a1 = [];
for (const d of D) for (const w of d.worlds ?? []) a1.push({ d, w });
for (const k of KINDS)
  for (const rule of [...STOP, 'all']) {
    const xs = a1.filter(x => x.d.sk === k && (rule === 'all' || x.w.rule === rule) && x.w.r === 'rez');
    if (!xs.length && rule !== 'all') continue;
    const cl = xs.filter(x => x.w.clicks > 0);
    const wk = cl.filter(x => x.w.w);
    const cls = wk.filter(x => !x.w.w.rez.holds && x.w.w.pass.holds);
    p(
      `| ${k} | ${rule} | ${xs.length} | ${cl.length} | ${wk.filter(x => x.w.w.rez.holds).length} | ${wk.filter(x => x.w.w.pass.holds).length} | ${cls.length} | ${per(cls.length, k)} | ${wk.filter(x => x.w.w.passes).length} | ${wk.filter(x => x.w.w.pass.thisRunIn).length} |`,
    );
  }
// per game (self)
const byGame = new Map();
for (const x of a1) if (x.d.sk === 'self' && x.w.r === 'rez' && x.w.clicks > 0 && x.w.w && !x.w.w.rez.holds && x.w.w.pass.holds) byGame.set(x.d.src, (byGame.get(x.d.src) ?? 0) + 1);
const hist = {};
for (const g of games) {
  const n = byGame.get(g.src) ?? 0;
  hist[n >= 3 ? '3+' : n] = (hist[n >= 3 ? '3+' : n] ?? 0) + 1;
}
p(
  `\nSelf-play games by class boards: ${Object.entries(hist)
    .map(([n, c]) => `${n}: ${c}`)
    .join(', ')}.\n`,
);

// A3 for the class boards
p(`### A3. What followed in the source at each class board (and at each arm-rule board)\n`);
p(`| kind | boards | Runner ran that server again this turn | and got in | ran another server | got in there | agenda points taken later this turn | this run got in |`);
p(`| --- | --- | --- | --- | --- | --- | --- | --- |`);
for (const [nm, f] of [
  ['class', x => !x.w.w.rez.holds && x.w.w.pass.holds],
  ['arm rule passes', x => x.w.w.passes],
])
  for (const k of KINDS) {
    const xs = a1.filter(x => x.d.sk === k && x.w.r === 'rez' && x.w.clicks > 0 && x.w.w && f(x));
    if (!xs.length) continue;
    const fol = xs.map(x => ({ x, f: x.d.followed })).filter(y => y.f);
    const same = fol.filter(y => y.f.runs.some(r => r.server === y.x.w.server));
    const other = fol.filter(y => y.f.runs.some(r => r.server !== y.x.w.server));
    p(
      `| ${k} (${nm}) | ${xs.length} | ${same.length} | ${same.filter(y => y.f.runs.some(r => r.server === y.x.w.server && r.in)).length} | ${other.length} | ${other.filter(y => y.f.runs.some(r => r.server !== y.x.w.server && r.in)).length} | ${fol.reduce((n, y) => n + y.f.stolen, 0)} | ${fol.filter(y => y.f.thisRunIn).length} |`,
    );
  }

// ---------------------------------------------------------------------------------------------- A2
p(`\n## A2. The run term's "out" answers (beta, the deciding Corp's own prompts in a run, when the term priced)\n`);
p(`| kind | card | priced prompts | "out" answers | with clicks left on the settled board | does not hold over the turn | per game | beta picked such an "out" |`);
p(`| --- | --- | --- | --- | --- | --- | --- | --- |`);
const terms = D.filter(d => d.term && d.c === 'corpPrompt');
for (const k of KINDS) {
  const byCard = new Map();
  for (const d of terms.filter(d => d.sk === k)) {
    const card = d.p?.card ?? '?';
    const e = byCard.get(card) ?? { n: 0, outs: 0, cl: 0, nh: 0, picked: 0 };
    e.n++;
    for (const o of d.term.opts) {
      if (o.v !== 'out') continue;
      e.outs++;
      if (o.ot && o.ot.clicks > 0) e.cl++;
      if (o.ot && o.ot.clicks > 0 && !o.ot.holds) {
        e.nh++;
        if (o.a === d.term.pick) e.picked++;
      }
    }
    byCard.set(card, e);
  }
  for (const [card, e] of [...byCard].sort((a, b) => b[1].nh - a[1].nh)) p(`| ${k} | ${card} | ${e.n} | ${e.outs} | ${e.cl} | ${e.nh} | ${per(e.nh, k)} | ${e.picked} |`);
}

// ---------------------------------------------------------------------------------------------- B
p(`\n## B. Arms: decisions changed against beta\n`);
p(
  `In class: a rez window where beta's own countedRez made a stop rez (R2, R3s, R4s) and the arm's own call passed it by its rule (stopOverTurn), or a prompt where beta's run term priced (out arms). Outside: everything else (through the look-ahead, listed apart).\n`,
);
p(`| arm | kind | changed | corpRez in class | corpPrompt in class | corpRez other | corpPrompt other | corpMain | Runner decisions | per game (in class) |`);
p(`| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`);
const inClass = (d, arm) => {
  if (d.c === 'corpRez') return !!d.armRez?.[arm]?.some(r => STOP.includes(r.rule) && r.armed === true);
  if (d.c === 'corpPrompt') return !!d.term && arm !== 'stopOverTurn';
  return false;
};
for (const arm of ARMS)
  for (const k of KINDS) {
    const ch = D.filter(d => d.sk === k && d.changed?.[arm]);
    const ic = ch.filter(d => inClass(d, arm));
    p(
      `| ${arm} | ${k} | ${ch.length} | ${ic.filter(d => d.c === 'corpRez').length} | ${ic.filter(d => d.c === 'corpPrompt').length} | ${ch.filter(d => d.c === 'corpRez' && !inClass(d, arm)).length} | ${ch.filter(d => d.c === 'corpPrompt' && !inClass(d, arm)).length} | ${ch.filter(d => d.c === 'corpMain').length} | ${ch.filter(d => d.side === 'runner').length} | ${per(ic.length, k)} |`,
    );
  }

p(`\n### Arm fire counts (the arm's condition passing a stop / charging an "out", top level and look-ahead, per decision asked)\n`);
p(`| arm | kind | decisions with a fire | fires R2 | R3s | R4s | out |`);
p(`| --- | --- | --- | --- | --- | --- | --- |`);
for (const arm of ARMS)
  for (const k of KINDS) {
    const j = ASKED.indexOf(arm);
    const fs = D.filter(d => d.sk === k && d.fire?.[j] && Object.keys(d.fire[j]).length).map(d => d.fire[j]);
    const s = key => fs.reduce((n, f) => n + (f[key] ?? 0), 0);
    p(`| ${arm} | ${k} | ${fs.length} | ${s('R2')} | ${s('R3s')} | ${s('R4s')} | ${s('out')} |`);
  }

// ---------------------------------------------------------------------------------------------- continuations
p(`\n## B (i). Continuations, beta's agents both sides to the end (arm's decision minus beta's)\n`);
p(`| arm | sources | pairs | Corp wins arm / beta | Corp points | points stolen | stolen this turn | Runner got in on THIS run after the arm only |`);
p(`| --- | --- | --- | --- | --- | --- | --- | --- |`);
const pairsOf = (arm, kinds, only) => C.filter(c => c.arm === arm && kinds.includes(c.sk) && !c.ca.err && !c.cb.err && (!only || only(c)));
for (const arm of ARMS)
  for (const [nm, kinds, only] of [
    ['all', KINDS],
    ['self', ['self']],
    ['all, in class', KINDS, c => inClass(D.find(d => d.src === c.src && d.i === c.i) ?? {}, arm)],
    ['all, look-ahead', KINDS, c => !inClass(D.find(d => d.src === c.src && d.i === c.i) ?? {}, arm)],
  ]) {
    const xs = pairsOf(arm, kinds, only);
    if (!xs.length) continue;
    const wins = [xs.filter(c => c.ca.winner === 'corp').length, xs.filter(c => c.cb.winner === 'corp').length];
    p(
      `| ${arm} | ${nm} | ${xs.length} | ${wins[0]} / ${wins[1]} | ${fmt(mse(xs.map(c => c.ca.cs - c.cb.cs)))} | ${fmt(mse(xs.map(c => c.ca.rs - c.cb.rs)))} | ${fmt(mse(xs.map(c => c.ca.stolenTurn - c.cb.stolenTurn)))} | ${xs.filter(c => c.ca.thisRunIn === true && c.cb.thisRunIn === false).length} |`,
    );
  }
p(`\n## B (ii). The bait line (rest of this turn: credits, then a run on the target with the last click), then beta's agents\n`);
p(`| arm | sources | pairs | agenda points stolen this turn arm / beta (sum) | difference | Corp wins arm / beta | Corp points | points stolen |`);
p(`| --- | --- | --- | --- | --- | --- | --- | --- |`);
for (const arm of ARMS)
  for (const [nm, kinds] of [
    ['all', KINDS],
    ['self', ['self']],
    ['humanRunner', ['humanRunner']],
  ]) {
    const xs = C.filter(c => c.arm === arm && kinds.includes(c.sk) && c.ba && c.bb && !c.ba.err && !c.bb.err);
    if (!xs.length) continue;
    const sa = xs.reduce((n, c) => n + c.ba.stolenTurn, 0);
    const sb = xs.reduce((n, c) => n + c.bb.stolenTurn, 0);
    p(
      `| ${arm} | ${nm} | ${xs.length} | ${sa} / ${sb} | ${fmt(mse(xs.map(c => c.ba.stolenTurn - c.bb.stolenTurn)))} | ${xs.filter(c => c.ba.winner === 'corp').length} / ${xs.filter(c => c.bb.winner === 'corp').length} | ${fmt(mse(xs.map(c => c.ba.cs - c.bb.cs)))} | ${fmt(mse(xs.map(c => c.ba.rs - c.bb.rs)))} |`,
    );
  }

// ---------------------------------------------------------------------------------------------- time
p(`\n## Time against control\n`);
p(`Ratio of means and of p95 (arm / control), and decisions over 2x control at 0.5 s or more. "planner" = the Corp's main-phase decisions.\n`);
p(`| arm | kind | scope | decisions | mean | p95 | over 2x at >= 0.5 s | beta / control mean |`);
p(`| --- | --- | --- | --- | --- | --- | --- | --- |`);
const pct = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN;
};
for (const arm of ARMS)
  for (const k of KINDS)
    for (const [scope, f] of [
      ['all', () => true],
      ['planner', d => d.c === 'corpMain'],
      ['corpRez', d => d.c === 'corpRez'],
      ['corpPrompt', d => d.c === 'corpPrompt'],
    ]) {
      const xs = D.filter(d => d.sk === k && f(d) && !d.errors);
      if (!xs.length) continue;
      const j = ASKED.indexOf(arm);
      const ctl = xs.map(d => d.ms[1]);
      const a = xs.map(d => d.ms[j]);
      const be = xs.map(d => d.ms[0]);
      const sum = v => v.reduce((x, y) => x + y, 0);
      const over = xs.filter(d => d.ms[j] >= 500 && d.ms[j] > 2 * d.ms[1]).length;
      p(`| ${arm} | ${k} | ${scope} | ${xs.length} | ${r3(sum(a) / sum(ctl))} | ${r3(pct(a, 0.95) / pct(ctl, 0.95))} | ${over} | ${r3(sum(be) / sum(ctl))} |`);
    }

writeFileSync(process.argv[3] ?? '/dev/stdout', L.join('\n') + '\n');

// ---------------------------------------------------------------------------------------------- every changed decision
if (process.argv[4]) {
  const M = [`# Every changed decision (bait-run count)\n`];
  for (const arm of ARMS) {
    M.push(`\n## ${arm}\n`);
    M.push(
      `| src | T | c | in class | beta | arm | rule / term | Runner clicks, credits; Corp credits | worlds (rez: cr/keep holds; pass: cr/keep holds) | (i) stolen turn a/b, this run in a/b, end cs a/b, rs a/b | (ii) bait stolen a/b |`,
    );
    M.push(`| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`);
    for (const d of D.filter(d => d.changed?.[arm])) {
      const c = C.find(c => c.src === d.src && c.i === d.i && c.arm === arm);
      const w = (d.worlds ?? []).find(x => x.w);
      const ws = w
        ? `${w.t} ${w.rule}: rez ${w.w.rez.cr}/${w.w.rez.keep} ${w.w.rez.holds ? 'H' : '-'}; pass ${w.w.pass.cr}/${w.w.pass.keep} ${w.w.pass.holds ? 'H' : '-'}${w.w.pass.thisRunIn ? ' (in this run)' : ''}`
        : '';
      const rule =
        d.rez?.map(r => `${r.t}:${r.rule ?? '-'}:${r.r ?? '-'}`).join(' ') || (d.term ? `term ${d.term.opts.map(o => `${o.a}=${o.v}${o.ot ? (o.ot.holds ? '/H' : '/-') : ''}`).join(' ')}` : '');
      const run = d.run ? `${d.run.clicks}k ${d.run.rcr}c; ${d.run.ccr}c @${d.run.server} [${d.run.root ?? ''}]` : '';
      const i = c ? `${c.ca.stolenTurn}/${c.cb.stolenTurn}, ${c.ca.thisRunIn}/${c.cb.thisRunIn}, ${c.ca.cs}/${c.cb.cs}, ${c.ca.rs}/${c.cb.rs}` : '(cap)';
      const ii = c?.ba ? `${c.ba.stolenTurn}/${c.bb.stolenTurn} @${c.bait}` : '';
      M.push(`| ${d.src} ${d.sk} #${d.i} | ${d.T} | ${d.c} | ${inClass(d, arm) ? 'yes' : 'no'} | ${d.beta} | ${d.changed[arm]} | ${rule} | ${run} | ${ws} | ${i} | ${ii} |`);
    }
  }
  writeFileSync(process.argv[4], M.join('\n') + '\n');
}
