/**
 * Game logging for AI batches: plays one AI-vs-AI game and records how it
 * ended and where each Runner point came from (which server, how much ice,
 * how advanced the agenda was). Used by ai-match.ts and corp-losses.ts;
 * loss-summary.mjs prints the breakdown.
 */
import { GameState } from '../src/core';
import { cardDef } from '../src/core/cards';
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
  let lastTurn = -1;
  for (let steps = 0; steps < 4000 && runner.state.turnNumber <= 80; steps++) {
    const before = runner.state;
    if (before.turnNumber !== lastTurn && before.activePlayer === 'corp') {
      lastTurn = before.turnNumber;
      const remoteAgenda = Object.entries(before.corp.servers).some(([id, s]) => id.startsWith('remote') && s.root.some(isAgenda));
      if (!remoteAgenda && before.corp.hq.some(isAgenda)) idleAgendaTurns++;
    }
    if (!runner.step()) break;
    const after = runner.state;
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
  };
}
