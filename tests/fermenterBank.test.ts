import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, cardDef, findCardAnywhere } from '../src/core';
import { HeuristicRunnerAI, createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { inDecision } from './helpers/pricing';

/**
 * Bug report #17 (Jeff's Corp game 1, 2026-11-05): the Runner held two Fermenters, 10 and 5 counters (30 credits),
 * from turn 10 on while it clicked for credits on 0 to 5 credits, until Jeff's Flyswatter purged them. Each counter
 * was priced at a flat 1.75, and each Fermenter as if its credits were the first the Runner would gain, so a bank of
 * 10 outweighed 20 credits to a broke Runner. plan.fermenterBank prices the whole bank on one stretch of the credit
 * slide, 2% off each counter for every counter banked (a purge takes the lot).
 *
 * Position: the Runner's turn 10 after its first click, 5 credits, 3 clicks, Fermenters on 10 and 5 counters.
 *
 * Restated 2026-11-25 (F108, Jeff's yes in the build thread; ruling in tag-owner/brief-build.md, "Rulings during the build"):
 * the pin was "cashing a Fermenter is the first pick". The fixture holds 2 tags, and that pick held only through the
 * tagged per-turn rate on the banked counters (a tag puts no program at risk, rule 10.5.3), which F108 deletes. On a
 * copy with 0 tags the old code ranked the run first too (run 1.239, Fermenter 1.169, Fermenter 0.572, GAIN_CREDIT -0.113),
 * the same list as now. What #17 was about stays pinned: the bank ranks above clicking for credits, and the Runner
 * cashes it this turn and never clicks for credits while a Fermenter holds counters.
 */
function position(): GameState {
  return JSON.parse(readFileSync(new URL('./fixtures/bug-report-17-fermenters.json', import.meta.url), 'utf8'));
}

const ranked = (s: GameState) =>
  inDecision(s, 'runner', () => new HeuristicRunnerAI({ synergy: true, planner: false }).rankMainActions(s)).map(r => ({
    what: r.action.type === 'USE_ABILITY' ? `use ${cardDef(findCardAnywhere(s, r.action.cardInstanceId)!).title}` : r.action.type,
    score: r.score,
  }));
const banked = (s: GameState) => s.runner.rig.programs.filter(c => cardDef(c).title === 'Fermenter').reduce((n, c) => n + (c.tokens?.virus ?? 0), 0);

describe('a big Fermenter bank is cashed when the Runner is short (plan.fermenterBank)', () => {
  it('ranks cashing either Fermenter above clicking for a credit, on 5 credits with 15 counters banked', () => {
    const list = ranked(position());
    const credit = list.find(r => r.what === 'GAIN_CREDIT')!.score;
    const fermenters = list.filter(r => r.what === 'use Fermenter');
    expect(fermenters).toHaveLength(2);
    for (const f of fermenters) expect(f.score).toBeGreaterThan(credit);
  });

  it('the Normal Runner cashes a Fermenter this turn and never clicks for credits while one holds counters', () => {
    const run = new GameRunner(position(), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
    const turn = run.state.turnNumber;
    let cashed = false;
    for (let i = 0; i < 400 && run.state.turnNumber === turn && run.state.activePlayer === 'runner' && !run.state.winner; i++) {
      const before = run.state;
      if (!run.step()) break;
      const a = run.last;
      if (!a || a.player !== 'runner') continue;
      if (a.type === 'GAIN_CREDIT') expect(banked(before)).toBe(0);
      if (a.type === 'USE_ABILITY' && cardDef(findCardAnywhere(before, a.cardInstanceId)!).title === 'Fermenter') cashed = true;
    }
    expect(cashed).toBe(true);
    expect(banked(run.state)).toBeLessThan(15);
  });
});
