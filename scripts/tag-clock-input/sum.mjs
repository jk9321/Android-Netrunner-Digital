// F114 + F110 phase A sums (brief tag-clock-input rev 2). node scripts/tag-clock-input/sum.mjs <probe dir> [<record dir>] [<time dir>]
// Each dir holds the ai-script out/ (or local *.jsonl/*.txt files of JSON lines). Only games that finished are read.
// Errors are BY GAME (a by-game jackknife: the deal is the unit), paired where two costs are read on the same boards.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [probeDir, recordDir, timeDir] = process.argv.slice(2);
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
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const band = cc => (cc <= 4 ? '2-4' : cc <= 8 ? '5-8' : '9+');
const gk = r => `${r.pool}:${r.seed}`;
/** A statistic over units grouped by game, with its by-game jackknife error. */
function jack(units, stat) {
  const by = new Map();
  for (const u of units) by.set(gk(u), [...(by.get(gk(u)) ?? []), u]);
  const keys = [...by.keys()];
  const all = stat(units);
  if (keys.length < 2) return { v: all, se: NaN, games: keys.length, n: units.length };
  const loo = keys.map(k => stat(units.filter(u => gk(u) !== k)));
  const m = mean(loo);
  const se = Math.sqrt(((keys.length - 1) / keys.length) * sum(loo.map(x => (x - m) ** 2)));
  return { v: all, se, games: keys.length, n: units.length };
}
const js = j => `${f2(j.v)} ± ${f2(j.se)} (${j.n} units, ${j.games} games)`;
const POOLS = ['batch', 'nrdb'];
const P = (a, p) => a.filter(r => r.pool === p);
const isT = r => (r.did ?? '').startsWith('TRASH_RESOURCE');
const lines = [];
const say = (...x) => lines.push(x.join(' '));

// ================================================================ probe
const R = rowsOf(probeDir);
const done = new Set(R.filter(r => r.kind === 'g').map(gk));
const D = R.filter(r => r.kind === 'd' && !r.error && done.has(gk(r)) && r.pool !== 'people');
const U = R.filter(r => r.kind === 'u' && !r.error && done.has(gk(r)));
const Gm = R.filter(r => r.kind === 'g' && r.pool !== 'people');
const errs = R.filter(r => r.error || r.kind === 'err');
say(`# Probe: games ${Gm.length} (matches the batch record: ${Gm.filter(g => g.matchesBatch).length}), decisions ${D.length}, Runner turn starts ${U.length}, errors ${errs.length}`);
for (const e of errs.slice(0, 3)) say('  error:', JSON.stringify(e).slice(0, 300));
const usesOf = new Map(Gm.map(g => [gk(g), g.uses ?? []]));
// the trash line's take in Corp turn T of a game (record-set.ts measure)
const trashTake = (k, T) => sum((usesOf.get(k) ?? []).filter(u => u.line === 'trash' && u.T === T && u.active === 'corp').map(u => u.take));
const trashedIn = (k, T) => (usesOf.get(k) ?? []).filter(u => u.line === 'trash' && u.T === T && u.active === 'corp').length;
for (const pool of POOLS) {
  const p = P(D, pool);
  say(`\n## ${pool}: decisions ${p.length}, trashed ${p.filter(isT).length}`);
  // ---- 1 a
  const w = p.filter(r => r.dCorp !== undefined && !r.prompt);
  say(` 1a. Split of the trash's cost to the Corp side, the decision board (rows without an HQ-cost prompt: ${w.length}); Corp's view`);
  const line = (name, a) => say(`  ${name} (${a.length}): whole ${f2(mean(a.map(r => -r.dCorp)))} = click ${f2(mean(a.map(r => -r.dHand)))} + credit slide ${f2(mean(a.map(r => -r.dCred)))} + board ${f2(mean(a.map(r => -r.dBoard)))} + rest ${f2(mean(a.map(r => -r.dCorp + r.dHand + r.dCred + r.dBoard)))} | board for the click alone ${f2(mean(a.map(r => r.boardClick)))}, the 2 credits alone ${f2(mean(a.map(r => r.boardCred)))} | yardstick ${f2(mean(a.map(r => r.c2dec)))} | C1 ${f2(mean(a.map(r => r.c1.cost)))} | Runner-view C1 ${f2(mean(a.map(r => r.rv.c1.cost)))}`);
  line('all', w);
  line('trashed', w.filter(isT));
  line('not trashed', w.filter(r => !isT(r)));
  for (const b of ['2-4', '5-8', '9+']) line(`credits ${b}`, w.filter(r => band(r.cc) === b));
  const ex = a => pct(mean(a.map(r => r.c1.cost - 3.25)), mean(a.map(r => r.c2dec - 3.25)));
  say(`  share of the yardstick's excess over 3.25 that C1 carries: all ${ex(p)} | 2-4 ${ex(p.filter(r => band(r.cc) === '2-4'))} | 5-8 ${ex(p.filter(r => band(r.cc) === '5-8'))} | 9+ ${ex(p.filter(r => band(r.cc) === '9+'))}`);
  say(`  rows where the board moves 1+ for the click alone: ${w.filter(r => r.boardClick >= 1).length}; for the 2 credits alone: ${w.filter(r => r.boardCred >= 1).length}`);
  // ---- 1 b by decision and by Corp turn
  const c1m = mean(p.map(r => r.c1.cost));
  const costs = { 'flat 3.25': () => 3.25, C1: r => r.c1.cost, yardstick: r => r.c2dec, [`flat at C1's mean ${f2(c1m)}`]: () => c1m };
  say(' 1b. "pays" (the best net above the cost). By decision: pays, trashed among them, trashes outside');
  for (const [name, c] of Object.entries(costs)) {
    const pays = p.filter(r => r.base.nets[0] > c(r));
    say(`  ${name}: ${pays.length}, ${pays.filter(isT).length} (${pct(pays.filter(isT).length, pays.length)}), outside ${p.filter(r => isT(r) && !(r.base.nets[0] > c(r))).length}`);
  }
  const first = p.filter(r => r.firstOfTurn);
  const turnTrashed = r => trashedIn(gk(r), r.T) > 0;
  say(`  By Corp turn (first chance; trashed = any trash that turn): turns ${first.length}, trashed ${first.filter(turnTrashed).length}`);
  for (const [name, c] of Object.entries(costs)) {
    const pays = first.filter(r => r.base.nets[0] > c(r));
    say(`  ${name}: pays ${pays.length}, trashed ${pays.filter(turnTrashed).length} (${pct(pays.filter(turnTrashed).length, pays.length)}), trashed turns outside ${first.filter(r => turnTrashed(r) && !(r.base.nets[0] > c(r))).length}`);
  }
  // ---- 1 c: C1's bar reading
  const part = (r, c) => Math.max(0, r.base.nets[0] - c(r));
  const gapM = c => us => mean(us.map(r => part(r, c) - trashTake(gk(r), r.T)));
  say(' 1c. C1\'s bar reading, by Corp turn: the clock\'s trash part at the first chance less the trash line\'s take that turn (record-set measure)');
  for (const [name, c] of Object.entries(costs)) {
    const j = jack(first, gapM(c));
    say(`  ${name}: mean gap ${js(j)}; |mean gap| ${f2(Math.abs(j.v))}; mean part ${f2(mean(first.map(r => part(r, c))))}, mean take ${f2(mean(first.map(r => trashTake(gk(r), r.T))))}`);
  }
  const dj = jack(first, us => Math.abs(gapM(costs.C1)(us)) - Math.abs(gapM(costs['flat 3.25'])(us)));
  say(`  BAR: |mean gap| C1 less flat, paired by game: ${js(dj)} -> ${dj.v < -2 * dj.se ? 'C1 below flat by more than two SE' : dj.v > dj.se ? 'C1 WORSE by more than one SE' : 'within noise'}`);
  const tg = first.filter(turnTrashed), nt = first.filter(r => !turnTrashed(r));
  say(`  split: turns with a trash (${tg.length}) gap flat ${f2(gapM(costs['flat 3.25'])(tg))} C1 ${f2(gapM(costs.C1)(tg))}; turns without (${nt.length}) gap flat ${f2(gapM(costs['flat 3.25'])(nt))} C1 ${f2(gapM(costs.C1)(nt))}`);
  // ---- 1 d
  const pr = first.filter(r => r.atRunner && r.atRunner.cost !== null);
  say(` 1d. approx 2, which board: ${pr.length} pairs; C1 at the chance less at the last Runner-turn board ${f2(mean(pr.map(r => r.c1.cost - r.atRunner.cost)))}, mean abs ${f2(mean(pr.map(r => Math.abs(r.c1.cost - r.atRunner.cost))))}; "pays" differs ${pr.filter(r => r.c1.nets[0] > r.c1.cost !== r.atRunner.nets[0] > r.atRunner.cost).length}; Corp credits up ${pr.filter(r => r.cc > r.atRunner.cc).length}, down ${pr.filter(r => r.cc < r.atRunner.cc).length}`);
  const rc = p.filter(r => r.reach0 !== r.reach2);
  say(`  approx 3, money in reach changes 2 credits down: ${rc.length} of ${p.length}; slide there ${f2(mean(rc.map(r => r.slide)))}, elsewhere ${f2(mean(p.filter(r => r.reach0 === r.reach2).map(r => r.slide)))}`);
  say(`  approx 5, skip-1 boards (every chance board): C1 at the credits now ${f2(mean(p.map(r => r.c1.cost)))} against 2 credits down ${f2(mean(p.map(r => r.c1down2)))}; mean abs difference ${f2(mean(p.map(r => Math.abs(r.c1.cost - r.c1down2))))}`);
  // ---- 1 f identities
  const ids = arm => p.filter(r => !(r[arm].nets[0] > r[arm].cost) && Math.abs(r[arm].perTurn - r[arm].skip1) > 1e-9).length;
  say(` 1f. identities (each must be 0): new function vs two-call difference (4 side/viewer pairs) ${p.filter(r => r.fnDiffMax !== 0).length} boards; C1 cost inside vs outside the frame ${p.filter(r => r.c1in.cost !== r.c1.cost || r.c1in.perTurn !== r.c1.perTurn).length}; trashNow (best does not pay, skip 0 vs 1 differ) flat ${ids('base')} of ${p.filter(r => !(r.base.nets[0] > r.base.cost)).length}, C1 ${ids('c1')} of ${p.filter(r => !(r.c1.nets[0] > r.c1.cost)).length}`);
  // ---- 2
  const payN = (r, c) => r.base.nets.filter(n => n > c(r)).length;
  const two = first.filter(r => payN(r, costs['flat 3.25']) >= 2);
  const twoC = first.filter(r => payN(r, costs.C1) >= 2);
  const took = r => trashedIn(gk(r), r.T);
  const hist = a => [0, 1, 2].map(k => `${k === 2 ? '2+' : k}: ${a.filter(r => (k === 2 ? took(r) >= 2 : took(r) === k)).length}`).join(', ');
  say(` 2. Corp turns whose first chance has 2+ resources payable: flat ${two.length} (took ${hist(two)}); C1 ${twoC.length} (took ${hist(twoC)})`);
  // ---- 6
  const cp = p.filter(r => r.trashAt === 0 && r.behind === false && !isT(r));
  const kinds = {};
  for (const r of cp) kinds[r.did.split(':')[0]] = (kinds[r.did.split(':')[0]] ?? 0) + 1;
  say(` 6. counted picks took the click from a trash first and not behind: ${cp.length} (${JSON.stringify(kinds)}); trash v ${f2(mean(cp.map(r => r.v)))}; board for the click alone ${f2(mean(cp.map(r => r.boardClick)))} (1+ at ${cp.filter(r => r.boardClick >= 1).length})`);
  const lc = p.filter(r => r.ck === 1 && !isT(r) && r.riseCredit !== null);
  const flips = lc.filter(r => r.v <= r.creditValue && r.v > r.creditValue - r.riseCredit && r.base.nets[0] > 3.25);
  say(`  last-click rise: ${lc.length} last-click decisions without a trash; the credit click's clock rise ${f2(mean(lc.map(r => r.riseCredit)))}; flips the credit test against a paying trash at ${flips.length}${flips.length ? ' e.g. ' + flips.slice(0, 3).map(r => `${r.seed} T${r.T} v ${r.v} credit ${r.creditValue} rise ${r.riseCredit}`).join('; ') : ''}`);
  say(`  Rotary installed and a tag: decisions ${p.filter(r => r.rotary).length}, tagged turn starts ${P(U, pool).filter(r => r.rotary && r.tags > 0).length}`);
}
// ---- 3 and 5
for (const pool of POOLS) {
  const u = P(U, pool), tg = u.filter(r => r.tags > 0), d = P(D, pool);
  say(`\n## ${pool}: step 3 (P) and step 5`);
  const cards = {};
  for (const r of [...d, ...u]) for (const x of new Set(r.hqFlag)) cards[x] = (cards[x] ?? 0) + 1;
  say(`  flagged HQ cards, boards (decisions + turn starts) [kept by P if operation]: ${Object.entries(cards).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  say(`  identity term on: decisions ${d.filter(r => r.idFlag).length}, turn starts ${u.filter(r => r.idFlag).length} (decks: ${[...new Set(u.filter(r => r.idFlag).map(r => r.corpDeck))].join(', ')})`);
  const share = arm => 1 - sum(tg.map(r => Math.max(0, r[arm].c.nets ? r[arm].c.nets[0] - r[arm].c.cost : 0))) / sum(tg.map(r => r[arm].c.perTurn));
  const pun = arm => sum(tg.map(r => (r[arm].c.punish ?? 0) + (r[arm].c.id ?? 0))) / sum(tg.map(r => r[arm].c.perTurn));
  say(`  tagged turn starts ${tg.length} (with a resource ${tg.filter(r => r.nres > 0).length}); Corp-view per-turn input base ${f2(mean(tg.map(r => r.base.c.perTurn)))} / C1 ${f2(mean(tg.map(r => r.c1.c.perTurn)))} / P ${f2(mean(tg.map(r => r.p.c.perTurn)))} / C1+P ${f2(mean(tg.map(r => r.c1p.c.perTurn)))}; share that is the punisher term and the identity: base ${pct(pun('base'), 1)} P ${pct(pun('p'), 1)} C1+P ${pct(pun('c1p'), 1)} (not the trash part: base ${pct(share('base'), 1)} P ${pct(share('p'), 1)})`);
  say(`  Runner view, the same: base ${f2(mean(tg.map(r => r.base.r.perTurn)))} / C1 ${f2(mean(tg.map(r => r.c1.r.perTurn)))} / P ${f2(mean(tg.map(r => r.p.r.perTurn)))} / C1+P ${f2(mean(tg.map(r => r.c1p.r.perTurn)))}`);
  const decks = [...new Set(u.map(r => r.corpDeck))].sort();
  say('  Runner-view pool share of punishers held (turn starts), base / P, and the identity term, by Corp deck:');
  for (const dk of decks) {
    const a = u.filter(r => r.corpDeck === dk);
    say(`   ${dk} (${a.length}): ${f2(mean(a.map(r => r.base.r.held)))} / ${f2(mean(a.map(r => r.p.r.held)))}; id ${a.some(r => r.idFlag) ? 1 : 0}`);
  }
  const ip = tg.filter(r => r.hqFlag.some(x => x.startsWith('IP Enforcement')));
  say(`  IP Enforcement in HQ at tagged turn starts: ${ip.length}; an agenda it could take (points <= tags) ${ip.filter(r => r.rsAgendas.some(x => x > 0 && x <= r.tags)).length}; agendas but none it could take ${ip.filter(r => r.rsAgendas.length && !r.rsAgendas.some(x => x > 0 && x <= r.tags)).length}; none in the score area ${ip.filter(r => !r.rsAgendas.length).length}`);
  const g = P(Gm, pool);
  const byCard = {};
  for (const x of g) for (const us of x.uses ?? []) byCard[`${us.line}:${us.card === undefined ? '?' : us.line === 'trash' ? 'resource' : us.card}`] = (byCard[`${us.line}:${us.line === 'trash' ? 'resource' : us.card}`] ?? 0) + 1;
  say(`  uses by line and card (source games, record-set rule): ${Object.entries(byCard).sort().map(([k, n]) => `${k} ${n}`).join(', ')}`);
  // 5 a
  const ob = u.filter(r => r.orbital);
  if (ob.length) say(`  5a. vs Orbital Superiority decks (${ob.length} turn starts, ${[...new Set(ob.map(r => r.corpDeck))].join(', ')}): tagCost base ${f2(mean(ob.map(r => r.orbital.base.tagCost)))}, P ${f2(mean(ob.map(r => r.orbital.p.tagCost)))}; evaluate's fall for one more tag ${f2(mean(ob.map(r => r.orbital.base.evalDiff)))}, of which the clock ${f2(mean(ob.map(r => r.orbital.base.clockDiff)))}, the rest ${f2(mean(ob.map(r => r.orbital.base.evalDiff - r.orbital.base.clockDiff)))} (P: ${f2(mean(ob.map(r => r.orbital.p.evalDiff - r.orbital.p.clockDiff)))})`);
  else say('  5a. no Orbital Superiority deck in this pool');
  // 5 c
  say('  5c. direction table: Corp-view price of the next tag at Runner turn starts, base / C1 / P / C1+P, and the verdict per arm (lowered by 0.25+: "may give fewer tags")');
  for (const dk of decks) {
    const a = u.filter(r => r.corpDeck === dk);
    const m = arm => mean(a.map(r => r[arm].nextC));
    const v = arm => (m('base') - m(arm) >= 0.25 ? 'fewer' : 'same');
    say(`   ${dk} (${a.length}): ${f2(m('base'))} / ${f2(m('c1'))} / ${f2(m('p'))} / ${f2(m('c1p'))} | C1 ${v('c1')}, P ${v('p')}, C1+P ${v('c1p')}`);
  }
  const tpc = jack(g.filter(x => x.chances > 0), gs => sum(gs.map(x => x.trashes)) / sum(gs.map(x => x.chances)));
  say(`  games ${g.length}: trashes per chance ${js(tpc)}; tags given per game ${f2(mean(g.map(x => x.tagsGiven)))}; clears per game ${f2(mean(g.map(x => x.clears)))}`);
  const src = {};
  for (const x of g) for (const [k, n] of Object.entries(x.bySource ?? {})) src[k.replace(/:.*/, '')] = (src[k.replace(/:.*/, '')] ?? 0) + n;
  say(`  tags given by source kind: ${JSON.stringify(src)}`);
}
// ---- 7 people
const PD = R.filter(r => r.kind === 'd' && r.pool === 'people' && !r.error);
if (PD.length) {
  say(`\n## Step 7, people (the person was the Corp): ${PD.length} chances in ${new Set(PD.map(r => r.src)).size} games (${R.filter(r => r.kind === 'g' && r.pool === 'people').length} files read)`);
  const pays = (r, arm) => r[arm].nets && r[arm].nets[0] > r[arm].cost;
  for (const r of PD) say(`  ${r.src} T${r.T} ${r.firstOfTurn ? 'first' : '     '} cc ${r.cc} ck ${r.ck} tags ${r.tags}: did ${r.did} | flat pays ${pays(r, 'base') ? 'y' : 'n'} (${f2(r.base.nets?.[0] - r.base.cost)}), C1 pays ${pays(r, 'c1') ? 'y' : 'n'} (${f2(r.c1.nets?.[0] - r.c1.cost)}, cost ${f2(r.c1.cost)}); per-turn base ${f2(r.base.perTurn)} C1 ${f2(r.c1.perTurn)} P ${f2(r.p.perTurn)} C1+P ${f2(r.c1p.perTurn)}`);
  const ft = PD.filter(r => r.firstOfTurn);
  const tr = r => PD.some(x => x.src === r.src && x.T === r.T && x.did.startsWith('TRASH_RESOURCE'));
  for (const arm of ['base', 'c1']) {
    const py = ft.filter(r => pays(r, arm));
    say(`  by turn, ${arm}: ${ft.length} turns, the person trashed in ${ft.filter(tr).length}; "pays" ${py.length}, trashed among them ${py.filter(tr).length}, trashed outside ${ft.filter(r => tr(r) && !pays(r, arm)).length}`);
  }
}

// ================================================================ record (step 4, 5 b)
const RR = rowsOf(recordDir);
if (RR.length) {
  const done2 = new Set(RR.filter(r => r.kind === 'g').map(gk));
  const units = RR.filter(r => r.kind === 'u' && done2.has(gk(r)) && !r.beside.error);
  const CL = ['trash', 'punisher'];
  const legsOk = u => u.legs.filter(l => !l.error);
  const takeOf = (u, pred) => mean(legsOk(u).map(l => sum(l.uses.filter(pred).map(x => x.take ?? 0))));
  for (const u of units) {
    u.take = takeOf(u, x => CL.includes(x.line));
    u.takeTrash = takeOf(u, x => x.line === 'trash');
    u.takePun = takeOf(u, x => x.line === 'punisher');
    u.chances = mean(legsOk(u).map(l => l.chances));
    u.trashes = mean(legsOk(u).map(l => l.trashes));
  }
  say(`\n# Record (step 4): units ${units.length} in ${done2.size} games, leg errors ${units.reduce((n, u) => n + u.legs.filter(l => l.error).length, 0)}`);
  for (const pool of POOLS) {
    const p = P(units, pool);
    say(`\n## ${pool}: ${p.length} units (tagged Runner turn starts), horizon 1, the clock's own lines (trash, punisher)`);
    for (const arm of ['base', 'c1', 'p', 'c1p']) {
      const decks = [...new Set(p.map(u => u.corpDeck))].sort();
      const gapD = us => {
        // the pool's reading: the absolute value of each deck's mean gap, weighted by the deck's units
        let n = 0, s = 0;
        for (const dk of decks) {
          const a = us.filter(u => u.corpDeck === dk);
          if (!a.length) continue;
          n += a.length;
          s += a.length * Math.abs(mean(a.map(u => u.beside[arm].c.perTurn - u.take)));
        }
        return s / n;
      };
      const j = jack(p, gapD), sg = jack(p, us => mean(us.map(u => u.beside[arm].c.perTurn - u.take)));
      say(`  ${arm}: weighted |deck mean gap| ${js(j)}; signed mean gap ${f2(sg.v)} ± ${f2(sg.se)}; mean input ${f2(mean(p.map(u => u.beside[arm].c.perTurn)))}, clock output ${f2(mean(p.map(u => u.beside[arm].c.clock)))}`);
    }
    const dj = jack(p, us => {
      const f = arm => { const decks = [...new Set(us.map(u => u.corpDeck))]; let n = 0, s = 0; for (const dk of decks) { const a = us.filter(u => u.corpDeck === dk); n += a.length; s += a.length * Math.abs(mean(a.map(u => u.beside[arm].c.perTurn - u.take))); } return s / n; };
      return f('c1p') - f('base');
    });
    say(`  (read on base's own games; the check proper is step 9 on the arm's tree) C1+P less base, paired: ${js(dj)}`);
    say(`  take per unit: clock lines ${f2(mean(p.map(u => u.take)))} (trash ${f2(mean(p.map(u => u.takeTrash)))}, punisher ${f2(mean(p.map(u => u.takePun)))}); trashes per chance in the legs ${js(jack(p.filter(u => u.chances > 0), us => sum(us.map(u => u.trashes)) / sum(us.map(u => u.chances))))}`);
    say('  by deck: units, mean take, mean gap (signed) base / C1 / P / C1+P');
    for (const dk of [...new Set(p.map(u => u.corpDeck))].sort()) {
      const a = p.filter(u => u.corpDeck === dk);
      say(`   ${dk} (${a.length}): take ${f2(mean(a.map(u => u.take)))}; ${['base', 'c1', 'p', 'c1p'].map(arm => f2(mean(a.map(u => u.beside[arm].c.perTurn - u.take)))).join(' / ')}`);
    }
    const other = {};
    for (const u of p) for (const l of legsOk(u)) for (const x of l.uses) if (!CL.includes(x.line)) {
      const k = `${x.line}:${x.card}`;
      other[k] = other[k] ?? { n: 0, take: 0, gain: 0, kill: 0 };
      other[k].n++;
      other[k].take += x.take ?? 0;
      other[k].gain += x.gain ?? 0;
      if (x.kill) other[k].kill++;
    }
    say(`  other lines (never in the gap), uses over all legs: ${Object.entries(other).map(([k, v]) => `${k} ${v.n} (take ${f2(v.take / v.n)}, gain ${f2(v.gain / v.n)}${v.kill ? `, kills ${v.kill}` : ''})`).join('; ') || 'none'}`);
    say('  5b. Runner-view per-turn input, base / C1 / P / C1+P, by Corp credits:');
    for (const b of ['0-1', '2-4', '5-8', '9+']) {
      const a = p.filter(u => (u.beside.cc <= 1 ? '0-1' : band(u.beside.cc)) === b);
      if (a.length) say(`   ${b} (${a.length}): ${['base', 'c1', 'p', 'c1p'].map(arm => f2(mean(a.map(u => u.beside[arm].r.perTurn)))).join(' / ')}`);
    }
  }
}

// ================================================================ time (1 e)
const TR = rowsOf(timeDir).filter(r => r.kind === 'time');
if (TR.length) {
  say(`\n# Time (1e): ${TR.length} games`);
  const tot = {};
  const nn = {};
  const dif = {};
  const wk = {};
  for (const r of TR) {
    for (const [k, v] of Object.entries(r.ms)) tot[k] = (tot[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.n)) nn[k] = (nn[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.differ)) dif[k] = (dif[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.work)) wk[k] = (wk[k] ?? 0) + v;
  }
  const kinds = Object.keys(nn).filter(k => !k.includes('tagged')).sort();
  say('  caller: decisions | seconds base / ctl / off / c1 / p / c1p | c1/off (same tree), c1/base, ctl/base, off/base');
  for (const k of kinds) {
    const s = a => (tot[`${a} ${k}`] ?? 0) / 1000;
    say(`  ${k}: ${nn[k]} | ${['base', 'ctl', 'off', 'c1', 'p', 'c1p'].map(a => f2(s(a))).join(' / ')} | ${f2(s('c1') / s('off'))}, ${f2(s('c1') / s('base'))}, ${f2(s('ctl') / s('base'))}, ${f2(s('off') / s('base'))}`);
  }
  say('  decisions that move against base (all / tagged): ' + ['ctl', 'off', 'c1', 'p', 'c1p'].map(a => `${a}: ` + kinds.map(k => `${k} ${dif[`${a} ${k}`] ?? 0}/${dif[`${a} ${k} tagged`] ?? 0}`).join(', ')).join(' || '));
  say('  per game, decisions moved: ' + ['c1', 'p', 'c1p'].map(a => `${a} ${f2(sum(kinds.map(k => dif[`${a} ${k}`] ?? 0)) / TR.length)}`).join(', '));
  say('  keep work-outs per tagLoss work-out (X tree): ' + ['off', 'c1'].map(a => `${a} ${f2(sum(kinds.map(k => wk[`keep ${a} ${k}`] ?? 0)) / sum(kinds.map(k => wk[`clock ${a} ${k}`] ?? 0)))}`).join(', ') + `; extra keep work-outs per clock price under C1: ${f2((sum(kinds.map(k => wk[`keep c1 ${k}`] ?? 0)) - sum(kinds.map(k => wk[`keep off ${k}`] ?? 0))) / sum(kinds.map(k => wk[`clock c1 ${k}`] ?? 0)))}`);
  const ts = TR.filter(r => r.turns);
  if (ts.length) {
    const t = ts.flatMap(r => r.turns.map(x => ({ ...x, pool: r.pool })));
    for (const pool of POOLS) {
      const a = t.filter(x => x.pool === pool);
      say(`  approx 4 (${pool}): Corp turns that start tagged with a resource and under 2 credits: ${a.length}; trashed in ${a.filter(x => x.trashes > 0).length}`);
    }
  }
}
console.log(lines.join('\n'));
