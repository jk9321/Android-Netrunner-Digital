import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, cardDef, executeAction } from '../src/core';
import { agendaWorth } from '../src/ai/evaluate';
import { HeuristicCorpAI, createAgent } from '../src/ai';
import { tuning } from '../src/ai/synergy';

/**
 * Jeff's bug report (issue #2, 2026-10-31; LEO Construction vs Vic, Hard Corp): at 0 credits
 * with Petty Cash x3 and Hedge Fund in HQ, the Corp installed agenda after agenda in bare
 * remotes (turns 14-19) instead of clicking for credits, and the Runner took three of them in
 * one turn. Advancing is "[click], 1[credit]" (rule 5.2.6), so at 0 credits an agenda can't be
 * finished this turn on clicks alone. Agenda tempo counted only clicks: a bare agenda the Corp
 * had 3 clicks for looked scoreable this turn, every click spent looked like a lost score,
 * and taking a credit ranked far below another bare install.
 *
 * The fixture is the reported game rebuilt at the start of the Corp's turn 17 (the steals and
 * installs of turns 17-19 put back): 0 credits; HQ Petty Cash x3, Hedge Fund, Project Ingatan,
 * Méliès City Luxury Line, Anthill Excavation Contract; Méliès bare in Remote 4, Project Ingatan bare in Remote 9.
 */
const turn17 = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/bug-report-2-turn17.json', import.meta.url), 'utf8'));

const bareAgendas = (s: GameState) =>
  Object.values(s.corp.servers).filter(sv => sv.isRemote && sv.ice.length === 0 && sv.root.some(c => cardDef(c).type_code === 'agenda')).length;

function playTurn(s: GameState, corp = createAgent('corp', 'normal')): GameState {
  for (let i = 0; i < 20 && s.activePlayer === 'corp' && !s.winner; i++) {
    const action = corp.chooseAction(s);
    s = executeAction(s, action);
    if (action.type === 'END_TURN') break;
  }
  return s;
}

describe('a Corp with no credits (Jeff’s bug report, plan.agendaCredits)', () => {
  it('an agenda it can’t pay to advance is not counted as scored this turn', () => {
    const s = turn17();
    const rich = { ...s, corp: { ...s.corp, credits: 3 } };
    expect(agendaWorth(s, 0, 3, 2, 'remote-9')).toBeLessThan(agendaWorth(rich, 0, 3, 2, 'remote-9') - 5);
  });

  it('ranks taking a credit above another bare agenda', () => {
    const s = turn17();
    const ranked = new HeuristicCorpAI({ planner: false }).rankMainActions(s);
    const credit = ranked.findIndex(r => r.action.type === 'GAIN_CREDIT');
    const bare = ranked.findIndex(r => r.action.type === 'INSTALL_CARD' && r.action.asNewRemote && cardDef(s.corp.hq.find(c => c.instanceId === (r.action as { cardInstanceId: string }).cardInstanceId)!).type_code === 'agenda');
    expect(credit).toBeGreaterThanOrEqual(0);
    expect(credit).toBeLessThan(bare);
  });

  it('installs no more bare agendas (Normal and Hard)', () => {
    expect(bareAgendas(turn17())).toBe(2);
    expect(bareAgendas(playTurn(turn17()))).toBe(2);
    expect(bareAgendas(playTurn(turn17(), createAgent('corp', 'hard', { samples: 6, seed: 1 })))).toBe(2);
  }, 60_000);

  it('the old way (plan off) is what the report saw', () => {
    const was = tuning.plan.agendaCredits;
    tuning.plan.agendaCredits = false;
    try {
      expect(bareAgendas(playTurn(turn17(), createAgent('corp', 'hard', { samples: 6, seed: 1 })))).toBeGreaterThan(2);
    } finally {
      tuning.plan.agendaCredits = was;
    }
  }, 60_000);
});
