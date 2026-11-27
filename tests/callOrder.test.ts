/**
 * Call-order leak (Stage D item 1, call-order.md): the rez budget's per-decision stop notes (iceValues.ts
 * decisionStopCache, `anchor.stops`, deleted on ai-rez-stops) kept the first board's stop for each ice, keyed by ice only. A look-ahead board of
 * the same game position (same state.id) where another ice was rezzed gives Mycoweb a borrowed sentry subroutine, so
 * its stop there is 8, not 3; asked first, that 8 is served on the decision's own board. The same question must not
 * depend on what was asked before it in the decision. The root is deal 2191, decision 135 of the Stage D g10 base
 * (run 43995122310); call-order-2191-135-lookahead.json is the planner's look-ahead board from that decision, kept with
 * it for reference (this test rezzes inst-37 on the root instead).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import '../src/ai';
import { runSuccess } from '../src/ai/effectValues';
import { asSide, plan, withPricing } from '../src/ai/pricing';
import { inDecision as decisionFrame } from '../src/ai/handValues';
import { GameState } from '../src/core';

const FILE = 'tests/fixtures/stage-d/call-order-2191-135.json';

function inDecision<T>(root: GameState, fn: () => T): T {
  return withPricing({ plan: { ...plan() } }, () => asSide('corp', () => decisionFrame(root, 'corp', fn)));
}

// Asked through the reader that carried the leak (effectValues ownIce, the Corp's own unrezzed ice by its rez budget):
// runSuccess on every server of the root. On the old code ownIce asked rezBudget(state, true), the noted path
const servers = (s: GameState) => Object.keys(s.corp.servers);
const odds = (s: GameState) => servers(s).map(id => [id, runSuccess(s, id)] as const);

describe('rez budget stop notes: the answer does not depend on what was asked first', () => {
  it("the root's run odds are the same whether or not a look-ahead with the R&D sentry rezzed was priced first", () => {
    const root1: GameState = JSON.parse(readFileSync(FILE, 'utf8'));
    const alone = inDecision(root1, () => odds(root1));
    const root2: GameState = JSON.parse(readFileSync(FILE, 'utf8'));
    // A look-ahead of the same position (the planner's boards keep state.id): the R&D sentry (inst-37) rezzed, so
    // Mycoweb's "resolve 1 subroutine on a rezzed sentry" has one to borrow: its stop there is 8, on the root 3
    const ahead: GameState = structuredClone(root2);
    ahead.corp.servers.rd.ice.find(c => c.instanceId === 'inst-37')!.isRezzed = true;
    const after = inDecision(root2, () => {
      odds(ahead);
      return odds(root2);
    });
    // With the note (beta before ai-rez-stops) the look-ahead's stops were served on the root: both Mycowebs covered
    // first and R&D's sentry left out, so the root's odds moved
    expect(after).toEqual(alone);
  });
});
