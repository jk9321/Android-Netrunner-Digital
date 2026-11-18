// Stage D item 2, step 1b (brief section 4): scores predictors of where the Runner runs next turn on the lines of
// runner-runs-record.ts (one per Runner turn). Every run of a turn is one observation of that turn's prediction.
//   node scripts/stage-d/runner-runs-counts.mjs rr/*.jsonl
//
// Servers are scored by identity (each server open at the turn's start) and by class: hq, rd, archives, `rtop` (the
// remote with the largest public stake: the Runner-view agenda odds of its best hidden root card, then advancement
// counters, then root cards, then ice, then the lowest id), `rother` (any other remote).
//  P0  today: PACE shares (src/ai/effectValues.ts: HQ 0.18, R&D 0.21, Archives 0.05, remotes 0.56 split evenly);
//  P1  last turn's runs by server, mixed with P0 (weight w fitted per sample; P0 when last turn had no runs);
//  P2  this Runner's runs so far by server with P0 as a Dirichlet prior of strength k (fitted per sample), optionally
//      each earlier turn weighted by d^age (d = 1: no decay);
//  P3  reach times stake: the open server (the hold count says the Runner's turn gets in: holds false) with the largest
//      public stake (odds x points), mass m on it and the rest by P0 (m fitted);
//  P4  P2 with mass m moved to P3's server (k, d and m fitted).
// Log loss in nats; top-1 is the share of runs whose server was the predictor's first choice. dLL: the predictor's
// log loss less P0's on the same runs, with its SE by a bootstrap over games (fitted numbers are refitted in no
// bootstrap: the SE is of the fixed fit, so read small differences with care).
import { readFileSync } from 'node:fs';

const PACE = { runs: 1.01, hq: 0.18, rd: 0.21, archives: 0.05, remote: 0.56 };
const files = process.argv.slice(2);
const lines = files.flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));

// Games: lines grouped by source, in turn order
const games = new Map();
for (const l of lines) {
  if (!games.has(l.src)) games.set(l.src, []);
  games.get(l.src).push(l);
}
for (const g of games.values()) g.sort((a, b) => a.turn - b.turn);

const stakeOf = s => s.odds * s.points;
const rkey = s => [stakeOf(s), s.adv, s.root, s.ice, -Number(s.id.replace(/\D/g, ''))];
const cmp = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i];
  return 0;
};
function rtop(turn) {
  const r = turn.servers.filter(s => s.kind === 'remote').sort((a, b) => cmp(rkey(a), rkey(b)));
  return r[0]?.id;
}
const classOf = (turn, id) => {
  if (id === 'hq' || id === 'rd' || id === 'archives') return id;
  return id === rtop(turn) ? 'rtop' : 'rother';
};

// The prior's shares: today's PACE, or (P0L, P2L) the shares measured on the OTHER games of the same sample
let SHARES = PACE;
function p0(turn) {
  const remotes = turn.servers.filter(s => s.kind === 'remote');
  const p = { hq: SHARES.hq, rd: SHARES.rd, archives: SHARES.archives };
  for (const r of remotes) p[r.id] = SHARES.remote / remotes.length;
  return norm(p);
}
function sharesWithout(gs, skip) {
  const n = { hq: 0, rd: 0, archives: 0, remote: 0 };
  let all = 0;
  for (const g of gs) if (g !== skip) for (const t of g) for (const r of t.runs) {
    const c = r.server === 'hq' || r.server === 'rd' || r.server === 'archives' ? r.server : 'remote';
    n[c]++;
    all++;
  }
  return { hq: n.hq / all, rd: n.rd / all, archives: n.archives / all, remote: n.remote / all };
}
function norm(p) {
  const t = Object.values(p).reduce((a, b) => a + b, 0);
  const out = {};
  for (const [k, v] of Object.entries(p)) out[k] = v / t;
  return out;
}
const mix = (a, b, w) => {
  const out = {};
  for (const k of Object.keys(b)) out[k] = (1 - w) * b[k] + w * (a[k] ?? 0);
  return out;
};

// Earlier turns' runs on servers still open at this turn
function counts(game, i, d) {
  const n = {};
  const open = new Set(game[i].servers.map(s => s.id));
  for (let j = 0; j < i; j++) {
    const wgt = d ** (game[i].turn - game[j].turn - 1);
    for (const r of game[j].runs) if (open.has(r.server)) n[r.server] = (n[r.server] ?? 0) + wgt;
  }
  return n;
}
function lastTurn(game, i) {
  const prev = game[i - 1];
  if (!prev || prev.turn !== game[i].turn - 1 || !prev.runs.length) return null;
  const open = new Set(game[i].servers.map(s => s.id));
  const n = {};
  for (const r of prev.runs) if (open.has(r.server)) n[r.server] = (n[r.server] ?? 0) + 1;
  const t = Object.values(n).reduce((a, b) => a + b, 0);
  if (!t) return null;
  for (const k of Object.keys(n)) n[k] /= t;
  return n;
}
function p3target(turn) {
  const open = turn.servers.filter(s => s.holds === false);
  const pool = open.length ? open : turn.servers;
  return [...pool].sort((a, b) => cmp([stakeOf(a), a.kind === 'remote' ? 0 : 1], [stakeOf(b), b.kind === 'remote' ? 0 : 1]))[0]?.id;
}

const PRED = {
  P0: () => (game, i) => p0(game[i]),
  P1: ({ w }) => (game, i) => {
    const last = lastTurn(game, i);
    return last ? mix(last, p0(game[i]), w) : p0(game[i]);
  },
  P2: ({ k, d }) => (game, i) => {
    const base = p0(game[i]);
    const n = counts(game, i, d);
    const N = Object.values(n).reduce((a, b) => a + b, 0);
    if (k === Infinity || N === 0) return base;
    const out = {};
    for (const s of Object.keys(base)) out[s] = (n[s] ?? 0) / (N + k) + (k / (N + k)) * base[s];
    return out;
  },
  P3: ({ m }) => (game, i) => {
    const t = p3target(game[i]);
    const base = p0(game[i]);
    return t ? mix({ [t]: 1 }, base, m) : base;
  },
  P4: ({ k, d, m }) => (game, i) => {
    const two = PRED.P2({ k, d })(game, i);
    const t = p3target(game[i]);
    return t ? mix({ [t]: 1 }, two, m) : two;
  },
};

const EPS = 1e-4;
/** Per game: [sum log loss, runs, top-1 hits, class log loss sum]. */
function score(gs, pred) {
  const per = [];
  for (const g of gs) {
    let ll = 0;
    let n = 0;
    let hit = 0;
    let cll = 0;
    for (let i = 0; i < g.length; i++) {
      const p = pred(g, i);
      const first = Object.entries(p).sort((a, b) => b[1] - a[1])[0]?.[0];
      const cls = {};
      for (const [s, v] of Object.entries(p)) cls[classOf(g[i], s)] = (cls[classOf(g[i], s)] ?? 0) + v;
      for (const r of g[i].runs) {
        const q = Math.max(EPS, p[r.server] ?? 0);
        ll -= Math.log(q);
        cll -= Math.log(Math.max(EPS, cls[classOf(g[i], r.server)] ?? 0));
        n++;
        if (r.server === first) hit++;
      }
    }
    per.push([ll, n, hit, cll]);
  }
  return per;
}
const sum = (per, j) => per.reduce((a, x) => a + x[j], 0);
const mean = per => sum(per, 0) / Math.max(1, sum(per, 1));

// A seeded bootstrap over games of (pred - P0) log loss per run
function bootSE(per, base, B = 1000) {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const d = [];
  for (let b = 0; b < B; b++) {
    let a = 0;
    let z = 0;
    let n = 0;
    for (let i = 0; i < per.length; i++) {
      const j = Math.floor(rnd() * per.length);
      a += per[j][0];
      z += base[j][0];
      n += per[j][1];
    }
    if (n) d.push((a - z) / n);
  }
  const m = d.reduce((x, y) => x + y, 0) / d.length;
  return Math.sqrt(d.reduce((x, y) => x + (y - m) ** 2, 0) / (d.length - 1));
}

const K = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256];
const D = [1, 0.8, 0.6, 0.4];
const W = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const M = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
const grid = {
  P0: [{}],
  P1: W.map(w => ({ w })),
  P2: K.flatMap(k => [{ k, d: 1 }]),
  P2d: K.flatMap(k => D.filter(d => d < 1).map(d => ({ k, d }))),
  P3: M.map(m => ({ m })),
  P4: K.flatMap(k => D.flatMap(d => M.map(m => ({ k, d, m })))),
  P0L: [{}],
  P2L: K.map(k => ({ k, d: 1 })),
  P3L: M.map(m => ({ m })),
  P4L: K.flatMap(k => M.map(m => ({ k, d: 1, m }))),
};
let LOO = null; // the sample's games, for the leave-one-out prior
const make = (name, args) => {
  const inner = PRED[name === 'P2d' || name === 'P2L' ? 'P2' : name.endsWith('L') ? name.slice(0, -1) : name](args);
  if (!name.endsWith('L')) return (g, i) => ((SHARES = PACE), inner(g, i));
  return (g, i) => {
    SHARES = g.__loo ??= sharesWithout(LOO, g);
    const p = inner(g, i);
    SHARES = PACE;
    return p;
  };
};

function fit(gs, name) {
  let best = null;
  for (const args of grid[name]) {
    const per = score(gs, make(name, args));
    const ll = mean(per);
    if (!best || ll < best.ll) best = { args, per, ll };
  }
  return best;
}

const groups = { person: [], ai: [], self: [] };
for (const [src, g] of games) groups[g[0].who].push(g);

const out = { samples: {}, fits: {} };
for (const [who, gs] of Object.entries(groups)) {
  if (!gs.length) continue;
  const turns = gs.reduce((a, g) => a + g.length, 0);
  const runs = gs.reduce((a, g) => a + g.reduce((b, t) => b + t.runs.length, 0), 0);
  // Where the runs went, by class, against PACE
  const byClass = {};
  for (const g of gs) for (const t of g) for (const r of t.runs) byClass[classOf(t, r.server)] = (byClass[classOf(t, r.server)] ?? 0) + 1;
  for (const k of Object.keys(byClass)) byClass[k] = +(byClass[k] / runs).toFixed(3);
  // Runs a turn (PACE.runs 1.01), turns with no run
  const runsPerTurn = runs / turns;
  const idle = gs.reduce((a, g) => a + g.filter(t => !t.runs.length).length, 0) / turns;
  // A failed run repeated on the same server next turn, against running that server next turn at all after any run there
  let failed = 0;
  let repeated = 0;
  let succeeded = 0;
  let again = 0;
  for (const g of gs)
    for (let i = 0; i + 1 < g.length; i++) {
      if (g[i + 1].turn !== g[i].turn + 1) continue;
      const servers = new Set(g[i].runs.map(r => r.server));
      for (const s of servers) {
        if (!g[i + 1].servers.some(v => v.id === s)) continue;
        const ok = g[i].runs.some(r => r.server === s && r.successful);
        const next = g[i + 1].runs.some(r => r.server === s);
        if (ok) {
          succeeded++;
          if (next) again++;
        } else {
          failed++;
          if (next) repeated++;
        }
      }
    }
  // How concentrated a game's runs are: the share of its runs on its most-run server
  const top = gs.map(g => {
    const n = {};
    for (const t of g) for (const r of t.runs) n[r.server] = (n[r.server] ?? 0) + 1;
    const all = Object.values(n).reduce((a, b) => a + b, 0);
    return all ? Math.max(...Object.values(n)) / all : 0;
  });
  // Holds: share of runs made on a server the hold count said holds
  let onHeld = 0;
  let known = 0;
  for (const g of gs)
    for (const t of g)
      for (const r of t.runs) {
        const v = t.servers.find(s => s.id === r.server);
        if (v && v.holds !== null) {
          known++;
          if (v.holds) onHeld++;
        }
      }
  out.samples[who] = {
    games: gs.length,
    turns,
    runs,
    runsPerTurn: +runsPerTurn.toFixed(3),
    turnsWithoutRun: +idle.toFixed(3),
    shareByClass: byClass,
    failedRepeatedNextTurn: `${repeated}/${failed} = ${(repeated / Math.max(1, failed)).toFixed(3)}`,
    successfulRunAgainNextTurn: `${again}/${succeeded} = ${(again / Math.max(1, succeeded)).toFixed(3)}`,
    meanTopServerShare: +(top.reduce((a, b) => a + b, 0) / top.length).toFixed(3),
    runsOnServersTheCountHolds: `${onHeld}/${known}`,
  };
  LOO = gs;
  const base = score(gs, make('P0', {}));
  out.fits[who] = {};
  for (const name of Object.keys(grid)) {
    const f = name === 'P0' ? { args: {}, per: base, ll: mean(base) } : fit(gs, name);
    out.fits[who][name] = {
      args: f.args,
      logLoss: +f.ll.toFixed(4),
      classLogLoss: +(sum(f.per, 3) / sum(f.per, 1)).toFixed(4),
      top1: +(sum(f.per, 2) / sum(f.per, 1)).toFixed(3),
      dLL: name === 'P0' ? 0 : +(f.ll - mean(base)).toFixed(4),
      se: name === 'P0' ? 0 : +bootSE(f.per, base).toFixed(4),
    };
  }
  // P2's curve over k (no decay), for "the strength that fits each sample"
  out.fits[who].P2curve = Object.fromEntries(K.map(k => [k, +mean(score(gs, make('P2', { k, d: 1 }))).toFixed(4)]));
  // Cross-check: each sample scored with the person sample's P2 fit (do the samples agree)
}
if (out.fits.person) {
  const k = out.fits.person.P2.args.k;
  out.crossFit = {};
  for (const [who, gs] of Object.entries(groups)) if (gs.length) out.crossFit[who] = { k, logLoss: +mean(score(gs, make('P2', { k, d: 1 }))).toFixed(4) };
}
console.log(JSON.stringify(out, null, 1));
