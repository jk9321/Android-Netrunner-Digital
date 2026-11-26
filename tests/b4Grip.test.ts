import { describe, expect, it } from 'vitest';
import { createCardInstance, GameState } from '../src/core';
import { revealInHand, updateHandKnowledge } from '../src/core/engine/helpers';
import { updateRdKnowledge } from '../src/core/engine/rdKnowledge';
import { corpSeenGrip } from '../src/ai/oracle';
import { newGame } from './helpers';
import '../src/ai';

// B4a, brief b4-hidden-zones ruling 6: the Corp's readers of the grip read what the Corp surely knows is there, by code
// and count (the same count rule as HQ: a seen card stays known until a card that could be it leaves unseen, 10.2.2b,
// 1.12.3), not the "could be" list by instance.

const SG = { sureGamble: '30030', cleaver: '30006' };

function act(s: GameState, change: (next: GameState) => void): GameState {
  const next = structuredClone(s);
  change(next);
  updateRdKnowledge(s, next);
  updateHandKnowledge(s, next);
  return next;
}
const take = <T extends { instanceId: string }>(zone: T[], id: string): T => zone.splice(zone.findIndex(c => c.instanceId === id), 1)[0];

/** The grip holds a seen Sure Gamble, a seen Cleaver and an unseen Sure Gamble. */
function grip() {
  const s = newGame();
  const gamble = createCardInstance(s, SG.sureGamble);
  const cleaver = createCardInstance(s, SG.cleaver);
  const other = createCardInstance(s, SG.sureGamble);
  s.runner.grip = [gamble, cleaver, other];
  revealInHand(s, 'runner', [gamble, cleaver]);
  return { s, gamble, cleaver, other };
}
const codesOf = (s: GameState, ids: Set<string>) => s.runner.grip.filter(c => ids.has(c.instanceId)).map(c => c.cardCode).sort();

describe('B4a ruling 6: corpSeenGrip', () => {
  it('counts the seen cards by code; after an unseen card leaves to the stack, no Sure Gamble is certain', () => {
    const { s, other } = grip();
    expect(codesOf(s, corpSeenGrip(s, 'reply'))).toEqual([SG.cleaver, SG.sureGamble].sort());
    // A card shuffled back into the stack unseen (Touch-ups): either Sure Gamble may be the one gone, and so may the Cleaver
    const after = act(s, n => n.runner.stack.push(take(n.runner.grip, other.instanceId)));
    expect(corpSeenGrip(after, 'threat').size).toBe(0);
  });
  it('the cards chosen do not depend on which instance the list names', () => {
    const { s, gamble, other } = grip();
    const moved = structuredClone(s);
    moved.runner.knownToCorp = moved.runner.knownToCorp!.map(e => (e.id === gamble.instanceId ? { ...e, id: other.instanceId } : e));
    expect([...corpSeenGrip(moved, 'reply')]).toEqual([...corpSeenGrip(s, 'reply')]);
  });
});
