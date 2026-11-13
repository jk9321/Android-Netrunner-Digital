import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState } from '../src/core';
import { moneyPick, moneyStats } from '../src/ai/incomeLine';
import { tuning } from '../src/ai/synergy';
import { installCorpForTest, installIceForTest, newGame, rezForTest } from './helpers';
import { inDecision } from './helpers/pricing';

/**
 * Money step M1c (incomeLine.ts moneyPick): a one-click paid ability of a rezzed installed card (rules 1.8.3a, 5.2.6a,
 * 9.5.1) that nets credits takes a click the Corp's own pick spends on a draw or a click for a credit (5.2.6a-b). Click
 * asset trace (redesign/money/click-asset-trace.txt): the Corp AI drew 50 times while a rezzed Regolith Mining License
 * held credits, Jeff 4. A Corp turn, 3 clicks, 0 credits, a rezzed Regolith (15 loaded) on a remote, an unrezzed Palisade on R&D, an empty HQ.
 */
const REGOLITH = '30071';
const position = (): { s: GameState; reg: string } => {
  let s = structuredClone(newGame(1));
  s.corp.rd.push(...s.corp.hq.splice(0));
  s.corp.clicks = 3;
  s.corp.credits = 0;
  // Short of what its own cards cost to use (corpCreditNeed): an unrezzed Palisade on R&D, rez 3
  installIceForTest(s, '30072', 'rd', false);
  const reg = installCorpForTest(s, REGOLITH, 'remote-1');
  s = rezForTest(s, reg);
  s.corp.credits = 0;
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

/**
 * M1c input (corpCreditNeed, countedScore.ts): the ability takes a draw's click only while the Corp's credits and known
 * income fall short of what its own cards cost to use (installed unrezzed ice and assets, the cards in HQ). The first
 * M1c batch (run 43348252028, -1.4 ± 1.1) flipped deals where it took draws with credits to spare; the states before
 * the first changed decision (scripts/m1c-diverge.ts, the 56-deal map): deal 1281 turn 14, 10 credits, HQ empty, 2
 * clicks: the draws found Urtica Cipher and Spin Doctor, then Offworld Office (scored turn 17); deal 2521 turn 11, 17
 * credits, no agenda in HQ: the draw found Offworld Office.
 */
describe('money step M1c: with credits to spare the draw stands', () => {
  const read = (name: string): GameState => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
  for (const name of ['m1c-flip-1281-t14.json', 'm1c-flip-2521-t11.json']) {
    it(`${name}: the draw is kept; a click for a credit still goes to the ability`, () => {
      const s = read(name);
      expect(withSwitch(true, () => inDecision(s, 'corp', () => moneyPick(s, draw)))).toBeNull();
      expect(withSwitch(true, () => inDecision(s, 'corp', () => moneyPick(s, credit)))).toMatchObject({ type: 'USE_ABILITY' });
    });
  }
});
