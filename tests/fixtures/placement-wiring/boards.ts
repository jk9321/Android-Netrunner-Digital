/**
 * Boards for tests/placementWiring.test.ts that scripts/review-fixes/placement-wiring-pair-snapshot.ts also builds (the
 * merge base's order on them is the fixture tests/fixtures/placement-wiring/pair-candidates.json). Turn 7, empty rig, the
 * Runner at $0 and 4 clicks (as tests/reviewPins.test.ts's board).
 */
import { GameState, createCardInstance } from '../../../src/core';
import { installIceForTest, newGame } from '../../helpers';

export const PW = { PALISADE: '30072', REGOLITH: '30071', PING: '30055', OFFWORLD: '30067' };

export function pwBoard(setup: (s: GameState) => void): GameState {
  const s = newGame(3);
  s.corp.hq = [];
  s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  s.runner.credits = 0;
  s.corp.credits = 20;
  s.turnNumber = 7;
  setup(s);
  return s;
}
const toHq = (s: GameState, code: string) => s.corp.hq.push(createCardInstance(s, code));

/** Boards where place gives an econ asset's install the asset cover's ice-pair placement (no iced remote waits). */
export const pairBoards: Record<string, () => GameState> = {
  // The review pin's mirror: Regolith and a Palisade in HQ, no remote, Corp 5
  mirror: () =>
    pwBoard(s => {
      s.corp.credits = 5;
      toHq(s, PW.REGOLITH);
      toHq(s, PW.PALISADE);
    }),
  // Two ice in HQ (the cheaper in front), a rezzed Palisade on HQ's server, Corp 8
  twoIce: () =>
    pwBoard(s => {
      s.corp.credits = 8;
      installIceForTest(s, PW.PALISADE, 'hq', true);
      toHq(s, PW.REGOLITH);
      toHq(s, PW.PALISADE);
      toHq(s, PW.PING);
    }),
};
