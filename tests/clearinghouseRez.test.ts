/**
 * Phase 2 O4c (opening-audit/report.md; spend audit: Clearinghouse advanced 39 times in losses, never fired; 0 of 119
 * installs fired in run 42558416772). Clearinghouse: "When your turn begins, you may trash this asset to do 1 meat damage
 * for each hosted advancement counter."
 *   8.5.2: "Corp cards are installed facedown, unrezzed, and remain inactive until rezzed."
 *   5.6.1b: "A paid ability window occurs, in which players may use paid abilities, the Corp may rez non-ice cards, and
 *           the Corp may score agendas."  5.6.1d: "The Corp's turn formally begins. Conditions related to the turn
 *           beginning are met."
 * So it has to be rezzed in 5.6.1b to fire at 5.6.1d. The AI treated every Hostile asset as an access trap and never
 * rezzed it on its own turn; both rez gates (corpAI oneCurrencyScore REZ_CARD and rezValue) now read one helper,
 * springsOnAccess (plan.clearinghouseRez).
 */
import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { GameRunner, HeuristicCorpAI, createAgent } from '../src/ai';
import { tuning } from '../src/ai/synergy';
import { installCorpForTest, newGame, passTurn } from './helpers';
import { inDecision } from './helpers/pricing';

const CLEARINGHOUSE = '30061';

function corpTurnStart(counters: number): { s: GameState; id: string } {
  let s = newGame();
  s.corp.credits = 6;
  const id = installCorpForTest(s, CLEARINGHOUSE, 'remote-1', false);
  s.corp.servers['remote-1'].root[0].advancementCounters = counters;
  s = passTurn(s); // the Corp's turn 1 ends
  s = passTurn(s); // the Runner's turn ends: the Corp's draw phase, paid ability window 5.6.1b
  return { s, id };
}

const withSwitch = <T,>(on: boolean, work: () => T): T => {
  const was = tuning.plan.clearinghouseRez;
  tuning.plan.clearinghouseRez = on;
  try {
    return work();
  } finally {
    tuning.plan.clearinghouseRez = was;
  }
};

const top = (s: GameState) => inDecision(s, 'corp', () => new HeuristicCorpAI({ planner: false }).rankMainActions(s))[0].action;

describe('Clearinghouse is rezzed before the Corp turn begins (plan.clearinghouseRez, rules 8.5.2, 5.6.1b-d)', () => {
  it('with counters on it, the window before the turn begins rezzes it', () => {
    const { s, id } = corpTurnStart(3);
    expect(s.turnStep?.kind).toBe('corp_turn_start');
    expect(top(s)).toMatchObject({ type: 'REZ_CARD', cardInstanceId: id });
  });

  it('with no counters it stays unrezzed (nothing to fire)', () => {
    const { s } = corpTurnStart(0);
    expect(top(s).type).toBe('START_TURN');
  });

  it('then the Corp trashes it for the meat damage', () => {
    const { s } = corpTurnStart(3);
    const grip = s.runner.grip.length;
    const gr = new GameRunner(s, { corp: createAgent('corp'), runner: createAgent('runner') });
    for (let i = 0; i < 10 && gr.state.corp.servers['remote-1']; i++) gr.step();
    expect(gr.state.corp.servers['remote-1']).toBeUndefined();
    expect(gr.state.runner.grip.length).toBe(Math.max(0, grip - 3));
  });

  it('switched off, the old rule left it unrezzed', () => {
    const { s } = corpTurnStart(3);
    expect(withSwitch(false, () => top(s)).type).toBe('START_TURN');
  });
});
