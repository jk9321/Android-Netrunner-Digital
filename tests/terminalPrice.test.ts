import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, cardDef, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { flatlineWorth, pointValue, sampledEndWorth } from '../src/ai/valueModel';
import { plannerStats } from '../src/ai/turnPlanner';

/**
 * Audit Step 1 (spec-step1-terminal-price.md, bars/terminal-price.md): a game end inside a SAMPLED Runner reply is one deal of
 * hidden cards, priced on the point clock (winner 7, loser 0; 1.7.2a-c), not evaluate's ±1000.
 */
const withScores = (corp: number, runner: number, winner: 'corp' | 'runner' | null) => ({ corp: { score: corp }, runner: { score: runner }, winner }) as unknown as GameState;

describe('sampledEndWorth: the points term settled to winner 7, loser 0', () => {
  it('a flatline (Corp wins under 7) is flatlineWorth', () => {
    const s = withScores(3, 4, 'corp');
    expect(sampledEndWorth(s)).toBeCloseTo(flatlineWorth(s));
  });

  it('a Runner points win and the Corp decked both settle to -pointValue(7) on the points term', () => {
    for (const s of [withScores(2, 7, 'runner'), withScores(5, 3, 'runner')]) expect(sampledEndWorth(s) + pointValue(s.corp.score) - pointValue(s.runner.score)).toBeCloseTo(-pointValue(7));
  });

  it('a Corp points win settles to +pointValue(7); no game end adds nothing', () => {
    const s = withScores(7, 6, 'corp');
    expect(sampledEndWorth(s) + pointValue(7) - pointValue(6)).toBeCloseTo(pointValue(7));
    expect(sampledEndWorth(withScores(3, 3, null))).toBe(0);
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
