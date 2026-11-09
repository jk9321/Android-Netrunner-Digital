// Phase 2 item O: prints the opening audit (O1) and the card value audit (O3) from games carrying an `opening` record
// (scripts/opening-audit.ts). corp-losses-sum.mjs calls it at the end of a batch summary; opening-human.ts prints Jeff's
// games with it. Corp losses vs wins side by side.

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');
const f1 = x => (Number.isFinite(x) ? x.toFixed(1) : '-');
const f2 = x => (Number.isFinite(x) ? x.toFixed(2) : '-');
const mean = (xs, f = x => x) => (xs.length ? xs.reduce((n, x) => n + f(x), 0) / xs.length : NaN);
const CLICK = 1.25;

const groupsOf = (games, human) =>
  human
    ? [['all', games]]
    : [
        ['losses', games.filter(g => g.winner === 'runner')],
        ['wins', games.filter(g => g.winner === 'corp')],
        ['all', games],
      ];

/** Kinds in a fixed order, the rest after */
const ORDER = ['agenda: install', 'agenda: advance', 'agenda: score', 'asset', 'upgrade', 'ice: central', 'ice: remote', 'operation: money', 'operation: other', 'credit click', 'draw', 'advance: asset', 'advance: ice', 'ability', 'rez asset', 'rez upgrade', 'trash resource', 'purge', 'end turn'];
const ordered = counts => [...Object.keys(counts)].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99) || counts[b] - counts[a]);
const tally = list => list.reduce((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});
const mix = (counts, total) => ordered(counts).map(k => `${k} ${pct(counts[k], total)}`).join(', ');

export function printOpeningAudit(all, { human = false, label = 'OPENING AUDIT (Phase 2 O1, scripts/opening-audit.ts)' } = {}) {
  const games = all.filter(g => g.opening && !g.crashed);
  if (!games.length) return;
  console.log('');
  console.log(`${label}: ${games.length} games`);
  const groups = groupsOf(games, human);

  // Firsts: the Corp turn it first did each thing (never: 0)
  console.log('First Corp turn of each (mean over games where it happened; share that never did by turn 6):');
  for (const [name, list] of groups) {
    const first = key => {
      const hit = list.map(g => g.opening[key]).filter(t => t > 0);
      return `${f1(mean(hit))} (none by T6 ${pct(list.filter(g => !(g.opening[key] > 0 && g.opening[key] <= 6)).length, list.length)})`;
    };
    const central = list.filter(g => g.opening.firstIceWhere === 'central').length;
    console.log(`  ${name} (${list.length}): ice ${first('firstIce')}, central first ${pct(central, list.filter(g => g.opening.firstIce).length)}; remote ${first('firstRemote')}; agenda install ${first('firstAgendaInstall')}; advance ${first('firstAdvance')}; score ${first('firstScore')}`);
  }
  // Credits at the start of turns 1-6
  console.log('Credits at the start of Corp turns 1-6 (mean):');
  for (const [name, list] of groups) {
    const row = [0, 1, 2, 3, 4, 5].map(i => f1(mean(list.filter(g => g.opening.startCredits.length > i), g => g.opening.startCredits[i])));
    console.log(`  ${name}: ${row.join(' / ')}`);
  }
  // Click mix on turns 1-3 and 4-6
  console.log('Clicks on Corp turns 1-3 | 4-6, by kind:');
  for (const [name, list] of groups) {
    for (const [span, from, to] of [['T1-3', 0, 3], ['T4-6', 3, 6]]) {
      const kinds = list.flatMap(g => g.opening.clicks.slice(from, to).flat());
      console.log(`  ${name} ${span} (${kinds.length} clicks): ${mix(tally(kinds), kinds.length)}`);
    }
  }

  // Agenda windows: decisions where an agenda move was open in a safe window
  console.log('Agenda windows (a safe advance or agenda install was open; opening-audit.ts windowAt), all turns:');
  for (const [name, list] of groups) {
    const rows = list.flatMap(g => g.opening.windows);
    const turns = list.reduce((n, g) => n + g.opening.corpTurns, 0);
    for (const kind of ['advance', 'install']) {
      const w = rows.filter(r => r[1] === kind);
      const moved = w.filter(r => r[2].startsWith('agenda:'));
      const instead = w.filter(r => !r[2].startsWith('agenda:'));
      const blocked = instead.filter(r => r[4] === -999 || r[4] === null);
      const finite = instead.filter(r => r[4] !== -999 && r[4] !== null);
      const override = instead.filter(r => r[6] === 1);
      console.log(`  ${name} ${kind} windows: ${w.length} (${f2(w.length / Math.max(1, turns))} a Corp turn); agenda move taken ${pct(moved.length, w.length)}`);
      if (!instead.length) continue;
      console.log(`    instead (${instead.length}): ${mix(tally(instead.map(r => r[2])), instead.length)}`);
      console.log(`    of those: every agenda move ruled out by the one-step rules (-Infinity) ${pct(blocked.length, instead.length)}; open but ranked lower ${pct(finite.length, instead.length)} (rule-score gap chosen - best agenda move: mean ${f2(mean(finite, r => r[3] - r[4]))}); planner chose other than the one-step top ${pct(override.length, instead.length)}`);
      if (blocked.length) console.log(`    ruled-out windows by the agenda move that was ruled out: ${mix(tally(blocked.map(r => r[5])), blocked.length)}`);
      if (finite.length) console.log(`    open-but-lower windows, chosen: ${mix(tally(finite.map(r => r[2])), finite.length)}`);
    }
    // Whole turns with a window and no agenda move at all
    const turnRows = new Map();
    list.forEach((g, gi) => g.opening.windows.forEach(r => {
      const key = `${gi}:${r[0]}`;
      const t = turnRows.get(key) ?? { moved: false, kinds: [] };
      if (r[2].startsWith('agenda:')) t.moved = true;
      else t.kinds.push(r[2]);
      turnRows.set(key, t);
    }));
    const idle = [...turnRows.values()].filter(t => !t.moved);
    const kinds = idle.flatMap(t => t.kinds);
    console.log(`  ${name}: Corp turns with a window: ${turnRows.size}; with no agenda move in it ${idle.length} (${pct(idle.length, turnRows.size)}); their window clicks went on: ${mix(tally(kinds), kinds.length)}`);
  }
}

/**
 * O3: per card, the worth the AI gave it when it went in vs what it returned. `worth` is the evaluate delta of the move
 * (the planner leaf's units, credits); `score` the one-step rule score. Realised, in credits where the card's return
 * is credits: assets and upgrades = paid out - rez cost - the install click; operations = returned - paid - the click,
 * with cards drawn listed apart; ice and agendas by their outcomes (no credit price for a stopped run).
 */
export function printValueAudit(all, { human = false, label = 'CARD VALUE AUDIT (Phase 2 O3, scripts/opening-audit.ts)', minN = 10 } = {}) {
  const games = all.filter(g => g.opening && !g.crashed);
  if (!games.length) return;
  const rows = games.flatMap(g => g.opening.values.map(v => ({ ...v, won: g.winner === 'corp' })));
  const by = new Map();
  for (const r of rows) {
    const list = by.get(r.title) ?? [];
    list.push(r);
    by.set(r.title, list);
  }
  console.log('');
  console.log(`${label}: ${rows.length} cards installed or played in ${games.length} games (worth = evaluate delta of the move, score = one-step rule score; Corp win % of games holding it)`);
  const realised = r => {
    if (r.type === 'asset' || r.type === 'upgrade') return (r.out ?? 0) - (r.rez ?? 0) - CLICK;
    if (r.type === 'operation') return (r.out ?? 0) - (r.paid ?? 0) - CLICK;
    return NaN;
  };
  const table = [];
  for (const [title, list] of by) {
    const t = list[0].type;
    const n = list.length;
    const base = { title, type: t, n, worth: mean(list, r => r.worth), score: mean(list.filter(r => Number.isFinite(r.score)), r => r.score), win: list.filter(r => r.won).length / n };
    if (t === 'asset' || t === 'upgrade') {
      const rezzed = list.filter(r => r.rezzed);
      table.push({ ...base, rezzed: rezzed.length / n, rez: mean(rezzed, r => r.rez ?? 0), out: mean(list, r => r.out ?? 0), fired: list.filter(r => r.fired).length / n, real: mean(list, realised) });
    } else if (t === 'operation') {
      table.push({ ...base, paid: mean(list, r => r.paid ?? 0), out: mean(list, r => r.out ?? 0), drew: mean(list, r => r.drew ?? 0), real: mean(list, realised) });
    } else if (t === 'ice') {
      table.push({ ...base, rezzed: list.filter(r => r.rezzed).length / n, stops: mean(list, r => r.stops ?? 0), subs: mean(list, r => r.subs ?? 0), tax: mean(list, r => r.tax ?? 0), nothing: list.filter(r => !r.stops && !r.subs && !r.tax).length / n, central: list.filter(r => r.where === 'central').length / n });
    } else if (t === 'agenda') {
      table.push({ ...base, scored: list.filter(r => r.fate === 'scored').length / n, stolen: list.filter(r => r.fate === 'stolen').length / n });
    }
  }
  const minRows = table.filter(r => r.n >= (human ? 1 : minN));
  const p = x => `${Math.round(100 * x)}%`;
  // Credit-priced cards: the gap worth - realised
  const priced = minRows.filter(r => Number.isFinite(r.real));
  const gapLine = r =>
    `  ${r.title} (${r.type}, ${r.n}): worth ${f2(r.worth)} vs realised ${f2(r.real)} = gap ${f2(r.worth - r.real)}; ` +
    (r.type === 'operation' ? `paid ${f1(r.paid)} back ${f1(r.out)} drew ${f1(r.drew)}` : `rezzed ${p(r.rezzed)}, rez ${f1(r.rez)}, paid out ${f1(r.out)}, fired ${p(r.fired)}`) +
    `; score ${f2(r.score)}; win ${p(r.win)}`;
  console.log(`Overpriced (worth above realised credits), top 10 of ${priced.length} assets/upgrades/operations${human ? '' : ` with ${minN}+ copies`}:`);
  for (const r of [...priced].sort((a, b) => b.worth - b.real - (a.worth - a.real)).slice(0, 10)) console.log(gapLine(r));
  console.log('Underpriced (realised credits above worth), top 10:');
  for (const r of [...priced].sort((a, b) => a.worth - a.real - (b.worth - b.real)).slice(0, 10)) console.log(gapLine(r));
  console.log('  (realised = paid out - rez - 1.25 click; an upgrade or asset that fires without paying credits reads low here: see its fired %)');
  // Families
  const fam = (name, f) => {
    const list = rows.filter(f);
    const real = list.map(realised).filter(Number.isFinite);
    console.log(`  family ${name}: ${list.length} copies, worth ${f2(mean(list, r => r.worth))}, realised ${f2(mean(real))}, fired ${pct(list.filter(r => r.fired).length, list.length)}`);
  };
  console.log('Families (credit-priced):');
  fam('assets', r => r.type === 'asset');
  fam('upgrades', r => r.type === 'upgrade');
  fam('money operations', r => r.type === 'operation' && (r.out ?? 0) > 0);
  fam('other operations', r => r.type === 'operation' && !((r.out ?? 0) > 0));
  // Ice and agendas
  const ice = minRows.filter(r => r.type === 'ice');
  console.log(`Ice (${ice.length}${human ? '' : `, ${minN}+ installs`}), by worth: worth | rezzed | runs ended, subs fired, credits taxed per install | did nothing | on a central`);
  for (const r of [...ice].sort((a, b) => b.worth - a.worth)) console.log(`  ${r.title} (${r.n}): ${f2(r.worth)} | ${p(r.rezzed)} | ${f2(r.stops)}, ${f2(r.subs)}, ${f2(r.tax)} | ${p(r.nothing)} | ${p(r.central)}; score ${f2(r.score)}`);
  const ag = minRows.filter(r => r.type === 'agenda');
  console.log(`Agendas (${ag.length}): worth of the install | scored | stolen`);
  for (const r of [...ag].sort((a, b) => b.n - a.n)) console.log(`  ${r.title} (${r.n}): ${f2(r.worth)} | ${p(r.scored)} | ${p(r.stolen)}; score ${f2(r.score)}`);
  // Every credit-priced card, for the record
  console.log('All assets/upgrades/operations (title, n, worth, realised, fired/drew):');
  for (const r of [...table].filter(r => Number.isFinite(r.real)).sort((a, b) => b.n - a.n)) console.log(`  ${r.title} | ${r.type} | ${r.n} | ${f2(r.worth)} | ${f2(r.real)} | ${r.type === 'operation' ? `drew ${f1(r.drew)}` : `fired ${p(r.fired)}`}`);
}
