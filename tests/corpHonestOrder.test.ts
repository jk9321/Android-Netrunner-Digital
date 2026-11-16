import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CardInstance, GameAction, GameState, getLegalActions } from '../src/core';
import { HeuristicCorpAI } from '../src/ai';
import { breakerScript, iceSubtypes } from '../src/core/engine/ice';
import { asSide, plan, withPricing } from '../src/ai/pricing';
import { decisionContext, clearHandCaches } from '../src/ai/handValues';
import { RankedCandidate, corpCandidates } from '../src/ai/corp/candidates';
import { isCorpMain } from '../src/ai/corp/lines';
import { corpSeenGrip } from '../src/ai/oracle';
import { guessHidden } from '../src/ai/runnerReply';
import { clearThreatCaches } from '../src/ai/threatModel';
import { clearDamageThreats } from '../src/ai/effectValues';
import { clearDeckShares } from '../src/ai/iceValues';
import { clearBuildTargets } from '../src/ai/valueModel';
// A namespace import, so that on a tree without the view (beta decad444) only the tests that read it fail
import * as planner from '../src/ai/turnPlanner';

/**
 * ai-corp-honest-order (brief rev 2, "Pins"; red team 2026-11-16 findings 1 and 2): the deciding Corp builds its order
 * of ordinary moves on its own view of the decision (turnPlanner.ts corpDecisionView), not on the real state. Rule
 * 10.2.2a: R&D's order and the cards in the Runner's grip are hidden from the Corp (Jeff: the Normal Corp does not see
 * its own draws; it may know both decklists). So the order, each candidate's line, behind flag and keys, and the
 * planner's pick are the same whatever R&D's order and whichever of the Runner's unseen cards are in its grip.
 *
 * Variants of each fixture: R&D rotated by one and by two, and reversed; the Runner's unseen grip cards swapped with
 * stack cards (same sizes). None of the fixtures has an R&D card both sides know the place of (knownRdSlots), so a
 * rotation re-deals all of R&D. The caches are emptied before every variant (red team finding 4), so no variant is
 * served another's values. plan.hiddenDraws and plan.plannerSeed are on (the honesty holds only with plannerSeed on).
 */
const read = (name: string): GameState => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const honest = <T>(f: () => T): T => withPricing({ plan: { ...plan(), hiddenDraws: true, plannerSeed: true } }, () => asSide('corp', f));
const reset = () => {
  clearThreatCaches();
  clearHandCaches();
  clearDamageThreats();
  clearDeckShares();
  clearBuildTargets();
};
const key = (a: GameAction) => JSON.stringify(Object.fromEntries(Object.entries(a).sort()));
const card = (instanceId: string, cardCode: string) => ({ instanceId, cardCode, isRezzed: false, advancementCounters: 0, tokens: {}, hostedCardIds: [] }) as unknown as CardInstance;

/** The audit's probe (Stage C checkpoint, SC-CORP-DRAW-PEEK): deal 1001 T10 with Mindscaping and Sprint in HQ at 6 credits. */
const drawPlays = (): GameState => {
  const s = read('hidden-draws-1001-t10.json');
  s.corp.credits = 6;
  s.corp.hq.push(card('inst-900', '34045'), card('inst-901', '30041'));
  return s;
};
/**
 * Deal r39 T6: barrier ice shown that no AI breaker on the rig breaks (evaluate.ts:80-85), and the Runner's grip and
 * stack read in the values of the advance and the remote installs.
 */
const shownIce = (): GameState => read('asset-cover-r39-t6.json');
const FIXTURES: [string, () => GameState][] = [
  ['draw plays (deal 1001 T10)', drawPlays],
  ['shown ice (deal r39 T6)', shownIce],
];

function variants(s: GameState): [string, GameState][] {
  const out: [string, GameState][] = [];
  for (const k of [1, 2]) {
    const t = structuredClone(s);
    t.corp.rd = [...t.corp.rd.slice(k), ...t.corp.rd.slice(0, k)];
    out.push([`R&D rotated by ${k}`, t]);
  }
  const r = structuredClone(s);
  r.corp.rd.reverse();
  out.push(['R&D reversed', r]);
  // The Runner's unseen grip: one card swapped for a breaker of a shown ice type from the stack, then every unseen grip
  // card swapped with a stack card
  const known = honest(() => corpSeenGrip(s, 'reply'));
  const unseen = s.runner.grip.map((c, i) => (known.has(c.instanceId) ? -1 : i)).filter(i => i >= 0);
  const faced = new Set(Object.values(s.corp.servers).flatMap(v => v.ice.filter(i => i.isRezzed).flatMap(i => iceSubtypes(i, s))));
  const breaker = s.runner.stack.findIndex(c => {
    const b = breakerScript(c);
    return !!b && (b.breaks === 'any' || faced.has(b.breaks as never));
  });
  if (breaker >= 0 && unseen.length) {
    const b = structuredClone(s);
    [b.runner.grip[unseen[0]], b.runner.stack[breaker]] = [b.runner.stack[breaker], b.runner.grip[unseen[0]]];
    out.push(['grip: a breaker in from the stack', b]);
  }
  const g = structuredClone(s);
  unseen.forEach((i, n) => {
    if (n < g.runner.stack.length) [g.runner.grip[i], g.runner.stack[n]] = [g.runner.stack[n], g.runner.grip[i]];
  });
  out.push(['grip: every unseen card swapped with the stack', g]);
  return out;
}

/** The deciding agent's order (the planner on): action, line and behind flag of each candidate. */
const agentOrder = (s: GameState): string[] => {
  reset();
  return honest(() => new HeuristicCorpAI({ synergy: true, planner: true }).rankMainActions(structuredClone(s)) as RankedCandidate[]).map(r => `${key(r.action)} L${r.line}${r.behind ? ' behind' : ''}`);
};
/**
 * The order built on the state the deciding Corp builds it on (its view; before this branch, the real state itself):
 * line, behind flag and keys as well.
 */
const decidingView = (s: GameState): GameState => ('corpDecisionView' in planner ? planner.corpDecisionView(s) : s);
const keyed = (s: GameState, view: GameState): string[] =>
  corpCandidates(view, getLegalActions(s, 'corp'), { held: null, freeExhausted: false }).map(c => `${key(c.action)} L${c.line}${c.behind ? ' behind' : ''} [${c.keys.join(',')}]`);
const viewOrder = (s: GameState): string[] => {
  reset();
  return honest(() => {
    const view = decidingView(s);
    decisionContext(view, 'corp');
    return keyed(s, view);
  });
};

describe("the deciding Corp's order reads no hidden card (rule 10.2.2a)", () => {
  // One test per fixture and variant, so a failure names its kind (R&D order or grip)
  for (const [name, make] of FIXTURES) {
    for (const [variant] of variants(make())) {
      it(`builds the same order through the agent: ${variant} (${name})`, () => {
        const s = make();
        const v = variants(s).find(([n]) => n === variant)![1];
        expect(agentOrder(v)).toEqual(agentOrder(s));
      }, 240_000);

      it(`gives every candidate the same line, behind flag and keys on its view: ${variant} (${name})`, () => {
        const s = make();
        const v = variants(s).find(([n]) => n === variant)![1];
        expect(viewOrder(v)).toEqual(viewOrder(s));
      }, 240_000);
    }
  }

  for (const [variant] of variants(drawPlays())) {
    it(`makes the same pick through chooseAction, the planner's own: ${variant} (draw plays, deal 1001 T10)`, () => {
      const pick = (v: GameState) => {
        reset();
        return key(honest(() => new HeuristicCorpAI({ synergy: true, planner: true }).chooseAction(structuredClone(v))));
      };
      const s = drawPlays();
      expect(pick(variants(s).find(([n]) => n === variant)![1])).toBe(pick(s));
    }, 600_000);
  }

  it('the variants change the order or its keys built on the real state (the pins test something)', () => {
    const real = (s: GameState) => {
      reset();
      return honest(() => (decisionContext(s, 'corp'), keyed(s, s)));
    };
    const moved = (s: GameState, kind: string) => variants(s).filter(([n]) => n.startsWith(kind)).some(([, v]) => JSON.stringify(real(v)) !== JSON.stringify(real(s)));
    expect(moved(drawPlays(), 'R&D')).toBe(true);
    expect(moved(drawPlays(), 'grip')).toBe(true);
    expect(moved(shownIce(), 'grip')).toBe(true);
  }, 240_000);

  // Red team finding 3: one deal per decision, by construction. The view is the deal planTurn's Corp root made before
  // this branch (guessHidden with the decision's seed, inside the planner's frozen context), so the playouts are unchanged
  it("is the deal the planner's playouts started from before (every Corp main-phase fixture)", () => {
    const names = readdirSync(new URL('./fixtures/', import.meta.url)).filter(f => f.endsWith('.json'));
    let checked = 0;
    for (const name of names) {
      let s: GameState;
      try {
        s = read(name);
      } catch {
        continue;
      }
      if (!s?.corp || !isCorpMain(s)) continue;
      const before = honest(() => withPricing({ frozen: true, decisionSeed: planner.decisionSeedFor(s, 'corp') }, () => guessHidden(s, planner.HIDDEN_DRAW_SAMPLE)));
      const view = honest(() => planner.corpDecisionView(s));
      expect(JSON.stringify(view), name).toBe(JSON.stringify(before));
      expect(honest(() => planner.corpDecisionView(s)), `${name}: kept for the decision`).toBe(view);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });
});
