// F114 + F110 phase A step 9 (brief tag-clock-input rev 2; ruling 1, ruling-redteam.md "Ruling 1 on phase A"): the ruled arm
// on its own tree against base. Arm and base are different games, so every difference is UNPAIRED: its error is the root
// of the sum of the two runs' squared errors, each a by-game jackknife.
//   node scripts/tag-clock-input/step9.mjs ARM=ruled BASE_PROBE=<dir> BASE_RECORD=<dir> ARM_PROBE=<dir> ARM_RECORD=<dir>
//        [BASE_PLAY=<dir: base g rows with tagsEnd>] [MOVES=<dir: MODE=time ASK=<arm> rows>]
// The bars it reads are the brief's, written before the batch (RULE-BAR-BEFORE-BATCH), never reworded:
//   the check: the pool's weighted |deck mean gap| (clock lines, Corp view) on the arm not above base's by more than 1 SE;
//   the take guard: trashes per chance and the take per unit not below base's by more than 2 SE (1 to 2: named);
//   tags given, against direction.md's column for the arm (the ruled arm's Corp view is C1+P's): in the "same" decks
//   taken together, a fall beyond 2 SE is a stop.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const A = Object.fromEntries(process.argv.slice(2).filter(x => x.includes('=')).map(x => x.split('=')));
const ARM = A.ARM ?? 'ruled';
const COLUMN = ARM === 'ruled' || ARM === 'ruledin' ? 'C1+P' : { c1: 'C1', p: 'P', c1p: 'C1+P' }[ARM];
function rowsOf(dir) {
  if (!dir) return [];
  const files = [];
  const walk = d => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(txt|jsonl)$/.test(f) && !/done-/.test(f)) files.push(p);
    }
  };
  if (statSync(dir).isDirectory()) walk(dir);
  else files.push(dir);
  const rows = [];
  for (const f of files) for (const l of readFileSync(f, 'utf8').split('\n')) if (l.startsWith('{')) try { rows.push(JSON.parse(l)); } catch {}
  return rows;
}
const mean = a => (a.length ? a.reduce((n, v) => n + v, 0) / a.length : NaN);
const sum = a => a.reduce((n, v) => n + v, 0);
const f2 = x => (Number.isFinite(x) ? x.toFixed(2) : String(x));
const gk = r => `${r.pool}:${r.seed}`;
const POOLS = ['batch', 'nrdb'];
const say = s => console.log(s);
function jack(units, stat) {
  const by = new Map();
  for (const u of units) by.set(gk(u), [...(by.get(gk(u)) ?? []), u]);
  const keys = [...by.keys()];
  const all = stat(units);
  if (keys.length < 2) return { v: all, se: NaN, games: keys.length, n: units.length };
  const loo = keys.map(k => stat(units.filter(u => gk(u) !== k)));
  const m = mean(loo);
  return { v: all, se: Math.sqrt(((keys.length - 1) / keys.length) * sum(loo.map(x => (x - m) ** 2))), games: keys.length, n: units.length };
}
const js = j => `${f2(j.v)} ± ${f2(j.se)} (${j.n} units, ${j.games} games)`;
/** arm less base, unpaired. */
const diff = (a, b) => ({ v: a.v - b.v, se: Math.hypot(a.se, b.se) });
const ds = d => `${f2(d.v)} ± ${f2(d.se)} (${f2(d.v / d.se)} SE)`;

// ---- direction table (committed 06572a4 before any arm game)
const DIR = {};
for (const l of readFileSync(new URL('./direction.md', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^\s{3}(.+) \(\d+\): [\d. /]+\| (.+)$/);
  if (!m) continue;
  const v = Object.fromEntries(m[2].split(', ').map(x => { const i = x.lastIndexOf(' '); return [x.slice(0, i), x.slice(i + 1)]; }));
  DIR[m[1]] = v[COLUMN];
}

// ---- the record on each tree (step 4's units; the take on the clock's own lines)
const CL = ['trash', 'punisher'];
function units(dir, arm) {
  const R = rowsOf(dir);
  const done = new Set(R.filter(r => r.kind === 'g').map(gk));
  const us = R.filter(r => r.kind === 'u' && done.has(gk(r)) && !r.beside.error && r.beside[arm]);
  for (const u of us) {
    const legs = u.legs.filter(l => !l.error);
    u.take = mean(legs.map(l => sum(l.uses.filter(x => CL.includes(x.line)).map(x => x.take ?? 0))));
    u.input = u.beside[arm].c.perTurn;
    u.gap = u.input - u.take;
  }
  return { us, games: done.size, legErr: R.filter(r => r.kind === 'u').reduce((n, u) => n + u.legs.filter(l => l.error).length, 0) };
}
const weighted = us => {
  const decks = [...new Set(us.map(u => u.corpDeck))];
  let n = 0, s = 0;
  for (const dk of decks) {
    const a = us.filter(u => u.corpDeck === dk);
    n += a.length;
    s += a.length * Math.abs(mean(a.map(u => u.gap)));
  }
  return s / n;
};
const RB = units(A.BASE_RECORD, 'base');
const RA = units(A.ARM_RECORD, ARM);
say(`# Step 9: arm ${ARM} (direction column ${COLUMN}) against base. Unpaired throughout.`);
say(`record: base ${RB.us.length} units in ${RB.games} games (leg errors ${RB.legErr}); arm ${RA.us.length} units in ${RA.games} games (leg errors ${RA.legErr})`);

// ---- the full games (the g rows of MODE=probe on each tree)
const gamesOf = dir => {
  const R = rowsOf(dir);
  return R.filter(r => r.kind === 'g');
};
const GB = gamesOf(A.BASE_PROBE);
const GA = gamesOf(A.ARM_PROBE);
const GE = A.BASE_PLAY ? new Map(gamesOf(A.BASE_PLAY).map(g => [gk(g), g.tagsEnd])) : new Map();
for (const g of GB) if (g.tagsEnd === undefined && GE.has(gk(g))) g.tagsEnd = GE.get(gk(g));
say(`games: base ${GB.length}, arm ${GA.length}; arm errors ${rowsOf(A.ARM_PROBE).filter(r => r.kind === 'e' || r.error).length}`);
const tpc = gs => jack(gs.filter(g => g.chances > 0), x => sum(x.map(g => g.trashes)) / sum(x.map(g => g.chances)));
const perGame = (gs, f) => jack(gs, x => mean(x.map(f)));
const P = (xs, pool) => xs.filter(x => x.pool === pool);

const stops = [];
const named = [];
for (const pool of POOLS) {
  say(`\n## ${pool}`);
  // the check
  const ub = P(RB.us, pool), ua = P(RA.us, pool);
  const cb = jack(ub, weighted), ca = jack(ua, weighted);
  const cd = diff(ca, cb);
  const checkOk = Number.isFinite(cd.se) && !(cd.v > cd.se);
  say(`CHECK (clock lines, Corp view): weighted |deck mean gap| base ${js(cb)}, arm ${js(ca)}; arm less base ${ds(cd)} -> ${checkOk ? 'passes (not above base by more than 1 SE)' : 'FAILS'}`);
  if (!checkOk) stops.push(`${pool}: the check`);
  say(`  signed mean gap base ${f2(mean(ub.map(u => u.gap)))}, arm ${f2(mean(ua.map(u => u.gap)))}; mean input base ${f2(mean(ub.map(u => u.input)))}, arm ${f2(mean(ua.map(u => u.input)))}; take base ${f2(mean(ub.map(u => u.take)))}, arm ${f2(mean(ua.map(u => u.take)))}`);
  say('  by deck: units base/arm, take base/arm, signed mean gap base -> arm (away from 0 by 0.25+: named)');
  for (const dk of [...new Set([...ub, ...ua].map(u => u.corpDeck))].sort()) {
    const b = ub.filter(u => u.corpDeck === dk), a = ua.filter(u => u.corpDeck === dk);
    const gb = mean(b.map(u => u.gap)), ga = mean(a.map(u => u.gap));
    const away = Math.abs(ga) - Math.abs(gb) >= 0.25;
    if (away) named.push(`${pool} ${dk}: gap ${f2(gb)} -> ${f2(ga)}`);
    say(`   ${dk}: ${b.length}/${a.length}, take ${f2(mean(b.map(u => u.take)))}/${f2(mean(a.map(u => u.take)))}, gap ${f2(gb)} -> ${f2(ga)}${away ? '  AWAY FROM 0' : ''}`);
  }
  // the take guard
  const gb = P(GB, pool), ga = P(GA, pool);
  const tb = tpc(gb), ta = tpc(ga), td = diff(ta, tb);
  const kb = jack(ub, x => mean(x.map(u => u.take))), ka = jack(ua, x => mean(x.map(u => u.take))), kd = diff(ka, kb);
  for (const [name, d, b, a] of [['trashes per chance', td, tb, ta], ['take per unit', kd, kb, ka]]) {
    const z = d.v / d.se;
    const verdict = !Number.isFinite(z) ? 'n/a' : z < -2 ? 'STOP (below base by more than 2 SE)' : z < -1 ? 'named (below base by 1 to 2 SE)' : 'passes';
    if (z < -2) stops.push(`${pool}: ${name}`);
    else if (z < -1) named.push(`${pool}: ${name} ${ds(d)}`);
    say(`TAKE GUARD ${name}: base ${js(b)}, arm ${js(a)}; arm less base ${ds(d)} -> ${verdict}`);
  }
  // tags given against the direction table
  const tg = gs => perGame(gs, g => g.tagsGiven);
  const same = gs => gs.filter(g => DIR[g.corpDeck] === 'same');
  const fewer = gs => gs.filter(g => DIR[g.corpDeck] === 'fewer');
  const sb = tg(same(gb)), sa = tg(same(ga)), sd = diff(sa, sb);
  const sOk = Number.isFinite(sd.se) && !(sd.v / sd.se < -2);
  if (!sOk) stops.push(`${pool}: tags given in the "same" decks`);
  say(`TAGS GIVEN per game, "same" decks together: base ${js(sb)}, arm ${js(sa)}; arm less base ${ds(sd)} -> ${sOk ? 'passes' : 'STOP'}`);
  const fb = tg(fewer(gb)), fa = tg(fewer(ga));
  say(`  "fewer" decks together (reported): base ${js(fb)}, arm ${js(fa)}; arm less base ${ds(diff(fa, fb))}`);
  const unk = [...new Set([...gb, ...ga].map(g => g.corpDeck))].filter(d => !DIR[d]);
  if (unk.length) say(`  decks not in the direction table: ${unk.join(', ')}`);
  // per game reads, by pool and deck
  const srcK = gs => { const o = {}; for (const g of gs) for (const [k, n] of Object.entries(g.bySource ?? {})) o[k.replace(/:.*/, '')] = (o[k.replace(/:.*/, '')] ?? 0) + n; return Object.fromEntries(Object.entries(o).map(([k, n]) => [k, f2(n / gs.length)])); };
  const usesK = gs => { const o = {}; for (const g of gs) for (const u of g.uses ?? []) { const k = `${u.line}:${u.card}`; o[k] = (o[k] ?? 0) + 1; } return Object.entries(o).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`).join(', '); };
  const row = gs => `chances ${f2(mean(gs.map(g => g.chances)))}, trashes ${f2(mean(gs.map(g => g.trashes)))}, tags given ${f2(mean(gs.map(g => g.tagsGiven)))}, clears ${f2(mean(gs.map(g => g.clears)))}, tags at the end ${f2(mean(gs.filter(g => g.tagsEnd !== undefined).map(g => g.tagsEnd)))}`;
  say(`  per game base: ${row(gb)}; tags by source ${JSON.stringify(srcK(gb))}`);
  say(`  per game arm:  ${row(ga)}; tags by source ${JSON.stringify(srcK(ga))}`);
  say(`  uses base: ${usesK(gb)}`);
  say(`  uses arm:  ${usesK(ga)}`);
  say('  by deck (games base/arm; direction): tags given, trashes, clears, tags at the end, base -> arm');
  for (const dk of [...new Set([...gb, ...ga].map(g => g.corpDeck))].sort()) {
    const b = gb.filter(g => g.corpDeck === dk), a = ga.filter(g => g.corpDeck === dk);
    const m = (gs, f) => f2(mean(gs.map(f)));
    say(`   ${dk} (${b.length}/${a.length}; ${DIR[dk] ?? '?'}): ${m(b, g => g.tagsGiven)} -> ${m(a, g => g.tagsGiven)}, ${m(b, g => g.trashes)} -> ${m(a, g => g.trashes)}, ${m(b, g => g.clears)} -> ${m(a, g => g.clears)}, ${m(b.filter(g => g.tagsEnd !== undefined), g => g.tagsEnd)} -> ${m(a, g => g.tagsEnd)}`);
  }
  const wins = gs => f2(gs.filter(g => g.winner === 'corp').length / gs.length);
  say(`  Corp wins (reported, not a bar): base ${wins(gb)}, arm ${wins(ga)}`);
}

// ---- decisions that move against base (MODE=time ASK=<arm>, on base's boards)
const TR = rowsOf(A.MOVES).filter(r => r.kind === 'time');
if (TR.length) {
  say(`\n## Decisions that move against base: ${TR.length} deals (${POOLS.map(p => `${p} ${P(TR, p).length}`).join(', ')}), on base's boards`);
  for (const pool of POOLS) {
    const t = P(TR, pool);
    const n = {}, d = {};
    for (const r of t) {
      for (const [k, v] of Object.entries(r.n)) n[k] = (n[k] ?? 0) + v;
      for (const [k, v] of Object.entries(r.differ)) if (k.startsWith(`${ARM} `)) d[k.slice(ARM.length + 1)] = (d[k.slice(ARM.length + 1)] ?? 0) + v;
    }
    const kinds = Object.keys(n).filter(k => !k.endsWith('tagged')).sort();
    say(`  ${pool}: by side and kind, moved / decisions (tagged moved / tagged decisions): ${kinds.map(k => `${k} ${d[k] ?? 0}/${n[k]} (${d[`${k} tagged`] ?? 0}/${n[`${k} tagged`] ?? 0})`).join(', ')}`);
    say(`  ${pool}: named apart: rezzes on the Runner's turn ${d["rez on the Runner's turn"] ?? 0}, credit clicks on a tagged board ${d['credit click tagged'] ?? 0}`);
    for (const r of t) {
      const f = r.first?.[ARM];
      say(`   ${r.seed} ${r.corpDeck}: ${f ? `first at decision ${f.i}, T${f.T} ${f.k} tags ${f.tags}: base ${f.base} | arm ${f.arm}` : 'no move'}`);
    }
  }
}

say(`\nSTOPS: ${stops.length ? stops.join('; ') : 'none'}`);
say(`NAMED: ${named.length ? named.join('; ') : 'none'}`);
