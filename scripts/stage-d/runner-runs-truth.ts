/**
 * Stage D item 2, brief rev 2 section 2: does the truth about where the Runner runs change any Corp move, and through
 * which layer? On the human games where a person played the Runner (config.ai === 'corp'; AI=runner for the others), at
 * every Corp main-phase decision (and prompt on its own turn), a fresh Normal Corp is asked under five arms, the replay
 * following the recorded moves. No file under src/ changes; the arms are set in this process for one decision:
 *  - base, and null (base asked again: the noise floor of "changed");
 *  - T1, next turn: inside the planner's reply (runnerReply.ts plays our Runner AI, HeuristicRunnerAI, for the
 *    Runner's next turn) the Runner's runs are forced to the person's actual next turn: the servers in order, each run
 *    started when the AI's own pick is a main-phase action and a run on that server is legal, no run after the list
 *    ends (the AI's pick is replaced by a click for a credit); breaks, prompts and every other action are the AI's;
 *  - T2, after: the leaf's flat numbers are this game's truth over the turns after the next one (the next one where it is
 *    the last): PACE.runs x each share = the runs a turn on HQ, R&D, Archives and the remotes; STEAL.run = the share of
 *    those turns with a run on the agenda remote (else the most-run remote), the agenda remote's chance of being run in
 *    a turn, which stealOdds multiplies by the pass odds as today; every reader of these constants reads them (the
 *    three flat sites and the card formulas listed in the design note);
 *  - T3: both.
 * A run's kind: 'chosen' (the Runner's own INITIATE_RUN) or 'offered' (a card's run: Alarm Clock, a run event), by the
 * move that started it. One JSON line per changed decision, a summary per game.
 *
 * ARGS=raise (brief rev 2 3.6: history may only raise a server's odds): the arms are base, null, and
 *  - T2r: T2 raise-only: each server's runs a turn is the larger of today's (1.01 x its share) and the truth's, the
 *    agenda remote's run chance the larger of STEAL.run and the truth's;
 *  - T2p: the record predictor, raise-only (runner-runs-counts2.mjs P1, k = K, default 8): each open server's runs a turn
 *    (runs on it so far + k x today's) / (turns it was open + k), at least today's; the agenda remote's run chance the
 *    larger of STEAL.run and 1 - exp(-that).
 *   SHARD=0/4 npx vite-node scripts/stage-d/runner-runs-truth.ts > truth-0.jsonl
 */
import { readFileSync } from 'node:fs';
import { GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction, getLegalActions, isLegalAction } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { createAgent } from '../../src/ai';
import { HeuristicRunnerAI } from '../../src/ai/runnerAI';
import { PACE, STEAL } from '../../src/ai/effectValues';
import { clearCaches, humanFiles } from '../stage-a/harness';
import { clearBuildTargets, valueLoops } from '../../src/ai/valueModel';
import { clearDeckShares } from '../../src/ai/iceValues';

const BASE = { runs: PACE.runs, hqShare: PACE.hqShare, rdShare: PACE.rdShare, archivesShare: PACE.archivesShare, remoteShare: PACE.remoteShare, steal: STEAL.run };
type Run = { server: string; successful: boolean; kind?: 'chosen' | 'offered' };

// ---- T1: the reply's Runner forced to the person's next turn
let forced: string[] | null = null;
const original = HeuristicRunnerAI.prototype.chooseAction;
HeuristicRunnerAI.prototype.chooseAction = function (this: HeuristicRunnerAI, state: GameState): GameAction {
  const a = original.call(this, state);
  if (!forced || state.activePlayer !== 'runner' || state.activeRun || state.pendingPrompts.length) return a;
  const done = state.runsThisTurn.length;
  const isMain = !state.priority || state.priority.holder === 'runner';
  if (done < forced.length) {
    const want: GameAction = { type: 'INITIATE_RUN', player: 'runner', targetServerId: forced[done] } as GameAction;
    if (a.type === 'INITIATE_RUN' && (a as { targetServerId?: string }).targetServerId === forced[done]) return a;
    if (isMain && state.runner.clicks > 0 && safeLegal(state, want)) return want;
    return a.type === 'INITIATE_RUN' ? creditOr(state, a) : a;
  }
  return a.type === 'INITIATE_RUN' ? creditOr(state, a) : a;
};
function safeLegal(state: GameState, a: GameAction): boolean {
  try {
    return isLegalAction(state, a);
  } catch {
    return false;
  }
}
function creditOr(state: GameState, a: GameAction): GameAction {
  const gain = getLegalActions(state, 'runner').find(x => x.type === 'GAIN_CREDIT');
  return gain ?? getLegalActions(state, 'runner').find(x => x.type === 'END_TURN') ?? a;
}

// ---- T2: the leaf's flat numbers from the truth of the turns after
function truthAfter(state: GameState, later: Run[][]): Record<string, number> | null {
  if (!later.length) return null;
  const remotes = Object.keys(state.corp.servers).filter(id => state.corp.servers[id].isRemote);
  const runs: Record<string, number> = {};
  const turnsWith: Record<string, number> = {};
  for (const t of later) {
    for (const r of t) runs[r.server] = (runs[r.server] ?? 0) + 1;
    for (const s of new Set(t.map(r => r.server))) turnsWith[s] = (turnsWith[s] ?? 0) + 1;
  }
  const per = (id: string) => (runs[id] ?? 0) / later.length;
  const total = Object.values(runs).reduce((a, b) => a + b, 0) / later.length;
  const withAgenda = remotes.filter(id => state.corp.servers[id].root.some(c => cardDef(c).type_code === 'agenda'));
  const pick = [...(withAgenda.length ? withAgenda : remotes)].sort((a, b) => (runs[b] ?? 0) - (runs[a] ?? 0))[0];
  return {
    runs: total,
    hq: per('hq'),
    rd: per('rd'),
    archives: per('archives'),
    remote: remotes.reduce((n, id) => n + per(id), 0),
    steal: pick ? (turnsWith[pick] ?? 0) / later.length : BASE.steal,
  };
}
function setLeaf(t: Record<string, number> | null) {
  Object.assign(PACE, { runs: BASE.runs, hqShare: BASE.hqShare, rdShare: BASE.rdShare, archivesShare: BASE.archivesShare, remoteShare: BASE.remoteShare });
  STEAL.run = BASE.steal;
  if (!t) return;
  PACE.runs = Math.max(1e-6, t.runs);
  PACE.hqShare = t.hq / PACE.runs;
  PACE.rdShare = t.rd / PACE.runs;
  PACE.archivesShare = t.archives / PACE.runs;
  PACE.remoteShare = t.remote / PACE.runs;
  STEAL.run = t.steal;
}

const RAISE = (process.env.ARGS ?? '').includes('raise');
const K = Number(process.env.K ?? 8);
/** Today's runs a turn on each open server (PACE.runs x share; the remotes' share split evenly). */
function today(state: GameState): Record<string, number> {
  const remotes = Object.keys(state.corp.servers).filter(id => state.corp.servers[id].isRemote);
  const out: Record<string, number> = { hq: BASE.runs * BASE.hqShare, rd: BASE.runs * BASE.rdShare, archives: BASE.runs * BASE.archivesShare };
  for (const r of remotes) out[r] = (BASE.runs * BASE.remoteShare) / remotes.length;
  return out;
}
/** Sets the leaf from per-server runs a turn (raise-only against today) and the agenda remote's run chance. */
function setRaised(state: GameState, lam: Record<string, number>, remoteChance: (id: string) => number) {
  setLeaf(null);
  const t = today(state);
  const l = (id: string) => Math.max(t[id] ?? 0, lam[id] ?? 0);
  const remotes = Object.keys(state.corp.servers).filter(id => state.corp.servers[id].isRemote);
  PACE.hqShare = l('hq') / BASE.runs;
  PACE.rdShare = l('rd') / BASE.runs;
  PACE.archivesShare = l('archives') / BASE.runs;
  PACE.remoteShare = Math.max(BASE.remoteShare, remotes.reduce((n, id) => n + l(id), 0) / BASE.runs);
  const withAgenda = remotes.filter(id => state.corp.servers[id].root.some(c => cardDef(c).type_code === 'agenda'));
  const pick = [...(withAgenda.length ? withAgenda : remotes)].sort((a, b) => l(b) - l(a))[0];
  STEAL.run = pick ? Math.max(BASE.steal, remoteChance(pick)) : BASE.steal;
}
function truthRates(later: Run[][]): { rate: Record<string, number>; turnShare: Record<string, number> } {
  const rate: Record<string, number> = {};
  const turnShare: Record<string, number> = {};
  for (const t of later) {
    for (const r of t) rate[r.server] = (rate[r.server] ?? 0) + 1 / later.length;
    for (const sv of new Set(t.map(r => r.server))) turnShare[sv] = (turnShare[sv] ?? 0) + 1 / later.length;
  }
  return { rate, turnShare };
}
/** The record predictor (raise-only is applied by setRaised): per open server, (runs + k today) / (turns open + k). */
function recordRates(state: GameState, record: { open: string[]; runs: Run[] }[]): Record<string, number> {
  const t = today(state);
  const out: Record<string, number> = {};
  for (const id of Object.keys(t)) {
    let n = 0;
    let T = 0;
    for (const turn of record) {
      if (!turn.open.includes(id)) continue;
      T++;
      n += turn.runs.filter(r => r.server === id).length;
    }
    out[id] = (n + K * t[id]) / (T + K);
  }
  return out;
}

function clearAll() {
  clearCaches();
  clearBuildTargets();
  clearDeckShares();
  valueLoops?.clear();
}
function ask(s: GameState): string {
  clearAll();
  return JSON.stringify(createAgent('corp', 'normal').chooseAction(structuredClone(s)));
}

/** The Runner turns of the game, by turn number, from the replayed state; a run's kind from the move that started it. */
function runnerTurns(report: { config: { seed: number; corpDeck: never; runnerDeck: never }; moves: GameAction[]; startStops?: never }): Map<number, Run[]> {
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  const out = new Map<number, Run[]>();
  for (const m of report.moves) {
    const before = s.runsThisTurn.length;
    const turn = s.turnNumber;
    const runner = s.activePlayer === 'runner';
    try {
      s = executeAction(s, m);
    } catch {
      break;
    }
    if (runner && s.turnNumber === turn && s.runsThisTurn.length > before) {
      const list = out.get(turn) ?? [];
      for (let i = before; i < s.runsThisTurn.length; i++) list.push({ server: s.runsThisTurn[i].server, successful: false, kind: m.type === 'INITIATE_RUN' ? 'chosen' : 'offered' });
      out.set(turn, list);
    }
    // Success and the final server as the engine recorded them, at the turn's end
    if (runner && s.activePlayer === 'corp' && out.has(turn)) {
      const rec = s.runnerLastTurnRuns;
      out.get(turn)!.forEach((r, i) => rec[i] && Object.assign(r, { server: rec[i].server, successful: rec[i].successful }));
    }
  }
  return out;
}

function game(file: string) {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const src = file.split('/').pop()!;
  const turns = runnerTurns(report);
  const lastTurn = Math.max(0, ...turns.keys());
  valueLoops.clear();
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  const tally = { decisions: 0, null: 0, T1: 0, T2: 0, T3: 0, T2r: 0, T2p: 0, ms: 0 };
  // The Runner turns seen so far, with the servers open at each (for the record predictor)
  const record: { turn: number; open: string[]; runs: Run[] }[] = [];
  let i = 0;
  for (const move of report.moves as GameAction[]) {
    // The servers open as each Runner turn starts (the record predictor's exposure)
    if (s.activePlayer === 'runner' && !record.some(r => r.turn === s.turnNumber)) record.push({ turn: s.turnNumber, open: Object.keys(s.corp.servers), runs: turns.get(s.turnNumber) ?? [] });
    const side = actingSide(s);
    const corpOwn = side === 'corp' && s.activePlayer === 'corp' && !s.winner && !s.activeRun;
    if (corpOwn) {
      const t = performance.now();
      // The Runner's next turn is this turn number (turns count rounds: the Corp's turn n, then the Runner's turn n)
      const next = (turns.get(s.turnNumber) ?? []).map(r => r.server);
      const later: Run[][] = [];
      for (let k = s.turnNumber + 1; k <= lastTurn; k++) later.push(turns.get(k) ?? []);
      const after = truthAfter(s, later.length ? later : [turns.get(s.turnNumber) ?? []]);
      if (RAISE) {
        try {
          setLeaf(null);
          forced = null;
          const base = ask(s);
          const again = ask(s);
          const tr = truthRates(later.length ? later : [turns.get(s.turnNumber) ?? []]);
          setRaised(s, tr.rate, id => tr.turnShare[id] ?? 0);
          const t2r = ask(s);
          // The record: the Runner turns before this Corp turn (turn n's Runner turn follows the Corp's turn n)
          const rr = recordRates(s, record.filter(r => r.turn < s.turnNumber));
          setRaised(s, rr, id => 1 - Math.exp(-(rr[id] ?? 0)));
          const t2p = ask(s);
          setLeaf(null);
          tally.decisions++;
          const ch = { null: again !== base, T2r: t2r !== base, T2p: t2p !== base };
          for (const k of Object.keys(ch) as (keyof typeof ch)[]) if (ch[k]) tally[k]++;
          if (ch.null || ch.T2r || ch.T2p) console.log(JSON.stringify({ src, i, turn: s.turnNumber, next: (turns.get(s.turnNumber) ?? []).map(r => `${r.server}${r.successful ? '+' : '-'}${r.kind === 'offered' ? '(o)' : ''}`).join(' '), base, null: ch.null ? again : '=', T1: '=', T2: ch.T2r ? t2r : '=', T3: ch.T2p ? t2p : '=', arms: 'T2=T2r,T3=T2p' }));
        } catch (e) {
          setLeaf(null);
          console.error(`${src} #${i}: ${(e as Error).message}`);
        }
        tally.ms += performance.now() - t;
        i++;
        try {
          s = executeAction(s, move);
        } catch {
          break;
        }
        continue;
      }
      try {
        setLeaf(null);
        forced = null;
        const base = ask(s);
        const again = ask(s);
        forced = next;
        const t1 = ask(s);
        forced = null;
        setLeaf(after);
        const t2 = ask(s);
        forced = next;
        const t3 = ask(s);
        forced = null;
        setLeaf(null);
        tally.decisions++;
        const ch = { null: again !== base, T1: t1 !== base, T2: t2 !== base, T3: t3 !== base };
        for (const k of Object.keys(ch) as (keyof typeof ch)[]) if (ch[k]) tally[k]++;
        if (ch.null || ch.T1 || ch.T2 || ch.T3)
          console.log(JSON.stringify({ src, i, turn: s.turnNumber, next: (turns.get(s.turnNumber) ?? []).map(r => `${r.server}${r.successful ? '+' : '-'}${r.kind === 'offered' ? '(o)' : ''}`).join(' '), base, null: ch.null ? again : '=', T1: ch.T1 ? t1 : '=', T2: ch.T2 ? t2 : '=', T3: ch.T3 ? t3 : '=', after }));
      } catch (e) {
        forced = null;
        setLeaf(null);
        console.error(`${src} #${i}: ${(e as Error).message}`);
      }
      tally.ms += performance.now() - t;
      i++;
    }
    try {
      s = executeAction(s, move);
    } catch {
      break;
    }
  }
  // Runs by kind, for the counts
  const runs = [...turns.values()].flat();
  console.log(JSON.stringify({ summary: src, ...tally, ms: Math.round(tally.ms), runs: runs.length, offered: runs.filter(r => r.kind === 'offered').length }));
}

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const files = humanFiles().filter(f => JSON.parse(readFileSync(f, 'utf8')).config.ai === (process.env.AI ?? 'corp'));
files.forEach((f, k) => {
  if (k % shards === shard) game(f);
});
