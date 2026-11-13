import { describe, expect, it } from 'vitest';
import { GameAction, GameState, getCardDefinition } from '../src/core';
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
const withSwitches = <T>(on: Partial<typeof tuning.plan>, f: () => T): T => {
  const keep = tuning.plan;
  tuning.plan = { ...keep, ...on };
  try {
    return f();
  } finally {
    tuning.plan = keep;
  }
};
const withSwitch = <T>(on: boolean, f: () => T): T => withSwitches({ moneyAbility: on }, f);

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

/**
 * M1c second arm (plan.moneyAbilityMulti): Humanoid Resources (35039, src/data/elevation-cards.json: "[click][click]
 * [click], [trash]: Gain 4[credit] and draw 3 cards. Install up to 2 cards from HQ (one at a time). You may play 1
 * operation from HQ."). Click asset trace: the AI rezzed 2-5% of its copies, Jeff all 3 of his. Its line installs from
 * HQ what a click would (rule 8.5), so it takes the clicks of an own pick that installs a card of the same type, and
 * an unrezzed copy is rezzed first (8.1.2, in the paid ability window, 5.6.2a). Deal seed 1's opening HQ, 3 clicks, 10
 * credits, the Corp's own pick Karunā (ice).
 */
describe('money step M1c, second arm: Humanoid Resources', () => {
  const HUMANOID = '35039';
  const position = (rezzed: boolean) => {
    const s = structuredClone(newGame(1));
    s.corp.clicks = 3;
    s.corp.credits = 10;
    const id = installCorpForTest(s, HUMANOID, 'remote-1', rezzed);
    const ice = s.corp.hq.find(c => c.cardCode === karuna(s))!;
    const own = { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: ice.instanceId, targetServerId: 'hq' } as GameAction;
    return { s, id, own };
  };
  const karuna = (s: GameState) => s.corp.hq.find(c => getCardDefinition(c.cardCode).title === 'Karunā')!.cardCode;
  const both = <T>(f: () => T): T => withSwitches({ moneyAbility: true, moneyAbilityMulti: true }, f);

  it('rezzes it (1) to use it, in place of the ice install its line also makes', () => {
    const { s, id, own } = position(false);
    expect(both(() => inDecision(s, 'corp', () => moneyPick(s, own)))).toMatchObject({ type: 'REZ_CARD', cardInstanceId: id });
  });

  it('uses it once rezzed', () => {
    const { s, id, own } = position(true);
    expect(both(() => inDecision(s, 'corp', () => moneyPick(s, own)))).toMatchObject({ type: 'USE_ABILITY', cardInstanceId: id });
  });

  it('only with the second arm on, and never with fewer clicks than it costs', () => {
    const { s, own } = position(true);
    expect(withSwitches({ moneyAbility: true, moneyAbilityMulti: false }, () => inDecision(s, 'corp', () => moneyPick(s, own)))).toBeNull();
    const t = structuredClone(s);
    t.corp.clicks = 2;
    expect(both(() => inDecision(t, 'corp', () => moneyPick(t, own)))).toBeNull();
  });
});
