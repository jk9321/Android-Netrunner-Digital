import { describe, expect, it } from 'vitest';
import { createCardInstance, executeAction, findCardAnywhere, GameAction, GameState, getLegalActions, isLegalAction } from '../src/core';
import { installRunnerTrashing } from '../src/core/scripts/effects';
import { answer, giveCard, installProgramForTest, keepGoing, newGame, play, runnerInstall, setIdentity, startRunnerTurn, useAbility } from './helpers';

// Making room for a program (rules 8.5.6c: "When installing a program, the Runner may first trash any number of
// programs already installed. They must do so if installing the new program would exceed their memory limit.").
// Regressions from the deep engine fuzz of 2026-11-20 (run 44736659830, beta 062dd0f0); the seeds themselves are
// replayed in tests/engineFuzz.test.ts.

const E = { topan: '35002', scrounge: '35004', madani: '35028', principia: '35032' };
const L = { muse: '34091' };
const SG = { buzzsaw: '30005', cleaver: '30006', leech: '30008', echelon: '30025', unity: '30026', mayfly: '30032' };

const card = (s: GameState, id: string) => findCardAnywhere(s, id)!;
const pick = (s: GameState, ids: string[], trashFirst?: string[]) => keepGoing(answer(s, { kind: 'effect_cards', cardInstanceIds: ids, trashFirst }));
const heapIds = (s: GameState) => s.runner.heap.map(c => c.instanceId);
/** The make-room answers the engine lists for installing `id` at the current prompt. */
const listedTrash = (s: GameState, id: string) =>
  getLegalActions(s, 'runner').flatMap(a =>
    a.type === 'RESOLVE_PROMPT' && a.choice.kind === 'effect_cards' && a.choice.cardInstanceIds[0] === id && a.choice.trashFirst ? [a.choice.trashFirst] : []
  );

/** Madani hosting Principia, beside four installed icebreakers filling the 4 MU limit. */
function madaniWithPrincipia(): { s: GameState; madani: string; principia: string; breakers: string[] } {
  let [s, madani] = runnerInstall(newGame(), E.madani);
  const principia = giveCard(s, 'runner', E.principia);
  s.runner.clicks = 1;
  s = useAbility(s, 'runner', madani, 0);
  s = pick(s, [principia]);
  const breakers = [SG.cleaver, SG.unity, SG.buzzsaw, SG.echelon].map(code => installProgramForTest(s, code));
  expect(s.runner.memoryUnitsUsed).toBe(4);
  return { s, madani, principia, breakers };
}

describe('Make room only when the install is then possible, cost included (rules 8.5.6c, 8.5.16c-d)', () => {
  // Seeds 1120019771, 1120060455 (Madani) and 1120109228 (Arissana): the program fit once programs were trashed, so the
  // plain answer was refused, but every trash made Principia dearer than the Runner's credits: no answer at all (1.14.5)
  it('Madani cannot install a Principia that every make-room trash prices out of reach', () => {
    const { s } = madaniWithPrincipia();
    const use: GameAction = { type: 'USE_ABILITY', player: 'runner', cardInstanceId: s.runner.rig.hardware[0].instanceId, abilityIndex: 1 };
    // 4 less for four other icebreakers = 0, but trashing one (as it must, 3.9.3b) brings it back to 1 (Principia's text)
    s.runner.credits = 0;
    expect(isLegalAction(s, use)).toBe(false);
  });

  it('with the credits for it, Madani installs Principia after trashing one breaker, and the plain answer is refused', () => {
    const { s: s0, madani, principia, breakers } = madaniWithPrincipia();
    s0.runner.credits = 1;
    const s = useAbility(s0, 'runner', madani, 1);
    expect(() => answer(s, { kind: 'effect_cards', cardInstanceIds: [principia] })).toThrow(/make room/);
    // Every listed answer trashes exactly one program, and each is answerable
    const listed = listedTrash(s, principia);
    expect(listed.length).toBe(4);
    for (const t of listed) expect(t.length).toBe(1);
    const t = pick(s, [principia], [breakers[0]]);
    expect(t.runner.rig.programs.map(c => c.instanceId)).toContain(principia);
    expect(t.runner.credits).toBe(0);
    expect(t.runner.memoryUnitsUsed).toBe(4);
  });

  it('a non-breaker trashed to make room keeps Principia cheap; the listed answers are the ones the Runner can pay for', () => {
    const { s: s0, madani, principia, breakers } = madaniWithPrincipia();
    // Swap one breaker for Leech (not an icebreaker): trashing Leech keeps the three-breaker discount
    s0.runner.rig.programs.splice(s0.runner.rig.programs.findIndex(c => c.instanceId === breakers[3]), 1);
    s0.runner.memoryUnitsUsed -= 1;
    const leech = installProgramForTest(s0, SG.leech);
    s0.runner.credits = 1; // Principia: 4 - 3 = 1 while all three breakers stay
    const s = useAbility(s0, 'runner', madani, 1);
    expect(listedTrash(s, principia)).toEqual([[leech]]);
    expect(() => answer(s, { kind: 'effect_cards', cardInstanceIds: [principia], trashFirst: [breakers[0]] })).toThrow();
    const t = pick(s, [principia], [leech]);
    expect(t.runner.rig.programs.map(c => c.instanceId)).toContain(principia);
    expect(heapIds(t)).toContain(leech);
  });

  it('an effect install that no trash makes possible installs nothing and trashes nothing (rules 1.2.4)', () => {
    const { s, principia, breakers } = madaniWithPrincipia();
    s.runner.credits = 0;
    const p = card(s, principia);
    const zone = s.runner.rig.hardware[0].hostedCards!;
    expect(installRunnerTrashing(s, p, zone, undefined, 0, [])).toBe(false);
    expect(s.runner.rig.programs.map(c => c.instanceId)).toEqual(breakers);
    // Naming programs that don't make it possible is not an answer
    expect(() => installRunnerTrashing(s, p, zone, undefined, 0, [breakers[0]])).toThrow();
    expect(heapIds(s)).not.toContain(breakers[0]);
  });
});

describe("The listed make-room answers are priced by the effect's own discount", () => {
  // Found by a local fuzz of the fix (seed 1120003674, Topan): listing make-room answers at full price dropped every
  // answer when only Topan's 2-credit discount made the install affordable
  it('Topan installs Echelon for 1 credit after trashing a program, and the engine lists those answers', () => {
    let s = newGame();
    startRunnerTurn(s);
    setIdentity(s, 'runner', E.topan);
    const leeches = [1, 2, 3, 4].map(() => installProgramForTest(s, SG.leech));
    const echelon = giveCard(s, 'runner', SG.echelon); // 3, so 1 with Topan's discount
    s.runner.credits = 1;
    s.runner.clicks = 4;
    s = useAbility(s, 'runner', s.runner.identity.instanceId, 0);
    expect(s.pendingPrompts[0].message).toMatch(/^Topan/);
    expect(listedTrash(s, echelon)).toEqual(leeches.map(id => [id]));
    s = pick(s, [echelon], [leeches[0]]);
    expect(s.runner.rig.programs.map(c => c.instanceId)).toContain(echelon);
    expect(s.runner.credits).toBe(0);
  });
});

describe('A program hosted on a trashed host goes with it, once (rules 1.13.13, 4.1.1c)', () => {
  /** Muse (1 MU) hosting Leech (1 MU), plus two more programs: 4 of 4 MU. */
  function museHostingLeech(): { s: GameState; muse: string; leech: string; others: string[] } {
    let s = newGame();
    const leechCard = createCardInstance(s, SG.leech);
    s.runner.heap.push(leechCard);
    const others = [installProgramForTest(s, SG.cleaver), installProgramForTest(s, SG.unity)];
    let muse: string;
    [s, muse] = runnerInstall(s, L.muse);
    s = pick(s, [leechCard.instanceId]);
    expect(card(s, leechCard.instanceId).hostedOnId).toBe(muse);
    expect(s.runner.memoryUnitsUsed).toBe(4);
    return { s, muse, leech: leechCard.instanceId, others };
  }

  // Seeds 1120169013, 1120113068 and three more: the answer [Muse, its hosted program] put that program in the heap twice
  it('trashing Muse and its hosted program together puts the program in the heap once', () => {
    const { s: s0, muse, leech } = museHostingLeech();
    startRunnerTurn(s0);
    const mayfly = giveCard(s0, 'runner', SG.mayfly); // 2 MU
    s0.runner.credits = 5;
    s0.runner.clicks = 4;
    const s = executeAction(s0, { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: mayfly, trashFirst: [muse, leech] });
    expect(heapIds(s).filter(id => id === leech)).toHaveLength(1);
    expect(heapIds(s).filter(id => id === muse)).toHaveLength(1);
    expect(s.runner.memoryUnitsUsed).toBe(4);
  });

  it('trashing Muse alone frees the memory of the program it hosts too', () => {
    const { s: s0, muse, leech } = museHostingLeech();
    startRunnerTurn(s0);
    const mayfly = giveCard(s0, 'runner', SG.mayfly);
    s0.runner.credits = 5;
    s0.runner.clicks = 4;
    const s = executeAction(s0, { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: mayfly, trashFirst: [muse] });
    expect(heapIds(s)).toEqual(expect.arrayContaining([muse, leech]));
    expect(s.runner.rig.programs.map(c => c.instanceId)).toContain(mayfly);
    expect(s.runner.memoryUnitsUsed).toBe(4);
  });

  it('the listed make-room answers never name a hosted program beside its host: Muse alone frees both', () => {
    const { s: s0, muse, leech } = museHostingLeech();
    startRunnerTurn(s0);
    const mayfly = createCardInstance(s0, SG.mayfly); // 2 MU over a full 4 MU
    s0.runner.heap.push(mayfly);
    const id = giveCard(s0, 'runner', E.scrounge);
    s0.runner.clicks = 2;
    s0.runner.credits = 10;
    const s = keepGoing(play(s0, 'runner', id));
    expect(s.pendingPrompts[0].message).toMatch(/^Scrounge: install/);
    const listed = listedTrash(s, mayfly.instanceId);
    expect(listed).toEqual([[muse]]);
    const t = pick(s, [mayfly.instanceId], [muse]);
    expect(heapIds(t).filter(x => x === leech)).toHaveLength(1);
    expect(t.runner.rig.programs.map(c => c.instanceId)).toContain(mayfly.instanceId);
  });
});

describe("Scrounge's second sentence after Muse's search (rules 9.6.5a)", () => {
  // Seeds 1120075505 and 1120092432: Scrounge installed Muse from the heap, Muse's search installed a heap program, and
  // Scrounge's "add 1 program to the bottom of your stack" still listed it: getLegalActions threw
  it('the "add to stack" question lists only the programs still in the heap', () => {
    let s = newGame();
    startRunnerTurn(s);
    const muse = createCardInstance(s, L.muse);
    const leech = createCardInstance(s, SG.leech);
    const cleaver = createCardInstance(s, SG.cleaver);
    s.runner.heap.push(muse, leech, cleaver);
    const id = giveCard(s, 'runner', E.scrounge);
    s.runner.clicks = 2;
    s.runner.credits = 10;
    s = keepGoing(play(s, 'runner', id));
    s = pick(s, [muse.instanceId]); // Scrounge installs Muse
    expect(s.pendingPrompts[0].message).toMatch(/^Muse/);
    s = pick(s, [leech.instanceId]); // Muse installs Leech from the heap
    expect(card(s, leech.instanceId).hostedOnId).toBe(muse.instanceId);
    const p = s.pendingPrompts[0];
    expect(p.message).toMatch(/^Scrounge/);
    expect(p.kind === 'effect_cards' && p.candidateIds).toEqual([cleaver.instanceId]);
    expect(() => getLegalActions(s, 'runner')).not.toThrow();
    expect(() => answer(s, { kind: 'effect_cards', cardInstanceIds: [leech.instanceId] })).toThrow();
    s = pick(s, [cleaver.instanceId]);
    expect(s.runner.stack[s.runner.stack.length - 1].instanceId).toBe(cleaver.instanceId);
  });
});
