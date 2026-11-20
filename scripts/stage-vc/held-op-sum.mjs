// V-C item 3 (the held economy operation) count: sums the rows of scripts/stage-vc/held-op.ts.
//   node scripts/stage-vc/held-op-sum.mjs ask <dir|file> <out.md> [jobs.json] [cap]   part ask: the tables, and the cont jobs
//   node scripts/stage-vc/held-op-sum.mjs cont <ask dir|file> <cont dir|file> <jobs.json> <out.md>   part cont: the pairs
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KINDS = ['self', 'humanRunner', 'humanCorp'];
const SUBS = ['now', 'next', 'held'];
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
const count = (xs, f) => xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
const top = (o, n = 12) =>
  Object.entries(o)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');

const mode = process.argv[2];
const L = [];
const p = s => L.push(s);

function askTables(rows, jobsOut, cap) {
  const meta = rows.find(r => r.kind === 'meta');
  const ASKED = meta?.asked ?? ['beta', 'control', 'reachShort', 'playedPrice', 'playedPriceShort', 'saveUpMoney'];
  const ARMS = ASKED.slice(2);
  const D = rows.filter(r => r.kind === 'd');
  const C = rows.filter(r => r.kind === 'c');
  const SP = rows.filter(r => r.kind === 'sp');
  const CJ = rows.filter(r => r.kind === 'cj');
  const games = rows.filter(r => r.kind === 'g');
  const hs = rows.filter(r => r.kind === 'h');
  const nG = { self: games.length, humanRunner: hs.filter(h => h.sk === 'humanRunner').length, humanCorp: hs.filter(h => h.sk === 'humanCorp').length };
  const per = (n, k) => (nG[k] ? r2(n / nG[k]) : '-');

  p('## Stops');
  p(`- Sources: self ${nG.self} games (${games.filter(g => g.matchesBatch === true).length} match the g1 base on winner, cr and sc; ${games.filter(g => g.matchesBatch === false).map(g => g.src).join(', ') || 'none'} do not), humanRunner ${nG.humanRunner}, humanCorp ${nG.humanCorp} files${hs.some(h => h.stopped) ? ` (replay stopped: ${hs.filter(h => h.stopped).map(h => `${h.src} ${h.stopped}`).join('; ')})` : ''}.`);
  p(`- Decisions asked: ${D.length} (Corp ${D.filter(d => d.side === 'corp').length}, Runner ${D.filter(d => d.side === 'runner').length}). Control differs from beta: ${D.filter(d => d.controlDiffers).length}. Asks with an error: ${D.filter(d => d.errors).length}${D.filter(d => d.errors).length ? ` (${top(count(D.filter(d => d.errors), d => Object.keys(d.errors).join('+')))})` : ''}.`);
  const fr = D.filter(d => d.fresh !== undefined && d.sk === 'self' && d.side === 'corp');
  p(`- A fresh beta Corp (agents restored from the source's) plays the source's action on ${fr.filter(d => d.fresh).length} of ${fr.length} self Corp decisions.`);

  // ------------------------------------------------------------------ the class
  p('\n## The class (Corp main-phase boards, a money operation in HQ)');
  const live = C; // c rows are live (now, next, held) cards on class boards
  const byBoard = new Map();
  for (const c of live) {
    const k = `${c.src}|${c.i}`;
    (byBoard.get(k) ?? byBoard.set(k, []).get(k)).push(c);
  }
  p('| source | boards (any) | now | next | held | games with one | plan-priced cards (apart) |');
  p('|---|---|---|---|---|---|---|');
  for (const k of KINDS) {
    const cs = live.filter(c => c.sk === k);
    const boards = new Set(cs.map(c => `${c.src}|${c.i}`));
    const sub = s => new Set(cs.filter(c => c.sub === s && !c.plan).map(c => `${c.src}|${c.i}`)).size;
    const gamesWith = new Set(cs.map(c => c.src.split('#')[0])).size;
    p(`| ${k} | ${boards.size} | ${sub('now')} | ${sub('next')} | ${sub('held')} | ${gamesWith} of ${nG[k]} | ${cs.filter(c => c.plan).length} |`);
  }
  const dCls = D.filter(d => d.cls);
  p(`- Played from the class (payable and the source played it): ${dCls.flatMap(d => d.cls).filter(c => c.sub === 'played').length} board-cards; far (short beyond next turn): ${dCls.flatMap(d => d.cls).filter(c => c.sub === 'far').length}.`);
  p(`- Cards met (live board-cards): ${top(count(live, c => c.card), 30)}.`);
  p(`- By shortfall and clicks left (self, now/next): ${top(count(live.filter(c => c.sk === 'self' && c.sub !== 'held'), c => `s${c.short}/c${c.clk}`), 20)}.`);
  p(`- Held (self) by clicks left: ${top(count(live.filter(c => c.sk === 'self' && c.sub === 'held'), c => `c${c.clk}`))}.`);

  // ------------------------------------------------------------------ T
  p('\n## T, the first layer that loses the play (plan-priced cards apart)');
  // memory boards take the layer of the last traced board of the same source, turn and card
  const lastLayer = new Map();
  const withLayer = [];
  for (const c of [...live].sort((a, b) => (a.src < b.src ? -1 : a.src > b.src ? 1 : a.i - b.i))) {
    const k = `${c.src.split('#')[0]}|${c.T}|${c.card}`;
    let layer = c.layer;
    let from = null;
    if (layer === 'memory') {
      const prev = lastLayer.get(k);
      layer = prev ? `${prev.layer}` : 'memory';
      from = prev ?? null;
    } else if (layer !== 'toward') lastLayer.set(k, c);
    withLayer.push({ ...c, L: layer, from });
  }
  for (const k of KINDS) {
    p(`\n### ${k}`);
    p('| sub-class | boards | toward (not lost) | L1 | L2 | L3 | L4 | L5 | picked | memory (no earlier trace) | err | fresh = source |');
    p('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const s of SUBS) {
      const xs = withLayer.filter(c => c.sk === k && c.sub === s && !c.plan);
      const n = L => xs.filter(c => c.L === L).length;
      p(`| ${s} | ${xs.length} | ${n('toward')} | ${n('L1')} | ${n('L2')} | ${n('L3')} | ${n('L4')} | ${n('L5')} | ${n('picked')} | ${n('memory')} | ${n('err') + n('noRec')} | ${xs.filter(c => c.fresh).length} |`);
    }
    for (const s of SUBS) {
      const xs = withLayer.filter(c => c.sk === k && c.sub === s && !c.plan);
      const lost = xs.filter(c => c.L !== 'toward');
      if (!lost.length) continue;
      const l1 = xs.filter(c => c.L === 'L1');
      const l2 = xs.filter(c => c.L === 'L2');
      const l3 = xs.filter(c => c.L === 'L3');
      p(`- **${s}**: lost on ${lost.length}. L1 by question: ${top(count(l1.map(c => c.from ?? c), c => c.q)) || '-'}. L2: ${top(count(l2.map(c => c.from ?? c), c => c.why)) || '-'}. L3: ${top(count(l3.map(c => c.from ?? c), c => `${c.why}; took ${c.took} line ${c.line}${c.byLine ? ' (held line)' : ''}`)) || '-'}.`);
      for (const L of ['L4', 'L5']) {
        const ys = xs.filter(c => c.L === L).map(c => (c.from ? { ...c.from } : c)).filter(c => Number.isFinite(c.gap));
        if (!ys.length) continue;
        const opHalf = ys.filter(c => c.gap > 0 && c.opGap >= 0.5 * c.gap).length;
        p(`  - ${L} (${ys.length}): gap (pick - this) ${fmt(mse(ys.map(c => c.gap)))}; the operation's own terms ${fmt(mse(ys.map(c => c.opGap)))}; everything else ${fmt(mse(ys.map(c => c.rest)))}. The operation's terms carry half or more of the gap on ${opHalf} of ${ys.length}. The pick: ${top(count(ys, c => c.pickKind))}. Op price at the pick's leaf ${fmt(mse(ys.map(c => c.opBest)))}, at this line's ${fmt(mse(ys.map(c => c.opCand)))}.`);
      }
    }
  }
  // ------------------------------------------------------------------ S
  p('\n## S, the price of the card by shortfall (value with the card in HQ less without; Corp view)');
  p('price(s) at the board with the Corp\'s credits set to cost - s; leaf = the planner\'s leaf pricing, plain = evaluate. playedOut = creditSlide(credits + gain) - creditSlide(credits) - CLICK at s = 0.');
  for (const k of KINDS) {
    const xs = live.filter(c => c.sk === k && Array.isArray(c.S));
    if (!xs.length) continue;
    p(`\n### ${k}`);
    p('| card | boards | leaf p(0) | leaf p(1) | leaf p(2) | leaf p(3+) | plain p(0) | plain p(1) | plain p(2) | plain p(3+) | playedOut(0) | leaf p(0) < p(1) | plain p(0) < p(1) |');
    p('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    const cards = [...new Set(xs.map(c => c.card))];
    const tot = { n: 0, lInv: 0, pInv: 0, both: 0 };
    for (const card of cards) {
      // one row per board and card (the board's S rows)
      const ys = xs.filter(c => c.card === card);
      const at = (c, s, f) => {
        const r = s === 3 ? c.S.filter(x => x.s >= 3) : c.S.filter(x => x.s === s);
        return r.length ? mean(r.map(x => x[f])) : NaN;
      };
      const col = (s, f) => r2(mean(ys.map(c => at(c, s, f)).filter(Number.isFinite)));
      const pairs = ys.filter(c => Number.isFinite(at(c, 0, 'leaf')) && Number.isFinite(at(c, 1, 'leaf')));
      const lInv = pairs.filter(c => at(c, 0, 'leaf') < at(c, 1, 'leaf') - 1e-9).length;
      const pInv = pairs.filter(c => at(c, 0, 'plain') < at(c, 1, 'plain') - 1e-9).length;
      tot.n += pairs.length;
      tot.lInv += lInv;
      tot.pInv += pInv;
      p(`| ${card} | ${ys.length} | ${col(0, 'leaf')} | ${col(1, 'leaf')} | ${col(2, 'leaf')} | ${col(3, 'leaf')} | ${col(0, 'plain')} | ${col(1, 'plain')} | ${col(2, 'plain')} | ${col(3, 'plain')} | ${col(0, 'playedOut')} | ${lInv} of ${pairs.length} | ${pInv} of ${pairs.length} |`);
    }
    p(`- All cards: price(0) below price(1) on ${tot.lInv} of ${tot.n} boards with both (leaf), ${tot.pInv} of ${tot.n} (plain).`);
    const z = xs.map(c => c.S.find(x => x.s === 0)).filter(Boolean);
    p(`- price(0) against the played-out worth: leaf ${fmt(mse(z.map(x => x.leaf - x.playedOut)))}, plain ${fmt(mse(z.map(x => x.plain - x.playedOut)))} (price less played-out).`);
  }

  // ------------------------------------------------------------------ guards
  p('\n## The guards on every class board (at the board with the credits raised to the cost; plain evaluation)');
  p('g1: the play scores below a click for a credit. g2: holding it (the click spent on nothing) scores at or above the play.');
  p('| tree | boards | g1 met | g2 met |');
  p('|---|---|---|---|');
  for (const arm of ['beta', ...ARMS]) {
    const gs = live.map(c => c.guards?.[arm]).filter(g => g && !g.err);
    p(`| ${arm} | ${gs.length} | ${gs.filter(g => g.g1).length} | ${gs.filter(g => g.g2).length} |`);
  }

  // ------------------------------------------------------------------ arms
  p('\n## The arms: decisions changed against beta');
  p('| arm | source | changed | a game | in the class (now/next/held) | out of the class, the arm fired in the ask | out of the class, no fire |');
  p('|---|---|---|---|---|---|---|');
  for (const arm of ARMS) {
    for (const k of KINDS) {
      const xs = CJ.filter(j => j.job === 'arm' && j.arm === arm && j.sk === k);
      p(`| ${arm} | ${k} | ${xs.length} | ${per(xs.length, k)} | ${xs.filter(j => j.inClass.length).length} (${top(count(xs.filter(j => j.inClass.length), j => j.inClass.join('+')))}) | ${xs.filter(j => !j.inClass.length && j.fire > 0).length} | ${xs.filter(j => !j.inClass.length && !(j.fire > 0)).length} |`);
    }
  }
  p('\n### Time (each ask against control on the same decision, Corp decisions)');
  p('| arm | source | mean ratio | p95 ratio | planner mean ratio | over 2x at 0.5 s or more |');
  p('|---|---|---|---|---|---|');
  const ci = ASKED.indexOf('control');
  for (const arm of ARMS) {
    const ai = ASKED.indexOf(arm);
    for (const k of KINDS) {
      const xs = D.filter(d => d.sk === k && d.side === 'corp' && d.ms && d.ms[ci] > 1);
      const rs = xs.map(d => d.ms[ai] / d.ms[ci]);
      const pm = xs.filter(d => d.pm[ci] > 1).map(d => d.pm[ai] / d.pm[ci]);
      const over = xs.filter(d => d.ms[ai] >= 500 && d.ms[ai] > 2 * d.ms[ci]).length;
      p(`| ${arm} | ${k} | ${r2(mean(rs))} | ${r2(pct(rs, 0.95))} | ${r2(mean(pm))} | ${over} |`);
    }
  }
  p('\n### Every changed decision');
  for (const arm of ARMS) {
    const xs = CJ.filter(j => j.job === 'arm' && j.arm === arm);
    p(`\n**${arm}** (${xs.length}): by what the arm played instead of beta: ${top(count(xs, j => `${j.kb}->${j.ka}`), 20)}`);
    for (const j of xs.slice(0, 400)) p(`- ${j.src} #${j.at} T${j.T} ${j.c}: beta ${j.lb} -> ${j.la}${j.inClass.length ? ` [class ${j.inClass.join('+')}]` : j.fire > 0 ? ' [look-ahead]' : ' [no fire]'}`);
  }

  // ------------------------------------------------------------------ spells
  p('\n## What happens to the card (spells: from its first class board until it leaves HQ)');
  p('| source | first sub-class | spells | played | left otherwise | still in HQ at the end | turns in HQ | turns from first payable board (held) | 4+ turns |');
  p('|---|---|---|---|---|---|---|---|---|');
  for (const k of KINDS)
    for (const s of SUBS) {
      const xs = SP.filter(x => x.sk === k && x.firstSub === s);
      if (!xs.length) continue;
      const ht = xs.map(x => x.heldTurns).filter(x => x !== null);
      p(`| ${k} | ${s} | ${xs.length} | ${xs.filter(x => x.how === 'played').length} | ${xs.filter(x => x.how === 'other').length} | ${xs.filter(x => x.how === 'end').length} | ${fmt(mse(xs.map(x => x.turns)))} | ${fmt(mse(ht))} | ${xs.filter(x => x.turns >= 4).length} |`);
    }
  for (const k of KINDS) {
    const cl = {};
    for (const x of SP.filter(x => x.sk === k)) for (const [a, n] of Object.entries(x.clicks)) cl[a] = (cl[a] ?? 0) + n;
    p(`- ${k}: the source's main-phase clicks while the card waited: ${top(cl)}.`);
  }
  // ------------------------------------------------------------------ report-50
  p('\n## Report-50, the Hedge Fund boards (every tree\'s answer)');
  const r50 = D.filter(d => d.r50);
  p(`${r50.length} boards.`);
  for (const d of r50) {
    const c = live.find(x => x.src === d.src && x.i === d.i && x.card === 'Hedge Fund');
    const lw = c ? withLayer.find(x => x.src === d.src && x.i === d.i && x.card === 'Hedge Fund') : null;
    p(`- ${d.src.split('#')[1] ?? ''} T${d.T} cr ${d.cr} clk ${d.clk}${c ? ` ${c.sub} s${c.short} layer ${lw?.L}` : ''}: played ${d.played}; ${ASKED.map(a => `${a} ${d.labels[a]}`).join('; ')}`);
  }

  // ------------------------------------------------------------------ jobs
  if (jobsOut) {
    const jobs = [];
    const perSrcArm = {};
    for (const j of CJ) {
      if (j.job === 'arm') {
        const k = `${j.src}|${j.arm}`;
        perSrcArm[k] = (perSrcArm[k] ?? 0) + 1;
        if (perSrcArm[k] > cap) continue;
      }
      jobs.push({ ...j, id: jobs.length });
    }
    // balance: by source, sources sorted by job count, round-robin onto 64 shards
    const bySrc = {};
    for (const j of jobs) (bySrc[j.src] ??= []).push(j);
    const load = Array(64).fill(0);
    for (const [, list] of Object.entries(bySrc).sort((a, b) => b[1].length - a[1].length)) {
      const s = load.indexOf(Math.min(...load));
      for (const j of list) j.shard = s;
      load[s] += list.length + 2;
    }
    writeFileSync(jobsOut, JSON.stringify(jobs));
    p(`\nJobs written: ${jobs.length} (R ${jobs.filter(j => j.job === 'R').length}, arm ${jobs.filter(j => j.job === 'arm').length}, at most ${cap} a source and arm), max shard load ${Math.max(...load)}.`);
  }
}

function contTables(askRows, contRows, jobs) {
  const byId = new Map(jobs.map(j => [j.id, j]));
  const res = new Map();
  for (const r of contRows.filter(r => r.kind === 'cr')) {
    if (!res.has(r.id)) res.set(r.id, {});
    res.get(r.id)[r.line] = r;
  }
  const cols = (x, y) => {
    // x - y, the five columns and the credits
    const adj = r => (r.winner === 'corp' ? Math.max(r.cs, 7) : r.cs);
    return {
      raw: x.r.cs - y.r.cs,
      adj: adj(x.r) - adj(y.r),
      win: (x.r.winner === 'corp' ? 1 : 0) - (y.r.winner === 'corp' ? 1 : 0),
      st2: x.r.rs2 - x.rs0 - (y.r.rs2 - y.rs0),
      stEnd: x.r.rs - x.rs0 - (y.r.rs - y.rs0),
      cr: x.r.crNext - y.r.crNext,
    };
  };
  const table = (title, ds) => {
    if (!ds.length) return p(`| ${title} | 0 | | | | | | |`);
    const f = k => fmt(mse(ds.map(d => d[k])));
    p(`| ${title} | ${ds.length} | ${f('raw')} | ${f('adj')} | ${f('win')} | ${f('st2')} | ${f('stEnd')} | ${f('cr')} |`);
  };
  const head = () => {
    p('| set | pairs | raw Corp points | win-adjusted Corp points | Corp wins | stolen within two turn pairs | stolen at the end | Corp credits at the end of its next turn |');
    p('|---|---|---|---|---|---|---|---|');
  };
  const errs = contRows.filter(r => r.kind === 'cr' && (r.err || r.r?.err));
  p(`Continuation errors: ${errs.length}${errs.length ? ` (${top(count(errs, r => (r.err ?? r.r.err).slice(0, 50)))})` : ''}.`);
  // ------------------------------------------------------------------ R
  p('\n## R, the record: the save-up line (ii) less beta\'s line (i), from one board a spell');
  head();
  const R = [];
  for (const [id, x] of res) {
    const j = byId.get(id);
    if (!j || j.job !== 'R' || !x.i || !x.ii || x.i.err || x.ii.err) continue;
    R.push({ j, ...cols(x.ii, x.i), forced: x.ii.r.forced, waitI: x.i.r.wait[j.id], waitII: x.ii.r.wait[j.id] });
  }
  table('all sources', R);
  for (const k of KINDS) table(k, R.filter(d => d.j.sk === k));
  for (const s of SUBS) {
    table(`**${s}** all sources`, R.filter(d => d.j.sub === s));
    for (const pk of [...new Set(R.filter(d => d.j.sub === s).map(d => d.j.pk))].sort()) table(`${s}, beta's click: ${pk}`, R.filter(d => d.j.sub === s && d.j.pk === pk));
    for (const k of KINDS) table(`${s}, ${k}`, R.filter(d => d.j.sub === s && d.j.sk === k));
  }
  const w = (d, k) => (d[k] === -1 || d[k] === null ? NaN : d[k]);
  p(`- Turns the card waits in HQ after the board: line i ${fmt(mse(R.map(d => w(d, 'waitI')).filter(Number.isFinite)))}, line ii ${fmt(mse(R.map(d => w(d, 'waitII')).filter(Number.isFinite)))}; still in HQ at the end: i ${R.filter(d => d.waitI === -1).length}, ii ${R.filter(d => d.waitII === -1).length}. Forced steps in line ii: ${fmt(mse(R.map(d => d.forced)))}.`);

  // ------------------------------------------------------------------ arms
  p('\n## The arms\' pairs: the arm\'s action less beta\'s, both continued by beta\'s agents');
  head();
  const A = [];
  for (const [id, x] of res) {
    const j = byId.get(id);
    if (!j || j.job !== 'arm' || !x.a || !x.b || x.a.err || x.b.err) continue;
    const wa = Object.values(x.a.r.wait).filter(v => v >= 0);
    const wb = Object.values(x.b.r.wait).filter(v => v >= 0);
    A.push({ j, ...cols(x.a, x.b), wait: wa.length && wb.length ? mean(wa) - mean(wb) : NaN, a: x.a, b: x.b });
  }
  const arms = [...new Set(A.map(d => d.j.arm))];
  for (const arm of arms) {
    table(`**${arm}** all sources`, A.filter(d => d.j.arm === arm));
    table(`${arm} self`, A.filter(d => d.j.arm === arm && d.j.sk === 'self'));
    table(`${arm} humanRunner`, A.filter(d => d.j.arm === arm && d.j.sk === 'humanRunner'));
    table(`${arm} humanCorp`, A.filter(d => d.j.arm === arm && d.j.sk === 'humanCorp'));
    table(`${arm} in the class`, A.filter(d => d.j.arm === arm && d.j.inClass.length));
    table(`${arm} out of the class`, A.filter(d => d.j.arm === arm && !d.j.inClass.length));
  }
  p('\nMoney operation wait (turns in HQ after the board, arm less beta, cards in HQ at the board that left it in both lines):');
  for (const arm of arms) p(`- ${arm}: ${fmt(mse(A.filter(d => d.j.arm === arm).map(d => d.wait).filter(Number.isFinite)))}`);
  p('\n### Every arm pair (stolen within two turn pairs and at the end, arm less beta; flagged: the arm clicked for a credit and the Runner stole more within two turn pairs)');
  for (const arm of arms)
    for (const d of A.filter(d => d.j.arm === arm)) {
      const flag = d.j.ka === 'credit' && d.st2 > 0 ? ' **credit while more was stolen**' : '';
      p(`- ${arm} ${d.j.src} #${d.j.at} T${d.j.T}: beta ${d.j.lb} -> ${d.j.la}; raw ${d.raw}, stolen2 ${d.st2}, stolenEnd ${d.stEnd}, cr ${d.cr}${flag}`);
    }
}

if (mode === 'ask') {
  const rows = readRows(process.argv[3]);
  askTables(rows, process.argv[5], Number(process.argv[6] ?? 8));
  writeFileSync(process.argv[4], L.join('\n') + '\n');
} else if (mode === 'cont') {
  const askRows = readRows(process.argv[3]);
  const contRows = readRows(process.argv[4]);
  const jobs = JSON.parse(readFileSync(process.argv[5], 'utf8'));
  contTables(askRows, contRows, jobs);
  writeFileSync(process.argv[6], L.join('\n') + '\n');
} else console.error('mode: ask | cont');
