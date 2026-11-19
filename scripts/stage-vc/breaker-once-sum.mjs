// V-C item 1 count, the summing step of breaker-once.ts (JSON lines from every shard).
//   node scripts/stage-vc/breaker-once-sum.mjs <dir or files...> > sum.md
// Reads every *.txt / *.jsonl under the given paths. Kinds kept apart: self, humanRunner, humanCorp.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// SUM_ARMS: the arms the run asked (its ARMS_ASK), in that order; the default is the first count's seven.
const ARMS = process.env.SUM_ARMS ? process.env.SUM_ARMS.split(',') : ['iceOwnsBoth', 'iceOwnsCorp', 'rigOwnsBoth', 'rigOwnsCorp', 'readerOnce', 'orEndCorp', 'iceOrEndCorp'];
const ASKED = ['beta', 'control', ...ARMS];
const KINDS = ['self', 'humanRunner', 'humanCorp'];
const files = [];
const walk = p => (statSync(p).isDirectory() ? readdirSync(p).forEach(f => walk(join(p, f))) : /\.(txt|jsonl)$/.test(p) && files.push(p));
process.argv.slice(2).forEach(walk);
const rows = [];
for (const f of files) for (const l of readFileSync(f, 'utf8').split('\n')) if (l.startsWith('{')) try { rows.push(JSON.parse(l)); } catch { /* a cut line */ }
const r2 = x => (Number.isFinite(x) ? Math.round(x * 100) / 100 : x);
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const se = xs => (xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1) / xs.length) : NaN);
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const pm = xs => `${r2(mean(xs))} ± ${r2(se(xs))} (n ${xs.length})`;
const P = s => console.log(s);

const games = rows.filter(r => r.kind === 'g');
const humans = rows.filter(r => r.kind === 'h');
const decs = rows.filter(r => r.kind === 'd');
const conts = rows.filter(r => r.kind === 'c');
const nGames = { self: games.length, humanRunner: new Set(humans.filter(h => h.sk === 'humanRunner').map(h => h.src)).size, humanCorp: new Set(humans.filter(h => h.sk === 'humanCorp').map(h => h.src)).size };

P(`# breaker-once count: summary\n`);
P(`Sources: ${games.length} deals (${games.filter(g => g.matchesBatch).length} match the batch's record), human files ${humans.length} (${humans.filter(h => h.stopped).length} stopped early: ${humans.filter(h => h.stopped).map(h => `${h.src} ${h.stopped}`).join('; ') || 'none'}). Decisions ${decs.length}.`);
for (const g of games.filter(g => !g.matchesBatch)) P(`- STOP: ${g.src} does not match the batch's record`);
const ctl = decs.filter(d => d.controlDiffers);
P(`Control: ${ctl.length} decisions differ from beta${ctl.length ? ' (STOP): ' + ctl.slice(0, 5).map(d => `${d.src} #${d.i}`).join(', ') : ''}. Errors: ${decs.filter(d => d.errors).length}${decs.filter(d => d.errors).slice(0, 3).map(d => ` ${d.src}#${d.i} ${JSON.stringify(d.errors).slice(0, 160)}`).join('')}.`);
P(`Fresh beta equals the recorded AI move: ${decs.filter(d => d.fresh === true).length} of ${decs.filter(d => d.fresh !== undefined).length}.\n`);

// ------------------------------------------------------------------------------------------------ A1
P(`## A1. Each installed breaker's two movements (first decision board of each half-turn)\n`);
P(`dRig: runnerRigValue with it less without it. dIceC / dIceR: the sum of iceWorth without it less with it (Corp view / Runner view); split into the ice of a type it breaks (Type) and the rest (Other). dCbC / dCbR: corpBoardValue, the same. toCome: the rig's movement on the iceOwnsCorp rig term (stops still to meet), so the rest of dRig is the rezzed ice of its type already on the board.\n`);
const a1 = decs.flatMap(d => (d.a1 ?? []).map(x => ({ ...x, sk: d.sk })));
const a1Table = (label, sel) => {
  P(`| ${label} | n | dRig | toCome | board share of dRig | dIceC | of it Type | Other | dCbC | dIceR | dCbR | dIceC / dRig (ratio of means) | dIceTypeC / dRig |`);
  P(`|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const [name, xs] of sel) {
    if (!xs.length) continue;
    const m = k => mean(xs.map(x => x[k]));
    P(`| ${name} | ${xs.length} | ${r2(m('dRig'))} | ${r2(m('dRigToCome'))} | ${r2(1 - m('dRigToCome') / m('dRig'))} | ${r2(m('dIceC'))} | ${r2(m('dIceTypeC'))} | ${r2(m('dIceOtherC'))} | ${r2(m('dCbC'))} | ${r2(m('dIceR'))} | ${r2(m('dCbR'))} | ${r2(m('dIceC') / m('dRig'))} | ${r2(m('dIceTypeC') / m('dRig'))} |`);
  }
  P('');
};
for (const sk of KINDS) {
  const xs = a1.filter(x => x.sk === sk);
  if (!xs.length) continue;
  P(`### ${sk} (${xs.length} breaker-boards)\n`);
  const bucket = n => (n >= 3 ? '3+' : String(n));
  a1Table('by kind', ['typed', 'AI', 'oneUse', 'other'].map(k => [k, xs.filter(x => x.kind === k)]));
  a1Table('rezzed ice of its type out', ['0', '1', '2', '3+'].map(b => [b, xs.filter(x => bucket(x.ofType) === b)]));
  a1Table('breakers in the rig', ['1', '2', '3+'].map(b => [b, xs.filter(x => bucket(x.breakers) === b)]));
  a1Table('reading 1 base: rezzed ice of its type out >= 1', [['all kinds', xs.filter(x => x.ofType >= 1)], ['typed', xs.filter(x => x.ofType >= 1 && x.kind === 'typed')], ['another breaker of its type too', xs.filter(x => x.ofType >= 1 && x.sameType > 0)], ['the only breaker of its type', xs.filter(x => x.ofType >= 1 && x.sameType === 0)]]);
  const base = xs.filter(x => x.ofType >= 1);
  const ratios = base.filter(x => x.dRig > 0.5).map(x => x.dIceC / x.dRig);
  P(`Reading 1 (${sk}): mean dIceC ${r2(mean(base.map(x => x.dIceC)))} against half of mean dRig ${r2(mean(base.map(x => x.dRig)) / 2)} => ${mean(base.map(x => x.dIceC)) >= mean(base.map(x => x.dRig)) / 2 ? 'GENERAL' : 'not general'}; per breaker (dRig > 0.5) median ratio ${r2(q(ratios, 0.5))}, p25 ${r2(q(ratios, 0.25))}, p75 ${r2(q(ratios, 0.75))}, share with ratio >= 0.5 ${r2(ratios.filter(r => r >= 0.5).length / Math.max(1, ratios.length))} of ${ratios.length}.\n`);
}

// ------------------------------------------------------------------------------------------------ A2
P(`## A2. The class: decisions whose options differ by a breaker in the rig\n`);
const cls = decs.filter(d => d.cls);
P(`| class | kind | decisions | a game | beta picks a trash | by run term / fallback | ${ARMS.join(' | ')} |`);
P(`|---|---|---|---|---|---|${ARMS.map(() => '---').join('|')}|`);
for (const c of ['progTrash', 'lookAhead', 'progIce', 'breakerInstall', 'breakerLost']) {
  for (const sk of KINDS) {
    const xs = cls.filter(d => d.cls.cls === c && d.sk === sk);
    if (!xs.length) continue;
    const trash = c === 'progTrash' ? xs.filter(d => { const o = d.cls.opts.find(o => o.a === d.beta); return o && o.gone.length; }).length : '';
    const by = c === 'progTrash' ? `${xs.filter(d => d.by === 'run').length} / ${xs.filter(d => d.by === 'fb').length}` : '';
    P(`| ${c} | ${sk} | ${xs.length} | ${r2(xs.length / Math.max(1, nGames[sk]))} | ${trash} | ${by} | ${ARMS.map(a => xs.filter(d => d.changed?.[a]).length).join(' | ')} |`);
  }
}
P('');
P(`progTrash by card (all sources): ${Object.entries(cls.filter(d => d.cls.cls === 'progTrash').reduce((m, d) => ((m[d.cls.card] = (m[d.cls.card] ?? 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join(', ')}`);
const pt = cls.filter(d => d.cls.cls === 'progTrash');
const ptOpts = pt.flatMap(d => d.cls.opts.filter(o => o.gone.length).map(o => ({ ...o, sk: d.sk })));
P(`progTrash answers that remove a program: ${ptOpts.length}; a breaker among them ${ptOpts.filter(o => o.breaker).length}; mean dRig ${r2(mean(ptOpts.map(o => o.dRig)))}, mean Corp-view ice movement ${r2(mean(ptOpts.map(o => o.dIceC)))} (the readerOnce correction).\n`);

// ------------------------------------------------------------------------------------------------ B: decisions changed
P(`## B. Decisions changed per game, by kind (in the class / outside it)\n`);
const CLS = ['corpPrompt', 'corpRez', 'corpMain', 'runnerPrompt', 'runnerMain', 'runnerOff'];
for (const sk of KINDS) {
  const xs = decs.filter(d => d.sk === sk);
  if (!xs.length) continue;
  P(`### ${sk} (${nGames[sk]} games, ${xs.length} decisions)\n`);
  P(`| arm | ${CLS.join(' | ')} | Corp all | Runner all |`);
  P(`|---|${CLS.map(() => '---').join('|')}|---|---|`);
  for (const a of ARMS) {
    const cell = c => { const ys = xs.filter(d => d.c === c && d.changed?.[a]); return `${r2(ys.filter(d => d.cls).length / nGames[sk])} / ${r2(ys.filter(d => !d.cls).length / nGames[sk])}`; };
    const side = s => r2(xs.filter(d => d.side === s && d.changed?.[a]).length / nGames[sk]);
    P(`| ${a} | ${CLS.map(cell).join(' | ')} | ${side('corp')} | ${side('runner')} |`);
  }
  P('');
}

// ------------------------------------------------------------------------------------------------ B: continuations
P(`## B. Paired continuations (arm's decision first against beta's, beta's agents both sides, to the end)\n`);
P(`Corp points a-b and agenda points stolen (the Runner's final score) a-b, mean ± SE. Out-of-class pairs are capped per source and arm (a sample).\n`);
P(`| arm | group | pairs | Corp wins a / b | Corp points a-b | stolen a-b | run stolen a-b (class) |`);
P(`|---|---|---|---|---|---|---|`);
const good = c => !c.ca.err && !c.cb.err && c.ca.winner !== undefined;
for (const a of ARMS) {
  const xs = conts.filter(c => c.arm === a && good(c));
  const groups = [
    ['class, Corp decisions, self', xs.filter(c => c.cls && c.side === 'corp' && c.sk === 'self')],
    ['class, Corp decisions, human', xs.filter(c => c.cls && c.side === 'corp' && c.sk !== 'self')],
    ['class, Corp decisions, all', xs.filter(c => c.cls && c.side === 'corp')],
    ['class, Corp prompts (progTrash), all', xs.filter(c => c.cls === 'progTrash')],
    ['class, Runner decisions, all', xs.filter(c => c.cls && c.side === 'runner')],
    ['Corp decisions, self', xs.filter(c => c.side === 'corp' && c.sk === 'self')],
    ['Corp decisions, all', xs.filter(c => c.side === 'corp')],
    ['Corp, outside the class, all', xs.filter(c => c.side === 'corp' && !c.cls)],
    ['Runner decisions, all', xs.filter(c => c.side === 'runner')],
  ];
  for (const [g, ys] of groups) {
    if (!ys.length) continue;
    const runs = ys.filter(c => c.ca.run && c.cb.run).map(c => c.ca.run.stolen - c.cb.run.stolen);
    P(`| ${a} | ${g} | ${ys.length} | ${ys.filter(c => c.ca.winner === 'corp').length} / ${ys.filter(c => c.cb.winner === 'corp').length} | ${pm(ys.map(c => c.ca.cs - c.cb.cs))} | ${pm(ys.map(c => c.ca.rs - c.cb.rs))} | ${runs.length ? pm(runs) : ''} |`);
  }
}
P(`\nContinuation errors: ${conts.filter(c => !good(c)).length}.\n`);

// ------------------------------------------------------------------------------------------------ (i) / (ii) split
// AI Coordinator 18:32Z (red team S1): the run term is also reached inside the Corp's model of itself (the planner's
// Runner reply, the playout's Corp, rez follow-ups). (i) = a top-level Corp prompt the arm's tree decided by the run term
// (where its correction reads directly); (ii) = every other changed Corp decision (carried by the Corp's model of itself).
P(`## Changed Corp decisions split: (i) top-level run-term prompt / (ii) everything else\n`);
const dKey = d => `${d.src}#${d.i}`;
const dBy = new Map(decs.map(d => [dKey(d), d]));
const top = (d, a) => d.c === 'corpPrompt' && d.prices?.[a]?.by === 'run';
P(`| arm | part | changed (self / human) | by kind | pairs | Corp points a-b | stolen a-b | run stolen a-b |`);
P(`|---|---|---|---|---|---|---|---|`);
for (const a of ARMS) {
  const ch = decs.filter(d => d.side === 'corp' && d.changed?.[a]);
  for (const [part, sel] of [['(i)', d => top(d, a)], ['(ii)', d => !top(d, a)]]) {
    const ys = ch.filter(sel);
    const kinds = {};
    for (const d of ys) kinds[d.c] = (kinds[d.c] ?? 0) + 1;
    const ps = conts.filter(c => c.arm === a && c.side === 'corp' && good(c) && dBy.get(dKey(c)) && sel(dBy.get(dKey(c))));
    const runs = ps.filter(c => c.ca.run && c.cb.run).map(c => c.ca.run.stolen - c.cb.run.stolen);
    P(`| ${a} | ${part} | ${ys.filter(d => d.sk === 'self').length} / ${ys.filter(d => d.sk !== 'self').length} | ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')} | ${ps.length} | ${ps.length ? pm(ps.map(c => c.ca.cs - c.cb.cs)) : ''} | ${ps.length ? pm(ps.map(c => c.ca.rs - c.cb.rs)) : ''} | ${runs.length ? pm(runs) : ''} |`);
  }
  for (const d of ch.filter(d => !top(d, a))) P(`- ${a} (ii): ${dKey(d)} T${d.T ?? ''} ${d.sk} ${d.c}${d.cls ? ` ${d.cls.cls ?? d.cls}` : ''}: beta ${d.beta}; ${a} ${d.changed[a]}${d.prices?.[a] ? ` (decided by ${d.prices[a].by})` : ''}`);
}
P('');

// ------------------------------------------------------------------------------------------------ time
P(`## Time against the control arm (mean / p95 ratios; decisions over 2x control at 0.5 s or more)\n`);
P(`corpMain is the planner's decision (the look-ahead runs inside it).\n`);
P(`| arm | kind | mean | p95 | corpMain mean | corpMain p95 | over 2x |`);
P(`|---|---|---|---|---|---|---|`);
for (const a of ARMS) {
  const i = ASKED.indexOf(a);
  for (const sk of KINDS) {
    const xs = decs.filter(d => d.sk === sk && d.ms);
    if (!xs.length) continue;
    const m = (ys, j) => mean(ys.map(d => d.ms[j]));
    const p = (ys, j) => q(ys.map(d => d.ms[j]), 0.95);
    const cm = xs.filter(d => d.c === 'corpMain');
    const over = xs.filter(d => d.ms[i] >= 500 && d.ms[i] > 2 * d.ms[1]).length;
    const mr = m(xs, i) / m(xs, 1), pr = p(xs, i) / p(xs, 1);
    P(`| ${a} | ${sk} | ${r2(mr)}${mr > 1.05 ? ' STOP' : ''} | ${r2(pr)}${pr > 1.15 ? ' STOP' : ''} | ${r2(m(cm, i) / m(cm, 1))} | ${r2(p(cm, i) / p(cm, 1))} | ${over}${over ? ' STOP' : ''} |`);
  }
}
P('');
for (const sk of KINDS) {
  const xs = decs.filter(d => d.sk === sk && d.ms);
  if (xs.length) P(`Noise reference (${sk}): beta against control, mean ${r2(mean(xs.map(d => d.ms[0])) / mean(xs.map(d => d.ms[1])))}, p95 ${r2(q(xs.map(d => d.ms[0]), 0.95) / q(xs.map(d => d.ms[1]), 0.95))}, beta over 2x control at 0.5 s or more: ${xs.filter(d => d.ms[0] >= 500 && d.ms[0] > 2 * d.ms[1]).length}.`);
}
P('');
P(`Fire counts (arm's term changed a value, per decision, mean): ${ARMS.map(a => `${a} ${r2(mean(decs.map(d => d.fire?.[ASKED.indexOf(a)] ?? 0)))}`).join(', ')}.\n`);

// ------------------------------------------------------------------------------------------------ every changed class decision
P(`## Every changed decision of the A2 class\n`);
for (const d of cls.filter(d => d.changed)) {
  P(`- ${d.src} #${d.i} T${d.T} ${d.sk}/${d.who} ${d.c} ${d.cls.cls}${d.cls.card ? ` ${d.cls.card}` : ''}${d.cls.cards ? ` [${d.cls.cards}]` : ''}${d.root ? ` root ${d.root}` : ''}: beta ${d.beta}; ${Object.entries(d.changed).map(([a, x]) => `${a} ${x}`).join('; ')}`);
  if (d.prices) for (const [t, p] of Object.entries(d.prices)) P(`  - ${t} (${p.by}${p.loss !== undefined ? ` loss ${r2(p.loss)}` : ''}): ${(p.opts ?? []).map(o => `${o.a} ${o.p}${o.v ? ` ${o.v}` : ''}`).join('; ')}`);
  if (d.cls.opts) P(`  - movements: ${d.cls.opts.filter(o => o.gone.length).map(o => `${o.a} (${o.gone}) dRig ${o.dRig} dIceC ${o.dIceC}`).join('; ')}`);
  for (const c of conts.filter(c => c.src === d.src && c.i === d.i)) P(`  - pair ${c.arm}: a ${c.ca.winner} ${c.ca.cs}-${c.ca.rs}${c.ca.run ? ` run stolen ${c.ca.run.stolen}` : ''} / b ${c.cb.winner} ${c.cb.cs}-${c.cb.rs}${c.cb.run ? ` run stolen ${c.cb.run.stolen}` : ''}`);
}
P(`\n## Unchanged progTrash decisions where beta trashes a program (for the error to look for)\n`);
for (const d of pt.filter(d => !d.changed && d.cls.opts.find(o => o.a === d.beta)?.gone.length)) P(`- ${d.src} #${d.i} T${d.T} ${d.sk} ${d.cls.card}${d.root ? ` root ${d.root}` : ''}: beta ${d.beta}; ${(d.prices?.beta?.opts ?? []).map(o => `${o.a} ${o.p}${o.v ? ` ${o.v}` : ''}`).join('; ')}`);
