import { describe, expect, it } from 'vitest';
import { answer, giveCard, installCorpForTest, keepGoing, newGame, passTurn, play, scoreForTest, startRunnerTurn, useAbility } from './helpers';
import { cardDef, createCardInstance, executeAction, findCardAnywhere, GameState, knownInHand } from '../src/core';
import { turnFlag, TurnFlag } from '../src/core/engine/cardEffects';

// Rule 8.7.2: "While a player is searching, they may FIND an appropriate number of cards matching any criteria of the
// search by taking them from the zone being searched and setting them aside facedown." Rule 4.8.4: "Cards found during
// a search are set aside facedown while the search completes." Rule 4.8.3: "cards moved into another zone from the
// set-aside zone are treated as though they entered that zone directly from their location prior to being set aside."
// The engine used to park a found card in HQ (Off the Books, Eminent Domain) or on top of the stack (Mutual Favor).

const OFF_THE_BOOKS = '35071';
const STOKE = '34114';
const HOLO_MAN = '34120';
const EMINENT = '34122';
const OFFWORLD = '30067';
const PALISADE = '30072';
const MUTUAL_FAVOR = '30011';
const TUCANA = '34064';
const CHEST = '34070';
const T400 = '30031';
const DOCKLANDS = '30013';

const choose = (s: GameState, optionId: string) => keepGoing(answer(s, { kind: 'effect_choice', optionId }));
const pick = (s: GameState, ids: string[]) => keepGoing(answer(s, { kind: 'effect_cards', cardInstanceIds: ids }));
const source = (s: GameState) => {
  const p = s.pendingPrompts[0];
  return p && 'source' in p ? p.source : undefined;
};
const inHQ = (s: GameState, id: string) => s.corp.hq.some(c => c.instanceId === id);
const setAsideIds = (s: GameState) => (s.setAside ?? []).map(c => c.instanceId);

/** Scores Off the Books, puts `code` in R&D, and passes to the Corp's discard phase, where its dividend is offered. */
function offTheBooksSearch(code: string): { s: GameState; found: string } {
  let s = newGame();
  const id = installCorpForTest(s, OFF_THE_BOOKS, 'remote-score');
  findCardAnywhere(s, id)!.advancementCounters = 4;
  s.activePlayer = 'corp';
  s.phase = 'corp_turn';
  s.corp.clicks = 3;
  s = executeAction(s, { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: id });
  const found = createCardInstance(s, code);
  s.corp.rd.push(found);
  s = passTurn(s);
  s = choose(s, 'use');
  return { s, found: found.instanceId };
}

describe('a card found by a search is set aside, not put in HQ or on the stack (rules 8.7.2, 4.8.3, 4.8.4)', () => {
  it('Off the Books: while the install is decided, the card is in neither R&D nor HQ', () => {
    const { s: before, found } = offTheBooksSearch(OFFWORLD);
    const hq = before.corp.hq.length;
    const s = pick(before, [found]);
    expect(source(s)).toMatchObject({ cardCode: OFF_THE_BOOKS, step: 'install' });
    expect(setAsideIds(s)).toEqual([found]);
    expect(inHQ(s, found)).toBe(false);
    expect(s.corp.rd.some(c => c.instanceId === found)).toBe(false);
    expect(s.corp.hq).toHaveLength(hq);
  });

  it('Off the Books installing Stoke the Embers from R&D offers its reveal ("install from anywhere except HQ")', () => {
    const { s: before, found } = offTheBooksSearch(STOKE);
    let s = pick(before, [found]);
    s = choose(s, 'new');
    expect(source(s)).toMatchObject({ cardCode: STOKE, step: 'reveal' });
    expect(turnFlag(s, TurnFlag.installedFromHQ)).toBe(0);
    expect(s.setAside).toBeUndefined();
  });

  it('Off the Books: a card not installed goes to HQ, known to the Runner, and the set-aside zone is empty', () => {
    const { s: before, found } = offTheBooksSearch(OFFWORLD);
    let s = pick(before, [found]);
    s = choose(s, 'to-hand');
    expect(inHQ(s, found)).toBe(true);
    expect(knownInHand(s, 'corp').map(c => c.id)).toContain(found);
    expect(s.setAside).toBeUndefined();
  });

  it('Eminent Domain: the card found on score is installed from R&D, so The Holo Man still places 3 this turn', () => {
    let s = newGame();
    s.corp.rd.push(...s.corp.hq.splice(0));
    const holo = installCorpForTest(s, HOLO_MAN, 'remote-1', true);
    const target = installCorpForTest(s, OFFWORLD, 'remote-1');
    const pal = createCardInstance(s, PALISADE);
    s.corp.rd.push(pal);
    s = scoreForTest(s, EMINENT);
    s = pick(s, [pal.instanceId]);
    expect(setAsideIds(s)).toEqual([pal.instanceId]);
    expect(s.corp.hq).toHaveLength(0);
    s = choose(s, 'hq');
    expect(findCardAnywhere(s, pal.instanceId)!.isRezzed).toBe(true);
    expect(turnFlag(s, TurnFlag.installedFromHQ)).toBe(0);
    s.corp.clicks = 3;
    s.corp.credits = 10;
    s = useAbility(s, 'corp', holo);
    s = pick(s, [target]);
    expect(findCardAnywhere(s, target)!.advancementCounters).toBe(3);
  });

  it('Mutual Favor: the icebreaker is set aside while the install is decided, not on top of the stack', () => {
    let s = newGame();
    startRunnerTurn(s);
    s.runner.credits = 20;
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'archives' });
    s = executeAction(s, { type: 'CONTINUE_RUN', player: 'runner' });
    s = executeAction(s, { type: 'CONTINUE_RUN', player: 'runner' });
    s = play(s, 'runner', giveCard(s, 'runner', MUTUAL_FAVOR));
    const breaker = s.runner.stack.find(c => /icebreaker/i.test(cardDef(c).keywords ?? ''))!.instanceId;
    const stack = s.runner.stack.length;
    s = answer(s, { kind: 'effect_cards', cardInstanceIds: [breaker] });
    expect(setAsideIds(s)).toEqual([breaker]);
    expect(s.runner.stack).toHaveLength(stack - 1);
    expect(s.runner.stack.some(c => c.instanceId === breaker)).toBe(false);
    s = answer(s, { kind: 'effect_choice', optionId: 'grip' });
    expect(s.runner.grip.map(c => c.instanceId)).toContain(breaker);
    expect(s.setAside).toBeUndefined();
  });

  it('Tucana: the ice found is set aside while the server is chosen, then installed from R&D', () => {
    let s = newGame();
    const pal = createCardInstance(s, PALISADE);
    s.corp.rd.push(pal);
    installCorpForTest(s, TUCANA, 'remote-score', true);
    s.corp.credits = 0;
    s = scoreForTest(s, OFFWORLD);
    const rd = s.corp.rd.length;
    s = pick(s, [pal.instanceId]);
    expect(setAsideIds(s)).toEqual([pal.instanceId]);
    expect(s.corp.rd).toHaveLength(rd - 1);
    s = choose(s, 'hq');
    expect(s.corp.servers.hq.ice.map(c => c.instanceId)).toContain(pal.instanceId);
    expect(turnFlag(s, TurnFlag.installedFromHQ)).toBe(0);
    expect(s.setAside).toBeUndefined();
  });

  // The Wizard's Chest: "Set aside cards from the top of your stack faceup until you set aside 2 cards of the chosen
  // type. You may install 1 of those 2 cards, ignoring all costs. Shuffle the rest of the set-aside cards into your stack."
  it("The Wizard's Chest: the 2 cards wait set aside, not on the stack; the one not installed is shuffled back", () => {
    let s = newGame();
    const wc = createCardInstance(s, CHEST);
    wc.isRezzed = true;
    s.runner.rig.hardware.push(wc);
    startRunnerTurn(s);
    s.runsThisTurn = ['hq', 'rd', 'archives'].map(server => ({ server, successful: true }));
    const a = createCardInstance(s, T400);
    const b = createCardInstance(s, DOCKLANDS);
    s.runner.stack.unshift(a, b);
    const stack = s.runner.stack.length;
    s = useAbility(s, 'runner', wc.instanceId);
    s = choose(s, 'hardware');
    expect(setAsideIds(s).sort()).toEqual([a.instanceId, b.instanceId].sort());
    expect(s.runner.stack).toHaveLength(stack - 2);
    s = pick(s, [b.instanceId]);
    expect(s.runner.rig.hardware.map(c => c.instanceId)).toContain(b.instanceId);
    expect(s.runner.stack.map(c => c.instanceId)).toContain(a.instanceId);
    expect(s.setAside).toBeUndefined();
  });
});
