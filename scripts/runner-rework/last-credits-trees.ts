/**
 * R-14h, the last credits (brief netrunner-ai/runner-rework/briefs/r14h-last-credits-count.md rev 0a, issue #65): the trees
 * the count uses. Text patches on scratch copies of this checkout's src, never the repo's.
 *
 *   play   src unchanged: plays the source games (a plain GameRunner, never asked or cleared by the script).
 *   eval   asked on structuredClones: R-14e's eval tree (decided-twice's EVAL patches and trash-readers' PARTS, imported,
 *          not edited) plus one export: runs.ts trashNet (the price of a trash since O1b: the engine's cost, the tag the
 *          trash gives), so the price is read as the run reads it. No value changes.
 *   pairs  src unchanged: plays the two answers on to the end of the game.
 *
 * Each patch must match exactly once (a stop otherwise).
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVAL as DT_EVAL, Patch } from './decided-twice-trees';
import { PARTS } from './trash-readers-trees';

export const EXTRA: Patch[] = [
  // Export only: the price of a trash (O1b's owner), read by name
  ['ai/runs.ts', `function trashNet(state: GameState, card: CardInstance): number {`, `export function trashNet(state: GameState, card: CardInstance): number {`],
];

export function makeTrees(root: string): { play: string; eval: string; pairs: string } {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs = { play: join(root, 'play'), eval: join(root, 'eval'), pairs: join(root, 'pairs') };
  for (const [name, dir] of Object.entries(dirs)) {
    mkdirSync(dir, { recursive: true });
    // SRC_REF=<sha> (R-14h fix bar 3: the base arm on beta's src, this checkout's scripts): that commit's src (git archive)
    if (process.env.SRC_REF) execSync(`git cat-file -e ${process.env.SRC_REF}^{commit} || git fetch --depth 1 origin ${process.env.SRC_REF}; git archive ${process.env.SRC_REF} src | tar -x -C ${dir}`, { shell: '/bin/bash' });
    else cpSync('src', join(dir, 'src'), { recursive: true });
    const patches = name === 'eval' ? [...DT_EVAL, ...PARTS, ...EXTRA] : [];
    for (const [f, at, to] of patches) {
      const path = join(dir, 'src', f);
      const text = readFileSync(path, 'utf8');
      if (text.split(at).length !== 2) throw new Error(`${name} tree: a patch does not match once in ${f}: ${at.slice(0, 90)}`);
      writeFileSync(
        path,
        text.replace(at, () => to)
      );
    }
  }
  return dirs;
}
