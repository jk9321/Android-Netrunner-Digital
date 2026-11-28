/**
 * R-B B2: the log of "decided twice" (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/b2-decided-twice-log.md
 * rev 0, tracker R-14a). A run priced one way by the ranking (runScore) and decided another inside the run. Counts only:
 * no src change, nothing fixed. Classes H, T3, T2, T1, T4, P, A as the brief defines them (first that applies, in order),
 * and the reverse (a run priced out for a payability reason, forced on a copy).
 *
 * Unit: one run started by the deciding Normal Runner at the top level of a game, from the decision that starts it to the
 * run's end. Pools (kept apart): batch (the 221 deals of g1 45499791395), nrdb (the 110 of NRDB=1 g1 45503877309), issues
 * (the saved games of #58 and #59 in tests/fixtures/runner-facts/issues/, #64 to #67 in tests/fixtures/runner-issues/:
 * replayed, and at each recorded run a fresh Normal Runner that watched every board plays on a copy to the end of that
 * turn against a Normal Corp; every run it starts there is a unit).
 *
 * Trees (decided-twice-trees.ts): `hooked` plays the source games (its hooks only call `__dt` with values already
 * computed); `eval` is asked on structuredClones (S0's readers, the access answer's two scores, the reverse's forced runs);
 * `plain` is src unchanged, played only by IDENT=1 (step 0 point 2: the hooked tree's games equal plain src's, action for
 * action, and the batch's deals.json records).
 *
 * HIDDEN-READ (the measuring script, never an agent): the Runner's memory (read, copied for the eval asks), the facedown
 * cards' identity at S0 (to tell what was facedown and what was rezzed in the run). Every place is marked.
 *
 *   SHARD=0/64 POOL=batch,nrdb,issues npx vite-node scripts/runner-rework/decided-twice.ts
 *   ARGS="POOL=issues" npx vite-node scripts/runner-rework/decided-twice.ts
 *   ARGS="POOL=batch,nrdb DEALS=1001,1011 IDENT=1" (step 0 point 2); REVERSE=0 turns the reverse off; REVERSE_K=k samples it
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CardInstance, GameAction, GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { Tree, loadTree } from './facts-trees';
import { makeTrees } from './decided-twice-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const POOLS = (process.env.POOL ?? 'batch,nrdb,issues').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const ISSUES = (process.env.ISSUES ?? '').split(',').filter(Boolean);
const IDENT = process.env.IDENT === '1';
const REVERSE = process.env.REVERSE !== '0';
/** The reverse on every k-th Runner turn only (k written before the run; 1 = every turn). */
const REVERSE_K = Number(process.env.REVERSE_K ?? 1);
const MAX_MS = Number(process.env.MAX_MS ?? Infinity);
/** Issue boards: 'run' (each recorded run, the brief's) and 'turn' (each Runner turn's first main decision, the #65 pin's board). */
const ISSUE_BOARDS = (process.env.ISSUE_BOARDS ?? 'run,turn').split(',');
const RUN_BOARDS = ISSUE_BOARDS.includes('run');
const TURN_BOARDS = ISSUE_BOARDS.includes('turn');
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/decided-twice', String(shard));
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r3 = (x: number | null | undefined): number | string | null =>
  x === null || x === undefined ? null : Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x > 0 ? 'Inf' : '-Inf';
const key = (a: unknown) => JSON.stringify(a ?? null);
const G = globalThis as any;

let H: Tree; // hooked: plays
let E: Tree & { prompts: any; planner: any; reply: any }; // eval: asked on copies
const timing: Record<string, number> = {};
const timed = <X>(k: string, f: () => X): X => {
  const t0 = performance.now();
  try {
    return f();
  } finally {
    timing[k] = (timing[k] ?? 0) + performance.now() - t0;
  }
};
const safe = <X>(f: () => X, dflt: X): X => {
  try {
    return f();
  } catch {
    return dflt;
  }
};
const asRunner = <X>(s: GameState, f: () => X): X =>
  // R-83: the decision's pricing frame is opened by inDecision since B4 (decisionContext left)
  E.pricing.asSide('runner', () => E.handValues.inDecision(s, 'runner', f));
const def = (c: CardInstance | string) => E.core.getCardDefinition(typeof c === 'string' ? c : c.cardCode);
const title = (code: string | undefined) => (code ? safe(() => def(code).title as string, code) : null);

// ------------------------------------------------------------------------------------------------ S0 readings (eval tree)
type Price = { agent: any; state: GameState; action: GameAction; server: string; view: GameState; options: any; score: number; rs: any };

/** The way runScore's price takes one ice (its prices map entry): tank, credits, counter, clicks, selfCredits, physarum, free, bypass, unrezzed. */
function wayOf(v: GameState, ice: CardInstance, price: any, bypassed: Set<string>): string {
  if (bypassed.has(ice.instanceId)) return 'bypass';
  if (!ice.isRezzed) return 'unrezzed';
  if (!price) return 'none';
  if (price.credits === Infinity || price.value === Infinity) return 'block';
  if ('damage' in price) return price.value > 0 ? 'tank' : 'free';
  const subs = (E.runs.plannedSubroutines(v, ice) as any[]).length - (E.runs.botulusBreaks(v, ice) as number);
  if (subs <= 0) return E.runs.botulusBreaks(v, ice) > 0 ? 'counter' : 'free';
  const phys = E.runs.physarumCost(v, ice);
  if (phys !== undefined && price.credits === phys && price.value === 0) return 'physarum';
  // The click self-break: the field the scratch trees return beside that price (rev 1), not a value match
  if (price.__clicks !== undefined) return 'clicks';
  const self = E.runs.__selfBreakPrice(v, ice, subs);
  if (E.ice.iceScript?.(ice)?.runnerBreakCost !== undefined && price.credits === self.credits && price.value === 0) return 'selfCredits';
  return price.credits === 0 && price.value > 0 ? 'counter' : 'credits';
}

/** runScore on S0's view with the ranking's options, its parts, and the in-run readers asked on the same view. */
function s0Read(p: Price, s1: GameState) {
  const v = structuredClone(p.view);
  const opts = { ...p.options, memory: p.options.memory ? new Map(p.options.memory) : undefined };
  E.clear();
  G.__dtRs = null;
  // The ranking's decision context is the real board (rankMainActions: inDecision(state)), its prices the view
  const ctx = structuredClone(p.state);
  const score = E.pricing.asSide('runner', () => E.handValues.inDecision(ctx, 'runner', () => E.runs.runScore(v, p.server, opts))) as number;
  const evalRs = G.__dtRs ?? {};
  // The parts the ranking read: the hooked tree's record of the very call (the eval re-ask is the check beside it)
  const rs = p.rs ?? evalRs;
  const sv = v.corp.servers[p.server];
  const bypassed = new Set<string>(rs.bypassed ?? []);
  const ice = sv.ice.map((c: CardInstance, pos: number) => {
    const price = rs.prices?.get(c.instanceId);
    return {
      id: c.instanceId,
      code: c.cardCode,
      t: title(c.cardCode),
      pos,
      rezzed: c.isRezzed,
      way: asRunner(v, () => wayOf(v, c, price, bypassed)),
      cr: r3(price?.credits),
      val: r3(price?.value),
      dmg: price?.damage ?? null,
      clicks: price?.__clicks ?? 0,
    };
  });
  const bioroidClicks = asRunner(v, () => E.runs.bioroidClicks(v, sv.ice)) as number;
  // The in-run readers on S0r (rev 1): the state after the run is started, at the outermost ice, before any rez
  const inRun: GameState = structuredClone(s1);
  E.clear();
  const sumNeed = asRunner(inRun, () =>
    sv.ice.reduce((n: number, c: CardInstance) => n + (c.isRezzed && !bypassed.has(c.instanceId) ? (E.runs.iceCreditNeed(inRun, c) as number) : 0), 0)
  ) as number;
  const ahead = asRunner(inRun, () => E.runs.creditsAhead(inRun)) as number;
  const avail = E.effects.availableCredits(v, 'runner') as number;
  const availRun = E.effects.availableCredits(inRun, 'runner') as number;
  // The credits on cards that pay only during runs (runBudget adds them before a run by design, runs.ts:476)
  const duringRun = (asRunner(v, () => E.runs.runBudget(v)) as number) - avail;
  const P = ice.filter((i: any) => i.way === 'clicks').reduce((n: number, i: any) => n + i.clicks, 0);
  // S0's trashes: every root card whose trash serverWorth adds (a rezzed card, or one the Runner accessed: the memory,
  // HIDDEN-READ, read), and its worth there: serverValue with the card less without it (count L14's method, the owner asked)
  const trashes: any[] = [];
  const memory: Map<string, string> = opts.memory ?? new Map();
  const grip = v.runner.grip.length - (rs.iceDamage ?? 0);
  for (const card of sv.root) {
    const d = def(card);
    if (d.trash_cost == null || d.type_code === 'agenda') continue;
    if (!card.isRezzed && !memory.has(card.instanceId)) continue;
    if (d.trash_cost > v.runner.credits) continue;
    const without = structuredClone(v);
    without.corp.servers[p.server].root = without.corp.servers[p.server].root.filter((c: CardInstance) => c.instanceId !== card.instanceId);
    E.clear();
    const w1 = asRunner(v, () => E.runs.serverValue(v, p.server, opts.extraAccesses ?? 0, memory, opts.wary, undefined, grip)) as number;
    E.clear();
    const w0 = asRunner(without, () => E.runs.serverValue(without, p.server, opts.extraAccesses ?? 0, memory, opts.wary, undefined, grip)) as number;
    if (w1 - w0 > 1e-9) trashes.push({ id: card.instanceId, code: card.cardCode, t: d.title, worth: r3(w1 - w0), cost: d.trash_cost, rezzed: card.isRezzed });
  }
  return {
    score: r3(score),
    hookScore: r3(p.score),
    reason: rs.reason ?? null,
    evalReason: evalRs.reason ?? null,
    budget: r3(rs.budget),
    known: r3(rs.known),
    expected: r3(rs.expected),
    iceDamage: rs.iceDamage ?? null,
    value: r3(rs.value),
    approach: rs.approach ? { cost: r3(rs.approach.cost), credits: rs.approach.credits } : rs.approach === null ? null : undefined,
    bioroidClicks,
    clicksS0: v.runner.clicks,
    clicksS1: s1.runner.clicks,
    creditsS0: v.runner.credits,
    creditsS1: s1.runner.credits,
    ice,
    sumNeed: r3(sumNeed),
    ahead: r3(ahead),
    avail,
    availRun,
    duringRun,
    P,
    trashes,
  };
}

/** The access answer's two scores (prompts.ts fallback: scoreOutcome of each answer, on the board the Runner answers on). */
function accessScores(a: GameState, memory: Map<string, string>) {
  const s = structuredClone(a);
  const p = E.core.activePrompt(s);
  E.clear();
  return asRunner(s, () => {
    // As HeuristicRunnerAI.promptAnswer: the Runner's view, unless the prompt names a card the view may have changed
    const view = E.planner.runnerDecisionView(s, memory);
    const shown = JSON.stringify(p);
    const { ice, root, loose } = E.reply.runnerUnknownSlots(s, memory);
    const board = [...s.runner.stack, ...ice, ...root, ...loose].some((c: CardInstance) => shown.includes(`"${c.instanceId}"`)) ? s : view;
    const score = (trash: boolean) => {
      const after = E.prompts.simulate(board, { type: 'RESOLVE_PROMPT', player: 'runner', promptId: p.id, choice: { kind: 'access_trash', trash } });
      return after ? (E.prompts.scoreOutcome(board, after, 'runner', memory, true) as number) : -Infinity;
    };
    const trash = p.trashCost == null ? -Infinity : score(true);
    const keep = score(false);
    return { trash: r3(trash), keep: r3(keep), pick: trash > keep ? 'trash' : 'keep' };
  });
}

// ------------------------------------------------------------------------------------------------ the watcher
interface Enc {
  id: string;
  code: string;
  t: string | null;
  pos: number;
  rezzedS0: boolean;
  credits: number;
  clicks: number;
  broke: { credits: number; click: number; ability: number };
  unbroken: number;
  resolved: boolean;
  reasons: { r: string; d: any }[];
  spent: number;
  clicksSpent: number;
  clickSubs: number[];
  blocks: boolean[];
  pricedClicks: boolean;
}

class Watch {
  stash: Price[] = [];
  pstash: Price[] = [];
  root: { s: GameState; a: GameAction; stash: Price[] } | null = null;
  unit: any = null;
  units = 0;
  runnerTurns = 0;
  lastTurnStart = -1;
  pending: { kind: string; r?: string; d?: any; ahead?: number; credits?: number; state?: GameState }[] = [];
  constructor(
    public pool: string,
    public src: string,
    public top: any,
    public memoryOf: () => Map<string, string>
  ) {}

  // The hooked tree's calls (the deciding agent's own, never a look-ahead's or a reply's: they are other instances)
  price(agent: any, state: GameState, action: GameAction, server: string, view: GameState, options: any, score: number) {
    // runScore's own record of this call (the hooked tree writes it; read, never asked)
    if (agent === this.top) this.stash.push({ agent, state, action, server, view, options, score, rs: G.__dtRs });
  }
  /** A run a prompt answer decides (Alarm Clock's turn-start run, prompts.ts): the top Runner's by its memory. */
  pprice(memory: any, state: GameState, server: string, options: any, score: number) {
    if (memory && memory === (this.top as any).memory) this.pstash.push({ agent: this.top, state, action: { type: 'RESOLVE_PROMPT' } as any, server, view: state, options, score, rs: G.__dtRs });
  }
  enc(agent: any, state: GameState, r: string, d: any) {
    if (agent === this.top) this.pending.push({ kind: 'enc', r, d });
  }
  move(agent: any, state: GameState, ahead: number, credits: number) {
    if (agent === this.top) this.pending.push({ kind: 'move', ahead, credits, state });
  }

  /** Before the top GameRunner's step on `s`. */
  before(s: GameState) {
    this.pending = [];
    if (this.isMain(s)) this.stash = [];
  }

  isMain(s: GameState) {
    const c = E.core;
    return c.actingSide(s) === 'runner' && s.activePlayer === 'runner' && !s.activeRun && !c.activePrompt(s) && !(s.priority && s.priority.holder !== s.activePlayer) && !s.winner;
  }

  /** After the step: `s` before, `a` the action applied, `next` after. */
  after(s: GameState, a: GameAction | null, next: GameState) {
    if (this.isMain(s) && a) {
      this.root = { s, a, stash: this.stash };
      if (s.turnNumber !== this.lastTurnStart) {
        this.lastTurnStart = s.turnNumber;
        if (REVERSE && this.runnerTurns++ % REVERSE_K === 0) timed('reverse', () => this.reverse(s, this.stash));
      }
    }
    if (!s.activeRun && next.activeRun && s.activePlayer === 'runner') timed('start', () => this.start(s, a, next));
    if (this.unit && (s.activeRun || next.activeRun)) timed('step', () => this.step(s, a, next));
    if (this.unit && s.activeRun && !next.activeRun) timed('end', () => this.end(s, a, next));
  }

  start(s: GameState, a: GameAction | null, next: GameState) {
    const server = next.activeRun!.server;
    // A run started by a prompt answer that priced it (Alarm Clock): that price, on the board it was asked on
    const pp = a?.type === 'RESOLVE_PROMPT' ? this.pstash.filter(x => x.server === server && x.state.turnNumber === s.turnNumber).pop() : undefined;
    this.pstash = [];
    const root = pp ? { s: pp.state, a: pp.action, stash: [pp] } : this.root;
    const fromRoot = root && root.s.turnNumber === s.turnNumber;
    const matches = fromRoot ? root!.stash.filter(p => p.server === server) : [];
    const exact = matches.filter(p => key(p.action) === key(root!.a));
    const p = exact[0] ?? matches[matches.length - 1];
    const how = pp ? `RESOLVE_PROMPT:${title(E.core.activePrompt(s)?.source?.cardCode) ?? 'prompt'}` : fromRoot ? `${root!.a.type}${'cardInstanceId' in root!.a && (root!.a as any).cardInstanceId ? ':' + (title(E.core.findCardAnywhere(root!.s, (root!.a as any).cardInstanceId)?.cardCode) ?? '?') : ''}` : `${a?.type ?? 'none'}`;
    // HIDDEN-READ: what was facedown at S0 (the board itself), to tell the cards the run met that the price could not know
    const s0 = fromRoot ? root!.s : s;
    const facedown = new Set<string>(Object.values(s0.corp.servers).flatMap(v => [...v.ice, ...v.root]).filter(c => !c.isRezzed).map(c => c.instanceId));
    let read: any = null;
    if (p) read = safe(() => s0Read(p, next), { err: 'S0 read failed' });
    this.unit = {
      kind: 'run',
      pool: this.pool,
      src: this.src,
      T: s.turnNumber,
      n: this.units++,
      server,
      how,
      priced: p ? (exact.length ? 'exact' : 'server') : 'none',
      s0: read,
      facedown,
      encs: [] as Enc[],
      moves: [] as any[],
      prompts: [] as any[],
      accesses: [] as any[],
      deltas: [] as any[],
      rezzedInRun: [] as string[],
      breached: false,
      atBreach: null as any,
      jack: null as any,
      startCredits: next.runner.credits,
      startClicks: next.runner.clicks,
    };
  }

  step(s: GameState, a: GameAction | null, next: GameState) {
    const u = this.unit;
    const c = E.core;
    const run = next.activeRun ?? s.activeRun;
    const sv = run ? next.corp.servers[run.server] ?? s.corp.servers[run.server] : undefined;
    // Cards rezzed during the run that were facedown at S0
    for (const v of Object.values(next.corp.servers)) for (const card of [...v.ice, ...v.root]) if (card.isRezzed && u.facedown.has(card.instanceId) && !u.rezzedInRun.includes(card.instanceId)) u.rezzedInRun.push(card.instanceId);
    const e0 = s.activeRun?.encounter ?? null;
    const e1 = next.activeRun?.encounter ?? null;
    let cur: Enc | undefined = u.encs[u.encs.length - 1];
    // Reasons and jack-out tests made in this step's Runner decision
    for (const x of this.pending) {
      if (x.kind === 'enc' && cur && e0 && cur.id === e0.iceId) cur.reasons.push({ r: x.r!, d: x.d });
      if (x.kind === 'move') {
        const pos = x.state!.activeRun!.icePosition ?? 0;
        const inner = sv?.ice[pos - 1];
        u.moves.push({ pos, next: inner?.instanceId ?? null, nextCode: inner?.cardCode ?? null, ahead: r3(x.ahead), credits: x.credits, clicks: x.state!.runner.clicks });
      }
    }
    this.pending = [];
    if (e0 && cur && cur.id === e0.iceId && a) {
      const newly = e1 && e1.iceId === e0.iceId ? e1.broken.filter((b, i) => b && !e0.broken[i]).length : 0;
      if (newly) {
        if (a.type === 'BIOROID_BREAK') {
          cur.broke.click += newly;
          e1!.broken.forEach((b, i) => b && !e0.broken[i] && cur!.clickSubs.push(i));
        }
        else if (a.type === 'BREAK_SUBROUTINE') cur.broke.credits += newly;
        else cur.broke.ability += newly;
      }
      if (e0.resolvingIndex !== null || (e1 && e1.resolvingIndex !== null)) cur.resolved = true;
      cur.unbroken = (e1 && e1.iceId === e0.iceId ? e1 : e0).broken.filter(b => !b).length;
      cur.spent += Math.max(0, s.runner.credits - next.runner.credits);
      cur.clicksSpent += Math.max(0, s.runner.clicks - next.runner.clicks);
    }
    if (e1 && (!e0 || e0.iceId !== e1.iceId)) {
      const ice = sv?.ice.find(x => x.instanceId === e1.iceId);
      cur = {
        id: e1.iceId,
        code: ice?.cardCode ?? '?',
        t: title(ice?.cardCode),
        pos: sv?.ice.findIndex(x => x.instanceId === e1.iceId) ?? -1,
        rezzedS0: !u.facedown.has(e1.iceId),
        credits: next.runner.credits,
        clicks: next.runner.clicks,
        broke: { credits: 0, click: 0, ability: 0 },
        unbroken: e1.broken.filter(b => !b).length,
        resolved: false,
        reasons: [],
        spent: 0,
        clicksSpent: 0,
        clickSubs: [],
        // Each subroutine: would it end the run (subroutineBlocks, asked on a copy of the encounter's board)
        blocks: safe(() => {
          const b = structuredClone(next);
          const iceB = b.corp.servers[b.activeRun!.server].ice.find(x => x.instanceId === e1.iceId)!;
          return asRunner(b, () => (E.ice.iceSubroutines(b, iceB) as any[]).map(sub => !!E.runs.subroutineBlocks(b, sub.label)));
        }, [] as boolean[]),
        pricedClicks: (u.s0?.ice ?? []).find((i: any) => i.id === e1.iceId)?.way === 'clicks',
      };
      u.encs.push(cur);
    }
    // Every change of the Runner's credits or clicks during the run, and what made it
    const dc = next.runner.credits - s.runner.credits;
    const dk = next.runner.clicks - s.runner.clicks;
    if ((dc || dk) && a) {
      const cardId = (a as any).cardInstanceId ?? (a as any).breakerInstanceId;
      const card = cardId ? c.findCardAnywhere(s, cardId) : undefined;
      const prompt = c.activePrompt(s);
      u.deltas.push({
        dc,
        dk,
        by: a.player,
        a: a.type,
        card: title(card?.cardCode) ?? (prompt && 'source' in prompt ? title(prompt.source.cardCode) : null),
        phase: s.activeRun?.phase ?? null,
        ice: e0?.iceId ?? null,
        rezzedS0: e0 ? !u.facedown.has(e0.iceId) : null,
      });
    }
    // The Runner's prompt answers in the run, and the accesses
    const pr = c.activePrompt(s);
    if (a?.type === 'RESOLVE_PROMPT' && pr && pr.side === 'runner' && a.player === 'runner') {
      if (pr.kind === 'access_trash') {
        const ch = (a as any).choice;
        const card = s.corp.servers[run!.server]?.root.find(x => x.instanceId === pr.cardInstanceId) ?? c.findCardAnywhere(s, pr.cardInstanceId);
        const acc: any = { id: pr.cardInstanceId, code: card?.cardCode, t: title(card?.cardCode), trashCost: pr.trashCost, cost: card ? (def(card).trash_cost ?? null) : null, trash: !!ch?.trash || !!ch?.alternativeId, credits: s.runner.credits };
        // The access answer's scores here, and the two S0 asks
        if (u.s0?.trashes?.some((t: any) => t.id === pr.cardInstanceId)) {
          const memory = new Map(this.memoryOf());
          acc.here = timed('access', () => safe(() => accessScores(s, memory), null));
          Object.assign(acc, this.asks(u, s, acc.cost, memory));
        }
        u.accesses.push(acc);
      } else {
        const src = 'source' in pr ? pr.source : undefined;
        const srcCard = src ? c.findCardAnywhere(s, src.instanceId) : undefined;
        u.prompts.push({
          kind: pr.kind,
          code: src?.cardCode ?? null,
          t: title(src?.cardCode),
          step: src?.step ?? null,
          choice: (a as any).choice?.optionId ?? (a as any).choice?.kind,
          options: pr.kind === 'effect_choice' ? pr.options.map((o: any) => o.id) : undefined,
          label: pr.message?.slice(0, 90),
          knownS0: src ? !u.facedown.has(src.instanceId) : null,
          side: srcCard ? (E.core.getCardDefinition(srcCard.cardCode).side_code ?? null) : null,
          ended: !!s.activeRun && !next.activeRun,
          inEncounter: e0?.iceId ?? null,
        });
      }
    }
    // A priced trash accessed with no trash offered (could not pay): the two S0 asks on a copy with the prompt it lacked
    const was = new Set((s.activeRun?.accessed ?? []).map((x: any) => x.id));
    for (const x of next.activeRun?.accessed ?? []) {
      const t = (u.s0?.trashes ?? []).find((y: any) => y.id === x.id);
      if (!t || was.has(x.id) || u.accesses.some((y: any) => y.id === x.id)) continue;
      const pn = c.activePrompt(next);
      if (pn && pn.kind === 'access_trash' && pn.cardInstanceId === x.id) continue;
      const memory = new Map(this.memoryOf());
      u.accesses.push({ id: x.id, code: t.code, t: t.t, trashCost: null, cost: t.cost, trash: false, credits: next.runner.credits, notOffered: true, ...this.asks(u, next, t.cost, memory, x.id) });
    }
    if (next.activeRun?.breached && !u.breached) {
      u.breached = true;
      u.atBreach = { credits: next.runner.credits, clicks: next.runner.clicks, grip: next.runner.grip.length, tags: next.runner.tags };
    }
    if (a?.type === 'JACK_OUT' && a.player === 'runner') {
      const pos = s.activeRun?.icePosition ?? 0;
      const inner = sv?.ice[pos - 1];
      // The ice the jack-out is before: walking inward from here, the first rezzed ice at which the needs (iceCreditNeed,
      // creditsAhead's own reader, asked per ice on a copy) add up to more than the credits; else the approach toll
      const need = timed('jackNeed', () => safe(() => jackNeeds(s), [] as any[]));
      const credits = E.effects.availableCredits(s, 'runner') as number;
      let sum = 0;
      const over = need.find(x => (sum += x.need) > credits);
      const xIce = over ? sv?.ice.find(c => c.instanceId === over.id) : undefined;
      u.jack = { pos, credits, needs: need.map(x => [x.t, r3(x.need)]), next: inner?.instanceId ?? null, x: xIce?.instanceId ?? null, code: xIce?.cardCode ?? null, t: title(xIce?.cardCode) ?? (over ? null : 'approach'), rezzedS0: xIce ? !u.facedown.has(xIce.instanceId) : null };
    }
    if (u.tagsAtStart === undefined) u.tagsAtStart = s.runner.tags;
  }

  /**
   * The two S0 asks (rev 1) on an access board `b0`: the clicks and tags of the priced path (the run's start less the
   * planned click breaks) and the credits (1) S0's, which the price's own trash test reads (runs.ts:1161, :1174), (2) S0's
   * less `known` (the priced path). With no trash offered at the access (could not pay), the board gets the access prompt
   * the engine would offer at those credits (a copy only).
   */
  asks(u: any, b0: GameState, cost: number | null, memory: Map<string, string>, card?: string) {
    const ask = (credits: number) => {
      const b = structuredClone(b0);
      b.runner.credits = Math.max(0, credits);
      b.runner.clicks = Math.max(0, u.startClicks - Number(u.s0.P ?? 0));
      b.runner.tags = u.tagsAtStart ?? b.runner.tags;
      const pb = E.core.activePrompt(b);
      if (card && !(pb && pb.kind === 'access_trash' && pb.cardInstanceId === card)) {
        b.pendingPrompts = [{ kind: 'access_trash', id: 'dt-ask', side: 'runner', cardInstanceId: card, trashCost: cost, alternatives: [], message: '' } as any, ...b.pendingPrompts];
      } else if (pb && pb.kind === 'access_trash' && pb.trashCost == null && cost != null && b.runner.credits >= cost) pb.trashCost = cost;
      return { credits: b.runner.credits, clicks: b.runner.clicks, tags: b.runner.tags, ...(timed('access', () => safe(() => accessScores(b, memory), null)) ?? {}) };
    };
    return { atS0: ask(u.s0.creditsS0), atPrice: ask(u.s0.creditsS0 - Number(u.s0.known ?? 0)) };
  }

  end(s: GameState, a: GameAction | null, next: GameState) {
    const u = this.unit;
    this.unit = null;
    const c = E.core;
    const run = s.activeRun!;
    const pr = c.activePrompt(s);
    let end: any;
    if (next.winner && /flatline/i.test(next.winReason ?? '')) end = { kind: 'flatline', ice: run.encounter?.iceId ?? null };
    else if (u.breached || run.breached || next.runsThisTurn[next.runsThisTurn.length - 1]?.successful) end = { kind: 'breach' };
    else if (u.jack) end = { kind: 'jack', ice: u.jack.x ?? u.jack.next, approach: !u.jack.x };
    else if (a?.type === 'RESOLVE_PROMPT' && a.player === 'runner' && pr?.side === 'runner') end = { kind: 'prompt', card: 'source' in pr ? pr.source.instanceId : null, code: 'source' in pr ? pr.source.cardCode : null, t: 'source' in pr ? title(pr.source.cardCode) : null, choice: (a as any).choice?.optionId ?? null };
    else if (run.encounter) end = { kind: 'sub', ice: run.encounter.iceId };
    else end = { kind: 'corpCard', phase: run.phase, log: next.log.slice(s.log.length).map(e => e.message).slice(-3) };
    if (end.ice) {
      const ice = s.corp.servers[run.server]?.ice.find(x => x.instanceId === end.ice);
      end.code = ice?.cardCode ?? null;
      end.t = title(ice?.cardCode);
      end.rezzedS0 = !u.facedown.has(end.ice);
    }
    u.end = end;
    u.accessedIds = (run.accessed ?? []).map((x: any) => x.id);
    Object.assign(u, classify(u));
    const { facedown, ...rest } = u;
    out({ ...rest, facedownN: facedown.size });
  }

  /** The reverse at the first main-phase decision of a Runner turn: each run priced out for a payability reason, forced on a copy. */
  reverse(s: GameState, stash: Price[]) {
    for (const p of stash) {
      if (p.action.type !== 'INITIATE_RUN' || Number.isFinite(p.score)) continue;
      const v = structuredClone(p.view);
      const opts = { ...p.options, memory: p.options.memory ? new Map(p.options.memory) : undefined };
      E.clear();
      G.__dtRs = null;
      const score = asRunner(v, () => E.runs.runScore(v, p.server, opts)) as number;
      const evalRs = G.__dtRs ?? {};
      // The reason the ranking's own call returned minus infinity (the hooked tree's record); the eval re-ask beside it
      const rsOwn = p.rs ?? evalRs;
      const reason: string | null = rsOwn.reason ?? null;
      const payability = reason === 'known>budget' || reason === 'BLOCK' || reason === 'noSurvivablePrices' || reason === 'noApproach';
      const rec: any = { kind: 'rev', pool: this.pool, src: this.src, T: s.turnNumber, server: p.server, reason, evalReason: evalRs.reason ?? null, evalScore: r3(score), credits: s.runner.credits, clicks: s.runner.clicks, grip: s.runner.grip.length };
      if (reason === 'BLOCK') rec.blockIce = title(v.corp.servers[p.server]?.ice.find((c: CardInstance) => c.instanceId === rsOwn.blockIce)?.cardCode);
      if (reason === 'known>budget') Object.assign(rec, { known: r3(rsOwn.known), budget: r3(rsOwn.budget) });
      if (!payability) {
        out({ ...rec, forced: false });
        continue;
      }
      rec.forced = true;
      Object.assign(rec, timed('forced', () => safe(() => forceRun(s, p.server, this.memoryOf()), { err: 'forced run failed' })));
      out(rec);
    }
  }
}

/** At a jack-out: the rezzed ice further in, outermost first, each with its iceCreditNeed as creditsAhead reads it (bypasses skipped). */
function jackNeeds(s0: GameState): { id: string; t: string | null; need: number }[] {
  const s = structuredClone(s0);
  const run = s.activeRun!;
  const outside: GameState = { ...s, activeRun: { ...run, encounter: null } };
  const inner = s.corp.servers[run.server].ice.slice(0, run.icePosition ?? 0);
  E.clear();
  return asRunner(outside, () => {
    const skip: Set<string> = E.runs.bypassesAhead(outside, inner, !!run.encounter);
    return [...inner].reverse().filter(c => c.isRezzed && !skip.has(c.instanceId)).map(c => ({ id: c.instanceId, t: title(c.cardCode), need: E.runs.iceCreditNeed(outside, c) as number }));
  });
}

/** A copy of the game with the run forced: the Runner's own in-run decisions and the Corp's agent (GameRunner, eval tree). */
function forceRun(s: GameState, server: string, memory: Map<string, string>) {
  E.clear();
  const start = E.core.executeAction(structuredClone(s), { type: 'INITIATE_RUN', player: 'runner', targetServerId: server });
  const runner: any = E.createAgent('runner', 'normal');
  runner.memory = new Map(memory);
  const g = new E.GameRunner(start, { runner, corp: E.createAgent('corp', 'normal') });
  let breach: any = null;
  let steps = 0;
  for (; steps < 400 && g.state.activeRun && !g.state.winner; steps++) {
    if (!g.step()) break;
    if (!breach && g.state.activeRun?.breached) breach = { credits: g.state.runner.credits, clicks: g.state.runner.clicks, grip: g.state.runner.grip.length };
  }
  const last = g.state.runsThisTurn[g.state.runsThisTurn.length - 1];
  return { breached: !!breach || !!last?.successful, atBreach: breach, steps, flatlined: !!g.state.winner && /flatline/i.test(g.state.winReason ?? '') };
}

// ------------------------------------------------------------------------------------------------ classes
const BREAK_WAYS = new Set(['credits', 'counter', 'clicks', 'selfCredits', 'physarum']);
function classify(u: any): { cls: string; sub?: string; detail?: any } {
  const s0 = u.s0;
  if (!s0 || s0.err) return { cls: 'U', detail: { priced: u.priced } };
  const end = u.end;
  const reached = end.kind === 'breach';
  // H: the end on a card facedown at S0; H2: a card facedown at S0, rezzed in the run, took credits or clicks before the end
  const endFacedown = (end.ice && end.rezzedS0 === false) || (end.kind === 'prompt' && end.card && u.facedown.has(end.card)) || (end.kind === 'corpCard' && u.rezzedInRun.length > 0);
  if (!reached && endFacedown) return { cls: 'H', sub: 'H1', detail: { end: end.t ?? end.kind } };
  const costly = (u.encs as Enc[]).filter(e => !e.rezzedS0 && (e.spent > 0 || e.clicksSpent > 0));
  if (!reached && costly.length) return { cls: 'H', sub: 'H2', detail: { took: costly.map(e => ({ t: e.t, cr: e.spent, k: e.clicksSpent })) } };
  const priced = new Map<string, any>((s0.ice as any[]).map(i => [i.id, i]));
  if (!reached && end.kind === 'prompt') return { cls: 'T3', detail: { card: end.t, choice: end.choice, damage: (u.prompts as any[]).some(x => x.ended && /damage/i.test(`${x.label} ${(x.options ?? []).join(' ')}`)) } };
  if (!reached && (end.kind === 'sub' || end.kind === 'jack')) {
    const x = priced.get(end.ice);
    const enc = (u.encs as Enc[]).filter(e => e.id === end.ice).pop();
    const reasons = enc?.reasons.map(r => r.r) ?? [];
    if (x?.way === 'clicks') {
      // K (rev 1): P, the clicks the chosen prices plan, against the clicks left after the run's own click; bioroidClicks beside it
      const K = s0.P > s0.clicksS0 - 1;
      const W = (u.encs as Enc[]).filter(e => e.clicksSpent > 0 || e.pricedClicks).map(e => ({ t: e.t, clicks: e.clicksSpent, subs: e.clickSubs, endsRun: e.clickSubs.map(i => !!e.blocks[i]), planned: e.pricedClicks }));
      return { cls: 'T2', detail: { ice: x.t, K, P: s0.P, Kbioroid: s0.bioroidClicks > s0.clicksS0 - 1, bioroidClicks: s0.bioroidClicks, clicksAfterRunClick: s0.clicksS0 - 1, W, end: end.kind, reasons, clicksAtEnc: enc?.clicks ?? null } };
    }
    const wantCredits = end.kind === 'jack' || reasons.some(r => r === 'cannotGetThrough' || r === 'cannotPayAll' || r === 'cannotBreakBlocking');
    if (wantCredits) {
      const i = Math.abs(Number(s0.known) - Number(s0.sumNeed)) > 1e-6;
      // (ii) rev 1: budget against availableCredits plus the credits that pay only during runs (runBudget's by design)
      const ii = Math.abs(Number(s0.budget) - (Number(s0.avail) + Number(s0.duringRun ?? 0))) > 1e-6;
      const sub = i && ii ? 'i+ii' : i ? 'i' : ii ? 'ii' : 'iii';
      // What took the credits that the price did not charge as credits: every credit loss in the run not on a priced credit break
      const took = (u.deltas as any[])
        .filter(d => d.dc < 0)
        .filter(d => !(d.ice && priced.get(d.ice) && BREAK_WAYS.has(priced.get(d.ice).way) && (d.a === 'BREAK_SUBROUTINE' || d.a === 'BOOST_BREAKER' || d.a === 'USE_ABILITY')))
        .map(d => `${d.by}:${d.a}${d.card ? ':' + d.card : ''}@${d.phase}${d.ice ? ':' + (priced.get(d.ice)?.t ?? 'unpriced') : ''} ${d.dc}`);
      return { cls: 'T1', sub, detail: { ice: x?.t ?? end.t, way: x?.way ?? null, known: s0.known, sumNeed: s0.sumNeed, budget: s0.budget, avail: s0.avail, duringRun: s0.duringRun, end: end.kind, reasons, took } };
    }
    return { cls: 'O', sub: `${end.kind}:${x?.way ?? 'unpriced'}`, detail: { ice: end.t, reasons } };
  }
  if (!reached) return { cls: 'O', sub: end.kind, detail: end };
  // Reached the breach. H2 before the access (a facedown card took credits first) is checked with T4 below
  const trashes = (s0.trashes as any[]).map(t => {
    const acc = (u.accesses as any[]).find(x => x.id === t.id);
    const accessed = (u.accessedIds as string[]).includes(t.id) || !!acc;
    return { ...t, accessed, offered: !!acc && acc.trashCost != null, taken: !!acc?.trash, creditsAtAccess: acc?.credits ?? null, here: acc?.here ?? null, atS0: acc?.atS0 ?? null, atPrice: acc?.atPrice ?? null };
  });
  const missed = trashes.filter(t => t.accessed && !t.taken);
  if (missed.length) {
    if (costly.length) return { cls: 'H', sub: 'H2', detail: { took: costly.map(e => ({ t: e.t, cr: e.spent, k: e.clicksSpent })), trash: missed.map(t => t.t) } };
    const t = missed[0];
    // Rev 1: two kinds (declined, could not pay), and which S0 ask already kept: with S0's credits; only with S0's less known; neither
    const kind = t.offered ? 'declined' : 'couldNotPay';
    const keepAt = t.atS0?.pick === 'keep' ? 'keepS0' : t.atPrice?.pick === 'keep' ? 'keepLessKnown' : 'neither';
    return { cls: 'T4', sub: `${kind}/${keepAt}`, detail: { trashes: missed } };
  }
  const pairs: string[] = [];
  for (const e of u.encs as Enc[]) {
    const x = priced.get(e.id);
    if (!x || !e.rezzedS0) continue;
    const broke = e.broke.credits + e.broke.click + e.broke.ability > 0;
    const actual = !broke ? 'tank' : e.broke.click ? 'clicks' : e.broke.credits ? 'credits' : 'ability';
    const pricedWay = x.way;
    if (pricedWay === 'tank' && broke) pairs.push(`tank>${actual}`);
    if (BREAK_WAYS.has(pricedWay) && !broke && e.unbroken > 0 && e.resolved) pairs.push(`${pricedWay}>tank`);
  }
  if (pairs.length) return { cls: 'P', detail: { pairs } };
  return { cls: 'A', detail: trashes.length ? { trashes: trashes.map(t => ({ t: t.t, taken: t.taken, accessed: t.accessed })) } : undefined };
}

// ------------------------------------------------------------------------------------------------ sources
type Rec = { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
function dealStateOf(t: Tree, rec: Rec): GameState {
  const c = DECK_POOL.find(d => d.side === 'corp' && d.name === rec.corpDeck);
  const r = DECK_POOL.find(d => d.side === 'runner' && d.name === rec.runnerDeck);
  if (!c || !r) throw new Error(`deal ${rec.seed}: deck not found (${rec.corpDeck} v ${rec.runnerDeck})`);
  return t.core.createInitialGameState(t.decks.deckGameSetup(rec.seed, c, r));
}

/** A self-play deal on the hooked tree, watched; with IDENT the plain tree plays it too, step for step. */
function deal(pool: string, rec: Rec, plain?: Tree) {
  const t0 = performance.now();
  H.clear();
  const ag = { corp: H.createAgent('corp', 'normal'), runner: H.createAgent('runner', 'normal') };
  const g = new H.GameRunner(dealStateOf(H, rec), ag);
  const w = new Watch(pool, `${pool}:${rec.seed}`, ag.runner, () => (ag.runner as any).memory ?? new Map());
  G.__dt = w;
  let pg: any = null;
  if (plain) {
    plain.clear();
    pg = new plain.GameRunner(dealStateOf(plain, rec), { corp: plain.createAgent('corp', 'normal'), runner: plain.createAgent('runner', 'normal') });
  }
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  let firstDiff: number | null = null;
  let steps = 0;
  try {
    for (let n = 0; n < 4000; n++) {
      const s: GameState = g.state;
      if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
        cr.push(s.corp.credits);
        sc.push(s.corp.score);
        lastTurn = s.turnNumber;
      }
      w.before(s);
      const more = g.step();
      if (pg) {
        G.__dt = undefined;
        const pm = pg.step();
        G.__dt = w;
        if (firstDiff === null && (pm !== more || key(pg.last) !== key(g.last))) firstDiff = n;
      }
      if (!more) break;
      steps++;
      w.after(s, g.last ?? null, g.state);
    }
  } finally {
    G.__dt = undefined;
  }
  const matches = (g.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
  out({ kind: 'g', pool, src: `${pool}:${rec.seed}`, steps, units: w.units, matchesBatch: matches, ...(plain ? { plainSame: firstDiff === null, firstDiff } : {}), ms: Math.round(performance.now() - t0) });
}

/** From board `b` of an issue game: a fresh Normal Runner with the watcher's memory (it watched every board up to `b`) plays a copy to the turn's end. */
function continueFrom(name: string, at: string, b: GameState, j: number, watcher: any) {
  const runner: any = H.createAgent('runner', 'normal');
  runner.observe?.(b);
  runner.memory = new Map([...(watcher.memory ?? new Map()), ...(runner.memory ?? new Map())]);
  H.clear();
  const g = new H.GameRunner(structuredClone(b), { runner, corp: H.createAgent('corp', 'normal') });
  const w = new Watch('issues', `${name}@${at}:T${b.turnNumber}m${j}`, runner, () => runner.memory ?? new Map());
  G.__dt = w;
  try {
    for (let k = 0; k < 4000 && g.state.turnNumber === b.turnNumber && g.state.activePlayer === 'runner' && !g.state.winner; k++) {
      const st = g.state;
      w.before(st);
      if (!g.step()) break;
      w.after(st, g.last ?? null, g.state);
    }
  } finally {
    G.__dt = undefined;
  }
}

/** An issue game: replayed; at each recorded run a fresh Normal Runner that watched every board plays a copy to the turn's end. */
function issue(file: string) {
  const t0 = performance.now();
  const r = JSON.parse(readFileSync(file, 'utf8'));
  const name = file.split('/').pop()!.replace('.json', '');
  let s: GameState = H.core.createInitialGameState(H.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  const watcher: any = H.createAgent('runner', 'normal');
  let lastMain: { s: GameState; j: number } | null = null;
  let lastTurnBoard = -1;
  let boards = 0;
  for (const [j, move] of (r.moves as GameAction[]).entries()) {
    watcher.observe?.(s);
    const main = s.activePlayer === 'runner' && !s.activeRun && !E.core.activePrompt(s) && move.player === 'runner' && !(s.priority && s.priority.holder !== s.activePlayer);
    if (main) lastMain = { s, j };
    // The board at the Runner's first main decision of each turn (the #65 pin's board), when ISSUE_BOARDS asks for it
    if (main && TURN_BOARDS && s.turnNumber !== lastTurnBoard) {
      lastTurnBoard = s.turnNumber;
      boards++;
      continueFrom(name, 'ts', s, j, watcher);
    }
    let next: GameState;
    try {
      next = H.core.executeAction(s, move);
    } catch (e) {
      out({ kind: 'err', src: name, at: j, error: (e as Error).message.slice(0, 120) });
      break;
    }
    if (RUN_BOARDS && !s.activeRun && next.activeRun && s.activePlayer === 'runner' && lastMain && lastMain.s.turnNumber === s.turnNumber) {
      boards++;
      continueFrom(name, 'run', lastMain.s, lastMain.j, watcher);
      lastMain = null;
    }
    s = next;
  }
  out({ kind: 'h', pool: 'issues', src: name, boards, ms: Math.round(performance.now() - t0) });
}

async function main() {
  const dirs = makeTrees(root);
  H = await loadTree('hooked', dirs.hooked);
  const e = await loadTree('eval', dirs.eval);
  const m = (p: string) => import(/* @vite-ignore */ join(dirs.eval, 'src', p));
  E = Object.assign(e, { prompts: await m('ai/prompts.ts'), planner: await m('ai/turnPlanner.ts'), reply: await m('ai/runnerReply.ts') });
  const plain = IDENT ? await loadTree('plain', dirs.plain) : undefined;
  const started = Date.now();
  const sources: { pool: string; id: any }[] = [];
  for (const pool of POOLS) {
    if (pool === 'batch' || pool === 'nrdb') {
      const run = pool === 'batch' ? '45499791395' : '45503877309';
      const recs: Rec[] = JSON.parse(readFileSync(`scripts/runner-rework/decided-twice-deals-${run}.json`, 'utf8'));
      for (const r of recs) if (!DEALS.length || DEALS.includes(String(r.seed))) sources.push({ pool, id: r });
    } else if (pool === 'issues') {
      for (const dir of ['tests/fixtures/runner-facts/issues', 'tests/fixtures/runner-issues'])
        for (const f of readdirSync(dir).filter(x => /^issue-(58|59|64|66|67)\.json$/.test(x)).sort())
          if (!ISSUES.length || ISSUES.some(i => f.includes(i))) sources.push({ pool, id: join(dir, f) });
    } else throw new Error(`unknown pool ${pool}`);
  }
  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    if (Date.now() - started > MAX_MS) break;
    try {
      if (src.pool === 'issues') issue(src.id);
      else deal(src.pool, src.id, plain);
    } catch (err) {
      out({ kind: 'err', pool: src.pool, src: src.pool === 'issues' ? src.id : src.id.seed, error: (err as Error).stack?.slice(0, 500) });
    }
  }
  const tm: Record<string, number> = {};
  for (const [k2, v] of Object.entries(timing)) tm[k2] = Math.round(v);
  out({ kind: 's', shard, timing: tm, ms: Date.now() - started });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
