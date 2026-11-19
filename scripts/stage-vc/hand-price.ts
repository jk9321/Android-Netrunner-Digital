/**
 * V-C item 2 (the hand's price), count step. Brief: /mnt/project-files/netrunner-ai/stage-vc/item2-hand-price/brief.md.
 * Scripts only: nothing in src or tests. Trees and arms: hand-price-trees.ts (each a patched copy of this checkout's src,
 * its own module graph).
 *
 * Two parts (PARTS=ask, the default; PARTS=cont with JOBS=<file>), because continuations to the game's end are the slow
 * part and are spread over the shards by job, not by source:
 *
 * PART ask. Sources (kinds kept apart everywhere: self, humanRunner = the person played the Runner, humanCorp):
 *  (a) the 221 deals of the g1 base 44381468776 (scripts/stage-d/post-pick-deals.json: each game's winner, cr and sc
 *      checked against that record), played by the `source` tree with a plain GameRunner, Normal v Normal, as the batch.
 *      The source tree is never asked or cleared mid-game (found row 71b); its agents' state is copied (structuredClone)
 *      before each step into the fresh agents that are asked.
 *  (b) the human files in tests/fixtures/human-games: the recorded moves replayed; at every board where either side
 *      decides, today's AI of that side is asked (fresh agents, no memory). `who`: ai (the AI played that side) or person.
 *  Every decision is asked of beta, control and each arm (one-step GameRunner on a copy of the board, fresh agents of that
 *  tree, caches cleared first, the order of the trees rotated per decision, timed, the time inside the planner apart).
 *  A control answer unlike beta's is a stop. Per ask: the reader calls (keepValue, hqTrashCardsLoss, scoreOutcome,
 *  keepBonus) and the arms' fire counts.
 *  H1 (untimed, beta tree, the Corp's decision view): at every Corp turn start (its first main-phase decision of the turn)
 *  and at every Corp decision where a card can leave HQ other than by being played or installed (an answer beta's
 *  fallback prices sends an HQ card to Archives or R&D; a discard prompt; a prompt that picks HQ cards; a main-phase board
 *  with a legal resource trash that costs HQ cards), each HQ card's heldWorth, keepValue less CLICK, 0.5 x keepValue and
 *  its share of the flat handValue, and the pairs of cards the held worth and the keep order differently.
 *  H3 (b): every Corp decision after which an agenda went from HQ to Archives: Archives' 'runnerTurn' hold on the board
 *  after it, archivedAgendaLoss there, and what followed (breached Archives, stolen from it). (c) the shuffle charges the
 *  beta ask records. (d) keepBonus calls over every ask.
 *  G1: every Corp turn that ends with an agenda in HQ whose install was legal at one of that turn's main-phase decisions:
 *  at the last such board, the order's candidate for that agenda (line, behind, server, the server's hold after the
 *  install), HQ's 'runnerTurn' hold and entries, __hqSteal, the Corp's credits, its clicks on credits and draws that turn;
 *  then what followed (the measuring script reads the true record): successful HQ runs on the Runner's next turn,
 *  agendas stolen from HQ there, and the agenda's fate (installed, scored, stolen from where, discarded, by turn).
 *  G2 (the class) is read from G1 rows by the summing step; the continuation jobs for G3 and for every arm's changed
 *  decision are written as `cj` rows.
 *
 * PART cont: each job (a source, a decision index, the first action(s), the Runner's mode) from that decision's board,
 * on the beta tree with fresh agents restored from the source's state: beta's agents both sides to the game's end, or
 * with the HQ line (the Runner, on its next turn only, runs HQ with every click while its HQ runs this turn have all got
 * in, then beta's Runner; its in-run choices are beta's Runner's). Read: Corp and Runner points two turn pairs later and
 * at the end, the winner.
 *
 * Hidden information: agents are asked only through GameRunner (their own views). This measuring script reads the true
 * record of what followed (stolen, fate, breached) and, for G1, the Corp's own HQ (known to it): marked HIDDEN-READ where
 * it reads a card the Corp could not see. No arm reads it.
 *
 *   SHARD=0/64 npx vite-node scripts/stage-vc/hand-price.ts
 *   ARGS="DEALS=1321 HUMAN=none" npx vite-node scripts/stage-vc/hand-price.ts
 *   ARGS="PARTS=cont JOBS=scripts/stage-vc/hand-price-jobs.json" SHARD=0/64 npx vite-node scripts/stage-vc/hand-price.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { dealState } from '../stage-a/harness';
import { ARMS, Arm, G_ARMS, PRICE_ARMS, Tree, loadTree, makeTrees } from './hand-price-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/hand-price', String(shard));
const PART = process.env.PARTS ?? 'ask';
const ASKED: Arm[] = ['beta', 'control', ...(process.env.ARMS_ASK ? (process.env.ARMS_ASK.split(',') as Arm[]) : PRICE_ARMS)];
const ASKED_ARMS = ASKED.slice(2);
const G = globalThis as any;
const key = (a: unknown) => (a ? JSON.stringify(a) : 'null');
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r3 = (x: number) => Math.round(x * 1000) / 1000;

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
  calls: Record<string, number>;
  fire: Record<string, number>;
  shuffle: any[];
  leave: boolean;
  kbCards: Record<string, number>;
  err?: string;
}
function resetG() {
  G.__hpCalls = {};
  G.__hpFire = {};
  G.__hpShuffle = [];
  G.__hpLeave = false;
  G.__hpKbCards = {};
  G.__hpPlanMs = 0;
  G.__hpTopNext = false;
  G.__hpPTop = false;
}
function ask(t: Tree, s: GameState, snaps: Snaps | undefined): Ask {
  t.clear();
  const ag = agents(t, snaps);
  const g = new t.GameRunner(structuredClone(s), ag);
  resetG();
  G.__hpArm = true;
  const at = performance.now();
  try {
    g.step();
    const ms = performance.now() - at;
    const a = g.last as GameAction | null;
    return { a, k: key(a), ms, pm: G.__hpPlanMs, calls: G.__hpCalls, fire: G.__hpFire, shuffle: G.__hpShuffle, leave: !!G.__hpLeave, kbCards: G.__hpKbCards };
  } catch (e) {
    return { a: null, k: `error: ${(e as Error).message.slice(0, 80)}`, ms: performance.now() - at, pm: G.__hpPlanMs, calls: G.__hpCalls, fire: G.__hpFire, shuffle: [], leave: false, kbCards: {}, err: (e as Error).message.slice(0, 160) };
  } finally {
    G.__hpArm = false;
    resetG();
  }
}

function title(t: Tree, s: GameState, id: string): string {
  const c = t.core.findCardAnywhere(s, id);
  return c ? `${t.core.cardDef(c).type_code}:${t.core.cardDef(c).title}` : id;
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
function promptInfo(t: Tree, s: GameState) {
  const p = t.core.activePrompt(s);
  if (!p) return null;
  const src = 'source' in p ? p.source : null;
  return { side: p.side, kind: p.kind, code: src?.cardCode ?? null, step: src?.step ?? null, card: src ? t.core.getCardDefinition(src.cardCode).title : null };
}

// ------------------------------------------------------------------------------------------------ measures (beta tree)
const isAgenda = (t: Tree, c: any) => t.core.cardDef(c).type_code === 'agenda';
/** Runs f as the deciding Corp on its own decision view, the decision noted (as rankMainActions does). */
function asCorp<T>(t: Tree, s: GameState, f: (view: GameState) => T): T {
  t.clear();
  return t.pricing.asSide('corp', () => {
    const view = t.tp.corpDecisionView(s);
    t.hv.decisionContext(view, 'corp');
    return f(view);
  });
}
/** H1: each HQ card's four prices, and the pairs the held worth and the keep order differently. */
function h1Prices(t: Tree, s: GameState) {
  return asCorp(t, s, view => {
    const hq = view.corp.hq;
    const n = hq.length;
    const flat = n ? t.ev.handValue(n, view.corp.handSizeLimit, 'corp') / n : 0;
    const CLICK = t.vm.CLICK;
    const cards = hq.map((c: any) => {
      const keep = t.ev.keepValue(view, c);
      return { code: c.cardCode, title: t.core.cardDef(c).title, type: t.core.cardDef(c).type_code, held: r3(t.hv.heldWorth(view, c, 'corp')), keepNet: r3(keep - CLICK), half: r3(0.5 * keep), flat: r3(flat) };
    });
    let invAN = 0;
    let invOther = 0;
    let pairsAN = 0;
    let pairsOther = 0;
    const E = 1e-9;
    for (let i = 0; i < cards.length; i++)
      for (let j = i + 1; j < cards.length; j++) {
        const an = (cards[i].type === 'agenda') !== (cards[j].type === 'agenda');
        if (an) pairsAN++;
        else pairsOther++;
        const dh = cards[i].held - cards[j].held;
        const dk = cards[i].keepNet - cards[j].keepNet;
        if (Math.abs(dh) > E && Math.abs(dk) > E && Math.sign(dh) !== Math.sign(dk)) {
          if (an) invAN++;
          else invOther++;
        }
      }
    return { cards, invAN, invOther, pairsAN, pairsOther };
  });
}
/** G1: the order's candidate for each agenda id, HQ's hold, __hqSteal, on this board (the Corp's view). */
function g1Order(t: Tree, s: GameState, snaps: Snaps | undefined, ids: string[]) {
  return asCorp(t, s, view => {
    const ag = agents(t, snaps).corp;
    const ranked = ag.rankMainActions(s) as any[];
    const hq = t.hold.serverHold(view, 'hq', { when: 'runnerTurn', corpCredits: view.corp.credits });
    const steal = t.hv.__hqSteal(view);
    const per: Record<string, any> = {};
    for (const id of ids) {
      const i = ranked.findIndex(r => r.card === id && r.action.type === 'INSTALL_CARD');
      if (i < 0) {
        per[id] = null;
        continue;
      }
      const r = ranked[i];
      const a = r.action;
      let server: string | null = a.asNewRemote || !a.targetServerId ? null : a.targetServerId;
      let hold: any = null;
      let remoteSteal: number | null = null;
      try {
        const after = t.core.executeAction(structuredClone(view), a);
        server = Object.values(after.corp.servers as Record<string, any>).find(v => v.root.some((c: any) => c.instanceId === id))?.id ?? server;
        if (server) {
          const h = t.hold.serverHold(after, server, { when: 'runnerTurn', corpCredits: after.corp.credits });
          hold = { holds: h.holds, margin: r3(h.margin), entries: h.entries, need: r3(h.need), budget: r3(h.budget) };
          remoteSteal = r3(t.hv.__remoteSteal(after, server));
        }
      } catch (e) {
        hold = { err: (e as Error).message.slice(0, 80) };
      }
      per[id] = { pos: i, of: ranked.length, line: r.line, behind: r.behind, server: a.asNewRemote ? 'new' : a.targetServerId ?? 'new', placed: server, hold, remoteSteal, action: a };
    }
    return { hq: { holds: hq.holds, entries: hq.entries, margin: r3(hq.margin), need: r3(hq.need), budget: r3(hq.budget) }, steal: r3(steal), first: ranked[0] ? { line: ranked[0].line, behind: ranked[0].behind, type: ranked[0].action.type } : null, per };
  });
}

// ------------------------------------------------------------------------------------------------ the record of a source
interface Dec {
  src: string;
  kind: 'self' | 'humanRunner' | 'humanCorp';
  who: 'ai' | 'person';
  i: number;
  /** the step index in the trajectory */
  j: number;
  s: GameState;
  side: 'corp' | 'runner';
  cls: Cls;
  snaps?: Snaps;
  played?: GameAction | null;
}
/** One light record a step: turn, side, agenda locations, scores, the runs of this turn so far. */
interface Step {
  T: number;
  P: string;
  loc: Record<string, string>;
  cs: number;
  rs: number;
  runs: { server: string; in: boolean }[];
}
function locs(t: Tree, s: GameState): Record<string, string> {
  const o: Record<string, string> = {};
  const put = (cs: any[], where: string) => {
    for (const c of cs) if (isAgenda(t, c)) o[c.instanceId] = where;
  };
  put(s.corp.hq, 'hq');
  put(s.corp.rd, 'rd');
  put([...s.corp.archives.faceUp, ...s.corp.archives.faceDown], 'archives');
  for (const v of Object.values(s.corp.servers) as any[]) put(v.root, `server:${v.id}`);
  put(s.corp.scoreArea, 'corpScore');
  put(s.runner.scoreArea, 'runnerScore');
  return o;
}
function stepOf(t: Tree, s: GameState): Step {
  return { T: s.turnNumber, P: s.activePlayer, loc: locs(t, s), cs: s.corp.score, rs: s.runner.score, runs: (s.runsThisTurn ?? []).map(r => ({ server: r.server, in: !!r.successful })) };
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
function partAsk(src: Source) {
  const t = trees.beta;
  const { decs, steps } = src;
  let kb = { calls: 0, nz: 0 };
  const kbCards: Record<string, number> = {};
  const seenTurnStart = new Set<number>();
  const changedPer: Record<string, number> = {};
  for (const d of decs) {
    const order = [...ASKED.slice(rot % ASKED.length), ...ASKED.slice(0, rot % ASKED.length)];
    rot++;
    const asks: Record<string, Ask> = {};
    for (const arm of order) asks[arm] = ask(trees[arm], d.s, d.snaps);
    const b = asks.beta;
    kb = { calls: kb.calls + (b.calls.kb ?? 0), nz: kb.nz + (b.calls.kbnz ?? 0) };
    for (const [c, n] of Object.entries(b.kbCards)) kbCards[c] = (kbCards[c] ?? 0) + n;
    const changed = ASKED_ARMS.filter(a => asks[a].k !== b.k);
    const row: Record<string, unknown> = { kind: 'd', src: d.src, sk: d.kind, who: d.who, i: d.i, T: d.s.turnNumber, side: d.side, c: d.cls, ms: ASKED.map(a => r3(asks[a].ms)), pm: ASKED.map(a => r3(asks[a].pm)) };
    const fires = ASKED.map(a => asks[a].fire);
    if (fires.some(f => Object.keys(f).length)) row.fire = fires;
    if (d.side === 'corp') row.calls = b.calls;
    if (asks.control.k !== b.k) row.controlDiffers = true;
    if (d.played !== undefined && d.who === 'ai') row.fresh = key(d.played) === b.k;
    for (const a of ASKED) if (asks[a].err) (row.errors ??= {} as any)[a] = asks[a].err;
    if (d.cls === 'corpPrompt' || d.cls === 'runnerPrompt') row.p = promptInfo(t, d.s);
    if (b.shuffle.length) row.shuffle = b.shuffle;
    if (b.leave) row.leave = true;
    if (changed.length) {
      row.changed = Object.fromEntries(changed.map(a => [a, label(t, d.s, asks[a].a)]));
      row.beta = label(t, d.s, b.a);
      row.hq = d.s.corp.hq.map((c: any) => t.core.cardDef(c).title);
      row.cr = d.s.corp.credits;
      row.clk = d.s.corp.clicks;
      row.rcr = d.s.runner.credits;
    }
    // H1
    let why: string | null = null;
    if (d.side === 'corp' && d.cls === 'corpMain' && d.s.activePlayer === 'corp' && !seenTurnStart.has(d.s.turnNumber)) {
      seenTurnStart.add(d.s.turnNumber);
      why = 'turnStart';
    }
    const p = d.cls === 'corpPrompt' ? t.core.activePrompt(d.s) : null;
    const hqIds = new Set(d.s.corp.hq.map((c: any) => c.instanceId));
    if (p?.kind === 'discard') why = 'discard';
    else if (p?.kind === 'effect_cards' && p.candidateIds.some((id: string) => hqIds.has(id))) why = why ?? 'pickHq';
    else if (b.leave) why = why ?? 'leave';
    if (d.cls === 'corpMain' && !why) {
      const trash = t.core.getLegalActions(d.s, 'corp').filter((a: any) => a.type === 'TRASH_RESOURCE');
      if (trash.some((a: any) => {
        const r = d.s.runner.rig.resources.find((c: any) => c.instanceId === a.cardInstanceId);
        return r && t.basic.resourceTrashHqCost(d.s, r) > 0;
      }))
        why = 'hqTrash';
    }
    if (why && d.s.corp.hq.length) {
      try {
        row.h1 = { why, ...h1Prices(t, d.s) };
      } catch (e) {
        row.h1 = { why, err: (e as Error).message.slice(0, 100) };
      }
    }
    // H3 (b): an agenda that went from HQ to Archives on this decision
    const st0 = steps[d.j];
    const st1 = steps[d.j + 1];
    if (d.side === 'corp' && st0 && st1) {
      const gone = Object.keys(st0.loc).filter(id => st0.loc[id] === 'hq' && st1.loc[id] === 'archives');
      if (gone.length) {
        const s1 = after1(src, d);
        let arch: any = null;
        if (s1) {
          try {
            arch = asCorp(t, s1, view => {
              const h = t.hold.serverHold(view, 'archives', { when: 'runnerTurn', corpCredits: view.corp.credits });
              return { holds: h.holds, entries: h.entries, loss: gone.map(id => r3(t.ev.archivedAgendaLoss(view, t.core.cardDef(t.core.findCardAnywhere(view, id)).agenda_points ?? 1))) };
            });
          } catch (e) {
            arch = { err: (e as Error).message.slice(0, 80) };
          }
        }
        // HIDDEN-READ (measuring script): what became of each agenda after
        const fate = gone.map(id => fateOf(steps, d.j + 1, id));
        row.h3b = { gone: gone.map(id => title(t, d.s, id)), arch, fate };
      }
    }
    out(row);
    // continuation jobs for the arms' changed decisions
    for (const arm of changed) {
      const x = asks[arm];
      if (!x.a || !b.a) continue;
      changedPer[arm] = (changedPer[arm] ?? 0) + 1;
      const hqLine = G_ARMS.includes(arm) && d.side === 'corp' && d.s.activePlayer === 'corp';
      out({ kind: 'cj', job: 'arm', src: d.src.split('#')[0], sk: d.kind, at: d.i, j: d.j, arm, T: d.s.turnNumber, side: d.side, c: d.cls, a: [x.a], b: [b.a], hq: hqLine, la: label(t, d.s, x.a), lb: label(t, d.s, b.a) });
    }
  }
  partG1(src);
  return { kb, kbCards, changedPer };
}
/** The board after decision d in the source (the next decision's board if it is the next step, else replayed). */
function after1(src: Source, d: Dec): GameState | null {
  const next = src.decs[d.i + 1];
  if (next && next.j === d.j + 1) return next.s;
  try {
    return d.played ? trees.beta.core.executeAction(structuredClone(d.s), d.played) : null;
  } catch {
    return null;
  }
}
/** HIDDEN-READ (measuring script): the agenda's next location change after step j, and at which turn. */
function fateOf(steps: Step[], j: number, id: string) {
  const at = steps[j]?.loc[id];
  for (let k = j + 1; k < steps.length; k++) {
    const l = steps[k].loc[id];
    if (l !== at) return { to: l ?? 'gone', T: steps[k].T, P: steps[k].P, from: at };
  }
  return { to: 'end', T: steps[steps.length - 1].T, from: at };
}

/** G1: every Corp turn ending with an agenda in HQ whose install was legal that turn; and G3's jobs at class boards. */
function partG1(src: Source) {
  const t = trees.beta;
  const { decs, steps } = src;
  const corpTurns = new Map<number, Dec[]>();
  for (const d of decs) if (d.side === 'corp' && d.cls === 'corpMain' && d.s.activePlayer === 'corp') (corpTurns.get(d.s.turnNumber) ?? corpTurns.set(d.s.turnNumber, []).get(d.s.turnNumber)!).push(d);
  for (const [T, list] of corpTurns) {
    // the turn's last step (the Corp's turn ends when the next step is the Runner's turn or a later turn)
    let jEnd = list[list.length - 1].j;
    while (jEnd + 1 < steps.length && steps[jEnd + 1].T === T && steps[jEnd + 1].P === 'corp') jEnd++;
    const endLoc = steps[Math.min(jEnd + 1, steps.length - 1)].loc;
    const legalAt = new Map<string, Dec>();
    for (const d of list) {
      const legal = t.core.getLegalActions(d.s, 'corp');
      for (const c of d.s.corp.hq)
        if (isAgenda(t, c) && legal.some((a: any) => a.type === 'INSTALL_CARD' && a.cardInstanceId === c.instanceId)) legalAt.set(c.instanceId, d);
    }
    const held = [...legalAt.keys()].filter(id => endLoc[id] === 'hq');
    if (!held.length) continue;
    // the Runner's next turn: from the end of this Corp turn to the next Corp turn
    let jr = jEnd + 1;
    while (jr < steps.length && steps[jr].P === 'corp') jr++;
    let jrEnd = jr;
    while (jrEnd + 1 < steps.length && steps[jrEnd + 1].P === 'runner') jrEnd++;
    const rTurn = jr < steps.length ? steps[jrEnd] : null;
    // HIDDEN-READ (measuring script): the true record of the Runner's next turn
    const hqRunsIn = rTurn ? rTurn.runs.filter(r => r.server === 'hq' && r.in).length : null;
    const hqRuns = rTurn ? rTurn.runs.filter(r => r.server === 'hq').length : null;
    const hqAgendasAtEnd = Object.keys(endLoc).filter(id => endLoc[id] === 'hq');
    const stolenFromHq = rTurn ? hqAgendasAtEnd.filter(id => rTurn.loc[id] === 'runnerScore').length : null;
    const stolenElsewhere = rTurn ? Object.keys(rTurn.loc).filter(id => rTurn.loc[id] === 'runnerScore' && endLoc[id] !== 'runnerScore' && endLoc[id] !== 'hq').length : null;
    // the turn's clicks on credits and draws (the source's played actions)
    const credits = list.filter(d => d.played?.type === 'GAIN_CREDIT').length;
    const draws = list.filter(d => d.played?.type === 'DRAW_CARD').length;
    const clicksCD = list.filter(d => d.played?.type === 'GAIN_CREDIT' || d.played?.type === 'DRAW_CARD');
    for (const id of held) {
      const at = legalAt.get(id)!;
      let order: any;
      try {
        order = g1Order(t, at.s, at.snaps, [id]);
      } catch (e) {
        order = { err: (e as Error).message.slice(0, 100) };
      }
      const c = order?.per?.[id];
      const fate = fateOf(steps, jEnd + 1, id);
      const row = {
        kind: 'g1',
        src: src.name,
        sk: src.kind,
        who: src.kind === 'humanCorp' ? 'person' : 'ai',
        T,
        agenda: title(t, at.s, id),
        pts: t.core.cardDef(t.core.findCardAnywhere(at.s, id)).agenda_points ?? 1,
        hqSize: at.s.corp.hq.length,
        hqAgendas: at.s.corp.hq.filter((x: any) => isAgenda(t, x)).length,
        hand: at.s.corp.hq.map((x: any) => t.core.cardDef(x).title),
        at: at.i,
        cr: at.s.corp.credits,
        crEnd: null as number | null,
        credits,
        draws,
        line: c?.line ?? null,
        behind: c?.behind ?? null,
        server: c?.server ?? null,
        hold: c?.hold ?? null,
        remoteSteal: c?.remoteSteal ?? null,
        hq: order?.hq ?? null,
        steal: order?.steal ?? null,
        first: order?.first ?? null,
        err: order?.err ?? null,
        hqRuns,
        hqRunsIn,
        stolenFromHq,
        stolenElsewhere,
        thisStolenNext: rTurn ? rTurn.loc[id] === 'runnerScore' : null,
        fate,
      };
      out(row);
      // G2 class: line 9, HQ does not hold for the coming turn, and the Corp ends the turn holding it -> G3 jobs
      if (row.line === 9 && row.hq && !row.hq.holds && c?.action) {
        const k = clicksCD[clicksCD.length - 1];
        const j2 = clicksCD[clicksCD.length - 2];
        const inst = (d: Dec | undefined) => {
          if (!d) return null;
          try {
            const o = g1Order(t, d.s, d.snaps, [id]).per[id];
            return o?.action && t.core.isLegalAction(d.s, o.action) ? o.action : null;
          } catch {
            return null;
          }
        };
        const ik = inst(k);
        const ij = inst(j2);
        const base = { kind: 'cj', job: 'g3', src: src.name.split('#')[0], sk: src.kind, T, agenda: row.agenda, hqSize: row.hqSize, hqAgendas: row.hqAgendas };
        if (!k || !ik) out({ ...base, none: !k ? 'no credit or draw click' : 'install not legal at that board' });
        else {
          for (const hq of [false, true]) {
            out({ ...base, line: 'i', at: k.i, j: k.j, a: [k.played], hq });
            out({ ...base, line: 'ii', at: k.i, j: k.j, a: [ik], hq });
            if (ij && j2) out({ ...base, line: 'iii', at: j2.i, j: j2.j, a: [ij, { type: 'ADVANCE_CARD', player: 'corp', cardInstanceId: id }], hq, iiiBase: true });
            if (ij && j2) out({ ...base, line: 'iiiBase', at: j2.i, j: j2.j, a: [j2.played], hq });
          }
        }
      }
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
  hqIn?: number;
  err?: string;
}
function hqRunner(t: Tree, base: any, T0: number) {
  return new Proxy(base, {
    get(tg, p) {
      if (p === 'chooseAction')
        return (s: GameState) => {
          if (!s.activeRun && s.pendingPrompts.length === 0 && s.activePlayer === 'runner' && s.turnNumber === T0 && s.runner.clicks > 0) {
            const hqRuns = (s.runsThisTurn ?? []).filter(r => r.server === 'hq');
            if (hqRuns.every(r => r.successful)) {
              const a = { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' } as GameAction;
              if (t.core.isLegalAction(s, a)) return a;
            }
          }
          return base.chooseAction(s);
        };
      const v = (tg as any)[p];
      return typeof v === 'function' ? v.bind(tg) : v;
    },
  });
}
function cont(s0: GameState, firsts: GameAction[], snaps: Snaps | undefined, hq: boolean): ContRes {
  const t = trees.beta;
  t.clear();
  let s: GameState = structuredClone(s0);
  const none: ContRes = { cs2: s0.corp.score, rs2: s0.runner.score, cs: s0.corp.score, rs: s0.runner.score, winner: null, T: s0.turnNumber };
  try {
    for (const a of firsts) {
      if (!t.core.isLegalAction(s, a)) return { ...none, err: `not legal: ${a.type}` };
      s = t.core.executeAction(s, a);
    }
  } catch (e) {
    return { ...none, err: (e as Error).message.slice(0, 100) };
  }
  const ag = agents(t, snaps);
  const T0 = s0.turnNumber;
  if (hq) ag.runner = hqRunner(t, ag.runner, T0);
  const g = new t.GameRunner(s, ag);
  let two: { cs: number; rs: number } | null = null;
  let lastRuns = 0;
  try {
    for (let n = 0; n < 6000; n++) {
      if (!two && (g.state.turnNumber >= T0 + 2 || g.state.winner)) two = { cs: g.state.corp.score, rs: g.state.runner.score };
      if (g.state.turnNumber === T0 && g.state.activePlayer === 'runner') lastRuns = (g.state.runsThisTurn ?? []).filter(r => r.server === 'hq' && r.successful).length;
      if (!g.step()) break;
    }
  } catch (e) {
    return { cs2: two?.cs ?? g.state.corp.score, rs2: two?.rs ?? g.state.runner.score, cs: g.state.corp.score, rs: g.state.runner.score, winner: g.state.winner ?? null, T: g.state.turnNumber, hqIn: lastRuns, err: (e as Error).message.slice(0, 100) };
  }
  return { cs2: two?.cs ?? g.state.corp.score, rs2: two?.rs ?? g.state.runner.score, cs: g.state.corp.score, rs: g.state.runner.score, winner: g.state.winner ?? null, T: g.state.turnNumber, hqIn: lastRuns };
}

async function partCont() {
  const jobs: any[] = JSON.parse(readFileSync(process.env.JOBS!, 'utf8'));
  // jobs carry a shard number (balanced by the summing step); each shard replays each of its sources once
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
      const r = cont(d.s, j.a, d.snaps, !!j.hq);
      out({ kind: 'cr', id: j.id, r, cs0: d.s.corp.score, rs0: d.s.runner.score, T0: d.s.turnNumber });
    }
    out({ kind: 'cs', src: name, jobs: list.length, ms: Math.round(performance.now() - t0) });
  }
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const used = PART === 'cont' || PART === 'states' ? (['beta', 'source'] as Arm[]) : ARMS.filter(a => a === 'source' || ASKED.includes(a));
  const dirs = makeTrees(root, used);
  trees = {};
  for (const arm of used) trees[arm] = await loadTree(arm, dirs[arm]);
  if (PART === 'cont') {
    await partCont();
  } else if (PART === 'states') {
    // the boards for the trace (hand-price-trace.ts STATES=): PICK=<file.json of {name, src, at}>, one {name, state} line each
    for (const p of JSON.parse(readFileSync(process.env.PICK!, 'utf8')) as { name: string; src: string; at: number }[]) {
      const src = p.src.startsWith('deal:') ? playDeal(Number(p.src.slice(5)), p.at) : playHuman(p.src.slice(6));
      const d = src?.decs[p.at];
      if (d) out({ name: p.name, state: d.s });
    }
  } else {
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
      const r = partAsk(src);
      out({ kind: 's', src: src.name, sk: src.kind, ms: Math.round(performance.now() - t0), decisions: src.decs.length, kb: r.kb, kbCards: r.kbCards, changed: r.changedPer });
    }
  }
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
