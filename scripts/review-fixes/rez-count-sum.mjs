/**
 * Review fixes 2026-11-19, bundle R (rez and rez money), count step: the summing step. Reads the JSON lines that
 * rez-count.ts printed (files or folders of them: the ai-script run's out/*.txt) and prints the note's tables (markdown);
 * with LIST=1 also every changed decision. D reads scripts/review-fixes/rez-d-list.json (rez-d-list.mjs).
 *
 *   node scripts/review-fixes/rez-count-sum.mjs <out dir or files...> > sum.md
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
const walk = p => (statSync(p).isDirectory() ? readdirSync(p).forEach(f => walk(join(p, f))) : /\.(txt|jsonl)$/.test(p) && files.push(p));
process.argv.slice(2).forEach(walk);
const rows = [];
for (const f of files)
  for (const l of readFileSync(f, 'utf8').split('\n')) {
    if (!l.startsWith('{')) continue;
    try {
      rows.push(JSON.parse(l));
    } catch {
      /* a cut line */
    }
  }
const meta = rows.find(r => r.kind === 'meta');
const ASKED = meta?.asked ?? ['beta', 'control', 'leoFallThrough', 'rdStakeUnseen', 'tollByHold', 'keepPricedCentral', 'keepPriced'];
const ARMS = ASKED.slice(2);
const ALL_ARMS = [...ARMS, 'spentApart'];
const KINDS = ['self', 'humanRunner', 'humanCorp'];
const KSETS = [['all', KINDS], ['self', ['self']], ['humanRunner', ['humanRunner']], ['humanCorp', ['humanCorp']]];
const D = rows.filter(r => r.kind === 'd');
const C = rows.filter(r => r.kind === 'c');
const games = rows.filter(r => r.kind === 'g');
const humans = rows.filter(r => r.kind === 'h');
const p = s => console.log(s);
const f2 = x => (x == null || Number.isNaN(x) ? '-' : (Math.round(x * 100) / 100).toString());
const f3 = x => (x == null || Number.isNaN(x) ? '-' : (Math.round(x * 1000) / 1000).toString());
const sum = a => a.reduce((x, y) => x + y, 0);
const mean = a => (a.length ? sum(a) / a.length : NaN);
const se = a => (a.length > 1 ? Math.sqrt(sum(a.map(x => (x - mean(a)) ** 2)) / (a.length - 1) / a.length) : NaN);
const pct = (a, q) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const nGames = k => (k === 'self' ? games.length : humans.filter(h => h.sk === k).length);
const fireOf = (r, arm, pre) => {
  const f = r.fire?.[ASKED.indexOf(arm)] ?? {};
  return sum(Object.entries(f).filter(([k]) => k.startsWith(pre)).map(([, v]) => v));
};
const rezzed = lbl => typeof lbl === 'string' && lbl.startsWith('REZ_CARD');
const ices = r => (r.m?.ice ?? []);

// ---------------------------------------------------------------- sources and stops
p('## Sources and stops\n');
p(`Self-play games: ${games.length}, matching the batch's record (winner, cr, sc): ${games.filter(g => g.matchesBatch).length}. Human files: ${humans.length} (human Runner ${humans.filter(h => h.sk === 'humanRunner').length}, human Corp ${humans.filter(h => h.sk === 'humanCorp').length}; stopped replays ${humans.filter(h => h.stopped).length}).`);
const bad = games.filter(g => !g.matchesBatch).map(g => g.src);
if (bad.length) p(`\n**STOP: games not matching the batch:** ${bad.join(', ')}`);
p('\n| kind | Corp decisions | main | prompt | rez | control differs | errors | measure differs | beta = source move |');
p('|---|---|---|---|---|---|---|---|---|');
for (const k of KINDS) {
  const d = D.filter(r => r.sk === k);
  const fresh = d.filter(r => r.fresh !== undefined);
  p(`| ${k} | ${d.length} | ${d.filter(r => r.c === 'corpMain').length} | ${d.filter(r => r.c === 'corpPrompt').length} | ${d.filter(r => r.c === 'corpRez').length} | ${d.filter(r => r.controlDiffers).length} | ${d.filter(r => r.errors).length} | ${d.filter(r => r.measureDiffers).length} | ${fresh.length ? `${fresh.filter(r => r.fresh).length} of ${fresh.length}` : '-'} |`);
}
const errs = D.filter(r => r.errors);
for (const r of errs.slice(0, 20)) p(`- **error** ${r.src} i${r.i}: ${JSON.stringify(r.errors)}`);
for (const r of D.filter(r => r.controlDiffers)) p(`- **STOP control differs** ${r.src} i${r.i} T${r.T} ${r.c}`);
const cErr = C.filter(c => c.ca.err || c.cb.err);
p(`\nContinuation errors: ${cErr.length}.`);
for (const c of cErr.slice(0, 10)) p(`- ${c.src} i${c.i} ${c.arm}: ${c.ca.err ?? ''} | ${c.cb.err ?? ''}`);

// ---------------------------------------------------------------- A
p('\n## A. LEO Construction and the other run stoppers (approach-server windows)\n');
const AS = D.filter(r => r.c === 'corpRez' && r.m?.phase === 'approach_server');
const usable = r => (r.m.stoppers ?? []).filter(s => s.usable).map(s => s.code);
const isA = r => r.m?.phase === 'approach_server' && r.m.leo && !(r.m.leoGain > 0) && r.m.importance >= 6 && usable(r).length > 0;
p('| kind | server windows | LEO legal | LEO legal, leoGain not above 0 | ... importance 6+ | ... and another stopper usable (class) | by stopper |');
p('|---|---|---|---|---|---|---|');
for (const k of KINDS) {
  const d = AS.filter(r => r.sk === k);
  const leo = d.filter(r => r.m.leo);
  const no = leo.filter(r => !(r.m.leoGain > 0));
  const imp = no.filter(r => r.m.importance >= 6);
  const cls = imp.filter(r => usable(r).length);
  const by = {};
  for (const r of cls) for (const c of usable(r)) by[c] = (by[c] ?? 0) + 1;
  p(`| ${k} | ${d.length} | ${leo.length} | ${no.length} | ${imp.length} | ${cls.length} | ${JSON.stringify(by)} |`);
}
p('\nAll windows where LEO was legal and leoGain not above 0 (importance, leoGain, stoppers legal (usable), beta\'s answer, leoFallThrough\'s):');
for (const r of AS.filter(r => r.m.leo && !(r.m.leoGain > 0)).slice(0, 80))
  p(`- ${r.src} T${r.T} (${r.sk}) ${r.m.server}: importance ${f2(r.m.importance)}, leoGain ${f2(r.m.leoGain)}, stoppers ${JSON.stringify(r.m.stoppers)}; beta ${r.beta} | arm ${r.changed?.leoFallThrough ?? '(same)'}`);

// ---------------------------------------------------------------- B
p('\n## B. R&D staked with no agenda left in it\n');
const bOf = r => r.bb ?? r.m?.b;
p('| kind | Corp decisions | with B measured | agendasUnseen 0 | ... R&D rez money above 0 (byServer.rd) | games with one |');
p('|---|---|---|---|---|---|');
for (const k of KINDS) {
  const d = D.filter(r => r.sk === k);
  const m = d.filter(r => bOf(r));
  const z = m.filter(r => bOf(r).unseen === 0);
  const rd = z.filter(r => (bOf(r).rd ?? 0) > 0);
  p(`| ${k} | ${d.length} | ${m.length} | ${z.length} | ${rd.length} | ${new Set(rd.map(r => r.src.split('#')[0])).size} |`);
}

// ---------------------------------------------------------------- C1
p('\n## C1. spendsKept\'s number (windows where countedRez reaches spendsKept: R3t, R4t)\n');
const C1 = D.filter(r => r.c === 'corpRez').flatMap(r => ices(r).filter(x => x.at === 'R3t' || x.at === 'R4t').map(x => ({ r, x })));
const THRESH = /if the runner has \d+ credits? or (less|fewer)/i;
const cmp = (handed, real) => (real === 'out' || real == null ? 'out' : handed === real ? 'equal' : handed < real ? 'lower' : 'higher');
const why = (x, world) => {
  const thrA = world === 'rez' && x.subs.some(s => THRESH.test(s));
  const thrIn = (x.innerRezzed ?? []).filter(c => c.subs.some(s => THRESH.test(s))).map(c => c.title);
  const gained = (world === 'rez' ? x.gainedRez : x.gainedPass) ?? [];
  const out = [];
  if (thrA) out.push(`threshold approached (${x.title})`);
  if (thrIn.length) out.push(`threshold further in (${thrIn.join(', ')})`);
  if (gained.length) out.push(`credits gained (${gained.map(g => `+${g.n} ${g.by}`).join(', ')})`);
  return out.length ? out.join('; ') : 'other';
};
for (const world of ['rez', 'pass']) {
  p(`\n### ${world} world\n`);
  p('| kind | windows | equal | handed lower | handed higher | out | out, toll holds | out, toll does not hold | cannot be played |');
  p('|---|---|---|---|---|---|---|---|---|');
  for (const k of KINDS) {
    const it = C1.filter(({ r }) => r.sk === k);
    const c = it.map(({ x }) => cmp(world === 'rez' ? x.handedRez : x.handedPass, world === 'rez' ? x.realRez : x.realPass));
    const holds = ({ x }) => (world === 'rez' ? x.w.holds : x.n.holds);
    const outs = it.filter((_, i) => c[i] === 'out');
    p(`| ${k} | ${it.length} | ${c.filter(v => v === 'equal').length} | ${c.filter(v => v === 'lower').length} | ${c.filter(v => v === 'higher').length} | ${outs.length} | ${outs.filter(holds).length} | ${outs.filter(o => !holds(o)).length} | ${it.filter(({ x }) => x.realErr?.[world === 'rez' ? 0 : 1]).length} |`);
  }
  const low = C1.filter(({ x }) => cmp(world === 'rez' ? x.handedRez : x.handedPass, world === 'rez' ? x.realRez : x.realPass) === 'lower');
  const hi = C1.filter(({ x }) => cmp(world === 'rez' ? x.handedRez : x.handedPass, world === 'rez' ? x.realRez : x.realPass) === 'higher');
  const byWhy = {};
  for (const { x } of low) {
    const w = why(x, world);
    byWhy[w] = byWhy[w] ?? [];
    byWhy[w].push((world === 'rez' ? x.realRez - x.handedRez : x.realPass - x.handedPass));
  }
  p(`\nLower, by why (n, mean credits short): ${Object.entries(byWhy).map(([w, v]) => `${w}: ${v.length}, ${f2(mean(v))}`).join(' | ') || 'none'}`);
  for (const { r, x } of [...low, ...hi].slice(0, 40)) p(`- ${r.src} T${r.T} (${r.sk}) ${r.m.server} ${x.title} ${x.at}: handed ${world === 'rez' ? x.handedRez : x.handedPass} real ${world === 'rez' ? x.realRez : x.realPass}; ${why(x, world)}; Runner ${r.m.rc}`);
}
const differ = C1.filter(({ x }) => cmp(x.handedRez, x.realRez) === 'lower' || cmp(x.handedRez, x.realRez) === 'higher' || cmp(x.handedPass, x.realPass) === 'lower' || cmp(x.handedPass, x.realPass) === 'higher');
const flips = C1.filter(({ x }) => x.spendsReal !== undefined && x.spendsReal !== x.spends);
p(`\nWindows where handed differs from real in either world: ${differ.length} of ${C1.length} (${f2((100 * differ.length) / Math.max(1, C1.length))}%). spendsKept answers that change with real (spentApart): ${flips.length}${flips.length ? ': ' + flips.map(({ r, x }) => `${r.src} T${r.T} ${x.title} ${x.spends}→${x.spendsReal}`).join('; ') : ''}.`);
const unplayable = D.filter(r => r.c === 'corpRez').flatMap(r => ices(r).filter(x => x.realErr));
const asked = D.filter(r => r.c === 'corpRez').flatMap(r => ices(r).filter(x => x.realRez !== undefined));
p(`\nreal asked at ${asked.length} windows (R3t, R4t, free gate); could not be played at ${unplayable.length} (${f2((100 * unplayable.length) / Math.max(1, asked.length))}%; the stop is at 5%).`);

// ---------------------------------------------------------------- C2
p('\n## C2. The free gate and a toll that is not a break cost\n');
const SUB = [
  ['credits lost', /loses? \d+ credits?/i],
  ['credit threshold', THRESH],
  ['tags', /tag/i],
  ['damage', /damage/i],
  ['clicks', /click/i],
];
const subOf = x => {
  const got = SUB.filter(([, re]) => x.subs.some(s => re.test(s))).map(([n]) => n);
  return got.length ? got : [`other (${x.title})`];
};
const realToll = x => typeof x.realRez === 'number' && typeof x.realPass === 'number' && x.realRez < x.realPass;
const isToll = x => x.tollHold || realToll(x);
const freeRows = D.filter(r => r.c === 'corpRez').flatMap(r => ices(r).filter(x => x.at === 'free').map(x => ({ r, x })));
const W = freeRows.filter(({ r, x }) => r.m.r34 && isToll(x));
const W2 = freeRows.filter(({ r, x }) => !r.m.r34 && isToll(x));
const isW = r => ices(r).some(x => x.at === 'free' && r.m.r34 && isToll(x));
const isW2 = r => ices(r).some(x => x.at === 'free' && !r.m.r34 && isToll(x));
p(`Free-gate windows (countedRez returns null at line 60): ${freeRows.length}; a toll (by the hold owner or by real): ${W.length + W2.length}; W (R3's or R4's conditions): ${W.length}; W2 (every other server): ${W2.length}.\n`);
const clsTable = (name, it) => {
  p(`\n### ${name}\n`);
  p('| kind | windows | toll by hold | toll by real only | rezzed (priced) | not rezzed | spendsKept (handed) true | spendsKept (real) true | rezzed and spendsKept (real) true |');
  p('|---|---|---|---|---|---|---|---|---|');
  for (const k of KINDS) {
    const d = it.filter(({ r }) => r.sk === k);
    p(`| ${k} | ${d.length} | ${d.filter(({ x }) => x.tollHold).length} | ${d.filter(({ x }) => !x.tollHold && realToll(x)).length} | ${d.filter(({ r }) => rezzed(r.beta)).length} | ${d.filter(({ r }) => !rezzed(r.beta)).length} | ${d.filter(({ x }) => x.spends).length} | ${d.filter(({ x }) => x.spendsReal).length} | ${d.filter(({ r, x }) => rezzed(r.beta) && x.spendsReal).length} |`);
  }
  const by = {};
  for (const { r, x } of it) for (const s of subOf(x)) {
    const b = (by[s] ??= { n: 0, rez: 0, cards: {} });
    b.n++;
    if (rezzed(r.beta)) b.rez++;
    b.cards[x.title] = (b.cards[x.title] ?? 0) + 1;
  }
  p('\nSub-classes (what the ice takes from a Runner that passes it unbroken, by its subroutines; a card can be in more than one):\n');
  p('| sub-class | windows | rezzed | cards |');
  p('|---|---|---|---|');
  for (const [s, b] of Object.entries(by)) p(`| ${s} | ${b.n} | ${b.rez} | ${Object.entries(b.cards).map(([c, n]) => `${c} ${n}`).join(', ')} |`);
  const bySk = {};
  for (const { r } of it) bySk[r.m.sk] = (bySk[r.m.sk] ?? 0) + 1;
  p(`\nBy server: ${JSON.stringify(bySk)}.`);
  const dec = {};
  for (const { r } of it) {
    const k = `${r.dec?.at ?? '?'} / ${r.dec?.gain == null ? 'no priced ask' : r.dec.gain > 0 ? 'gain > 0' : 'gain ≤ 0'} / ${rezzed(r.beta) ? 'rez' : 'no rez'}`;
    dec[k] = (dec[k] ?? 0) + 1;
  }
  p(`\nWhat decided (countedRez's exit / the priced rez / the answer): ${JSON.stringify(dec)}.`);
};
clsTable('W', W);
clsTable('W2', W2);
p('\nEvery W window (deal or file, turn, server, ice, need by the hold owner with / without, handed and real both worlds, gain, answer, spendsKept handed / real):\n');
for (const { r, x } of W.slice(0, 120))
  p(`- ${r.src} T${r.T} (${r.sk}) ${r.m.server} ${x.title} cost ${x.cost} cr ${r.m.cr} rc ${r.m.rc} rk ${r.m.rk}: need ${x.w.need}/${x.n.need}, handed ${x.handedRez}/${x.handedPass}, real ${x.realRez}/${x.realPass}, gain ${f2(x.gain)}; ${r.beta}; spendsKept ${x.spends}/${x.spendsReal}`);

p('\n### T: the trace (W windows where the priced rez is made and spendsKept with real says it spends the kept money)\n');
const T = W.filter(({ r, x }) => rezzed(r.beta) && x.spendsReal && x.trace);
const TERMS = ['cCredit', 'cHand', 'cPoints', 'cBoard', 'cTags', 'cCounters', 'rCredit', 'rHand', 'rPoints', 'rTags', 'rCore', 'rClock', 'rRig'];
p(`${T.length} windows. Gain = rez branch − pass branch (evaluate, Corp view, on the board each branch ends on, less runLoss there); each term below is rez − pass; x = the toll's non-credit part (throughIce's extra).\n`);
p('| src | T | ice | gain | ' + TERMS.join(' | ') + ' | loss | x | cNeed (rez/pass) | boardNeed (rez/pass) | Corp cr after | keep next turn | keep rest of turn (rez world) | leaf |');
p('|' + '---|'.repeat(TERMS.length + 13));
const tRow = ({ r, x }) => {
  const a = x.trace.rez.parts;
  const b = x.trace.pass.parts;
  return `| ${r.src} | ${r.T} | ${x.title} | ${f2(x.gain)} | ${TERMS.map(t => f2(a[t] - b[t])).join(' | ')} | ${f2(-(x.trace.rez.loss - x.trace.pass.loss))} | ${f2(x.trace.rez.x - x.trace.pass.x)} | ${f2(a.cNeed)}/${f2(b.cNeed)} | ${f2(a.cBoardNeed)}/${f2(b.cBoardNeed)} | ${x.keeps?.crAfter ?? '-'} | ${x.keeps?.nextTurn ?? '-'} | ${x.keeps?.restRez ?? '-'} | ${x.trace.rez.leaf}/${x.trace.pass.leaf} |`;
};
for (const it of [...T].sort((a, b) => b.x.gain - a.x.gain)) p(tRow(it));
const termSum = {};
for (const { x } of T) for (const t of TERMS) termSum[t] = (termSum[t] ?? 0) + (x.trace.rez.parts[t] - x.trace.pass.parts[t]);
p(`\nMean term over T: ${TERMS.map(t => `${t} ${f2(termSum[t] / Math.max(1, T.length))}`).join(', ')}.`);
p(`Short on the rest of the turn after the rez (Corp credits after < the rest-of-turn keep): ${T.filter(({ x }) => x.keeps && x.keeps.crAfter < x.keeps.restRez).length}; short on next turn's keep: ${T.filter(({ x }) => x.keeps && x.keeps.crAfter < x.keeps.nextTurn).length}; the slide's need is the build target (boardNeed below creditNeed) in ${T.filter(({ x }) => x.trace.rez.parts.cBoardNeed < x.trace.rez.parts.cNeed).length}.`);
p('\nThe five largest (by gain), whole:');
for (const { r, x } of [...T].sort((a, b) => b.x.gain - a.x.gain).slice(0, 5)) p(`\n- ${r.src} T${r.T} (${r.sk}) ${JSON.stringify({ server: r.m.server, cr: r.m.cr, rc: r.m.rc, rk: r.m.rk, b: r.m.b, ice: { ...x, trace: { ...x.trace, rez: { ...x.trace.rez, parts: undefined }, pass: { ...x.trace.pass, parts: undefined } } } })}`);

// ---------------------------------------------------------------- arms
p('\n## Arms: changed decisions\n');
const inClassTop = (arm, r) => {
  if (arm === 'leoFallThrough') return isA(r);
  if (arm === 'rdStakeUnseen') return bOf(r)?.unseen === 0;
  if (arm === 'tollByHold') return isW(r) || isW2(r);
  if (arm === 'keepPricedCentral') return isW(r);
  if (arm === 'keepPriced') return isW(r) || isW2(r);
  if (arm === 'spentApart') return true;
  return false;
};
const FIRES = { leoFallThrough: 'leoFall', rdStakeUnseen: 'rdOut', tollByHold: 'tollGate', keepPricedCentral: 'keepPriced', keepPriced: 'keepPriced', spentApart: '-' };
const where = (arm, r) => (inClassTop(arm, r) ? 'class' : arm !== 'spentApart' && fireOf(r, arm, FIRES[arm]) > 0 ? 'lookahead' : 'outside');
const dirOf = r => (rezzed(r.beta) && !rezzed(r.changed.tollByHold) ? 'i' : !rezzed(r.beta) && rezzed(r.changed.tollByHold) ? 'ii' : 'other');
p('| arm | kind | changed | a game | at the decision board (class) | through the look-ahead (fired) | outside every class | main | prompt | rez |');
p('|---|---|---|---|---|---|---|---|---|---|');
for (const arm of ALL_ARMS)
  for (const k of KINDS) {
    const d = D.filter(r => r.sk === k && r.changed?.[arm]);
    if (!d.length) continue;
    p(`| ${arm} | ${k} | ${d.length} | ${f3(d.length / Math.max(1, nGames(k)))} | ${d.filter(r => where(arm, r) === 'class').length} | ${d.filter(r => where(arm, r) === 'lookahead').length} | ${d.filter(r => where(arm, r) === 'outside').length} | ${d.filter(r => r.c === 'corpMain').length} | ${d.filter(r => r.c === 'corpPrompt').length} | ${d.filter(r => r.c === 'corpRez').length} |`);
  }
for (const arm of ALL_ARMS) {
  const o = D.filter(r => r.changed?.[arm] && where(arm, r) === 'outside');
  if (o.length) p(`\n**STOP: ${arm} changed decisions outside every class: ${o.length}**`);
  for (const r of o.slice(0, 20)) p(`- ${r.src} i${r.i} T${r.T} ${r.c} (${r.sk}): beta ${r.beta} | arm ${r.changed[arm]}; fire ${JSON.stringify(r.fire?.[ASKED.indexOf(arm)] ?? {})}`);
}
p('\ntollByHold by direction ((i) beta rezzes, the arm passes: F1 met; (ii) beta passes, the arm rezzes: R3 or R4 on a loss toll), at the decision board and through the look-ahead (by the fires: tollGate:pass, tollGate:rez):\n');
p('| kind | (i) at the board | (ii) at the board | other at the board | look-ahead with a pass fire only | with a rez fire only | both |');
p('|---|---|---|---|---|---|---|');
for (const k of KINDS) {
  const d = D.filter(r => r.sk === k && r.changed?.tollByHold);
  const top = d.filter(r => r.c === 'corpRez' && inClassTop('tollByHold', r));
  const look = d.filter(r => !(r.c === 'corpRez' && inClassTop('tollByHold', r)));
  const fp = r => fireOf(r, 'tollByHold', 'tollGate:pass');
  const fr = r => fireOf(r, 'tollByHold', 'tollGate:rez');
  p(`| ${k} | ${top.filter(r => dirOf(r) === 'i').length} | ${top.filter(r => dirOf(r) === 'ii').length} | ${top.filter(r => dirOf(r) === 'other').length} | ${look.filter(r => fp(r) && !fr(r)).length} | ${look.filter(r => fr(r) && !fp(r)).length} | ${look.filter(r => fr(r) && fp(r)).length} |`);
}
p('\nrdStakeUnseen: what moved at its changed decisions (beta / arm: keep, R&D\'s byServer; the other staked servers\' byServer):');
for (const r of D.filter(r => r.changed?.rdStakeUnseen).slice(0, 60)) {
  const b = bOf(r);
  p(`- ${r.src} i${r.i} T${r.T} ${r.c} (${r.sk}, ${where('rdStakeUnseen', r)}): unseen ${b?.unseen}; keep ${b?.keep} → ${r.bbArm?.keep ?? '?'}, rd ${b?.rd} → ${r.bbArm?.byServer?.rd ?? '-'}, others ${JSON.stringify(Object.fromEntries(Object.entries(b?.byServer ?? {}).filter(([k]) => k !== 'rd')))}; beta ${r.beta} | arm ${r.changed.rdStakeUnseen}`);
}

// ---------------------------------------------------------------- pairs
p('\n## Pairs\n');
p('Continuations (beta\'s agents both sides to the end; the arm\'s move against beta\'s from the same board), arm − beta per pair, mean ± SE. Corp wins diff (0/1); win-adjusted Corp points (a winner\'s score read as at least 7); raw Corp points; agenda points stolen (the Runner\'s score).\n');
const wadj = o => (o.winner === 'corp' ? Math.max(7, o.cs) : o.cs);
const pm = v => `${f2(mean(v))} ± ${f2(se(v))}`;
const cols = c => [c.map(x => (x.ca.winner === 'corp') - (x.cb.winner === 'corp')), c.map(x => wadj(x.ca) - wadj(x.cb)), c.map(x => x.ca.cs - x.cb.cs), c.map(x => x.ca.rs - x.cb.rs)].map(pm).join(' | ');
const decOf = new Map(D.map(r => [r.src + '|' + r.i, r]));
const contsOf = (arm, kinds, sel = () => true) => C.filter(c => c.arm === arm && kinds.includes(c.sk) && !c.ca.err && !c.cb.err && sel(decOf.get(c.src + '|' + c.i)));
p('| arm | subset | sources | pairs | Corp wins arm / beta | Corp wins diff | win-adjusted Corp points | Corp points | points stolen |');
p('|---|---|---|---|---|---|---|---|---|');
const SUBSETS = {
  tollByHold: [['(i) at the board', r => r?.c === 'corpRez' && inClassTop('tollByHold', r) && dirOf(r) === 'i'], ['(ii) at the board', r => r?.c === 'corpRez' && inClassTop('tollByHold', r) && dirOf(r) === 'ii'], ['look-ahead', r => !(r?.c === 'corpRez' && inClassTop('tollByHold', r))]],
  leoFallThrough: [['at the board', r => r?.c === 'corpRez'], ['look-ahead', r => r?.c !== 'corpRez']],
  rdStakeUnseen: [['at the board (unseen 0)', r => bOf(r)?.unseen === 0], ['look-ahead', r => bOf(r)?.unseen !== 0]],
  keepPricedCentral: [['at the board', r => r?.c === 'corpRez'], ['look-ahead', r => r?.c !== 'corpRez']],
  keepPriced: [['at the board', r => r?.c === 'corpRez'], ['look-ahead', r => r?.c !== 'corpRez']],
};
for (const arm of ALL_ARMS) {
  for (const [subset, sel] of [['all', () => true], ...(SUBSETS[arm] ?? [])])
    for (const [name, kinds] of KSETS) {
      const c = contsOf(arm, kinds, sel);
      if (!c.length) continue;
      p(`| ${arm} | ${subset} | ${name} | ${c.length} | ${c.filter(x => x.ca.winner === 'corp').length} / ${c.filter(x => x.cb.winner === 'corp').length} | ${cols(c)} |`);
    }
  const capped = D.filter(r => r.changed?.[arm]).length - C.filter(c => c.arm === arm).length;
  if (capped > 0) p(`| ${arm} | (changed decisions past the cap, no pair) | | ${capped} | | | | | |`);
}

// ---------------------------------------------------------------- D
p('\n## D. The 37 "rez not made" misses (count 3, section 4)\n');
let dl = [];
try {
  dl = JSON.parse(readFileSync(new URL('./rez-d-list.json', import.meta.url), 'utf8'));
} catch {
  p('rez-d-list.json not found.');
}
const runs = new Map();
for (const x of dl) {
  const k = `${x.src}|${x.T}|${x.run}`;
  const e = runs.get(k) ?? { ...x, rows: 0, wheres: [] };
  e.rows++;
  e.wheres.push(x.where);
  runs.set(k, e);
}
p(`${dl.length} rows (a row is a board-server of count 3: the turn start and the board before each run each count) = ${runs.size} distinct runs.\n`);
const reasonOf = (r, x) => {
  if (rezzed(r.beta)) return 'rezzed';
  if (x.at === 'match') return "matchPointRez's pass";
  if (x.at === 'R5') return 'R5';
  if (x.at === 'bypassed') return 'runBypassed';
  if (x.at === 'R3t' || x.at === 'R4t') return `a spendsKept pass (${x.at})`;
  if (x.gain != null && !(x.gain > 0)) return `the priced rez's gain not above 0 (exit ${x.at})`;
  return `other (exit ${x.at}, gain ${f2(x.gain)})`;
};
p('| deal | T | server | run | cause | count-3 rows | rez windows asked (ice) | not rezzed: what said no | server window |');
p('|---|---|---|---|---|---|---|---|---|');
const tally = {};
let classified = 0;
for (const e of runs.values()) {
  const w = D.filter(r => r.src === e.src && r.T === e.T && r.c === 'corpRez' && r.run === e.run && r.m?.server === e.server);
  const iw = w.filter(r => r.m.phase === 'approach_ice');
  const sw = w.filter(r => r.m.phase === 'approach_server');
  const no = iw.flatMap(r => ices(r).map(x => ({ r, x }))).filter(({ r }) => !rezzed(r.beta));
  const reasons = no.map(({ r, x }) => `pos ${r.m.pos} ${x.title}: ${reasonOf(r, x)}`);
  if (iw.length) classified++;
  for (const { r, x } of no) tally[reasonOf(r, x)] = (tally[reasonOf(r, x)] ?? 0) + 1;
  if (!iw.length) tally['no approach-ice window asked (the Corp could not pay, or nothing to rez)'] = (tally['no approach-ice window asked (the Corp could not pay, or nothing to rez)'] ?? 0) + 1;
  p(`| ${e.src} | ${e.T} | ${e.server} | ${e.run} | ${e.cause} | ${e.rows} | ${iw.length} | ${reasons.join('; ') || '-'} | ${sw.map(r => r.beta).join(', ') || '-'} |`);
}
p(`\nRuns with an approach-ice window on the record: ${classified} of ${runs.size}. What said no, over the windows not rezzed: ${JSON.stringify(tally)}.`);

// ---------------------------------------------------------------- time
p('\n## Time against control\n');
p('Ratio of means (arm / control) and p95 ratio, the whole ask; a decision over 2x control at 0.5 s or more counted.\n');
p('| arm | kind | n | mean ratio | p95 ratio | decisions over 2x at ≥0.5 s |');
p('|---|---|---|---|---|---|');
const ci = ASKED.indexOf('control');
for (const arm of ['beta', ...ARMS]) {
  const ai = ASKED.indexOf(arm);
  for (const [name, kinds] of [['all', KINDS], ...KINDS.map(k => [k, [k]])]) {
    const d = D.filter(r => kinds.includes(r.sk));
    if (!d.length) continue;
    const a = d.map(r => r.ms[ai]);
    const c = d.map(r => r.ms[ci]);
    const over = d.filter(r => r.ms[ai] >= 500 && r.ms[ai] > 2 * r.ms[ci]).length;
    p(`| ${arm} | ${name} | ${d.length} | ${f3(sum(a) / sum(c))} | ${f3(pct(a, 0.95) / pct(c, 0.95))} | ${over} |`);
  }
}

// ---------------------------------------------------------------- every changed decision
if (process.env.LIST) {
  p('\n## Every changed decision\n');
  for (const arm of ALL_ARMS) {
    const d = D.filter(r => r.changed?.[arm]);
    p(`\n### ${arm} (${d.length})\n`);
    for (const r of d) {
      const c = C.find(x => x.arm === arm && x.src === r.src && x.i === r.i);
      const cont = c ? ` → Corp ${c.ca.cs}-${c.ca.rs} ${c.ca.winner ?? '-'} vs ${c.cb.cs}-${c.cb.rs} ${c.cb.winner ?? '-'}` : '';
      p(`- ${r.src} i${r.i} T${r.T} ${r.c} (${r.sk}, ${where(arm, r)}) cr ${r.cr} cl ${r.cl}: beta ${r.beta} | arm ${r.changed[arm]}; fire ${JSON.stringify(r.fire?.[ASKED.indexOf(arm)] ?? {})}${cont}`);
    }
  }
}
