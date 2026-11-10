/**
 * Corp redesign stage 0 (spec /mnt/project-files/netrunner-ai/redesign/spec-stage0.md): the labeller and the counting
 * check of scripts/plan-measure-lib.ts on hand-built positions (System Gateway cards). Measurement only.
 *
 * Rules the checks rely on (Comprehensive Rules v26.03):
 *  - 1.17.2 "If at any time a player's score is greater than or equal to 7, they win the game at the next checkpoint."
 *  - 1.17.3a "The Corp can only score an agenda that has advancement counters on it greater than or equal to its
 *    advancement requirement." 1.17.3c: scoring an agenda does not cost [click] and is not an action.
 *  - 5.2.6a/f basic actions "[click]: Gain 1[credit]" and "[click], 1[credit]: Advance 1 installed card".
 *  - 8.5.11a "The install cost of a piece of ice is 1 credit for each piece of ice already installed protecting the
 *    destination server".
 *  - 3.4.3a "Unlike assets and upgrades, ice can normally only be rezzed while being approached during a run."
 *  - 6.9.2b on approach "the Corp can rez the approached piece of ice"; 6.9.2c unrezzed ice is not encountered.
 */
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, executeAction } from '../src/core';
import { giveCard, installCorpForTest, installIceForTest, installProgramForTest, newGame } from './helpers';
import { CorpTurn, commitments, continues, blocked, holdCost, labelTurn, scoreInTwo, scoreThisTurn } from '../scripts/plan-measure-lib';

const ABOVE_THE_LAW = '30060'; // agenda 3/2
const OFFWORLD_OFFICE = '30067'; // agenda 4/2
const PALISADE = '30072'; // barrier, rez 3, strength 2 (+2 on a remote), End the run
const HEDGE_FUND = '30075';
const SEAMLESS_LAUNCH = '30040'; // place 2 advancement counters on 1 installed card you did not install this turn
const CLEAVER = '30006'; // fracter, strength 3: 1 credit breaks up to 2 barrier subroutines, 2 credits +1 strength

/** Corp turn 1 of a starter game with an empty HQ and the given credits and clicks (a copy: never a state already asked about). */
function corpMain(credits: number, clicks = 3): GameState {
  const s = structuredClone(newGame(1));
  s.corp.rd.push(...s.corp.hq.splice(0));
  s.corp.credits = credits;
  s.corp.clicks = clicks;
  return s;
}

/** A Corp turn record played from `start` with these actions (each given the state it is taken in), then END_TURN. */
function playTurn(start: GameState, actions: ((s: GameState) => GameAction)[]): CorpTurn {
  let s = start;
  const steps: CorpTurn['steps'] = [];
  for (const make of [...actions, () => ({ type: 'END_TURN', player: 'corp' }) as GameAction]) {
    const action = make(s);
    const after = executeAction(s, action);
    steps.push({ before: s, action, after });
    s = after;
  }
  return { turn: start.turnNumber, start, steps, end: s, runnerActions: [] };
}
const install = (id: string, target?: string) => (): GameAction => (target ? { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: id, targetServerId: target } : { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: id, asNewRemote: true }) as GameAction;
const credit = () => ({ type: 'GAIN_CREDIT', player: 'corp' }) as GameAction;

describe('M2 score this turn (exact search, rules 1.17.3a-c, 5.2.6f)', () => {
  it('a 3-advancement agenda from HQ needs 4 clicks: not with 3, yes with 4', () => {
    const three = corpMain(5, 3);
    giveCard(three, 'corp', ABOVE_THE_LAW);
    expect(scoreThisTurn(three).feasible).toBe(false);
    const four = corpMain(5, 4);
    giveCard(four, 'corp', ABOVE_THE_LAW);
    const r = scoreThisTurn(four);
    expect(r.feasible).toBe(true);
    expect(r.agenda).toBe('Above the Law');
    expect(r.usedCard).toBe(false);
  });

  it('a line whose placing card resolves in a prompt is found (winNow canStillWin no longer cuts at an open Corp prompt)', () => {
    // Seamless Launch onto an installed Above the Law (0 counters), then one advance: 2 clicks, 2 credits, scores
    // (1.17.3a: scored at its requirement; 1.17.2: the win search). While Seamless Launch's target prompt is open the card
    // has left HQ and its 2 counters are not placed yet; the bound used to read 3 advancements against 1 click and cut it.
    const s = corpMain(5, 2);
    installCorpForTest(s, ABOVE_THE_LAW, 'remote-1');
    giveCard(s, 'corp', SEAMLESS_LAUNCH);
    const r = scoreThisTurn(s);
    expect(r.feasible).toBe(true);
    expect(r.usedCard).toBe(true);
  });

  it('credits count too: 3 clicks for an installed 3-advancement agenda but only 2 credits', () => {
    const s = corpMain(2, 3);
    installCorpForTest(s, ABOVE_THE_LAW, 'remote-1');
    expect(scoreThisTurn(s).feasible).toBe(false);
  });
});

describe('M2 score in two turns (counting, rules 3.4.3a, 6.9.2b, 8.5.11a)', () => {
  it('ice and agenda from HQ into a new remote, finish next turn: the Runner has no barrier breaker', () => {
    const s = corpMain(8, 3);
    giveCard(s, 'corp', OFFWORLD_OFFICE);
    giveCard(s, 'corp', PALISADE);
    const line = scoreInTwo(s);
    expect(line).not.toBeNull();
    expect(line!.form).toBe('install+ice');
    // 2 clicks to install, 1 advance now (7 credits left, 3 kept to rez Palisade on approach), 3 next turn (4 left >= 3)
    expect(line!.advanceNow + line!.advanceNext).toBe(4);
    expect(line!.rez).toBe(3);
  });

  it('5 credits are not enough for that line: 1 advance now leaves 4, the rez takes 3, 3 advances next turn need 3', () => {
    const s = corpMain(5, 3);
    giveCard(s, 'corp', OFFWORLD_OFFICE);
    giveCard(s, 'corp', PALISADE);
    expect(scoreInTwo(s)).toBeNull();
  });

  it('none when the Runner can break the only ice: Cleaver and enough credits against Palisade', () => {
    const s = corpMain(5, 3);
    giveCard(s, 'corp', OFFWORLD_OFFICE);
    giveCard(s, 'corp', PALISADE);
    installProgramForTest(s, CLEAVER);
    s.runner.credits = 10;
    expect(scoreInTwo(s)).toBeNull();
  });

  it('none when the Corp could not pay the rez on approach: 0 credits, Palisade costs 3', () => {
    const s = corpMain(0, 3);
    giveCard(s, 'corp', OFFWORLD_OFFICE);
    giveCard(s, 'corp', PALISADE);
    expect(scoreInTwo(s)).toBeNull();
  });

  it('an iced remote already standing: install there, nothing to rez', () => {
    const s = corpMain(4, 3);
    installIceForTest(s, PALISADE, 'remote-1', true);
    giveCard(s, 'corp', OFFWORLD_OFFICE);
    const line = scoreInTwo(s);
    expect(line?.server).toBe('remote-1');
    expect(line?.rez).toBe(0);
    expect(holdCost(s, s.corp.servers['remote-1'].ice, 0)).toBe(0);
  });

  it('a rezzed barrier the Runner can break with its credits does not hold', () => {
    const s = corpMain(4, 3);
    installIceForTest(s, PALISADE, 'remote-1', true);
    installProgramForTest(s, CLEAVER);
    s.runner.credits = 4; // + 3 clicks for credits: 7 >= 3 (two boosts to strength 4, one break)
    expect(holdCost(s, s.corp.servers['remote-1'].ice, 10)).toBeNull();
    s.runner.credits = 0;
    s.runner.maxClicks = 2; // 1 credit: not enough
    expect(holdCost(s, s.corp.servers['remote-1'].ice, 10)).toBe(0);
  });
});

describe('M1 labeller and commitments', () => {
  it('ice on a new remote with nothing in it is build; next turn of credit clicks with an agenda in HQ is a flip candidate', () => {
    const s = corpMain(5, 3);
    const ice = giveCard(s, 'corp', PALISADE);
    giveCard(s, 'corp', OFFWORLD_OFFICE);
    const t = playTurn(s, [install(ice), credit, credit]);
    expect(labelTurn(t).shape).toBe('build');
    const c = commitments(t);
    expect(c).toEqual([{ kind: 'build', server: 'remote-1' }]);
    // the next turn: credit clicks only (a hand-made start, same board)
    const next0 = structuredClone(t.end);
    next0.activePlayer = 'corp';
    next0.phase = 'corp_turn';
    next0.priority = null;
    next0.turnStep = null;
    next0.corp.clicks = 3;
    const next = playTurn(next0, [credit, credit, credit]);
    expect(labelTurn(next).shape).toBe('money');
    expect(continues(c[0], next)).toBe(false);
    expect(blocked(c[0], next)).toBe(false);
  });

  it('agenda installed and advanced is score, ice on HQ is shore, credit clicks are money', () => {
    const s = corpMain(5, 3);
    const agenda = giveCard(s, 'corp', OFFWORLD_OFFICE);
    const t = playTurn(s, [install(agenda), () => ({ type: 'ADVANCE_CARD', player: 'corp', cardInstanceId: agenda, serverId: 'remote-1' }) as GameAction, credit]);
    expect(labelTurn(t).shape).toBe('score');
    expect(commitments(t)[0]).toMatchObject({ kind: 'agenda', id: agenda, server: 'remote-1' });

    const s2 = corpMain(5, 3);
    const ice = giveCard(s2, 'corp', PALISADE);
    expect(labelTurn(playTurn(s2, [install(ice, 'hq'), credit, credit])).shape).toBe('shore');

    const s3 = corpMain(5, 3);
    const hf = giveCard(s3, 'corp', HEDGE_FUND);
    const money = playTurn(s3, [() => ({ type: 'PLAY_OPERATION_OR_EVENT', player: 'corp', cardInstanceId: hf }) as GameAction, credit, credit]);
    expect(labelTurn(money).shape).toBe('money');
    expect(commitments(money)).toEqual([]);
  });
});
