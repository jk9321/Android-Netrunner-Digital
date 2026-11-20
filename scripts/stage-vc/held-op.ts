/**
 * V-C item 3 (the held economy operation), count step. Brief:
 * /mnt/project-files/netrunner-ai/stage-vc/item3-held-operation/brief.md. Scripts only: nothing in src or tests.
 * Trees and arms: held-op-trees.ts (each a patched copy of this checkout's src, its own module graph).
 *
 * Two parts (PARTS=ask, the default; PARTS=cont with JOBS=<file>), as scripts/stage-vc/hand-price.ts.
 *
 * PART ask. Sources (kinds apart everywhere: self, humanRunner = the person played the Runner, humanCorp):
 *  (a) the 221 deals of the g1 base (44594439017, identical to 44381468776; scripts/stage-d/post-pick-deals.json: each
 *      game's winner, cr and sc checked), played by the `source` tree with a plain GameRunner, Normal v Normal. The source
 *      tree is never asked or cleared mid-game; its agents' state is copied before each step into the fresh agents asked.
 *  (b) the human files in tests/fixtures/human-games, the recorded moves replayed.
 *  Every Corp decision (main, prompt, rez window) is asked of beta, control and each arm (one-step GameRunner on a copy of
 *  the board, fresh agents of that tree restored from the source's, caches cleared, tree order rotated, timed, the time
 *  inside the planner apart). A control answer unlike beta's is a stop. RUNNER=1 also asks the Runner's decisions.
 *
 *  The class (Corp main-phase boards, the turn-start window apart): a money operation in HQ (moneyGain > 0). Per card:
 *  short = cost - credits; sub-class `held` (payable: a legal play, and the source's action is not its play), `played`
 *  (payable and played), `now` (short > 0, credits + clicks - 1 >= cost), `next` (short > 0, not now, credits + clicks +
 *  maxClicks - 1 >= cost: credit clicks only, no income; step 8 added knownIncome), `far`. Cards priced by a card plan
 *  (handPlanWorth defined on the Corp's view) are flagged `plan` and sized apart.
 *  On every class board (now, next or held card): T, the trace (a separate ask on the beta tree with the planner's record
 *  on, so the asks compared are untouched); S, the price by shortfall (beta tree, the Corp's view; leaf pricing and plain);
 *  the guards g1 and g2 for beta and each arm at the board with the credits raised to the cost (where short).
 *  Spells (a card from its first class board until it leaves HQ): fate, turns, what the source's clicks went to; the
 *  R jobs (one board a spell, at most 3 spells a source: the first board of the spell where the source's action is not the
 *  save-up action); arm jobs for every changed decision (the summing step keeps at most 8 a source and arm).
 *
 * PART cont: each job from its decision's board, beta's tree, fresh agents restored from the source's state, to the
 * game's end: R line i (beta's agents), R line ii (the save-up line: at the Corp's main-phase boards while the card is in
 * HQ and up to the end of the Corp's next turn, play it if payable, else click for a credit); arm jobs: the arm's action
 * then beta's agents, against beta's action then beta's agents. Read: Corp and Runner points two turn pairs later and at
 * the end, the winner, the Corp's credits at the end of its next turn, and each money operation's turns until it leaves HQ.
 *
 * Hidden information: agents are asked only through GameRunner (their own views). The measuring script reads the Corp's
 * own HQ (known to it) and the true record of what followed (HIDDEN-READ: fates of cards, the game's end). No arm reads it.
 *
 *   SHARD=0/64 npx vite-node scripts/stage-vc/held-op.ts
 *   ARGS="DEALS=1321 HUMAN=none" npx vite-node scripts/stage-vc/held-op.ts
 *   ARGS="PARTS=cont JOBS=scripts/stage-vc/held-op-jobs.json" SHARD=0/64 npx vite-node scripts/stage-vc/held-op.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { dealState } from '../stage-a/harness';
import { ARMS, Arm, PRICE_ARMS, Tree, loadTree, makeTrees } from './held-op-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/held-op', String(shard));
const PART = process.env.PARTS ?? 'ask';
const ASKED: Arm[] = ['beta', 'control', ...(process.env.ARMS_ASK ? (process.env.ARMS_ASK.split(',') as Arm[]) : PRICE_ARMS)];
const ASKED_ARMS = ASKED.slice(2);
const G = globalThis as any;
const key = (a: unknown) => (a ? JSON.stringify(a) : 'null');
const same = (a: unknown, b: unknown) => key(a) === key(b);
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r3 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x);

let trees: Record<string, Tree> = {};

// ------------------------------------------------------------------------------------------------ agents
type Snap = Record<string, unknown>;
type Snaps = { corp?: Snap; runner?: Snap };
function snapAgent(agent: any): Snap {
  const s: Snap = {};
  for (const [k, v] of Object.entries(agent)) {
    if (typeof v === 'function') continue;
    try {
      s[k] = structuredClone(v);
    } catch {
      /* not cloneable: left as the fresh agent has it */
    }
  }
  return s;
}
function restore(fresh: any, snap: Snap | undefined) {
  if (!snap) return fresh;
  for (const [k, v] of Object.entries(snap)) {
    const cur = fresh[k];
    if (cur && typeof cur === 'object' && !Array.isArray(cur) && !(cur instanceof Map) && !(cur instanceof Set) && Object.getPrototypeOf(cur) !== Object.prototype)
      Object.assign(cur, structuredClone(v));
    else fresh[k] = structuredClone(v);
  }
  return fresh;
}
function agents(t: Tree, snaps?: Snaps) {
  return {
    corp: restore(t.createAgent('corp', 'normal'), snaps?.corp),
    runner: restore(t.createAgent('runner', 'normal'), snaps?.runner),
  };
}

// ------------------------------------------------------------------------------------------------ decisions
type Cls = 'corpPrompt' | 'corpMain' | 'corpRez' | 'runnerPrompt' | 'runnerMain' | 'runnerOff';
function decisionOf(core: any, s: GameState): { side: 'corp' | 'runner'; cls: Cls } | null {
  const side = core.actingSide(s);
  if (!side || s.winner) return null;
  const w = s.priority;
  if (s.pendingPrompts.length === 0 && w && w.holder !== s.activePlayer) {
    const ask = core.wantsStop(s, side, w);
    if (ask && side === 'corp' && (w.step === 'approach_ice' || w.step === 'approach_server')) return { side, cls: 'corpRez' };
    if (ask && side === 'runner' && w.step === 'corp_action') return { side, cls: 'runnerOff' };
    return null;
  }
  return { side, cls: core.activePrompt(s) ? (`${side}Prompt` as Cls) : (`${side}Main` as Cls) };
}

interface Ask {
  a: GameAction | null;
  k: string;
  ms: number;
  pm: number;
  fire: number;
  rec: any;
  plan: any;
  mem: boolean;
  err?: string;
}
function resetG() {
  G.__hoFire = { n: 0 };
  G.__hoPlanMs = 0;
  G.__hoRec = null;
  G.__hoPlan = null;
  G.__hoMem = false;
}
function ask(t: Tree, s: GameState, snaps: Snaps | undefined, trace?: string[]): Ask {
  t.clear();
  const ag = agents(t, snaps);
  const g = new t.GameRunner(structuredClone(s), ag);
  resetG();
  G.__hoArm = true;
  if (trace) {
    G.__hoTraceOn = true;
    G.__hoIds = trace;
  }
  const at = performance.now();
  try {
    g.step();
    const ms = performance.now() - at;
    const a = g.last as GameAction | null;
    return { a, k: key(a), ms, pm: G.__hoPlanMs, fire: G.__hoFire.n, rec: G.__hoRec, plan: G.__hoPlan, mem: !!G.__hoMem };
  } catch (e) {
    return { a: null, k: `error: ${(e as Error).message.slice(0, 80)}`, ms: performance.now() - at, pm: G.__hoPlanMs, fire: G.__hoFire?.n ?? 0, rec: null, plan: null, mem: false, err: (e as Error).message.slice(0, 160) };
  } finally {
    G.__hoArm = false;
    G.__hoTraceOn = false;
    G.__hoIds = undefined;
    resetG();
  }
}

function title(t: Tree, s: GameState, id: string): string {
  const c = t.core.findCardAnywhere(s, id);
  return c ? t.core.cardDef(c).title : id;
}
function label(t: Tree, s: GameState, a: GameAction | null | undefined): string {
  if (!a) return 'none';
  const x = a as any;
  if (a.type === 'RESOLVE_PROMPT') {
    const c = x.choice;
    if (c.kind === 'effect_choice') return `prompt:${c.optionId}`;
    if (c.kind === 'effect_cards' || c.kind === 'discard') return `prompt:${c.kind}:[${(c.cardInstanceIds ?? []).map((id: string) => title(t, s, id)).join(', ')}]`;
    return `prompt:${c.kind}`;
  }
  const id = x.cardInstanceId;
  const where = x.targetServerId ? `>${x.targetServerId}` : x.asNewRemote ? '>new' : '';
  if (!id) return a.type + where;
  return `${a.type} ${title(t, s, id)}${where}`;
}
/** What a Corp main-phase click went to: agenda (advance, install, score), ice, draw, credit, op (the play of `opId`), operation, other. */
function kindOf(t: Tree, s: GameState, a: GameAction | null | undefined, opId?: string): string {
  if (!a) return 'none';
  const x = a as any;
  if (a.type === 'GAIN_CREDIT') return 'credit';
  if (a.type === 'DRAW_CARD') return 'draw';
  if (a.type === 'SCORE_AGENDA') return 'agenda';
  if (a.type === 'ADVANCE_CARD') {
    const c = t.core.findCardAnywhere(s, x.cardInstanceId);
    return c && t.core.cardDef(c).type_code === 'agenda' ? 'agenda' : 'advanceOther';
  }
  if (a.type === 'INSTALL_CARD') {
    const c = t.core.findCardAnywhere(s, x.cardInstanceId);
    const ty = c ? t.core.cardDef(c).type_code : '';
    return ty === 'agenda' ? 'agenda' : ty === 'ice' ? 'ice' : 'installOther';
  }
  if (a.type === 'PLAY_OPERATION_OR_EVENT') return x.cardInstanceId === opId ? 'op' : 'operation';
  return 'other';
}

// ------------------------------------------------------------------------------------------------ the class
interface ClsCard {
  id: string;
  title: string;
  cost: number;
  gain: number;
  short: number;
  sub: 'held' | 'played' | 'now' | 'next' | 'far';
  plan: boolean;
}
/** Runs f as the deciding Corp on its own decision view, the decision noted (as rankMainActions does). */
function asCorp<T>(t: Tree, s: GameState, f: (view: GameState) => T): T {
  t.clear();
  return t.pricing.asSide('corp', () => {
    const view = t.tp.corpDecisionView(s);
    t.hv.decisionContext(view, 'corp');
    return f(view);
  });
}
const isCorpMainBoard = (t: Tree, s: GameState) => s.activePlayer === 'corp' && !t.core.activePrompt(s) && !s.activeRun && (s as any).turnStep?.kind !== 'corp_turn_start' && s.corp.clicks > 0;
function classOf(t: Tree, s: GameState, played: GameAction | null | undefined): ClsCard[] {
  if (!isCorpMainBoard(t, s)) return [];
  const legal: GameAction[] = t.core.getLegalActions(s, 'corp');
  const playable = new Set(legal.filter(a => a.type === 'PLAY_OPERATION_OR_EVENT').map(a => (a as any).cardInstanceId));
  const cr = s.corp.credits;
  const clicks = s.corp.clicks;
  const maxClicks = s.corp.maxClicks ?? 3;
  const outL: ClsCard[] = [];
  for (const c of s.corp.hq) {
    const d = t.core.cardDef(c);
    if (d.type_code !== 'operation') continue;
    const gain = t.vm.moneyGain(c);
    if (!(gain > 0)) continue;
    const cost = d.cost ?? 0;
    const short = cost - cr;
    let sub: ClsCard['sub'];
    if (short <= 0) {
      if (!playable.has(c.instanceId)) continue; // payable but not legal (a condition): not in the class
      sub = played?.type === 'PLAY_OPERATION_OR_EVENT' && (played as any).cardInstanceId === c.instanceId ? 'played' : 'held';
    } else sub = cr + clicks - 1 >= cost ? 'now' : cr + clicks + maxClicks - 1 >= cost ? 'next' : 'far';
    let plan: boolean;
    try {
      plan = asCorp(t, s, view => {
        const card = view.corp.hq.find((x: any) => x.instanceId === c.instanceId);
        return !!card && t.plans.handPlanWorth(view, card) !== undefined;
      });
    } catch {
      plan = false;
    }
    outL.push({ id: c.instanceId, title: d.title, cost, gain, short, sub, plan });
  }
  return outL;
}

/** S: the price of each class card by shortfall, leaf pricing and plain, and the played-out worth by owners. */
function priceTable(t: Tree, s: GameState, cards: ClsCard[]) {
  return asCorp(t, s, view => {
    const res: any[] = [];
    for (const c of cards) {
      const from = Math.max(view.corp.credits, c.cost - 6);
      const rows: any[] = [];
      for (let cr = Math.max(c.cost, view.corp.credits); cr >= from; cr--) {
        const at = { ...view, corp: { ...view.corp, credits: cr } } as GameState;
        const without = { ...at, corp: { ...at.corp, hq: at.corp.hq.filter((x: any) => x.instanceId !== c.id) } } as GameState;
        const plain = t.ev.evaluate(at, 'corp') - t.ev.evaluate(without, 'corp');
        const leaf = t.pricing.withPricing({ leaves: [...t.pricing.pricing().leaves, { side: 'corp', plan: t.pricing.plan() }] }, () => t.ev.evaluate(at, 'corp') - t.ev.evaluate(without, 'corp'));
        const need = t.vm.creditNeed(at, 'corp');
        const playedOut = t.vm.creditSlide(cr + c.gain, need, t.vm.BROKE_SLOPE) - t.vm.creditSlide(cr, need, t.vm.BROKE_SLOPE) - t.vm.CLICK;
        rows.push({ s: Math.max(0, c.cost - cr), cr, plain: r3(plain), leaf: r3(leaf), playedOut: r3(playedOut) });
      }
      res.push({ id: c.id, title: c.title, rows });
    }
    return res;
  });
}

/** g1 and g2 on one tree, at the board with the Corp's credits raised to the card's cost (plain evaluation, the Corp's view). */
function guards(t: Tree, s: GameState, c: ClsCard) {
  return asCorp(t, s, view => {
    const at = { ...view, corp: { ...view.corp, credits: Math.max(view.corp.credits, c.cost) } } as GameState;
    const legal: GameAction[] = t.core.getLegalActions(at, 'corp');
    const play = legal.find(a => a.type === 'PLAY_OPERATION_OR_EVENT' && (a as any).cardInstanceId === c.id);
    const credit = legal.find(a => a.type === 'GAIN_CREDIT');
    if (!play || !credit) return null;
    const ev = (x: GameState) => t.ev.evaluate(x, 'corp');
    const vPlay = ev(t.core.executeAction(structuredClone(at), play));
    const vCredit = ev(t.core.executeAction(structuredClone(at), credit));
    const vIdle = ev({ ...at, corp: { ...at.corp, clicks: at.corp.clicks - 1 } } as GameState);
    return { g1: vPlay < vCredit, g2: vIdle >= vPlay, dPC: r3(vPlay - vCredit), dPI: r3(vPlay - vIdle) };
  });
}

/** T: the first layer that loses the play, from the trace ask's record. */
function layerOf(t: Tree, s: GameState, c: ClsCard, tr: Ask, sourceAction: GameAction | null | undefined) {
  const rec = tr.rec;
  const o: any = { fresh: same(tr.a, sourceAction) };
  if (tr.err) return { ...o, layer: 'err', err: tr.err };
  if (!rec) return { ...o, layer: 'noRec' };
  if (rec.win) return { ...o, layer: 'L1', q: 'Q1 win' };
  if (rec.later) return { ...o, layer: 'L1', q: 'Q4 later step' };
  if (rec.lineStep) return { ...o, layer: 'L1', q: 'Q5 line step' };
  if (rec.score) return { ...o, layer: 'L1', q: 'Q3 score' };
  if (rec.money && !same(rec.money, rec.planned)) return { ...o, layer: 'L1', q: 'Q6 money', money: label(t, s, rec.money) };
  if (rec.final && rec.chosen && !same(rec.final, rec.chosen)) return { ...o, layer: 'L1', q: 'Q5 veto', vetoed: label(t, s, rec.chosen) };
  if (tr.mem) return { ...o, layer: 'memory' };
  const P = tr.plan;
  if (!P || !P.cands?.length) return { ...o, layer: 'L2', why: 'no look-ahead' };
  const target = c.sub === 'held' ? (a: any) => a.type === 'PLAY_OPERATION_OR_EVENT' && a.cardInstanceId === c.id : (a: any) => a.type === 'GAIN_CREDIT';
  const ci = P.cands.findIndex((x: any) => target(x.action));
  if (ci < 0) return { ...o, layer: 'L2', why: c.sub === 'held' ? 'no play in K' : 'no credit in K', K: P.cands.map((x: any) => label(t, s, x.action)) };
  const cand = P.cands[ci];
  const bi = P.cands.findIndex((x: any) => same(x.action, P.best));
  const best = P.cands[bi >= 0 ? bi : 0];
  if (ci === bi) return { ...o, layer: 'picked', note: 'the look-ahead picked it; another step took the click' };
  // the operation's own terms on each candidate's leaf (0 where the card is not in HQ there)
  const terms = (x: any) => x.ops.find((p: any) => p.id === c.id)?.terms ?? 0;
  const gap = best.value - cand.value;
  const opGap = terms(best) - terms(cand);
  const split = { gap: r3(gap), opGap: r3(opGap), rest: r3(gap - opGap), opBest: r3(terms(best)), opCand: r3(terms(cand)), pick: label(t, s, best.action), pickKind: kindOf(t, s, best.action, c.id), endCand: cand.ops.find((p: any) => p.id === c.id) ?? null };
  if (c.sub === 'held') return { ...o, layer: 'L5', ...split };
  // the credit's playout: the first step where the card is payable with a click left
  const steps: any[] = cand.steps;
  const k = steps.findIndex(x => x.payable);
  const plays = steps.some(x => x.plays);
  if (plays) return { ...o, layer: 'L5', ...split };
  if (k >= 0) return { ...o, layer: 'L3', why: 'payable, not played', took: steps[k].type, line: steps[k].line, byLine: steps[k].byLine, at: k, ...split };
  if (c.sub === 'now') {
    const firstOther = steps.find(x => x.type !== 'GAIN_CREDIT');
    return { ...o, layer: 'L3', why: 'never payable: clicks or credits spent', took: firstOther?.type ?? null, line: firstOther?.line ?? null, byLine: firstOther?.byLine ?? null, ...split };
  }
  return { ...o, layer: 'L4', ...split };
}

// ------------------------------------------------------------------------------------------------ the record of a source
interface Dec {
  src: string;
  kind: 'self' | 'humanRunner' | 'humanCorp';
  who: 'ai' | 'person';
  i: number;
  j: number;
  s: GameState;
  side: 'corp' | 'runner';
  cls: Cls;
  snaps?: Snaps;
  played?: GameAction | null;
}
/** One light record a step: turn, side, the money operations in HQ, scores. */
interface Step {
  T: number;
  P: string;
  hq: string[];
  cs: number;
  rs: number;
}
function stepOf(t: Tree, s: GameState): Step {
  return { T: s.turnNumber, P: s.activePlayer, hq: s.corp.hq.filter((c: any) => t.core.cardDef(c).type_code === 'operation' && t.vm.moneyGain(c) > 0).map((c: any) => c.instanceId), cs: s.corp.score, rs: s.runner.score };
}
interface Source {
  name: string;
  kind: 'self' | 'humanRunner' | 'humanCorp';
  decs: Dec[];
  steps: Step[];
  meta: Record<string, unknown>;
}
const record: { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] }[] = JSON.parse(readFileSync('scripts/stage-d/post-pick-deals.json', 'utf8'));
const hdir = 'tests/fixtures/human-games';

function playDeal(seed: number, upTo = Infinity): Source {
  const rec = record.find(r => r.seed === seed)!;
  const name = `deal:${seed}`;
  const t = trees.source;
  t.clear();
  const ag = { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') };
  const g = new t.GameRunner(dealState(seed), ag);
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  const decs: Dec[] = [];
  const steps: Step[] = [stepOf(t, g.state)];
  for (let n = 0; n < 4000 && decs.length <= upTo; n++) {
    const s: GameState = g.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    const dec = decisionOf(t.core, s);
    const copy = dec ? structuredClone(s) : null;
    const snaps = dec ? { corp: snapAgent(ag.corp), runner: snapAgent(ag.runner) } : undefined;
    if (!g.step()) break;
    steps.push(stepOf(t, g.state));
    if (dec && copy) decs.push({ src: name, kind: 'self', who: 'ai', i: decs.length, j: steps.length - 2, s: copy, side: dec.side, cls: dec.cls, snaps, played: g.last ?? null });
  }
  const matches = upTo === Infinity ? (g.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc) : null;
  return {
    name,
    kind: 'self',
    decs,
    steps,
    meta: { decks: `${rec.corpDeck} v ${rec.runnerDeck}`, winner: g.state.winner ?? null, T: g.state.turnNumber, cs: g.state.corp.score, rs: g.state.runner.score, matchesBatch: matches, ...(matches === false ? { cr, sc, recCr: rec.cr, recSc: rec.sc, recWinner: rec.winner } : {}) },
  };
}
function playHuman(file: string): Source | null {
  const r = JSON.parse(readFileSync(join(hdir, file), 'utf8'));
  const kind = r.config.ai === 'corp' ? 'humanRunner' : 'humanCorp';
  const aiSide = r.config.ai === 'corp' ? 'corp' : 'runner';
  const name = `human:${file}`;
  if (!r.moves?.length) return null;
  const t = trees.beta;
  const core = t.core;
  let s: GameState;
  if (r.startsAt === 'state') s = structuredClone(r.state);
  else {
    s = core.createInitialGameState(t.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
    if (r.startStops) s = { ...s, stops: r.startStops };
  }
  let stopped: string | null = null;
  const decs: Dec[] = [];
  const steps: Step[] = [stepOf(t, s)];
  for (const [j, move] of (r.moves as GameAction[]).entries()) {
    const dec = decisionOf(core, { ...s, stops: { corp: 'ai', runner: 'ai' } } as GameState);
    if (dec) decs.push({ src: `${name}#${j}`, kind, who: dec.side === aiSide ? 'ai' : 'person', i: decs.length, j, s: structuredClone(s), side: dec.side, cls: dec.cls, played: move });
    let next: GameState;
    try {
      next = core.executeAction(s, move);
    } catch (e) {
      stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
      break;
    }
    steps.push(stepOf(t, next));
    s = next;
  }
  return { name, kind, decs, steps, meta: { moves: r.moves.length, stopped, aiSide } };
}

// ------------------------------------------------------------------------------------------------ PART ask
let rot = 0;
const RUNNER = process.env.RUNNER === '1';
function partAsk(src: Source) {
  const t = trees.beta;
  const { decs } = src;
  const r50 = src.name.includes('report-50');
  /** spells: card id -> its first class board (decision index) and the boards since */
  const spells = new Map<string, { start: number; title: string; subs: string[]; boards: number[] }>();
  for (const d of decs) {
    if (d.side === 'runner' && !RUNNER) continue;
    const cls = d.side === 'corp' && d.cls === 'corpMain' ? classOf(t, d.s, d.played) : [];
    const order = [...ASKED.slice(rot % ASKED.length), ...ASKED.slice(0, rot % ASKED.length)];
    rot++;
    const asks: Record<string, Ask> = {};
    for (const arm of order) asks[arm] = ask(trees[arm], d.s, d.snaps);
    const b = asks.beta;
    const changed = ASKED_ARMS.filter(a => asks[a].k !== b.k);
    const row: Record<string, unknown> = { kind: 'd', src: d.src, sk: d.kind, who: d.who, i: d.i, T: d.s.turnNumber, side: d.side, c: d.cls, ms: ASKED.map(a => r3(asks[a].ms)), pm: ASKED.map(a => r3(asks[a].pm)), fire: ASKED.map(a => asks[a].fire) };
    if (asks.control.k !== b.k) row.controlDiffers = true;
    if (d.played !== undefined && d.who === 'ai') row.fresh = same(d.played, b.a);
    for (const a of ASKED) if (asks[a].err) (row.errors ??= {} as any)[a] = asks[a].err;
    if (cls.length) row.cls = cls.map(c => ({ t: c.title, sub: c.sub, short: c.short, plan: c.plan }));
    const hasHF = d.cls === 'corpMain' && isCorpMainBoard(t, d.s) && d.s.corp.hq.some((c: any) => t.core.cardDef(c).title === 'Hedge Fund');
    if (changed.length || (r50 && hasHF)) {
      row.labels = Object.fromEntries(ASKED.map(a => [a, label(t, d.s, asks[a].a)]));
      row.played = label(t, d.s, d.played);
      row.cr = d.s.corp.credits;
      row.clk = d.s.corp.clicks;
      row.hq = d.s.corp.hq.map((c: any) => t.core.cardDef(c).title);
      row.agendas = Object.values(d.s.corp.servers as Record<string, any>).flatMap(v => v.root.filter((c: any) => t.core.cardDef(c).type_code === 'agenda').map((c: any) => `${t.core.cardDef(c).title}:${c.advancementCounters ?? 0}/${t.core.cardDef(c).advancement_cost}`));
      if (r50 && hasHF) row.r50 = true;
    }
    if (changed.length) row.changed = changed;
    out(row);
    for (const arm of changed) {
      const x = asks[arm];
      if (!x.a || !b.a) continue;
      out({ kind: 'cj', job: 'arm', src: d.src.split('#')[0], sk: d.kind, who: d.who, at: d.i, arm, T: d.s.turnNumber, side: d.side, c: d.cls, a: [x.a], b: [b.a], la: label(t, d.s, x.a), lb: label(t, d.s, b.a), ka: kindOf(t, d.s, x.a), kb: kindOf(t, d.s, b.a), inClass: cls.filter(c => c.sub !== 'far' && c.sub !== 'played').map(c => c.sub), fire: x.fire, ids: d.s.corp.hq.filter((c: any) => t.core.cardDef(c).type_code === 'operation' && t.vm.moneyGain(c) > 0).map((c: any) => c.instanceId) });
    }
    // the class board: T, S, guards
    const live = cls.filter(c => c.sub === 'now' || c.sub === 'next' || c.sub === 'held');
    if (live.length) {
      const tr = ask(t, d.s, d.snaps, live.map(c => c.id));
      let S: any;
      try {
        S = priceTable(t, d.s, live);
      } catch (e) {
        S = { err: (e as Error).message.slice(0, 100) };
      }
      for (const c of live) {
        const toward = c.sub === 'held' ? false : d.played?.type === 'GAIN_CREDIT';
        const layer = toward ? { layer: 'toward' } : layerOf(t, d.s, c, tr, d.played);
        const g: Record<string, unknown> = {};
        for (const arm of ['beta', ...ASKED_ARMS]) {
          try {
            g[arm] = guards(trees[arm], d.s, c);
          } catch (e) {
            g[arm] = { err: (e as Error).message.slice(0, 80) };
          }
        }
        out({ kind: 'c', src: d.src, sk: d.kind, who: d.who, i: d.i, T: d.s.turnNumber, card: c.title, cost: c.cost, gain: c.gain, sub: c.sub, short: c.short, clk: d.s.corp.clicks, cr: d.s.corp.credits, plan: c.plan, played: label(t, d.s, d.played), pk: kindOf(t, d.s, d.played, c.id), trace: label(t, d.s, tr.a), ...layer, S: Array.isArray(S) ? S.find((x: any) => x.id === c.id)?.rows : S, guards: g, r50: r50 || undefined });
        if (!spells.has(c.id)) spells.set(c.id, { start: d.i, title: c.title, subs: [], boards: [] });
        const sp = spells.get(c.id)!;
        sp.subs.push(c.sub);
        sp.boards.push(d.i);
      }
    }
    // a card played from the class without a live board first still ends no spell (spells start at a live board)
  }
  partSpells(src, spells);
}

/** Spells: fate, turns, the source's clicks while the card waited; and the R jobs (at most 3 spells a source). */
function partSpells(src: Source, spells: Map<string, { start: number; title: string; subs: string[]; boards: number[] }>) {
  const t = trees.beta;
  const { decs, steps } = src;
  let nR = 0;
  for (const [id, sp] of [...spells.entries()].sort((a, b) => a[1].start - b[1].start)) {
    const d0 = decs[sp.start];
    // HIDDEN-READ (measuring script): where the card went, from the source's record
    let kEnd = steps.length - 1;
    for (let k = d0.j + 1; k < steps.length; k++)
      if (!steps[k].hq.includes(id)) {
        kEnd = k;
        break;
      }
    const left = !steps[kEnd].hq.includes(id);
    const byDec = decs.find(d => d.j === kEnd - 1);
    const how = !left ? 'end' : byDec?.played?.type === 'PLAY_OPERATION_OR_EVENT' && (byDec.played as any).cardInstanceId === id ? 'played' : 'other';
    // the source's Corp main-phase clicks while it waited, and the turns it waited from its first held (payable) board
    const clicks: Record<string, number> = {};
    let firstHeldT: number | null = null;
    for (const d of decs) {
      if (d.j < d0.j || d.j >= kEnd || d.side !== 'corp' || d.cls !== 'corpMain' || !isCorpMainBoard(t, d.s)) continue;
      if (d.who !== (src.kind === 'humanCorp' ? 'person' : 'ai')) continue;
      const k = kindOf(t, d.s, d.played, id);
      clicks[k] = (clicks[k] ?? 0) + 1;
      if (firstHeldT === null && sp.boards.includes(d.i) && d.s.corp.credits >= (t.core.cardDef(t.core.findCardAnywhere(d.s, id)).cost ?? 0)) firstHeldT = d.s.turnNumber;
    }
    out({ kind: 'sp', src: src.name, sk: src.kind, card: sp.title, firstSub: sp.subs[0], subs: [...new Set(sp.subs)], T0: d0.s.turnNumber, Tend: steps[kEnd].T, turns: steps[kEnd].T - d0.s.turnNumber, heldTurns: firstHeldT === null ? null : steps[kEnd].T - firstHeldT, how, clicks });
    // the R job: the first board of the spell where the source's action is not the save-up action
    if (nR >= 3) continue;
    for (const i of sp.boards) {
      const d = decs[i];
      const c = classOf(t, d.s, d.played).find(x => x.id === id);
      if (!c || (c.sub !== 'now' && c.sub !== 'next' && c.sub !== 'held')) continue;
      const legal: GameAction[] = t.core.getLegalActions(d.s, 'corp');
      const save = c.sub === 'held' ? legal.find(a => a.type === 'PLAY_OPERATION_OR_EVENT' && (a as any).cardInstanceId === id) : legal.find(a => a.type === 'GAIN_CREDIT');
      if (!save || same(save, d.played)) continue;
      out({ kind: 'cj', job: 'R', src: src.name, sk: src.kind, who: d.who, at: d.i, T: d.s.turnNumber, id, card: c.title, sub: c.sub, short: c.short, clk: d.s.corp.clicks, pk: kindOf(t, d.s, d.played, id), lb: label(t, d.s, d.played), ids: [id] });
      nR++;
      break;
    }
  }
}

// ------------------------------------------------------------------------------------------------ PART cont
interface ContRes {
  cs2: number;
  rs2: number;
  cs: number;
  rs: number;
  winner: string | null;
  T: number;
  crNext: number | null;
  wait: Record<string, number | null>;
  forced?: number;
  err?: string;
}
/** The save-up line: at the Corp's main-phase boards while `id` is in HQ, up to the end of the Corp's next turn. */
function saveUpCorp(t: Tree, base: any, id: string, T0: number, n: { forced: number }) {
  return new Proxy(base, {
    get(tg, p) {
      if (p === 'chooseAction')
        return (s: GameState) => {
          if (s.turnNumber <= T0 + 1 && isCorpMainBoard(t, s) && s.corp.hq.some((c: any) => c.instanceId === id)) {
            const legal: GameAction[] = t.core.getLegalActions(s, 'corp');
            const play = legal.find(a => a.type === 'PLAY_OPERATION_OR_EVENT' && (a as any).cardInstanceId === id);
            const credit = legal.find(a => a.type === 'GAIN_CREDIT');
            const a = play ?? credit;
            if (a) {
              n.forced++;
              return a;
            }
          }
          return base.chooseAction(s);
        };
      const v = (tg as any)[p];
      return typeof v === 'function' ? v.bind(tg) : v;
    },
  });
}
function cont(s0: GameState, firsts: GameAction[], snaps: Snaps | undefined, ids: string[], saveId?: string): ContRes {
  const t = trees.beta;
  t.clear();
  let s: GameState = structuredClone(s0);
  const T0 = s0.turnNumber;
  const none: ContRes = { cs2: s0.corp.score, rs2: s0.runner.score, cs: s0.corp.score, rs: s0.runner.score, winner: null, T: T0, crNext: null, wait: {} };
  try {
    for (const a of firsts) {
      if (!t.core.isLegalAction(s, a)) return { ...none, err: `not legal: ${a.type}` };
      s = t.core.executeAction(s, a);
    }
  } catch (e) {
    return { ...none, err: (e as Error).message.slice(0, 100) };
  }
  const ag = agents(t, snaps);
  const n = { forced: 0 };
  if (saveId) ag.corp = saveUpCorp(t, ag.corp, saveId, T0, n);
  const g = new t.GameRunner(s, ag);
  let two: { cs: number; rs: number } | null = null;
  // the end of the Corp's next turn: the decision is in the Corp's turn T0 (its next is T0 + 1) or the Runner's (next T0 + 1)
  let crNext: number | null = null;
  const wait: Record<string, number | null> = Object.fromEntries(ids.map(id => [id, null]));
  const look = (st: GameState) => {
    for (const id of ids) if (wait[id] === null && !st.corp.hq.some((c: any) => c.instanceId === id)) wait[id] = st.turnNumber - T0;
    if (crNext === null && ((st.turnNumber === T0 + 1 && st.activePlayer === 'runner') || st.turnNumber > T0 + 1)) crNext = st.corp.credits;
  };
  look(s);
  let err: string | undefined;
  try {
    for (let k = 0; k < 6000; k++) {
      if (!two && (g.state.turnNumber >= T0 + 2 || g.state.winner)) two = { cs: g.state.corp.score, rs: g.state.runner.score };
      if (!g.step()) break;
      look(g.state);
    }
  } catch (e) {
    err = (e as Error).message.slice(0, 100);
  }
  for (const id of ids) if (wait[id] === null) wait[id] = -1; // still in HQ at the end
  return { cs2: two?.cs ?? g.state.corp.score, rs2: two?.rs ?? g.state.runner.score, cs: g.state.corp.score, rs: g.state.runner.score, winner: g.state.winner ?? null, T: g.state.turnNumber, crNext: crNext ?? g.state.corp.credits, wait, forced: saveId ? n.forced : undefined, ...(err ? { err } : {}) };
}

async function partCont() {
  const jobs: any[] = JSON.parse(readFileSync(process.env.JOBS!, 'utf8'));
  const mine = jobs.filter(j => j.shard % shards === shard);
  const bySrc = new Map<string, any[]>();
  for (const j of mine) (bySrc.get(j.src) ?? bySrc.set(j.src, []).get(j.src)!).push(j);
  for (const [name, list] of bySrc) {
    const t0 = performance.now();
    const maxAt = Math.max(...list.map(j => j.at));
    const src = name.startsWith('deal:') ? playDeal(Number(name.slice(5)), maxAt) : playHuman(name.slice(6));
    if (!src) continue;
    for (const j of list) {
      const d = src.decs[j.at];
      if (!d) {
        out({ kind: 'cr', id: j.id, err: 'no decision' });
        continue;
      }
      const base = { kind: 'cr', id: j.id, cs0: d.s.corp.score, rs0: d.s.runner.score, cr0: d.s.corp.credits, T0: d.s.turnNumber };
      if (j.job === 'R') {
        // line i: beta's own line (its fresh, restored agents from this board); line ii: the save-up line
        out({ ...base, line: 'i', r: cont(d.s, [], d.snaps, j.ids) });
        out({ ...base, line: 'ii', r: cont(d.s, [], d.snaps, j.ids, j.id) });
      } else {
        out({ ...base, line: 'a', r: cont(d.s, j.a, d.snaps, j.ids) });
        out({ ...base, line: 'b', r: cont(d.s, j.b, d.snaps, j.ids) });
      }
    }
    out({ kind: 'cs', src: name, jobs: list.length, ms: Math.round(performance.now() - t0) });
  }
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const used = PART === 'cont' ? (['beta', 'source'] as Arm[]) : ARMS.filter(a => a === 'source' || ASKED.includes(a));
  const dirs = makeTrees(root, used);
  trees = {};
  for (const arm of used) trees[arm] = await loadTree(arm, dirs[arm]);
  if (PART === 'cont') await partCont();
  else {
    if (shard === 0) out({ kind: 'meta', asked: ASKED });
    const want = (process.env.DEALS ?? '').split(',').filter(Boolean);
    const dealList = want.includes('none') ? [] : record.filter(r => !want.length || want.includes(String(r.seed)));
    const hwant = (process.env.HUMAN ?? '').split(',').filter(Boolean);
    const humans = hwant.includes('none')
      ? []
      : readdirSync(hdir)
          .filter(f => f.endsWith('.json') && (!hwant.length || hwant.some(w => f.startsWith(w))))
          .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')) || a.localeCompare(b));
    const sources: { kind: 'deal' | 'human'; id: any }[] = [...humans.map(f => ({ kind: 'human' as const, id: f })), ...dealList.map(r => ({ kind: 'deal' as const, id: r.seed }))];
    for (const [k, s] of sources.entries()) {
      if (k % shards !== shard) continue;
      const t0 = performance.now();
      const src = s.kind === 'deal' ? playDeal(s.id) : playHuman(s.id);
      if (!src) continue;
      out({ kind: s.kind === 'deal' ? 'g' : 'h', src: src.name, sk: src.kind, decisions: src.decs.length, ...src.meta });
      partAsk(src);
      out({ kind: 's', src: src.name, sk: src.kind, ms: Math.round(performance.now() - t0), decisions: src.decs.length });
    }
  }
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
