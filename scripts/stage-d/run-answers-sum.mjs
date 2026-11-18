// Sums scripts/stage-d/run-answers.ts output (the ai-script `out` folder, or files): node scripts/stage-d/run-answers-sum.mjs out/
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = process.argv.slice(2).flatMap(p => (statSync(p).isDirectory() ? readdirSync(p).filter(f => f.endsWith('.txt')).map(f => join(p, f)) : [p]));
const lines = files.flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
const srcs = lines.filter(l => l.kind === 'src');
const decs = lines.filter(l => l.kind === 'dec');
const arms = lines.filter(l => l.kind === 'arm');
const human = s => s.startsWith('human:');
const groups = { self: s => !human(s), human };
const f2 = x => (Math.round(x * 100) / 100).toFixed(2);
const out = [];
const p = s => out.push(s);

p(`sources: ${srcs.filter(s => s.play === 'base').length} deals (base), ${srcs.filter(s => s.play === 'arm').length} deals (arm), ${srcs.filter(s => s.play === 'human').length} human games`);
for (const [g, is] of Object.entries(groups)) {
  const S = srcs.filter(s => is(s.src) && s.play !== 'arm');
  const D = decs.filter(d => is(d.src) && d.side === 'corp');
  const n = S.length || 1;
  const sum = k => S.reduce((a, s) => a + (s[k] ?? 0), 0);
  const dis = D.filter(d => d.disagree);
  p(`\n## Corp, ${g} (${S.length} games)`);
  p(`Corp prompts during a run: ${sum('prompts')} (${f2(sum('prompts') / n)} a game); family (answers differ in whether the run goes on) ${D.filter(d => d.family).length}; separating (differ in whether the Runner gets in, by the walk) ${D.filter(d => d.separating).length} (${f2(D.filter(d => d.separating).length / n)} a game)`);
  p(`given answer lets the Runner in where another keeps it out (disagree): ${dis.length} (${f2(dis.length / n)} a game); followed by a breach ${dis.filter(d => d.followed?.breach).length}, a steal ${dis.filter(d => d.followed?.steal).length}, a game end ${dis.filter(d => d.followed?.end).length} (Runner wins ${dis.filter(d => d.followed?.end === 'runner').length})`);
  if (g === 'human') p(`  of these, the recorded move was the given answer: ${dis.filter(d => d.recordedIsGiven).length}`);
  const sepD = D.filter(d => d.separating && d.priced !== undefined);
  p(`priced variant (score less runLoss when the walk lets the Runner in): changed ${sepD.filter(d => d.priced !== d.given).length} (${f2(sepD.filter(d => d.priced !== d.given).length / n)} a game); keeps out where the given lets in ${dis.filter(d => d.pricedOut === 'out').length} of ${dis.length}`);
  const cause = {};
  for (const d of dis) cause[d.cause] = (cause[d.cause] ?? 0) + 1;
  p(`given answer is the fallback's (answerPrompt on the state): ${D.filter(d => d.givenIsFallback).length} of ${D.filter(d => d.givenIsFallback !== undefined).length}`);
  p(`cause: ${JSON.stringify(cause)}; walk's answer leaves a prompt pending with the run on: ${dis.filter(d => d.walkPending).length}`);
  const cards = {};
  for (const d of dis) cards[d.card] = (cards[d.card] ?? 0) + 1;
  p(`by card: ${Object.entries(cards).sort((a, b) => b[1] - a[1]).map(([c, k]) => `${c} ${k}`).join(', ')}`);
  const agree = D.filter(d => d.separating && !d.disagree);
  p(`separating, given answer keeps the Runner out (agree): ${agree.length}; by card: ${Object.entries(agree.reduce((m, d) => ((m[d.card] = (m[d.card] ?? 0) + 1), m), {})).map(([c, k]) => `${c} ${k}`).join(', ')}`);
  if (g === 'self' && S.some(s => s.probeCalls !== undefined)) p(`PROBE: the agents' own fallback calls for the Corp during a run (top level, planner reply, playouts; both agents): ${sum('probeCalls')} (${f2(sum('probeCalls') / n)} a game), options ${sum('probeOpts')} (${f2(sum('probeOpts') / n)} a game); against ${sum('prompts')} top-level Corp prompts in a run`);
  const asks = sum('holdAsks');
  p(`hold asks: ${asks} (${f2(asks / n)} a game); arm time ${sum('armMs')} ms${g === 'self' ? ` against Corp decision time ${sum('corpMs')} ms (x${(1 + sum('armMs') / Math.max(1, sum('corpMs'))).toFixed(3)} at the top level)` : ''}`);
}

p('\n## The arm (changed decisions)');
const A = srcs.filter(s => s.play === 'arm');
p(`self-play: ${arms.length} changed in ${A.length} deals (${f2(arms.length / (A.length || 1))} a game); followed by a breach ${arms.filter(a => a.followed?.breach).length}, a steal ${arms.filter(a => a.followed?.steal).length}`);
const H = srcs.filter(s => s.play === 'human');
p(`human: ${H.reduce((a, s) => a + s.changed, 0)} changed in ${H.length} games (${f2(H.reduce((a, s) => a + s.changed, 0) / (H.length || 1))} a game)`);
const base = Object.fromEntries(srcs.filter(s => s.play === 'base').map(s => [s.src, s]));
const flips = A.filter(a => base[a.src] && base[a.src].winner !== a.winner);
p(`deal winners base -> arm: Corp ${srcs.filter(s => s.play === 'base' && s.winner === 'corp').length} -> ${A.filter(s => s.winner === 'corp').length} of ${A.length}; flipped ${flips.length}: ${flips.map(a => `${a.src} ${base[a.src].winner}->${a.winner}`).join(', ')}`);
p('\nchanged decisions (self-play), each: src T server card given -> arm | options | followed');
for (const a of arms) p(`- ${a.src} T${a.turn} ${a.server} ${a.card}${a.step ? ' ' + a.step : ''}: ${a.given} -> ${a.arm} (runLoss ${a.runLoss}) | ${a.options?.map(o => `${o.id}:${o.out}${o.settled !== undefined ? `(${o.one}/${o.settled})` : ''}`).join(' ')} | ${JSON.stringify(a.followed)}`);
const hArm = decs.filter(d => d.arm);
if (hArm.length) {
  p('\nchanged decisions (human, the recorded moves go on), each: src T server card step given -> arm (runLoss) | options | followed | recorded');
  for (const d of hArm) p(`- ${d.src} T${d.turn} ${d.server} ${d.card} ${d.step ?? ''}: ${d.given} -> ${d.arm} (runLoss ${d.armRunLoss}) | ${d.options.map(o => `${o.id}:${o.out}`).join(' ')} | ${JSON.stringify(d.followed)} | recorded ${d.recorded}`);
}
p('\ndisagreements, each: src T server card shred given (out) -> walk | cause | score one-step/full given vs walk | followed');
for (const d of decs.filter(d => d.disagree)) p(`- ${d.src} T${d.turn} ${d.server} ${d.card}${d.shred ? ' [Shred]' : ''}: ${d.given} -> ${d.walk} | ${d.cause} | priced ${d.priced} (runLoss ${d.runLoss}) | ${JSON.stringify(d.score)} | ${JSON.stringify(d.followed)}${d.recorded ? ` | recorded ${d.recorded}` : ''}`);

const gated = lines.filter(l => l.gate && l.side === 'corp');
if (gated.length) {
  p('\n## The gates (GATE=1): every Corp prompt during a run');
  for (const [g, is] of Object.entries(groups)) {
    const D = gated.filter(d => is(d.src));
    const n = srcs.filter(s => is(s.src) && s.play !== 'arm').length || 1;
    const c = f => D.filter(d => f(d.gate)).length;
    p(`${g}: ${D.length} prompts; verdict differs ${c(x => x.verdict)}; one-step run-over differs (ruling 6) ${c(x => x.oneStep)}; board key differs ${c(x => x.board)}`);
    p(`  verdict differs, run goes on either way one step (ruling 6 does not ask) ${c(x => x.verdict && !x.oneStep)}; verdict differs, board key same (the key would miss) ${c(x => x.verdict && !x.board)}`);
    p(`  board key differs, verdict same (asks with no change) ${c(x => x.board && !x.verdict)}; ruling 6 opens ${c(x => x.oneStep)}`);
    const asks = D.reduce((a, d) => a + d.gate.asks, 0);
    const ms = D.reduce((a, d) => a + d.gate.ms, 0);
    const keyMs = D.reduce((a, d) => a + d.gate.keyMs, 0);
    p(`  board gate's cost at the top level: ${asks} asks (${f2(asks / n)} a game), ${Math.round(ms)} ms (${f2(ms / n)} ms a game); the keys ${Math.round(keyMs)} ms`);
    const miss = D.filter(d => d.gate.verdict && !d.gate.oneStep);
    for (const d of miss) p(`  - ${d.src} T${d.turn} ${d.server} ${d.card} ${d.step ?? ''}: given ${d.given} | ${d.options.map(o => `${o.id}:${o.out}`).join(' ')}`);
  }
}

p('\n## Runner side (reported only)');
for (const [g, is] of Object.entries(groups)) {
  const D = decs.filter(d => is(d.src) && d.side === 'runner');
  const ends = D.filter(d => d.endsWhereIn);
  p(`${g}: family/separating prompts ${D.length}; the Runner ended the run where another answer gets in (by the walk) ${ends.length}; went on where no answer gets in ${D.filter(d => d.goesOnWhereOut).length}`);
  for (const d of ends) p(`  - ${d.src} T${d.turn} ${d.server} ${d.card}: ${d.given} | ${d.options.map(o => `${o.id}:${o.out}`).join(' ')}`);
}
const err = lines.length;
p(`\n(${err} lines read from ${files.length} files)`);
console.log(out.join('\n'));
