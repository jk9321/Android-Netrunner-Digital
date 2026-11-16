/**
 * ai-breaker-guard-key phase 2: the fire count and time of the build (tree K' of phase 1) on the merged core, both
 * sides. Two trees, each a copy of this tree's src/ in its own module graph:
 *   beta    the guard left out of pricingKey (its key segment emptied): what beta does, the guard outside the key;
 *   branch  this tree.
 * At each recorded decision (the 56 local deals played by this tree's Normal AIs, Jeff's games replayed, and the deal
 * 3061 and deal 2138 saved decisions, timed REPS times; split by SHARD), a fresh Normal agent of the acting side
 * decides on a copy of the state in both trees, every cache cleared first, in alternating order. A changed pick is
 * asked again in both trees with the cache audits on and valueLoops recorded. One JSON line per decision.
 *   SHARD=0/64 npx vite-node scripts/breaker-guard-key/build-check.ts > bc-0.txt     (sum: build-check-sum.mjs)
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GameAction, GameState, actingSide, createInitialGameState, executeAction } from '../../src/core';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { deckGameSetup } from '../../src/data/decks';
import { deals, dealState, humanFiles } from '../stage-a/harness';
import { treeRoot } from './trees';

type Arm = 'beta' | 'branch';
const ARMS: Arm[] = ['beta', 'branch'];
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const REPS = Number(process.env.REPS ?? 3);
const root = treeRoot(`bc-${shard}`);
const KEY = "    c.pricingBreaker && !c.averaging ? 'b' : '', // last: deckPricingKey drops it\n";

function makeTrees(): Record<Arm, string> {
  rmSync(root, { recursive: true, force: true });
  const out = {} as Record<Arm, string>;
  for (const arm of ARMS) {
    const dir = join(root, arm);
    mkdirSync(dir, { recursive: true });
    cpSync('src', join(dir, 'src'), { recursive: true });
    if (arm === 'beta') {
      const path = join(dir, 'src', 'ai', 'pricing.ts');
      const text = readFileSync(path, 'utf8');
      if (text.split(KEY).length !== 2) throw new Error('pricing.ts: the guard key segment does not match once');
      writeFileSync(path, text.replace(KEY, () => "    '',\n"));
    }
    out[arm] = dir;
  }
  return out;
}

interface Tree {
  createAgent: typeof createAgent;
  clear: () => void;
  audits: (on: boolean) => { checked: number; mismatches: number };
  loops: () => Record<string, number>;
  priced: () => number;
}
async function load(dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const ai = await m('ai/index.ts');
  const hv = await m('ai/handValues.ts');
  const ev = await m('ai/effectValues.ts');
  const vm = await m('ai/valueModel.ts');
  const iv = await m('ai/iceValues.ts');
  return {
    createAgent: ai.createAgent,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets();
      iv.clearDeckShares();
      vm.valueLoops?.clear();
    },
    audits: on => {
      const all = [hv.drawAudit, hv.clickAudit];
      const st = hv.deckAvgStats;
      const sum = { checked: all.reduce((n, a) => n + a.checked, 0) + st.checked, mismatches: all.reduce((n, a) => n + a.mismatches, 0) + st.mismatches };
      for (const a of all) Object.assign(a, { on, checked: 0, mismatches: 0 });
      Object.assign(st, { audit: on, checked: 0, mismatches: 0 });
      return sum;
    },
    loops: () => Object.fromEntries(vm.valueLoops ?? []),
    priced: () => hv.deckAvgStats.priced,
  };
}

const key = (a: GameAction | null) => (a ? JSON.stringify(Object.fromEntries(Object.entries(a).sort())) : 'null');

async function main() {
  const dirs = makeTrees();
  const trees = { beta: await load(dirs.beta), branch: await load(dirs.branch) };
  const ask = (arm: Arm, side: 'corp' | 'runner', s: GameState) => {
    const tree = trees[arm];
    tree.clear();
    const agent = tree.createAgent(side, 'normal');
    const priced = tree.priced();
    const t0 = performance.now();
    let a: string;
    try {
      a = key(agent.chooseAction(structuredClone(s)));
    } catch (e) {
      a = `error: ${(e as Error).message}`;
    }
    return { a, ms: Math.round(performance.now() - t0), priced: tree.priced() - priced };
  };
  const again = (arm: Arm, side: 'corp' | 'runner', s: GameState) => {
    const r = ask(arm, side, s);
    const loops = trees[arm].loops();
    trees[arm].audits(true);
    const audited = ask(arm, side, s).a;
    return { a: r.a, loops, audited, ...trees[arm].audits(false) };
  };
  let n = 0;
  const decision = (src: string, i: number, s: GameState, reps = 1) => {
    const side = actingSide(s);
    if (!side || s.winner) return;
    const kind = s.pendingPrompts.length ? 'prompt' : s.activeRun ? 'run' : 'main';
    if (side === 'corp' && kind !== 'main') return; // the Corp: its ordinary moves (as the earlier fire counts)
    if (side === 'runner' && kind === 'run') return;
    const order: Arm[] = n++ % 2 ? ['beta', 'branch'] : ['branch', 'beta'];
    const r = {} as Record<Arm, { a: string; ms: number; priced: number }>;
    const ms = { beta: [] as number[], branch: [] as number[] };
    for (let k = 0; k < reps; k++) {
      for (const arm of order) {
        r[arm] = ask(arm, side, s);
        ms[arm].push(r[arm].ms);
      }
    }
    const changed = r.beta.a !== r.branch.a;
    console.log(
      JSON.stringify({
        src, i, side, kind, T: s.turnNumber, changed,
        picks: changed ? { beta: r.beta.a, branch: r.branch.a } : undefined,
        again: changed ? { beta: again('beta', side, s), branch: again('branch', side, s) } : undefined,
        ms: reps > 1 ? ms : { beta: ms.beta[0], branch: ms.branch[0] },
        priced: { beta: r.beta.priced, branch: r.branch.priced },
        errors: [r.beta.a, r.branch.a].some(a => a.startsWith('error')) || undefined,
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
