import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { HeuristicRunnerAI } from '../src/ai';
import { serverValue } from '../src/ai/runs';
import { installIceForTest, newGame, startRunnerTurn } from './helpers';

/**
 * Jeff's bug report (issue #5, 2026-11-02): the Runner ran Archives after nearly every Corp discard. The
 * odds it gave each facedown card were the deck's share of agendas, as if the Corp discarded at random.
 * A Corp chooses its discards, and into an Archives with no ice it rarely chooses an agenda.
 * Jeff (2026-11-04): still too often (Vic vs Startup Regards). Self-play had 0 agendas among 57 facedown
 * cards at Archives runs, iced or not: 0.05 of the deck's odds bare, 0.1 behind ice.
 */
function discarded(cards: number): GameState {
  const s = newGame();
  startRunnerTurn(s);
  s.corp.archives.faceDown.push(...s.corp.rd.splice(0, cards));
  return s;
}

/** The Archives run's score over a click for a credit. */
const archivesOverCredit = (s: GameState) => {
  const ranked = new HeuristicRunnerAI({ synergy: true, planner: false }).rankMainActions(s);
  const archives = ranked.find(r => r.action.type === 'INITIATE_RUN' && r.action.targetServerId === 'archives')!.score;
  return archives - ranked.find(r => r.action.type === 'GAIN_CREDIT')!.score;
};

describe('a facedown card in an Archives with no ice (bug report #5; plan.archivesChosen folded in item 6)', () => {
  it('is worth little, and twice as much behind ice (a twentieth of a random card bare, a tenth iced)', () => {
    const s = discarded(1);
    const bare = serverValue(s, 'archives');
    expect(bare).toBeGreaterThan(0);
    installIceForTest(s, '30072', 'archives');
    expect(serverValue(s, 'archives')).toBeGreaterThan(bare);
  });

  it('neither one discard nor a pile of three is worth a click', () => {
    expect(archivesOverCredit(discarded(1))).toBeLessThan(0);
    expect(archivesOverCredit(discarded(3))).toBeLessThan(0);
  });
});
