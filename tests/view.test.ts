import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, GameView, SideCode, StopLevel, ViewIds, actingSide, addLog, createCardInstance, createInitialGameState, executeAction, getLegalActions, newViewIds, toEngineAction, fromEngineAction, viewFor, IllegalActionError } from '../src/core';
import { GAME_STATE_FIELDS } from '../src/core/view';
import { deckGameSetup } from '../src/data/decks';
import { answer, cont, installCorpForTest, keepGoing, newGame, newGameAtSetup, run, setIdentity, startRunnerTurn, step } from './helpers';
import { LeakChecker } from '../scripts/leak-check';

// Per-player views (multiplayer phase 1): one scenario per row of the visibility table in
// /mnt/project-files/netrunner-multiplayer/phase1/spec.md. Rules: Comprehensive Rules v26.03.

const HEDGE_FUND = '30075';
const OFFWORLD = '30067'; // agenda
const ADRIAN = '34046'; // Adrian Seis: Psi Game on access
const MELIES = '36036';
const NICO = '30037'; // Nico Campaign: an asset with a trash cost
const MANEGARM = '30042'; // Manegarm Skunkworks: an upgrade
const REGOLITH = '30071'; // Regolith Mining License: an asset, rezzed in the tests

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

  it('never carries the game seed, at the start or after moves (chunk 2f: the seed predicts every shuffle, 1.12 / 4.2.2)', () => {
    const SEED = 987654321;
    let s = newGameAtSetup(SEED);
    expect(s.log[0].message).toBe('Game started. Both players may mulligan, then the Corp takes the first turn.');
    const ids: Record<SideCode, ViewIds> = { corp: newViewIds(), runner: newViewIds() };
    let x = 1;
    for (let step = 0; step < 150 && !s.winner; step++) {
      for (const side of ['corp', 'runner'] as SideCode[]) {
        const v = viewFor(s, side, ids[side], 'g');
        ids[side] = v.ids;
        expect(JSON.stringify(v.view), `${side} at step ${step}`).not.toContain(String(SEED));
      }
      const side = actingSide(s);
      if (!side) break;
      const legal = getLegalActions(s, side).filter(a => a.type !== 'CONCEDE');
      if (legal.length === 0) break;
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      s = executeAction(s, legal[(x >>> 8) % legal.length]);
    }
    expect(s.log.length).toBeGreaterThan(20); // the game moved on
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

  it('a Runner accessing a trashable card in R&D: the Corp sees no prompt and no card (4.2.2, 7.1.2)', () => {
    let s = newGame();
    s.corp.rd.unshift(createCardInstance(s, NICO));
    s.runner.credits = 10;
    s = cont(run(s, 'rd'));
    const p = s.pendingPrompts[0];
    expect(p?.kind).toBe('access_trash');
    const v = views(s);
    expect(v.corp.pendingPrompts).toEqual([]);
    // The Corp sees only that the game waits on the Runner. At these (AI) stops only cards with a decision pause, the
    // tell Jeff accepted below 'full' (2026-11-08); at 'full' every R&D card pauses (the next two tests)
    expect(v.corp.waitingOn).toBe('runner');
    expect(json(v.corp)).not.toContain('access_trash');
    expect(json(v.corp)).not.toContain(`"${NICO}"`);
    const mine = v.runner.pendingPrompts[0];
    expect(mine.kind).toBe('access_trash');
    expect(mine.cards.map(c => c.cardCode)).toEqual([NICO]);
  });

  /** The Corp's views, one per action, of a run on R&D with `top` on top: passing, continuing, declining to trash. */
  function corpViewsOfRdRun(top: string, runnerStops: StopLevel): string[] {
    let s = newGame();
    s.stops = { corp: 'ai', runner: runnerStops };
    s.corp.rd.unshift(createCardInstance(s, top));
    startRunnerTurn(s);
    s.runner.credits = 10;
    let ids = newViewIds();
    const out: string[] = [];
    const see = () => {
      const v = viewFor(s, 'corp', ids, 'g');
      ids = v.ids;
      out.push(JSON.stringify(v.view));
    };
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'rd' });
    see();
    for (let i = 0; i < 40 && s.activeRun; i++) {
      const side = actingSide(s)!;
      const legal = getLegalActions(s, side);
      const action = legal.find(a => a.type === 'RESOLVE_PROMPT' && a.choice.kind === 'access_trash' && !a.choice.trash && !a.choice.alternativeId) ?? legal.find(a => (a.type === 'PASS' && !a.restOfRun) || a.type === 'CONTINUE_RUN');
      s = executeAction(s, action!);
      see();
    }
    return out;
  }

  it('Runner stops at full: the Corp\'s views of an R&D access are the same for an operation and a trashable asset, before and after the Runner answers (4.2.2, 7.1.2)', () => {
    const hedge = corpViewsOfRdRun(HEDGE_FUND, 'full');
    const nico = corpViewsOfRdRun(NICO, 'full');
    expect(nico).toEqual(hedge);
    // The access did wait on the Runner (one view with the run still on and the Runner to act)
    expect(hedge.some(v => JSON.parse(v).waitingOn === 'runner' && JSON.parse(v).activeRun?.accessedCount === 1)).toBe(true);
  });

  it('Runner stops at auto: the views differ (only the trashable card pauses), a tell Jeff accepted for AUTO (2026-11-08)', () => {
    expect(corpViewsOfRdRun(NICO, 'auto')).not.toEqual(corpViewsOfRdRun(HEDGE_FUND, 'auto'));
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

  it('a flag naming a card is kept only for a viewer who sees that card\'s face (4.6.3)', () => {
    const s = newGame();
    const facedown = installCorpForTest(s, NICO, 'remote-1');
    const rezzed = installCorpForTest(s, NICO, 'remote-2', true);
    s.turnFlags[`once:${facedown}`] = 1;
    s.turnFlags[`once:${rezzed}`] = 1;
    s.turnFlags[`once:${s.corp.rd[0].instanceId}`] = 1;
    const { corp, runner, ids } = views(s);
    expect(Object.keys(corp.turnFlags).sort()).toEqual([`once:${ids.corp.view[facedown]}`, `once:${ids.corp.view[rezzed]}`].sort());
    // The Runner sees where the facedown card is (it has an id) but not what it is: no flag for it
    expect(ids.runner.view[facedown]).toBeDefined();
    expect(Object.keys(runner.turnFlags)).toEqual([`once:${ids.runner.view[rezzed]}`]);
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
  // Chunk 2g. 10.2.2a: "HIDDEN INFORMATION is any information ... unavailable to one or more players. This includes
  // facedown cards in play"; 10.2.2b: "A player cannot learn hidden information without the aid of a game effect, rule,
  // or another player"; 8.5.3a: "The Runner should not be able to tell what type of card is installed in the root of a
  // remote server". 7.3.4: the Runner chooses which candidate to access next, so the choice comes before the access.
  describe('a prompt shows the face only of cards the viewer may see (chunk 2g)', () => {
    /** Runs on remote-1 and stops at the Runner's access_order prompt. */
    const toAccessOrder = (s: GameState): GameState => {
      startRunnerTurn(s);
      s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote-1' });
      for (let i = 0; i < 20 && s.pendingPrompts[0]?.kind !== 'access_order'; i++) s = step(s);
      expect(s.pendingPrompts[0]?.kind).toBe('access_order');
      return s;
    };

    it('access_order: unrezzed root cards are facedown in the Runner\'s prompt, a rezzed one is shown; the Corp\'s view is unchanged', () => {
      let s = newGame();
      s.corp.hq.splice(0);
      const a = installCorpForTest(s, NICO, 'remote-1');
      const b = installCorpForTest(s, MANEGARM, 'remote-1');
      const up = installCorpForTest(s, REGOLITH, 'remote-1', true);
      s = toAccessOrder(s);
      const { runner, corp, ids } = views(s);
      const p = runner.pendingPrompts[0];
      expect(p.kind).toBe('access_order');
      const byId = new Map(p.cards.map(c => [ids.runner.real[c.instanceId], c]));
      expect(byId.get(a)?.cardCode).toBeUndefined();
      expect(byId.get(b)?.cardCode).toBeUndefined();
      expect(byId.get(up)?.cardCode).toBe(REGOLITH);
      // The facedown cards keep their table ids, so the screen can still point at them and the options stay answerable
      expect(byId.get(a)?.instanceId).toBe(ids.runner.view[a]);
      expect(p.options?.map(o => o.id)).toContain(`root:${ids.runner.view[a]}`);
      const text = json(runner);
      for (const code of [NICO, MANEGARM]) expect(text).not.toContain(`"${code}"`);
      expect(text).not.toContain('Nico Campaign');
      expect(text).not.toContain('Manegarm Skunkworks');
      // The Corp is not asked; its view shows its own cards as before
      expect(corp.pendingPrompts).toEqual([]);
      expect(corp.corp.servers['remote-1'].root.map(c => c.cardCode)).toEqual([NICO, MANEGARM, REGOLITH]);
      // The leak checker now catches this class (its prompt exemption is narrowed)
      const checker = new LeakChecker(9001);
      checker.check(s, 0);
      expect(checker.failures).toEqual([]);
    });

    it('effect_cards: a facedown installed candidate is facedown to the Runner (Hermes, Chain Reaction, Tāo Salonga)', () => {
      const s = newGame();
      const down = installCorpForTest(s, NICO, 'remote-1');
      const up = installCorpForTest(s, NICO, 'remote-2', true);
      s.pendingPrompts.push({ id: 'prompt-x', kind: 'effect_cards', side: 'runner', message: 'Choose', candidateIds: [down, up], min: 1, max: 1, source: { cardCode: HEDGE_FUND, instanceId: '', step: 'x' } });
      const { runner, ids } = views(s);
      const cards = runner.pendingPrompts[0].cards;
      expect(cards.find(c => ids.runner.real[c.instanceId] === down)?.cardCode).toBeUndefined();
      expect(cards.find(c => ids.runner.real[c.instanceId] === up)?.cardCode).toBe(NICO);
      expect(runner.pendingPrompts[0].candidateIds).toEqual([ids.runner.view[down], ids.runner.view[up]]);
    });

    it('replay pin: round 3 play test game 2, the access_order prompt before move #100 names no facedown card', () => {
      const r = JSON.parse(readFileSync(new URL('./fixtures/access-order-r3g2-100.json', import.meta.url), 'utf8'));
      let s: GameState = { ...createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck)), stops: r.startStops };
      for (const m of r.moves) s = executeAction(s, m);
      expect(s.pendingPrompts[0]?.kind).toBe('access_order');
      const root = s.corp.servers['remote-1'].root;
      const facedown = root.filter(c => !c.isRezzed && !c.faceUp && !c.runnerKnows);
      expect(facedown.length).toBeGreaterThan(0);
      const { runner, ids } = views(s);
      for (const c of runner.pendingPrompts[0].cards) {
        const real = root.find(x => x.instanceId === ids.runner.real[c.instanceId]);
        expect(real).toBeDefined();
        if (facedown.includes(real!)) expect(c.cardCode).toBeUndefined();
        else expect(c.cardCode).toBe(real!.cardCode);
      }
      // The facedown card is a second Project Ingatan; the stolen copy in the Runner's score area may show its code
      const prompt = JSON.stringify(runner.pendingPrompts);
      for (const c of facedown) expect(prompt).not.toContain(`"${c.cardCode}"`);
      const checker = new LeakChecker(9001);
      checker.check(s, 0);
      expect(checker.failures).toEqual([]);
    });
  });
});
