import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { GameState, cardDef } from '../src/core';
import { HeuristicRunnerAI } from '../src/ai/runnerAI';
import { tuning } from '../src/ai/synergy';
import { inDecision } from './helpers/pricing';

/**
 * Jeff's Teia game (bug report #28, 2026-11-06; the AI played the Runner): on its turn 8 with 5 credits and 3 clicks,
 * holding DZMZ Optimizer, Fermenter, Sure Gamble and VRcation, the Runner played VRcation (draw 4) over Sure Gamble.
 * Drawing to 7 cards halved what the Corp's damage ice looked worth against it, but the Runner discards down to its
 * maximum hand size at the end of its turn (rule 1.7.2b, 5.7.2a), so the ice faces at most 5 cards on later turns.
 * plan.iceGripCap prices board ice against the capped grip (iceValues iceWorthOf). Position: the replay of that game at
 * the VRcation play (scripts: replay report-28 to the Runner's PLAY_OPERATION_OR_EVENT VRcation).
 */
const position = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/vrcation-sure-gamble.json', import.meta.url), 'utf8'));
const best = (s: GameState) => {
  const rk = inDecision(s, 'runner', () => new HeuristicRunnerAI({ synergy: true, planner: false }).rankMainActions(s));
  const a = rk[0].action as { cardInstanceId?: string };
  return cardDef(s.runner.grip.find(c => c.instanceId === a.cardInstanceId)!).title;
};

describe('board ice priced against a grip no bigger than the hand size (plan.iceGripCap)', () => {
  // On by default since tuning pass 1: the old-way test switches it off
  afterEach(() => { tuning.plan.iceGripCap = true; });

  it('plays Sure Gamble before VRcation', () => {
    expect(best(position())).toBe('Sure Gamble');
  });

  it('the old way, VRcation first', () => {
    tuning.plan.iceGripCap = false;
    expect(best({ ...position(), id: 'vrcation-off' })).toBe('VRcation');
  });
});
