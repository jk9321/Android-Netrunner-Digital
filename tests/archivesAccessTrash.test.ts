import { describe, expect, it } from 'vitest';
import { GameState, StopLevel, actingSide, createCardInstance, executeAction, getLegalActions } from '../src/core';
import { installCorpForTest, newGame, startRunnerTurn } from './helpers';

// Report (2026-11-24, no saved game): "the Runner can trash a rezzed asset by accessing the same asset in Archives".
// Rule 7.1.5b: the Runner cannot trash or pay the trash cost of a card in the Corp's discard pile, so a card accessed
// in Archives (7.4.1d) gets no trash prompt; the basic trash ability (7.1.5) trashes the accessed object only, never
// another copy of the same card. A rezzed card in the ROOT of Archives is different: it is a
// candidate (7.4.1a) and may be trashed, and once trashed it is a new object in Archives that is accessed again
// (7.4.5, whose example is exactly this). These tests pin both.

const NICO = '30037'; // Nico Campaign, asset, trash cost 2
const AMAZE = '30058'; // AMAZE Amusements, upgrade, trash cost 3

/** Runs Archives and answers every prompt, paying to trash whenever the Runner is offered it. Returns the final state and every trash prompt seen. */
function runArchivesTrashingAll(s: GameState): { s: GameState; offered: string[] } {
  const offered: string[] = [];
  startRunnerTurn(s);
  s.runner.clicks = 4;
  s.runner.credits = 20;
  s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'archives' });
  for (let i = 0; i < 60 && s.activeRun; i++) {
    const p = s.pendingPrompts[0];
    if (p?.kind === 'access_trash' && p.trashCost !== null) offered.push(p.cardInstanceId);
    const legal = getLegalActions(s, actingSide(s)!);
    const pick =
      legal.find(a => a.type === 'RESOLVE_PROMPT' && a.choice.kind === 'access_trash' && a.choice.trash) ??
      legal.find(a => a.type === 'RESOLVE_PROMPT') ??
      legal.find(a => (a.type === 'PASS' && !a.restOfRun) || a.type === 'CONTINUE_RUN');
    s = executeAction(s, pick!);
  }
  expect(s.activeRun).toBeNull();
  return { s, offered };
}

describe('Trashing on access during a breach of Archives (7.4.1, 7.4.5)', () => {
  for (const stops of ['full', 'auto', 'ai'] as StopLevel[]) {
    it(`stops ${stops}: a copy of a rezzed installed asset in Archives offers no trash, and the installed copy stays`, () => {
      const s = newGame(5);
      s.stops = { corp: 'ai', runner: stops };
      const installed = installCorpForTest(s, NICO, 'remote-nico', true);
      const up = createCardInstance(s, NICO);
      up.faceUp = true;
      s.corp.archives.faceUp.push(up);
      s.corp.archives.faceDown.push(createCardInstance(s, NICO));
      const { s: end, offered } = runArchivesTrashingAll(s);
      expect(offered).toEqual([]);
      expect(end.corp.servers['remote-nico'].root.map(c => [c.instanceId, c.isRezzed])).toEqual([[installed, true]]);
      expect(end.corp.archives.faceUp.filter(c => c.cardCode === NICO)).toHaveLength(2);
      expect(end.log.filter(l => l.message === 'Runner accessed Nico Campaign.')).toHaveLength(2);
    });
  }

  it('a rezzed upgrade in the root of Archives may be trashed, and is then accessed again in Archives (7.4.1a, 7.4.5)', () => {
    const s = newGame(5);
    s.stops = { corp: 'ai', runner: 'auto' };
    const amaze = installCorpForTest(s, AMAZE, 'archives', true);
    const nico = installCorpForTest(s, NICO, 'remote-nico', true);
    const { s: end, offered } = runArchivesTrashingAll(s);
    expect(offered).toEqual([amaze]);
    expect(end.corp.servers.archives.root).toEqual([]);
    expect(end.corp.archives.faceUp.map(c => c.instanceId)).toEqual([amaze]);
    expect(end.log.filter(l => l.message === 'Runner accessed AMAZE Amusements.')).toHaveLength(2);
    // Only the accessed card is trashed
    expect(end.corp.servers['remote-nico'].root.map(c => c.instanceId)).toEqual([nico]);
  });
});
