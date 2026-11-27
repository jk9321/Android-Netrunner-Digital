import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCardInstance, GameState } from '../src/core';
import { certainInArchives, certainInHand, handUpkeepCheck, revealInHand, updateHandKnowledge } from '../src/core/engine/helpers';
import { runnerSeesRd, shuffleRD, updateRdKnowledge } from '../src/core/engine/rdKnowledge';
import { newGame } from './helpers';

// B4c part 1 (brief b4c-knowledge-by-copy rev 1, items 1, 2, 4, 7, 9): the viewer cannot tell two copies of one title
// apart (rules 10.2.2b: what a player saw stays known, as a card of that title, not as an instance). So what the
// Runner knows about HQ, the grip, R&D marks that join HQ and facedown Archives depends only on the titles seen, never
// on which copy the engine happened to move. Each board below is run with each copy as the one moved or seen, and the
// counts must agree. On the base (beta 7724180) every pair differed (red team probes, b4c/probes).

const SG = { hedgeFund: '30075', palisade: '30072', funhouse: '30054', sureGamble: '30030' };

let wasOn = false;
beforeEach(() => {
  wasOn = handUpkeepCheck.on;
  handUpkeepCheck.on = true;
  handUpkeepCheck.failures.length = 0;
});
afterEach(() => {
  expect(handUpkeepCheck.failures).toEqual([]);
  handUpkeepCheck.on = wasOn;
});

function act(s: GameState, change: (next: GameState) => void = () => {}): GameState {
  const next = structuredClone(s);
  change(next);
  updateHandKnowledge(s, next, updateRdKnowledge(s, next));
  return next;
}
const take = <T extends { instanceId: string }>(zone: T[], id: string): T => zone.splice(zone.findIndex(c => c.instanceId === id), 1)[0];
/** Two Hedge Funds and a Palisade in HQ. */
function twoCopies(extra: string[] = [SG.palisade]) {
  const s = newGame();
  const a = createCardInstance(s, SG.hedgeFund);
  const b = createCardInstance(s, SG.hedgeFund);
  s.corp.hq = [a, b, ...extra.map(code => createCardInstance(s, code))];
  return { s, a, b };
}

describe('B4c part 1: copies of one title are known by copy (10.2.2b)', () => {
  it('B1: two HQ accesses, each shows "a Hedge Fund": one Hedge Fund known, whichever copy the second was', () => {
    const counts = [0, 1].map(second => {
      const { s: s0 } = twoCopies();
      let s = act(s0, n => revealInHand(n, 'corp', [n.corp.hq[0]]));
      s = act(s, n => revealInHand(n, 'corp', [n.corp.hq[second]]));
      return certainInHand(s, 'corp');
    });
    expect(counts).toEqual([[[SG.hedgeFund, 1]], [[SG.hedgeFund, 1]]]);
  });

  it('B2: seen a Hedge Fund, 2 cards leave unseen, seen a Hedge Fund, one is played: none certain, whichever was played', () => {
    const counts = (['a', 'b'] as const).map(played => {
      const { s: s0, a, b } = twoCopies([SG.palisade, SG.palisade]);
      let s = act(s0, n => revealInHand(n, 'corp', [n.corp.hq[0]]));
      s = act(s, n => n.corp.archives.faceDown.push(n.corp.hq.pop()!, n.corp.hq.pop()!));
      s = act(s, n => revealInHand(n, 'corp', [n.corp.hq[1]]));
      s = act(s, n => n.corp.archives.faceUp.push(take(n.corp.hq, played === 'a' ? a.instanceId : b.instanceId)));
      return certainInHand(s, 'corp');
    });
    expect(counts).toEqual([[], []]);
  });

  it('the second sighting refreshes the older entry: its losses go and it is the newest', () => {
    const { s: s0, b } = twoCopies([SG.palisade, SG.palisade]);
    let s = act(s0, n => revealInHand(n, 'corp', [n.corp.hq[0]]));
    s = act(s, n => n.corp.archives.faceDown.push(n.corp.hq.pop()!));
    expect(s.corp.knownToRunner?.[0].lost).toEqual({ any: 1 });
    s = act(s, n => revealInHand(n, 'corp', [n.corp.hq.find(c => c.instanceId === b.instanceId)!]));
    expect(s.corp.knownToRunner).toEqual([{ id: b.instanceId, code: SG.hedgeFund }]);
  });

  it('one reveal of both copies (1.21.3) is two Hedge Funds, after one was seen', () => {
    const { s: s0 } = twoCopies();
    let s = act(s0, n => revealInHand(n, 'corp', [n.corp.hq[0]]));
    s = act(s, n => revealInHand(n, 'corp', n.corp.hq.slice(0, 2)));
    expect(certainInHand(s, 'corp')).toEqual([[SG.hedgeFund, 2]]);
  });

  it('a two-access breach after an older sighting: the second access is a different card (7.4.3, 7.3.4a)', () => {
    const counts = [0, 1].map(first => {
      const { s: s0 } = twoCopies();
      let s = act(s0, n => revealInHand(n, 'corp', [n.corp.hq[0]]));
      const ids = s.corp.hq.slice(0, 2).map(c => c.instanceId);
      const [one, two] = first === 0 ? ids : [ids[1], ids[0]];
      s = act(s, n => {
        n.activeRun = { server: 'hq', accessed: [] } as unknown as GameState['activeRun'];
        revealInHand(n, 'corp', [n.corp.hq.find(c => c.instanceId === one)!]);
        n.activeRun!.accessed.push({ id: one, inArchives: false });
      });
      expect(certainInHand(s, 'corp')).toEqual([[SG.hedgeFund, 1]]);
      s = act(s, n => {
        revealInHand(n, 'corp', [n.corp.hq.find(c => c.instanceId === two)!]);
        n.activeRun!.accessed.push({ id: two, inArchives: false });
      });
      return certainInHand(s, 'corp');
    });
    expect(counts).toEqual([[[SG.hedgeFund, 2]], [[SG.hedgeFund, 2]]]);
  });

  it('an arrival is always its own entry: a seen card returned to HQ beside a seen copy is two', () => {
    const { s: s0, a } = twoCopies();
    let s = act(s0, n => revealInHand(n, 'corp', [n.corp.hq[1]]));
    const third = createCardInstance(s, SG.hedgeFund);
    s.corp.archives.faceUp.push(third);
    s = act(s, n => {
      const c = take(n.corp.archives.faceUp, third.instanceId);
      n.corp.hq.push(c);
      revealInHand(n, 'corp', [c]);
    });
    expect(certainInHand(s, 'corp')).toEqual([[SG.hedgeFund, 2]]);
    void a;
  });

  it('an arrival seen twice in one action (put in HQ from Archives, then accessed: Méliès U, seed search 1857) is one entry', () => {
    const { s: s0 } = twoCopies();
    const c = createCardInstance(s0, SG.hedgeFund);
    s0.corp.archives.faceUp = [c];
    const s = act(s0, n => {
      const card = take(n.corp.archives.faceUp, c.instanceId);
      n.corp.hq.push(card);
      revealInHand(n, 'corp', [card]);
      revealInHand(n, 'corp', [card]);
    });
    expect(s.corp.knownToRunner).toEqual([{ id: c.instanceId, code: SG.hedgeFund }]);
  });

  it('the grip is kept the same way: two Sure Gambles seen one at a time are one, whichever copy', () => {
    const counts = [0, 1].map(second => {
      const s0 = newGame();
      s0.runner.grip = [SG.sureGamble, SG.sureGamble, SG.palisade].map(code => createCardInstance(s0, code));
      let s = act(s0, n => revealInHand(n, 'runner', [n.runner.grip[0]]));
      s = act(s, n => revealInHand(n, 'runner', [n.runner.grip[second]]));
      return certainInHand(s, 'runner');
    });
    expect(counts).toEqual([[[SG.sureGamble, 1]], [[SG.sureGamble, 1]]]);
  });

  it('D1: a Hedge Fund was seen in HQ; a Hedge Fund from HQ is shown and put on top of R&D: none certain, whichever copy', () => {
    const counts = (['a', 'b'] as const).map(moved => {
      const { s: s0, a, b } = twoCopies();
      s0.corp.rd = [createCardInstance(s0, SG.palisade)];
      let s = act(s0, n => revealInHand(n, 'corp', [n.corp.hq[0]]));
      s = act(s, n => {
        const c = take(n.corp.hq, moved === 'a' ? a.instanceId : b.instanceId);
        n.corp.rd.unshift(c);
        runnerSeesRd(n, c);
      });
      return [certainInHand(s, 'corp'), s.corp.knownToRunner ?? []];
    });
    expect(counts).toEqual([[[], []], [[], []]]);
  });

  it('A1: the Runner knows one facedown Hedge Fund in Archives; a facedown Hedge Fund turns faceup: none certain, whichever', () => {
    const counts = (['a', 'b'] as const).map(moved => {
      const s0 = newGame();
      const a = createCardInstance(s0, SG.hedgeFund);
      const b = createCardInstance(s0, SG.hedgeFund);
      s0.corp.archives.faceDown = [a, b];
      s0.corp.archKnownToRunner = [{ id: a.instanceId, code: a.cardCode }];
      const s = act(s0, n => n.corp.archives.faceUp.push(take(n.corp.archives.faceDown, moved === 'a' ? a.instanceId : b.instanceId)));
      return certainInArchives(s);
    });
    expect(counts).toEqual([[], []]);
  });
});

describe('B4c part 1: an R&D mark that joins HQ merges with a sighting it may be (red team 4b)', () => {
  /** A Hedge Fund M seen in R&D, R&D shuffled (M one of 3), drawn until M is in HQ beside another Hedge Fund. */
  function pendingM() {
    const s0 = newGame();
    const m = createCardInstance(s0, SG.hedgeFund);
    s0.corp.rd = [m, createCardInstance(s0, SG.palisade), createCardInstance(s0, SG.funhouse)];
    s0.corp.hq = [createCardInstance(s0, SG.hedgeFund)];
    let s = act(s0, n => runnerSeesRd(n, m));
    s = act(s, n => shuffleRD(n));
    while (!s.corp.hq.some(c => c.instanceId === m.instanceId)) s = act(s, n => n.corp.hq.push(n.corp.rd.shift()!));
    return { s, m };
  }

  it('J1: a pending Hedge Fund mark, an HQ access shows a Hedge Fund, then R&D is drawn out: one, whichever copy was seen', () => {
    const counts = (['m', 'other'] as const).map(seen => {
      const { s: s1, m } = pendingM();
      expect(s1.corp.rdKnownToRunner?.[0]).toMatchObject({ id: m.instanceId, left: 'hq' });
      const id = seen === 'm' ? m.instanceId : s1.corp.hq.find(c => c.cardCode === SG.hedgeFund && c.instanceId !== m.instanceId)!.instanceId;
      let s = act(s1, n => revealInHand(n, 'corp', [n.corp.hq.find(c => c.instanceId === id)!]));
      s = act(s, n => n.corp.hq.push(...n.corp.rd.splice(0)));
      return certainInHand(s, 'corp');
    });
    expect(counts).toEqual([[[SG.hedgeFund, 1]], [[SG.hedgeFund, 1]]]);
  });

  it('a mark drawn in the action, after a seen copy left HQ unseen: it may be that copy, so the two are one', () => {
    const { s: s0, a } = twoCopies([SG.palisade, SG.palisade]);
    s0.corp.rd = [createCardInstance(s0, SG.palisade), createCardInstance(s0, SG.palisade)];
    let s = act(s0, n => revealInHand(n, 'corp', [n.corp.hq.find(c => c.instanceId === a.instanceId)!]));
    // the seen copy goes into R&D unseen, second from the top (a card put back facedown: 1.12.3); the Runner then sees
    // a Hedge Fund there, and the Corp draws 2
    s = act(s, n => n.corp.rd.splice(1, 0, take(n.corp.hq, a.instanceId)));
    expect(s.corp.knownToRunner?.[0].lost).toEqual({ any: 1 });
    s = act(s, n => runnerSeesRd(n, n.corp.rd[1]));
    s = act(s, n => n.corp.hq.push(...n.corp.rd.splice(0, 2)));
    expect(s.corp.knownToRunner?.filter(e => e.code === SG.hedgeFund)).toHaveLength(1);
    expect(certainInHand(s, 'corp')).toEqual([[SG.hedgeFund, 1]]);
  });

  it('a mark drawn in the action beside a seen copy whose only loss is an ice install: that copy is on a server or in HQ, so two (ruling 24)', () => {
    const s0 = newGame();
    const [p1, p2] = [0, 1].map(() => createCardInstance(s0, SG.palisade));
    s0.corp.hq = [p1, p2, createCardInstance(s0, SG.hedgeFund)];
    s0.corp.rd = [createCardInstance(s0, SG.palisade), createCardInstance(s0, SG.hedgeFund)];
    let s = act(s0, n => revealInHand(n, 'corp', [n.corp.hq[0]]));
    s = act(s, n => n.corp.servers.hq.ice.push(take(n.corp.hq, p2.instanceId)));
    expect(s.corp.knownToRunner?.[0].lost).toEqual({ ice: 1 });
    s = act(s, n => runnerSeesRd(n, n.corp.rd[0]));
    s = act(s, n => n.corp.hq.push(n.corp.rd.shift()!));
    expect(s.corp.knownToRunner?.filter(e => e.code === SG.palisade)).toHaveLength(2);
  });

  it('a mark drawn in the action is a card that was in R&D until now: it joins as its own entry beside a seen copy still in HQ', () => {
    const { s: s0 } = twoCopies();
    const m = createCardInstance(s0, SG.hedgeFund);
    s0.corp.rd = [m, createCardInstance(s0, SG.palisade)];
    let s = act(s0, n => revealInHand(n, 'corp', [n.corp.hq[0]]));
    s = act(s, n => runnerSeesRd(n, m));
    s = act(s, n => n.corp.hq.push(n.corp.rd.shift()!));
    expect(certainInHand(s, 'corp')).toEqual([[SG.hedgeFund, 2]]);
  });

  it('joined, then seen: an HQ access after the drawn mark refreshes it, whichever copy is shown', () => {
    const counts = [0, 1].map(shown => {
      const s0 = newGame();
      const m = createCardInstance(s0, SG.hedgeFund);
      s0.corp.rd = [m, createCardInstance(s0, SG.palisade)];
      s0.corp.hq = [createCardInstance(s0, SG.hedgeFund), createCardInstance(s0, SG.palisade)];
      let s = act(s0, n => runnerSeesRd(n, m));
      s = act(s, n => n.corp.hq.push(n.corp.rd.shift()!));
      expect(certainInHand(s, 'corp')).toEqual([[SG.hedgeFund, 1]]);
      const hfs = s.corp.hq.filter(c => c.cardCode === SG.hedgeFund).map(c => c.instanceId);
      s = act(s, n => revealInHand(n, 'corp', [n.corp.hq.find(c => c.instanceId === hfs[shown])!]));
      return certainInHand(s, 'corp');
    });
    expect(counts).toEqual([[[SG.hedgeFund, 1]], [[SG.hedgeFund, 1]]]);
  });
});

describe("B4c part 1: R&D marks forget the strongest claim when a copy surfaces (brief rev 1 item 4, 10.2.2b)", () => {
  it("a Hedge Fund with no mark of its own turns up in the open: the mark that may be in HQ goes before one gone elsewhere", () => {
    const s0 = newGame();
    const [m1, m2, x] = [0, 1, 2].map(() => createCardInstance(s0, SG.hedgeFund));
    s0.corp.rd = [createCardInstance(s0, SG.palisade), createCardInstance(s0, SG.palisade)];
    s0.corp.hq = [m2, x];
    s0.corp.archives.faceDown = [m1];
    s0.corp.rdKnownToRunner = [
      { id: m1.instanceId, code: SG.hedgeFund, lo: 0, hi: 1, left: 'other' },
      { id: m2.instanceId, code: SG.hedgeFund, lo: 0, hi: 1, left: 'hq' },
    ];
    const s = act(s0, n => n.corp.archives.faceUp.push(take(n.corp.hq, x.instanceId)));
    expect(s.corp.rdKnownToRunner?.map(e => e.left)).toEqual(['other']);
  });
});
