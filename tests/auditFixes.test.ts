import { describe, expect, it } from 'vitest';
import { createCardInstance } from '../src/core';
import { serverValue, tagCost } from '../src/ai/runs';
import { corpEffect, rezzedWorth } from '../src/ai/effectValues';
import { HeuristicCorpAI, outOfReach } from '../src/ai/corpAI';
import { answerPrompt } from '../src/ai/prompts';
import { asSide, tuning } from '../src/ai/synergy';
import { guessHidden } from '../src/ai/runnerReply';
import { determinize } from '../src/ai/search';
import { cont, installCorpForTest, newGame, run, startRunnerTurn } from './helpers';


// Additional costs to steal (rules 1.16.10a-b): the Runner may decline them, and can't steal when it can't pay them all
// (Gemini audit, 2026-11-01; plan.stealCosts)
const MELIES = '36026'; // Méliès City Luxury Line: spend a click to steal it
const MAGISTRATE = '36048'; // Magistrate Revontulet: pay 3 credits to steal any agenda
const HOSTILE = '30067';

describe('additional costs to steal in the Runner AI', () => {
  it('a Méliès City it saw and could not steal is worth a run only with a click left over for the steal', () => {
    const value = (clicks: number) => {
      const s = newGame();
      startRunnerTurn(s);
      const id = installCorpForTest(s, MELIES, 'remote-1');
      s.runner.clicks = clicks;
      return serverValue(s, 'remote-1', 0, new Map([[id, MELIES]]), true);
    };
    expect(value(1)).toBe(0);
    expect(value(2)).toBeGreaterThan(0);
  });

  it('with Magistrate Revontulet rezzed, a broke Runner gets nothing from HQ and less from an unknown remote card', () => {
    const value = (credits: number, server: string) => {
      const s = newGame();
      startRunnerTurn(s);
      installCorpForTest(s, MAGISTRATE, 'remote-2', true);
      installCorpForTest(s, HOSTILE, 'remote-1');
      s.runner.credits = credits;
      return serverValue(s, server, 0, new Map(), true);
    };
    expect(value(2, 'hq')).toBe(0);
    expect(value(10, 'hq')).toBeGreaterThan(0);
    expect(value(2, 'remote-1')).toBeLessThan(value(10, 'remote-1'));
  });

  it('pays the click to steal Méliès City when it accesses it with clicks left', () => {
    const s = newGame();
    installCorpForTest(s, MELIES, 'remote-1');
    startRunnerTurn(s);
    const t = cont(run(s, 'remote-1'));
    const action = asSide('runner', () => answerPrompt(t, 'runner', new Map(), true));
    expect(action).toMatchObject({ choice: { optionId: 'steal' } });
  });
});

describe('additional costs to steal in the Corp AI', () => {
  it('counts Magistrate Revontulet\'s 3 credits in what keeps a remote out of reach', () => {
    const s = newGame();
    const server = { id: 'remote-1', name: 'remote-1', isRemote: true, ice: [], root: [createCardInstance(s, HOSTILE)] };
    s.corp.servers['remote-1'] = server;
    s.runner.credits = 0;
    const without = outOfReach(s, server, 0);
    installCorpForTest(s, MAGISTRATE, 'remote-2', true);
    expect(without).toBe(false);
    expect(outOfReach(s, server, 0)).toBe(true);
  });
});

describe('a rezzed Corp card\'s rez cost is paid once (plan.rezPaid; Gemini audit, 2026-11-01)', () => {
  it('rezzing Magistrate Revontulet is worth its effect less one rez cost, not two', () => {
    const s = newGame();
    const id = installCorpForTest(s, MAGISTRATE, 'remote-1');
    const card = s.corp.servers['remote-1'].root.find(c => c.instanceId === id)!;
    const once = corpEffect(s, MAGISTRATE, true)!.keep;
    expect(once - corpEffect(s, MAGISTRATE)!.keep).toBeCloseTo(2); // the unrezzed worth still has the 2 to pay
    expect(rezzedWorth(s, card, 2)).toBeCloseTo(once - 2);
  });
});

describe('a tag the Runner can\'t clear before the Corp\'s turn (plan.tagNoClear; Gemini audit, 2026-11-01)', () => {
  it('costs more on a last-click run than on a run with clicks left to clear it', () => {
    const cost = (clicks: number) => {
      const s = newGame();
      startRunnerTurn(s);
      s.runner.rig.resources.push(createCardInstance(s, '30027')); // Telework Contract: something for the Corp to trash
      s.corp.credits = 8;
      s.corp.hq = [0, 1, 2, 3, 4].map(() => createCardInstance(s, '30065')); // Retribution: trashes a card if the Runner is tagged
      s.runner.credits = 6;
      s.runner.clicks = clicks;
      return tagCost(s);
    };
    expect(cost(1)).toBeGreaterThan(cost(3));
  });
});

describe('Clearinghouse is advanced toward a flatline (plan.clearinghouseLethal; Gemini audit, 2026-11-01)', () => {
  const advanceScore = (counters: number, grip: number, type = 'ADVANCE_CARD') => {
    const s = newGame();
    s.activePlayer = 'corp';
    s.corp.credits = 10;
    const id = installCorpForTest(s, '30061', 'remote-1', true);
    s.corp.servers['remote-1'].root[0].advancementCounters = counters;
    s.runner.grip = s.runner.grip.slice(0, grip);
    const ranked = asSide('corp', () => new HeuristicCorpAI({ planner: false }).rankMainActions(s));
    return ranked.find(r => r.action.type === type && (type !== 'ADVANCE_CARD' || ('cardInstanceId' in r.action && r.action.cardInstanceId === id)))?.score ?? -Infinity;
  };
  it('past 3 counters while they are not yet more than the grip', () => {
    expect(advanceScore(3, 5)).toBeGreaterThan(-Infinity);
  });
  it('not past one more than the grip', () => {
    // plan.oneCurrency ranks by the evaluate delta, so "not taken" is a delta below a click for a credit, not -Infinity:
    // a counter past what can flatline is worth only the card it costs a Runner that draws back before it fires
    if (tuning.plan.oneCurrency) expect(advanceScore(4, 3)).toBeLessThan(advanceScore(4, 3, 'GAIN_CREDIT'));
    else expect(advanceScore(4, 3)).toBe(-Infinity);
  });
});

describe('lookahead guesses keep hand cards the guessing side has seen (plan.keepKnownHand; Gemini audit, 2026-11-01)', () => {
  it('the Corp\'s guess at the grip keeps a card it saw there', () => {
    const s = newGame();
    const seen = s.runner.grip[0];
    s.runner.knownToCorp = [{ id: seen.instanceId, code: seen.cardCode }];
    for (let k = 0; k < 5; k++) expect(guessHidden(s, k).runner.grip.map(c => c.instanceId)).toContain(seen.instanceId);
  });
  it('Hard\'s Runner-side guess keeps an HQ card the Runner saw', () => {
    const s = newGame();
    const seen = s.corp.hq[0];
    s.corp.knownToRunner = [{ id: seen.instanceId, code: seen.cardCode }];
    let n = 0;
    for (let k = 0; k < 5; k++) {
      const g = determinize(s, 'runner', () => ((n = (n * 9301 + 49297) % 233280) / 233280));
      expect(g.corp.hq.find(c => c.instanceId === seen.instanceId)?.cardCode).toBe(seen.cardCode);
    }
  });
});
