/**
 * ai-breaker-guard-key (brief rev 2, phase 1): crossings, the fire count and time, both sides. At each recorded decision
 * (the 56 local deals played by this tree's Normal AIs, Jeff's games replayed, and the deal 3061 and deal 2138 saved
 * decisions; split by SHARD), a fresh Normal agent of the acting side decides on a copy of the state in each tree of
 * trees.ts, every cache cleared first:
 *   - beta, K, K2 (the brief's K'), R: pick, ms and deck prices worked out (deckAvgStats.priced), in a rotating order;
 *   - aB, aK2: the same decision with the crossing probe on (every store keyed by pricingKey: crossings per store and
 *     key name, each worked out again: trees.ts). Their picks are only checked against beta's and K2's.
 *   - a changed pick (K or K2 against beta) with no guard difference among aB's crossings is asked again cold in both
 *     trees with valueLoops recorded, then with the cache audits on (drawAudit, clickAudit, threatAudit and the root
 *     deck audit), red team finding 4.
 *   - the hosted breakers of the board (tree R's information): each one's held worth as beta prices it and rule-based.
 * The saved decisions are timed REPS times in each timed tree. One JSON line per decision.
 *   SHARD=0/64 npx vite-node scripts/breaker-guard-key/fire-count.ts > fc-0.txt     (sum: fire-count-sum.mjs)
 * Env: DEALS, HUMAN (harness), FIXTURES=none, CAP_MS (10000), REPS (3).
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction } from '../../src/core';
import { isIcebreaker } from '../../src/core/engine/ice';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { deckGameSetup } from '../../src/data/decks';
import { deals, dealState, humanFiles } from '../stage-a/harness';
import { Arm, GuardProbe, StoreTally, TIMED, installProbe, makeTrees, treeRoot } from './trees';

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const REPS = Number(process.env.REPS ?? 3);
const ARMS: Arm[] = [...TIMED, 'aB', 'aK2'];
const root = treeRoot(`fc-${shard}`);
const probe = installProbe(new GuardProbe());
probe.capMs = Number(process.env.CAP_MS ?? 10_000);
const MADANI = '35028';

interface Tree {
  createAgent: typeof createAgent;
  clear: () => void;
  audits: (on: boolean) => { checked: number; mismatches: number };
  priced: () => number;
  loops: () => Record<string, number>;
  guardUp: () => boolean;
  setGuard: <T>(up: boolean, fn: () => T) => T;
  hosted: (s: GameState, side: 'corp' | 'runner') => [string, number, number][];
}
async function load(arm: Arm, dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const ai = await m('ai/index.ts');
  const hv = await m('ai/handValues.ts');
  const ev = await m('ai/effectValues.ts');
  const tm = await m('ai/threatModel.ts');
  const vm = await m('ai/valueModel.ts');
  const iv = await m('ai/iceValues.ts');
  const pr = await m('ai/pricing.ts');
  const keyed = arm === 'K' || arm === 'K2' || arm === 'aK2';
  const guardUp = keyed ? () => pr.pricing().pricingBreaker === true : () => pr.pricing().pricingBreakers.size > 0;
  const setGuard = keyed
    ? <T>(up: boolean, fn: () => T): T => pr.withPricing({ pricingBreaker: up }, fn)
    : <T>(up: boolean, fn: () => T): T => {
        const set: Set<string> = pr.pricing().pricingBreakers;
        const saved = [...set];
        set.clear();
        if (up) set.add('__X');
        try {
          return fn();
        } finally {
          set.clear();
          for (const id of saved) set.add(id);
        }
      };
  const clear = () => {
    hv.clearHandCaches();
    ev.clearDamageThreats();
    tm.clearThreatCaches();
    vm.clearBuildTargets();
    iv.clearDeckShares();
    vm.valueLoops?.clear();
  };
  return {
    createAgent: ai.createAgent,
    clear,
    audits: on => {
      const all = [hv.drawAudit, hv.clickAudit, tm.threatAudit];
      const st = hv.deckAvgStats;
      const sum = { checked: all.reduce((n, a) => n + a.checked, 0) + st.checked, mismatches: all.reduce((n, a) => n + a.mismatches, 0) + st.mismatches };
      for (const a of all) Object.assign(a, { on, checked: 0, mismatches: 0 });
      Object.assign(st, { audit: on, checked: 0, mismatches: 0 });
      return sum;
    },
    priced: () => hv.deckAvgStats.priced,
    loops: () => Object.fromEntries(vm.valueLoops ?? []),
    guardUp,
    setGuard,
    // Each hosted Runner breaker's held worth on this board: as this tree prices it, and rule-based (the guard up)
    hosted: (s, side) => {
      const out: [string, number, number][] = [];
      const rig = s.runner.rig;
      for (const host of [...rig.programs, ...rig.hardware, ...rig.resources]) {
        for (const h of host.hostedCards ?? []) {
          if (cardDef(h).side_code !== 'runner' || !isIcebreaker(h)) continue;
          const free = host.cardCode === MADANI;
          clear();
          const normal: number = pr.asSide(side, () => hv.heldWorth(s, h, 'runner', free));
          clear();
          const rule: number = pr.asSide(side, () => setGuard(true, () => hv.heldWorth(s, h, 'runner', free)));
          out.push([h.cardCode, +normal.toFixed(4), +rule.toFixed(4)]);
        }
      }
      return out;
    },
  };
}

const key = (a: GameAction | null) => (a ? JSON.stringify(Object.fromEntries(Object.entries(a).sort())) : 'null');
interface Ask { a: string; ms: number; priced: number }
/** A store tally, without the empty fields. */
const slim = (t: Record<string, StoreTally>) =>
  Object.fromEntries(
    Object.entries(t).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([, x]) => (typeof x === 'number' ? x !== 0 : Array.isArray(x) ? x.some(Boolean) : Object.keys(x).length > 0)))]),
  );
const guardDiffers = (t: Record<string, StoreTally>) => Object.values(t).reduce((n, v) => n + v.guard, 0);
const anyDiffers = (t: Record<string, StoreTally>) => Object.values(t).reduce((n, v) => n + v.differ, 0);

async function main() {
  const dirs = makeTrees(root, ARMS);
  const trees = {} as Record<Arm, Tree>;
  for (const arm of ARMS) trees[arm] = await load(arm, dirs[arm]);
  const ask = (arm: Arm, side: 'corp' | 'runner', s: GameState): Ask => {
    const tree = trees[arm];
    tree.clear();
    const agent = tree.createAgent(side, 'normal');
    const priced = tree.priced();
    const t0 = performance.now();
    let a: GameAction | null;
    try {
      a = agent.chooseAction(structuredClone(s));
    } catch (e) {
      return { a: `error: ${(e as Error).message}`, ms: performance.now() - t0, priced: 0 };
    }
    return { a: key(a), ms: performance.now() - t0, priced: tree.priced() - priced };
  };
  const audited = (arm: Arm, side: 'corp' | 'runner', s: GameState) => {
    const tree = trees[arm];
    probe.guardUp = tree.guardUp;
    probe.setGuard = tree.setGuard;
    probe.reset();
    probe.on = true;
    let r: Ask;
    try {
      r = ask(arm, side, s);
    } finally {
      probe.on = false;
    }
    const spent = Math.round(probe.spent);
    return { a: r.a, ms: Math.round(r.ms), spent, t: probe.reset() };
  };
  const cold = (arm: Arm, side: 'corp' | 'runner', s: GameState) => {
    const r = ask(arm, side, s);
    const loops = trees[arm].loops();
    trees[arm].audits(true);
    const audit = ask(arm, side, s);
    return { a: r.a, loops, audited: audit.a, ...trees[arm].audits(false) };
  };
  let n = 0;
  const decision = (src: string, i: number, s: GameState, reps = 1) => {
    const side = actingSide(s);
    if (!side || s.winner) return;
    const kind = s.pendingPrompts.length ? 'prompt' : s.activeRun ? 'run' : 'main';
    if (side === 'corp' && kind !== 'main') return; // the Corp: its ordinary moves (as the earlier fire counts)
    if (side === 'runner' && kind === 'run') return;
    const order = [...TIMED.slice(n % 4), ...TIMED.slice(0, n % 4)];
    n++;
    const r = {} as Record<Arm, Ask>;
    const times = {} as Record<Arm, number[]>;
    for (let k = 0; k < reps; k++) {
      for (const arm of order) {
        r[arm] = ask(arm, side, s);
        (times[arm] ??= []).push(Math.round(r[arm].ms));
      }
    }
    const aB = audited('aB', side, s);
    const aK2 = audited('aK2', side, s);
    const ch = { K: r.K.a !== r.beta.a, K2: r.K2.a !== r.beta.a, R: r.R.a !== r.beta.a };
    const gB = guardDiffers(aB.t);
    // A changed pick with no guard difference among beta's crossings: asked again cold, loops and audits (finding 4)
    const coldRuns: Record<string, unknown> = {};
    if ((ch.K || ch.K2) && gB === 0) {
      coldRuns.beta = cold('beta', side, s);
      if (ch.K) coldRuns.K = cold('K', side, s);
      if (ch.K2) coldRuns.K2 = cold('K2', side, s);
    }
    let hosted: [string, number, number][] | string | undefined;
    try {
      const h = trees.aB.hosted(structuredClone(s), side);
      hosted = h.length ? h : undefined;
    } catch (e) {
      hosted = `error: ${(e as Error).message}`;
    }
    const any = ch.K || ch.K2 || ch.R;
    console.log(
      JSON.stringify({
        src, i, side, kind, T: s.turnNumber,
        ch,
        picks: any ? { beta: r.beta.a, K: r.K.a, K2: r.K2.a, R: r.R.a } : undefined,
        ms: reps > 1 ? times : Object.fromEntries(TIMED.map(a => [a, Math.round(r[a].ms)])),
        priced: Object.fromEntries(TIMED.map(a => [a, r[a].priced])),
        aB: { same: aB.a === r.beta.a, ms: aB.ms, spent: aB.spent, differ: anyDiffers(aB.t), guard: gB, t: slim(aB.t) },
        aK2: { same: aK2.a === r.K2.a, ms: aK2.ms, spent: aK2.spent, differ: anyDiffers(aK2.t), guard: guardDiffers(aK2.t), t: slim(aK2.t) },
        cold: Object.keys(coldRuns).length ? coldRuns : undefined,
        hosted,
      }),
    );
  };

  const fixture = (name: string, path: string) => () => {
    if (process.env.FIXTURES === 'none') return;
    decision(`fixture:${name}`, 0, JSON.parse(readFileSync(path, 'utf8')) as GameState, REPS);
  };
  const sources: (() => void)[] = [
    fixture('3061', 'tests/fixtures/breaker-price-depth/hang-deal3061-T16-corp.json'),
    fixture('2138', 'tests/fixtures/hold-reentry/deal2138-T11-corp.json'),
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
