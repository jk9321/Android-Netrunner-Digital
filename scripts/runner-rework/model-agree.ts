/**
 * R0 count 4 (the Runner's two roles), parts A, M and P. Brief:
 * /mnt/project-files/netrunner-ai/runner-rework/r0/count4-two-roles/brief.md; shared rules ../standing-rules.md.
 * Count only: no arm, no tree is patched, nothing under src/ or tests/ changes. Summed by model-agree-sum.mjs.
 *
 * The reply's Runner is the Runner the Corp's look-ahead plays for the Runner's next turn (src/ai/runnerReply.ts
 * runnerReply): from the board where the Corp's action phase is over, a GameRunner with HeuristicCorpAI and
 * HeuristicRunnerAI, both planner off, synergy on, stepped until the Runner's turn is over (REPLY.maxSteps), on the
 * Corp's deal guessHidden(end, k) for k < replySamples(REPLY.samples) (2 today). This script plays the same loop.
 *
 * Sources (kinds kept apart everywhere):
 *  - self: the 221 deals of the g1 base 44381468776 (scripts/stage-d/post-pick-deals.json: winner, cr and sc of each
 *    game, checked), played by the `source` tree with a plain GameRunner, Normal v Normal, as the batch. The moves are
 *    kept and replayed afterwards on the `beta` tree's engine; nothing is asked while the source game plays.
 *  - humanRunner: tests/fixtures/human-games with config.ai 'corp' and level normal (a person is the Runner);
 *    humanRunnerHC: report-33 (a person against the Hard Corp, read apart).
 *  - aiRunnerNormal: config.ai 'runner', level normal (report-54: our Normal Runner against a person's Corp);
 *    aiRunnerHard: config.ai 'runner', level hard (reports 17-29, 32: our Hard Runner, switched off; read apart).
 *  A split game (report-40, -40b, -40c) is one game for the standard errors; a board whose Runner turn runs past the
 *  end of its file is dropped and counted ('cut').
 *
 * A board: the state just before the Corp's END_TURN (its action phase over): the state runnerReply starts from.
 * The real Runner turn: the recorded moves from there until the Corp is the active player again with no run.
 *  A1: the first main-phase action of the Runner's turn (key: type, card codes, server, host; kind: run, credit, draw,
 *      install, event, ability, tag, end, other; a card or ability that starts a run is kind 'run').
 *  A2: at every main-phase decision of the real Runner's turn, the reply's Runner (planner off, fresh at the board, then
 *      shown each real state of the turn and each real move, as its own play would) ranks the actions
 *      (rankMainActions): is the real move among its first 4 finite (PLANNER.candidates)?
 *  A3: the turn's outcome: agenda points stolen, servers breached (successful runs), Corp assets and upgrades installed
 *      at the board that are in Archives at the end, the Runner's credits at the end (within 2), and the winner.
 *  Each reading on the real grip and stack (`real`; HIDDEN-READ: the measuring script hands the model the true hidden
 *  cards, what it could do at best) and on the Corp's own deals guessHidden(board, k), k = 0, 1 (`d0`, `d1`: what the
 *  Corp sees today). A2's dealt reading ranks guessHidden(state, k) at each decision (the deal is redrawn at each
 *  state: its seed is the turn's, turnSeed, as outside a Corp decision; inside one it is the decision's own).
 *  `r` (rngOnly): the real cards with each deal's fresh shuffler (guessHidden reseeds it), the chance part.
 *  `g` (gripOnly): the same deals with R&D's real order put back (and both sides' memory of it), so the dealt
 *  part splits into the grip and stack, and R&D's order (HIDDEN-READ).
 *  Control: the real-grip reply is played again on the `control` tree; a difference is a stop ('ctl' line).
 * M (per board, for the sum): every real run start with the decision it came from (the last main-phase decision at or
 *  before it): how it started (click or card), the server, and at that decision the reply's ranking's top pick and
 *  score, its score for the run on that server, runShortfall, the unrezzed ice on the server, and whether the server was
 *  already run this turn. The model's own runs are listed the same way (started by click or card, breached or not).
 * P (person-Runner files only): the deciding Normal Runner (planner on), with the memory a deciding Runner would have
 *  built from every state of the game so far, at each real decision: its ranking (rankMainActions, on its own view) and
 *  its pick (chooseAction): is the person's move its pick, and among its first 4.
 * Row 36 (TRACE36, default on): deals 1041 T10 and 2121 T16, 8 dealt samples each, played by the reply's Runner and by
 *  the deciding Normal Runner (planner on) against the planner-off Corp, plus the real grip.
 *
 * Hidden information: no arm exists; the reply's Runner and the deciding Runner are asked only through their own
 * functions on the board they are given. HIDDEN-READ marks the places where this measuring script gives the model the
 * real hidden cards (the `real` reading) or reads hidden cards to say what was true (the outcome's trashed cards).
 *
 *   SHARD=0/64 npx vite-node scripts/runner-rework/model-agree.ts
 *   ARGS="DEALS=1041 HUMAN=none" npx vite-node scripts/runner-rework/model-agree.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { dealState } from '../stage-a/harness';
import { TREES, Tree, loadTree, makeTrees } from './model-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/model-agree', String(shard));
const TOP = 4; // PLANNER.candidates: the planner's intake today
const DEALT = 2; // replySamples(REPLY.samples) today; checked against the tree below
const TRACE36 = process.env.TRACE36 !== '0';
const ROW36: [number, number][] = [
  [1041, 10],
  [2121, 16],
];
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
let T: Record<string, Tree> = {};

// ------------------------------------------------------------------------------------------------ actions
function codeOf(s: GameState, id: unknown): string | null {
  if (typeof id !== 'string') return null;
  const c = T.beta.core.findCardAnywhere(s, id);
  return c ? c.cardCode : `?${id}`;
}
/** An action as a key that survives a re-deal of the grip: instance ids become card codes. */
function akey(s: GameState, a: GameAction | null): string {
  if (!a) return 'null';
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) {
    if (k === 'player') continue;
    if (k.endsWith('InstanceId')) o[k] = codeOf(s, v);
    else if (Array.isArray(v) && v.every(x => typeof x === 'string') && /Ids$|trashFirst/.test(k)) o[k] = v.map(x => codeOf(s, x)).sort();
    else o[k] = v;
  }
  return JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
}
const TYPE_KIND: Record<string, string> = { GAIN_CREDIT: 'credit', DRAW_CARD: 'draw', INSTALL_CARD: 'install', PLAY_EVENT: 'event', PLAY_OPERATION_OR_EVENT: 'event', USE_ABILITY: 'ability', REMOVE_TAG: 'tag', END_TURN: 'end', INITIATE_RUN: 'run' };
function isServerChoice(s: GameState): boolean {
  const p = T.beta.core.activePrompt(s);
  return !!p && p.side === 'runner' && p.kind === 'effect_choice' && p.options.length > 0 && p.options.every((o: any) => s.corp.servers[o.id]);
}
function kindOf(s: GameState, a: GameAction | null): string {
  if (!a) return 'null';
  if (a.type === 'INITIATE_RUN') return 'run';
  try {
    const n: GameState = T.beta.core.executeAction(s, a);
    if ((!s.activeRun && n.activeRun) || isServerChoice(n)) return 'run';
  } catch {
    /* not legal here: kind by type */
  }
  return TYPE_KIND[a.type] ?? 'other';
}
const runnerMain = (core: any, s: GameState) =>
  !s.winner && s.activePlayer === 'runner' && !s.activeRun && core.actingSide(s) === 'runner' && !core.activePrompt(s) && (!s.priority || s.priority.holder === 'runner');
const corpEnd = (core: any, s: GameState, a: GameAction | undefined) =>
  !!a && a.type === 'END_TURN' && a.player === 'corp' && !s.winner && s.activePlayer === 'corp' && !s.activeRun && !core.activePrompt(s);

// ------------------------------------------------------------------------------------------------ outcome
interface RunRec {
  server: string;
  how: 'click' | 'card';
  ok: boolean;
}
interface Outcome {
  stolen: number;
  breached: string[];
  trashed: number;
  cr: number;
  win: string | null;
  runs: RunRec[];
}
/** HIDDEN-READ (measuring only): the Corp's installed cards at the board, to say which were trashed. */
function rootIds(s: GameState): Set<string> {
  const ids = new Set<string>();
  for (const sv of Object.values(s.corp.servers)) for (const c of sv.root) if (T.beta.core.cardDef(c).type_code !== 'agenda') ids.add(c.instanceId);
  return ids;
}
function outcome(board: GameState, end: GameState, runs: { server: string; how: 'click' | 'card' }[], lastRunnerRuns: { server: string; successful: boolean }[]): Outcome {
  const before = rootIds(board);
  const arch = [...end.corp.archives.faceUp, ...end.corp.archives.faceDown].filter(c => before.has(c.instanceId)).length;
  const rec: RunRec[] = runs.map((r, i) => ({ ...r, ok: !!lastRunnerRuns[i]?.successful }));
  // A run that ended the game (an agenda stolen to win) may not reach runsThisTurn: count it breached
  if (end.winner === 'runner' && rec.length && end.runner.score > board.runner.score && !rec[rec.length - 1].ok) rec[rec.length - 1].ok = true;
  return {
    stolen: end.runner.score - board.runner.score,
    breached: [...new Set(rec.filter(r => r.ok).map(r => r.server))].sort(),
    trashed: arch,
    cr: end.runner.credits,
    win: end.winner ?? null,
    runs: rec,
  };
}

// ------------------------------------------------------------------------------------------------ the reply's Runner
interface Play {
  first: { k: string; kind: string } | null;
  o: Outcome;
  err?: string;
}
/** runnerReply's loop (src/ai/runnerReply.ts), from `start`, with `runner` standing for the Runner. */
function playTurn(t: Tree, start: GameState, runner?: any): Play {
  t.clear();
  const g = new t.GameRunner(structuredClone(start), {
    corp: new t.HeuristicCorpAI({ synergy: true, planner: false }),
    runner: runner ?? new t.HeuristicRunnerAI({ synergy: true, planner: false }),
  });
  const board = g.state as GameState;
  let runnerTurn = false;
  let first: Play['first'] = null;
  const runs: { server: string; how: 'click' | 'card' }[] = [];
  let lastRuns: { server: string; successful: boolean }[] = [];
  let err: string | undefined;
  try {
    for (let i = 0; i < t.REPLY.maxSteps && !g.state.winner; i++) {
      const s: GameState = g.state;
      const main = runnerMain(t.core, s);
      if (!g.step()) break;
      const n: GameState = g.state;
      if (main && !first) first = { k: akey(s, g.last), kind: kindOf(s, g.last) };
      if (!s.activeRun && n.activeRun && n.activePlayer === 'runner') runs.push({ server: n.activeRun.server, how: g.last?.type === 'INITIATE_RUN' ? 'click' : 'card' });
      if (n.activePlayer === 'runner') {
        runnerTurn = true;
        lastRuns = n.runsThisTurn.map(r => ({ server: r.server, successful: r.successful }));
      } else if (runnerTurn && !n.activeRun) break;
    }
  } catch (e) {
    err = (e as Error).message.slice(0, 120);
  }
  return { first, o: outcome(board, g.state, runs, lastRuns), ...(err ? { err } : {}) };
}

// ------------------------------------------------------------------------------------------------ rankings
interface Ranked {
  pos: number;
  top: { k: string; sc: number }[];
  n: number;
}
function rankOf(t: Tree, agent: any, s: GameState, realKey: string, view?: GameState): Ranked {
  t.clear();
  const list: { action: GameAction; score: number }[] = t.asSide('runner', () => agent.rankMainActions(structuredClone(view ?? s)));
  const finite = list.filter(r => Number.isFinite(r.score));
  const keys = finite.map(r => ({ k: akey(view ?? s, r.action), sc: Math.round(r.score * 100) / 100 }));
  return { pos: keys.findIndex(x => x.k === realKey), top: keys.slice(0, TOP + 1), n: keys.length };
}
function setMemory(agent: any, from: any) {
  agent.memory = new Map(from.memory);
  return agent;
}

// ------------------------------------------------------------------------------------------------ one game
interface Game {
  src: string;
  game: string;
  kind: string;
  s0: GameState;
  moves: GameAction[];
}
function measure(g: Game) {
  const core = T.beta.core;
  const states: GameState[] = [g.s0];
  let stopped: string | null = null;
  for (const [j, m] of g.moves.entries()) {
    try {
      states.push(core.executeAction(states[j], m));
    } catch (e) {
      stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
      break;
    }
  }
  const n = states.length - 1; // moves replayed
  const people = g.kind === 'humanRunner' || g.kind === 'humanRunnerHC';
  // P: the deciding Runner's memory, built from every state of the game (as an AI Runner playing it would see them)
  const seen = people ? T.beta.createAgent('runner', 'normal') : null;
  let seenUpTo = -1;
  const observeTo = (i: number) => {
    if (!seen) return;
    for (let x = seenUpTo + 1; x <= i; x++) T.beta.asSide('runner', () => seen.observe(states[x]));
    seenUpTo = Math.max(seenUpTo, i);
  };
  let boards = 0;
  let cut = 0;
  for (let j = 0; j < n; j++) {
    if (!corpEnd(core, states[j], g.moves[j])) continue;
    // The Runner's turn: until the Corp is active again with no run, or the game ends
    let e = -1;
    let runnerTurn = false;
    for (let x = j + 1; x <= n; x++) {
      const s = states[x];
      if (s.activePlayer === 'runner') runnerTurn = true;
      if (s.winner || (runnerTurn && s.activePlayer === 'corp' && !s.activeRun)) {
        e = x;
        break;
      }
    }
    if (e < 0) {
      cut++;
      continue;
    }
    boards++;
    const B = states[j];
    const T0 = B.turnNumber;
    // The real turn
    const realRuns: { server: string; how: 'click' | 'card'; at: number; dec: number }[] = [];
    let lastRuns: { server: string; successful: boolean }[] = [];
    const decs: number[] = [];
    for (let x = j + 1; x < e; x++) {
      const s = states[x];
      const nx = states[x + 1];
      if (runnerMain(core, s)) decs.push(x);
      if (nx && !s.activeRun && nx.activeRun && nx.activePlayer === 'runner')
        realRuns.push({ server: nx.activeRun.server, how: g.moves[x].type === 'INITIATE_RUN' ? 'click' : 'card', at: x, dec: decs.length ? decs[decs.length - 1] : -1 });
      if (nx && nx.activePlayer === 'runner') lastRuns = nx.runsThisTurn.map(r => ({ server: r.server, successful: r.successful }));
    }
    const realO = outcome(B, states[e], realRuns, lastRuns);
    const realFirst = decs.length ? { k: akey(states[decs[0]], g.moves[decs[0]]), kind: kindOf(states[decs[0]], g.moves[decs[0]]) } : null;
    // The reply's Runner on the board: real grip (HIDDEN-READ) on beta and control, then the Corp's deals
    const t0 = performance.now();
    const real = playTurn(T.beta, B);
    const ms = Math.round(performance.now() - t0);
    const ctl = playTurn(T.control, B);
    const ctlOk = JSON.stringify(ctl) === JSON.stringify(real);
    if (!ctlOk) out({ kind: 'ctl', src: g.src, T: T0, beta: real, control: ctl });
    const dealt: Play[] = [];
    // gripOnly (rule 3's split): the same deals with R&D, the Runner's memory of it and the Corp's put back as they are
    // (HIDDEN-READ: the real R&D order), so the dealt part is split into the grip and stack, and R&D's order
    const grip: Play[] = [];
    // rngOnly: the real cards with the deal's fresh shuffler (random accesses, shuffles): the part of the split that is chance
    const rng: Play[] = [];
    for (let k = 0; k < DEALT; k++) {
      const dealtB = T.beta.guessHidden(B, k);
      rng.push(playTurn(T.beta, { ...B, rng: T.beta.core.createRng(dealtB.rng.state) }));
      dealt.push(playTurn(T.beta, dealtB));
      grip.push(playTurn(T.beta, { ...dealtB, corp: { ...dealtB.corp, rd: B.corp.rd, rdKnownToRunner: B.corp.rdKnownToRunner } }));
    }
    out({
      kind: 'b',
      src: g.src,
      game: g.game,
      sk: g.kind,
      T: T0,
      j,
      cs: B.corp.score,
      rs: B.runner.score,
      rcr: B.runner.credits,
      grip: B.runner.grip.length,
      real: { first: realFirst, o: realO, runs: realRuns.map(r => ({ server: r.server, how: r.how, dec: decs.indexOf(r.dec) })) },
      model: { real, d: dealt, g: grip, r: rng },
      ctlOk,
      ms,
      decisions: decs.length,
    });
    // A2 and M's decision data; P for person-Runner files
    const reply = new T.beta.HeuristicRunnerAI({ synergy: true, planner: false });
    const replyD = Array.from({ length: DEALT }, () => new T.beta.HeuristicRunnerAI({ synergy: true, planner: false }));
    let shown = j;
    for (const [di, d] of decs.entries()) {
      for (let x = shown + 1; x <= d; x++) {
        T.beta.asSide('runner', () => reply.observe(states[x]));
        for (const r of replyD) T.beta.asSide('runner', () => r.observe(states[x]));
      }
      shown = d;
      const s = states[d];
      const a = g.moves[d];
      const rk = akey(s, a);
      const rr = rankOf(T.beta, reply, s, rk);
      const rd = replyD.map((r, k) => rankOf(T.beta, r, s, rk, T.beta.guessHidden(s, k)));
      // The runs this decision started (M)
      const started = realRuns.filter(r => r.dec === d);
      const runInfo = started.map(r => {
        const runKey = akey(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: r.server } as GameAction);
        const fullRank = (() => {
          T.beta.clear();
          const list: { action: GameAction; score: number }[] = T.beta.asSide('runner', () => reply.rankMainActions(structuredClone(s)));
          const hit = list.find(x => x.action.type === 'INITIATE_RUN' && (x.action as any).targetServerId === r.server);
          return hit ? (Number.isFinite(hit.score) ? Math.round(hit.score * 100) / 100 : null) : 'illegal';
        })();
        const sv = s.corp.servers[r.server];
        const shortfall: number | null = (() => {
          try {
            return T.beta.runs.runShortfall(s, r.server);
          } catch {
            return null;
          }
        })();
        return {
          server: r.server,
          how: r.how,
          topIsRun: rr.top[0]?.k === runKey,
          runScore: fullRank,
          shortfall,
          unrezzed: sv ? sv.ice.filter(c => !c.isRezzed).length : 0,
          ice: sv ? sv.ice.length : 0,
          repeat: s.runsThisTurn.some(x => x.server === r.server),
          clicks: s.runner.clicks,
          cr: s.runner.credits,
        };
      });
      let P: Record<string, unknown> | undefined;
      if (people && seen) {
        observeTo(d);
        const dr = rankOf(T.beta, setMemory(T.beta.createAgent('runner', 'normal'), seen), s, rk);
        T.beta.clear();
        let pick: string;
        let pickKind = 'error';
        try {
          const ag = setMemory(T.beta.createAgent('runner', 'normal'), seen);
          const p = ag.chooseAction(structuredClone(s));
          pick = akey(s, p);
          pickKind = kindOf(s, p);
        } catch (e) {
          pick = `error: ${(e as Error).message.slice(0, 80)}`;
        }
        P = { pos: dr.pos, top: dr.top, n: dr.n, pick, pickKind, same: pick === rk };
      }
      out({ kind: 'd', src: g.src, game: g.game, sk: g.kind, T: T0, di, k: rk, kd: kindOf(s, a), reply: rr, dealt: rd.map(x => ({ pos: x.pos, top0: x.top[0]?.k ?? null, n: x.n })), runs: runInfo, ...(P ? { P } : {}) });
      // the reply would have played the real move next: tell it, as its own play does (free-action guard)
      reply.notePlayed(a);
      for (const r of replyD) r.notePlayed(a);
    }
    // Row 36's two boards: 8 dealt samples each, the reply's Runner and the deciding Runner
    if (TRACE36 && g.kind === 'self' && ROW36.some(([seed, turn]) => g.src === `deal:${seed}` && turn === T0)) {
      for (let k = 0; k < 8; k++) {
        const dealtB = T.beta.guessHidden(B, k);
        const r = playTurn(T.beta, dealtB);
        const dcd = playTurn(T.beta, dealtB, T.beta.createAgent('runner', 'normal'));
        out({ kind: 't', src: g.src, T: T0, k, reply: r, deciding: dcd });
      }
      out({ kind: 't', src: g.src, T: T0, k: 'real', reply: real, deciding: playTurn(T.beta, B, T.beta.createAgent('runner', 'normal')), actual: realO });
    }
  }
  out({ kind: 'g2', src: g.src, game: g.game, sk: g.kind, moves: g.moves.length, replayed: n, stopped, boards, cut });
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const dirs = makeTrees(root);
  T = {};
  for (const name of TREES) T[name] = await loadTree(name, dirs[name]);
  const want = T.beta.replySamples(T.beta.REPLY.samples);
  if (want !== DEALT) throw new Error(`replySamples is ${want}, the script reads ${DEALT}: stop`);
  const record: { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] }[] = JSON.parse(readFileSync('scripts/stage-d/post-pick-deals.json', 'utf8'));
  const dwant = (process.env.DEALS ?? '').split(',').filter(Boolean);
  const dealList = dwant.includes('none') ? [] : record.filter(r => !dwant.length || dwant.includes(String(r.seed)));
  const hdir = 'tests/fixtures/human-games';
  const hwant = (process.env.HUMAN ?? '').split(',').filter(Boolean);
  const humans = hwant.includes('none')
    ? []
    : readdirSync(hdir)
        .filter(f => f.endsWith('.json') && (!hwant.length || hwant.some(w => f.startsWith(w))))
        .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')) || a.localeCompare(b));
  const sources: { kind: 'deal' | 'human'; id: any }[] = [...humans.map(f => ({ kind: 'human' as const, id: f })), ...dealList.map(r => ({ kind: 'deal' as const, id: r }))];
  const key = (a: unknown) => JSON.stringify(a);
  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    const t0 = performance.now();
    if (src.kind === 'deal') {
      const rec = src.id as (typeof record)[number];
      const name = `deal:${rec.seed}`;
      const t = T.source;
      const ag = { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') };
      const s0: GameState = dealState(rec.seed);
      const g = new t.GameRunner(s0, ag);
      const start = g.state as GameState;
      const moves: GameAction[] = [];
      const cr: number[] = [];
      const sc: number[] = [];
      let lastTurn = -1;
      for (let n = 0; n < 4000; n++) {
        const s: GameState = g.state;
        if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
          cr.push(s.corp.credits);
          sc.push(s.corp.score);
          lastTurn = s.turnNumber;
        }
        if (!g.step()) break;
        moves.push(g.last);
      }
      const matches = (g.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
      out({ kind: 'g', src: name, decks: `${rec.corpDeck} v ${rec.runnerDeck}`, winner: g.state.winner ?? null, T: g.state.turnNumber, matchesBatch: matches, ...(matches ? {} : { cr, sc, recCr: rec.cr, recSc: rec.sc, recWinner: rec.winner }) });
      measure({ src: name, game: name, kind: 'self', s0: start, moves });
    } else {
      const file = join(hdir, src.id as string);
      const r = JSON.parse(readFileSync(file, 'utf8'));
      if (!r.moves?.length) continue;
      const hard = (r.config.level ?? r.config.difficulty) === 'hard';
      const kind = r.config.ai === 'corp' ? (hard ? 'humanRunnerHC' : 'humanRunner') : hard ? 'aiRunnerHard' : 'aiRunnerNormal';
      const core = T.beta.core;
      let s0: GameState;
      if (r.startsAt === 'state') s0 = structuredClone(r.state);
      else {
        s0 = core.createInitialGameState(T.beta.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
        if (r.startStops) s0 = { ...s0, stops: r.startStops };
      }
      const name = `human:${src.id}`;
      measure({ src: name, game: name.replace(/(\d)[a-z]\.json$/, '$1.json'), kind, s0, moves: r.moves });
    }
    out({ kind: 's', src: src.kind === 'deal' ? `deal:${src.id.seed}` : `human:${src.id}`, ms: Math.round(performance.now() - t0) });
  }
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
