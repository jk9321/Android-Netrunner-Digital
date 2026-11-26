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
import { clearHandCaches, clickAudit, clickWorth, drawAudit } from '../src/ai/handValues';
import { clearDamageThreats, damageThreat, threatsAudit } from '../src/ai/effectValues';
import { Pricing, contextKey, withPricing } from '../src/ai/pricing';
import { askedFreeze, cardRate } from '../src/ai/valueModel';
import { tuning } from '../src/ai/synergy';
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

  it('every Pricing field is in pricingKey, in contextKey, or on the not-read list', () => {
    const src = readFileSync(new URL('../src/ai/pricing.ts', import.meta.url), 'utf8');
    const iface = src.slice(src.indexOf('export interface Pricing {'), src.indexOf('\n}\n', src.indexOf('export interface Pricing {')));
    const fields = [...iface.matchAll(/^ {2}(\w+):/gm)].map(m => m[1]);
    const body = (name: string) => src.slice(src.indexOf(`export function ${name}(`), src.indexOf('\n}\n', src.indexOf(`export function ${name}(`)));
    const read = `${body('pricingKey')}\n${body('contextKey')}`;
    // Read through a helper, or by no value
    const NOT_IN_KEYS: Record<string, string> = {
      plan: "pricingKey's planSide (which side's plan) and leafHandByCard read it",
      leaves: "pricingKey's leafHandByCard reads it",
      diagnostics: 'no decision reads it (diagnostics.ts writes only)',
    };
    expect(fields.length).toBeGreaterThan(10);
    expect(fields.filter(f => !new RegExp(`\\bc\\.${f}\\b`).test(read) && !(f in NOT_IN_KEYS))).toEqual([]);
    expect(Object.keys(NOT_IN_KEYS).filter(f => !fields.includes(f) || new RegExp(`\\bc\\.${f}\\b`).test(read))).toEqual([]);
  });

  it("contextKey changes with each field it holds", () => {
    const s = midGame();
    const base = contextKey();
    for (const [field, patch] of CONTEXT_FIELDS(s)) expect(withPricing(patch, contextKey), field).not.toBe(base);
  });
});

/** Each contextKey field, changed one at a time from the default context. */
function CONTEXT_FIELDS(s: GameState): [string, Partial<Pricing>][] {
  const root = structuredClone(s);
  return [
    ['frozen', { frozen: true }],
    ['known.corp', { known: { corp: new Set([s.corp.hq[0]?.instanceId ?? 'x']), runner: null } }],
    ['known.runner', { known: { corp: null, runner: new Set([s.runner.grip[0]?.instanceId ?? 'x']) } }],
    ['anchor.id', { anchor: { id: 'a', credits: 0 } }],
    ['anchor.credits', { anchor: { id: '', credits: 3 } }],
    ['anchor.side', { anchor: { id: '', credits: 0, side: 'corp' } }],
    ['anchor.root', { anchor: { id: '', credits: 0, root } }],
    ['decisionSeed', { decisionSeed: 7 }],
    ['rezzingToUse', { rezzingToUse: new Set(['inst-1']) }],
  ];
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
