import { describe, expect, it } from 'vitest';
import { HAND_FLOOR, SOON, clickPrice, clickWorth, heldWorth, noteKnownHand, ownHandValue, playedWorth } from '../src/ai/handValues';
import { createCardInstance } from '../src/core/engine/gameState';
import { CLICK } from '../src/ai/valueModel';
import { tuning } from '../src/ai/synergy';
import { installIceForTest, newGame } from './helpers';

describe('cards in hand by what they do (Jeff, 2026-10-28; plan.handByCard)', () => {
  it('a card in hand holds part of its played worth, so playing a good card gains the rest', () => {
    const s = newGame();
    s.runner.credits = 10;
    const verbal = createCardInstance(s, '30034'); // Verbal Plasticity
    const played = playedWorth(s, verbal);
    expect(played).toBeGreaterThan(0);
    expect(heldWorth(s, verbal, 'runner')).toBeCloseTo(SOON.now * played);
    // Can't afford it yet: worth less while it waits
    s.runner.credits = 0;
    expect(heldWorth(s, verbal, 'runner')).toBeCloseTo(Math.max(HAND_FLOOR, SOON.later * played));
  });

  it('a card not worth playing is still worth the floor (a card to discard to damage or the limit)', () => {
    const s = newGame();
    const conduit = createCardInstance(s, '30024');
    s.runner.credits = 0;
    expect(heldWorth(s, conduit, 'runner')).toBeGreaterThanOrEqual(HAND_FLOOR);
  });

  it('a card drawn in a look-ahead is worth the deck average, not what it is', () => {
    const s = newGame();
    noteKnownHand(s, 'runner');
    const known = ownHandValue(s, 'runner');
    const drawn = s.runner.stack.shift()!;
    s.runner.grip.push(drawn);
    const withDraw = ownHandValue(s, 'runner');
    // Swap the drawn card for any other deck card: same worth, since it's unseen
    const other = structuredClone(s);
    const swap = other.runner.stack.findIndex(c => c.cardCode !== drawn.cardCode);
    [other.runner.grip[other.runner.grip.length - 1], other.runner.stack[swap]] = [other.runner.stack[swap], other.runner.grip[other.runner.grip.length - 1]];
    other.runner.grip[other.runner.grip.length - 1].instanceId = drawn.instanceId + '-x';
    expect(withDraw).toBeGreaterThan(known);
    expect(ownHandValue(other, 'runner')).toBeCloseTo(withDraw, 1);
  });

  it('only the best cards up to the hand limit count; one over is a small filter', () => {
    const s = newGame();
    noteKnownHand(s, 'corp');
    s.corp.hq = s.corp.hq.slice(0, s.corp.handSizeLimit);
    noteKnownHand(s, 'corp');
    const full = ownHandValue(s, 'corp');
    // Two more copies of the weakest card: only the first adds the filter
    const worst = [...s.corp.hq].sort((a, b) => heldWorth(s, a, 'corp') - heldWorth(s, b, 'corp'))[0];
    s.corp.hq.push({ ...worst, instanceId: 'w1' }, { ...worst, instanceId: 'w2' });
    noteKnownHand(s, 'corp');
    expect(ownHandValue(s, 'corp') - full).toBeCloseTo(0.3);
  });
});

describe('a click priced by the best play in hand (Jeff, 2026-10-28; plan.clickByPlay)', () => {
  it('is never worth less than a credit, even with nothing to play', () => {
    const s = newGame();
    s.runner.grip = [];
    s.runner.stack = [];
    expect(clickWorth(s, 'runner')).toBeGreaterThanOrEqual(1);
  });

  it('a strong card in hand raises it, by what playing it now adds over holding it', () => {
    const s = newGame();
    s.runner.credits = 10;
    s.runner.grip = [];
    s.runner.stack = [];
    installIceForTest(s, '35041', 'hq'); // a rezzed sentry for Carmen to break
    const bare = clickWorth(s, 'runner');
    const carmen = createCardInstance(s, '30015');
    s.runner.grip = [carmen];
    s.runner.clicks = 1;
    expect(clickWorth(s, 'runner')).toBeGreaterThan(bare);
    expect(clickWorth(s, 'runner')).toBeCloseTo(Math.min(3, Math.max(1, (1 - SOON.now) * (playedWorth(s, carmen) + CLICK))));
  });

  it('is capped at 3 credits and only used for the side’s own clicks', () => {
    const s = newGame();
    s.runner.credits = 50;
    expect(clickWorth(s, 'runner')).toBeLessThanOrEqual(3);
    expect(clickPrice(s, 'corp', 'runner')).toBe(CLICK);
    tuning.plan.clickByPlay = { corp: false, runner: false };
    expect(clickPrice(s, 'runner', 'runner')).toBe(CLICK);
    tuning.plan.clickByPlay = { corp: true, runner: true };
  });
});
