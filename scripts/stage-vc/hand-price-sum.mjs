// V-C item 2 (the hand's price) count: sums the rows of scripts/stage-vc/hand-price.ts.
//   node scripts/stage-vc/hand-price-sum.mjs ask <dir|file> <out.md> [jobs.json] [cap]   part ask: the tables, and the cont jobs
//   node scripts/stage-vc/hand-price-sum.mjs cont <ask dir|file> <cont dir|file> <jobs.json> <out.md>   part cont: the pairs
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KINDS = ['self', 'humanRunner', 'humanCorp'];
const readRows = input => {
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
  return rows;
};
const r2 = x => (Number.isFinite(x) ? Math.round(x * 100) / 100 : x);
const r3 = x => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x);
const mse = xs => {
  if (!xs.length) return { m: NaN, se: NaN, n: 0 };
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.length > 1 ? xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1) : 0;
  return { m, se: Math.sqrt(v / xs.length), n: xs.length };
};
const fmt = ({ m, se, n }) => (n ? `${r2(m)} ± ${r2(se)} (${n})` : '-');
const pct = (xs, q) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
// a tiny seeded rng for samples
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

const mode = process.argv[2];
const L = [];
const p = s => L.push(s);

function askTables(rows, jobsOut, cap) {
  const meta = rows.find(r => r.kind === 'meta');
  const ASKED = meta?.asked ?? ['beta', 'control', 'ownerEverywhere', 'keepFromOwner', 'ownerOne', 'flatEverywhere', 'heldRisk', 'leastBad'];
  const ARMS = ASKED.slice(2);
  const D = rows.filter(r => r.kind === 'd');
  const games = rows.filter(r => r.kind === 'g');
  const hs = rows.filter(r => r.kind === 'h');
  const S = rows.filter(r => r.kind === 's');
  const G1 = rows.filter(r => r.kind === 'g1');
  const CJ = rows.filter(r => r.kind === 'cj');
  const nG = { self: games.length, humanRunner: hs.filter(h => h.sk === 'humanRunner').length, humanCorp: hs.filter(h => h.sk === 'humanCorp').length };
  const per = (n, k) => (nG[k] ? r3(n / nG[k]) : '-');
  p(`# Hand price count, part ask: summed tables\n`);
  p(`Sources: ${nG.self} self-play games (${games.filter(g => g.matchesBatch).length} match the g1 base record), ${nG.humanRunner} human-Runner files, ${nG.humanCorp} human-Corp files; ${D.length} decisions asked of ${ASKED.join(', ')}.`);
  const bad = games.filter(g => !g.matchesBatch);
  if (bad.length) p(`**STOP: source games that do not match the batch: ${bad.map(g => g.src).join(', ')}**`);
  p(`Human files that stop replaying: ${hs.filter(h => h.stopped).map(h => `${h.src} (${h.stopped})`).join('; ') || 'none'}.`);
  const ctl = D.filter(d => d.controlDiffers);
  p(`Control answers unlike beta's: ${ctl.length}${ctl.length ? ' (STOP): ' + ctl.slice(0, 10).map(d => `${d.src} #${d.i}`).join(', ') : ''}.`);
  const errs = D.filter(d => d.errors);
  p(`Asks with an error: ${errs.length}${errs.length ? ': ' + errs.slice(0, 8).map(d => `${d.src} #${d.i} ${JSON.stringify(d.errors).slice(0, 120)}`).join('; ') : ''}.`);
  p(`Fresh agent plays the source's action (self-play, AI decisions): ${D.filter(d => d.sk === 'self' && d.fresh !== undefined).length ? r3(D.filter(d => d.sk === 'self' && d.fresh).length / D.filter(d => d.sk === 'self' && d.fresh !== undefined).length) : '-'}.\n`);

  // ------------------------------------------------------------------ H1
  p(`## H1. The prices of a card in HQ\n`);
  const H = D.filter(d => d.h1 && !d.h1.err);
  p(`Boards measured: ${H.length} (errors ${D.filter(d => d.h1?.err).length}). By reason and source kind:\n`);
  p(`| reason | ${KINDS.join(' | ')} |`);
  p(`|---|${KINDS.map(() => '---').join('|')}|`);
  for (const why of ['turnStart', 'discard', 'pickHq', 'leave', 'hqTrash']) p(`| ${why} | ${KINDS.map(k => H.filter(d => d.sk === k && d.h1.why === why).length).join(' | ')} |`);
  p(`\nBoards with an inversion (two cards of one hand the held worth and the keep order differently), a game (self) or count (human):\n`);
  p(`| boards | kind | boards | with an agenda/non-agenda inversion | a game | with another inversion | a game | pairs agenda/non-agenda | inverted | pairs other | inverted |`);
  p(`|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const [nm, f] of [
    ['leave (a card can leave HQ)', d => d.h1.why !== 'turnStart'],
    ['turn start (play values compared)', d => d.h1.why === 'turnStart'],
  ])
    for (const k of KINDS) {
      const xs = H.filter(d => d.sk === k && f(d));
      const an = xs.filter(d => d.h1.invAN > 0).length;
      const ot = xs.filter(d => d.h1.invOther > 0).length;
      const sum = key => xs.reduce((n, d) => n + d.h1[key], 0);
      p(`| ${nm} | ${k} | ${xs.length} | ${an} | ${per(an, k)} | ${ot} | ${per(ot, k)} | ${sum('pairsAN')} | ${sum('invAN')} | ${sum('pairsOther')} | ${sum('invOther')} |`);
    }
  // spreads by type
  const cards = H.flatMap(d => d.h1.cards.map(c => ({ ...c, sk: d.sk })));
  p(`\nThe prices by card type (all boards, all kinds; mean, and mean of |held - keepNet|):\n`);
  p(`| type | cards | held | keep - CLICK | 0.5 x keep | flat share | mean abs(held - keepNet) | held at the floor 0.5 |`);
  p(`|---|---|---|---|---|---|---|---|`);
  for (const ty of [...new Set(cards.map(c => c.type))]) {
    const xs = cards.filter(c => c.type === ty);
    p(`| ${ty} | ${xs.length} | ${r2(mean(xs.map(c => c.held)))} | ${r2(mean(xs.map(c => c.keepNet)))} | ${r2(mean(xs.map(c => c.half)))} | ${r2(mean(xs.map(c => c.flat)))} | ${r2(mean(xs.map(c => Math.abs(c.held - c.keepNet))))} | ${r3(xs.filter(c => c.held === 0.5).length / xs.length)} |`);
  }
  const byCard = new Map();
  for (const c of cards) {
    const e = byCard.get(c.title) ?? { title: c.title, type: c.type, n: 0, held: 0, keep: 0, gap: 0 };
    e.n++;
    e.held += c.held;
    e.keep += c.keepNet;
    e.gap += c.keepNet - c.held;
    byCard.set(c.title, e);
  }
  p(`\nThe 25 cards with the largest mean keepNet - held (n ≥ 5):\n`);
  p(`| card | type | n | held | keepNet | gap |`);
  p(`|---|---|---|---|---|---|`);
  for (const e of [...byCard.values()].filter(e => e.n >= 5).sort((a, b) => b.gap / b.n - a.gap / a.n).slice(0, 25)) p(`| ${e.title} | ${e.type} | ${e.n} | ${r2(e.held / e.n)} | ${r2(e.keep / e.n)} | ${r2(e.gap / e.n)} |`);
  p(`\nThe 10 cards with the smallest (most negative) mean keepNet - held (n ≥ 5):\n`);
  p(`| card | type | n | held | keepNet | gap |`);
  p(`|---|---|---|---|---|---|`);
  for (const e of [...byCard.values()].filter(e => e.n >= 5).sort((a, b) => a.gap / a.n - b.gap / b.n).slice(0, 10)) p(`| ${e.title} | ${e.type} | ${e.n} | ${r2(e.held / e.n)} | ${r2(e.keep / e.n)} | ${r2(e.gap / e.n)} |`);

  // ------------------------------------------------------------------ H2 and the G arms: changed decisions
  p(`\n## H2 and the arms: decisions changed against beta\n`);
  p(`| arm | ${KINDS.map(k => `${k} Corp (a game)`).join(' | ')} | ${KINDS.map(k => `${k} Runner`).join(' | ')} |`);
  p(`|---|${KINDS.map(() => '---').join('|')}|${KINDS.map(() => '---').join('|')}|`);
  for (const a of ARMS) {
    const ch = D.filter(d => d.changed?.[a]);
    p(`| ${a} | ${KINDS.map(k => {
      const n = ch.filter(d => d.sk === k && d.side === 'corp').length;
      return `${n} (${per(n, k)})`;
    }).join(' | ')} | ${KINDS.map(k => ch.filter(d => d.sk === k && d.side === 'runner').length).join(' | ')} |`);
  }
  p(`\nBy decision class and prompt kind (Corp, all kinds):\n`);
  p(`| arm | corpMain | corpPrompt discard | corpPrompt effect_cards | corpPrompt other | corpRez | Corp person boards |`);
  p(`|---|---|---|---|---|---|---|`);
  for (const a of ARMS) {
    const ch = D.filter(d => d.changed?.[a] && d.side === 'corp');
    p(`| ${a} | ${ch.filter(d => d.c === 'corpMain').length} | ${ch.filter(d => d.p?.kind === 'discard').length} | ${ch.filter(d => d.p?.kind === 'effect_cards').length} | ${ch.filter(d => d.c === 'corpPrompt' && !['discard', 'effect_cards'].includes(d.p?.kind)).length} | ${ch.filter(d => d.c === 'corpRez').length} | ${ch.filter(d => d.who === 'person').length} |`);
  }
  p(`\nFire counts (summed over the asks of each tree): ${ARMS.map((a, i) => {
    const f = {};
    for (const d of D) for (const [k, v] of Object.entries(d.fire?.[i + 2] ?? {})) f[k] = (f[k] ?? 0) + v;
    return `${a} ${JSON.stringify(f)}`;
  }).join('; ')}.`);
  p(`\nBeta's reader calls on Corp decisions (inside the look-ahead too), a self-play game: ${['kv', 'ht', 'so', 'kb', 'kbnz'].map(k => `${k} ${per(D.filter(d => d.sk === 'self').reduce((n, d) => n + (d.calls?.[k] ?? 0), 0), 'self')}`).join(', ')}.`);

  // ------------------------------------------------------------------ time
  p(`\n## Time against the control arm (Corp decisions; the stop: over 1.05x mean or 1.15x p95 on a source kind, or a decision over 2x at 0.5 s or more)\n`);
  p(`| arm | kind | mean top | p95 top | mean planner | p95 planner | over 2x at ≥ 0.5 s |`);
  p(`|---|---|---|---|---|---|---|`);
  const ci = ASKED.indexOf('control');
  for (const a of ['beta', ...ARMS]) {
    const ai = ASKED.indexOf(a);
    for (const k of KINDS) {
      const xs = D.filter(d => d.sk === k && d.side === 'corp');
      if (!xs.length) continue;
      const ta = xs.map(d => d.ms[ai]);
      const tc = xs.map(d => d.ms[ci]);
      const pa = xs.map(d => d.pm[ai]).filter(x => x > 0);
      const pc = xs.map(d => d.pm[ci]).filter(x => x > 0);
      const slow = xs.filter(d => Math.max(d.ms[ai], d.ms[ci]) >= 500 && d.ms[ai] > 2 * d.ms[ci]);
      p(`| ${a} | ${k} | ${r3(mean(ta) / mean(tc))} | ${r3(pct(ta, 0.95) / pct(tc, 0.95))} | ${r3(mean(pa) / mean(pc))} | ${r3(pct(pa, 0.95) / pct(pc, 0.95))} | ${slow.length}${slow.length ? ': ' + slow.slice(0, 4).map(d => `${d.src} #${d.i} ${Math.round(d.ms[ci])}->${Math.round(d.ms[ai])} ms`).join(', ') : ''} |`);
    }
  }

  // ------------------------------------------------------------------ H3
  p(`\n## H3. Row 76's three small ones\n`);
  const B = D.filter(d => d.h3b);
  p(`(b) Decisions after which an agenda went from HQ to Archives: ${KINDS.map(k => `${k} ${B.filter(d => d.sk === k).length}`).join(', ')}.`);
  p(`| src | T | class | gone | Archives holds (runnerTurn) | entries | archivedAgendaLoss | fate |`);
  p(`|---|---|---|---|---|---|---|---|`);
  for (const d of B.slice(0, 60)) p(`| ${d.src} | ${d.T} | ${d.c}${d.p ? ' ' + (d.p.card ?? d.p.kind) : ''} | ${d.h3b.gone.join(', ')} | ${d.h3b.arch?.holds} | ${d.h3b.arch?.entries} | ${(d.h3b.arch?.loss ?? []).join(', ')} | ${d.h3b.fate.map(f => `${f.to}@T${f.T}`).join(', ')} |`);
  p(`Held / open Archives: ${B.filter(d => d.h3b.arch?.holds).length} / ${B.filter(d => d.h3b.arch && !d.h3b.arch.holds).length}; stolen from Archives afterwards: ${B.filter(d => d.h3b.fate.some(f => f.to === 'runnerScore')).length} (holding: ${B.filter(d => d.h3b.arch?.holds && d.h3b.fate.some(f => f.to === 'runnerScore')).length}).`);
  const SH = D.flatMap(d => (d.shuffle ?? []).map(x => ({ ...x, src: d.src, sk: d.sk })));
  p(`\n(c) Answers at the Corp's own prompts that shuffle an agenda from HQ into R&D, with the Archives loss the 0.5 x keep term charged: ${SH.length} (decisions ${D.filter(d => d.shuffle).length}).`);
  const shBy = new Map();
  for (const x of SH) {
    const e = shBy.get(x.title) ?? { n: 0, c: 0, prompts: new Set() };
    e.n++;
    e.c += x.charged;
    e.prompts.add(x.prompt);
    shBy.set(x.title, e);
  }
  for (const [t, e] of shBy) p(`- ${t}: ${e.n} answers, mean charge ${r2(e.c / e.n)}, prompts ${[...e.prompts].join(', ')}`);
  const kbCalls = S.reduce((n, s) => n + (s.kb?.calls ?? 0), 0);
  const kbNz = S.reduce((n, s) => n + (s.kb?.nz ?? 0), 0);
  const kbCards = {};
  for (const s of S) for (const [c, n] of Object.entries(s.kbCards ?? {})) kbCards[c] = (kbCards[c] ?? 0) + n;
  p(`\n(d) keepBonus over every beta ask (all sources): ${kbCalls} calls, ${kbNz} non-zero; cards: ${JSON.stringify(kbCards).slice(0, 400)}.`);

  // ------------------------------------------------------------------ G1 / G2
  p(`\n## G1. Agendas held in HQ at a Corp turn's end whose install was legal that turn\n`);
  p(`| kind | agenda-turns | a game | line 3 | line 9 | behind | no candidate | HQ holds | HQ open | stolen from HQ next turn (this agenda) | HQ runs in next turn |`);
  p(`|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const k of KINDS) {
    const xs = G1.filter(g => g.sk === k);
    p(`| ${k} | ${xs.length} | ${per(xs.length, k)} | ${xs.filter(g => g.line === 3).length} | ${xs.filter(g => g.line === 9).length} | ${xs.filter(g => g.behind).length} | ${xs.filter(g => g.line === null).length} | ${xs.filter(g => g.hq?.holds).length} | ${xs.filter(g => g.hq && !g.hq.holds).length} | ${xs.filter(g => g.thisStolenNext).length} | ${xs.reduce((n, g) => n + (g.hqRunsIn ?? 0), 0)} |`);
  }
  p(`\nFate of the held agenda (its next move after the turn), by kind:\n`);
  for (const k of KINDS) {
    const xs = G1.filter(g => g.sk === k);
    const f = {};
    for (const g of xs) {
      const to = g.fate?.to?.startsWith('server') ? 'installed' : g.fate?.to;
      f[to] = (f[to] ?? 0) + 1;
    }
    p(`- ${k}: ${JSON.stringify(f)}`);
  }
  p(`\nSteals per game (self-play, true record): from HQ while some agenda-turn was held there ${G1.filter(g => g.sk === 'self').reduce((n, g) => n + (g.thisStolenNext ? 1 : 0), 0)}; by whether the agenda's best server held: held ${G1.filter(g => g.sk === 'self' && g.hold?.holds && g.thisStolenNext).length}, did not ${G1.filter(g => g.sk === 'self' && g.hold && !g.hold.holds && g.thisStolenNext).length}.`);
  const cls = G1.filter(g => g.line === 9 && g.hq && !g.hq.holds);
  p(`\n## G2. The class: line 9, HQ open for the coming turn, the Corp ends the turn holding it\n`);
  p(`| kind | class agenda-turns | a game (self) | stolen from HQ next turn | behind among them | HQ entries mean | __hqSteal mean | remote steal mean |`);
  p(`|---|---|---|---|---|---|---|---|`);
  for (const k of KINDS) {
    const xs = cls.filter(g => g.sk === k);
    p(`| ${k} | ${xs.length} | ${per(xs.length, k)} | ${xs.filter(g => g.thisStolenNext).length} | ${xs.filter(g => g.behind).length} | ${r2(mean(xs.map(g => g.hq.entries)))} | ${r3(mean(xs.map(g => g.steal)))} | ${r3(mean(xs.filter(g => Number.isFinite(g.remoteSteal)).map(g => g.remoteSteal)))} |`);
  }
  p(`\nThe first 40 class boards:\n`);
  p(`| src | T | agenda | hand | cr | credits/draws clicks | server | its hold (margin) | HQ entries | __hqSteal | remote steal | stolen next | fate |`);
  p(`|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const g of cls.slice(0, 40)) p(`| ${g.src} | ${g.T} | ${g.agenda} | ${g.hand.join(', ')} | ${g.cr} | ${g.credits}/${g.draws} | ${g.server} | ${g.hold?.holds} (${g.hold?.margin}) | ${g.hq.entries} | ${g.steal} | ${g.remoteSteal} | ${g.thisStolenNext} | ${g.fate?.to}@T${g.fate?.T} |`);
  p(`\nG3 jobs written: ${CJ.filter(c => c.job === 'g3' && !c.none).length} (${CJ.filter(c => c.job === 'g3' && c.none).length} class boards listed apart: ${[...new Set(CJ.filter(c => c.none).map(c => c.none))].join('; ')}).`);

  // ------------------------------------------------------------------ the changed decisions
  p(`\n## Every changed decision\n`);
  for (const a of ARMS) {
    const ch = D.filter(d => d.changed?.[a]);
    p(`\n### ${a} (${ch.length})\n`);
    for (const d of ch.slice(0, 300)) p(`- ${d.src} #${d.i} T${d.T} ${d.side} ${d.c}${d.p ? ` ${d.p.card ?? d.p.kind}/${d.p.step ?? ''}` : ''} (${d.who}): beta ${d.beta} -> ${d.changed[a]}; HQ [${(d.hq ?? []).join(', ')}], cr ${d.cr}, clicks ${d.clk}, Runner cr ${d.rcr}`);
    if (ch.length > 300) p(`- ... ${ch.length - 300} more`);
  }

  // ------------------------------------------------------------------ jobs
  if (jobsOut) {
    const jobs = [];
    const seen = new Map();
    const add = (src, sk, at, a, hq, tag) => {
      const k = `${src}|${at}|${JSON.stringify(a)}|${hq}`;
      if (seen.has(k)) return seen.get(k);
      const id = jobs.length;
      jobs.push({ id, src, sk, at, a, hq, tag });
      seen.set(k, id);
      return id;
    };
    const pairs = [];
    const perSrcArm = new Map();
    const armRows = CJ.filter(c => c.job === 'arm');
    // a cap per source and arm, a seeded sample past it
    const groups = new Map();
    for (const c of armRows) {
      const k = `${c.src}|${c.arm}`;
      (groups.get(k) ?? groups.set(k, []).get(k)).push(c);
    }
    for (const [, list] of groups) {
      const pick = list.length <= cap ? list : [...list].sort(() => rnd() - 0.5).slice(0, cap);
      for (const c of pick) {
        perSrcArm.set(c.arm, (perSrcArm.get(c.arm) ?? 0) + 1);
        for (const hq of c.hq ? [false, true] : [false]) pairs.push({ kind: 'arm', arm: c.arm, src: c.src, sk: c.sk, at: c.at, T: c.T, side: c.side, c: c.c, la: c.la, lb: c.lb, hq, A: add(c.src, c.sk, c.at, c.a, hq, 'arm'), B: add(c.src, c.sk, c.at, c.b, hq, 'beta') });
      }
    }
    // G3: up to 300 class boards a kind, then a seeded sample
    const g3 = CJ.filter(c => c.job === 'g3' && !c.none);
    const boards = new Map();
    for (const c of g3) {
      const k = `${c.src}|${c.T}|${c.agenda}`;
      (boards.get(k) ?? boards.set(k, []).get(k)).push(c);
    }
    const byKind = {};
    for (const [k, list] of boards) (byKind[list[0].sk] ??= []).push([k, list]);
    for (const [, bl] of Object.entries(byKind)) {
      const pick = bl.length <= 300 ? bl : [...bl].sort(() => rnd() - 0.5).slice(0, 300);
      for (const [k, list] of pick)
        for (const c of list) pairs.push({ kind: 'g3', board: k, src: c.src, sk: c.sk, T: c.T, agenda: c.agenda, hqSize: c.hqSize, hqAgendas: c.hqAgendas, line: c.line, hq: c.hq, J: add(c.src, c.sk, c.at, c.a, c.hq, 'g3') });
    }
    // shards: balance by source (each shard replays a source once), the heaviest sources first
    const bySrc = new Map();
    for (const j of jobs) bySrc.set(j.src, (bySrc.get(j.src) ?? 0) + 1);
    const load = Array(64).fill(0);
    const shardOf = new Map();
    for (const [src, n] of [...bySrc].sort((a, b) => b[1] - a[1])) {
      const i = load.indexOf(Math.min(...load));
      shardOf.set(src, i);
      load[i] += n + 3;
    }
    for (const j of jobs) j.shard = shardOf.get(j.src);
    writeFileSync(jobsOut, JSON.stringify(jobs));
    writeFileSync(jobsOut.replace(/\.json$/, '-pairs.json'), JSON.stringify(pairs));
    p(`\nJobs: ${jobs.length} continuations for ${pairs.length} pairs/lines (arm pairs by arm, capped at ${cap} a source and arm: ${JSON.stringify(Object.fromEntries(perSrcArm))}); heaviest shard ${Math.max(...load)} job-units.`);
  }
}

function contTables(jobs, pairs, rows) {
  const R = new Map(rows.filter(r => r.kind === 'cr').map(r => [r.id, r]));
  const res = id => R.get(id);
  const stolen = (r, at) => (at === 'end' ? r.r.rs : r.r.rs2) - r.rs0;
  const corpPts = (r, at) => (at === 'end' ? r.r.cs : r.r.cs2) - r.cs0;
  p(`# Hand price count, part cont: the pairs\n`);
  p(`Continuations read: ${R.size} of ${jobs.length}; with an error: ${[...R.values()].filter(r => r.err || r.r?.err).length}.\n`);
  const ARMSLIST = [...new Set(pairs.filter(x => x.kind === 'arm').map(x => x.arm))];
  p(`## The arms' changed decisions: arm's action minus beta's, beta's agents to the end (paired, SE)\n`);
  p(`| arm | sources | pairs | Corp wins arm / beta | Corp points +2 pairs | at the end | points stolen +2 pairs | at the end |`);
  p(`|---|---|---|---|---|---|---|---|`);
  for (const arm of ARMSLIST)
    for (const [nm, f] of [
      ['all', () => true],
      ['self', x => x.sk === 'self'],
      ['human', x => x.sk !== 'self'],
      ['HQ line (G arms)', x => x.hq],
    ]) {
      const xs = pairs.filter(x => x.kind === 'arm' && x.arm === arm && f(x) && (nm === 'HQ line (G arms)' ? x.hq : !x.hq)).filter(x => res(x.A) && res(x.B) && !res(x.A).err && !res(x.B).err);
      if (!xs.length) continue;
      const d = (g, at) => mse(xs.map(x => g(res(x.A), at) - g(res(x.B), at)));
      p(`| ${arm} | ${nm} | ${xs.length} | ${xs.filter(x => res(x.A).r.winner === 'corp').length} / ${xs.filter(x => res(x.B).r.winner === 'corp').length} | ${fmt(d(corpPts, 2))} | ${fmt(d(corpPts, 'end'))} | ${fmt(d(stolen, 2))} | ${fmt(d(stolen, 'end'))} |`);
    }
  p(`\nThe arm decisions where the arm's line had more points stolen within two turn pairs than beta's (the error to look for):\n`);
  for (const x of pairs.filter(x => x.kind === 'arm' && !x.hq && res(x.A) && res(x.B)))
    if (stolen(res(x.A), 2) > stolen(res(x.B), 2)) p(`- ${x.arm} ${x.src} #${x.at} T${x.T} ${x.c}: beta ${x.lb} -> ${x.la}: stolen ${stolen(res(x.B), 2)} -> ${stolen(res(x.A), 2)}`);
  // G3
  p(`\n## G3. Which place was least bad, at the class boards\n`);
  const boards = new Map();
  for (const x of pairs.filter(x => x.kind === 'g3')) {
    const k = `${x.board}|${x.hq}`;
    (boards.get(k) ?? boards.set(k, { x, lines: {} }).get(k)).lines[x.line] = res(x.J);
  }
  const B = [...boards.values()];
  p(`Class boards with continuations: ${new Set(B.map(b => b.x.board)).size} (with line iii: ${new Set(B.filter(b => b.lines.iii).map(b => b.x.board)).size}).\n`);
  p(`| Runner | lines | board group | n | Corp points +2 pairs | at the end | points stolen +2 pairs | at the end | Corp wins (a / b) |`);
  p(`|---|---|---|---|---|---|---|---|---|`);
  const groups = [
    ['all', () => true],
    ['self', b => b.x.sk === 'self'],
    ['human', b => b.x.sk !== 'self'],
    ['one agenda in HQ', b => b.x.hqAgendas === 1],
    ['two or more agendas in HQ', b => b.x.hqAgendas >= 2],
    ['HQ 1-3 cards', b => b.x.hqSize <= 3],
    ['HQ 4-5 cards', b => b.x.hqSize >= 4 && b.x.hqSize <= 5],
    ['HQ 6+ cards', b => b.x.hqSize >= 6],
  ];
  for (const hq of [false, true])
    for (const [a, bb] of [
      ['ii', 'i'],
      ['iii', 'iiiBase'],
    ])
      for (const [nm, f] of groups) {
        const xs = B.filter(b => b.x.hq === hq && f(b) && b.lines[a] && b.lines[bb] && !b.lines[a].err && !b.lines[bb].err && !b.lines[a].r.err && !b.lines[bb].r.err);
        if (!xs.length) continue;
        const d = (g, at) => mse(xs.map(b => g(b.lines[a], at) - g(b.lines[bb], at)));
        p(`| ${hq ? 'HQ line' : "beta's"} | ${a} - ${bb} | ${nm} | ${xs.length} | ${fmt(d(corpPts, 2))} | ${fmt(d(corpPts, 'end'))} | ${fmt(d(stolen, 2))} | ${fmt(d(stolen, 'end'))} | ${xs.filter(b => b.lines[a].r.winner === 'corp').length} / ${xs.filter(b => b.lines[bb].r.winner === 'corp').length} |`);
      }
  p(`\nClass boards where installing (ii) had more points stolen within two turn pairs than holding (i), beta's Runner:\n`);
  for (const b of B.filter(b => !b.x.hq && b.lines.ii && b.lines.i))
    if (stolen(b.lines.ii, 2) > stolen(b.lines.i, 2)) p(`- ${b.x.board}: ${stolen(b.lines.i, 2)} -> ${stolen(b.lines.ii, 2)}`);
}

if (mode === 'ask') {
  const rows = readRows(process.argv[3]);
  askTables(rows, process.argv[5], Number(process.argv[6] ?? 8));
  writeFileSync(process.argv[4], L.join('\n') + '\n');
} else if (mode === 'cont') {
  const jobs = JSON.parse(readFileSync(process.argv[5], 'utf8'));
  const pairs = JSON.parse(readFileSync(process.argv[5].replace(/\.json$/, '-pairs.json'), 'utf8'));
  contTables(jobs, pairs, readRows(process.argv[4]));
  writeFileSync(process.argv[6], L.join('\n') + '\n');
} else console.error('usage: see the head of the file');
