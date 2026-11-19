/**
 * R0 count 2 of the Runner rework: what the Runner's ranking costs, and what it depends on.
 * Brief: /mnt/project-files/netrunner-ai/runner-rework/r0/count2-rank-cost/brief.md (shared rules: ../standing-rules.md).
 * Scripts only: nothing in src or tests. Trees and arms: rank-cost-trees.ts.
 *
 * Sources (kinds kept apart everywhere: `sk` self; hr = a person played the Runner against our Normal-or-Hard Corp file,
 * hrHard = report-33 (against the Hard Corp, read apart); hcHard = a person played the Corp against the Hard Runner
 * (switched off, read apart); hcNormal = against the Normal Runner, report-54):
 *  (a) the 221 deals of the g1 base 44381468776 (scripts/stage-d/post-pick-deals.json: winner, cr and sc checked against
 *      that record), played by the `source` tree with a plain GameRunner, Normal v Normal, as the batch. The source tree
 *      is never asked or cleared mid-game (found row 71b); its agents' state is copied before each step into the fresh
 *      agents that are asked.
 *  (b) tests/fixtures/human-games: the recorded moves replayed; at every board where either side decides, today's AI of
 *      that side is asked (fresh agents). `who`: ai (the AI decided this board in the game) or person.
 * The Corp decision index `ci` counts Corp asks as count-bound did (scripts/stage-d/count-bound-prof.ts askAt), so the
 * slow decisions of scripts/stage-d/count-bound-slow.json (`src#ci`, beta's src is unchanged since that run) are found.
 *
 * PART=C (time and cuts): every decision is asked of beta, control and each C arm (one GameRunner step on a copy, fresh
 * agents, hand caches cleared, tree order rotated, timed, __rc on). Per Corp decision and tree: ms, the Runner agent's
 * and its ranking's ms inside the reply, the reply's samples (their action sequences): for each arm the samples are laid
 * beside beta's (same index and start key) and the first differing pick found (per reply step: Runner steps compared up
 * to it, and whether the first difference was the Runner's or the Corp's pick). Corp decisions are also asked of the
 * `instr` tree (the split of the ranking's time; its answer checked against beta) and, every AUDIT_EVERY-th Corp
 * decision, of `deckRootA` (the audit of root-served deck averages). Runner main-phase boards also get O's row (below).
 * PART=D: beta and the ten term arms (picks only). PART=X with ARMS=...: any arms (the arms together, `c:A+B`).
 * O (PART=C only): on each Runner main-phase board, the beta Runner's ranking (rankMainActions on a fresh agent with the
 * deciding agent's memory): per kind of move legal and scored above the cut (finite), its best score; the move played
 * (the source game's Runner, or the person); public conditions (runShortfall per server, the rig's coverage against
 * the rezzed ice's types, tags, credits).
 * Hold-count classes (the five faults being fixed on ai-hold-inputs, not merged): each Corp decision carries flags K
 * (Knickknack O'Brian installed), A (Audrey v2 installed), R (a run under way: the three run-time classes).
 *
 * Hidden information: agents are asked only through GameRunner (their own views); no arm reads a hidden card (DECKROOT
 * prices the Runner's own stack as the Runner's view deals it). This measuring script reads card titles to label an
 * action (a Corp card named by a prompt may be hidden: HIDDEN-READ, labels only).
 *
 *   SHARD=0/64 PART=C npx vite-node scripts/runner-rework/rank-cost.ts
 *   ARGS="PART=C DEALS=1601 HUMAN=none MAXDEC=40" npx vite-node scripts/runner-rework/rank-cost.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameAction, GameState } from '../../src/core';
import { dealState } from '../stage-a/harness';
import { C_ARMS, D_ARMS, Tree, loadTree, makeTrees } from './rank-cost-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const PART = process.env.PART ?? 'C';
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/rank-cost', String(shard));
const MAXDEC = Number(process.env.MAXDEC ?? Infinity);
const CHUNK = Number(process.env.CHUNK ?? 12);
const AUDIT_EVERY = Number(process.env.AUDIT_EVERY ?? 4);
const AUDIT_SAMPLE = Number(process.env.AUDIT_SAMPLE ?? 1);
const ARMS: string[] = process.env.ARMS ? process.env.ARMS.split(',') : PART === 'D' ? [...D_ARMS] : [...C_ARMS];
const ASKED = PART === 'C' ? ['beta', 'control', ...ARMS] : ['beta', ...ARMS];
const EXTRA = process.env.EXTRA !== undefined ? process.env.EXTRA.split(',').filter(Boolean) : PART === 'C' ? ['instr', 'deckRootA'] : [];
const ORDER = (process.env.O ?? (PART === 'C' ? '1' : '0')) === '1';
/** Each deal is split into DPARTS units (decision i belongs to part i % DPARTS; the source game is played again per part). */
const DPARTS = Number(process.env.DPARTS ?? 2);
const G = globalThis as any;
const key = (a: unknown) => (a ? JSON.stringify(a) : 'null');
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

let trees: Record<string, Tree> = {};

// ------------------------------------------------------------------------------------------------ globals the trees write
interface Rc {
  on: boolean;
  reply: number;
  samples: { key: string; seq: string[] }[];
  rankMs: number;
  rankCalls: number;
  runnerMs: number;
  ownRankMs: number;
  ownRankCalls: number;
  sample(k: string): string[];
}
function freshRc(): Rc {
  const rc: Rc = {
    on: true,
    reply: 0,
    samples: [],
    rankMs: 0,
    rankCalls: 0,
    runnerMs: 0,
    ownRankMs: 0,
    ownRankCalls: 0,
    sample(k: string) {
      const seq: string[] = [];
      this.samples.push({ key: k, seq });
      return seq;
    },
  };
  return rc;
}
/** The instr tree's timers (exclusive, on a stack) and counts, only inside a ranking. */
function freshRi() {
  const ri: any = {
    depth: 0,
    ctx: '',
    kind: 'setup',
    stack: [] as { name: string; t0: number; inner: number }[],
    split: {} as Record<string, number>,
    cnt: {} as Record<string, number>,
    enter(ctx: string) {
      if (this.depth === 0) {
        this.ctx = ctx;
        this.kind = 'setup';
      }
      this.depth++;
      if (this.depth === 1) this.c('rank');
      this.stack.push({ name: 'rank', t0: performance.now(), inner: 0 });
    },
    leave() {
      this.pop();
      this.depth--;
    },
    pop() {
      const fr = this.stack.pop();
      const all = performance.now() - fr.t0;
      const path = this.stack.map((f: any) => f.name).slice(-2).join('>');
      const k = `${this.ctx}|${this.kind}|${path ? `${path}>` : ''}${fr.name}`;
      this.split[k] = (this.split[k] ?? 0) + all - fr.inner;
      const up = this.stack[this.stack.length - 1];
      if (up) up.inner += all;
    },
    T(name: string, f: () => any) {
      if (this.depth === 0) return f();
      this.c(name);
      this.stack.push({ name, t0: performance.now(), inner: 0 });
      try {
        return f();
      } finally {
        this.pop();
      }
    },
    c(name: string) {
      if (this.depth === 0) return;
      const k = `${this.ctx}|${this.kind}|${name}`;
      this.cnt[k] = (this.cnt[k] ?? 0) + 1;
    },
    cand(state: GameState, action: GameAction, f: () => any) {
      const was = this.kind;
      this.kind = rkind(trees.beta, state, action);
      try {
        return this.T('score', f);
      } finally {
        this.kind = was;
      }
    },
  };
  return ri;
}

// ------------------------------------------------------------------------------------------------ kinds of move
const CENTRAL = new Set(['hq', 'rd', 'archives']);
const MONEY = /\b(gain|take)\s+(\d+|X|all)\b[^.]*\[?credit/i;
function rkind(t: Tree, s: GameState, a: GameAction): string {
  const x = a as any;
  switch (a.type) {
    case 'INITIATE_RUN':
      return CENTRAL.has(x.targetServerId) ? 'runCentral' : 'runRemote';
    case 'INSTALL_CARD': {
      if (x.trashFirst?.length) return 'makeRoom';
      const c = t.core.findCardAnywhere(s, x.cardInstanceId);
      return c && /icebreaker/i.test(t.core.cardDef(c).keywords ?? '') ? 'installBreaker' : 'install';
    }
    case 'PLAY_OPERATION_OR_EVENT': {
      const c = t.core.findCardAnywhere(s, x.cardInstanceId);
      const text = c ? (t.core.cardDef(c).stripped_text ?? '') : '';
      if (/\bmake a run\b|\brun (hq|r&d|archives|any server|a remote)/i.test(text)) return 'runEvent';
      return MONEY.test(text) ? 'money' : 'event';
    }
    case 'USE_ABILITY': {
      const c = t.core.findCardAnywhere(s, x.cardInstanceId);
      const text = c ? (t.core.cardDef(c).stripped_text ?? '') : '';
      return MONEY.test(text) ? 'moneyAbility' : 'ability';
    }
    case 'DRAW_CARD':
      return 'draw';
    case 'GAIN_CREDIT':
      return 'credit';
    case 'REMOVE_TAG':
      return 'tag';
    case 'END_TURN':
      return 'end';
    default:
      return a.type;
  }
}

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
type Cls = 'corpPrompt' | 'corpMain' | 'corpRez' | 'runnerPrompt' | 'runnerMain' | 'runnerOff' | 'runnerRun';
function decisionOf(core: any, s0: GameState): { side: 'corp' | 'runner'; cls: Cls } | null {
  const s = { ...s0, stops: { corp: 'ai', runner: 'ai' } } as GameState;
  const side = core.actingSide(s);
  if (!side || s.winner) return null;
  const w = s.priority;
  if (s.pendingPrompts.length === 0 && w && w.holder !== s.activePlayer) {
    const ask = core.wantsStop(s, side, w);
    if (ask && side === 'corp' && (w.step === 'approach_ice' || w.step === 'approach_server')) return { side, cls: 'corpRez' };
    if (ask && side === 'runner' && w.step === 'corp_action') return { side, cls: 'runnerOff' };
    return null;
  }
  if (core.activePrompt(s)) return { side, cls: `${side}Prompt` as Cls };
  if (side === 'runner' && s.activeRun) return { side, cls: 'runnerRun' };
  return { side, cls: `${side}Main` as Cls };
}

interface Ask {
  a: GameAction | null;
  k: string;
  ms: number;
  rc: Rc;
  err?: string;
}
function ask(t: Tree, s: GameState, snaps: { corp?: Snap; runner?: Snap } | undefined): Ask {
  t.clear();
  const ag = agents(t, snaps);
  const g = new t.GameRunner(structuredClone(s), ag);
  const rc = freshRc();
  G.__rc = rc;
  const at = performance.now();
  try {
    g.step();
    const ms = performance.now() - at;
    const a = g.last as GameAction | null;
    return { a, k: key(a), ms, rc };
  } catch (e) {
    return { a: null, k: `error: ${(e as Error).message.slice(0, 80)}`, ms: performance.now() - at, rc, err: (e as Error).message.slice(0, 160) };
  } finally {
    G.__rc = undefined;
  }
}

function title(t: Tree, s: GameState, id: string): string {
  // HIDDEN-READ (measuring script, labels only): a card named by an action may be a hidden Corp card
  const c = t.core.findCardAnywhere(s, id);
  return c ? t.core.cardDef(c).title : id;
}
function label(t: Tree, s: GameState, a: GameAction | null | undefined): string {
  if (!a) return 'none';
  const x = a as any;
  if (a.type === 'RESOLVE_PROMPT') {
    const c = x.choice;
    if (c.kind === 'effect_choice') return `prompt:${c.optionId}${c.trashFirst?.length ? '+trashFirst' : ''}`;
    if (c.kind === 'effect_cards') return `prompt:[${c.cardInstanceIds.map((id: string) => title(t, s, id)).join(', ')}]`;
    if (c.kind === 'discard') return `discard:[${c.cardInstanceIds.map((id: string) => title(t, s, id)).join(', ')}]`;
    return `prompt:${c.kind}`;
  }
  const id = x.cardInstanceId;
  const tf = x.trashFirst?.length ? ` trashing ${x.trashFirst.map((i: string) => title(t, s, i)).join('+')}` : '';
  const host = x.hostInstanceId ? ` on ${title(t, s, x.hostInstanceId)}` : '';
  if (!id) return a.type + (x.targetServerId ? `>${x.targetServerId}` : x.server ? `>${x.server}` : '');
  return `${a.type} ${title(t, s, id)}${host}${tf}${x.targetServerId ? `>${x.targetServerId}` : ''}`;
}
function promptInfo(t: Tree, s: GameState) {
  const p = t.core.activePrompt(s);
  if (!p) return null;
  const src = 'source' in p ? p.source : null;
  return `${p.side}:${p.kind}:${src ? t.core.getCardDefinition(src.cardCode).title : ''}:${src?.step ?? ''}`;
}
/** The hold count's known-fault classes (public facts only). */
function holdFlags(s: GameState): string {
  const rig = [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources].map(c => c.cardCode);
  return `${rig.includes('35033') ? 'K' : ''}${rig.includes('34004') ? 'A' : ''}${s.activeRun ? 'R' : ''}`;
}

/** Reply samples of `arm` beside beta's: Runner steps compared up to the first differing pick, and who picked first differently. */
function replyDiff(b: Rc, x: Rc): [number, number, number, number, number] {
  let steps = 0;
  let rDiv = 0;
  let cDiv = 0;
  let unaligned = 0;
  const n = Math.max(b.samples.length, x.samples.length);
  for (let j = 0; j < n; j++) {
    const sb = b.samples[j];
    const sx = x.samples[j];
    if (!sb || !sx || sb.key !== sx.key) {
      unaligned += n - j;
      break;
    }
    const m = Math.max(sb.seq.length, sx.seq.length);
    for (let i = 0; i < m; i++) {
      const pb = sb.seq[i];
      const px = sx.seq[i];
      const side = pb ? (JSON.parse(pb).player as string) : px ? (JSON.parse(px).player as string) : '';
      if (side === 'runner') steps++;
      if (pb !== px) {
        if (side === 'runner') rDiv++;
        else cDiv++;
        break;
      }
    }
  }
  return [steps, rDiv, cDiv, unaligned, n];
}
const runnerSteps = (rc: Rc) => rc.samples.reduce((n, s) => n + s.seq.filter(a => a.includes('"player":"runner"')).length, 0);

// ------------------------------------------------------------------------------------------------ O: a Runner main-phase board
function orderRow(d: Dec) {
  const t = trees.beta;
  t.clear();
  const ag = restore(t.createAgent('runner', 'normal'), d.snaps?.runner);
  const s = structuredClone(d.s);
  let ranked: { action: GameAction; score: number }[];
  try {
    ranked = ag.rankMainActions(s);
  } catch (e) {
    return { err: (e as Error).message.slice(0, 120) };
  }
  const open: Record<string, number> = {};
  for (const r of ranked) {
    if (!Number.isFinite(r.score)) continue;
    const k = rkind(t, d.s, r.action);
    if (open[k] === undefined || r.score > open[k]) open[k] = r3(r.score);
  }
  const played = d.played ? rkind(t, d.s, d.played) : null;
  // Public conditions
  const short: Record<string, number | null> = {};
  for (const id of Object.keys(d.s.corp.servers)) {
    const sv = d.s.corp.servers[id];
    if (!CENTRAL.has(id) && sv.root.length === 0) continue;
    short[id] = t.runs.runShortfall(d.s, id);
  }
  const best = (ids: string[]) => {
    const xs = ids.map(id => short[id]).filter((v): v is number => v !== null && v !== undefined);
    return xs.length ? Math.min(...xs) : null;
  };
  const cen = best(Object.keys(short).filter(id => CENTRAL.has(id)));
  const rem = best(Object.keys(short).filter(id => !CENTRAL.has(id)));
  const cov = t.evaluate.rigCoverage(d.s.runner.rig.programs);
  const types = new Set<string>();
  for (const sv of Object.values(d.s.corp.servers))
    for (const ice of sv.ice) if (ice.isRezzed) for (const ty of ['barrier', 'code gate', 'sentry']) if (new RegExp(`\\b${ty}\\b`, 'i').test(t.core.cardDef(ice).keywords ?? '')) types.add(ty);
  const missing = cov.anyBreakers > 0 ? [] : [...types].filter(ty => !cov.covered.has(ty));
  const cond = {
    inCentral: cen !== null && cen <= 0, // some central's rezzed ice is affordable now
    inRemote: rem !== null && rem <= 0, // some remote with cards in it is affordable now
    shortCentral: cen === null || cen > 0,
    shortRemote: rem === null || rem > 0,
    hasRemote: rem !== null || Object.keys(short).some(id => !CENTRAL.has(id)),
    missingType: missing.length > 0,
    noBreakers: cov.covered.size === 0 && cov.anyBreakers === 0,
    tagged: (d.s.runner.tags ?? 0) > 0,
    clicks: d.s.runner.clicks,
    credits: d.s.runner.credits,
    grip: d.s.runner.grip.length,
    breakerInGrip: d.s.runner.grip.some(c => /icebreaker/i.test(t.core.cardDef(c).keywords ?? '')),
  };
  return { open, played, top: ranked[0] ? rkind(t, d.s, ranked[0].action) : null, cond };
}

// ------------------------------------------------------------------------------------------------ one decision
let rot = 0;
interface Dec {
  src: string;
  sk: string;
  who: 'ai' | 'person';
  i: number;
  ci: number;
  slow: boolean;
  s: GameState;
  side: 'corp' | 'runner';
  cls: Cls;
  snaps?: { corp?: Snap; runner?: Snap };
  played?: GameAction | null;
}
let corpSeen = 0;
function decide(d: Dec) {
  const t = trees.beta;
  const order = [...ASKED.slice(rot % ASKED.length), ...ASKED.slice(0, rot % ASKED.length)];
  rot++;
  const asks: Record<string, Ask> = {};
  for (const arm of order) asks[arm] = ask(trees[arm], d.s, d.snaps);
  const b = asks.beta;
  const changed = ARMS.filter(a => asks[a].k !== b.k);
  const row: Record<string, unknown> = { k: d.side === 'corp' ? 'c' : 'r', src: d.src, sk: d.sk, who: d.who, i: d.i, T: d.s.turnNumber, cls: d.cls, ms: ASKED.map(a => r1(asks[a].ms)) };
  if (d.side === 'corp') {
    row.ci = d.ci;
    if (d.slow) row.slow = 1;
    row.hold = holdFlags(d.s) || undefined;
    row.rk = ASKED.map(a => r1(asks[a].rc.rankMs));
    row.rkn = ASKED.map(a => asks[a].rc.rankCalls);
    row.rn = ASKED.map(a => r1(asks[a].rc.runnerMs));
    row.ns = b.rc.samples.length;
    row.st = ASKED.map(a => runnerSteps(asks[a].rc));
    row.rep = Object.fromEntries(ASKED.filter(a => a !== 'beta').map(a => [a, replyDiff(b.rc, asks[a].rc)]));
    if (d.cls === 'corpPrompt') row.p = promptInfo(t, d.s);
  } else {
    row.or = ASKED.map(a => r1(asks[a].rc.ownRankMs));
    row.orn = b.rc.ownRankCalls;
    if (d.cls === 'runnerPrompt') row.p = promptInfo(t, d.s);
  }
  if (asks.control && asks.control.k !== b.k) row.controlDiffers = label(t, d.s, asks.control.a);
  if (d.played !== undefined && d.played !== null) {
    row.fresh = key(d.played) === b.k ? 1 : 0;
    if (d.who === 'person') row.played = label(t, d.s, d.played);
  }
  for (const a of ASKED) if (asks[a].err) (row.errors ??= {} as any)[a] = asks[a].err;
  if (changed.length) {
    row.ch = Object.fromEntries(changed.map(a => [a, label(t, d.s, asks[a].a)]));
    row.beta = label(t, d.s, b.a);
  }
  if (d.side === 'runner') row.bk = b.a ? rkind(t, d.s, b.a) : null;
  // The instr tree and the audit tree (PART C, Corp decisions)
  if (d.side === 'corp' && EXTRA.includes('instr')) {
    const ri = freshRi();
    G.__ri = ri;
    let x: Ask;
    try {
      x = ask(trees.instr, d.s, d.snaps);
    } finally {
      G.__ri = undefined;
    }
    row.instr = { ms: r1(x.ms), same: x.k === b.k ? 1 : 0, split: Object.fromEntries(Object.entries(ri.split as Record<string, number>).map(([k, v]) => [k, r3(v)])), cnt: ri.cnt };
  }
  if (d.side === 'corp' && EXTRA.includes('deckRootA')) {
    if (corpSeen++ % AUDIT_EVERY === 0) {
      const au = { on: true, n: 0, every: AUDIT_SAMPLE, corp: [0, 0, 0], runner: [0, 0, 0], rec(side: 'corp' | 'runner', served: number, fresh: number) {
        const r = this[side];
        r[0]++;
        if (Math.abs(served - fresh) > 1e-9) {
          r[1]++;
          r[2] += Math.abs(served - fresh);
        }
      } };
      G.__rcAudit = au;
      const hv = trees.deckRootA.hv;
      hv.drawAudit.on = true;
      hv.drawAudit.checked = 0;
      hv.drawAudit.mismatches = 0;
      hv.drawAudit.errors.length = 0;
      try {
        ask(trees.deckRootA, d.s, d.snaps);
      } finally {
        G.__rcAudit = undefined;
        hv.drawAudit.on = false;
      }
      row.audit = { corp: au.corp.map(r3), runner: au.runner.map(r3), map: [hv.drawAudit.checked, hv.drawAudit.mismatches] };
    }
  }
  out(row);
  if (ORDER && d.side === 'runner' && d.cls === 'runnerMain') out({ k: 'o', src: d.src, sk: d.sk, who: d.who, i: d.i, T: d.s.turnNumber, ...orderRow(d) });
}

// ------------------------------------------------------------------------------------------------ main
async function main() {
  const names = ['source', ...ASKED, ...EXTRA];
  const dirs = makeTrees(root, names);
  trees = {};
  for (const n of names) trees[n] = await loadTree(n, dirs[n]);
  const slowList: [string, number, number, number][] = JSON.parse(readFileSync('scripts/stage-d/count-bound-slow.json', 'utf8'));
  const slow = new Set(slowList.map(([src, i]) => `${src}#${i}`));
  const record: { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] }[] = JSON.parse(readFileSync('scripts/stage-d/post-pick-deals.json', 'utf8'));
  const want = (process.env.DEALS ?? '').split(',').filter(Boolean);
  const dealList = want.includes('none') ? [] : record.filter(r => !want.length || want.includes(String(r.seed)));
  const hdir = 'tests/fixtures/human-games';
  const hwant = (process.env.HUMAN ?? '').split(',').filter(Boolean);
  const humans = hwant.includes('none')
    ? []
    : readdirSync(hdir)
        .filter(f => f.endsWith('.json') && (!hwant.length || hwant.some(w => f.startsWith(w))))
        .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')) || a.localeCompare(b));

  // Units: human files in chunks of CHUNK decisions (either side), then the deals
  const core = trees.beta.core;
  const startOf = (r: any): GameState => {
    if (r.startsAt === 'state') return structuredClone(r.state);
    let s = core.createInitialGameState(trees.beta.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
    if (r.startStops) s = { ...s, stops: r.startStops };
    return s;
  };
  type Unit = { kind: 'deal'; rec: (typeof record)[number]; part: number } | { kind: 'human'; file: string; from: number; to: number };
  const units: Unit[] = [];
  const reports = new Map<string, any>();
  for (const f of humans) {
    const r = JSON.parse(readFileSync(join(hdir, f), 'utf8'));
    if (!r.moves?.length) continue;
    reports.set(f, r);
    let s = startOf(r);
    let n = 0;
    for (const move of r.moves as GameAction[]) {
      if (decisionOf(core, s)) n++;
      try {
        s = core.executeAction(s, move);
      } catch {
        break;
      }
    }
    for (let from = 0; from < n; from += CHUNK) units.push({ kind: 'human', file: f, from, to: Math.min(n, from + CHUNK) });
  }
  for (const rec of dealList) for (let part = 0; part < DPARTS; part++) units.push({ kind: 'deal', rec, part });

  for (const [u, unit] of units.entries()) {
    if (u % shards !== shard) continue;
    const t0 = performance.now();
    let decisions = 0;
    if (unit.kind === 'deal') {
      const rec = unit.rec;
      const name = `deal:${rec.seed}`;
      const t = trees.source;
      t.clear();
      const ag = { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') };
      const g = new t.GameRunner(dealState(rec.seed), ag);
      const cr: number[] = [];
      const sc: number[] = [];
      let lastTurn = -1;
      const decs: Dec[] = [];
      let ci = 0;
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
        if (dec && copy) {
          decs.push({ src: name, sk: 'self', who: 'ai', i: decs.length, ci: dec.side === 'corp' ? ci : -1, slow: dec.side === 'corp' && slow.has(`${name}#${ci}`), s: copy, side: dec.side, cls: dec.cls, snaps, played: g.last ?? null });
          if (dec.side === 'corp') ci++;
        }
      }
      const matches = (g.state.winner ?? null) === rec.winner && key(cr) === key(rec.cr) && key(sc) === key(rec.sc);
      out({ k: 'g', src: name, part: unit.part, decks: `${rec.corpDeck} v ${rec.runnerDeck}`, winner: g.state.winner ?? null, T: g.state.turnNumber, matchesBatch: matches, ...(matches ? {} : { cr, sc, recCr: rec.cr, recSc: rec.sc, recWinner: rec.winner }), decisions: decs.length, corp: ci, playMs: Math.round(performance.now() - t0) });
      for (const d of decs.filter(x => x.i % DPARTS === unit.part).slice(0, MAXDEC)) {
        decide(d);
        decisions++;
      }
    } else {
      const r = reports.get(unit.file);
      const sk = r.config.ai === 'corp' ? (r.config.difficulty === 'hard' ? 'hrHard' : 'hr') : r.config.difficulty === 'hard' ? 'hcHard' : 'hcNormal';
      const aiSide = r.config.ai === 'corp' ? 'corp' : 'runner';
      const name = `human:${unit.file}`;
      let s = startOf(r);
      let n = 0;
      let ci = 0;
      let stopped: string | null = null;
      for (const [j, move] of (r.moves as GameAction[]).entries()) {
        const dec = decisionOf(core, s);
        if (dec) {
          if (n >= unit.from && n < unit.to && decisions < MAXDEC) {
            decide({ src: name, sk, who: dec.side === aiSide ? 'ai' : 'person', i: n, ci: dec.side === 'corp' ? ci : -1, slow: dec.side === 'corp' && slow.has(`${name}#${ci}`), s: structuredClone(s), side: dec.side, cls: dec.cls, played: move });
            decisions++;
          }
          n++;
          if (dec.side === 'corp') ci++;
          if (n >= unit.to) break;
        }
        try {
          s = core.executeAction(s, move);
        } catch (e) {
          stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
          break;
        }
      }
      if (stopped) out({ k: 'h', src: name, from: unit.from, stopped });
    }
    out({ k: 's', src: unit.kind === 'deal' ? `deal:${unit.rec.seed}/${unit.part}` : `human:${unit.file}@${unit.from}`, ms: Math.round(performance.now() - t0), decisions });
  }
  out({ k: 'mem', shard, part: PART, maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024) });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
