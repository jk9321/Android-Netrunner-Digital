import { describe, expect, it } from 'vitest';
import { GameAction, GameState } from '../src/core';
import { moneyPick, moneyStats } from '../src/ai/incomeLine';
import { tuning } from '../src/ai/synergy';
import { installCorpForTest, newGame, rezForTest } from './helpers';
import { inDecision } from './helpers/pricing';

/**
 * Money step M1c (incomeLine.ts moneyPick): a one-click paid ability of a rezzed installed card (rules 1.8.3a, 5.2.6a,
 * 9.5.1) that nets credits takes a click the Corp's own pick spends on a draw or a click for a credit (5.2.6a-b). Click
 * asset trace (redesign/money/click-asset-trace.txt): the Corp AI drew 50 times while a rezzed Regolith Mining License
 * held credits, Jeff 4. A Corp turn, 3 clicks, 5 credits, a rezzed Regolith (15 loaded) on a remote, an empty HQ.
 */
const REGOLITH = '30071';
const position = (): { s: GameState; reg: string } => {
  let s = structuredClone(newGame(1));
  s.corp.rd.push(...s.corp.hq.splice(0));
  s.corp.clicks = 3;
  s.corp.credits = 5;
  const reg = installCorpForTest(s, REGOLITH, 'remote-1');
  s = rezForTest(s, reg);
  return { s, reg };
};
const draw = { type: 'DRAW_CARD', player: 'corp' } as GameAction;
const credit = { type: 'GAIN_CREDIT', player: 'corp' } as GameAction;
const withSwitch = <T>(on: boolean, f: () => T): T => {
  const keep = tuning.plan;
  tuning.plan = { ...keep, moneyAbility: on };
  try {
    return f();
  } finally {
    tuning.plan = keep;
  }
};

describe('money step M1c: an installed econ ability in place of a draw or a credit', () => {
  it('the Regolith rezzed with 15 on it holds 15 credits', () => {
    const { s, reg } = position();
    expect(s.corp.servers['remote-1'].root.find(c => c.instanceId === reg)?.tokens.credit).toBe(15);
  });

  it('takes 3 from Regolith over a draw or a click for a credit', () => {
    const { s, reg } = position();
    for (const own of [draw, credit]) {
      const before = moneyStats.abilities;
      expect(withSwitch(true, () => inDecision(s, 'corp', () => moneyPick(s, own)))).toMatchObject({ type: 'USE_ABILITY', cardInstanceId: reg });
      expect(moneyStats.abilities).toBe(before + 1);
    }
  });

  it('leaves the click to an install or an advance, and to no own pick', () => {
    const { s } = position();
    const install = { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: 'x', asNewRemote: true } as GameAction;
    for (const own of [install, null]) expect(withSwitch(true, () => inDecision(s, 'corp', () => moneyPick(s, own)))).toBeNull();
  });

  it('switch off: the draw stands', () => {
    const { s } = position();
    expect(withSwitch(false, () => inDecision(s, 'corp', () => moneyPick(s, draw)))).toBeNull();
  });
});
