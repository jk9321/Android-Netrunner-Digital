/**
 * Corp redesign stage 0b (spec /mnt/project-files/netrunner-ai/redesign/spec-stage0b.md): the per-game measures a
 * corp-losses batch adds when its PLAN_OFF names oracle.countedScore or oracle.centralsLight (the base names them off,
 * "oracle.countedScore,oracle.centralsLight", a no-op that turns the measures on). Measurement only: the moves are
 * read from GameRunner.apply as plan-measure-record.ts reads them, and nothing the agents see or decide changes.
 *
 * Each game gets `stage0b`: stage 0's turn labels (labelTurn) counted over the Corp's turns, the Corp turn of its first
 * score, and the instruments' own counts (countedScore.ts countedStats) with what became of each forced line.
 */
import { GameAction } from '../src/core';
import { GameRunner } from '../src/ai/playout';
import { countedStats, resetCountedStats } from '../src/ai/countedScore';
import { labelTurn, replayGame } from './plan-measure-lib';
import type { DeckList } from '../src/data/decks';

export const measuring = /(^|,)\+?(oracle\.)?(countedScore|countedStrict|centralsLight)(,|$)/.test(process.env.PLAN_OFF ?? '');

let moves: GameAction[] = [];
let agents: object | null = null;
if (measuring) {
  const apply = GameRunner.prototype.apply;
  // Only the game's own runner records: the AI's look-ahead plays its own GameRunners with other agents
  GameRunner.prototype.apply = function (this: GameRunner, action: GameAction) {
    if ((this as unknown as { agents: object }).agents === agents) moves.push(action);
    apply.call(this, action);
  };
}

/** Before each game: the agents whose moves to keep, the instruments' counts cleared. */
export function startMeasure(pair: object) {
  agents = pair;
  moves = [];
  resetCountedStats();
}

export interface Stage0bGame {
  /** Corp turns replayed, and the stage 0 label of each, counted (score, kill, build, shore, money, mixed). */
  corpTurns: number;
  labels: Record<string, number>;
  /** The Corp turn (1 = its first) that ended with its first point scored, or null. */
  firstScore: number | null;
  nowFound: number;
  nowForced: number;
  stepsForced: number;
  restVetoed: number;
  centralHeld: number;
  /** Each forced two-turn line: its form, the check's verdict at the next Corp turn, and the agenda's fate. */
  lines: { form: string; next: string; end: 'scoredNext' | 'scoredLater' | 'stolen' | 'trashed' | 'other' }[];
  /** False when the replay stopped short of the game's end (a move the engine refused). */
  replayed: boolean;
}

/** After each game: replays the recorded moves into Corp turns and counts the measures. */
export function stage0bMeasure(seed: number, corpDeck: DeckList, runnerDeck: DeckList): Stage0bGame | { error: string } {
  try {
    const game = replayGame({ config: { seed, corpDeck, runnerDeck, ai: 'both' }, moves });
    const labels: Record<string, number> = {};
    for (const t of game.turns) {
      const { shape } = labelTurn(t);
      labels[shape] = (labels[shape] ?? 0) + 1;
    }
    const first = game.turns.findIndex(t => t.end.corp.score > 0);
    const corpTurnOf = new Map(game.turns.map((t, i) => [t.turn, i]));
    const lines = countedStats.lines.map(l => {
      const scoredAt = game.turns.find(t => t.end.corp.scoreArea.some(c => c.instanceId === l.agendaId));
      const stolen = game.final.runner.scoreArea.some(c => c.instanceId === l.agendaId);
      // Trashed: accessed and trashed by the Runner, or by the Corp itself, it ends in Archives
      const trashed = [...game.final.corp.archives.faceUp, ...game.final.corp.archives.faceDown].some(c => c.instanceId === l.agendaId);
      const begun = corpTurnOf.get(l.turn);
      const end: Stage0bGame['lines'][number]['end'] = scoredAt
        ? begun !== undefined && corpTurnOf.get(scoredAt.turn) === begun + 1
          ? 'scoredNext'
          : 'scoredLater'
        : stolen
          ? 'stolen'
          : trashed
            ? 'trashed'
            : 'other';
      return { form: l.form, next: l.next ?? 'none', end };
    });
    return {
      corpTurns: game.turns.length,
      labels,
      firstScore: first >= 0 ? first + 1 : null,
      nowFound: countedStats.nowFound,
      nowForced: countedStats.nowForced,
      stepsForced: countedStats.stepsForced,
      restVetoed: countedStats.restVetoed,
      centralHeld: countedStats.centralHeld,
      lines,
      replayed: !!game.winner,
    };
  } catch (err) {
    return { error: `${err}`.slice(0, 200) };
  }
}
