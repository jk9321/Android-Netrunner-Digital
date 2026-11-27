import { describe, expect, it } from 'vitest';
import { createCardInstance, GameState, KnownHandCard } from '../src/core';
import { revealInHand, updateHandKnowledge } from '../src/core/engine/helpers';
import { runnerSeesRd, updateRdKnowledge } from '../src/core/engine/rdKnowledge';
import { newGame } from './helpers';
import { knownByCopy, relabelledCopy } from '../scripts/engine-fuzz-check';

// B4c part 4 (brief rev 1 item 3; rework ruling 24 (1)): the relabel check, on the red team's boards. Take the state
// before the action that decides the count, move a listed id to the other copy of the same title, run the same action
// on both, and the lists must agree with the ids stripped (rules 10.2.2b). The fuzzer runs the same check on every
// action (scripts/engine-fuzz-check.ts, known-by-copy). This file uses only what the base (beta 7724180) also has, so it
// is run there too: every board here fails on the base.

const SG = { hedgeFund: '30075', palisade: '30072' };

function act(s: GameState, change: (next: GameState) => void): GameState {
  const next = structuredClone(s);
  change(next);
  updateHandKnowledge(s, next, updateRdKnowledge(s, next));
  return next;
}
const strip = (l: KnownHandCard[] | undefined) =>
  (l ?? []).map(e => `${e.code}:${['any', 'ice', 'root', 'upgrade'].map(k => e.lost?.[k as keyof typeof e.lost] ?? 0).join('/')}`).sort();
/** The same action from `pre` and from `pre` with the entry `from` naming the card `to`: both HQ lists, ids stripped. */
function relabelled(pre: GameState, from: string, to: string, change: (next: GameState) => void) {
  const copy = structuredClone(pre);
  copy.corp.knownToRunner = copy.corp.knownToRunner!.map(e => (e.id === from ? { ...e, id: to } : e));
  return [strip(act(pre, change).corp.knownToRunner), strip(act(copy, change).corp.knownToRunner)];
}
function twoCopies(extra: string[]) {
  const s = newGame();
  const [a, b] = [0, 1].map(() => createCardInstance(s, SG.hedgeFund));
  s.corp.hq = [a, b, ...extra.map(code => createCardInstance(s, code))];
  return { s, a: a.instanceId, b: b.instanceId };
}
const byId = (n: GameState, id: string) => n.corp.hq.find(c => c.instanceId === id)!;

describe('B4c part 4: the relabel check (known-by-copy) on the red team boards', () => {
  it('B1: an HQ access shows a Hedge Fund after one was seen', () => {
    const { s, a, b } = twoCopies([SG.palisade]);
    const pre = act(s, n => revealInHand(n, 'corp', [byId(n, a)]));
    const [played, other] = relabelled(pre, a, b, n => revealInHand(n, 'corp', [byId(n, b)]));
    expect(other).toEqual(played);
  });

  it('B2: a Hedge Fund seen after two cards left HQ unseen', () => {
    const { s, a, b } = twoCopies([SG.palisade, SG.palisade]);
    let pre = act(s, n => revealInHand(n, 'corp', [byId(n, a)]));
    pre = act(pre, n => n.corp.archives.faceDown.push(n.corp.hq.pop()!, n.corp.hq.pop()!));
    const [played, other] = relabelled(pre, a, b, n => revealInHand(n, 'corp', [byId(n, b)]));
    expect(other).toEqual(played);
  });

  it('D1: a Hedge Fund from HQ is shown and put on top of R&D', () => {
    const { s, a, b } = twoCopies([SG.palisade]);
    s.corp.rd = [createCardInstance(s, SG.palisade)];
    const pre = act(s, n => revealInHand(n, 'corp', [byId(n, a)]));
    const [played, other] = relabelled(pre, a, b, n => {
      const c = n.corp.hq.splice(n.corp.hq.indexOf(byId(n, b)), 1)[0];
      n.corp.rd.unshift(c);
      runnerSeesRd(n, c);
    });
    expect(other).toEqual(played);
  });

  it('one reveal of both copies after one was seen (ruling 24 (1)): two either way', () => {
    const { s, a, b } = twoCopies([SG.palisade]);
    const pre = act(s, n => revealInHand(n, 'corp', [byId(n, a)]));
    const [played, other] = relabelled(pre, a, b, n => revealInHand(n, 'corp', [byId(n, a), byId(n, b)]));
    expect(played).toEqual([`${SG.hedgeFund}:0/0/0/0`, `${SG.hedgeFund}:0/0/0/0`]);
    expect(other).toEqual(played);
  });
});

// The fuzzer's own relabel (branch only: it is new in B4c; drop this block to run the file on the base)
describe('relabelledCopy (engine-fuzz-check.ts)', () => {
  it('moves one listed id to an unlisted copy in the same zone, on a copy, and leaves an accessed card alone', () => {
    const { s, a, b } = twoCopies([SG.palisade]);
    revealInHand(s, 'corp', [byId(s, a)]);
    delete s.corp.rdNotes;
    const copy = relabelledCopy(s)!;
    expect(copy.corp.knownToRunner?.map(e => e.id)).toEqual([b]);
    expect(s.corp.knownToRunner?.map(e => e.id)).toEqual([a]);
    expect(knownByCopy(copy)).toBe(knownByCopy(s));
    s.activeRun = { accessed: [{ id: a, inArchives: false }] } as unknown as GameState['activeRun'];
    expect(relabelledCopy(s)).toBeNull();
  });
});
