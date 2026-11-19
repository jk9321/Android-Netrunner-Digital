#!/usr/bin/env node
/**
 * R0 count 4: sums scripts/runner-rework/model-agree.ts output (one JSON line per record, any number of shard files).
 *
 *   node scripts/runner-rework/model-agree-sum.mjs out/*.txt > sum.md
 *
 * Kinds are kept apart (self, humanRunner, humanRunnerHC, aiRunnerNormal, aiRunnerHard). Standard errors are by game
 * (a split game is one game): SE of a ratio sum(y)/sum(n) over games g, sqrt(G/(G-1) * sum_g (y_g - m n_g)^2) / sum(n).
 * A difference (real grip less dealt grip) is per board, the same clustering.
 *
 * Readings: `real` = the reply's Runner on the real grip and stack; `dealt` = the mean of the two deals the Corp uses.
 * A1: same first action (by card codes), same kind. A2: the real move among the reply's first 4. A3: stolen points
 * equal, breached servers equal, trashed assets/upgrades equal, credits within 2, and all four.
 * M: every board where A3 differs on a steal or a breach, by miss unit (a server breached by one and not the other, or
 * a steal that differs on the same breaches), sorted into kinds (see `classify`).
 */
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
const rows = [];
for (const f of files) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* a cut line */
    }
  }
}
const by = k => rows.filter(r => r.kind === k);
const KINDS = ['self', 'humanRunner', 'humanRunnerHC', 'aiRunnerNormal', 'aiRunnerHard'];
const pct = x => (Number.isFinite(x) ? (100 * x).toFixed(1) : '-');

/** Cluster SE of a ratio: items {g, y, n}. */
function ratio(items) {
  const games = new Map();
  for (const it of items) {
    const v = games.get(it.g) ?? { y: 0, n: 0 };
    v.y += it.y;
    v.n += it.n;
    games.set(it.g, v);
  }
  const Y = [...games.values()].reduce((a, v) => a + v.y, 0);
  const N = [...games.values()].reduce((a, v) => a + v.n, 0);
  const m = N ? Y / N : NaN;
  const G = games.size;
  const ss = [...games.values()].reduce((a, v) => a + (v.y - m * v.n) ** 2, 0);
  const se = G > 1 && N ? Math.sqrt((G / (G - 1)) * ss) / N : NaN;
  return { m, se, N, G };
}
const fmt = r => `${pct(r.m)}% ± ${pct(r.se)} (n ${r.N}, ${r.G} games)`;
const fmtD = r => `${r.m >= 0 ? '+' : ''}${(100 * r.m).toFixed(1)} ± ${(100 * r.se).toFixed(1)} pts`;

const lines = [];
const say = (...x) => lines.push(x.join(''));

// ---------------------------------------------------------------- sources and stops
const g = by('g');
const g2 = by('g2');
const ctl = by('ctl');
say('# R0 count 4: the reply\'s Runner against the real Runner');
say('');
say(`Self-play games: ${g.length}, matching the g1 base record (winner, cr, sc): ${g.filter(x => x.matchesBatch).length}.`);
for (const x of g.filter(x => !x.matchesBatch)) say(`- STOP: ${x.src} does not match the batch record`);
say(`Files and games replayed: ${g2.length}; stopped replays: ${g2.filter(x => x.stopped).length}; boards cut by a file's end: ${g2.reduce((a, x) => a + x.cut, 0)}.`);
for (const x of g2.filter(x => x.stopped)) say(`- ${x.src}: ${x.stopped}`);
say(`Control (real-grip reply on the control tree unlike beta's): ${ctl.length}${ctl.length ? ' STOP' : ''}.`);
for (const x of ctl.slice(0, 10)) say(`- ${x.src} T${x.T}`);
const errs = by('b').filter(b => b.model.real.err || b.model.d.some(d => d.err));
say(`Reply playouts that threw (scored where they stopped, as runnerReply does): ${errs.length}.`);
say('');

// ---------------------------------------------------------------- A1, A3 per board
const agree = (m, r) => ({
  stolen: m.o.stolen === r.o.stolen,
  breach: JSON.stringify(m.o.breached) === JSON.stringify(r.o.breached),
  trashed: m.o.trashed === r.o.trashed,
  credits: Math.abs(m.o.cr - r.o.cr) <= 2,
});
const allOf = a => a.stolen && a.breach && a.trashed && a.credits;
const n01 = b => (b ? 1 : 0);

say('## A1 and A3 by source (per board; dealt = mean of the two deals)');
say('');
say('| source | boards | reading | A1 same action | A1 same kind | A3 stolen | A3 breached | A3 trashed | A3 credits ±2 | A3 all four |');
say('|---|---|---|---|---|---|---|---|---|---|');
const a3diff = {};
for (const sk of KINDS) {
  const bs = by('b').filter(b => b.sk === sk);
  if (!bs.length) continue;
  const withFirst = bs.filter(b => b.real.first);
  for (const reading of ['real', 'rngOnly', 'gripOnly', 'dealt']) {
    const plays = b => (reading === 'real' ? [b.model.real] : reading === 'rngOnly' ? b.model.r ?? [] : reading === 'gripOnly' ? b.model.g ?? [] : b.model.d);
    if ((reading === 'gripOnly' && !bs[0].model.g) || (reading === 'rngOnly' && !bs[0].model.r)) continue;
    const mean = (b, f) => plays(b).reduce((a, p) => a + f(p), 0) / plays(b).length;
    const A1a = ratio(withFirst.map(b => ({ g: b.game, n: 1, y: mean(b, p => n01(p.first?.k === b.real.first.k)) })));
    const A1k = ratio(withFirst.map(b => ({ g: b.game, n: 1, y: mean(b, p => n01(p.first?.kind === b.real.first.kind)) })));
    const col = f => ratio(bs.map(b => ({ g: b.game, n: 1, y: mean(b, p => n01(f(agree(p, b.real)))) })));
    say(`| ${sk} | ${bs.length} | ${reading} | ${fmt(A1a)} | ${fmt(A1k)} | ${fmt(col(a => a.stolen))} | ${fmt(col(a => a.breach))} | ${fmt(col(a => a.trashed))} | ${fmt(col(a => a.credits))} | ${fmt(col(allOf))} |`);
  }
  // real less dealt, per board, for rule 3; split at gripOnly (the deals with R&D's real order put back)
  const avg = (ps, b, f) => ps.reduce((a, p) => a + n01(f(agree(p, b.real))), 0) / ps.length;
  const d = (f, from, to) => ratio(bs.map(b => ({ g: b.game, n: 1, y: avg(from(b), b, f) - avg(to(b), b, f) })));
  const R = b => [b.model.real];
  const G = b => b.model.g ?? b.model.d;
  const Rn = b => b.model.r ?? [b.model.real];
  const D = b => b.model.d;
  a3diff[sk] = {};
  for (const [name, from, to] of [['real - dealt', R, D], ['real - rngOnly (chance: the shuffler)', R, Rn], ['rngOnly - gripOnly (grip and stack)', Rn, G], ['gripOnly - dealt (R&D order)', G, D]])
    a3diff[sk][name] = { all: d(allOf, from, to), stolen: d(a => a.stolen, from, to), breach: d(a => a.breach, from, to) };
}
say('');
say('A3 real grip less dealt grip (paired per board; rule 3: the dealt grip is material if the dealt reading is lower by more than 1 SE):');
say('');
say('| source | split | all four | stolen | breached |');
say('|---|---|---|---|---|');
for (const [sk, vs] of Object.entries(a3diff)) for (const [name, v] of Object.entries(vs)) say(`| ${sk} | ${name} | ${fmtD(v.all)} | ${fmtD(v.stolen)} | ${fmtD(v.breach)} |`);
say('');

// ---------------------------------------------------------------- A2 per decision
say('## A2: the real move among the reply\'s first 4 (per main-phase decision)');
say('');
say('| source | decisions | real grip | dealt grip | real grip, its first pick | real grip, first decision of the turn |');
say('|---|---|---|---|---|---|');
for (const sk of KINDS) {
  const ds = by('d').filter(d => d.sk === sk);
  if (!ds.length) continue;
  const top = ratio(ds.map(d => ({ g: d.game, n: 1, y: n01(d.reply.pos >= 0 && d.reply.pos < 4) })));
  const dealt = ratio(ds.map(d => ({ g: d.game, n: 1, y: d.dealt.reduce((a, x) => a + n01(x.pos >= 0 && x.pos < 4), 0) / d.dealt.length })));
  const first = ratio(ds.map(d => ({ g: d.game, n: 1, y: n01(d.reply.pos === 0) })));
  const firstDec = ratio(ds.filter(d => d.di === 0).map(d => ({ g: d.game, n: 1, y: n01(d.reply.pos >= 0 && d.reply.pos < 4) })));
  say(`| ${sk} | ${ds.length} | ${fmt(top)} | ${fmt(dealt)} | ${fmt(first)} | ${fmt(firstDec)} |`);
}
say('');
// by kind of the real move
say('A2 (real grip, first 4) by the kind of the real move:');
say('');
say('| source | ' + ['run', 'credit', 'draw', 'install', 'event', 'ability', 'tag', 'end', 'other'].join(' | ') + ' |');
say('|---|---|---|---|---|---|---|---|---|---|');
for (const sk of KINDS) {
  const ds = by('d').filter(d => d.sk === sk);
  if (!ds.length) continue;
  const cell = kd => {
    const x = ds.filter(d => d.kd === kd);
    return x.length ? `${pct(x.filter(d => d.reply.pos >= 0 && d.reply.pos < 4).length / x.length)}% of ${x.length}` : '-';
  };
  say(`| ${sk} | ${['run', 'credit', 'draw', 'install', 'event', 'ability', 'tag', 'end', 'other'].map(cell).join(' | ')} |`);
}
say('');

// ---------------------------------------------------------------- P
say('## P: the deciding Normal Runner (planner on) at the people\'s boards');
say('');
say('| source | decisions | its pick = the person\'s move | first decision of the turn: same | same kind (first decision) | person\'s move in its first 4 |');
say('|---|---|---|---|---|---|');
for (const sk of ['humanRunner', 'humanRunnerHC']) {
  const ds = by('d').filter(d => d.sk === sk && d.P);
  if (!ds.length) continue;
  const same = ratio(ds.map(d => ({ g: d.game, n: 1, y: n01(d.P.same) })));
  const f = ds.filter(d => d.di === 0);
  const sameF = ratio(f.map(d => ({ g: d.game, n: 1, y: n01(d.P.same) })));
  const kindF = ratio(f.map(d => ({ g: d.game, n: 1, y: n01(d.P.pickKind === d.kd) })));
  const top = ratio(ds.map(d => ({ g: d.game, n: 1, y: n01(d.P.pos >= 0 && d.P.pos < 4) })));
  say(`| ${sk} | ${ds.length} | ${fmt(same)} | ${fmt(sameF)} | ${fmt(kindF)} | ${fmt(top)} |`);
}
say('');

// ---------------------------------------------------------------- M
/**
 * Miss units of one model play against the real turn. A unit is a server breached by the real Runner and not the model
 * ('missed'), by the model and not the real one ('extra'), or a steal that differs on the same breaches ('steal').
 * Kinds for 'missed' (in this order): cardRun (the real run was started by a card: a run event, an ability, a prompt);
 * runOutcome (the model ran that server too and was stopped: ice, the Corp's rez, breaks); sequence (at the real
 * decision before the run, the reply's top pick is that run, after earlier clicks of the turn the reply did not order);
 * pricedLow:<term> (the reply's ranking had the run below its top pick: blocked = scored -Infinity; creditsNow =
 * runShortfall > 0; repeat = already run this turn; unrezzedIce = unrezzed ice on it; value = none of these).
 * 'extra': runOutcome (the real Runner ran it and was stopped) or overRun (the real Runner did not run it).
 * 'steal': access or prompt (same breaches, different points: random accesses in HQ and R&D, or an access prompt).
 */
function units(b, p) {
  const out = [];
  const r = b.real.o;
  const m = p.o;
  const missed = r.breached.filter(s => !m.breached.includes(s));
  const extra = m.breached.filter(s => !r.breached.includes(s));
  if (!missed.length && !extra.length && r.stolen !== m.stolen) out.push({ dir: 'steal', kind: 'accessOrPrompt' });
  const decs = by_d.get(`${b.src}|${b.T}`) ?? [];
  for (const s of missed) {
    const run = b.real.runs.find((x, i) => x.server === s && r.runs[i]?.ok);
    if (!run) {
      out.push({ dir: 'missed', kind: 'other', s });
      continue;
    }
    if (run.how === 'card') {
      out.push({ dir: 'missed', kind: 'cardRun', s });
      continue;
    }
    if (m.runs.some(x => x.server === s)) {
      out.push({ dir: 'missed', kind: 'runOutcome', s });
      continue;
    }
    const d = decs.find(x => x.di === run.dec);
    const info = d?.runs.find(x => x.server === s);
    if (!info) {
      out.push({ dir: 'missed', kind: 'other', s });
      continue;
    }
    if (info.topIsRun) out.push({ dir: 'missed', kind: run.dec > 0 ? 'sequence' : 'sequence(first)', s });
    else {
      const term = info.runScore === null ? 'blocked' : info.shortfall !== null && info.shortfall > 0 ? 'creditsNow' : info.repeat ? 'repeat' : info.unrezzed > 0 ? 'unrezzedIce' : 'value';
      out.push({ dir: 'missed', kind: `pricedLow:${term}`, s });
    }
  }
  for (const s of extra) out.push({ dir: 'extra', kind: b.real.runs.some(x => x.server === s) ? 'runOutcome' : 'overRun', s });
  return out;
}
const by_d = new Map();
for (const d of by('d')) {
  const k = `${d.src}|${d.T}`;
  if (!by_d.has(k)) by_d.set(k, []);
  by_d.get(k).push(d);
}
const missesOf = b => {
  const realU = units(b, b.model.real);
  const dealtU = b.model.d.map(p => {
    const u = units(b, p);
    // the dealt grip: a miss on this deal on a board the real-grip reading gets right
    return realU.length === 0 && u.length ? u.map(x => ({ ...x, kind: `dealtGrip(${x.kind})` })) : u;
  });
  return { realU, dealtU };
};
say('## M: the misses, by kind (A3 differs on a steal or a breach)');
say('');
for (const sk of KINDS) {
  const bs = by('b').filter(b => b.sk === sk);
  if (!bs.length) continue;
  const tallies = { real: new Map(), dealt: new Map() };
  const gamesWith = { real: new Map(), dealt: new Map() };
  let boardsMissed = { real: 0, dealt: 0 };
  for (const b of bs) {
    const { realU, dealtU } = missesOf(b);
    if (realU.length) boardsMissed.real++;
    boardsMissed.dealt += dealtU.filter(u => u.length).length / dealtU.length;
    const add = (which, u, w) => {
      const key = `${u.dir} ${u.kind}`;
      tallies[which].set(key, (tallies[which].get(key) ?? 0) + w);
      if (!gamesWith[which].has(key)) gamesWith[which].set(key, new Set());
      gamesWith[which].get(key).add(b.game);
    };
    for (const u of realU) add('real', u, 1);
    for (const us of dealtU) for (const u of us) add('dealt', u, 1 / dealtU.length);
  }
  say(`### ${sk}: ${bs.length} boards; boards with a miss: real grip ${boardsMissed.real}, dealt grip ${boardsMissed.dealt.toFixed(1)}`);
  say('');
  say('| miss | real grip: units | share of missed (real got in) | games | dealt grip: units | share of missed | games |');
  say('|---|---|---|---|---|---|---|');
  const keys = [...new Set([...tallies.real.keys(), ...tallies.dealt.keys()])].sort();
  const missedTotal = w => [...tallies[w].entries()].filter(([k]) => k.startsWith('missed') || k.startsWith('steal')).reduce((a, [, v]) => a + v, 0);
  const mt = { real: missedTotal('real'), dealt: missedTotal('dealt') };
  for (const k of keys) {
    const cell = w => {
      const v = tallies[w].get(k) ?? 0;
      const share = k.startsWith('extra') ? '-' : mt[w] ? `${pct(v / mt[w])}%` : '-';
      return `${Number.isInteger(v) ? v : v.toFixed(1)} | ${share} | ${gamesWith[w].get(k)?.size ?? 0}`;
    };
    say(`| ${k} | ${cell('real')} | ${cell('dealt')} |`);
  }
  say('');
}

// ---------------------------------------------------------------- Row 36
const t = by('t');
if (t.length) {
  say('## Row 36\'s two boards (8 dealt samples each, then the real grip)');
  say('');
  say('| board | sample | reply: stolen / breached / winner | deciding Normal Runner: stolen / breached / winner | actual |');
  say('|---|---|---|---|---|');
  const o = p => `${p.o.stolen} / ${p.o.breached.join(',') || '-'} / ${p.o.win ?? '-'}`;
  for (const x of t) say(`| ${x.src} T${x.T} | ${x.k} | ${o(x.reply)} | ${o(x.deciding)} | ${x.actual ? `${x.actual.stolen} / ${x.actual.breached.join(',') || '-'} / ${x.actual.win ?? '-'}` : ''} |`);
  say('');
}

// ---------------------------------------------------------------- cost
const ms = by('b').map(b => b.ms).sort((a, b) => a - b);
if (ms.length) say(`Reply playout time (real grip, beta tree): median ${ms[Math.floor(ms.length / 2)]} ms, p95 ${ms[Math.floor(ms.length * 0.95)]} ms over ${ms.length} boards.`);
console.log(lines.join('\n'));
