/**
 * Stage D item 1 branch 2 (brief rev 2, section 6): the hold walk (src/ai/corp/hold.ts) on the boards of the brief's
 * section 2, each with its mirror (the same board one credit, click, counter, tag or card different, where the answer
 * turns), and each checked against the engine oracle (scripts/stage-d/hold-oracle.ts), which plays the Runner's turn in
 * the engine. Rules: Comprehensive Rules v26.03, cited on each row.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, executeAction, rezCostOf } from '../src/core';
import { createCardInstance } from '../src/core/engine/gameState';
import { installCorpForTest, installIceForTest, installProgramForTest, newGame, startRunnerTurn, toCorp } from './helpers';
import { oracle, oracleGetsIn } from '../scripts/stage-d/hold-oracle';
import { serverHold, turnReach } from '../src/ai/corp/hold';
import { rezMoney } from '../src/ai/corp/rezMoney';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';

const C = {
  BRAN: '30039', ANSEL: '30038', PALISADE: '30072', CLEAVER: '30006', PHAROS: '30063', FLY: '35079', AUDREY: '34004',
  BOTULUS: '30004', TRANQ: '30017', LAMP: '35080', KARUNA: '30047', GRUBBER: '36050', PAYWALL: '36052', WHITESPACE: '30074',
  UNITY: '30026', VALENTAO: '34060', PING: '30055', FUNHOUSE: '30054', MAYFLY: '30032', HANTU: '35008', VERBAL: '30034', LYCIAN: '34100', CARMEN: '30015',
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
// The walk is judged against the turn's whole truth: a run that fails may be followed by another (the 10:10Z ruling)
const oracleOn = (s: GameState, rez: string[], cap?: number) => oracleGetsIn(s, 'remote1', 'runnerTurn', rez, undefined, cap, true).answer;

/** The walk holds with rez set `rez` exactly when the oracle says the Runner can't get in through it. */
function agrees(s: GameState, corp = s.corp.credits, cap?: number) {
  const h = walk(s, corp);
  expect(h.margin).toBe(h.need - h.budget);
  // `need` is a single run's (brief rev 2, 2.5): holding needs it above the budget; a run after a failed one may get in
  // where it is above, so "does not hold" with a margin above 0 is allowed, and then at least one run gets in
  if (h.holds) expect(h.need).toBeGreaterThan(h.budget);
  else expect(h.entries).toBeGreaterThanOrEqual(1);
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

  // Found in the oracle comparison (deal 1041 T10, walk-measurements.md section 9): Verbal Plasticity, "The first time
  // each turn you take the basic action to draw 1 card, instead draw 2 cards" (the engine's firstBasicDraw)
  it('G3 mirror with Verbal Plasticity: grip 4, the first draw gives 2, 4 + 4 = 8 survives 8 (10.4.4, 5.2.7c): gets in', () => {
    const s = board(st => {
      ice(st, C.KARUNA);
      ice(st, C.KARUNA);
      st.runner.grip = st.runner.grip.slice(0, 4);
      const vp = createCardInstance(st, C.VERBAL);
      vp.isRezzed = true;
      st.runner.rig.resources.push(vp);
    });
    expect(agrees(s).holds).toBe(false);
    expect(oracleOn(s, [])).toBe('getsIn');
  });

  // Found in the oracle comparison (human games 18, 36, 49; walk-measurements.md section 9): Lycian Multi-Munition, "When
  // you rez this ice, choose 1 or more subtypes among barrier, code gate, and sentry"; its subroutines work only for
  // the subtypes it has. The Corp chooses as it rezzes (ruling 6: the walk takes the choice that keeps the Runner out)
  it('R Lycian unrezzed, Carmen and Unity (no fracter), $10: holds for its rez (the Corp makes it a barrier)', () => {
    const s = board(st => {
      ice(st, C.LYCIAN, false);
      installProgramForTest(st, C.CARMEN);
      installProgramForTest(st, C.UNITY);
      st.runner.credits = 10;
    });
    const h = agrees(s);
    expect(h.holds).toBe(true);
    expect(h.rez).toEqual([s.corp.servers.remote1.ice[0].instanceId]);
    // The oracle with retries tries the Corp's every choice on every run
  }, 60_000);

  it('R Lycian mirror: Cleaver as well, the Runner breaks whatever the Corp chooses: gets in', () => {
    const s = board(st => {
      ice(st, C.LYCIAN, false);
      installProgramForTest(st, C.CARMEN);
      installProgramForTest(st, C.UNITY);
      installProgramForTest(st, C.CLEAVER);
      st.runner.credits = 10;
    });
    expect(agrees(s).holds).toBe(false);
    expect(oracleOn(s, [s.corp.servers.remote1.ice[0].instanceId])).toBe('getsIn');
  });

  // The turn's whole truth (the 10:10Z ruling): the first run ends at Lamplighter (Ping's rez tagged the Runner); the
  // Runner clears the tag (5.2.7g: a click and 2 credits) and runs again past a Ping already rezzed (no new tag)
  it('R1 unrezzed Ping outside Lamplighter, Cleaver, $10, no killer: the tag is cleared and a second run gets in', () => {
    const s = board(st => { ice(st, C.LAMP); ice(st, C.PING, false); installProgramForTest(st, C.CLEAVER); st.runner.credits = 10; });
    expect(agrees(s).holds).toBe(false);
    const ping = [s.corp.servers.remote1.ice[1].instanceId];
    expect(oracleOn(s, ping)).toBe('getsIn');
    // One run alone is kept out by the rez of Ping (the count's old one-run definition)
    expect(oracleGetsIn(s, 'remote1', 'runnerTurn', ping).answer).toBe('holds');
  });

  it('R1 mirror: no clicks for a second run (2 clicks, $10): the rez of Ping holds, for the whole turn too', () => {
    const s = board(st => { ice(st, C.LAMP); ice(st, C.PING, false); installProgramForTest(st, C.CLEAVER); st.runner.credits = 10; st.runner.maxClicks = 2; });
    const h = agrees(s);
    expect(h.holds).toBe(true);
    expect(h.rez).toEqual([s.corp.servers.remote1.ice[1].instanceId]);
    // The oracle with a failed run followed by another (the pin's truth) agrees: one click clears the tag, none is left
    expect(oracleGetsIn(s, 'remote1', 'runnerTurn', h.rez ?? [], undefined, undefined, true).answer).toBe('holds');
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

describe('hold walk, commit 4: the run sequence (turnReach; brief 5.6)', () => {
  /** How many of `targets` the oracle's Runner breaches in order on its next turn, nothing more rezzed. */
  const reached = (s: GameState, targets: string[]) => oracle(s, { when: 'runnerTurn', targets, rez: new Set() }).reached;

  it('A3 one Brân 1.0, no breakers: 1 entry (a run and 2 clicks to break it of 4; 1.16.1, 5.2.7d)', () => {
    const s = board(st => { ice(st, C.BRAN); });
    expect(walk(s).entries).toBe(1);
    expect(reached(s, ['remote1', 'remote1'])).toBe(1);
  });

  it('A3 mirror: Palisade on a remote (strength 4) with Cleaver, $8: 3 entries (3 a run: boost 2, break 1; the 4th click earns the 9th)', () => {
    const s = board(st => { ice(st, C.PALISADE); installProgramForTest(st, C.CLEAVER); st.runner.credits = 8; });
    const h = walk(s);
    expect(h.holds).toBe(false);
    expect(h.entries).toBe(3);
    expect(reached(s, ['remote1', 'remote1', 'remote1', 'remote1'])).toBe(3);
  });

  it('Mayfly is trashed as its run ends: 1 entry through Palisade (its text; 6.9.6)', () => {
    const s = board(st => { ice(st, C.PALISADE); installProgramForTest(st, C.MAYFLY); st.runner.credits = 8; });
    expect(walk(s).entries).toBe(1);
    expect(reached(s, ['remote1', 'remote1'])).toBe(1);
  });

  it('one turn reaches each of two Brân servers alone but not both (the clicks are shared; 1.16.1)', () => {
    const s = board(st => { ice(st, C.BRAN); installIceForTest(st, C.BRAN, 'remote2', true); });
    const reach = (servers: string[]) => inCorp(s, () => turnReach(s, servers, servers.map(() => []))).reaches;
    expect([reach(['remote1']), reach(['remote2']), reach(['remote1', 'remote2'])]).toEqual([true, true, false]);
    expect(reached(s, ['remote1', 'remote2'])).toBe(1);
  });

  it("rezMoney's keep: two agenda remotes, each a rezzed Brân 1.0 outside an unrezzed Palisade: keep is one Palisade, not two (one turn reaches one of them)", () => {
    const s = board(st => {
      for (const id of ['remote1', 'remote2']) {
        installIceForTest(st, C.PALISADE, id, false);
        installIceForTest(st, C.BRAN, id, true);
        st.corp.servers[id].root.push(createCardInstance(st, '30067'));
      }
    });
    const money = inCorp(s, () => rezMoney(s));
    expect(money.byServer).toMatchObject({ remote1: 3, remote2: 3 });
    expect(money.keep).toBe(3);
    expect(reached(s, ['remote1', 'remote2'])).toBe(1);
  });
});

describe('hold walk, commit 5: what an ice takes besides breaks', () => {
  it('B1 Grubber outside Palisade, Cleaver, $4: holds (Grubber 5 to break or 6 to pay, Palisade 3: 8 against 7; 1.16.11b)', () => {
    const s = board(st => { ice(st, C.PALISADE); ice(st, C.GRUBBER); installProgramForTest(st, C.CLEAVER); st.runner.credits = 4; });
    expect(agrees(s).holds).toBe(true);
  });

  it('B1 mirror: $5: 8 against 8: gets in', () => {
    const s = board(st => { ice(st, C.PALISADE); ice(st, C.GRUBBER); installProgramForTest(st, C.CLEAVER); st.runner.credits = 5; });
    expect(agrees(s).holds).toBe(false);
    expect(oracleOn(s, [])).toBe('getsIn');
  });

  it('B2 Paywall alone, $0: gets in (3 clicks earn 3; it loses 1 and pays 1; 5.2.7b, 6.9.3a)', () => {
    const s = board(st => { ice(st, C.PAYWALL); });
    const h = agrees(s);
    expect(h).toMatchObject({ holds: false, need: 2 });
    expect(oracleOn(s, [])).toBe('getsIn');
  });

  it('B2 mirror: 1 click, $1: the encounter takes the 1 it would pay: holds', () => {
    const s = board(st => { ice(st, C.PAYWALL); st.runner.maxClicks = 1; st.runner.credits = 1; });
    expect(agrees(s)).toMatchObject({ holds: true, need: 2 });
  });

  it('B3 Paywall alone, $1: need 2 (the encounter loss counted; 6.9.3a)', () => {
    const s = board(st => { ice(st, C.PAYWALL); st.runner.credits = 1; });
    expect(agrees(s).need).toBe(2);
  });

  // Thunderbolt Armaments: the subroutine the ice gains when rezzed during a run lasts for that run only (9.8.3e). The
  // first run ends; the second meets Diviner rezzed without it (the turn's whole truth, the 10:10Z ruling)
  it('R2 Thunderbolt Armaments, unrezzed Diviner, nothing installed: the first run ends, the second gets in', () => {
    const s = board(st => { st.corp.identity = createCardInstance(st, '34096'); ice(st, '30046', false); });
    expect(agrees(s).holds).toBe(false);
    const diviner = s.corp.servers.remote1.ice.map(c => c.instanceId);
    expect(oracleOn(s, diviner)).toBe('getsIn');
    expect(oracleGetsIn(s, 'remote1', 'runnerTurn', diviner).answer).toBe('holds');
  });

  it('R2, human game 49 turn 1 (Thunderbolt Armaments, Diviner on R&D, nothing installed): the walk agrees with the oracle', () => {
    const f = JSON.parse(readFileSync(new URL('./fixtures/hold-walk/thunderbolt-49-t1-rd.json', import.meta.url), 'utf8'));
    const s: GameState = f.state;
    const h = inCorp(s, () => serverHold(s, f.server, { when: 'runnerTurn', corpCredits: Infinity }));
    expect(h.holds).toBe(false);
    const all = s.corp.servers[f.server].ice.map(c => c.instanceId);
    expect(oracleGetsIn(s, f.server, 'runnerTurn', all, Infinity, undefined, true).answer).toBe('getsIn');
  });

  it('R2 mirror: one click (a single run): the rez holds, for the whole turn too', () => {
    const s = board(st => { st.corp.identity = createCardInstance(st, '34096'); ice(st, '30046', false); st.runner.maxClicks = 1; });
    const h = agrees(s);
    expect(h.holds).toBe(true);
    expect(h.rez).toHaveLength(1);
    expect(oracleGetsIn(s, 'remote1', 'runnerTurn', h.rez ?? [], undefined, undefined, true).answer).toBe('holds');
  });

  it('R2 mirror: a card installed to trash: gets in', () => {
    const s = board(st => { st.corp.identity = createCardInstance(st, '34096'); ice(st, '30046', false); installProgramForTest(st, C.CLEAVER); st.runner.grip = st.runner.grip.slice(0, 5); });
    expect(agrees(s).holds).toBe(false);
    expect(oracleOn(s, s.corp.servers.remote1.ice.map(c => c.instanceId))).toBe('getsIn');
  });

  it('G1 mirror: two tags, $5: clearing both (2 clicks, $4) leaves 1 click to run and $1 for a 3-credit toll: holds', () => {
    const s = board(st => { ice(st, C.LAMP); st.runner.tags = 2; st.runner.credits = 5; });
    expect(agrees(s).holds).toBe(true);
  });

  it('G2 mirror: 4 clicks: 3 earn the 3 it pays: gets in', () => {
    const s = board(st => { ice(st, C.LAMP); });
    expect(agrees(s).holds).toBe(false);
    expect(oracleOn(s, [])).toBe('getsIn');
  });
});

// The failed run (ai-hold-retry, brief rev 2 section 2): a run that ends may be followed by another; `need` and `margin`
// stay a single run's (2.5), `holds` and `entries` are the turn's. Each board against the oracle's whole turn
describe('hold walk: a run that fails, then another (brief rev 2)', () => {
  const VICSEK = '36042';
  const VOVO = '34038';
  const pingBoard = (credits: number, clicks = 4) => board(st => { ice(st, C.LAMP); ice(st, C.PING, false); installProgramForTest(st, C.CLEAVER); st.runner.credits = credits; st.runner.maxClicks = clicks; });

  it("Ping's board: a single run is kept out, so `need` is above the budget, yet the turn gets in: margin above 0, holds false, entries 2 (2.5)", () => {
    const s = pingBoard(10);
    const h = agrees(s);
    expect(h.holds).toBe(false);
    expect(h.margin).toBeGreaterThan(0);
    // `entries` is the turn's too: run 1 ended at Ping (its subroutine left unbroken), the tag cleared ($2), then in
    // twice ($1 for Cleaver on Ping, $3 for Lamplighter's first subroutine, each time): $10 and 4 clicks
    expect(h.entries).toBe(2);
    // 3 clicks: one entry
    expect(serverHold(pingBoard(10, 3), 'remote1', { when: 'runnerTurn' }).entries).toBe(1);
  });

  it('an ice that trashed itself is gone on the next run: Vicsek outside Lamplighter, nothing installed, $7: in (its text: "Give the Runner 1 tag. Trash this ice."; 5.2.7g)', () => {
    // Run 1: Vicsek tags and trashes itself, Lamplighter's second subroutine ends the run (tagged); its first is a second
    // tag or 3 paid. Then the tags are cleared (a click and $2 each) and run 2 meets Lamplighter alone: pay 3, not
    // tagged, in. Two tags: 4 clicks and $7; one tag: 3 clicks, the fourth earns 1, $8 - 1: $7 either way. A single run
    // never gets in. The turn's line costs the budget exactly (the retry's own boundary)
    const s = board(st => { ice(st, C.LAMP); ice(st, VICSEK); st.runner.credits = 7; });
    const h = agrees(s);
    expect(h.holds).toBe(false);
    expect(h.need).toBe(Infinity);
    expect(oracleOn(s, [])).toBe('getsIn');
  });

  it('Vicsek mirror: $6: holds (a credit short of the line)', () => {
    const s = board(st => { ice(st, C.LAMP); ice(st, VICSEK); st.runner.credits = 6; });
    const h = agrees(s);
    expect(h.holds).toBe(true);
    expect(oracleOn(s, [])).toBe('holds');
  });

  it("a run ended on purpose: Ping's board at $5, its subroutine left unbroken (Cleaver's break saved for run 2): in", () => {
    // Run 1: Ping rezzed (a tag), its "End the run." left to resolve: nothing paid. A click and $2 clear the tag
    // (5.2.7g); run 2: Ping broken by Cleaver, Lamplighter's first subroutine paid (3), the second finds no tag. Breaking
    // Ping on run 1 too (the line without the ending left in) needs $9
    const s = pingBoard(5);
    const h = agrees(s);
    expect(h.holds).toBe(false);
    expect(oracleOn(s, [s.corp.servers.remote1.ice[1].instanceId])).toBe('getsIn');
  });

  it('the run ended on purpose, mirror: $4: holds', () => {
    const s = pingBoard(4);
    expect(agrees(s).holds).toBe(true);
    expect(oracleOn(s, [s.corp.servers.remote1.ice[1].instanceId])).toBe('holds');
  });

  it('Vicsek mirror: 2 clicks (no click to clear the tag and run again), $7: holds', () => {
    const s = board(st => { ice(st, C.LAMP); ice(st, VICSEK); st.runner.credits = 7; st.runner.maxClicks = 2; });
    const h = agrees(s);
    expect(h.holds).toBe(true);
    expect(oracleOn(s, [])).toBe('holds');
  });

  it("a rez the Corp pays 0 for is a change a retry reads: Ping's board with Vovô Ozetti in the root (Ping's rez cost lowered by 2: its text)", () => {
    const s = pingBoard(10);
    installCorpForTest(s, VOVO, 'remote1', true);
    expect(rezCostOf(s, s.corp.servers.remote1.ice[1])).toBe(0);
    const h = agrees(s);
    expect(h.holds).toBe(false);
    expect(oracleOn(s, [s.corp.servers.remote1.ice[1].instanceId])).toBe('getsIn');
  });
});

describe("hold walk: a run's encounter is this run's (review R2)", () => {
  // A 'runnerTurn' question asked during an encounter (a rez window in a run reads keep) is about the Runner's next turn:
  // the subroutines broken on this encounter are not broken then (6.9.3, 6.9.4: an encounter ends with its run)
  it('rezzed Palisade, Palisade broken on the encounter under way, $0: the next turn still holds, as with no run', () => {
    const s = board(st => { ice(st, C.PALISADE); });
    const id = s.corp.servers.remote1.ice[0].instanceId;
    const before = walk(s);
    const during = structuredClone(s);
    during.activeRun = { ...(during.activeRun ?? {}), server: 'remote1', phase: 'encounter_ice', icePosition: 0, encounter: { iceId: id, broken: [true], boosts: {}, resolvingIndex: null, iceStrengthModifier: 0 } } as GameState['activeRun'];
    const h = walk(during);
    expect(before.holds).toBe(true);
    expect(h.holds).toBe(true);
    expect(h.need).toBe(before.need);
  });
});

// Red team F13 (ruled 02:50Z): cards outside the batch pool the walk does not model yet. The next set's thread, or the
// thread that brings one into a batch deck, turns its line into a row with a mirror and the oracle
describe('hold walk: not modelled yet (cards outside the batch pool)', () => {
  it.todo('Event Horizon: "trash: End the run", a paid ability usable during any run on its server (rezzed: holds whatever the credits)');
  it.todo('Attini at threat 3: credits cannot be spent while its subroutines resolve (no paying through)');
  it.todo('Capacitor: +2 strength while the Runner is tagged (a tag on the way raises the break price)');
  it.todo('Phoneutria and Virtual Service Agent: a tag when the Runner passes the ice');
  it.todo('Cloud Eater');
  it.todo("Logjam's counters placed on rez");
  it.todo('Hammer and Sorocaban Blade: a subroutine that trashes the breaker needed further in (today: not modelled, errs toward "does not hold")');
  it.todo("Thunderbolt Armaments' +1 strength on the ice it rezzes during a run (its gained subroutine is modelled)");
});
