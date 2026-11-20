/**
 * Review fixes 2026-11-19, bundle R (rez), count step (brief: netrunner-ai/review-fixes-1119/rez-count/brief.md): the
 * pins' bodies against each tree (rez-count-trees.ts), the test file untouched. For each tree: "Whitespace toll, the
 * decision" and its Palisade mirror (tests/reviewPins.test.ts:394, 400), "LEO with The Red Room" and its two mirrors,
 * "empty R&D" and its mirror; the boards are the pins' own (built here with the test helpers, played with the tree's
 * agents). On the beta tree, the trace T on the Whitespace board: the measure of the window (__rzMeasureAt, with the
 * priced rez's two boards split into sideStrength's terms) and the Runner's real credits both worlds (as rez-count.ts).
 *
 *   npx vite-node scripts/review-fixes/rez-pin.ts > rez-pin.json
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GameAction, GameState, activePrompt, cardDef, createCardInstance, executeAction, findCardAnywhere, getLegalActions } from '../../src/core';
import { installCorpForTest, installIceForTest, newGame, setIdentity, startRunnerTurn } from '../../tests/helpers';
import { Arm, RZ_ARMS, Tree, loadTree, makeTrees } from './rez-count-trees';

const C = { PALISADE: '30072', UNITY: '30026', WHITESPACE: '30074', SLEIPNIR: '36030', OFFWORLD: '30067', SAM: '30069', LEO: '35035', RED_ROOM: '36045', BRAN: '30039' };
const G = globalThis as any;
const f1: GameState = JSON.parse(readFileSync('tests/fixtures/adversarial/stage-c-f1-hq-toll-rez.json', 'utf8'));

function tollBoard(t: Tree, code: string): GameState {
  const s = structuredClone(f1);
  const mk = (c: string, rez: boolean) => Object.assign(t.core.createCardInstance(s, c), { isRezzed: rez });
  s.runner.rig.programs = s.runner.rig.programs.filter(c => c.cardCode !== C.UNITY);
  s.corp.servers.hq.ice[1] = mk(code, false);
  s.corp.servers['remote-1'].ice = [mk(C.SLEIPNIR, false), mk(C.PALISADE, false)];
  s.corp.credits = 5;
  s.runner.credits = 11;
  return s;
}
const proxy = (agent: any, over: Record<string, unknown>) =>
  new Proxy(agent, {
    get(o, p) {
      if (typeof p === 'string' && p in over) return over[p];
      const v = o[p];
      return typeof v === 'function' ? v.bind(o) : v;
    },
  });
/** The pin's remoteRunAfter: the Normal Corp; the Runner AI runs remote-1 with each click it has outside a run. */
function remoteRunAfter(t: Tree, s: GameState) {
  const ai = t.createAgent('runner', 'normal');
  const runner = proxy(ai, {
    chooseAction: (st: GameState) =>
      (!st.activeRun && st.pendingPrompts.length === 0 && st.activePlayer === 'runner' && st.runner.clicks > 0 && st.corp.servers['remote-1'] ? ({ type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote-1' } as GameAction) : null) ||
      ai.chooseAction(st),
  });
  const g = new t.GameRunner(s, { corp: t.createAgent('corp', 'normal'), runner });
  const moves: string[] = [];
  for (let i = 0; i < 600 && !g.state.winner && g.state.activePlayer === 'runner'; i++) {
    if (!g.step()) break;
    const a = g.last as any;
    if (a?.player === 'corp' && a.type === 'REZ_CARD') moves.push(`rez ${cardDef(findCardAnywhere(g.state, a.cardInstanceId)!).title}`);
  }
  return { stolenSam: g.state.runner.scoreArea.some(c => c.cardCode === C.SAM), corpRezzes: moves, corpCredits: g.state.corp.credits, runnerCredits: g.state.runner.credits };
}

function atHq(leo: boolean, hq: string[]): GameState {
  const s0 = newGame(3);
  s0.corp.hq = [];
  s0.runner.rig = { ...s0.runner.rig, programs: [], hardware: [], resources: [] };
  s0.runner.credits = 0;
  s0.corp.credits = 20;
  s0.turnNumber = 7;
  if (leo) setIdentity(s0, 'corp', C.LEO);
  installIceForTest(s0, C.BRAN, 'hq', true);
  const rr = installCorpForTest(s0, C.RED_ROOM, 'rd', true);
  s0.corp.servers.rd.root.find(c => c.instanceId === rr)!.tokens = { power: 1 };
  s0.corp.hq = hq.map(code => createCardInstance(s0, code));
  startRunnerTurn(s0);
  let s = executeAction(s0, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
  for (let i = 0; i < 30 && s.activeRun && !(s.activeRun.phase === 'approach_server' && s.priority?.holder === 'corp'); i++) {
    const p = activePrompt(s);
    const la = getLegalActions(s, p ? p.side : (s.priority?.holder ?? 'runner'));
    s = executeAction(s, la.find(x => x.type === 'BIOROID_BREAK') ?? la.find(x => x.type === 'CONTINUE_RUN') ?? la.find(x => x.type === 'PASS') ?? la[0]);
  }
  return s;
}
function stopper(t: Tree, s: GameState) {
  const server = s.corp.servers[s.activeRun!.server];
  const cands = server.root.filter(c => !c.isRezzed && t.core.isLegalAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: c.instanceId }));
  const a = t.createAgent('corp', 'normal').chooseRez(structuredClone(s), cands) as any;
  return a?.type === 'USE_ABILITY' ? (findCardAnywhere(s, a.cardInstanceId)?.cardCode ?? null) : (a?.type ?? null);
}
function emptyRd(left: number): GameState {
  const st = newGame(3);
  st.corp.hq = [];
  st.runner.rig = { ...st.runner.rig, programs: [], hardware: [], resources: [] };
  st.runner.credits = 0;
  st.corp.credits = 20;
  st.turnNumber = 7;
  installIceForTest(st, C.PALISADE, 'rd', false);
  const agendas = st.corp.rd.filter(c => cardDef(c).type_code === 'agenda');
  const out = new Set(agendas.slice(left).map(c => c.instanceId));
  st.corp.archives.faceUp.push(...st.corp.rd.filter(c => out.has(c.instanceId)));
  st.corp.rd = st.corp.rd.filter(c => !out.has(c.instanceId));
  return st;
}

/** The Runner's credits once it has passed the Whitespace (rez world) or with it left unrezzed (pass world: no rezzed ice, its credits). */
function realOnPin(t: Tree, s0: GameState, world: 'rez' | 'pass') {
  if (world === 'pass') return s0.runner.credits;
  const ice = s0.corp.servers.hq.ice[1].instanceId;
  const corp = proxy(t.createAgent('corp', 'normal'), { chooseRez: (_s: GameState, cards: any[]) => (cards.some(c => c.instanceId === ice) ? { type: 'REZ_CARD', player: 'corp', cardInstanceId: ice } : null) });
  const g = new t.GameRunner(structuredClone(s0), { corp, runner: t.createAgent('runner', 'normal') });
  for (let i = 0; i < 100; i++) {
    if (!g.step()) return 'out';
    const r = g.state.activeRun;
    if (!r || r.server !== 'hq') return 'out';
    if (r.icePosition === null || r.icePosition < 1) return g.state.runner.credits;
  }
  return 'out';
}

async function main() {
  const arms: Arm[] = ['beta', ...RZ_ARMS];
  const dirs = makeTrees(resolve('node_modules/.cache/rez-pin'), arms);
  const res: Record<string, any> = {};
  for (const arm of arms) {
    const t = await loadTree(arm, dirs[arm]);
    const r: any = {};
    t.clear();
    r.whitespace = remoteRunAfter(t, tollBoard(t, C.WHITESPACE));
    r.whitespacePinPasses = !r.whitespace.stolenSam;
    t.clear();
    r.palisade = remoteRunAfter(t, tollBoard(t, C.PALISADE));
    r.palisadeMirrorPasses = !r.palisade.stolenSam;
    const REPORT_HQ = [C.OFFWORLD, C.OFFWORLD, C.PALISADE, C.PALISADE, C.PALISADE, C.PALISADE];
    t.clear();
    r.leoPin = stopper(t, atHq(true, REPORT_HQ));
    r.leoPinPasses = r.leoPin === C.RED_ROOM;
    t.clear();
    r.leoMirrorSam = stopper(t, atHq(true, [C.SAM, C.SAM, C.SAM]));
    t.clear();
    r.leoMirrorOtherId = stopper(t, atHq(false, REPORT_HQ));
    for (const [k, left] of [
      ['emptyRd', 0],
      ['emptyRdMirror', 1],
    ] as const) {
      const s = emptyRd(left);
      t.clear();
      r[k] = t.inCorp(s, () => t.rez.__rzBoard(s));
    }
    r.emptyRdPinPasses = !('rd' in r.emptyRd.byServer);
    if (arm === 'beta') {
      // The trace T on the pin's board: the deciding Corp's own window, measured (its view: the fixture has no hidden
      // draws to deal that matter here, but the agent's own view is used as in play)
      const s = tollBoard(t, C.WHITESPACE);
      t.clear();
      G.__rzMeasure = true;
      const cands = [s.corp.servers.hq.ice[1]];
      const a = t.createAgent('corp', 'normal').chooseRez(structuredClone(s), cands);
      G.__rzMeasure = false;
      r.trace = { decision: a, dec: G.__rzDec, m: G.__rzM };
      const view = G.__rzView;
      t.clear();
      r.trace.realRez = realOnPin(t, s, 'rez');
      r.trace.realPass = realOnPin(t, s, 'pass');
      const real: any = {};
      if (typeof r.trace.realRez === 'number') real.rez = r.trace.realRez;
      if (typeof r.trace.realPass === 'number') real.pass = r.trace.realPass;
      r.trace.spendsReal = t.inCorp(view, () => t.rez.__rzSpent(view, s.corp.servers.hq.ice[1].instanceId, real));
    }
    res[arm] = r;
  }
  console.log(JSON.stringify(res, null, 1));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
