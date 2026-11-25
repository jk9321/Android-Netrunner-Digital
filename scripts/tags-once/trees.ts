/**
 * Count of "a tag priced twice" (brief /mnt/project-files/netrunner-ai/tags-once/brief.md rev 0, tracker F104 c): the
 * trees. Text patches on scratch copies of this checkout's src, never on the repo's src (as
 * scripts/runner-rework/facts-trees.ts). Each patch must match exactly once (a stop otherwise).
 *
 *   source      src unchanged. Plays the source games (GameRunner, its agents' calls only watched); never asked by the
 *               count, its caches never cleared.
 *   base        src with exports only (no line of logic changes): the arm every other arm is read against, and the
 *               owner that prices the record in count 3 (addRigCard is private in evaluate.ts).
 *   once        base, and the Corp strength's tag line dropped: a tag enters `evaluate` once.
 *   onceR       base, and the Runner strength's tag line dropped instead. Not a pick arm: only the check that it is the
 *               same arm as `once` (evaluate read on every decision board under both; `sideStrength` has no reader in
 *               src but `evaluate`, and both lines read tagsWorth(state, viewer) with the same viewer).
 *   onceNoWait  once, and payoutWait's tagged risk off (a tagged Runner's paying card waits as an untagged one's). Only to
 *               size the second reader; not a candidate.
 *   onceNoRisk  once, and both tagged risks off: payoutWait's and perTurn's (effectValues.ts:115, the reader the rev 1
 *               split found under #58's rig term). Added by this thread (a deviation): sizes the third reader; not a candidate.
 *   noPerTurn   base, and perTurn's tagged risk off. Not a pick arm: only to name the rig's part read by perTurn (rev 1 split).
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Patch = [file: string, at: string, to: string];
export const ARMS = ['base', 'once', 'onceR', 'onceNoWait', 'onceNoRisk', 'noPerTurn'] as const;
export type Arm = (typeof ARMS)[number];

const EXPORTS: Patch[] = [['ai/evaluate.ts', `function addRigCard(state: GameState, card: CardInstance, value: number): number {`, `export function addRigCard(state: GameState, card: CardInstance, value: number): number {`]];
const CORP_LINE: Patch = ['ai/evaluate.ts', `      corpBoardValue(state, viewer) +\n      tagsWorth(state, viewer) +\n`, `      corpBoardValue(state, viewer) +\n`];
const RUNNER_LINE: Patch = ['ai/evaluate.ts', `    pointValue(runner.score) -\n    tagsWorth(state, viewer) -\n`, `    pointValue(runner.score) -\n`];
const NO_WAIT: Patch = ['ai/cardProfiles.ts', `(state.runner.tags > 0 ? PAYOUT_RISK.runnerTagged : PAYOUT_RISK.runnerUntagged)`, `PAYOUT_RISK.runnerUntagged`];
// perTurn's tagged risk (effectValues.ts:115): a Runner card's per-turn effect discounted as a tagged Runner's (the third reader of #58)
const NO_PERTURN: Patch = ['ai/effectValues.ts', `const tagRisk = state.runner.tags > 0 && !(plan().ownTrashRisk && actingSide() === 'corp');`, `const tagRisk = (false as boolean) && state.runner.tags > 0 && !(plan().ownTrashRisk && actingSide() === 'corp');`];

export const PATCHES: Record<Arm | 'source', Patch[]> = {
  source: [],
  base: EXPORTS,
  once: [...EXPORTS, CORP_LINE],
  onceR: [...EXPORTS, RUNNER_LINE],
  onceNoWait: [...EXPORTS, CORP_LINE, NO_WAIT],
  onceNoRisk: [...EXPORTS, CORP_LINE, NO_WAIT, NO_PERTURN],
  noPerTurn: [...EXPORTS, NO_PERTURN],
};

export function makeTrees(root: string): Record<Arm | 'source', string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs = {} as Record<Arm | 'source', string>;
  for (const [name, patches] of Object.entries(PATCHES) as [Arm | 'source', Patch[]][]) {
    const dir = join(root, name);
    dirs[name] = dir;
    mkdirSync(dir, { recursive: true });
    cpSync('src', join(dir, 'src'), { recursive: true });
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
