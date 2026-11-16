/**
 * ai-breaker-price-depth (brief rev 2, "Bar"): the fire count, both sides. At each recorded decision (the 56 local
 * deals played by this tree's Normal AIs, and the human games replayed; split by SHARD), a fresh Normal agent of the
 * acting side decides on a copy of the state in two trees, each its own module graph:
 *   beta    a copy of this tree's src/ with the old guard put back (each breaker nests under every other one);
 *   branch  this tree (a breaker met while any breaker is priced takes the rule-based worth: depth 1).
 * Each line also says how many breakers the position holds that are priced this way: hosted on a Runner card, plus the
 * ones in the grip when one is hosted (a grip breaker's rig price walks the hosted ones). With at most one, the two
 * trees must pick the same (a stop otherwise). One JSON line per decision. Sum with fire-count-sum.mjs.
 *   SHARD=0/64 npx vite-node scripts/breaker-price-depth/fire-count.ts > fc-0.txt
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GameAction, GameState, actingSide, cardDef, executeAction, createInitialGameState } from '../../src/core';
import { isIcebreaker } from '../../src/core/engine/ice';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { deals, dealState, humanFiles } from '../stage-a/harness';
import { deckGameSetup } from '../../src/data/decks';

const NEW = 'if (isIcebreaker(card) && pricing().pricingBreakers.size === 0 && !pricing().averaging) {';
const OLD = 'if (isIcebreaker(card) && !pricing().pricingBreakers.has(card.instanceId) && !pricing().averaging) {';
type Arm = 'beta' | 'branch';

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve('.fc-variants', String(shard));

function makeTrees(): Record<Arm, string> {
  rmSync(root, { recursive: true, force: true });
  const beta = join(root, 'beta');
  mkdirSync(beta, { recursive: true });
  cpSync('src', join(beta, 'src'), { recursive: true });
  const path = join(beta, 'src', 'ai', 'handValues.ts');
  const text = readFileSync(path, 'utf8');
  if (text.split(NEW).length !== 2) throw new Error('guard patch does not match once');
  writeFileSync(path, text.replace(NEW, OLD));
  return { beta, branch: resolve('.') };
}

interface Tree {
  createAgent: typeof createAgent;
  clear: () => void;
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
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      tm.clearThreatCaches();
      vm.clearBuildTargets();
      iv.clearDeckShares();
      vm.valueLoops?.clear();
    },
  };
}

const key = (a: GameAction | null) => (a ? JSON.stringify(Object.fromEntries(Object.entries(a).sort())) : 'null');

/** Breakers priced by the nesting branch: hosted on a Runner card, plus grip breakers when one is hosted. */
function breakersPriced(s: GameState): { hosted: number; grip: number; priced: number } {
  const rig = s.runner.rig;
  const hosted = [...rig.programs, ...rig.hardware, ...rig.resources].flatMap(c => c.hostedCards ?? []).filter(h => cardDef(h).side_code === 'runner' && isIcebreaker(h)).length;
  const grip = s.runner.grip.filter(c => isIcebreaker(c)).length;
  return { hosted, grip, priced: hosted + (hosted > 0 ? grip : 0) };
}

async function main() {
  const dirs = makeTrees();
  const trees = { beta: await load(dirs.beta), branch: await load(dirs.branch) };
  const ask = (arm: Arm, side: 'corp' | 'runner', s: GameState) => {
    const tree = trees[arm];
    tree.clear();
    const agent = tree.createAgent(side, 'normal');
    const t = performance.now();
    let a: GameAction | null;
    try {
      a = agent.chooseAction(structuredClone(s));
    } catch (e) {
      return { a: `error: ${(e as Error).message}`, ms: 0 };
    }
    return { a: key(a), ms: performance.now() - t };
  };
  let n = 0;
  const decision = (src: string, i: number, s: GameState) => {
    const side = actingSide(s);
    if (!side || s.winner) return;
    const kind = s.pendingPrompts.length ? 'prompt' : s.activeRun ? 'run' : 'main';
    if (side === 'corp' && kind !== 'main') return; // the Corp: its ordinary moves (as the honest-order count)
    if (side === 'runner' && kind === 'run') return;
    const order: Arm[] = n++ % 2 ? ['beta', 'branch'] : ['branch', 'beta'];
    const r = {} as Record<Arm, { a: string; ms: number }>;
    for (const arm of order) r[arm] = ask(arm, side, s);
    const changed = r.beta.a !== r.branch.a;
    console.log(JSON.stringify({ src, i, side, kind, T: s.turnNumber, ...breakersPriced(s), changed, beta: changed ? r.beta.a : undefined, branch: changed ? r.branch.a : undefined, msBeta: Math.round(r.beta.ms), msBranch: Math.round(r.branch.ms) }));
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
