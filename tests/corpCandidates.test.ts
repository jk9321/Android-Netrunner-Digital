import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { GameAction, GameState, getLegalActions } from '../src/core';
import { HeuristicCorpAI } from '../src/ai';
import { asSide, plan, withPricing } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';
import { newDiagnostics } from '../src/ai/diagnostics';
import { Candidate, RankedCandidate, asRanked, corpCandidates, plannerIntake } from '../src/ai/corp/candidates';
import { PLANNER } from '../src/ai/turnPlanner';

/**
 * Stage C (brief "Pins", spec 1.3): the nine-line order's contracts, under plan.corpCore. One destination per card
 * under a counted placement rule; the planner's K under its two caps; a total, deterministic order that draws no
 * random number; no hidden information read (rule 10.2.2a); a two-turn line's step is not a Q7 candidate; the counted
 * pins also hold with no look-ahead (spec section 3).
 */
const read = (name: string): GameState => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const FIXTURES = ['ice-redirect-1001-t10.json', 'ice-redirect-1411-t6.json', 'money-1001-t1.json', 'asset-cover-r39-t6.json', 'planner-build-2.json', 'hidden-draws-1001-t10.json'];
const core = <T>(f: () => T, extra: Record<string, unknown> = {}): T => withPricing({ plan: { ...plan(), corpCore: true, rolloutLines: true, ...extra } }, f);
const candidates = (s: GameState): Candidate[] =>
  core(() => asSide('corp', () => (decisionContext(s, 'corp'), corpCandidates(s, getLegalActions(s, 'corp'), { held: null, freeExhausted: false }))));
const key = (a: GameAction) => JSON.stringify(Object.fromEntries(Object.entries(a).sort()));
const cardOf = (a: GameAction) => ('cardInstanceId' in a ? (a.cardInstanceId as string) : undefined);

describe('the Corp candidate order (Stage C)', () => {
  it('gives Whitespace one destination where a counted rule places it (deal 1001 T10: the scoring remote)', () => {
    const list = candidates(read('ice-redirect-1001-t10.json'));
    const whitespace = list.filter(c => c.action.type === 'INSTALL_CARD' && cardOf(c.action) === 'inst-29');
    expect(whitespace.map(c => (c.action as { targetServerId?: string }).targetServerId)).toEqual(['remote-1']);
  });

  it("keeps the planner's K under its two caps: at most two moves of one line and two of one card", () => {
    for (const name of FIXTURES) {
      const s = read(name);
      const list = candidates(s);
      const open = asRanked(s, list).filter(r => r.score > -Infinity && r.action.type !== 'END_TURN' && r.action.type !== 'START_TURN');
      const { picked, slots } = plannerIntake(open, PLANNER.candidates);
      const inK = picked.filter(r => !slots.has(r)) as RankedCandidate[];
      const byLine = new Map<number, number>();
      const byCard = new Map<string, number>();
      for (const r of inK) {
        byLine.set(r.line, (byLine.get(r.line) ?? 0) + 1);
        if (r.card) byCard.set(r.card, (byCard.get(r.card) ?? 0) + 1);
      }
      expect(Math.max(0, ...byLine.values()), name).toBeLessThanOrEqual(2);
      expect(Math.max(0, ...byCard.values()), name).toBeLessThanOrEqual(2);
    }
  });

  it('is total and deterministic: the same state gives the same order, and no random number is drawn', () => {
    for (const name of FIXTURES) {
      const random = vi.spyOn(Math, 'random');
      const a = candidates(read(name)).map(c => key(c.action));
      const b = candidates(read(name)).map(c => key(c.action));
      expect(random, name).not.toHaveBeenCalled();
      random.mockRestore();
      expect(b, name).toEqual(a);
      expect(new Set(a).size, name).toBe(a.length);
    }
  });

  it("reads no hidden information: the same order with R&D reversed and the Runner's grip replaced (rule 10.2.2a)", () => {
    for (const name of FIXTURES) {
      const s = read(name);
      const hidden = structuredClone(s);
      hidden.corp.rd.reverse();
      hidden.runner.grip = hidden.runner.stack.slice(0, hidden.runner.grip.length);
      expect(candidates(hidden).map(c => key(c.action)), name).toEqual(candidates(s).map(c => key(c.action)));
    }
  });

  it("does not put a two-turn line's step among the Q7 candidates (deal 1411 T6: the line's Whitespace on a new remote)", () => {
    const diag = newDiagnostics();
    let seen: GameAction[] | null = null;
    diag.onCandidates = (side, _v, actions) => {
      if (side === 'corp' && !seen) seen = actions;
    };
    const chosen = core(() => withPricing({ diagnostics: diag }, () => new HeuristicCorpAI({ synergy: true }).chooseAction(read('ice-redirect-1411-t6.json'))));
    expect(chosen).toMatchObject({ cardInstanceId: 'inst-41', asNewRemote: true });
    expect((seen ?? []).some(a => cardOf(a) === 'inst-41')).toBe(false);
  }, 240_000);

  // Deal 1001 T10 (tests/iceRedirect.test.ts) rewritten for the new order (AI Coordinator 2026-11-15 12:50Z): the pin's
  // card (Whitespace) was the ranking's choice; the order's line 2 holds the decision, ice on remote-1, the scoring remote
  // that does not hold. The Corp with the look-ahead plays the Regolith click: a known-failing pin in stageDPins.test.ts
  it('plays the counted placements with no look-ahead too (spec section 3: deal 1001 T10 ice on remote-1 by line 2; deal 1411 T6)', () => {
    const off = { turnPlanner: { ...(plan().turnPlanner ?? {}), corp: false } };
    const s = read('ice-redirect-1001-t10.json');
    const a = core(() => new HeuristicCorpAI({ synergy: true }).chooseAction(structuredClone(s)), off) as GameAction & { targetServerId?: string };
    expect(a.type).toBe('INSTALL_CARD');
    expect(a.targetServerId).toBe('remote-1');
    expect(candidates(s).find(c => key(c.action) === key(a))?.line).toBe(2);
    expect(core(() => new HeuristicCorpAI({ synergy: true }).chooseAction(read('ice-redirect-1411-t6.json')), off)).toMatchObject({ cardInstanceId: 'inst-41', asNewRemote: true });
  }, 240_000);

  // Bug report #4 (lethalHq; c0-rulings 15:50Z and 16:00Z (1)): Send a Message in HQ wins the Runner the game, so the ice
  // redirect to the scoring remote waits (rule 1.7.2a, the stake owner's points on the point clock); the order's first
  // move is ice on HQ (line 2). The look-ahead's own pick is pinned known-failing in stageDPins.test.ts
  it('puts ice on HQ first while HQ holds the agenda that would win the Runner the game (bug report #4)', () => {
    const first = candidates(read('bug-report-4-turn13.json'))[0].action as GameAction & { targetServerId?: string };
    expect(first.type).toBe('INSTALL_CARD');
    expect(first.targetServerId).toBe('hq');
  });
});
