/**
 * V-C item 4 (install prompts and the Corp's other chained prompt answers, the fourth price), count step. Brief:
 * /mnt/project-files/netrunner-ai/stage-vc/item4-install-prompts/brief.md. Scripts only: nothing in src or tests.
 * Harness after scripts/stage-d/prompt-chain.ts (the first count of this class, run 44530910615); trees and arms:
 * install-prompt-trees.ts (each a patched copy of this checkout's src, its own module graph).
 *
 * Sources (kinds apart everywhere: self, humanRunner = the person played the Runner, humanCorp):
 *  (a) the 221 deals of the g1 base of current beta, run 44666924040 (install-prompt-deals.json: each game's winner, cr
 *      and sc checked against that record), played by the `source` tree with a plain GameRunner, Normal v Normal. The
 *      source tree is never asked or cleared mid-game (found row 71b); its agents' state is copied before each step into
 *      the fresh agents that are asked.
 *  (b) the human files in tests/fixtures/human-games: the recorded moves replayed; every board where either side decides
 *      is asked (fresh agents, no memory).
 *
 * Every decision (a prompt, a main-phase or run action, the Corp's rez window, the Runner's off-turn window) is asked of
 * beta, control and each arm: a one-step GameRunner on a copy of the board, fresh agents of that tree (state copied),
 * caches cleared first, tree order rotated per decision, timed (control is read in the same call sequence, found row 69a).
 * A control answer unlike beta's is a stop. Per ask: the fallback's calls, the chains followed and the ones followed only
 * by the arm's widening (`wide`), the top-level fallback record (each answer's score, half-keep term, whether it
 * continues the card's chain and whether the next step is an install step), and, on a main-phase decision, the planner's
 * per-candidate wide follows (the IN / OUTSIDE trace of the brief's (a)).
 *
 * Continuations (b): for each arm's changed decision (capped at CAP a source and arm), two GameRunners from the board on
 * the beta tree (src/ai/playout.ts, the batch's runner), fresh agents with the copied state, both sides beta's: the arm's
 * action first, and beta's. Read: the run under way (breach, points stolen, root cards trashed, HQ cards out by type),
 * Corp credits and HQ at the end of that turn, Corp and Runner points two turn pairs later, and the game's end (winner,
 * points; a flatline win is a win, found row 89 i).
 *
 * Hidden information: agents are asked only through GameRunner (their own views). This measuring script reads the
 * Corp's root and HQ card types after a continuation (marked HIDDEN-READ below) to say what was trashed; no agent sees it.
 *
 *   SHARD=0/64 npx vite-node scripts/stage-vc/install-prompt.ts
 *   ARGS="DEALS=1321 HUMAN=none CAP=8" npx vite-node scripts/stage-vc/install-prompt.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { dealState } from '../stage-a/harness';
import { ARMS, Arm, CHAIN_ARMS, Tree, loadTree, makeTrees } from './install-prompt-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/install-prompt', String(shard));
const CAP = Number(process.env.CAP ?? 8);
const ASKED: Arm[] = ['beta', 'control', ...CHAIN_ARMS];
const G = globalThis as any;
const key = (a: unknown) => (a ? JSON.stringify(a) : 'null');
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r2 = (x: number) => Math.round(x * 100) / 100;

let trees: Record<string, Tree> = {};

// ------------------------------------------------------------------------------------------------ agents
type Snap = Record<string, unknown>;
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
    if (cur && typeof cur === 'object' && !Array.isArray(cur) && !(cur instanceof Map) && !(cur instanceof Set) && Object.getPrototypeOf(cur) !== Object.prototype) Object.assign(cur, structuredClone(v));
    else fresh[k] = structuredClone(v);
  }
  return fresh;
}
function agents(t: Tree, snaps?: { corp?: Snap; runner?: Snap }) {
  return { corp: restore(t.createAgent('corp', 'normal'), snaps?.corp), runner: restore(t.createAgent('runner', 'normal'), snaps?.runner) };
}

// ------------------------------------------------------------------------------------------------ decisions
type Cls = 'corpPrompt' | 'corpMain' | 'corpRez' | 'runnerPrompt' | 'runnerMain' | 'runnerOff';
/** Whether GameRunner.step asks an agent on this board, and which kind of decision (as playout.ts step). */
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
  calls: number;
  follow: number;
  wide: number;
  rec: any;
  cand: any[] | null;
  err?: string;
}
function resetG() {
  G.__pcRec = null;
  G.__pcCalls = 0;
  G.__pcFollow = 0;
  G.__pcWide = 0;
  G.__pcCand = null;
  G.__pcPlanDepth = 0;
  G.__pcRunLen = 0;
  G.__pcTopNext = false;
  G.__pcTop = false;
}
function ask(t: Tree, s: GameState, snaps: { corp?: Snap; runner?: Snap } | undefined): Ask {
  t.clear();
  const ag = agents(t, snaps);
  const g = new t.GameRunner(structuredClone(s), ag);
  resetG();
  G.__pcArm = true;
  const at = performance.now();
  try {
    g.step();
    const ms = performance.now() - at;
    const a = g.last as GameAction | null;
    return { a, k: key(a), ms, calls: G.__pcCalls, follow: G.__pcFollow, wide: G.__pcWide, rec: G.__pcRec, cand: G.__pcCand };
  } catch (e) {
    return { a: null, k: `error: ${(e as Error).message.slice(0, 80)}`, ms: performance.now() - at, calls: G.__pcCalls, follow: G.__pcFollow, wide: G.__pcWide, rec: null, cand: null, err: (e as Error).message.slice(0, 160) };
  } finally {
    G.__pcArm = false;
    resetG();
  }
}

/** A short label of an action (its type, the option or the cards' titles; Corp cards named only where the acting side sees them is not needed: labels are for the report). */
function label(t: Tree, s: GameState, a: GameAction | null | undefined): string {
  if (!a) return 'none';
  const x = a as any;
  if (a.type === 'RESOLVE_PROMPT') {
    const c = x.choice;
    if (c.kind === 'effect_choice') return `prompt:${c.optionId}${c.trashFirst?.length ? '+trashFirst' : ''}`;
    if (c.kind === 'effect_cards') return `prompt:[${c.cardInstanceIds.map((id: string) => title(t, s, id)).join(', ')}]`;
    return `prompt:${c.kind}`;
  }
  const id = x.cardInstanceId;
  if (!id) return a.type + (x.server ? `>${x.server}` : '');
  return `${a.type} ${title(t, s, id)}`;
}
function title(t: Tree, s: GameState, id: string): string {
  const c = t.core.findCardAnywhere(s, id);
  return c ? `${t.core.cardDef(c).type_code}:${t.core.cardDef(c).title}` : id;
}
function promptInfo(t: Tree, s: GameState) {
  const p = t.core.activePrompt(s);
  if (!p) return null;
  const src = 'source' in p ? p.source : null;
  return { side: p.side, kind: p.kind, code: src?.cardCode ?? null, step: src?.step ?? null, card: src ? t.core.getCardDefinition(src.cardCode).title : null, run: !!s.activeRun, server: s.activeRun?.server ?? null };
}

// ------------------------------------------------------------------------------------------------ continuations
/** The agenda points in a remote's root that could be stolen (the measuring script's read of what was true). */
function rootSummary(t: Tree, s: GameState, server: string | null) {
  const sv = server ? s.corp.servers[server] : null;
  if (!sv) return null;
  // HIDDEN-READ (measuring script): the types of facedown root cards, to say what the run could reach
  return sv.root.map(c => t.core.cardDef(c).type_code + (t.core.cardDef(c).type_code === 'agenda' ? `:${t.core.cardDef(c).agenda_points}` : '')).join(',');
}

interface Cont {
  run: null | { breach: boolean; stolen: number; rootTrashed: string[]; rcr: number; ccr: number; hqGone: string[]; hqAgendaGone: boolean; ended: string };
  turnEnd: { cr: number; hq: number } | null;
  /** Corp and Runner points two turn pairs later (turn T0 + 2 starts, or the game's end) */
  cs2: number;
  rs2: number;
  winner: string | null;
  T: number;
  cs: number;
  rs: number;
  err?: string;
}
function cont(s0: GameState, first: GameAction, snaps: { corp?: Snap; runner?: Snap } | undefined): Cont {
  const t = trees.beta;
  t.clear();
  const none: Cont = { run: null, turnEnd: null, cs2: s0.corp.score, rs2: s0.runner.score, winner: null, T: 0, cs: 0, rs: 0 };
  let s: GameState;
  try {
    if (!t.core.isLegalAction(s0, first)) return { ...none, err: 'not legal' };
    s = t.core.executeAction(structuredClone(s0), first);
  } catch (e) {
    return { ...none, err: (e as Error).message.slice(0, 100) };
  }
  const g = new t.GameRunner(s, agents(t, snaps));
  const runOn = !!s0.activeRun;
  const server = s0.activeRun?.server ?? null;
  const roots0 = new Map((server && s0.corp.servers[server] ? s0.corp.servers[server].root : []).map(c => [c.instanceId, t.core.cardDef(c).title]));
  const hq0 = s0.corp.hq.map(c => c.instanceId);
  const T0 = s0.turnNumber;
  const P0 = s0.activePlayer;
  let run: Cont['run'] = null;
  // The answer itself can carry the run into the breach (Anoetic Void "no": the approach passes, the run succeeds)
  let breach = !!s0.activeRun?.breached || !!s.activeRun?.breached || s.activeRun?.phase === 'access';
  let turnEnd: Cont['turnEnd'] = null;
  let two: { cs: number; rs: number } | null = null;
  const fin = (x: GameState, why: string) => {
    const gone = hq0.filter(id => !x.corp.hq.some(c => c.instanceId === id));
    // HIDDEN-READ (measuring script): the types of the HQ cards that left HQ
    const kinds = gone.map(id => {
      const c = t.core.findCardAnywhere(x, id);
      return c ? t.core.cardDef(c).type_code : '?';
    });
    const sv = server ? x.corp.servers[server] : null;
    const last = x.turnNumber === T0 ? x.runsThisTurn?.[x.runsThisTurn.length - 1] : undefined;
    return {
      breach: breach || !!(last && last.server === server && last.successful),
      stolen: x.runner.score - s0.runner.score,
      rootTrashed: [...roots0].filter(([id]) => !sv?.root.some(c => c.instanceId === id)).map(([, n]) => n),
      rcr: x.runner.credits - s0.runner.credits,
      ccr: x.corp.credits - s0.corp.credits,
      hqGone: kinds,
      hqAgendaGone: kinds.includes('agenda'),
      ended: why,
    };
  };
  try {
    let prev: GameState = g.state;
    if (runOn && !g.state.activeRun) run = fin(g.state, 'first');
    if (g.state.turnNumber !== T0 || g.state.activePlayer !== P0) turnEnd = { cr: prev.corp.credits, hq: prev.corp.hq.length };
    for (let n = 0; n < 6000; n++) {
      if (!two && (g.state.turnNumber >= T0 + 2 || g.state.winner)) two = { cs: g.state.corp.score, rs: g.state.runner.score };
      if (!g.step()) break;
      if (g.state.activeRun?.breached || g.state.activeRun?.phase === 'access') breach = true;
      if (runOn && !run && (!g.state.activeRun || g.state.activeRun.server !== server)) run = fin(g.state, g.state.winner ? 'game' : 'run');
      if (!turnEnd && (g.state.turnNumber !== T0 || g.state.activePlayer !== P0)) turnEnd = { cr: prev.corp.credits, hq: prev.corp.hq.length };
      prev = g.state;
    }
  } catch (e) {
    return { run, turnEnd, cs2: two?.cs ?? g.state.corp.score, rs2: two?.rs ?? g.state.runner.score, winner: g.state.winner ?? null, T: g.state.turnNumber, cs: g.state.corp.score, rs: g.state.runner.score, err: (e as Error).message.slice(0, 100) };
  }
  if (!turnEnd) turnEnd = { cr: g.state.corp.credits, hq: g.state.corp.hq.length };
  if (!two) two = { cs: g.state.corp.score, rs: g.state.runner.score };
  return { run, turnEnd, cs2: two.cs, rs2: two.rs, winner: g.state.winner ?? null, T: g.state.turnNumber, cs: g.state.corp.score, rs: g.state.runner.score };
}

// ------------------------------------------------------------------------------------------------ one decision
let rot = 0;
interface Dec {
  src: string;
  deck?: string;
  kind: 'self' | 'humanRunner' | 'humanCorp';
  who: 'ai' | 'person';
  i: number;
  s: GameState;
  side: 'corp' | 'runner';
  cls: Cls;
  snaps?: { corp?: Snap; runner?: Snap };
  played?: GameAction | null;
}
function decide(d: Dec, perSrc: Record<string, number>) {
  const t = trees.beta;
  const order = [...ASKED.slice(rot % ASKED.length), ...ASKED.slice(0, rot % ASKED.length)];
  rot++;
  const asks: Record<string, Ask> = {};
  for (const arm of order) asks[arm] = ask(trees[arm], d.s, d.snaps);
  const b = asks.beta;
  const changed = CHAIN_ARMS.filter(a => asks[a].k !== b.k);
  const row: Record<string, unknown> = {
    kind: 'd',
    src: d.src,
    sk: d.kind,
    deck: d.deck,
    who: d.who,
    i: d.i,
    T: d.s.turnNumber,
    side: d.side,
    c: d.cls,
    ms: ASKED.map(a => r2(asks[a].ms)),
    calls: ASKED.map(a => asks[a].calls),
    fol: ASKED.map(a => asks[a].follow),
    wide: ASKED.map(a => asks[a].wide),
  };
  if (asks.control.k !== b.k) row.controlDiffers = true;
  if (d.played !== undefined) row.fresh = key(d.played) === b.k;
  for (const a of ASKED) if (asks[a].err) (row.errors ??= {} as any)[a] = asks[a].err;
  const isPrompt = d.cls === 'corpPrompt' || d.cls === 'runnerPrompt';
  if (isPrompt) row.p = promptInfo(t, d.s);
  if (changed.length) {
    row.changed = Object.fromEntries(changed.map(a => [a, label(t, d.s, asks[a].a)]));
    row.beta = label(t, d.s, b.a);
    if (d.s.activeRun) row.root = rootSummary(t, d.s, d.s.activeRun.server);
  }
  // The top-level fallback record of each tree (prompts): ties, the half-keep term, install steps
  if (isPrompt) {
    const fb: Record<string, unknown> = {};
    for (const arm of ASKED) {
      const rec = asks[arm].rec;
      if (!rec) continue;
      const sc = rec.opts.map((o: any) => o.score as number).filter((x: number) => x > -Infinity);
      const order = rec.opts.map((o: any, j: number) => j).filter((j: number) => rec.opts[j].score > -Infinity).sort((x: number, y: number) => rec.opts[y].score - rec.opts[x].score);
      const gap = sc.length > 1 ? rec.opts[order[0]].score - rec.opts[order[1]].score : null;
      const hkGap = sc.length > 1 ? Math.abs(rec.opts[order[0]].hk - rec.opts[order[1]].hk) : null;
      fb[arm] = {
        code: rec.code,
        step: rec.step,
        run: rec.run,
        id: rec.identity,
        n: rec.n,
        cont: rec.opts.some((o: any) => o.cont),
        inst: rec.opts.some((o: any) => o.inst),
        tie: gap !== null && Math.abs(gap) < 1e-9,
        gap: gap === null ? null : r2(gap),
        hkGap: hkGap === null ? null : r2(hkGap),
        hkDecides: gap !== null && hkGap !== null && hkGap > gap,
      };
    }
    if (Object.keys(fb).length) row.fb = fb;
  }
  // The trace of a changed main-phase decision: the arm's planner, per root candidate, the chains only the arm followed
  if (d.cls === 'corpMain' && changed.length) {
    const tr: Record<string, unknown> = {};
    for (const arm of changed) {
      const cand = asks[arm].cand;
      if (!cand) {
        tr[arm] = { planner: false, wide: asks[arm].wide, cls: asks[arm].wide > 0 ? 'IN' : 'OUTSIDE' };
        continue;
      }
      const wa = cand.find((c: any) => c.k === asks[arm].k)?.w ?? null;
      const wb = cand.find((c: any) => c.k === b.k)?.w ?? null;
      tr[arm] = { planner: true, wide: asks[arm].wide, wa, wb, cands: cand.length, anyWide: cand.filter((c: any) => c.w > 0).length, cls: (wa ?? 0) > 0 || (wb ?? 0) > 0 ? 'IN' : 'OUTSIDE' };
    }
    row.trace = tr;
  }
  out(row);
  // B: continuations of the changed decisions (one continuation per distinct action: arms that agree share it)
  const conts = new Map<string, Cont>();
  const contOf = (a: GameAction) => conts.get(key(a)) ?? conts.set(key(a), cont(d.s, a, d.snaps)).get(key(a))!;
  for (const arm of changed) {
    const x = asks[arm];
    if (!x.a || !b.a) continue;
    const n = (perSrc[arm] = (perSrc[arm] ?? 0) + 1);
    if (n > CAP) continue;
    const ca = contOf(x.a);
    const cb = contOf(b.a);
    out({ kind: 'c', src: d.src, sk: d.kind, deck: d.deck, inst: isPrompt && Object.values((row.fb ?? {}) as Record<string, any>).some(f => f.inst), who: d.who, i: d.i, T: d.s.turnNumber, arm, side: d.side, c: d.cls, p: isPrompt ? promptInfo(t, d.s) : null, a: label(t, d.s, x.a), b: label(t, d.s, b.a), root: d.s.activeRun ? rootSummary(t, d.s, d.s.activeRun.server) : null, cs0: d.s.corp.score, rs0: d.s.runner.score, cr0: d.s.corp.credits, hq0: d.s.corp.hq.length, ca, cb });
  }
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const dirs = makeTrees(root, ARMS);
  trees = {};
  for (const arm of ARMS) trees[arm] = await loadTree(arm, dirs[arm]);
  const record: { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] }[] = JSON.parse(readFileSync('scripts/stage-vc/install-prompt-deals.json', 'utf8'));
  const want = (process.env.DEALS ?? '').split(',').filter(Boolean);
  const dealList = want.includes('none') ? [] : record.filter(r => !want.length || want.includes(String(r.seed)));
  const hdir = 'tests/fixtures/human-games';
  const hwant = (process.env.HUMAN ?? '').split(',').filter(Boolean);
  const humans = hwant.includes('none')
    ? []
    : readdirSync(hdir)
        .filter(f => f.endsWith('.json') && (!hwant.length || hwant.some(w => f.startsWith(w))))
        .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')) || a.localeCompare(b));
  const sources: { kind: 'deal' | 'human'; id: any }[] = [...humans.map(f => ({ kind: 'human' as const, id: f })), ...dealList.map(r => ({ kind: 'deal' as const, id: r }))];

  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    const t0 = performance.now();
    const perSrc: Record<string, number> = {};
    let decisions = 0;
    if (src.kind === 'deal') {
      const rec = src.id as (typeof record)[number];
      const name = `deal:${rec.seed}`;
      const t = trees.source;
      t.clear();
      const ag = { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') };
      const g = new t.GameRunner(dealState(rec.seed), ag);
      const cr: number[] = [];
      const sc: number[] = [];
      let lastTurn = -1;
      const decs: Dec[] = [];
      for (let n = 0; n < 4000; n++) {
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
        if (dec && copy) decs.push({ src: name, deck: rec.corpDeck, kind: 'self', who: 'ai', i: decs.length, s: copy, side: dec.side, cls: dec.cls, snaps, played: g.last ?? null });
      }
      const matches = (g.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
      out({ kind: 'g', src: name, decks: `${rec.corpDeck} v ${rec.runnerDeck}`, winner: g.state.winner ?? null, T: g.state.turnNumber, cs: g.state.corp.score, rs: g.state.runner.score, matchesBatch: matches, ...(matches ? {} : { cr, sc, recCr: rec.cr, recSc: rec.sc, recWinner: rec.winner }), decisions: decs.length });
      for (const d of decs) decide(d, perSrc);
      decisions = decs.length;
    } else {
      const file = join(hdir, src.id as string);
      const r = JSON.parse(readFileSync(file, 'utf8'));
      const kind = r.config.ai === 'corp' ? 'humanRunner' : 'humanCorp';
      const aiSide = r.config.ai === 'corp' ? 'corp' : 'runner';
      const name = `human:${src.id}`;
      if (!r.moves?.length) continue;
      const core = trees.beta.core;
      let s: GameState;
      if (r.startsAt === 'state') s = structuredClone(r.state);
      else {
        s = core.createInitialGameState(trees.beta.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
        if (r.startStops) s = { ...s, stops: r.startStops };
      }
      let stopped: string | null = null;
      for (const [j, move] of (r.moves as GameAction[]).entries()) {
        const dec = decisionOf(core, { ...s, stops: { corp: 'ai', runner: 'ai' } });
        if (dec) {
          decide({ src: `${name}#${j}`, kind, who: dec.side === aiSide ? 'ai' : 'person', i: decisions, s: structuredClone(s), side: dec.side, cls: dec.cls, played: dec.side === aiSide ? move : undefined }, perSrc);
          decisions++;
        }
        try {
          s = core.executeAction(s, move);
        } catch (e) {
          stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
          break;
        }
      }
      out({ kind: 'h', src: name, sk: kind, moves: r.moves.length, decisions, stopped });
    }
    out({ kind: 's', src: src.kind === 'deal' ? `deal:${src.id.seed}` : `human:${src.id}`, ms: Math.round(performance.now() - t0), decisions, pairs: perSrc });
  }
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
