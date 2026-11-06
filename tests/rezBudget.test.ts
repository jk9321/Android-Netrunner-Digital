import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, cardDef } from '../src/core';
import { REZ_NEXT_SHARE, REZ_NOW_SHARE, iceWorth, rezBudget } from '../src/ai/iceValues';
import { asSide } from '../src/ai/synergy';

/**
 * The rez budget (structural review, 2026-11-06): unrezzed ice counts as rezzable from one pool of credits. Before,
 * each unrezzed ice was tested against the same credits, so in this position 3 credits counted as rezzing both the
 * Palisade on the agenda remote and the Whitespace on HQ, and spending them priced at about 19: more than the 2-point
 * steal the rez would stop (about 14), so the in-run rez model (plan.modelRez) let the Runner steal. With the budget the
 * ice part of that drops from 6.6 to 3.3 (the agenda's own protection, agendaWorth via stealOdds, still reads the same
 * credits: a second count left for the Corp ranking refactor, item 1).
 *
 * Position: the rez-toll fixture, Offworld Office moved to remote-1 behind the outer Palisade (unrezzed, 3 to rez),
 * the run ended, the Runner on 0 credits; HQ has an unrezzed Whitespace (3 to rez). The Corp has 3 credits.
 */
function position(credits: number): GameState {
  const { state, cards } = JSON.parse(readFileSync(new URL('./fixtures/rez-toll.json', import.meta.url), 'utf8')) as { state: GameState; cards: string[] };
  const ice = state.corp.servers.rd.ice.find(c => c.instanceId === cards[0])!;
  const agenda = state.corp.hq.find(c => cardDef(c).title === 'Offworld Office')!;
  const servers = state.corp.servers;
  return {
    ...state,
    activeRun: null,
    runner: { ...state.runner, credits: 0 },
    corp: {
      ...state.corp,
      credits,
      hq: state.corp.hq.filter(c => c !== agenda),
      servers: { ...servers, rd: { ...servers.rd, ice: servers.rd.ice.filter(c => c !== ice) }, 'remote-1': { ...servers['remote-1'], ice: [ice], root: [agenda] } },
    },
  };
}
const unrezzed = (s: GameState) => Object.values(s.corp.servers).flatMap(v => v.ice).filter(c => !c.isRezzed);

describe('unrezzed ice shares one pool of rez money', () => {
  it('3 credits cover one 3-credit ice now; the other waits on next turn\'s income', () => {
    const s = position(3);
    const shares = unrezzed(s).map(c => rezBudget(s).get(c.instanceId));
    expect(shares.sort()).toEqual([REZ_NEXT_SHARE, REZ_NOW_SHARE].sort());
  });

  it('spending the 3 credits costs each ice one step (now to next turn, next turn to nothing), not both their full shares', () => {
    asSide('corp', () => {
      const rich = position(3);
      const broke = position(0);
      const ice = unrezzed(rich);
      const now = ice.find(c => rezBudget(rich).get(c.instanceId) === REZ_NOW_SHARE)!;
      const next = ice.find(c => rezBudget(rich).get(c.instanceId) === REZ_NEXT_SHARE)!;
      // broke: the one the pool covered waits on next turn's income, the other gets nothing
      expect(rezBudget(broke).get(now.instanceId)).toBe(REZ_NEXT_SHARE);
      expect(rezBudget(broke).get(next.instanceId)).toBeUndefined();
      expect(iceWorth(rich, now, 'corp')).toBeGreaterThan(iceWorth(broke, now, 'corp'));
    });
  });
});
