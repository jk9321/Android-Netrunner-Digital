/**
 * R-14h sums (brief netrunner-ai/runner-rework/briefs/r14h-last-credits-count.md rev 0a). Reads last-credits.ts's records
 * (the ai-script run's out/*.txt) and prints the tables in markdown.
 *
 *   node scripts/runner-rework/last-credits-sum.mjs <out dir> [--select=5 --out=scripts/runner-rework/last-credits-pairs.json]
 *
 * --select=k writes the pairs' list: every class-Z access where the price and the decision disagree, and every k-th agreeing
 * Z access by deal and turn, per pool (batch, nrdb).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const opt = Object.fromEntries(process.argv.slice(3).map(a => a.replace(/^--/, '').split('=')));
const recs = [];
for (const f of readdirSync(dir).filter(x => x.endsWith('.txt')).sort()) {
  for (const l of readFileSync(join(dir, f), 'utf8').split('\n')) {
    if (!l.startsWith('{')) continue;
    try {
      recs.push(JSON.parse(l));
    } catch {
      /* a partial line */
    }
  }
}
const kind = k => recs.filter(r => r.kind === k);
const A = kind('a');
const C = kind('c');
const P = kind('p');
const order = (a, b) => String(a.src).localeCompare(String(b.src), undefined, { numeric: true }) || a.T - b.T || a.idx - b.idx;
A.sort(order);
const median = xs => {
  const v = xs.filter(x => typeof x === 'number').sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const f3 = x => (x === null || x === undefined ? '' : typeof x === 'number' ? (Math.round(x * 1000) / 1000).toString() : String(x));
const DIRS = ['bothTrash', 'bothKeep', 'priceTrash/decisionKeep', 'priceKeep/decisionTrash'];
const POOLS = ['batch', 'nrdb', 'people', 'fixtures'];
const line = cells => `| ${cells.join(' | ')} |`;
const print = s => console.log(s);

if (opt.select) {
  const k = Number(opt.select);
  const list = [];
  for (const pool of ['batch', 'nrdb']) {
    let n = 0;
    for (const r of A.filter(x => x.pool === pool && x.cls === 'Z')) {
      const e = { key: r.key, cls: r.cls, sub: r.sub, dir: r.dir, card: r.card, rezzed: r.rezzed, credits: r.credits, creditsAfter: r.creditsAfter, margin: r.decision.margin, margin5: r.plus5?.margin ?? null, trashNet: r.priceRun.trashNet, fine: r.fine, tips: r.tips };
      if (!r.agree) list.push(e);
      else if (n++ % k === 0) list.push({ ...e, control: true });
    }
  }
  // #65's fixture, one board apart (coordinator 13:21Z ask 3)
  for (const r of A.filter(x => x.pool === 'fixtures' && x.cls === 'Z')) list.push({ key: r.key, cls: r.cls, sub: r.sub, dir: r.dir, card: r.card, rezzed: r.rezzed, credits: r.credits, creditsAfter: r.creditsAfter, margin: r.decision.margin, margin5: r.plus5?.margin ?? null, trashNet: r.priceRun.trashNet, fine: r.fine, tips: r.tips, fixture: true });
  writeFileSync(opt.out ?? 'scripts/runner-rework/last-credits-pairs.json', JSON.stringify(list));
  print(`pairs list: ${list.length} accesses (${list.filter(x => !x.control).length} disagreeing, ${list.filter(x => x.control).length} controls)`);
  process.exit(0);
}

// ---------------------------------------------------------------- checks
print('## Checks');
const G = kind('g');
for (const pool of ['batch', 'nrdb']) {
  const g = G.filter(x => x.pool === pool);
  print(`- ${pool}: ${g.length} deals read, ${g.filter(x => x.matchesBatch).length} equal their batch record; not equal: ${g.filter(x => !x.matchesBatch).map(x => x.src).join(', ') || 'none'}`);
}
print(`- errors: ${kind('err').length}${kind('err').length ? ' (' + kind('err').slice(0, 5).map(e => `${e.src}: ${String(e.error).slice(0, 80)}`).join('; ') + ')' : ''}`);
const withParts = A.filter(r => r.parts && !r.parts.missing);
print(`- parts add within 0.001: ${withParts.filter(r => r.parts.adds).length} of ${A.length} (missing: ${A.filter(r => r.parts?.missing).length}, ${[...new Set(A.filter(r => r.parts?.missing).map(r => r.parts.missing.join('+')))].join('; ')})`);
const gaps = withParts.filter(r => r.fineGap && (Math.abs(r.fineGap.rig) > 0.001 || Math.abs(r.fineGap.hand) > 0.001));
print(`- fine split (rig, hand) equal to the captured terms within 0.001: ${withParts.length - gaps.length} of ${withParts.length}${gaps.length ? '; off: ' + gaps.slice(0, 6).map(r => `${r.key} ${r.card} rig ${r.fineGap.rig} hand ${r.fineGap.hand}`).join('; ') : ''}`);
const mism = A.filter(r => r.pickMatches === false && r.pool !== 'people');
print(`- eval pick equals the answer made: ${A.filter(r => r.pickMatches === true && r.pool !== 'people').length} of ${A.filter(r => r.pickMatches !== null && r.pool !== 'people').length}; differ: ${mism.map(r => `${r.key} T${r.T} ${r.card}`).join('; ') || 'none'}`);

// ---------------------------------------------------------------- class by agreement
print('\n## Class by agreement (price = trashNet > 0; R-14e read the raw printed-cost price)');
print(line(['pool', 'class', 'n', ...DIRS, 'made trash', 'priceRaw disagrees with trashNet']));
print(line(['---', '---', '---:', ...DIRS.map(() => '---:'), '---:', '---:']));
for (const pool of POOLS) {
  for (const cls of ['C', 'Z', 'L', 'F', 'R']) {
    const xs = A.filter(r => r.pool === pool && r.cls === cls);
    if (!xs.length) continue;
    print(line([pool, cls, xs.length, ...DIRS.map(d => xs.filter(r => r.dir === d).length), xs.filter(r => r.answerTrash).length, xs.filter(r => r.priceTrashRaw !== r.priceTrash).length]));
    if (cls === 'Z') {
      for (const [name, f] of [['Z1 only', r => r.z1 && !r.z2], ['Z2 only', r => r.z2 && !r.z1], ['Z1+Z2', r => r.z1 && r.z2], ['rezzed', r => r.rezzed], ['seen', r => !r.rezzed]]) {
        const ys = xs.filter(f);
        print(line([pool, `Z ${name}`, ys.length, ...DIRS.map(d => ys.filter(r => r.dir === d).length), ys.filter(r => r.answerTrash).length, ys.filter(r => r.priceTrashRaw !== r.priceTrash).length]));
      }
    }
  }
}

// ---------------------------------------------------------------- Z parts (Part A item 2)
const FINE = ['card', 'corpBoardRest', 'credits', 'rigCoverage', 'rigCards', 'rigPlans', 'gripClicks', 'gripOwn', 'gripKeep', 'tagsRunner', 'tagsCorp', 'damage', 'runRest', 'corpCredits', 'corpHand', 'other'];
print('\n## Z: the decision\'s margin by fine part (trash board less keep board), medians, with the price beside it');
print(line(['pool', 'dir', 'n', ...FINE, 'margin', 'trashNet', 'creditCost (engine)', 'price/credit', 'decision credits/credit', 'cardRate trash-keep', 'priced-out cards (mean)']));
print(line(['---', '---', '---:', ...FINE.map(() => '---:'), '---:', '---:', '---:', '---:', '---:', '---:', '---:']));
for (const pool of POOLS) {
  for (const d of [...DIRS, 'all']) {
    const xs = A.filter(r => r.pool === pool && r.cls === 'Z' && r.fine && (d === 'all' || r.dir === d));
    if (!xs.length) continue;
    print(line([pool, d, xs.length, ...FINE.map(p => f3(median(xs.map(r => r.fine[p])))), f3(median(xs.map(r => r.decision.margin))), f3(median(xs.map(r => r.priceRun.trashNet))), f3(median(xs.map(r => r.priceRun.creditCostEngine))), f3(median(xs.map(r => r.priceRun.perCreditPrice))), f3(median(xs.map(r => r.priceRun.perCreditDecision))), f3(median(xs.map(r => r.cardRate.trash - r.cardRate.keep))), f3(xs.reduce((n, r) => n + (r.pricedOut?.length ?? 0), 0) / xs.length)]));
  }
}
print('\n### Z: which non-zero parts move with the trash (share of accesses where the part is non-zero, mean when non-zero)');
print(line(['pool', 'part', 'share non-zero', 'mean non-zero', 'median non-zero']));
print(line(['---', '---', '---:', '---:', '---:']));
for (const pool of ['batch', 'nrdb']) {
  const xs = A.filter(r => r.pool === pool && r.cls === 'Z' && r.fine);
  for (const p of FINE) {
    const nz = xs.map(r => r.fine[p]).filter(v => Math.abs(v) > 1e-6);
    if (!nz.length) continue;
    print(line([pool, p, f3(nz.length / xs.length), f3(nz.reduce((a, b) => a + b, 0) / nz.length), f3(median(nz))]));
  }
}
print('\n### Z: the rig cards whose own term moves with the trash (sum over the pool\'s Z accesses, count)');
for (const pool of ['batch', 'nrdb']) {
  const by = {};
  for (const r of A.filter(x => x.pool === pool && x.cls === 'Z' && x.rigByCard)) {
    for (const [k, v] of Object.entries(r.rigByCard)) {
      const t = k.replace(/ inst-\d+$/, '');
      by[t] ??= { n: 0, sum: 0 };
      by[t].n++;
      by[t].sum += v;
    }
  }
  print(`- ${pool}: ` + Object.entries(by).sort((a, b) => a[1].sum - b[1].sum).slice(0, 12).map(([k, v]) => `${k} ${v.n} (sum ${f3(v.sum)}, mean ${f3(v.sum / v.n)})`).join('; '));
}

// ---------------------------------------------------------------- tipping
print('\n## The tipping part: which single fine part, set to its value on the same board with 5 more credits, turns the answer');
print('(an access may have several; "none" = no single part turns it; "whole +5 turns" = the +5 board\'s margin has the other sign)');
for (const pool of POOLS) {
  for (const d of DIRS) {
    const xs = A.filter(r => r.pool === pool && r.cls === 'Z' && r.dir === d && r.tips);
    if (!xs.length) continue;
    const by = {};
    for (const r of xs) for (const t of r.tips.length ? r.tips : ['none']) by[t] = (by[t] ?? 0) + 1;
    const whole = xs.filter(r => r.plus5 && (r.plus5.margin > 0) !== (r.decision.margin > 0)).length;
    print(`- ${pool} ${d} (n ${xs.length}; whole +5 turns ${whole}): ${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }
}

// ---------------------------------------------------------------- five records per cell
print('\n## Five records per Z cell (first five by deal and turn)');
for (const pool of POOLS) {
  for (const d of DIRS) {
    const xs = A.filter(r => r.pool === pool && r.cls === 'Z' && r.dir === d).slice(0, 5);
    if (!xs.length) continue;
    print(`\n**${pool} ${d}**`);
    for (const r of xs) {
      const nz = r.fine ? Object.entries(r.fine).filter(([, v]) => Math.abs(v) > 1e-6).map(([k, v]) => `${k} ${f3(v)}`).join(', ') : 'no parts';
      print(`- ${r.key} T${r.T} ${r.card} (${r.rezzed ? 'rezzed' : 'seen'}, ${r.sub}), credits ${r.credits} -> ${r.creditsAfter}, engine cost ${r.engineCost}; trashNet ${r.priceRun.trashNet}; margin ${r.decision.margin} (+5: ${r.plus5?.margin ?? ''}); parts: ${nz}; tips: ${r.tips?.join('+') || 'none'}; priced out: ${(r.pricedOut ?? []).map(x => `${x.card} (${x.cost})`).join(', ') || 'none'}; made ${r.answer}`);
    }
  }
}

// ---------------------------------------------------------------- the Corp (Part A item 3)
print('\n## The Corp: chosen move against the best other one, where the two differ in leaving the Corp at 0 or 1 credits');
print(line(['pool', 'kind', 'units', 'chosen leaves 0-1', 'other leaves 0-1', 'hand terms tip', 'evaluate hand tips', 'keep term tips', 'own hand (not clicks) tips', 'chosen is the score\'s top', 'unmatched']));
print(line(['---', '---', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:']));
for (const pool of ['batch', 'nrdb']) {
  for (const [name, f] of [['prompt', r => r.prompt], ['main action (one-step proxy)', r => !r.prompt]]) {
    const all = C.filter(r => r.pool === pool && f(r));
    const xs = all.filter(r => !r.unmatched);
    print(line([pool, name, xs.length, xs.filter(r => r.chosen.low).length, xs.filter(r => r.other.low).length, xs.filter(r => r.tipsHand).length, xs.filter(r => r.tipsHandEval).length, name === 'prompt' ? xs.filter(r => r.tipsKeep).length : '', xs.filter(r => r.tipsOwn).length, xs.filter(r => r.chosenIsTop).length, all.filter(r => r.unmatched).length]));
  }
}
for (const pool of ['batch', 'nrdb']) {
  const xs = C.filter(r => r.pool === pool && !r.unmatched && r.tipsHand).slice(0, 5);
  if (xs.length) print(`\n**${pool}, hand terms tip (first five)**\n` + xs.map(r => `- ${r.src} T${r.T} ${r.prompt ? r.promptKind : 'main'}: chosen ${r.chosen.a} (to ${r.chosen.credits}) v ${r.other.a} (to ${r.other.credits}), margin ${r.margin}, hand ${r.handEval} (own ${r.handOwn}), keep ${r.keep}`).join('\n'));
}

// ---------------------------------------------------------------- the pairs (Part B)
if (P.length) {
  print('\n## Pairs (trash minus keep; per-access mean over seeds, then mean ± SE over accesses)');
  const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  const se = xs => (xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1) / xs.length) : NaN);
  const cell = xs => (xs.length ? `${f3(mean(xs))} ± ${f3(se(xs))}${Math.abs(mean(xs)) > 2 * se(xs) ? ' **shown**' : ''}` : '');
  const money = (p, h) => (h === 2 ? p.at2 : p.at4) && (h === 2 ? p.at2.rc - p.at2.cc : p.at4.rc - p.at4.cc);
  print(line(['pool', 'dir', 'n', 'seeds', 'wins', 'point margin', 'money T+2', 'money T+4']));
  print(line(['---', '---', '---:', '---:', '---:', '---:', '---:', '---:']));
  for (const pool of ['batch', 'nrdb']) {
    for (const d of [...DIRS]) {
      const xs = P.filter(r => r.pool === pool && r.dir === d);
      if (!xs.length) continue;
      const per = f => xs.map(r => mean(r.pairs.map(f)));
      const w = per(p => (p.trash.w === 'runner') - (p.keep.w === 'runner'));
      const m = per(p => p.trash.rp - p.trash.cp - (p.keep.rp - p.keep.cp));
      const m2 = per(p => money(p.trash, 2) - money(p.keep, 2));
      const m4 = per(p => (p.trash.at4 && p.keep.at4 ? money(p.trash, 4) - money(p.keep, 4) : 0));
      print(line([pool, d, xs.length, xs[0].pairs.length, cell(w), cell(m), cell(m2), cell(m4)]));
    }
  }
  const row = (label, xs) => {
    const per = f => xs.map(r => mean(r.pairs.map(f)));
    const w = per(p => (p.trash.w === 'runner') - (p.keep.w === 'runner'));
    const m = per(p => p.trash.rp - p.trash.cp - (p.keep.rp - p.keep.cp));
    const m2 = per(p => money(p.trash, 2) - money(p.keep, 2));
    const m4 = per(p => money(p.trash, 4) - money(p.keep, 4));
    print(line([label, xs.length, xs.length ? xs[0].pairs.length : '', xs.length >= 10 ? cell(w) : `${cell(w)} (under 10: shows nothing)`, cell(m), cell(m2), cell(m4)]));
  };
  print('\n### price trash, decision keep, by the access\'s tipping part (an access with several counts in each; reported only)');
  print(line(['pool / tipping part', 'n', 'seeds', 'wins', 'point margin', 'money T+2', 'money T+4']));
  print(line(['---', '---:', '---:', '---:', '---:', '---:', '---:']));
  for (const pool of ['batch', 'nrdb']) {
    const xs = P.filter(r => r.pool === pool && r.dir === 'priceTrash/decisionKeep' && !r.fixture);
    for (const t of ['rigCards', 'gripClicks', 'credits', 'gripKeep', 'corpBoardRest']) row(`${pool} ${t}`, xs.filter(r => r.tips?.includes(t)));
    row(`${pool} none alone`, xs.filter(r => r.tips && !r.tips.length));
  }
  const fx = P.filter(r => r.fixture);
  if (fx.length) {
    print('\n### #65\'s fixture, one board (never a rate): per seed, trash then keep');
    for (const r of fx) print(`- ${r.src} T${r.T} ${r.card}: ` + r.pairs.map(p => `k${p.k} ${p.trash.w}/${p.keep.w} margin ${p.trash.rp - p.trash.cp}/${p.keep.rp - p.keep.cp} T+2 ${money(p.trash, 2)}/${money(p.keep, 2)} T+4 ${money(p.trash, 4)}/${money(p.keep, 4)}`).join('; '));
    row('#65 fixture (seed-level only)', fx);
  }
}
