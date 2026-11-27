// F119 phase A sums (brief f119-punisher-field rev 1). node scripts/f119-punisher-field/sum.mjs <probe dir> [<record dir>] [<time dir>]
// Each dir holds the ai-script out/ (or local *.jsonl/*.txt files of JSON lines; "-" skips one). Only games that finished
// are read. Errors are BY GAME (a by-game jackknife: the deal is the unit), paired where two readings are on the same boards.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [probeDir, recordDir, timeDir] = process.argv.slice(2).map(x => (x === '-' ? undefined : x));
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
  for (const f of files) for (const l of readFileSync(f, 'utf8').split('\n')) if (l.startsWith('{')) try { rows.push(JSON.parse(l)); } catch { /* a cut line */ }
  return rows;
}
const mean = a => (a.length ? a.reduce((n, v) => n + v, 0) / a.length : NaN);
const sum = a => a.reduce((n, v) => n + v, 0);
const f2 = x => (Number.isFinite(x) ? x.toFixed(2) : String(x));
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const gk = r => `${r.pool}:${r.seed}`;
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
const ARMS = ['base', 'U', 'UG'];
const TITLE = { '30065': 'Retribution', '35066': 'IP Enforcement', '35065': 'Bigger Picture', '34045': 'Mindscaping', '30068': 'Orbital Superiority', '34049': 'Oracle Thinktank', '30056': 'Predictive Planogram', '35058': 'Synapse Global', '34037': 'Greasing the Palm', '36044': 'Unleash' };
const tt = c => TITLE[c.replace('?', '')] + (c.endsWith('?') ? ' (installed)' : '');
const lines = [];
const say = (...x) => lines.push(x.join(' '));
const num = x => (typeof x === 'number' ? x : x === 'Inf' ? Infinity : x === '-Inf' ? -Infinity : NaN);

// ================================================================ probe
const R = rowsOf(probeDir);
const done = new Set(R.filter(r => r.kind === 'g').map(gk));
const Gm = R.filter(r => r.kind === 'g' && r.pool !== 'people');
const U = R.filter(r => r.kind === 'u' && !r.error && done.has(gk(r)));
const C = R.filter(r => r.kind === 'c' && !r.error && done.has(gk(r)) && r.pool !== 'people');
const errs = R.filter(r => r.error || r.kind === 'err');
if (R.length) {
  say(`# Probe: games ${Gm.length} (match the batch record: ${Gm.filter(g => g.matchesBatch).length}), Runner turn starts read ${U.length} (tagged ${U.filter(u => u.tags > 0).length}), tagged Corp turns read ${C.length}, errors ${errs.length}`);
  for (const e of errs.slice(0, 5)) say(`  error ${e.pool}:${e.seed ?? e.src} ${String(e.error).slice(0, 200)}`);
  const unmatched = Gm.filter(g => g.matchesBatch === false).map(gk);
  if (unmatched.length) say(`  games that differ from the batch record: ${unmatched.slice(0, 20).join(' ')}`);
  const gOf = new Map(Gm.map(g => [gk(g), g]));
  // ---------------- step 2
  say('\n## Step 2: where the cards are');
  for (const pool of POOLS) {
    const g = P(Gm, pool);
    const decks = new Map();
    for (const x of g) decks.set(x.corpDeck, x.deck);
    const field = g.filter(x => x.deck.filled.length);
    const gain = g.filter(x => x.deck.gain);
    say(`\n### ${pool}: ${g.length} games`);
    say(`  UNITS (tagged Runner turn starts, step 3's unit): all decks ${sum(g.map(x => x.taggedRunnerStarts))}; FIELD decks ${sum(field.map(x => x.taggedRunnerStarts))} in ${field.length} games; GAIN decks ${sum(gain.map(x => x.taggedRunnerStarts))} in ${gain.length} games`);
    say('  decks holding each filled card (games):');
    for (const code of Object.keys(TITLE)) {
      const ds = [...decks].filter(([, d]) => d.filled.includes(code)).map(([k]) => `${k} (${g.filter(x => x.corpDeck === k).length})`);
      if (ds.length) say(`    ${TITLE[code]}: ${ds.join(', ')}`);
    }
    const c = P(C, pool);
    say(`  tagged Corp turns read: ${c.length} (all decks); with each card usable (Corp's view, the gate by from):`);
    const byCard = {};
    for (const r of c) for (const u of r.usable) byCard[u] = (byCard[u] ?? 0) + 1;
    say(`    ${Object.entries(byCard).map(([k, n]) => `${tt(k)} ${n}`).join(', ') || 'none'}`);
    const orbGate = c.filter(r => r.cand.some(x => x.code === '30068')).length;
    say(`    an installed Orbital Superiority the Corp can finish this turn (its candidate): ${orbGate}`);
    const ip = c.filter(r => r.ipCan !== null);
    say(`  IP Enforcement in HQ on tagged Corp turns: ${ip.length}; with an agenda it could take at the tags held: ${ip.filter(r => r.ipCan).length}`);
    const uses = {};
    for (const x of g) for (const u of x.uses) {
      const k = `${u.line}:${u.card}`;
      uses[k] = uses[k] ?? { n: 0, swing: 0, kills: 0, ip: [], gr: [] };
      uses[k].n++;
      uses[k].swing += u.swing;
      if (u.kill) uses[k].kills++;
      if (u.ipPoints !== undefined) uses[k].ip.push(u.ipPoints);
      if (u.greasedType) uses[k].gr.push(u.greasedType);
    }
    say('  plays with a tag (the record set\'s rule), source games:');
    for (const [k, v] of Object.entries(uses).sort()) say(`    ${k}: ${v.n} (mean swing ${f2(v.swing / v.n)}${v.kills ? `, kills ${v.kills}` : ''}${v.ip.length ? `, agenda points taken ${v.ip.join(',')}` : ''}${v.gr.length ? `, counter on ${v.gr.join(',')}` : ''})`);
  }
  // ---------------- share of the per-turn input that is the use part
  say('\n## The use part\'s share of the per-turn input, tagged Runner turn starts (base: the punisher and identity terms)');
  for (const pool of POOLS) {
    const u = P(U, pool).filter(r => r.tags > 0);
    for (const v of ['c', 'r']) say(`  ${pool} ${v === 'c' ? "Corp's view" : "Runner's view"} (${u.length}): ${ARMS.map(a => `${a} ${pct(sum(u.map(r => r[a][v].use)), sum(u.map(r => r[a][v].perTurn)))} (mean input ${f2(mean(u.map(r => r[a][v].perTurn)))})`).join('; ')}`);
  }
  // ---------------- step 4
  say('\n## Step 4: the damage overlap (D1, approximation 8), U+G, tagged boards of decks with Mindscaping or Orbital');
  for (const pool of POOLS) {
    const u = P(U, pool).filter(r => r.tags > 0 && r.v18 !== undefined);
    if (!u.length) {
      say(`  ${pool}: no such boards`);
      continue;
    }
    const dmg = r => sum(r.candC.filter(x => x.code === '34045' || x.code === '30068').map(x => x.p * x.swing));
    const both = u.filter(r => r.v18 > 0.005 && dmg(r) > 0.005);
    say(`  ${pool}: ${u.length} boards; V18's term for the two cards ${f2(mean(u.map(r => r.v18)))} (> 0 on ${u.filter(r => r.v18 > 0.005).length}); the clock's damage read ${f2(mean(u.map(dmg)))} (> 0 on ${u.filter(r => dmg(r) > 0.005).length}); BOTH (the flatline step read twice) on ${both.length}`);
    for (const [lo, hi] of [[0, 2], [3, 4], [5, 99]]) {
      const a = u.filter(r => r.grip >= lo && r.grip <= hi);
      if (a.length) say(`    grip ${lo}-${hi === 99 ? '+' : hi} (${a.length}): V18 ${f2(mean(a.map(r => r.v18)))}, clock ${f2(mean(a.map(dmg)))}, both on ${a.filter(r => r.v18 > 0.005 && dmg(r) > 0.005).length}`);
    }
  }
  for (const pool of POOLS) {
    const u = P(U, pool).filter(r => r.tags > 0 && r.orbitalInstalled > 0);
    const scored = r => (gOf.get(gk(r))?.orbitalScores ?? []).some(o => o.T > r.T && o.T <= r.T + 1);
    say(`  ${pool} installed Orbital boards (tagged Runner turn starts): ${u.length}; the Corp-view gate passes ${u.filter(r => r.candC.some(x => x.code === '30068')).length}; Runner-view odds mean ${f2(mean(u.map(r => sum(r.candR.filter(x => x.code === '30068').map(x => x.p)))))}; scored on the next Corp turn ${u.filter(scored).length} (tagged then: ${u.filter(r => (gOf.get(gk(r))?.orbitalScores ?? []).some(o => o.T > r.T && o.T <= r.T + 1 && o.tags > 0)).length})`);
  }
  // ---------------- step 5 a
  say("\n## Step 5 a: the Runner's tagCost at Runner turn starts, base / U / U+G, by Corp deck (Orbital decks marked *)");
  for (const pool of POOLS) {
    const u = P(U, pool);
    say(`  ${pool} (${u.length}): ${ARMS.map(a => f2(mean(u.map(r => r[a].nextR)))).join(' / ')}`);
    for (const dk of [...new Set(u.map(r => r.corpDeck))].sort()) {
      const a = u.filter(r => r.corpDeck === dk);
      const orb = gOf.get(gk(a[0]))?.deck.filled.includes('30068') ? '*' : '';
      say(`    ${dk}${orb} (${a.length}): ${ARMS.map(x => f2(mean(a.map(r => r[x].nextR)))).join(' / ')}`);
    }
  }
  // ---------------- step 5 c: direction
  say('\n## Step 5 c: the direction table (by Corp deck; 0.25 line): the Corp-view price of the next tag and the Runner-view tagCost, base / U / U+G');
  for (const pool of POOLS) {
    const u = P(U, pool);
    for (const dk of [...new Set(u.map(r => r.corpDeck))].sort()) {
      const a = u.filter(r => r.corpDeck === dk);
      const m = (arm, k) => mean(a.map(r => r[arm][k]));
      const dir = (arm, k, up, down) => (m(arm, k) - m('base', k) >= 0.25 ? up : m(arm, k) - m('base', k) <= -0.25 ? down : 'did not move');
      say(`  ${pool} | ${dk} | ${a.length} | Corp ${ARMS.map(x => f2(m(x, 'nextC'))).join(' / ')} | U: ${dir('U', 'nextC', 'may give fewer tags', 'may give more tags')}; U+G: ${dir('UG', 'nextC', 'may give fewer tags', 'may give more tags')} | Runner ${ARMS.map(x => f2(m(x, 'nextR'))).join(' / ')} | U: ${dir('U', 'nextR', 'may clear sooner', 'may clear later')}; U+G: ${dir('UG', 'nextR', 'may clear sooner', 'may clear later')}`);
    }
  }
  // ---------------- step 6
  say('\n## Step 6: identities (counts that must be 0), every probe board at tags 0 to 5 and Infinity');
  const id = U.map(r => r.id);
  say(`  corpTurnDamage through the field against today's (Mindscaping, Orbital): ${sum(id.map(x => x.dmg))} differences over ${id.length * 14} reads`);
  say(`  pendingFreeRezzes against today's: ${sum(id.map(x => x.free))}; Retribution's hand plan payoff against today's: ${sum(id.map(x => x.ret))}; does or spends not finite at Infinity: ${sum(id.map(x => x.inf))}`);
  const bp = id.flatMap(x => x.bp);
  say(`  Bigger Picture's payoff (moves by design), old / new by tags: ${[1, 2, 3].map(t => `${t} tag ${f2(mean(bp.filter(b => b[0] === t).map(b => b[2])))} / ${f2(mean(bp.filter(b => b[0] === t).map(b => b[3])))}`).join('; ')} (${bp.length / 3} boards)`);
  for (const [lo, hi] of [[0, 4], [5, 9], [10, 99]]) {
    const a = bp.filter(b => b[1] >= lo && b[1] <= hi && b[0] === 1);
    if (a.length) say(`    Runner credits ${lo}-${hi === 99 ? '+' : hi} (${a.length}), 1 tag: old ${f2(mean(a.map(b => b[2])))}, new ${f2(mean(a.map(b => b[3])))}`);
  }
  // ---------------- step 7
  say("\n## Step 7: the hand plan and the clock (base play), Retribution / Bigger Picture / IP Enforcement in HQ, tagged");
  for (const pool of POOLS) {
    for (const [name, rows] of [["Corp's turn", P(C, pool)], ["Runner's turn", P(U, pool).filter(r => r.tags > 0)]]) {
      const by = {};
      for (const r of rows) for (const [card, v] of Object.entries(r.hand ?? {})) {
        by[card] = by[card] ?? { n: 0, plan: [], planH: [], clock: [], both: 0 };
        by[card].n++;
        if (v.plan !== null) by[card].plan.push(v.plan);
        if (v.planH !== null) by[card].planH.push(v.planH);
        by[card].clock.push(v.clock);
        if ((v.plan ?? 0) > 0.005 && v.clock > 0.005) by[card].both++;
      }
      for (const [card, v] of Object.entries(by)) say(`  ${pool} ${name} ${card} (${v.n} boards): hand plan ${f2(mean(v.plan))} (H ${f2(mean(v.planH))}), clock's use term (U) ${f2(mean(v.clock))}, both > 0 on ${v.both}`);
    }
    // per chance: a take usable on a tagged Corp turn, and played that turn
    const c = P(C, pool);
    for (const code of ['30065', '35065', '35066', '34045']) {
      const ch = c.filter(r => r.usable.includes(code));
      if (!ch.length) continue;
      const played = ch.filter(r => (gOf.get(gk(r))?.uses ?? []).some(u => u.card === TITLE[code] && u.T === r.T && u.active === 'corp'));
      // S's bar (ruling-redteam.md "Rev 1, ruled" item 4): the take counted in both the clock's use term and its hand plan this turn
      const bothNow = ch.filter(r => (r.hand?.[TITLE[code]]?.plan ?? 0) > 0.005 && r.cand.some(x => x.code === code)).length;
      say(`  ${pool} ${TITLE[code]}: usable on ${ch.length} tagged Corp turns, played on ${played.length} (${pct(played.length, ch.length)}); in both the hand plan and the clock's use term on ${bothNow} (${pct(bothNow, ch.length)}; S's line: more than 1 in 10)`);
    }
  }
}

// ================================================================ record (step 3)
const RR = rowsOf(recordDir);
if (RR.length) {
  const done2 = new Set(RR.filter(r => r.kind === 'g').map(gk));
  const units = RR.filter(r => r.kind === 'u' && done2.has(gk(r)) && !r.beside.error);
  const legsOk = u => u.legs.filter(l => !l.error);
  const swingOf = (u, pred) => mean(legsOk(u).map(l => sum(l.uses.filter(pred).map(x => x.swing ?? 0))));
  for (const u of units) {
    u.recU = swingOf(u, x => x.line === 'trash' || x.line === 'take');
    u.recUG = swingOf(u, x => x.line === 'trash' || x.line === 'take' || x.line === 'gain');
    u.recTrash = swingOf(u, x => x.line === 'trash');
    u.recTake = swingOf(u, x => x.line === 'take');
    u.recGain = swingOf(u, x => x.line === 'gain');
  }
  say(`\n# Record (step 3): units ${units.length} in ${done2.size} games, leg errors ${units.reduce((n, u) => n + u.legs.filter(l => l.error).length, 0)}, unit read errors ${RR.filter(r => r.kind === 'u' && r.beside.error).length}`);
  const gapD = (arm, rec) => us => {
    const decks = [...new Set(us.map(u => u.corpDeck))];
    let n = 0;
    let s = 0;
    for (const dk of decks) {
      const a = us.filter(u => u.corpDeck === dk);
      n += a.length;
      s += a.length * Math.abs(mean(a.map(u => u.beside[arm].c.perTurn - u[rec])));
    }
    return s / n;
  };
  for (const pool of POOLS) {
    const p = P(units, pool);
    const field = p.filter(u => u.deck.filled.length);
    const gain = p.filter(u => u.deck.gain);
    say(`\n## ${pool}: ${p.length} units; field decks ${field.length} units in ${new Set(field.map(gk)).size} games; gain decks ${gain.length} units`);
    for (const [label, set] of [['all decks', p], ['field decks', field]]) {
      if (!set.length) continue;
      say(`  ${label}, the clock's lines under U (trash, take):`);
      for (const arm of ARMS) {
        const j = jack(set, gapD(arm, 'recU'));
        const sg = jack(set, us => mean(us.map(u => u.beside[arm].c.perTurn - u.recU)));
        say(`    ${arm}: weighted |deck mean gap| ${js(j)}; signed ${f2(sg.v)} ± ${f2(sg.se)}; mean input ${f2(mean(set.map(u => u.beside[arm].c.perTurn)))}, clock ${f2(mean(set.map(u => u.beside[arm].c.clock)))}`);
      }
      const dj = jack(set, us => gapD('U', 'recU')(us) - gapD('base', 'recU')(us));
      say(`    U BAR: U less base, paired by game: ${js(dj)} -> ${dj.v < -2 * dj.se ? 'U below base by more than two SE' : dj.v > dj.se ? 'U WORSE by more than one SE' : 'within noise'}`);
      say(`    record per unit: trash ${f2(mean(set.map(u => u.recTrash)))}, take ${f2(mean(set.map(u => u.recTake)))}, gain ${f2(mean(set.map(u => u.recGain)))}`);
    }
    if (gain.length) {
      say(`  gain decks (${gain.length} units), the clock's lines under U+G (trash, take, gain):`);
      for (const arm of ARMS) {
        const j = jack(gain, gapD(arm, 'recUG'));
        say(`    ${arm}: weighted |deck mean gap| ${js(j)}; signed ${f2(mean(gain.map(u => u.beside[arm].c.perTurn - u.recUG)))}`);
      }
      const dj = jack(gain, us => gapD('UG', 'recUG')(us) - gapD('U', 'recUG')(us));
      say(`    G BAR: U+G less U, paired by game: ${js(dj)} -> ${dj.v < -2 * dj.se ? 'U+G closer by more than two SE' : dj.v > dj.se ? 'U+G WORSE by more than one SE' : 'within noise'}${gain.length < 30 ? ' (UNDER 30 UNITS: reported, the coordinator rules)' : ''}`);
    }
    say('  by deck: units, record (U lines / U+G lines), signed gap U lines base / U, U+G lines U / U+G:');
    for (const dk of [...new Set(p.map(u => u.corpDeck))].sort()) {
      const a = p.filter(u => u.corpDeck === dk);
      if (!a[0].deck.filled.length) continue;
      say(`    ${dk} (${a.length}): ${f2(mean(a.map(u => u.recU)))} / ${f2(mean(a.map(u => u.recUG)))}; ${['base', 'U'].map(arm => f2(mean(a.map(u => u.beside[arm].c.perTurn - u.recU)))).join(' / ')}; ${['U', 'UG'].map(arm => f2(mean(a.map(u => u.beside[arm].c.perTurn - u.recUG)))).join(' / ')}`);
    }
    const by = {};
    for (const u of p) for (const l of legsOk(u)) for (const x of l.uses) {
      const k = `${x.line}:${x.card}`;
      by[k] = by[k] ?? { n: 0, swing: 0, drop: 0, gain: 0, wo: 0, kill: 0 };
      by[k].n++;
      by[k].swing += x.swing;
      by[k].drop += x.drop;
      by[k].gain += x.gain;
      by[k].wo += x.without ?? 0;
      if (x.kill) by[k].kill++;
    }
    say(`  uses in the legs by line and card (n, mean swing, drop, gain, without): ${Object.entries(by).sort().map(([k, v]) => `${k} ${v.n} (${f2(v.swing / v.n)}, ${f2(v.drop / v.n)}, ${f2(v.gain / v.n)}, ${f2(v.wo / v.n)}${v.kill ? `, kills ${v.kill}` : ''})`).join('; ')}`);
  }
}

// ================================================================ time (step 8)
const TR = rowsOf(timeDir).filter(r => r.kind === 'time');
if (TR.length) {
  say(`\n# Time (step 8): ${TR.length} deals, ${sum(TR.map(r => r.decisions))} decisions`);
  const kinds = [...new Set(TR.flatMap(r => Object.keys(r.n)).filter(k => !k.endsWith('tagged')))].sort();
  const ms = (a, k) => sum(TR.map(r => r.ms[`${a} ${k}`] ?? 0));
  say('  per caller kind: decisions; ms base / ctl / off / U+G; U+G against off (same tree); ctl against base (the noise)');
  for (const k of kinds) {
    const n = sum(TR.map(r => r.n[k] ?? 0));
    say(`    ${k}: ${n}; ${['base', 'ctl', 'off', 'UG'].map(a => (ms(a, k) / 1000).toFixed(1) + ' s').join(' / ')}; ${f2((100 * ms('UG', k)) / ms('off', k) - 100)}%; ${f2((100 * ms('ctl', k)) / ms('base', k) - 100)}%`);
  }
  const differ = {};
  for (const r of TR) for (const [k, v] of Object.entries(r.differ)) differ[k] = (differ[k] ?? 0) + v;
  say(`  answers that differ from base: ${Object.entries(differ).sort().map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const work = {};
  for (const r of TR) for (const [k, v] of Object.entries(r.work)) {
    const kk = k.replace(/ (corp|runner):\w+$/, '');
    work[kk] = (work[kk] ?? 0) + v;
  }
  say(`  work on the patched tree (all kinds): ${Object.entries(work).sort().map(([k, v]) => `${k} ${f2(v)}`).join(', ')}`);
  const clockUG = work['clock UG'] ?? 0;
  if (clockUG) say(`  per clock price on U+G: use-part work-outs ${f2(sum(Object.entries(work).filter(([k]) => k.startsWith('miss') && k.endsWith('UG')).map(([, v]) => v)) / clockUG)}, damageWorth ${f2((work['damageWorth UG'] ?? 0) / clockUG)}, agendaWorth ${f2((work['agendaWorth UG'] ?? 0) / clockUG)}; hand plan (tagUseHandWorth) ${f2(work['hand UG'] ?? 0)} calls, ${f2((work['handMs UG'] ?? 0) / 1000)} s`);
}
console.log(lines.join('\n'));
void num;
