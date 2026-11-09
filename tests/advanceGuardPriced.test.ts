import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { GameAction, GameState, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { HeuristicCorpAI, createAgent } from '../src/ai';
import { tuning } from '../src/ai/synergy';
import { inDecision } from './helpers/pricing';

/**
 * plan.advanceGuardPriced (Phase 2 O2b, opening-audit/report.md): the timing guard in corpAI advanceScore (the agenda
 * can't be scoreable next turn, nothing guards it, or its server is exposed) returned -Infinity, so the advance was in
 * no candidate list and the planner's leaf never saw it. Priced instead (ADVANCE_GUARD_PENALTY below the advance it
 * would be), it reaches the planner through plannerAgenda and the playout decides. Jeff's Corp game report-26, turn 11,
 * last click, 12 credits: every agenda advance was ruled out; priced, the planner plays one out and picks it.
 * Rules: installed agendas can always be advanced (1.18.3; basic action 5.2.6f: a click and 1 credit).
 */
function position(): GameState {
  const report = JSON.parse(readFileSync(new URL('./fixtures/human-games/report-26.json', import.meta.url), 'utf8'));
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  for (const move of report.moves as GameAction[]) {
    if (s.activePlayer === 'corp' && s.turnNumber === 11 && s.corp.clicks === 1 && !s.activeRun && s.pendingPrompts.length === 0 && move.player === 'corp') return structuredClone(s);
    s = executeAction(s, move);
  }
  throw new Error('turn 11 not reached');
}

const defaultOn = tuning.plan.advanceGuardPriced;
afterEach(() => { tuning.plan.advanceGuardPriced = defaultOn; });

const agendaAdvances = (s: GameState) =>
  inDecision(s, 'corp', () => new HeuristicCorpAI({ planner: false }).rankMainActions(s)).filter(r => r.action.type === 'ADVANCE_CARD');

describe('plan.advanceGuardPriced', () => {
  it('report-26 turn 11: a ruled-out advance is priced, not -Infinity, and the planner plays it', () => {
    const s = position();
    tuning.plan.advanceGuardPriced = false;
    const off = agendaAdvances(s);
    expect(off.length).toBeGreaterThan(0);
    expect(off.every(r => r.score === -Infinity)).toBe(true);
    expect(createAgent('corp').chooseAction(s).type).not.toBe('ADVANCE_CARD');
    tuning.plan.advanceGuardPriced = true;
    expect(agendaAdvances(s).some(r => Number.isFinite(r.score))).toBe(true);
    expect(createAgent('corp').chooseAction(s).type).toBe('ADVANCE_CARD');
  });
});
