/**
 * Game logging for AI batches: plays one AI-vs-AI game and records how it
 * ended and where each Runner point came from (which server, how much ice,
 * how advanced the agenda was). Used by ai-match.ts and corp-losses.ts;
 * loss-summary.mjs prints the breakdown.
 */
import { GameState } from '../src/core';
import { cardDef } from '../src/core/cards';
import { rezCost } from '../src/core/engine/cardEffects';
import { Agent, GameRunner } from '../src/ai';

export interface Steal {
  turn: number;
  points: number;
  /** hq, rd, archives, remote, or other (points not from a run) */
  from: string;
  ice: number;
  rezzedIce: number;
  /** Advancement counters on the agenda (remote steals) */
  advanced: number;
  /** The agenda could have been scored already (remote steals) */
  scoreable: boolean;
  corpCredits: number;
  /** Agendas in HQ just before the steal (HQ steals) */
  hqAgendas: number;
  hqSize: number;
  title: string;
  /** Remotes with ice when it was stolen (spread) */
  icedRemotes: number;
  /**
   * Unrezzed ice on the server at the steal: none, 'declined' (the Corp had
   * the credits to rez the cheapest of it and didn't), or 'broke' (it
   * couldn't afford any of it)
   */
  unrezzed?: 'none' | 'declined' | 'broke';
}

export interface GameRecord {
  corpDeck: string;
  runnerDeck: string;
  winner: string;
  reason: string;
  turns: number;
  corpScore: number;
  runnerScore: number;
  steals: Steal[];
  /** Agendas still in R&D / HQ when the game ended */
  agendasInRD: number;
  agendasInHQ: number;
  /** Turns the Corp spent with an agenda in hand and no remote holding one */
  idleAgendaTurns: number;
  /** Averages over the Corp's turns: remotes, remotes with ice, ice in remotes, ice on the best-iced remote, ice on HQ and R&D */
  board: { remotes: number; icedRemotes: number; remoteIce: number; maxRemoteIce: number; hqIce: number; rdIce: number };
  /** Runner runs: how many, and the failed ones where it had already paid to break ice (see RunWaste) */
  runs: RunWaste;
}

/**
 * Runs the Runner paid into (boosting or breaking) and then lost: jacked out
 * or stopped by ice. `known` means the ice that stopped it was rezzed when
 * the run began (it could have budgeted for it); `fresh` means the Corp
 * rezzed it during the run.
 */
export interface RunWaste {
  total: number;
  paidAndFailed: number;
  credits: number;
  jackOutKnown: number;
  jackOutFresh: number;
  stoppedKnown: number;
  stoppedFresh: number;
}

function unrezzedAtSteal(state: GameState, server: GameState['corp']['servers'][string] | undefined): Steal['unrezzed'] {
  const costs = (server?.ice ?? []).filter(i => !i.isRezzed).map(i => rezCost(state, i));
  if (costs.length === 0) return 'none';
  return Math.min(...costs) <= state.corp.credits ? 'declined' : 'broke';
}

const isAgenda = (c: { cardCode: string }) => cardDef(c as never).type_code === 'agenda';

function reasonOf(state: GameState): string {
  const r = state.winReason ?? '';
  if (!state.winner) return 'unfinished';
  if (/flatline/i.test(r)) return 'flatline';
  if (/decked/i.test(r)) return 'corp decked';
  if (/conceded/i.test(r)) return 'conceded';
  return state.winner === 'corp' ? 'corp points' : 'runner points';
}

/** Plays a game to the end (or the step/turn limits) and records it. */
export function playLogged(start: GameState, agents: { corp: Agent; runner: Agent }, decks: { corp: string; runner: string }): GameRecord {
  const runner = new GameRunner(start, agents);
  const steals: Steal[] = [];
  let idleAgendaTurns = 0;
  const board = { remotes: 0, icedRemotes: 0, remoteIce: 0, maxRemoteIce: 0, hqIce: 0, rdIce: 0 };
  let corpTurns = 0;
  let lastTurn = -1;
  const runs: RunWaste = { total: 0, paidAndFailed: 0, credits: 0, jackOutKnown: 0, jackOutFresh: 0, stoppedKnown: 0, stoppedFresh: 0 };
  let rezzedAtStart = new Set<string>();
  let paid = 0;
  let startCredits = 0;
  for (let steps = 0; steps < 4000 && runner.state.turnNumber <= 80; steps++) {
    const before = runner.state;
    if (before.turnNumber !== lastTurn && before.activePlayer === 'corp') {
      lastTurn = before.turnNumber;
      const remoteAgenda = Object.entries(before.corp.servers).some(([id, s]) => id.startsWith('remote') && s.root.some(isAgenda));
      if (!remoteAgenda && before.corp.hq.some(isAgenda)) idleAgendaTurns++;
      const remotes = Object.values(before.corp.servers).filter(s => s.isRemote);
      corpTurns++;
      board.remotes += remotes.length;
      board.icedRemotes += remotes.filter(s => s.ice.length > 0).length;
      board.remoteIce += remotes.reduce((n, s) => n + s.ice.length, 0);
      board.maxRemoteIce += Math.max(0, ...remotes.map(s => s.ice.length));
      board.hqIce += before.corp.servers.hq.ice.length;
      board.rdIce += before.corp.servers.rd.ice.length;
    }
    if (!runner.step()) break;
    const after = runner.state;
    const run = before.activeRun;
    if (!run && after.activeRun) {
      runs.total++;
      paid = 0;
      startCredits = after.runner.credits + after.activeRun.bonusCredits;
      rezzedAtStart = new Set(Object.values(after.corp.servers).flatMap(sv => sv.ice.filter(i => i.isRezzed).map(i => i.instanceId)));
    }
    // Credits spent while the encounter stays open: boosts and breaks (subroutines resolve as it closes)
    const pool = (st: GameState) => st.runner.credits + (st.activeRun?.bonusCredits ?? 0);
    if (run?.encounter && after.activeRun?.encounter && run.encounter.resolvingIndex === null && after.activeRun.encounter.resolvingIndex === null) {
      paid += Math.max(0, pool(before) - pool(after));
    }
    if (run && !after.activeRun) {
      const ended = after.runsThisTurn[after.runsThisTurn.length - 1];
      if (ended && !ended.successful && paid > 0) {
        const ice = before.corp.servers[run.server]?.ice ?? [];
        runs.paidAndFailed++;
        runs.credits += paid;
        if (run.phase === 'movement') {
          // Jacked out: what lay ahead
          const ahead = ice.slice(0, run.icePosition ?? 0).filter(i => i.isRezzed);
          if (ahead.some(i => rezzedAtStart.has(i.instanceId))) runs.jackOutKnown++;
          else runs.jackOutFresh++;
          if (process.env.RUN_DEBUG)
            console.error(
              `JACKOUT ${run.server} credits@start=${startCredits} now=${pool(before)} paid=${paid} ice(out->in)=${[...ice]
                .reverse()
                .map(i => `${cardDef(i).title}${rezzedAtStart.has(i.instanceId) ? '[K]' : i.isRezzed ? '[R]' : '[u]'}`)
                .join(',')} pos=${run.icePosition} bonus=${run.bonusCredits}`
            );
        } else {
          const stopper = run.icePosition !== null ? ice[run.icePosition] : undefined;
          if (stopper && rezzedAtStart.has(stopper.instanceId)) runs.stoppedKnown++;
          else runs.stoppedFresh++;
        }
      }
    }
    const gained = after.runner.score - before.runner.score;
    if (gained <= 0) continue;
    const serverId = before.activeRun?.server ?? after.activeRun?.server ?? null;
    const server = serverId ? before.corp.servers[serverId] : undefined;
    const stolen = after.runner.scoreArea.filter(a => !before.runner.scoreArea.some(b => b.instanceId === a.instanceId));
    const agenda = stolen[0] ? (server?.root.find(x => x.instanceId === stolen[0].instanceId) ?? null) : null;
    const def = agenda ? cardDef(agenda) : null;
    steals.push({
      turn: before.turnNumber,
      points: gained,
      from: !serverId ? 'other' : serverId.startsWith('remote') ? 'remote' : serverId,
      ice: server?.ice.length ?? 0,
      rezzedIce: server?.ice.filter(i => i.isRezzed).length ?? 0,
      advanced: agenda?.advancementCounters ?? 0,
      scoreable: !!agenda && !!def && (agenda.advancementCounters ?? 0) >= (def.advancement_cost ?? 99),
      corpCredits: before.corp.credits,
      hqAgendas: before.corp.hq.filter(isAgenda).length,
      hqSize: before.corp.hq.length,
      title: stolen[0] ? cardDef(stolen[0]).title : '?',
      icedRemotes: Object.values(before.corp.servers).filter(s => s.isRemote && s.ice.length > 0).length,
      unrezzed: unrezzedAtSteal(before, server),
    });
  }
  const s = runner.state;
  return {
    corpDeck: decks.corp,
    runnerDeck: decks.runner,
    winner: s.winner ?? 'draw',
    reason: reasonOf(s),
    turns: s.turnNumber,
    corpScore: s.corp.score,
    runnerScore: s.runner.score,
    steals,
    agendasInRD: s.corp.rd.filter(isAgenda).length,
    agendasInHQ: s.corp.hq.filter(isAgenda).length,
    idleAgendaTurns,
    board: Object.fromEntries(Object.entries(board).map(([k, v]) => [k, v / Math.max(corpTurns, 1)])) as GameRecord['board'],
    runs,
  };
}
