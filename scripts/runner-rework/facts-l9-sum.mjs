// The L9 count's tables (brief runner-rework/briefs/l9-residual.md): reads facts-l9.ts lines (one or more files or
// directories of *.txt / *.jsonl) and writes the markdown tables to stdout.
//   node scripts/runner-rework/facts-l9-sum.mjs out/ local-human.jsonl > sum.md
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
const walk = p => {
  if (statSync(p).isDirectory()) for (const f of readdirSync(p)) walk(join(p, f));
  else if (/\.(txt|jsonl)$/.test(p)) files.push(p);
};
for (const a of process.argv.slice(2)) walk(a);
const lines = [];
for (const f of files)
  for (const l of readFileSync(f, 'utf8').split('\n')) {
    if (!l.startsWith('{')) continue;
    try {
      lines.push(JSON.parse(l));
    } catch {
      /* a cut line */
    }
  }

const poolOf = x => (x.pool === 'batch' ? 'self' : x.pool === 'human' ? x.sk : x.pool);
const POOLS = ['self', 'nrdb', 'humanRunner', 'humanCorp', 'issues'];
const AT = ['turnStart', 'runStart'];
const PEOPLE = new Set(['humanRunner', 'humanCorp', 'issues']);
const p = (...a) => console.log(...a);
// The arms' classes (step-0 rulings, 4): f a fact read in two places, q the two questions differ, m the measurement
const CLASS = { retry: 'q', loss: 'q', click: 'm' };
const classOf = arm => CLASS[arm.replace(/[RW]$/, '')] ?? 'f';
const cell = (n, met, pool) => (met < 10 ? 'not shown' : PEOPLE.has(pool) && n > 0 && n < 10 ? `${n} (thin)` : String(n));

// ---- sources and stops
const g = lines.filter(x => x.kind === 'g');
const h = lines.filter(x => x.kind === 'h');
const errs = lines.filter(x => x.kind === 'err');
const boards = lines.filter(x => x.kind === 'b');
const d = lines.filter(x => x.kind === 'd');
p('## Sources');
p('| Pool | games | match the record (winner, cr, sc) | turn-start boards | run-start boards |');
p('|---|---:|---:|---:|---:|');
for (const pool of POOLS) {
  const games = pool === 'self' || pool === 'nrdb' ? g.filter(x => poolOf(x) === pool) : h.filter(x => poolOf(x) === pool);
  const matched = pool === 'self' || pool === 'nrdb' ? String(games.filter(x => x.matchesBatch).length) : 'n/a';
  const b = at => boards.filter(x => poolOf(x) === pool && x.at === at).length;
  p(`| ${pool} | ${games.length} | ${matched} | ${b('turnStart')} | ${b('runStart')} |`);
}
const mism = g.filter(x => !x.matchesBatch).map(x => x.src);
const stopped = h.filter(x => x.stopped).map(x => `${x.src} ${x.stopped}`);
p('');
p(`- Source games that do not match their record: ${mism.length ? mism.join(', ') : 'none'}.`);
p(`- Human files stopped before their last move: ${stopped.length ? stopped.join('; ') : 'none'}.`);
p(`- Reading errors: ${errs.length}${errs.length ? ' (' + errs.slice(0, 5).map(e => `${e.src} T${e.T} ${e.id}: ${e.err}`).join('; ') + ')' : ''}.`);

// ---- the recount
const met = (pool, at) => boards.filter(x => poolOf(x) === pool && x.at === at).reduce((n, x) => n + x.met, 0);
p('');
p('## L9 recount (src tree fd7831eb)');
p('Unit: fact-reading = (board, server). A difference is explained by a policy only if removing it alone makes the two agree; "together": the three removed at once (added, r-b.md "Decided here" 2\'s wording).');
p('| Pool | where | met | differ | unrezzed flat | rez choice | money | unexplained | of those, explained by the three together |');
p('|---|---|---:|---:|---:|---:|---:|---:|---:|');
for (const at of AT)
  for (const pool of POOLS) {
    const m = met(pool, at);
    const dd = d.filter(x => poolOf(x) === pool && x.at === at);
    const c = k => dd.filter(x => x.explain[k]).length;
    const un = dd.filter(x => x.unexplained);
    p(`| ${pool} | ${at} | ${m} | ${cell(dd.length, m, pool)} | ${c('unrezzedFlat')} | ${c('rezChoice')} | ${c('money')} | ${cell(un.length, m, pool)} | ${un.filter(x => x.explain.together).length} |`);
  }
const un = d.filter(x => x.unexplained);
const kindOf = x => `${x.runner ? 'Runner in, walk holds' : `Runner ${x.why}, walk open`}`;
const byKind = {};
for (const x of un) byKind[kindOf(x)] = (byKind[kindOf(x)] ?? 0) + 1;
p('');
p(`Unexplained, all pools: ${un.length}; by the Runner's reading: ${Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join('; ')}.`);

// ---- the arms
const withArms = un.filter(x => x.arms);
const armNames = [...new Set(withArms.flatMap(x => Object.keys(x.arms.alone)))];
const leaks = withArms.filter(x => x.arms.leak.length);
const ctrlBad = withArms.filter(x => x.arms.control.alone || x.arms.control.aside !== !!x.explain.together);
p('');
p('## Stops');
p(`- Control asks (no arm) that do not give the base reading again: ${ctrlBad.length}${ctrlBad.length ? ' (' + ctrlBad.slice(0, 5).map(x => `${x.src} T${x.T} ${x.id}`).join(', ') + ')' : ''}.`);
p(`- An arm that changes a reading on a board where its fact is not present: ${leaks.length}${leaks.length ? ' (' + leaks.slice(0, 8).map(x => `${x.src} T${x.T} ${x.id}: ${x.arms.leak.join(',')}`).join('; ') + ')' : ''}.`);

for (const frame of ['alone', 'aside']) {
  p('');
  p(`## Each arm, frame "${frame}"${frame === 'aside' ? ' (the three policies set aside together first)' : ' (as L9 removed one policy)'}`);
  p('Unit: unexplained fact-reading. "present": the fact differs on the path; "alone": setting it equal alone makes the two agree; "with another": only in a pair (each arm of the pair counted).');
  p(`| Arm | ${AT.flatMap(at => POOLS.map(pl => `${pl} ${at === 'turnStart' ? 'TS' : 'RS'}`)).join(' | ')} |`);
  p(`|---|${AT.flatMap(() => POOLS.map(() => '---:')).join('|')}|`);
  for (const a of armNames) {
    const row = AT.flatMap(at =>
      POOLS.map(pl => {
        const xs = withArms.filter(x => poolOf(x) === pl && x.at === at);
        const pres = xs.filter(x => x.arms.present.includes(a)).length;
        const alone = xs.filter(x => x.arms[frame][a]).length;
        const pair = xs.filter(x => (x.arms[`${frame}Pairs`] ?? []).some(q => q.split('+').includes(a))).length;
        return `${pres} / ${alone} / ${pair}`;
      })
    );
    p(`| ${a} (present / alone / with another) | ${row.join(' | ')} |`);
  }
  // residual
  // Ruling 3: agreement only with three or more arms set equal ("combined") counts as left
  const explained = x => (frame === 'aside' && x.arms.control.aside) || Object.values(x.arms[frame]).some(Boolean) || (x.arms[`${frame}Pairs`] ?? []).length > 0;
  const how = x => {
    if (frame === 'aside' && x.arms.control.aside) return 'policies together';
    const s = Object.entries(x.arms[frame]).filter(([, v]) => v).map(([k]) => k);
    if (s.length) return 'single';
    // pairs below
    if ((x.arms[`${frame}Pairs`] ?? []).length) return 'pair';
    if (x.arms[`${frame}CombinedR`] || x.arms[`${frame}CombinedW`]) return 'combined';
    return 'unexplained';
  };
  p('');
  p(`### Rule 3, frame "${frame}": what is left`);
  // the class of the explanation: a single arm's (any class f/q/m that explains alone; f if an f arm does), a pair's
  const cls = x => {
    const singles = Object.entries(x.arms[frame]).filter(([, v]) => v).map(([k]) => classOf(k));
    if (singles.length) return [...new Set(singles)].sort().join('+');
    const pairs = (x.arms[`${frame}Pairs`] ?? []).map(q => [...new Set(q.split('+').map(classOf))].sort().join('+'));
    return [...new Set(pairs)].sort().join(' | ');
  };
  p('| Pool | where | met | unexplained by L9 | policies together | single arm (by class) | pair (by class) | three or more only (left) | none (left) | left | left / met | rule 3 |');
  p('|---|---|---:|---:|---:|---|---|---:|---:|---:|---:|---|');
  let peopleLeft = 0;
  for (const at of AT)
    for (const pl of POOLS) {
      const m = met(pl, at);
      const xs = withArms.filter(x => poolOf(x) === pl && x.at === at);
      const c = k => xs.filter(x => how(x) === k).length;
      const byCls = k => {
        const t = {};
        for (const x of xs.filter(y => how(y) === k)) t[cls(x)] = (t[cls(x)] ?? 0) + 1;
        const n = xs.filter(y => how(y) === k).length;
        return n ? `${n} (${Object.entries(t).map(([a, b]) => `${a} ${b}`).join(', ')})` : '0';
      };
      const left = c('unexplained') + c('combined');
      if (PEOPLE.has(pl)) peopleLeft += left;
      const share = m ? (100 * left) / m : 0;
      const ok = PEOPLE.has(pl) ? 'summed below' : share <= 0.3 ? 'yes' : 'no';
      p(`| ${pl} | ${at} | ${m} | ${xs.length} | ${frame === 'aside' ? c('policies together') : '-'} | ${byCls('single')} | ${byCls('pair')} | ${c('combined')} | ${c('unexplained')} | ${left} | ${share.toFixed(2)}% | ${ok} |`);
    }
  p('');
  p(`People's boards left (humanRunner + humanCorp + issues, both places, ruling 2): **${peopleLeft}** (rule 3 needs fewer than 10: ${peopleLeft < 10 ? 'met' : 'NOT met'}).`);
  if (frame === 'aside') {
    // Ruling 5: retry and partial are present on every board with ice (retry: every reading)
    const br = {};
    let base = 0;
    for (const x of withArms) {
      if (!Object.values(x.arms.aside).some(Boolean)) continue;
      base++;
      for (const [y, list] of Object.entries(x.arms.asideBreaks ?? {})) br[y] = (br[y] ?? 0) + 1;
    }
    p('');
    p(`Ruling 5: of ${base} readings some arm explains alone (aside), how many a second arm undoes when added: ${['retryW', 'partialR', 'partialW'].map(y => `${y} ${br[y] ?? 0}`).join(', ')}.`);
  }
  const left = withArms.filter(x => !explained(x));
  // kinds: same game, same server on following turns = one kind
  const kinds = [];
  for (const x of [...left].sort((a, b) => (a.src + a.id).localeCompare(b.src + b.id) || a.T - b.T)) {
    const k = kinds[kinds.length - 1];
    if (k && k.src === x.src && k.id === x.id && x.T - k.last <= 1) {
      k.n++;
      k.last = x.T;
    } else kinds.push({ src: x.src, id: x.id, pool: poolOf(x), first: x.T, last: x.T, n: 1, x });
  }
  p('');
  p(`#### Left in frame "${frame}" by kind (same game, same server on following turns = one kind): ${kinds.length} kinds`);
  for (const k of kinds) p(`- ${k.pool} ${k.src} ${k.id} T${k.first}${k.last !== k.first ? '-' + k.last : ''} (${k.n}): runner ${k.x.why}, walk ${k.x.holds ? 'holds' : 'open'} (need ${k.x.need} of ${k.x.walkBudget}); path ${k.x.arms.path.join(' > ') || '(none)'}${k.x.arms.root.length ? '; root ' + k.x.arms.root.join(', ') : ''}; present ${k.x.arms.present.join(',')}${k.x.arms[frame + 'CombinedR'] || k.x.arms[frame + 'CombinedW'] ? '; agrees only with three or more set equal' : ''}`);
  p('');
  p(`#### Left in frame "${frame}", every one (${left.length})`);
  for (const x of left)
    p(`- ${poolOf(x)} ${x.src} ${x.at} T${x.T} ${x.id}: runner ${x.why} (known ${x.known} of ${x.budget}); walk ${x.holds ? 'holds' : 'open'} need ${x.need} of ${x.walkBudget}, set ${JSON.stringify(x.walkSet)}; present ${x.arms.present.join(',')}; path ${x.arms.path.join(' > ')}${x.arms.root.length ? '; root ' + x.arms.root.join(', ') : ''}; rig ${x.arms.rig.join(', ')}`);
}
const s = lines.filter(x => x.kind === 's');
p('');
p(`Shards: ${s.length}; Runner asks ${s.reduce((n, x) => n + x.asks, 0)}, walk asks ${s.reduce((n, x) => n + x.walks, 0)}.`);
