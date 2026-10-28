import { describe, expect, it } from 'vitest';
import { AGENDA_RUN, agendaWorth, archivedAgendaLoss, evaluate, keepValue } from '../src/ai/evaluate';
import { cardDef } from '../src/core';
import { playedWorth } from '../src/ai/handValues';
import { iceWorth } from '../src/ai/iceValues';
import { CLICK, pointValue } from '../src/ai/valueModel';
import { createCardInstance } from '../src/core';
import { installIceForTest, newGame } from './helpers';

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
    expect(bare).toBeCloseTo((pointValue(2) - pointValue(0)) * (1 - AGENDA_RUN));
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
});
