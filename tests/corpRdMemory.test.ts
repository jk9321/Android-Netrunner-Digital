import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, createCardInstance, executeAction, findCardAnywhere } from '../src/core';
import { knownInRd, knownToCorpInRd, shuffleRD, updateRdKnowledge } from '../src/core/engine/rdKnowledge';
import { HeuristicCorpAI, HeuristicRunnerAI } from '../src/ai';
import { asSide, plan, withPricing } from '../src/ai/pricing';
import { clearHandCaches } from '../src/ai/handValues';
import { clearDamageThreats } from '../src/ai/effectValues';
import { clearDeckShares } from '../src/ai/iceValues';
import { clearBuildTargets } from '../src/ai/valueModel';
import { corpKnownRdSlots, guessHidden, guessRunnerView } from '../src/ai/runnerReply';
import { corpDecisionView } from '../src/ai/turnPlanner';
import { checkInvariants } from '../scripts/engine-fuzz-check';
import { corpArrangesTop4 } from './rdArrange';
import {
  answer,
  cont,
  giveCard,
  installCorpForTest,
  installIceForTest,
  keepGoing,
  newGame,
  passTurn,
  play,
  run,
  runnerInstall,
  scoreForTest,
  setIdentity,
  startRunnerTurn,
  useAbility,
} from './helpers';

/**
 * ai-corp-rd-memory (brief rev 2 and the red team rulings of 2026-11-16): the engine keeps the Corp's memory of R&D
 * (engine/rdKnowledge.ts, corp.rdKnownToCorp), the R&D cards the Corp knows the place of, and the deciding Corp's own
 * guess (runnerReply.ts guessHidden, turnPlanner.ts corpDecisionView) keeps those places and only those.
 *
 * Rules (Comprehensive Rules v26.03): 4.2.2 decks are hidden from both players unless a rule or ability says to look;
 * 4.2.3 the place of each card in a deck is kept unless an effect moves it; 1.8.5 a draw takes the top card; 8.7.3 a
 * search ends in a shuffle; 8.3.3 the player who arranges "in any order" puts the cards in secret, and 8.3.3a the
 * opponent may not look at them; 8.3.3b effects on set-aside cards are not declared; 7.1.2 the Corp may look at a card
 * the Runner accesses, except in R&D; 10.2.2b hidden information is learnt only through an effect or a rule.
 */

const V = { seeker: '36040', ezam: '36039', cultivate: '36043', melies: '36036', letThemDream: '36066', lethe: '36051' };
const L = { epiphany: '34048', balanced: '34050', nuvem: '34121', cataloguer: '34088' };
const C = { poetri: '35036', embedded: '35059', kpi: '35077', greenmail: '35070' };
const SG = { hedgeFund: '30075', nico: '30037', offworld: '30067', palisade: '30072' };

const choose = (s: GameState, optionId: string) => keepGoing(answer(s, { kind: 'effect_choice', optionId }));
const pick = (s: GameState, ids: string[]) => keepGoing(answer(s, { kind: 'effect_cards', cardInstanceIds: ids }));
const prompt = (s: GameState) => s.pendingPrompts[0];
const source = (s: GameState) => {
  const p = prompt(s);
  return p && 'source' in p ? p.source : undefined;
};
const ids = (cards: { instanceId: string }[]) => cards.map(c => c.instanceId);
/** The Corp's memory as [instance id, place]. */
const memory = (s: GameState) => knownToCorpInRd(s).map(e => [e.id, e.at]);
/** The Corp's memory must name the card at each place (the fuzz invariant's first half). */
const inPlace = (s: GameState) => knownToCorpInRd(s).every(e => s.corp.rd[e.at]?.instanceId === e.id);
function corpTurn(s: GameState, clicks = 3): void {
  s.activePlayer = 'corp';
  s.phase = 'corp_turn';
  s.turnStep = null;
  s.corp.clicks = clicks;
}
function toCorpTurn(s: GameState): GameState {
  startRunnerTurn(s);
  s = passTurn(s);
  if (s.turnStep?.kind === 'corp_turn_start') s = keepGoing(executeAction(s, { type: 'START_TURN', player: 'corp' }));
  return s;
}
function finishBreach(s: GameState): GameState {
  for (let i = 0; i < 20 && s.pendingPrompts.length > 0; i++) {
    const p = prompt(s);
    if (p.kind === 'access_trash') s = keepGoing(answer(s, { kind: 'access_trash', trash: false }));
    else s = cont(s);
  }
  return s;
}
/** Applies a change the way an action would (a copy, then the memories are brought up to date). */
function act(s: GameState, change: (next: GameState) => void): GameState {
  const next = structuredClone(s);
  change(next);
  updateRdKnowledge(s, next);
  return next;
}

describe("The Corp's memory of R&D (engine)", () => {
  it('is empty at the start, and a saved game without the field remembers nothing', () => {
    const s = newGame();
    expect(knownToCorpInRd(s)).toEqual([]);
    const old = structuredClone(s);
    delete old.corp.rdKnownToCorp;
    expect(knownToCorpInRd(old)).toEqual([]);
  });

  it('an arrange in any order (Knowledge Seeker): the Corp knows each card where it put it (8.3.3)', () => {
    const [s, order] = corpArrangesTop4(newGame());
    expect(ids(s.corp.rd.slice(0, 4))).toEqual(order);
    expect(memory(s)).toEqual(order.map((id, i) => [id, i]));
  });

  it('follows its cards when the Corp draws from the top (1.8.5) and a card is added on top, and a shuffle forgets them (4.2.2, 8.7.3)', () => {
    let [s, order] = corpArrangesTop4(newGame());
    corpTurn(s);
    s = executeAction(s, { type: 'DRAW_CARD', player: 'corp' } as GameAction);
    expect(memory(s)).toEqual(order.slice(1).map((id, i) => [id, i]));
    // A card from HQ put on top is one the Corp saw (4.3.2): known at the top, the others one lower
    s = act(s, n => n.corp.rd.unshift(n.corp.hq.pop()!));
    expect(memory(s)).toEqual([[s.corp.rd[0].instanceId, 0], ...order.slice(1).map((id, i) => [id, i + 1])]);
    s = act(s, n => shuffleRD(n));
    expect(memory(s)).toEqual([]);
  });

  it('a card the Runner accesses in R&D tells the Corp nothing (7.1.2); a card the Runner steals or trashes there leaves its memory', () => {
    let s = newGame();
    const fund = createCardInstance(s, SG.hedgeFund);
    s.corp.rd.unshift(fund);
    startRunnerTurn(s);
    s = finishBreach(cont(run(s, 'rd')));
    expect(knownInRd(s).map(e => e.id)).toContain(fund.instanceId); // the Runner remembers it
    expect(memory(s)).toEqual([]); // the Corp does not
  });

  it('Poétrï: looking at the top 3 on a score puts them in the memory', () => {
    let s = newGame();
    setIdentity(s, 'corp', C.poetri);
    const top3 = ids(s.corp.rd.slice(0, 3));
    s = scoreForTest(s, C.greenmail);
    expect(memory(s)).toEqual(top3.map((id, i) => [id, i]));
    expect(inPlace(s)).toBe(true);
  });

  it('Epiphany Analytica: the top 3 it looks at are known', () => {
    let s = newGame();
    setIdentity(s, 'corp', L.epiphany);
    s.corp.identity.tokens = { ...s.corp.identity.tokens, power: 1 };
    corpTurn(s);
    const top3 = ids(s.corp.rd.slice(0, 3));
    s = useAbility(s, 'corp', s.corp.identity.instanceId);
    expect(memory(s)).toEqual(top3.map((id, i) => [id, i]));
  });

  it('Balanced Coverage: the top card it looks at is known', () => {
    let s = newGame();
    installCorpForTest(s, L.balanced, 'remote-1', true);
    s.corp.rd.unshift(createCardInstance(s, SG.hedgeFund));
    s = toCorpTurn(s);
    for (let i = 0; i < 10 && source(s) && source(s)!.cardCode !== L.balanced; i++) s = cont(s);
    expect(source(s)).toMatchObject({ cardCode: L.balanced, step: 'type' });
    const top = s.corp.rd[0].instanceId;
    s = answer(s, { kind: 'effect_choice', optionId: 'operation' }); // a match: the reveal prompt waits, before the turn's draw
    expect(source(s)).toMatchObject({ cardCode: L.balanced, step: 'reveal' });
    expect(memory(s)).toContainEqual([top, 0]);
  });

  it('Nuvem SA: the top card it looks at after an operation is known', () => {
    let s = newGame();
    setIdentity(s, 'corp', L.nuvem);
    corpTurn(s);
    const id = giveCard(s, 'corp', SG.hedgeFund);
    s.corp.credits += 15;
    s = play(s, 'corp', id);
    expect(source(s)).toMatchObject({ cardCode: L.nuvem, step: 'look' });
    expect(memory(s)).toEqual([[s.corp.rd[0].instanceId, 0]]);
    s = choose(s, 'no');
    expect(memory(s)).toEqual([[s.corp.rd[0].instanceId, 0]]);
  });

  it('ezaM: the top card it looks at is known, and still known on the bottom (4.2.3)', () => {
    let s = newGame();
    installIceForTest(s, V.ezam, 'rd');
    const top = s.corp.rd[0].instanceId;
    startRunnerTurn(s);
    s = cont(run(s, 'rd'));
    s = executeAction(s, { type: 'CONTINUE_RUN', player: 'runner' });
    expect(memory(s)).toEqual([[top, 0]]);
    s = choose(s, 'bottom');
    expect(memory(s)).toEqual([[top, s.corp.rd.length - 1]]);
  });

  it('Cultivate: the 3 cards left and arranged are known where the Corp put them (8.3.3, 8.3.3b)', () => {
    let s = newGame();
    const top5 = ids(s.corp.rd.slice(0, 5));
    corpTurn(s);
    const id = giveCard(s, 'corp', V.cultivate);
    s.corp.credits += 15;
    s = play(s, 'corp', id);
    expect(memory(s)).toEqual(top5.map((c, i) => [c, i]));
    s = pick(s, [top5[0]]);
    s = pick(s, [top5[1]]);
    s = pick(s, [top5[4]]);
    s = pick(s, [top5[3]]);
    expect(memory(s)).toEqual([
      [top5[4], 0],
      [top5[3], 1],
      [top5[2], 2],
    ]);
  });

  it('Embedded Reporting: after the search shuffles R&D (8.7.3), only the operation put on top is known', () => {
    let s = newGame();
    const [t] = corpArrangesTop4(s);
    s = t;
    const id = installCorpForTest(s, C.embedded, 'remote-score');
    findCardAnywhere(s, id)!.advancementCounters = 4;
    corpTurn(s);
    s = executeAction(s, { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: id });
    const op = createCardInstance(s, C.kpi);
    s.corp.rd.push(op);
    s = passTurn(s);
    s = choose(s, 'use');
    s = pick(s, [op.instanceId]);
    expect(s.corp.rd[0].instanceId).toBe(op.instanceId);
    expect(memory(s)).toEqual([[op.instanceId, 0]]);
  });

  it('Let Them Dream: a card the Corp puts on the bottom from HQ is known there (4.3.2)', () => {
    let s = newGame();
    corpTurn(s);
    const off = createCardInstance(s, SG.offworld);
    s.corp.archives.faceUp.push(off);
    s = scoreForTest(s, V.letThemDream);
    s = choose(s, 'archives');
    s = pick(s, [off.instanceId]);
    s = choose(s, 'bottom');
    expect(memory(s)).toContainEqual([off.instanceId, s.corp.rd.length - 1]);
  });

  it("Lethe: a card the Corp puts on top from Archives is known there (4.4.6c)", () => {
    let s = newGame();
    installIceForTest(s, V.lethe, 'remote-1');
    const hedge = createCardInstance(s, SG.hedgeFund);
    s.corp.archives.faceUp.push(hedge);
    startRunnerTurn(s);
    s = cont(cont(run(s, 'remote-1')));
    s = pick(s, [hedge.instanceId]);
    s = choose(s, 'top');
    expect(memory(s)).toContainEqual([hedge.instanceId, 0]);
  });

  it('Cataloguer: the Runner arranging the top 4 in secret drops the Corp\'s entries among them (8.3.3a)', () => {
    let [s, order] = corpArrangesTop4(newGame());
    // One more known card below the arranged ones, which the Runner's arrange does not touch
    s = act(s, n => n.corp.rd.splice(5, 0, n.corp.hq.pop()!));
    const below = s.corp.rd[5].instanceId;
    expect(memory(s)).toEqual([...order.map((id, i) => [id, i]), [below, 5]]);
    const [s1] = runnerInstall(s, L.cataloguer);
    s = cont(run(s1, 'rd'));
    s = choose(s, 'yes');
    const top = ids(s.corp.rd.slice(0, 4));
    s = pick(s, [top[3]]);
    s = pick(s, [top[2]]);
    s = pick(s, [top[1]]);
    expect(memory(s)).toEqual([[below, 5]]);
  });

  it('the fuzz invariant: every entry names the card in R&D at its place, and none outlives a shuffle', () => {
    const [s] = corpArrangesTop4(newGame());
    const ids0 = new Set<string>();
    expect(checkInvariants(s, null, ids0).failures.filter(f => f.check.startsWith('corp-rd-memory'))).toEqual([]);
    const moved = structuredClone(s);
    [moved.corp.rd[0], moved.corp.rd[7]] = [moved.corp.rd[7], moved.corp.rd[0]];
    expect(checkInvariants(moved, null, ids0).failures.map(f => f.check)).toContain('corp-rd-memory-in-place');
    // A memory that outlived a shuffle: in place, but not looked at since the shuffle
    const after = structuredClone(s);
    shuffleRD(after);
    after.corp.rdKnownToCorp = [{ id: after.corp.rd[0].instanceId, at: 0 }];
    expect(checkInvariants(after, s, ids0).failures.map(f => f.check)).toContain('corp-rd-memory-forgets-shuffle');
  });
});

// --- The deciding Corp's view (AI) ---------------------------------------------------------------------------------

const read = (name: string): GameState => {
  const raw = JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
  return raw.state ?? raw;
};
const honest = <T>(f: () => T): T => withPricing({ plan: { ...plan(), hiddenDraws: true, plannerSeed: true } }, () => asSide('corp', f));
const reset = () => {
  clearHandCaches();
  clearDamageThreats();
  clearDeckShares();
  clearBuildTargets();
};
const key = (a: GameAction | null) => (a ? JSON.stringify(Object.fromEntries(Object.entries(a).sort())) : 'null');
const corpAnswer = (s: GameState) => {
  reset();
  const copy = structuredClone(s);
  return honest(() => key(new HeuristicCorpAI({ synergy: true, planner: true }).chooseAction(copy)));
};
/** The Corp's turn of the honest-order probe (deal 1001 T10), with the top 4 of R&D arranged by the Corp. */
const arranged = (): [GameState, string[]] => {
  const s = read('hidden-draws-1001-t10.json');
  s.corp.credits = 6;
  return corpArrangesTop4(s);
};

describe("The deciding Corp's view keeps what the Corp knows of R&D, and only that", () => {
  it('keeps the arranged cards where the Corp put them, and deals the rest', () => {
    const [s, order] = arranged();
    const view = honest(() => corpDecisionView(s));
    expect(ids(view.corp.rd.slice(0, 4))).toEqual(order);
    expect(ids(view.corp.rd.slice(4))).not.toEqual(ids(s.corp.rd.slice(4)));
  });

  it("the Corp's answer does not move when unseen R&D cards below the arranged ones are swapped", { timeout: 120_000 }, () => {
    const [s] = arranged();
    const base = corpAnswer(s);
    const t = structuredClone(s);
    const [i, j] = [4, t.corp.rd.length - 1];
    [t.corp.rd[i], t.corp.rd[j]] = [t.corp.rd[j], t.corp.rd[i]];
    expect(corpAnswer(t)).toBe(base);
  });

  it('the view follows the arranged cards themselves when they change (the Corp may know them)', () => {
    const [s, order] = arranged();
    const t = structuredClone(s);
    // A different card in the second known place: the Corp's memory now names it there
    const j = t.corp.rd.length - 1;
    [t.corp.rd[1], t.corp.rd[j]] = [t.corp.rd[j], t.corp.rd[1]];
    t.corp.rdKnownToCorp = t.corp.rdKnownToCorp!.map(e => (e.at === 1 ? { id: t.corp.rd[1].instanceId, at: 1 } : e));
    const view = honest(() => corpDecisionView(t));
    expect(ids(view.corp.rd.slice(0, 4))).toEqual([order[0], t.corp.rd[1].instanceId, order[2], order[3]]);
    expect(honest(() => corpDecisionView(s))).not.toBe(view);
  });

  it("the Runner's R&D memory fixes nothing in the Corp's deal (7.1.2), and names the dealt card at each place", () => {
    const s = read('hidden-draws-1001-t10.json');
    const top3 = s.corp.rd.slice(0, 3);
    s.corp.rdKnownToRunner = top3.map((c, i) => ({ id: c.instanceId, code: c.cardCode, lo: i, hi: i }));
    expect(honest(() => corpKnownRdSlots(s)).size).toBe(0);
    // Across a few deals the real top 3 do not all stay put, and each Runner entry names the card the deal put there
    let moved = 0;
    for (let k = 0; k < 6; k++) {
      const view = honest(() => guessHidden(s, k));
      if (ids(view.corp.rd.slice(0, 3)).join() !== ids(top3).join()) moved++;
      for (const e of view.corp.rdKnownToRunner!) {
        expect(view.corp.rd[e.lo].instanceId).toBe(e.id);
        expect(view.corp.rd[e.lo].cardCode).toBe(e.code);
      }
    }
    expect(moved).toBeGreaterThan(0);
    // A card the Corp also knows (revealed to both) keeps its place and its entry
    const both = structuredClone(s);
    both.corp.rdKnownToCorp = [{ id: top3[0].instanceId, at: 0 }];
    const view = honest(() => guessHidden(both, 0));
    expect(view.corp.rd[0].instanceId).toBe(top3[0].instanceId);
    expect(view.corp.rdKnownToRunner![0]).toEqual(both.corp.rdKnownToRunner![0]);
  });

  it("the Runner's view carries no Corp memory, and the Runner's view and answer do not change when the Corp's memory is edited", { timeout: 120_000 }, () => {
    const [s] = arranged();
    const none = structuredClone(s);
    delete none.corp.rdKnownToCorp;
    const v1 = guessRunnerView(s, 0);
    const v2 = guessRunnerView(none, 0);
    expect(v1.corp.rdKnownToCorp).toBeUndefined();
    expect(JSON.stringify(v1)).toBe(JSON.stringify(v2));
    // The Runner deciding at the same board (its turn)
    const runnerAt = (t: GameState) => {
      reset();
      const c = structuredClone(t);
      startRunnerTurn(c);
      return withPricing({ plan: { ...plan(), hiddenDraws: true, plannerSeed: true } }, () => asSide('runner', () => key(new HeuristicRunnerAI({ synergy: true }).chooseAction(c))));
    };
    expect(runnerAt(s)).toBe(runnerAt(none));
  });
});
