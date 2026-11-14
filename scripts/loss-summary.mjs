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
  // Symptom alarms (alarms.ts): patterns a human would punish, whoever won. Each example names the deal and turn to dump for a test
  const alarmed = games.flatMap(g => (g.alarms ?? []).map(a => ({ ...a, g })));
  if (alarmed.length) {
    console.log(`ALARMS (per 100 games; dump a position: SEED=<deal> DUMP_TURN=<turn> DUMP_SIDE=<side> DUMP_FILE=x.json corp-losses.ts):`);
    const kinds = [...new Set(alarmed.map(a => a.kind))].sort();
    for (const kind of kinds) {
      const list = alarmed.filter(a => a.kind === kind);
      const inGames = new Set(list.map(a => a.g)).size;
      console.log(`  ${kind}: ${((100 * list.length) / Math.max(games.length, 1)).toFixed(1)} (${list.length} in ${inGames} games)`);
      const byDeck = new Map();
      for (const a of list) {
        const deck = a.side === 'corp' ? a.g.corpDeck : a.g.runnerDeck;
        byDeck.set(deck, (byDeck.get(deck) ?? 0) + 1);
      }
      const details = new Map();
      for (const a of list) if (a.detail) details.set(a.detail, (details.get(a.detail) ?? 0) + 1);
      if (details.size) console.log(`    really: ${[...details].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d} ${n}`).join(', ')}`);
      console.log(`    most: ${[...byDeck].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d, n]) => `${d} ${n}`).join(', ')}`);
      for (const a of list.slice(0, 3)) console.log(`    deal ${a.g.seed} ${a.g.corpDeck} vs ${a.g.runnerDeck}, turn ${a.turn} ${a.side}: ${a.note}`);
    }
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
      // Phase 2 E0: the bank at each Corp turn start (records from before E0 have none)
      const starts = list.flatMap(g => g.money.creditsAtTurnStart ?? []);
      if (starts.length) console.log(`  credits at start of turn ${(starts.reduce((a, b) => a + b, 0) / starts.length).toFixed(1)}; turn starts under 3 credits ${pct(starts.filter(c => c < 3).length, starts.length)}`);
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
  if (games[0]?.spend) printSpendAudit(games);

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

/** The first spend table of a summary is printed in full; later ones (the weak-deck sections) only by kind */
let spendTables = 0;

/**
 * Phase 2 S, the spend audit (spec-phase2.md; spend-audit.ts says what each kind's "bought nothing" means): every
 * Corp credit spent, by kind and outcome, per Corp turn, in Corp losses vs wins.
 */
export function printSpendAudit(games) {
  const full = spendTables++ === 0;
  const groups = [['losses', games.filter(g => g.winner === 'runner')], ['wins', games.filter(g => g.winner === 'corp')], ['all', games]];
  const turnsOf = list => Math.max(1, list.reduce((n, g) => n + g.spend.corpTurns, 0));
  const items = list => list.flatMap(g => g.spend.items);
  const f2 = x => x.toFixed(2);
  const pc = (x, n) => `${((100 * x) / Math.max(n, 1)).toFixed(0)}%`;
  const KINDS = ['rez ice in a run', 'rez ice', 'rez asset/upgrade', 'advance', 'install ice', 'operation', "runner's turn", 'ability', 'trash resource'];
  const kinds = [...new Set([...KINDS, ...items(games).map(i => i[0])])].filter(k => items(games).some(i => i[0] === k));
  console.log('SPEND AUDIT (Corp credits spent per Corp turn, and the share that bought nothing; operations gross; see scripts/spend-audit.ts):');
  console.log(`  ${'kind'.padEnd(20)} ${groups.map(([l, list]) => `${l} (${list.length} games)`.padEnd(30)).join('')}`);
  const row = (label, test) => {
    const cells = groups.map(([, list]) => {
      const its = items(list).filter(test);
      const cr = its.reduce((n, i) => n + i[1], 0);
      const wasted = its.filter(i => i[3]).reduce((n, i) => n + i[1], 0);
      const t = turnsOf(list);
      return `${f2(cr / t)}/turn, nothing ${f2(wasted / t)} (${pc(wasted, cr)})`.padEnd(30);
    });
    console.log(`  ${label.padEnd(20)} ${cells.join('')}`);
  };
  for (const k of kinds) row(k, i => i[0] === k);
  row('all but income ops', i => !(i[0] === 'operation' && i[2] === 'income'));
  row('all', () => true);
  // Top three "bought nothing" kinds, by credits per Corp turn
  for (const [label, list] of groups.slice(0, 2)) {
    const t = turnsOf(list);
    const m = new Map();
    for (const i of items(list)) if (i[3]) m.set(i[0], (m.get(i[0]) ?? 0) + i[1]);
    console.log(`  top "bought nothing" in ${label}: ${[...m].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${f2(v / t)}`).join(', ')}`);
  }
  if (!full) return;
  // Outcomes by kind
  const table = (title, test, key) => {
    console.log(title);
    const keys = [...new Set(items(games).filter(test).map(key))];
    const totals = groups.map(([, list]) => items(list).filter(test).reduce((n, i) => n + i[1], 0));
    const lines = keys.map(k => {
      const per = groups.map(([, list], gi) => {
        const its = items(list).filter(i => test(i) && key(i) === k);
        const cr = its.reduce((n, i) => n + i[1], 0);
        return { cr, n: its.length, t: turnsOf(list), total: totals[gi] };
      });
      return { k, per };
    });
    for (const { k, per } of lines.sort((a, b) => b.per[2].cr - a.per[2].cr)) {
      console.log(`    ${k.padEnd(44)} ${per.map(p => `${f2(p.cr / p.t)} (${pc(p.cr, p.total)}, n ${p.n})`.padEnd(24)).join('')}`);
    }
  };
  console.log(`  outcomes (credits per Corp turn, share of the kind's credits, count): columns ${groups.map(g => g[0]).join(' | ')}`);
  for (const k of ['rez ice in a run', 'rez ice', 'rez asset/upgrade', 'advance', 'install ice', 'operation']) {
    if (!kinds.includes(k)) continue;
    table(`  ${k}, by outcome:`, i => i[0] === k, i => i[2]);
  }
  table('  rez ice (in a run or not), by the ice\'s life and the server\'s stake when rezzed:', i => i[0] === 'rez ice in a run' || i[0] === 'rez ice', i => i[4]);
  table('  install ice, by whether the server was ever run while it stood:', i => i[0] === 'install ice', i => `${i[2]}, ${i[4]}`);
  // By card: operations, assets/upgrades, non-agenda advances, other paid things
  const byCard = (title, test) => {
    const m = new Map();
    for (const [gi, [, list]] of groups.slice(0, 2).entries()) for (const i of items(list).filter(test)) {
      const e = m.get(i[4]) ?? { n: [0, 0], cr: [0, 0], nothing: [0, 0], outcomes: new Map() };
      e.n[gi]++;
      e.cr[gi] += i[1];
      if (i[3]) e.nothing[gi] += i[1];
      e.outcomes.set(i[2], (e.outcomes.get(i[2]) ?? 0) + 1);
      m.set(i[4], e);
    }
    console.log(`${title} (losses | wins: count, credits, bought nothing; outcomes over all)`);
    for (const [k, e] of [...m].sort((a, b) => b[1].nothing[0] + b[1].nothing[1] - a[1].nothing[0] - a[1].nothing[1] || b[1].cr[0] + b[1].cr[1] - a[1].cr[0] - a[1].cr[1]).slice(0, 15)) {
      console.log(`    ${k}: ${e.n[0]}, ${e.cr[0]} cr, nothing ${e.nothing[0]} | ${e.n[1]}, ${e.cr[1]} cr, nothing ${e.nothing[1]}; ${[...e.outcomes].sort((a, b) => b[1] - a[1]).map(([o, n]) => `${o} ${n}`).join(', ')}`);
    }
  };
  byCard('  operations by card', i => i[0] === 'operation');
  byCard('  assets/upgrades rezzed, by card', i => i[0] === 'rez asset/upgrade');
  byCard('  advances, by card', i => i[0] === 'advance');
  byCard("  Runner's-turn costs, paid abilities and resource trashes, by card", i => ["runner's turn", 'ability', 'trash resource'].includes(i[0]));
}
