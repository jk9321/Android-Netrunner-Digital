import { describe, expect, it } from 'vitest';
import { ALL_CARDS, CardInstance, GameState, cardDef, createCardInstance } from '../src/core';
import { CARDS } from '../src/ai/cards';
import { CARD_PLANS } from '../src/ai/cardPlans';
import { ownTurnDamage } from '../src/ai/effectValues';
import { tagPunisher } from '../src/ai/evaluate';
import { pendingFreeRezzes } from '../src/ai/freeRez';
import { trashedCardCost } from '../src/ai/runs';
import { cardSynergy } from '../src/ai/synergyTags';
import { CLICK } from '../src/ai/valueModel';
import { giveCard, installCorpForTest, installProgramForTest, newGame } from './helpers';

/**
 * F119-S (addendum-structure.md to brief f119-punisher-field rev 1, Corp coordinator 2026-11-27): the per-card tag-use field
 * as structure, a translation at today's prices. Bar (a): every reader gives today's number, and the tag clock's punisher
 * set equals today's ifTagged flag set in both views, on every card of the four sets. Play identical is bar (b), on CI.
 */

const RETRIBUTION = '30065';
const BIGGER_PICTURE = '35065';
const MINDSCAPING = '34045';
const ORBITAL = '30068';
const UNLEASH = '36044';
const SEND_A_MESSAGE = '30069';
const SURE_GAMBLE = '30030'; // any Runner card for the grip

/** Today's tag clock rule (beta 5daabf1, evaluate.ts tagLoss before F119-S): the flag, and in the Corp's view an operation. */
const flagged = (code: string) => cardSynergy(cardDef({ cardCode: code } as CardInstance)).when?.includes('ifTagged') ?? false;
const todayPunisher = (code: string, viewer: 'corp' | 'runner') =>
  flagged(code) && (viewer === 'runner' || cardDef({ cardCode: code } as CardInstance).type_code === 'operation');

const corpCodes = ALL_CARDS.filter(d => d.side_code === 'corp').map(d => d.code);
const inst = (code: string) => ({ cardCode: code }) as CardInstance;

describe('F119-S: the tag clock reads the field, with today\'s membership', () => {
  it("the clock's punisher set equals today's flag rule in both views, on every Corp card of the four sets", () => {
    const differ: string[] = [];
    for (const code of corpCodes)
      for (const viewer of ['corp', 'runner'] as const) if (tagPunisher(inst(code), viewer) !== todayPunisher(code, viewer)) differ.push(`${code} ${viewer}`);
    expect(differ).toEqual([]);
  });

  it("today's flag set is the 14 cards the translation filled (a flag edit shows here first)", () => {
    expect(corpCodes.filter(flagged).sort()).toEqual(
      ['30051', '30056', '30065', '30068', '34035', '34116', '35058', '35063', '35065', '35066', '35080', '36038', '36042', '36044'].sort(),
    );
  });

  it('every flagged Corp card has a tagUse entry; the three outside the flag carry clock: false', () => {
    const entries = corpCodes.filter(c => CARDS[c]?.tagUse);
    expect(corpCodes.filter(c => flagged(c) && !CARDS[c]?.tagUse)).toEqual([]);
    expect(entries.filter(c => !flagged(c)).sort()).toEqual(['34037', '34045', '34049']);
    for (const c of ['34037', '34045', '34049']) expect(CARDS[c].tagUse!.clock).toBe(false);
    expect(entries.filter(c => flagged(c) && CARDS[c].tagUse!.clock === false)).toEqual([]);
    expect(entries.length).toBe(17);
  });

  it("an entry from 'hq' is an operation, and every operation entry is from 'hq'", () => {
    for (const c of corpCodes.filter(code => CARDS[code]?.tagUse)) {
      const op = cardDef(inst(c)).type_code === 'operation';
      expect([c, CARDS[c].tagUse!.from === 'hq']).toEqual([c, op]);
    }
  });

  it('only Corp cards carry the field', () => {
    expect(ALL_CARDS.filter(d => d.side_code !== 'corp' && CARDS[d.code]?.tagUse).map(d => d.code)).toEqual([]);
  });
});

/** A board with `tags` tags, `credits` Runner credits, a grip of `grip` and a program and a hardware installed. */
function board(tags: number, credits = 7, grip = 3): GameState {
  const s = newGame(4);
  s.runner.tags = tags;
  s.runner.credits = credits;
  s.runner.grip = Array.from({ length: grip }, () => createCardInstance(s, SURE_GAMBLE));
  installProgramForTest(s, '30026');
  return s;
}

describe('F119-S: the readers give today\'s numbers (identities)', () => {
  const tagCounts = [0, 1, 2, 3, 4, 5, Infinity];

  it("Mindscaping's and Orbital Superiority's corpTurnDamage at tags 0-5 and Infinity", () => {
    for (const t of tagCounts) {
      const s = board(t);
      expect([t, ownTurnDamage(s, MINDSCAPING)]).toEqual([t, Math.min(3, t)]);
      expect([t, ownTurnDamage(s, ORBITAL)]).toEqual([t, t > 0 ? 4 : 0]);
    }
  });

  it('pendingFreeRezzes: Send a Message installed, plus min(tags, Unleash copies in HQ)', () => {
    for (const t of [0, 1, 2, 3, Infinity])
      for (const copies of [0, 1, 2, 3])
        for (const sam of [0, 1]) {
          const s = board(t);
          s.corp.hq = [];
          for (let i = 0; i < copies; i++) giveCard(s, 'corp', UNLEASH);
          giveCard(s, 'corp', RETRIBUTION); // another tag use in HQ, no free rez
          if (sam) installCorpForTest(s, SEND_A_MESSAGE, 'remote1');
          expect([t, copies, sam, pendingFreeRezzes(s)]).toEqual([t, copies, sam, sam + Math.min(t, copies)]);
        }
  });

  it("Retribution's and Bigger Picture's hand-plan payoffs equal today's on every probe board", () => {
    for (const t of [0, 1, 2, 3, 4])
      for (const credits of [0, 1, 4, 5, 6, 10, 15, 26]) {
        const s = board(t, credits);
        const ret = createCardInstance(s, RETRIBUTION);
        const bp = createCardInstance(s, BIGGER_PICTURE);
        const retToday = trashedCardCost(s) - (cardDef(ret).cost ?? 0) - CLICK;
        const bpToday = 2 * Math.min(s.runner.credits, 5 * Math.max(1, s.runner.tags)) - (cardDef(bp).cost ?? 0) - CLICK;
        expect([t, credits, CARD_PLANS[RETRIBUTION].hand!.payoff(s, ret)]).toEqual([t, credits, retToday]);
        expect([t, credits, CARD_PLANS[BIGGER_PICTURE].hand!.payoff(s, bp)]).toEqual([t, credits, bpToday]);
      }
  });
});

describe('F119-S: the field states facts the Runner may read', () => {
  const entries = Object.keys(CARDS).filter(c => CARDS[c].tagUse);

  it('every function is finite at n = 0-5 and Infinity', () => {
    for (const code of entries) {
      const use = CARDS[code].tagUse!;
      for (const n of [0, 1, 2, 3, 4, 5, Infinity]) {
        const s = board(Number.isFinite(n) ? n : 3, 9);
        expect([code, n, Number.isFinite(use.spends(s, n))]).toEqual([code, n, true]);
        const effects = [use.does(s, n), ...[use.without?.(s) ?? []].flat()];
        for (const e of effects)
          for (const [k, v] of Object.entries(e)) {
            const nums = typeof v === 'number' ? [v] : Object.values(v as Record<string, number>);
            for (const x of nums) expect([code, n, k, Number.isFinite(x)]).toEqual([code, n, k, true]);
          }
      }
    }
  });

  it('reads public facts only: HQ and R&D contents swapped (same sizes) change nothing (RULE-HIDDEN-INFO)', () => {
    for (const code of entries) {
      const use = CARDS[code].tagUse!;
      const a = board(2, 9);
      const b = structuredClone(a);
      b.corp.hq = b.corp.hq.map(() => createCardInstance(b, UNLEASH));
      b.corp.rd = b.corp.rd.map(() => createCardInstance(b, ORBITAL));
      for (const n of [0, 1, 2, 3]) {
        expect([code, n, use.spends(b, n)]).toEqual([code, n, use.spends(a, n)]);
        expect([code, n, use.does(b, n)]).toEqual([code, n, use.does(a, n)]);
        expect([code, n, use.without?.(b)]).toEqual([code, n, use.without?.(a)]);
      }
    }
  });
});
