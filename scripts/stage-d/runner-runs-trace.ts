/**
 * Stage D item 2, step 1a (brief section 2): the trace. At a recorded position the Corp plays its whole turn (a fresh
 * Normal agent deciding every click, as the game would) under arms that change ONLY the inputs the three flat readers
 * take for where the Runner runs, with no file under src/ changed (the exported constants are set in this process):
 *  - base: today (PACE.runs 1.01, shares HQ 0.18 / R&D 0.21 / Archives 0.05 / remotes 0.56, STEAL.run 0.45);
 *  - record: this Runner's runs so far (the engine's runnerLastTurnRuns at each earlier Corp turn) with today's
 *    shares as the prior at the strength the person sample fits (runner-runs-counts.mjs P2, K below), and its runs a
 *    turn shrunk the same way toward 1.01; a remote's run chance 1 - exp(-runs x share), which is 0.43 on today's
 *    numbers with one remote (STEAL.run 0.45);
 *  - next: the Runner's actual next turn (the oracle: the right answer at this position);
 *  - hqAll / remoteAll: every run on HQ (remote run chance 0) / on the remotes (run chance 1), to see whether a layer
 *    reads the input at all.
 * Each arm: the Corp's actions over the turn, the first decision's serverStake on HQ and R&D (iceValues) and the first
 * look's agendaWorth of each installed agenda (evaluate, through stealOdds). The counted questions (winNow.ts, corp/
 * lines.ts, corp/placement.ts, corp/rez.ts, corp/rezMoney.ts, corp/hold.ts) read none of these constants or functions
 * (grep in the design note), so a move that changes between arms is the order's or the planner's, through the values.
 *
 *   npx vite-node scripts/stage-d/runner-runs-trace.ts                 (the default positions)
 *   POS="report-43:12,report-50:12" npx vite-node scripts/stage-d/runner-runs-trace.ts
 */
import { readFileSync } from 'node:fs';
import { GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { createAgent } from '../../src/ai';
import { HeuristicCorpAI } from '../../src/ai/corpAI';
import { PACE, STEAL } from '../../src/ai/effectValues';
import { serverStake } from '../../src/ai/iceValues';
import { withDiagnostics } from '../../src/ai/diagnostics';
import { asSide } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { clearCaches } from '../stage-a/harness';
import { clearBuildTargets, valueLoops } from '../../src/ai/valueModel';
import { clearDeckShares } from '../../src/ai/iceValues';
import { installCorpForTest, installIceForTest, newGame } from '../../tests/helpers';

const K = Number(process.env.K ?? 8);
const BASE = { runs: PACE.runs, hqShare: PACE.hqShare, rdShare: PACE.rdShare, archivesShare: PACE.archivesShare, remoteShare: PACE.remoteShare, steal: STEAL.run };
type Runs = { server: string; successful: boolean }[];

interface Position {
  name: string;
  state: GameState;
  /** Runs of each earlier Runner turn, oldest first. */
  record: Runs[];
  /** The Runner's next turn (the oracle), when known. */
  next?: Runs;
}

/** A human game replayed to the Corp's first main-phase decision of `turn` (the pins' report34), with its run record. */
function human(file: string, turn: number): Position {
  const report = JSON.parse(readFileSync(`tests/fixtures/human-games/${file}.json`, 'utf8'));
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  const record: Runs[] = [];
  let at: GameState | null = null;
  let seenTurn = -1;
  let next: Runs | undefined;
  for (const m of report.moves as GameAction[]) {
    if (s.activePlayer === 'corp' && s.turnNumber !== seenTurn && s.turnNumber > 1) {
      seenTurn = s.turnNumber;
      if (at) {
        next = s.runnerLastTurnRuns;
        break;
      }
      record.push(s.runnerLastTurnRuns);
    }
    const decision = s.activePlayer === 'corp' && s.corp.clicks > 0 && actingSide(s) === 'corp' && !s.pendingPrompts.length && m.type !== 'START_TURN';
    if (decision && s.turnNumber === turn && !at) at = s;
    s = executeAction(s, m);
  }
  if (!at) throw new Error(`${file}: no Corp decision on turn ${turn}`);
  // The record is the turns before the decision: the last one is at.runnerLastTurnRuns
  return { name: `${file} T${turn}`, state: at, record, next };
}

/** Pin 2's board (tests/runnerRunsRead.test.ts guardedRemote): Offworld Office behind a rezzed Palisade, broke Runner, turn 11. */
function pin2(): Position {
  const s = newGame(3);
  installIceForTest(s, '30072', 'remote-1');
  installCorpForTest(s, '30067', 'remote-1');
  s.runner.credits = 0;
  s.corp.credits = 2;
  s.turnNumber = 11;
  const ran: Runs = [{ server: 'remote-1', successful: false }];
  s.runnerLastTurnRuns = ran;
  return { name: 'pin 2 board (remote-1 run on turns 5, 7, 9 and the last)', state: s, record: [[], [], [], [], ran, [], ran, [], ran, ran] };
}

/** The P2 estimate: expected runs on each server next turn (this Runner's runs a turn x its shares, today's as the prior). */
function estimate(state: GameState, record: Runs[]): Record<string, number> {
  const open = Object.keys(state.corp.servers);
  const remotes = open.filter(id => state.corp.servers[id].isRemote);
  const prior: Record<string, number> = { hq: BASE.hqShare, rd: BASE.rdShare, archives: BASE.archivesShare };
  for (const r of remotes) prior[r] = BASE.remoteShare / remotes.length;
  const pt = Object.values(prior).reduce((a, b) => a + b, 0);
  const n: Record<string, number> = {};
  let N = 0;
  for (const turn of record)
    for (const r of turn)
      if (open.includes(r.server)) {
        n[r.server] = (n[r.server] ?? 0) + 1;
        N++;
      }
  const all = record.reduce((a, t) => a + t.length, 0);
  const runs = (all + K * BASE.runs) / (record.length + K);
  const out: Record<string, number> = {};
  for (const id of Object.keys(prior)) out[id] = runs * ((n[id] ?? 0) + (K * prior[id]) / pt) / (N + K);
  return out;
}
/** Expected runs from an actual turn (the oracle arm). */
function actual(turn: Runs): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of turn) out[r.server] = (out[r.server] ?? 0) + 1;
  return out;
}

type Arm = { name: string; lambda?: Record<string, number>; set?: Partial<typeof BASE> };
function apply(arm: Arm, state: GameState) {
  Object.assign(PACE, { runs: BASE.runs, hqShare: BASE.hqShare, rdShare: BASE.rdShare, archivesShare: BASE.archivesShare, remoteShare: BASE.remoteShare });
  STEAL.run = BASE.steal;
  if (arm.set) {
    const { steal, ...pace } = arm.set;
    Object.assign(PACE, pace);
    if (steal !== undefined) STEAL.run = steal;
  }
  if (arm.lambda) {
    const l = arm.lambda;
    const total = Object.values(l).reduce((a, b) => a + b, 0);
    const remotes = Object.keys(state.corp.servers).filter(id => state.corp.servers[id].isRemote);
    const remote = remotes.reduce((a, id) => a + (l[id] ?? 0), 0);
    PACE.runs = Math.max(1e-6, total);
    PACE.hqShare = (l.hq ?? 0) / PACE.runs;
    PACE.rdShare = (l.rd ?? 0) / PACE.runs;
    PACE.archivesShare = (l.archives ?? 0) / PACE.runs;
    PACE.remoteShare = remote / PACE.runs;
    // STEAL.run is one number for every remote: the agenda remote's (the most-run remote with an agenda, else the most-run remote)
    const withAgenda = remotes.filter(id => state.corp.servers[id].root.some(c => cardDef(c).type_code === 'agenda'));
    const pick = (withAgenda.length ? withAgenda : remotes).sort((a, b) => (l[b] ?? 0) - (l[a] ?? 0))[0];
    STEAL.run = pick ? 1 - Math.exp(-(l[pick] ?? 0)) : BASE.steal;
  }
}

function clearAll() {
  clearCaches();
  clearBuildTargets();
  clearDeckShares();
  valueLoops?.clear();
}

/** The Corp's turn from `start`, a fresh Normal agent deciding every Corp action (Runner prompts on the Corp's turn: the Runner AI). */
function playTurn(start: GameState): string[] {
  let s = structuredClone(start);
  const corp = createAgent('corp', 'normal');
  const runner = createAgent('runner', 'normal');
  const out: string[] = [];
  const turn = s.turnNumber;
  for (let n = 0; n < 40 && !s.winner && s.turnNumber === turn && s.activePlayer === 'corp'; n++) {
    const side = actingSide(s);
    if (!side) break;
    clearAll();
    const a = side === 'corp' ? corp.chooseAction(s) : runner.chooseAction(s);
    if (side === 'corp') out.push(label(s, a));
    s = executeAction(s, a);
  }
  return out;
}
function label(s: GameState, a: GameAction): string {
  const x = a as GameAction & { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean };
  const card = x.cardInstanceId ? [...s.corp.hq, ...Object.values(s.corp.servers).flatMap(v => [...v.root, ...v.ice])].find(c => c.instanceId === x.cardInstanceId) : undefined;
  return [a.type, card ? cardDef(card).title : '', x.targetServerId ?? (x.asNewRemote ? 'new' : '')].filter(Boolean).join(' ');
}

/** The first decision's readers: serverStake on HQ and R&D; agendaWorth (the steal through stealOdds) of each installed agenda. */
function readers(state: GameState): { hq: number; rd: number; agendas: Record<string, number> } {
  const s = structuredClone(state);
  clearAll();
  const stakes = asSide('corp', () => {
    decisionContext(s, 'corp');
    return { hq: serverStake(s, s.corp.servers.hq), rd: serverStake(s, s.corp.servers.rd) };
  });
  const agendas: Record<string, number> = {};
  clearAll();
  withDiagnostics(d => {
    d.onValue = (_q, site, _st, value, args) => {
      if (site === 'agendaWorth' && typeof args[3] === 'string' && args[4] === undefined && agendas[args[3] as string] === undefined) agendas[args[3] as string] = +value.toFixed(3);
    };
    new HeuristicCorpAI().chooseAction(structuredClone(state));
  });
  return { hq: +stakes.hq.toFixed(3), rd: +stakes.rd.toFixed(3), agendas };
}

const positions: Position[] = (process.env.POS ?? 'report-34:12,report-43:12,report-50:12,pin2')
  .split(',')
  .map(p => (p === 'pin2' ? pin2() : human(p.split(':')[0], Number(p.split(':')[1]))));

for (const pos of positions) {
  const arms: Arm[] = [{ name: 'base' }, { name: 'record', lambda: estimate(pos.state, pos.record) }];
  if (pos.next) arms.push({ name: 'next', lambda: actual(pos.next) });
  arms.push({ name: 'hqAll', set: { hqShare: 1, rdShare: 0, archivesShare: 0, remoteShare: 0, steal: 0 } });
  arms.push({ name: 'remoteAll', set: { hqShare: 0, rdShare: 0, archivesShare: 0, remoteShare: 1, steal: 1 } });
  const runsBy = (rs: Runs[]) => rs.map(t => t.map(r => r.server + (r.successful ? '+' : '-')).join(' ') || '-').join(' | ');
  console.log(`\n=== ${pos.name}: record ${runsBy(pos.record)}${pos.next ? `; next turn: ${runsBy([pos.next])}` : ''}`);
  console.log(`board: ${Object.values(pos.state.corp.servers).map(v => `${v.id}[${v.ice.length} ice${v.root.length ? `, root ${v.root.map(c => cardDef(c).title + (c.isRezzed ? '*' : '')).join('/')}` : ''}]`).join(' ')}; HQ agendas ${pos.state.corp.hq.filter(c => cardDef(c).type_code === 'agenda').length}/${pos.state.corp.hq.length}; Corp ${pos.state.corp.credits} cr, Runner ${pos.state.runner.credits} cr, score ${pos.state.corp.score}-${pos.state.runner.score}`);
  let baseLine = '';
  for (const arm of arms) {
    apply(arm, pos.state);
    const r = readers(pos.state);
    const line = playTurn(pos.state).join('; ');
    if (arm.name === 'base') baseLine = line;
    const inputs = `runs ${PACE.runs.toFixed(2)} hq ${PACE.hqShare.toFixed(2)} rd ${PACE.rdShare.toFixed(2)} arch ${PACE.archivesShare.toFixed(2)} rem ${PACE.remoteShare.toFixed(2)} steal ${STEAL.run.toFixed(2)}`;
    console.log(`  ${arm.name.padEnd(9)} [${inputs}] stake HQ ${r.hq} R&D ${r.rd} agendaWorth ${JSON.stringify(r.agendas)}`);
    console.log(`            turn: ${arm.name !== 'base' && line === baseLine ? '(same as base)' : line}`);
  }
  apply({ name: 'base' }, pos.state);
}
