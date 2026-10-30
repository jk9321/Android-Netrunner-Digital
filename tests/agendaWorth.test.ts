import { describe, expect, it } from 'vitest';
import { agendaWorth, archivedAgendaLoss, evaluate, keepValue } from '../src/ai/evaluate';
import { cardDef } from '../src/core';
import { playedWorth } from '../src/ai/handValues';
import { iceWorth } from '../src/ai/iceValues';
import { CLICK, pointValue } from '../src/ai/valueModel';
import { createCardInstance } from '../src/core';
import { installIceForTest, newGame } from './helpers';
import { STEAL, runSuccess, stealOdds } from '../src/ai/effectValues';

const PALISADE = '30072';

/** A remote with two rezzed Palisades the rig can't break, and a bare one. */
function remotes() {
  const s = newGame();
  s.runner.rig.programs = [];
  s.runner.credits = 5;
  installIceForTest(s, PALISADE, 'remote-1');
  installIceForTest(s, PALISADE, 'remote-1');
  s.corp.servers['remote-2'] = { id: 'remote-2', name: 'remote-2', isRemote: true, ice: [], root: [] };
  return s;
}

describe('agendas on the board (Jeff, 2026-10-28; plan.agendaBoard)', () => {
  it('scoreable on the Corp’s turn: worth its points on the clock', () => {
    const s = remotes();
    s.activePlayer = 'corp';
    expect(agendaWorth(s, 3, 3, 2, 'remote-2')).toBeCloseTo(pointValue(2) - pointValue(0));
  });

  it('waiting for the Runner’s turn: worth more behind ice the rig can’t get through', () => {
    const s = remotes();
    s.activePlayer = 'runner';
    const iced = agendaWorth(s, 3, 3, 2, 'remote-1');
    const bare = agendaWorth(s, 3, 3, 2, 'remote-2');
    expect(iced).toBeGreaterThan(bare);
    expect(bare).toBeCloseTo(0); // an open remote: as good as stolen (plan.openSteal)
  });

  it('each advancement brings it closer: the click and credit it took come back', () => {
    const s = remotes();
    s.activePlayer = 'corp';
    expect(agendaWorth(s, 1, 3, 2, 'remote-1') - agendaWorth(s, 0, 3, 2, 'remote-1')).toBeCloseTo(CLICK + 1);
  });

  it('in HQ, an agenda is worth installing in the safest remote, as the board will value it', () => {
    const s = remotes();
    const agenda = createCardInstance(s, '30069'); // Send a Message
    expect(playedWorth(s, agenda)).toBeCloseTo(agendaWorth(s, 0, 5, 3, 'remote-1') - CLICK);
  });

  it('ice in HQ is worth what it will be installed, less the click', () => {
    const s = remotes();
    const ice = createCardInstance(s, PALISADE);
    expect(playedWorth(s, ice)).toBeCloseTo(iceWorth(s, { ...ice, isRezzed: false }, 'corp') - CLICK);
  });

  it('an agenda let go goes to Archives, where the Runner steals it: never the first card to discard (rule 7.3.2)', () => {
    const s = newGame();
    const agenda = s.corp.rd.find(c => cardDef(c).type_code === 'agenda')!;
    const ice = s.corp.rd.find(c => cardDef(c).type_code === 'ice')!;
    s.corp.hq = [agenda, ice];
    expect(keepValue(s, agenda)).toBeGreaterThan(keepValue(s, ice));
    expect(archivedAgendaLoss(s, 2)).toBeGreaterThan(0);
    expect(archivedAgendaLoss(s, 2)).toBeLessThanOrEqual(pointValue(2));
    // On the board too: the Corp sees its facedown agenda in Archives as a likely steal
    const before = evaluate(s, 'corp', true);
    s.corp.archives.faceDown.push(s.corp.hq.shift()!);
    expect(evaluate(s, 'corp', true)).toBeLessThan(before);
  });

  it('sooner is better: an agenda the Corp can finish this turn beats one that waits a Runner turn (plan.agendaTempo)', () => {
    const s = remotes();
    s.activePlayer = 'corp';
    s.corp.clicks = 3;
    const now = agendaWorth(s, 0, 3, 2, 'remote-2');
    s.corp.clicks = 2;
    const later = agendaWorth(s, 0, 3, 2, 'remote-2');
    expect(now).toBeGreaterThan(later);
    // From hand it takes a click more to install
    expect(agendaWorth(s, 0, 2, 2, 'remote-2', undefined, true)).toBeLessThan(agendaWorth(s, 0, 2, 2, 'remote-2'));
  });
});

describe('steal odds as measured (Jeff, 2026-10-28; plan.stealOdds)', () => {
  it('an open remote is as good as stolen (Jeff, plan.openSteal)', () => {
    const s = remotes();
    s.activePlayer = 'corp';
    expect(stealOdds(s, 'remote-2')).toBe(1);
  });

  it('ice is judged against the credits the Runner can raise on its turn, not what it holds now', () => {
    const s = newGame();
    installIceForTest(s, PALISADE, 'remote-1');
    s.corp.servers['remote-1'].ice[0].isRezzed = true;
    s.activePlayer = 'corp';
    const broke = { ...s, runner: { ...s.runner, credits: 0 } };
    expect(stealOdds(broke, 'remote-1', STEAL.run, 0)).toBeLessThanOrEqual(stealOdds(broke, 'remote-1', STEAL.run, 4));
    expect(stealOdds(s, 'remote-1')).toBeGreaterThanOrEqual(STEAL.run * runSuccess(s, 'remote-1') - 1e-9);
  });
});


describe('plan switches for one side (Jeff, 2026-10-29; synergy.ts sideOff)', () => {
  it('a side decides with its own plan, nested inside the other side, and the base plan comes back', async () => {
    const { asSide, sideOff, tuning } = await import('../src/ai/synergy');
    const saved = sideOff.corp;
    sideOff.corp = ['flatRates'];
    try {
      const base = tuning.plan;
      asSide('corp', () => {
        expect(tuning.plan.flatRates).toBe(false);
        asSide('runner', () => expect(tuning.plan.flatRates).toBe(base.flatRates));
        expect(tuning.plan.flatRates).toBe(false);
      });
      expect(tuning.plan).toBe(base);
    } finally {
      sideOff.corp = saved;
    }
  });
});

describe('ice that cannot end the run (Jeff, 2026-10-30; plan.tankIce)', () => {
  const remote = (s: ReturnType<typeof newGame>) => {
    s.corp.servers['remote-1'] = { id: 'remote-1', name: 'Remote Server 1', isRemote: true, ice: [], root: [] };
    installIceForTest(s, '35063', 'remote-1'); // Doomscroll: a tag and net damage, no end the run
  };

  it('Doomscroll stops little against a broke Runner with a full grip', () => {
    const s = newGame();
    remote(s);
    s.runner.credits = 0;
    expect(s.runner.grip.length).toBeGreaterThanOrEqual(4);
    expect(stealOdds(s, 'remote-1')).toBeGreaterThan(STEAL.run * 0.5);
  });

  it('but holds off a Runner it would flatline', () => {
    const s = newGame();
    remote(s);
    s.runner.credits = 0;
    s.runner.grip = s.runner.grip.slice(0, 1);
    s.runner.tags = 1; // the third subroutine's 2 net damage too
    expect(stealOdds(s, 'remote-1')).toBeLessThan(STEAL.run * 0.2);
  });
});
