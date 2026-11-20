/**
 * Bundle P, the placement wiring fixes of the external review of 2026-11-19 (build brief:
 * /mnt/project-files/netrunner-ai/review-fixes-1119/placement-build/brief.md rev 3; the count and its ruling beside it in
 * placement-count/). The review's own pins are in tests/reviewPins.test.ts, "bundle P".
 *
 * Fix 1 (AI-SCORING-SHORT-DOUBLE-COUNT): lineKeep takes the server a line is on and leaves it out of the pools
 * (rezMoney's `except`, honoured on the next turn too), so scoringShort counts the scoring remote's own holding rez once.
 *
 * Rules (Comprehensive Rules v26.03): 6.9.2b the Corp rezzes ice as the Runner approaches it (the holding rez is paid on
 * the Runner's turn, from what the Corp ends its turn on); 8.5.11a an install costs 1 credit per ice already protecting
 * the server; 3.3.1 one agenda or asset in a remote's root.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameState, cardDef } from '../src/core';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { serverHold } from '../src/ai/corp/hold';
import { lineKeep, rezMoney } from '../src/ai/corp/rezMoney';
import { reservedForAgenda, scoringShort } from '../src/ai/corp/placement';
import { nextTurnCredits, scoringRemote } from '../src/ai/corp/lines';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';
import { installCorpForTest, installIceForTest, newGame } from './helpers';

const C = { PALISADE: '30072', OFFWORLD: '30067', SAM: '30069', LYCIAN: '34100', MYCOWEB: '35053', PING: '30055' };
const T = 120_000;
const inCorp = <X>(s: GameState, f: () => X): X => asSide('corp', () => (decisionContext(s, 'corp'), f()));
const read = (name: string): GameState => JSON.parse(readFileSync(new URL(`./fixtures/placement-wiring/${name}`, import.meta.url), 'utf8'));
const agendasInHq = (s: GameState) => s.corp.hq.filter(c => cardDef(c).type_code === 'agenda');

/** A Corp turn-7 board (as tests/reviewPins.test.ts): empty rig and HQ, the Runner at $0 and 4 clicks. */
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

/** The review pin's board: remote-1 an unrezzed Palisade with Offworld Office in the root, R&D a rezzed Palisade, 1 click. */
const shortBoard = (corp: number) =>
  board(st => {
    installIceForTest(st, C.PALISADE, 'remote-1', false);
    installCorpForTest(st, C.OFFWORLD, 'remote-1');
    installIceForTest(st, C.PALISADE, 'rd', true);
    st.corp.credits = corp;
    st.corp.clicks = 1;
  });

describe('fix 1: the scoring remote\'s own holding rez counted once (rezMoney `except` on the next turn)', () => {
  it('on the pin\'s board, except remote-1 leaves remote-1 out of byServer and keep is the keep of the pools without it', { timeout: T }, () => {
    const s = shortBoard(5);
    const plain = inCorp(s, () => rezMoney(s));
    const once = inCorp(s, () => rezMoney(s, { except: 'remote-1' }));
    expect(plain).toMatchObject({ keep: 3, byServer: { rd: 0, 'remote-1': 3 } });
    expect(once.byServer).toEqual({ rd: 0 });
    expect(once.keep).toBe(0);
    // The same as the pools with remote-1's agenda gone (nothing else differs)
    const without = inCorp(s, () => rezMoney(s, { without: s.corp.servers['remote-1'].root.map(c => c.instanceId) }));
    expect(once).toEqual(without);
    // scoringShort reads lineKeep with the remote out: 5 - 0 covers the Palisade's 3 (the pin in reviewPins.test.ts)
    expect(inCorp(s, () => lineKeep(s, agendasInHq(s), 'remote-1'))).toBe(0);
    expect(inCorp(s, () => lineKeep(s, agendasInHq(s)))).toBe(3);
  });

  it('asked with and without except, in both orders, the two answers do not leak into each other (the memo)', { timeout: T }, () => {
    const a = shortBoard(5);
    const b = structuredClone(a);
    const plainFirst = inCorp(a, () => [rezMoney(a), rezMoney(a, { except: 'remote-1' })]);
    const exceptFirst = inCorp(b, () => [rezMoney(b, { except: 'remote-1' }), rezMoney(b)]);
    expect(plainFirst[0]).toEqual(exceptFirst[1]);
    expect(plainFirst[1]).toEqual(exceptFirst[0]);
    expect(plainFirst[0]).not.toEqual(plainFirst[1]);
    // Asked again, each form returns its own memoised answer
    inCorp(a, () => {
      expect(rezMoney(a, { except: 'remote-1' })).toBe(plainFirst[1]);
      expect(rezMoney(a)).toBe(plainFirst[0]);
    });
  });

  it('two staked remotes: only the line\'s own server leaves the pools', { timeout: T }, () => {
    const s = board(st => {
      installIceForTest(st, C.PALISADE, 'remote-1', false);
      installCorpForTest(st, C.OFFWORLD, 'remote-1');
      installIceForTest(st, C.PALISADE, 'remote-2', false);
      installCorpForTest(st, C.SAM, 'remote-2');
      installIceForTest(st, C.PALISADE, 'rd', true);
    });
    const plain = inCorp(s, () => rezMoney(s));
    expect(Object.keys(plain.byServer)).toEqual(['rd', 'remote-1', 'remote-2']);
    const once = inCorp(s, () => rezMoney(s, { except: 'remote-1' }));
    expect(Object.keys(once.byServer)).toEqual(['rd', 'remote-2']);
    expect(once.byServer['remote-2']).toBe(plain.byServer['remote-2']);
    expect(once.byServer.rd).toBe(plain.byServer.rd);
    const other = inCorp(s, () => rezMoney(s, { except: 'remote-2' }));
    expect(Object.keys(other.byServer)).toEqual(['rd', 'remote-1']);
  });

  it('except naming a server that stakes nothing: the plain answer, the same object the memo holds', { timeout: T }, () => {
    const s = shortBoard(5);
    s.corp.servers['remote-2'] = { id: 'remote-2', name: 'remote-2', isRemote: true, ice: [], root: [] };
    installIceForTest(s, C.PALISADE, 'remote-2', true);
    inCorp(s, () => {
      const plain = rezMoney(s);
      expect(rezMoney(s, { except: 'remote-2' })).toBe(plain);
      expect(rezMoney(s, { except: 'hq' })).toBe(plain);
    });
  });

  // Red team M1: the joint question is not asked. A lender on the scoring remote (Lycian Multi-Munition, unrezzed) and
  // a second staked server whose ice borrows (Mycoweb, rezzed, "Resolve 1 subroutine on a rezzed sentry"): the other
  // server's own answer is serverHold's, asked alone, and does not move with `except`.
  it('with a lender on the scoring remote, the other staked server\'s answer is the same with and without except', { timeout: T }, () => {
    const s = board(st => {
      installIceForTest(st, C.LYCIAN, 'remote-1', false);
      installIceForTest(st, C.PALISADE, 'remote-1', false);
      installCorpForTest(st, C.OFFWORLD, 'remote-1');
      installIceForTest(st, C.MYCOWEB, 'remote-2', true);
      installCorpForTest(st, C.SAM, 'remote-2');
      st.corp.archives.faceUp = [];
      st.corp.archives.faceDown = [];
    });
    expect(inCorp(s, () => scoringRemote(s)?.id)).toBe('remote-1');
    const plain = inCorp(s, () => rezMoney(s));
    const once = inCorp(s, () => rezMoney(s, { except: 'remote-1' }));
    expect('remote-2' in plain.byServer || plain.unholdable.includes('remote-2')).toBe(true);
    expect(once.byServer['remote-2']).toBe(plain.byServer['remote-2']);
    expect(once.rezIds['remote-2']).toEqual(plain.rezIds['remote-2']);
    expect(once.unholdable.includes('remote-2')).toBe(plain.unholdable.includes('remote-2'));
  });

  // The count's one in-class board (bundle P count note, shortOnce (a); human file report-48, move 42, turn 4, the AI
  // Corp at 4 credits and 3 clicks): remote-1 (Funhouse, Ping, Witch Hunt to come) read short only by the double count
  // (floor 6 against 4 once), so the three HQ ice went to remote-1 and the Corp took a credit; counted once remote-1 is
  // not short and Ping goes to a new remote.
  it('report-48 move 42: the Corp installs Ping on a new remote', { timeout: T }, () => {
    const s = read('report-48-42.json');
    expect(inCorp(s, () => scoringShort(s))).toBe(null);
    expect(inCorp(s, () => [lineKeep(s, agendasInHq(s)), lineKeep(s, agendasInHq(s), 'remote-1')])).toEqual([6, 4]);
    const g = new GameRunner(structuredClone(s), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
    g.step();
    expect(g.last).toEqual({ type: 'INSTALL_CARD', player: 'corp', cardInstanceId: 'inst-47', asNewRemote: true });
    expect(s.corp.hq.find(c => c.instanceId === 'inst-47')?.cardCode).toBe(C.PING);
  });

  // 1b: reservedForAgenda keeps reading the pools as before fix 1 (the corrected input was counted and not built: its
  // known-failing pin is in tests/reviewPins.test.ts). On report-48 move 59 (turn 6, Corp 3 credits, 2 clicks) its floor
  // is still lineKeep without the server, and its answer is null as on beta.
  it('report-48 move 59: reservedForAgenda reads the floor without except, as before fix 1 (null)', { timeout: T }, () => {
    const s = read('report-48-59.json');
    expect(inCorp(s, () => scoringRemote(s)?.id)).toBe('remote-1');
    expect(inCorp(s, () => [lineKeep(s, agendasInHq(s)), lineKeep(s, agendasInHq(s), 'remote-1')])).toEqual([6, 4]);
    expect(inCorp(s, () => reservedForAgenda(s))).toBe(null);
    // The line's horizon (reservedForAgenda's: what the Corp ends on, its known income, next turn's clicks): with the
    // floor of today remote-1 does not hold on it; with the remote left out (the corrected input) it does
    const horizon = inCorp(s, () => nextTurnCredits(s, s.corp.credits + Math.max(0, s.corp.clicks - 1), 0, 0));
    const holdsOn = (floor: number) => inCorp(s, () => serverHold(s, 'remote-1', { when: 'runnerTurn', corpCredits: horizon - floor }).holds);
    expect([holdsOn(6), holdsOn(4)]).toEqual([false, true]);
  });
});
