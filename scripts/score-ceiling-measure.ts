/**
 * Counted scoring (spec /mnt/project-files/netrunner-ai/redesign/spec-counted-scoring.md; first written for stage 0b,
 * spec-stage0b.md): the per-game measures a corp-losses batch adds when its PLAN_OFF names plan.scoreNow or
 * plan.scoreInTwo in either form ("scoreNow" off, "+scoreNow" on: a base names them off while they default off).
 * Measurement only: the moves are read from GameRunner.apply as plan-measure-record.ts reads them, and nothing the
 * agents see or decide changes.
 *
 * Each game gets `stage0b`: stage 0's turn labels (labelTurn) counted over the Corp's turns, the Corp turn of its first
 * score, the two layers' own counts (winNow.ts scoreNowStats, countedScore.ts scoreInTwoStats) and what became of each
 * two-turn line begun.
 */
import { GameAction } from '../src/core';
import { GameRunner } from '../src/ai/playout';
import { resetScoreInTwoStats, scoreInTwoStats } from '../src/ai/countedScore';
import { scoreNowStats } from '../src/ai/winNow';
import { labelTurn, replayGame } from './plan-measure-lib';
import type { DeckList } from '../src/data/decks';

export const measuring = /(^|,)\+?(scoreNow|scoreInTwo)(,|$)/.test(process.env.PLAN_OFF ?? '');

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

let nowFound = 0;
let nowChoices = 0;
/** Before each game: the agents whose moves to keep, the layers' counts cleared. */
export function startMeasure(pair: object) {
  agents = pair;
  moves = [];
  resetScoreInTwoStats();
  nowFound = scoreNowStats.found;
  nowChoices = scoreNowStats.choices;
}

export interface Stage0bGame {
  /** Corp turns replayed, and the stage 0 label of each, counted (score, kill, build, shore, money, mixed). */
  corpTurns: number;
  labels: Record<string, number>;
  /** The Corp turn (1 = its first) that ended with its first point scored, or null. */
  firstScore: number | null;
  /** plan.scoreNow: decisions where its search found a score this turn. */
  nowFound: number;
  /** Of those, decisions where more than one agenda could be scored. */
  nowChoices: number;
  /** plan.scoreInTwo: lines begun, steps played over the Corp's pick, spare-click picks vetoed, lines dropped, finished. */
  two: { begun: number; steps: number; vetoed: number; dropped: number; finished: number };
  /** Each two-turn line begun: its form and the agenda's fate. */
  lines: { form: string; end: 'scoredNext' | 'scoredLater' | 'stolen' | 'trashed' | 'other' }[];
  /** False when the replay stopped short of the game's end (a move the engine refused). */
  replayed: boolean;
}

/** After each game: replays the recorded moves into Corp turns and counts the measures. */
export function stage0bMeasure(seed: number, corpDeck: DeckList, runnerDeck: DeckList): Stage0bGame | { error: string } {
  try {
    const found = scoreNowStats.found - nowFound;
    const choices = scoreNowStats.choices - nowChoices;
    const two = { begun: scoreInTwoStats.begun, steps: scoreInTwoStats.steps, vetoed: scoreInTwoStats.vetoed, dropped: scoreInTwoStats.dropped, finished: scoreInTwoStats.finished };
    const begunLines = [...scoreInTwoStats.lines];
    const game = replayGame({ config: { seed, corpDeck, runnerDeck, ai: 'both' }, moves });
    const labels: Record<string, number> = {};
    for (const t of game.turns) {
      const { shape } = labelTurn(t);
      labels[shape] = (labels[shape] ?? 0) + 1;
    }
    const first = game.turns.findIndex(t => t.end.corp.score > 0);
    const corpTurnOf = new Map(game.turns.map((t, i) => [t.turn, i]));
    const lines = begunLines.map(l => {
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
      return { form: l.form, end };
    });
    return {
      corpTurns: game.turns.length,
      labels,
      firstScore: first >= 0 ? first + 1 : null,
      nowFound: found,
      nowChoices: choices,
      two,
      lines,
      replayed: !!game.winner,
    };
  } catch (err) {
    return { error: `${err}`.slice(0, 200) };
  }
}
