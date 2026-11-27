import { describe, expect, it } from 'vitest';
import { answer, giveCard, installCorpForTest, keepGoing, newGame, passTurn, play, scoreForTest, startRunnerTurn, useAbility } from './helpers';
import { cardDef, createCardInstance, executeAction, findCardAnywhere, GameState, getLegalActions, knownInHand, newViewIds, viewFor } from '../src/core';
import { turnFlag, TurnFlag } from '../src/core/engine/cardEffects';
import { revealInHand } from '../src/core/engine/helpers';
import { cardsByZone, checkInvariants } from '../scripts/engine-fuzz-check';

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
const LET_THEM_DREAM = '36066';
const MALAPERT = '30066';
const TOCSIN = '36060';

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
    const x = createCardInstance(s, MUTUAL_FAVOR); // not hardware: one of "the rest of the set-aside cards"
    const b = createCardInstance(s, DOCKLANDS);
    s.runner.stack.unshift(a, x, b);
    const stack = s.runner.stack.length;
    s = useAbility(s, 'runner', wc.instanceId);
    s = choose(s, 'hardware');
    // All three wait set aside until the install choice; none sits at a known place in the stack
    expect(setAsideIds(s).sort()).toEqual([a.instanceId, x.instanceId, b.instanceId].sort());
    expect(s.runner.stack).toHaveLength(stack - 3);
    s = pick(s, [b.instanceId]);
    expect(s.runner.rig.hardware.map(c => c.instanceId)).toContain(b.instanceId);
    expect(s.runner.stack.map(c => c.instanceId)).toEqual(expect.arrayContaining([a.instanceId, x.instanceId]));
    expect(s.setAside).toBeUndefined();
  });

  // The view (multiplayer boundary): set-aside cards are facedown (4.8.4), so neither view carries the zone; the found
  // card reaches the prompted side only through its prompt, and a card the text reveals is still named in the log
  it.each([
    ['Off the Books', true],
    ['Tucana', false],
  ] as const)("%s: the Runner's view holds no code for the found card; the Corp sees it only in the prompt", (_which, viaOffTheBooks) => {
    let s: GameState;
    let found: string;
    if (viaOffTheBooks) {
      const o = offTheBooksSearch(STOKE);
      s = pick(o.s, [o.found]);
      found = o.found;
    } else {
      s = newGame();
      const stoke = createCardInstance(s, STOKE);
      const ice = createCardInstance(s, PALISADE);
      s.corp.rd.push(ice);
      s.corp.rd.push(stoke); // a Stoke in R&D too, unseen: Palisade is the found card
      installCorpForTest(s, TUCANA, 'remote-score', true);
      s = scoreForTest(s, OFFWORLD);
      s = pick(s, [ice.instanceId]);
      found = ice.instanceId;
    }
    expect(setAsideIds(s)).toEqual([found]);
    const code = findCardAnywhere(s, found)!.cardCode;
    const runner = viewFor(s, 'runner', newViewIds(), 'g').view;
    expect('setAside' in runner).toBe(false);
    const cardObjects = (v: unknown): { cardCode?: string }[] =>
      v && typeof v === 'object' ? [...(('cardCode' in v) ? [v as { cardCode?: string }] : []), ...Object.values(v).flatMap(cardObjects)] : [];
    const { log: runnerLog, ...runnerRest } = runner;
    expect(cardObjects(runnerRest).some(c => c.cardCode === code)).toBe(false);
    // Revealed by takeFromRD's log line ("Corp revealed <title> and shuffled R&D."), at the same moment as before
    expect(runnerLog.some(l => l.message.includes(`revealed ${cardDef(findCardAnywhere(s, found)!).title}`))).toBe(true);
    const corp = viewFor(s, 'corp', newViewIds(), 'g').view;
    expect('setAside' in corp).toBe(false);
    const { pendingPrompts, log: _corpLog, ...corpRest } = corp;
    void _corpLog;
    expect(cardObjects(pendingPrompts).some(c => c.cardCode === code)).toBe(true);
    // Only the found copy is hidden from the zones: the Corp's other cards with that code are where they are
    const elsewhere = [...s.corp.rd, ...s.corp.hq].filter(c => c.cardCode === code).length;
    expect(cardObjects(corpRest).filter(c => c.cardCode === code).length).toBe(elsewhere);
  });

  // Let Them Dream: "search HQ, R&D, or Archives for 1 agenda and reveal it. Add that agenda to HQ or the bottom of R&D."
  it('Let Them Dream: the agenda found waits set aside, not in HQ, while its place is chosen', () => {
    let s = newGame();
    s.activePlayer = 'corp';
    s.phase = 'corp_turn';
    const off = createCardInstance(s, OFFWORLD);
    s.corp.archives.faceUp.push(off);
    const hq = s.corp.hq.length;
    s = scoreForTest(s, LET_THEM_DREAM);
    s = choose(s, 'archives');
    s = pick(s, [off.instanceId]);
    expect(setAsideIds(s)).toEqual([off.instanceId]);
    expect(s.corp.hq).toHaveLength(hq);
    s = choose(s, 'hq');
    expect(inHQ(s, off.instanceId)).toBe(true);
    expect(knownInHand(s, 'corp').map(c => c.id)).toContain(off.instanceId);
    expect(s.setAside).toBeUndefined();
  });

  // Fuzz invariant set-aside-held (tier 1, RULE-ENGINE-FUZZER): a set-aside card must be named by a pending prompt, or it
  // is out of every visible zone for the rest of the game. Planted fault: the flow ends without taking the card out.
  it('the set-aside-held invariant passes mid-prompt and fires when a flow drops its prompt with the card still set aside', () => {
    const { s: before, found } = offTheBooksSearch(OFFWORLD);
    const s = pick(before, [found]);
    const ids = new Set(cardsByZone(s).map(z => z.card.instanceId));
    const checks = (t: GameState) => checkInvariants(t, null, ids).failures.map(f => f.check).filter(c => c.startsWith('set-aside'));
    expect(checks(s)).toEqual([]);
    const planted = structuredClone(s);
    planted.pendingPrompts = [];
    expect(checks(planted)).toEqual(['set-aside-held']);
    const untidy = structuredClone(s);
    untidy.setAside = [];
    untidy.corp.hq.push(...s.setAside!.map(c => structuredClone(c)));
    expect(checks(untidy)).toEqual(['set-aside-tidy', 'set-aside-origin']);
  });

  // Red team finding 2: the Runner's or Corp's memory of a hand survives a found copy being installed (the found card
  // counts as coming from its deck, 4.8.3), and a hand card that is only set aside is still remembered
  it('hand memory: a known HQ Palisade stays known when Tucana finds and installs another Palisade', () => {
    let s = newGame();
    const inHq = createCardInstance(s, PALISADE);
    s.corp.hq.push(inHq);
    revealInHand(s, 'corp', [inHq]);
    const pal = createCardInstance(s, PALISADE);
    s.corp.rd.push(pal);
    installCorpForTest(s, TUCANA, 'remote-score', true);
    s = scoreForTest(s, OFFWORLD);
    s = pick(s, [pal.instanceId]);
    s = choose(s, 'hq');
    expect(findCardAnywhere(s, pal.instanceId)!.isRezzed).toBe(true);
    expect(knownInHand(s, 'corp').map(e => e.id)).toEqual([inHq.instanceId]);
  });

  it('hand memory: a known grip breaker stays known when Mutual Favor finds and installs another copy', () => {
    let s = newGame();
    startRunnerTurn(s);
    s.runner.credits = 20;
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'archives' });
    s = executeAction(s, { type: 'CONTINUE_RUN', player: 'runner' });
    s = executeAction(s, { type: 'CONTINUE_RUN', player: 'runner' });
    const breaker = s.runner.stack.find(c => /icebreaker/i.test(cardDef(c).keywords ?? ''))!;
    const copy = createCardInstance(s, breaker.cardCode);
    s.runner.grip.push(copy);
    revealInHand(s, 'runner', [copy]);
    s = play(s, 'runner', giveCard(s, 'runner', MUTUAL_FAVOR));
    s = answer(s, { kind: 'effect_cards', cardInstanceIds: [breaker.instanceId] });
    s = answer(s, { kind: 'effect_choice', optionId: 'install' });
    expect(s.runner.rig.programs.some(c => c.instanceId === breaker.instanceId)).toBe(true);
    expect(knownInHand(s, 'runner').map(e => e.id)).toEqual([copy.instanceId]);
  });

  it('hand memory: Let Them Dream searching an all-known HQ forgets none of it', () => {
    let s = newGame();
    s.activePlayer = 'corp';
    s.phase = 'corp_turn';
    const off = createCardInstance(s, OFFWORLD);
    s.corp.hq.push(off);
    revealInHand(s, 'corp', [...s.corp.hq]);
    const before = knownInHand(s, 'corp').map(e => e.id);
    s = scoreForTest(s, LET_THEM_DREAM);
    s = choose(s, 'hq');
    s = pick(s, [off.instanceId]);
    expect(knownInHand(s, 'corp').map(e => e.id)).toEqual(before);
    s = choose(s, 'hq');
    expect(knownInHand(s, 'corp').map(e => e.id).sort()).toEqual([...before].sort());
  });

  // Red team finding 3, rule 4.8.3: "An ability cannot see the set-aside zone unless it specifically sets objects aside
  // or refers to set-aside objects": a second search queued behind the first does not offer the card the first found
  it.each([
    ['Malapert Data Vault', MALAPERT, OFFWORLD],
    ['Eminent Domain', null, EMINENT],
  ] as const)('a search queued behind Tucana (%s) does not offer the ice Tucana set aside', (_name, upgrade, agenda) => {
    let s = newGame();
    const pal = createCardInstance(s, PALISADE);
    s.corp.rd.push(pal);
    installCorpForTest(s, TUCANA, 'remote-score', true);
    if (upgrade) installCorpForTest(s, upgrade, 'remote-score', true);
    s.corp.credits = 10;
    s = scoreForTest(s, agenda);
    expect(source(s)?.cardCode).toBe(TUCANA);
    s = pick(s, [pal.instanceId]);
    expect(setAsideIds(s)).toEqual([pal.instanceId]);
    const second = s.pendingPrompts[0];
    expect(second.kind === 'effect_cards' && second.candidateIds).toContain(pal.instanceId); // listed when it was queued
    const answers = getLegalActions(s, 'corp').filter(a => a.type === 'RESOLVE_PROMPT');
    expect(answers.some(a => JSON.stringify(a).includes(`"${pal.instanceId}"`))).toBe(false);
    expect(() => answer(s, { kind: 'effect_cards', cardInstanceIds: [pal.instanceId] })).toThrow(/offered cards/);
  });

  it('Malapert Data Vault: an answer naming a card that has left R&D finds nothing and does not throw', () => {
    let s = newGame();
    const pal = createCardInstance(s, PALISADE);
    s.corp.rd.push(pal);
    installCorpForTest(s, MALAPERT, 'remote-score', true);
    s = scoreForTest(s, OFFWORLD);
    expect(source(s)?.cardCode).toBe(MALAPERT);
    const t = structuredClone(s);
    t.corp.rd = t.corp.rd.filter(c => c.instanceId !== pal.instanceId);
    t.corp.archives.faceUp.push(structuredClone(pal));
    const hq = t.corp.hq.length;
    const after = pick(t, [pal.instanceId]);
    expect(after.corp.hq).toHaveLength(hq);
  });

  it('Tocsin: the barrier waits set aside while the sentry is searched for, then both go to HQ', () => {
    let s = newGame();
    s.activePlayer = 'corp';
    s.phase = 'corp_turn';
    s.corp.clicks = 3;
    s.corp.credits = 5;
    const barrier = createCardInstance(s, PALISADE);
    s.corp.rd.push(barrier);
    const tocsin = giveCard(s, 'corp', TOCSIN);
    const hq = s.corp.hq.length;
    s = useAbility(s, 'corp', tocsin);
    s = pick(s, [barrier.instanceId]);
    expect(setAsideIds(s)).toEqual([barrier.instanceId]);
    expect(s.corp.hq).toHaveLength(hq - 1); // Tocsin itself was trashed from HQ
    s = pick(s, []);
    expect(inHQ(s, barrier.instanceId)).toBe(true);
    expect(knownInHand(s, 'corp').map(e => e.id)).toContain(barrier.instanceId);
    expect(s.setAside).toBeUndefined();
  });
});
