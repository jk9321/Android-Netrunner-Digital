/**
 * Stage D, the counted rez asks the hold owner (branch ai-rez-set; brief
 * /mnt/project-files/netrunner-ai/stage-d/rez-follow/build-brief.md rev 2, count in count-note.md beside it, red team
 * /mnt/project-files/adversarial/2026-11-18-rez-set/findings.md). countedRez (src/ai/corp/rez.ts) reads the one stop
 * count, the 'thisRun' hold with the set further in (rezStops), in two places where it read a second one:
 *  - R2 (a root agenda): this ice with the unrezzed ice further in the Corp can still afford, not this ice alone;
 *  - the free gate (iceCreditNeed 0): it gives way only where the count needs this ice for a root agenda (countNeeds:
 *    a set with it stops the run, and none without it stops for the same cost or less).
 * And the hold walk sees the Runner's money from the rez itself (Saci, holdFacts.hostRezPays; finding 1).
 *
 * Rules (Comprehensive Rules v26.03): 6.4.3 and 6.9.2b, the Corp may rez the approached ice only in the approach-ice
 * paid ability window; 6.9.2c, ice left unrezzed is passed; 1.14.5, the controller of an ability makes its choices
 * (Ballista's "Trash 1 installed program or end the run" is the Corp's choice); 6.1.5a and 6.9.4c, the Runner may jack
 * out after passing a piece of ice; 9.2.8, a conditional ability (Saci: "Whenever host ice is rezzed or derezzed, gain
 * 3 credits.") resolves in the reaction window after its condition, so the 3 credits arrive before the encounter.
 *
 * Boards: tests/fixtures/rez-set/ (written by scripts/stage-d/rez-follow-capture.ts from the recorded games: deals 1081
 * and 1641 played by beta dbefb94's Normal agents, report-28 replayed), and the red team's boards built on
 * tests/fixtures/rez-toll.json (the Runner with Cleaver, 0 clicks, score 0-1, Offworld Office moved into the root).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CardInstance, GameAction, GameState, cardDef, createCardInstance } from '../src/core';
import { createAgent } from '../src/ai';
import { countedRez, rezStops } from '../src/ai/corp/rez';
import { serverHold } from '../src/ai/corp/hold';
import { iceCreditNeed } from '../src/ai/runs';
import { GameRunner, rezCandidates } from '../src/ai/playout';
import { corpDecisionView } from '../src/ai/turnPlanner';
import { inDecision } from './helpers/pricing';

const T = 120_000;
const fixture = (name: string): GameState => JSON.parse(readFileSync(new URL(`./fixtures/rez-set/${name}.json`, import.meta.url), 'utf8'));
const approached = (s: GameState): CardInstance => s.corp.servers[s.activeRun!.server].ice[s.activeRun!.icePosition!];
const isAgenda = (c: CardInstance) => cardDef(c).type_code === 'agenda';

/** The rez window's facts as the Corp asks them (corpAI chooseRez: the Corp's own view). */
function ask(s: GameState) {
  const v = corpDecisionView(s);
  const ice = approached(v);
  return inDecision(v, 'corp', () => ({
    counted: countedRez(v, ice),
    further: rezStops(v, ice, true),
    alone: rezStops(v, ice, false),
    need: iceCreditNeed(v, { ...ice, isRezzed: true }),
  }));
}
/** The window as the game loop asks it (playout.ts GameRunner.step): does the Corp rez the approached ice? */
function rezzes(s: GameState): boolean {
  const a = createAgent('corp', 'normal').chooseRez!(structuredClone(s), rezCandidates(s, 'approach_ice')) as (GameAction & { cardInstanceId?: string }) | null;
  return a?.type === 'REZ_CARD' && a.cardInstanceId === approached(s).instanceId;
}
/** Plays on with GameRunner (Normal against Normal) until the run is over, or (turn) until the Runner's turn is. */
function playOn(s0: GameState, turn = false) {
  const g = new GameRunner(structuredClone(s0), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  const moves: GameAction[] = [];
  for (let i = 0; i < 400 && !g.state.winner; i++) {
    if (turn ? g.state.turnNumber !== s0.turnNumber || g.state.activePlayer !== 'runner' : !g.state.activeRun) break;
    if (!g.step()) break;
    if (g.last) moves.push(g.last);
  }
  return { end: g.state, moves };
}
const rezzed = (moves: GameAction[]) => moves.filter(m => m.type === 'REZ_CARD').map(m => (m as { cardInstanceId: string }).cardInstanceId);
const stolen = (s0: GameState, end: GameState) => end.runner.score > s0.runner.score;

// ---------------------------------------------------------------- the red team's boards (findings 1, 2, 4)
const toll = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/rez-toll.json', import.meta.url), 'utf8')).state;
/** remote-1 with `ice` (innermost first, all unrezzed, from card codes), Offworld Office in the root, the run approaching the outermost. */
function remote(codes: string[], runner: number, corp: number): GameState {
  const s = structuredClone(toll());
  const agenda = s.corp.hq.find(isAgenda)!;
  s.corp.hq = s.corp.hq.filter(c => c !== agenda);
  const ice = codes.map(code => Object.assign(createCardInstance(s, code), { isRezzed: false }));
  s.corp.servers.rd = { ...s.corp.servers.rd, ice: [] };
  s.corp.servers['remote-1'] = { id: 'remote-1', name: 'Server 1', isRemote: true, ice, root: [agenda] } as never;
  s.runner.credits = runner;
  s.corp.credits = corp;
  s.activeRun = { ...s.activeRun!, server: 'remote-1', icePosition: ice.length - 1 };
  return s;
}
/** The red team's two-Palisade board (saci-set): the fixture's own Palisades (inner, outer), unrezzed, on remote-1. */
function palisades(runner: number, corp: number, saciOn?: 'outer' | 'inner'): GameState {
  const s = structuredClone(toll());
  const [inner, outer] = s.corp.servers.rd.ice.map(c => ({ ...c, isRezzed: false }));
  const agenda = s.corp.hq.find(isAgenda)!;
  s.corp.hq = s.corp.hq.filter(c => c !== agenda);
  s.corp.servers.rd = { ...s.corp.servers.rd, ice: [] };
  s.corp.servers['remote-1'] = { id: 'remote-1', name: 'Server 1', isRemote: true, ice: [inner, outer], root: [agenda] } as never;
  s.runner.credits = runner;
  s.corp.credits = corp;
  s.activeRun = { ...s.activeRun!, server: 'remote-1', icePosition: 1 };
  if (saciOn) saci(s, saciOn === 'outer' ? outer : inner);
  return s;
}
function saci(s: GameState, host: CardInstance) {
  const c = createCardInstance(s, SACI);
  c.isRezzed = true;
  c.hostedOnId = host.instanceId;
  s.runner.rig.programs.push(c);
}
const BALLISTA = '30062';
const PALISADE = '30072';
const TITHE = '30073';
const SACI = '34017';
const thisRun = (s: GameState, mustRez: string[]) => inDecision(s, 'corp', () => serverHold(s, s.activeRun!.server, { when: 'thisRun', mustRez, further: true }));

describe('R2 reads the count the agenda was committed on (the set further in)', () => {
  it('deal 1081 T16: the outer Palisade stops the run only with the ice further in: rez, and nothing is stolen that turn', { timeout: T }, () => {
    const s = fixture('deal-1081-t16-inst-24');
    expect(cardDef(approached(s)).title).toBe('Palisade');
    expect(s.corp.servers['remote-2'].root.some(isAgenda)).toBe(true);
    // Beta asked this ice alone (no stop) and the value model passed; the agenda was stolen
    expect(ask(s)).toMatchObject({ counted: 'rez', further: true, alone: false });
    expect(rezzes(s)).toBe(true);
    const { end, moves } = playOn(s, true);
    expect(rezzed(moves)[0]).toBe('inst-24');
    expect(stolen(s, end)).toBe(false);
    expect(end.corp.servers['remote-2'].root.some(isAgenda)).toBe(true);
  });

  it("report-28 T16 (the reverse case): a set without Boto stops for less, so R2 gives no opinion, Boto is passed and the inner ice is rezzed at its own window", { timeout: T }, () => {
    const s = fixture('report-28-t16-inst-34');
    expect(cardDef(approached(s)).title).toBe('Boto');
    // Boto alone stops (beta's R2 rezzed it), but a cheaper set further in stops too (6.9.2b: its own window comes)
    expect(ask(s)).toMatchObject({ counted: null, further: false, alone: true });
    expect(rezzes(s)).toBe(false);
    const { end, moves } = playOn(s);
    expect(rezzed(moves)).toEqual(['inst-23']);
    expect(stolen(s, end)).toBe(false);
    expect(end.runsThisTurn.at(-1)?.successful).toBe(false);
  });

  it('the drain guard: the Corp cannot pay for the inner Palisade after this rez: no counted rez (Corp 5); mirror Corp 6: rez, and the run is held', { timeout: T }, () => {
    const short = palisades(5, 5);
    expect(ask(short)).toMatchObject({ counted: null, further: false, alone: false });
    const enough = palisades(5, 6);
    expect(ask(enough)).toMatchObject({ counted: 'rez', further: true, alone: false });
    const { end, moves } = playOn(enough);
    expect(rezzed(moves).length).toBe(2);
    expect(stolen(enough, end)).toBe(false);
  });
});

describe('the free gate gives way only where the count needs this ice for a root agenda', () => {
  it('deal 1641 T18, Ballista (free by the price rules, 1.14.5: the walk takes the end): rez; played on, the Corp trashes Unity, the Runner jacks out, nothing stolen', { timeout: T }, () => {
    const s = fixture('deal-1641-t18-inst-42');
    expect(cardDef(approached(s)).title).toBe('Ballista');
    expect(ask(s)).toMatchObject({ counted: 'rez', further: true, alone: true, need: 0 });
    expect(rezzes(s)).toBe(true);
    const { end, moves } = playOn(s);
    // The count's stop is the end of the run; the Corp's answer (runAnswer, found row 72b) is a program trash instead
    const answer = moves.find(m => m.type === 'RESOLVE_PROMPT' && m.player === 'corp') as { choice?: { optionId?: string } } | undefined;
    expect(answer?.choice?.optionId).toBe('inst-91');
    expect(end.runner.heap.some(c => c.instanceId === 'inst-91' && cardDef(c).title === 'Unity')).toBe(true);
    expect(moves.some(m => m.type === 'JACK_OUT')).toBe(true);
    expect(stolen(s, end)).toBe(false);
    expect(end.corp.servers['remote-1'].root.filter(isAgenda).length).toBe(s.corp.servers['remote-1'].root.filter(isAgenda).length);
  });

  it('a free ice the count says does not stop the run: Tithe alone on the agenda remote: no opinion, as before', { timeout: T }, () => {
    const s = remote([TITHE], 5, 8);
    expect(ask(s)).toMatchObject({ counted: null, further: false, need: 0 });
  });

  it('a free Ballista with a cheaper set further in (an unrezzed Palisade the Runner cannot pay): no opinion; the Palisade is rezzed at its own window', { timeout: T }, () => {
    const s = remote([PALISADE, BALLISTA], 2, 8);
    expect(ask(s)).toMatchObject({ counted: null, further: false, alone: true, need: 0 });
    const inner = structuredClone(s);
    inner.activeRun = { ...inner.activeRun!, icePosition: 0 };
    expect(ask(inner)).toMatchObject({ counted: 'rez', further: true });
  });

  it('the tie (finding 5): two unrezzed Ballistas, the inner one stops for the same cost: no opinion at the outer (strict), rez at the inner', { timeout: T }, () => {
    const s = remote([BALLISTA, BALLISTA], 5, 8);
    // rezStops itself reads the tie as a stop (its >=, R2's test); the gate's helper reads it strictly
    expect(ask(s)).toMatchObject({ counted: null, further: true, need: 0 });
    const inner = structuredClone(s);
    inner.activeRun = { ...inner.activeRun!, icePosition: 0 };
    expect(ask(inner).counted).toBe('rez');
  });
});

describe('R3 and R4 are unchanged for a free ice the count says stops the run (finding 4)', () => {
  /** The red team's ballista-central board: an unrezzed Ballista on `server`; remote-1 holds an agenda behind two unrezzed Palisades. */
  function central(server: 'rd' | 'hq', runner: number, corp: number): GameState {
    const s = structuredClone(toll());
    const pals = s.corp.servers.rd.ice.map(c => ({ ...c, isRezzed: false }));
    const ballista = Object.assign(createCardInstance(s, BALLISTA), { isRezzed: false });
    const agenda = s.corp.hq.find(isAgenda)!;
    if (server === 'rd') s.corp.hq = s.corp.hq.filter(c => !isAgenda(c));
    s.corp.servers.rd = { ...s.corp.servers.rd, ice: server === 'rd' ? [ballista] : [] };
    s.corp.servers.hq = { ...s.corp.servers.hq, ice: server === 'hq' ? [ballista] : [] };
    s.corp.servers['remote-1'] = { id: 'remote-1', name: 'Server 1', isRemote: true, ice: pals, root: [createCardInstance(s, cardDef(agenda).code)] } as never;
    s.runner.credits = runner;
    s.runner.clicks = 3;
    s.corp.credits = corp;
    s.activeRun = { ...s.activeRun!, server, icePosition: 0 };
    return s;
  }
  it('R4 (R&D, no agenda in HQ), Corp 6 with 6 kept for remote-1: no counted opinion; the value model passes and the Runner goes on', { timeout: T }, () => {
    const s = central('rd', 2, 6);
    expect(ask(s)).toMatchObject({ counted: null, further: true, need: 0 });
    expect(rezzes(s)).toBe(false);
  });
  it('R4, Corp 8: no counted opinion; the value model rezzes, as before', { timeout: T }, () => {
    const s = central('rd', 2, 8);
    expect(ask(s)).toMatchObject({ counted: null, further: true, need: 0 });
    expect(rezzes(s)).toBe(true);
  });
  it('R3 (HQ with an agenda), Corp 8: no counted opinion; the value model decides, as before', { timeout: T }, () => {
    const s = central('hq', 2, 8);
    expect(ask(s)).toMatchObject({ counted: null, further: true, need: 0 });
    expect(rezzes(s)).toBe(true);
  });
});

describe('Saci: the Runner gains 3 as its host is rezzed (finding 1; holdFacts.hostRezPays)', () => {
  it('two Palisades, no Saci (the plain case): the set holds, rez, held', { timeout: T }, () => {
    const s = palisades(5, 8);
    expect(thisRun(s, [approached(s).instanceId]).holds).toBe(true);
    expect(ask(s).counted).toBe('rez');
    expect(stolen(s, playOn(s).end)).toBe(false);
  });
  it('Saci on the outer Palisade: the set no longer holds (5 + 3 pays both), no counted rez; the Corp passes it and the Runner gets no 3', { timeout: T }, () => {
    const s = palisades(5, 8, 'outer');
    expect(thisRun(s, [approached(s).instanceId]).holds).toBe(false);
    expect(ask(s)).toMatchObject({ counted: null, further: false });
    expect(rezzes(s)).toBe(false);
    const { moves } = playOn(s);
    expect(rezzed(moves)).not.toContain(approached(s).instanceId);
  });
  it('Saci on the inner Palisade: the set no longer holds (the 3 at the inner rez pays it), no counted rez', { timeout: T }, () => {
    const s = palisades(5, 8, 'inner');
    expect(thisRun(s, [approached(s).instanceId]).holds).toBe(false);
    expect(ask(s)).toMatchObject({ counted: null, further: false });
  });
  it("one Palisade with Saci, the Runner at 2 (already in beta: R2's alone test rezzed it, the Runner gained 3 and stole): no counted rez", { timeout: T }, () => {
    const s = remote([PALISADE], 2, 8);
    saci(s, approached(s));
    expect(thisRun(s, [approached(s).instanceId]).holds).toBe(false);
    expect(ask(s)).toMatchObject({ counted: null, further: false, alone: false });
    // mirror: no Saci, the Runner at 2 cannot pay Palisade's 3: rez
    const plain = remote([PALISADE], 2, 8);
    expect(ask(plain).counted).toBe('rez');
  });
});
