/**
 * R-B B1b (brief runner-rework/briefs/b1b-pricing-context.md rev 1a): pricing.ts's context as immutable frames.
 * Bar 2: a frame can't be written (frameChecks, on in the tests: a write throws, through each Set too). The Corp side's
 * condition 4: asSide's base plan is a frame field, and two plans in one game never meet. Rev 1 items 1, 3 and 5: the
 * anchor is never copied, a patch that changes nothing makes no frame, installTop throws inside a scope.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { rezCandidates } from '../src/ai/playout';
import { withDiagnostics } from '../src/ai/diagnostics';
import { clearDamageThreats } from '../src/ai/effectValues';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { HeuristicCorpAI } from '../src/ai/corpAI';
import { HeuristicRunnerAI } from '../src/ai/runnerAI';
import { anchorAt, clearHandCaches, inDecision } from '../src/ai/handValues';
import { Pricing, asSide, frameChecks, frameKeys, installTop, plan, pricing, valueSet, withPricing } from '../src/ai/pricing';
import { sideOff } from '../src/ai/synergy';
import { newGame } from './helpers';
import { dealState } from '../scripts/stage-a/harness';

describe('a pricing frame is never written (bar 2)', () => {
  it('runs with the checks on in the tests', () => expect(frameChecks.on).toBe(true));

  it('a field write throws, and the known record, leaves and anchor are frozen', () => {
    const s = newGame();
    asSide('corp', () =>
      inDecision(s, 'corp', () =>
        withPricing({ pricingIce: true, leaves: [{ side: 'corp', plan: plan() }] }, () => {
          const f = pricing() as unknown as Record<string, unknown>;
          expect(() => (f.pricingIce = false)).toThrow(TypeError);
          expect(() => ((f.known as Record<string, unknown>).runner = null)).toThrow(TypeError);
          expect(() => (f.leaves as unknown[]).push(1)).toThrow(TypeError);
          expect(() => ((f.anchor as Record<string, unknown>).credits = 99)).toThrow(TypeError);
        }),
      ),
    );
  });

  it('a write through each Set a frame holds throws (rezzingToUse, both known slots)', () => {
    const s = newGame();
    asSide('runner', () =>
      inDecision(s, 'runner', () =>
        asSide('corp', () =>
          inDecision(s, 'corp', () =>
            withPricing({ rezzingToUse: valueSet(['inst-1']) }, () => {
              const c = pricing();
              for (const set of [c.rezzingToUse, c.known.corp!, c.known.runner!] as Set<string>[]) {
                expect(() => set.add('x')).toThrow(TypeError);
                expect(() => set.delete('inst-1')).toThrow(TypeError);
                expect(() => set.clear()).toThrow(TypeError);
              }
            }),
          ),
        ),
      ),
    );
    // A Set handed in a patch is sealed too, and the top-level frame's
    const mine = new Set(['inst-2']);
    withPricing({ rezzingToUse: mine }, () => expect(() => (pricing().rezzingToUse as Set<string>).add('y')).toThrow(TypeError));
  });

  it('a patch that changes nothing makes no frame; the old frame is current again after a throw', () => {
    const top = pricing();
    withPricing({ pricingIce: false, diagnostics: null }, () => expect(pricing()).toBe(top));
    expect(() => withPricing({ pricingIce: true }, () => {
      throw new Error('x');
    })).toThrow('x');
    expect(pricing()).toBe(top);
  });

  it('the anchor is never copied: a frame inside a decision keeps its object', () => {
    const s = newGame();
    asSide('corp', () =>
      inDecision(s, 'corp', () => {
        const a = pricing().anchor;
        expect(a?.root).toBe(s);
        withPricing({ pricingIce: true, frozen: true }, () => expect(pricing().anchor).toBe(a));
        // The ranking asked inside the decision opens no second frame (the re-note is gone)
        inDecision(s, 'corp', () => expect(pricing().anchor).toBe(a));
      }),
    );
  });

  it('an anchor made by hand with a root is refused by the key (anchorAt makes it)', () => {
    const s = newGame();
    expect(() => withPricing({ anchor: { id: s.id, credits: 0, root: s } }, () => frameKeys())).toThrow();
    expect(() => withPricing({ anchor: anchorAt(s, 'corp') }, () => frameKeys())).not.toThrow();
  });

  it('installTop sets a top-level frame, and throws inside a scope', () => {
    const top = pricing();
    try {
      installTop({ pricingIce: false });
      expect(pricing()).toBe(top);
      expect(() => withPricing({ pricingIce: true }, () => installTop({ planning: true }))).toThrow(/inside a pricing scope/);
    } finally {
      expect(pricing()).toBe(top);
    }
  });
});

describe("asSide's base plan is a frame field (the Corp side's condition 4)", () => {
  it("nested decisions build on the outermost decision's base plan, and nothing is left current", () => {
    const corp = [...sideOff.corp];
    const runner = [...sideOff.runner];
    try {
      sideOff.corp = ['rezMoney'];
      sideOff.runner = ['tagFirst'];
      const seen: string[] = [];
      const look = (who: string) => seen.push(`${who}: rezMoney ${String(plan().rezMoney)}, tagFirst ${String(plan().tagFirst)}`);
      asSide('corp', () => {
        look('corp');
        asSide('runner', () => {
          look('runner inside the corp');
          asSide('corp', () => look('corp inside that'));
        });
        look('corp again');
      });
      expect(seen).toEqual([
        'corp: rezMoney false, tagFirst true',
        'runner inside the corp: rezMoney true, tagFirst false',
        'corp inside that: rezMoney false, tagFirst true',
        'corp again: rezMoney false, tagFirst true',
      ]);
      expect(pricing().basePlan).toBeNull();
      expect(pricing().plan).toBeNull();
    } finally {
      sideOff.corp = corp;
      sideOff.runner = runner;
    }
  });

  it('two plans in one self-play game: each side ranks with its own plan, and no frame is left between decisions', () => {
    const corp = [...sideOff.corp];
    const runner = [...sideOff.runner];
    const corpRank = HeuristicCorpAI.prototype.rankMainActions;
    const runnerRank = HeuristicRunnerAI.prototype.rankMainActions;
    const seen = { corp: new Set<string>(), runner: new Set<string>() };
    try {
      sideOff.corp = ['rezMoney'];
      sideOff.runner = ['tagFirst'];
      HeuristicCorpAI.prototype.rankMainActions = function (...a) {
        seen.corp.add(`${String(plan().rezMoney)}/${String(plan().tagFirst)}/${pricing().side}`);
        return corpRank.apply(this, a);
      };
      HeuristicRunnerAI.prototype.rankMainActions = function (...a) {
        seen.runner.add(`${String(plan().rezMoney)}/${String(plan().tagFirst)}/${pricing().side}`);
        return runnerRank.apply(this, a);
      };
      const game = new GameRunner(dealState(1001), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
      for (let i = 0; i < 40 && game.step(); i++) expect(pricing().depth, `after step ${i}`).toBe(0);
      // The Corp's ranking (and the Corp's planner rollouts) on the Corp's plan; the Runner's, and the Corp's model of
      // the Runner in its reply, on the Runner's
      expect([...seen.corp]).toEqual(['false/true/corp']);
      expect([...seen.runner]).toEqual(['true/false/runner']);
    } finally {
      HeuristicCorpAI.prototype.rankMainActions = corpRank;
      HeuristicRunnerAI.prototype.rankMainActions = runnerRank;
      sideOff.corp = corp;
      sideOff.runner = runner;
    }
  }, 120_000);
});

/**
 * B1b named proof: a planner-off Corp's rez (corpAI chooseRez; the Hard Corp's base, search.ts) makes no frame of its
 * own, as on the base, where it took no note, so it runs in the frame around it. At the top level of a game that frame
 * is empty on the branch, where on the base the last decision's notes were left over (the Runner's anchor and grip).
 * Step 0 found (build-step0.md): the Runner's leftover grip is not read (the same value stream, in order, and the
 * same answer), but the Corp's leftover hand and a leftover anchor are: iceWorth counts the hand's unseen cards
 * (unknownInHand) and iceValues stopCredits caps the ice stop at the anchor's credits, so the rez on deal 1841 #87
 * answers otherwise with a leftover anchor. In play only the Hard Corp's top-level rez had one (Hard is off for
 * players, RULE-HIDDEN-INFO); the hand-off lists it. These pin both halves.
 */
describe("a planner-off Corp's rez in the frame around it", () => {
  const read = (name: string): GameState => {
    const raw = JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
    return raw.state ?? raw;
  };
  const stream = (s: GameState, patch: Partial<Pricing>) => {
    const copy = structuredClone(s);
    const out: string[] = [];
    clearHandCaches();
    clearDamageThreats();
    withPricing(patch, () =>
      withDiagnostics(d => {
        d.onValue = (q, site, _st, v) => void out.push(`${q}@${site}=${v}`);
        const a = new HeuristicCorpAI({ synergy: true, planner: false }).chooseRez(copy, rezCandidates(copy, copy.priority!.step as 'approach_ice'));
        out.push(`answer ${JSON.stringify(a)}`);
      }),
    );
    return out;
  };
  for (const name of ['rez-toll.json', 'stage-b-rez-biawak-r20-42.json', 'honest-corp-rez-1841-87.json']) {
    it(`${name}: the Runner's leftover grip is not read`, () => {
      const s = read(name);
      const alone = stream(s, {});
      expect(alone.length).toBeGreaterThan(1);
      expect(stream(s, { known: { corp: null, runner: valueSet(s.runner.grip.map(c => c.instanceId)) } })).toEqual(alone);
      expect(stream(s, { known: { corp: null, runner: valueSet([]) } })).toEqual(alone);
    }, 120_000);
  }
  const firstMoved = (a: string[], b: string[]) => b[b.findIndex((x, k) => x !== a[k])];
  it("rez toll: the Corp's leftover hand (an earlier board's) is read: its cards count as unseen in iceWorth", () => {
    const s = read('rez-toll.json');
    const alone = stream(s, {});
    expect(firstMoved(alone, stream(s, { known: { corp: valueSet(newGame(7).corp.hq.map(c => c.instanceId)), runner: null } }))).toMatch(/^ice@iceWorth=/);
    expect(stream(s, { known: { corp: valueSet(s.corp.hq.map(c => c.instanceId)), runner: null } })).toEqual(alone);
  }, 120_000);
  it("deal 1841 #87: a leftover anchor is read (the Runner's, on this board), and moves the answer", () => {
    const s = read('honest-corp-rez-1841-87.json');
    const alone = stream(s, {});
    const left = stream(s, { anchor: anchorAt(s, 'runner') });
    expect(left.at(-1)).not.toBe(alone.at(-1));
    expect(firstMoved(alone, left)).toMatch(/^ice@iceWorth=/);
  }, 120_000);
});
