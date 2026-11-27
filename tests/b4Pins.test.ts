import { describe, expect, it } from 'vitest';
import { cardDef, executeAction, GameState, getLegalActions, InstallCardAction } from '../src/core';
import { revealInHand, updateHandKnowledge } from '../src/core/engine/helpers';
import { rdSharesKnownToRunner, runnerSeesRd, shuffleRD, updateRdKnowledge } from '../src/core/engine/rdKnowledge';
import { hqAgendaOdds, serverValue } from '../src/ai/runs';
import { agendaOdds } from '../src/ai/effectValues';
import { newGame } from './helpers';
import '../src/ai';

// B4 pins (brief b4-hidden-zones rev 1c, bar 6): each fails without its change.

/** Applies `change` to a copy of `s` the way an action would, then runs the engine's two knowledge updates. */
function act(s: GameState, change: (next: GameState) => void): GameState {
  const next = structuredClone(s);
  change(next);
  updateHandKnowledge(s, next, updateRdKnowledge(s, next));
  return next;
}

describe('B4a 7(a): HQ odds read only the seen cards surely still there', () => {
  // Red team b4 probe-hq-stale (R-100): the Runner saw all of HQ (3 ice); the Corp draws and installs a seen ice
  // three times. HQ now holds three unseen cards, but the list still names the three ice, and hqAgendaOdds read 0.
  // Each install protects a server, so it was ice (4.6.6d, 10.2.3a): it may have been a seen card (1.12.3).
  it('after three seen ice are installed, HQ is priced as three unseen cards', () => {
    let s: GameState = newGame(3);
    const type = (c: { cardCode: string }) => cardDef(c as never).type_code;
    const ice = s.corp.rd.filter(c => type(c) === 'ice').slice(0, 3);
    const agendas = s.corp.rd.filter(c => type(c) === 'agenda').slice(0, 3);
    s.corp.rd.push(...s.corp.hq);
    s.corp.hq = [...ice];
    s.corp.rd = [...agendas, ...s.corp.rd.filter(c => !ice.includes(c) && !agendas.includes(c))];
    s.corp.credits = 20;
    const iceIds = ice.map(c => c.instanceId);
    revealInHand(s, 'corp', s.corp.hq);
    expect(hqAgendaOdds(s, agendaOdds(s).odds)).toBe(0);
    for (let round = 0; round < 3; round++) {
      s = executeAction(s, { type: 'DRAW_CARD', player: 'corp' });
      const seen = s.corp.hq.find(c => iceIds.includes(c.instanceId))!;
      const install = getLegalActions(s, 'corp').find(a => a.type === 'INSTALL_CARD' && (a as InstallCardAction).cardInstanceId === seen.instanceId)!;
      s = executeAction(s, install);
      s.corp.clicks = 3;
    }
    const odds = agendaOdds(s).odds;
    expect(odds).toBeGreaterThan(0);
    expect(hqAgendaOdds(s, odds)).toBeCloseTo(odds, 9);
  });
});

describe('B4a 7(b): after a shuffle, R&D is priced from the shares of the cards seen there', () => {
  // A shuffle hides where each card is, not that it is in R&D (4.2.2, 8.7.3, 10.2.2b). The Runner saw all five cards
  // of R&D, none an agenda; after the shuffle R&D cannot hold an agenda, so it is worth nothing to access. Before 7(b)
  // the shuffle emptied the Runner's memory and R&D was priced at the deck's odds.
  function seenThenShuffled(): GameState {
    const s0 = newGame(3);
    const type = (c: { cardCode: string }) => cardDef(c as never).type_code;
    s0.corp.hq.push(...s0.corp.rd.filter(c => type(c) === 'agenda'));
    s0.corp.rd = s0.corp.rd.filter(c => type(c) !== 'agenda').slice(0, 5);
    let s = act(s0, n => n.corp.rd.forEach(c => runnerSeesRd(n, c)));
    s = act(s, n => shuffleRD(n));
    return s;
  }
  it('five seen non-agendas shuffled: R&D is worth nothing, also after a draw the share prices', () => {
    let s = seenThenShuffled();
    expect(rdSharesKnownToRunner(s)).toHaveLength(5);
    expect(agendaOdds(s).odds).toBeGreaterThan(0);
    expect(serverValue(s, 'rd')).toBeCloseTo(0, 9);
    s = act(s, n => n.corp.hq.push(...n.corp.rd.splice(0, 1)));
    expect(serverValue(s, 'rd')).toBeCloseTo(0, 9);
  });
  it('a share whose card has surely left does not lower the price', () => {
    let s = seenThenShuffled();
    // The top card is trashed faceup from R&D: the Runner sees it leave (4.4.6, 10.2.3a)
    s = act(s, n => n.corp.archives.faceUp.push(...n.corp.rd.splice(0, 1)));
    expect(rdSharesKnownToRunner(s)).toHaveLength(4);
    const without = structuredClone(s);
    without.corp.rdKnownToRunner = [];
    // The four left lower the price; the trashed card's share no longer does, so R&D is not priced at 0
    expect(serverValue(s, 'rd')).toBeLessThan(serverValue(without, 'rd'));
    expect(serverValue(s, 'rd')).toBeGreaterThan(0);
  });
});

describe('B4a 7(c): a facedown Archives card the Runner surely knows is priced as what it is', () => {
  // The Runner saw the top of R&D; the Corp trashes it facedown (4.4.6b): the Runner knows that card is in Archives
  // (10.2.2b). Every card in Archives is a candidate (7.3.2, 7.4.1d): a known non-agenda is worth nothing, a known agenda is a
  // sure steal. Before 7(c) every facedown card was priced as an unseen one.
  function trashedFacedown(type: 'agenda' | 'operation'): GameState {
    const s0 = newGame(3);
    const card = s0.corp.rd.find(c => cardDef(c).type_code === type)!;
    s0.corp.rd = [card, ...s0.corp.rd.filter(c => c !== card)];
    const s = act(s0, n => runnerSeesRd(n, n.corp.rd[0]));
    return act(s, n => n.corp.archives.faceDown.push(...n.corp.rd.splice(0, 1)));
  }
  it('a known operation: Archives is worth nothing; a known agenda: worth its steal', () => {
    const op = trashedFacedown('operation');
    const unknown = structuredClone(op);
    unknown.corp.archKnownToRunner = [];
    expect(serverValue(unknown, 'archives')).toBeGreaterThan(0);
    expect(serverValue(op, 'archives')).toBeCloseTo(0, 9);
    const agenda = trashedFacedown('agenda');
    const faceUp = structuredClone(agenda);
    faceUp.corp.archives.faceUp.push(...faceUp.corp.archives.faceDown.splice(0, 1));
    faceUp.corp.archKnownToRunner = [];
    expect(serverValue(agenda, 'archives')).toBeCloseTo(serverValue(faceUp, 'archives'), 9);
  });
});
