/**
 * F117 / R-93 (brief netrunner-ai/f117-deck-arrivals/design-brief.md rev 2; ruling-redteam.md): a card arriving from a
 * search is priced by its owner. Bars 2, 3, 4 (Retribution and Public Trail; the null slot), 6 (Eminent Domain fetching
 * Spin Doctor), 7 (ties), 9 (both frames on the Off the Books board) and 10's budget fallback, on boards built here (the red team's
 * Off the Books board: 12 credits and an iced empty remote, Send a Message's install preferred by 6.30).
 */
import { describe, expect, it } from 'vitest';
import { answer, installCorpForTest, installIceForTest, keepGoing, newGame, passTurn, scoreForTest } from './helpers';
import { CardInstance, GameAction, GameState, activePrompt, cardDef, createCardInstance, executeAction, findCardAnywhere } from '../src/core';
import { ALL_CARDS } from '../src/core/cards';
import { createAgent } from '../src/ai';
import { CHAIN_BUDGET, chainStats, scoreAnswer, scoreOutcome, simulate, withChainWork } from '../src/ai/prompts';
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
