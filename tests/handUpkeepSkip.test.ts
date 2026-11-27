import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCardInstance, GameState, KnownHandCard } from '../src/core';
import { handUpkeepCheck, revealInHand, updateHandKnowledge } from '../src/core/engine/helpers';
import { runnerSeesRd, shuffleRD, updateRdKnowledge } from '../src/core/engine/rdKnowledge';
import { newGame } from './helpers';

// R-105 (brief r105-upkeep-skip rev 1a, part 1): updateHandKnowledge skips a walk whose inputs show it would write
// nothing. No rules change: the walks keep the rules they cite, 1.12.3 (a card gone to a hidden place is not followed),
// 4.4.6b (facedown Archives stays hidden), 10.2.2a and b (what a player saw stays known), 10.2.3a (where a card is
// installed is open). Every test runs with the checked walk on (handUpkeepCheck): each skip taken is compared with the
// walk run from the same lists, and a difference is recorded and thrown. A test that expects a skip says so by its count.

const SG = { hedgeFund: '30075', regolith: '30071', palisade: '30072', sureGamble: '30030', cleaver: '30006' };

let wasOn = false;
beforeEach(() => {
  wasOn = handUpkeepCheck.on;
  handUpkeepCheck.on = true;
  handUpkeepCheck.failures.length = 0;
});
afterEach(() => {
  expect(handUpkeepCheck.failures).toEqual([]);
  handUpkeepCheck.on = wasOn;
});
/** The skips the last act() took, by walk. */
let lastTaken: Record<string, number> = {};
const taken = () => lastTaken;

/** Applies `change` to a copy of `s` the way an action would, then runs the engine's two knowledge updates. */
function act(s: GameState, change: (next: GameState) => void = () => {}): GameState {
  const next = structuredClone(s);
  change(next);
  const walk = updateRdKnowledge(s, next);
  const before = { ...handUpkeepCheck.checked };
  updateHandKnowledge(s, next, walk);
  lastTaken = Object.fromEntries(Object.entries(handUpkeepCheck.checked).map(([k, v]) => [k, v - before[k as keyof typeof before]]));
  return next;
}
const codes = (list: KnownHandCard[] | undefined) => (list ?? []).map(e => e.code);

/** HQ holds the given codes, the Runner has seen the first `seen`; the grip and facedown Archives are emptied. */
function board(hqCodes: string[], seen: number): { s: GameState; ids: string[] } {
  const s = newGame();
  const cards = hqCodes.map(code => createCardInstance(s, code));
  s.corp.hq = cards;
  s.corp.knownToRunner = [];
  revealInHand(s, 'corp', cards.slice(0, seen));
  // The board is a state between actions: the walk after the reveal has taken its notes (B4c's RdNotes.handSeen)
  delete s.corp.rdNotes;
  return { s, ids: cards.map(c => c.instanceId) };
}
/** An unrezzed card installed in a new remote. */
function installRemote(s: GameState, code: string) {
  const card = createCardInstance(s, code);
  s.corp.servers.remote9 = { id: 'remote9', isRemote: true, root: [card], ice: [] } as unknown as GameState['corp']['servers'][string];
  return card;
}

describe('R-105: the upkeep skip leaves every list as the walk would', () => {
  it('an action that changes nothing leaves all three lists as they were, and every walk is skipped', () => {
    const { s, ids } = board([SG.hedgeFund, SG.regolith], 2);
    s.runner.grip = [createCardInstance(s, SG.sureGamble)];
    revealInHand(s, 'runner', s.runner.grip);
    delete s.corp.rdNotes;
    const arc = createCardInstance(s, SG.palisade);
    s.corp.archives.faceDown = [arc];
    s.corp.archKnownToRunner = [{ id: arc.instanceId, code: arc.cardCode }];
    const after = act(s);
    expect(after.corp.knownToRunner).toEqual(s.corp.knownToRunner);
    expect(after.runner.knownToCorp).toEqual(s.runner.knownToCorp);
    expect(after.corp.archKnownToRunner).toEqual(s.corp.archKnownToRunner);
    expect(codes(after.corp.knownToRunner)).toEqual([SG.hedgeFund, SG.regolith]);
    expect(ids).toHaveLength(2);
    expect(taken()).toEqual({ archives: 1, arrivals: 2, main: 1 });
  });

  it('an installed card exposed in place still makes the walk forget the same-named HQ entry (the flag is compared)', () => {
    const { s } = board([SG.hedgeFund, SG.regolith], 2);
    const remote = installRemote(s, SG.regolith);
    const after = act(s, n => (n.corp.servers.remote9.root[0].runnerKnows = true));
    expect(codes(after.corp.knownToRunner)).toEqual([SG.hedgeFund]);
    expect(remote.cardCode).toBe(SG.regolith);
    expect(taken().main).toBe(0);
  });

  it('an installed card rezzed in place does the same', () => {
    const { s } = board([SG.hedgeFund, SG.regolith], 2);
    installRemote(s, SG.regolith);
    const after = act(s, n => (n.corp.servers.remote9.root[0].isRezzed = true));
    expect(codes(after.corp.knownToRunner)).toEqual([SG.hedgeFund]);
    expect(taken().main).toBe(0);
  });

  it('a remote removed changes the server keys: the strict test misses, nothing surfaced, and the lists are as the walk leaves them', () => {
    const { s } = board([SG.hedgeFund, SG.regolith], 2);
    s.corp.servers.remote9 = { id: 'remote9', isRemote: true, root: [], ice: [] } as unknown as GameState['corp']['servers'][string];
    const after = act(s, n => delete n.corp.servers.remote9);
    expect(codes(after.corp.knownToRunner)).toEqual([SG.hedgeFund, SG.regolith]);
  });

  it('a Corp list longer than HQ is still cut to HQ, oldest first', () => {
    const { s, ids } = board([SG.hedgeFund, SG.regolith, SG.palisade], 3);
    s.corp.hq = s.corp.hq.filter(c => c.instanceId !== ids[2]);
    const after = act(s);
    expect(codes(after.corp.knownToRunner)).toEqual([SG.regolith, SG.palisade]);
    expect(taken().main).toBe(0);
  });

  // B4c (brief b4c-knowledge-by-copy rev 1, item 4a): the R-105 form of this test listed an R&D card's id and marked it
  // without the card leaving HQ, a state no action makes. The followed card now leaves HQ in the action, and it forgets
  // one entry of its title by copy, not the entry with its id.
  it('an HQ card the Runner follows into R&D in the action forgets an entry of its title (10.2.2b)', () => {
    const { s, ids } = board([SG.hedgeFund, SG.regolith], 2);
    const after = act(s, n => {
      const c = n.corp.hq.splice(1, 1)[0];
      n.corp.rd.unshift(c);
      runnerSeesRd(n, c);
    });
    expect(after.corp.knownToRunner?.map(e => e.id)).toEqual([ids[0]]);
    expect(taken().main).toBe(0);
  });

  it('a bare-id entry from an old save is still dropped', () => {
    const { s } = board([SG.hedgeFund, SG.regolith], 1);
    s.corp.knownToRunner = ['inst-old' as unknown as KnownHandCard, ...(s.corp.knownToRunner ?? [])];
    const after = act(s);
    expect(after.corp.knownToRunner).toEqual(s.corp.knownToRunner.slice(1));
    expect(taken().main).toBe(0);
  });

  it('facedown Archives reordered falls through to the walk and ends the same', () => {
    const { s } = board([SG.hedgeFund], 1);
    const [a, b] = [createCardInstance(s, SG.palisade), createCardInstance(s, SG.regolith)];
    s.corp.archives.faceDown = [a, b];
    s.corp.archKnownToRunner = [{ id: a.instanceId, code: a.cardCode }];
    const after = act(s, n => n.corp.archives.faceDown.reverse());
    expect(after.corp.archKnownToRunner).toEqual([{ id: a.instanceId, code: a.cardCode }]);
    expect(taken().archives).toBe(0);
  });

  it('the grip list is kept on an action that changes nothing, and still cut when longer than the grip', () => {
    const { s } = board([SG.hedgeFund], 0);
    const grip = [SG.sureGamble, SG.cleaver, SG.sureGamble].map(code => createCardInstance(s, code));
    s.runner.grip = grip;
    revealInHand(s, 'runner', grip);
    expect(codes(act(s).runner.knownToCorp)).toEqual([SG.sureGamble, SG.cleaver, SG.sureGamble]);
    s.runner.grip = grip.slice(0, 2);
    expect(codes(act(s).runner.knownToCorp)).toEqual([SG.cleaver, SG.sureGamble]);
  });

  it('a reveal made inside the action, with HQ and the board unchanged, is kept', () => {
    const { s } = board([SG.hedgeFund, SG.regolith], 1);
    const after = act(s, n => revealInHand(n, 'corp', [n.corp.hq[1]]));
    expect(codes(after.corp.knownToRunner)).toEqual([SG.hedgeFund, SG.regolith]);
    // B4c: a list changed in the action is a sighting the walk places by copy (helpers.ts placeSightings), so the skip
    // is not taken; under R-105 it was.
    expect(taken().main).toBe(0);
  });

  it('a card newly hosted on an installed card surfaces and forgets the same-named entry', () => {
    const { s } = board([SG.hedgeFund, SG.regolith], 2);
    s.runner.rig.programs = [createCardInstance(s, SG.cleaver)];
    const after = act(s, n => (n.runner.rig.programs[0].hostedCards = [createCardInstance(n, SG.hedgeFund)]));
    expect(codes(after.corp.knownToRunner)).toEqual([SG.regolith]);
    expect(taken().main).toBe(0);
  });

  it('an Archives list longer than an unchanged pile is still cut', () => {
    const { s } = board([SG.hedgeFund], 1);
    const [a, z] = [createCardInstance(s, SG.palisade), createCardInstance(s, SG.regolith)];
    s.corp.archives.faceDown = [a];
    s.corp.archKnownToRunner = [
      { id: a.instanceId, code: a.cardCode },
      { id: z.instanceId, code: z.cardCode },
    ];
    const after = act(s);
    expect(after.corp.archKnownToRunner).toEqual([{ id: z.instanceId, code: z.cardCode }]);
    expect(taken().archives).toBe(0);
  });

  it('an absent field stays absent (no empty list is written)', () => {
    const { s } = board([SG.hedgeFund], 1);
    delete s.corp.archKnownToRunner;
    delete s.runner.knownToCorp;
    const after = act(s);
    expect('archKnownToRunner' in after.corp).toBe(false);
    expect('knownToCorp' in after.runner).toBe(false);
    expect(codes(after.corp.knownToRunner)).toEqual([SG.hedgeFund]);
  });

  it('a card leaving the open with nothing newly open is skipped by the looser test, and the lists are as the walk leaves them', () => {
    const { s } = board([SG.hedgeFund, SG.regolith], 2);
    s.runner.heap = [createCardInstance(s, SG.sureGamble)];
    const after = act(s, n => n.runner.stack.unshift(n.runner.heap.pop()!));
    expect(codes(after.corp.knownToRunner)).toEqual([SG.hedgeFund, SG.regolith]);
    expect(taken().main).toBe(1);
  });
});

describe('R-105 with R-109: the R&D marks the walk writes are checked too', () => {
  it("a left 'hq' mark gets an HQ departure's loss once when the other skips are taken and the main walk runs (rules 1.12.3, 4.6.6d)", () => {
    const s0 = newGame();
    const fun = createCardInstance(s0, '30054');
    s0.corp.rd = [createCardInstance(s0, SG.hedgeFund), fun, createCardInstance(s0, SG.palisade)];
    let s = act(s0, n => runnerSeesRd(n, fun));
    s = act(s, n => shuffleRD(n));
    s = act(s, n => n.corp.hq.push(n.corp.rd.splice(n.corp.rd.findIndex(c => c.instanceId === fun.instanceId), 1)[0]));
    expect(s.corp.rdKnownToRunner?.[0]).toMatchObject({ id: fun.instanceId, left: 'hq' });
    expect(s.runner.grip.length).toBeGreaterThan(0);
    // An HQ card installed facedown as ice: HQ changed, so the main walk runs; Archives and the grip are unchanged
    s = act(s, n => n.corp.servers.hq.ice.push(n.corp.hq.splice(n.corp.hq.findIndex(x => x.instanceId === fun.instanceId), 1)[0]));
    expect(taken()).toEqual({ archives: 1, arrivals: 1, main: 0 });
    expect(s.corp.rdKnownToRunner?.[0].lost).toEqual({ ice: 1 });
  });
});

describe('R-105: the checked walk is a test seam', () => {
  it('is a const object, off unless a test turns it on, and only helpers.ts names it in src', async () => {
    const { readFileSync } = await import('node:fs');
    const { execSync } = await import('node:child_process');
    const helpers = readFileSync('src/core/engine/helpers.ts', 'utf8');
    expect(helpers).toMatch(/^export const handUpkeepCheck = \{\n {2}on: false,/m);
    const named = execSync('grep -rl handUpkeepCheck src || true', { encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(named).toEqual(['src/core/engine/helpers.ts']);
  });
});
