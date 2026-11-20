/**
 * R0 count 4 (the Runner's two roles), the trees. Brief: /mnt/project-files/netrunner-ai/runner-rework/r0/count4-two-roles/brief.md.
 *
 * A tree is an unpatched copy of this checkout's src/ loaded as its own module graph, as the Stage D and V-C count
 * scripts build theirs (scripts/stage-vc/breaker-once-trees.ts), so the game that is measured is never played by the
 * graph that is asked (found row 71b). This count has no arm: no tree is patched and no number is added.
 *  - source: plays the self-play games (Normal v Normal, as the batch); never asked, never cleared.
 *  - beta: asked (the reply's Runner, the deciding Runner's ranking and pick).
 *  - control: the same as beta, asked the real-grip reply again; any answer unlike beta's is a stop.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const TREES = ['source', 'beta', 'control'] as const;
export type TreeName = (typeof TREES)[number];

export function makeTrees(root: string, from = 'src'): Record<TreeName, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs = {} as Record<TreeName, string>;
  for (const name of TREES) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    cpSync(from, join(dir, 'src'), { recursive: true });
    dirs[name] = dir;
  }
  return dirs;
}

export interface Tree {
  name: string;
  createAgent: (side: string, level: string) => any;
  GameRunner: any;
  core: any;
  decks: any;
  HeuristicCorpAI: any;
  HeuristicRunnerAI: any;
  guessHidden: (state: any, k: number) => any;
  REPLY: { samples: number; maxSteps: number };
  replySamples: (n: number) => number;
  asSide: <T>(side: string, fn: () => T) => T;
  runs: any;
  clear: () => void;
}

export async function loadTree(name: string, dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const files = ['ai/index.ts', 'ai/playout.ts', 'core/index.ts', 'data/decks.ts', 'ai/handValues.ts', 'ai/effectValues.ts', 'ai/valueModel.ts', 'ai/iceValues.ts', 'ai/corpAI.ts', 'ai/runnerAI.ts', 'ai/runnerReply.ts', 'ai/pricing.ts', 'ai/runs.ts', 'ai/oracle.ts'];
  const mods: any[] = [];
  // One at a time: vite-node never settles concurrent imports of one circular graph
  for (const p of files) mods.push(await m(p));
  const [ai, po, core, decks, hv, ev, vm, iv, corpAI, runnerAI, reply, pricing, runs, oracle] = mods;
  return {
    name,
    createAgent: ai.createAgent,
    GameRunner: po.GameRunner,
    core,
    decks,
    HeuristicCorpAI: corpAI.HeuristicCorpAI,
    HeuristicRunnerAI: runnerAI.HeuristicRunnerAI,
    guessHidden: reply.guessHidden,
    REPLY: reply.REPLY,
    replySamples: oracle.replySamples,
    asSide: pricing.asSide,
    runs,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}
