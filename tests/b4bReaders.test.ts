import { describe, expect, it } from 'vitest';
import { cardDef, executeAction, GameState } from '../src/core';
import { dealRunnerUnknowns } from '../src/ai/runnerReply';
import { installCorpForTest, newGame } from './helpers';

// B4b readers of the root-kinds fact (brief b4-hidden-zones ruling 9; engine/helpers.ts runnerRootKinds), each with the
// rule it reads: a central root holds only upgrades (3.6.1, 4.6.6e), a remote root one agenda or asset (3.2.1, 3.3.1).
const UPGRADE = '30066'; // Malapert Data Vault
const ASSET = '30071'; // Regolith Mining License
const AGENDA = '30070'; // Superconducting Hub

const tick = (s: GameState) => executeAction(s, { type: 'GAIN_CREDIT', player: 'corp' });
const kind = (code: string) => cardDef({ cardCode: code } as never).type_code;

/** A board with each case: an upgrade in Archives' root, one beside a rezzed asset, and two facedown cards in a remote. */
function board(): GameState {
  const s = newGame();
  installCorpForTest(s, UPGRADE, 'archives');
  installCorpForTest(s, ASSET, 'remote-1', true);
  installCorpForTest(s, UPGRADE, 'remote-1');
  installCorpForTest(s, UPGRADE, 'remote-2');
  installCorpForTest(s, AGENDA, 'remote-2');
  return tick(s);
}

describe('B4b (a): the deal gives a root slot only a kind it can be', () => {
  it('no agenda or asset in a central root or beside a known asset, at most one in a remote root (3.6.1, 3.2.1, 3.3.1)', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let k = 0; k < 60; k++) {
      const v = structuredClone(board());
      dealRunnerUnknowns(v, random);
      expect(kind(v.corp.servers.archives.root[0].cardCode)).toBe('upgrade');
      expect(kind(v.corp.servers['remote-1'].root[1].cardCode)).toBe('upgrade');
      expect(v.corp.servers['remote-2'].root.filter(c => ['agenda', 'asset'].includes(kind(c.cardCode))).length).toBeLessThanOrEqual(1);
    }
  });
});
