import { describe, expect, it } from 'vitest';
import { createCardInstance, GameState, knownInHand } from '../src/core';
import { knownInRd, noteRdPrivate, runnerSeesRd, shuffleRD, updateRdKnowledge } from '../src/core/engine/rdKnowledge';
import { answer, cont, newGame, passTurn, run, startRunnerTurn } from './helpers';
import { getCardDefinition } from '../src/core';
import { serverValue } from '../src/ai/runs';

// The Runner remembers R&D cards they saw (rules 7.4.7a: R&D is accessed top
// down and accessed cards stay in place) until the cards are drawn (1.8.5),
// R&D is shuffled, or the cards move somewhere else. Cards the Corp acts on
// in secret could be anywhere among those cards (8.3.3, 1.12.3).

const SG = { hedgeFund: '30075', palisade: '30072', regolith: '30071' };

/** Applies `change` to a copy of `s` the way an action would, then updates the Runner's memory. */
function act(s: GameState, change: (next: GameState) => void): GameState {
  const next = structuredClone(s);
  change(next);
  updateRdKnowledge(s, next);
  return next;
}
const draw = (s: GameState, n = 1) => act(s, n2 => n2.corp.hq.push(...n2.corp.rd.splice(0, n)));
const where = (s: GameState) => knownInRd(s).map(e => [e.code, e.lo, e.hi, e.left ?? null]);
const inHq = (s: GameState) => knownInHand(s, 'corp').map(c => c.id);

/** A game whose R&D holds a known card at `pos` (0 is the top). */
function seenAt(pos: number, code = SG.hedgeFund): [GameState, string] {
  const s = newGame();
  const card = createCardInstance(s, code);
  s.corp.rd.splice(pos, 0, card);
  const seen = act(s, n => runnerSeesRd(n, card));
  return [seen, card.instanceId];
}

describe('R&D cards the Runner has seen', () => {
  it('an R&D card accessed and left is remembered on top; when drawn it joins the cards known in HQ', () => {
    const s0 = newGame();
    const fund = createCardInstance(s0, SG.hedgeFund);
    s0.corp.rd.unshift(fund);
    startRunnerTurn(s0);
    let s = cont(run(s0, 'rd'));
    for (let i = 0; i < 10 && s.pendingPrompts.length > 0; i++) {
      s = s.pendingPrompts[0].kind === 'access_trash' ? answer(s, { kind: 'access_trash', trash: false }) : cont(s);
    }
    expect(where(s)).toEqual([[SG.hedgeFund, 0, 0, null]]);
    s = passTurn(s); // Corp's mandatory draw takes the top card (rules 5.1.2, 1.8.5)
    expect(knownInRd(s)).toEqual([]);
    expect(inHq(s)).toContain(fund.instanceId);
  });

  it('follows the card as cards are drawn above it and added to the top', () => {
    let [s, id] = seenAt(2);
    s = draw(s);
    expect(where(s)).toEqual([[SG.hedgeFund, 1, 1, null]]);
    s = act(s, n => n.corp.rd.unshift(n.corp.hq.pop()!));
    expect(where(s)).toEqual([[SG.hedgeFund, 2, 2, null]]);
    s = draw(s, 2);
    expect(inHq(s)).not.toContain(id);
    s = draw(s);
    expect(inHq(s)).toContain(id);
  });

  it('a seen card trashed from the top (facedown) is forgotten, not added to HQ', () => {
    let [s, id] = seenAt(0);
    s = act(s, n => n.corp.archives.faceDown.push(...n.corp.rd.splice(0, 1)));
    expect(knownInRd(s)).toEqual([]);
    expect(inHq(s)).not.toContain(id);
  });

  // Jeff: 1 known card in a rearranged top 3 isn't certainly drawn until 3 draws later
  it('after the Corp rearranges the top 3, the card is only certainly in HQ after 3 draws', () => {
    let [s, id] = seenAt(1);
    s = act(s, n => {
      n.corp.rd.unshift(...n.corp.rd.splice(0, 3).reverse());
      noteRdPrivate(n, 3);
    });
    expect(where(s)).toEqual([[SG.hedgeFund, 0, 2, null]]);
    s = draw(s);
    expect(where(s)).toEqual([[SG.hedgeFund, 0, 1, 'hq']]);
    expect(inHq(s)).not.toContain(id);
    s = draw(s);
    expect(where(s)).toEqual([[SG.hedgeFund, 0, 0, 'hq']]);
    expect(inHq(s)).not.toContain(id);
    s = draw(s);
    expect(knownInRd(s)).toEqual([]);
    expect(inHq(s)).toContain(id);
  });

  it('rearranging does not tell the Runner whether the order changed', () => {
    const [s0] = seenAt(0);
    const same = act(s0, n => noteRdPrivate(n, 4));
    const swapped = act(s0, n => {
      n.corp.rd.splice(1, 0, n.corp.rd.shift()!);
      noteRdPrivate(n, 4);
    });
    expect(where(same)).toEqual([[SG.hedgeFund, 0, 3, null]]);
    expect(where(swapped)).toEqual(where(same));
  });

  it('Cultivate: a card that may have been trashed or added to HQ is dropped once it has certainly left', () => {
    let [s, id] = seenAt(2);
    s = act(s, n => {
      n.corp.archives.faceDown.push(n.corp.rd.splice(4, 1)[0]); // trashes some other card, secretly
      noteRdPrivate(n, 5);
    });
    expect(where(s)).toEqual([[SG.hedgeFund, 0, 3, 'other']]);
    s = act(s, n => {
      n.corp.hq.push(n.corp.rd.splice(2, 1)[0]); // the seen card goes to HQ, secretly
      noteRdPrivate(n, 4);
    });
    expect(where(s)).toEqual([[SG.hedgeFund, 0, 2, 'other']]);
    s = draw(s, 3);
    expect(knownInRd(s)).toEqual([]);
    expect(inHq(s)).not.toContain(id); // it might have been the trashed card
  });

  it('a shuffle forgets everything', () => {
    let [s] = seenAt(0);
    s = act(s, n => shuffleRD(n));
    expect(knownInRd(s)).toEqual([]);
  });

  it('a seen top card moved to the bottom (ezaM) is known on the bottom', () => {
    let [s] = seenAt(0);
    s = act(s, n => n.corp.rd.push(n.corp.rd.shift()!));
    const last = s.corp.rd.length - 1;
    expect(where(s)).toEqual([[SG.hedgeFund, last, last, null]]);
  });

  it('seeing the top card narrows where an earlier rearranged card can be', () => {
    let [s, id] = seenAt(0, SG.palisade);
    s = act(s, n => {
      n.corp.rd.splice(2, 0, n.corp.rd.shift()!);
      noteRdPrivate(n, 3);
    });
    s = act(s, n => runnerSeesRd(n, n.corp.rd[0]));
    expect(knownInRd(s).find(e => e.id === id)).toMatchObject({ lo: 1, hi: 2 });
    expect(knownInRd(s).find(e => e.id !== id)).toMatchObject({ lo: 0, hi: 0 });
  });

  it('a public card put on top of R&D (from faceup Archives) is known there', () => {
    const s0 = newGame();
    const fund = createCardInstance(s0, SG.hedgeFund);
    s0.corp.archives.faceUp.push(fund);
    let s = act(s0, n => runnerSeesRd(n, n.corp.rd[3]));
    s = act(s, n => n.corp.rd.unshift(n.corp.archives.faceUp.pop()!));
    expect(knownInRd(s).map(e => [e.id, e.lo])).toContainEqual([fund.instanceId, 0]);
    expect(knownInRd(s).find(e => e.id !== fund.instanceId)?.lo).toBe(4);
  });
});

describe('Runner AI: R&D runs priced from what it remembers', () => {
  const agenda = '30052'; // Tomorrow's Headline
  it('a remembered non-agenda on top makes a single-access R&D run worth nothing; a remembered agenda makes it worth more', () => {
    expect(getCardDefinition(agenda).type_code).toBe('agenda');
    const s0 = newGame();
    s0.corp.rd.unshift(createCardInstance(s0, SG.hedgeFund));
    const unseen = serverValue(s0, 'rd');
    const fund = act(s0, n => runnerSeesRd(n, n.corp.rd[0]));
    expect(serverValue(fund, 'rd')).toBe(0);
    expect(serverValue(fund, 'rd', 1)).toBeCloseTo(unseen, 5); // the 2nd card is still unseen
    const s1 = newGame();
    s1.corp.rd.unshift(createCardInstance(s1, agenda));
    const known = act(s1, n => runnerSeesRd(n, n.corp.rd[0]));
    expect(serverValue(known, 'rd')).toBeGreaterThan(serverValue(s1, 'rd'));
  });
});
