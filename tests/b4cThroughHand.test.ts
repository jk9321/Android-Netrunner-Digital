import { describe, expect, it } from 'vitest';
import { createCardInstance, GameState } from '../src/core';
import { certainInArchives, certainInHand, drawCards, revealInHand, updateHandKnowledge } from '../src/core/engine/helpers';
import { runnerSeesRd, updateRdKnowledge } from '../src/core/engine/rdKnowledge';
import { newGame } from './helpers';

// B4c part 3 (brief b4c-knowledge-by-copy rev 0 part 3, rev 1 item 6; rework ruling 24 (3)): a card drawn into a hand
// and gone from it again within one action left the hand unseen, hidden among its cards, like any hand card (rules
// 1.8.5, 1.12.3). It is a departure every entry of that hand counts, it is not followed out of HQ into Archives, and one
// that turns up in the open surfaced from the hand. drawCards records the draws (RdNotes.drawn).

const SG = { hedgeFund: '30075', palisade: '30072', sureGamble: '30030', cleaver: '30006' };

function act(s: GameState, change: (next: GameState) => void): GameState {
  const next = structuredClone(s);
  change(next);
  updateHandKnowledge(s, next, updateRdKnowledge(s, next));
  return next;
}
const take = <T extends { instanceId: string }>(zone: T[], id: string): T => zone.splice(zone.findIndex(c => c.instanceId === id), 1)[0];

describe('B4c part 3: a card in and out of a hand within one action (1.12.3)', () => {
  it('C1: the Runner knows the top Palisade M; one action draws 2 and installs a Palisade as ice: M is not certain, whichever went', () => {
    const counts = (['m', 'x', 'y'] as const).map(installed => {
      const s0 = newGame();
      const [m, x, y] = [0, 1, 2].map(() => createCardInstance(s0, SG.palisade));
      s0.corp.rd = [m, x, createCardInstance(s0, SG.hedgeFund)];
      s0.corp.hq = [y];
      let s = act(s0, n => runnerSeesRd(n, m));
      s = act(s, n => {
        drawCards(n, 'corp', 2);
        n.corp.servers.hq.ice.push(take(n.corp.hq, { m, x, y }[installed].instanceId));
      });
      return certainInHand(s, 'corp');
    });
    expect(counts).toEqual([[], [], []]);
  });

  it('C2: the Runner knows the top Hedge Fund M; one action draws it and discards an HQ card facedown: nothing certain, whichever', () => {
    const counts = (['m', 'y'] as const).map(discarded => {
      const s0 = newGame();
      const [m, y] = [0, 1].map(() => createCardInstance(s0, SG.hedgeFund));
      s0.corp.rd = [m, createCardInstance(s0, SG.palisade)];
      s0.corp.hq = [y];
      let s = act(s0, n => runnerSeesRd(n, m));
      s = act(s, n => {
        drawCards(n, 'corp', 1);
        n.corp.archives.faceDown.push(take(n.corp.hq, discarded === 'm' ? m.instanceId : y.instanceId));
      });
      return [certainInHand(s, 'corp'), certainInArchives(s)];
    });
    expect(counts).toEqual([[[], []], [[], []]]);
  });

  it('a seen HQ card counts the departure of a card drawn and put back in the same action', () => {
    const s0 = newGame();
    s0.corp.hq = [createCardInstance(s0, SG.hedgeFund), createCardInstance(s0, SG.palisade)];
    s0.corp.rd = [createCardInstance(s0, SG.palisade), createCardInstance(s0, SG.palisade)];
    let s = act(s0, n => revealInHand(n, 'corp', [n.corp.hq[0]]));
    s = act(s, n => {
      drawCards(n, 'corp', 1);
      // put a card from HQ back on top of R&D: the drawn one, which the Runner can't tell from the Hedge Fund
      n.corp.rd.unshift(n.corp.hq.pop()!);
    });
    expect(s.corp.knownToRunner?.[0].lost).toEqual({ any: 1 });
  });

  it('a card drawn and put back in the same action is no longer followed in R&D (it went by HQ)', () => {
    const s0 = newGame();
    const m = createCardInstance(s0, SG.palisade);
    s0.corp.rd = [m, createCardInstance(s0, SG.hedgeFund)];
    s0.corp.hq = [createCardInstance(s0, SG.palisade)];
    let s = act(s0, n => runnerSeesRd(n, m));
    s = act(s, n => {
      drawCards(n, 'corp', 1);
      n.corp.rd.splice(1, 0, take(n.corp.hq, m.instanceId));
    });
    expect(s.corp.rdKnownToRunner ?? []).toEqual([]);
  });

  it('drawn and put back in the very same place: R&D looks unchanged, and the card is still not followed', () => {
    const s0 = newGame();
    const m = createCardInstance(s0, SG.palisade);
    s0.corp.rd = [m, createCardInstance(s0, SG.hedgeFund)];
    s0.corp.hq = [createCardInstance(s0, SG.palisade)];
    let s = act(s0, n => runnerSeesRd(n, m));
    s = act(s, n => {
      drawCards(n, 'corp', 1);
      n.corp.rd.unshift(take(n.corp.hq, m.instanceId));
    });
    expect(s.corp.rdKnownToRunner ?? []).toEqual([]);
  });

  it('the grip too: a Sure Gamble drawn and played in one action surfaces from the grip and the seen one is forgotten', () => {
    const s0 = newGame();
    s0.runner.grip = [createCardInstance(s0, SG.sureGamble), createCardInstance(s0, SG.cleaver)];
    s0.runner.stack = [createCardInstance(s0, SG.sureGamble)];
    let s = act(s0, n => revealInHand(n, 'runner', [n.runner.grip[0]]));
    s = act(s, n => {
      drawCards(n, 'runner', 1);
      const drawn = n.runner.grip.pop()!;
      n.runner.heap.push(drawn);
    });
    expect(certainInHand(s, 'runner')).toEqual([]);
  });
});
