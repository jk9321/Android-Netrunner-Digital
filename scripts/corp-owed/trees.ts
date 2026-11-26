/**
 * The owed Corp counts (brief /mnt/project-files/netrunner-ai/owed-counts/brief.md): scratch trees. Each tree is a copy
 * of a src (this checkout's, or a commit's taken with `git archive`) with text patches that only export a reader or call
 * a global the measuring script sets (unset, the patched line does what it did). Never the repo's src. Each patch must
 * match exactly once (a stop otherwise).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Patch = [file: string, at: string, to: string];

/** A commit's src, fetched at depth 1 if the clone lacks it (the four processes of a CI runner fetch under one lock). */
export function ensureCommit(sha: string) {
  try {
    execSync(`git cat-file -e ${sha}^{commit}`, { stdio: 'ignore' });
  } catch {
    // flock: the processes of one runner share .git (scripts/cache-keys/trees.ts, 229354c)
    execSync(`flock /tmp/corp-owed-git.lock git fetch --depth 1 origin ${sha}`, { stdio: 'ignore' });
  }
}

export function makeTree(dir: string, opts: { ref?: string; patches?: Patch[]; optional?: Patch[] }): string {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  if (opts.ref) {
    ensureCommit(opts.ref);
    execSync(`git archive ${opts.ref} src | tar -x -C ${dir}`);
  } else cpSync('src', join(dir, 'src'), { recursive: true });
  const apply = (patches: Patch[], must: boolean) => {
    for (const [f, at, to] of patches) {
      const path = join(dir, 'src', f);
      const text = readFileSync(path, 'utf8');
      const n = text.split(at).length - 1;
      if (n !== 1) {
        if (!must && n === 0) continue;
        throw new Error(`${dir}: a patch matches ${n} times in ${f}: ${at.slice(0, 90)}`);
      }
      writeFileSync(path, text.replace(at, () => to));
    }
  };
  apply(opts.patches ?? [], true);
  apply(opts.optional ?? [], false);
  return dir;
}

export interface Tree {
  name: string;
  ai: any;
  po: any;
  core: any;
  decks: any;
  ev: any;
  hv: any;
  vm: any;
  fx: any;
  pricing: any;
  plans: any;
  syn: any;
  runs: any;
  rez: any;
  hold: any;
  cards: any;
  tp: any;
  clear: () => void;
}

/** The modules a script reads, in the order loadTree takes them. */
const MODULES: [name: string, path: string][] = [
  ['ai', './ai/index'],
  ['po', './ai/playout'],
  ['core', './core/index'],
  ['decks', './data/decks'],
  ['ev', './ai/evaluate'],
  ['hv', './ai/handValues'],
  ['vm', './ai/valueModel'],
  ['fx', './ai/effectValues'],
  ['iv', './ai/iceValues'],
  ['tm', './ai/threatModel'],
  ['pricing', './ai/pricing'],
  ['plans', './ai/cardPlans'],
  ['syn', './ai/synergyTags'],
  ['runs', './ai/runs'],
  ['rez', './ai/corp/rez'],
  ['hold', './ai/corp/hold'],
  ['cards', './ai/cards/index'],
  ['tp', './ai/turnPlanner'],
];

/**
 * The tree's modules through one entry file written into its src (`__ow.ts`, static imports named as the src names its
 * own). vite-node keys a module by how it is asked for: a dynamic import of `<dir>/src/ai/valueModel.ts` from a script is
 * a second instance beside the one the src's `./valueModel` loads, so a script that reads modules that way sets its
 * pricing context, clears its caches and reads registrations on copies the AI never uses (found 2026-11-26: the copy of
 * valueModel had no runner agenda odds registered).
 */
export async function loadTree(name: string, dir: string): Promise<Tree> {
  const entry = join(dir, 'src', '__ow.ts');
  // One import statement a module, in this order (vite-node never settles concurrent imports of one circular graph)
  writeFileSync(entry, MODULES.map(([n, p]) => `export * as ${n} from '${p}';`).join('\n') + '\n');
  const m: any = await import(/* @vite-ignore */ entry);
  const { ai, po, core, decks, ev, hv, vm, fx, iv, tm, pricing, plans, syn, runs, rez, hold, cards, tp } = m;
  return {
    name,
    ai,
    po,
    core,
    decks,
    ev,
    hv,
    vm,
    fx,
    pricing,
    plans,
    syn,
    runs,
    rez,
    hold,
    cards: cards.CARDS,
    tp,
    clear: () => {
      hv.clearHandCaches?.();
      fx.clearDamageThreats?.();
      tm.clearThreatCaches?.();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}

export const rootOf = (name: string, shard: number) => join(process.env.TROOT ?? `node_modules/.cache/corp-owed-${name}`, String(shard));
export const exists = existsSync;
