/**
 * Race-clock calibration (tuning pass 1, plan.raceClock piece 0; src/ai/clock.ts). At the start of every Runner turn
 * (the board the Corp left), the clock's runnerRate, as the Corp sees it, against the agenda points the Runner then took:
 * on that turn, and over the next 3 Runner turns (the rate times the turns that were played). At the start of every
 * Corp turn, the Corp's points over its next 3 turns, by its score: the measured corpRate table. A report, not a knob.
 *   npx vite-node scripts/race-calibration.ts -- human [dir]          (Jeff's Corp games: tests/fixtures/human-games)
 *   SHARD=i/n npx vite-node scripts/race-calibration.ts -- self [games per pairing] > race-i.json
 *   node scripts/race-calibration-sum.mjs race-*.json
 * The batch workflow's script=race-calibration runs the self mode and sums the shards with race-calibration-sum.mjs.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GameAction, GameState, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { applyPlanOff, asSide } from '../src/ai/synergy';
import { clock, runnerRateParts } from '../src/ai/clock';
import { turnsLeft } from '../src/ai/cardProfiles';
import { ALL_DECKS as DECKS } from './nsg-sample-decks';
// @ts-expect-error plain JS, shared with the batch workflow's summary job
import { fresh, print, sum } from './race-calibration-sum.mjs';
applyPlanOff(process.env.PLAN_OFF ?? '');

/** One Runner turn's start: the clock, and the Runner's score then. */
interface Mark { score: number; corpScore: number; rate: number; parts: Record<string, number>; turn: number; lateStep: number; openStep: number }
/** One Corp turn's start: the Corp's score then. */
interface CorpMark { score: number; runnerScore: number; turn: number }

const bucket = (score: number) => (score <= 2 ? '0-2' : score <= 4 ? '3-4' : '5-6');
const rateBucket = (r: number) => (r < 0.1 ? '<0.1' : r < 0.3 ? '0.1-0.3' : r < 0.6 ? '0.3-0.6' : r < 1 ? '0.6-1' : '1+');

/** Adds one game's marks: `scores[i]` is the Runner's score after its i-th turn in `marks`, `corpScores` the same for the Corp. */
function addGame(stats: ReturnType<typeof fresh>, marks: Mark[], after: number[], corpMarks: CorpMark[], corpAfter: number[]) {
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    const next = after[i] - m.score;
    const turns = Math.min(3, marks.length - i);
    const three = after[i + turns - 1] - m.score;
    const add = (key: string, table: Record<string, { n: number; predicted: number; observed: number; predicted3: number; observed3: number; turns3: number; lateStep?: number; openStep?: number }>) => {
      const c = (table[key] ??= { n: 0, predicted: 0, observed: 0, predicted3: 0, observed3: 0, turns3: 0 });
      c.n++;
      c.predicted += m.rate;
      c.observed += next;
      c.predicted3 += m.rate * turns;
      c.observed3 += three;
      c.turns3 += turns;
      c.lateStep = (c.lateStep ?? 0) + m.lateStep;
      c.openStep = (c.openStep ?? 0) + m.openStep;
    };
    add(`runner ${bucket(m.score)}`, stats.byScore);
    add(`corp ${bucket(m.corpScore)}`, stats.byCorpScore);
    add(rateBucket(m.rate), stats.byRate);
    add('all', stats.byScore);
    for (const [k, v] of Object.entries(m.parts)) stats.parts[k] = (stats.parts[k] ?? 0) + v;
  }
  for (let i = 0; i < corpMarks.length; i++) {
    const m = corpMarks[i];
    const turns = Math.min(3, corpMarks.length - i);
    const c = (stats.corp[String(m.score)] ??= { n: 0, points: 0, turns: 0, next: 0 });
    c.n++;
    c.next += corpAfter[i] - m.score;
    c.points += corpAfter[i + turns - 1] - m.score;
    c.turns += turns;
  }
  stats.turns += marks.length;
  stats.games++;
}

function mark(s: GameState): Mark {
  return asSide('corp', () => {
    const c = clock(s);
    return { score: s.runner.score, corpScore: s.corp.score, rate: c.runnerRate, parts: { ...runnerRateParts(s) }, turn: s.turnNumber, lateStep: 1 / turnsLeft(s), openStep: 1 - c.open(1) };
  });
}

/** Plays a game through `step` (returns the state after each action, or null at the end) and marks turn starts. */
function track(states: Iterable<[GameState, GameState]>, stats: ReturnType<typeof fresh>) {
  const marks: Mark[] = [];
  const after: number[] = [];
  const corpMarks: CorpMark[] = [];
  const corpAfter: number[] = [];
  for (const [before, s] of states) {
    if (before.activePlayer !== 'runner' && s.activePlayer === 'runner') marks.push(mark(s));
    if (before.activePlayer === 'runner' && s.activePlayer !== 'runner' && marks.length > after.length) after.push(s.runner.score);
    if (before.activePlayer !== 'corp' && s.activePlayer === 'corp') corpMarks.push({ score: s.corp.score, runnerScore: s.runner.score, turn: s.turnNumber });
    if (before.activePlayer === 'corp' && s.activePlayer !== 'corp' && corpMarks.length > corpAfter.length) corpAfter.push(s.corp.score);
    if (s.winner) {
      if (marks.length > after.length) after.push(s.runner.score);
      if (corpMarks.length > corpAfter.length) corpAfter.push(s.corp.score);
      break;
    }
  }
  addGame(stats, marks.slice(0, after.length), after, corpMarks.slice(0, corpAfter.length), corpAfter);
}

function human(dir: string) {
  const stats = fresh();
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const report = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    // Jeff's Corp games: the AI played the Runner
    if (!report.moves?.length || report.config.ai !== 'runner') continue;
    let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
    if (report.startStops) s = { ...s, stops: report.startStops };
    function* states(): Generator<[GameState, GameState]> {
      for (const move of report.moves as GameAction[]) {
        const before = s;
        s = executeAction(s, move);
        yield [before, s];
      }
    }
    try {
      track(states(), stats);
    } catch (err) {
      console.error(`${file}: ${err}`);
    }
  }
  return stats;
}

function self(games: number) {
  const stats = fresh();
  const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
  let seed = 1000;
  let deal = 0;
  for (const c of DECKS.filter(d => d.side === 'corp')) for (const r of DECKS.filter(d => d.side === 'runner')) for (let g = 0; g < games; g++) {
    seed++;
    if (deal++ % shards !== shard) continue;
    const gr = new GameRunner(createInitialGameState(deckGameSetup(seed, c, r)), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
    function* states(): Generator<[GameState, GameState]> {
      for (let steps = 0; steps < 4000 && gr.state.turnNumber <= 80 && !gr.state.winner; steps++) {
        const before = gr.state;
        if (!gr.step()) break;
        yield [before, gr.state];
      }
    }
    try {
      track(states(), stats);
    } catch (err) {
      console.error(`${c.id} v ${r.id}: ${err}`);
    }
  }
  return stats;
}

const args = process.argv.slice(2).filter(a => a !== '--');
const numeric = /^\d+$/.test(args[0] ?? '');
const mode = numeric ? 'self' : args[0] ?? 'human';
if (numeric) args.unshift('self');
if (mode === 'human') print(human(args[1] ?? 'tests/fixtures/human-games'));
else if (mode === 'self') console.log(JSON.stringify(self(Number(args[1] ?? 1))));
else if (mode === 'sum') print(sum(args.slice(1)));
