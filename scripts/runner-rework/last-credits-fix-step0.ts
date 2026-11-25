/**
 * R-14h fix, step 0 (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/r14h-last-credits-fix.md rev 2, step 0.1 to
 * 0.3): on the base pools, played on this checkout's tree (commit 2: play identical to beta 4d85e9f, every cardRate call
 * carries its class), with call-only hooks on a scratch copy that compute what commit 3 would compute and change nothing:
 *   reach   every cardRate call by its site (the caller's file:line), side of the deck read and class, per top-level decision
 *   fires   every drawWorth read whose deck average would move by more than 0.001 if its money were each candidate form
 *           (none: credits plus turn-start payments; k1, k2: every click but 1 or 2 earning), by class and side of the deck
 *   money   at each top-level decision, the decider's own deck on the decision's board: the cards each form flips (cost above
 *           today's credits, within the form's money), and (written after the game) the peak credits that side held during
 *           its next own turn
 * The hooked tree plays the source games itself: the hooks only read values the code works out anyway (a deck card's played
 * worth, on a cache miss) and pure functions of the board (the next-turn money owners, nextTurnMoney.ts); every deal is
 * checked against its batch record (winner, cr, sc).
 *
 * Pools: batch (the 221 deals of g1 45617829233), nrdb (the 110 of NRDB=1 g1 45621322301), both on beta 4d85e9f's tree.
 *
 *   SHARD=0/64 npx vite-node scripts/runner-rework/last-credits-fix-step0.ts -- POOL=batch,nrdb
 *   ARGS="POOL=batch DEALS=1001" npx vite-node scripts/runner-rework/last-credits-fix-step0.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { Tree, loadTree } from './facts-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const POOLS = (process.env.POOL ?? 'batch,nrdb').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 6000);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/last-credits-fix-step0', String(shard));
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const key = (a: unknown) => JSON.stringify(a ?? null);
const G = globalThis as any;
const FORMS = ['none', 'k1', 'k2'] as const;
type Form = (typeof FORMS)[number];
type Side = 'corp' | 'runner';

// ------------------------------------------------------------------------------------------------ the hooked tree
type Patch = [file: string, at: string, to: string];
const HOOKS: Patch[] = [
  // cardRate: the caller's site, the side and class, before the deck average is asked (drawWorth reads the site)
  [
    'ai/valueModel.ts',
    `  return logValue('cardDrawn', 'cardRate', state, state && deckCard ? deckCard(state, side, when) : RATES.drawnCard, side, when);\n`,
    `  const __lf = (globalThis as any).__LF;\n  if (__lf?.on) __lf.rate(new Error().stack, side, when);\n  try {\n    return logValue('cardDrawn', 'cardRate', state, state && deckCard ? deckCard(state, side, when) : RATES.drawnCard, side, when);\n  } finally {\n    if (__lf?.on) __lf.rateEnd();\n  }\n`,
  ],
  // drawWorth on a cache miss: the deck cards' played worths, so each form's average is worked out from the same numbers
  [
    'ai/handValues.ts',
    `  const value = withPricing({ averaging: true }, () => (deck.length ? deck.reduce((n, c) => n + heldFromPlayed(c, playedWorth(state, c), money), 0) / deck.length : RATES.drawnCard));\n`,
    `  const __played: number[] = [];\n  const value = withPricing({ averaging: true }, () => (deck.length ? deck.reduce((n, c) => {\n    const __p = playedWorth(state, c);\n    __played.push(__p);\n    return n + heldFromPlayed(c, __p, money);\n  }, 0) / deck.length : RATES.drawnCard));\n  if ((globalThis as any).__LF?.on && cached === undefined) (globalThis as any).__LF.miss(key, state, side, deck, __played);\n`,
  ],
  // drawWorth's answer (a hit or a miss): the value and its key (the forms' averages are kept by key, as the value is)
  [
    'ai/handValues.ts',
    `  if (cached !== undefined && !drawAudit.on) return cached;\n`,
    `  if (cached !== undefined && !drawAudit.on) {\n    (globalThis as any).__LF?.on && (globalThis as any).__LF.answer(key, state, side, when, cached);\n    return cached;\n  }\n`,
  ],
  [
    'ai/handValues.ts',
    `  if (deckAverage.size > 500) deckAverage.clear();\n  deckAverage.set(key, value);\n  return value;\n`,
    `  if (deckAverage.size > 500) deckAverage.clear();\n  deckAverage.set(key, value);\n  (globalThis as any).__LF?.on && (globalThis as any).__LF.answer(key, state, side, when, value);\n  return value;\n`,
  ],
  // rootDeckAverage (the Corp's planner playouts): the played worths it already holds
  [
    'ai/handValues.ts',
    `    sum += heldFromPlayed(c, played, money);\n  }\n  return sum / deck.length;\n`,
    `    sum += heldFromPlayed(c, played, money);\n    __played.push(played);\n  }\n  (globalThis as any).__LF?.on && (globalThis as any).__LF.root(state, side, deck, __played);\n  return sum / deck.length;\n`,
  ],
  [
    'ai/handValues.ts',
    `  if (rootAvg !== undefined) return rootAvg;\n`,
    `  if (rootAvg !== undefined) {\n    (globalThis as any).__LF?.on && (globalThis as any).__LF.rootAnswer(state, side, when, rootAvg);\n    return rootAvg;\n  }\n`,
  ],
  ['ai/handValues.ts', `  deckAvgStats.served++;\n`, `  deckAvgStats.served++;\n  const __played: number[] = [];\n`],
];

/** Hooked line -> this checkout's line, per patched file (a site is named by the repo's line, not the hooked copy's). */
const LINE_MAP: Record<string, number[]> = {};
function makeTree(): string {
  rmSync(root, { recursive: true, force: true });
  const dir = join(root, 'hooked');
  mkdirSync(dir, { recursive: true });
  cpSync('src', join(dir, 'src'), { recursive: true });
  for (const [f, at, to] of HOOKS) {
    const path = join(dir, 'src', f);
    const text = readFileSync(path, 'utf8');
    if (text.split(at).length !== 2) throw new Error(`hooked tree: a patch does not match once in ${f}: ${at.slice(0, 90)}`);
    writeFileSync(path, text.replace(at, () => to));
  }
  for (const f of new Set(HOOKS.map(h => h[0]))) {
    const orig = readFileSync(join('src', f), 'utf8').split('\n');
    const hooked = readFileSync(join(dir, 'src', f), 'utf8').split('\n');
    const map: number[] = [];
    let j = 0;
    for (let i = 0; i < hooked.length; i++) {
      const k = orig.indexOf(hooked[i], j);
      if (k >= 0 && k - j < 3) j = k + 1;
      map[i + 1] = j; // an inserted line maps to the repo line before it
    }
    LINE_MAP[`ai/${f.replace(/^ai\//, '')}`] = map;
  }
  return dir;
}

let T: Tree;
let NTM: any; // the tree's nextTurnMoney.ts
let CORE: any;
let ORACLE: any;

// ------------------------------------------------------------------------------------------------ the money forms
const credits = (s: GameState, side: Side) => (side === 'corp' ? s.corp.credits : s.runner.credits);
/** The money each candidate form gives `side` on `s` (one WeakMap per board, as commit 3 will). */
const moneys = new WeakMap<GameState, Partial<Record<Side, Record<Form, number>>>>();
function moneyOf(s: GameState, side: Side): Record<Form, number> {
  let m = moneys.get(s);
  if (!m) moneys.set(s, (m = {}));
  if (m[side]) return m[side]!;
  let r: Record<Form, number>;
  if (side === 'runner') {
    const earn: number[] = NTM.runnerEarnings(s, NTM.nextTurn(s));
    const max = s.runner.maxClicks;
    const at = (k: number) => earn[Math.max(0, max - k)];
    r = { none: s.runner.credits + earn[0], k1: s.runner.credits + at(1), k2: s.runner.credits + at(2) };
  } else {
    r = { none: s.corp.credits + NTM.knownIncome(s), k1: NTM.nextTurnCredits(s, s.corp.credits, 0, 1), k2: NTM.nextTurnCredits(s, s.corp.credits, 0, 2) };
  }
  return (m[side] = r);
}
const held = (cost: number, played: number, money: number) => Math.max(T.handValues.HAND_FLOOR, (cost <= money ? T.handValues.SOON.now : T.handValues.SOON.later) * played);
const costOf = (c: any) => CORE.cardDef(c).cost ?? 0;
function averages(deck: any[], played: number[], forms: Record<Form, number>): Record<Form, number> {
  const r = {} as Record<Form, number>;
  for (const f of FORMS) r[f] = deck.reduce((n, c, i) => n + held(costOf(c), played[i], forms[f]), 0) / deck.length;
  return r;
}

// ------------------------------------------------------------------------------------------------ the decision's record
interface Dec {
  side: Side;
  kind: string;
  sites: Map<string, number>; // site|side|when -> calls
  fires: Map<string, number>; // form|when|deckSide|site -> calls whose value moves > 0.001
  reads: Map<string, number>; // when|deckSide -> drawWorth answers
}
let cur: Dec | null = null;
const siteStack: string[] = [];
const altByKey = new Map<string, Record<Form, number>>();
let lastRoot: Record<Form, number> | undefined;
const siteOf = (stack: string): string => {
  const line = stack.split('\n')[2] ?? '';
  const m = line.match(/src\/(ai\/[^:)]+):(\d+)/);
  if (!m) return line.trim().slice(0, 60);
  const map = LINE_MAP[m[1]];
  return `${m[1].replace(/^ai\//, '')}:${map ? map[Number(m[2])] : m[2]}`;
};
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
function note(state: GameState, side: Side, when: string, value: number, alts: Record<Form, number> | undefined) {
  if (!cur) return;
  bump(cur.reads, `${when}|${side}`);
  const s = siteStack[siteStack.length - 1] ?? 'direct';
  if (!alts) return;
  for (const f of FORMS) if (Math.abs(alts[f] - value) > 0.001) bump(cur.fires, `${f}|${when}|${side}|${s}`);
  void state;
}
function install() {
  G.__LF = {
    on: true,
    rate(stack: string, side: Side, when: string) {
      const site = siteOf(stack);
      siteStack.push(site);
      if (cur) bump(cur.sites, `${site}|${side}|${when}`);
    },
    rateEnd() {
      siteStack.pop();
    },
    miss(k: string, state: GameState, side: Side, deck: any[], played: number[]) {
      if (deck.length) altByKey.set(k, averages(deck, played, moneyOf(state, side)));
    },
    answer(k: string, state: GameState, side: Side, when: string, value: number) {
      note(state, side, when, value, altByKey.get(k));
    },
    root(state: GameState, side: Side, deck: any[], played: number[]) {
      lastRoot = averages(deck, played, moneyOf(state, side));
    },
    rootAnswer(state: GameState, side: Side, when: string, value: number) {
      note(state, side, when, value, lastRoot);
      lastRoot = undefined;
    },
  };
}

// ------------------------------------------------------------------------------------------------ deals
type Deal = { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
function dealStateOf(d: Deal): GameState {
  const c = DECK_POOL.find(x => x.side === 'corp' && x.name === d.corpDeck);
  const r = DECK_POOL.find(x => x.side === 'runner' && x.name === d.runnerDeck);
  if (!c || !r) throw new Error(`deal ${d.seed}: deck not found (${d.corpDeck} v ${d.runnerDeck})`);
  return T.core.createInitialGameState(T.decks.deckGameSetup(d.seed, c, r));
}
/** The decision GameRunner.step asks an agent for at `s`, or null (as core-lockstep.ts). */
function decisionOf(s: GameState): { side: Side; kind: string } | null {
  const side = CORE.actingSide(s);
  if (!side || s.winner) return null;
  const w = s.priority;
  if (s.pendingPrompts.length === 0 && w && w.holder !== s.activePlayer) {
    const want = CORE.wantsStop(s, side, w);
    if (want && side === 'corp' && (w.step === 'approach_ice' || w.step === 'approach_server')) return { side, kind: 'rez' };
    if (want && side === 'runner' && w.step === 'corp_action') return { side, kind: 'off' };
    return null;
  }
  return { side, kind: CORE.activePrompt(s) ? 'prompt' : s.activeRun ? 'run' : 'main' };
}

function deal(pool: string, d: Deal) {
  T.clear();
  altByKey.clear();
  const g = new T.GameRunner(dealStateOf(d), { corp: T.createAgent('corp', 'normal'), runner: T.createAgent('runner', 'normal') });
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  // turn blocks: one per player turn, in order, with the peak credits of the side whose turn it is
  const blocks: { side: Side; peak: number }[] = [];
  let blockId = '';
  const decs: Record<string, unknown>[] = [];
  const t0 = performance.now();
  for (let i = 0; i < MAX_STEPS; i++) {
    const s: GameState = g.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    const id = `${s.turnNumber}:${s.activePlayer}`;
    if (id !== blockId) {
      blockId = id;
      blocks.push({ side: s.activePlayer as Side, peak: credits(s, s.activePlayer as Side) });
    }
    const dec = decisionOf(s);
    cur = dec ? { ...dec, sites: new Map(), fires: new Map(), reads: new Map() } : null;
    const more: boolean = g.step();
    const after: GameState = g.state;
    const b = blocks[blocks.length - 1];
    if (`${after.turnNumber}:${after.activePlayer}` === blockId) b.peak = Math.max(b.peak, credits(after, b.side));
    if (dec && cur) {
      // the decider's own deck on the decision's board, against each form (cards the form flips)
      const side = dec.side;
      const deck = side === 'corp' ? ORACLE.corpDrawPool(s) : s.runner.stack;
      const today = credits(s, side);
      const m = moneyOf(s, side);
      const costs: number[] = deck.map(costOf);
      const flips = Object.fromEntries(FORMS.map(f => [f, costs.filter(c => c > today && c <= m[f])]));
      decs.push({
        side,
        dk: dec.kind,
        step: i,
        T: s.turnNumber,
        block: blocks.length - 1,
        credits: today,
        money: m,
        flips,
        sites: Object.fromEntries(cur.sites),
        fires: Object.fromEntries(cur.fires),
        reads: Object.fromEntries(cur.reads),
      });
    }
    cur = null;
    if (!more) break;
  }
  const B: GameState = g.state;
  const recordSame = (B.winner ?? null) === d.winner && key(cr) === key(d.cr) && key(sc) === key(d.sc);
  // the peak credits each decision's side held during its next own turn (null when the game ended before it ended)
  for (const x of decs) {
    const next = blocks.findIndex((bl, i) => i > (x.block as number) && bl.side === x.side);
    x.peak = next < 0 || next === blocks.length - 1 ? null : blocks[next].peak;
    delete x.block;
    out({ kind: 'dec', pool, seed: d.seed, ...x });
  }
  out({ kind: 'deal', pool, seed: d.seed, recordSame, winner: B.winner ?? null, T: B.turnNumber, decisions: decs.length, ms: Math.round(performance.now() - t0) });
}

async function main() {
  const dir = makeTree();
  T = await loadTree('hooked', dir);
  NTM = await import(/* @vite-ignore */ join(dir, 'src', 'ai/nextTurnMoney.ts'));
  CORE = T.core;
  ORACLE = await import(/* @vite-ignore */ join(dir, 'src', 'ai/oracle.ts'));
  install();
  const batch: Deal[] = JSON.parse(readFileSync('scripts/runner-rework/last-credits-fix-deals-45617829233.json', 'utf8'));
  const nrdb: Deal[] = JSON.parse(readFileSync('scripts/runner-rework/last-credits-fix-deals-45621322301.json', 'utf8'));
  const sources: { pool: string; d: Deal }[] = [];
  for (const pool of POOLS) for (const d of pool === 'batch' ? batch : nrdb) if (!DEALS.length || DEALS.includes(String(d.seed))) sources.push({ pool, d });
  for (let i = shard; i < sources.length; i += shards) {
    try {
      deal(sources[i].pool, sources[i].d);
    } catch (e) {
      out({ kind: 'error', pool: sources[i].pool, seed: sources[i].d.seed, error: (e as Error).stack?.slice(0, 400) });
    }
  }
  if (process.env.OUT_DIR) writeFileSync(join(process.env.OUT_DIR, `done-${shard}.txt`), 'ok');
}
main();
