// Prints the Corp loss breakdown for game records from lossLog.ts.

/** Prints how the games ended and where the Runner's points came from. */
export function printLossSummary(all, detail = !!process.env.DETAIL) {
  // Crashed games and value loops (valueModel.ts guardLoop) are listed first, to be fixed
  const crashed = all.filter(g => g.crashed);
  const games = all.filter(g => !g.crashed);
  if (crashed.length) {
    console.log(`CRASHED GAMES: ${crashed.length}`);
    for (const g of crashed.slice(0, 10)) console.log(`  deal ${g.seed} ${g.corpDeck} vs ${g.runnerDeck}: ${g.crashed}`);
  }
  const loops = new Map();
  for (const g of games) for (const [chain, n] of Object.entries(g.loops ?? {})) loops.set(chain.replace(/ inst-\d+| @\d+/g, ''), (loops.get(chain.replace(/ inst-\d+| @\d+/g, '')) ?? 0) + n);
  if (loops.size) {
    console.log(`VALUE LOOPS (games played on with flat values): ${games.filter(g => g.loops).length} games`);
    for (const [chain, n] of [...loops].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${chain}: ${n}`);
  }
  const pct = (x, n) => `${((100 * x) / Math.max(n, 1)).toFixed(1)}%`;
  const count = (list, key) => list.reduce((m, x) => m.set(key(x), (m.get(key(x)) ?? 0) + 1), new Map());
  const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);
  const avg = (list, f) => (sum(list, f) / Math.max(list.length, 1)).toFixed(1);
  const show = (title, map, n) => {
    console.log(title);
    for (const [k, v] of [...map].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v} (${pct(v, n)})`);
  };

  const n = games.length;
  const losses = games.filter(g => g.winner === 'runner');
  const wins = games.filter(g => g.winner === 'corp');
  console.log(`${n} games: Corp ${pct(wins.length, n)}, Runner ${pct(losses.length, n)}`);
  show('How games end:', count(games, g => `${g.winner} ${g.reason}`), n);

  // Where the Runner's points come from in Corp losses
  const steals = losses.flatMap(g => g.steals);
  const points = steals.reduce((m, s) => m.set(s.from, (m.get(s.from) ?? 0) + s.points), new Map());
  show('Runner points in Corp losses, by server:', points, sum(steals, s => s.points));

  const remote = steals.filter(s => s.from === 'remote');
  console.log(`Remote steals (${remote.length}):`);
  show('  by ice on the server (rezzed/total):', count(remote, s => `${s.rezzedIce}/${s.ice}`), remote.length);
  if (remote[0]?.unrezzed) {
    for (const [label, list] of [['remote', remote], ['R&D', steals.filter(s => s.from === 'rd')], ['HQ', steals.filter(s => s.from === 'hq')]]) {
      console.log(`  unrezzed ice at ${label} steals: ${[...count(list, s => s.unrezzed)].map(([k, v]) => `${k} ${v} (${pct(v, list.length)})`).join(', ')}; broke since: ${[...count(list.filter(s => s.unrezzed === 'broke'), s => s.brokeWhen)].map(([k, v]) => `${k} ${v}`).join(', ')}`);
    const brokeRemote = remote.filter(s => s.unrezzed === 'broke');
    if (label === 'remote') console.log(`    broke remote steals of agendas installed the Corp's last turn: ${brokeRemote.filter(s => s.freshAgenda).length} of ${brokeRemote.length}`);
    }
  }
  console.log(`  already scoreable when stolen: ${remote.filter(s => s.scoreable).length}`);
  console.log(`  advanced at least once: ${remote.filter(s => s.advanced > 0).length}`);
  console.log(`  Corp credits when stolen: avg ${avg(remote, s => s.corpCredits)}`);

  const hq = steals.filter(s => s.from === 'hq');
  console.log(`HQ steals (${hq.length}): avg ${avg(hq, s => s.hqAgendas)} agendas in a ${avg(hq, s => s.hqSize)}-card HQ, ice avg ${avg(hq, s => s.ice)} (${avg(hq, s => s.rezzedIce)} rezzed)`);
  const rd = steals.filter(s => s.from === 'rd');
  console.log(`R&D steals (${rd.length}): ice avg ${avg(rd, s => s.ice)} (${avg(rd, s => s.rezzedIce)} rezzed)`);

  console.log('Corp losses:');
  console.log(`  Corp score at loss: avg ${avg(losses, g => g.corpScore)}; at 5+: ${losses.filter(g => g.corpScore >= 5).length}`);
  console.log(`  game length: avg ${avg(losses, g => g.turns)} turns (Corp wins ${avg(wins, g => g.turns)})`);
  if (games[0]?.board) {
    const b = (list, k) => avg(list, g => g.board[k]);
    for (const [label, list] of [['losses', losses], ['wins', wins]])
      console.log(`  board in Corp ${label} (avg per turn): ${b(list, 'remotes')} remotes, ${b(list, 'icedRemotes')} with ice, ${b(list, 'remoteIce')} remote ice (best remote ${b(list, 'maxRemoteIce')}), HQ ${b(list, 'hqIce')}, R&D ${b(list, 'rdIce')}`);
    console.log(`  remote steals by iced remotes at the time: ${[...count(remote, s => s.icedRemotes)].sort((x, y) => x[0] - y[0]).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
  }
  console.log(`  turns with an agenda in HQ and none in a remote: avg ${avg(losses, g => g.idleAgendaTurns)} (Corp wins ${avg(wins, g => g.idleAgendaTurns)})`);
  console.log(`  agendas still in HQ at the end: avg ${avg(losses, g => g.agendasInHQ)}`);
  if (games[0]?.runs) {
    const r = k => sum(games, g => g.runs[k]);
    console.log(`Runner runs: ${r('total')}; paid to break then failed: ${r('paidAndFailed')} (${pct(r('paidAndFailed'), r('total'))}), ${r('credits')} credits wasted`);
    console.log(`  jacked out before rezzed ice: known at run start ${r('jackOutKnown')}, rezzed during the run ${r('jackOutFresh')}`);
    console.log(`  stopped by ice: known at run start ${r('stoppedKnown')}, rezzed during the run ${r('stoppedFresh')}`);
  }
  if (games[0]?.money) {
    for (const [label, list] of [['losses', losses], ['wins', wins]]) {
      const turns = sum(list, g => g.money.corpTurns);
      const book = key => {
        const m = new Map();
        for (const g of list) for (const [k, v] of Object.entries(g.money[key])) m.set(k, (m.get(k) ?? 0) + v);
        const total = [...m.values()].reduce((a, b) => a + b, 0);
        return `${(total / Math.max(turns, 1)).toFixed(2)}/turn: ` + [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / Math.max(turns, 1)).toFixed(2)}`).join(', ');
      };
      console.log(`Corp money in Corp ${label} (per Corp turn):`);
      console.log(`  spent ${book('spent')}`);
      console.log(`  gained ${book('gained')}`);
      console.log(`  credits at end of turn ${(sum(list, g => g.money.creditsAtTurnEnd) / Math.max(turns, 1)).toFixed(1)}; clicks for a credit ${pct(sum(list, g => g.money.creditClicks), sum(list, g => g.money.clicks))}`);
    }
  }
  if (games[0]?.rootRezzes) {
    const m = new Map();
    for (const g of games) for (const [k, v] of Object.entries(g.rootRezzes)) {
      const e = m.get(k) ?? { run: 0, turn: 0, credits: 0 };
      m.set(k, { run: e.run + v.run, turn: e.turn + v.turn, credits: e.credits + v.credits });
    }
    console.log(`Assets/upgrades rezzed (in a run / on the Corp's turn, credits per game): ` + [...m].sort((a, b) => b[1].credits - a[1].credits).map(([k, v]) => `${k} ${v.run}/${v.turn} ${(v.credits / games.length).toFixed(2)}`).join(', '));
    const b = k => sum(games, g => g.brokeApproaches[k]);
    console.log(`  unrezzed ice approached that the Corp couldn't pay for: ${b('total')}; affordable without asset/upgrade rezzes since its turn began: ${b('rootSpend')}`);
  }
  if (games[0]?.traps) {
    const m = new Map();
    for (const g of games) for (const [k, v] of Object.entries(g.traps)) {
      const e = m.get(k) ?? { installed: 0, accessed: 0 };
      m.set(k, { installed: e.installed + v.installed, accessed: e.accessed + v.accessed });
    }
    const all = [...m.values()].reduce((a, v) => ({ installed: a.installed + v.installed, accessed: a.accessed + v.accessed }), { installed: 0, accessed: 0 });
    console.log(`Traps installed and accessed: all ${all.accessed}/${all.installed} (${pct(all.accessed, all.installed)}); ` + [...m].sort((a, b) => b[1].installed - a[1].installed).map(([k, v]) => `${k} ${v.accessed}/${v.installed}`).join(', '));
  }
  if (games[0]?.assets) {
    const m = new Map();
    for (const g of games) for (const [k, v] of Object.entries(g.assets)) {
      const e = m.get(k) ?? { rezzed: 0, paid: 0, cost: 0, trashed: 0, emptied: 0, atEnd: 0, turns: 0 };
      for (const f of Object.keys(e)) e[f] += v[f];
      m.set(k, e);
    }
    console.log('Money assets (rezzed: credits paid out / rez cost each, Corp turns out, trashed in a run / emptied / still out at the end):');
    for (const [k, v] of [...m].sort((a, b) => b[1].rezzed - a[1].rezzed)) {
      const each = x => (x / Math.max(v.rezzed, 1)).toFixed(1);
      console.log(`  ${k}: ${v.rezzed}: paid ${each(v.paid)} / cost ${each(v.cost)}, ${each(v.turns)} turns, ${pct(v.trashed, v.rezzed)} / ${pct(v.emptied, v.rezzed)} / ${pct(v.atEnd, v.rezzed)}`);
    }
  }
  if (games[0]?.assetRisk) {
    const r = k => sum(games, g => g.assetRisk[k]);
    console.log(`  trash risk per Runner turn: behind ice ${pct(r('icedTrashed'), r('icedTurns'))} of ${r('icedTurns')}, bare ${pct(r('bareTrashed'), r('bareTurns'))} of ${r('bareTurns')}`);
  }
  if (steals[0]?.stopperAt !== undefined) {
    const run = steals.filter(s => s.stopperAt !== undefined && ['remote', 'rd', 'hq'].includes(s.from));
    console.log(`Placement (steals from runs in Corp losses: ${run.length}):`);
    console.log(`  Runner paid to get in: avg ${avg(run, s => s.runnerPaid ?? 0)}; nothing ${run.filter(s => !s.runnerPaid).length}, 1-3 ${run.filter(s => s.runnerPaid >= 1 && s.runnerPaid <= 3).length}, 4+ ${run.filter(s => s.runnerPaid >= 4).length}`);
    show('  ice that would have stopped them:', count(run, s => s.stopperAt), run.length);
    for (const from of ['remote', 'rd', 'hq']) {
      const list = run.filter(s => s.from === from);
      console.log(`    ${from}: ${[...count(list, s => s.stopperAt)].map(([k, v]) => `${k} ${v}`).join(', ')}`);
    }
    const broke = run.filter(s => s.unrezzed === 'broke');
    console.log(`  broke steals where a rez on a low-value server in the last 2 turns would have paid for the ice: ${broke.filter(s => s.savedRezWouldCover).length} of ${broke.length}`);
  }
  if (games[0]?.early) {
    for (const turn of [1, 2]) {
      const e = games.flatMap(g => g.early).filter(x => x.turn === turn);
      const bare = e.filter(x => x.rdIce === 0 || x.hqIce === 0);
      console.log(`Runner's turn ${turn} (${e.length} games): R&D bare ${pct(e.filter(x => x.rdIce === 0).length, e.length)}, HQ bare ${pct(e.filter(x => x.hqIce === 0).length, e.length)}, ice on remotes avg ${avg(e, x => x.remoteIce)}`);
      console.log(`  with a bare central: ${bare.length}; Corp held ice ${bare.filter(x => x.iceInHand > 0).length}, ice it could rez ${bare.filter(x => x.cheapIceInHand > 0).length}; credits avg ${avg(bare, x => x.credits)}; HQ agendas avg ${avg(bare, x => x.hqAgendas)}`);
    }
  }
  if (games[0]?.rezzes) {
    const r = k => sum(games, g => g.rezzes[k]);
    console.log(`Rezzes in runs (all games): ${r('total')} (${r('credits')} credits); on low-value servers ${r('low')} (${pct(r('low'), r('total'))}), ${r('lowCredits')} credits (${pct(r('lowCredits'), r('credits'))})`);
  }
  show('  most stolen agendas:', count(steals, s => s.title), steals.length);

  if (detail) {
    const decks = new Map();
    for (const g of games) {
      const d = decks.get(g.corpDeck) ?? { n: 0, w: 0 };
      d.n++;
      d.w += g.winner === 'corp' ? 1 : 0;
      decks.set(g.corpDeck, d);
    }
    for (const [name, d] of decks) console.log(`  corp ${name}: ${pct(d.w, d.n)} of ${d.n}`);
  }
}
