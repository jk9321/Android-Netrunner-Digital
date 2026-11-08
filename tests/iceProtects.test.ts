import { afterEach, describe, expect, it } from 'vitest';
import { iceWorth } from '../src/ai/iceValues';
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
