import { describe, expect, it } from 'vitest';
import { fuzzRoomGame, roomPairing } from '../scripts/leak-check-room';

// Room fuzzer, short version (the full one is scripts/room-fuzz.ts, 200 games): two scripted clients play through
// the game server's room (server/room.ts, multiplayer phase 2, chunk 2b), and every message each one gets is checked:
// the phase 1 leak checks, the room's seq and settled-point rules, persistence, and the twin check at the message
// level (rules 4.2.2, 7.1.2: the blind seat's messages must not depend on a card it can't see).
describe('Room fuzzer', () => {
  it('6 games (4 random, 2 AI): no message leaks, the twins send the blind seat the same messages', () => {
    const failures = [];
    for (let g = 0; g < 6; g++) {
      const [c, r] = roomPairing(g);
      const res = fuzzRoomGame(500 + g, c, r, g < 4 ? 'random' : 'ai', { maxMoves: g < 4 ? 150 : 80, twinEvery: 6 });
      failures.push(...res.failures);
      expect(res.sizes.length).toBeGreaterThan(0);
    }
    expect(failures).toEqual([]);
  }, 120_000);
});
