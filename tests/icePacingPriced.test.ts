/**
 * Bug report #43 (Jeff's Runner test game 11 vs the Normal Corp, Teia, 2026-11-09): "it didn't seem to know what to do ...
 * Afraid to rez ice or something despite having plenty of money". The Runner won 8-2.
 *
 * Turn 7: the Corp on 20 credits, the Runner on 5 points, HQ with no ice, and Mycoweb and Cloud Eater in HQ. Every ice
 * install ranked -Infinity and the Corp clicked to draw three times. The ice-pacing guard (corpAI installScore: no ice
 * the Corp can't afford to rez on top of the unrezzed ice already out) counted every unrezzed ice on the board: two
 * Attini (6 each) on remotes holding nothing or assets and the Mycoweb on R&D (8), 20 credits it never meant to spend,
 * so the board's own unrezzed ice locked out the ice HQ needed. plan.icePacingPriced drops the guard while
 * plan.ownIceKnown prices the ice (Jeff: "that ICE just shouldn't count as protection unless it CAN rez it").
 *
 * plan.icePacingPriced is PARKED OFF (about -7 points through over-icing, synergy.ts): these tests pin what it does when on.
 *
 * Turn 6 (plan.ownIceKnown, effectValues.ts): Fujii Asset Retrieval on 2 counters behind an unrezzed Attini, the Corp on
 * 20 credits; the Runner approached and the Corp passed (rules 6.9.2b-c: unrezzed ice is passed) and lost 3 points.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { HeuristicCorpAI, createAgent } from '../src/ai';
import { rezCandidates } from '../src/ai/playout';
import { tuning } from '../src/ai/synergy';

const report = () => JSON.parse(readFileSync(new URL('./fixtures/human-games/report-43.json', import.meta.url), 'utf8'));

/** Game 11 replayed until `stop` says so. */
function replay(stop: (s: GameState, m: GameAction) => boolean): GameState {
  const r = report();
  let s: GameState = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  for (const m of r.moves as GameAction[]) {
    if (stop(s, m)) return s;
    s = executeAction(s, m);
  }
  throw new Error('position not reached');
}

/** The Corp's first main-phase decision of turn 7. */
const turn7 = () => replay((s, m) => s.turnNumber === 7 && s.activePlayer === 'corp' && s.corp.clicks > 0 && actingSide(s) === 'corp' && !s.pendingPrompts.length && m.type !== 'START_TURN');

/** The Runner approaching the Attini on Remote Server 1 at turn 6, the Corp to answer. */
const attini = () => replay(s => s.turnNumber === 6 && s.activePlayer === 'runner' && s.priority?.holder === 'corp' && s.priority.step === 'approach_ice' && !s.pendingPrompts.length);

const withSwitch = <T>(key: 'icePacingPriced' | 'ownIceKnown', on: boolean, work: () => T): T => {
  const was = tuning.plan[key];
  tuning.plan[key] = on;
  try {
    return work();
  } finally {
    tuning.plan[key] = was;
  }
};

const iceInstalls = (s: GameState, server: string) =>
  new HeuristicCorpAI({ planner: false })
    .rankMainActions(s)
    .filter(r => r.action.type === 'INSTALL_CARD' && r.action.targetServerId === server && cardDef(findCardAnywhere(s, r.action.cardInstanceId)!).type_code === 'ice');

describe('game 11 (bug report #43): the Corp with money ices HQ and rezzes its ice', () => {
  it('turn 7: the position as Jeff met it (20 credits, HQ bare, the Runner on 5)', () => {
    const s = turn7();
    expect(s.corp.credits).toBe(20);
    expect(s.runner.score).toBe(5);
    expect(s.corp.servers.hq.ice).toHaveLength(0);
    expect(s.corp.hq.filter(c => cardDef(c).type_code === 'ice').length).toBeGreaterThanOrEqual(2);
  });

  it('turn 7: the Corp ices its centrals with plan.icePacingPriced, HQ among them; every ice install was -Infinity without it', { timeout: 120_000 }, () => {
    const on = withSwitch('icePacingPriced', true, () => {
      const s = turn7();
      const top = new HeuristicCorpAI({ planner: false }).rankMainActions(s)[0];
      // The whole planned turn (Normal): Cloud Eater on HQ, Empiricist on R&D, then Regolith's credits
      let t = s;
      const ai = createAgent('corp', 'normal');
      for (let i = 0; i < 10 && t.activePlayer === 'corp'; i++) {
        const action = ai.chooseAction(t);
        t = executeAction(t, action);
        if (action.type === 'END_TURN') break;
      }
      return { top, hqIce: t.corp.servers.hq.ice.length, rdIce: t.corp.servers.rd.ice.length, ranked: iceInstalls(s, 'hq') };
    });
    expect(on.top.action.type === 'INSTALL_CARD' && cardDef(findCardAnywhere(turn7(), on.top.action.cardInstanceId)!).type_code).toBe('ice');
    expect(on.ranked.some(r => Number.isFinite(r.score))).toBe(true);
    expect(on.hqIce).toBeGreaterThanOrEqual(1);
    const off = withSwitch('icePacingPriced', false, () => iceInstalls(turn7(), 'hq'));
    expect(off.length).toBeGreaterThan(0);
    expect(off.every(r => r.score === -Infinity)).toBe(true);
  });

  it('turn 7: ice the Corp can\'t pay for is priced lower, not blocked (Cloud Eater, rez 10, on 5 credits vs 20)', { timeout: 60_000 }, () => {
    const cloud = (credits: number) => {
      const s = turn7();
      const st = { ...s, corp: { ...s.corp, credits } };
      return iceInstalls(st, 'hq').find(r => r.action.type === 'INSTALL_CARD' && cardDef(findCardAnywhere(st, r.action.cardInstanceId)!).title === 'Cloud Eater')!.score;
    };
    expect(withSwitch('icePacingPriced', true, () => cloud(5) < cloud(20))).toBe(true);
  });

  it('turn 6: the Attini in front of Fujii Asset Retrieval (2 counters) is rezzed with plan.ownIceKnown; passed without it', { timeout: 60_000 }, () => {
    const pick = (on: boolean) =>
      withSwitch('ownIceKnown', on, () => {
        const s = attini();
        expect(s.activeRun!.server).toBe('remote-1');
        const cands = rezCandidates(s, 'approach_ice');
        expect(cands.map(c => cardDef(c).title)).toEqual(['Attini']);
        const rez = new HeuristicCorpAI({ synergy: true }).chooseRez(s, cands);
        return rez ? cardDef(findCardAnywhere(s, (rez as { cardInstanceId: string }).cardInstanceId)!).title : 'pass';
      });
    expect(pick(true)).toBe('Attini');
    expect(pick(false)).toBe('pass');
  });
});
