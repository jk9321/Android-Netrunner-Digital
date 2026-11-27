import { describe, expect, it } from 'vitest';
import { createCardInstance, GameState } from '../src/core';
import { certainInArchives, updateHandKnowledge } from '../src/core/engine/helpers';
import { noteRdPrivate, runnerSeesRd, shuffleRD, updateRdKnowledge } from '../src/core/engine/rdKnowledge';
import { newGame } from './helpers';

// B4c part 2 (brief b4c-knowledge-by-copy rev 0 part 2, rev 1): a card put facedown in Archives from R&D is known only if
// the Runner followed it out of an exact place in that action (the R&D walk's step 2). A card the Corp picked from among
// cards it looked at in secret (8.3.3b: Cultivate, AU Co.) may be any of them (1.12.3), and after a shuffle the Runner
// knows no place in R&D at all.

const SG = { hedgeFund: '30075', palisade: '30072', funhouse: '30054', regolith: '30069' };

function act(s: GameState, change: (next: GameState) => void): GameState {
  const next = structuredClone(s);
  change(next);
  updateHandKnowledge(s, next, updateRdKnowledge(s, next));
  return next;
}
const take = <T extends { instanceId: string }>(zone: T[], id: string): T => zone.splice(zone.findIndex(c => c.instanceId === id), 1)[0];

/** The Runner knows the top card X exactly; below it 5 more, one of them another Hedge Fund. */
function topKnown() {
  const s0 = newGame();
  const x = createCardInstance(s0, SG.hedgeFund);
  const rest = [SG.palisade, SG.funhouse, SG.hedgeFund, SG.regolith, SG.palisade].map(c => createCardInstance(s0, c));
  s0.corp.rd = [x, ...rest];
  return { s: act(s0, n => runnerSeesRd(n, x)), x, rest };
}

describe('B4c part 2: a secret trash from R&D (8.3.3b, 1.12.3)', () => {
  it('C3: the Corp looks at the top 5 and trashes one facedown: nothing certain in Archives, whichever was trashed', () => {
    const counts = (['x', 'other'] as const).map(trashed => {
      const { s: s1, x, rest } = topKnown();
      const s = act(s1, n => {
        n.corp.archives.faceDown.push(take(n.corp.rd, trashed === 'x' ? x.instanceId : rest[2].instanceId));
        noteRdPrivate(n, 5); // as cultivateFlow.trash does
      });
      return [certainInArchives(s), s.corp.archKnownToRunner ?? []];
    });
    expect(counts).toEqual([[[], []], [[], []]]);
  });

  it('R&D shuffled and then X trashed facedown in one action: the Runner knows no place, so nothing in Archives', () => {
    const { s: s1, x } = topKnown();
    const s = act(s1, n => {
      shuffleRD(n);
      n.corp.archives.faceDown.push(take(n.corp.rd, x.instanceId));
    });
    expect(certainInArchives(s)).toEqual([]);
  });

  it('the known top card trashed facedown in the open (no secret look) is followed into Archives', () => {
    const { s: s1, x } = topKnown();
    const s = act(s1, n => n.corp.archives.faceDown.push(take(n.corp.rd, x.instanceId)));
    expect(certainInArchives(s)).toEqual([[SG.hedgeFund, 1]]);
  });

  it('with no R&D walk handed over (a direct call), nothing from R&D joins: the safe default', () => {
    const { s: s1, x } = topKnown();
    const next = structuredClone(s1);
    next.corp.archives.faceDown.push(take(next.corp.rd, x.instanceId));
    updateRdKnowledge(s1, next);
    updateHandKnowledge(s1, next);
    expect(certainInArchives(next)).toEqual([]);
  });
});
