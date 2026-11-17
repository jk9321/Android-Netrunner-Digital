// Stage D item 2, brief rev 2 section 4: predictors of the chance that a server is run at least once in a Runner turn
// (the owner's unit, rev 2 3.5), scored per (Runner turn, open server) as a yes/no event on the lines of
// runner-runs-record.ts. Rev 1's share predictors are runner-runs-counts.mjs.
//   node scripts/stage-d/runner-runs-counts2.mjs rr/*.jsonl            (KIND=chosen or offered: count only that kind)
//
// Every predictor gives each open server a run rate a turn, lambda, and a chance 1 - exp(-lambda) (runs in a turn as a
// Poisson count). The prior lambda0 is today's: PACE.runs 1.01 x the PACE share (HQ 0.18, R&D 0.21, Archives 0.05, the
// remotes' 0.56 split evenly over the open remotes).
//  P0  lambda0.
//  P1  this game's record so far: lambda = (runs on S + k lambda0) / (turns S was open + k), RAISE-ONLY: max(lambda0, .).
//  P2  as P1 counting only the turns S had something public at stake (a remote with a card in its root; HQ and R&D
//      always; Archives with a card in it), and P0 while it has nothing at stake now. RAISE-ONLY.
//  P1u, P2u  the same without the raise-only floor (for the record: what lowering would add, rev 2 3.6 forbids it).
// k is fitted leave-one-game-out (for each game the k that fits the other games of the sample, then scored on it),
// and also reported as the single best k. Scores: mean Bernoulli log loss per (turn, server) in nats, the share of
// runs on the server with the largest chance (first choice), dLL against P0 with its SE (bootstrap over games) and
// the per-game spread (SD of the game's dLL).
import { readFileSync } from 'node:fs';

const PACE = { runs: 1.01, hq: 0.18, rd: 0.21, archives: 0.05, remote: 0.56 };
const KIND = process.env.KIND;
const lines = process.argv.slice(2).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)));
for (const l of lines) if (KIND) l.runs = l.runs.filter(r => r.kind === KIND);
const games = new Map();
for (const l of lines) (games.get(l.src) ?? games.set(l.src, []).get(l.src)).push(l);
for (const g of games.values()) g.sort((a, b) => a.turn - b.turn);

function lambda0(turn, s) {
  if (s.kind !== 'remote') return PACE.runs * PACE[s.kind];
  return (PACE.runs * PACE.remote) / turn.servers.filter(v => v.kind === 'remote').length;
}
const staked = s => (s.kind === 'remote' ? s.root > 0 : s.kind === 'archives' ? s.root > 0 || true : true);
// Archives' facts carry no card count; it counts as staked (its runs are few: 1.7% of a person's)

function predictor(name, k) {
  return (g, i) => {
    const t = g[i];
    const out = {};
    for (const s of t.servers) {
      const l0 = lambda0(t, s);
      if (name === 'P0') {
        out[s.id] = l0;
        continue;
      }
      const stakeOnly = name.startsWith('P2');
      if (stakeOnly && !staked(s)) {
        out[s.id] = l0;
        continue;
      }
      let n = 0;
      let T = 0;
      for (let j = 0; j < i; j++) {
        const v = g[j].servers.find(x => x.id === s.id);
        if (!v || (stakeOnly && !staked(v))) continue;
        T++;
        n += g[j].runs.filter(r => r.server === s.id).length;
      }
      const l = (n + k * l0) / (T + k);
      out[s.id] = name.endsWith('u') ? l : Math.max(l0, l);
    }
    return out;
  };
}

/** Per game: [log loss sum, (turn, server) events, runs, first-choice hits]. */
function score(gs, make) {
  return gs.map(g => {
    let ll = 0;
    let ev = 0;
    let runs = 0;
    let hit = 0;
    const pred = make(g);
    for (let i = 0; i < g.length; i++) {
      const lam = pred(g, i);
      const ran = new Set(g[i].runs.map(r => r.server));
      for (const [id, l] of Object.entries(lam)) {
        const p = Math.min(1 - 1e-4, Math.max(1e-4, 1 - Math.exp(-l)));
        ll -= ran.has(id) ? Math.log(p) : Math.log(1 - p);
        ev++;
      }
      const first = Object.entries(lam).sort((a, b) => b[1] - a[1])[0]?.[0];
      for (const r of g[i].runs) {
        runs++;
        if (r.server === first) hit++;
      }
    }
    return [ll, ev, runs, hit];
  });
}
const tot = (per, j) => per.reduce((a, x) => a + x[j], 0);
const mean = per => tot(per, 0) / Math.max(1, tot(per, 1));
function boot(per, base, B = 1000) {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
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
    d.push((a - z) / n);
  }
  const m = d.reduce((x, y) => x + y, 0) / B;
  return Math.sqrt(d.reduce((x, y) => x + (y - m) ** 2, 0) / (B - 1));
}

const K = [0.5, 1, 2, 4, 8, 16, 32, 64, 128];
const groups = { person: [], ai: [], self: [] };
for (const g of games.values()) groups[g[0].who].push(g);
const out = { kind: KIND ?? 'all' };
for (const [who, gs] of Object.entries(groups)) {
  if (!gs.length) continue;
  const base = score(gs, () => predictor('P0'));
  const row = { games: gs.length, turns: gs.reduce((a, g) => a + g.length, 0), runs: tot(base, 2), events: tot(base, 1), P0: { logLoss: +mean(base).toFixed(4), first: +(tot(base, 3) / tot(base, 2)).toFixed(3) } };
  for (const name of ['P1', 'P2', 'P1u', 'P2u']) {
    // Single best k, and the k curve
    const curve = Object.fromEntries(K.map(k => [k, mean(score(gs, () => predictor(name, k)))]));
    const kBest = +Object.entries(curve).sort((a, b) => a[1] - b[1])[0][0];
    // Leave one game out: each game scored with the k that fits the others
    const loo = gs.map(g => {
      const others = gs.filter(x => x !== g);
      const k = K.map(k => [k, mean(score(others, () => predictor(name, k)))]).sort((a, b) => a[1] - b[1])[0][0];
      return { k, s: score([g], () => predictor(name, k))[0] };
    });
    const per = loo.map(x => x.s);
    const dGame = per.map((x, i) => (x[0] - base[i][0]) / Math.max(1, x[1]));
    const mg = dGame.reduce((a, b) => a + b, 0) / dGame.length;
    row[name] = {
      kBest,
      looK: [...new Set(loo.map(x => x.k))].sort((a, b) => a - b),
      logLoss: +mean(per).toFixed(4),
      dLL: +(mean(per) - mean(base)).toFixed(4),
      se: +boot(per, base).toFixed(4),
      gameSD: +Math.sqrt(dGame.reduce((a, b) => a + (b - mg) ** 2, 0) / Math.max(1, dGame.length - 1)).toFixed(4),
      gamesBetter: `${dGame.filter(x => x < -1e-9).length}/${dGame.length}`,
      first: +(tot(per, 3) / tot(per, 2)).toFixed(3),
      curve: Object.fromEntries(Object.entries(curve).map(([k, v]) => [k, +v.toFixed(4)])),
    };
  }
  out[who] = row;
}
console.log(JSON.stringify(out, null, 1));
