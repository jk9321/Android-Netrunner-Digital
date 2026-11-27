import { describe, expect, it } from 'vitest';
import { createCardInstance, GameState, newViewIds, stateFromView, viewFor } from '../src/core';
import { certainInArchives, certainInHand, revealInHand, updateHandKnowledge } from '../src/core/engine/helpers';
import { rdSharesKnownToRunner, runnerSeesRd, shuffleRD, updateRdKnowledge } from '../src/core/engine/rdKnowledge';
import { newGame } from './helpers';

// B4a bar 4 (brief b4-hidden-zones; Multiplayer review): the screen after a shuffle, after an unidentified loss, and
// for facedown Archives. B4a keeps the screen as it was: the HQ and grip lists are shown as "could be" lists (their
// note says a card that left unseen could be one of them), a shuffle's shares and the facedown Archives list are the AI's
// and are not shown (the R&D note says "until ... R&D is shuffled"). The view and its reconstruction agree on each.

const SG = { hedgeFund: '30075', palisade: '30072' };

function act(s: GameState, change: (next: GameState) => void): GameState {
  const next = structuredClone(s);
  change(next);
  updateHandKnowledge(s, next, updateRdKnowledge(s, next));
  return next;
}
const view = (s: GameState) => viewFor(s, 'runner', newViewIds(), 'g').view;
/** What the Runner's screen shows of the hidden zones, from a view. */
const shown = (v: ReturnType<typeof view>) => ({ hq: v.corp.hq.known, rd: v.corp.rd.known ?? [], archives: v.corp.archives.faceDown.count, archivesCards: v.corp.archives.faceDown.cards.map(c => c.cardCode ?? null) });
/** The view, its reconstruction, and the view of the reconstruction show the same. */
function agrees(s: GameState) {
  const v = view(s);
  const r = stateFromView(v);
  expect(shown(view(r))).toEqual(shown(v));
  return { v, r };
}

describe('B4a bar 4: the screen keeps what it showed; view and reconstruction agree', () => {
  it('after a shuffle: the share is not shown, the R&D list is empty on the screen and in the reconstruction', () => {
    const s0 = newGame();
    s0.corp.rd.splice(2, 0, createCardInstance(s0, SG.hedgeFund));
    let s = act(s0, n => runnerSeesRd(n, n.corp.rd[2]));
    expect(view(s).corp.rd.known).toHaveLength(1);
    s = act(s, n => shuffleRD(n));
    expect(rdSharesKnownToRunner(s)).toHaveLength(1);
    const { v, r } = agrees(s);
    expect(v.corp.rd.known).toBeUndefined();
    expect(r.corp.rdKnownToRunner ?? []).toEqual([]);
  });

  it('after an unidentified loss: HQ still lists every seen code ("could be"), certain or not', () => {
    const s0 = newGame();
    const fund = createCardInstance(s0, SG.hedgeFund);
    const wall = createCardInstance(s0, SG.palisade);
    s0.corp.hq = [fund, wall, createCardInstance(s0, SG.palisade)];
    revealInHand(s0, 'corp', [fund, wall]);
    // A card goes back to R&D unseen: either seen card may be it (1.12.3)
    const s = act(s0, n => n.corp.rd.unshift(...n.corp.hq.splice(2, 1)));
    expect(certainInHand(s, 'corp')).toEqual([]);
    const { v, r } = agrees(s);
    expect([...v.corp.hq.known].sort()).toEqual([SG.hedgeFund, SG.palisade].sort());
    expect((r.corp.knownToRunner ?? []).map(k => k.code).sort()).toEqual([SG.hedgeFund, SG.palisade].sort());
  });

  it('facedown Archives: a card the Runner saw go in is known to the AI and shown as a card back', () => {
    const s0 = newGame();
    const top = s0.corp.rd[0];
    let s = act(s0, n => runnerSeesRd(n, n.corp.rd[0]));
    s = act(s, n => n.corp.archives.faceDown.push(...n.corp.rd.splice(0, 1)));
    expect(certainInArchives(s)).toEqual([[top.cardCode, 1]]);
    const { v, r } = agrees(s);
    expect(v.corp.archives.faceDown.count).toBe(1);
    expect(JSON.stringify(v)).not.toContain(`"${top.cardCode}"`);
    expect(r.corp.archKnownToRunner ?? []).toEqual([]);
  });
});
