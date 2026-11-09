import { describe, expect, it } from 'vitest';
import { GameAction, GameState } from '../src/core';
import { SpendTracker } from '../scripts/spend-audit';
import { installCorpForTest, installIceForTest, newGame } from './helpers';

/**
 * Phase 2 S, the spend audit (spec-phase2.md): every Corp credit spent is tagged with what it bought, once the outcome
 * is known. Hand-built state pairs, as in stayedBrokeAlarm.test.ts; the tracker only reads states.
 */
const corpAction = (a: Partial<GameAction> & { type: GameAction['type'] }) => ({ player: 'corp', ...a }) as GameAction;

function corpTurn(): GameState {
  return { ...structuredClone(newGame()), activePlayer: 'corp', activeRun: null, pendingPrompts: [] };
}

describe('spend audit (scripts/spend-audit.ts)', () => {
  it('ice installed and never rezzed: its install cost (rules 1.16.6b, 8.5.11a) bought nothing', () => {
    const t = new SpendTracker();
    const before = corpTurn();
    installIceForTest(before, '30072', 'hq'); // Palisade already protecting HQ: the next ice costs 1
    const after = structuredClone(before);
    installIceForTest(after, '30072', 'hq', false);
    after.corp.credits = before.corp.credits - 1;
    t.step(before, after, corpAction({ type: 'INSTALL_CARD' }));
    const items = t.done(after).items.filter(i => i[0] === 'install ice' && i[1] === 1);
    expect(items).toEqual([['install ice', 1, 'never rezzed', 1, 'server never run']]);
  });

  it('advancing an agenda that is then stolen bought nothing; one that is scored did', () => {
    for (const fate of ['stolen', 'scored'] as const) {
      const t = new SpendTracker();
      const s0 = corpTurn();
      const id = installCorpForTest(s0, '30067', 'remote-1'); // Offworld Office
      const s1 = structuredClone(s0);
      s1.corp.servers['remote-1'].root[0].advancementCounters = 1;
      s1.corp.credits = s0.corp.credits - 1;
      t.step(s0, s1, corpAction({ type: 'ADVANCE_CARD', cardInstanceId: id, serverId: 'remote-1' } as Partial<GameAction> & { type: 'ADVANCE_CARD' }));
      const s2 = structuredClone(s1);
      const [card] = s2.corp.servers['remote-1'].root.splice(0, 1);
      (fate === 'stolen' ? s2.runner : s2.corp).scoreArea.push(card);
      t.step(s1, s2);
      const items = t.done(s2).items.filter(i => i[0] === 'advance');
      expect(items).toEqual([['advance', 1, fate, fate === 'stolen' ? 1 : 0, 'Offworld Office']]);
    }
  });

  it('an asset rezzed and trashed in a run without firing bought nothing', () => {
    const t = new SpendTracker();
    const s0 = corpTurn();
    installCorpForTest(s0, '30037', 'remote-1'); // Nico Campaign
    const s1 = structuredClone(s0);
    s1.corp.servers['remote-1'].root[0].isRezzed = true;
    s1.corp.credits = s0.corp.credits - 2;
    t.step(s0, s1, corpAction({ type: 'REZ_CARD' }));
    // The Runner trashes it during a run (only the activeRun flag matters to the tracker here)
    const inRun = { ...structuredClone(s1), activePlayer: 'runner' as const, activeRun: { server: 'remote-1', accessed: [] } as unknown as GameState['activeRun'] };
    const gone = structuredClone(inRun);
    gone.corp.archives.faceUp.push(gone.corp.servers['remote-1'].root.splice(0, 1)[0]);
    t.step(inRun, gone);
    const items = t.done(gone).items.filter(i => i[0] === 'rez asset/upgrade');
    expect(items).toEqual([['rez asset/upgrade', 2, 'trashed unfired', 1, 'Nico Campaign']]);
  });
});
