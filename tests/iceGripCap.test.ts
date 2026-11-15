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
// The scores of the main actions by what they play (a card's title, or the action type for the rest)
const scores = (s: GameState) => {
  const rk = inDecision(s, 'runner', () => new HeuristicRunnerAI({ synergy: true, planner: false }).rankMainActions(s));
  const out = new Map<string, number>();
  for (const r of rk) {
    const a = r.action as { type: string; cardInstanceId?: string; targetServerId?: string };
    const card = a.cardInstanceId ? s.runner.grip.find(c => c.instanceId === a.cardInstanceId) : undefined;
    const key = card ? cardDef(card).title : a.targetServerId ? `${a.type} ${a.targetServerId}` : a.type;
    if (!out.has(key)) out.set(key, r.score);
  }
  return out;
};

describe('board ice priced against a grip no bigger than the hand size (plan.iceGripCap)', () => {
  // On by default since tuning pass 1: the old-way test switches it off
  afterEach(() => { tuning.plan.iceGripCap = true; });

  // Compared card to card, not as the top action: the run on remote-2 (below) can rank first in this position
  it('plays Sure Gamble before VRcation, and above a click for a credit', () => {
    const sc = scores(position());
    expect(sc.get('Sure Gamble')!).toBeGreaterThan(sc.get('VRcation')!);
    expect(sc.get('Sure Gamble')!).toBeGreaterThan(sc.get('GAIN_CREDIT')!);
  });

  // Since the run choice reads the draw-back (RM-DRAWBACK-RUN-START) the run on remote-2 ranks first and every card play
  // pays the click it takes from that run, so the old way no longer puts VRcation first: it closes most of the gap
  it('the old way, VRcation level with Sure Gamble and far above its capped score', () => {
    const on = scores({ ...position(), id: 'vrcation-on' });
    tuning.plan.iceGripCap = false;
    const off = scores({ ...position(), id: 'vrcation-off' });
    expect(off.get('VRcation')!).toBeGreaterThan(on.get('VRcation')! + 5);
    expect(off.get('VRcation')!).toBeGreaterThan(off.get('Sure Gamble')! - 0.5);
  });
});
