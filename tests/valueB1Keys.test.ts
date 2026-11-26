/**
 * V-B B1 (brief rev 2 step B1, ruling 1; review M1): the incomplete-key caches, pinned known-failing until the exact keys
 * were affordable; since F3 (netrunner-ai/cache-keys/brief-build.md) both maps are by position and both pins pass:
 * - clickWorth's key: a board whose stack differs (fingerprint has zone sizes only) is served the other board's value.
 * - damageThreat's key: two boards with the same counts but another card out of the pool share a value.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, cardDef } from '../src/core';
import { createCardInstance } from '../src/core/engine/gameState';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { anchorAt, clearHandCaches, clickAudit, clickWorth, drawAudit, inDecision } from '../src/ai/handValues';
import { clearDamageThreats, damageThreat, threatsAudit } from '../src/ai/effectValues';
import { Pricing, asSide, frameKeys, pricing, withPricing } from '../src/ai/pricing';
import { askedFreeze, cardRate } from '../src/ai/valueModel';
import { planWith, tuning } from '../src/ai/synergy';
import { newGame } from './helpers';
import { dealState } from '../scripts/stage-a/harness';

function midGame() {
  const game = new GameRunner(dealState(1001), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  for (let i = 0; i < 60 && game.step(); i++);
  return game.state;
}

// clickWorth's map is by position since F3 (valueModel stateEntries): a board with another stack is priced on its own
describe("clickWorth's key holds the stack", () => {
  it('a Runner board with a stack card swapped for a heap card is priced on its own', () => {
    const s = midGame();
    const b = structuredClone(s);
    const i = b.runner.stack.findIndex(c => c.cardCode !== b.runner.heap[0]?.cardCode);
    expect(b.runner.heap.length).toBeGreaterThan(0);
    [b.runner.stack[i], b.runner.heap[0]] = [b.runner.heap[0], b.runner.stack[i]];
    clearHandCaches();
    const alone = clickWorth(b, 'runner');
    clearHandCaches();
    expect(clickWorth(s, 'runner')).not.toBe(alone);
    expect(clickWorth(b, 'runner')).toBe(alone);
  }, 60_000);
});

// damageThreat's map is by position since F3 (valueModel stateEntries): each board is priced on its own
describe("damageThreat's key holds the pool", () => {
  it('two boards with the same counts and another card out of the pool are each priced on their own', () => {
    const s = midGame();
    // move a damage card from R&D to Archives face up on one board, a card that deals none on the other
    const damaging = s.corp.rd.findIndex(c => /do \d+ (net|meat|core) damage/i.test(cardDef(c).stripped_text ?? ''));
    const quiet = s.corp.rd.findIndex(c => !/damage/i.test(cardDef(c).stripped_text ?? ''));
    expect(damaging).toBeGreaterThanOrEqual(0);
    expect(quiet).toBeGreaterThanOrEqual(0);
    const out = (at: number) => {
      const b = structuredClone(s);
      b.corp.archives.faceUp.push(...b.corp.rd.splice(at, 1));
      return b;
    };
    const a = out(damaging);
    const b = out(quiet);
    clearDamageThreats();
    const alone = damageThreat(b).share;
    clearDamageThreats();
    damageThreat(a);
    expect(damageThreat(b).share).toBe(alone);
  }, 60_000);
});

/**
 * F3 build (netrunner-ai/cache-keys/brief-build.md, minor items): one pin per inner-key field. Each map is on the asked
 * state (valueModel stateEntries), so the inner key holds only what is not in the state; a field left out would serve
 * one context's value in another. On one board, asked twice in one context: a hit (the audit counts it); then asked
 * with one field changed: a miss.
 */
describe('the by-position maps key every field that is not in the state', () => {
  const hits = (audit: { on: boolean; checked: number }, ask: () => unknown) => {
    const before = audit.checked;
    ask();
    return audit.checked - before;
  };
  const audited = <T>(audit: { on: boolean }, fn: () => T): T => {
    audit.on = true;
    try {
      return fn();
    } finally {
      audit.on = false;
    }
  };

  it("clickWorth: the pricing key, the side and each contextKey field", () => {
    const s = midGame();
    clearHandCaches();
    audited(clickAudit, () => {
      clickWorth(s, 'runner');
      expect(hits(clickAudit, () => clickWorth(s, 'runner'))).toBe(1);
      expect(hits(clickAudit, () => clickWorth(s, 'corp'))).toBe(0); // side
      expect(hits(clickAudit, () => withPricing({ pricingIce: true }, () => clickWorth(s, 'runner')))).toBe(0); // pricingKey
      for (const [field, patch] of CONTEXT_FIELDS(s)) expect(hits(clickAudit, () => withPricing(patch, () => clickWorth(s, 'runner'))), field).toBe(0);
    });
  }, 60_000);

  it("drawWorth: the deck pricing key, the side, the money (R-14h) and each contextKey field", () => {
    const s = midGame();
    clearHandCaches();
    const draw = (side: 'corp' | 'runner', when: 'now' | 'later' = 'now') => cardRate(s, side, when);
    audited(drawAudit, () => {
      draw('runner');
      expect(hits(drawAudit, () => draw('runner'))).toBe(1);
      expect(hits(drawAudit, () => draw('corp'))).toBe(0); // side
      expect(hits(drawAudit, () => withPricing({ pricingIce: true }, () => draw('runner')))).toBe(0); // deckPricingKey
      // the money: the Runner's later money differs from its credits on this board, so 'later' is its own entry
      expect(hits(drawAudit, () => draw('runner', 'later'))).toBe(0);
      for (const [field, patch] of CONTEXT_FIELDS(s)) expect(hits(drawAudit, () => withPricing(patch, () => draw('runner'))), field).toBe(0);
    });
  }, 60_000);

  it("damageThreat: skipIce (the Corp's turn) and own (plan.corpTurnDamageOwn)", () => {
    const s = midGame();
    clearDamageThreats();
    const own = tuning.plan.corpTurnDamageOwn;
    audited(threatsAudit, () => {
      damageThreat(s, false);
      expect(hits(threatsAudit, () => damageThreat(s, false))).toBe(1);
      try {
        tuning.plan.corpTurnDamageOwn = false;
        expect(hits(threatsAudit, () => damageThreat(s, true))).toBe(0); // skipIce
        tuning.plan.corpTurnDamageOwn = true;
        expect(hits(threatsAudit, () => damageThreat(s, true))).toBe(0); // own
      } finally {
        tuning.plan.corpTurnDamageOwn = own;
      }
    });
  }, 60_000);

  // L-26 (B1b): the three maps are const; each clear helper moves its maps to a new generation (valueModel
  // clearStateEntries), so they miss on the next ask, and leaves the other helper's map as it was (scripts/cache-bisect
  // clears them one at a time). No module-level counter: codeHealth MODULE_LETS has none of the three
  it("the clear helpers: each makes its own maps miss on the next ask, and only its own", () => {
    const s = midGame();
    const draw = () => cardRate(s, 'runner', 'now');
    const click = () => clickWorth(s, 'runner');
    const threat = () => damageThreat(s, false);
    const all = () => [hits(drawAudit, draw), hits(clickAudit, click), hits(threatsAudit, threat)];
    audited(drawAudit, () =>
      audited(clickAudit, () =>
        audited(threatsAudit, () => {
          clearHandCaches();
          clearDamageThreats();
          all();
          expect(all(), 'asked twice: every map hits').toEqual([1, 1, 1]);
          clearHandCaches();
          expect(all(), 'after clearHandCaches: drawWorth and clickWorth miss, damageThreat hits').toEqual([0, 0, 1]);
          clearDamageThreats();
          expect(all(), 'after clearDamageThreats: damageThreat misses, the hand maps hit').toEqual([1, 1, 0]);
          clearHandCaches();
          clearDamageThreats();
          expect(all(), 'after both: all three miss').toEqual([0, 0, 0]);
          expect(all()).toEqual([1, 1, 1]);
        }),
      ),
    );
  }, 60_000);

  it('every frame field moves a key, or is on the not-read list (B1b: a behaviour pin, rev 1 item 5)', () => {
    const s = midGame();
    const src = readFileSync(new URL('../src/ai/pricing.ts', import.meta.url), 'utf8');
    const iface = src.slice(src.indexOf('export interface Pricing {'), src.indexOf('\n}\n', src.indexOf('export interface Pricing {')));
    const fields = [...iface.matchAll(/^ {2}readonly (\w+):/gm)].map(m => m[1]);
    expect(fields.length).toBeGreaterThan(15);
    const keysIn = (patch: Partial<Pricing>) => withPricing(patch, () => JSON.stringify(frameKeys()));
    // Each moved field: a frame `base` and the same frame with that field (and only it) changed
    const cases = FIELD_CASES(s);
    for (const f of fields) {
      if (f in NOT_READ) {
        expect(cases[f], `${f} is on the not-read list and has a case`).toBeUndefined();
        continue;
      }
      expect(cases[f], `${f}: a case, or a reason on the not-read list`).toBeDefined();
      for (const [label, base, changed] of cases[f]) {
        const only = Object.keys(changed).filter(k => !Object.is((changed as Record<string, unknown>)[k], (base as Record<string, unknown>)[k]));
        expect(only, `${label}: the variant differs from its base in ${f} only`).toEqual([f]);
        expect(keysIn({ ...base, ...changed }), label).not.toBe(keysIn(base));
      }
    }
    expect(Object.keys(NOT_READ).filter(f => !fields.includes(f))).toEqual([]);
    expect(Object.keys(cases).filter(f => !fields.includes(f))).toEqual([]);
  });

  it('a frame that only changes the plan object keeps its keys: the plan is named by its side (not-read list)', () => {
    const p1 = planWith(tuning.plan, []);
    expect(withPricing({ plan: p1 }, () => frameKeys())).toEqual(frameKeys());
  });

  it("the parts B1b drops are not in a frame at all: a top-level decision's frame has no other side's hand and no earlier anchor", () => {
    const s = midGame();
    // A Runner decision, then the Corp's: the Corp's frame starts from the top-level frame, not from what the Runner noted
    let seen: { known: Pricing['known']; anchor: Pricing['anchor'] } | null = null;
    asSide('runner', () => inDecision(s, 'runner', () => frameKeys()));
    asSide('corp', () => inDecision(s, 'corp', () => (seen = { known: pricing().known, anchor: pricing().anchor })));
    expect(seen!.known.runner).toBeNull();
    expect(seen!.anchor?.side).toBe('corp');
    // Nothing is left current after a decision, either side's
    const game = new GameRunner(dealState(1001), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
    for (let i = 0; i < 30 && game.step(); i++) {
      expect(pricing().anchor, `after step ${i}`).toBeNull();
      expect(pricing().known, `after step ${i}`).toEqual({ corp: null, runner: null });
      expect(pricing().depth, `after step ${i}`).toBe(0);
    }
  }, 60_000);
});

/** Frame fields no key holds, each with why (B1b rev 1a rider (a): and the two parts N2 drops, which are not fields). */
const NOT_READ: Record<string, string> = {
  plan: "named by its side in the pricing key (sideOff: the switches are the same for every position in a run); leafHandByCard reads its identity, pinned by the leaves case",
  diagnostics: 'no decision reads it (diagnostics.ts writes only)',
  depth: 'how many scopes deep the frame is: read by installTop only',
  // Not fields: the other side's leftover known slot and a leftover anchor (an earlier decision's) were in the
  // context key until B1b; a frame never holds them (the test above), so they are the only many-to-one change
};

type Case = [label: string, base: Partial<Pricing>, changed: Partial<Pricing>];
/** Per moved field, frames that differ in it only (from a base that makes the field read, where one is needed). */
function FIELD_CASES(s: GameState): Record<string, Case[]> {
  const root = structuredClone(s);
  const p = planWith(tuning.plan, []);
  const one = (f: keyof Pricing, v: unknown, base: Partial<Pricing> = {}): Case => [`${f}=${String(v)}`, base, { [f]: v } as Partial<Pricing>];
  return {
    side: [one('side', 'corp'), one('side', 'runner')],
    basePlan: [['basePlan, read by a leaf of the base plan', { plan: planWith(tuning.plan, []), leaves: [{ side: 'corp', plan: p }] }, { basePlan: p }]],
    frozen: [one('frozen', true)],
    known: [
      ['known.corp', {}, { known: { corp: new Set([s.corp.hq[0]?.instanceId ?? 'x']), runner: null } }],
      ['known.runner', {}, { known: { corp: null, runner: new Set([s.runner.grip[0]?.instanceId ?? 'x']) } }],
    ],
    anchor: [
      ['anchor.id', {}, { anchor: { id: 'a', credits: 0 } }],
      ['anchor.credits', { anchor: { id: '', credits: 0 } }, { anchor: { id: '', credits: 3 } }],
      ['anchor.side', { anchor: { id: '', credits: 0 } }, { anchor: { id: '', credits: 0, side: 'corp' } }],
      ['anchor.root', { anchor: anchorAt(s, 'corp') }, { anchor: anchorAt(root, 'corp') }],
    ],
    leaves: [['leaves, a leaf of the plan in force', { plan: p }, { leaves: [{ side: 'runner', plan: p }] }]],
    averaging: [one('averaging', true)],
    pricingRootDeck: [one('pricingRootDeck', true)],
    pricingTagLoss: [one('pricingTagLoss', true)],
    pricingIce: [one('pricingIce', true)],
    countingHold: [one('countingHold', true)],
    planning: [one('planning', true)],
    decisionSeed: [one('decisionSeed', 7)],
    rezzingToUse: [['rezzingToUse', {}, { rezzingToUse: new Set(['inst-1']) }]],
    pricingBreaker: [one('pricingBreaker', true)],
    oracleRunning: [one('oracleRunning', true)],
  };
}

/** Each contextKey field, changed one at a time from the default context (the by-position maps' audits above). */
function CONTEXT_FIELDS(s: GameState): [string, Partial<Pricing>][] {
  return Object.values(FIELD_CASES(s))
    .flat()
    .filter(([label]) => /^(frozen|known|anchor|decisionSeed|rezzingToUse)/.test(label))
    .map(([label, base, changed]) => [label, { ...base, ...changed }]);
}

/**
 * Code audit 2026-11-26 AI-LATER-MONEY-HANDMADE-MEMO: the Runner's later money was kept in a hand-made WeakMap a board
 * changed in place did not clear (2.1228 kept against a fresh 1.9631 on this board at 12ee4b4). It is valueModel memo's
 * now (dropped when the board changes), and an asked board is frozen in the tests (askedFreeze), so the write throws.
 */
describe("the later money is the board's own", () => {
  const CHEAP = ['30026', '30022', '30032', '30009', '30033', '30023', '30027', '30007', '30030'];
  const board = (credits: number, id: string) => {
    const s = newGame();
    s.id = id;
    s.runner.stack = CHEAP.map(c => createCardInstance(s, c));
    s.runner.credits = credits;
    return s;
  };
  it('a board changed in place after a later read is priced as a fresh board (freeze off)', () => {
    askedFreeze.on = false;
    try {
      const s = board(3, 'later-same');
      const kept = cardRate(s, 'runner', 'later');
      s.runner.credits = 0;
      const fresh = cardRate(board(0, 'later-fresh'), 'runner', 'later');
      expect(fresh).not.toBe(kept);
      expect(cardRate(s, 'runner', 'later')).toBe(fresh);
    } finally {
      askedFreeze.on = true;
    }
  });
  it('with the freeze on, the write to an asked board throws', () => {
    const s = board(3, 'later-frozen');
    cardRate(s, 'runner', 'later');
    expect(() => {
      s.runner.credits = 0;
    }).toThrow(TypeError);
  });
});
