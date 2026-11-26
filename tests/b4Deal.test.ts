import { describe, expect, it } from 'vitest';
import { createCardInstance, createRng, GameState, nextFloat } from '../src/core';
import { certainInHand, revealInHand, updateHandKnowledge } from '../src/core/engine/helpers';
import { runnerSeesRd, shuffleRD, updateRdKnowledge } from '../src/core/engine/rdKnowledge';
import { dealRunnerUnknowns, guessHidden } from '../src/ai/runnerReply';
import { newGame } from './helpers';
import '../src/ai';

// B4a 7(e) (brief b4-hidden-zones ruling 5): the Runner's deal reads what it knows of HQ, R&D and facedown Archives by
// code and count, never by instance. A card it surely knows is in a zone is dealt back to that zone (10.2.2b), at
// least as many copies as it knows (three Hedge Funds with one seen: the other two are anywhere); once a card that could
// be it has left unseen it is no longer kept (1.12.3).

const SG = { hedgeFund: '30075', palisade: '30072', regolith: '30071' };

function act(s: GameState, change: (next: GameState) => void): GameState {
  const next = structuredClone(s);
  change(next);
  updateRdKnowledge(s, next);
  updateHandKnowledge(s, next);
  return next;
}
const dealt = (s: GameState, seed: number): GameState => {
  const v = structuredClone(s);
  const rng = createRng(seed);
  dealRunnerUnknowns(v, () => nextFloat(rng));
  return v;
};
const count = (cards: { cardCode: string }[], code: string) => cards.filter(c => c.cardCode === code).length;

/** HQ of three cards, the Runner has seen the Hedge Fund among them; the stack-side R&D holds two more Hedge Funds. */
function board(): { s: GameState; fund: string } {
  const s = newGame();
  const fund = createCardInstance(s, SG.hedgeFund);
  s.corp.hq = [createCardInstance(s, SG.palisade), fund, createCardInstance(s, SG.regolith)];
  s.corp.rd.push(createCardInstance(s, SG.hedgeFund), createCardInstance(s, SG.hedgeFund));
  revealInHand(s, 'corp', [fund]);
  return { s, fund: fund.instanceId };
}

describe('B4a 7(e): the deal places what the Runner knows by code and count', () => {
  it('a seen card surely still in HQ is dealt to HQ on every deal, by code (10.2.2b)', () => {
    const { s } = board();
    expect(certainInHand(s, 'corp')).toEqual([[SG.hedgeFund, 1]]);
    for (let seed = 1; seed <= 40; seed++) expect(count(dealt(s, seed).corp.hq, SG.hedgeFund)).toBeGreaterThanOrEqual(1);
  });

  it('the deal does not depend on which instance the list names (no id is read)', () => {
    const { s, fund } = board();
    // The same list with its entry pointing at another HQ card: a reader by code and count deals the same
    const other = structuredClone(s);
    other.corp.knownToRunner = other.corp.knownToRunner!.map(e => (e.id === fund ? { ...e, id: other.corp.hq[0].instanceId } : e));
    for (let seed = 1; seed <= 20; seed++) expect(dealt(other, seed).corp.hq.map(c => c.cardCode)).toEqual(dealt(s, seed).corp.hq.map(c => c.cardCode));
  });

  it('a facedown root install cannot be the seen operation; a card gone back to R&D could be, and then HQ need not hold it (1.12.3, 4.6.6e)', () => {
    const { s, fund } = board();
    const left = act(s, n => n.corp.servers['remote-1'] = { id: 'remote-1', name: 'Server 1', isRemote: true, ice: [], root: n.corp.hq.splice(n.corp.hq.findIndex(c => c.instanceId !== fund && c.cardCode === SG.regolith), 1) });
    expect(certainInHand(left, 'corp')).toEqual([[SG.hedgeFund, 1]]);
    // A card gone back into R&D unseen could be the seen one
    const gone = act(s, n => n.corp.rd.unshift(...n.corp.hq.splice(0, 1)));
    expect(certainInHand(gone, 'corp')).toEqual([]);
    const misses = Array.from({ length: 60 }, (_, k) => count(dealt(gone, k + 1).corp.hq, SG.hedgeFund)).filter(n => n === 0).length;
    expect(misses).toBeGreaterThan(0);
  });

  it("the Corp's guess of a shuffle's share names a dealt card at a random place, not the top (red team b4 finding 6)", () => {
    const s0 = newGame();
    const fund = createCardInstance(s0, SG.hedgeFund);
    s0.corp.rd.splice(3, 0, fund);
    let s = act(s0, n => runnerSeesRd(n, n.corp.rd[3]));
    s = act(s, n => shuffleRD(n));
    const places = new Set<number>();
    for (let k = 0; k < 30; k++) {
      const g = guessHidden(s, k);
      const share = (g.corp.rdKnownToRunner ?? []).find(e => e.n0)!;
      expect(share).toBeDefined();
      places.add(g.corp.rd.findIndex(c => c.instanceId === share.id));
    }
    expect(places.size).toBeGreaterThan(5);
  });
});
