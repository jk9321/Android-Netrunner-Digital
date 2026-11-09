import { describe, expect, it } from 'vitest';
import { GameState, GameView, SideCode, ViewIds, addLog, createCardInstance, executeAction, newViewIds, toEngineAction, fromEngineAction, viewFor, IllegalActionError } from '../src/core';
import { GAME_STATE_FIELDS } from '../src/core/view';
import { answer, cont, installCorpForTest, keepGoing, newGame, run, setIdentity } from './helpers';
import { LeakChecker } from '../scripts/leak-check';

// Per-player views (multiplayer phase 1): one scenario per row of the visibility table in
// /mnt/project-files/netrunner-multiplayer/phase1/spec.md. Rules: Comprehensive Rules v26.03.

const HEDGE_FUND = '30075';
const OFFWORLD = '30067'; // agenda
const ADRIAN = '34046'; // Adrian Seis: Psi Game on access
const MELIES = '36036';
const NICO = '30037'; // Nico Campaign: an asset with a trash cost

/** Both sides' views of a state, with fresh id maps unless given. */
function views(s: GameState, ids?: Record<SideCode, ViewIds>) {
  const corp = viewFor(s, 'corp', ids?.corp ?? newViewIds(), 'g');
  const runner = viewFor(s, 'runner', ids?.runner ?? newViewIds(), 'g');
  return { corp: corp.view, runner: runner.view, ids: { corp: corp.ids, runner: runner.ids } };
}
const json = (v: GameView) => JSON.stringify(v);
const choose = (s: GameState, optionId: string) => keepGoing(answer(s, { kind: 'effect_choice', optionId }));

describe('Per-player views', () => {
  it('drops engine internals and replaces the game id (the seed predicts every shuffle)', () => {
    const s = newGame(7);
    const { corp, runner } = views(s);
    for (const v of [corp, runner]) {
      expect(v.id).toBe('g');
      expect(json(v)).not.toMatch(/inst-|"rng"|"seed"|nextInstanceId|nextPromptId|game-7/);
    }
    expect(Object.entries(GAME_STATE_FIELDS).filter(([, vis]) => vis === 'dropped').map(([k]) => k)).toEqual(
      expect.arrayContaining(['rng', 'nextInstanceId', 'nextPromptId']),
    );
    expect(s.id).toBe('game-7'); // the state itself is untouched
  });

  it('R&D and the stack are a count for both sides (4.2.2, 4.2.4)', () => {
    const s = newGame();
    const { corp, runner } = views(s);
    expect(corp.corp.rd).toEqual({ count: s.corp.rd.length });
    expect(runner.corp.rd).toEqual({ count: s.corp.rd.length });
    expect(runner.runner.stack).toEqual({ count: s.runner.stack.length });
    expect(corp.runner.stack).toEqual({ count: s.runner.stack.length });
  });

  it('HQ and the grip: the owner sees every card, the opponent the count and the cards it knows (4.3.2, 4.3.4)', () => {
    const s = newGame();
    s.corp.knownToRunner = [{ id: s.corp.hq[0].instanceId, code: s.corp.hq[0].cardCode }];
    const { corp, runner } = views(s);
    expect(corp.corp.hq.cards.map(c => c.cardCode)).toEqual(s.corp.hq.map(c => c.cardCode));
    expect(runner.corp.hq).toEqual({ count: s.corp.hq.length, cards: [], known: [s.corp.hq[0].cardCode] });
    expect(runner.runner.grip.cards).toHaveLength(s.runner.grip.length);
    expect(corp.runner.grip.cards).toEqual([]);
    expect(corp.runner.grip.count).toBe(s.runner.grip.length);
    // Known cards are names only: no id that could follow the card out of the hand
    expect(json(runner)).not.toContain(s.corp.hq[0].instanceId);
  });

  it('Archives: faceup cards are open, facedown cards only the Corp sees (4.4.6c)', () => {
    const s = newGame();
    const up = createCardInstance(s, HEDGE_FUND);
    const down = createCardInstance(s, OFFWORLD);
    s.corp.archives.faceUp.push(up);
    s.corp.archives.faceDown.push(down);
    const { corp, runner } = views(s);
    expect(runner.corp.archives.faceUp.map(c => c.cardCode)).toEqual([HEDGE_FUND]);
    expect(runner.corp.archives.faceDown).toEqual({ count: 1, cards: [] });
    expect(corp.corp.archives.faceDown.cards.map(c => c.cardCode)).toEqual([OFFWORLD]);
  });

  it('an unrezzed card shows the Runner its position and counters only; access makes it known (4.6.2, 1.12.5)', () => {
    const s = newGame();
    s.corp.hq.splice(0);
    installCorpForTest(s, OFFWORLD, 'remote-1');
    s.corp.servers['remote-1'].root[0].advancementCounters = 2;
    let v = views(s);
    const seen = v.runner.corp.servers['remote-1'].root[0];
    expect(seen.cardCode).toBeUndefined();
    expect(seen.advancementCounters).toBe(2);
    expect(json(v.runner)).not.toContain(`"${OFFWORLD}"`);
    expect(v.corp.corp.servers['remote-1'].root[0].cardCode).toBe(OFFWORLD);
    // Turned up by an access in place, it stays known while installed
    s.corp.servers['remote-1'].root[0].runnerKnows = true;
    v = views(s, v.ids);
    expect(v.runner.corp.servers['remote-1'].root[0]).toMatchObject({ instanceId: seen.instanceId, cardCode: OFFWORLD, runnerKnows: true });
  });

  it('a card shuffled back into R&D comes back with a new id (1.12.3); one moved in the open keeps its id (1.12.4)', () => {
    const s = newGame();
    const card = createCardInstance(s, HEDGE_FUND);
    s.corp.archives.faceUp.push(card);
    const first = views(s);
    const before = first.runner.corp.archives.faceUp[0].instanceId;
    // Moved within open places: same id
    s.corp.archives.faceUp.pop();
    s.corp.scoreArea.push(card);
    const moved = views(s, first.ids);
    expect(moved.runner.corp.scoreArea[0].instanceId).toBe(before);
    // Into R&D (out of sight), then back out: a new object
    s.corp.scoreArea.pop();
    s.corp.rd.unshift(card);
    const hidden = views(s, moved.ids);
    expect(hidden.ids.runner.view[card.instanceId]).toBeUndefined();
    s.corp.rd.shift();
    s.corp.archives.faceUp.push(card);
    const back = views(s, hidden.ids);
    expect(back.runner.corp.archives.faceUp[0].instanceId).not.toBe(before);
  });

  it('the two sides get different ids, and a viewer id outside the map makes an action illegal', () => {
    const s = newGame();
    const { corp, runner, ids } = views(s);
    expect(corp.corp.identity.instanceId).toMatch(/^c\d+$/);
    expect(runner.corp.identity.instanceId).toMatch(/^r\d+$/);
    const card = s.corp.hq[0];
    const action = { type: 'PLAY_OPERATION_OR_EVENT' as const, player: 'corp' as const, cardInstanceId: card.instanceId };
    const mine = fromEngineAction(action, ids.corp)!;
    expect(mine.type === 'PLAY_OPERATION_OR_EVENT' && mine.cardInstanceId).toMatch(/^c\d+$/);
    expect(toEngineAction(mine, ids.corp)).toEqual(action);
    // The Runner has no id for a card in HQ
    expect(fromEngineAction(action, ids.runner)).toBeNull();
    expect(() => toEngineAction({ ...action, cardInstanceId: 'c999' }, ids.corp)).toThrow(IllegalActionError);
  });

  it('Méliès U: the side set in secret reaches the Runner only once the identity flips (1.5.2b)', () => {
    const s = newGame();
    setIdentity(s, 'corp', MELIES);
    s.corp.meliesServer = 'rd';
    s.corp.identity.flipped = false;
    let v = views(s);
    expect(v.corp.corp.meliesServer).toBe('rd');
    expect(v.runner.corp.meliesServer).toBeUndefined();
    s.corp.identity.flipped = true;
    v = views(s);
    expect(v.runner.corp.meliesServer).toBe('rd');
  });

  it('a Psi Game: the Runner never sees the Corp\'s bid, the Corp gets no prompt entry, only who the game waits on (10.14.2)', () => {
    let s = newGame();
    s.corp.hq.splice(0);
    installCorpForTest(s, ADRIAN, 'remote-1', true);
    installCorpForTest(s, OFFWORLD, 'remote-1');
    s = cont(run(s, 'remote-1'));
    expect(s.pendingPrompts[0].side).toBe('corp');
    let v = views(s);
    expect(v.runner.pendingPrompts).toEqual([]);
    expect(v.runner.waitingOn).toBe('corp');
    s = choose(s, '2');
    const p = s.pendingPrompts[0];
    expect(p.side).toBe('runner');
    expect(p.kind === 'effect_choice' && p.source.data?.corpBid).toBe(2); // the engine keeps the bid
    v = views(s);
    const mine = v.runner.pendingPrompts[0];
    expect(mine.options?.map(o => o.id)).toEqual(['0', '1', '2']);
    expect(json(v.runner)).not.toContain('corpBid');
    expect(v.corp.pendingPrompts).toEqual([]);
    expect(v.corp.waitingOn).toBe('runner');
  });

  it('a Runner accessing a trashable card in R&D: the Corp sees no prompt, so it cannot tell what its top card is (4.2.2, 7.1.2)', () => {
    let s = newGame();
    s.corp.rd.unshift(createCardInstance(s, NICO));
    s.runner.credits = 10;
    s = cont(run(s, 'rd'));
    const p = s.pendingPrompts[0];
    expect(p?.kind).toBe('access_trash');
    const v = views(s);
    expect(v.corp.pendingPrompts).toEqual([]);
    expect(v.corp.waitingOn).toBe('runner');
    expect(json(v.corp)).not.toContain('access_trash');
    expect(json(v.corp)).not.toContain(`"${NICO}"`);
    const mine = v.runner.pendingPrompts[0];
    expect(mine.kind).toBe('access_trash');
    expect(mine.cards.map(c => c.cardCode)).toEqual([NICO]);
  });

  it('a secret log line: the side it is kept from gets the public wording and no card', () => {
    const s = newGame();
    addLog(s, 'runner', 'Runner accessed Hedge Fund.', HEDGE_FUND, 'access', { from: 'corp', publicMessage: 'Runner accessed a card in R&D.' });
    addLog(s, 'runner', 'Runner cannot pay to steal Offworld Office.', undefined, undefined, { from: 'corp', publicMessage: '' });
    const { corp, runner } = views(s);
    expect(runner.log.slice(-2).map(e => e.message)).toEqual(['Runner accessed Hedge Fund.', 'Runner cannot pay to steal Offworld Office.']);
    expect(runner.log.at(-2)?.cardCode).toBe(HEDGE_FUND);
    expect(corp.log.at(-1)).toMatchObject({ message: 'Runner accessed a card in R&D.', event: 'access' });
    expect(corp.log.at(-1)?.cardCode).toBeUndefined();
    expect(json(corp)).not.toContain('Offworld Office');
    expect(json(corp)).not.toContain('"secret"');
  });

  it('log ids are the viewer\'s own: a line kept from the Corp leaves no gap, and ids stay put as the log grows (4.2.2, 7.1.2)', () => {
    const s = newGame();
    const n = s.log.length;
    addLog(s, 'runner', 'Runner accessed Offworld Office.', OFFWORLD, 'access', { from: 'corp', publicMessage: 'Runner accessed a card in R&D.' });
    addLog(s, 'runner', 'Runner cannot pay to steal Offworld Office.', undefined, undefined, { from: 'corp', publicMessage: '' });
    addLog(s, 'runner', 'The run ends.');
    const first = views(s);
    expect(first.corp.log.map(e => e.id)).toEqual(Array.from({ length: n + 2 }, (_, i) => `v${i}`));
    expect(first.runner.log.map(e => e.id)).toEqual(Array.from({ length: n + 3 }, (_, i) => `v${i}`));
    expect(json(first.corp)).not.toContain('log-');
    // A later view keeps every earlier line's id
    const t = structuredClone(s);
    addLog(t, 'corp', 'Corp gained 1 [credit].');
    const later = views(t, first.ids);
    expect(later.corp.log.slice(0, -1)).toEqual(first.corp.log);
    expect(later.corp.log.at(-1)?.id).toBe(`v${n + 2}`);
  });

  it('the opponent never sees a declared intent (5.6.2a-b)', () => {
    const s = newGame();
    const card = s.corp.hq[0];
    s.priority = { step: 'corp_action', holder: 'runner', received: true, intent: { type: 'PLAY_OPERATION_OR_EVENT', player: 'corp', cardInstanceId: card.instanceId } };
    const { corp, runner } = views(s);
    expect(runner.priority).toEqual({ step: 'corp_action', holder: 'runner', received: true });
    expect(corp.priority?.intent).toMatchObject({ type: 'PLAY_OPERATION_OR_EVENT', cardInstanceId: corp.corp.hq.cards[0].instanceId });
  });

  it('viewFor is pure: the state and the id map passed in are unchanged, and the same input gives the same view', () => {
    let s = newGame(3);
    s = executeAction(s, { type: 'GAIN_CREDIT', player: 'corp' });
    const before = JSON.stringify(s);
    const ids = newViewIds();
    const a = viewFor(s, 'runner', ids, 'g');
    const b = viewFor(s, 'runner', ids, 'g');
    expect(JSON.stringify(s)).toBe(before);
    expect(ids).toEqual(newViewIds());
    expect(b).toEqual(a);
  });

  it('the leak checker catches a log line that names a hidden card', () => {
    const s = newGame();
    s.corp.hq.splice(0, s.corp.hq.length, createCardInstance(s, OFFWORLD));
    const checker = new LeakChecker(1);
    checker.check(s, 0);
    expect(checker.failures).toEqual([]);
    const t = executeAction(s, { type: 'GAIN_CREDIT', player: 'corp' });
    addLog(t, 'corp', 'Corp is holding Offworld Office.');
    checker.check(t, 1);
    expect(checker.failures.map(f => `${f.viewer} ${f.check}`)).toEqual(['runner hidden-title']);
  });
});
