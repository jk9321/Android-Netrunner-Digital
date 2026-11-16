/**
 * V-B B1 (brief rev 2 step B1, ruling 1): the cache keys' fire count and time, per cache. At each recorded decision (the
 * 56 local deals played by this tree's Normal AIs, and Jeff's games replayed; split by SHARD), a fresh Normal agent of
 * the acting side decides on a copy of the state in several trees, each its own module graph (a copy of src/ under
 * .fc-variants/<shard>/<arm>/), made from this tree by text patches that put a cache's old key back:
 *   base       every key as on beta (the branch point);
 *   branch     this tree;
 *   <cache>    only that change made (entry: a drawn card's two side entrances through cardRate; the three cache keys
 *              were measured in runs 43876047121 and 43890327131 and are kept incomplete, review M1);
 *   no-<cache> every key completed but that one (leave-one-out).
 * base, branch and the three <cache> trees decide every decision (their times are the time per cache, same decisions,
 * order rotated); where base and branch pick differently the no-<cache> trees decide too. `causes`: a cache alone
 * reproduces the branch's pick; `needs`: without that cache the pick goes back to base's. A change no cache reproduces
 * (no cause and no need) is a stop. Caches are cleared before each decision (the method of every other step), so this
 * counts wrong hits within a decision; across decisions play keeps the maps for the game. One JSON line per decision;
 * sum with fire-count-sum.mjs.   SHARD=0/64 npx vite-node scripts/value-b1/fire-count.ts > fc-0.txt
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GameAction, GameState, actingSide, createInitialGameState, executeAction, findCardAnywhere } from '../../src/core';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { deals, dealState, humanFiles } from '../stage-a/harness';
import { deckGameSetup } from '../../src/data/decks';

/** Text patches that put each change's base text back (each must match exactly once), by change. A later step passes its
 * own as a JSON file `{ "<change>": [[file under src/, branch text, base text], ...] }` in ARGS (V-B B2 onward). */
const patchFile = process.argv.slice(2).find(a => a.endsWith('.json')) ?? (process.env.ARGS?.trim().endsWith('.json') ? process.env.ARGS.trim() : undefined);
const OFF: Record<string, [file: string, from: string, to: string][]> = patchFile
  ? JSON.parse(readFileSync(patchFile, 'utf8'))
  : {
      entry: [
        ['ai/handValues.ts', "'ownHandValue drawWorth', state, side === actingSide() ? cardRate(state, side) : drawWorth(state, side), side)", "'ownHandValue drawWorth', state, drawWorth(state, side), side)"],
        ['ai/handValues.ts', "'clickWorth drawWorth', state, side === actingSide() ? cardRate(state, side) : drawWorth(state, side), side)", "'clickWorth drawWorth', state, drawWorth(state, side), side)"],
      ],
    };
const CACHES = Object.keys(OFF);
type Cache = string;
type Arm = string;

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const root = resolve('.fc-variants', String(shard));

function makeTrees(): Record<Arm, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs = { branch: resolve('.') } as Record<Arm, string>;
  const arms: [Arm, Cache[]][] = [['base', [...CACHES]], ...CACHES.map(c => [c, CACHES.filter(x => x !== c)] as [Arm, Cache[]]), ...CACHES.map(c => [`no-${c}`, [c]] as [Arm, Cache[]])];
  for (const [arm, off] of arms) {
    const dir = join(root, arm);
    cpSync('src', join(dir, 'src'), { recursive: true });
    for (const [file, from, to] of off.flatMap(cache => OFF[cache])) {
      const path = join(dir, 'src', file);
      const text = readFileSync(path, 'utf8');
      if (text.split(from).length !== 2) throw new Error(`patch ${arm} does not match once in ${file}: ${from.slice(0, 60)}`);
      writeFileSync(path, text.replace(from, to));
    }
    dirs[arm] = dir;
  }
  return dirs;
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
      tm.clearThreatCaches?.(); // a tree from before ai-threat-delete
      vm.clearBuildTargets();
      iv.clearDeckShares();
      vm.valueLoops?.clear();
    },
  };
}

const key = (a: GameAction | null) => (a ? JSON.stringify(Object.fromEntries(Object.entries(a).sort())) : 'null');

async function main() {
  const dirs = makeTrees();
  const trees = {} as Record<Arm, Tree>;
  for (const arm of Object.keys(dirs) as Arm[]) trees[arm] = await load(dirs[arm]);
  const ask = (arm: Arm, side: 'corp' | 'runner', s: GameState) => {
    const tree = trees[arm];
    tree.clear();
    const agent = tree.createAgent(side, 'normal');
    const copy = structuredClone(s);
    const t = performance.now();
    let a: GameAction | null;
    try {
      a = agent.chooseAction(copy);
    } catch (e) {
      return { a: `error: ${(e as Error).message}`, ms: 0 };
    }
    return { a: key(a), ms: performance.now() - t };
  };
  const TIMED: Arm[] = ['base', 'branch', ...CACHES];
  let n = 0;
  const decision = (src: string, i: number, s: GameState) => {
    const side = actingSide(s);
    if (!side || s.winner) return;
    const kind = s.pendingPrompts.length ? 'prompt' : s.activeRun ? 'run' : 'main';
    const k = n++ % TIMED.length;
    const order = [...TIMED.slice(k), ...TIMED.slice(0, k)];
    const r = {} as Record<Arm, { a: string; ms: number }>;
    for (const arm of order) r[arm] = ask(arm, side, s);
    const changed = r.base.a !== r.branch.a;
    const causes: string[] = [];
    const needs: string[] = [];
    if (changed) {
      for (const c of CACHES) if (r[c].a === r.branch.a) causes.push(c);
      for (const c of CACHES) if (ask(`no-${c}`, side, s).a === r.base.a) needs.push(c);
    }
    const ms = Object.fromEntries(TIMED.map(a => [a, Math.round(r[a].ms * 10) / 10]));
    // V-B B2's watch (non-money upgrade rezzes): the card a REZ_CARD pick rezzes, in base and branch
    const rezzed = (pick: string) => (pick.startsWith('{') && JSON.parse(pick).type === 'REZ_CARD' ? findCardAnywhere(s, JSON.parse(pick).cardInstanceId)?.cardCode : undefined);
    const rez = { base: rezzed(r.base.a), branch: rezzed(r.branch.a) };
    console.log(JSON.stringify({ src, i, side, kind, T: s.turnNumber, changed, causes, needs, base: changed ? r.base.a : undefined, branch: changed ? r.branch.a : undefined, rez: rez.base || rez.branch ? rez : undefined, ms }));
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
