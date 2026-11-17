/**
 * Stage D item 1 branch 2 (the 10:10Z ruling: the time bar against beta after the failed-run change): the fire count
 * (scripts/value-b1/fire-count.ts) with one change, `beta`, whose base text is beta's own copy of every src file the
 * branch's walk changes. The walk's temporary switches are gone, so this is how the base tree becomes beta again: the
 * files are read from the beta commit in ARGS (`BETA=<full sha>`, fetched here) and passed to the fire count as
 * whole-file patches. The card facts and the folded switch names stay (beta's code reads neither). Sum with
 * fire-count-sum.mjs: `time base` is beta, `time branch` this tree, on the same decisions.
 *   ARGS="BETA=ebc21b8b2244449fb62316bb3678ef4c904faec2" SHARD=0/64 npx vite-node scripts/stage-d/retime-beta.ts
 */
import { execSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

const sha = /BETA=([0-9a-f]{40})/.exec(process.env.ARGS ?? '')?.[1] ?? process.env.BETA;
if (!sha) throw new Error('retime-beta: BETA=<full sha> in ARGS');
const FILES = ['ai/corp/hold.ts', 'ai/corp/rezMoney.ts', 'ai/runs.ts'];

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

const patch = {
  beta: FILES.map(f => {
    const base = execSync(`git show ${sha}:src/${f}`, { maxBuffer: 1 << 26 }).toString();
    // The fire count applies a patch with String.replace, which reads `$` patterns in the replacement: each `$` doubled
    // comes out as itself
    return [f, readFileSync(`src/${f}`, 'utf8'), base.replace(/\$/g, '$$$$')];
  }),
};
const out = `.retime-beta-${(process.env.SHARD ?? '0/1').replace('/', '-')}.json`;
writeFileSync(out, JSON.stringify(patch));
process.env.ARGS = out;
await import('../value-b1/fire-count');
rmSync(out, { force: true });
