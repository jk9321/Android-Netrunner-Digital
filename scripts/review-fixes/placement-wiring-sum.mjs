/**
 * Review fixes 2026-11-19, bundle P (placement wiring), count step: the summing step. Reads the JSON lines that
 * placement-wiring.ts printed (files or folders of them: the ai-script run's out/*.txt) and prints the note's tables
 * (markdown) to stdout; with LIST=1 also every changed decision.
 *
 *   node scripts/review-fixes/placement-wiring-sum.mjs <out dir or files...> > sum.md
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
const ASKED = meta?.asked ?? ['beta', 'control', 'shortOnce', 'coverAtPlace', 'redirectRemoteOnly', 'freeKey', 'shortCover'];
const ARMS = ASKED.slice(2);
const KINDS = ['self', 'humanRunner', 'humanCorp'];
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
const gameOf = r => r.src.split('#')[0];
const nGames = k => (k === 'self' ? games.length : humans.filter(h => h.sk === k).length);

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
if (errs.length) for (const r of errs.slice(0, 20)) p(`- error ${r.src} i${r.i}: ${JSON.stringify(r.errors)}`);
for (const r of D.filter(r => r.controlDiffers)) p(`- **STOP control differs** ${r.src} i${r.i} T${r.T} ${r.c}`);

// ---------------------------------------------------------------- S
p('\n## S. scoringShort\n');
p('Per Corp main-phase decision with a scoring remote (the deciding Corp\'s own view). Class: short today, not short with the scoring remote left out of the pools (`except`).\n');
p('| kind | main decisions | with a scoring remote | agenda in its root | short today | short today, agenda in root | class | class a game | games with class |');
p('|---|---|---|---|---|---|---|---|---|');
const sRows = k => D.filter(r => r.sk === k && r.c === 'corpMain' && r.m);
const isS = r => r.m?.s && r.m.s.shortToday && !r.m.s.shortOnce;
for (const k of KINDS) {
  const d = sRows(k);
  const s = d.filter(r => r.m.s);
  const cls = s.filter(isS);
  p(`| ${k} | ${d.length} | ${s.length} | ${s.filter(r => r.m.s.rootAgenda).length} | ${s.filter(r => r.m.s.shortToday).length} | ${s.filter(r => r.m.s.shortToday && r.m.s.rootAgenda).length} | ${cls.length} | ${f3(cls.length / Math.max(1, nGames(k)))} | ${new Set(cls.map(gameOf)).size} |`);
}
const sCls = D.filter(isS);
const notInRoot = sCls.filter(r => !r.m.s.rootAgenda).length;
p(`\nClass decisions with no agenda in the root (should be 0: the pools only differ when the remote stakes an agenda): ${notInRoot}.`);
p('\nAt class decisions: what the order did (the counted placements that read scoringShort), credits, the scoring remote\'s agendas\' fate in the source, and the Runner\'s next two turns by server (accesses / points stolen).\n');
p('| src | T | cr | cl | floor today / once (own rez) | counted placements | beta\'s move | agenda fate | window: scoring remote | HQ | R&D |');
p('|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of sCls) {
  const s = r.m.s;
  const counted = (r.m.d ?? []).map(x => `${x.title}:${x.rule}>${x.to}`).join('; ') || '-';
  const fate = (r.fate ?? []).map(x => `${x.by}${x.T ? ` T${x.T}` : ''}${x.server ? ` ${x.server}` : ''}`).join('; ') || '-';
  const w = id => (r.followed?.[id] ? `${r.followed[id].acc}/${r.followed[id].stolen}` : '0/0');
  p(`| ${r.src} | ${r.T} | ${r.cr} | ${r.cl} | ${s.floor} / ${s.floorOnce} (${s.own}) | ${counted} | ${r.beta} | ${fate} | ${w(s.id)} | ${w('hq')} | ${w('rd')} |`);
}

// ---------------------------------------------------------------- C
p('\n## C. Asset cover\n');
const cRows = D.filter(r => r.m?.c?.length);
p('| kind | decisions with an assetCover placement | waiting form | pair form | mean play value today | mean at the real first step | mean, both steps (pair) | cover in beta\'s intake | coverAtPlace changed |');
p('|---|---|---|---|---|---|---|---|---|');
for (const k of KINDS) {
  const d = cRows.filter(r => r.sk === k);
  const items = d.flatMap(r => r.m.c);
  const dedup = d.map(r => r.m.c[0]);


  const intake = d.filter(r => (r.cPlan ?? []).some(c => {
    const t = r.m.c.find(x => x.card === c.card);
    return t && c.betaIntake.some(a => a.startsWith('INSTALL_CARD asset:' + t.title + '>' + t.from));
  })).length;
  p(`| ${k} | ${d.length} | ${dedup.filter(c => c.form === 'waiting').length} | ${dedup.filter(c => c.form === 'pair').length} | ${f2(mean(items.map(c => c.vToday).filter(x => x != null)))} | ${f2(mean(items.map(c => c.vReal).filter(x => x != null)))} | ${f2(mean(items.filter(c => c.form === 'pair').map(c => c.vEnd).filter(x => x != null)))} | ${intake} | ${d.filter(r => r.changed?.coverAtPlace).length} |`);
}
p('\nEach decision with an assetCover placement: the form, the play value today / at the real first step, the look-ahead\'s value of the cover candidate on beta and on coverAtPlace (null: not in the intake), and both moves.\n');
p('| src | T | asset | form | from > to | v today / real (end) | look-ahead beta / arm | beta\'s move | coverAtPlace\'s move |');
p('|---|---|---|---|---|---|---|---|---|');
for (const r of cRows) {
  for (const c of r.m.c.slice(0, 1)) {
    const cp = (r.cPlan ?? []).find(x => x.card === c.card);
    const bi = cp ? cp.betaIntake.findIndex(a => a.startsWith(`INSTALL_CARD asset:${c.title}>${c.from}`)) : -1;
    const ai = cp?.armIntake ? cp.armIntake.findIndex(a => a.startsWith(`INSTALL_CARD asset:${c.title}>${c.form === 'waiting' ? c.server : c.from}`)) : -1;
    p(`| ${r.src} | ${r.T} | ${c.title} | ${c.form} | ${c.from} > ${c.server} | ${f2(c.vToday)} / ${f2(c.vReal)}${c.vEnd != null ? ` (${f2(c.vEnd)})` : ''} | ${bi >= 0 ? f2(cp.betaValues[bi]) : 'null'} / ${ai >= 0 && cp.armValues ? f2(cp.armValues[ai]) : 'null'} | ${r.beta} | ${r.changed?.coverAtPlace ?? '(same)'} |`);
  }
}

// ---------------------------------------------------------------- D
p('\n## D. One destination\n');
const dItems = D.filter(r => r.m?.d?.length).flatMap(r => r.m.d.map(x => ({ ...x, r })));
p('Counted destinations per card and decision, by rule, and the destinations no longer offered by kind.\n');
p('| kind | rule | card-decisions | decisions | a game | dropped: hq | rd | archives | agenda remote | scoring remote | other remote | new |');
p('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const k of KINDS)
  for (const rule of ['centralIce', 'iceRedirect', 'assetPartner', 'scoreLine', 'assetCover']) {
    const it = dItems.filter(x => x.r.sk === k && x.rule === rule);
    if (!it.length) continue;
    const dk = kk => it.filter(x => x.dropped.some(y => (kk === 'agendaRemote' ? y.k.startsWith('agendaRemote') : y.k === kk))).length;
    p(`| ${k} | ${rule} | ${it.length} | ${new Set(it.map(x => x.r.src + x.r.i)).size} | ${f3(new Set(it.map(x => x.r.src + x.r.i)).size / Math.max(1, nGames(k)))} | ${dk('hq')} | ${dk('rd')} | ${dk('archives')} | ${dk('agendaRemote')} | ${dk('scoringRemote')} | ${dk('remote')} | ${dk('new')} |`);
  }
p('\nIce redirected (iceRedirect): the centrals by the hold owner at those card-decisions (a central counted once per card-decision).\n');
p('| kind | iceRedirect card-decisions | a central with no ice | a central with one ice | a central that does not hold | a staked central that does not hold | ... and this ice there improves its count (class) | class decisions | class a game |');
p('|---|---|---|---|---|---|---|---|---|');
for (const k of KINDS) {
  const it = dItems.filter(x => x.r.sk === k && x.rule === 'iceRedirect' && x.centrals);
  const any = fn => it.filter(x => x.centrals.filter(c => c.id !== 'archives').some(fn)).length;
  const cls = it.filter(x => x.cls);
  const clsDec = new Set(cls.map(x => x.r.src + x.r.i)).size;
  p(`| ${k} | ${it.length} | ${any(c => c.ice === 0)} | ${any(c => c.ice === 1)} | ${any(c => !c.holds)} | ${it.filter(x => x.centrals.some(c => c.loss > 0 && !c.holds)).length} | ${cls.length} | ${clsDec} | ${f3(clsDec / Math.max(1, nGames(k)))} |`);
}
const up = dItems.filter(x => x.type === 'upgrade');
p(`\nUpgrades with a counted destination: ${up.length}; class (sent to a waiting remote while a remote holding an agenda could take it): ${up.filter(x => x.cls).length} (${KINDS.map(k => `${k} ${up.filter(x => x.cls && x.r.sk === k).length}`).join(', ')}).`);
p('\nWhat followed at ice class decisions (source; the Runner\'s turns T and T+1, accesses/points stolen): the staked centrals that did not hold against the scoring remote.\n');
p('| kind | class decisions | staked central: accesses | stolen | scoring remote: accesses | stolen |');
p('|---|---|---|---|---|---|');
for (const k of KINDS) {
  const decs = [...new Map(dItems.filter(x => x.r.sk === k && x.cls && x.type === 'ice').map(x => [x.r.src + x.r.i, x])).values()];
  let ca = 0, cs = 0, sa = 0, ss = 0;
  for (const x of decs) {
    const cen = x.centrals.filter(c => c.loss > 0 && !c.holds && c.improves).map(c => c.id);
    for (const id of cen) {
      ca += x.r.followed?.[id]?.acc ?? 0;
      cs += x.r.followed?.[id]?.stolen ?? 0;
    }
    sa += x.r.followed?.[x.to]?.acc ?? 0;
    ss += x.r.followed?.[x.to]?.stolen ?? 0;
  }
  p(`| ${k} | ${decs.length} | ${ca} | ${cs} | ${sa} | ${ss} |`);
}

// ---------------------------------------------------------------- arms
p('\n## Arms: changed decisions and continuations\n');
/** coverWaiting's class: a board with a waiting-form assetCover placement. reservedOnce's: reservedForAgenda answers differently once. */
const isW = r => (r.m?.c ?? []).some(c => c.form === 'waiting');
const isR = r => !!r.m?.g && r.m.g.tt.reserved !== r.m.g.ot.reserved;
const inClass = (arm, r) => {
  if (arm === 'shortOnce') return isS(r);
  if (arm === 'coverAtPlace') return !!r.m?.c?.length;
  if (arm === 'redirectRemoteOnly') return (r.m?.d ?? []).some(x => x.rule === 'iceRedirect' || x.rule === 'assetPartner');
  if (arm === 'shortCover') return isS(r) || !!r.m?.c?.length;
  if (arm === 'coverWaiting') return isW(r);
  if (arm === 'reservedOnce') return isR(r);
  if (arm === 'shortReserved') return isS(r) || isR(r);
  if (arm === 'shortCoverWaiting') return isS(r) || isW(r);
  return false;
};
/** Direct: one of the two picks is not in the other tree's order (the candidate list changed at the pick); else the look-ahead chose apart. */
const how = (arm, r) => {
  if (r.c !== 'corpMain') return r.c;
  const bo = (r.orders?.beta ?? []).map(x => x.slice(x.indexOf(' ') + 1));
  const ao = (r.orders?.[arm] ?? []).map(x => x.slice(x.indexOf(' ') + 1));
  return !ao.includes(r.beta) || !bo.includes(r.changed[arm]) ? 'direct' : 'lookahead';
};
p('| arm | kind | changed decisions | a game | in its class | outside | main direct | main look-ahead | prompt | rez |');
p('|---|---|---|---|---|---|---|---|---|---|');
for (const arm of ARMS)
  for (const k of KINDS) {
    const d = D.filter(r => r.sk === k && r.changed?.[arm]);
    p(`| ${arm} | ${k} | ${d.length} | ${f3(d.length / Math.max(1, nGames(k)))} | ${d.filter(r => inClass(arm, r)).length} | ${d.filter(r => !inClass(arm, r)).length} | ${d.filter(r => how(arm, r) === 'direct').length} | ${d.filter(r => how(arm, r) === 'lookahead').length} | ${d.filter(r => r.c === 'corpPrompt').length} | ${d.filter(r => r.c === 'corpRez').length} |`);
  }
p('\nContinuations (beta\'s agents both sides to the end; arm\'s move against beta\'s from the same board): pairs, Corp wins each way, the paired difference arm − beta in Corp points and in agenda points stolen (mean ± SE).\n');
p('Columns (red team S2, addendum 1): Corp wins diff = arm − beta in Corp wins (0/1) per pair; win-adjusted Corp points = a winner\'s score read as at least 7 (a Corp flatline or deck-out win counts 7); raw Corp points; points stolen.\n');
p('| arm | sources | pairs | errors | Corp wins arm / beta | Corp wins diff | win-adjusted Corp points diff | Corp points diff | points stolen diff |');
p('|---|---|---|---|---|---|---|---|---|');
const wadj = o => (o.winner === 'corp' ? Math.max(7, o.cs) : o.cs);
const pm = v => `${f2(mean(v))} ± ${f2(se(v))}`;
/** The four paired columns: Corp wins diff, win-adjusted Corp points, raw Corp points, points stolen (arm − beta). */
const cols = c =>
  [c.map(x => (x.ca.winner === 'corp') - (x.cb.winner === 'corp')), c.map(x => wadj(x.ca) - wadj(x.cb)), c.map(x => x.ca.cs - x.cb.cs), c.map(x => x.ca.rs - x.cb.rs)].map(pm).join(' | ');
const contsOf = (arm, kinds) => C.filter(c => c.arm === arm && kinds.includes(c.sk) && !c.ca.err && !c.cb.err);
for (const arm of ARMS)
  for (const [name, kinds] of [['all', KINDS], ['self', ['self']], ['humanRunner', ['humanRunner']], ['humanCorp', ['humanCorp']]]) {
    const c = contsOf(arm, kinds);
    const errsN = C.filter(x => x.arm === arm && kinds.includes(x.sk) && (x.ca.err || x.cb.err)).length;
    if (!c.length && !errsN) continue;
    p(`| ${arm} | ${name} | ${c.length} | ${errsN} | ${c.filter(x => x.ca.winner === 'corp').length} / ${c.filter(x => x.cb.winner === 'corp').length} | ${cols(c)} |`);
  }
p('\nredirectRemoteOnly: points stolen by server, arm − beta, over the whole continuation and in the window (Runner turns T and T+1); the scoring remote is the decision\'s own.\n');
p('| kinds | pairs | HQ | R&D | Archives | the scoring remote | other remotes | window: centrals | window: scoring remote |');
p('|---|---|---|---|---|---|---|---|---|');
for (const [name, kinds] of [['all', KINDS], ['self', ['self']], ['human', ['humanRunner', 'humanCorp']]]) {
  const c = contsOf('redirectRemoteOnly', kinds);
  const dec = new Map(D.map(r => [r.src + '|' + r.i, r]));
  const by = sel => {
    const v = c.map(x => {
      const sid = dec.get(x.src + '|' + x.i)?.m?.s?.id;
      return sel(x.ca, sid) - sel(x.cb, sid);
    });
    return `${f2(mean(v))} ± ${f2(se(v))}`;
  };
  const sb = (o, ids) => sum(Object.entries(o.stolenBy).filter(([k]) => ids(k)).map(([, v]) => v));
  const wb = (o, ids) => sum(Object.entries(o.win).filter(([k]) => ids(k)).map(([, v]) => v.stolen));
  p(
    `| ${name} | ${c.length} | ${by(o => sb(o, k => k === 'hq'))} | ${by(o => sb(o, k => k === 'rd'))} | ${by(o => sb(o, k => k === 'archives'))} | ${by((o, s) => sb(o, k => k === s))} | ${by((o, s) => sb(o, k => k !== s && k.startsWith('remote')))} | ${by(o => wb(o, k => ['hq', 'rd', 'archives'].includes(k)))} | ${by((o, s) => wb(o, k => k === s))} |`,
  );
}
p('\nredirectRemoteOnly, the error to look for: continuations where the arm lost more points from the scoring remote than beta (an agenda stolen there that beta\'s redirect would have kept out).\n');
{
  const dec = new Map(D.map(r => [r.src + '|' + r.i, r]));
  const list = contsOf('redirectRemoteOnly', KINDS).filter(x => {
    const sid = dec.get(x.src + '|' + x.i)?.m?.s?.id;
    return sid && (x.ca.stolenBy[sid] ?? 0) > (x.cb.stolenBy[sid] ?? 0);
  });
  p(`${list.length} pairs.`);
  for (const x of list) {
    const sid = dec.get(x.src + '|' + x.i)?.m?.s?.id;
    p(`- ${x.src} T${x.T} (${x.sk}): arm ${x.a} | beta ${x.b}; ${sid} stolen arm ${x.ca.stolenBy[sid] ?? 0} / beta ${x.cb.stolenBy[sid] ?? 0}; Corp ${x.ca.cs}-${x.ca.rs} (${x.ca.winner}) / ${x.cb.cs}-${x.cb.rs} (${x.cb.winner})`);
  }
}

// ---------------------------------------------------------------- addendum 1: the narrower arms
const decOf = new Map(D.map(r => [r.src + '|' + r.i, r]));
const KSETS = [['all', KINDS], ['self', ['self']], ['human', ['humanRunner', 'humanCorp']]];
const pickOf = (r, a) => r.changed?.[a] ?? r.beta;
if (ARMS.includes('coverWaiting')) {
  p('\n## coverWaiting by red team S1\'s class\n');
  p('A side "covers" when its move is the cover\'s real move: the asset at the waiting remote (waiting form) or the pair\'s ice at the cover\'s server (pair form), on the decision\'s board.\n');
  p('| class | sources | pairs | Corp wins arm / beta | Corp wins diff | win-adjusted Corp points | Corp points | points stolen |');
  p('|---|---|---|---|---|---|---|---|');
  for (const arm of ['coverWaiting', 'shortCoverWaiting'].filter(a => ARMS.includes(a)))
    for (const [label, sel] of [
      ['arm covers, beta not (waiting)', cv => cv?.[arm] === 'waiting' && cv?.beta !== 'waiting'],
      ['beta covers, arm not (waiting)', cv => cv?.beta === 'waiting' && cv?.[arm] !== 'waiting'],
      ['arm covers, beta not (pair)', cv => cv?.[arm] === 'pair' && cv?.beta !== 'pair'],
      ['beta covers, arm not (pair)', cv => cv?.beta === 'pair' && cv?.[arm] !== 'pair'],
      ['neither', cv => !cv?.[arm] && !cv?.beta],
    ])
      for (const [name, kinds] of KSETS) {
        const c = contsOf(arm, kinds).filter(x => sel(decOf.get(x.src + '|' + x.i)?.covers));
        if (!c.length) continue;
        p(`| ${arm}: ${label} | ${name} | ${c.length} | ${c.filter(x => x.ca.winner === 'corp').length} / ${c.filter(x => x.cb.winner === 'corp').length} | ${cols(c)} |`);
      }
  for (const arm of ['coverWaiting', 'shortCoverWaiting'].filter(a => ARMS.includes(a))) {
    const d = D.filter(r => r.changed?.[arm] && (r.m?.c ?? []).some(c => c.form === 'pair'));
    p(`\n${arm}: changed decisions on a board with a pair-form placement: ${d.length} (expected only through the look-ahead).\n`);
    for (const r of d)
      p(`- ${r.src} i${r.i} T${r.T} (${r.sk}, ${how(arm, r)}, waiting form on the board too: ${isW(r)}): beta ${r.beta} | arm ${r.changed[arm]}; covers ${JSON.stringify(r.covers ?? null)}`);
    const out = D.filter(r => r.changed?.[arm] && !inClass(arm, r));
    p(`\n${arm}: changed decisions outside its class: ${out.length}.\n`);
    for (const r of out) p(`- ${r.src} i${r.i} T${r.T} ${r.c} (${r.sk}, ${how(arm, r)}): beta ${r.beta} | arm ${r.changed[arm]}`);
    const ai = ASKED.indexOf(arm);
    const ill = D.filter(r => r.fire?.[ai]?.waitIllegal);
    p(`\n${arm}: waiting-form candidates the engine would refuse (red team M4): ${sum(ill.map(r => r.fire[ai].waitIllegal))} at ${ill.length} decisions.`);
  }
}
const gateFlips = (title, a, b, armA, armB) => {
  p(`\n### ${title}\n`);
  p('Boards with the gate measured (corp main decisions); "reserved differs" = reservedForAgenda answers differently; gate = `reserved && scoringShort(state)`; "reached" = the waiting branch does not return first for the cheapest econ asset in HQ.\n');
  p('| kind | boards | econ asset in HQ | reserved differs | gate false→true | gate true→false | of those, reached | decision differs |');
  p('|---|---|---|---|---|---|---|---|');
  for (const k of KINDS) {
    const g = D.filter(r => r.sk === k && r.m?.g);
    const rd = g.filter(r => r.m.g[a].reserved !== r.m.g[b].reserved);
    const econ = g.filter(r => r.m.g.econ > 0);
    const ft = econ.filter(r => !r.m.g[a].gate && r.m.g[b].gate);
    const tf = econ.filter(r => r.m.g[a].gate && !r.m.g[b].gate);
    const reached = [...ft, ...tf].filter(r => r.m.g[a].reached || r.m.g[b].reached);
    const differs = [...new Set([...rd, ...ft, ...tf])].filter(r => pickOf(r, armA) !== pickOf(r, armB));
    p(`| ${k} | ${g.length} | ${econ.length} | ${rd.length} | ${ft.length} | ${tf.length} | ${reached.length} | ${differs.length} |`);
  }
  const all = D.filter(r => r.m?.g && (r.m.g[a].reserved !== r.m.g[b].reserved || (r.m.g.econ > 0 && r.m.g[a].gate !== r.m.g[b].gate)));
  for (const r of all.slice(0, 60))
    p(`- ${r.src} i${r.i} T${r.T} (${r.sk}) cr ${r.cr} cl ${r.cl}: reserved ${r.m.g[a].reserved}→${r.m.g[b].reserved}, waiting ${r.m.g[a].waiting}→${r.m.g[b].waiting}, gate ${r.m.g[a].gate}→${r.m.g[b].gate}, reached ${r.m.g[a].reached}/${r.m.g[b].reached}; ${armA} ${pickOf(r, armA)} | ${armB} ${pickOf(r, armB)}`);
  if (all.length > 60) p(`- … ${all.length - 60} more`);
};
if (ARMS.includes('reservedOnce') || ARMS.includes('shortReserved')) {
  p('\n## reservedOnce: where the reservation and the gate answer differently\n');
  if (ARMS.includes('reservedOnce')) gateFlips('reservedOnce against control (today/today → once/today)', 'tt', 'ot', 'control', 'reservedOnce');
  if (ARMS.includes('shortReserved') && ARMS.includes('shortOnce')) {
    gateFlips('shortReserved against shortOnce (today/once → once/once)', 'to', 'oo', 'shortOnce', 'shortReserved');
    p('\nshortReserved against shortOnce, changed decisions by source kind:');
    for (const k of KINDS) p(`- ${k}: ${D.filter(r => r.sk === k && pickOf(r, 'shortReserved') !== pickOf(r, 'shortOnce')).length}`);
  }
}
if (ARMS.includes('shortCoverWaiting')) {
  p('\n## shortCoverWaiting against the union of shortOnce and coverWaiting\n');
  const ch = a => new Set(D.filter(r => r.changed?.[a]).map(r => r.src + '|' + r.i));
  const u = new Set([...ch('shortOnce'), ...ch('coverWaiting')]);
  const s = ch('shortCoverWaiting');
  const extra = [...s].filter(x => !u.has(x));
  const missing = [...u].filter(x => !s.has(x));
  const samePick = [...s].filter(x => u.has(x)).filter(x => {
    const r = decOf.get(x);
    return pickOf(r, 'shortCoverWaiting') !== (r.changed?.coverWaiting ?? r.changed?.shortOnce);
  });
  p(`shortCoverWaiting ${s.size}, union ${u.size}; new (in shortCoverWaiting only) ${extra.length}; missing (in the union only) ${missing.length}; in both but a different pick ${samePick.length}.`);
  for (const x of [...extra, ...missing, ...samePick]) {
    const r = decOf.get(x);
    p(`- ${r.src} i${r.i} T${r.T} ${r.c} (${r.sk}): beta ${r.beta} | shortCoverWaiting ${pickOf(r, 'shortCoverWaiting')} | coverWaiting ${pickOf(r, 'coverWaiting')} | shortOnce ${pickOf(r, 'shortOnce')}`);
  }
}

// ---------------------------------------------------------------- time
p('\n## Time against control\n');
p('Ratio of means (arm / control) and p95 ratio, top level (the whole ask) and inside the planner; stops: over 1.05x mean or 1.15x p95 on a source kind, or a decision over 2x control at 0.5 s or more.\n');
p('| arm | kind | n | mean ratio | p95 ratio | planner mean ratio | planner p95 ratio | decisions over 2x at ≥0.5 s |');
p('|---|---|---|---|---|---|---|---|');
const ci = ASKED.indexOf('control');
for (const arm of ['beta', ...ARMS]) {
  const ai = ASKED.indexOf(arm);
  for (const k of KINDS) {
    const d = D.filter(r => r.sk === k);
    if (!d.length) continue;
    const a = d.map(r => r.ms[ai]);
    const c = d.map(r => r.ms[ci]);
    const pa = d.map(r => r.pms?.[ai] ?? 0).filter((_, j) => (d[j].pms?.[ci] ?? 0) > 0);
    const pc = d.map(r => r.pms?.[ci] ?? 0).filter(x => x > 0);
    const over = d.filter(r => r.ms[ai] >= 500 && r.ms[ai] > 2 * r.ms[ci]).length;
    p(`| ${arm} | ${k} | ${d.length} | ${f3(sum(a) / sum(c))} | ${f3(pct(a, 0.95) / pct(c, 0.95))} | ${f3(sum(pa) / sum(pc))} | ${f3(pct(pa, 0.95) / pct(pc, 0.95))} | ${over} |`);
  }
}

// ---------------------------------------------------------------- every changed decision
if (process.env.LIST) {
  p('\n## Every changed decision\n');
  for (const arm of ARMS) {
    const d = D.filter(r => r.changed?.[arm]);
    p(`\n### ${arm} (${d.length})\n`);
    for (const r of d) {
      const c = C.find(x => x.arm === arm && x.src === r.src && x.i === r.i);
      const cont = c ? ` → Corp ${c.ca.cs}-${c.ca.rs} ${c.ca.winner ?? '-'} vs ${c.cb.cs}-${c.cb.rs} ${c.cb.winner ?? '-'}` : '';
      const counted = (r.betaPlacements ?? []).map(x => `${x.title}:${x.counted}>${x.returned[0]?.server}`).join('; ');
      const sInfo = r.m?.s ? ` S[${r.m.s.id} short ${r.m.s.shortToday}/${r.m.s.shortOnce} floor ${r.m.s.floor}/${r.m.s.floorOnce}]` : '';
      p(`- ${r.src} i${r.i} T${r.T} ${r.c} (${r.sk}, ${inClass(arm, r) ? 'class' : 'outside'}, ${how(arm, r)}) cr ${r.cr} cl ${r.cl}: beta ${r.beta} | arm ${r.changed[arm]}; counted: ${counted || '-'}${sInfo}${cont}`);
    }
  }
}
