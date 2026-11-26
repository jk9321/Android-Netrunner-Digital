/**
 * Manual payment. Rules 1.10.3c: "By default, the credits must come from the player's credit pool. Abilities can
 * also allow players to spend credits hosted on their cards under certain conditions. If any such abilities apply,
 * the player chooses how to divide the credits they are spending from among the allowed locations." Rules 1.10.4b:
 * credits a card says how to spend can be spent "as if they were in the player's credit pool for the specified
 * actions or abilities" (and only those). An action may carry the player's split (`payment`); the engine checks it
 * and falls back to the usual order when it doesn't fit, so a stale or bad split never blocks the game.
 */
import { describe, expect, it } from 'vitest';
import { executeAction, findCardAnywhere, getLegalActions, isLegalAction, newViewIds, paymentQuote, stateFromView, toEngineAction, viewFor } from '../src/core';
import type { GameAction, GameState, PaymentPlan } from '../src/core';
import { sanitizeAction } from '../src/net/protocol';
import { recordPayment, spendCredits, withPaymentPlan } from '../src/core/engine/cardEffects';
import { moveCredit, planOf } from '../src/ui/components/PaymentPanel';
import { seatPaymentChoice } from '../src/ui/seatLegality';
import { giveCard, newGame, runIntoFirstIce, runnerInstall } from './helpers';

const URBAN_ART = '34029'; // hosted credits pay only for installs (rules 1.10.4b)
const CLEAVER = '30006'; // program, install cost 3
const DOCKLANDS = '30013'; // hardware, install cost 2

/** Runner's turn: Urban Art Vernissage with 2 credits, 5 in the pool, Cleaver in the grip. */
function setup() {
  const [state, urban] = runnerInstall(newGame(), URBAN_ART);
  findCardAnywhere(state, urban)!.tokens.credit = 2;
  state.runner.credits = 5;
  state.runner.clicks = 3;
  const cleaver = giveCard(state, 'runner', CLEAVER);
  const install: GameAction = { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: cleaver };
  return { state, urban, cleaver, install };
}

const credits = (s: GameState, id: string) => findCardAnywhere(s, id)!.tokens.credit ?? 0;
const plan = (pool: number, cards: [string, number][] = []): PaymentPlan => ({ pool, cards: cards.map(([cardInstanceId, c]) => ({ cardInstanceId, credits: c })) });

describe('Manual payment (rules 1.10.3c)', () => {
  it('quotes the payment: its amount, each allowed location and what the usual order takes', () => {
    const { state, urban, install } = setup();
    const quote = paymentQuote(state, install);
    expect(quote).toMatchObject({ side: 'runner', amount: 3 });
    expect(quote!.sources).toEqual([
      { key: 'pool', max: 5, auto: 1 },
      { key: urban, cardInstanceId: urban, max: 2, auto: 2 },
    ]);
    // The usual order, as the quote says: the card's 2, then 1 from the pool
    const auto = executeAction(state, install);
    expect(credits(auto, urban)).toBe(0);
    expect(auto.runner.credits).toBe(4);
  });

  it("pays the player's split: all from the pool keeps the card's credits", () => {
    const { state, urban, install } = setup();
    const next = executeAction(state, { ...install, payment: plan(3, [[urban, 0]]) });
    expect(next.runner.credits).toBe(2);
    expect(credits(next, urban)).toBe(2);
  });

  it('pays any split in between (1 from the card, 2 from the pool)', () => {
    const { state, urban, install } = setup();
    const next = executeAction(state, { ...install, payment: plan(2, [[urban, 1]]) });
    expect(next.runner.credits).toBe(3);
    expect(credits(next, urban)).toBe(1);
  });

  it('a split that does not fit falls back to the usual order (wrong total, too many from a card, more than the pool)', () => {
    const { state, urban, install } = setup();
    for (const bad of [plan(1, [[urban, 1]]), plan(0, [[urban, 3]]), plan(6, []), plan(-1, [[urban, 4]]), plan(1.5, [[urban, 1.5]])]) {
      const next = executeAction(state, { ...install, payment: bad });
      expect(credits(next, urban)).toBe(0);
      expect(next.runner.credits).toBe(4);
      expect(next.log.some(e => /chosen payment no longer fits/i.test(e.message))).toBe(true);
    }
  });

  it('a card whose credits may not pay for this cost is not an allowed location (rules 1.10.4b)', () => {
    const { state, urban } = setup();
    // Urban Art pays installs only: a payment for anything else can't take its credits, even when the split says so
    withPaymentPlan({ type: 'GAIN_CREDIT', player: 'runner', payment: plan(0, [[urban, 2]]) }, () => spendCredits(state, 'runner', 2));
    expect(credits(state, urban)).toBe(2);
    expect(state.runner.credits).toBe(3);
  });

  it('only the first payment of the acting player uses the split; nothing to pay leaves it unused', () => {
    const { state, urban } = setup();
    const next = executeAction(state, { type: 'GAIN_CREDIT', player: 'runner', payment: plan(0, [[urban, 2]]) });
    expect(next.runner.credits).toBe(6);
    expect(credits(next, urban)).toBe(2);
  });

  it('no quote for an illegal action, an action that pays nothing, or one that already has a split', () => {
    const { state, urban, install } = setup();
    state.runner.clicks = 0;
    expect(paymentQuote(state, install)).toBeNull();
    state.runner.clicks = 3;
    expect(paymentQuote(state, { type: 'GAIN_CREDIT', player: 'runner' })).toBeNull();
    expect(paymentQuote(state, { ...install, payment: plan(3, [[urban, 0]]) })).toBeNull();
    // The quote ran on a copy: the state is as it was
    expect(state.runner.credits).toBe(5);
    expect(credits(state, urban)).toBe(2);
  });

  it('a plain pool payment quotes only the pool (the panel stays shut)', () => {
    const { state, urban } = setup();
    findCardAnywhere(state, urban)!.tokens.credit = 0;
    const docklands = giveCard(state, 'runner', DOCKLANDS);
    const quote = paymentQuote(state, { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: docklands });
    expect(quote!.sources).toEqual([{ key: 'pool', max: 5, auto: 2 }]);
  });

  it('is never in the legal lists the AIs choose from, and legality does not change with it', () => {
    const { state, urban, install } = setup();
    for (const side of ['corp', 'runner'] as const) expect(getLegalActions(state, side).some(a => a.payment)).toBe(false);
    expect(isLegalAction(state, { ...install, payment: plan(3, [[urban, 0]]) })).toBe(true);
  });

  it("goes through the seat's ids and the online sanitizer", () => {
    const { state, urban, install } = setup();
    const { view, ids } = viewFor(state, 'runner', newViewIds(), 'g');
    const recon = stateFromView(view);
    const mine = recon.runner.rig.resources.find(c => c.cardCode === URBAN_ART)!.instanceId;
    const cleaverMine = recon.runner.grip.find(c => c.cardCode === CLEAVER)!.instanceId;
    // The seat quotes on its reconstruction, in its own ids
    const quote = paymentQuote(recon, { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: cleaverMine });
    expect(quote!.sources.map(s => s.key)).toEqual(['pool', mine]);
    const sent: GameAction = { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: cleaverMine, payment: plan(3, [[mine, 0]]) };
    const clean = sanitizeAction(JSON.parse(JSON.stringify(sent)));
    expect(clean).toEqual(sent);
    const engine = toEngineAction(clean!, ids);
    expect(engine).toEqual({ ...install, payment: plan(3, [[urban, 0]]) });
    expect(sanitizeAction({ ...sent, payment: { pool: 'x', cards: [] } })).toBeNull();
  });
});

describe('Manual payment during a run (rules 10.6.2 bad publicity credits, run-only credits)', () => {
  it("the run's own credits are allowed locations, and the player may keep them", () => {
    const state = runIntoFirstIce(newGame(), 'hq');
    expect(state.activeRun).toBeTruthy();
    state.activeRun!.bonusCredits = 2;
    state.activeRun!.badPublicityCredits = 1;
    state.runner.credits = 5;
    // Recorded only inside an action's handler (where a split would apply too)
    const copy = structuredClone(state);
    expect(recordPayment('runner', () => spendCredits(structuredClone(state), 'runner', 2))).toBeNull();
    const quoted = recordPayment('runner', () => withPaymentPlan({ type: 'CONTINUE_RUN', player: 'runner' }, () => spendCredits(copy, 'runner', 2)));
    expect(quoted!.sources).toEqual([
      { key: 'pool', max: 5, auto: 0 },
      { key: 'run', max: 2, auto: 1 },
      { key: 'badPublicity', max: 1, auto: 1 },
    ]);
    withPaymentPlan({ type: 'CONTINUE_RUN', player: 'runner', payment: { pool: 1, run: 1, cards: [] } }, () => spendCredits(state, 'runner', 2));
    expect(state.runner.credits).toBe(4);
    expect(state.activeRun!.bonusCredits).toBe(1);
    expect(state.activeRun!.badPublicityCredits).toBe(1);
  });
});

describe('The payment panel (UI helpers)', () => {
  const sources = [
    { key: 'pool', max: 5, auto: 1 },
    { key: 'c1', cardInstanceId: 'c1', max: 2, auto: 2 },
  ];
  it('+/- moves one credit and keeps the total at the cost, pool first', () => {
    expect(moveCredit(sources, [1, 2], 0, 1)).toEqual([2, 1]);
    expect(moveCredit(sources, [1, 2], 1, -1)).toEqual([2, 1]);
    expect(moveCredit(sources, [3, 0], 1, 1)).toEqual([2, 1]);
    // Nothing to move: the card is empty / at its most, or the pool is
    expect(moveCredit(sources, [3, 0], 1, -1)).toBeNull();
    expect(moveCredit(sources, [1, 2], 1, 1)).toBeNull();
    expect(moveCredit(sources, [0, 2], 1, -1)).toEqual([1, 1]);
  });

  it('builds the plan the engine takes', () => {
    expect(planOf(sources, [3, 0])).toEqual({ pool: 3, cards: [{ cardInstanceId: 'c1', credits: 0 }] });
  });

  it('opens only when there is a choice: two places with credits and a cost below them both', () => {
    const { state, urban, install } = setup();
    expect(seatPaymentChoice({ state }, install)!.amount).toBe(3);
    // Exactly everything: one way to pay
    state.runner.credits = 1;
    expect(seatPaymentChoice({ state }, install)).toBeNull();
    state.runner.credits = 5;
    findCardAnywhere(state, urban)!.tokens.credit = 0;
    expect(seatPaymentChoice({ state }, install)).toBeNull();
  });
});

describe('Manual payment: red-team cases (review of 86dd36e)', () => {
  it('a split naming a card twice, or the other side\'s card, falls back to the usual order', () => {
    const { state, urban, install } = setup();
    const corpCard = state.corp.hq[0];
    for (const bad of [plan(1, [[urban, 1], [urban, 1]]), plan(1, [[corpCard.instanceId, 2]])]) {
      const next = executeAction(state, { ...install, payment: bad });
      expect(credits(next, urban)).toBe(0);
      expect(next.runner.credits).toBe(4);
    }
  });

  it('a split with no card list is read as none (no crash)', () => {
    const { state, urban, install } = setup();
    const next = executeAction(state, { ...install, payment: { pool: 3 } as unknown as PaymentPlan });
    expect(next.runner.credits).toBe(2);
    expect(credits(next, urban)).toBe(2);
  });

  it('stealth-only costs never take from the pool (Corsair, Lampades)', () => {
    const { state } = setup();
    withPaymentPlan({ type: 'GAIN_CREDIT', player: 'runner', payment: plan(1, []) }, () => spendCredits(state, 'runner', 1, { kind: 'stealth' }));
    expect(state.log.some(e => /chosen payment no longer fits/i.test(e.message))).toBe(true);
  });

  it('while Aircheck locks the pool, a split taking from it does not fit', () => {
    const state = runIntoFirstIce(newGame(), 'hq');
    state.runner.credits = 5;
    state.activeRun!.bonusCredits = 2;
    state.activeRun!.poolLocked = true;
    withPaymentPlan({ type: 'CONTINUE_RUN', player: 'runner', payment: plan(2, []) }, () => spendCredits(state, 'runner', 2));
    expect(state.runner.credits).toBe(5);
    expect(state.activeRun!.bonusCredits).toBe(0);
  });

  it('a declared install (the Corp stops at every window) keeps its split until the Corp passes', () => {
    const { state, urban, install } = setup();
    state.stops = { ...state.stops, corp: 'full' };
    const declared = executeAction(state, { ...install, payment: plan(3, [[urban, 0]]) });
    expect(declared.priority?.intent).toBeTruthy();
    const done = executeAction(declared, { type: 'PASS', player: 'corp' });
    expect(done.runner.credits).toBe(2);
    expect(credits(done, urban)).toBe(2);
  });
});
