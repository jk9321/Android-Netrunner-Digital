// Paired comparison of two batches on the same deals (structural review item 5, 2026-11-06).
// Both batches play the same seeds, so the per-deal difference cancels the luck of the deal:
// its standard error is smaller than the gap between two independent win rates whenever
// the two runs agree on most deals. A gap under about 2 SE is noise.
//
//   node scripts/corp-losses-sum.mjs on/*.json --base off/*.json
//   node scripts/paired-summary.mjs on/*.json --base off/*.json   (this block only)
// Order matters: this batch's files first, then --base and the base batch's files.
// The paired win-rate SE is only ~20% under the unpaired one (a small switch still flips the
// winner on ~28% of deals), so judge a change by the paired alarm diffs (and human-agreement.ts),
// with the win rate as a guard rail.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Games from shard files (the last line of each is a JSON array) or a saved deals file. */
export function readGames(files) {
  return files.flatMap(f => {
    const lines = readFileSync(f, 'utf8').trim().split('\n');
    return JSON.parse(lines[lines.length - 1]);
  });
}

/** Splits argv into this batch's files and the --base batch's files. */
export function splitArgs(args) {
  const at = args.indexOf('--base');
  return at < 0 ? { files: args, base: [] } : { files: args.slice(0, at), base: args.slice(at + 1) };
}

const dealKey = g => `${g.seed}|${g.corpDeck}|${g.runnerDeck}`;

/**
 * A game's steals from remotes (Stage D item 1's bar, its two steals lines): [steals, points, steals from a remote
 * holding a rezzed bioroid, their points], from a saved deals file (`rs`) or a shard's game record (`steals`; the
 * bioroid pair is null for a record from before the field). Null when the game has neither.
 */
export function remoteSteals(g) {
  if (g.rs) return g.rs;
  if (!g.steals) return null;
  const remote = g.steals.filter(s => s.from === 'remote');
  const known = remote.every(s => s.bioroid !== undefined);
  const bio = remote.filter(s => s.bioroid);
  const pts = list => list.reduce((n, s) => n + s.points, 0);
  return [remote.length, pts(remote), known ? bio.length : null, known ? pts(bio) : null];
}
const played = g => !g.crashed && g.seed != null;

/**
 * A game's agenda installs (hold-retry brief section 6): [installed behind a rezzed bioroid, of those advanced behind it,
 * then installs into a 'new', 'bare', 'iced' and 'bioroid' remote], from a shard's game record (`agendaInstalls` with
 * `kind`) or a saved deals file (`ai`). Null for a record from before the field.
 */
export const INSTALL_KINDS = ['new', 'bare', 'iced', 'bioroid'];
export function agendaInstalls(g) {
  if (g.ai) return g.ai;
  const list = g.agendaInstalls;
  if (!list || list.some(a => a.kind === undefined)) return null;
  const bio = list.filter(a => a.kind === 'bioroid');
  return [bio.length, list.filter(a => a.bioroidAdvanced).length, ...INSTALL_KINDS.map(k => list.filter(a => a.kind === k).length)];
}

/** Mean and standard error of a list of per-deal differences. */
function meanSE(diffs) {
  const n = diffs.length;
  if (!n) return { mean: 0, se: 0 };
  const mean = diffs.reduce((s, d) => s + d, 0) / n;
  const variance = n > 1 ? diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / (n - 1) : 0;
  return { mean, se: Math.sqrt(variance / n) };
}

/** Pairs two batches deal by deal. Deals only one batch played (or that crashed in either) are left out. */
export function pairBatches(games, baseGames) {
  const base = new Map(baseGames.filter(played).map(g => [dealKey(g), g]));
  const pairs = games.filter(played).flatMap(g => (base.has(dealKey(g)) ? [[g, base.get(dealKey(g))]] : []));
  const n = pairs.length;
  const corp = g => (g.winner === 'corp' ? 1 : 0);
  const win = meanSE(pairs.map(([a, b]) => corp(a) - corp(b)));
  const on = pairs.reduce((s, [a]) => s + corp(a), 0) / Math.max(n, 1);
  const off = pairs.reduce((s, [, b]) => s + corp(b), 0) / Math.max(n, 1);
  // What two independent batches of this size would give, to show what pairing buys
  const unpairedSE = n ? Math.sqrt((on * (1 - on) + off * (1 - off)) / n) : 0;
  const toCorp = pairs.filter(([a, b]) => corp(a) > corp(b)).length;
  const toRunner = pairs.filter(([a, b]) => corp(a) < corp(b)).length;
  // Alarms per 100 games, paired the same way (a count per deal, so one game can carry several)
  const kinds = [...new Set(pairs.flatMap(([a, b]) => [...(a.alarms ?? []), ...(b.alarms ?? [])].map(x => x.kind)))].sort();
  const countOf = (g, kind) => (g.alarms ?? []).filter(x => x.kind === kind).length;
  const alarms = kinds.map(kind => {
    const d = meanSE(pairs.map(([a, b]) => countOf(a, kind) - countOf(b, kind)));
    const per100 = side => (100 * pairs.reduce((s, p) => s + countOf(p[side], kind), 0)) / Math.max(n, 1);
    return { kind, on: per100(0), off: per100(1), diff: 100 * d.mean, se: 100 * d.se };
  });
  // Steals from remotes per game, paired (where both sides recorded them)
  const stealPairs = pairs.map(([a, b]) => [remoteSteals(a), remoteSteals(b)]).filter(([a, b]) => a && b);
  const steals = [
    ['steals from remotes', 0],
    ['points from remotes', 1],
    ['steals from remotes with a rezzed bioroid', 2],
    ['points from remotes with a rezzed bioroid', 3],
  ].flatMap(([label, k]) => {
    const both = stealPairs.filter(([a, b]) => a[k] !== null && b[k] !== null);
    if (!both.length) return [];
    const d = meanSE(both.map(([a, b]) => a[k] - b[k]));
    const mean = side => both.reduce((s, p) => s + p[side][k], 0) / both.length;
    return [{ label, n: both.length, on: mean(0), off: mean(1), diff: d.mean, se: d.se }];
  });
  // Agenda installs per game, paired (where both sides recorded them), and steals from bioroid remotes per agenda put
  // behind a rezzed bioroid (sums over the batch: a ratio, not paired)
  const installPairs = pairs.map(([a, b]) => [agendaInstalls(a), agendaInstalls(b)]).filter(([a, b]) => a && b);
  const installs = ['agendas installed behind a rezzed bioroid', 'agendas advanced behind a rezzed bioroid', ...INSTALL_KINDS.map(k => `agenda installs into ${k === 'iced' ? 'an' : 'a'} ${k} remote`)].map((label, k) => {
    const d = meanSE(installPairs.map(([a, b]) => a[k] - b[k]));
    const mean = side => installPairs.reduce((s, p) => s + p[side][k], 0) / Math.max(installPairs.length, 1);
    return { label, n: installPairs.length, on: mean(0), off: mean(1), diff: d.mean, se: d.se };
  });
  const perAgenda = side => {
    const both = pairs.filter(p => remoteSteals(p[side])?.[2] != null && agendaInstalls(p[side]));
    const agendas = both.reduce((s, p) => s + agendaInstalls(p[side])[0], 0);
    return agendas ? both.reduce((s, p) => s + remoteSteals(p[side])[2], 0) / agendas : null;
  };
  const bioroidStealRate = installPairs.length ? { on: perAgenda(0), off: perAgenda(1) } : null;
  return {
    steals,
    installs: installPairs.length ? installs : [],
    bioroidStealRate,
    n,
    games: games.filter(played).length,
    baseGames: baseGames.filter(played).length,
    on: 100 * on,
    off: 100 * off,
    diff: 100 * win.mean,
    se: 100 * win.se,
    unpairedSE: 100 * unpairedSE,
    toCorp,
    toRunner,
    alarms,
  };
}

const signed = x => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;

/** The block corp-losses-sum prints when a --base batch is given. batch-log.mjs reads the "Paired Corp win" line. */
export function printPaired(games, baseGames) {
  const p = pairBatches(games, baseGames);
  console.log(`PAIRED vs base batch (same deals): ${p.n} games counted (this batch ${p.games}, base ${p.baseGames})`);
  if (!p.n) {
    console.log('  no deals in common: this batch\'s files go first, then --base and its files; both batches need the same decks and games per pairing');
    return p;
  }
  const verdict = p.se === 0 && p.diff === 0 ? 'identical' : Math.abs(p.diff) >= 2 * p.se ? 'outside noise (2 SE)' : 'inside noise (under 2 SE)';
  console.log(`  Corp win: ${p.on.toFixed(1)}% this vs ${p.off.toFixed(1)}% base`);
  console.log(`  Paired Corp win diff: ${signed(p.diff)} pts ± ${p.se.toFixed(1)} SE over ${p.n} games, ${verdict}; unpaired SE would be ± ${p.unpairedSE.toFixed(1)}`);
  console.log(`  deals that changed winner: ${p.toCorp} to Corp, ${p.toRunner} to Runner, ${p.n - p.toCorp - p.toRunner} the same`);
  if (p.alarms.length) {
    console.log('  alarms per 100 games (this / base, paired diff ± SE):');
    for (const a of p.alarms) console.log(`    ${a.kind}: ${a.on.toFixed(1)} / ${a.off.toFixed(1)}, ${signed(a.diff)} ± ${a.se.toFixed(1)}`);
  }
  if (p.steals.length) {
    console.log('  per game (this / base, paired diff ± SE, in SE):');
    for (const x of p.steals) console.log(`    ${x.label}: ${x.on.toFixed(3)} / ${x.off.toFixed(3)}, ${x.diff >= 0 ? '+' : ''}${x.diff.toFixed(3)} ± ${x.se.toFixed(3)} (${x.se ? (x.diff / x.se).toFixed(1) : '-'} SE) over ${x.n} games`);
  } else console.log('  steals from remotes: not in both batches\' records (a base summed before they were saved)');
  if (p.installs.length) {
    for (const x of p.installs) console.log(`    ${x.label}: ${x.on.toFixed(3)} / ${x.off.toFixed(3)}, ${x.diff >= 0 ? '+' : ''}${x.diff.toFixed(3)} ± ${x.se.toFixed(3)} (${x.se ? (x.diff / x.se).toFixed(1) : '-'} SE) over ${x.n} games`);
    const r = p.bioroidStealRate;
    const f = x => (x === null ? '-' : x.toFixed(3));
    console.log(`    steals from bioroid remotes per agenda installed behind a rezzed bioroid: ${f(r.on)} / ${f(r.off)}`);
  } else console.log('  agenda installs by server kind: not in both batches\' records (a record from before the field)');
  return p;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { files, base } = splitArgs(process.argv.slice(2));
  if (!base.length) {
    console.error('usage: node scripts/paired-summary.mjs this/*.json --base base/*.json');
    process.exit(1);
  }
  printPaired(readGames(files), readGames(base));
}
