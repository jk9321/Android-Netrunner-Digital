import { describe, expect, it } from 'vitest';
import { createCardInstance, executeAction, GameState, knownInHand } from '../src/core';
import { certainInArchives, certainInHand, revealInHand, updateHandKnowledge } from '../src/core/engine/helpers';
import { knownInRd, rdSharesKnownToRunner, runnerSeesRd, shuffleRD, updateRdKnowledge } from '../src/core/engine/rdKnowledge';
import { newGame } from './helpers';

// B4a (brief b4-hidden-zones rev 1b, ruling 1 as amended by ruling 20.5): what one side knows is still in the other's
// hidden zone. A seen card stays known (10.2.2b: nothing un-learns it) until a card leaves the zone unseen that could
// have been it (1.12.3: a card gone to a hidden place is not followed). Where a card is installed is open information
// (4.6.6a, f, 10.2.3a): installed protecting a server it is ice (4.6.6d), in a remote root an agenda, asset or upgrade,
// in a central root an upgrade (4.6.6e). Readers count by code: the entries less the departures that could be that code.

const SG = { hedgeFund: '30075', palisade: '30072', regolith: '30071', sureGamble: '30030', cleaver: '30006' };

/** Applies `change` to a copy of `s` the way an action would, then runs the engine's two knowledge updates. */
function act(s: GameState, change: (next: GameState) => void): GameState {
  const next = structuredClone(s);
  change(next);
  updateRdKnowledge(s, next);
  updateHandKnowledge(s, next);
  return next;
}
const take = <T extends { instanceId: string }>(zone: T[], id: string): T => zone.splice(zone.findIndex(c => c.instanceId === id), 1)[0];

/** HQ holds the given codes; the Runner has seen the first `seen` of them. */
function hq(codes: string[], seen: number): { s: GameState; ids: string[] } {
  const s = newGame();
  const cards = codes.map(code => createCardInstance(s, code));
  s.corp.hq = cards;
  revealInHand(s, 'corp', cards.slice(0, seen));
  return { s, ids: cards.map(c => c.instanceId) };
}

describe('B4a: a seen HQ card stays known until a card that could be it leaves unseen', () => {
  it('a card installed protecting a server is ice, so a seen operation and a seen asset stay certain (4.6.6a, d, 10.2.3a)', () => {
    const { s, ids } = hq([SG.hedgeFund, SG.regolith, SG.palisade], 2);
    const after = act(s, n => n.corp.servers.hq.ice.push(take(n.corp.hq, ids[2])));
    expect(certainInHand(after, 'corp')).toEqual([
      [SG.regolith, 1],
      [SG.hedgeFund, 1],
    ].sort());
  });

  it('a card installed facedown in a remote root may be the seen asset, but not the seen operation (4.6.6e)', () => {
    const { s, ids } = hq([SG.hedgeFund, SG.regolith, SG.palisade], 2);
    s.activePlayer = 'corp';
    s.phase = 'corp_turn';
    s.corp.clicks = 3;
    s.corp.credits = 20;
    const after = executeAction(s, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: ids[1], asNewRemote: true });
    // The screen's list still says "could be" (knownInHand.test.ts); the count no longer calls the Regolith certain
    expect(knownInHand(after, 'corp').map(k => k.code)).toEqual([SG.hedgeFund, SG.regolith]);
    expect(certainInHand(after, 'corp')).toEqual([[SG.hedgeFund, 1]]);
  });

  it('a card installed in a central root is an upgrade, so a seen asset stays certain (4.6.6e)', () => {
    const { s, ids } = hq([SG.regolith, SG.palisade], 1);
    const after = act(s, n => n.corp.servers.rd.root.push(take(n.corp.hq, ids[1])));
    expect(certainInHand(after, 'corp')).toEqual([[SG.regolith, 1]]);
  });

  it('any other unseen departure (a facedown discard) may be any seen card (1.12.3, 4.4.6b)', () => {
    const { s, ids } = hq([SG.hedgeFund, SG.regolith, SG.palisade], 2);
    const after = act(s, n => n.corp.archives.faceDown.push(take(n.corp.hq, ids[2])));
    expect(certainInHand(after, 'corp')).toEqual([]);
    expect(knownInHand(after, 'corp')).toHaveLength(2);
  });

  it('a card seen after a departure is certain; one seen before it is not (count by code and count)', () => {
    const { s, ids } = hq([SG.hedgeFund, SG.hedgeFund, SG.palisade], 1);
    let after = act(s, n => n.corp.archives.faceDown.push(take(n.corp.hq, ids[2])));
    expect(certainInHand(after, 'corp')).toEqual([]);
    revealInHand(after, 'corp', [after.corp.hq.find(c => c.instanceId === ids[1])!]);
    expect(certainInHand(after, 'corp')).toEqual([[SG.hedgeFund, 1]]);
    // Seeing the first one again makes it certain again too
    revealInHand(after, 'corp', [after.corp.hq.find(c => c.instanceId === ids[0])!]);
    after = act(after, () => undefined);
    expect(certainInHand(after, 'corp')).toEqual([[SG.hedgeFund, 2]]);
  });

  // B4a gap 1 (step 0, 2.2): the list used to keep a card the Runner saw leave, and the count took it as still there
  it('a seen card the Runner follows from HQ into R&D leaves the list, and is no unseen departure (10.2.2b, 1.12.4)', () => {
    const { s, ids } = hq([SG.hedgeFund, SG.regolith, SG.palisade], 2);
    const after = act(s, n => {
      n.corp.rd.unshift(take(n.corp.hq, ids[0]));
      runnerSeesRd(n, n.corp.rd[0]);
    });
    expect(knownInHand(after, 'corp').map(k => k.code)).toEqual([SG.regolith]);
    expect(certainInHand(after, 'corp')).toEqual([[SG.regolith, 1]]);
    expect(knownInRd(after).map(e => [e.code, e.lo, e.hi])).toEqual([[SG.hedgeFund, 0, 0]]);
  });

  // B4a gap 3 (step 0, 2.2): a known ice returned to HQ was not listed
  it('a rezzed ice returned to HQ (Hermes, Descent) is a card the Runner saw go there (10.2.2b, 10.2.3a)', () => {
    const s = newGame();
    const ice = createCardInstance(s, SG.palisade);
    ice.isRezzed = true;
    s.corp.servers.hq.ice.push(ice);
    const after = act(s, n => n.corp.hq.push(take(n.corp.servers.hq.ice, ice.instanceId)));
    expect(knownInHand(after, 'corp').map(k => k.id)).toEqual([ice.instanceId]);
    expect(certainInHand(after, 'corp')).toEqual([[SG.palisade, 1]]);
  });

  it('a heap card taken back to the grip is one the Corp saw go there (4.4.7b, 10.2.3a)', () => {
    const s = newGame();
    const gamble = createCardInstance(s, SG.sureGamble);
    s.runner.heap.push(gamble);
    const after = act(s, n => n.runner.grip.push(take(n.runner.heap, gamble.instanceId)));
    expect(certainInHand(after, 'runner')).toEqual([[SG.sureGamble, 1]]);
  });

  it('the Corp knows the grip by the same rule: a card shuffled back into the stack may be the seen one (Touch-ups, 1.12.3)', () => {
    const s = newGame();
    const gamble = createCardInstance(s, SG.sureGamble);
    const cleaver = createCardInstance(s, SG.cleaver);
    const other = createCardInstance(s, SG.sureGamble);
    s.runner.grip = [gamble, cleaver, other];
    revealInHand(s, 'runner', [gamble, cleaver]);
    // Installing a seen card puts it in the open: no unseen departure
    let after = act(s, n => n.runner.rig.programs.push(take(n.runner.grip, cleaver.instanceId)));
    expect(certainInHand(after, 'runner')).toEqual([[SG.sureGamble, 1]]);
    after = act(after, n => n.runner.stack.push(take(n.runner.grip, other.instanceId)));
    expect(certainInHand(after, 'runner')).toEqual([]);
  });
});

describe('B4a: facedown Archives', () => {
  it('a card the Runner saw on top of R&D, trashed facedown, is known in Archives (4.4.6b, c, 10.2.2b)', () => {
    const s0 = newGame();
    const fund = createCardInstance(s0, SG.hedgeFund);
    s0.corp.rd.unshift(fund);
    const s = act(s0, n => runnerSeesRd(n, n.corp.rd[0]));
    const after = act(s, n => n.corp.archives.faceDown.push(...n.corp.rd.splice(0, 1)));
    expect(knownInRd(after)).toEqual([]);
    expect(certainInArchives(after)).toEqual([[SG.hedgeFund, 1]]);
  });

  it('an unseen card leaving facedown Archives may be the known one; a card turned faceup is no longer hidden', () => {
    const s0 = newGame();
    const fund = createCardInstance(s0, SG.hedgeFund);
    const other = createCardInstance(s0, SG.palisade);
    s0.corp.rd.unshift(fund);
    s0.corp.archives.faceDown = [other];
    let s = act(s0, n => runnerSeesRd(n, n.corp.rd[0]));
    s = act(s, n => n.corp.archives.faceDown.push(...n.corp.rd.splice(0, 1)));
    // Accessing Archives turns its cards faceup (open, 4.4.6c): the known card leaves the facedown list
    const opened = act(s, n => n.corp.archives.faceUp.push(...n.corp.archives.faceDown.splice(0)));
    expect(certainInArchives(opened)).toEqual([]);
    // A facedown card shuffled into R&D unseen (Spin Doctor) may be the known one
    const shuffled = act(s, n => n.corp.rd.push(take(n.corp.archives.faceDown, other.instanceId)));
    expect(certainInArchives(shuffled)).toEqual([]);
  });
});

describe('B4a: a shuffle hides where an R&D card is, not that it is in R&D', () => {
  it('each mark becomes a share of the whole deck, 1 / n0 per place (4.2.2, 8.7.3, 10.2.2b)', () => {
    const s0 = newGame();
    const fund = createCardInstance(s0, SG.hedgeFund);
    s0.corp.rd.splice(3, 0, fund);
    let s = act(s0, n => runnerSeesRd(n, n.corp.rd[3]));
    s = act(s, n => shuffleRD(n));
    const n0 = s.corp.rd.length;
    expect(knownInRd(s)).toEqual([]);
    expect(rdSharesKnownToRunner(s).map(e => [e.code, e.lo, e.hi, e.n0, e.left ?? null])).toEqual([[SG.hedgeFund, 0, n0 - 1, n0, null]]);
    // A draw from the top: the card may have been drawn, and it is in one place fewer
    s = act(s, n => n.corp.hq.push(...n.corp.rd.splice(0, 1)));
    expect(rdSharesKnownToRunner(s).map(e => [e.lo, e.hi, e.n0, e.left ?? null])).toEqual([[0, n0 - 2, n0, 'hq']]);
  });

  it('a mark that may already have left R&D is not kept through a shuffle', () => {
    const s0 = newGame();
    const fund = createCardInstance(s0, SG.hedgeFund);
    s0.corp.rd.unshift(fund);
    let s = act(s0, n => runnerSeesRd(n, n.corp.rd[0]));
    s = act(s, n => {
      n.corp.rd.splice(0, 0, ...n.corp.rd.splice(0, 3).reverse());
      n.corp.hq.push(...n.corp.rd.splice(1, 1));
      n.corp.rdNotes = { ...n.corp.rdNotes, privateTop: 3 };
    });
    expect(knownInRd(s).every(e => e.left)).toBe(true);
    s = act(s, n => shuffleRD(n));
    expect(rdSharesKnownToRunner(s)).toEqual([]);
  });

  // B4a gap 4 (step 0, 2.2): the shuffle's action used to skip its other moves
  it('a card that left R&D unseen in the shuffle\'s action could be a marked one: every share may have left (1.12.3)', () => {
    const s0 = newGame();
    const fund = createCardInstance(s0, SG.hedgeFund);
    s0.corp.rd.unshift(fund);
    let s = act(s0, n => runnerSeesRd(n, n.corp.rd[0]));
    s = act(s, n => {
      n.corp.hq.push(...n.corp.rd.splice(3, 1)); // a search takes a card the Runner doesn't see
      shuffleRD(n);
    });
    expect(rdSharesKnownToRunner(s).map(e => [e.code, e.left ?? null])).toEqual([[SG.hedgeFund, 'other']]);
  });

  it('a marked card the Runner sees leave in the shuffle\'s action is followed, not shared (10.2.2b)', () => {
    const s0 = newGame();
    const fund = createCardInstance(s0, SG.hedgeFund);
    s0.corp.rd.unshift(fund);
    let s = act(s0, n => runnerSeesRd(n, n.corp.rd[0]));
    s = act(s, n => {
      const card = n.corp.rd.splice(0, 1)[0]; // Pivot-like: the card found is revealed and goes to HQ
      n.corp.hq.push(card);
      revealInHand(n, 'corp', [card]);
      shuffleRD(n);
    });
    expect(rdSharesKnownToRunner(s)).toEqual([]);
    expect(knownInHand(s, 'corp').map(k => k.id)).toEqual([fund.instanceId]);
  });

  it('a card seen in R&D earlier in the shuffle\'s action is in R&D too (4.2.2, 10.2.2b)', () => {
    const s0 = newGame();
    const fund = createCardInstance(s0, SG.hedgeFund);
    s0.corp.rd.unshift(fund);
    const s = act(s0, n => {
      runnerSeesRd(n, n.corp.rd[0]);
      shuffleRD(n);
    });
    expect(rdSharesKnownToRunner(s).map(e => [e.id, e.n0])).toEqual([[fund.instanceId, s.corp.rd.length]]);
  });

  it('a share whose every place was drawn is a card surely drawn: it joins the cards known in HQ (1.8.5)', () => {
    const s0 = newGame();
    s0.corp.rd = [createCardInstance(s0, SG.hedgeFund), createCardInstance(s0, SG.palisade)];
    const id = s0.corp.rd[0].instanceId;
    let s = act(s0, n => runnerSeesRd(n, n.corp.rd[0]));
    s = act(s, n => shuffleRD(n));
    s = act(s, n => n.corp.hq.push(...n.corp.rd.splice(0, 1)));
    expect(knownInHand(s, 'corp').map(k => k.id)).not.toContain(id);
    s = act(s, n => n.corp.hq.push(...n.corp.rd.splice(0, 1)));
    expect(rdSharesKnownToRunner(s)).toEqual([]);
    expect(knownInHand(s, 'corp').map(k => k.id)).toContain(id);
  });
});

describe('B4a gap 2: a card shown going into R&D', () => {
  it('a faceup Archives card shuffled into R&D (Spin Doctor) gets a share of the deck (4.4.6c, 8.7.3, 10.2.2b)', () => {
    const s0 = newGame();
    const fund = createCardInstance(s0, SG.hedgeFund);
    s0.corp.archives.faceUp.push(fund);
    const s = act(s0, n => {
      n.corp.rd.push(take(n.corp.archives.faceUp, fund.instanceId));
      shuffleRD(n);
    });
    expect(rdSharesKnownToRunner(s).map(e => [e.id, e.lo, e.hi, e.n0])).toEqual([[fund.instanceId, 0, s.corp.rd.length - 1, s.corp.rd.length]]);
  });
});
