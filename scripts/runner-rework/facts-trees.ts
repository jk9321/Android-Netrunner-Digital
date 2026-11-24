/**
 * R-A A-log (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/a-log.md rev 2): the two trees the log reads.
 *
 * `source` is this checkout's src copied unchanged: it plays the source games (plain GameRunner) and is never asked or
 * cleared mid-game. `eval` is a second copy whose only changes are exports (no line of logic changes): the log reads
 * private functions of runs.ts (SUB_RULES, subroutineDamage, runPrices, selfBreakPrice, borrowedSubroutines) and the
 * walk's own rez set when it does not hold (hold.ts walkPick: the set that asks the most, the set policy (b) of L9 needs).
 * Each patch must match exactly once (a stop otherwise, as count 2's trees).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Patch = [file: string, at: string, to: string];

const EVAL_PATCHES: Patch[] = [
  // Exports only: the log reads these private readers by name
  [
    'ai/runs.ts',
    `const CHAIN_REACTION = '36001';`,
    `export { SUB_RULES as __SUB_RULES, subroutineDamage as __subroutineDamage, runPrices as __runPrices, selfBreakPrice as __selfBreakPrice, borrowedSubroutines as __borrowedSubroutines, plainIcePrice as __plainIcePrice };\nconst CHAIN_REACTION = '36001';`,
  ],
  // The walk's set that asks the most when nothing holds (the answer's own set; a field added to the returned object only)
  ['ai/corp/hold.ts', `    rez: null,\n    rezCost: Infinity,\n    need,`, `    rez: null,\n    rezCost: Infinity,\n    rezMost: ids(a.set),\n    need,`],
];

export interface Tree {
  name: string;
  createAgent: (side: string, level: string) => any;
  GameRunner: any;
  core: any;
  decks: any;
  runs: any;
  hold: any;
  rez: any;
  ice: any;
  effects: any;
  cards: any;
  pricing: any;
  handValues: any;
  synergy: any;
  iceValues: any;
  clear: () => void;
}

export function makeTrees(root: string): { source: string; eval: string } {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs = { source: join(root, 'source'), eval: join(root, 'eval') };
  for (const [name, dir] of Object.entries(dirs)) {
    mkdirSync(dir, { recursive: true });
    cpSync('src', join(dir, 'src'), { recursive: true });
    if (name !== 'eval') continue;
    for (const [f, at, to] of EVAL_PATCHES) {
      const path = join(dir, 'src', f);
      const text = readFileSync(path, 'utf8');
      if (text.split(at).length !== 2) throw new Error(`eval tree: a patch does not match once in ${f}: ${at.slice(0, 80)}`);
      writeFileSync(
        path,
        text.replace(at, () => to)
      );
    }
  }
  return dirs;
}

export async function loadTree(name: string, dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const files = [
    'ai/index.ts',
    'ai/playout.ts',
    'core/index.ts',
    'data/decks.ts',
    'ai/handValues.ts',
    'ai/effectValues.ts',
    'ai/valueModel.ts',
    'ai/iceValues.ts',
    'ai/runs.ts',
    'ai/corp/hold.ts',
    'ai/corp/rez.ts',
    'core/engine/ice.ts',
    'core/engine/cardEffects.ts',
    'ai/cards/index.ts',
    'ai/pricing.ts',
    'ai/synergy.ts',
  ];
  const mods: any[] = [];
  // One at a time: vite-node never settles concurrent imports of one circular graph
  for (const p of files) mods.push(await m(p));
  const [ai, po, core, decks, hv, ev, vm, iv, runs, hold, rez, ice, effects, cards, pricing, synergy] = mods;
  return {
    name,
    createAgent: ai.createAgent,
    GameRunner: po.GameRunner,
    core,
    decks,
    runs,
    hold,
    rez,
    ice,
    effects,
    cards: cards.CARDS,
    pricing,
    handValues: hv,
    synergy,
    iceValues: iv,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}
