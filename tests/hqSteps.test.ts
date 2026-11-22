import { describe, expect, it } from 'vitest';
import { GameAction, GameState, cardDef, createCardInstance, executeAction } from '../src/core';
import { createAgent } from '../src/ai';
import { HeuristicCorpAI } from '../src/ai/corpAI';
import { installCorpForTest, newGame } from './helpers';

// Jeff 2026-11-22: "the Corp AI activates Humanoid Resources ... but never carries out the card's steps". Humanoid
// Resources: "[click][click][click], [trash]: Gain 4 credits and draw 3 cards. Install up to 2 cards from HQ (one at a
// time). You may play 1 operation from HQ." The installs and the play spend no click (rule 5.2.6: only a Corp action
// does) but pay their install and play costs (rules 1.16.6, 1.16.7). The engine offered each step; the Corp declined
// all three (an install pick ties with the decline one step ahead; the play paid the hand's half-keep). corp/hqSteps.ts.

const HUMANOID = '35039';
const PALISADE = '30072';
const NICO = '30037';
const HEDGE_FUND = '30075';

/** The Corp has just used Humanoid Resources: HQ holds Palisade, Nico Campaign and Hedge Fund, plus the 3 cards drawn. */
function afterUse(): GameState {
  let s = newGame(5);
  const hr = installCorpForTest(s, HUMANOID, 'remote-1', true);
  s.corp.hq = [createCardInstance(s, PALISADE), createCardInstance(s, NICO), createCardInstance(s, HEDGE_FUND)];
  s.corp.credits = 10;
  s = executeAction(s, { type: 'USE_ABILITY', player: 'corp', cardInstanceId: hr, abilityIndex: 0 });
  return s;
}

/** Answers the Corp's prompts with `decide` until none is left. */
function answerAll(s: GameState, decide: (s: GameState) => GameAction): GameState {
  for (let i = 0; i < 10 && s.pendingPrompts.length > 0; i++) s = executeAction(s, decide(s));
  return s;
}

const installed = (s: GameState) => Object.values(s.corp.servers).flatMap(v => [...v.ice, ...v.root]).map(c => cardDef(c).title);

describe('Humanoid Resources: the Corp carries out its steps (corp/hqSteps.ts)', () => {
  it('the deciding Corp installs 2 cards from HQ and plays Hedge Fund', { timeout: 60_000 }, () => {
    const corp = createAgent('corp', 'normal');
    const s0 = afterUse();
    expect(s0.pendingPrompts[0]?.kind).toBe('effect_cards');
    const credits = s0.corp.credits;
    const s = answerAll(s0, x => corp.chooseAction(x));
    expect(installed(s)).toHaveLength(2);
    expect(s.corp.hq.some(c => c.cardCode === HEDGE_FUND)).toBe(false);
    expect(s.corp.archives.faceUp.some(c => c.cardCode === HEDGE_FUND)).toBe(true);
    // Hedge Fund: pay 5, gain 9; the ice's install cost is paid too (1.16.6)
    expect(s.corp.credits).toBeGreaterThan(credits);
  });

  it('the planner’s rollouts (no counted questions) keep the fallback’s answers', { timeout: 60_000 }, () => {
    const rollout = new HeuristicCorpAI({ planner: false });
    const s = answerAll(afterUse(), x => rollout.chooseAction(x));
    expect(installed(s)).toHaveLength(0);
  });
});
