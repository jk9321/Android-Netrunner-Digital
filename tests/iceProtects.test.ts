import { afterEach, describe, expect, it } from 'vitest';
import { iceWorth } from '../src/ai/iceValues';
import { evaluate } from '../src/ai/evaluate';
import { tuning } from '../src/ai/synergy';
import { cardDef, createCardInstance, GameState } from '../src/core';
import { newGame } from './helpers';
import { inDecision } from './helpers/pricing';

/**
 * plan.iceProtects (install-worth side check, probe P1, 2026-11-08): the Corp prices its installed ice by what it
 * protects. A successful run breaches the server and accesses its cards (comprehensive rules 7.4.1, 7.4.1b-c), so the
 * ice in front of an advanced agenda holds back a steal, and the same ice in front of nothing holds back nothing.
 * The break cost (what it costs the Runner to get past) stays the cap.
 */
const JAGUARUNDI = '34035';
const OFFWORLD_OFFICE = '30067';
const defaultOn = tuning.plan.iceProtects;
afterEach(() => { tuning.plan.iceProtects = defaultOn; });

function remoteWithJaguarundi(agenda: boolean): { s: GameState; worth: (viewer?: 'corp' | 'runner') => number } {
  const s = newGame();
  s.corp.credits = 10;
  s.corp.hq = [];
  s.corp.rd = s.corp.rd.filter(c => cardDef(c).type_code !== "agenda"); // no agenda to come for the remote
  const ice = createCardInstance(s, JAGUARUNDI);
  const root = [];
  if (agenda) {
    const offworld = createCardInstance(s, OFFWORLD_OFFICE);
    offworld.advancementCounters = 2;
    root.push(offworld);
  }
  s.corp.servers['remote-1'] = { id: 'remote-1', name: 'Remote Server 1', isRemote: true, ice: [ice], root };
  return { s, worth: (viewer = 'corp') => inDecision(s, viewer, () => iceWorth(s, ice, viewer)) };
}

describe('plan.iceProtects', () => {
  it('is off by default', () => expect(defaultOn).toBe(false));

  it('the same unrezzed Jaguarundi is worth more in front of an advanced Offworld Office than an empty remote', () => {
    tuning.plan.iceProtects = true;
    const guarded = remoteWithJaguarundi(true).worth();
    const empty = remoteWithJaguarundi(false).worth();
    expect(guarded).toBeGreaterThan(empty);
  });

  it('is never worth more than with the switch off (the break cost is the cap)', () => {
    for (const agenda of [true, false]) {
      const { worth } = remoteWithJaguarundi(agenda);
      tuning.plan.iceProtects = false;
      const off = worth();
      tuning.plan.iceProtects = true;
      expect(worth()).toBeLessThanOrEqual(off + 1e-9);
    }
  });

  it('leaves the Runner view alone', () => {
    const { worth } = remoteWithJaguarundi(false);
    tuning.plan.iceProtects = false;
    const off = worth('runner');
    tuning.plan.iceProtects = true;
    expect(worth('runner')).toBe(off);
  });
});

describe('plan.iceProtects: the scoring remote', () => {
  it('keeps its ice worth after the agenda in it is scored while agendas are still to come', () => {
    tuning.plan.iceProtects = true;
    const { s, worth } = remoteWithJaguarundi(false);
    const idle = worth();
    s.corp.rd.unshift(createCardInstance(s, OFFWORLD_OFFICE));
    expect(worth()).toBeGreaterThan(idle);
  });
});

describe('plan.iceProtects: ice in HQ (review R1)', () => {
  const rezBudgetOn = tuning.plan.rezBudget;
  afterEach(() => { tuning.plan.rezBudget = rezBudgetOn; });
  const handWorth = (s: GameState, ice: ReturnType<typeof createCardInstance>) => inDecision(s, 'corp', () => iceWorth(s, { ...ice, isRezzed: false }, 'corp'));

  // Shipped config (plan.rezBudget on): ice in HQ has no share of the rez budget, so its break-cost term is 0 and the
  // switch can't change the hand copy (handValues prices it at RATES.ice; protects() never enters)
  it('with the rez budget on, the HQ copy is worth the same with the switch on or off', () => {
    const { s } = remoteWithJaguarundi(true);
    const held = createCardInstance(s, JAGUARUNDI);
    s.corp.hq = [held];
    tuning.plan.iceProtects = false;
    const off = handWorth(s, held);
    tuning.plan.iceProtects = true;
    expect(handWorth(s, held)).toBe(off);
  });

  // Without the rez budget the hand copy keeps a break-cost term: priced at the best server it could join, so holding
  // it never reads more than installing it there
  it('rez budget off: a second Jaguarundi in HQ is worth what it would be in front of the advanced Offworld Office', () => {
    tuning.plan.iceProtects = true;
    tuning.plan.rezBudget = false;
    const { s } = remoteWithJaguarundi(true);
    const held = createCardInstance(s, JAGUARUNDI);
    s.corp.hq = [held];
    const inHq = handWorth(s, held);
    const installed: GameState = structuredClone(s);
    installed.corp.hq = [];
    installed.corp.servers['remote-1'].ice.push({ ...held, isRezzed: false });
    const there = inDecision(installed, 'corp', () => iceWorth(installed, installed.corp.servers['remote-1'].ice[1], 'corp'));
    // (within 1%: the board around it differs by the card leaving HQ)
    expect(Math.abs(inHq - there)).toBeLessThan(0.01 * there);
  });

  it('rez budget off: with nothing to protect anywhere, the HQ copy is priced as unguarded ice, below the switch-off worth', () => {
    tuning.plan.rezBudget = false;
    const { s } = remoteWithJaguarundi(false);
    const held = createCardInstance(s, JAGUARUNDI);
    s.corp.hq = [held];
    tuning.plan.iceProtects = false;
    const off = handWorth(s, held);
    tuning.plan.iceProtects = true;
    expect(handWorth(s, held)).toBeLessThan(off);
  });
});

describe('plan.iceProtects: no value loop through the root card (review 2 batch)', () => {
  // The stake of an asset or upgrade was its priced worth, which reads the server's ice (Manegarm's tax, a money
  // asset's trash risk behind ice), which read the stake: a loop, played on with flat values (vitest throws on one)
  it.each([['Manegarm Skunkworks', '30042', '30039'], ['Regolith Mining License', '30071', '35079']])('%s behind rezzed ice prices without a loop', (_title, root, iceCode) => {
    tuning.plan.iceProtects = true;
    const s = newGame();
    s.corp.credits = 10;
    const card = createCardInstance(s, root);
    card.isRezzed = true;
    const ice = createCardInstance(s, iceCode);
    ice.isRezzed = true;
    s.corp.servers['remote-1'] = { id: 'remote-1', name: 'Remote Server 1', isRemote: true, ice: [ice], root: [card] };
    expect(() => inDecision(s, 'corp', () => evaluate(s, 'corp'))).not.toThrow();
  });
});
