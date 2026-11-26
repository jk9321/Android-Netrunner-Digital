import { describe, expect, it } from 'vitest';
import { cardDef, executeAction, GameState } from '../src/core';
import { dealRunnerUnknowns } from '../src/ai/runnerReply';
import { remoteAgendaOdds, serverValue, trapOdds } from '../src/ai/runs';
import { createCardInstance } from '../src/core';
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

describe('B4b (b): remoteAgendaOdds prices an agenda only where the root allows one', () => {
  it('0 in a central root and beside a known asset; two facedown cards in a remote share its one agenda or asset', () => {
    const s = board();
    const odds = (server: string, i: number) => remoteAgendaOdds(s, s.corp.servers[server], s.corp.servers[server].root[i], 0);
    expect(odds('archives', 0)).toBe(0);
    expect(odds('remote-1', 1)).toBe(0);
    // remote-2 has no ice (no ice bump): a card is an agenda at A / (U + 2 (A + S)) of the unseen pool, not A / (A + S + U)
    const pool = [...s.corp.hq, ...s.corp.rd, ...s.corp.archives.faceDown, ...Object.values(s.corp.servers).flatMap(sv => sv.root.filter(c => !c.isRezzed))];
    const n = (t: string) => pool.filter(c => kind(c.cardCode) === t).length;
    expect(odds('remote-2', 0)).toBeCloseTo(n('agenda') / (n('upgrade') + 2 * (n('agenda') + n('asset'))));
    expect(odds('remote-2', 0)).toBeLessThan(n('agenda') / (n('upgrade') + n('agenda') + n('asset')));
  });
});

describe('B4b (c): no trap share in a root card that can only be an upgrade (a trap is an asset, isTrap)', () => {
  it('beside a rezzed asset, the facedown card adds what an upgrade is worth, with traps in the unseen pool', () => {
    const s = newGame();
    s.corp.hq.push(createCardInstance(s, '30045'), createCardInstance(s, '30045')); // Urtica Cipher: a trap
    installCorpForTest(s, ASSET, 'remote-1', true);
    installCorpForTest(s, ASSET, 'remote-2', true);
    installCorpForTest(s, UPGRADE, 'remote-2');
    const t = tick(s);
    t.activePlayer = 'runner';
    t.phase = 'runner_turn';
    expect(trapOdds(t)).toBeGreaterThan(0);
    // the same server less the facedown upgrade: the difference is the upgrade's own 1 (no agenda, no trap)
    expect(serverValue(t, 'remote-2', 0, new Map(), true) - serverValue(t, 'remote-1', 0, new Map(), true)).toBeCloseTo(1);
  });
});
