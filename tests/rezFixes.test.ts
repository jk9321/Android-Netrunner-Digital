/**
 * The rez fixes of the external review's bundle R (build brief /mnt/project-files/netrunner-ai/review-fixes-1119/
 * rez-build/brief.md, rev 1; count and ruling in rez-count/). The pins themselves are in tests/reviewPins.test.ts,
 * "bundle R"; these are the brief's further tests. Each is named for what it asserts: where the answer is a run
 * stopper's threshold, "by today's thresholds" (the thresholds price nothing and are registry debt,
 * docs/ai-priced-quantities.md), not "right".
 *
 * Rules (Comprehensive Rules v26.03): 6.9.4e the Corp's paid ability window at the approach to the server (where the
 * run stoppers are used); 6.4.3 and 6.9.2b the Corp rezzes ice as it is approached; 10.2.2a the Corp knows the set of
 * its cards in R&D, never their order (agendasUnseen).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, activePrompt, cardDef, createCardInstance, executeAction, findCardAnywhere, getLegalActions } from '../src/core';
import { createAgent } from '../src/ai';
import { rezCandidates } from '../src/ai/playout';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';
import { rezMoney } from '../src/ai/corp/rezMoney';
import { agendasUnseen } from '../src/ai/corp/pools';
import { countedRez, spendsKept } from '../src/ai/corp/rez';
import { installCorpForTest, installIceForTest, newGame, setIdentity, startRunnerTurn } from './helpers';

const C = {
  PALISADE: '30072', LEO: '35035', RED_ROOM: '36045', BRAN: '30039', OFFWORLD: '30067', EVENT_HORIZON: '36058',
  PROPRIONEGATION: '35048', SLEIPNIR: '36030',
};
const T = 120_000;
const inCorp = <X>(s: GameState, f: () => X): X => asSide('corp', () => (decisionContext(s, 'corp'), f()));

/** A Corp turn-7 board (as tests/reviewPins.test.ts): empty rig and HQ, the Runner at $0, the Corp at $20. */
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

describe('A: LEO falls through to the other run stoppers when its trash is not worth it', () => {
  // The pin's board (reviewPins.test.ts, "LEO with The Red Room"): rezzed Brân 1.0 on HQ, broken with the Runner's
  // three clicks; the Corp's window at the approach to HQ (6.9.4e). Options add or take away the other stoppers.
  interface Opts { leo?: boolean; redRoom?: boolean; archivesAgenda?: boolean; proprionegation?: boolean }
  const atHq = (hq: string[], o: Opts = {}) => {
    const s0 = board(st => {
      if (o.leo ?? true) setIdentity(st, 'corp', C.LEO);
      installIceForTest(st, C.BRAN, 'hq', true);
      if (o.redRoom ?? true) {
        const rr = installCorpForTest(st, C.RED_ROOM, 'rd', true);
        st.corp.servers.rd.root.find(c => c.instanceId === rr)!.tokens = { power: 1 };
      }
      st.corp.hq = hq.map(code => createCardInstance(st, code));
      if (o.archivesAgenda) {
        const i = st.corp.rd.findIndex(c => cardDef(c).type_code === 'agenda');
        st.corp.archives.faceDown.push(...st.corp.rd.splice(i, 1));
      }
      if (o.proprionegation) st.corp.scoreArea.push(Object.assign(createCardInstance(st, C.PROPRIONEGATION), { tokens: { agenda: 1 } }));
    });
    startRunnerTurn(s0);
    let s = executeAction(s0, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    for (let i = 0; i < 30 && s.activeRun && !(s.activeRun.phase === 'approach_server' && s.priority?.holder === 'corp'); i++) {
      const p = activePrompt(s);
      const la = getLegalActions(s, p ? p.side : s.priority?.holder ?? 'runner');
      s = executeAction(s, la.find(x => x.type === 'BIOROID_BREAK') ?? la.find(x => x.type === 'CONTINUE_RUN') ?? la.find(x => x.type === 'PASS') ?? la[0]);
    }
    expect([s.activeRun?.phase, s.priority?.holder]).toEqual(['approach_server', 'corp']);
    return s;
  };
  /** A fresh copy with a rezzed Event Horizon added to HQ's ice, before anything is asked of the copy. */
  const withHorizon = (s0: GameState) => {
    const s = structuredClone(s0);
    s.corp.servers.hq.ice.push(Object.assign(createCardInstance(s, C.EVENT_HORIZON), { isRezzed: true }));
    return s;
  };
  const usable = (s: GameState) => getLegalActions(s, 'corp').flatMap(a => (a.type === 'USE_ABILITY' ? [findCardAnywhere(s, a.cardInstanceId)?.cardCode] : [])).sort();
  const stopper = (s: GameState) => {
    const a = createAgent('corp', 'normal').chooseRez!(structuredClone(s), rezCandidates(s, 'approach_server')) as (GameAction & { cardInstanceId?: string }) | null;
    return a?.type === 'USE_ABILITY' ? findCardAnywhere(s, a.cardInstanceId!)?.cardCode ?? null : a?.type ?? null;
  };
  // The report's HQ: 2 Offworld Office, 4 Palisade; HQ's importance 3 + 2 + 2 = 7 (serverImportance, aware)
  const REPORT_HQ = [C.OFFWORLD, C.OFFWORLD, C.PALISADE, C.PALISADE, C.PALISADE, C.PALISADE];
  // The report's two Offworld Office in an HQ of 12 (importance 7 as the report's)
  const BIG_HQ = [C.OFFWORLD, C.OFFWORLD, ...Array<string>(10).fill(C.PALISADE)];
  // One Offworld Office in six: importance 3 + 2 = 5, under the stoppers' 6
  const LOW_HQ = [C.OFFWORLD, C.PALISADE, C.PALISADE, C.PALISADE, C.PALISADE, C.PALISADE];

  it('LEO not worth it and no other stopper legal: no stopper (today\'s answer)', { timeout: T }, () => {
    const s = atHq(REPORT_HQ, { redRoom: false });
    expect(usable(s)).toEqual([C.LEO]);
    expect(stopper(s)).toBe(null);
  });
  it('LEO not worth it, The Red Room legal, importance under 6: no stopper, by today\'s thresholds', { timeout: T }, () => {
    const s = atHq(LOW_HQ);
    expect(usable(s)).toEqual([C.LEO, C.RED_ROOM].sort());
    expect(stopper(s)).toBe(null);
  });
  it('LEO not worth it, Event Horizon legal, importance 7: Event Horizon, by today\'s thresholds', { timeout: T }, () => {
    const s = withHorizon(atHq(BIG_HQ, { redRoom: false }));
    expect(usable(s)).toEqual([C.LEO, C.EVENT_HORIZON].sort());
    expect(stopper(s)).toBe(C.EVENT_HORIZON);
  });
  it('LEO not worth it, Event Horizon legal, importance under 7: no stopper, by today\'s thresholds', { timeout: T }, () => {
    const s = withHorizon(atHq(LOW_HQ, { redRoom: false }));
    expect(usable(s)).toEqual([C.LEO, C.EVENT_HORIZON].sort());
    expect(stopper(s)).toBe(null);
  });
  it('LEO not worth it, importance 7, Proprionegation legal, no agenda in Archives: Proprionegation, by today\'s thresholds', { timeout: T }, () => {
    const s = atHq(REPORT_HQ, { redRoom: false, proprionegation: true });
    expect(usable(s)).toEqual([C.LEO, C.PROPRIONEGATION].sort());
    expect(stopper(s)).toBe(C.PROPRIONEGATION);
  });
  it("LEO not worth it, importance 7, Proprionegation legal, an agenda face down in Archives: not Proprionegation (its own guard holds after the fall-through)", { timeout: T }, () => {
    const s = atHq(REPORT_HQ, { redRoom: false, proprionegation: true, archivesAgenda: true });
    expect(usable(s)).toEqual([C.LEO, C.PROPRIONEGATION].sort());
    expect(stopper(s)).toBe(null);
  });
});

describe('B: R&D is staked only while the deck list has an agenda left in it', () => {
  /**
   * The pin's board (reviewPins.test.ts, "empty R&D"): unrezzed Palisade on R&D, the Runner with no program; `left` of
   * the deck's R&D agendas stay in R&D, the rest go to Archives face up. With `remote`, the deck's last R&D agenda (the
   * same on every board) is installed in remote-1 behind an unrezzed Palisade.
   */
  const rdBoard = (left: number, remote = false) =>
    board(st => {
      installIceForTest(st, C.PALISADE, 'rd', false);
      const agendas = st.corp.rd.filter(c => cardDef(c).type_code === 'agenda');
      // The same agenda goes to the remote on every board
      const inRemote = remote ? agendas.pop()! : undefined;
      const out = agendas.slice(left);
      st.corp.rd = st.corp.rd.filter(c => !out.includes(c) && c !== inRemote);
      if (inRemote) {
        installIceForTest(st, C.PALISADE, 'remote-1', false);
        st.corp.servers['remote-1'].root.push(inRemote);
      }
      st.corp.archives.faceUp.push(...out);
    });

  it('no agenda left in R&D, an agenda in a remote: byServer holds the remote and not R&D; the remote\'s number is the one the board gives with an agenda left in R&D, and keep is that number', { timeout: T }, () => {
    const empty = rdBoard(0, true);
    const one = rdBoard(1, true);
    expect(inCorp(empty, () => agendasUnseen(empty))).toBe(0);
    expect(inCorp(one, () => agendasUnseen(one))).toBe(1);
    const e = inCorp(empty, () => rezMoney(empty));
    const o = inCorp(one, () => rezMoney(one));
    expect(Object.keys(e.byServer)).toEqual(['remote-1']);
    expect(Object.keys(o.byServer)).toEqual(['rd', 'remote-1']);
    expect(e.byServer['remote-1']).toBeGreaterThan(0);
    expect(e.byServer['remote-1']).toBe(o.byServer['remote-1']);
    expect(e.keep).toBe(e.byServer['remote-1']);
  });

  it('an agenda back in R&D from Archives (a fresh copy of the empty board) stakes R&D again', { timeout: T }, () => {
    const empty = rdBoard(0);
    const back = structuredClone(empty);
    const i = back.corp.archives.faceUp.findIndex(c => cardDef(c).type_code === 'agenda');
    back.corp.rd.push(...back.corp.archives.faceUp.splice(i, 1));
    expect(inCorp(empty, () => agendasUnseen(empty))).toBe(0);
    expect(inCorp(empty, () => rezMoney(empty)).byServer).not.toHaveProperty('rd');
    expect(inCorp(back, () => agendasUnseen(back))).toBe(1);
    expect(inCorp(back, () => rezMoney(back))).toMatchObject({ byServer: { rd: 3 } });
  });

  // The rest-of-turn keep (spendsKept, F1) reads the same staked servers. F1's board (tests/fixtures/adversarial/
  // stage-c-f1-hq-toll-rez.json: a run on HQ at its outer ice, unrezzed Palisade, Offworld Office in HQ) reshaped as the
  // review pins' toll board: Unity taken off (Cleaver only: nothing breaks Sleipnir), R&D's ice an unrezzed Sleipnir,
  // remote-1 gone (its Send a Message with it), the Corp at 5, the Runner at 11. R3's toll: spendsKept passes it when
  // the rez leaves the Corp short of the money kept for R&D, which it keeps only while an agenda is left there.
  const f1: GameState = JSON.parse(readFileSync(new URL('./fixtures/adversarial/stage-c-f1-hq-toll-rez.json', import.meta.url), 'utf8'));
  const tollBoard = (left: number) => {
    const s = structuredClone(f1);
    s.runner.rig.programs = s.runner.rig.programs.filter(c => c.cardCode !== '30026');
    s.corp.servers.rd.ice = [Object.assign(createCardInstance(s, C.SLEIPNIR), { isRezzed: false })];
    delete s.corp.servers['remote-1'];
    const agendas = s.corp.rd.filter(c => cardDef(c).type_code === 'agenda');
    const out = agendas.slice(left);
    s.corp.rd = s.corp.rd.filter(c => !out.includes(c));
    s.corp.archives.faceUp.push(...out);
    s.corp.credits = 5;
    s.runner.credits = 11;
    expect([s.activeRun?.server, s.activeRun?.icePosition, s.runner.clicks]).toEqual(['hq', 1, 3]);
    expect(s.corp.hq.some(c => c.cardCode === C.OFFWORLD)).toBe(true);
    expect(s.corp.servers.hq.ice[1]).toMatchObject({ cardCode: C.PALISADE, isRezzed: false });
    return s;
  };
  it('R3 toll on HQ, no agenda left in R&D: spendsKept is false (nothing staked outside HQ) and the toll is rezzed', { timeout: T }, () => {
    const s = tollBoard(0);
    const ice = s.corp.servers.hq.ice[1];
    expect(inCorp(s, () => agendasUnseen(s))).toBe(0);
    expect(inCorp(s, () => spendsKept(s, ice))).toBe(false);
    expect(inCorp(s, () => countedRez(s, ice))).toBe('rez');
  });
  it('R3 toll mirror, one agenda left in R&D: spendsKept is true (the rez spends the money kept for Sleipnir) and the toll is passed', { timeout: T }, () => {
    const s = tollBoard(1);
    const ice = s.corp.servers.hq.ice[1];
    expect(inCorp(s, () => agendasUnseen(s))).toBe(1);
    expect(inCorp(s, () => spendsKept(s, ice))).toBe(true);
    expect(inCorp(s, () => countedRez(s, ice))).toBe('pass');
  });
});
