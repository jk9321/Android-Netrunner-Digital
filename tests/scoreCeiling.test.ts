/**
 * Corp redesign stage 0b (spec /mnt/project-files/netrunner-ai/redesign/spec-stage0b.md): the two measurement
 * instruments of src/ai/countedScore.ts on hand-built positions (System Gateway cards). Default off, never shipped.
 *
 * Rules the instruments rely on (Comprehensive Rules v26.03):
 *  - 1.17.3a an agenda can be scored once its advancement counters reach its requirement; 5.2.6f "[click], 1[credit]:
 *    Advance 1 installed card"; 5.2.6a "[click]: Gain 1[credit]".
 *  - 8.5.11a "The install cost of a piece of ice is 1 credit for each piece of ice already installed protecting the
 *    destination server".
 *  - 3.4.3a / 6.9.2b ice is rezzed as it is approached; 6.9.1a a run on a server is public (the run record I2 reads).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { GameAction, GameState, executeAction, getLegalActions } from '../src/core';
import { giveCard, installCorpForTest, installIceForTest, installProgramForTest, newGame } from './helpers';
import { countedStats, oracleCorpPick, resetCountedStats } from '../src/ai/countedScore';
import { asSide, tuning } from '../src/ai/synergy';

const OFFWORLD_OFFICE = '30067'; // agenda 4/2
const ABOVE_THE_LAW = '30060'; // agenda 3/2
const PALISADE = '30072'; // barrier, rez 3, End the run
const CLEAVER = '30006'; // fracter, strength 3: 1 credit breaks up to 2 barrier subroutines, 2 credits +1 strength

const saved = tuning.plan;
afterEach(() => {
  tuning.plan = saved;
  resetCountedStats();
});
const on = (o: { countedScore?: boolean; centralsLight?: boolean }) => {
  tuning.plan = { ...saved, oracle: { ...saved.oracle, ...o } };
  resetCountedStats();
};

/** Corp turn 1 of a starter game with an empty HQ and the given credits and clicks (a copy). */
function corpMain(credits: number, clicks = 3): GameState {
  const s = structuredClone(newGame(1));
  s.corp.rd.push(...s.corp.hq.splice(0));
  s.corp.credits = credits;
  s.corp.clicks = clicks;
  return s;
}

const credit = (s: GameState) => getLegalActions(s, 'corp').find(a => a.type === 'GAIN_CREDIT')!;
const pick = (s: GameState, chosen: GameAction, ranked: { action: GameAction; score: number }[] = [{ action: chosen, score: 0 }]) =>
  asSide('corp', () => oracleCorpPick(s, chosen, ranked, () => false));

describe('stage 0b instruments (countedScore.ts oracleCorpPick)', () => {
  it('off by default: the Corp keeps its own pick', () => {
    const s = corpMain(8, 3);
    giveCard(s, 'corp', OFFWORLD_OFFICE);
    giveCard(s, 'corp', PALISADE);
    const c = credit(s);
    expect(pick(s, c)).toBe(c);
  });

  it('I1: a score this turn the check finds is played over the Corp pick (1.17.3a, 5.2.6f)', () => {
    on({ countedScore: true });
    const s = corpMain(3, 1);
    const id = installCorpForTest(s, ABOVE_THE_LAW, 'remote-1');
    s.corp.servers['remote-1'].root[0].advancementCounters = 2;
    const a = pick(s, credit(s));
    expect(a.type).toBe('ADVANCE_CARD');
    expect((a as { cardInstanceId: string }).cardInstanceId).toBe(id);
    expect(countedStats.nowForced).toBe(1);
  });

  it('I1: a two-turn line is played step by step: ice into a new remote, the agenda behind it, one advance (8.5.11a)', () => {
    on({ countedScore: true });
    let s = corpMain(8, 3);
    const agenda = giveCard(s, 'corp', OFFWORLD_OFFICE);
    const ice = giveCard(s, 'corp', PALISADE);
    const a1 = pick(s, credit(s));
    expect(a1).toMatchObject({ type: 'INSTALL_CARD', cardInstanceId: ice, asNewRemote: true });
    s = executeAction(s, a1);
    const a2 = pick(s, credit(s));
    expect(a2).toMatchObject({ type: 'INSTALL_CARD', cardInstanceId: agenda });
    s = executeAction(s, a2);
    const a3 = pick(s, credit(s));
    expect(a3).toMatchObject({ type: 'ADVANCE_CARD', cardInstanceId: agenda });
    expect(countedStats.lines).toHaveLength(1);
    expect(countedStats.lines[0].form).toBe('install+ice');
    expect(countedStats.stepsForced).toBe(3);
  });

  it("I1: the spare clicks follow the Corp's pick only while the line holds; a second ice that leaves too little to rez is vetoed", () => {
    on({ countedScore: true });
    let s = corpMain(5, 3);
    const agenda = installCorpForTest(s, OFFWORLD_OFFICE, 'remote-1');
    installIceForTest(s, PALISADE, 'remote-1', false);
    const second = giveCard(s, 'corp', PALISADE);
    // Line: advance once now (4 credits left), 3 next turn; Palisade's 3 to rez in between
    const a1 = pick(s, credit(s));
    expect(a1).toMatchObject({ type: 'ADVANCE_CARD', cardInstanceId: agenda });
    s = executeAction(s, a1);
    // A second Palisade costs 1 (8.5.11a): 3 credits and 1 click left end the turn on 4, 1 after the rez, 3 needed next turn
    const ice = getLegalActions(s, 'corp').find(a => a.type === 'INSTALL_CARD' && a.cardInstanceId === second && (a as { targetServerId?: string }).targetServerId === 'remote-1')!;
    expect(ice).toBeDefined();
    expect(pick(s, ice).type).toBe('GAIN_CREDIT');
    expect(countedStats.restVetoed).toBe(1);
    // A click for a credit keeps it: the Corp's own pick stands
    const c = credit(s);
    expect(pick(s, c)).toBe(c);
  });

  it('I2: a second ice on HQ is held back for the next-ranked action; the first ice, or one after a successful run there, is not', () => {
    on({ centralsLight: true });
    const s = corpMain(5, 3);
    installIceForTest(s, PALISADE, 'hq', false);
    const second = giveCard(s, 'corp', PALISADE);
    const legal = getLegalActions(s, 'corp');
    const toHq = legal.find(a => a.type === 'INSTALL_CARD' && a.cardInstanceId === second && (a as { targetServerId?: string }).targetServerId === 'hq' && !(a as { trashFirst?: string[] }).trashFirst?.length)!;
    const toRd = legal.find(a => a.type === 'INSTALL_CARD' && a.cardInstanceId === second && (a as { targetServerId?: string }).targetServerId === 'rd')!;
    const ranked = [{ action: toHq, score: 2 }, { action: credit(s), score: 1 }];
    expect(pick(s, toHq, ranked).type).toBe('GAIN_CREDIT');
    expect(countedStats.centralHeld).toBe(1);
    // R&D has no ice: its first piece is allowed
    expect(pick(s, toRd, ranked)).toBe(toRd);
    // A successful run on HQ in the Runner's last turn (the public run record) lifts the rule
    const ran = structuredClone(s);
    ran.runnerLastTurnRuns = [{ server: 'hq', successful: true }];
    resetCountedStats();
    expect(asSide('corp', () => oracleCorpPick(ran, toHq, ranked, () => false))).toBe(toHq);
    // So does the lethal-HQ rule
    resetCountedStats();
    expect(asSide('corp', () => oracleCorpPick(s, toHq, ranked, () => true))).toBe(toHq);
  });
});

describe('stage 0b I1 dial: strict (Runner on +4 credits) against loose', () => {
  it('a line that holds against the Runner as it stands but not with 4 credits more is forced loose, not strict', () => {
    // Cleaver breaks Palisade for 1 credit (the count reads a new remote's ice at its printed strength 2, under Cleaver's
    // 3); the Runner has 0 credits and no click to spare (budget 0): loose holds, strict (budget 4) does not
    const build = () => {
      const s = corpMain(8, 3);
      giveCard(s, 'corp', OFFWORLD_OFFICE);
      giveCard(s, 'corp', PALISADE);
      installProgramForTest(s, CLEAVER);
      s.runner.credits = 0;
      s.runner.maxClicks = 1;
      return s;
    };
    on({ countedScore: true });
    const loose = build();
    expect(pick(loose, credit(loose)).type).toBe('INSTALL_CARD');
    tuning.plan = { ...saved, oracle: { ...saved.oracle, countedScore: true, countedStrict: true } };
    resetCountedStats();
    const strict = build();
    const c = credit(strict);
    expect(pick(strict, c)).toBe(c);
    expect(countedStats.lines).toHaveLength(0);
  });
});
