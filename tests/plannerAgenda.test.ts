import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { GameAction, GameState, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { withDiagnostics } from '../src/ai/diagnostics';
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
const hiddenDraws = tuning.plan.hiddenDraws;
afterEach(() => { tuning.plan.plannerAgenda = defaultOn; tuning.plan.hiddenDraws = hiddenDraws; });

describe('plan.plannerAgenda', () => {
  it('is on by default', () => expect(defaultOn).toBe(true));

  it('report-17 turn 2: the agenda install is among the candidates only with the switch, and wins its playout', () => {
    // plan.hiddenDraws (S6) OFF here: with the playouts on one guess of R&D the pick is ice on R&D (deal-dependent);
    // this pins the candidate mechanism on the old path. Listed in the S6 hand-off as a known gap.
    tuning.plan.hiddenDraws = false;
    const s = position();
    const target = 'INSTALL_CARD Offworld Office @remote-1';
    const candidates = (on: boolean) => {
      tuning.plan.plannerAgenda = on;
      let seen: string[] = [];
      const pick = withDiagnostics(d => {
        d.onCandidates = (side, _values, actions) => { if (side === 'corp') seen = actions.map(a => describeAction(s, a)); };
        return describeAction(s, createAgent('corp', 'normal').chooseAction(s));
      });
      return { seen, pick };
    };
    const off = candidates(false);
    const on = candidates(true);
    // What the switch changes: the planner's candidate list (not what the rest of the AI picks without it)
    expect(off.seen.length).toBeGreaterThan(0);
    expect(off.seen).not.toContain(target);
    expect(on.seen).toContain(target);
    expect(on.pick).toBe(target);
  });
});
