/**
 * The Runner's position is an element of the server's sequence of positions, not an index into it (rules 6.2.6).
 * Ice leaving its position: 6.2.4 (the Runner's own position stays until they move on), 6.2.6b (ice inward of the
 * Runner changes what they meet next), 6.2.7a/c and 8.5.10 (an uninstalled ice is not passed; its position is).
 */
import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { cont, installIceForTest, newGame, run } from './helpers';
import { iceAtPosition, trashInstalledCorpCard } from '../src/core/engine/helpers';

const PALISADE = '30072';
const VICSEK = '36042';
const PHONEUTRIA = '34043';
const VERTIGO = '36031';

const at = (s: GameState) => iceAtPosition(s)?.instanceId;

describe('the Runner\'s position when ice leaves the attacked server (rules 6.2.4, 6.2.6, 8.5.10)', () => {
  it('Vicsek trashes itself: the ice outward of it is not passed again, and the Runner goes on to the next ice inward', () => {
    let s = newGame();
    const palisade = installIceForTest(s, PALISADE, 'remote-1');
    const vicsek = installIceForTest(s, VICSEK, 'remote-1');
    installIceForTest(s, PHONEUTRIA, 'remote-1');
    for (let i = 0; i < 8; i++) s.runner.grip.push(s.runner.stack.shift()!);
    s = run(s, 'remote-1');
    for (let guard = 0; guard < 10 && at(s) !== vicsek; guard++) s = cont(s);
    expect(at(s)).toBe(vicsek);
    s = cont(s); // encounter Vicsek
    expect(s.activeRun?.phase).toBe('encounter_ice');
    const tags = s.runner.tags;
    // Vicsek's subroutines: X net damage and X tags (X = 1, Phoneutria's pass tag), then 1 tag and it trashes itself.
    // The Runner passes Vicsek's position (no ice) and approaches Palisade.
    s = cont(s);
    expect(s.corp.servers['remote-1'].ice.map(c => c.instanceId)).not.toContain(vicsek);
    expect(at(s)).toBe(palisade);
    // Phoneutria, passed earlier, is not passed again (that pass would give a third tag)
    expect(s.runner.tags - tags).toBe(2);
  });

  it('ice inward of the Runner is trashed: the Runner meets the ice that is now next inward, not the same ice again', () => {
    let s = newGame();
    const palisade = installIceForTest(s, PALISADE, 'remote-1', false);
    const vicsek = installIceForTest(s, VICSEK, 'remote-1', false);
    const vertigo = installIceForTest(s, VERTIGO, 'remote-1', false);
    s = run(s, 'remote-1');
    for (let guard = 0; guard < 10 && at(s) !== vertigo; guard++) s = cont(s);
    expect(at(s)).toBe(vertigo);
    const server = s.corp.servers['remote-1'];
    trashInstalledCorpCard(s, server, server.ice.find(c => c.instanceId === palisade)!);
    expect(at(s)).toBe(vertigo);
    for (let guard = 0; guard < 10 && at(s) === vertigo; guard++) s = cont(s);
    expect(at(s)).toBe(vicsek);
  });
});
