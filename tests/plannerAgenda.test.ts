import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { GameAction, GameState, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { tuning } from '../src/ai/synergy';

/**
 * plan.plannerAgenda (install-worth side check, probe P3, 2026-11-08): Jeff's Corp game, report-17 turn 2 with 2 clicks
 * left. He installed Offworld Office in remote-1 (behind ice) and went on to score it. The rule ranking charges the
 * installed agenda its whole steal and advancement cost at once, so the planner's 4 candidates left it out and the AI
 * built instead, though the turn played out from Jeff's move ends better at the leaf (29.31 against 24.33,
 * scripts/leaf-decompose.ts). With the switch the agenda install is a candidate and wins its playout.
 * Rules: an installed agenda can always be advanced (1.18.3) and is scored once its counters reach its advancement
 * requirement (1.17.3a).
 */
function position(): GameState {
  const report = JSON.parse(readFileSync(new URL('./fixtures/human-games/report-17.json', import.meta.url), 'utf8'));
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  for (const move of report.moves as GameAction[]) {
    if (s.activePlayer === 'corp' && s.turnNumber === 2 && s.corp.clicks === 2 && !s.activeRun && s.pendingPrompts.length === 0 && move.player === 'corp') return s;
    s = executeAction(s, move);
  }
  throw new Error('turn 2 not reached');
}

const describeAction = (s: GameState, a: GameAction) => {
  const card = 'cardInstanceId' in a && a.cardInstanceId ? findCardAnywhere(s, a.cardInstanceId) : undefined;
  return `${a.type}${card ? ' ' + cardDef(card).title : ''}${'targetServerId' in a && a.targetServerId ? ' @' + a.targetServerId : ''}`;
};

const defaultOn = tuning.plan.plannerAgenda;
afterEach(() => { tuning.plan.plannerAgenda = defaultOn; });

describe('plan.plannerAgenda', () => {
  it('is off by default', () => expect(defaultOn).toBe(false));

  it('report-17 turn 2: installs Offworld Office behind remote-1\'s ice, as Jeff did', () => {
    const s = position();
    tuning.plan.plannerAgenda = false;
    const off = describeAction(s, createAgent('corp', 'normal').chooseAction(s));
    tuning.plan.plannerAgenda = true;
    const on = describeAction(s, createAgent('corp', 'normal').chooseAction(s));
    expect(off).not.toBe('INSTALL_CARD Offworld Office @remote-1');
    expect(on).toBe('INSTALL_CARD Offworld Office @remote-1');
  });
});
