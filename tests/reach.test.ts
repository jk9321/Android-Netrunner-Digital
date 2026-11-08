import { afterEach, describe, expect, it } from 'vitest';
import { GameState, cardDef, createCardInstance } from '../src/core';
import { tuning } from '../src/ai/synergy';
import { atLeastOne, cases, getIn, reachOn, reachStanding } from '../src/ai/reach';
import { newGame } from './helpers';
import { inDecision } from './helpers/pricing';

/**
 * Round 2 Phase 2 K (spec-phase2.md K, design-k1.md): the Runner capability model. The Corp can't see the grip (rule
 * 10.2.2a), so reach prices a server over the breakers the Runner may hold or draw from its unseen pool (grip and stack
 * together; decklists are public), each installed for a click and its cost (rule 5.2.7d).
 */

const saved = { reach: tuning.plan.reach, reachStrength: tuning.plan.reachStrength, reachTime: tuning.plan.reachTime };
afterEach(() => Object.assign(tuning.plan, saved));

const PALISADE = '30072'; // barrier
const CLEAVER = '30006'; // fracter
const FILLER = '30034'; // Creative Commission

/** A remote with a rezzed Palisade and an agenda, end of the Corp's turn; the Runner has no breakers installed. */
function board(grip: string[], stack: string[], credits = 8): GameState {
  const s = structuredClone(newGame());
  s.runner.rig.programs = [];
  s.runner.credits = credits;
  s.runner.grip = grip.map(code => createCardInstance(s, code));
  s.runner.stack = stack.map(code => createCardInstance(s, code));
  const agenda = s.corp.hq.find(c => cardDef(c).type_code === 'agenda') ?? s.corp.rd.find(c => cardDef(c).type_code === 'agenda')!;
  const ice = createCardInstance(s, PALISADE);
  ice.isRezzed = true;
  s.corp.servers['remote-9'] = { id: 'remote-9', name: 'Remote Server 9', isRemote: true, ice: [ice], root: [{ ...agenda, instanceId: 'agenda-x', isRezzed: false, faceUp: false }] };
  s.corp.clicks = 0;
  return s;
}
const filler = (n: number) => Array.from({ length: n }, () => FILLER);

describe('atLeastOne (hypergeometric)', () => {
  const brute = (pool: number, hits: number, n: number) => {
    // Every n-subset of a pool whose first `hits` cards are hits
    let all = 0;
    let some = 0;
    const walk = (start: number, left: number, hit: boolean) => {
      if (left === 0) {
        all++;
        if (hit) some++;
        return;
      }
      for (let i = start; i <= pool - left; i++) walk(i + 1, left - 1, hit || i < hits);
    };
    walk(0, n, false);
    return some / all;
  };
  it('matches a brute-force count over every grip of a small pool', () => {
    for (let n = 0; n <= 8; n++) for (const hits of [0, 1, 2, 3]) expect(atLeastOne(8, hits, n)).toBeCloseTo(n === 0 ? 0 : brute(8, hits, n), 10);
  });
  it('reads a fractional draw count between its whole neighbours', () => {
    expect(atLeastOne(30, 2, 6.5)).toBeCloseTo((atLeastOne(30, 2, 6) + atLeastOne(30, 2, 7)) / 2, 10);
  });
  it('is 0 with no hits and 1 once the misses run out', () => {
    expect(atLeastOne(30, 0, 10)).toBe(0);
    expect(atLeastOne(10, 2, 9)).toBe(1);
  });
});

describe('plan.reach', () => {
  it('is off by default, and off for the Runner deciding', () => {
    const s = board([CLEAVER], filler(20));
    expect(inDecision(s, 'corp', () => reachOn())).toBe(false);
    tuning.plan.reach = true;
    expect(inDecision(s, 'corp', () => reachOn())).toBe(true);
    expect(inDecision(s, 'runner', () => reachOn())).toBe(false);
  });

  it('a barrier the rig can\'t break: a case with the fracter it may find, weighted by the pool', () => {
    tuning.plan.reach = true;
    const s = board(filler(5), [CLEAVER, ...filler(24)]);
    const cs = inDecision(s, 'corp', () => cases(s, 'remote-9', 1));
    expect(cs).toHaveLength(2);
    const found = cs.find(c => c.added.length)!;
    // 5 grip + 1.6 draws from a 30-card pool holding 1 Cleaver: between 6/30 and 7/30
    expect(found.weight).toBeCloseTo(0.4 * (6 / 30) + 0.6 * (7 / 30), 6);
    expect(found.view.runner.rig.programs.map(p => p.cardCode)).toContain(CLEAVER);
    expect(found.view.runner.credits).toBe(8 - (cardDef(found.added[0]).cost ?? 0));
  });

  it('gets in more often the more fracters the pool holds, never with none', () => {
    tuning.plan.reach = true;
    const none = board(filler(5), filler(25));
    const one = board(filler(5), [CLEAVER, ...filler(24)]);
    const three = board(filler(5), [CLEAVER, CLEAVER, CLEAVER, ...filler(22)]);
    const g = (s: GameState) => inDecision(s, 'corp', () => getIn(s, 'remote-9'));
    expect(g(none)).toBe(0);
    expect(g(one)).toBeGreaterThan(0);
    expect(g(three)).toBeGreaterThan(g(one));
  });

  it('no peeking: which pool cards sit in the grip doesn\'t move it; a grip card the Corp has seen does', () => {
    tuning.plan.reach = true;
    const inGrip = board([CLEAVER, ...filler(4)], filler(25));
    const inStack = board(filler(5), [CLEAVER, ...filler(24)]);
    const g = (s: GameState) => inDecision(s, 'corp', () => getIn(s, 'remote-9'));
    expect(g(inGrip)).toBeCloseTo(g(inStack), 10);
    // The Corp saw the Cleaver in the grip (rule 10.2.2b: a revealed card): the fracter case is sure
    const seen = board([CLEAVER, ...filler(4)], filler(25));
    seen.runner.knownToCorp = [{ id: seen.runner.grip[0].instanceId, code: CLEAVER }];
    const seenCase = inDecision(seen, 'corp', () => cases(seen, 'remote-9', 1)).find(c => c.added.length);
    expect(seenCase?.weight).toBe(1);
  });

  it('a run event that helps get in is a case of its own: Overclock\'s credits pay for the break', () => {
    tuning.plan.reach = true;
    const OVERCLOCK = '30029';
    const broke = (stack: string[]) => {
      const s = board(filler(5), stack, 1);
      s.runner.rig.programs = [createCardInstance(s, CLEAVER)];
      return s;
    };
    const without = broke(filler(25));
    const withIt = broke([OVERCLOCK, OVERCLOCK, ...filler(23)]);
    const cs = inDecision(withIt, 'corp', () => cases(withIt, 'remote-9', 1));
    expect(cs.some(c => c.event?.cardCode === OVERCLOCK && c.options?.bonusCredits === 5)).toBe(true);
    const g = (s: GameState) => inDecision(s, 'corp', () => getIn(s, 'remote-9'));
    expect(g(withIt)).toBeGreaterThan(g(without));
  });

  it('K3: a later horizon has more draws and credits, so standing falls with the turns waited', () => {
    tuning.plan.reach = true;
    tuning.plan.reachTime = true;
    const s = board(filler(5), [CLEAVER, ...filler(24)], 2);
    const [t1, t3] = inDecision(s, 'corp', () => [getIn(s, 'remote-9', 1), getIn(s, 'remote-9', 3)]);
    expect(t3).toBeGreaterThanOrEqual(t1);
    const [one, three] = inDecision(s, 'corp', () => [reachStanding(s, 'remote-9', 1), reachStanding(s, 'remote-9', 3)]);
    expect(three).toBeLessThanOrEqual(one);
  });

  it('K3: the charge falls to zero when the agenda is scored (it has left the board)', () => {
    tuning.plan.reach = true;
    tuning.plan.reachTime = true;
    const s = board(filler(5), [CLEAVER, ...filler(24)]);
    const scored = structuredClone(s);
    const [agenda] = scored.corp.servers['remote-9'].root.splice(0, 1);
    scored.corp.scoreArea.push(agenda);
    // No agenda left in the remote: standing over 0 waiting turns is whole, nothing is charged
    expect(inDecision(scored, 'corp', () => reachStanding(scored, 'remote-9', 0))).toBe(1);
  });
});
