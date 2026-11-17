/**
 * Stage D item 1 branch 2 (the 10:10Z ruling: the time bar against beta after the failed-run change): the fire count
 * (scripts/value-b1/fire-count.ts) with one change, `beta`, whose base text is beta's own copy of every src file the
 * branch's walk changes. The walk's temporary switches are gone, so this is how the base tree becomes beta again: the
 * files are read from the beta commit in ARGS (`BETA=<full sha>`, fetched here) and passed to the fire count as
 * whole-file patches. The card facts and the folded switch names stay (beta's code reads neither). Sum with
 * fire-count-sum.mjs: `time base` is beta, `time branch` this tree, on the same decisions.
 *   ARGS="BETA=ebc21b8b2244449fb62316bb3678ef4c904faec2" SHARD=0/64 npx vite-node scripts/stage-d/retime-beta.ts
 * `RETRIES=off` in ARGS also times this tree with the failed run off (the 10:33Z ruling: the time with it on and off),
 * without touching the checkout (four processes share it): a second change, `retries`, puts Walk's default false, and
 * beta's hold.ts patch becomes two, the text before that line (beta's whole file and a comment opened) and the text
 * after it (the comment closed), so the two changes never overlap. The timed trees are then base = beta, branch = this
 * tree, `beta` (only beta's change made, so retries off) = this tree with the failed run off, `retries` = beta again.
 */
import { execSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

const sha = /BETA=([0-9a-f]{40})/.exec(process.env.ARGS ?? '')?.[1] ?? process.env.BETA;
if (!sha) throw new Error('retime-beta: BETA=<full sha> in ARGS');
const FILES = ['ai/corp/hold.ts', 'ai/corp/rezMoney.ts', 'ai/runs.ts'];
const OFF = /RETRIES=off/.test(process.env.ARGS ?? '');
const ON = '    private readonly retries = true,';

// Four processes share a runner's checkout: the first fetch may race the others, so each tries until the commit is there
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
for (let k = 0; ; k++) {
  try {
    execSync(`git cat-file -e ${sha}^{commit}`, { stdio: 'ignore' });
    break;
  } catch {
    if (k >= 10) throw new Error(`retime-beta: could not fetch ${sha}`);
    try {
      execSync(`git fetch -q --depth=1 origin ${sha}`, { stdio: 'ignore' });
    } catch {
      sleep(500 + Math.floor(Math.random() * 1500));
    }
  }
}

const patch: Record<string, string[][]> = {
  beta: FILES.flatMap(f => {
    // The fire count applies a patch with String.replace, which reads `$` patterns in the replacement: each `$` doubled
    // comes out as itself
    const base = execSync(`git show ${sha}:src/${f}`, { maxBuffer: 1 << 26 }).toString().replace(/\$/g, '$$$$');
    const text = readFileSync(`src/${f}`, 'utf8');
    if (!OFF || f !== 'ai/corp/hold.ts') return [[f, text, base]];
    const at = text.indexOf(ON);
    if (at < 0 || text.indexOf(ON, at + 1) >= 0) throw new Error('retime-beta: the retries default is not in hold.ts once');
    return [
      [f, text.slice(0, at), `${base}\n/*`],
      [f, text.slice(at + ON.length), '*/\n'],
    ];
  }),
  ...(OFF ? { retries: [['ai/corp/hold.ts', ON, '    private readonly retries = false,']] } : {}),
};
const out = `.retime-beta-${(process.env.SHARD ?? '0/1').replace('/', '-')}.json`;
writeFileSync(out, JSON.stringify(patch));
process.env.ARGS = out;
try {
  await import('../value-b1/fire-count');
} finally {
  rmSync(out, { force: true });
}
