/**
 * Stage D item 1 follow-up 4, steps 1.3 to 1.5 (brief section 2): the fire count, time and continuations of the
 * Runner-money arms. At each recorded Corp decision of the fire count's 92 sources (the 56 local deals played by this
 * tree's Normal AIs and the human games replayed; split by SHARD), a fresh Normal Corp decides on a copy of the state in
 * `beta` (this tree) and in every arm (beta plus that arm's patches, runner-money-trees.ts), each its own module graph,
 * order rotated, timed. Runner decisions are not asked: the Runner AI does not read the hold count's budget.
 *
 * CONT (default the F2 arms and `installed`): where an arm's pick differs from beta's, both continue in the engine,
 * from the decision, with that tree's Normal Corp against beta's Normal Runner, to the end of the second Runner turn
 * after it: the points each side has at the end of the Runner's next turn and of the Corp's turn after it ("does the
 * Runner get in next turn; does the Corp still score"), and at the end (marks at each turn's end). Deterministic: the same seeded state both ways.
 *
 * One JSON line per Corp decision (`d`): the groups in play (runner-money-trees.ts `present`), each arm's pick where it
 * differs, milliseconds by tree, and the continuations. Sum with runner-money-sum.mjs.
 *
 *   SHARD=0/64 npx vite-node scripts/stage-d/runner-money-fire.ts
 *   DEALS=1881 HUMAN=none ARMS=runBegin npx vite-node scripts/stage-d/runner-money-fire.ts
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GameAction, GameState, actingSide, createInitialGameState, executeAction } from '../../src/core';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { deals, dealState, humanFiles } from '../stage-a/harness';
import { deckGameSetup } from '../../src/data/decks';
import { makeTrees, present, readArms } from './runner-money-trees';

for (const kv of (process.env.ARGS ?? '').split(/\s+/).filter(x => x.includes('='))) {
  const [k, v] = kv.split('=');
  process.env[k] = v;
}
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
if (process.env.ONLY && !process.env.ONLY.split(',').map(Number).includes(shard)) process.exit(0);
const file = readArms();
const ARMS = Object.keys(file.arms);
const CONT = new Set((process.env.CONT ?? 'f2max,f2odds,installed').split(',').filter(Boolean));
const root = resolve('.rm-fire', String(shard));

interface Tree {
  createAgent: typeof createAgent;
  GameRunner: typeof GameRunner;
  clear: () => void;
}
async function load(dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const ai = await m('ai/index.ts');
  const hv = await m('ai/handValues.ts');
  const ev = await m('ai/effectValues.ts');
  const vm = await m('ai/valueModel.ts');
  const iv = await m('ai/iceValues.ts');
  const po = await m('ai/playout.ts');
  return {
    createAgent: ai.createAgent,
    GameRunner: po.GameRunner,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets();
      iv.clearDeckShares();
      vm.valueLoops?.clear();
    },
  };
}
const key = (a: GameAction | null) => (a ? JSON.stringify(Object.fromEntries(Object.entries(a).sort())) : 'null');

async function main() {
  const dirs = { beta: resolve('.'), ...makeTrees(file, root) } as Record<string, string>;
  const trees: Record<string, Tree> = {};
  for (const t of Object.keys(dirs)) trees[t] = await load(dirs[t]);
  const ask = (t: string, s: GameState) => {
    const tree = trees[t];
    tree.clear();
    const agent = tree.createAgent('corp', 'normal');
    const at = performance.now();
    let a: GameAction | null;
    try {
      a = agent.chooseAction(structuredClone(s));
    } catch (e) {
      return { a: `error: ${(e as Error).message}`, ms: 0 };
    }
    return { a: key(a), ms: performance.now() - at };
  };

  /** The game on from `s` with tree `t`'s Corp against beta's Runner: points at the end of the next Runner turn, of the Corp turn after it, and of the second Runner turn. */
  const cont = (t: string, s: GameState) => {
    trees[t].clear();
    trees.beta.clear();
    const g = new trees[t].GameRunner(structuredClone(s), { corp: trees[t].createAgent('corp', 'normal'), runner: trees.beta.createAgent('runner', 'normal') });
    // A mark at each turn's end: who ended it, and the points then (R1 = the first Runner turn ended, C2 the Corp turn after)
    const marks: { ended: string; corp: number; runner: number; T: number }[] = [];
    let last = g.state.activePlayer;
    for (let n = 0; n < 3000 && !g.state.winner && marks.filter(m => m.ended === 'runner').length < 2; n++) {
      if (!g.step()) break;
      const now = g.state.activePlayer;
      if (now !== last) {
        marks.push({ ended: last, corp: g.state.corp.score, runner: g.state.runner.score, T: g.state.turnNumber });
        last = now;
      }
    }
    const end = { corp: g.state.corp.score, runner: g.state.runner.score, T: g.state.turnNumber };
    return { start: { corp: s.corp.score, runner: s.runner.score }, marks, end, winner: g.state.winner ?? null };
  };

  const TIMED = ['beta', ...ARMS];
  let n = 0;
  const decision = (src: string, i: number, s: GameState) => {
    if (actingSide(s) !== 'corp' || s.winner) return;
    const kind = s.pendingPrompts.length ? 'prompt' : s.activeRun ? 'run' : 'main';
    const k = n++ % TIMED.length;
    const order = [...TIMED.slice(k), ...TIMED.slice(0, k)];
    const r: Record<string, { a: string; ms: number }> = {};
    for (const t of order) r[t] = ask(t, s);
    const changed = ARMS.filter(a => r[a].a !== r.beta.a);
    const p = present(s);
    const groups = Object.entries(p).filter(([g, v]) => g !== 'known' && v === true).map(([g]) => g);
    const out: Record<string, unknown> = {
      kind: 'd', src, i, T: s.turnNumber, dk: kind, groups, known: p.known, changed,
      ms: Object.fromEntries(TIMED.map(t => [t, Math.round(r[t].ms * 10) / 10])),
    };
    if (changed.length) {
      out.picks = Object.fromEntries([['beta', r.beta.a], ...changed.map(a => [a, r[a].a])]);
      const want = changed.filter(a => CONT.has(a));
      if (want.length) {
        const c: Record<string, unknown> = { beta: cont('beta', s) };
        for (const a of want) c[a] = cont(a, s);
        out.cont = c;
      }
    }
    console.log(JSON.stringify(out));
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
      const game = new GameRunner(dealState(seed), { corp: watch(createAgent('corp', 'normal')), runner: createAgent('runner', 'normal') });
      for (let k = 0; k < 4000 && game.step(); k++);
    }),
    ...humanFiles().map(f => () => {
      const report = JSON.parse(readFileSync(f, 'utf8'));
      if (!report.moves?.length) return;
      const src = `human:${f.split('/').pop()}`;
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
