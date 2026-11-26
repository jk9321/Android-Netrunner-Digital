// B3 step 0: sums step0.ts's lines (brief runner-rework/briefs/b3-prompt-view.md rev 2, step 0.2 to 0.5). Pools apart.
//   node scripts/runner-rework/b3/step0-sum.mjs <shard output files...>
import { readFileSync } from 'node:fs';

const lines = process.argv.slice(2).flatMap(f => readFileSync(f, 'utf8').split('\n')).filter(l => l.startsWith('{')).map(l => JSON.parse(l));
const ARMS = ['in1', 'capA', 'capC'];
const pools = [...new Set(lines.filter(l => l.pool).map(l => l.pool))];
const inc = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const deal = l => l.src;
const se = xs => {
  if (xs.length < 2) return NaN;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1) / xs.length);
};
const f2 = x => (Number.isFinite(x) ? x.toFixed(2) : '-');
console.log(`errors: ${lines.filter(l => l.kind === 'err').length}; shards: ${lines.filter(l => l.kind === 's').length}`);
for (const e of lines.filter(l => l.kind === 'err').slice(0, 10)) console.log('  err', e.src, e.T, e.e);

for (const pool of pools) {
  const L = lines.filter(l => l.pool === pool);
  const games = L.filter(l => l.kind === 'g');
  console.log(`\n================ pool ${pool}: games ${games.length}, matching the batch record ${games.filter(g => g.matchesBatch).length}, with a trojan in the Runner's deck ${games.filter(g => g.trojanDeck).length}`);

  // 0.2
  const pc = new Map();
  for (const l of L.filter(l => l.kind === 'pc')) for (const [k, n] of Object.entries(l.counts)) inc(pc, k, n);
  const byBranch = new Map();
  for (const [k, n] of pc) inc(byBranch, k.split(' | ').slice(2).join(' | '), n);
  console.log(`\n0.2 Runner prompts the deciding Runner answers, by branch | run: ${[...byBranch].map(([k, n]) => `${k} ${n}`).join('; ')}`);
  console.log('  real-state answers by kind | source:step | branch | run:');
  for (const [k, n] of [...pc].filter(([k]) => k.includes('real:')).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${k}`);
  const P = L.filter(l => l.kind === 'p');
  const byLabel = new Map();
  for (const p of P) {
    const k = `${p.label} | ${p.inRun}`;
    if (!byLabel.has(k)) byLabel.set(k, []);
    byLabel.get(k).push(p);
  }
  console.log('  per kind: n, deals; classes; today: honest view answer illegal / differs / stable on 12 deals; capA: the same');
  for (const [k, ps] of byLabel) {
    const cls = {};
    for (const p of ps) for (const [c, n] of Object.entries(p.classes)) cls[c] = (cls[c] ?? 0) + n;
    const part = arm => {
      const h = ps.map(p => p.honest[arm]);
      return `illegal ${h.filter(x => !x.legal).length}, differs ${h.filter(x => x.differs).length} (deals ${new Set(ps.filter(p => p.honest[arm].differs).map(deal)).size}), stable ${h.filter(x => Object.keys(x.deals).length === 1).length}`;
    };
    console.log(`    ${k}: n ${ps.length}, deals ${new Set(ps.map(deal)).size}${ps.length < 10 ? ' (under 10: listed, not a rate)' : ''}; ${JSON.stringify(cls)}; today ${part('today')}; capA ${part('capA')}`);
    if (ps.length < 10) for (const p of ps) console.log(`        ${p.src} T${p.T}: played ${p.today}; view ${p.honest.today.answer} ${JSON.stringify(p.honest.today.deals)}; capA ${p.honest.capA.answer} ${JSON.stringify(p.honest.capA.deals)}`);
  }

  // 0.3 host prompts
  const H = L.filter(l => l.kind === 'hp');
  console.log(`\n0.3 host prompts answered by the deciding Runner: ${H.length} in ${new Set(H.map(deal)).size} deals; in a run ${H.filter(h => h.inRun).length}`);
  const eff = new Map();
  for (const h of H) inc(eff, `${h.effect} -> ${h.card}${h.inRun ? ' (in a run)' : ''}`);
  console.log(`  by effect: ${[...eff].map(([k, n]) => `${k} ${n}`).join('; ')}`);
  for (const arm of ['today', ...ARMS]) {
    const moved = H.filter(h => arm !== 'today' && h.picks[arm] !== h.picks.today);
    const second = H.filter(h => h.second[arm]);
    const tie = H.filter(h => h.tiedTop[arm] > 1);
    const tieCopy = H.filter(h => {
      const r = h.arms[arm].real.hosts;
      const top = Math.max(...r.map(x => (typeof x.score === 'number' ? x.score : -Infinity)));
      const tied = r.filter(x => typeof x.score === 'number' && Math.abs(x.score - top) <= 1e-9).map(x => h.hosts.find(y => y.id === x.id));
      return tied.some(t => t.same > 0) && tied.some(t => t.same === 0);
    });
    console.log(`  ${arm.padEnd(5)}: picks moved from today ${moved.length} (deals ${new Set(moved.map(deal)).size}); second copy on a host while an empty one is offered ${second.length}; top tied ${tie.length}, of which a tie between a host holding a copy and one holding none ${tieCopy.length}`);
  }
  console.log('  each host prompt (src T effect: hosts as id/server/rezzed|facedown/known/what it hosts; picks today in1 capA capC; real-state board term cw per host today | capA):');
  for (const h of H) {
    const hosts = h.hosts.map(x => `${x.id}/${x.server}/${x.rezzed ? 'R' : 'F'}${x.known ? 'k' : ''}/${x.hosts.join('+') || '-'}`).join(' ');
    const cw = arm => h.arms[arm].real.hosts.map(x => x.cw).join(',');
    console.log(`    ${h.src} T${h.T} ${h.effect}${h.inRun ? ' [run]' : ''}: ${hosts}; picks ${['today', ...ARMS].map(a => h.picks[a]).join(' ')}; cw ${cw('today')} | ${cw('capA')}; view pick today ${h.arms.today.view.pick} capA ${h.arms.capA.view.pick}`);
  }

  // 0.3 install-or-hold boards
  const I = L.filter(l => l.kind === 'ia');
  console.log(`\n0.3 deciding-Runner boards with a legal trojan install on ice: ${I.length} in ${new Set(I.map(deal)).size} deals`);
  for (const arm of ARMS) {
    const first = I.filter(i => i.arms[arm].first !== i.arms.today.first);
    const enter = first.filter(i => i.arms[arm].trojan && i.arms[arm].trojan.rank === 1);
    const leave = first.filter(i => i.arms.today.trojan && i.arms.today.trojan.rank === 1);
    const pick = I.filter(i => i.arms[arm].pick !== i.arms.today.pick);
    const host = I.filter(i => i.arms[arm].trojan && i.arms.today.trojan && i.arms[arm].trojan.action !== i.arms.today.trojan.action);
    console.log(`  ${arm}: first place moved ${first.length} (a trojan install enters ${enter.length}, leaves ${leave.length}); pick moved ${pick.length} (deals ${new Set(pick.map(deal)).size}); the best trojan install's host moved ${host.length}`);
  }
  for (const i of I.filter(i => i.moves.length)) console.log(`    ${i.src} T${i.T} c${i.clicks} $${i.credits}: today first ${i.arms.today.first} pick ${i.arms.today.pick} trojan ${JSON.stringify(i.arms.today.trojan)}; ${ARMS.map(a => `${a} first ${i.arms[a].first} pick ${i.arms[a].pick} trojan ${i.arms[a].trojan?.action}#${i.arms[a].trojan?.rank}`).join('; ')}`);

  // 0.3 reply Runner
  const R = L.filter(l => l.kind === 'rh');
  console.log(`\n0.3 reply Runner host choices (sampled: the first main-phase Corp decision each turn, trojan decks): ${R.length} (prompts ${R.filter(r => r.what === 'prompt').length}, rankings ${R.filter(r => r.what === 'rank').length}) in ${new Set(R.map(deal)).size} deals`);
  for (const arm of ARMS) {
    const m = R.filter(r => r.moves.includes(arm));
    console.log(`  ${arm}: moved ${m.length} (prompts ${m.filter(r => r.what === 'prompt').length}, rankings: first place ${m.filter(r => r.what === 'rank' && r.arms[arm].first !== r.arms.today.first).length}, trojan's host or rank ${m.filter(r => r.what === 'rank' && r.arms[arm].first === r.arms.today.first).length})`);
  }

  // 0.4 played on
  const PO = L.filter(l => l.kind === 'po');
  console.log(`\n0.4 played on: boards ${PO.length} (host ${PO.filter(p => p.what === 'host').length}, install ${PO.filter(p => p.what === 'install').length}) in ${new Set(PO.map(deal)).size} deals; three Runner turns, seeds per arm ${Math.max(0, ...PO.flatMap(p => p.res.map(r => (r.k ?? 0) + 1)))}`);
  const measures = [
    ['broke', 'subroutines the trojan broke on runs through its host (more is better)'],
    ['paid', 'credits paid on runs through a host (less is better)'],
    ['inside', 'runs through a host that got in (more is better)'],
    ['hostRuns', 'runs through a host'],
    ['runs', 'runs'],
    ['installs', 'trojan installs'],
  ];
  for (const what of ['host', 'install']) {
    for (const arm of ARMS) {
      const boards = PO.filter(p => p.what === what && p.arms.includes(arm));
      if (!boards.length) continue;
      const deals = [...new Set(boards.map(deal))];
      console.log(`  ${what} boards, ${arm} - today, by deal (n deals ${deals.length}${deals.length < 10 ? ': under 10, decides nothing; read the boards as play' : ''}):`);
      for (const [m, label] of measures) {
        const diffs = deals.map(d => {
          const bs = boards.filter(b => deal(b) === d);
          const mean = (a, rs) => {
            const xs = rs.filter(r => r.arm === a && !r.err).map(r => r[m]);
            return xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : NaN;
          };
          const per = bs.map(b => mean(arm, b.res) - mean('today', b.res)).filter(Number.isFinite);
          return per.length ? per.reduce((x, y) => x + y, 0) / per.length : NaN;
        }).filter(Number.isFinite);
        const mu = diffs.length ? diffs.reduce((x, y) => x + y, 0) / diffs.length : NaN;
        console.log(`    ${label}: ${f2(mu)} ± ${f2(se(diffs))}`);
      }
      for (const b of boards) {
        const sum = a => {
          const rs = b.res.filter(r => r.arm === a && !r.err);
          return `${a}: broke ${rs.map(r => r.broke).join('/')} paid ${rs.map(r => r.paid).join('/')} in ${rs.map(r => `${r.inside}of${r.hostRuns}`).join('/')} installs ${rs.map(r => r.installs).join('/')}`;
        };
        console.log(`      ${b.src} T${b.T}: ${sum('today')} | ${sum(arm)}`);
      }
    }
  }

  // 0.5 time
  const tm = new Map();
  for (const l of L.filter(l => l.kind === 'tm')) for (const [k, v] of Object.entries(l.ms)) inc(tm, k, v);
  const kinds = [...new Set([...tm.keys()].map(k => k.split(':')[0]))];
  console.log('\n0.5 time (ms summed; arm / today):');
  for (const k of kinds) console.log(`  ${k}: today ${tm.get(`${k}:today`) ?? '-'}; ${ARMS.map(a => `${a} ${tm.get(`${k}:${a}`) ?? '-'} (${f2((tm.get(`${k}:${a}`) ?? NaN) / (tm.get(`${k}:today`) ?? NaN))})`).join('; ')}`);
}
