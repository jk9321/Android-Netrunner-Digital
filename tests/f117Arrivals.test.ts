/**
 * F117 / R-93 (brief netrunner-ai/f117-deck-arrivals/design-brief.md rev 2; ruling-redteam.md): a card arriving from a
 * search is priced by its owner. Bars 2, 3, 4 (Retribution and Public Trail; the null slot), 6 (Eminent Domain fetching
 * Spin Doctor), 7 (ties), 9 (both frames on the Off the Books board) and 10's budget fallback, on boards built here (the red team's
 * Off the Books board: 12 credits and an iced empty remote, Send a Message's install preferred by 6.30), and the departures'
 * chance case on issue #72's saved board (Karunā's jack-out prompt, tests/fixtures/runner-issues/issue-72.json).
 */
import { describe, expect, it } from 'vitest';
import { answer, giveCard, installCorpForTest, installIceForTest, keepGoing, newGame, passTurn, scoreForTest } from './helpers';
import { CardInstance, GameAction, GameState, activePrompt, cardDef, createCardInstance, executeAction, findCardAnywhere } from '../src/core';
import { ALL_CARDS } from '../src/core/cards';
import { readFileSync } from 'node:fs';
import { createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { CHAIN_BUDGET, answerPrompt, chainStats, scoreAnswer, scoreOutcome, simulate, withChainWork } from '../src/ai/prompts';
import { evaluate, handCount, keepValue } from '../src/ai/evaluate';
import { inDecision, ownHandValue, withKnownCards } from '../src/ai/handValues';

const OFF_THE_BOOKS = '35071';
const MALAPERT = '30066';
const OFFWORLD = '30067';
const PALISADE = '30072';
const PUBLIC_TRAIL = '30057';
const RETRIBUTION = '30065';
const EMINENT = '34122';
const SPIN_DOCTOR = '30053';
const MERCIA = '35045';

const pick = (s: GameState, ids: string[]) => keepGoing(answer(s, { kind: 'effect_cards', cardInstanceIds: ids }));
const choose = (s: GameState, optionId: string) => keepGoing(answer(s, { kind: 'effect_choice', optionId }));
const resolve = (s: GameState, choice: Extract<GameAction, { type: 'RESOLVE_PROMPT' }>['choice']): GameAction => ({ type: 'RESOLVE_PROMPT', player: 'corp', promptId: activePrompt(s)!.id, choice });
const cards = (ids: string[]) => ({ kind: 'effect_cards' as const, cardInstanceIds: ids });
/** One answer's score as the Corp's prompt scorer gives it, in the decision's frame on `s`. */
const scored = (s: GameState, a: GameAction) => withChainWork(s, at => scoreAnswer(s, activePrompt(s)!, a, simulate(s, a)!, 'corp', undefined, false, at));

/** The red team's Off the Books board: its dividend's search found `code`, the install step waits; 12 credits, an iced empty remote. */
function offTheBooksInstall(code: string): { s: GameState; found: string } {
  let s = newGame();
  const id = installCorpForTest(s, OFF_THE_BOOKS, 'remote-score');
  findCardAnywhere(s, id)!.advancementCounters = 4;
  s.activePlayer = 'corp';
  s.phase = 'corp_turn';
  s.corp.clicks = 3;
  s = executeAction(s, { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: id });
  const found = createCardInstance(s, code);
  s.corp.rd.push(found);
  s.corp.servers['remote-2'] = { id: 'remote-2', name: 'Server 2', isRemote: true, ice: [], root: [] };
  installIceForTest(s, PALISADE, 'remote-2');
  s.corp.credits = 12;
  s = passTurn(s);
  s = choose(s, 'use');
  return { s: pick(s, [found.instanceId]), found: found.instanceId };
}

/** Malapert in the scoring remote, HQ of `hq` cards (Retribution among them when asked), an agenda scored there: its search waits. */
function malapertSearch(hq: number, retribution = false): GameState {
  let s = newGame();
  while (s.corp.hq.length < hq) s.corp.hq.push(s.corp.rd.shift()!);
  s.corp.hq = s.corp.hq.slice(0, hq);
  if (retribution) s.corp.hq[0] = createCardInstance(s, RETRIBUTION);
  installCorpForTest(s, MALAPERT, 'remote-score', true);
  s = scoreForTest(s, OFFWORLD);
  const p = activePrompt(s);
  if (p?.kind !== 'effect_cards' || !('source' in p) || p.source.cardCode !== MALAPERT) throw new Error('no Malapert search');
  return s;
}

const SG_AGENDAS = ALL_CARDS.filter(c => c.side_code === 'corp' && c.type_code === 'agenda' && /^300/.test(c.code));

describe('F117: a searched card priced by its owner', () => {
  it('bar 3: Off the Books installs each System Gateway agenda where the board itself prices it best (the iced remote, by 6.30 for Send a Message)', () => {
    expect(SG_AGENDAS.length).toBe(8);
    const rows: string[] = [];
    for (const agenda of SG_AGENDAS) {
      const { s } = offTheBooksInstall(agenda.code);
      const p = activePrompt(s)!;
      expect(p.kind === 'effect_choice' && 'source' in p && p.source.step).toBe('install');
      const options = p.kind === 'effect_choice' ? p.options.map(o => o.id) : [];
      expect(options).toEqual(['new', 'remote-2', 'to-hand']);
      // The board's own score of each answer (evaluate on the board after it, in the decision's frame)
      const board = inDecision(s, 'corp', () => Object.fromEntries(options.map(o => [o, evaluate(simulate(s, resolve(s, { kind: 'effect_choice', optionId: o }))!, 'corp')])));
      const best = options.reduce((a, b) => (board[b] > board[a] ? b : a));
      const a = createAgent('corp', 'normal').chooseAction(s) as GameAction & { choice?: { optionId?: string } };
      rows.push(`${agenda.title}: ${a.choice?.optionId} (board prefers ${best})`);
      expect(a.choice?.optionId, agenda.title).toBe(best);
      if (agenda.code === '30069') expect(board['remote-2'] - board['to-hand']).toBeCloseTo(6.3, 2);
    }
    // Superconducting Hub is the one agenda the board itself would rather hold (its own score, not the hand term)
    expect(rows.filter(r => r.includes(': remote-2')).length).toBe(7);
  }, 60_000);

  it('bar 2: at HQ 7 of 5, no Malapert candidate its owner prices above nothing scores below "take nothing"', () => {
    const s = malapertSearch(7);
    expect(s.corp.hq.length).toBeGreaterThan(s.corp.handSizeLimit);
    const p = activePrompt(s)!;
    const ids = p.kind === 'effect_cards' ? p.candidateIds : [];
    expect(ids.length).toBe(18);
    inDecision(s, 'corp', () => {
      const none = scored(s, resolve(s, cards([])));
      let above = 0;
      for (const id of ids) {
        const after = simulate(s, resolve(s, cards([id])))!;
        const without = { ...after, corp: { ...after.corp, hq: after.corp.hq.filter(c => c.instanceId !== id) } };
        const M = withKnownCards('corp', [id], () => ownHandValue(after, 'corp') - ownHandValue(without, 'corp'));
        if (M <= 0) continue;
        above++;
        expect(scored(s, resolve(s, cards([id]))), cardDef(findCardAnywhere(s, id)!).title).toBeGreaterThanOrEqual(none);
      }
      expect(above).toBeGreaterThan(5);
    });
  });

  it('bar 4: Retribution in HQ, Malapert fetching Public Trail (HQ 3 and 5): the staying cards are kept on the board without the arrival', () => {
    for (const hq of [3, 5]) {
      const s = malapertSearch(hq, true);
      const before = s.corp.hq;
      const p = activePrompt(s)!;
      const trail = (p.kind === 'effect_cards' ? p.candidateIds : []).find(id => findCardAnywhere(s, id)!.cardCode === PUBLIC_TRAIL)!;
      expect(trail).toBeDefined();
      const a = resolve(s, cards([trail]));
      const after = simulate(s, a)!;
      const keepBoard = { ...after, corp: { ...after.corp, hq: after.corp.hq.filter(c => c.instanceId !== trail) } };
      const staying = (b: GameState) => b.corp.hq.filter(c => before.some(x => x.instanceId === c.instanceId));
      const sum = (b: GameState, cs: CardInstance[]) => cs.reduce((n, c) => n + keepValue(b, c), 0);
      inDecision(s, 'corp', () => {
        const score = scored(s, a);
        const parts = withKnownCards('corp', [trail], () => {
          const M = ownHandValue(after, 'corp') - ownHandValue(keepBoard, 'corp');
          const C = handCount(after, 'corp', 'corp') - handCount(keepBoard, 'corp', 'corp');
          const base = evaluate(after, 'corp') + M - C - 0.5 * sum(s, before);
          return { right: base + 0.5 * sum(keepBoard, staying(keepBoard)), wrong: base + 0.5 * sum(after, staying(after)) };
        });
        expect(score).toBeCloseTo(parts.right, 9);
        // The staying cards' keep moves with Public Trail in the hand (Retribution's), the part D2 leaves to M
        expect(Math.abs(parts.wrong - parts.right), `HQ ${hq}`).toBeGreaterThan(0.1);
      });
    }
  });

  it('departures (the Mercia ruling): a card leaving the own hand is priced by its owner, its keep inside that price', () => {
    let s = newGame();
    installCorpForTest(s, MERCIA, 'remote-1', true);
    const ice = giveCard(s, 'corp', PALISADE);
    s.corp.clicks = 0;
    s = executeAction(s, { type: 'END_TURN', player: 'corp' });
    expect(activePrompt(s)).toMatchObject({ kind: 'effect_cards', source: { cardCode: MERCIA } });
    // The install's end board: Palisade on R&D (the server step answered), Mercia moved with it
    const first = simulate(s, resolve(s, cards([ice])))!;
    const end = simulate(first, resolve(first, { kind: 'effect_choice', optionId: 'rd' }))!;
    expect(end.corp.servers.rd.ice.some(c => c.instanceId === ice)).toBe(true);
    const staying = s.corp.hq.filter(c => c.instanceId !== ice);
    const sum = (b: GameState, cs: CardInstance[]) => cs.reduce((n, c) => n + keepValue(b, c), 0);
    const withIce = { ...end, corp: { ...end.corp, hq: [...end.corp.hq, findCardAnywhere(s, ice)!] } };
    const noIce = { ...s, corp: { ...s.corp, hq: staying } };
    inDecision(s, 'corp', () => {
      const got = scoreOutcome(s, end, 'corp', undefined, false, { first: end, named: new Set([ice]) });
      const owner = ownHandValue(s, 'corp') - ownHandValue(noIce, 'corp');
      const count = handCount(withIce, 'corp', 'corp') - handCount(end, 'corp', 'corp');
      const staysKeep = 0.5 * (sum(end, end.corp.hq.filter(c => staying.some(x => x.instanceId === c.instanceId))) - sum(noIce, staying));
      expect(got).toBeCloseTo(evaluate(end, 'corp') - (owner - count) + staysKeep, 9);
      // Today's term (the count's price and the card's half keep) is not what is read
      expect(Math.abs(scoreOutcome(s, end, 'corp') - got)).toBeGreaterThan(0.1);
    });
    // The null slot (the Corp's hand inside a Runner decision) keeps today's term
    inDecision(s, 'runner', () => {
      const a = resolve(s, cards([ice]));
      const chainEnd = simulate(first, answerPrompt(first, 'corp'))!;
      expect(scored(s, a)).toBe(scoreOutcome(s, chainEnd, 'corp'));
    });
  });

  it('bar 4: the null slot (a Corp prompt priced inside a Runner decision) keeps today\'s hand term to the digit', () => {
    const s = malapertSearch(5);
    const p = activePrompt(s)!;
    const ids = p.kind === 'effect_cards' ? p.candidateIds : [];
    inDecision(s, 'runner', () => {
      for (const id of ids.slice(0, 6)) {
        const a = resolve(s, cards([id]));
        expect(scored(s, a)).toBe(scoreOutcome(s, simulate(s, a)!, 'corp'));
      }
    });
  });

  it('bar 6: Eminent Domain fetching Spin Doctor scores the same whichever two cards its rez draws', () => {
    const scores: number[] = [];
    for (const shift of [0, 1, 2]) {
      let s = newGame();
      const doctor = createCardInstance(s, SPIN_DOCTOR);
      s.corp.rd.push(doctor);
      // The deck's order moved (the view's deal moved by +0, +1, +2): other cards on top
      s.corp.rd = [...s.corp.rd.slice(shift), ...s.corp.rd.slice(0, shift)];
      s = scoreForTest(s, EMINENT);
      const p = activePrompt(s)!;
      expect(p.kind === 'effect_cards' && p.candidateIds.includes(doctor.instanceId)).toBe(true);
      scores.push(inDecision(s, 'corp', () => scored(s, resolve(s, cards([doctor.instanceId])))));
    }
    expect(new Set(scores.map(x => x.toFixed(9))).size).toBe(1);
  });

  it('bar 7: a tie among a search\'s candidates is broken by card, not by the deck\'s order', () => {
    const picks: string[] = [];
    for (const reversed of [false, true]) {
      let s = newGame();
      while (s.corp.hq.length < 3) s.corp.hq.push(s.corp.rd.shift()!);
      s.corp.hq = s.corp.hq.slice(0, 3);
      // Five ice the owner prices alike at HQ 3 (and the agendas, which Malapert does not offer), in two orders
      const deck = s.corp.rd.filter(c => ['Ballista', 'Ping', 'Brân 1.0', 'Ansel 1.0', 'Funhouse'].includes(cardDef(c).title) || cardDef(c).type_code === 'agenda');
      s.corp.rd = reversed ? [...deck].reverse() : deck;
      installCorpForTest(s, MALAPERT, 'remote-score', true);
      s = scoreForTest(s, OFFWORLD);
      const a = createAgent('corp', 'normal').chooseAction(s) as GameAction & { choice?: { cardInstanceIds?: string[] } };
      picks.push((a.choice?.cardInstanceIds ?? []).map(id => findCardAnywhere(s, id)!.cardCode).join(','));
    }
    expect(picks[0]).not.toBe('');
    expect(picks[1]).toBe(picks[0]);
  });

  it('bar 9: the Off the Books board asked in the decision\'s frame and with the arrival known, either order, as a fresh board', () => {
    const { s, found } = offTheBooksInstall('30069');
    const toHand = simulate(s, resolve(s, { kind: 'effect_choice', optionId: 'to-hand' }))!;
    const fresh = () => structuredClone(toHand);
    const plain = (b: GameState) => inDecision(s, 'corp', () => [evaluate(b, 'corp'), ownHandValue(b, 'corp')]);
    const known = (b: GameState) => inDecision(s, 'corp', () => withKnownCards('corp', [found], () => [evaluate(b, 'corp'), ownHandValue(b, 'corp')]));
    const want = { plain: plain(fresh()), known: known(fresh()) };
    expect(want.plain).not.toEqual(want.known);
    const a = fresh();
    expect(plain(a)).toEqual(want.plain);
    expect(known(a)).toEqual(want.known);
    const b = fresh();
    expect(known(b)).toEqual(want.known);
    expect(plain(b)).toEqual(want.plain);
  });

  it('bar 10: past the budget a prompt is scored at one step, its set-aside card priced as held (counted, the pick still made)', () => {
    const { s: install } = offTheBooksInstall('30069');
    void install;
    // Back one step: the search itself, whose install step is the chain
    let s = newGame();
    const id = installCorpForTest(s, OFF_THE_BOOKS, 'remote-score');
    findCardAnywhere(s, id)!.advancementCounters = 4;
    s.activePlayer = 'corp';
    s.phase = 'corp_turn';
    s.corp.clicks = 3;
    s = executeAction(s, { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: id });
    s = passTurn(s);
    s = choose(s, 'use');
    const was = CHAIN_BUDGET.size;
    const capped = [...chainStats.capped.values()].reduce((n, v) => n + v, 0);
    const aside = chainStats.aside.get(`${OFF_THE_BOOKS}:one`) ?? 0;
    try {
      CHAIN_BUDGET.size = 0;
      const a = createAgent('corp', 'normal').chooseAction(s);
      expect(a.type).toBe('RESOLVE_PROMPT');
    } finally {
      CHAIN_BUDGET.size = was;
    }
    expect([...chainStats.capped.values()].reduce((n, v) => n + v, 0)).toBeGreaterThan(capped);
    expect(chainStats.aside.get(`${OFF_THE_BOOKS}:one`) ?? 0).toBeGreaterThan(aside);
  });
});

/** Issue #72's saved game before move 124: the Runner at Karunā's "jack out?" prompt, 2 net damage taken, 2 to come. */
function karunaPrompt(): GameState {
  const r = JSON.parse(readFileSync(new URL('./fixtures/runner-issues/issue-72.json', import.meta.url), 'utf8'));
  let s: GameState = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  for (let i = 0; i < 124; i++) s = executeAction(s, r.moves[i]);
  return s;
}
const stay = (s: GameState): GameAction => ({ type: 'RESOLVE_PROMPT', player: 'runner', promptId: activePrompt(s)!.id, choice: { kind: 'effect_choice', optionId: 'stay' } });
const scoredRunner = (s: GameState, a: GameAction) => withChainWork(s, at => scoreAnswer(s, activePrompt(s)!, a, simulate(s, a)!, 'runner', undefined, false, at));

describe('F117 departures by chance and the red team\'s mirrors (Runner coordinator conditions 1 and 3; departures red team 3 and 4)', () => {
  it('finding 3: a full-grip core damage answer\'s hand terms equal a net damage answer\'s for the same card', () => {
    const s = newGame();
    while (s.runner.grip.length < s.runner.handSizeLimit) s.runner.grip.push(s.runner.stack.shift()!);
    s.runner.grip = s.runner.grip.slice(0, s.runner.handSizeLimit);
    const card = s.runner.grip[0];
    const net: GameState = { ...s, runner: { ...s.runner, grip: s.runner.grip.slice(1), heap: [...s.runner.heap, card] } };
    const core: GameState = { ...net, runner: { ...net.runner, handSizeLimit: s.runner.handSizeLimit - 1 } };
    const frame = { first: net, named: new Set<string>() };
    inDecision(s, 'runner', () => {
      const terms = (after: GameState) => scoreOutcome(s, after, 'runner', undefined, false, { ...frame, first: after }) - evaluate(after, 'runner');
      expect(terms(core)).toBeCloseTo(terms(net), 9);
    });
  });

  it('finding 4: bar 4\'s Retribution pin reversed: Public Trail leaving HQ moves no staying card\'s keep (the before sum without it)', () => {
    for (const hq of [3, 5]) {
      const s = newGame();
      while (s.corp.hq.length < hq) s.corp.hq.push(s.corp.rd.shift()!);
      s.corp.hq = s.corp.hq.slice(0, hq);
      s.corp.hq[0] = createCardInstance(s, RETRIBUTION);
      const trail = createCardInstance(s, PUBLIC_TRAIL);
      s.corp.hq[1] = trail;
      // Public Trail played (named by the answer): out of HQ, into Archives
      const after: GameState = { ...s, corp: { ...s.corp, hq: s.corp.hq.filter(c => c !== trail), archives: { ...s.corp.archives, faceUp: [...s.corp.archives.faceUp, trail] } } };
      const without: GameState = { ...s, corp: { ...s.corp, hq: s.corp.hq.filter(c => c !== trail) } };
      const back: GameState = { ...after, corp: { ...after.corp, hq: [...after.corp.hq, trail] } };
      const sum = (b: GameState, cs: CardInstance[]) => cs.reduce((n, c) => n + keepValue(b, c), 0);
      inDecision(s, 'corp', () => {
        const got = scoreOutcome(s, after, 'corp', undefined, false, { first: after, named: new Set([trail.instanceId]) });
        const owner = ownHandValue(s, 'corp') - ownHandValue(without, 'corp');
        const count = handCount(back, 'corp', 'corp') - handCount(after, 'corp', 'corp');
        const right = evaluate(after, 'corp') - (owner - count) + 0.5 * (sum(after, after.corp.hq) - sum(without, without.corp.hq));
        expect(got).toBeCloseTo(right, 9);
        // The before sum with Public Trail still in HQ (54adee7's) reads Retribution's keep moving with it
        const old = evaluate(after, 'corp') - (owner - count) + 0.5 * (sum(after, after.corp.hq) - sum(s, without.corp.hq));
        expect(Math.abs(old - got), `HQ ${hq}`).toBeGreaterThan(0.1);
      });
    }
  });

  it('a chance departure is priced exactly as base prices it: the jack prompt\'s framed score is base\'s term, rng seeds +0, +1, +2', () => {
    // Ruling "Time per kind and the chance averaging" (2026-11-27 15:45Z): no averaging over the sets the damage could
    // take; base's count and half keep on the scored board (its read of the RNG's cards is R-C1's R-111)
    const base = karunaPrompt();
    expect(activePrompt(base)).toMatchObject({ side: 'runner', source: { cardCode: '30047', step: 'jack_out' } });
    const lost: string[] = [];
    for (const seed of [0, 1, 2].map(k => (base.rng.state + k) >>> 0)) {
      const s = structuredClone(base);
      s.rng.state = seed;
      const after = simulate(s, stay(s))!;
      lost.push(s.runner.grip.filter(c => !after.runner.grip.some(d => d.instanceId === c.instanceId)).map(c => c.instanceId).sort().join(','));
      inDecision(s, 'runner', () => expect(scoredRunner(s, stay(s))).toBe(scoreOutcome(s, after, 'runner')));
    }
    expect(new Set(lost).size).toBeGreaterThan(1);
  });

  it('bar 4\'s null slot, the grip: the Runner\'s prompt priced inside a Corp decision keeps today\'s hand term to the digit', () => {
    const s = karunaPrompt();
    inDecision(s, 'corp', () => {
      for (const optionId of ['jack', 'stay']) {
        const a: GameAction = { ...stay(s), choice: { kind: 'effect_choice', optionId } } as GameAction;
        expect(scoredRunner(s, a)).toBe(scoreOutcome(s, simulate(s, a)!, 'runner'));
      }
    });
  });
});
