/**
 * Stage D item 1 branch 2 (brief rev 2, section 6): the hold walk (src/ai/corp/hold.ts) on the boards of the brief's
 * section 2, each with its mirror (the same board one credit, click, counter, tag or card different, where the answer
 * turns), and each checked against the engine oracle (scripts/stage-d/hold-oracle.ts), which plays the Runner's turn in
 * the engine. Rules: Comprehensive Rules v26.03, cited on each row.
 */
import { describe, expect, it } from 'vitest';
import { GameState, executeAction } from '../src/core';
import { createCardInstance } from '../src/core/engine/gameState';
import { installIceForTest, installProgramForTest, newGame, startRunnerTurn, toCorp } from './helpers';
import { oracleGetsIn } from '../scripts/stage-d/hold-oracle';
import { serverHold } from '../src/ai/corp/hold';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';

const C = {
  BRAN: '30039', ANSEL: '30038', PALISADE: '30072', CLEAVER: '30006', PHAROS: '30063', FLY: '35079', AUDREY: '34004',
  BOTULUS: '30004', TRANQ: '30017', LAMP: '35080', KARUNA: '30047', GRUBBER: '36050', PAYWALL: '36052', WHITESPACE: '30074',
  UNITY: '30026', VALENTAO: '34060', PING: '30055', FUNHOUSE: '30054', MAYFLY: '30032', HANTU: '35008',
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
const inCorp = <T>(s: GameState, f: () => T): T => asSide('corp', () => (decisionContext(s, 'corp'), f()));

/** The walk's answer for remote1 on the Runner's next turn, the Corp's rezzes limited to `corp` credits. */
const walk = (s: GameState, corp = s.corp.credits) => inCorp(s, () => serverHold(s, 'remote1', { when: 'runnerTurn', corpCredits: corp }));
/** The oracle's answer for the rez set the walk names (none when it does not hold: the cheapest set, nothing rezzed). */
const oracleOn = (s: GameState, rez: string[], cap?: number) => oracleGetsIn(s, 'remote1', 'runnerTurn', rez, undefined, cap).answer;

/** The walk holds with rez set `rez` exactly when the oracle says the Runner can't get in through it. */
function agrees(s: GameState, corp = s.corp.credits, cap?: number) {
  const h = walk(s, corp);
  expect(h.margin).toBe(h.need - h.budget);
  expect(h.holds).toBe(h.need > h.budget);
  if (h.holds) expect(oracleOn(s, h.rez ?? [], cap)).toBe('holds');
  return h;
}

describe('hold walk, commit 1: clicks, counters, plans, the turn start (runnerTurn)', () => {
  it('A1 Ansel 1.0 outside Palisade, Cleaver, $0: holds (1 click runs, Ansel takes 2, 1 earns $1 < 3; 5.2.7b, 1.16.1)', () => {
    const s = board(st => {
      ice(st, C.PALISADE);
      ice(st, C.ANSEL);
      installProgramForTest(st, C.CLEAVER);
    });
    expect(agrees(s).holds).toBe(true);
    expect(oracleOn(s, [])).toBe('holds');
  });

  it('A1 mirror: $2 more, it gets in (oracle too)', () => {
    const s = board(st => {
      ice(st, C.PALISADE);
      ice(st, C.ANSEL);
      installProgramForTest(st, C.CLEAVER);
      st.runner.credits = 2;
    });
    expect(agrees(s).holds).toBe(false);
    expect(oracleOn(s, [])).toBe('getsIn');
  });

  it('A2 two Brân 1.0, no fracter: holds (4 clicks to break, 3 after the run; 1.16.1, 1.11.3)', () => {
    const s = board(st => { ice(st, C.BRAN); ice(st, C.BRAN); });
    expect(agrees(s).holds).toBe(true);
  });

  it('A2 mirror: one Brân 1.0 (2 clicks): gets in', () => {
    const s = board(st => { ice(st, C.BRAN); });
    expect(agrees(s).holds).toBe(false);
    expect(oracleOn(s, [])).toBe('getsIn');
  });

  it('A4 two Flyswatters, Botulus at 0 counters on each: gets in (each gains 1 at the turn start, 5.7.1)', () => {
    // Botulus breaks with its own counters, on its host only
    const s = board(st => { for (let i = 0; i < 2; i++) hosted(st, C.BOTULUS, ice(st, C.FLY), 0); });
    expect(agrees(s).holds).toBe(false);
    expect(oracleOn(s, [])).toBe('getsIn');
  });

  it('A4 mirror: three Flyswatters, Botulus on two of them: holds (the third has nothing)', () => {
    const s = board(st => { ice(st, C.FLY); for (let i = 0; i < 2; i++) hosted(st, C.BOTULUS, ice(st, C.FLY), 0); });
    expect(agrees(s).holds).toBe(true);
    expect(oracleOn(s, [])).toBe('holds');
  });

  it('A4 Hantu: its counters pay its boosts and are shared across sentries (two Karunā, Hantu with 2 counters, $4)', () => {
    // Karunā is strength 3, Hantu 2: one counter (+2) a Karunā; 2 credits a Karunā to break its 2 subroutines
    const s = board(st => { ice(st, C.KARUNA); ice(st, C.KARUNA); counters(st, installProgramForTest(st, C.HANTU), 2); st.runner.credits = 4; st.runner.maxClicks = 1; });
    expect(agrees(s).holds).toBe(false);
    expect(oracleOn(s, [])).toBe('getsIn');
  });

  it('A4 Hantu mirror: 1 counter: the second Karunā can only be tanked (2 + 2 net on a grip of 1: flatline, 10.4.4)', () => {
    const s = board(st => {
      ice(st, C.KARUNA);
      ice(st, C.KARUNA);
      counters(st, installProgramForTest(st, C.HANTU), 1);
      st.runner.credits = 4;
      st.runner.maxClicks = 1;
      st.runner.grip = st.runner.grip.slice(0, 1);
    });
    expect(agrees(s).holds).toBe(true);
    expect(oracleOn(s, [])).toBe('holds');
  });

  it('A5 Pharos outside Flyswatter, Audrey v2 (1 counter), Cleaver, $2: gets in (Cleaver on Pharos for 5, Audrey on Flyswatter)', () => {
    const s = board(st => {
      ice(st, C.FLY);
      ice(st, C.PHAROS);
      counters(st, installProgramForTest(st, C.AUDREY), 1);
      installProgramForTest(st, C.CLEAVER);
      st.runner.credits = 2;
    });
    expect(agrees(s).holds).toBe(false);
    expect(oracleOn(s, [])).toBe('getsIn');
  });

  it('A5 mirror: Audrey with no counter, $5 and only the run click: Cleaver pays Pharos, nothing breaks Flyswatter: holds', () => {
    const s = board(st => {
      ice(st, C.FLY);
      ice(st, C.PHAROS);
      installProgramForTest(st, C.AUDREY);
      installProgramForTest(st, C.CLEAVER);
      st.runner.credits = 5;
      st.runner.maxClicks = 1;
    });
    expect(agrees(s).holds).toBe(true);
    // With the counter it gets in on the same click
    const t = structuredClone(s);
    counters(t, t.runner.rig.programs.find(c => c.cardCode === C.AUDREY)!.instanceId, 1);
    expect(agrees(t).holds).toBe(false);
    expect(oracleOn(t, [])).toBe('getsIn');
  }, 60_000);

  it("T1 Pharos hosting Botulus (1 counter), no fracter: gets in (2 counters at the Runner's turn start, 5.7.1)", () => {
    const s = board(st => hosted(st, C.BOTULUS, ice(st, C.PHAROS), 1));
    expect(agrees(s).holds).toBe(false);
    expect(oracleOn(s, [])).toBe('getsIn');
  });

  it('T1 mirror: Pharos with Botulus at 0 counters (1 at the turn start, 2 subroutines): holds', () => {
    const s = board(st => hosted(st, C.BOTULUS, ice(st, C.PHAROS), 0));
    expect(agrees(s).holds).toBe(true);
  });

  it('T2 Palisade rezzed, Tranquilizer with 2 counters, Corp at $0: gets in (derezzed at the turn start; 5.7.1, 6.9.2c)', () => {
    const s = board(st => { hosted(st, C.TRANQ, ice(st, C.PALISADE), 2); st.corp.credits = 0; });
    expect(agrees(s).holds).toBe(false);
    expect(oracleOn(s, [])).toBe('getsIn');
  });

  it('T2 mirror: Corp at $3 rezzes Palisade again as it is approached: holds, for a rez of 3 (6.4.3)', () => {
    const s = board(st => { hosted(st, C.TRANQ, ice(st, C.PALISADE), 2); st.corp.credits = 3; });
    const h = agrees(s);
    expect(h.holds).toBe(true);
    expect(h.rezCost).toBe(3);
  });

  it("Flyswatter's purge: Botulus on Pharos (2 counters at the turn start) behind an unrezzed Flyswatter the Corp rezzes: holds", () => {
    // Flyswatter is outermost; rezzed on approach it purges Botulus's counters (its text), then ends the run itself
    let fly = '';
    const s = board(st => { hosted(st, C.BOTULUS, ice(st, C.PHAROS), 1); fly = ice(st, C.FLY, false); });
    const h = agrees(s);
    expect(h.holds).toBe(true);
    expect(h.rez).toEqual([fly]);
    // Not rezzed, Flyswatter is passed (6.9.2c) and Botulus breaks Pharos
    expect(oracleOn(s, [])).toBe('getsIn');
  });

  it("Flyswatter's purge mirror: Flyswatter inside Pharos, Botulus on it and a second on Pharos: the purge comes too late for Pharos", () => {
    const s = board(st => {
      const fly = ice(st, C.FLY, false);
      hosted(st, C.BOTULUS, fly, 0);
      hosted(st, C.BOTULUS, ice(st, C.PHAROS), 1);
    });
    // Pharos broken by its Botulus; Flyswatter's own Botulus is purged as it is rezzed: holds with Flyswatter rezzed
    expect(agrees(s).holds).toBe(true);
    const t = structuredClone(s);
    t.corp.credits = 0;
    t.corp.servers.remote1.ice[0].isRezzed = true;
    // Rezzed before the run (no purge): both Botulus break their host, it gets in
    expect(agrees(t).holds).toBe(false);
    expect(oracleOn(t, [])).toBe('getsIn');
  });
});

describe('hold walk, commit 2: tags and grip move through the turn (runnerTurn)', () => {
  it('G1 Lamplighter, the Runner tagged with $5, no killer: gets in (5.2.7g: a click and 2 credits clear the tag, then it pays 3)', () => {
    const s = board(st => { ice(st, C.LAMP); st.runner.tags = 1; st.runner.credits = 5; });
    expect(agrees(s).holds).toBe(false);
    expect(oracleOn(s, [])).toBe('getsIn');
  });

  it('G2 Lamplighter alone, untagged, $0, 3 clicks: holds (sub 1 tags it, sub 2 ends the run; 9.8.7b)', () => {
    const s = board(st => { ice(st, C.LAMP); st.runner.maxClicks = 3; });
    expect(agrees(s).holds).toBe(true);
  });

  it('G3 two Karunā, grip 5, no killer: gets in at 3 clicks of draws (8 damage on a grip of 8; 10.4.4, 5.2.7c)', () => {
    const s = board(st => { ice(st, C.KARUNA); ice(st, C.KARUNA); });
    expect(agrees(s).holds).toBe(false);
    expect(oracleOn(s, [])).toBe('getsIn');
  });

  it('G3 mirror: grip 4, the draws make 7 < 8: holds (10.4.4)', () => {
    const s = board(st => { ice(st, C.KARUNA); ice(st, C.KARUNA); st.runner.grip = st.runner.grip.slice(0, 4); });
    expect(agrees(s).holds).toBe(true);
  });

  it('R1 unrezzed Ping outside Lamplighter, Cleaver, $10, no killer: holds for a rez of Ping (its rez tags the Runner)', () => {
    const s = board(st => { ice(st, C.LAMP); ice(st, C.PING, false); installProgramForTest(st, C.CLEAVER); st.runner.credits = 10; });
    const h = agrees(s);
    expect(h.holds).toBe(true);
    expect(h.rez).toEqual([s.corp.servers.remote1.ice[1].instanceId]);
    // Ping unrezzed is passed: Lamplighter's tag is paid through
    expect(oracleOn(s, [])).toBe('getsIn');
  });

  it('R1 mirror: Ping already rezzed (no rez this turn, no tag): gets in', () => {
    const s = board(st => { ice(st, C.LAMP); ice(st, C.PING); installProgramForTest(st, C.CLEAVER); st.runner.credits = 10; });
    expect(agrees(s).holds).toBe(false);
    expect(oracleOn(s, [])).toBe('getsIn');
  });

  it('Bumi 1.0 rezzed during the run trashes the Botulus the ice further in needs (the Corp chooses; ruling 6)', () => {
    // Bumi outermost and unrezzed; Pharos inside it hosts Botulus. Bumi's own subroutines are broken by clicks
    const s = board(st => { hosted(st, C.BOTULUS, ice(st, C.PHAROS), 1); ice(st, '35041', false); st.runner.credits = 0; });
    const h = agrees(s);
    expect(h.holds).toBe(true);
    // Without the rez, Botulus breaks Pharos
    expect(oracleOn(s, [])).toBe('getsIn');
  });

  it('F1 Funhouse alone, $0: gets in (the Runner takes the tag; 6.9.3a), as on beta: no toll is a credit (ruling 1)', () => {
    const s = board(st => { ice(st, C.FUNHOUSE); });
    expect(agrees(s).holds).toBe(false);
    expect(oracleOn(s, [])).toBe('getsIn');
  });

  it('F1 mirror: Funhouse outside Lamplighter, $0, 3 clicks: the tag Funhouse gives ends the run at Lamplighter: holds', () => {
    const s = board(st => { ice(st, C.LAMP); ice(st, C.FUNHOUSE); st.runner.maxClicks = 3; });
    expect(agrees(s).holds).toBe(true);
  });
});

describe('hold walk, commit 3: credits move on both sides through the run', () => {
  it('B4 Whitespace with Unity, $0, 3 clicks: gets in (Unity breaks both subroutines for 2; 6.9.3b)', () => {
    const s = board(st => { ice(st, C.WHITESPACE); installProgramForTest(st, C.UNITY); st.runner.maxClicks = 3; });
    expect(agrees(s).holds).toBe(false);
    expect(oracleOn(s, [])).toBe('getsIn');
  });

  it('B4 2 clicks ($1 after a click): Unity breaks only the end-the-run for 1 and the loss takes nothing: gets in', () => {
    const s = board(st => { ice(st, C.WHITESPACE); installProgramForTest(st, C.UNITY); st.runner.maxClicks = 2; });
    expect(agrees(s).holds).toBe(false);
    expect(oracleOn(s, [])).toBe('getsIn');
  });

  it('B4 mirror: 1 click, $0: Unity breaks nothing: holds', () => {
    const s = board(st => { ice(st, C.WHITESPACE); installProgramForTest(st, C.UNITY); st.runner.maxClicks = 1; });
    expect(agrees(s).holds).toBe(true);
  });

  it('C1 Whitespace alone, $8, no decoder: gets in (three clicks make 11, less 3 is 8, more than 6; 9.8.7b)', () => {
    const s = board(st => { ice(st, C.WHITESPACE); st.runner.credits = 8; });
    expect(agrees(s).holds).toBe(false);
    expect(oracleOn(s, [])).toBe('getsIn');
  });

  it('C1 mirror: $6 (9 less 3 is 6): holds', () => {
    const s = board(st => { ice(st, C.WHITESPACE); st.runner.credits = 6; });
    expect(agrees(s).holds).toBe(true);
  });

  it('C2 Valentão unrezzed, Corp $6, Runner $3 and tagged: gets in on runnerTurn (5 or more at the encounter; 6.4.3, 9.8.7b)', () => {
    const s = board(st => { ice(st, C.VALENTAO, false); st.corp.credits = 6; st.runner.credits = 3; st.runner.tags = 1; });
    expect(agrees(s).holds).toBe(false);
    expect(oracleOn(s, [s.corp.servers.remote1.ice[0].instanceId])).toBe('getsIn');
  });

  it('C2 thisRun: the same run under way, the Runner at $3 with no clicks to earn: holds (3 against 1+2)', () => {
    const s = board(st => { ice(st, C.VALENTAO, false); st.corp.credits = 6; st.runner.credits = 3; st.runner.tags = 1; });
    startRunnerTurn(s);
    const r = toCorp(executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote1' }));
    const v = r.corp.servers.remote1.ice[0].instanceId;
    expect(r.priority?.holder).toBe('corp');
    const h = inCorp(r, () => serverHold(r, 'remote1', { when: 'thisRun', mustRez: [v], further: false }));
    expect(h.holds).toBe(true);
    expect(oracleGetsIn(r, 'remote1', 'thisRun', [v]).answer).toBe('holds');
  });

  it('E1 two Palisades, Cleaver, $1, Corp with 2 bad publicity: gets in (1 + 3 clicks + the fund of 2; 6.9.1b, 10.6.3)', () => {
    const s = board(st => { ice(st, C.PALISADE); ice(st, C.PALISADE); installProgramForTest(st, C.CLEAVER); st.runner.credits = 1; st.corp.badPublicity = 2; });
    expect(agrees(s).holds).toBe(false);
    expect(oracleOn(s, [])).toBe('getsIn');
  });

  it('E1 mirror: no bad publicity: holds', () => {
    const s = board(st => { ice(st, C.PALISADE); ice(st, C.PALISADE); installProgramForTest(st, C.CLEAVER); st.runner.credits = 1; });
    expect(agrees(s).holds).toBe(true);
  });
});
