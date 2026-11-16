/**
 * ai-hold-reentry (brief rev 2, "Measure first", "Pins and proof", F1): the nesting table and the fire count, both sides.
 * At each recorded decision (the 56 local deals played by this tree's Normal AIs, and the human games replayed; split
 * by SHARD), a fresh Normal agent of the acting side decides on a copy of the state in three trees (trees.ts): beta,
 * c1 (the guard) and c2 (the guard and the skipped rez sets), each its own module graph, every cache cleared first.
 * One JSON line per decision:
 *   - the beta tree's nesting (hold counts started, deepest, at depth 2/3/4+, ms at depth 2+, rez windows, hold counts
 *     opened inside a rez window, the sampled routes that opened a nested count);
 *   - each tree's pick, time, rez sets priced and deck prices worked out (deckAvgStats.priced), and the guarded reads
 *     in c1 and c2 (a countRezBudget corp read past the cheap exit with the flag up: brief F1);
 *   - a changed pick is asked again in both trees with drawAudit, threatAudit and clickAudit on (a cache side effect
 *     shows as an audit mismatch);
 *   - c1 against c2, the Hold of every server with ice at corpCredits Infinity, 0 and the Corp's credits (deep-equal).
 * A beta decision that runs past CAP_S seconds (deal 2138 does not finish on beta) is stopped by the probe: every hold
 * count throws from then on, and the line says `capped`; its pick is not compared.
 *   SHARD=0/64 npx vite-node scripts/hold-reentry/fire-count.ts > fc-0.txt     (sum: fire-count-sum.mjs)
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { GameAction, GameState, actingSide, createInitialGameState, executeAction } from '../../src/core';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { deckGameSetup } from '../../src/data/decks';
import { deals, dealState, humanFiles } from '../stage-a/harness';
import { Arm, Probe, Tally, installProbe, makeTrees, treeRoot } from './trees';

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const CAP = Number(process.env.CAP_S ?? 180) * 1000;
const ARMS: Arm[] = ['beta', 'c1', 'c2'];
const root = treeRoot(`fc-${shard}`);

class Capped extends Error {}
/** The probe, with a time cap: past it every hold count throws until the next reset. */
class CappedProbe extends Probe {
  start = 0;
  cap = Infinity;
  capped = false;
  enter(kind: 'turn' | 'run') {
    if (this.capped || performance.now() - this.start > this.cap) {
      this.capped = true;
      throw new Capped('cap');
    }
    super.enter(kind);
  }
}
const probe = installProbe(new CappedProbe(20, 200)) as CappedProbe;

interface Tree {
  createAgent: typeof createAgent;
  clear: () => void;
  audits: (on: boolean) => { checked: number; mismatches: number };
  priced: () => number;
  holds: (s: GameState) => unknown[];
}
async function load(dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const ai = await m('ai/index.ts');
  const hv = await m('ai/handValues.ts');
  const ev = await m('ai/effectValues.ts');
  const tm = await m('ai/threatModel.ts');
  const vm = await m('ai/valueModel.ts');
  const iv = await m('ai/iceValues.ts');
  const hold = await m('ai/corp/hold.ts');
  const pr = await m('ai/pricing.ts');
  return {
    createAgent: ai.createAgent,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      tm.clearThreatCaches?.(); // a tree from before ai-threat-delete
      vm.clearBuildTargets();
      iv.clearDeckShares();
      vm.valueLoops?.clear();
    },
    audits: on => {
      const all = [hv.drawAudit, hv.clickAudit, tm.threatAudit];
      const sum = { checked: all.reduce((n, a) => n + a.checked, 0), mismatches: all.reduce((n, a) => n + a.mismatches, 0) };
      for (const a of all) Object.assign(a, { on, checked: 0, mismatches: 0 });
      return sum;
    },
    priced: () => hv.deckAvgStats.priced,
    holds: s =>
      pr.asSide('corp', () =>
        Object.entries(s.corp.servers as GameState['corp']['servers'])
          .filter(([, sv]) => sv.ice.length)
          .flatMap(([id]) => [Infinity, 0, s.corp.credits].map(corpCredits => hold.serverHold(s, id, { when: 'runnerTurn', corpCredits })))),
  };
}

const key = (a: GameAction | null) => (a ? JSON.stringify(Object.fromEntries(Object.entries(a).sort())) : 'null');
interface Ask { a: string; ms: number; t: Tally; priced: number; capped: boolean }

async function main() {
  const dirs = makeTrees(root, ARMS);
  const trees = {} as Record<Arm, Tree>;
  for (const arm of ARMS) trees[arm] = await load(dirs[arm]);
  const ask = (arm: Arm, side: 'corp' | 'runner', s: GameState): Ask => {
    const tree = trees[arm];
    tree.clear();
    probe.reset();
    probe.capped = false;
    probe.cap = arm === 'beta' ? CAP : Infinity;
    const agent = tree.createAgent(side, 'normal');
    const priced = tree.priced();
    probe.start = performance.now();
    let a: GameAction | null;
    let err = '';
    try {
      a = agent.chooseAction(structuredClone(s));
    } catch (e) {
      a = null;
      err = `error: ${(e as Error).message}`;
    }
    const ms = performance.now() - probe.start;
    const capped = probe.capped;
    const t = probe.reset();
    return { a: err || (capped ? 'capped' : key(a)), ms, t, priced: tree.priced() - priced, capped };
  };
  const audited = (arm: Arm, side: 'corp' | 'runner', s: GameState) => {
    trees[arm].audits(true);
    const r = ask(arm, side, s);
    return { a: r.a, ...trees[arm].audits(false) };
  };
  let n = 0;
  const decision = (src: string, i: number, s: GameState) => {
    const side = actingSide(s);
    if (!side || s.winner) return;
    const kind = s.pendingPrompts.length ? 'prompt' : s.activeRun ? 'run' : 'main';
    if (side === 'corp' && kind !== 'main') return; // the Corp: its ordinary moves (as the honest-order count)
    if (side === 'runner' && kind === 'run') return;
    const order = [ARMS, ['c2', 'beta', 'c1'], ['c1', 'c2', 'beta']][n++ % 3] as Arm[];
    const r = {} as Record<Arm, Ask>;
    for (const arm of order) r[arm] = ask(arm, side, s);
    const ch1 = !r.beta.capped && r.beta.a !== r.c1.a;
    const ch2 = r.c1.a !== r.c2.a;
    // A changed pick, asked again with the cache audits on in both trees
    const audit1 = ch1 ? { beta: audited('beta', side, s), c1: audited('c1', side, s) } : undefined;
    const audit2 = ch2 ? { c1: audited('c1', side, s), c2: audited('c2', side, s) } : undefined;
    let holdsEqual: boolean | string;
    try {
      trees.c1.clear();
      const h1 = trees.c1.holds(s);
      trees.c2.clear();
      const h2 = trees.c2.holds(s);
      holdsEqual = isDeepStrictEqual(h1, h2) ? true : JSON.stringify([h1, h2]).slice(0, 400);
    } catch (e) {
      holdsEqual = `error: ${(e as Error).message}`;
    }
    const b = r.beta.t;
    console.log(
      JSON.stringify({
        src, i, side, kind, T: s.turnNumber,
        beta: { turns: b.turns, maxDepth: b.maxDepth, d2: b.d2, d3: b.d3, d4: b.d4, msDeep: Math.round(b.msDeep), runs: b.runs, turnInRun: b.turnInRun, msRun: Math.round(b.msRun), routes: b.routes },
        capped: r.beta.capped || undefined,
        guarded1: r.c1.t.guarded, guarded2: r.c2.t.guarded,
        turns1: r.c1.t.turns, turns2: r.c2.t.turns, depth1: r.c1.t.maxDepth, depth2: r.c2.t.maxDepth,
        sets: { beta: b.sets, c1: r.c1.t.sets, c2: r.c2.t.sets },
        priced: { beta: r.beta.priced, c1: r.c1.priced, c2: r.c2.priced },
        ms: { beta: Math.round(r.beta.ms), c1: Math.round(r.c1.ms), c2: Math.round(r.c2.ms) },
        ch1, ch2,
        picks: ch1 || ch2 ? { beta: r.beta.a, c1: r.c1.a, c2: r.c2.a } : undefined,
        audit1, audit2, holdsEqual,
      }),
    );
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
  sources.forEach((run, k) => {
    if (k % shards === shard) run();
  });
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
}

void main();
