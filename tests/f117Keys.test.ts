/**
 * F117 / R-93 (brief netrunner-ai/f117-deck-arrivals/design-brief.md rev 2, D1c and bar 9; ruling-redteam.md, rev 2's
 * point 1): a memo value that reads what the deciding AI knows of HQ is never served across frames that know HQ apart.
 * The two iceProtects entries sit above centralAccess (HQ's stake: a known agenda counts its points, an unseen card the
 * deck's density) and now carry the board's unseen HQ ids in their key, as centralAccess's own entry does
 * (handValues.ts unseenKey). Red on the merge base (beta 701f9ee): the second frame was served the first one's value.
 * The test-only on-hit audit of memo (valueModel.ts memoAudit) is the bar's instrument; its own mechanics are pinned here.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GameState } from '../src/core';
import { giveCard, installIceForTest, newGame } from './helpers';
import { iceWorth } from '../src/ai/iceValues';
import { pricing, valueSet, withPricing } from '../src/ai/pricing';
import { memo, memoAudit } from '../src/ai/valueModel';

afterEach(() => {
  memoAudit.on = false;
  memoAudit.reset();
});

/** HQ holds Send a Message (3 points), two ice and Funhouse; HQ's own ice is a rezzed Palisade. */
function board(): { state: GameState; agenda: string } {
  const state = newGame(3);
  state.corp.hq = [];
  const agenda = giveCard(state, 'corp', '30069');
  giveCard(state, 'corp', '30072');
  giveCard(state, 'corp', '30073');
  giveCard(state, 'corp', '30054');
  installIceForTest(state, '30072', 'hq', true);
  return { state, agenda };
}
/** HQ's ice priced for the Corp in a frame that has seen `ids` of HQ. */
const hqIce = (state: GameState, ids: string[]) => withPricing({ known: { corp: valueSet(ids), runner: null } }, () => iceWorth(state, state.corp.servers.hq.ice[0], 'corp'));

describe('F117 D1c: the iceProtects key carries the unseen HQ ids', () => {
  it('one board asked with the agenda unseen, then seen, gives each time what a fresh board gives', () => {
    const { state, agenda } = board();
    const all = state.corp.hq.map(c => c.instanceId);
    const some = all.filter(id => id !== agenda);
    const fresh = (ids: string[]) => hqIce(structuredClone(state), ids);
    expect(fresh(all)).not.toBe(fresh(some)); // the stake reads the known agenda: the two readings differ
    expect(hqIce(state, some)).toBe(fresh(some));
    expect(hqIce(state, all)).toBe(fresh(all)); // the merge base served the first frame's value here
  });

  it('and in the other order', () => {
    const { state, agenda } = board();
    const all = state.corp.hq.map(c => c.instanceId);
    const some = all.filter(id => id !== agenda);
    expect(hqIce(state, all)).toBe(hqIce(structuredClone(state), all));
    expect(hqIce(state, some)).toBe(hqIce(structuredClone(state), some));
  });

  it('the on-hit audit finds no hit served across the two frames', () => {
    const { state, agenda } = board();
    const all = state.corp.hq.map(c => c.instanceId);
    const some = all.filter(id => id !== agenda);
    memoAudit.on = true;
    hqIce(state, some);
    hqIce(state, all);
    hqIce(state, some);
    hqIce(state, all);
    expect(memoAudit.checked).toBeGreaterThan(0);
    expect(memoAudit.mismatches).toBe(0);
  });
});

describe('the on-hit audit of memo (test-only)', () => {
  it('counts a hit whose key leaves out the known hands, and the frame it came from', () => {
    const { state } = board();
    const known = () => pricing().known.corp?.size ?? -1;
    const ask = (n: number) => withPricing({ known: { corp: valueSet(state.corp.hq.slice(0, n).map(c => c.instanceId)), runner: null } }, () => memo(state, 'f117AuditProbe', known));
    memoAudit.on = true;
    expect(ask(1)).toBe(1);
    expect(ask(2)).toBe(1); // served from the first frame: the key leaves the known hand out
    expect(ask(1)).toBe(1); // a hit in the frame that made it
    expect(memoAudit.checked).toBe(2);
    expect(memoAudit.mismatches).toBe(1);
    expect(memoAudit.otherKnown).toBe(1);
    expect(memoAudit.otherKnownMismatches).toBe(1);
    expect(memoAudit.byName.get('f117AuditProbe')).toMatchObject({ checked: 2, mismatches: 1, otherKnown: 1 });
  });

  it('is off in play: a hit is served without working the value out again', () => {
    const { state } = board();
    let runs = 0;
    memo(state, 'f117AuditOff', () => ++runs);
    memo(state, 'f117AuditOff', () => ++runs);
    expect(runs).toBe(1);
    expect(memoAudit.checked).toBe(0);
  });
});
