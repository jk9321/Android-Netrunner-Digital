import { describe, expect, it } from 'vitest';
import { GameState, cardDef } from '../src/core';
import { revealInHand } from '../src/core/engine/helpers';
import { HeuristicRunnerAI } from '../src/ai';
import { serverValue } from '../src/ai/runs';
import { newGame, startRunnerTurn } from './helpers';

/**
 * Jeff (2026-11-04, playing A Teia with two iced remotes and HQ open): the AI Runner kept running HQ and
 * getting nothing. Every HQ card was a random unseen card to it, however often it had looked. The Runner knows
 * the cards it accessed in HQ are still there (until they leave it), so those count at what they are
 * (plan.knownHq).
 */
function hqOf(types: ('agenda' | 'other')[]): GameState {
  const s = newGame();
  startRunnerTurn(s);
  const agendas = s.corp.rd.filter(c => cardDef(c).type_code === 'agenda');
  const others = s.corp.rd.filter(c => cardDef(c).type_code !== 'agenda');
  s.corp.rd.push(...s.corp.hq);
  s.corp.hq = types.map(t => (t === 'agenda' ? agendas.pop()! : others.pop()!));
  s.corp.rd = s.corp.rd.filter(c => !s.corp.hq.includes(c));
  return s;
}

const hqOverCredit = (s: GameState) => {
  const ranked = new HeuristicRunnerAI({ synergy: true, planner: false }).rankMainActions(s);
  const hq = ranked.find(r => r.action.type === 'INITIATE_RUN' && r.action.targetServerId === 'hq')?.score ?? -Infinity;
  return hq - ranked.find(r => r.action.type === 'GAIN_CREDIT')!.score;
};

describe('HQ cards the Runner has seen (bug report #13; plan.knownHq folded in item 6)', () => {
  it('an HQ it has seen all of, with no agenda, is worth nothing to run', () => {
    const s = hqOf(['other', 'other', 'other']);
    revealInHand(s, 'corp', s.corp.hq);
    expect(serverValue(s, 'hq')).toBe(0);
    expect(hqOverCredit(s)).toBeLessThan(0);
  });

  it('a known agenda in HQ makes it worth more than an unseen HQ', () => {
    const s = hqOf(['agenda', 'other', 'other']);
    const unseen = serverValue(s, 'hq');
    revealInHand(s, 'corp', [s.corp.hq[0]]);
    expect(serverValue(s, 'hq')).toBeGreaterThan(unseen);
  });
});
