/**
 * Stage D, "programs hosted on Madani are not read by the hold count", the count step (brief:
 * /mnt/project-files/netrunner-ai/stage-d/madani-hosted/brief.md). Scripts only: the arm is text patches on copies of
 * src/ (madani-hosted-arms.json, built by madani-hosted-arms.mjs; runner-money-trees.ts makeTrees). Sources: the fire
 * count's 92, the 56 local deals played by this checkout's Normal AIs and the human games replayed
 * (scripts/stage-a/harness.ts), split by SHARD. Generated servers and the worst board are split by SHARD too.
 *
 * Found row 71b: the tree that plays a source game (this checkout) is never asked or cleared. Every question goes to a
 * copy: `beta` (identical), `control` (identical, the time base), `hosted` (the arm), `probe` (beta recording every
 * serverHold question a decision asks, with its board and caller: measuring only, never timed or compared).
 *
 * JSON lines:
 *  - `d` (fire, Q3): every Corp decision asked of beta, control and hosted on their own structuredClone by a fresh Normal
 *    Corp, order rotated, timed (a decision over a stop is timed twice more, both trees, medians kept); `pres` marks a
 *    board with a public card out of the rig (Madani's hosted programs, Bling's hosted cards, a Muse hosted on Madani,
 *    Jeitinho in the heap at threat 3); where hosted's pick differs from beta's both are played on by GameRunner (CONT).
 *  - `q` (Q2): on a board with a program hosted on Madani, every hold question the decision asks (probe), deduplicated by
 *    board, server and options: its caller, beta's answer, the arm's answer on the same board, and the engine oracle's
 *    (scripts/stage-d/hold-oracle.ts; 'runnerTurn' with retries, the turn's truth: does some affordable set keep the
 *    Runner out; 'thisRun' from the run as it stands; 'restOfTurn' is not asked of it).
 *  - `c` (Q3): a commit (an agenda installed or advanced in a remote) on such a board: the hold after it, beta and arm,
 *    and what the arm's Corp does instead.
 *  - `run`: every run (server, outcome, agendas stolen), so a wrong answer can be followed to how its exposure ended.
 *  - `p`: a local deal's record (cr, sc at each Corp turn start; the winner), checked against the g1 batch's deals.json.
 *  - `g` (Q3): a generated server with Madani and 1 to 4 hosted programs: beta, the arm, the oracle.
 *  - `w` (Q3): the worst board's times (four hosted programs, two trojans, five ice): control and the arm, median of 3.
 * Hidden information: the copies are asked on the Corp's view or by a Normal Corp, which builds its own; no arm reads the
 * grip, the stack's order or a facedown card. The measuring side reads the real board for presence and the oracle.
 *
 *   SHARD=0/64 npx vite-node scripts/stage-d/madani-hosted.ts
 *   DEALS=none HUMAN=report-40 PARTS=fire,q2 npx vite-node scripts/stage-d/madani-hosted.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { CardInstance, GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction, rezCostOf, wantsStop } from '../../src/core';
import { createCardInstance } from '../../src/core/engine/gameState';
import { getCardScript } from '../../src/core';
import { threatLevel } from '../../src/core/engine/cardEffects';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { deals, dealState, humanFiles } from '../stage-a/harness';
import { deckGameSetup } from '../../src/data/decks';
import { makeTrees, readArms } from './runner-money-trees';
import { Tree, askAction, askRez, isRezWindow, key, loadTree, serverKind } from './rez-follow-lib';
import { oracleGetsIn } from './hold-oracle';
import { oracleGetsIn as oracleGetsInX } from './madani-hosted-oracle';
import { memoryLimit } from '../../src/core/engine/cardEffects';
import { breakerCodes, iceCodes } from './golden-prices';
import { installIceForTest, installProgramForTest, newGame } from '../../tests/helpers';

for (const kv of (process.env.ARGS ?? '').split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
process.env.ARMS_FILE ||= 'scripts/stage-d/madani-hosted-arms.json';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const PARTS = new Set((process.env.PARTS ?? 'fire,q2,cont,gen,worst').split(','));
const TREES = ['beta', 'control', 'hosted'];
const GEN = Number(process.env.GEN ?? 2000);
const ORACLE_CAP = Number(process.env.ORACLE_CAP ?? 150_000);
const Q2_CAP = Number(process.env.Q2_CAP ?? 80);
// FROM_I, TO_I: only a human game's decisions numbered in [FROM_I, TO_I) are asked (a resume of a shard cut by its timeout)
const inRange = (i: number) => i >= Number(process.env.FROM_I ?? 0) && i < Number(process.env.TO_I ?? Infinity);
const root = resolve(process.env.TROOT ?? '.mh-fire', String(shard));
const r1 = (x: number) => Math.round(x * 10) / 10;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const isAgenda = (c: CardInstance) => cardDef(c).type_code === 'agenda';
const rigOf = (s: GameState) => [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources];
const MADANI = '35028';
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));

/** The measuring side's reading of the class (Q1): which public cards out of the rig a board has. */
function presence(s: GameState) {
  const rig = rigOf(s);
  const mad = rig.find(c => c.cardCode === MADANI);
  const hosted = (mad?.hostedCards ?? []).filter(c => cardDef(c).type_code === 'program');
  const walked = hosted.filter(c => /icebreaker/i.test(cardDef(c).keywords ?? '') || !!getCardScript(c.cardCode)?.installsOnIce);
  const bling = rig.filter(c => c.cardCode === '35006').reduce((n, c) => n + (c.hostedCards?.length ?? 0), 0);
  return {
    madani: hosted.map(c => cardDef(c).title),
    walked: walked.length > 0,
    used: mad ? (s.turnFlags?.[`ability:${mad.instanceId}:1`] ?? 0) > 0 : false,
    bling,
    muse: hosted.some(c => c.cardCode === '34091'),
    jeitinho: threatLevel(s) >= 3 && s.runner.heap.some(c => c.cardCode === '34079'),
  };
}
const anyPres = (p: ReturnType<typeof presence>) => p.madani.length > 0 || p.bling > 0 || p.jeitinho;

const plainOracle = oracleGetsIn;
const memOf = (c: CardInstance) => (cardDef(c).type_code === 'program' ? cardDef(c).memory_cost || 0 : 0);
/** Memory: full now, and whether some install of the hosted programs can go over it (only then can the extended oracle differ). */
function memory(s: GameState) {
  const limit = memoryLimit(s);
  const hostedMU = rigOf(s).flatMap(c => (c.cardCode === MADANI || c.cardCode === '35006' ? (c.hostedCards ?? []) : [])).reduce((n, c) => n + memOf(c), 0);
  return { used: s.runner.memoryUnitsUsed, limit, full: s.runner.memoryUnitsUsed >= limit, over: s.runner.memoryUnitsUsed + hostedMU > limit };
}
/** Plain and extended oracle (madani-hosted-oracle.ts, rule 8.5.6c); the extended one asked only where an install can go over memory. */
function oracles(s: GameState, server: string, opts: Parameters<typeof oracleAnswer>[2]) {
  const o = oracleAnswer(s, server, opts);
  const mem = memory(s);
  const x = mem.over ? oracleAnswer(s, server, opts, oracleGetsInX) : o;
  return { o, x, mem };
}

const hashOf = (s: GameState) => {
  const rest: Partial<GameState> = { ...s };
  delete rest.log;
  return createHash('sha1').update(JSON.stringify(rest)).digest('base64').slice(0, 16);
};

type HoldLike = { holds: boolean; rez: string[] | null; rezCost: number; need: number; budget: number };
const hOut = (h: HoldLike) => ({ holds: h.holds, rez: h.rez, cost: Number.isFinite(h.rezCost) ? h.rezCost : null, need: Number.isFinite(h.need) ? Math.round(h.need * 100) / 100 : 'inf', budget: h.budget });

/** The engine oracle's answer to a hold question on board `s` (see the file comment). */
function oracleAnswer(s: GameState, server: string, opts: { when: string; corpCredits?: number; mustRez?: string[]; further?: boolean }, oracleGetsIn: typeof oracleGetsInX = plainOracle): { answer: string; sets: string[]; work: number } {
  const ice = s.corp.servers[server]?.ice ?? [];
  const credits = opts.corpCredits ?? s.corp.credits;
  const sets: string[] = [];
  let work = 0;
  let unknown = false;
  if (opts.when === 'restOfTurn') return { answer: 'n/a', sets, work };
  if (opts.when === 'thisRun') {
    const run = s.activeRun;
    if (!run || run.server !== server) return { answer: 'n/a', sets, work };
    const pos = run.icePosition ?? -1;
    const must = opts.mustRez ?? [];
    const open = (opts.further ?? true) ? ice.slice(0, Math.max(0, pos)).filter(c => !c.isRezzed && !must.includes(c.instanceId)).slice(0, 6) : [];
    for (let mask = 0; mask < 1 << open.length; mask++) {
      const set = [...must, ...open.filter((_, i) => mask & (1 << i)).map(c => c.instanceId)];
      const a = oracleGetsIn(s, server, 'thisRun', set, credits, ORACLE_CAP);
      work += a.work;
      sets.push(`[${set}]:${a.answer}`);
      if (a.answer === 'holds') return { answer: 'holds', sets, work };
      if (a.answer !== 'getsIn') unknown = true;
    }
    return { answer: unknown ? 'unknown' : 'getsIn', sets, work };
  }
  const open = ice.filter(c => !c.isRezzed).slice(0, 6);
  const all: { set: string[]; cost: number }[] = [];
  for (let mask = 0; mask < 1 << open.length; mask++) {
    const pick = open.filter((_, i) => mask & (1 << i));
    const cost = pick.reduce((n, c) => n + rezCostOf(s, c), 0);
    if (Number.isFinite(credits) && cost > credits) continue;
    all.push({ set: pick.map(c => c.instanceId), cost });
  }
  all.sort((a, b) => a.cost - b.cost);
  for (const { set } of all) {
    const a = oracleGetsIn(s, server, 'runnerTurn', set, credits, ORACLE_CAP, true);
    work += a.work;
    sets.push(`[${set}]:${a.answer}`);
    if (a.answer === 'holds') return { answer: 'holds', sets, work };
    if (a.answer === 'skipped') return { answer: `skipped`, sets, work };
    if (a.answer !== 'getsIn') unknown = true;
  }
  return { answer: unknown ? 'unknown' : 'getsIn', sets, work };
}

/** The frame that asked serverHold: its function and file:line inside the tree's src. */
function callerOf(stack: string): string {
  const lines = stack.split('\n').slice(1).map(l => l.trim());
  const i = lines.findIndex(l => /serverHold\b/.test(l) && !/serverHoldAsked/.test(l));
  const frame = lines[i + 1] ?? lines[2] ?? '';
  const m = /at (?:([\w.$<>]+) )?\(?.*?src\/(.*?):(\d+):\d+\)?$/.exec(frame);
  return m ? `${m[2]}:${m[3]} ${m[1] ?? ''}`.trim() : frame.slice(0, 80);
}

async function main() {
  const file = readArms();
  const dirs = makeTrees(file, root);
  const trees: Record<string, Tree> = {};
  for (const t of Object.keys(file.arms)) trees[t] = await loadTree(t, dirs[t]);
  const beta = trees.beta;
  const hosted = trees.hosted;

  const holdIn = (t: Tree, s: GameState, server: string, opts: Record<string, unknown>): HoldLike =>
    t.asSide('corp', () => {
      t.decisionContext(s, 'corp');
      return t.serverHold(s, server, opts);
    });

  // ------------------------------------------------------------------------------------------------ continuations
  const cont = (t: string, s: GameState) => {
    trees[t].clear();
    beta.clear();
    const g = new trees[t].GameRunner(structuredClone(s), { corp: trees[t].createAgent('corp', 'normal'), runner: beta.createAgent('runner', 'normal') });
    const marks: { ended: string; corp: number; runner: number; credits: number; T: number }[] = [];
    let last = g.state.activePlayer;
    for (let n = 0; n < 6000 && !g.state.winner; n++) {
      if (!g.step()) break;
      if (g.state.activePlayer !== last) {
        marks.push({ ended: last, corp: g.state.corp.score, runner: g.state.runner.score, credits: g.state.corp.credits, T: g.state.turnNumber });
        last = g.state.activePlayer;
      }
    }
    return { marks: marks.slice(0, 4), end: { corp: g.state.corp.score, runner: g.state.runner.score, T: g.state.turnNumber }, winner: g.state.winner ?? null };
  };

  // ------------------------------------------------------------------------------------------------ fire (and Q2)
  let n = 0;
  const decision = (src: string, i: number, s: GameState, dk: 'rez' | 'main' | 'prompt' | 'run') => {
    if (s.winner) return;
    const pres = presence(s);
    if (PARTS.has('fire')) {
      const k = n++ % TREES.length;
      const order = [...TREES.slice(k), ...TREES.slice(0, k)];
      const ask = (t: string) => (dk === 'rez' ? askRez(trees[t], s) : askAction(trees[t], s));
      const r: Record<string, { a: string; ms: number }> = {};
      for (const t of order) r[t] = ask(t);
      const retimed: string[] = [];
      for (const a of TREES.filter(x => x !== 'control')) {
        if (!((r[a].ms >= 500 && r[a].ms > 2 * r.control.ms) || r[a].ms > r.control.ms + 3000)) continue;
        const am = [r[a].ms, ask(a).ms, ask(a).ms];
        const cm = [r.control.ms, ask('control').ms, ask('control').ms];
        retimed.push(`${a}:${am.map(r1).join('/')}|control:${cm.map(r1).join('/')}`);
        r[a] = { ...r[a], ms: median(am) };
        r.control = { ...r.control, ms: median(cm) };
      }
      const changed = TREES.filter(a => a !== 'beta' && r[a].a !== r.beta.a);
      const o: Record<string, unknown> = { kind: 'd', src, i, T: s.turnNumber, dk, changed, ms: Object.fromEntries(TREES.map(t => [t, r1(r[t].ms)])) };
      if (anyPres(pres)) o.pres = pres;
      if (retimed.length) o.retimed = retimed;
      if (changed.length) o.picks = Object.fromEntries(TREES.map(t => [t, r[t].a]));
      if (changed.includes('hosted') && PARTS.has('cont')) o.cont = { beta: cont('beta', s), hosted: cont('hosted', s) };
      out(o);
    }
    if (PARTS.has('q2') && pres.walked) q2(src, i, s, dk, pres);
  };

  const q2 = (src: string, i: number, s: GameState, dk: string, pres: ReturnType<typeof presence>) => {
    const probe = trees.probe;
    probe.clear();
    const rec: { state: GameState; server: string; opts: Record<string, unknown>; h: HoldLike; stack: string }[] = [];
    (globalThis as { __holdProbe?: unknown[] }).__holdProbe = rec;
    try {
      if (dk === 'rez') askRez(probe, s);
      else askAction(probe, s);
    } finally {
      delete (globalThis as { __holdProbe?: unknown[] }).__holdProbe;
    }
    const seen = new Map<string, { r: (typeof rec)[number]; callers: Set<string>; asked: number }>();
    for (const r of rec) {
      const k = `${hashOf(r.state)}|${r.server}|${JSON.stringify(r.opts, (_, v) => (typeof v === 'number' && !Number.isFinite(v) ? 'inf' : v))}`;
      const e = seen.get(k) ?? { r, callers: new Set<string>(), asked: 0 };
      e.callers.add(callerOf(r.stack));
      e.asked++;
      seen.set(k, e);
    }
    // The decision's own board first, then by caller (the commit's readers first), at most Q2_CAP oracle asks
    const rank = (e: { r: (typeof rec)[number]; callers: Set<string> }) => [...e.callers].some(c => /candidates/.test(c)) ? 0 : [...e.callers].some(c => /rez\.ts/.test(c)) ? 1 : 2;
    const list = [...seen.values()].sort((a, b) => rank(a) - rank(b));
    out({ kind: 'qd', src, i, T: s.turnNumber, dk, asked: rec.length, unique: list.length, pres });
    list.forEach((e, k) => {
      const { r } = e;
      const opts = Object.fromEntries(Object.entries(r.opts).map(([a, v]) => [a, typeof v === 'number' && !Number.isFinite(v) ? 'inf' : v]));
      let arm: HoldLike | string;
      try {
        hosted.clear();
        arm = holdIn(hosted, r.state, r.server, r.opts);
      } catch (err) {
        arm = `error ${(err as Error).message.slice(0, 80)}`;
      }
      const capped = { answer: 'capped', sets: [], work: 0 };
      const { o, x, mem } = k < Q2_CAP ? oracles(r.state, r.server, r.opts as never) : { o: capped, x: capped, mem: memory(r.state) };
      out({ kind: 'q', src, i, T: s.turnNumber, dk, callers: [...e.callers], asked: e.asked, server: r.server, sk: serverKind(beta, r.state, r.server), opts, own: r.state.turnNumber === s.turnNumber && r.state.activePlayer === s.activePlayer, beta: hOut(r.h), hosted: typeof arm === 'string' ? arm : hOut(arm), oracle: o.answer, oracleX: x.answer, mem, oracleSets: o.sets, oracleXSets: x === o ? undefined : x.sets, work: o.work });
    });
  };

  /** A commit on a board with a hosted program: the hold after it (beta and the arm, the Corp's view) and the arm's pick. */
  const commit = (src: string, i: number, s: GameState, a: GameAction | null) => {
    if (!PARTS.has('q2') || !a || !presence(s).walked) return;
    if (a.type !== 'INSTALL_CARD' && a.type !== 'ADVANCE_CARD') return;
    const card = [...s.corp.hq, ...Object.values(s.corp.servers).flatMap(v => v.root)].find(c => c.instanceId === a.cardInstanceId);
    const server = a.type === 'INSTALL_CARD' ? a.targetServerId : a.serverId;
    if (!card || !isAgenda(card) || !server || !/^remote/.test(server)) return;
    let after: GameState;
    try {
      after = executeAction(structuredClone(s), a);
    } catch {
      return;
    }
    const sid = Object.keys(after.corp.servers).find(id => after.corp.servers[id].root.some(c => c.instanceId === card.instanceId)) ?? server;
    const ask = (t: Tree) =>
      hOut(
        t.asSide('corp', () => {
          const v = t.corpDecisionView(structuredClone(after)) as GameState;
          t.decisionContext(v, 'corp');
          return t.serverHold(v, sid, { when: 'runnerTurn', corpCredits: v.corp.credits });
        }),
      );
    beta.clear();
    const b = ask(beta);
    hosted.clear();
    const h = ask(hosted);
    out({ kind: 'c', src, i, T: s.turnNumber, action: key(a), server: sid, beta: b, hosted: h, hostedPick: askAction(hosted, s).a, betaPick: askAction(beta, s).a, ...(({ o, x, mem }) => ({ oracle: o.answer, oracleX: x.answer, mem }))(oracles(after, sid, { when: 'runnerTurn', corpCredits: after.corp.credits })) });
  };

  /** Runs, for following an exposure to its end. */
  const runWatch = (src: string) => {
    let cur: { T: number; server: string; stolen: number } | null = null;
    return (before: GameState, after: GameState) => {
      if (after.activeRun && (!before.activeRun || after.runsThisTurn.length > before.runsThisTurn.length)) cur = { T: after.turnNumber, server: after.activeRun.server, stolen: after.runner.scoreArea.filter(isAgenda).length };
      if (cur && !after.activeRun) {
        out({ kind: 'run', src, T: cur.T, server: cur.server, ok: !!after.runsThisTurn.at(-1)?.successful, stolen: after.runner.scoreArea.filter(isAgenda).length - cur.stolen });
        cur = null;
      }
    };
  };

  // ------------------------------------------------------------------------------------------------ sources
  const sources: (() => void)[] = [
    ...deals().map(seed => () => {
      const src = `deal:${seed}`;
      let i = 0;
      const watch = (inner: Agent): Agent =>
        new Proxy(inner, {
          get(target, prop, recv) {
            if (prop === 'chooseAction')
              return (state: GameState) => {
                const at = i++;
                decision(src, at, state, state.pendingPrompts.length ? 'prompt' : state.activeRun ? 'run' : 'main');
                const a = target.chooseAction(state);
                commit(src, at, state, a);
                return a;
              };
            if (prop === 'chooseRez')
              return (state: GameState, cards: CardInstance[]) => {
                if (cards.length) decision(src, i++, state, 'rez');
                return target.chooseRez!(state, cards);
              };
            return Reflect.get(target, prop, recv);
          },
        });
      const game = new GameRunner(dealState(seed), { corp: watch(createAgent('corp', 'normal')), runner: createAgent('runner', 'normal') });
      const runs = runWatch(src);
      const cr: number[] = [];
      const sc: number[] = [];
      let lastTurn = -1;
      for (let k = 0; k < 4000; k++) {
        const before = game.state;
        if (before.turnNumber !== lastTurn && before.activePlayer === 'corp') {
          cr.push(before.corp.credits);
          sc.push(before.corp.score);
          lastTurn = before.turnNumber;
        }
        if (!game.step()) break;
        runs(before, game.state);
      }
      out({ kind: 'p', src, cr, sc, winner: game.state.winner ?? null });
    }),
    ...humanFiles().map(f => () => {
      const report = JSON.parse(readFileSync(f, 'utf8'));
      if (!report.moves?.length) return;
      const src = `human:${f.split('/').pop()}`;
      let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
      if (report.startStops) s = { ...s, stops: report.startStops };
      out({ kind: 'h', src, ai: report.config.ai });
      const moves = report.moves as GameAction[];
      const runs = runWatch(src);
      let i = 0;
      for (let k = 0; k < moves.length; k++) {
        const move = moves[k];
        if (!s.winner) {
          if (isRezWindow(s, wantsStop)) {
            const cards = beta.rezCandidates(structuredClone(s), s.priority!.step);
            if (cards.length) {
              const at = i++;
              if (inRange(at)) decision(src, at, s, 'rez');
            }
          } else if (actingSide(s) === 'corp' && !(s.priority && s.priority.holder === 'corp' && s.activePlayer === 'runner')) {
            const at = i++;
            if (inRange(at)) {
              decision(src, at, s, s.pendingPrompts.length ? 'prompt' : s.activeRun ? 'run' : 'main');
              if (move.player === 'corp') commit(src, at, s, move);
            }
          }
        }
        const before = s;
        try {
          s = executeAction(s, move);
        } catch {
          break;
        }
        runs(before, s);
      }
    }),
  ];
  sources.forEach((run, k) => {
    if (k % shards === shard) run();
  });

  if (PARTS.has('gen')) for (let k = shard; k < GEN; k += shards) generated(k, trees);
  if (PARTS.has('worst') && shard === 0) worst(trees);
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
}

// ------------------------------------------------------------------------------------------------ generated servers
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ICE = iceCodes();
const BREAKERS = breakerCodes();
const CHROMATOPHORES = '35030';
const BOTULUS = '30004';
const NEITHER = '30024'; // Conduit: a program the walk reads nothing of

/**
 * tests/holdWalkReference.test.ts randomBoard, extended: 1 to 3 ice on remote1 (some unrezzed), 0 to 2 installed
 * breakers, maybe a Botulus, the Runner's means at random; and Madani installed with 1 to 4 hosted programs drawn from
 * breakers, Chromatophores, Botulus and a program that is neither. On the Corp's turn, its clicks spent, as the commit
 * asks: Madani's install is free on the Corp's turn and again on the Runner's.
 */
function madaniBoard(r: () => number): GameState {
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const s = newGame(3);
  s.turnNumber = 7;
  s.corp.hq = s.corp.hq.slice(0, Math.floor(r() * 4));
  s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  s.runner.memoryUnitsUsed = 0;
  s.runner.credits = Math.floor(r() * 9);
  s.runner.tags = r() < 0.3 ? Math.floor(r() * 3) : 0;
  s.runner.grip = s.runner.grip.slice(0, Math.floor(r() * 6));
  s.runner.maxClicks = 1 + Math.floor(r() * 4);
  s.corp.credits = Math.floor(r() * 12);
  s.corp.clicks = 0;
  s.corp.badPublicity = r() < 0.15 ? 1 : 0;
  const ids: string[] = [];
  for (let k = 1 + Math.floor(r() * 3); k > 0; k--) ids.push(installIceForTest(s, pick(ICE), 'remote1', r() < 0.5));
  for (let k = Math.floor(r() * 3); k > 0; k--) installProgramForTest(s, pick(BREAKERS));
  if (r() < 0.1) {
    const b = createCardInstance(s, BOTULUS);
    b.isRezzed = true;
    b.hostedOnId = pick(ids);
    b.tokens = { virus: Math.floor(r() * 3) };
    s.runner.rig.programs.push(b);
  }
  const m = createCardInstance(s, MADANI);
  m.isRezzed = true;
  m.hostedCards = [];
  for (let k = 1 + Math.floor(r() * 4); k > 0; k--) {
    const x = r();
    const code = x < 0.45 ? pick(BREAKERS) : x < 0.7 ? CHROMATOPHORES : x < 0.85 ? BOTULUS : NEITHER;
    const c = createCardInstance(s, code);
    c.isRezzed = true;
    m.hostedCards.push(c);
  }
  s.runner.rig.hardware.push(m);
  if (r() < 0.25) installIceForTest(s, pick(ICE), 'hq', true);
  // A quarter of the servers with the memory full (AI Coordinator's ruling, 19:15Z): programs that are neither breaker
  // nor trojan fill what the rig leaves (drawn after the board, so the other boards' draws are unchanged)
  if (r() < 0.25) while (s.runner.memoryUnitsUsed < memoryLimit(s)) installProgramForTest(s, NEITHER);
  return s;
}

function generated(k: number, trees: Record<string, Tree>) {
  const r = rng(20261118 + 7919 * k);
  const s = madaniBoard(r);
  const ask = (t: Tree, b: GameState) => {
    t.clear();
    return t.asSide('corp', () => {
      t.decisionContext(b, 'corp');
      const at = performance.now();
      const h = t.serverHold(b, 'remote1', { when: 'runnerTurn' }) as HoldLike;
      return { ...hOut(h), ms: Math.round((performance.now() - at) * 10) / 10 };
    });
  };
  // The same server with nothing hosted: whether beta and the oracle agree without the hosted programs (a cause)
  const bare = structuredClone(s);
  for (const c of bare.runner.rig.hardware) if (c.cardCode === MADANI) c.hostedCards = [];
  let b, h, o, x, mem, ob;
  try {
    b = ask(trees.beta, s);
    h = ask(trees.hosted, s);
    ({ o, x, mem } = oracles(s, 'remote1', { when: 'runnerTurn' }));
    ob = oracleAnswer(bare, 'remote1', { when: 'runnerTurn' });
  } catch (e) {
    out({ kind: 'g', k, error: (e as Error).message.slice(0, 120) });
    return;
  }
  const t = (c: CardInstance) => `${cardDef(c).title}${c.isRezzed ? '*' : ''}`;
  out({
    kind: 'g',
    k,
    beta: b,
    hosted: h,
    oracle: o.answer,
    oracleX: x.answer,
    mem,
    oracleBare: ob.answer,
    oracleSets: o.sets,
    work: o.work,
    board: {
      ice: s.corp.servers.remote1.ice.map(t),
      rig: s.runner.rig.programs.map(c => `${cardDef(c).title}${c.hostedOnId ? '@ice' : ''}`),
      hosted: s.runner.rig.hardware.find(c => c.cardCode === MADANI)!.hostedCards!.map(c => cardDef(c).title),
      runner: s.runner.credits,
      clicks: s.runner.maxClicks,
      tags: s.runner.tags,
      grip: s.runner.grip.length,
      corp: s.corp.credits,
      bp: s.corp.badPublicity,
    },
  });
}

// ------------------------------------------------------------------------------------------------ the worst board
function worst(trees: Record<string, Tree>) {
  const s = newGame(5);
  s.turnNumber = 9;
  s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  s.runner.memoryUnitsUsed = 0;
  s.runner.credits = 9;
  s.corp.credits = 14;
  // Five ice on a remote with an agenda in it, two rezzed
  const ice = ['30072', '35079', '30055', '35041', '34100'];
  ice.forEach((code, k) => installIceForTest(s, code, 'remote1', k < 2));
  const agenda = s.corp.hq.find(isAgenda) ?? s.corp.rd.find(isAgenda)!;
  s.corp.hq = s.corp.hq.filter(c => c !== agenda);
  s.corp.rd = s.corp.rd.filter(c => c !== agenda);
  s.corp.servers.remote1.root.push(agenda);
  installProgramForTest(s, BREAKERS.find(c => /fracter/i.test(cardDef({ cardCode: c } as CardInstance).keywords ?? ''))!);
  const m = createCardInstance(s, MADANI);
  m.isRezzed = true;
  const fr = BREAKERS.filter(c => /killer|decoder/i.test(cardDef({ cardCode: c } as CardInstance).keywords ?? ''));
  m.hostedCards = [fr[0], fr[fr.length - 1], CHROMATOPHORES, BOTULUS].map(code => Object.assign(createCardInstance(s, code), { isRezzed: true }));
  s.runner.rig.hardware.push(m);
  const ask = (t: Tree, f: () => unknown) => {
    t.clear();
    const at = performance.now();
    f();
    return performance.now() - at;
  };
  const hold = (t: Tree) => () => t.asSide('corp', () => (t.decisionContext(s, 'corp'), t.serverHold(s, 'remote1', { when: 'runnerTurn' })));
  const times: Record<string, Record<string, number[]>> = { control: { hold: [], decision: [] }, hosted: { hold: [], decision: [] } };
  const picks: Record<string, string> = {};
  for (let rep = 0; rep < 3; rep++)
    for (const name of rep % 2 ? ['hosted', 'control'] : ['control', 'hosted']) {
      const t = trees[name];
      times[name].hold.push(ask(t, hold(t)));
      const d = askAction(t, s);
      picks[name] = d.a;
      times[name].decision.push(d.ms);
    }
  const h = (t: Tree) => hOut(hold(t)() as HoldLike);
  // The reference: the same four programs installed in the rig (Chromatophores on Bumi 1.0, Botulus on Lycian), control asked
  const inst = structuredClone(s);
  const mad = inst.runner.rig.hardware.find(c => c.cardCode === MADANI)!;
  const iceIds = inst.corp.servers.remote1.ice.map(c => c.instanceId);
  for (const c of mad.hostedCards ?? []) inst.runner.rig.programs.push({ ...c, hostedOnId: c.cardCode === CHROMATOPHORES ? iceIds[3] : c.cardCode === BOTULUS ? iceIds[4] : undefined, tokens: c.cardCode === BOTULUS ? { virus: 1 } : c.tokens });
  mad.hostedCards = [];
  const ih: number[] = [];
  const idc: number[] = [];
  for (let rep = 0; rep < 3; rep++) {
    ih.push(ask(trees.control, () => trees.control.asSide('corp', () => (trees.control.decisionContext(inst, 'corp'), trees.control.serverHold(inst, 'remote1', { when: 'runnerTurn' })))));
    idc.push(askAction(trees.control, inst).ms);
  }
  const installed = { hold: median(ih), decision: median(idc), answer: hOut(trees.control.asSide('corp', () => (trees.control.decisionContext(inst, 'corp'), trees.control.serverHold(inst, 'remote1', { when: 'runnerTurn' }))) as HoldLike) };
  out({ kind: 'w', installed, board: { ice: s.corp.servers.remote1.ice.map(c => `${cardDef(c).title}${c.isRezzed ? '*' : ''}`), hosted: m.hostedCards.map(c => cardDef(c).title), rig: s.runner.rig.programs.map(c => cardDef(c).title) }, control: { hold: median(times.control.hold), decision: median(times.control.decision), all: times.control }, hosted: { hold: median(times.hosted.hold), decision: median(times.hosted.decision), all: times.hosted }, picks, answers: { control: h(trees.control), hosted: h(trees.hosted) } });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
