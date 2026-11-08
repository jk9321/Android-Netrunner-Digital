import { describe, expect, it } from 'vitest';
import { HeuristicCorpAI, HeuristicRunnerAI } from '../src/ai';
import { decisionContext, ownHandValue } from '../src/ai/handValues';
import { PLANNER, planTurn, plannerStats } from '../src/ai/turnPlanner';
import { isLegalAction } from '../src/core';
import { simulate } from '../src/ai/prompts';
import { installCorpForTest, newGame, startRunnerTurn } from './helpers';

describe('the whole-turn planner (Jeff, 2026-10-28; plan.turnPlanner)', () => {
  it('picks a legal move for each side from the rule-based AI’s best few', () => {
    const corp = newGame();
    const corpAI = new HeuristicCorpAI();
    const a = corpAI.chooseAction(corp);
    expect(isLegalAction(corp, a)).toBe(true);
    const runner = newGame();
    startRunnerTurn(runner);
    const r = new HeuristicRunnerAI().chooseAction(runner);
    expect(isLegalAction(runner, r)).toBe(true);
  });

  it('only chooses among the candidates it played out (the top few plus the added build and agenda lines), and passes with one or none', () => {
    const s = newGame();
    const ai = new HeuristicCorpAI({ planner: false });
    const ranked = ai.rankMainActions(s);
    let played: string[] = [];
    plannerStats.onCandidates = (_side, _values, actions) => { played = actions.map(a => JSON.stringify(a)); };
    let choice;
    try {
      choice = planTurn(s, 'corp', ranked, { rank: x => ai.rankMainActions(x), answer: x => ai.chooseAction(x) }, true);
    } finally {
      plannerStats.onCandidates = undefined;
    }
    const top = ranked.filter(r => r.score > -Infinity && r.action.type !== 'END_TURN').slice(0, PLANNER.candidates).map(r => JSON.stringify(r.action));
    // The top few are always played; plannerBuild and plannerAgenda add at most PLANNER.withBuild + 2 in all
    for (const t of top) expect(played).toContain(t);
    expect(played.length).toBeLessThanOrEqual(PLANNER.withBuild + 2);
    expect(played).toContain(JSON.stringify(choice));
    expect(planTurn(s, 'corp', ranked.slice(0, 1), { rank: x => ai.rankMainActions(x), answer: x => ai.chooseAction(x) }, true)).toBeNull();
  });

  it('never learns a card it would draw in a playout', () => {
    const s = newGame();
    startRunnerTurn(s);
    decisionContext(s, 'runner');
    const before = ownHandValue(s, 'runner');
    new HeuristicRunnerAI().chooseAction(s);
    // The hand it knows is the same after planning: cards drawn in playouts were never noted as seen
    expect(ownHandValue(s, 'runner')).toBeCloseTo(before);
  });
});

describe('the planner never clicks for 1 credit while a money card pays more for the click (Jeff, 2026-10-30)', () => {
  it('Regolith Mining License: three takes, not a click for a credit first', () => {
    let s = newGame();
    s.activePlayer = 'corp';
    s.corp.credits = 3; // with 3 credits and an empty HQ it used to click for a credit, then take twice
    s.corp.hq = [];
    const id = installCorpForTest(s, '30071', 'remote-1');
    const regolith = s.corp.servers['remote-1'].root.find(c => c.instanceId === id)!;
    regolith.isRezzed = true;
    regolith.tokens.credit = 15;
    const ai = new HeuristicCorpAI();
    const turn: string[] = [];
    while (s.corp.clicks > 0 && turn.length < 4) {
      const action = ai.chooseAction(s);
      turn.push(action.type);
      const next = simulate(s, action);
      if (!next) break;
      s = next;
    }
    expect(turn).not.toContain('GAIN_CREDIT');
    expect(turn[0]).toBe('USE_ABILITY');
  });
});
