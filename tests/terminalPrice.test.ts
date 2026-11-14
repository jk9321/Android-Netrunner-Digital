import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, cardDef, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { pointValue, pointsTerm, sampledEndWorth } from '../src/ai/valueModel';
import { runnerReply } from '../src/ai/runnerReply';
import { tuning } from '../src/ai/synergy';
import { plannerStats } from '../src/ai/turnPlanner';

/**
 * Audit Step 1 (spec-step1-terminal-price.md, bars/terminal-price.md): a game end inside a SAMPLED Runner reply is one deal of
 * hidden cards, priced on the point clock (winner 7, the loser forfeits the rest of its game; 1.7.2a-c) from the reply root's board, not evaluate's ±1000.
 */
describe('sampledEndWorth: the winner\'s 7, the loser forfeits the rest of its game, from the reply root\'s board', () => {
  const withScores = (corp: number, runner: number) => ({ corp: { score: corp }, runner: { score: runner } }) as unknown as GameState;
  it('a Runner win costs pointValue(7) plus what the Corp could still have scored, on top of the root board', () => {
    for (const board of [-40, 0, 102]) {
      expect(sampledEndWorth('runner', board, withScores(2, 4))).toBeCloseTo(board - pointValue(7) - (pointValue(7) - pointValue(2)));
      expect(sampledEndWorth('corp', board, withScores(5, 6))).toBeCloseTo(board + pointValue(7) + (pointValue(7) - pointValue(6)));
    }
  });

  it('a near loss is not cheap: the Runner one point from 7 or four points from it, the same price', () => {
    expect(sampledEndWorth('runner', 50, withScores(3, 6))).toBeCloseTo(sampledEndWorth('runner', 50, withScores(3, 3)));
  });

  it('runnerReply prices a sampled end from the root, not the leaf\'s ±1000', () => {
    const root = { ...report(51, 33), winner: null };
    const leaf = (s: GameState) => (s.winner ? 1000 : 60 + pointsTerm(s) + s.runner.credits);
    const ended = (winner: 'corp' | 'runner', credit: number) => ({ ...root, winner, runner: { ...root.runner, credits: credit } }) as GameState;
    // A game already over at the root ends every sample on the spot: two different end boards, one price
    const rootBoard = (s: GameState) => leaf({ ...s, winner: null }) - pointsTerm(s);
    const was = tuning.plan.terminalClock;
    tuning.plan.terminalClock = true;
    try {
      for (const credit of [0, 9]) {
        expect(runnerReply(ended('runner', credit), true, leaf)).toBeCloseTo(rootBoard(ended('runner', credit)) - pointValue(7) - (pointValue(7) - pointValue(root.corp.score)));
        expect(runnerReply(ended('corp', credit), true, leaf)).toBeCloseTo(rootBoard(ended('corp', credit)) + pointValue(7) + (pointValue(7) - pointValue(root.runner.score)));
      }
    } finally {
      tuning.plan.terminalClock = was;
    }
  });
});

/** The planner's candidate values at a decision (plannerStats.onCandidates), by the action's card title or type. */
function candidates(s: GameState): { name: string; value: number }[] {
  const out: { name: string; value: number }[] = [];
  const all = [...s.corp.hq, ...Object.values(s.corp.servers).flatMap(v => [...v.ice, ...v.root])];
  plannerStats.onCandidates = (side, values, acts) => {
    if (side !== 'corp' || out.length) return;
    acts.forEach((a, i) => {
      const x = a as GameAction & { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean };
      const c = all.find(y => y.instanceId === x.cardInstanceId);
      out.push({ name: `${x.type}${c ? ' ' + cardDef(c).title : ''}${x.targetServerId ? ' ' + x.targetServerId : x.asNewRemote ? ' new' : ''}`, value: values[i] });
    });
  };
  try {
    createAgent('corp', 'normal').chooseAction(structuredClone(s));
  } finally {
    plannerStats.onCandidates = undefined;
  }
  return out;
}
const report = (n: number, move: number): GameState => {
  const r = JSON.parse(readFileSync(new URL(`./fixtures/human-games/report-${n}.json`, import.meta.url), 'utf8'));
  let s: GameState = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  for (const m of (r.moves as GameAction[]).slice(0, move)) s = executeAction(s, m);
  return s;
};

describe('planner lines with a sampled game end', () => {
  // Jeff's #51 #33: Tithe to a new remote read 501.4 (one sampled Corp win at +1000 in a two-sample mean)
  it('#51 #33: no line is near 500', () => {
    const values = candidates(report(51, 33));
    expect(values.length).toBeGreaterThan(1);
    expect(Math.max(...values.map(v => v.value))).toBeLessThan(100);
  });

  // Self-play deal 1201 T18: Draw read -476 and advance Pharos -479 (a sampled Runner win at -1000 each)
  it('1201 T18: Draw and advance Pharos are above -100', () => {
    const s: GameState = JSON.parse(readFileSync(new URL('./fixtures/terminal-1201-t18.json', import.meta.url), 'utf8'));
    const values = candidates(s);
    const draw = values.find(v => v.name === 'DRAW_CARD');
    const pharos = values.find(v => v.name.includes('Pharos'));
    expect(draw?.value).toBeGreaterThan(-100);
    expect(pharos?.value).toBeGreaterThan(-100);
  });
});
