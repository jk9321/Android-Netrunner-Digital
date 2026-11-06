import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CardInstance, GameState, cardDef } from '../src/core';
import { HeuristicCorpAI } from '../src/ai/corpAI';
import { modelRezParts } from '../src/ai/rezModel';
import { asSide, tuning } from '../src/ai/synergy';

/**
 * Jeff (2026-11-05): the Corp never banks money. Over 40 self-play games 40% of everything it spent went on rezzing
 * ice in the Runner's runs, and about a quarter of that on ice the Runner could pay its way through and did: the run
 * went on, the Corp only took a toll (rules 6.4.3, 6.9.2b: the Corp may rez the approached ice in the approach ice paid ability window).
 * plan.rezToll: outside a server holding an agenda, breakable ice is rezzed only when its toll is worth the rez.
 * plan.modelRez (structural review item 2, 2026-11-06) prices the same decision with the value model and replaces it.
 *
 * Position: a self-play game (the loop-trace deals from 1100), turn 8, the Runner (1 credit, Cleaver) approaching the
 * outer Palisade on R&D, a rezzed Palisade behind it; the Corp has 3 credits. Rezzing it costs all 3.
 */
function position(): { state: GameState; cards: string[] } {
  return JSON.parse(readFileSync(new URL('./fixtures/rez-toll.json', import.meta.url), 'utf8'));
}
const outerPalisade = (state: GameState, id: string) => state.corp.servers.rd.ice.find(c => c.instanceId === id)!;
const choose = (state: GameState, ice: CardInstance) => new HeuristicCorpAI({ synergy: true }).chooseRez(state, [ice]);
const base = () => {
  const { state, cards } = position();
  return { state, ice: outerPalisade(state, cards[0]) };
};
const withPlans = <T>(plans: Partial<typeof tuning.plan>, f: () => T): T => {
  const saved = { ...tuning.plan };
  Object.assign(tuning.plan, plans);
  try {
    return f();
  } finally {
    Object.assign(tuning.plan, saved);
  }
};

/** The same Palisade moved to the only ice on remote-1, which holds Offworld Office; the run on remote-1. */
function agendaRemote(corpCredits: number, runnerCredits: number): { state: GameState; ice: CardInstance } {
  const { state, ice } = base();
  const agenda = state.corp.hq.find(c => cardDef(c).title === 'Offworld Office')!;
  const servers = state.corp.servers;
  const moved: GameState = {
    ...state,
    runner: { ...state.runner, credits: runnerCredits },
    activeRun: { ...state.activeRun!, server: 'remote-1', icePosition: 0 },
    corp: {
      ...state.corp,
      credits: corpCredits,
      hq: state.corp.hq.filter(c => c !== agenda),
      servers: { ...servers, rd: { ...servers.rd, ice: servers.rd.ice.filter(c => c !== ice) }, 'remote-1': { ...servers['remote-1'], ice: [ice], root: [agenda] } },
    },
  };
  return { state: moved, ice };
}

describe('in-run ice rez (plan.rezToll, plan.modelRez)', () => {
  it('keeps its 3 credits rather than rez Palisade on R&D', () => {
    const { state, ice } = base();
    expect(choose(state, ice)).toBeNull();
  });

  it('the model alone keeps the credits too (rezToll off): a 3-in-16 R&D access is not worth a broke Corp\'s last 3', () => {
    const { state, ice } = base();
    withPlans({ rezToll: false }, () => expect(choose(state, ice)).toBeNull());
    const parts = asSide('corp', () => modelRezParts(state, ice, true))!;
    // 1 credit can't pay for both Palisades, so the rez would stop the run: it is the price that says no
    expect(parts.stops).toBe(true);
    expect(parts.rez).toBeLessThan(parts.pass);
  });

  it('with neither plan it rezzes (the old importance table)', () => {
    const { state, ice } = base();
    withPlans({ rezToll: false, modelRez: false }, () => expect(choose(state, ice)?.type).toBe('REZ_CARD'));
  });

  it('rezzes to stop a Runner that can\'t pay its way to an agenda', () => {
    const { state, ice } = agendaRemote(3, 0);
    expect(choose(state, ice)?.type).toBe('REZ_CARD');
  });

  it('does not rez ice the Runner breaks on its way to the agenda anyway: the agenda goes either way, the credits needn\'t', () => {
    const { state, ice } = agendaRemote(3, 5);
    const parts = asSide('corp', () => modelRezParts(state, ice, true))!;
    expect(parts.stops).toBe(false);
    expect(choose(state, ice)).toBeNull();
  });

  it('does not rez when the rezzed ice further in stops the run already', () => {
    const { state, ice } = base();
    const broke = { ...state, runner: { ...state.runner, credits: 0 } };
    expect(choose(broke, ice)).toBeNull();
  });
});
