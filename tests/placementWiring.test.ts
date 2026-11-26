/**
 * Bundle P, the placement wiring fixes of the external review of 2026-11-19 (build brief:
 * /mnt/project-files/netrunner-ai/review-fixes-1119/placement-build/brief.md rev 3; the count and its ruling beside it in
 * placement-count/). The review's own pins are in tests/reviewPins.test.ts, "bundle P".
 *
 * Fix 1 (AI-SCORING-SHORT-DOUBLE-COUNT): lineKeep takes the server a line is on and leaves it out of the pools
 * (rezMoney's `except`, honoured on the next turn too), so scoringShort counts the scoring remote's own holding rez once.
 *
 * Fix 2 (AI-ASSET-COVER-PLANNER-MISMATCH): an asset cover placement's waiting form (no ice pair) is one install, so the
 * candidate is that install (the asset at the iced remote that waits), the move the Corp makes; the ice pair is as before.
 *
 * Rules (Comprehensive Rules v26.03): 6.9.2b the Corp rezzes ice as the Runner approaches it (the holding rez is paid on
 * the Runner's turn, from what the Corp ends its turn on); 8.5.11a an install costs 1 credit per ice already protecting
 * the server; 3.3.1 one agenda or asset in a remote's root.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, cardDef, createCardInstance, getLegalActions, isLegalAction } from '../src/core';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { serverHold } from '../src/ai/corp/hold';
import { lineKeep, rezMoney } from '../src/ai/corp/rezMoney';
import { place, placedInstall, reservedForAgenda, scoreInTwoPick, scoringShort } from '../src/ai/corp/placement';
import { corpCandidates, freeInstallTarget } from '../src/ai/corp/candidates';
import { memo } from '../src/ai/valueModel';
import { isEconAsset } from '../src/ai/cardValues';
import { PW, pairBoards, pwBoard } from './fixtures/placement-wiring/boards';
import { scoringRemote } from '../src/ai/corp/lines';
import { nextTurnCredits } from '../src/ai/nextTurnMoney';
import { asSide, withPricing } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';
import { installCorpForTest, installIceForTest } from './helpers';

const C = { PALISADE: '30072', OFFWORLD: '30067', SAM: '30069', LYCIAN: '34100', MYCOWEB: '35053', PING: '30055' };
const T = 120_000;
const inCorp = <X>(s: GameState, f: () => X): X => asSide('corp', () => (decisionContext(s, 'corp'), f()));
const read = (name: string): GameState => JSON.parse(readFileSync(new URL(`./fixtures/placement-wiring/${name}`, import.meta.url), 'utf8'));
const agendasInHq = (s: GameState) => s.corp.hq.filter(c => cardDef(c).type_code === 'agenda');

const board = pwBoard;

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
  // Restated 2026-11-25 (Corp-side AI Coordinator; runner-rework/r14h-fix/placement-48-42.md): the pin asserted the first
  // pick (Ping on a new remote, a 0.55 margin over GAIN_CREDIT). With the Runner's later-turn money (R-14h, #65) the
  // Corp's reply Runner on that line draws instead of removing Ping's tag, so the Corp takes a credit first; fix 1's
  // quantity is unchanged. The pin now asserts fix 1 itself (remote-1 not short, the floor counted once) and what fix 1
  // removed: no HQ ice goes to remote-1 in the rest of the Corp's turn
  it('report-48 move 42: remote-1 is not short and no ice goes to remote-1 this turn', { timeout: T }, () => {
    const s = read('report-48-42.json');
    expect(inCorp(s, () => scoringShort(s))).toBe(null);
    expect(inCorp(s, () => [lineKeep(s, agendasInHq(s)), lineKeep(s, agendasInHq(s), 'remote-1')])).toEqual([6, 4]);
    expect(s.corp.hq.find(c => c.instanceId === 'inst-47')?.cardCode).toBe(C.PING);
    const iceInHq = new Set(s.corp.hq.filter(c => cardDef(c).type_code === 'ice').map(c => c.instanceId));
    expect(iceInHq.size).toBeGreaterThan(0);
    const g = new GameRunner(structuredClone(s), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
    const played: GameAction[] = [];
    for (let k = 0; k < 40 && !g.state.winner && g.state.turnNumber === s.turnNumber && g.state.activePlayer === 'corp'; k++) {
      if (!g.step()) break;
      if (g.last?.player === 'corp') played.push(g.last);
    }
    expect(played.length).toBeGreaterThan(0);
    const onRemote1 = (a: GameAction) => a.type === 'INSTALL_CARD' && iceInHq.has((a as { cardInstanceId?: string }).cardInstanceId ?? '') && (a as { targetServerId?: string }).targetServerId === 'remote-1';
    expect(played.filter(onRemote1)).toEqual([]);
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

type Install = GameAction & { type: 'INSTALL_CARD'; cardInstanceId: string; targetServerId?: string; asNewRemote?: boolean };
const candidatesOf = (s: GameState) => inCorp(s, () => corpCandidates(s, getLegalActions(s, 'corp'), { held: null, freeExhausted: false }));
const installsOf = (s: GameState, id: string) => getLegalActions(s, 'corp').filter((a): a is Install => a.type === 'INSTALL_CARD' && a.cardInstanceId === id && !(a as { faceUp?: boolean }).faceUp);

describe('fix 2: the asset cover\'s waiting form, the candidate is the install the Corp makes', () => {
  // The review pin's board (tests/reviewPins.test.ts, "asset cover, the waiting remote"): Regolith in HQ, remote-1 a
  // rezzed Palisade with an empty root, no agenda in HQ, Corp 5 and 3 clicks
  const waitingBoard = () =>
    pwBoard(st => {
      installIceForTest(st, PW.PALISADE, 'remote-1', true);
      st.corp.credits = 5;
      st.corp.hq.push(createCardInstance(st, PW.REGOLITH));
    });
  it('Q5 (scoreInTwoPick) given the waiting-form candidate returns it unchanged and begins no line', { timeout: T }, () => {
    const s = waitingBoard();
    const reg = s.corp.hq[0];
    const mine = candidatesOf(s).filter(c => (c.action as Install).cardInstanceId === reg.instanceId);
    expect(mine.map(c => (c.action as Install).targetServerId)).toEqual(['remote-1']);
    const r = inCorp(s, () => scoreInTwoPick(s, mine[0].action, null));
    expect(r.action).toBe(mine[0].action);
    expect(r.held).toBe(null);
    // Beta's candidate (the asset's own install on a new remote) began the asset line whose step is this same install
    const bare = installsOf(s, reg.instanceId).find(a => a.asNewRemote)!;
    const old = inCorp(s, () => scoreInTwoPick(s, bare, null));
    expect(old.action).toEqual(mine[0].action);
    expect(old.held?.line.kind).toBe('asset');
  });

  it('a board with an ice-pair placement has the same candidates, values and order as on the merge base', { timeout: T }, () => {
    const base = JSON.parse(readFileSync(new URL('./fixtures/placement-wiring/pair-candidates.json', import.meta.url), 'utf8'));
    for (const [name, make] of Object.entries(pairBoards)) {
      const s = make();
      const reg = s.corp.hq.find(c => c.cardCode === PW.REGOLITH)!;
      const fromNew = installsOf(s, reg.instanceId).find(a => a.asNewRemote)!;
      expect(inCorp(s, () => place(s, reg, { from: fromNew, held: null }))[0], name).toMatchObject({ reason: 'assetCover', server: 'new' });
      expect(inCorp(s, () => place(s, reg, { from: fromNew, held: null }))[0].pairWith, name).toBeDefined();
      const now = candidatesOf(s).map(c => ({ action: c.action, line: c.line, behind: c.behind, keys: c.keys, card: c.card ?? null }));
      // compared as written (JSON: an infinite key is written null)
      expect(JSON.parse(JSON.stringify(now)), name).toEqual(base[name]);
    }
  });

  // Red team M4: a placed install the engine would refuse keeps today's candidate. No real board was found where it is
  // refused: this asserts that every waiting-form placement on the suite's saved boards is a legal install (and that the
  // saved boards have some).
  it('every waiting-form placement on the saved boards is a legal install (no refusal found)', { timeout: T }, () => {
    const dir = new URL('./fixtures/', import.meta.url);
    const boards: [string, GameState][] = [['waiting', waitingBoard()]];
    for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
      const s = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
      if (s?.corp?.hq && s?.corp?.servers) boards.push([f, s]);
    }
    for (const f of readdirSync(new URL('./placement-wiring/', dir)).filter(f => f.startsWith('report-'))) boards.push([f, JSON.parse(readFileSync(new URL(`./placement-wiring/${f}`, dir), 'utf8'))]);
    let waiting = 0;
    for (const [name, s0] of boards) {
      const s: GameState = { ...structuredClone(s0), activePlayer: 'corp', activeRun: null, pendingPrompts: [], winner: null } as GameState;
      if (s.corp.clicks <= 0) s.corp.clicks = 3;
      for (const card of s.corp.hq.filter(c => cardDef(c).type_code === 'asset' && isEconAsset(c.cardCode))) {
        for (const from of installsOf(s, card.instanceId)) {
          const p = inCorp(s, () => place(s, card, { from, held: null }))[0];
          if (p?.reason !== 'assetCover' || p.pairWith) continue;
          waiting++;
          expect(isLegalAction(s, placedInstall(from, p)), `${name} ${card.cardCode} ${JSON.stringify(p)}`).toBe(true);
        }
      }
    }
    expect(waiting).toBeGreaterThan(0);
  });
});

describe('fix 3: the free install order, once per position and pricing context (valueModel memo)', () => {
  // Bug report #13's board (tests/synapseFreeInstall.test.ts): Synapse Global's free install prompt open, Doomscroll and
  // Offworld Office in HQ
  it('two pricing contexts asked of one state get two entries', { timeout: T }, () => {
    const s: GameState = JSON.parse(readFileSync(new URL('./fixtures/bug-report-13-synapse.json', import.meta.url), 'utf8'));
    const doom = s.corp.hq.find(c => cardDef(c).title === 'Doomscroll')!;
    const options = ['new', ...Object.keys(s.corp.servers)];
    const key = 'freeOrder:' + options.join();
    const cached = () => memo(s, key, () => 'not cached' as unknown);
    const a = inCorp(s, () => [freeInstallTarget(s, doom, options), cached()] as const);
    const b = inCorp(s, () => withPricing({ planning: true }, () => [freeInstallTarget(s, doom, options), cached()] as const));
    expect(Array.isArray(a[1]) && Array.isArray(b[1])).toBe(true);
    expect(b[1]).not.toBe(a[1]);
    expect(a[0]?.server).toBe('rd');
    // Both entries stay: asked again in the first context, its own order
    expect(inCorp(s, () => cached())).toBe(a[1]);
  });
});
