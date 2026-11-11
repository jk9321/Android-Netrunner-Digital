/**
 * Discarding down to maximum hand size with a large hand (multiplayer chunk 2e,
 * MP-DISCARD-COMBINATORICS). Rules 4.3.6 and 5.5.4c (steps 5.6.3a, 5.7.2a): the
 * player discards cards from their hand equal to the difference and chooses
 * which. A hand of 18 down to 5 has 8,568 answers: the legal list stops at 256,
 * as for effect_cards, and every correct answer stays legal (engine, seat, room).
 */
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, executeAction, getLegalActions, isLegalAction, stateFromView } from '../src/core';
import { STARTER_DECKS } from '../src/data/decks';
import { RoomCore } from '../server/room';
import type { RoomSnapshot } from '../server/room';
import { seatCan } from '../src/ui/seatLegality';
import type { ServerMessage } from '../src/net/protocol';
import { submission } from '../scripts/leak-check-room';
import { newGame, startRunnerTurn } from './helpers';

type StateMsg = ServerMessage & { type: 'state' };
const PROMPT = 'prompt-900';

/** The Runner with 18 cards in the grip, discarding 13 (down to 5). */
function bigHand(): GameState {
  const s = newGame(7);
  startRunnerTurn(s);
  while (s.runner.grip.length < 18) s.runner.grip.push(s.runner.stack.shift()!);
  s.pendingPrompts = [{ id: PROMPT, kind: 'discard', side: 'runner', message: 'Discard down to hand size.', cards: [], count: 13 }] as never;
  return s;
}

const discard = (ids: string[]): GameAction => ({ type: 'RESOLVE_PROMPT', player: 'runner', promptId: PROMPT, choice: { kind: 'discard', cardInstanceIds: ids } });
const discards = (legal: GameAction[]) => legal.filter(a => a.type === 'RESOLVE_PROMPT' && a.choice.kind === 'discard');
const key = (a: GameAction) => (a.type === 'RESOLVE_PROMPT' && a.choice.kind === 'discard' ? [...a.choice.cardInstanceIds].sort().join() : '');

describe('Discard down to hand size with a large hand (rules 4.3.6, 5.5.4c)', () => {
  it('engine: the list stops at 256; an unlisted answer of exactly 13 different cards from the grip is legal and discards them', () => {
    const s = bigHand();
    const listed = discards(getLegalActions(s, 'runner'));
    expect(listed).toHaveLength(256);
    // The last 13 cards: the last combination in the listing's order, far past the first 256
    const last = s.runner.grip.slice(5).map(c => c.instanceId);
    expect(listed.map(key)).not.toContain([...last].sort().join());
    expect(isLegalAction(s, discard(last))).toBe(true);
    const after = executeAction(s, discard(last));
    expect(after.runner.grip.map(c => c.instanceId)).toEqual(s.runner.grip.slice(0, 5).map(c => c.instanceId));
    expect(after.runner.heap.slice(-13).map(c => c.instanceId).sort()).toEqual([...last].sort());
  });

  it('engine: a wrong count, a repeated card or a card not in the grip is illegal', () => {
    const s = bigHand();
    const grip = s.runner.grip.map(c => c.instanceId);
    expect(isLegalAction(s, discard(grip.slice(6)))).toBe(false);
    expect(isLegalAction(s, discard(grip.slice(4)))).toBe(false);
    expect(isLegalAction(s, discard([grip[5], ...grip.slice(5, 17)]))).toBe(false);
    expect(isLegalAction(s, discard([s.runner.stack[0].instanceId, ...grip.slice(6)]))).toBe(false);
  });

  it('a smaller hand still lists every answer, in the same order as before (hand 10 down to 5: 252)', () => {
    const s = bigHand();
    s.runner.grip = s.runner.grip.slice(0, 10);
    (s.pendingPrompts[0] as { count: number }).count = 5;
    const listed = discards(getLegalActions(s, 'runner'));
    expect(listed).toHaveLength(252);
    const ids = s.runner.grip.map(c => c.instanceId);
    expect(listed[0]).toEqual(discard(ids.slice(0, 5)));
    expect(listed[1]).toEqual(discard([...ids.slice(0, 4), ids[5]]));
    expect(listed[251]).toEqual(discard(ids.slice(5)));
  });

  it('room: the state message stays under 100 KB, and an unlisted correct discard from the seat is taken', () => {
    const corp = submission(STARTER_DECKS[0]);
    const made = RoomCore.create({ code: 'K7QM2X', side: 'corp', deck: corp, format: 'casual', playerId: 'host-player', tokenHash: 'host-hash', build: 'test', seed: 7, now: 1000 });
    if (!(made instanceof RoomCore)) throw new Error(JSON.stringify(made));
    made.join({ deck: submission(STARTER_DECKS[1]), playerId: 'guest-player', tokenHash: 'guest-hash', now: 2000 });
    const snap: RoomSnapshot = { meta: { ...structuredClone(made.meta), ids: null }, state: bigHand(), moves: [] };
    const room = RoomCore.load(snap, 5000);
    const text = room.connectTexts('runner').find(t => t.startsWith('{"type":"state"'))!;
    expect(text.length).toBeLessThan(100_000);
    const st = JSON.parse(text) as StateMsg;
    expect(discards(st.legal)).toHaveLength(256);
    // In the seat's own ids: what it reconstructs from its view
    const seen = stateFromView(st.view);
    const last = seen.runner.grip.slice(5).map(c => c.instanceId);
    expect(discards(st.legal).map(key)).not.toContain([...last].sort().join());
    // The seat: `can` is true for the unlisted correct pick, false for a wrong count or a repeat
    expect(seatCan(st.legal, 'runner', seen, discard(last))).toBe(true);
    expect(seatCan(st.legal, 'runner', seen, discard(last.slice(1)))).toBe(false);
    expect(seatCan(st.legal, 'runner', seen, discard([last[0], ...last.slice(0, 12)]))).toBe(false);
    // The room refuses a repeat and takes the correct pick
    const bad = room.receive('runner', { type: 'act', seq: st.seq, action: discard([last[0], last[0], ...last.slice(1, 12)]) }, 6000);
    expect(bad.out.map(o => o.msg.type)).toEqual(['error']);
    const res = room.receive('runner', { type: 'act', seq: st.seq, action: discard(last) }, 6000);
    expect(res.out.filter(o => o.to === 'runner').map(o => o.msg.type)).not.toContain('error');
    expect(room.realState!.runner.grip).toHaveLength(5);
    expect(room.moves).toHaveLength(1);
  });
});
