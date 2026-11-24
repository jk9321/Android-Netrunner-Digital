// R-A A-log: sums facts-log.ts output into the note's tables (brief a-log.md rev 2, reading rules 1 to 6).
// Rewritten from Gemini's draft: every table names its unit, the number that met the fact and the number that differ.
//   node scripts/runner-rework/facts-log-sum.mjs <dir or files...>   (every *.txt / *.jsonl under a dir is read)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
const walk = p => {
  if (statSync(p).isDirectory()) for (const f of readdirSync(p)) walk(join(p, f));
  else if (/\.(txt|jsonl)$/.test(p)) files.push(p);
};
for (const a of process.argv.slice(2)) walk(a);
const L = [];
for (const f of files)
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      L.push(JSON.parse(line));
    } catch {
      /* a cut line */
    }
  }

// Pools as reported: self-play (batch), the NRDB pool, people split by who ran, the issue games
const poolOf = x => (x.pool === 'human' ? x.sk : x.pool === 'batch' ? 'self' : x.pool);
const POOLS = ['self', 'nrdb', 'humanRunner', 'humanCorp', 'issues'];
const PEOPLE = new Set(['humanRunner', 'humanCorp', 'issues']); // the issue games are people's games too (Jeff's reports #58, #59)
const p = s => console.log(s);
const fmt = v => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : JSON.stringify(v));
const ex = (x, extra) => `${x.src} T${x.T}${extra ? ': ' + extra : ''}`;

/** One table: per pool the number that met, the number that differ, the kinds, three examples; reading rules 2 and 3. */
function table(title, unit, rows) {
  // rows: { pool, met: boolean, diff: boolean, kind, example }
  p(`\n### ${title}\nUnit: ${unit}. Columns: met (the fact was read), differ (the readings disagree), by kind; "not shown" under 10 met; "thin" under 10 people's.`);
  p('| Pool | met | differ | kinds (count) |\n|---|---:|---:|---|');
  const kinds = new Map();
  for (const pool of POOLS) {
    const r = rows.filter(x => x.pool === pool);
    const met = r.filter(x => x.met).length;
    const d = r.filter(x => x.diff);
    const byKind = new Map();
    for (const x of d) {
      byKind.set(x.kind, (byKind.get(x.kind) ?? 0) + 1);
      const k = kinds.get(x.kind) ?? [];
      if (k.length < 3 && !k.some(e => e.includes(`${x.example.split(' ')[0]} `))) k.push(`${pool} ${x.example}`);
      kinds.set(x.kind, k);
    }
    const note = met < 10 ? ' (not shown)' : PEOPLE.has(pool) && d.length > 0 && d.length < 10 ? ' (thin)' : '';
    const ks = [...byKind.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${n}`)
      .join('; ');
    if (met || d.length) p(`| ${pool} | ${met} | ${d.length}${note} | ${ks.slice(0, 900)} |`);
  }
  if (kinds.size) {
    p('\nExamples (up to three a kind):');
    for (const [k, e] of kinds) p(`- **${k}**: ${e.join(' | ')}`);
  }
}

const boards = L.filter(x => x.kind === 'b');
const runStarts = L.filter(x => x.kind === 'r');
const runs = L.filter(x => x.kind === 'run');
const runKey = x => `${x.src}|${x.T}|${x.n}`;
const runOf = new Map(runs.map(x => [runKey(x), x]));

// ---------------------------------------------------------------- sources
p('## Sources');
const g = L.filter(x => x.kind === 'g');
for (const pool of ['batch', 'nrdb']) {
  const r = g.filter(x => x.pool === pool);
  p(
    `- ${pool}: ${r.length} games, ${r.filter(x => x.matchesBatch).length} match the batch record (winner, cr, sc)${
      r.filter(x => !x.matchesBatch).length
        ? '; MISMATCH: ' +
          r
            .filter(x => !x.matchesBatch)
            .map(x => x.src)
            .join(', ')
        : ''
    }`
  );
}
const h = L.filter(x => x.kind === 'h');
p(
  `- people/issues: ${h.length} files; stopped: ${
    h
      .filter(x => x.stopped)
      .map(x => `${x.src} (${x.stopped})`)
      .join('; ') || 'none'
  }`
);
p('\n| Pool | turn-start boards | run-start boards | runs | turn-end boards with a used flag |\n|---|---:|---:|---:|---:|');
for (const pool of POOLS)
  p(
    `| ${pool} | ${boards.filter(x => poolOf(x) === pool).length} | ${runStarts.filter(x => poolOf(x) === pool).length} | ${runs.filter(x => poolOf(x) === pool).length} | ${L.filter(x => x.kind === 'te' && poolOf(x) === pool).length} |`
  );

// Met in play by case code (games where a measured board held it where a reader reads it)
p('\n### Cases met (games with a measured board holding the card where a reader reads it; boards in brackets)');
const metBy = new Map();
for (const x of [...boards, ...runStarts])
  for (const c of x.met ?? []) {
    const m = metBy.get(c) ?? Object.fromEntries(POOLS.map(q => [q, { games: new Set(), boards: 0 }]));
    m[poolOf(x)].games.add(x.src);
    m[poolOf(x)].boards++;
    metBy.set(c, m);
  }
p(`| Code | ${POOLS.join(' | ')} |\n|---|${POOLS.map(() => '---:').join('|')}|`);
for (const [c, m] of [...metBy.entries()].sort()) p(`| ${c} | ${POOLS.map(q => `${m[q].games.size} (${m[q].boards})`).join(' | ')} |`);

// ---------------------------------------------------------------- L1, L2, L4
const subRows = (field, metField, kindOf) =>
  boards.flatMap(b => {
    const pool = poolOf(b);
    const diffs = (b[field] ?? []).map(d => ({
      pool,
      met: true,
      diff: true,
      kind: kindOf(d),
      example: ex(b, `${d.code} #${d.i} "${d.label}" ${JSON.stringify({ ...d, label: undefined, ice: undefined })}`),
    }));
    const same = Math.max(0, (b[metField] ?? 0) - diffs.length);
    return [...diffs, ...Array.from({ length: same }, () => ({ pool, met: true, diff: false }))];
  });
table(
  'L1. This subroutine ends the run (five encodings)',
  'one fact-reading = (turn-start board, rezzed or Runner-known ice, subroutine); kind = blocks/factsAlways/factsAny/hasEtr/literal as 1 or 0, then the label',
  subRows('l1', 'l1Met', d => `${d.e} "${d.label}"`)
);
table(
  'L2. The damage a subroutine does',
  'one fact-reading = (turn-start board, ice, subroutine) where any reader reads damage above 0; readings: subroutineDamage / SUB_RULES first rule / subroutineFacts',
  subRows('l2', 'l2Met', d => `"${d.label}" sub ${d.sub} rules ${d.rules} facts ${d.facts}`)
);
table(
  'L4. "Or end the run" choices',
  'one fact-reading = (turn-start board, subroutine with an "or end the run"); the Runner\'s price (5 with a program, BLOCK without) against the walk (the end)',
  subRows('l4', 'l4Met', d => `program ${d.program}: price ${d.price}, walk ends ${d.walkEnds}`)
);

// ---------------------------------------------------------------- L3
p(
  '\n### L3. The seven cards\nUnit: one fact-reading = (turn-start board, card on the board). Per card: met; the fact read alike (factSame false = differ as a fact); the number each reader gets.'
);
p('| Card | Pool | met | differ as a fact | differ as a number | example readings |\n|---|---|---:|---:|---:|---|');
const seven = boards.flatMap(b => (b.seven ?? []).map(r => ({ ...r, pool: poolOf(b), b })));
for (const code of [...new Set(seven.map(r => r.code))].sort())
  for (const pool of POOLS) {
    const r = seven.filter(x => x.code === code && x.pool === pool);
    if (!r.length) continue;
    const fact = r.filter(x => x.factSame === false).length;
    const num = r.filter(x => x.numSame === false).length;
    const e = r.find(x => x.factSame === false || x.numSame === false) ?? r[0];
    p(`| ${code} | ${pool} | ${r.length}${r.length < 10 ? ' (not shown)' : ''} | ${fact} | ${num} | ${ex(e.b, `walk ${fmt(e.walk)}; runner ${fmt(e.runner)}`).slice(0, 300)} |`);
  }

// ---------------------------------------------------------------- L5
const l5 = boards.flatMap(b =>
  (b.unrez ?? []).map(u => ({
    pool: poolOf(b),
    met: true,
    diff: u.kind !== 'sameCredits',
    kind: `${u.known ? 'known (same view)' : 'unknown (by construction)'}: ${u.kind}`,
    example: ex(b, `${u.code} flat ${u.flat} + risk ${u.risk} v exact ${u.exact} (+${u.exactValue})`),
  }))
);
table(
  'L5. An unrezzed ice',
  "one fact-reading = (turn-start board, unrezzed ice); the Runner's flat credits (and unrezzedDamageRisk) against the ice as the walk meets it (HIDDEN-READ, rezzed when the Corp can pay); split: the Runner knows it or not",
  l5
);

// ---------------------------------------------------------------- L6
const l6 = boards.map(b => {
  const m = b.money;
  const split = m.gripMoneyCards === 0 ? 'no money card in grip' : 'money cards in grip (by construction)';
  const kind = m.runBudget === m.walk ? 'same' : m.walk > m.runBudget ? 'walk more (runnerEarnings)' : 'runScore more (run-only credits)';
  return {
    pool: poolOf(b),
    met: true,
    diff: m.runBudget !== m.walk,
    kind: `${split}: ${kind}${m.locked ? ' [pool lock card]' : ''}`,
    example: ex(b, `credits ${m.credits}, runBudget ${m.runBudget}, walk ${m.walk}, iceStop flat ${m.iceStopFlat}, grip money ${m.gripMoney}`),
  };
});
table(
  "L6. The Runner's money over the turn",
  "one board = a turn-start board; runScore's budget (runBudget) against the walk's (runnerBudget over the rest of the turn); iceStop's flat 4 a turn in the examples",
  l6
);

// ---------------------------------------------------------------- L7
const l7 = boards.flatMap(b =>
  (b.runBegin ?? []).map(r => ({
    pool: poolOf(b),
    met: true,
    diff: r.runnerReads === 'nothing',
    kind: `${r.code} ${r.field}: walk ${fmt(r.walk)}, runner reads ${r.runnerReads}`,
    example: ex(b, `run-only credits over credits ${r.runBudgetOver}`),
  }))
);
table(
  'L7. Cards that act as a run begins or are paid by a run',
  "one fact-reading = (turn-start board, rig card with runBeginCredits, firstRunTrashForCost or counterCredits); the entry's fact against what the Runner's run price reads",
  l7
);

// ---------------------------------------------------------------- L8
const l8 = boards.flatMap(b =>
  (b.servers ?? [])
    .filter(s => s.l8)
    .map(s => ({
      pool: poolOf(b),
      met: true,
      diff: !s.l8.same,
      kind: s.l8.same ? 'same' : s.l8.walk.length > s.l8.runner.length ? 'walk bypasses more' : s.l8.walk.length < s.l8.runner.length ? 'runner bypasses more' : 'different ice',
      example: ex(b, `${s.id}: runner ${JSON.stringify(s.l8.runner)} walk ${JSON.stringify(s.l8.walk)} set ${JSON.stringify(s.l8.walkSet)}`),
    }))
);
table(
  'L8. A rig bypass',
  "one fact-reading = (turn-start board, server) where either side bypasses an ice; runBypasses on the board against runBypasses on the walk's rez set's board",
  l8
);

// ---------------------------------------------------------------- L9
function l9Rows(list, where) {
  return list.flatMap(x => {
    const srv = where === 'turn start' ? (x.servers ?? []).filter(s => s.l9).map(s => ({ id: s.id, l9: s.l9 })) : x.l9 ? [{ id: x.server, l9: x.l9 }] : [];
    return srv.map(s => {
      const d = s.l9.runner === s.l9.holds;
      const e = s.l9.explain ?? {};
      const named = Object.keys(e).filter(k => e[k]);
      const kind = !d
        ? 'agree'
        : `${s.l9.runner ? 'Runner in, walk holds' : 'Runner out, walk does not hold'}; explained by ${named.length ? named.join('+') : 'NONE (unexplained)'}`;
      return {
        pool: poolOf(x),
        met: true,
        diff: d,
        kind,
        l9: s.l9,
        server: s.id,
        x,
        example: ex(x, `${s.id}: runner ${s.l9.why} (known ${s.l9.known} of ${s.l9.budget}); walk need ${s.l9.need} of ${s.l9.walkBudget}, set ${JSON.stringify(s.l9.walkSet)}`),
      };
    });
  });
}
const l9t = l9Rows(boards, 'turn start');
const l9r = l9Rows(runStarts, 'run start');
table(
  'L9 at turn start. Can the Runner get into this server this turn (feasibility both sides)',
  'one fact-reading = (turn-start board, server), every identity public, the walk given the grip money; a difference is explained by a policy only if removing it alone makes the two agree',
  l9t
);
table('L9 at run start', "one fact-reading = (run-start board, the run's server)", l9r);
p('\n#### L9: each policy difference alone (counts of differing fact-readings it explains; a reading may be explained by more than one)');
p('| Pool | where | differ | unrezzed flat | rez choice | money | unexplained |\n|---|---|---:|---:|---:|---:|---:|');
for (const [where, rows] of [
  ['turn start', l9t],
  ['run start', l9r],
])
  for (const pool of POOLS) {
    const d = rows.filter(r => r.pool === pool && r.diff);
    if (!d.length) continue;
    const c = k => d.filter(r => r.l9.explain?.[k]).length;
    p(`| ${pool} | ${where} | ${d.length} | ${c('unrezzedFlat')} | ${c('rezChoice')} | ${c('money')} | ${d.filter(r => r.l9.unexplained).length} |`);
  }
p('\n#### L9 unexplained, every one');
for (const r of [...l9t, ...l9r].filter(r => r.diff && r.l9.unexplained)) p(`- ${r.pool} ${r.example}`);

// Count 3's kinds, on feasibility (A, B, B2, C, D, E), with the outcome of the turn (turn start) or the run (run start)
p("\n#### L9 with count 3's kinds (feasibility in place of runScore's worth)");
const gotIn = new Map(); // src|T|server -> 'in' | 'failed'
for (const r of runs) {
  const k = `${r.src}|${r.T}|${r.server}`;
  if (r.ended === 'successful') gotIn.set(k, 'in');
  else if (!gotIn.has(k)) gotIn.set(k, 'failed');
}
const kindsOf = (r, outcome) => {
  const ks = [];
  if (!r.l9.runner && outcome === 'in') ks.push('A');
  if (r.l9.holds && outcome === 'in') ks.push('B');
  if (!r.l9.holds && outcome === 'failed') ks.push('B2');
  if (r.l9.runner && outcome === 'failed') ks.push('C');
  if (r.l9.runner && r.l9.holds) ks.push(`D:${outcome ?? 'not run'}`);
  if (!r.l9.runner && !r.l9.holds) ks.push(`E:${outcome ?? 'not run'}`);
  return ks;
};
p('| Pool | where | A | B | B2 | C | D not run / failed / in | E not run / failed / in |\n|---|---|---:|---:|---:|---:|---|---|');
for (const [where, rows] of [
  ['turn start', l9t],
  ['run start', l9r],
])
  for (const pool of POOLS) {
    const c = new Map();
    for (const r of rows.filter(x => x.pool === pool)) {
      const outcome = where === 'turn start' ? gotIn.get(`${r.x.src}|${r.x.T}|${r.server}`) : runOf.get(runKey(r.x))?.ended === 'successful' ? 'in' : 'failed';
      for (const k of kindsOf(r, outcome)) c.set(k, (c.get(k) ?? 0) + 1);
    }
    if (!c.size) continue;
    const g2 = k => c.get(k) ?? 0;
    p(
      `| ${pool} | ${where} | ${g2('A')} | ${g2('B')} | ${g2('B2')} | ${g2('C')} | ${g2('D:not run')} / ${g2('D:failed')} / ${g2('D:in')} | ${g2('E:not run')} / ${g2('E:failed')} / ${g2('E:in')} |`
    );
  }

// ---------------------------------------------------------------- L10
p(
  "\n### L10. Once-per-turn uses at turn end\nUnit: one fact-reading = (turn-end board, a used flag on a Runner card). Readers: the walk's nextTurnBoard (once: forms), runs.ts (Malandragem's once:<inst>:0), runnerEarnings (no flag: from the rest of the turn it still counts a spent once-per-turn click use)."
);
p('| Card | flag written | pools (count) | nextTurnBoard sees it | runs.ts sees it | runnerEarnings counts the spent use |\n|---|---|---|---|---|---|');
const te = L.filter(x => x.kind === 'te').flatMap(x => x.rows.map(r => ({ ...r, pool: poolOf(x) })));
const byFlag = new Map();
for (const r of te) {
  const k = `${r.code}|${r.flag}`;
  const e = byFlag.get(k) ?? { r, pools: {} };
  e.pools[r.pool] = (e.pools[r.pool] ?? 0) + 1;
  byFlag.set(k, e);
}
for (const [, e] of byFlag)
  p(
    `| ${e.r.code} | ${e.r.flag} | ${Object.entries(e.pools)
      .map(([a, b]) => `${a} ${b}`)
      .join(', ')} | ${e.r.holdSees} | ${e.r.runsSees} | ${e.r.clickMoneyOnce ? e.r.earningsCounts : 'no clickMoney'} |`
  );

// ---------------------------------------------------------------- L12
const l12 = boards.flatMap(b =>
  (b.myco ?? []).map(m => ({
    pool: poolOf(b),
    met: true,
    diff: !m.same,
    kind: `${m.subtype}: ${m.derezzedLender ? 'a lender the walk derezzes at its start' : JSON.stringify(m.engine) !== JSON.stringify(m.runner) ? 'engine and Runner differ' : 'runner and walk differ'}`,
    example: ex(b, `engine ${JSON.stringify(m.engine)} runner ${JSON.stringify(m.runner)} walk ${JSON.stringify(m.walk)}`),
  }))
);
table(
  "L12. Mycoweb's lenders",
  "one fact-reading = (turn-start board, rezzed Mycoweb, its borrow subtype); the card's text as the engine reads it against the Runner's borrowedSubroutines and the walk's lenders at its start",
  l12
);

// ---------------------------------------------------------------- L13
p(
  "\n### L13. Clicks spent on bioroids along a run (issue #59)\nUnit: one fact-reading = (board, server) where the Runner's price passes some rezzed bioroid by its clicks; `sum` the clicks the price assumes, `after` the clicks after the run's click."
);
p('| Pool | where | met (sum > 0) | sum > after | of those, price finite | runs made on such boards: successful / jacked out / ended |\n|---|---|---:|---:|---:|---|');
for (const pool of POOLS) {
  const t = boards.filter(b => poolOf(b) === pool).flatMap(b => (b.servers ?? []).map(s => s.l13).filter(x => x && x.sum > 0));
  if (t.length) p(`| ${pool} | turn start | ${t.length} | ${t.filter(x => x.over).length} | ${t.filter(x => x.over && x.scoreFinite).length} | |`);
  const r = runs.filter(x => poolOf(x) === pool && x.l13 && x.l13.sum > 0);
  if (r.length) {
    const over = r.filter(x => x.l13.over);
    const e = k => over.filter(x => x.ended === k).length;
    p(`| ${pool} | run start | ${r.length} | ${over.length} | ${over.filter(x => x.l13.scoreFinite).length} | ${e('successful')} / ${e('jackedOut')} / ${e('ended')} |`);
  }
}
p('\nExamples (sum > after, price finite):');
for (const x of runs.filter(x => x.l13?.over && x.l13.scoreFinite).slice(0, 6))
  p(`- ${poolOf(x)} ${x.src} T${x.T} ${x.server}: sum ${x.l13.sum} > ${x.l13.after}, runScore ${x.l13.score}, ${x.bioroidBreaks} bioroid breaks, ${x.ended}`);

// ---------------------------------------------------------------- L14
p(
  "\n### L14. The trash the run was priced for against the trash at the access (issue #58)\nUnit: one fact-reading = (run, known installed card whose trash the run's price included). Offered = the access asked; declined by cause (credits: the prompt offered no paid trash; costOnTrash: trashing it on a copy gave a tag, damage or a further loss; other)."
);
p('| Pool | priced | offered | trashed | declined: credits / costOnTrash / other | declined cards (code count) |\n|---|---:|---:|---:|---|---|');
for (const pool of POOLS) {
  const c = runs.filter(x => poolOf(x) === pool).flatMap(x => (x.l14 ?? []).map(y => ({ ...y, run: x })));
  if (!c.length) continue;
  const off = c.filter(y => y.offered);
  const dec = off.filter(y => !y.trashed);
  const by = k => dec.filter(y => y.cause === k).length;
  const cards = new Map();
  for (const y of dec) cards.set(`${y.code} ${y.cause}`, (cards.get(`${y.code} ${y.cause}`) ?? 0) + 1);
  p(
    `| ${pool} | ${c.length} | ${off.length} | ${off.length - dec.length} | ${by('credits')} / ${by('costOnTrash')} / ${by('other')} | ${[...cards.entries()].map(([k, n]) => `${k} ${n}`).join('; ')} |`
  );
}
p('\nDeclined cards afterwards (first decline to the end of the game or until it left the server):');
p('| Pool | cards | declined again | accessed again | credits it paid the Corp (its log lines) |\n|---|---:|---:|---:|---:|');
for (const pool of POOLS) {
  const d = L.filter(x => x.kind === 'declined' && poolOf(x) === pool);
  if (d.length) p(`| ${pool} | ${d.length} | ${d.reduce((n, x) => n + x.declines - 1, 0)} | ${d.reduce((n, x) => n + x.reaccess, 0)} | ${d.reduce((n, x) => n + x.paid, 0)} |`);
}
p('\nExamples:');
for (const x of L.filter(x => x.kind === 'declined').slice(0, 8))
  p(`- ${poolOf(x)} ${x.src} ${x.title} (${x.code}) on ${x.server} from T${Math.floor(x.T)}: declined ${x.declines}, accessed again ${x.reaccess}, paid ${x.paid}`);

// The coordinator's two asks (17:15Z)
p("\n#### L14: what evaluate loses to the trash's tag, split (declined for a cost on trash that is a tag)\nEach part: evaluate after the trash against the same board with the tags as before; payoutWait = the change when the tagged payout risk is set to the untagged one; tagsWorth = its own change in evaluate (it enters twice: -2 x); other = the rest. trash-keep = the access answer's own difference.");
p('| Pool | game | turn | card | total | payoutWait | tagsWorth | other | trash - keep |\n|---|---|---|---|---:|---:|---:|---:|---:|');
for (const x of runs)
  for (const y of x.l14 ?? [])
    if (y.tagSplit) p(`| ${poolOf(x)} | ${x.src} | ${x.T} | ${y.code} | ${y.tagSplit.total} | ${y.tagSplit.payoutWait} | ${y.tagSplit.tagsWorth} | ${y.tagSplit.other} | ${y.tagSplit.trashMinusKeep} |`);
p("\n#### L13: on runs where the bioroid clicks exceed the clicks and the price is finite, the Runner's other moves ranked above 0");
p('| Pool | game | turn | server | ended | runs rank score | other moves above 0 | best other |\n|---|---|---|---|---|---:|---:|---|');
for (const x of runs.filter(x => x.l13?.alternatives))
  p(`| ${poolOf(x)} | ${x.src} | ${x.T} | ${x.server} | ${x.ended} | ${x.l13.alternatives.runScore} | ${x.l13.alternatives.othersAbove0} | ${x.l13.alternatives.best ? `${x.l13.alternatives.best.a} ${x.l13.alternatives.best.score}` : 'none'} |`);
