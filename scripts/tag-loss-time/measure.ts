/**
 * ai-tag-loss-time (brief-tag-loss-time.md rev 2, phase 1). Every arm of trees.ts in its own module graph, timed
 * WITHOUT the profiler on the same recorded boards in the same process, the arms' order rotated and reversed from one
 * decision to the next (both orders, same machine). Shares come from differences between arm timings (summary.mjs).
 * Modes (ARGS, or the MODE environment variable):
 *   deals   the 56 local deals played by this tree's Normal AIs and Jeff's games replayed (scripts/stage-a/harness.ts),
 *           split by SHARD: at each decision (the Corp's ordinary moves, the Runner's outside runs, as the hold-reentry
 *           fire count) every arm decides on a copy, caches cleared first. One JSON line per decision: each arm's ms,
 *           pick and probe tally; a pick that differs from base is listed; one that differs under arm 0 (exact) is asked
 *           again in base and 0 with drawAudit, clickAudit and threatAudit on.
 *   values  the same decisions, arms with the probe's shadow on: every tagClock also works out today's per-turn loss
 *           and worth on the same board (trees.ts); one JSON line per decision with each arm's Values (base on every
 *           10th decision, as the self-test: it must show no difference).
 *   game    the seed-104 finish-test game (tests/aiGames.ts index 4) and the saved state (t18-state.json), by SHARD k of 64:
 *           k < 40: the game played as tests/aiGames.ts plays it (playAIGame, this tree), its decisions with index
 *             % 40 = k asked in every arm (the same recorded boards; every call of the agents that takes a state);
 *           40 <= k < 56: the saved decision in every arm, rotated by k, forward then reversed;
 *           56 <= k < 64: the whole game played in arm ARMS[k - 56], its time per turn (picks that differ change the
 *             game, so this is the absolute game time only).
 *   bvalues  arm B (arms=...) with the shadow and by-card decomposition: for each resource, today's copy difference less
 *           its own term, split by the other rig card whose term moved (and the term's branch), combos and coverage.
 *   btrace   the same for base and B at the decisions listed in at=src#i,... (B's changed picks), on their games only.
 *   arms=a,b,...  any mode: the arms to build (default all eight; 0B on request).
 *   saved / saved-values   the saved decision alone in a container (K rotates the arms' order), or its values pass.
 *   SHARD=0/64 npx vite-node scripts/tag-loss-time/measure.ts -- deals > out-0.txt       (sum: summary.mjs)
 */
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GameAction, GameState, actingSide, createInitialGameState, executeAction } from '../../src/core';
import { createAgent, playAIGame } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { deckGameSetup } from '../../src/data/decks';
import { ALL_DECKS } from '../nsg-sample-decks';
import { deals, dealState, humanFiles } from '../stage-a/harness';
import { ARMS, Arm, CardCross, Tally, Values, installProbe, makeTrees, treeRoot } from './trees';

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const argv = process.argv.slice(2).filter(a => a !== '--');
const mode = process.env.MODE ?? argv[0] ?? 'deals';
/** Options as words after the mode (ai-script.yml passes ARGS split on spaces): arms=base,F,0B  at=deal:2041#38,... */
const opt = (name: string) => argv.find(a => a.startsWith(`${name}=`))?.slice(name.length + 1) ?? process.env[name.toUpperCase()];
const only = (opt('arms') ?? '').split(',').filter(Boolean) as Arm[];
const arms: readonly Arm[] = only.length ? only : mode === 'bvalues' ? ['B'] : mode === 'btrace' ? ['base', 'B'] : ARMS;
const at = new Set((opt('at') ?? '').split(',').filter(Boolean));
const root = treeRoot(`m-${mode}-${process.pid}`);
const probe = installProbe();

interface Tree {
  createAgent: typeof createAgent;
  playAIGame: typeof playAIGame;
  clear: () => void;
  audits: (on: boolean) => { checked: number; mismatches: number; draw: number; click: number; threat: number };
}
async function load(dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const ai = await m('ai/index.ts');
  const hv = await m('ai/handValues.ts');
  const ev = await m('ai/effectValues.ts');
  const tm = await m('ai/threatModel.ts');
  const vm = await m('ai/valueModel.ts');
  const iv = await m('ai/iceValues.ts');
  return {
    createAgent: ai.createAgent,
    playAIGame: ai.playAIGame,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      tm.clearThreatCaches();
      vm.clearBuildTargets();
      iv.clearDeckShares();
      vm.valueLoops?.clear();
    },
    audits: on => {
      const all = [hv.drawAudit, hv.clickAudit, tm.threatAudit];
      const out = { checked: all.reduce((n, a) => n + a.checked, 0), mismatches: all.reduce((n, a) => n + a.mismatches, 0), draw: hv.drawAudit.mismatches, click: hv.clickAudit.mismatches, threat: tm.threatAudit.mismatches };
      for (const a of all) Object.assign(a, { on, checked: 0, mismatches: 0 });
      return out;
    },
  };
}

const key = (a: unknown) => (a && typeof a === 'object' ? JSON.stringify(Object.fromEntries(Object.entries(a).sort())) : JSON.stringify(a ?? null));
interface Ask { a: string; ms: number; t: Tally; v: Values; cards: Record<string, CardCross> }

let trees = {} as Record<Arm, Tree>;
/** One arm decides on a copy of the state: a fresh agent, every cache cleared first. `method` is the agent call. */
function ask(arm: Arm, side: 'corp' | 'runner', s: GameState, method = 'chooseAction', rest: unknown[] = []): Ask {
  const tree = trees[arm];
  tree.clear();
  probe.reset();
  const agent = tree.createAgent(side, 'normal') as unknown as Record<string, (...x: unknown[]) => unknown>;
  const args = [structuredClone(s), ...structuredClone(rest)];
  const t0 = performance.now();
  let a: unknown;
  let err = '';
  try {
    a = agent[method](...args);
  } catch (e) {
    err = `error: ${(e as Error).message}`;
  }
  const ms = performance.now() - t0;
  const { t, v, cards } = probe.reset();
  return { a: err || key(a), ms, t, v, cards };
}

/** The arms in this decision's order: rotated by n, reversed every other decision. */
const orderFor = (n: number): Arm[] => {
  const r = [...arms.slice(n % arms.length), ...arms.slice(0, n % arms.length)];
  return Math.floor(n / arms.length) % 2 ? r.reverse() : r;
};

const round = (t: Tally) => ({ ...t, msIn: Math.round(t.msIn) });
let n = 0;

/** deals mode: every arm timed and counted; picks compared with base; arm 0's changed picks audited. */
function timed(src: string, i: number, side: 'corp' | 'runner', kind: string, s: GameState, method = 'chooseAction', rest: unknown[] = []) {
  const r = {} as Record<Arm, Ask>;
  for (const arm of orderFor(n++)) r[arm] = ask(arm, side, s, method, rest);
  const changed = arms.filter(a => a !== 'base' && r[a].a !== r.base.a);
  let audit;
  if (changed.includes('0')) {
    const once = (arm: Arm) => {
      trees[arm].audits(true);
      const x = ask(arm, side, s, method, rest);
      return { a: x.a, ...trees[arm].audits(false) };
    };
    audit = { base: once('base'), zero: once('0') };
  }
  console.log(
    JSON.stringify({
      src, i, side, kind, method, T: s.turnNumber,
      ms: Object.fromEntries(arms.map(a => [a, Math.round(r[a].ms * 10) / 10])),
      tally: Object.fromEntries(arms.map(a => [a, round(r[a].t)])),
      changed, picks: changed.length ? Object.fromEntries(arms.map(a => [a, r[a].a])) : undefined,
      audit,
    }),
  );
}

/** values mode: every arm with the shadow on (base every 10th decision). */
function valued(src: string, i: number, side: 'corp' | 'runner', kind: string, s: GameState) {
  probe.shadow = true;
  const out: Record<string, Values & { a: string }> = {};
  for (const arm of arms) {
    if (arm === 'F' || (arm === 'base' && n % 10)) continue;
    const r = ask(arm, side, s);
    out[arm] = { ...r.v, a: r.a };
  }
  n++;
  probe.shadow = false;
  console.log(JSON.stringify({ src, i, side, kind, T: s.turnNumber, values: out }));
}

/** bvalues / btrace: arm B (or the listed arms) with the shadow and the by-card decomposition on; btrace also asks base. */
function byCard(src: string, i: number, side: 'corp' | 'runner', kind: string, s: GameState) {
  if (mode === 'btrace' && !at.has(`${src}#${i}`)) return;
  const out: Record<string, unknown> = {};
  for (const arm of arms) {
    const on = arm !== 'base';
    probe.shadow = on;
    probe.byCard = on;
    const r = ask(arm, side, s);
    probe.shadow = false;
    probe.byCard = false;
    out[arm] = on ? { a: r.a, ms: Math.round(r.ms), values: r.v, cards: r.cards } : { a: r.a, ms: Math.round(r.ms) };
  }
  console.log(JSON.stringify({ src, i, side, kind, T: s.turnNumber, bycard: out }));
}

function decisionOf(s: GameState): { side: 'corp' | 'runner'; kind: string } | null {
  const side = actingSide(s);
  if (!side || s.winner) return null;
  const kind = s.pendingPrompts.length ? 'prompt' : s.activeRun ? 'run' : 'main';
  if (side === 'corp' && kind !== 'main') return null; // the Corp: its ordinary moves (as the honest-order count)
  if (side === 'runner' && kind === 'run') return null;
  return { side, kind };
}

function dealsAndHumans(each: (src: string, i: number, side: 'corp' | 'runner', kind: string, s: GameState) => void) {
  const decision = (src: string, i: number, s: GameState) => {
    const d = decisionOf(s);
    if (d) each(src, i, d.side, d.kind, s);
  };
  const sources: (() => void)[] = [
    ...deals().map(seed => () => {
      const src = `deal:${seed}`;
      let i = 0;
      const watch = (inner: Agent): Agent =>
        new Proxy(inner, {
          get(target, prop, recv) {
            if (prop === 'chooseAction') return (state: GameState) => (decision(src, i++, state), target.chooseAction(state));
            return Reflect.get(target, prop, recv);
          },
        });
      const game = new GameRunner(dealState(seed), { corp: watch(createAgent('corp', 'normal')), runner: watch(createAgent('runner', 'normal')) });
      for (let k = 0; k < 4000 && game.step(); k++);
    }),
    ...humanFiles().map(file => () => {
      const report = JSON.parse(readFileSync(file, 'utf8'));
      if (!report.moves?.length) return;
      const src = `human:${file.split('/').pop()}`;
      let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
      if (report.startStops) s = { ...s, stops: report.startStops };
      let i = 0;
      for (const move of report.moves as GameAction[]) {
        if (actingSide(s) === move.player && !(s.priority && s.priority.holder === 'corp' && s.activePlayer === 'runner')) decision(src, i++, s);
        try {
          s = executeAction(s, move);
        } catch {
          break;
        }
      }
    }),
  ];
  const names = [...deals().map(seed => `deal:${seed}`), ...humanFiles().map(f => `human:${f.split('/').pop()}`)];
  const wanted = at.size ? new Set([...at].map(x => x.split('#')[0])) : null;
  sources
    .map((run, k) => ({ run, name: names[k] }))
    .filter(x => !wanted || wanted.has(x.name))
    .forEach((x, k) => {
      if (k % shards === shard) x.run();
    });
}

const INDEX = 4; // tests/aiGames.ts: Quick and Dirty vs Bowel Movements, seed 104
function gameStart(createInitial: typeof createInitialGameState, setup: typeof deckGameSetup): GameState {
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  return createInitial(setup(100 + INDEX, corpDecks[INDEX], runnerDecks[INDEX % runnerDecks.length]));
}

/** game mode, k < 40: the finish-test game as tests/aiGames.ts plays it; its decisions with index % 40 = k asked in every arm. */
function gameDecisions(k: number, of: number) {
  let idx = 0;
  const wrap = (side: 'corp' | 'runner') => {
    const inner = createAgent(side);
    return new Proxy(inner, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (typeof v !== 'function') return v;
        return (...args: unknown[]) => {
          const s = args[0] as GameState;
          if (!s || typeof s !== 'object' || !('turnNumber' in s)) return v.apply(target, args);
          const i = idx++;
          if (i % of === k) timed('game:104', i, side, s.activeRun ? 'run' : s.pendingPrompts.length ? 'prompt' : 'main', s, String(prop), args.slice(1));
          const t = performance.now();
          const out = v.apply(target, args);
          // the game's own call (this tree, caches kept as in the finish test), for reference
          console.log(JSON.stringify({ own: true, i, side, method: String(prop), T: s.turnNumber, ms: Math.round((performance.now() - t) * 10) / 10 }));
          return out;
        };
      },
    });
  };
  const t0 = performance.now();
  const { state } = playAIGame(gameStart(createInitialGameState, deckGameSetup), 3000, 80, { corp: wrap('corp'), runner: wrap('runner') });
  console.log(JSON.stringify({ gameDone: true, winner: state.winner, T: state.turnNumber, score: `${state.corp.score}-${state.runner.score}`, ms: Math.round(performance.now() - t0) }));
}

/** game mode, 40 <= k < 56: the saved decision in every arm, forward then reversed. */
function savedState(k: number) {
  const s: GameState = JSON.parse(readFileSync(process.env.STATE ?? 'scripts/tag-loss-time/t18-state.json', 'utf8'));
  n = k;
  for (const pass of [0, 1]) {
    const order = orderFor(k);
    if (pass) order.reverse();
    for (const arm of order) {
      const r = ask(arm, 'corp', s);
      console.log(JSON.stringify({ saved: true, k, pass, arm, ms: Math.round(r.ms), pick: r.a, tally: round(r.t) }));
    }
  }
}

/** game mode, 56 <= k < 64: the whole game in one arm, timed per turn and side. */
async function wholeGame(arm: Arm) {
  const tree = trees[arm];
  const dir = join(root, arm, 'src');
  const core = await import(/* @vite-ignore */ join(dir, 'core/index.ts'));
  const decks = await import(/* @vite-ignore */ join(dir, 'data/decks.ts'));
  const rows: Record<string, { ms: number; n: number; max: number }> = {};
  const wrap = (side: 'corp' | 'runner') => {
    const inner = tree.createAgent(side);
    return new Proxy(inner, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (typeof v !== 'function') return v;
        return (...args: unknown[]) => {
          const s = args[0] as GameState;
          if (!s || typeof s !== 'object' || !('turnNumber' in s)) return v.apply(target, args);
          probe.reset();
          const t = performance.now();
          const out = v.apply(target, args);
          const ms = performance.now() - t;
          const r = (rows[`${s.turnNumber} ${side}`] ??= { ms: 0, n: 0, max: 0 });
          r.ms += ms; r.n++; r.max = Math.max(r.max, ms);
          return out;
        };
      },
    });
  };
  const t0 = performance.now();
  const { state } = tree.playAIGame(gameStart(core.createInitialGameState, decks.deckGameSetup), 3000, 80, { corp: wrap('corp'), runner: wrap('runner') });
  const ms = performance.now() - t0;
  console.log(JSON.stringify({ whole: true, arm, winner: state.winner, T: state.turnNumber, score: `${state.corp.score}-${state.runner.score}`, ms: Math.round(ms), turns: Object.fromEntries(Object.entries(rows).map(([k2, r]) => [k2, { ms: Math.round(r.ms), n: r.n, max: Math.round(r.max) }])) }));
}

async function main() {
  if (mode === 'game' && shard >= 56 && !arms[shard - 56]) return;
  const want = mode === 'game' && shard >= 56 ? [arms[shard - 56]] : arms;
  const dirs = makeTrees(root, want);
  trees = {} as Record<Arm, Tree>;
  for (const arm of want) trees[arm] = await load(dirs[arm]);
  try {
    if (mode === 'deals') dealsAndHumans((src, i, side, kind, s) => timed(src, i, side, kind, s));
    else if (mode === 'values') dealsAndHumans(valued);
    else if (mode === 'bvalues' || mode === 'btrace') dealsAndHumans(byCard);
    else if (mode === 'game') {
      if (shards !== 64) throw new Error('game mode expects SHARD=k/64');
      if (shard < 40) gameDecisions(shard, 40);
      else if (shard < 56) savedState(shard);
      else await wholeGame(arms[shard - 56]);
    } else if (mode === 'saved') savedState(Number(process.env.K ?? 0));
    else if (mode === 'saved-values') {
      const s: GameState = JSON.parse(readFileSync('scripts/tag-loss-time/t18-state.json', 'utf8'));
      valued('saved:t18', 0, 'corp', 'main', s);
    }
    else throw new Error(`unknown mode ${mode}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
void main();
