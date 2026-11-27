/** Each scratch patch's anchor occurs once in the given ref's src (a tree for a new merge base). ARM_BASE=<sha>. */
import { execSync } from 'node:child_process';
import { BAR, MERGE_BASE, armPatches } from './trees';

let bad = 0;
for (const [f, a] of [...armPatches('X'), BAR]) {
  const src = execSync(`git show ${MERGE_BASE}:src/${f}`, { maxBuffer: 1e8 }).toString();
  const n = src.split(a).length - 1;
  if (n !== 1) {
    bad++;
    console.log(`PATCH ${f}: anchor found ${n} times: ${a.slice(0, 100)}`);
  }
}
console.log(`${MERGE_BASE}: ${bad} anchors off`);
