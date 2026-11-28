/**
 * F117 / R-93 step 0 (brief netrunner-ai/f117-deck-arrivals/design-brief.md rev 2, section "Step 0"; ruling-redteam.md).
 * Plays the step 0 games (the 221 batch deals and the 110 NRDB deals, as c2a's step 0 and core-lockstep.ts) in one or
 * more trees, each loaded as its own module graph from an absolute path (scripts/corp-owed lesson: resolve() the dirs).
 *
 * MODE=audit (item 14 and bar 9's audit leg): memoAudit (valueModel.ts, test-only) is on in every tree, and each deal
 * reports per tree the audited memo hits by entry name: checked, mismatches, hits served from another frame and from a
 * frame that knew the hands apart (otherKnown), and their mismatches. Trees (TREES=, default nokey,key):
 *   key    this checkout's src (F117 commit 1 or later)
 *   nokey  this checkout's src with the two iceProtects key strings put back as on beta 701f9ee (the audit kept):
 *          beta's own play with the audit added
 *
 * MODE=step0 also counts bar 5 (`second`: the chain's simulated second answer against the real one, every mismatch
 * listed), item 11 (`paths`: the Runner's honest prompt path by source, chained or not) and item 13 (`keeps`: prompts
 * whose staying cards' keep moved with the seen arrival, by source, with the largest move), on the branch tree.
 *
 * MODE=step0 (items 1-5, 7, 10, 12 and the time of item 5 / bar 11, as counts): the branch (this checkout's src) plays
 * each deal; at every top-level decision a fresh agent of the base tree (BASE, default F117 commit 3 b4c26a9: today's
 * prompts, the step before the design) and a fresh agent of the branch are asked on copies of the state, in a turn that
 * rotates, each timed by side and kind (main, prompt, off, rez). Per prompt: its source, the base and branch answers,
 * the cards each answer names with their zone, whether any answer brings a card into the side's hand (an arrival is
 * possible) or takes one out of it (a departure; the first step of each answer only), the hand against its limit, and the branch's chain counts made while it answered (prompts.ts chainStats:
 * widened, capped, aside, used, rootRunner). Main decisions: whether the pick differs.
 *   ARGS="MODE=step0 POOL=batch DEALS=1001 MAX_STEPS=300" npx vite-node scripts/f117/count.ts
 *
 *   ARGS="POOL=batch DEALS=1001 MAX_STEPS=200" npx vite-node scripts/f117/count.ts
 *   SHARD=0/64 npx vite-node scripts/f117/count.ts -- POOL=batch,nrdb MODE=audit
 *   SHARD=0/64 npx vite-node scripts/f117/count.ts -- POOL=batch,nrdb,human MODE=audit TREES=key (speed pass bar 2)
 *   SHARD=0/64 npx vite-node scripts/f117/count.ts -- POOL=batch,nrdb,human MODE=audit TREES=key,noG ALL_AUDITS=1 BOARD_AUDIT=1
 *     (speed pass lever G's bar 2: every named audit with G on and off, every served board built again and compared)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { loadTree, type Tree } from '../runner-rework/facts-trees';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/f117-count', String(shard));
const POOLS = (process.env.POOL ?? 'batch,nrdb').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 4000);
const MAX_MS = Number(process.env.MAX_MS ?? Infinity);
const MODE = process.env.MODE ?? 'audit';
const TREES = (process.env.TREES ?? (MODE === 'step0' ? 'base,branch' : 'nokey,key')).split(',');
const BASE = process.env.BASE ?? 'b4c26a9a0d6ea81f0387e19c4a7bb39228e832e0';
const started = Date.now();
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));

type Patch = [file: string, at: string, to: string];
/** The two iceProtects key strings as on beta 701f9ee (F117 commit 1 adds `:${unseenKey(state)}` to each). */
const NOKEY: Patch[] = [
  ['ai/iceValues.ts', 'memo(state, `iceProtects:hand:${ice.cardCode}:${unseenKey(state)}`', 'memo(state, `iceProtects:hand:${ice.cardCode}`'],
  ['ai/iceValues.ts', "memo(state, `iceProtects:${server.id}:${extra?.cardCode ?? ''}:${unseenKey(state)}`", "memo(state, `iceProtects:${server.id}:${extra?.cardCode ?? ''}`"],
];
/**
 * Bar 5 (the second answer): the branch tree records, for the top decision's own board only (`__f117second.root`), the
 * answer followChain simulated at the first chained step after each first answer (the decision's own prompt, by its source
 * and step: the agent decides on its own view, a copy; the first record per answer). The real second prompt's answer is
 * compared with the one recorded for the answer the game took (step0Deal, `second`).
 */
const SECOND: Patch = [
  'ai/prompts.ts',
  `    const answer = withKnownCards(side, seen, () => answerPrompt(state, side, memory, synergy, inner));\n`,
  `    const answer = withKnownCards(side, seen, () => answerPrompt(state, side, memory, synergy, inner));
    {
      const h = (globalThis as any).__f117second;
      if (h && at.depth === 0 && depth === 0 && \`\${prompt.source.instanceId}:\${prompt.source.step ?? ''}\` === h.root && !h.rec.has(JSON.stringify(action))) h.rec.set(JSON.stringify(action), { src: \`\${next.source.instanceId}:\${next.source.step ?? ''}\`, answer: JSON.stringify(answer) });
    }
`,
];
/**
 * Item 11 ('again' on chained prompts): the Runner's honest prompt answer's path, pushed in call order (the top
 * decision's own call returns last). Item 13 (the staying cards' keep moving with A): at every arrivalTerms call with a
 * seen arrival, 0.5 x (the staying cards' keep on the board after, A in the hand, less on the board without A): what
 * D2's "after without A" removes.
 */
const PATHS: Patch = [
  'ai/runner/prompt.ts',
  'export function honestPromptAnswer(state: GameState, ports: PromptViewPorts): { action: GameAction; path: PromptPath } {',
  `export function honestPromptAnswer(state: GameState, ports: PromptViewPorts): { action: GameAction; path: PromptPath } {
  const r = __honestPromptAnswer(state, ports);
  (globalThis as any).__f117path?.push(r.path);
  return r;
}
function __honestPromptAnswer(state: GameState, ports: PromptViewPorts): { action: GameAction; path: PromptPath } {`,
];
const KEEP: Patch = [
  'ai/prompts.ts',
  '  const keepBoard = late.length ? toDeck(without(seen), side, late) : seen.length ? without(seen) : after;\n',
  `  const keepBoard = late.length ? toDeck(without(seen), side, late) : seen.length ? without(seen) : after;
  if (seen.length && (globalThis as any).__f117keep) {
    const stay = (b: GameState) => sumKeep(b, hand(b, side).filter(c => had.has(c.instanceId)), synergy);
    (globalThis as any).__f117keep.push(0.5 * (stay(after) - stay(without(seen))));
  }
`,
];
/**
 * Speed pass lever G, bar 2 (ruling-rev0.md "Lever G red team, ruled" 3 and step 0b's bar 2): `noG` is this src with G's
 * boards never served (built every time, as before G); in `key`, BOARD_AUDIT=1 builds every served board again and
 * compares the two as JSON (the whole-state audit on every hit, full rate).
 */
const NO_G: Patch = ['ai/boards.ts', '  if (hit) return hit;\n', ''];
const BOARD_AUDIT: Patch = [
  'ai/boards.ts',
  '  if (hit) return hit;\n',
  `  if (hit) {
    const a = ((globalThis as any).__boardAudit ??= { checked: 0, bad: 0, first: null });
    a.checked++;
    if (JSON.stringify(executeAction(state, structuredClone(action))) !== JSON.stringify(hit)) {
      a.bad++;
      a.first ??= key.slice(0, 200);
    }
    return hit;
  }
`,
];
const TREE_PATCHES: Record<string, Patch[]> = { key: process.env.BOARD_AUDIT ? [BOARD_AUDIT] : [], noG: [NO_G], nokey: NOKEY, branch: MODE === 'step0' ? [SECOND, PATHS, KEEP] : [], base: [] };

/** ALL_AUDITS=1 (G's bar 2): the named audits beside memoAudit (threats, draw with deckAverage, click, rezMoney), on and reported with it. */
const NAMED = ['threatsAudit', 'drawAudit', 'clickAudit', 'rezMoneyAudit'] as const;
function namedOf(t: Loaded): Record<string, any> {
  return { threatsAudit: t.effectValues.threatsAudit, drawAudit: t.handValues.drawAudit, clickAudit: t.handValues.clickAudit, rezMoneyAudit: t.rezMoney.rezMoneyAudit };
}
function auditsOn(t: Loaded, on: boolean) {
  t.vm.memoAudit.on = on;
  if (process.env.ALL_AUDITS) for (const n of NAMED) namedOf(t)[n].on = on;
}
function auditsReset(t: Loaded) {
  t.vm.memoAudit.reset();
  (globalThis as any).__boardAudit = { checked: 0, bad: 0, first: null };
  if (process.env.ALL_AUDITS)
    for (const a of Object.values(namedOf(t))) {
      a.checked = a.mismatches = 0;
      if (a.errors) a.errors.length = 0;
    }
}
function auditsRead(t: Loaded) {
  const named = process.env.ALL_AUDITS ? Object.fromEntries(NAMED.map(n => [n, { checked: namedOf(t)[n].checked, mismatches: namedOf(t)[n].mismatches }])) : undefined;
  return { named, boards: (globalThis as any).__boardAudit };
}

/**
 * SPLIT=1 (the time levers' ruling: split Runner main by what it calls): timers on prompts.ts in every tree, outermost
 * call only (a nested call is inside its caller's time), read per decision by side and kind: answerPrompt (every prompt
 * answered, in the decision's own prompt and in any look-ahead), scoreAnswer, arrivalTerms, and the chanceBoards average.
 * Applied where the line is found (a tree without the line has no such timer); a decision's own total is in `ms`.
 */
const SPLIT_TIMER = `const __split = (name: string, f: (...a: any[]) => any) => (...a: any[]) => { const g = (globalThis as any).__f117split; if (!g) return f(...a); const t = performance.now(); g.depth[name] = (g.depth[name] ?? 0) + 1; try { return f(...a); } finally { if (--g.depth[name] === 0) g.ms[name] = (g.ms[name] ?? 0) + performance.now() - t; } };
`;
const SPLIT_PATCHES: Patch[] = [
  ['ai/prompts.ts', `import { SHRED_STEP } from '../core/engine/runEnd';\n`, `import { SHRED_STEP } from '../core/engine/runEnd';\n${SPLIT_TIMER}`],
  ['ai/prompts.ts', 'export function answerPrompt(', `export const answerPrompt = __split('answerPrompt', __answerPrompt);
function __answerPrompt(`],
  ['ai/prompts.ts', 'export function scoreAnswer(', `export const scoreAnswer = __split('scoreAnswer', __scoreAnswer);
function __scoreAnswer(`],
  ['ai/prompts.ts', 'function arrivalTerms(', `const arrivalTerms = __split('arrivalTerms', __arrivalTerms);
function __arrivalTerms(`],
  [
    'ai/prompts.ts',
    'const score = scoreOutcome(state, b, side, memory, synergy, frame);',
    `const score = boards.length > 1 ? __split('chanceAverage', scoreOutcome)(state, b, side, memory, synergy, frame) : scoreOutcome(state, b, side, memory, synergy, frame);`,
  ],
];

/** BASE's commit in this clone (a shallow CI checkout fetches it; the shards wait on git's shallow lock in turn). */
function fetchBase() {
  for (let tries = 0; ; tries++) {
    try {
      execSync(`git cat-file -e ${BASE}^{commit}`, { stdio: 'ignore' });
      return;
    } catch {
      try {
        execSync(`git fetch --depth 1 origin ${BASE}`, { stdio: 'ignore' });
      } catch (e) {
        if (tries >= 8) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000 + 700 * (shard % 4));
      }
    }
  }
}

function makeTree(name: string): string {
  const dir = join(root, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  if (name === 'base') {
    fetchBase();
    execSync(`git archive ${BASE} src | tar -x -C ${dir}`);
  } else cpSync('src', join(dir, 'src'), { recursive: true });
  const patches = TREE_PATCHES[name];
  if (!patches) throw new Error(`no tree ${name} (${Object.keys(TREE_PATCHES).join(', ')})`);
  if (process.env.SPLIT)
    for (const [f, at, to] of SPLIT_PATCHES) {
      const path = join(dir, 'src', f);
      const text = readFileSync(path, 'utf8');
      if (text.split(at).length === 2) writeFileSync(path, text.replace(at, () => to));
      else if (to.includes('const __split')) throw new Error(`tree ${name}: the SPLIT timer's line is not in ${f}`);
    }
  for (const [f, at, to] of patches) {
    const path = join(dir, 'src', f);
    const text = readFileSync(path, 'utf8');
    if (text.split(at).length !== 2) throw new Error(`tree ${name}: a patch does not match once in ${f}: ${at.slice(0, 80)}`);
    writeFileSync(path, text.replace(at, () => to));
  }
  return dir;
}

type Deal = { seed: number; corpDeck: string; runnerDeck: string };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
function dealState(t: Tree, d: Deal): GameState {
  const c = DECK_POOL.find(x => x.side === 'corp' && x.name === d.corpDeck);
  const r = DECK_POOL.find(x => x.side === 'runner' && x.name === d.runnerDeck);
  if (!c || !r) throw new Error(`deal ${d.seed}: deck not found (${d.corpDeck} v ${d.runnerDeck})`);
  return t.core.createInitialGameState(t.decks.deckGameSetup(d.seed, c, r));
}

type Loaded = Tree & { vm: any; prompts: any; po: any; rezMoney: any };

function auditDeal(pool: string, d: Deal, trees: Record<string, Loaded>) {
  for (const [name, t] of Object.entries(trees)) {
    t.clear();
    auditsReset(t);
    auditsOn(t, true);
    const g = new t.GameRunner(dealState(t, d), { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') });
    const t0 = performance.now();
    let steps = 0;
    let error: string | null = null;
    try {
      while (steps < MAX_STEPS && g.step()) steps++;
    } catch (e) {
      error = (e as Error).message.slice(0, 200);
    } finally {
      auditsOn(t, false);
    }
    const a = t.vm.memoAudit;
    out({
      ...auditsRead(t),
      kind: 'deal',
      pool,
      seed: d.seed,
      tree: name,
      steps,
      T: g.state.turnNumber,
      winner: g.state.winner ?? null,
      ms: Math.round(performance.now() - t0),
      error,
      audit: { checked: a.checked, mismatches: a.mismatches, otherFrame: a.otherFrame, otherFrameMismatches: a.otherFrameMismatches, otherKnown: a.otherKnown, otherKnownMismatches: a.otherKnownMismatches },
      byName: Object.fromEntries(a.byName),
      errors: a.errors.slice(0, 20),
    });
  }
}

/**
 * POOL=human (speed pass bar 2): each tests/fixtures/human-games file's recorded moves replayed; at every decision each
 * tree's own persistent agents are asked on a copy (as core-lockstep.ts's human files), with memoAudit on for the asks.
 */
function auditHuman(file: string, trees: Record<string, Loaded>) {
  const r = JSON.parse(readFileSync(file, 'utf8'));
  if (!r.moves?.length) return;
  for (const [name, t] of Object.entries(trees)) {
    t.clear();
    auditsReset(t);
    const agents = { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') };
    let s: GameState;
    if (r.startsAt === 'state') s = structuredClone(r.state);
    else {
      s = t.core.createInitialGameState(t.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
      if (r.startStops) s = { ...s, stops: r.startStops };
    }
    const t0 = performance.now();
    let decisions = 0;
    let stopped: string | null = null;
    const errors: string[] = [];
    for (const [j, move] of (r.moves as any[]).entries()) {
      const ai = { ...s, stops: { corp: 'ai', runner: 'ai' } } as GameState;
      if (decisionOf(t.core, ai)) {
        decisions++;
        auditsOn(t, true);
        try {
          new t.GameRunner(structuredClone(ai), agents).step();
        } catch (e) {
          if (errors.length < 5) errors.push(`moves[${j}]: ${(e as Error).message.slice(0, 120)}`);
        } finally {
          auditsOn(t, false);
        }
      }
      try {
        s = t.core.executeAction(s, move);
      } catch (e) {
        stopped = `moves[${j}]: ${(e as Error).message.slice(0, 100)}`;
        break;
      }
    }
    const a = t.vm.memoAudit;
    out({
      ...auditsRead(t),
      kind: 'deal',
      pool: 'human',
      seed: file.split('/').pop(),
      tree: name,
      steps: decisions,
      stopped,
      ms: Math.round(performance.now() - t0),
      error: errors[0] ?? null,
      audit: { checked: a.checked, mismatches: a.mismatches, otherFrame: a.otherFrame, otherFrameMismatches: a.otherFrameMismatches, otherKnown: a.otherKnown, otherKnownMismatches: a.otherKnownMismatches },
      byName: Object.fromEntries(a.byName),
      errors: a.errors.slice(0, 20),
    });
  }
}


// ------------------------------------------------------------------------------------------------ step 0
type Side = 'corp' | 'runner';
function decisionOf(core: any, s: GameState): { side: Side; kind: string } | null {
  const side = core.actingSide(s);
  if (!side || s.winner) return null;
  const w = s.priority;
  if (s.pendingPrompts.length === 0 && w && w.holder !== s.activePlayer) {
    const want = core.wantsStop(s, side, w);
    if (want && side === 'corp' && (w.step === 'approach_ice' || w.step === 'approach_server')) return { side, kind: 'rez' };
    if (want && side === 'runner' && w.step === 'corp_action') return { side, kind: 'off' };
    return null;
  }
  return { side, kind: core.activePrompt(s) ? 'prompt' : 'main' };
}
/** Where card `id` is on `s` (the arrival's origin zone, item 1). */
function zoneOf(s: GameState, id: string): string {
  const has = (cs: { instanceId: string; hosted?: any[] }[] | undefined): boolean => Array.isArray(cs) && cs.some(c => c.instanceId === id || has(c.hosted));
  if (s.corp.rd.some(c => c.instanceId === id)) return 'rd';
  if (s.corp.hq.some(c => c.instanceId === id)) return 'hq';
  if (has(s.corp.archives.faceUp) || has(s.corp.archives.faceDown)) return 'archives';
  if (s.runner.stack.some(c => c.instanceId === id)) return 'stack';
  if (s.runner.grip.some(c => c.instanceId === id)) return 'grip';
  if (s.runner.heap.some(c => c.instanceId === id)) return 'heap';
  if (has(s.setAside as any)) return 'aside';
  for (const sv of Object.values(s.corp.servers)) {
    if (sv.ice.some(c => c.instanceId === id) || sv.root.some(c => c.instanceId === id)) return 'table';
    if (has(sv.ice as any) || has(sv.root as any)) return 'host';
  }
  if (has(Object.values(s.runner.rig).flat() as any)) return 'rig';
  return 'other';
}
const promptKey = (p: any) => (p && 'source' in p ? `${p.source.instanceId}:${p.source.step ?? ''}` : '-');
const handOf = (s: GameState, side: Side) => (side === 'corp' ? s.corp.hq : s.runner.grip);
/** The ids an answer names (its choice's card ids and option ids, and an install's card). */
function named(a: any): string[] {
  const c = a?.choice ?? {};
  return [...(c.cardInstanceIds ?? []), ...(typeof c.cardInstanceId === 'string' ? [c.cardInstanceId] : []), ...(typeof a?.cardInstanceId === 'string' ? [a.cardInstanceId] : [])];
}
const copyStats = (cs: any) => ({ widened: new Map(cs.widened), capped: new Map(cs.capped), aside: new Map(cs.aside), used: cs.used.length, rootRunner: cs.rootRunner });
function statsDelta(cs: any, was: ReturnType<typeof copyStats>) {
  const d = (m: Map<string, number>, w: Map<string, number>) => Object.fromEntries([...m].filter(([k, v]) => v !== (w.get(k) ?? 0)).map(([k, v]) => [k, v - (w.get(k) ?? 0)]));
  return { widened: d(cs.widened, was.widened), capped: d(cs.capped, was.capped), aside: d(cs.aside, was.aside), used: cs.used.slice(was.used), rootRunner: cs.rootRunner - was.rootRunner };
}

function step0Deal(pool: string, d: Deal, trees: Record<string, Loaded>) {
  const names = Object.keys(trees);
  const B = trees.branch;
  if (!B || !trees.base) throw new Error('MODE=step0 needs TREES=base,branch');
  for (const t of Object.values(trees)) t.clear();
  const g = new B.GameRunner(dealState(B, d), { corp: B.createAgent('corp', 'normal'), runner: B.createAgent('runner', 'normal') });
  const time: Record<string, Record<string, { ms: number; n: number }>> = Object.fromEntries(names.map(n => [n, {}]));
  const splits: Record<string, Record<string, Record<string, number>>> = Object.fromEntries(names.map(n => [n, {}]));
  const prompts: Record<string, unknown>[] = [];
  const mains = { corp: { n: 0, differ: 0 }, runner: { n: 0, differ: 0 } };
  const errors: string[] = [];
  const chains: Record<string, any> = {};
  // Bar 5: the simulated second answer for the answer the game took, and the counts (by source; every mismatch listed)
  let expect: { side: string; src: string; answer: string } | null = null;
  // Item 11: the Runner's prompt paths by source:step, chained (the prompt before was the same source's, same side) or not
  const paths: Record<string, Record<string, number>> = {};
  let lastPrompt = '';
  // Item 13: prompts whose staying cards' keep moved with A (any scored answer), by source, with the largest move
  const keeps: Record<string, { n: number; moved: number; max: number }> = {};
  const second = { asked: 0, match: 0, mismatch: [] as Record<string, unknown>[], noRecord: 0 };
  // The first decision the two trees answer differently (on the branch's game), for tracing a deal
  let firstDiffer: Record<string, unknown> | null = null;
  let steps = 0;
  for (let i = 0; i < MAX_STEPS; i++) {
    const s: GameState = g.state;
    const dec = decisionOf(B.core, s);
    let recorded: Map<string, { src: string; answer: string }> | null = null;
    if (dec) {
      const answers: Record<string, any> = {};
      let stats: ReturnType<typeof statsDelta> | null = null;
      const order = names.map((_, k) => names[(k + i) % names.length]);
      const took: Record<string, number> = {};
      for (const n of order) {
        const t = trees[n];
        const copy = structuredClone(s);
        const agent = t.createAgent(dec.side, 'normal');
        const was = n === 'branch' ? copyStats(t.prompts.chainStats) : null;
        const split = process.env.SPLIT ? ((globalThis as any).__f117split = { ms: {}, depth: {} }) : null;
        const pathList = n === 'branch' && dec.kind === 'prompt' && dec.side === 'runner' ? ((globalThis as any).__f117path = [] as string[]) : null;
        const keepList = n === 'branch' && dec.kind === 'prompt' ? ((globalThis as any).__f117keep = [] as number[]) : null;
        const rec = n === 'branch' && dec.kind === 'prompt' ? ((globalThis as any).__f117second = { root: promptKey(B.core.activePrompt(copy)), rec: new Map<string, { src: string; answer: string }>() }) : null;
        const t0 = performance.now();
        try {
          answers[n] = dec.kind === 'rez' ? (agent.chooseRez?.(copy, t.po.rezCandidates(copy, copy.priority!.step)) ?? null) : dec.kind === 'off' ? (agent.chooseOffTurn?.(copy) ?? null) : agent.chooseAction(copy);
        } catch (e) {
          answers[n] = { error: (e as Error).message.slice(0, 120) };
          if (errors.length < 5) errors.push(`${n} step ${i}: ${(e as Error).message.slice(0, 160)}`);
        }
        const k = (time[n][`${dec.side}:${dec.kind}`] ??= { ms: 0, n: 0 });
        took[n] = Math.round((performance.now() - t0) * 10) / 10;
        k.ms += took[n];
        k.n++;
        if (split) {
          (globalThis as any).__f117split = null;
          const sp = (splits[n][`${dec.side}:${dec.kind}`] ??= {});
          for (const [name, ms] of Object.entries(split.ms as Record<string, number>)) sp[name] = (sp[name] ?? 0) + ms;
        }
        if (was) stats = statsDelta(t.prompts.chainStats, was);
        if (pathList || keepList) {
          (globalThis as any).__f117path = null;
          (globalThis as any).__f117keep = null;
          const q: any = B.core.activePrompt(s);
          const key = q && 'source' in q ? `${q.source.cardCode}:${q.source.step ?? ''}` : String(q?.kind);
          if (pathList?.length) {
            const chained = q && 'source' in q && lastPrompt === `runner:${q.source.instanceId}`;
            const row = (paths[`${key}${chained ? ' (chained)' : ''}`] ??= {});
            const path = pathList[pathList.length - 1];
            row[path] = (row[path] ?? 0) + 1;
          }
          if (keepList?.length) {
            const row = (keeps[`${dec.side}:${key}`] ??= { n: 0, moved: 0, max: 0 });
            row.n++;
            const most = Math.max(...keepList.map(Math.abs));
            if (most > 1e-9) row.moved++;
            row.max = Math.max(row.max, Math.round(most * 1000) / 1000);
          }
        }
        if (rec) {
          (globalThis as any).__f117second = null;
          recorded = rec.rec;
        }
      }
      const differ = JSON.stringify(answers.base) !== JSON.stringify(answers.branch);
      if (differ && !firstDiffer) {
        const q: any = dec.kind === 'prompt' ? B.core.activePrompt(s) : null;
        firstDiffer = { step: i, T: s.turnNumber, side: dec.side, kind: dec.kind, src: q && 'source' in q ? `${q.source.cardCode}:${q.source.step ?? ''}` : q?.kind, base: JSON.stringify(answers.base).slice(0, 240), branch: JSON.stringify(answers.branch).slice(0, 240) };
      }
      if (expect && dec.kind === 'prompt') {
        const q: any = B.core.activePrompt(s);
        if (q && q.side === expect.side && 'source' in q && `${q.source.instanceId}:${q.source.step ?? ''}` === expect.src) {
          second.asked++;
          if (JSON.stringify(answers.branch) === expect.answer) second.match++;
          else if (second.mismatch.length < 40) second.mismatch.push({ step: i, T: s.turnNumber, side: dec.side, src: `${q.source.cardCode}:${q.source.step ?? ''}`, simulated: expect.answer.slice(0, 200), real: JSON.stringify(answers.branch).slice(0, 200) });
          else second.mismatch.push({ step: i });
        }
      }
      expect = null;
      {
        const q: any = dec.kind === 'prompt' ? B.core.activePrompt(s) : null;
        lastPrompt = q && 'source' in q ? `${dec.side}:${q.source.instanceId}` : '';
      }
      if (stats) {
        const agg = (chains[`${dec.side}:${dec.kind}`] ??= { widened: {}, capped: {}, aside: {}, used: { n: 0, sum: 0, max: 0, over: {} }, rootRunner: 0 });
        for (const f of ['widened', 'capped', 'aside'] as const) for (const [k, v] of Object.entries(stats[f])) agg[f][k] = (agg[f][k] ?? 0) + (v as number);
        for (const u of stats.used) {
          agg.used.n++;
          agg.used.sum += u;
          agg.used.max = Math.max(agg.used.max, u);
          for (const b of [10, 25, 50, 100, 150]) if (u > b) agg.used.over[b] = (agg.used.over[b] ?? 0) + 1;
        }
        agg.rootRunner += stats.rootRunner;
      }
      if (dec.kind === 'main') {
        mains[dec.side].n++;
        if (differ) mains[dec.side].differ++;
      } else if (dec.kind === 'prompt') {
        const p: any = B.core.activePrompt(s);
        const legal = B.core.getLegalActions(s, dec.side).filter((a: any) => a.type === 'RESOLVE_PROMPT');
        const had = new Set(handOf(s, dec.side).map(c => c.instanceId));
        let arrivalPossible = false;
        let departurePossible = false;
        let departureChance = false;
        for (const a of legal) {
          try {
            const after = B.core.executeAction(structuredClone(s), a);
            if (handOf(after, dec.side).some((c: { instanceId: string }) => !had.has(c.instanceId))) arrivalPossible = true;
            // Departures on the scored end board (the departures red team, finding 5): the same source's next prompts of
            // the same side, up to 3 steps, EVERY answer of each step (followChain answers them in the frame, which can
            // pick another answer than one asked outside it: bar 12's 9, a Mercia server it could not pay for outside);
            // a departure on any end board flags the prompt, chance where no answer on that path named the card
            let nodes = 0;
            const walk = (end: any, names: Set<string>, k: number): void => {
              nodes++;
              const now = new Set(handOf(end, dec.side).map((c: { instanceId: string }) => c.instanceId));
              const gone = [...had].filter(id => !now.has(id));
              if (gone.length) departurePossible = true;
              const discard = dec.side === 'corp' ? [...end.corp.archives.faceUp, ...end.corp.archives.faceDown, ...end.corp.rd] : [...end.runner.heap, ...end.runner.stack];
              if (gone.some(id => !names.has(id) && discard.some((c: { instanceId: string }) => c.instanceId === id))) departureChance = true;
              const q: any = B.core.activePrompt(end);
              if (k >= 3 || nodes > 200 || !p || !('source' in p) || !q || q.side !== dec.side || !('source' in q) || q.source.instanceId !== p.source.instanceId) return;
              for (const next of B.core.getLegalActions(end, dec.side).filter((x: any) => x.type === 'RESOLVE_PROMPT')) {
                try {
                  walk(B.core.executeAction(structuredClone(end), next), new Set([...names, ...named(next)]), k + 1);
                } catch {
                  // an answer the engine refuses moves no card
                }
              }
            };
            walk(after, new Set<string>(named(a)), 0);
          } catch {
            // an answer the engine refuses moves no card
          }
        }
        const zones = (a: any) => named(a).map(id => `${B.cards[B.core.findCardAnywhere(s, id)?.cardCode]?.type_code ?? '?'}@${zoneOf(s, id)}`);
        const st = stats!;
        const chained = Object.keys(st.widened).length + Object.keys(st.capped).length + Object.keys(st.aside).length + st.used.length + st.rootRunner > 0;
        if (differ || chained || arrivalPossible || departurePossible)
          prompts.push({
            step: i,
            T: s.turnNumber,
            side: dec.side,
            src: p && 'source' in p ? `${p.source.cardCode}:${p.source.step ?? ''}` : p?.kind,
            title: p && 'source' in p ? B.cards[p.source.cardCode]?.title : undefined,
            pk: p?.kind,
            n: legal.length,
            differ,
            arrivalPossible,
            departurePossible,
            departureChance,
            ms: took,
            hand: handOf(s, dec.side).length,
            limit: dec.side === 'corp' ? s.corp.handSizeLimit : s.runner.handSizeLimit,
            base: { names: named(answers.base), zones: zones(answers.base) },
            branch: { names: named(answers.branch), zones: zones(answers.branch) },
            ...(chained ? { chain: st } : {}),
          });
        promptsSeen[dec.side]++;
      }
    }
    if (!g.step()) break;
    steps++;
    if (dec?.kind === 'prompt' && recorded?.size) {
      const r = recorded.get(JSON.stringify(g.last));
      if (r) expect = { side: dec.side, src: r.src, answer: r.answer };
      else second.noRecord++;
    }
  }
  const ms = Object.fromEntries(names.map(n => [n, Object.fromEntries(Object.entries(time[n]).map(([k, v]) => [k, { ms: Math.round(v.ms), n: v.n }]))]));
  out({ kind: 'deal', pool, seed: d.seed, steps, T: g.state.turnNumber, winner: g.state.winner ?? null, mains, prompts: promptsSeen, ms, chains, rows: prompts, second, paths, keeps, firstDiffer, errors, ...(process.env.SPLIT ? { split: splits } : {}) });
  promptsSeen.corp = 0;
  promptsSeen.runner = 0;
}
const promptsSeen = { corp: 0, runner: 0 };

async function main() {
  const trees: Record<string, Loaded> = {};
  for (const name of TREES) {
    const dir = makeTree(name);
    const t = (await loadTree(name, dir)) as Loaded;
    t.vm = await import(/* @vite-ignore */ join(dir, 'src', 'ai/valueModel.ts'));
    t.prompts = await import(/* @vite-ignore */ join(dir, 'src', 'ai/prompts.ts'));
    // The chain counts are counted only with `on` (speed pass lever A; a tree from before it has no flag and counts anyway)
    if (t.prompts.chainStats) t.prompts.chainStats.on = true;
    t.po = await import(/* @vite-ignore */ join(dir, 'src', 'ai/playout.ts'));
    t.rezMoney = await import(/* @vite-ignore */ join(dir, 'src', 'ai/corp/rezMoney.ts'));
    trees[name] = t;
  }
  const recs = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Deal[];
  const pools: Record<string, string> = {
    batch: process.env.RECORDS_BATCH ?? 'scripts/f117/recs/deals-45940481387.json',
    nrdb: process.env.RECORDS_NRDB ?? 'scripts/runner-rework/facts-deals-45458221138.json',
  };
  const sources: { pool: string; d: Deal }[] = [];
  const humans: string[] = [];
  for (const pool of POOLS) {
    if (pool === 'human') {
      const dir = 'tests/fixtures/human-games';
      for (const f of readdirSync(dir).filter(x => x.endsWith('.json')).sort()) if (!DEALS.length || DEALS.includes(f)) humans.push(join(dir, f));
      continue;
    }
    if (!pools[pool]) throw new Error(`unknown pool ${pool}`);
    for (const d of recs(pools[pool])) if (!DEALS.length || DEALS.includes(String(d.seed))) sources.push({ pool, d });
  }
  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    if (Date.now() - started > MAX_MS) break;
    try {
      if (MODE === 'audit') auditDeal(src.pool, src.d, trees);
      else if (MODE === 'step0') step0Deal(src.pool, src.d, trees);
      else throw new Error(`unknown MODE ${MODE}`);
    } catch (e) {
      out({ kind: 'error', pool: src.pool, seed: src.d.seed, error: (e as Error).stack?.slice(0, 400) });
    }
  }
  for (const [k, file] of humans.entries()) {
    if ((sources.length + k) % shards !== shard) continue;
    if (MODE !== 'audit') throw new Error('POOL=human is for MODE=audit');
    try {
      auditHuman(file, trees);
    } catch (e) {
      out({ kind: 'error', pool: 'human', seed: file, error: (e as Error).stack?.slice(0, 400) });
    }
  }
  out({ kind: 'done', shard, ms: Date.now() - started });
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
