/**
 * V-C checkpoint fix, Friend of a Friend's click money (brief /mnt/project-files/netrunner-ai/stage-vc/checkpoint/foaf-fix/
 * brief.md rev 1, "Measurement"): the trees. A tree is a copy of a src/ loaded as its own module graph (the pattern of
 * scripts/stage-vc/run-term-once-trees.ts):
 *  - source, beta, control: the merge base's src (git archive of BASE, the branch's parent on beta). source plays the
 *    source games and is never asked or cleared (found row 71b).
 *  - branch: this checkout's src (Friend of a Friend's clickMoney entry, src/ai/cards/liberation.ts).
 *  - exact: the branch with the card's tagged payout read exactly (5 while the Runner is tagged, the card's first
 *    ability; 9 untagged): a measuring arm only, asked on the boards where Friend of a Friend is installed and the
 *    Runner is tagged ("Tagged boards" in the brief). Not a candidate: an exact number needs a reader change in hold.ts.
 * The branch and exact trees get the FIRE patch, which only writes a global the script reads: `__cmFire` counts the
 * times runnerEarnings reads Friend of a Friend's entry on any board (the decision's own or one in the look-ahead).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const TREES = ['source', 'beta', 'control', 'branch', 'exact'] as const;
export type TreeName = (typeof TREES)[number];
/** The merge base the branch was cut from (origin/beta when the build started); BASE=<sha> overrides it. */
export const BASE = process.env.BASE ?? '85972ceed256c70775ffb06ddca7b7f6923e6f80';

type Patch = [file: string, at: string, to: string];

const FIRE: Patch = [
  'ai/corp/hold.ts',
  `    const m = clickMoneyOf(c.cardCode);
    if (!m) continue;
`,
  `    const m = clickMoneyOf(c.cardCode);
    if (!m) continue;
    if (c.cardCode === '34074') (globalThis as any).__cmFire = ((globalThis as any).__cmFire ?? 0) + 1;
`,
];
const EXACT: Patch = ['ai/corp/hold.ts', `    let credits = m.credits;\n`, `    let credits = c.cardCode === '34074' && s.runner.tags > 0 ? 5 : m.credits;\n`];

function patches(tree: TreeName): Patch[] {
  if (tree === 'branch') return [FIRE];
  if (tree === 'exact') return [FIRE, EXACT];
  return [];
}

/** The merge base's src, extracted once into `dir` (git archive; on a shallow Actions checkout the commit is fetched first). */
function baseSrc(dir: string): string {
  const out = join(dir, 'base');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  // The four processes of an Actions shard fetch at once and race on .git/shallow.lock (found row 94), so each retries
  for (let tryNo = 0; ; tryNo++) {
    try {
      execSync(`git cat-file -e ${BASE}^{commit}`, { stdio: 'ignore' });
      break;
    } catch {
      if (tryNo >= 20) throw new Error(`merge base ${BASE} not fetched after ${tryNo} tries`);
      try {
        execSync(`git fetch -q --depth=1 origin ${BASE}`, { stdio: 'ignore' });
      } catch {
        execSync(`sleep ${1 + Math.floor(Math.random() * 4)}`);
      }
    }
  }
  execSync(`git archive ${BASE} src | tar -x -C ${out}`, { stdio: 'inherit' });
  return join(out, 'src');
}

/** Copies the tree's src into root/<tree>/src with its patches; each patch must match exactly once. */
export function makeTrees(root: string, trees: readonly TreeName[] = TREES): Record<string, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const base = trees.some(t => t === 'source' || t === 'beta' || t === 'control') ? baseSrc(root) : '';
  const dirs: Record<string, string> = {};
  for (const tree of trees) {
    const dir = join(root, tree);
    mkdirSync(dir, { recursive: true });
    cpSync(tree === 'branch' || tree === 'exact' ? 'src' : base, join(dir, 'src'), { recursive: true });
    for (const [f, at, to] of patches(tree)) {
      const path = join(dir, 'src', f);
      const text = readFileSync(path, 'utf8');
      if (text.split(at).length !== 2) throw new Error(`tree ${tree}: a patch does not match once in ${f}: ${at.slice(0, 80)}`);
      writeFileSync(path, text.replace(at, () => to));
    }
    if (tree === 'branch' || tree === 'exact') {
      const lib = readFileSync(join(dir, 'src', 'ai/cards/liberation.ts'), 'utf8');
      if (!lib.includes('clickMoney: { clicks: 1, credits: 9, once: true }')) throw new Error(`tree ${tree}: no Friend of a Friend entry`);
    } else if (readFileSync(join(dir, 'src', 'ai/cards/liberation.ts'), 'utf8').includes('clickMoney')) throw new Error(`tree ${tree}: the base has a clickMoney in liberation.ts`);
    dirs[tree] = dir;
  }
  return dirs;
}

export interface Tree {
  name: string;
  createAgent: (side: string, level: string) => any;
  GameRunner: any;
  core: any;
  decks: any;
  hold: any;
  rezMoney: any;
  placement: any;
  view: (s: any) => any;
  inCorp: <T>(s: any, f: () => T) => T;
  clear: () => void;
}

export async function loadTree(name: string, dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const mods: any[] = [];
  // One at a time: vite-node never settles concurrent imports of one circular graph
  for (const p of ['ai/index.ts', 'ai/playout.ts', 'core/index.ts', 'data/decks.ts', 'ai/handValues.ts', 'ai/effectValues.ts', 'ai/valueModel.ts', 'ai/iceValues.ts', 'ai/corp/hold.ts', 'ai/corp/rezMoney.ts', 'ai/corp/placement.ts', 'ai/turnPlanner.ts', 'ai/synergy.ts']) mods.push(await m(p));
  const [ai, po, core, decks, hv, ev, vm, iv, hold, rezMoney, placement, tp, syn] = mods;
  return {
    name,
    createAgent: ai.createAgent,
    GameRunner: po.GameRunner,
    core,
    decks,
    hold,
    rezMoney,
    placement,
    view: tp.corpDecisionView,
    inCorp: (s, f) => syn.asSide('corp', () => (hv.decisionContext(s, 'corp'), f())),
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}
