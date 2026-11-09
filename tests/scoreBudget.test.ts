import { afterEach, describe, expect, it } from 'vitest';
import { boardNeed, buildTarget, creditNeed, scoreNeed, sideCreditValue } from '../src/ai/valueModel';
import { tuning } from '../src/ai/synergy';
import { cardDef, createCardInstance, GameState } from '../src/core';
import { newGame } from './helpers';
import { inDecision } from './helpers/pricing';

/**
 * plan.scoreBudget (round 2 Phase 2 E1, spec-phase2.md): the Corp's credit need counts the credits still to pay to
 * score the agendas in its remotes. Advancing costs a click and 1 credit (comprehensive rules 5.2.6f) and an agenda
 * scores once its advancement counters reach its advancement requirement (1.17.3a), so an installed Offworld Office
 * (requirement 4) with 1 counter still needs 3 credits on top of the rez cost of the ice holding it (1.16.8).
 */
const JAGUARUNDI = '34035';
const OFFWORLD_OFFICE = '30067';
const defaultOn = tuning.plan.scoreBudget;
afterEach(() => { tuning.plan.scoreBudget = defaultOn; });

function remote(s: GameState, id: string, root: string[], ice: number, counters = 1) {
  const cards = root.map(code => Object.assign(createCardInstance(s, code), { advancementCounters: counters }));
  s.corp.servers[id] = { id, name: id, isRemote: true, ice: Array.from({ length: ice }, () => createCardInstance(s, JAGUARUNDI)), root: cards };
}

/** A Corp with an Offworld Office on 1 counter behind 3 unrezzed Jaguarundi. */
function scoringBoard(): GameState {
  const s = newGame();
  s.corp.credits = 5;
  remote(s, 'remote-1', [OFFWORLD_OFFICE], 3);
  return s;
}

describe('plan.scoreBudget', () => {
  it('is built off (batched against the Phase 2 base before any flip)', () => expect(defaultOn).toBe(false));

  it('counts the advancement still short on remote agendas, 1 credit each (5.2.6f)', () => {
    const s = scoringBoard();
    const need = (cardDef(s.corp.servers['remote-1'].root[0]).advancement_cost ?? 0) - 1;
    expect(need).toBeGreaterThan(0);
    expect(scoreNeed(s)).toBe(need);
    // a finished agenda needs nothing more
    s.corp.servers['remote-1'].root[0].advancementCounters = 9;
    expect(scoreNeed(s)).toBe(0);
  });

  it('adds it to the Corp’s own credit need on top of the build target or board need, only with the switch on', () => {
    const s = scoringBoard();
    tuning.plan.scoreBudget = false;
    const off = inDecision(s, 'corp', () => creditNeed(s, 'corp', 'corp'));
    expect(off).toBe(Math.max(buildTarget(s, 'corp'), inDecision(s, 'corp', () => boardNeed(s, 'corp'))));
    tuning.plan.scoreBudget = true;
    expect(inDecision(s, 'corp', () => creditNeed(s, 'corp', 'corp')) - off).toBe(scoreNeed(s));
    // with less ice than the build target needs, it still counts
    s.corp.servers['remote-1'].ice = s.corp.servers['remote-1'].ice.slice(0, 1);
    tuning.plan.scoreBudget = false;
    const small = inDecision(s, 'corp', () => creditNeed(s, 'corp', 'corp'));
    expect(small).toBe(buildTarget(s, 'corp'));
    tuning.plan.scoreBudget = true;
    expect(inDecision(s, 'corp', () => creditNeed(s, 'corp', 'corp')) - small).toBe(scoreNeed(s));
  });

  it('makes the Corp’s next credit worth more while the score is unpaid', () => {
    const s = scoringBoard();
    const richer = { ...s, corp: { ...s.corp, credits: s.corp.credits + 1 } };
    const marginal = () => inDecision(s, 'corp', () => sideCreditValue(richer, 'corp', 'corp') - sideCreditValue(s, 'corp', 'corp'));
    tuning.plan.scoreBudget = false;
    const off = marginal();
    tuning.plan.scoreBudget = true;
    expect(marginal()).toBeGreaterThan(off);
  });

  it('leaves the Runner view alone (it can’t tell a facedown root card is an agenda)', () => {
    const s = scoringBoard();
    const runnerView = () => inDecision(s, 'runner', () => sideCreditValue(s, 'corp', 'runner'));
    tuning.plan.scoreBudget = false;
    const off = runnerView();
    tuning.plan.scoreBudget = true;
    expect(runnerView()).toBe(off);
  });
});
