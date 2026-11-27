/**
 * F114 + F110, the tag clock's input (brief tag-clock-input rev 2; rulings 1 to 3 in tag-clock-input/ruling-redteam.md).
 * The Corp's basic action "[click], 2[credit]: Trash 1 resource. Take this action only if the Runner is tagged"
 * (Comprehensive Rules 5.2.6g) is what the clock prices (evaluate.ts tagLoss):
 * - part C: the action's cost is its owners' price as the viewer prices them, the click's (clickPrice) and the 2 credits'
 *   (valueModel.ts creditsLessCost, sideCreditValue's own difference with the need read once), not the flat CLICK + 2;
 * - N1 (ruling 3): inside an open hold count the cost is the flat CLICK + 2 (the ai-hold-reentry precedent);
 * - part P: in the Corp's view a tag punisher in HQ is a flagged operation (a card it plays from HQ); the Runner's view
 *   keeps the flag alone on the deck's odds until F119 carries that damage in both views.
 * Each board asserts its condition first. On the merge base (beta 609c4c3) the C, N1 and P cases are red; the base
 * numbers are in tag-clock-input/phase-b/tests-on-base.md. The deal 1281 replay overflows the stack when the cost is read
 * outside the tag-pricing frame (step 9 stop; step9-nrdb1281-stack.jsonl).
 */
import { inflateSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardInstance, GameAction, GameState, cardDef, createCardInstance, createInitialGameState, executeAction, isLegalAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { NRDB_TEST_DECKS } from '../src/data/testDecks/nrdb';
import { createAgent } from '../src/ai';
import { tagLossPerTurn, tagsWorth, unseenCorpPool } from '../src/ai/evaluate';
import { CLICK, creditsLessCost, sideCreditValue } from '../src/ai/valueModel';
import { clearHandCaches, clickPrice } from '../src/ai/handValues';
import { withPricing } from '../src/ai/pricing';
import { corpPorts } from '../src/ai/corpPorts';
import { cardSynergy } from '../src/ai/synergyTags';
import { trashedCardCost } from '../src/ai/runs';
import { inDecision } from './helpers/pricing';
import { installIceForTest, newGame } from './helpers';

const ARRUACEIRAS = '34073'; // Arruaceiras Crew
const LAGO = '34009'; // Lago Paranoá Shelter
const COOKBOOK = '30009'; // Cookbook: a resource worth a little over the flat cost
const RED_TEAM = '30018'; // Red Team
const HEDGE_FUND = '30075';
const flagged = (c: CardInstance) => cardSynergy(cardDef(c)).when?.includes('ifTagged') ?? false;

/** A tagged Runner on its own turn (Carnivore, Pennyshaver, Cleaver), the given resources, the Corp's credits and HQ. */
function board(resources: string[], corpCredits: number, hq: string[] = []): GameState {
  const s = newGame();
  s.runner.tags = 1;
  s.runner.credits = 6;
  s.corp.credits = corpCredits;
  s.activePlayer = 'runner';
  s.runner.clicks = 4;
  s.runner.rig.hardware = [createCardInstance(s, '30003'), createCardInstance(s, '30014')];
  s.runner.rig.programs = [createCardInstance(s, '30006')];
  s.runner.rig.resources = resources.map(code => {
    const c = createCardInstance(s, code);
    c.isRezzed = true;
    c.faceUp = true;
    return c;
  });
  s.corp.rd.push(...s.corp.hq);
  s.corp.hq = hq.map(code => createCardInstance(s, code));
  return s;
}

type View = 'corp' | 'runner';
const perTurn = (s: GameState, viewer: View, skip = 0) => inDecision(s, viewer, () => tagLossPerTurn(s, viewer, skip));
/** The same, inside an open hold count (N1: the flat CLICK + 2 there; on the merge base, everywhere). */
const flatPerTurn = (s: GameState, viewer: View, skip = 0) => inDecision(s, viewer, () => withPricing({ countingHold: true }, () => tagLossPerTurn(s, viewer, skip)));
/** The trash's cost as the clock reads it: inside the tag-pricing frame, in `viewer`'s decision. */
const cost = (s: GameState, viewer: View) => inDecision(s, viewer, () => withPricing({ pricingTagLoss: true }, () => clickPrice(s, 'corp', viewer) + creditsLessCost(s, 'corp', viewer, 2)));
const cardCost = (s: GameState, viewer: View) => inDecision(s, viewer, () => withPricing({ pricingTagLoss: true }, () => trashedCardCost(s)));
/** A resource's net in the clock (its term, nothing from HQ), read at the flat cost on a board where it pays. */
function flatNet(code: string): number {
  const s = board([code], 12);
  return flatPerTurn(s, 'corp') + CLICK + 2;
}

afterEach(() => vi.restoreAllMocks());

describe('part C: the trash costs its owners’ price', () => {
  it('(a) a Corp at 3 credits and one at 12, the same resource, no punisher: the trash part is lower at 3, each the net less the owners’ cost', () => {
    const poor = board([ARRUACEIRAS], 3);
    const rich = board([ARRUACEIRAS], 12);
    // The board's condition: no punisher (HQ empty, an unflagged identity), and the resource worth the trash at both
    for (const s of [poor, rich]) {
      expect(s.corp.hq).toHaveLength(0);
      expect(flagged(s.corp.identity)).toBe(false);
    }
    const net = flatNet(ARRUACEIRAS);
    expect(perTurn(poor, 'corp')).toBeGreaterThan(0);
    expect(perTurn(poor, 'corp')).toBeLessThan(perTurn(rich, 'corp'));
    expect(perTurn(poor, 'corp')).toBeCloseTo(net - cost(poor, 'corp'), 9);
    expect(perTurn(rich, 'corp')).toBeCloseTo(net - cost(rich, 'corp'), 9);
  });

  it('(b) red on base through part C: the best net is above CLICK + 2 and below the owners’ cost, the next lower; skip 0 and skip 1 read the same', () => {
    const s = board([COOKBOOK, RED_TEAM], 3);
    // The board's condition: Cookbook's net above the flat cost, Red Team's at or under it (lower); C1's cost below
    const cook = flatNet(COOKBOOK);
    expect(cook).toBeGreaterThan(CLICK + 2);
    expect(flatNet(RED_TEAM)).toBeLessThanOrEqual(CLICK + 2 + 1e-9);
    expect(perTurn(s, 'corp', 0)).toBe(perTurn(s, 'corp', 1));
    expect(cook).toBeLessThan(cost(s, 'corp'));
  });

  it('(b) where the best pays, skip 1 reads the next best (green on the merge base too)', () => {
    const s = board([ARRUACEIRAS, LAGO], 12);
    // The board's condition: the best (Arruaceiras Crew) pays, Lago is the next best
    expect(perTurn(s, 'corp', 0)).toBeGreaterThan(0);
    expect(perTurn(board([LAGO], 12), 'corp')).toBeLessThan(perTurn(board([ARRUACEIRAS], 12), 'corp'));
    expect(perTurn(s, 'corp', 1)).toBeCloseTo(perTurn(board([LAGO], 12), 'corp'), 9);
  });

  it('N1: inside an open hold count the cost is the flat CLICK + 2; outside it is the owners’ price', () => {
    const s = board([ARRUACEIRAS], 12);
    // The board's condition: the resource pays at both costs, and the two costs differ
    expect(perTurn(s, 'corp')).toBeGreaterThan(0);
    expect(Math.abs(cost(s, 'corp') - (CLICK + 2))).toBeGreaterThan(0.1);
    expect(flatPerTurn(s, 'corp') - perTurn(s, 'corp')).toBeCloseTo(cost(s, 'corp') - (CLICK + 2), 9);
  });
});

describe('part P: in the Corp’s view a punisher is a flagged operation', () => {
  // Doomscroll (ice, a subroutine), Orbital Superiority (agenda, on score), Esca (asset, on access): flagged, no card to
  // play from HQ. Retribution (operation) is the control
  for (const [code, type] of [
    ['35063', 'ice'],
    ['30068', 'agenda'],
    ['36038', 'asset'],
  ] as const) {
    it(`(c) an HQ holding only a flagged ${type} (${code}): no punisher term`, () => {
      const s = board([], 12, [code]);
      expect(flagged(s.corp.hq[0])).toBe(true);
      expect(cardDef(s.corp.hq[0]).type_code).toBe(type);
      expect(perTurn(s, 'corp')).toBe(0);
    });
  }

  it('(c) a flagged identity (NBN: Reality Plus): no identity term', () => {
    const s = board([], 12);
    const id = createCardInstance(s, '30051');
    id.isRezzed = true;
    s.corp.identity = id;
    expect(flagged(id)).toBe(true);
    expect(perTurn(s, 'corp')).toBe(0);
  });

  it('(c) control: a flagged operation in HQ (Retribution) is a punisher, priced at the trashed card’s cost', () => {
    const s = board([], 12, ['30065']);
    expect(flagged(s.corp.hq[0])).toBe(true);
    expect(cardDef(s.corp.hq[0]).type_code).toBe('operation');
    expect(perTurn(s, 'corp')).toBeGreaterThan(0);
    expect(perTurn(s, 'corp')).toBeCloseTo(cardCost(s, 'corp'), 9);
  });

  it('the Orbital board, both views (Runner rework coordinator, condition b): P moves the Corp’s price and not the Runner’s; C1 moves both', () => {
    const s = board([ARRUACEIRAS], 12, ['30068']);
    // The board's condition: Orbital Superiority (flagged, an agenda) in HQ, a resource that pays, the Runner seeing
    // flagged cards in the Corp's unseen pool
    expect(flagged(s.corp.hq[0])).toBe(true);
    const unseen = unseenCorpPool(s);
    const share = unseen.filter(flagged).length / unseen.length;
    expect(share).toBeGreaterThan(0);
    const net = flatNet(ARRUACEIRAS);
    // The Corp's view: the trash part alone, at the Corp's owners' cost
    expect(perTurn(s, 'corp')).toBeCloseTo(net - cost(s, 'corp'), 9);
    // The Runner's view: the trash part at the Runner view's cost, plus the deck's odds of a flagged card, as before P
    const held = 1 - (1 - share) ** s.corp.hq.length;
    expect(perTurn(s, 'runner')).toBeCloseTo(net - cost(s, 'runner') + held * cardCost(s, 'runner'), 9);
    for (const viewer of ['corp', 'runner'] as const) expect(Math.abs(cost(s, viewer) - (CLICK + 2))).toBeGreaterThan(0.1);
  });
});

describe('the Runner’s view (pass 1 finding 12; finding 7)', () => {
  /** A board with the Corp's own HQ and a facedown ice on HQ, both from its deck. */
  function hidden(): GameState {
    const s = board([ARRUACEIRAS], 12);
    const ices = s.corp.rd.filter(c => cardDef(c).type_code === 'ice');
    s.corp.hq = s.corp.rd.filter(c => cardDef(c).type_code !== 'ice').slice(0, 4);
    s.corp.rd = s.corp.rd.filter(c => !s.corp.hq.includes(c));
    expect(new Set(ices.map(c => c.cardCode)).size).toBeGreaterThan(1);
    return s;
  }
  /** The facedown ice on HQ is the deck's ice of index `i` (the rest stay in R&D, so the unseen cards are the same). */
  function withIce(s: GameState, i: number): GameState {
    const t = structuredClone(s);
    const ices = t.corp.rd.filter(c => cardDef(c).type_code === 'ice');
    const ice = ices.find(c => c.cardCode !== ices[0].cardCode && i === 1) ?? ices[0];
    t.corp.rd = t.corp.rd.filter(c => c !== ice);
    installIceForTest(t, ice.cardCode, 'hq', false);
    t.corp.rd.push(createCardInstance(t, ice.cardCode)); // installIceForTest makes a new instance: the deck keeps its count
    t.corp.rd = t.corp.rd.filter((c, k, all) => all.findIndex(d => d.instanceId === c.instanceId) === k);
    return t;
  }

  it('(d) unchanged when the Corp’s HQ cards are swapped for others of the same count', () => {
    const s = withIce(hidden(), 0);
    const swapped = structuredClone(s);
    const hq = swapped.corp.hq;
    swapped.corp.hq = swapped.corp.rd.filter(c => cardDef(c).type_code !== 'ice').slice(-hq.length);
    swapped.corp.rd = [...swapped.corp.rd.filter(c => !swapped.corp.hq.includes(c)), ...hq];
    expect(swapped.corp.hq.map(c => c.cardCode)).not.toEqual(s.corp.hq.map(c => c.cardCode));
    expect(perTurn(s, 'runner')).toBeGreaterThan(0);
    expect(perTurn(swapped, 'runner')).toBe(perTurn(s, 'runner'));
  });

  it('(d) unchanged when a facedown ice the Runner has not seen is swapped for another', () => {
    const a = withIce(hidden(), 0);
    const b = withIce(hidden(), 1);
    const iceOn = (s: GameState) => s.corp.servers.hq.ice.map(c => c.cardCode);
    expect(iceOn(a)).not.toEqual(iceOn(b));
    expect(a.corp.servers.hq.ice.every(c => !c.isRezzed)).toBe(true);
    expect(perTurn(b, 'runner')).toBe(perTurn(a, 'runner'));
  });

  it('(d) it prices the Corp’s credits by the Runner view’s owner', () => {
    const s = withIce(hidden(), 0);
    // The board's condition: the resource pays at both costs
    expect(flatPerTurn(s, 'runner')).toBeGreaterThan(0);
    expect(perTurn(s, 'runner')).toBeGreaterThan(0);
    const less = { ...s, corp: { ...s.corp, credits: s.corp.credits - 2 } };
    const two = inDecision(s, 'runner', () => sideCreditValue(s, 'corp', 'runner') - sideCreditValue(less, 'corp', 'runner'));
    expect(inDecision(s, 'runner', () => creditsLessCost(s, 'corp', 'runner', 2))).toBeCloseTo(two, 12);
    expect(flatPerTurn(s, 'runner') - perTurn(s, 'runner')).toBeCloseTo(cost(s, 'runner') - (CLICK + 2), 9);
  });
});

describe('(e) the memo: boards that differ in one field the new read depends on give different clocks', () => {
  // tagsWorth through tagClock's memo; the Runner on 1 credit cannot clear before the Corp's turn, so the clock is not
  // capped at one clear. The fields: the Corp's credits, a money operation in HQ (the Corp's view), the need's input,
  // the deciding side (the need follows it, valueModel.ts boardNeed)
  const clock = (s: GameState, viewer: View) => inDecision(s, viewer, () => tagsWorth(s, viewer));
  const stuck = (s: GameState) => ((s.runner.credits = 1), s);
  /** A then B (B a copy of A with one field changed): different clocks, and A's clock again after B's. */
  function differ(a: GameState, b: GameState, viewer: View) {
    const first = clock(a, viewer);
    const other = clock(b, viewer);
    expect(Math.abs(other - first)).toBeGreaterThan(1e-6);
    expect(clock(a, viewer)).toBe(first);
  }
  /** Six unrezzed Palisades on the centrals: the Runner view's need (corpIceMean an ice) passes the build target. */
  const iced = (s: GameState) => {
    for (const server of ['hq', 'rd', 'archives', 'hq', 'rd', 'archives']) installIceForTest(s, '30072', server, false);
    return s;
  };

  it('the Corp’s credits', () => {
    const a = stuck(board([ARRUACEIRAS], 3));
    const b = structuredClone(a);
    b.corp.credits = 12;
    for (const viewer of ['corp', 'runner'] as const) differ(a, b, viewer);
  });

  it('a money operation in HQ (the Corp’s view): Hedge Fund at 5 credits', () => {
    const a = stuck(board([ARRUACEIRAS], 5, ['30055']));
    const b = structuredClone(a);
    b.corp.hq = [createCardInstance(b, HEDGE_FUND)];
    expect(flagged(b.corp.hq[0]) || flagged(a.corp.hq[0])).toBe(false);
    expect(cost(b, 'corp')).not.toBeCloseTo(cost(a, 'corp'), 6);
    differ(a, b, 'corp');
  });

  it('the need’s input: unrezzed ice the Runner prices at the deck’s mean (the Runner’s view)', () => {
    const a = stuck(board([ARRUACEIRAS], 12));
    const b = iced(structuredClone(a));
    expect(cost(b, 'runner')).not.toBeCloseTo(cost(a, 'runner'), 6);
    differ(a, b, 'runner');
  });

  it('the deciding side: the Runner’s view read in the Corp’s decision does not serve the Runner’s decision', () => {
    const s = iced(stuck(board([ARRUACEIRAS], 12)));
    const fresh = structuredClone(s);
    const inCorp = inDecision(s, 'corp', () => tagsWorth(s, 'runner'));
    const inRunner = inDecision(s, 'runner', () => tagsWorth(s, 'runner'));
    expect(Math.abs(inCorp - inRunner)).toBeGreaterThan(1e-6);
    expect(inRunner).toBe(inDecision(fresh, 'runner', () => tagsWorth(fresh, 'runner')));
  });
});

describe('(f) creditsLessCost is sideCreditValue’s two-call difference, with the need worked out once', () => {
  it('equal on boards of both sides, both viewers, with and without a money operation in reach', () => {
    let n = 0;
    for (const credits of [3, 5, 6, 12])
      for (const hq of [[], [HEDGE_FUND]])
        for (const side of ['corp', 'runner'] as const)
          for (const viewer of ['corp', 'runner'] as const) {
            const s = board([ARRUACEIRAS], credits, hq);
            s.runner.credits = credits;
            const less = side === 'corp' ? { ...s, corp: { ...s.corp, credits: credits - 2 } } : { ...s, runner: { ...s.runner, credits: credits - 2 } };
            const two = inDecision(s, viewer, () => sideCreditValue(s, side, viewer) - sideCreditValue(less, side, viewer));
            expect(inDecision(s, viewer, () => creditsLessCost(s, side, viewer, 2)), `${side} ${viewer} ${credits} ${hq}`).toBeCloseTo(two, 12);
            n++;
          }
    expect(n).toBe(32);
  });

  it('the keep is worked out once (the two-call difference, on a copy, twice)', () => {
    const s = board([ARRUACEIRAS], 6, [HEDGE_FUND]);
    installIceForTest(s, '30072', 'hq', false);
    const keep = vi.spyOn(corpPorts, 'keep');
    clearHandCaches();
    inDecision(s, 'corp', () => creditsLessCost(s, 'corp', 'corp', 2));
    expect(keep).toHaveBeenCalledTimes(1);
    const t = structuredClone(s);
    keep.mockClear();
    clearHandCaches();
    inDecision(t, 'corp', () => sideCreditValue(t, 'corp', 'corp') - sideCreditValue({ ...t, corp: { ...t.corp, credits: 4 } }, 'corp', 'corp'));
    expect(keep).toHaveBeenCalledTimes(2);
  });
});

/**
 * NRDB deal 1281 (De Profundis v Trick Shot Zahya), T17, the Corp's main decision at 3 clicks, after 315 actions
 * (step9-nrdb1281-capture.jsonl, scripts/tag-clock-input/count.ts CAPTURE=1). With the cost read outside the tag-pricing
 * frame this decision re-entered the clock on new boards until the stack overflowed (the step 9 stop). The actions are
 * the capture's list, JSON, deflated and base64-coded.
 */
const DEAL_1281 = [
  'eNrtXG1vokoU/i98dhNgBlC/USUNuS40iL3Z3RhCkbZkLXgBd2+z6X+/yG56taLOnJlBbPrJF3AOnDnnOc95wW+/pPJ5FUtDybOm7uTWCm489/',
  'ONL/Wk1TJ8jvPqSJTlq83nPHtalfai+ub3209K9W30mCVR9ftf0vck3Rx7Wi+XyUOYVsde3w7vw2URv7z0CKTl6zSt3jTJU+HybGfqm5NJMDK9',
  'ccO9RWG+sNOiDNMoriUm1YdPyKgOlWH+EJfTOP8R5/Whx3+krYVvJuaXwL2xPNO3XSdwvcC6tRyfWIaKJCK1HNwE1KSU+P4+jsrgz/c9KVuVSZ',
  'bWP4vyeJGUhfTCJhZTil3k4U9WmdoxmZV2iz0tF9Lw2x89Y2m+Lf7atJ1g5Flje1/21mmWMw78meccO4fABF6NutkINF1i9Q2dcj/yxc5ujFzH',
  't52ZFXgzp0Ei6EzQfRhN9xFGUVwUQZmHxePGJetXTqDSp1TcQ5ikO6rjsP0DvuZk9KEb9pUaILcv3JxOj/mJCBsbe+bfe9e8f1qTG++fBQoSyi',
  'YKhoUT//Tip6ys1inzdcy8qnZiVeq9qlY8pTcI+AFgfNDkcYuk2Fz3EQTHyi6C247t26Z/yEgaIndeq7KiLYKN8pQjgHBKkcmRsbYVHqpSL1NV',
  'ClxVHNBXlroYWBWVNdBxxVpm3rwTMwnZHKtQJDNCn4IYKOxbAITIp6XtabzL2klCAgBtFt10GY1WWxnEYTgQSI39Xt9LAqEYrDh3AExaZZWDI0',
  'F5p2Jgjm9NZ2TRr16cZ10SAGnNbwylm7hDm5P+r2hm0QNW7xGhxUMudGJ7dVVYqnhpbidq3enI9azAvK60ZlKsS51kfnYrS/bNazF2IgPsBCir',
  'r9Ib22xaqfjKntj+Fxp+3JPCu2SZlM92uoj/lYYyRyasQOg3rAivn2aMZKwUtl8a35Cjs1M1VW6LqtEXBPULKQgCrUFD9N4r0jkwOu0csPqjQU',
  'pAW+qQYHa3UTrrNhid220AtQRVPUMLUIUVUOaAtJw4DeScL1be6vmwHIkLptQ1IiLXp+9BYParQzyBCWKBGNa+QG8a0IJpptIFU4bhtAZTsKHv',
  'KpjMj5hLwgqrPekMJeG3RgWRbzCWhAn5TacGLnCf3Uz7DPumqUTTKPx4q7hKCEx5wB6wjiA+3lJ3SFW4ribTugV/lOfA241uGR6SYYanKecILq',
  'rBniHKR/gSOx3DKp/qjGA2hDj3DdizUUSbjYZ59Jj8iAvhxfazpDOgEqdxtMQJqzZqp+1ZXOqlkfpqOyzJYK9VIhXWysKtlV7k912x1DFnm0Ds',
  'NoF4tDfJFXzlulM/uPIs8y/La7zGuzwOv1fudkJ773mhzRLBdHblubNKrRb1Wj2pWN/l2bpM0rgC42oPN+RJmYuXoc4FO6hA9FEEDVDD/JJ2OG',
  'wVPrNPHCDtyLBmli/qn22DQZaVw1flMUvX4aOiMIEGXKDA0QStsdWPL3ld0GgCB8bDUhfCb+pCPIcjSM87V7GYsEoDMpc6CxZhh1jhM/LGX+n0',
  'U7i7DzZS8CsxcV2et8xPzs0dIGAz6NiwK3PFq8/eIVTPUfESO+oKfoAHSx8p00fK1OGUie0ONVV88Dgoo0PBQ8hjdFhmeBabOK6Q0lKBTSGsAL',
  'uRm+j7uypmQNpDIMZZh7cTVJY5CmNBnXth4e6Du14cd8XqhTxdZ6hiQFlIOIWzm93ZZsaYifgyD8gf1KAzjKdizPEvajpItxAJ3l0iFrH8tRDS',
  'SIfwjl1B24VobJztIUPcb+8hwwsD4Y/s+cKI1/vP0EkTr6/UeQx1wgSJyAMIy5z/B5YWLyk=',
].join('');

describe('the step 9 stop’s board: NRDB deal 1281, T17', () => {
  it('rebuilt from the deal’s seed and its 315 actions, the Corp’s main decision finishes with a legal action', () => {
    const corp = NRDB_TEST_DECKS.find(d => d.side === 'corp' && d.name === 'De Profundis')!;
    const runner = NRDB_TEST_DECKS.find(d => d.side === 'runner' && d.name === '[Startup] Trick Shot Zahya (1st @ Americas Conts Startup)')!;
    let s: GameState = { ...createInitialGameState(deckGameSetup(1281, corp, runner)), stops: { corp: 'ai', runner: 'ai' } };
    const acts: GameAction[] = JSON.parse(inflateSync(Buffer.from(DEAL_1281, 'base64')).toString('utf8'));
    expect(acts).toHaveLength(315);
    for (const a of acts) s = executeAction(s, a);
    // The board's condition: the capture's board (T17, the Corp's main decision at 3 clicks)
    expect([s.turnNumber, s.activePlayer, s.corp.clicks, s.pendingPrompts.length]).toEqual([17, 'corp', 3, 0]);
    const action = createAgent('corp', 'normal').chooseAction(structuredClone(s));
    expect(isLegalAction(s, action)).toBe(true);
  }, 120_000);
});
