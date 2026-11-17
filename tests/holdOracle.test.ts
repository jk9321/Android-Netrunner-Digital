/**
 * Stage D item 1 (brief rev 2, 4.1): the engine oracle (scripts/stage-d/hold-oracle.ts) on the boards of the brief's
 * section 2, each against the truth worked out from the card text and the Comprehensive Rules (v26.03). The oracle
 * plays the Runner's turn in the engine and searches it, so these rows check the rows, not the count: where the count
 * is wrong today the row says so in its name (the count's answer is not asserted here; the baseline table reports it).
 */
import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core';
import { createCardInstance } from '../src/core/engine/gameState';
import { installIceForTest, installProgramForTest, newGame } from './helpers';
import { oracle, oracleGetsIn } from '../scripts/stage-d/hold-oracle';

const C = {
  BRAN: '30039', ANSEL: '30038', PALISADE: '30072', CLEAVER: '30006', PHAROS: '30063', FLY: '35079', AUDREY: '34004',
  BOTULUS: '30004', TRANQ: '30017', LAMP: '35080', KARUNA: '30047', GRUBBER: '36050', PAYWALL: '36052', WHITESPACE: '30074',
  UNITY: '30026', VALENTAO: '34060', PING: '30055', FUNHOUSE: '30054', MAYFLY: '30032',
};

/** A Corp turn-7 board with an empty rig and HQ, the Runner at $0 and 4 clicks, the Corp at $20. */
function board(setup: (s: GameState) => void): GameState {
  const s = newGame(3);
  s.corp.hq = [];
  s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  s.runner.credits = 0;
  s.corp.credits = 20;
  s.turnNumber = 7;
  setup(s);
  return s;
}
const ice = (s: GameState, code: string, rezzed = true) => installIceForTest(s, code, 'remote1', rezzed);
function hosted(s: GameState, code: string, host: string, virus: number) {
  const c = createCardInstance(s, code);
  c.isRezzed = true;
  c.hostedOnId = host;
  c.tokens = { virus };
  s.runner.rig.programs.push(c);
}
const counters = (s: GameState, id: string, virus: number) => (s.runner.rig.programs.find(c => c.instanceId === id)!.tokens = { virus });
const turn = (s: GameState, rez: string[] = []) => oracleGetsIn(s, 'remote1', 'runnerTurn', rez).answer;

describe('hold oracle: the brief rows (runnerTurn)', () => {
  it('A1 Ansel 1.0 outside Palisade, Cleaver, $0: holds (5.2.7b, 1.16.1); with $1 more it gets in', () => {
    const s = board(st => {
      ice(st, C.PALISADE);
      ice(st, C.ANSEL);
      installProgramForTest(st, C.CLEAVER);
    });
    expect(turn(s)).toBe('holds');
    // Ansel's sub 1 trashes 1 installed card: the Runner breaks it and the steal-blocking sub 3 (2 clicks), so 1 click
    // earns: $1 against Palisade's 3 (Cleaver: 1 to break, +1 strength for 2 at strength 4)
    const t = structuredClone(s);
    t.runner.credits = 2;
    expect(turn(t)).toBe('getsIn');
  });

  it('A2 two Brân 1.0, no fracter: holds (4 clicks to break, 3 after the run click; 1.16.1)', () => {
    expect(turn(board(st => { ice(st, C.BRAN); ice(st, C.BRAN); }))).toBe('holds');
  });

  it('A3 one Brân 1.0: gets in once, not twice (1.16.1, 1.11.3)', () => {
    const s = board(st => { ice(st, C.BRAN); });
    const a = oracle(s, { when: 'runnerTurn', targets: ['remote1', 'remote1'], rez: new Set() });
    expect(a.reached).toBe(1);
  });

  it('A5 Pharos outside Flyswatter, Audrey v2 (1 counter), Cleaver, $2: gets in (Cleaver on Pharos, Audrey on Flyswatter)', () => {
    const s = board(st => {
      ice(st, C.FLY);
      ice(st, C.PHAROS);
      counters(st, installProgramForTest(st, C.AUDREY), 1);
      installProgramForTest(st, C.CLEAVER);
      st.runner.credits = 2;
    });
    expect(turn(s)).toBe('getsIn');
  });

  it("T1 Pharos hosting Botulus (1 counter), no fracter: gets in (a counter at the Runner's turn start, 5.7.1)", () => {
    expect(turn(board(st => hosted(st, C.BOTULUS, ice(st, C.PHAROS), 1)))).toBe('getsIn');
  });

  it("T2 Palisade rezzed, Tranquilizer with 2 counters, Corp at $0: gets in (derezzed at the turn start, 5.7.1, 6.9.2c)", () => {
    expect(turn(board(st => { hosted(st, C.TRANQ, ice(st, C.PALISADE), 2); st.corp.credits = 0; }))).toBe('getsIn');
  });

  it('T2 mirror: Corp at $3 rezzes Palisade again when it is approached: holds (6.4.3)', () => {
    const s = board(st => { hosted(st, C.TRANQ, ice(st, C.PALISADE), 2); st.corp.credits = 3; });
    const palisade = s.corp.servers.remote1.ice[0].instanceId;
    expect(turn(s, [palisade])).toBe('holds');
  });

  it('G1 Lamplighter, the Runner tagged with $5, no killer: gets in (5.2.7g: clear the tag, then pay 3)', () => {
    expect(turn(board(st => { ice(st, C.LAMP); st.runner.tags = 1; st.runner.credits = 5; }))).toBe('getsIn');
  });

  it('G2 Lamplighter alone, $0, 3 clicks: holds (sub 1 tags it, sub 2 ends the run; 9.8.7b)', () => {
    expect(turn(board(st => { ice(st, C.LAMP); st.runner.maxClicks = 3; }))).toBe('holds');
  });

  it('G3 two Karunā, grip 5, no killer: gets in (three draws make 8, 8 damage is survived; 10.4.4, 5.2.7c)', () => {
    expect(turn(board(st => { ice(st, C.KARUNA); ice(st, C.KARUNA); }))).toBe('getsIn');
  });

  it('G3 mirror: grip 4, the draws make 7 < 8: holds (10.4.4)', () => {
    expect(turn(board(st => { ice(st, C.KARUNA); ice(st, C.KARUNA); st.runner.grip = st.runner.grip.slice(0, 4); }))).toBe('holds');
  });

  it('B1 Grubber outside Palisade, Cleaver, $4: holds (8 to pay against 7; 1.16.11b)', () => {
    expect(turn(board(st => { ice(st, C.PALISADE); ice(st, C.GRUBBER); installProgramForTest(st, C.CLEAVER); st.runner.credits = 4; }))).toBe('holds');
  });

  it('B2 Paywall alone, $0: gets in (3 clicks earn 3: lose 1 on encounter, pay 1; 5.2.7b, 6.9.3a)', () => {
    expect(turn(board(st => { ice(st, C.PAYWALL); }))).toBe('getsIn');
  });

  it('B3 Paywall alone, $0, 2 clicks: holds (1 earned is lost on encounter; 6.9.3a)', () => {
    expect(turn(board(st => { ice(st, C.PAYWALL); st.runner.maxClicks = 2; }))).toBe('holds');
  });

  it('B4 Whitespace with Unity, $0, 3 clicks: gets in (break both subs for 2)', () => {
    expect(turn(board(st => { ice(st, C.WHITESPACE); installProgramForTest(st, C.UNITY); st.runner.maxClicks = 3; }))).toBe('getsIn');
  });

  it('C1 Whitespace alone, $8, no decoder: gets in (11 less 3 is 8 > 6; 9.8.7b)', () => {
    expect(turn(board(st => { ice(st, C.WHITESPACE); st.runner.credits = 8; }))).toBe('getsIn');
  });

  it('C1 mirror: $6 (9 less 3 is 6): holds', () => {
    expect(turn(board(st => { ice(st, C.WHITESPACE); st.runner.credits = 6; }))).toBe('holds');
  });

  it('C2 Valentão unrezzed, Corp $6, Runner $3, tagged (rez cost: remove the tag): gets in on runnerTurn (6.4.3, 9.8.7b)', () => {
    const s = board(st => { ice(st, C.VALENTAO, false); st.corp.credits = 6; st.runner.credits = 3; st.runner.tags = 1; });
    expect(turn(s, [s.corp.servers.remote1.ice[0].instanceId])).toBe('getsIn');
  });

  it('R1 unrezzed Ping outside Lamplighter, Cleaver, $10, no killer: one run holds with Ping rezzed (its rez tags), gets in without', () => {
    const s = board(st => { ice(st, C.LAMP); ice(st, C.PING, false); installProgramForTest(st, C.CLEAVER); st.runner.credits = 10; });
    const ping = s.corp.servers.remote1.ice[1].instanceId;
    expect(turn(s, [ping])).toBe('holds');
    expect(turn(s)).toBe('getsIn');
    // The turn's whole truth: Ping's tag is spent on the first run; the Runner clears it (5.2.7g) and runs again, the
    // ice already rezzed (a second run is outside the count's one-run `need`: reported apart in the baseline table)
    expect(oracle(s, { when: 'runnerTurn', targets: ['remote1'], rez: new Set([ping]), retries: true }).reached).toBe(1);
  });

  it('F1 Funhouse alone, $0: gets in (the Runner takes the tag; 6.9.3a)', () => {
    expect(turn(board(st => { ice(st, C.FUNHOUSE); }))).toBe('getsIn');
  });

  it('Mayfly is trashed when the run ends: Palisade, Mayfly, $0: one entry, not two', () => {
    const s = board(st => { ice(st, C.PALISADE); installProgramForTest(st, C.MAYFLY); st.runner.credits = 5; });
    expect(oracle(s, { when: 'runnerTurn', targets: ['remote1', 'remote1'], rez: new Set() }).reached).toBe(1);
  });
});
