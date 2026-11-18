// Sums scripts/stage-d/prompt-place.ts output (item 6 step 1): node scripts/stage-d/prompt-place-sum.mjs <dir or files...>
//   CONT=1 also lists every changed decision with both continuations.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const walk = p => (statSync(p).isDirectory() ? readdirSync(p).flatMap(f => walk(join(p, f))) : p.endsWith('.txt') ? [p] : []);
const lines = process.argv.slice(2).flatMap(walk).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
const D = lines.filter(l => l.kind === 'd');
const IP = lines.filter(l => l.kind === 'ip');
const C = lines.filter(l => l.kind === 'cont');
const S = lines.filter(l => l.kind === 'src');
const E = lines.filter(l => l.kind === 'error');
const arms = [...new Set(D.flatMap(d => Object.keys(d.ms)))].filter(a => a !== 'base');
const whoOf = src => (src.startsWith('deal:') ? 'self' : 'human');
const games = { self: S.filter(s => s.src.startsWith('deal:')).length, human: S.filter(s => s.src.startsWith('human:')).length };
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
const sum = xs => xs.reduce((a, b) => a + b, 0);
const f = (x, k = 2) => x.toFixed(k);
console.log(`sources ${S.length} (deals ${games.self}, human ${games.human}); Corp decisions ${D.length}; top-level install prompts ${IP.length}; continuations ${C.length}; errors ${E.length}`);

// 2. On the record: per card and step
console.log('\n## Install prompts on the record (top level), by card:step');
const by = new Map();
for (const r of IP) (by.get(r.key) ?? by.set(r.key, []).get(r.key)).push(r);
const declined = r => r.picks.base === 'decline' || /option (to-hand)/.test(r.picks.base);
for (const [k, rs] of [...by].sort((a, b) => b[1].length - a[1].length)) {
  const legal = rs.filter(r => r.installs.length > 0);
  const self = rs.filter(r => whoOf(r.src) === 'self').length;
  const cols = arms.map(a => {
    const diff = rs.filter(r => r.picks[a] !== r.picks.base);
    const inst = rs.filter(r => declined(r) && r.picks[a] !== r.picks.base).length;
    return `${a}: differ ${diff.length} (installs where today declines ${inst}, declines where today installs ${rs.filter(r => !declined(r) && (r.picks[a] === 'decline' || /to-hand/.test(r.picks[a]))).length})`;
  });
  console.log(`${k} [${rs[0].cls}${rs[0].kindP === 'effect_cards' ? `, min ${rs[0].min}` : ''}]: asked ${rs.length} (self ${self}, human ${rs.length - self}); in a run ${rs.filter(r => r.inRun).length}, run term decided ${rs.filter(r => r.runDecided.base).length}; with a legal install ${legal.length}; today declined with a legal install ${legal.filter(declined).length} | ${cols.join(' | ')}`);
}

// Classes (AI Coordinator design-answer.md section 1.4): what the owners' order offers at each top-level install prompt
console.log('\n## Classes of the owners\' order at top-level install prompts (pick steps with min 0; server steps apart)');
const classOf = r => {
  const o = r.order ?? [];
  if (!o.length) return 'none offered';
  if (o.some(c => !c.behind && c.line <= 8)) return 'A: an install not behind (lines 1-8)';
  if (o.some(c => !c.behind && c.line === 9)) return 'B: only line 9';
  return o.some(c => c.credits === 0) ? 'C0: only behind, some at no credit' : 'C1: only behind, all cost credits';
};
for (const step of ['pick', 'server']) {
  const rs = IP.filter(r => (step === 'pick' ? r.kindP === 'effect_cards' : r.kindP !== 'effect_cards'));
  const cls = {};
  for (const r of rs) { const c = classOf(r); (cls[c] ??= { n: 0, self: 0, human: 0, keys: {} }); cls[c].n++; cls[c][whoOf(r.src)]++; cls[c].keys[r.key] = (cls[c].keys[r.key] ?? 0) + 1; }
  console.log(`${step} steps (${rs.length}):`);
  for (const [c, v] of Object.entries(cls).sort()) console.log(`   ${c}: ${v.n} (self ${v.self} = ${f(v.self / Math.max(1, games.self))} a game, human ${v.human} = ${f(v.human / Math.max(1, games.human))} a game); ${Object.entries(v.keys).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
}

// Arm tie (step 2): how often the fallback ties at a Corp card question, and how often the order's answer was taken
if (arms.includes('tie')) {
  console.log('\n## The pick-step tie (arm tie): top level, then inside decisions');
  for (const g of ['self', 'human']) {
    const ips = IP.filter(r => whoOf(r.src) === g && r.kindP === 'effect_cards');
    const tied = ips.filter(r => r.tieTop?.tie);
    const took = ips.filter(r => r.tieTop?.tie === 'took');
    const keys = {};
    for (const r of tied) keys[r.key] = (keys[r.key] ?? 0) + 1;
    console.log(`${g}: top-level install pick steps ${ips.length}, fallback tied ${tied.length} (${f(tied.length / Math.max(1, games[g]))} a game), order's answer taken ${took.length}; ${Object.entries(keys).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
    const inn = D.filter(d => whoOf(d.src) === g).map(d => d.inner.tie).filter(Boolean);
    const tk = inn.reduce((m, i) => { for (const [k, v] of Object.entries(i.tieKeys ?? {})) m[k] = (m[k] ?? 0) + v; return m; }, {});
    console.log(`   inside decisions: Corp card questions tied ${sum(inn.map(i => i.tie))}, of them install picks ${sum(inn.map(i => i.tieInstall))}, the order's answer taken ${sum(inn.map(i => i.tieTook))}; by key ${Object.entries(tk).sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
}

// 3. Fire count
console.log('\n## Fire count: changed Corp decisions a game');
for (const g of ['self', 'human']) {
  const ds = D.filter(d => whoOf(d.src) === g);
  for (const a of arms) {
    const ch = ds.filter(d => d.changed.includes(a));
    const top = ch.filter(d => d.install);
    const otherPrompt = ch.filter(d => !d.install && d.prompt);
    const main = ch.filter(d => !d.prompt);
    console.log(`${g} ${a}: changed ${ch.length} (${f(ch.length / Math.max(1, games[g]))} a game): at a top-level install prompt ${top.length} (${f(top.length / Math.max(1, games[g]))}), at another prompt ${otherPrompt.length}, main phase or rez window (inside the planner) ${main.length} (${f(main.length / Math.max(1, games[g]))})`);
    const inner = ds.map(d => d.inner[a]);
    console.log(`   inside decisions: install prompts answered ${sum(inner.map(i => i.install))}, by the owners ${sum(inner.map(i => i.owned))}, differently from today ${sum(inner.map(i => i.differ))}; by key: ${Object.entries(inner.reduce((m, i) => { for (const [k, v] of Object.entries(i.differKeys)) m[k] = (m[k] ?? 0) + v; return m; }, {})).sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
  const bi = ds.map(d => d.inner.base);
  console.log(`   base: Corp prompts answered inside decisions ${sum(bi.map(i => i.prompts))}, install prompts ${sum(bi.map(i => i.install))}; run term decided ${sum(bi.map(i => i.runDecided))} prompts, ${sum(bi.map(i => i.runDecidedInstall))} of them install prompts`);
}

// Continuations
console.log('\n## Continuations (4 turns or game end, GameRunner; arm Corp vs base Corp, base Runner)');
const ck = c => `${c.src}#${c.i}`;
const cont = new Map();
for (const c of C) (cont.get(ck(c)) ?? cont.set(ck(c), {}).get(ck(c)))[c.arm] = c;
const dmap = new Map(D.map(d => [`${d.src}#${d.i}`, d]));
const val = c => (c.error ? null : c.winner === 'corp' ? 100 : c.winner === 'runner' ? -100 : c.d[0] - c.d[1]);
for (const a of arms) {
  const rows = {};
  for (const [k, g] of cont) {
    if (!g.base || !g[a]) continue;
    const d = dmap.get(k);
    const cls = d?.install ? `prompt ${d.prompt}` : d?.prompt ? 'other prompt' : 'main/rez';
    const kind = d?.install ? 'top-level prompt' : 'inside planner';
    const vb = val(g.base), va = val(g[a]);
    for (const key of [kind, cls]) {
      const r = (rows[key] ??= { n: 0, better: 0, worse: 0, same: 0, winB: 0, winA: 0, lossB: 0, lossA: 0, err: 0 });
      r.n++;
      if (vb === null || va === null) { r.err++; continue; }
      if (va > vb) r.better++; else if (va < vb) r.worse++; else r.same++;
      if (g.base.winner === 'corp') r.winB++; if (g[a].winner === 'corp') r.winA++;
      if (g.base.winner === 'runner') r.lossB++; if (g[a].winner === 'runner') r.lossA++;
    }
  }
  console.log(`${a}:`);
  for (const [k, r] of Object.entries(rows).sort((x, y) => y[1].n - x[1].n)) console.log(`   ${k}: n ${r.n}: arm better ${r.better}, worse ${r.worse}, same ${r.same}${r.err ? `, error ${r.err}` : ''}; Corp wins base ${r.winB} arm ${r.winA}; Runner wins base ${r.lossB} arm ${r.lossA}`);
  if (process.env.CONT) {
    for (const [k, g] of cont) {
      if (!g.base || !g[a]) continue;
      const d = dmap.get(k);
      console.log(`   - ${k} T${d?.T} ${d?.prompt ?? 'main'} | base ${d?.picks?.base} -> ${g.base.winner ?? '-'} ${JSON.stringify(g.base.d)} | ${a} ${d?.picks?.[a]} -> ${g[a].winner ?? '-'} ${JSON.stringify(g[a].d)} | ${a} moves ${g[a].moves?.slice(0, 5).join('; ')}`);
    }
  }
}

// Ruling 2 on more boards: every owners pick of an agenda into a server that does not hold (line 9), against the decline
console.log('\n## Owners line-9 picks at top-level prompts, with continuations (owners vs base)');
for (const r of IP) {
  const o = r.order ?? [];
  const first = o.find(c => !c.behind);
  if (!first || first.line !== 9 || r.picks.owners === r.picks.base) continue;
  const g = cont.get(`${r.src}#${r.i}`) ?? {};
  const show = c => (c ? `${c.winner ?? '-'} ${JSON.stringify(c.d)} T${c.T}` : 'no cont');
  console.log(`   ${r.src}#${r.i} T${r.T} ${r.key} score ${JSON.stringify(r.score)} credits ${r.credits} | base ${r.picks.base}: ${show(g.base)} | owners ${r.picks.owners} -> ${first.server}: ${show(g.owners)} | no9 ${r.picks.no9 ?? '?'}: ${show(g.no9)}`);
}

// 5. Time
console.log('\n## Time (Corp decisions, ms; the owners-vs-today comparison is left out of the arm times)');
for (const g of ['self', 'human']) {
  const ds = D.filter(d => whoOf(d.src) === g);
  const b = ds.map(d => d.ms.base);
  for (const a of arms) {
    const h = ds.map(d => d.ms[a]);
    const slow = ds.filter(d => d.ms.base >= 500 && d.ms[a] > 2 * d.ms.base);
    const late = ds.filter(d => d.ms[a] - d.ms.base > 3000);
    console.log(`${g} ${a}: total base ${f(sum(b) / 1000, 1)} s, arm ${f(sum(h) / 1000, 1)} s: x${f(sum(h) / Math.max(1, sum(b)), 3)}; p95 x${f(q(h, 0.95) / Math.max(1, q(b, 0.95)), 3)}; at top-level install prompts x${f(sum(ds.filter(d => d.install).map(d => d.ms[a])) / Math.max(1, sum(ds.filter(d => d.install).map(d => d.ms.base))), 3)}; over 2x at >= 0.5 s: ${slow.length}${slow.length ? ' (' + slow.slice(0, 8).map(d => `${d.src}#${d.i} ${d.ms.base}->${d.ms[a]}`).join(', ') + ')' : ''}; 3 s slower: ${late.length}${late.length ? ' (' + late.slice(0, 8).map(d => `${d.src}#${d.i} ${d.ms.base}->${d.ms[a]}`).join(', ') + ')' : ''}`);
  }
}
// Against the control (a tree identical to base; AI Coordinator ruling (5), design-answer.md section 3): the bar is arm / control
if (arms.includes('same')) {
  console.log('\n## Time against the control (arm / same)');
  for (const g of ['self', 'human']) {
    const ds = D.filter(d => whoOf(d.src) === g);
    const c = ds.map(d => d.ms.same);
    for (const a of arms.filter(x => x !== 'same')) {
      const h = ds.map(d => d.ms[a]);
      const slow = ds.filter(d => d.ms.same >= 500 && d.ms[a] > 2 * d.ms.same);
      console.log(`${g} ${a}: control ${f(sum(c) / 1000, 1)} s, arm ${f(sum(h) / 1000, 1)} s: x${f(sum(h) / Math.max(1, sum(c)), 3)}; p95 x${f(q(h, 0.95) / Math.max(1, q(c, 0.95)), 3)}; control/base x${f(sum(c) / Math.max(1, sum(ds.map(d => d.ms.base))), 3)}; over 2x of control at >= 0.5 s: ${slow.length}${slow.length ? ' (' + slow.slice(0, 8).map(d => `${d.src}#${d.i} ${d.ms.same}->${d.ms[a]}`).join(', ') + ')' : ''}`);
    }
  }
}
const errs = D.filter(d => Object.values(d.picks ?? {}).some(p => String(p).startsWith('error')));
console.log(`\nerrors in picks: ${errs.length}`);
for (const d of errs.slice(0, 10)) console.log(`  ${d.src} #${d.i} ${JSON.stringify(d.picks).slice(0, 300)}`);
for (const e of E.slice(0, 10)) console.log(`  source error ${e.k}: ${e.message}`);
