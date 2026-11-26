/**
 * B3 commit 2a step 0 (R-93 folded into B3; ruling 19.2 in runner-rework/b3/c2-mutual-favor-question.md), scripts only:
 * every decision on g1 and NRDB g1 whose outcome hand term (prompts.ts scoreOutcome) would move if a card the active
 * prompt showed its side by face, and moved to that side's hand, counted as a known card rather than an unknown draw.
 *
 * Trees (copies of this checkout's src; no src change):
 *   source  plays the deals; a passive hook in scoreOutcome reports each call where the fix would move the hand term
 *           (a card drawn from the deck into the hand that the active prompt of `before` showed `side` by face; the
 *           shown cards read from the engine's rule, core/view.ts viewFor, the prompt's cards with their face); it
 *           changes no line of logic
 *   today   the same src with the same passive hook (a fresh agent asks the decision again: the like-for-like control)
 *   fix     the scratch fix: those cards are not counted as drawn (they stay in the hand term, as known cards)
 * At every top-level decision where the hook fired, a fresh agent of the deciding side on today and on fix answers a
 * copy of the board (the Runner with the source Runner's memory): the picks, the reaches by the side whose hand moved,
 * and the decision kind (prompt kind and source card:step, or main/run). One line per such decision.
 *
 *   SHARD=0/64 npx vite-node scripts/runner-rework/b3/c2a-step0.ts -- POOL=batch,nrdb
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../../src/core';
import { ALL_DECKS } from '../../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../../nrdb-test-decks';
import { Tree, loadTree } from '../facts-trees';
import { Patch, applyPatches } from '../core-hooks';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/b3-c2a', String(shard));
const POOLS = (process.env.POOL ?? 'batch,nrdb').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const LIMIT = Number(process.env.LIMIT ?? Infinity);
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 6000);
const RECORDS = (process.env.RECORDS ?? '45716865309,45721175528').split(',');
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const key = (a: unknown) => (a === undefined ? 'undefined' : JSON.stringify(a));
const G = globalThis as any;
const NAMES = ['source', 'today', 'fix'] as const;
type Name = (typeof NAMES)[number];

const DRAWN = `  const drawn = (c: CardInstance) => !hand(before, side).some(b => b.instanceId === c.instanceId) && fromDeck(before, side, c);\n`;
const PASSIVE: Patch[] = [
  [
    'ai/prompts.ts',
    DRAWN,
    `${DRAWN}  {\n    const __g = globalThis as any;\n    if (__g.__c2aShown && __g.__c2aMove) {\n      const __moved = hand(after, side).filter(c => drawn(c) && __g.__c2aShown(before, side).has(c.instanceId));\n      if (__moved.length) __g.__c2aMove(side, __moved.map((c: CardInstance) => c.cardCode));\n    }\n  }\n`,
  ],
];
const FIX: Patch[] = [
  [
    'ai/prompts.ts',
    DRAWN,
    `  const __shown = (globalThis as any).__c2aShown;\n  const drawn = (c: CardInstance) => !hand(before, side).some(b => b.instanceId === c.instanceId) && fromDeck(before, side, c) && !(__shown && __shown(before, side).has(c.instanceId));\n`,
  ],
];

function makeTrees(): Record<Name, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs = {} as Record<Name, string>;
  const read = (p: string) => readFileSync(p, 'utf8');
  const write = (p: string, t: string) => writeFileSync(p, t);
  for (const name of NAMES) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    cpSync('src', join(dir, 'src'), { recursive: true });
    applyPatches(dir, name === 'fix' ? FIX : PASSIVE, `tree ${name}`, read, write);
    dirs[name] = dir;
  }
  return dirs;
}
let T: Record<Name, Tree>;

/** The engine's rule for what `side`'s active prompt shows face up (core/view.ts viewFor, the prompt's cards), per tree. */
function shownFor(t: Tree) {
  const memo = new WeakMap<GameState, Map<string, Set<string>>>();
  return (s: GameState, side: 'corp' | 'runner'): Set<string> => {
    let m = memo.get(s);
    if (!m) memo.set(s, (m = new Map()));
    const have = m.get(side);
    if (have) return have;
    const outIds = new Set<string>();
    const p: any = t.core.activePrompt(s);
    if (p && p.side === side) {
      const { view, ids } = t.core.viewFor(s, side, t.core.newViewIds(), s.id);
      const mine = view.pendingPrompts.find((x: any) => x.id === p.id);
      for (const c of mine?.cards ?? []) if (c.cardCode !== undefined && ids.real[c.instanceId]) outIds.add(ids.real[c.instanceId]);
    }
    m.set(side, outIds);
    return outIds;
  };
}

type Deal = { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
function dealStateOf(t: Tree, d: Deal): GameState {
  const c = DECK_POOL.find(x => x.side === 'corp' && x.name === d.corpDeck);
  const r = DECK_POOL.find(x => x.side === 'runner' && x.name === d.runnerDeck);
  if (!c || !r) throw new Error(`deal ${d.seed}: deck not found`);
  return t.core.createInitialGameState(t.decks.deckGameSetup(d.seed, c, r));
}
const title = (t: Tree, code: string) => t.core.getCardDefinition(code)?.title ?? code;
const pickOf = (a: any) =>
  a?.type === 'RESOLVE_PROMPT' ? JSON.stringify(a.choice) : a ? `${a.type}${a.cardInstanceId ? ':' + a.cardInstanceId : ''}${a.hostInstanceId ? '@' + a.hostInstanceId : ''}${a.targetServerId ? '>' + a.targetServerId : ''}` : null;

/** The card titles an action names (its card, the cards a prompt answer picks), read on the source tree. */
const namesOf = (t: Tree, s: GameState, a: any): string[] => {
  const ids: string[] = [a?.cardInstanceId, ...(a?.choice?.cardInstanceIds ?? [])].filter(Boolean);
  return ids.map(id => title(t, t.core.findCardAnywhere(s, id)?.cardCode ?? '?'));
};

/** A fresh agent of `side` on tree `n` answers a copy of `s` (the Runner with `memory`), with the shown rule set for that tree. */
function ask(n: Name, s: GameState, side: 'corp' | 'runner', memory: Map<string, string>): { pick: string | null; action?: any; moves: Record<string, number> } {
  const t = T[n];
  t.clear();
  const agent: any = t.createAgent(side, 'normal');
  if (side === 'runner') agent.memory = new Map(memory);
  const moves: Record<string, number> = {};
  G.__c2aShown = shownFor(t);
  G.__c2aMove = (who: string) => (moves[who] = (moves[who] ?? 0) + 1);
  try {
    const action = agent.chooseAction(structuredClone(s));
    return { pick: pickOf(action), action, moves };
  } catch (e) {
    return { pick: `threw ${(e as Error).message.slice(0, 80)}`, moves };
  } finally {
    G.__c2aShown = G.__c2aMove = undefined;
  }
}

function deal(pool: string, d: Deal) {
  const S = T.source;
  S.clear();
  const ag = { corp: S.createAgent('corp', 'normal'), runner: S.createAgent('runner', 'normal') };
  const g = new S.GameRunner(dealStateOf(S, d), ag);
  const shown = shownFor(S);
  let decisions = 0;
  const kinds: Record<string, number> = {};
  for (let i = 0; i < MAX_STEPS && !g.state.winner; i++) {
    const s: GameState = g.state;
    const side = S.core.actingSide(s) as 'corp' | 'runner' | null;
    const p: any = S.core.activePrompt(s);
    // HIDDEN-READ: the source Runner's memory, read (never asked); every asked agent gets a copy
    const memory = new Map((ag.runner as any).memory ?? []) as Map<string, string>;
    const moves: Record<string, number> = {};
    const cards = new Set<string>();
    G.__c2aShown = shown;
    G.__c2aMove = (who: string, codes: string[]) => {
      moves[who] = (moves[who] ?? 0) + 1;
      codes.forEach(c => cards.add(c));
    };
    let more: boolean;
    try {
      more = g.step();
    } finally {
      G.__c2aShown = G.__c2aMove = undefined;
    }
    if (!more) break;
    if (!side || !Object.keys(moves).length) continue;
    decisions++;
    const kind = p ? `${p.kind} | ${p.source ? `${title(S, p.source.cardCode)}:${p.source.step}` : '-'}` : s.activeRun ? 'run' : 'main';
    const label = `${side} | ${kind}`;
    kinds[label] = (kinds[label] ?? 0) + 1;
    const today = ask('today', s, side, memory);
    const fix = ask('fix', s, side, memory);
    out({
      kind: 'd',
      pool,
      seed: d.seed,
      T: s.turnNumber,
      side,
      label: kind,
      inRun: !!s.activeRun,
      moves,
      cards: [...cards].map(c => title(S, c)),
      played: pickOf(g.last),
      today: today.pick,
      fix: fix.pick,
      differs: today.pick !== fix.pick,
      names: { played: namesOf(S, s, g.last), today: namesOf(S, s, today.action), fix: namesOf(S, s, fix.action) },
      prompt: p ? { kind: p.kind, candidates: p.candidateIds?.map((id: string) => title(S, S.core.findCardAnywhere(s, id)?.cardCode ?? '?')), min: p.min, max: p.max } : null,
    });
  }
  out({ kind: 'g', pool, seed: d.seed, decisions, kinds, winner: g.state.winner ?? null, recWinner: d.winner });
}

async function main() {
  const dirs = makeTrees();
  T = {} as Record<Name, Tree>;
  for (const n of NAMES) T[n] = await loadTree(n, dirs[n]);
  const batch: Deal[] = JSON.parse(readFileSync(`scripts/runner-rework/b3/deals-${RECORDS[0]}.json`, 'utf8'));
  const nrdb: Deal[] = JSON.parse(readFileSync(`scripts/runner-rework/b3/deals-${RECORDS[1]}.json`, 'utf8'));
  const sources: { pool: string; d: Deal }[] = [];
  for (const pool of POOLS) (pool === 'batch' ? batch : nrdb).filter(d => !DEALS.length || DEALS.includes(String(d.seed))).slice(0, LIMIT).forEach(d => sources.push({ pool, d }));
  for (let i = shard; i < sources.length; i += shards) {
    try {
      deal(sources[i].pool, sources[i].d);
    } catch (e) {
      out({ kind: 'error', pool: sources[i].pool, seed: sources[i].d.seed, error: (e as Error).stack?.slice(0, 400) });
    }
  }
  out({ kind: 's', shard });
  if (process.env.OUT_DIR) writeFileSync(join(process.env.OUT_DIR, `done-${shard}.txt`), 'ok');
}
main();
void key;
