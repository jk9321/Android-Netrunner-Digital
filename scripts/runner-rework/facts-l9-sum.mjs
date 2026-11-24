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
  const explained = x => (frame === 'aside' && x.arms.control.aside) || Object.values(x.arms[frame]).some(Boolean) || (x.arms[`${frame}Pairs`] ?? []).length > 0 || x.arms[`${frame}CombinedR`] || x.arms[`${frame}CombinedW`];
  const how = x => {
    if (frame === 'aside' && x.arms.control.aside) return 'policies together';
    const s = Object.entries(x.arms[frame]).filter(([, v]) => v).map(([k]) => k);
    if (s.length) return 'single';
    if ((x.arms[`${frame}Pairs`] ?? []).length) return 'pair';
    if (x.arms[`${frame}CombinedR`] || x.arms[`${frame}CombinedW`]) return 'combined';
    return 'unexplained';
  };
  p('');
  p(`### Rule 3, frame "${frame}": what is left`);
  p('| Pool | where | met | unexplained by L9 | policies together | single arm | pair | combined | left | left / met | rule 3 |');
  p('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const at of AT)
    for (const pl of POOLS) {
      const m = met(pl, at);
      const xs = withArms.filter(x => poolOf(x) === pl && x.at === at);
      const c = k => xs.filter(x => how(x) === k).length;
      const left = c('unexplained');
      const share = m ? (100 * left) / m : 0;
      const ok = PEOPLE.has(pl) ? (left < 10 ? 'yes (< 10)' : 'no') : share <= 0.3 ? 'yes' : 'no';
      p(`| ${pl} | ${at} | ${m} | ${xs.length} | ${frame === 'aside' ? c('policies together') : '-'} | ${c('single')} | ${c('pair')} | ${c('combined')} | ${left} | ${share.toFixed(2)}% | ${ok} |`);
    }
  const left = withArms.filter(x => !explained(x));
  p('');
  p(`#### Left in frame "${frame}", every one (${left.length})`);
  for (const x of left)
    p(`- ${poolOf(x)} ${x.src} ${x.at} T${x.T} ${x.id}: runner ${x.why} (known ${x.known} of ${x.budget}); walk ${x.holds ? 'holds' : 'open'} need ${x.need} of ${x.walkBudget}, set ${JSON.stringify(x.walkSet)}; present ${x.arms.present.join(',')}; path ${x.arms.path.join(' > ')}${x.arms.root.length ? '; root ' + x.arms.root.join(', ') : ''}; rig ${x.arms.rig.join(', ')}`);
}
const s = lines.filter(x => x.kind === 's');
p('');
p(`Shards: ${s.length}; Runner asks ${s.reduce((n, x) => n + x.asks, 0)}, walk asks ${s.reduce((n, x) => n + x.walks, 0)}.`);
