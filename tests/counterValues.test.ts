import { PACE, accessWorth, damageWorth } from '../src/ai/effectValues';
import { PAYOUT_RISK } from '../src/ai/cardProfiles';
import { CLICK, cardRate } from '../src/ai/valueModel';

const corpCard = () => cardRate(newGame(), 'corp');
import { describe, expect, it } from 'vitest';
import { CardInstance, GameState } from '../src/core';
import { createCardInstance } from '../src/core/engine/gameState';
import { addCounters, rezCost } from '../src/core/engine/cardEffects';
import { COUNTER_WORTH, counterWorth, countersWorth } from '../src/ai/counterValues';
import { installIceForTest, newGame, runnerInstall } from './helpers';

const ANSEL = '30038'; // bioroid sentry, rez 6, three subroutines
const make = (s: GameState, code: string): CardInstance => createCardInstance(s, code);
const worth = (code: string, type: 'credit' | 'virus' | 'power' | 'agenda') => {
  const s = newGame();
  return counterWorth(s, make(s, code), type);
};

describe('counters are worth what they do on their card (value model step 3)', () => {

  it('values Smartware credits less the more are stacked, since it pays out 1 a turn', () => {
    const s = newGame();
    const smartware = make(s, '30033');
    addCounters(smartware, 'credit', 3);
    const three = countersWorth(s, smartware, 'credit');
    expect(three).toBeCloseTo(0.85 + 0.85 ** 2 + 0.85 ** 3);
    addCounters(smartware, 'credit', 3);
    // The next 3 are worth well under the first 3, and under a click for 1 credit each turn
    expect(countersWorth(s, smartware, 'credit') - three).toBeLessThan(1.5);
  });

  it('prices trojan counters by their host', () => {
    let s = newGame();
    const ansel = installIceForTest(s, ANSEL, 'remote-9');
    let botulus: string, tranq: string;
    [s, botulus] = runnerInstall(s, '30004', ansel);
    [s, tranq] = runnerInstall(s, '30017', ansel);
    const prog = (id: string) => s.runner.rig.programs.find(c => c.instanceId === id)!;
    // No breaker for Ansel installed: a broken subroutine is worth the 3 cap
    expect(counterWorth(s, prog(botulus), 'virus')).toBe(3);
    const ice = s.corp.servers['remote-9'].ice[0];
    const tranqWorth = counterWorth(s, prog(tranq), 'virus');
    expect(tranqWorth).toBeCloseTo(ice.isRezzed ? rezCost(s, ice) / 3 : 0.3);
    // A trojan not installed yet (in hand) is priced on the best rezzed ice it could go on, or 0.5 with none rezzed
    const unhosted = { ...prog(botulus), hostedOnId: undefined };
    expect(counterWorth(s, unhosted, 'virus')).toBe(ice.isRezzed ? 3 : 0.5);
  });

  it('Vantage Point: run-only credits, Lampades by the stealth credits it can use, and the Corp counters by what one does', () => {
    expect(worth('36020', 'credit')).toBeCloseTo(0.9); // Methuselah
    expect(worth('36021', 'credit')).toBeCloseTo(0.9); // Touchstone
    expect(worth('36005', 'power')).toBeCloseTo(0.5); // Lampades with no stealth credits
    expect(worth('36037', 'agenda')).toBeCloseTo(1); // Lotus Haze: moves an upgrade
    expect(worth('36035', 'power')).toBeCloseTo(1.5); // Perfect Recall: protects a card for a run
    expect(worth('36045', 'power')).toBeCloseTo(2); // The Red Room: ends a run
  });

  it('Liberation: each counter by what it does', () => {
    const lib: [string, 'credit' | 'virus' | 'power' | 'agenda'][] = [
      ['34003', 'power'], ['34004', 'virus'], ['34015', 'power'], ['34019', 'credit'], ['34022', 'power'], ['34029', 'credit'],
      ['34030', 'credit'], ['34048', 'power'], ['34058', 'credit'], ['34069', 'power'], ['34081', 'power'], ['34083', 'power'],
      ['34084', 'power'], ['34086', 'power'], ['34087', 'credit'], ['34088', 'power'], ['34089', 'power'], ['34090', 'power'],
      ['34097', 'agenda'], ['34099', 'power'], ['34115', 'credit'], ['34123', 'agenda'],
    ];
    for (const [code, type] of lib) expect(worth(code, type), code).toBeGreaterThan(0);
    expect(worth('34081', 'power')).toBeCloseTo(2); // Malandragem: a bypass
    expect(worth('34089', 'power')).toBeCloseTo(1.7); // Coalescence: 2 credits, no click
    expect(worth('34097', 'agenda')).toBeCloseTo(3); // Lightning Laboratory: 2 ice rezzed free
    expect(Object.keys(COUNTER_WORTH).filter(code => code.startsWith('34')).length).toBe(lib.length);
  });
});

describe('the last hand-set counter rates from what each counter turns into (Jeff, 2026-10-28; plan.counterFormulas)', () => {
  const on = (code: string, type: 'credit' | 'virus' | 'power' | 'agenda', setup?: (s: GameState, card: CardInstance) => void) => {
    const s = newGame();
    const card = make(s, code);
    setup?.(s, card);
    return counterWorth(s, card, type);
  };

  it('Nico, Otto, Anthill: a free credit each turn, unless the asset is trashed first', () => {
    for (const code of ['30037', '35040', '35072']) expect(on(code, 'credit')).toBeCloseTo(1 - 2 * PAYOUT_RISK.corpBare);
  });

  it('Mahkota Langit Grid: a credit when there are rez costs to pay in its server, less when there are none', () => {
    const owed = on('35082', 'credit', (s, grid) => {
      s.corp.servers['remote-1'] = { id: 'remote-1', name: 'remote-1', isRemote: true, ice: [make(s, '30072')], root: [grid] };
    });
    const none = on('35082', 'credit', (s, grid) => {
      s.corp.servers['remote-1'] = { id: 'remote-1', name: 'remote-1', isRemote: true, ice: [], root: [grid] };
    });
    expect(owed).toBe(1);
    expect(none).toBe(0);
  });

  it('Phật Gioan Baotixita: a net damage, most turns an agenda is scored or stolen', () => {
    expect(on('35051', 'power')).toBeCloseTo(Math.min(1, 2 * PACE.agendaEvents) * damageWorth(newGame(), 1));
  });

  it('AU Co.: two counters draw 2 of 3 cards', () => {
    expect(on('35046', 'power')).toBeCloseTo((2 * corpCard() + 0.3) / 2);
  });

  it('Project Ingatan: worth more with a card in Archives to install', () => {
    const empty = on('35038', 'agenda');
    const stocked = on('35038', 'agenda', s => s.corp.archives.faceUp.push(make(s, '30072')));
    expect(stocked).toBeGreaterThan(empty);
  });

  it('Sericulture Expansion: 2 advancements, each a click and a credit', () => {
    expect(on('35049', 'agenda')).toBeCloseTo(2 * (CLICK + 1));
  });

  it('Embedded Reporting: the best money operation in R&D drawn next, over an average draw', () => {
    expect(on('35059', 'agenda', s => (s.corp.rd = []))).toBe(0);
    expect(on('35059', 'agenda', s => (s.corp.rd = [make(s, '30075')]))).toBeGreaterThan(0); // Hedge Fund
  });

  it('Off the Books: a card, a click and the install saved', () => {
    expect(on('35071', 'agenda')).toBeGreaterThan(corpCard() + CLICK);
  });

  it('Next Big Thing: 4 cards for a click, worth less into a full hand', () => {
    const roomy = on('35060', 'agenda', s => (s.corp.hq = []));
    const full = on('35060', 'agenda', s => (s.corp.hq = s.corp.hq.slice(0, 5)));
    expect(roomy).toBeCloseTo(4 * corpCard() - CLICK);
    expect(full).toBeLessThan(roomy);
  });

  it('Proprionegation: the steal it stops on a scoring server, more as the Runner nears 7', () => {
    const early = on('35048', 'agenda');
    const late = on('35048', 'agenda', s => (s.runner.score = 5));
    expect(late).toBeGreaterThan(early);
  });

  it('Azimat: worth a credit only as often as there are trash costs to pay', () => {
    expect(on('35029', 'credit')).toBeLessThan(1);
    expect(on('35029', 'credit')).toBeGreaterThan(0);
  });

  it('Red Team, Side Hustle, Pennyshaver: credits less the click or the wait to take them', () => {
    expect(on('30018', 'credit')).toBeLessThan(1);
    expect(on('35034', 'credit', (_s, c) => addCounters(c, 'credit', 5))).toBeGreaterThan(on('35034', 'credit'));
    expect(on('30014', 'credit', (_s, c) => addCounters(c, 'credit', 4))).toBeGreaterThan(on('30014', 'credit'));
  });

  it('Leech: what a +1 boost costs on the cheapest breaker in the rig', () => {
    const none = on('30008', 'virus', s => (s.runner.rig.programs = []));
    const cleaver = on('30008', 'virus', s => (s.runner.rig.programs = [make(s, '30006')])); // 2 credits: +1 strength
    expect(none).toBeCloseTo(0.5 * PAYOUT_RISK.clickWait);
    expect(cleaver).toBeCloseTo(2 * PAYOUT_RISK.clickWait);
  });

  it('Hantu: +2 strength is worth more against a sentry stronger than it', () => {
    const strong = on('35008', 'virus', s => {
      installIceForTest(s, ANSEL, 'hq'); // rezzed, strength 4
    });
    expect(strong).toBeGreaterThan(on('35008', 'virus'));
  });

  it('Devadatta Drone: one more R&D access', () => {
    expect(on('35031', 'power')).toBeCloseTo(PAYOUT_RISK.clickWait * accessWorth(newGame()));
  });

  it('Cacophony: half of sabotage 3, the Corp picking its worst cards', () => {
    expect(on('35010', 'power')).toBeCloseTo(0.75 * corpCard());
  });
});
