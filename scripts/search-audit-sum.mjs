// Spec-search S1: prints the continuation audit from batch games carrying `search` (scripts/search-audit.ts tuples).
// corp-losses-sum.mjs calls it at the end of a batch summary. Per Corp planner decision: does another continuation
// (hold: no agenda install from HQ this turn; finish: score, then advance an installed agenda, first) beat the line
// the planner chose, by how much, on which turn kinds, and the time split.

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');
const f1 = x => (Number.isFinite(x) ? x.toFixed(1) : '-');
const median = xs => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const MARGINS = [0, 1, 3, 6];

/** One decision as an object, with the alternative continuations' best gains */
function decision(t) {
  const [kind, turn, clicks, credits, chosen, pick, cands, ms, replyMs, extraMs] = t;
  const corpTurn = Math.ceil(turn / 2);
  const alt = []; // every distinct non-rule line: { i, mode, gain over chosen, same first }
  cands.forEach((c, i) => {
    const [type, agenda, rule, hold, holdD, finish, finishD] = c;
    if (holdD && hold !== null) alt.push({ i, mode: 'hold', type, agenda, gain: hold - chosen, same: i === pick, overRule: rule === null ? Infinity : hold - rule });
    if (finishD && finish !== null) alt.push({ i, mode: 'finish', type, agenda, gain: finish - chosen, same: i === pick, overRule: rule === null ? Infinity : finish - rule });
  });
  // The noise floor: any candidate's rule line, re-scored on two fresh reply deals, against the pick
  const resamples = cands.map(c => c[7]).filter(v => v !== null && v !== undefined);
  const nullGain = resamples.length ? Math.max(...resamples) - chosen : null;
  const best = alt.reduce((a, b) => (!a || b.gain > a.gain ? b : a), null);
  const sameBest = alt.filter(a => a.same).reduce((a, b) => (!a || b.overRule > a.overRule ? b : a), null);
  return { kind, corpTurn, clicks, credits, chosen, pick, cands, ms, replyMs, extraMs, alt, best, sameBest, nullGain, anyDistinct: alt.length > 0 };
}

function block(label, ds) {
  if (!ds.length) return;
  const n = ds.length;
  const beats = m => ds.filter(d => d.best && d.best.gain > m).length;
  const sameBeats = m => ds.filter(d => d.sameBest && d.sameBest.overRule > m).length;
  const gains = ds.filter(d => d.best && d.best.gain > 0).map(d => d.best.gain);
  console.log(`  ${label} (${n} decisions): any distinct alt line ${pct(ds.filter(d => d.anyDistinct).length, n)}`);
  console.log(`    another continuation (any candidate) beats the pick by > ${MARGINS.join(' / ')}: ${MARGINS.map(m => pct(beats(m), n)).join(' / ')}; median gain when > 0: ${f1(median(gains))}`);
  if (ds.some(d => d.nullGain !== null)) {
    const nulls = m => ds.filter(d => d.nullGain !== null && d.nullGain > m).length;
    console.log(`    noise floor: a candidate's rule line re-sampled (2 fresh reply deals) beats the pick by > ${MARGINS.join(' / ')}: ${MARGINS.map(m => pct(nulls(m), n)).join(' / ')}`);
    // Net of the noise (AI Coordinator 2026-11-09): an alt line counts only where it beats the pick by more than the
    // re-sample's own gain over the pick at that decision (0 when the re-sample is lower), plus the margin
    const net = m => ds.filter(d => d.best && d.nullGain !== null && d.best.gain > Math.max(0, d.nullGain) + m).length;
    console.log(`    net of the noise floor: alt line beats the pick by more than the re-sample's gain + ${MARGINS.join(' / ')}: ${MARGINS.map(m => pct(net(m), n)).join(' / ')}`);
  }
  console.log(`    same first action, alt line beats its rule line by > ${MARGINS.join(' / ')}: ${MARGINS.map(m => pct(sameBeats(m), n)).join(' / ')}`);
  const winners = ds.filter(d => d.best && d.best.gain > 3).map(d => d.best);
  if (winners.length) {
    const tally = {};
    for (const w of winners) {
      const k = `${w.mode} after ${w.same ? 'the pick' : 'another first'} (${w.agenda ? 'agenda ' : ''}${w.type})`;
      tally[k] = (tally[k] ?? 0) + 1;
    }
    const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log(`    winners by > 3: ${top.map(([k, v]) => `${k} ${pct(v, winners.length)}`).join('; ')}`);
  }
}

export function printSearchAudit(games) {
  const ds = games.filter(g => g.search).flatMap(g => g.search.map(decision));
  if (!ds.length) return;
  console.log('\n=== Spec-search S1: Corp planner continuations (rule / hold / finish-first) ===');
  console.log(`Decisions: ${ds.length} in ${games.filter(g => g.search).length} games. "Beats" compares reply-scored values (2 samples, common deals).`);
  const relevant = ds.filter(d => d.kind !== 'neither');
  block('agenda-relevant (installed or in HQ)', relevant);
  block('agenda installed, unscored', ds.filter(d => d.kind === 'installed'));
  block('agenda in HQ only', ds.filter(d => d.kind === 'hq'));
  block('neither', ds.filter(d => d.kind === 'neither'));
  console.log('  agenda-relevant by Corp turn:');
  for (const [label, lo, hi] of [['turns 1-3', 1, 3], ['turns 4-6', 4, 6], ['turns 7+', 7, 999]]) block(label, relevant.filter(d => d.corpTurn >= lo && d.corpTurn <= hi));
  console.log('  agenda-relevant by clicks left:');
  for (const c of [3, 2, 1]) block(`${c}${c === 3 ? '+' : ''} click${c > 1 ? 's' : ''}`, relevant.filter(d => (c === 3 ? d.clicks >= 3 : d.clicks === c)));
  const time = list => {
    const ms = list.reduce((n, d) => n + d.ms, 0);
    const reply = list.reduce((n, d) => n + d.replyMs, 0);
    const extra = list.reduce((n, d) => n + d.extraMs, 0);
    return `${f1(ms / list.length)} ms per decision as played, reply samples ${pct(reply, ms)} of it, playouts ${pct(ms - reply, ms)}; measurement's two extra lines ${f1(extra / list.length)} ms (${f1(extra / Math.max(1, ms))}x)`;
  };
  console.log(`  time, all: ${time(ds)}`);
  console.log(`  time, agenda-relevant: ${time(relevant)}`);
  console.log(`  time, neither: ${time(ds.filter(d => d.kind === 'neither'))}`);
  console.log(`  candidates per decision: ${f1(ds.reduce((n, d) => n + d.cands.length, 0) / ds.length)}`);
}
