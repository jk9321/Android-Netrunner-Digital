/**
 * R-27 (brief runner-rework/briefs/i67-i68-pins-count.md, Part 4): the two trees host-prompts.ts reads.
 *
 * `source` is this checkout's src copied unchanged: it plays the source games (a plain GameRunner) and is never asked or
 * cleared mid-game. `eval` is a second copy whose only change is a measurement hook: the try-each fallback of
 * answerPrompt (src/ai/prompts.ts, "Everything else: try each answer and keep the best outcome") reports each answer's
 * score to HOSTLOG.on when a script sets it. No line of logic changes; with HOSTLOG.on unset the copy plays as the source.
 * Each patch must match exactly once (a stop otherwise, as the other counts' trees).
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Patch = [file: string, at: string, to: string];

const EVAL_PATCHES: Patch[] = [
  [
    'ai/prompts.ts',
    `/** Picks an answer to the active prompt, which belongs to \`side\`. */`,
    `// eslint-disable-next-line @typescript-eslint/no-explicit-any\nexport const HOSTLOG: { on?: (promptId: string, action: any, score: number) => void } = {};\n/** Picks an answer to the active prompt, which belongs to \`side\`. */`,
  ],
  [
    'ai/prompts.ts',
    `    if (skip && after.activeRun?.encounter?.iceId === skip.iceId) score -= skip.cost;\n`,
    `    if (skip && after.activeRun?.encounter?.iceId === skip.iceId) score -= skip.cost;\n    HOSTLOG.on?.(prompt.id, action, score);\n`,
  ],
];

export function makeHostTrees(root: string): { source: string; eval: string } {
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
