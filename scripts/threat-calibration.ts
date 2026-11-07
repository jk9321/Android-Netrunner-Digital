/**
 * Threat calibration (structural review item 3, 2026-11-07; plan.threatModel): the Corp's threat (src/ai/threatModel.ts)
 * at the start of each Runner turn against where the Runner then ran. A report, not a knob: a gap is a bug in the
 * Runner's view or the budget, found with --turns (the turns where predicted and observed differ most).
 *   npx vite-node scripts/threat-calibration.ts -- human [dir] [--turns]
 *   SHARD=i/n npx vite-node scripts/threat-calibration.ts -- self [games per pairing] > cal-i.json   (self-play; the
 *     batch workflow's script=threat-calibration runs this, its shard artifacts summed with `sum`)
 *   npx vite-node scripts/threat-calibration.ts -- sum cal-*.json
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GameAction, GameState, cardDef, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { applyPlanOff, asSide } from '../src/ai/synergy';
import { threat } from '../src/ai/threatModel';
import { stealOdds, passOddsOf } from '../src/ai/effectValues';
import { ALL_DECKS as DECKS } from './nsg-sample-decks';
applyPlanOff(process.env.PLAN_OFF ?? '');

type Kind = 'hq' | 'rd' | 'archives' | 'remote';
const KINDS: Kind[] = ['hq', 'rd', 'archives', 'remote'];
const kind = (server: string): Kind => (server === 'hq' || server === 'rd' || server === 'archives' ? server : 'remote');

interface Cell { turns: number; predicted: number; ran: number; p1: number; p1ran: number; p0: number; p0ran: number }
/** Runs on a server whose ice was all unrezzed at the turn's start (the pass guess UNREZZED_PASS), by layers and Corp money. */
interface Layer { runs: number; successful: number }
/** Agenda remotes at the turn's start, by rezzed/total ice: the steal chance stealOdds gave (threat x passOdds, or STEAL.run x passOdds), the threat's run chance, steals. */
interface Steal { n: number; predicted: number; run: number; pass: number; stolen: number; brier: number }
interface Stats { games: number; turns: number; runs: number; predictedRuns: number; kinds: Record<Kind, Cell>; facedown: Cell; agendaRemote: Cell; unrezzed: Record<string, Layer>; steals: Record<string, Steal> }
const cell = (): Cell => ({ turns: 0, predicted: 0, ran: 0, p1: 0, p1ran: 0, p0: 0, p0ran: 0 });
const fresh = (): Stats => ({ games: 0, turns: 0, runs: 0, predictedRuns: 0, kinds: { hq: cell(), rd: cell(), archives: cell(), remote: cell() }, facedown: cell(), agendaRemote: cell(), unrezzed: {}, steals: {} });

function add(c: Cell, p: number, ran: boolean) {
  c.turns++;
  c.predicted += p;
  if (ran) c.ran++;
  if (p >= 0.5) {
    c.p1++;
    if (ran) c.p1ran++;
  } else {
    c.p0++;
    if (ran) c.p0ran++;
  }
}

const gaps: { gap: number; line: string }[] = [];

/** One Runner turn: the threat at its start (as the Corp) against the runs it made. */
function count(stats: Stats, start: GameState, runs: { server: string; successful?: boolean }[], label: string, end: GameState) {
  const t = asSide('corp', () => threat(start));
  // The unrezzed pass guess: runs on servers whose every ice was unrezzed at the turn's start (no ice: not counted)
  const rich = start.corp.credits >= 3 ? 'rich' : 'broke';
  for (const run of runs) {
    const v = start.corp.servers[run.server];
    if (!v || !v.ice.length || v.ice.some(i => i.isRezzed)) continue;
    const agenda = v.root.some(c => cardDef(c).type_code === 'agenda');
    const key = `${agenda ? 'agenda remote' : kind(run.server) === 'remote' ? 'other remote' : 'central'} ${v.ice.length} unrezzed, ${rich}`;
    const l = (stats.unrezzed[key] ??= { runs: 0, successful: 0 });
    l.runs++;
    if (run.successful) l.successful++;
  }
  const stolen = new Set(end.runner.scoreArea.map(c => c.instanceId));
  for (const v of Object.values(start.corp.servers)) {
    if (!v.isRemote) continue;
    for (const c of v.root.filter(c => cardDef(c).type_code === 'agenda')) {
      const p = asSide('corp', () => stealOdds(start, v.id));
      const key = `${v.ice.filter(i => i.isRezzed).length}/${v.ice.length}`;
      const x = (stats.steals[key] ??= { n: 0, predicted: 0, run: 0, pass: 0, stolen: 0, brier: 0 });
      const y = stolen.has(c.instanceId) ? 1 : 0;
      x.n++;
      x.predicted += p;
      x.run += t.servers[v.id]?.run ?? 0;
      x.pass += asSide('corp', () => passOddsOf(start, v.id));
      x.stolen += y;
      x.brier += (p - y) ** 2;
    }
  }
  stats.turns++;
  stats.runs += runs.length;
  stats.predictedRuns += t.runs;
  const ranOn = new Set(runs.map(r => r.server));
  for (const k of KINDS) {
    // A server kind: the chance of at least one run there (remotes: the most-threatened remote)
    const ids = Object.keys(start.corp.servers).filter(id => kind(id) === k);
    if (!ids.length) continue;
    const p = Math.max(...ids.map(id => t.servers[id]?.run ?? 0));
    add(stats.kinds[k], p, ids.some(id => ranOn.has(id)));
  }
  if (start.corp.archives.faceDown.length) add(stats.facedown, t.servers.archives?.run ?? 0, ranOn.has('archives'));
  for (const v of Object.values(start.corp.servers)) {
    if (v.isRemote && v.root.some(c => cardDef(c).type_code === 'agenda')) add(stats.agendaRemote, t.servers[v.id]?.run ?? 0, ranOn.has(v.id));
  }
  const predicted = t.order.join(',');
  const observed = runs.map(r => r.server).join(',');
  const gap = Math.abs(t.runs - runs.length) + KINDS.filter(k => (t.order.some(id => kind(id) === k)) !== runs.some(r => kind(r.server) === k)).length;
  if (gap >= 2) {
    const scores = Object.entries(t.servers).map(([id, s]) => `${id}:${Number.isFinite(s.score) ? s.score.toFixed(1) : '-'}`).join(' ');
    gaps.push({ gap, line: `${label} T${start.turnNumber} credits ${start.runner.credits} predicted [${predicted}] observed [${observed}] scores ${scores}` });
  }
}

function human(dir: string): Stats {
  const stats = fresh();
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const report = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    if (!report.moves?.length || report.config.ai !== 'runner') continue;
    let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
    if (report.startStops) s = { ...s, stops: report.startStops };
    let start: GameState | null = null;
    try {
      for (const move of report.moves as GameAction[]) {
        const before = s;
        s = executeAction(s, move);
        if (before.activePlayer !== 'runner' && s.activePlayer === 'runner') start = s;
        if (before.activePlayer === 'runner' && s.activePlayer !== 'runner' && start) {
          count(stats, start, before.runsThisTurn, file, s);
          start = null;
        }
      }
    } catch (err) {
      console.error(`${file}: ${err}`);
      continue;
    }
    stats.games++;
  }
  return stats;
}

function self(games: number): Stats {
  const stats = fresh();
  const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
  let seed = 1000;
  let deal = 0;
  for (const c of DECKS.filter(d => d.side === 'corp')) for (const r of DECKS.filter(d => d.side === 'runner')) for (let g = 0; g < games; g++) {
    seed++;
    if (deal++ % shards !== shard) continue;
    const gr = new GameRunner(createInitialGameState(deckGameSetup(seed, c, r)), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
    let start: GameState | null = null;
    try {
      for (let steps = 0; steps < 4000 && gr.state.turnNumber <= 80 && !gr.state.winner; steps++) {
        const before = gr.state;
        if (!gr.step()) break;
        const after = gr.state;
        if (before.activePlayer !== 'runner' && after.activePlayer === 'runner') start = after;
        if (before.activePlayer === 'runner' && after.activePlayer !== 'runner' && !before.activeRun && start) {
          count(stats, start, before.runsThisTurn, `${c.id} v ${r.id} #${seed}`, after);
          start = null;
        }
      }
    } catch (err) {
      console.error(`${c.id} v ${r.id}: ${err}`);
    }
    stats.games++;
  }
  return stats;
}

function sum(files: string[]): Stats {
  const all = fresh();
  for (const f of files) {
    const s: Stats = JSON.parse(readFileSync(f, 'utf8'));
    all.games += s.games;
    all.turns += s.turns;
    all.runs += s.runs;
    all.predictedRuns += s.predictedRuns;
    const merge = (a: Cell, b: Cell) => (Object.keys(a) as (keyof Cell)[]).forEach(k => (a[k] += b[k]));
    for (const k of KINDS) merge(all.kinds[k], s.kinds[k]);
    merge(all.facedown, s.facedown);
    merge(all.agendaRemote, s.agendaRemote);
    for (const [k, v] of Object.entries(s.unrezzed ?? {})) { const a = (all.unrezzed[k] ??= { runs: 0, successful: 0 }); a.runs += v.runs; a.successful += v.successful; }
    for (const [k, v] of Object.entries(s.steals ?? {})) { const a = (all.steals[k] ??= { n: 0, predicted: 0, run: 0, pass: 0, stolen: 0, brier: 0 }); (Object.keys(a) as (keyof Steal)[]).forEach(f => (a[f] += v[f])); }
  }
  return all;
}

function print(stats: Stats) {
  const f = (x: number, d = 2) => x.toFixed(d);
  const r = (a: number, b: number) => (b ? f(a / b) : ' -  ');
  console.log(`${stats.games} games, ${stats.turns} Runner turns`);
  console.log(`runs a turn: observed ${r(stats.runs, stats.turns)}, predicted ${r(stats.predictedRuns, stats.turns)}`);
  console.log('server        turns  observed  predicted   |  P=1 turns  ran   |  P=0 turns  ran');
  const row = (name: string, c: Cell) =>
    console.log(`${name.padEnd(13)} ${String(c.turns).padStart(5)}  ${r(c.ran, c.turns).padStart(8)}  ${r(c.predicted, c.turns).padStart(9)}   |  ${String(c.p1).padStart(9)}  ${r(c.p1ran, c.p1)}  |  ${String(c.p0).padStart(9)}  ${r(c.p0ran, c.p0)}`);
  for (const k of KINDS) row(k === 'remote' ? 'any remote' : k, stats.kinds[k]);
  row('facedown arc', stats.facedown);
  row('agenda rem.', stats.agendaRemote);
  console.log('\nruns on all-unrezzed ice (turn start): successful / runs, per-layer pass = share^(1/layers)');
  for (const [k, v] of Object.entries(stats.unrezzed).sort()) console.log(`  ${k.padEnd(34)} ${String(v.successful).padStart(4)}/${String(v.runs).padEnd(4)} ${r(v.successful, v.runs)}  per layer ${f((v.successful / v.runs) ** (1 / Number(k.match(/(\d+) unrezzed/)![1])))}`);
  const all = Object.values(stats.unrezzed);
  const one = Object.entries(stats.unrezzed).filter(([k]) => / 1 unrezzed/.test(k)).map(([, v]) => v);
  const sumL = (xs: Layer[]) => xs.reduce((a, v) => ({ runs: a.runs + v.runs, successful: a.successful + v.successful }), { runs: 0, successful: 0 });
  console.log(`  all: ${sumL(all).successful}/${sumL(all).runs}; one layer: ${r(sumL(one).successful, sumL(one).runs)}`);
  console.log('\nagenda remotes by rezzed/total ice: turns, predicted steals (stealOdds), threat runs, sum passOdds, stolen, stolen/(run x pass), Brier');
  for (const [k, v] of Object.entries(stats.steals).sort()) console.log(`  ${k.padEnd(5)} ${String(v.n).padStart(5)}  pred ${f(v.predicted, 1).padStart(6)}  runs ${f(v.run, 0).padStart(4)}  pass ${f(v.pass, 1).padStart(6)}  stolen ${String(v.stolen).padStart(4)}  brier ${r(v.brier, v.n)}`);
}

const args = process.argv.slice(2).filter(a => a !== '--');
// The batch workflow passes `-- <games> <level>`: a number first is self-play
const numeric = /^\d+$/.test(args[0] ?? '');
const mode = numeric ? 'self' : args[0] ?? 'human';
if (numeric) args.unshift('self');
if (mode === 'human') {
  print(human(args.find((a, i) => i > 0 && !a.startsWith('--')) ?? 'tests/fixtures/human-games'));
  if (args.includes('--turns')) for (const g of gaps.sort((a, b) => b.gap - a.gap).slice(0, 40)) console.log(g.line);
} else if (mode === 'self') {
  const stats = self(Number(args[1] ?? 1));
  console.log(JSON.stringify(stats));
  if (args.includes('--turns')) for (const g of gaps.sort((a, b) => b.gap - a.gap).slice(0, 40)) console.error(g.line);
} else if (mode === 'sum') print(sum(args.slice(1)));
