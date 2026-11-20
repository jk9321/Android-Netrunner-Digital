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
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, activePrompt, cardDef, createCardInstance, executeAction, findCardAnywhere, getLegalActions } from '../src/core';
import { createAgent } from '../src/ai';
import { rezCandidates } from '../src/ai/playout';
import { installCorpForTest, installIceForTest, newGame, setIdentity, startRunnerTurn } from './helpers';

const C = {
  PALISADE: '30072', LEO: '35035', RED_ROOM: '36045', BRAN: '30039', OFFWORLD: '30067', EVENT_HORIZON: '36058',
  PROPRIONEGATION: '35048',
};
const T = 120_000;

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
