// ai-tag-loss-time phase 1: sums scripts/tag-loss-time/measure.ts output (every shard's stdout), whatever the mode.
//   node scripts/tag-loss-time/summary.mjs out/*.txt > table.md
// deals lines: each arm's ms, tally and changed picks per decision. game lines: per-decision asks of the seed-104 game,
// the game's own call times, the saved state's asks, whole games per arm. values lines: each arm's value differences.
// Shares are differences between arm timings: (base - arm) / (base - F), never a profile.
import { readFileSync } from 'node:fs';

const ARMS = ['base', 'F', '0', 'A', '0A', 'H', 'S', 'B'];
const rows = [];
for (const f of process.argv.slice(2))
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* a line cut by a killed shard */
    }
  }
const decisions = rows.filter(r => r.ms && typeof r.ms === 'object' && !r.saved);
const saved = rows.filter(r => r.saved);
const own = rows.filter(r => r.own);
const whole = rows.filter(r => r.whole);
const values = rows.filter(r => r.values);
const fx = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const pct = x => (Number.isFinite(x) ? `${(100 * x).toFixed(0)}%` : '-');
const out = [];
const p = s => out.push(s);

/** Time removed per arm on a set of decisions, as a share of F's, with the paired difference's 2 SE. */
function shares(set, title) {
  if (!set.length) return;
  const arms = ARMS.filter(a => set.every(d => d.ms[a] !== undefined));
  const tot = a => set.reduce((n, d) => n + d.ms[a], 0);
  const base = tot('base');
  const fRemoved = base - tot('F');
  p(`\n#### ${title} (${set.length} decisions; base ${fx(base / 1000)} s, F removes ${fx(fRemoved / 1000)} s = ${pct(fRemoved / base)} of base)`);
  p('| arm | total s | removed s | 2 SE s | share of F |');
  p('|---|---|---|---|---|');
  for (const a of arms) {
    const diffs = set.map(d => d.ms.base - d.ms[a]);
    const mean = diffs.reduce((n, x) => n + x, 0) / diffs.length;
    const sd = Math.sqrt(diffs.reduce((n, x) => n + (x - mean) ** 2, 0) / Math.max(1, diffs.length - 1));
    const removed = base - tot(a);
    p(`| ${a} | ${fx(tot(a) / 1000)} | ${fx(removed / 1000)} | ${fx((2 * sd * Math.sqrt(diffs.length)) / 1000)} | ${a === 'base' ? '' : pct(removed / fRemoved)} |`);
  }
}

/** Mean tally per decision, per arm. */
function counts(set, title) {
  if (!set.length) return;
  const arms = ARMS.filter(a => set.every(d => d.tally?.[a]));
  const fields = ['prices', 'r0', 'rSkip', 'broke', 'priced', 'untrash', 'rig', 'rigIn', 'drawR', 'drawRIn', 'missR', 'missRIn', 'drawC', 'missC', 'rez', 'rezIn', 'hold', 'holdIn', 'msIn', 'heldServed', 'stackServed', 'stackPriced'];
  p(`\n#### Counts per decision, mean (${title}, ${set.length} decisions)`);
  p(`| field | ${arms.join(' | ')} |`);
  p(`|---|${arms.map(() => '---').join('|')}|`);
  for (const f of fields) p(`| ${f} | ${arms.map(a => fx(set.reduce((n, d) => n + (d.tally[a][f] ?? 0), 0) / set.length, f === 'msIn' ? 0 : 1)).join(' | ')} |`);
  const clears = {};
  for (const d of set) for (const a of arms) for (const [k, v] of Object.entries(d.tally[a].clears ?? {})) ((clears[k] ??= {})[a] = (clears[k][a] ?? 0) + v);
  for (const [k, by] of Object.entries(clears)) p(`| clears ${k} (total) | ${arms.map(a => by[a] ?? 0).join(' | ')} |`);
}

/** Decisions whose pick differs from base, per arm and side, per game. */
function fires(set, title) {
  if (!set.length) return;
  const games = new Set(set.map(d => d.src)).size;
  const arms = ARMS.filter(a => a !== 'base');
  p(`\n#### Fire count (${title}: ${set.length} decisions in ${games} games; decisions whose pick differs from base)`);
  p('| arm | Corp changed | Runner changed | per game | errors |');
  p('|---|---|---|---|---|');
  for (const a of arms) {
    const ch = set.filter(d => d.changed?.includes(a));
    const err = set.filter(d => d.picks?.[a]?.startsWith('error')).length;
    p(`| ${a} | ${ch.filter(d => d.side === 'corp').length} | ${ch.filter(d => d.side === 'runner').length} | ${fx(ch.length / games, 2)} | ${err} |`);
  }
  const zero = set.filter(d => d.changed?.includes('0'));
  if (zero.length) {
    p('\nArm 0 changed picks, asked again with drawAudit, clickAudit and threatAudit on:');
    for (const d of zero) p(`- ${d.src} #${d.i} ${d.side} T${d.T}: base audit ${JSON.stringify(d.audit?.base)}, arm 0 audit ${JSON.stringify(d.audit?.zero)}`);
  }
  const errs = set.filter(d => Object.values(d.picks ?? {}).some(x => String(x).startsWith('error')));
  for (const d of errs.slice(0, 10)) p(`- ERROR ${d.src} #${d.i}: ${JSON.stringify(d.picks)}`);
}

const corp = decisions.filter(d => d.side === 'corp' && !d.src.startsWith('game:'));
const runner = decisions.filter(d => d.side === 'runner' && !d.src.startsWith('game:'));
const slowest = [...corp].sort((a, b) => b.ms.base - a.ms.base).slice(0, 20);
if (corp.length || runner.length) {
  p('### Deals and Jeff\'s games (same recorded boards, arms rotated and reversed per decision)');
  shares(slowest, '20 slowest Corp decisions (by base)');
  shares(corp, 'all Corp decisions');
  shares(runner, 'all Runner decisions');
  shares(corp.filter(d => d.src.startsWith('human:')), "Corp decisions in Jeff's games");
  counts(corp, 'Corp');
  counts(slowest, '20 slowest Corp');
  counts(runner, 'Runner');
  fires([...corp, ...runner], 'deals + Jeff\'s games');
  p('\n20 slowest Corp decisions: ' + slowest.map(d => `${d.src}#${d.i} T${d.T} ${fx(d.ms.base / 1000)}s`).join(', '));
}

const game = decisions.filter(d => d.src.startsWith('game:'));
if (game.length || saved.length || whole.length) {
  p('\n### Seed-104 finish-test game (Quick and Dirty vs Bowel Movements) and the saved T18 decision');
  if (saved.length) {
    p(`\n#### Saved decision (t18-state.json), ${saved.length / ARMS.length} asks per arm (16 shards, both orders)`);
    p('| arm | median s | mean s | min s | max s | removed (median) s | share of F | picks |');
    p('|---|---|---|---|---|---|---|---|');
    const med = xs => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
    const by = a => saved.filter(r => r.arm === a).map(r => r.ms);
    const mb = med(by('base'));
    const mf = med(by('F'));
    for (const a of ARMS) {
      const xs = by(a);
      if (!xs.length) continue;
      const m = med(xs);
      p(`| ${a} | ${fx(m / 1000)} | ${fx(xs.reduce((n, x) => n + x, 0) / xs.length / 1000)} | ${fx(Math.min(...xs) / 1000)} | ${fx(Math.max(...xs) / 1000)} | ${fx((mb - m) / 1000)} | ${a === 'base' ? '' : pct((mb - m) / (mb - mf))} | ${[...new Set(saved.filter(r => r.arm === a).map(r => r.pick))].join(' / ')} |`);
    }
    const t = a => saved.find(r => r.arm === a)?.tally;
    const fields = ['prices', 'rig', 'rigIn', 'drawR', 'missR', 'missRIn', 'rez', 'rezIn', 'hold', 'holdIn', 'msIn', 'heldServed', 'stackServed', 'stackPriced'];
    p(`\n| count (one ask) | ${ARMS.join(' | ')} |`);
    p(`|---|${ARMS.map(() => '---').join('|')}|`);
    for (const f of fields) p(`| ${f} | ${ARMS.map(a => fx(t(a)?.[f] ?? NaN, 0)).join(' | ')} |`);
    p(`| clears | ${ARMS.map(a => JSON.stringify(t(a)?.clears ?? {})).join(' | ')} |`);
  }
  if (game.length) {
    shares(game, 'seed-104 game, every agent call asked in every arm (fresh agent, caches cleared)');
    shares(game.filter(d => d.T === 18), 'seed-104 game, turn 18 only');
    shares(game.filter(d => d.side === 'corp'), 'seed-104 game, Corp calls');
    fires(game, 'seed-104 game');
  }
  const ownGame = own.filter((r, i, all) => all.findIndex(x => x.i === r.i) === i);
  if (ownGame.length) {
    const sum = xs => xs.reduce((n, r) => n + r.ms, 0) / 1000;
    p(`\nThe game's own calls (this tree, caches kept as in tests/aiGames.ts; first shard's copy): ${ownGame.length} calls, ${fx(sum(ownGame))} s; turn 18: ${fx(sum(ownGame.filter(r => r.T === 18)))} s; slowest ${fx(Math.max(...ownGame.map(r => r.ms)) / 1000)} s.`);
  }
  if (whole.length) {
    p('\n#### Whole game per arm (one runner each; a changed pick changes the game)');
    p('| arm | game s | winner | turns | score | T18 Corp s | slowest call s |');
    p('|---|---|---|---|---|---|---|');
    for (const w of whole.sort((a, b) => ARMS.indexOf(a.arm) - ARMS.indexOf(b.arm))) {
      const slow = Math.max(...Object.values(w.turns).map(t => t.max));
      p(`| ${w.arm} | ${fx(w.ms / 1000)} | ${w.winner} | ${w.T} | ${w.score} | ${fx((w.turns['18 corp']?.ms ?? 0) / 1000)} | ${fx(slow / 1000)} |`);
    }
  }
}

if (values.length) {
  p(`\n### Values against today on the same boards (${values.length} decisions; every tagClock worked out both ways)`);
  p('| arm | clocks | per-turn differs (past 1e-9) | mean diff | mean abs diff | worth differs (past 1e-9) | mean diff | mean abs diff | non-finite | decisions with a difference past 1e-9 |');
  p('|---|---|---|---|---|---|---|---|---|---|');
  const largest = {};
  for (const a of ARMS) {
    const vs = values.map(r => r.values[a]).filter(Boolean);
    if (!vs.length) continue;
    const s = k => vs.reduce((n, v) => n + v[k], 0);
    const nd = vs.filter(v => v.turnBig || v.worthBig).length;
    for (const v of vs) if (v.largest && (!largest[a] || v.largest.d > largest[a].d)) largest[a] = v.largest;
    p(`| ${a} | ${s('n')} | ${s('turnDiff')} (${s('turnBig')}) | ${fx(s('turnSum') / Math.max(1, s('turnDiff')), 4)} | ${fx(s('turnAbs') / Math.max(1, s('turnDiff')), 4)} | ${s('worthDiff')} (${s('worthBig')}) | ${fx(s('worthSum') / Math.max(1, s('worthDiff')), 4)} | ${fx(s('worthAbs') / Math.max(1, s('worthDiff')), 4)} | ${s('nonFinite')} | ${nd} |`);
  }
  p('\nLargest difference per arm (per-turn loss or worth), with the board\'s resources (arm terms vs today\'s):');
  for (const [a, l] of Object.entries(largest)) p(`- ${a}: ${fx(l.d, 4)} (per turn ${fx(l.armTurn, 3)} vs ${fx(l.todayTurn, 3)}; worth ${fx(l.armWorth, 3)} vs ${fx(l.todayWorth, 3)}; viewer ${l.viewer}, tags ${l.tags}, Runner id ${l.ident}); terms ${JSON.stringify(l.armTerms)} vs ${JSON.stringify(l.todayTerms)}`);
}

console.log(out.join('\n'));
