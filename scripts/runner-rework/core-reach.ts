/**
 * R-B B2 step 1 (f) and bar 11 (brief netrunner-ai/runner-rework/briefs/b2-run.md rev 1; red team 2026-11-25 finding 6):
 * a BASE-ONLY count arm. How many of the pool's deals and people's files reach each branch of the decision during a run
 * (runnerAI.ts runAction and encounterAction at the base, beta 57b02d6), at the TOP LEVEL only: the state the top
 * GameRunner hands its Runner (no planner rollout, reply sample, Hard or oracle playout is counted). One tree, the base's
 * src from git with core-hooks.ts HOOKS (for the scope path) and the counters below; the counters change no answer, so
 * every finished deal's record (winner, cr, sc) must equal the batch's (`recordSame`).
 *
 * Branches (counter names): enc.action / enc.continue (an encounter answered, or left to CONTINUE_RUN); move.asked (the
 * jack-out test after passing ice), jackout, jackout.equal (credits ahead equal to the credits, JACK_OUT legal: the `>=`
 * fault's only input), continue; banner (Banner used: a run-ending subroutine priced 0), lethal (the subroutine that
 * would flatline made must-break), none (nothing must be broken), botulus, bioroid.etr / bioroid.spare (a bioroid click on
 * a run-ending subroutine, or a spare click on another), bioroid.pair (Ansel 2.0's two-at-once click), reserve.read (the
 * Manegarm reserve asked and above 0), reserve.held (a spare click held for it), cannot (cannot get through: paying here
 * is wasted), full (the full break), margin.window (the full break's plan costs more than the tank and at most 0.5 more),
 * full.margin (the full break played in that window: the margin decides), etrOnly (only what ends the run),
 * selfBreak.bioroid / selfBreak.npot (a click or N-Pot's credits on the first run-ending subroutine), end (nothing).
 *
 *   SHARD=0/64 npx vite-node scripts/runner-rework/core-reach.ts -- POOL=batch,nrdb,human
 *   ARGS="POOL=batch DEALS=1001" npx vite-node scripts/runner-rework/core-reach.ts
 *   SUM=<dir of shard outputs> npx vite-node scripts/runner-rework/core-reach.ts   (the summing step)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../nrdb-test-decks';
import { Tree, loadTree } from './facts-trees';
import { HOOKS, Patch, applyPatches } from './core-hooks';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const BASE = process.env.BASE ?? '57b02d6fe816fdeaf778954f2f09539e50c105a7';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/runner-reach', String(shard));
const POOLS = (process.env.POOL ?? 'batch,nrdb,human').split(',');
const DEALS = (process.env.DEALS ?? '').split(',').filter(Boolean);
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 4000);
const out = (x: Record<string, unknown>) => console.log(JSON.stringify(x));
const G = globalThis as any;
const RC = '(globalThis as any).__rc?.';
const R = 'ai/runnerAI.ts';

/** The counters, on the base's runnerAI.ts text (each must match once). Each adds a count and changes no answer. */
export const REACH: Patch[] = [
  // the top GameRunner's ask (after HOOKS, which wrote this line)
  ['ai/playout.ts', `    const __act = this.agents[side].chooseAction(state);`, `    (globalThis as any).__rcAsk?.(state);\n    const __act = this.agents[side].chooseAction(state);`],
  [
    R,
    `    if (run.phase === 'encounter_ice') return this.encounterAction(state, legal) ?? find('CONTINUE_RUN');`,
    `    if (run.phase === 'encounter_ice') {\n      const __e = this.encounterAction(state, legal);\n      ${RC}(state, __e ? 'enc.action' : 'enc.continue');\n      return __e ?? find('CONTINUE_RUN');\n    }`,
  ],
  [
    R,
    `      if (creditsAhead(state) > credits && find('JACK_OUT')) return find('JACK_OUT');`,
    `      const __a = creditsAhead(state);\n      ${RC}(state, 'move.asked');\n      if (__a === credits && find('JACK_OUT')) ${RC}(state, 'jackout.equal');\n      if (__a > credits && find('JACK_OUT')) {\n        ${RC}(state, 'jackout');\n        return find('JACK_OUT');\n      }`,
  ],
  [R, `    return find('CONTINUE_RUN') ?? legal[0];\n  }`, `    ${RC}(state, 'continue');\n    return find('CONTINUE_RUN') ?? legal[0];\n  }`],
  [
    R,
    `      .filter(s => !encounter.broken[s.i]);`,
    `      .filter(s => !encounter.broken[s.i]);\n    if (encounter.cannotEndRun && subs.some((s, i) => !encounter.broken[i] && /^end the run\\.?$/i.test(s.label.trim()))) ${RC}(state, 'banner');`,
  ],
  [R, `    for (const s of unbroken) if (s.i === lethal) s.cost = Infinity;`, `    for (const s of unbroken) if (s.i === lethal) s.cost = Infinity;\n    if (lethal !== undefined && unbroken.some(s => s.i === lethal)) ${RC}(state, 'lethal');`],
  [R, `    if (mustBreak.length === 0) return undefined;`, `    if (mustBreak.length === 0) {\n      ${RC}(state, 'none');\n      return undefined;\n    }`],
  [R, `      if (use) return use;`, `      if (use) {\n        ${RC}(state, 'botulus');\n        return use;\n      }`],
  [
    R,
    `      if (click && (worst.cost === Infinity || state.runner.clicks - (own?.clicks ?? 1) >= approachClickReserve(state))) return click;`,
    `      const __res = click && worst.cost !== Infinity ? approachClickReserve(state) : 0;\n      if (__res > 0) ${RC}(state, 'reserve.read');\n      if (__res > 0 && !(state.runner.clicks - (own?.clicks ?? 1) >= __res)) ${RC}(state, 'reserve.held');\n      if (click && (worst.cost === Infinity || state.runner.clicks - (own?.clicks ?? 1) >= approachClickReserve(state))) {\n        ${RC}(state, (click as any).subroutineIndices ? 'bioroid.pair' : worst.cost === Infinity ? 'bioroid.etr' : 'bioroid.spare');\n        return click;\n      }`,
  ],
  [R, `      if (credits < iceCreditNeed(state, ice, encounter.broken) && before < 2) return undefined;`, `      if (credits < iceCreditNeed(state, ice, encounter.broken) && before < 2) {\n        ${RC}(state, 'cannot');\n        return undefined;\n      }`],
  [
    R,
    `    if (breakPlan && planCost(breakPlan) <= tank + 0.5) {\n      const action = tryBreaking(mustBreak);\n      if (action) return action;\n    }`,
    `    if (breakPlan && planCost(breakPlan) <= tank + 0.5) {\n      if (planCost(breakPlan) > tank) ${RC}(state, 'margin.window');\n      const action = tryBreaking(mustBreak);\n      if (action) {\n        ${RC}(state, planCost(breakPlan) > tank ? 'full.margin' : 'full');\n        return action;\n      }\n    }`,
  ],
  [R, `      const action = tryBreaking(blocking);\n      if (action) return action;`, `      const action = tryBreaking(blocking);\n      if (action) {\n        ${RC}(state, 'etrOnly');\n        return action;\n      }`],
  [R, `        if (bioroid) return bioroid;`, `        if (bioroid) {\n          ${RC}(state, isBioroid(ice) ? 'selfBreak.bioroid' : 'selfBreak.npot');\n          return bioroid;\n        }`],
  [R, `    return undefined;\n  }\n\n  /** Counts actions in a row`, `    ${RC}(state, 'end');\n    return undefined;\n  }\n\n  /** Counts actions in a row`],
];
export const BRANCHES = [
  'enc.action', 'enc.continue', 'move.asked', 'jackout', 'jackout.equal', 'continue', 'banner', 'lethal', 'none', 'botulus', 'bioroid.etr', 'bioroid.spare', 'bioroid.pair',
  'reserve.read', 'reserve.held', 'cannot', 'full', 'margin.window', 'full.margin', 'etrOnly', 'selfBreak.bioroid', 'selfBreak.npot', 'end',
];

// ------------------------------------------------------------------------------------------------ sum
if (process.env.SUM && !(globalThis as any).__reachImport) {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.txt')) files.push(p);
    }
  };
  walk(process.env.SUM);
  const by: Record<string, { sources: number; reach: Record<string, number>; n: Record<string, number>; same: number; checked: number; errors: number }> = {};
  for (const f of files)
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (!line.startsWith('{')) continue;
      const x = JSON.parse(line);
      if (x.kind !== 'source' && x.kind !== 'error') continue;
      const p = (by[x.pool] ??= { sources: 0, reach: {}, n: {}, same: 0, checked: 0, errors: 0 });
      if (x.kind === 'error') {
        p.errors++;
        continue;
      }
      p.sources++;
      if (x.recordSame !== null) {
        p.checked++;
        if (x.recordSame) p.same++;
      }
      for (const [k, v] of Object.entries(x.counts as Record<string, number>)) {
        p.n[k] = (p.n[k] ?? 0) + v;
        if (v > 0) p.reach[k] = (p.reach[k] ?? 0) + 1;
      }
    }
  console.log('| Branch | ' + Object.keys(by).map(p => `${p} (${by[p].sources}): sources reaching / top-level decisions`).join(' | ') + ' |');
  console.log('|---|' + Object.keys(by).map(() => '---').join('|') + '|');
  for (const b of BRANCHES) console.log(`| ${b} | ` + Object.keys(by).map(p => `${by[p].reach[b] ?? 0} / ${by[p].n[b] ?? 0}`).join(' | ') + ' |');
  for (const p of Object.keys(by)) console.log(`${p}: ${by[p].sources} sources, record equal to the batch on ${by[p].same} of ${by[p].checked}, ${by[p].errors} errors`);
  process.exit(0);
}

// ------------------------------------------------------------------------------------------------ tree
function makeTree(): string {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  for (let tries = 0; ; tries++) {
    try {
      execSync(`git cat-file -e ${BASE}^{commit}`, { stdio: 'ignore' });
      break;
    } catch {
      try {
        execSync(`git fetch --depth 1 origin ${BASE}`, { stdio: 'ignore' });
      } catch (e) {
        if (tries >= 8) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000 + 700 * (shard % 4));
      }
    }
  }
  const dir = join(root, 'base');
  mkdirSync(dir, { recursive: true });
  execSync(`git archive ${BASE} src | tar -x -C ${dir}`);
  const read = (p: string) => readFileSync(p, 'utf8');
  const write = (p: string, t: string) => writeFileSync(p, t);
  applyPatches(dir, HOOKS, 'base hooks', read, write);
  applyPatches(dir, REACH, 'base reach', read, write);
  return dir;
}

let counts: Record<string, number> = {};
function listen() {
  const scopes: string[] = [];
  let top: GameState | null = null;
  G.__lkIn = (gr: any) => {
    scopes.push(gr.__lkScope ?? 'top');
    return () => void scopes.pop();
  };
  G.__rcAsk = (state: GameState) => {
    if (scopes.join('>') === 'top') top = state;
  };
  G.__rc = (state: GameState, name: string) => {
    if (state === top && scopes.join('>') === 'top') counts[name] = (counts[name] ?? 0) + 1;
  };
}

type Deal = { seed: number; corpDeck: string; runnerDeck: string; winner: string | null; cr: number[]; sc: number[] };
const DECK_POOL = [...ALL_DECKS, ...NRDB_TEST_DECKS];
const key = (a: unknown) => JSON.stringify(a);

function deal(t: Tree, pool: string, d: Deal) {
  const c = DECK_POOL.find(x => x.side === 'corp' && x.name === d.corpDeck);
  const r = DECK_POOL.find(x => x.side === 'runner' && x.name === d.runnerDeck);
  if (!c || !r) throw new Error(`deal ${d.seed}: deck not found`);
  t.clear();
  const g = new t.GameRunner(t.core.createInitialGameState(t.decks.deckGameSetup(d.seed, c, r)), { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') });
  counts = {};
  const cr: number[] = [];
  const sc: number[] = [];
  let lastTurn = -1;
  for (let i = 0; i < MAX_STEPS; i++) {
    const s: GameState = g.state;
    if (s.turnNumber !== lastTurn && s.activePlayer === 'corp') {
      cr.push(s.corp.credits);
      sc.push(s.corp.score);
      lastTurn = s.turnNumber;
    }
    if (!g.step()) break;
  }
  const B = g.state;
  const recordSame = (B.winner ?? null) === d.winner && key(cr) === key(d.cr) && key(sc) === key(d.sc);
  out({ kind: 'source', pool, src: d.seed, recordSame, counts });
}

/** The decision GameRunner.step asks an agent for at `s`, or null (core-lockstep.ts decisionOf). */
function decisionOf(core: any, s: GameState): boolean {
  const side = core.actingSide(s);
  if (!side || s.winner) return false;
  const w = s.priority;
  if (s.pendingPrompts.length === 0 && w && w.holder !== s.activePlayer) {
    const want = core.wantsStop(s, side, w);
    return !!want && ((side === 'corp' && (w.step === 'approach_ice' || w.step === 'approach_server')) || (side === 'runner' && w.step === 'corp_action'));
  }
  return true;
}

function human(t: Tree, file: string) {
  const r = JSON.parse(readFileSync(file, 'utf8'));
  if (!r.moves?.length) return;
  const core = t.core;
  let s: GameState;
  if (r.startsAt === 'state') s = structuredClone(r.state);
  else {
    s = core.createInitialGameState(t.decks.deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
    if (r.startStops) s = { ...s, stops: r.startStops };
  }
  t.clear();
  const agents = { corp: t.createAgent('corp', 'normal'), runner: t.createAgent('runner', 'normal') };
  counts = {};
  let errors = 0;
  for (const move of r.moves as any[]) {
    const ai = { ...s, stops: { corp: 'ai', runner: 'ai' } } as GameState;
    // every decision, as core-lockstep.ts asks it (the agents' memory sees what it would), counted where a run is under way
    if (decisionOf(core, ai)) {
      try {
        new t.GameRunner(structuredClone(ai), agents).step();
      } catch {
        errors++;
      }
    }
    try {
      s = core.executeAction(s, move);
    } catch {
      break;
    }
  }
  out({ kind: 'source', pool: 'human', src: file.split('/').pop(), recordSame: null, errors, counts });
}

async function main() {
  const dir = makeTree();
  const t = await loadTree('base', dir);
  listen();
  const batch: Deal[] = JSON.parse(readFileSync('scripts/runner-rework/facts-deals-45444888753.json', 'utf8'));
  const nrdb: Deal[] = JSON.parse(readFileSync('scripts/runner-rework/facts-deals-45458221138.json', 'utf8'));
  const pick = (recs: Deal[]) => recs.filter(r => !DEALS.length || DEALS.includes(String(r.seed)));
  const sources: { pool: string; id: any }[] = [];
  for (const pool of POOLS) {
    if (pool === 'batch') for (const r of pick(batch)) sources.push({ pool, id: r });
    else if (pool === 'nrdb') for (const r of pick(nrdb)) sources.push({ pool, id: r });
    else if (pool === 'human') {
      const hd = 'tests/fixtures/human-games';
      for (const f of readdirSync(hd).filter(f => f.endsWith('.json') && (!DEALS.length || DEALS.includes(f.slice(0, -5)))).sort()) sources.push({ pool, id: join(hd, f) });
    } else throw new Error(`unknown pool ${pool}`);
  }
  for (const [k, src] of sources.entries()) {
    if (k % shards !== shard) continue;
    try {
      if (src.pool === 'human') human(t, src.id);
      else deal(t, src.pool, src.id);
    } catch (e) {
      out({ kind: 'error', pool: src.pool, src: src.pool === 'human' ? src.id : src.id.seed, error: (e as Error).stack?.slice(0, 400) });
    }
  }
  if (process.env.OUT_DIR && existsSync(process.env.OUT_DIR)) writeFileSync(join(process.env.OUT_DIR, 'done'), 'ok');
}

// Imported for its REACH list (a unit board's branch, tests/runnerRun.test.ts's recording): no run
if (!(globalThis as any).__reachImport)
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
