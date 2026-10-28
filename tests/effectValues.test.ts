import { describe, expect, it } from 'vitest';
import { getCardDefinition } from '../src/core';
import { CLICK, RATES, cardRate } from '../src/ai/valueModel';
import { EFFECT_CODES, LOCKDOWN, MU, PACE, accessWorth, corpEffect, damageWorth, runSuccess, runnerEffect } from '../src/ai/effectValues';
import { corpKeepValue, econValue, runnerCardValue, upgradeValue } from '../src/ai/cardValues';
import { tuning } from '../src/ai/synergy';
import { installIceForTest, newGame } from './helpers';

const late = () => {
  const s = newGame();
  s.corp.score = 4;
  return s;
};
const keep = (code: string, s = newGame()) => corpEffect(s, code)!.keep;
const rig = (code: string, s = newGame()) => runnerEffect(s, code)!;

describe('the last hand-set cards, priced by what they do (Jeff, 2026-10-28)', () => {
  it('every listed card has a formula for its side', () => {
    for (const code of EFFECT_CODES) {
      const side = getCardDefinition(code).side_code;
      const value = side === 'corp' ? corpEffect(newGame(), code)?.keep : runnerEffect(newGame(), code);
      expect(value, code).toBeTypeOf('number');
      expect(Number.isFinite(value), code).toBe(true);
    }
  });

  it('cardValues uses the formulas while plan.effectValues is on, the hand-set numbers when off', () => {
    const s = newGame();
    expect(corpKeepValue('35039', s)).toBeCloseTo(keep('35039', s));
    expect(runnerCardValue('30013', s)).toBeCloseTo(rig('30013', s) / RATES.rigCardScale);
    tuning.plan.effectValues = false;
    expect(corpKeepValue('35039', s)).toBeCloseTo(3 + RATES.cardDrawn * 3);
    expect(runnerCardValue('30013', s)).toBe(2.5);
    tuning.plan.effectValues = true;
  });

  // ---- Corp assets ----
  it('Byte!: a tag and 3 net damage for 4 credits; a flatline when the grip is small', () => {
    const s = newGame();
    s.runner.grip = s.runner.grip.slice(0, 5);
    const small = newGame();
    small.runner.grip = small.runner.grip.slice(0, 2);
    expect(keep('35050', small)).toBeGreaterThan(keep('35050', s));
  });

  it('Urtica Cipher: half the time, 3 net damage', () => {
    const s = newGame();
    expect(keep('30045', s)).toBeCloseTo(0.5 * damageWorth(s, 3));
  });

  it('Clearinghouse: its 2 meat damage on the damage clock, less the clicks and credits to advance it', () => {
    const s = newGame();
    expect(keep('30061', s)).toBeCloseTo(Math.max(0.5, 0.6 * damageWorth(s, 2) - CLICK - 1));
  });

  it('Idiosyncresis: each advancement is a 5-credit swing for a click and a credit', () => {
    expect(keep('35061')).toBeCloseTo(0.6 * 2 * (5 - CLICK - 1));
  });

  it('Plutus: worth the transactions it can replay from Archives', () => {
    const empty = newGame();
    const stocked = newGame();
    const fund = stocked.corp.hq.find(c => c.cardCode === '30075') ?? { ...stocked.corp.hq[0], cardCode: '30075', instanceId: 'hf' };
    stocked.corp.archives.faceUp.push(fund, { ...fund, instanceId: 'hf2' });
    expect(keep('35073', stocked)).toBeGreaterThan(keep('35073', empty));
  });

  it('Public Access Plaza: a credit a turn, less as the game runs out', () => {
    expect(keep('35062')).toBeGreaterThan(4);
    expect(keep('35062', late())).toBeLessThan(keep('35062'));
    expect(econValue('35062', newGame())).toBeGreaterThan(2.5);
  });

  it('Spin Doctor: 2 cards drawn', () => {
    expect(keep('30053')).toBeCloseTo(2 * cardRate(newGame(), 'corp') + 0.5);
  });

  it('Humanoid Resources: 4 credits and 3 cards, its 3 clicks paid back by 3 free actions', () => {
    expect(keep('35039')).toBeCloseTo(0.9 * (4 + 3 * cardRate(newGame(), 'corp')) - 1);
  });

  it('Phật Gioan Baotixita: counters still to come, used up within 3 turns', () => {
    expect(keep('35051')).toBeGreaterThan(2);
    expect(keep('35051')).toBeLessThan(3 * 1.5 + 0.01);
  });

  // ---- Corp upgrades: [scoring remote, HQ or R&D] ----
  it('AMAZE Amusements: 2 tags on a steal, more often from a remote', () => {
    const [remote, central] = corpEffect(newGame(), '30058')!.upgrade!;
    expect(remote).toBeGreaterThan(central);
  });

  it('Anoetic Void: ending a run costs 2 credits and 2 cards, worth it where agendas sit', () => {
    const [remote, central] = corpEffect(newGame(), '30050')!.upgrade!;
    expect(remote).toBeGreaterThan(central);
    expect(remote).toBeGreaterThan(0);
  });

  it('Malapert Data Vault: only helps where agendas are scored', () => {
    expect(corpEffect(newGame(), '30066')!.upgrade![1]).toBe(0);
  });

  it('Manegarm Skunkworks: 2 clicks or 5 credits for each run here', () => {
    const [remote] = corpEffect(newGame(), '30042')!.upgrade!;
    expect(remote).toBeGreaterThan(Math.min(2 * CLICK, 5)); // more than one run's tax
    expect(upgradeValue('30042', newGame())[0]).toBeGreaterThan(2);
  });

  it('Mahkota Langit Grid: its 2 recurring credits come back each turn they get used', () => {
    expect(keep('35082')).toBeGreaterThan(keep('35082', late()));
  });

  it('Mercia B4LL4RD: a click and a credit saved on each ice it installs', () => {
    expect(keep('35045')).toBeGreaterThan(PACE.iceInHand * (CLICK + 1));
  });

  it('Mitra Aman: once, 3 credits and an ice swap', () => {
    expect(keep('35056')).toBe(5);
  });

  // ---- Runner hardware ----
  it('Bling, Carnivore, Detente, DZMZ, Pantograph, T400, Pennyshaver: at least the memory unit', () => {
    for (const code of ['35006', '30003', '35018', '30022', '30023', '30031', '30014']) expect(rig(code), code).toBeGreaterThanOrEqual(MU);
  });

  it('Docklands Pass: an extra HQ access each turn it runs HQ', () => {
    const s = newGame();
    expect(rig('30013', s)).toBeGreaterThan(PACE.runs * PACE.hqShare * accessWorth(s));
    expect(rig('30013', late())).toBeLessThan(rig('30013', s));
  });

  it('GAMEDRAGON Pro: worth more with a breaker to host it', () => {
    const none = newGame();
    none.runner.rig.programs = [];
    expect(rig('35027', none)).toBeGreaterThan(0);
  });

  it('Madani: a click saved for each program it can still install (at most 3)', () => {
    expect(rig('35028')).toBeLessThanOrEqual(3 * CLICK);
  });

  it('Maglectric Rapid: once, about the rez cost of the best rezzed ice', () => {
    expect(rig('35019')).toBeCloseTo(0.8 * 3);
  });

  it('Pantograph: a credit and maybe a free install on each agenda scored or stolen', () => {
    expect(rig('30023')).toBeGreaterThan(MU + 2);
  });

  it('T400 Memory Diamond: +1 MU and a bigger hand', () => {
    expect(rig('30031')).toBeCloseTo(MU + 0.6 * cardRate(newGame(), 'runner'));
  });

  // ---- Runner programs ----
  it('Chromatophores: worth more on costly rezzed ice', () => {
    expect(rig('35030')).toBe(1.5);
  });

  it('Gourmand: once, a trashed card and a card drawn', () => {
    expect(rig('35007')).toBeCloseTo(0.7 * (4 + cardRate(newGame(), 'runner')));
  });

  it('Botulus and Tranquilizer: a counter a turn for about 3 turns', () => {
    expect(rig('30004')).toBeGreaterThan(0);
    expect(rig('30017')).toBeGreaterThan(0);
  });

  it('Fermenter: a counter a turn worth 2 credits less the click to cash it', () => {
    expect(rig('30007')).toBeGreaterThan(4);
  });

  it('Leech and Conduit: counters from successful runs on centrals (Conduit: R&D)', () => {
    expect(rig('30008')).toBeGreaterThan(0);
    expect(rig('30024')).toBeGreaterThan(0);
  });

  it('Azimat: its credits refill each turn it pays a trash cost', () => {
    expect(rig('35029', late())).toBeLessThan(rig('35029'));
  });

  it('Devadatta Drone and Red Team: all their worth is the counters on them', () => {
    expect(rig('35031')).toBe(0);
    expect(rig('30018')).toBe(0);
  });

  // ---- Runner resources ----
  it('Knickknack O’Brian: an empty card turned into credits and a card now and then', () => {
    expect(rig('35033')).toBeGreaterThan(0);
  });

  it('Cookbook: a virus counter for each virus program still to install', () => {
    const s = newGame();
    s.runner.grip = s.runner.grip.filter(c => getCardDefinition(c.cardCode).type_code !== 'program');
    s.runner.stack = [];
    expect(rig('30009', s)).toBe(0);
  });

  it('Fransofia Ward: a credit off each Corp rez, and a bypass once the Corp is rich', () => {
    const rich = newGame();
    rich.corp.credits = 20;
    expect(rig('35021', rich)).toBeGreaterThan(rig('35021'));
  });

  it('Rent Rioters: 9 credits for 3 clicks', () => {
    expect(rig('35011')).toBeCloseTo(9 - 3 * CLICK);
  });

  it('Verbal Plasticity: a card more on most turns it draws', () => {
    expect(rig('30034')).toBeGreaterThan(rig('30034', late()));
  });

  it('Smartware Distributor and Side Hustle: what the click or the runs still turn into', () => {
    expect(rig('30033')).toBeGreaterThan(3 * 0.9 - CLICK); // used again about every other turn
    expect(rig('35034')).toBeGreaterThan(RATES.drawnCard);
  });

  it('Cacophony: a counter the first time each turn it steals or trashes', () => {
    expect(rig('35010')).toBeGreaterThan(0);
  });
});

describe('Fermenter, Conduit and Mayfly (Jeff, 2026-10-28; plan.cardFixes)', () => {
  it('Fermenter: its counters are banked and can be purged, so it counts for less', () => {
    const on = runnerEffect(newGame(), '30007')!;
    tuning.plan.cardFixes = false;
    const off = runnerEffect(newGame(), '30007')!;
    tuning.plan.cardFixes = true;
    expect(on).toBeLessThan(off);
  });

  it('Conduit: worth the extra accesses on the Conduit runs still to come, less late in the game', () => {
    const early = runnerEffect(newGame(), '30024')!;
    tuning.plan.cardFixes = false;
    const old = runnerEffect(newGame(), '30024')!;
    tuning.plan.cardFixes = true;
    expect(early).toBeGreaterThan(old);
    expect(runnerEffect(late(), '30024')!).toBeLessThan(early);
  });

  it('Mayfly: a breaker trashed after one run is worth a third of a lasting one', async () => {
    const { isOneUse } = await import('../src/ai/evaluate');
    const { playedWorth } = await import('../src/ai/handValues');
    const { createCardInstance } = await import('../src/core/engine/gameState');
    const s = newGame();
    const mayfly = createCardInstance(s, '30032');
    expect(isOneUse(mayfly)).toBe(true);
    const on = playedWorth(s, mayfly);
    tuning.plan.cardFixes = false;
    const off = playedWorth(s, mayfly);
    tuning.plan.cardFixes = true;
    expect(on).toBeLessThan(off);
  });
});

describe('run openness (Jeff, 2026-10-28; plan.runOpenness)', () => {
  const locked = () => {
    const s = newGame();
    s.runner.credits = 5;
    for (const id of ['hq', 'rd']) for (let i = 0; i < 2; i++) installIceForTest(s, '30072', id); // Palisades, rezzed, no fracter
    return s;
  };
  const open = () => {
    const s = newGame();
    s.runner.credits = 5;
    for (const id of ['hq', 'rd']) s.corp.servers[id].ice = [];
    return s;
  };

  it('a bare server is open; rezzed ice the rig can’t pay through mostly ends the run', () => {
    expect(runSuccess(open(), 'rd')).toBe(1);
    expect(runSuccess(locked(), 'rd')).toBeLessThan(0.05);
  });

  it('Leech, Conduit, Pennyshaver, Docklands Pass and Cacophony are worth more on open servers than locked ones', () => {
    for (const code of ['30008', '30024', '30014', '30013', '35010']) expect(rig(code, open()), code).toBeGreaterThan(rig(code, locked()));
  });

  it('later turns count for less as the Corp locks its servers down', () => {
    const s = open();
    const fading = rig('30013', s);
    expect(LOCKDOWN).toBeLessThan(1);
    tuning.plan.runOpenness = false;
    const flat = rig('30013', s) * PACE.success; // the old guess had no success odds at all
    tuning.plan.runOpenness = true;
    expect(fading).toBeLessThan(flat / PACE.success);
  });
});
