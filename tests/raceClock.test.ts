import { afterEach, describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { OPEN_FLOOR, clock } from '../src/ai/clock';
import { agendaWorth, nearestAgendaTurns } from '../src/ai/evaluate';
import { turnsLeft } from '../src/ai/cardProfiles';
import { tuning } from '../src/ai/synergy';
import { installForTest, newGame } from './helpers';
import { inDecision } from './helpers/pricing';

/**
 * The race clock (tuning pass 1, plan.raceClock; src/ai/clock.ts): the Runner's expected points a turn on this board,
 * as the Corp sees it, and the pieces that read it.
 */
const off = { ...tuning.plan.raceClock };
afterEach(() => { tuning.plan.raceClock = { ...off }; });
const corp = <T>(s: GameState, fn: () => T) => inDecision(s, 'corp', fn);

describe('the race clock (plan.raceClock)', () => {
  it('an agenda in a bare remote raises the Runner\'s rate by about its points', () => {
    const s = newGame();
    const before = corp(s, () => clock(s).runnerRate);
    installForTest(s, 'agenda', 'remote-1');
    const after = corp({ ...s, id: `${s.id}-agenda` }, () => clock(s).runnerRate);
    expect(after).toBeGreaterThan(before + 0.5);
  });

  it('open() starts at 1, falls with the turns, and is floored', () => {
    const s = newGame();
    const c = corp(s, () => clock(s));
    expect(c.open(0)).toBe(1);
    expect(c.open(2)).toBeLessThanOrEqual(c.open(1));
    expect(c.open(100)).toBe(OPEN_FLOOR);
  });

  it('tempo: an agenda held in HQ costs more to wait with than the old discount', () => {
    const s = newGame();
    const held = () => corp(s, () => agendaWorth(s, 0, 3, 2, undefined, 1, true));
    const old = held();
    tuning.plan.raceClock = { ...off, tempo: true };
    expect(corp({ ...s, id: `${s.id}-tempo` }, () => agendaWorth(s, 0, 3, 2, undefined, 1, true))).toBeLessThan(old);
  });

  it('horizon: turnsLeft is at least 2 and at most 14', () => {
    const s = newGame();
    tuning.plan.raceClock = { ...off, horizon: true };
    const t = corp(s, () => turnsLeft(s));
    expect(t).toBeGreaterThanOrEqual(2);
    expect(t).toBeLessThanOrEqual(14);
  });

  it('tempoOnce: a held agenda waits a turn longer than the same agenda installed', () => {
    const held = newGame();
    held.corp.hq = [];
    held.activePlayer = 'corp';
    held.corp.clicks = 3;
    held.corp.credits = 5;
    const installed = JSON.parse(JSON.stringify(held)) as GameState;
    installForTest(installed, 'agenda', 'remote-1');
    const agenda = installed.corp.servers['remote-1'].root[0];
    held.corp.hq.push({ ...agenda });
    tuning.plan.raceClock = { ...off, tempoOnce: true };
    const h = corp(held, () => nearestAgendaTurns(held));
    const i = corp(installed, () => nearestAgendaTurns(installed));
    expect(h).toBeGreaterThan(i);
    expect(corp(newGame(), () => nearestAgendaTurns(newGame()))).toBeGreaterThanOrEqual(0);
  });
});
