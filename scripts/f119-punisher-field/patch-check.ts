/** Each scratch patch's anchor occurs once in the merge base's src (a tree for a new merge base). ARM_BASE=<sha>. */
import { execSync } from 'node:child_process';
import { MERGE_BASE, armPatches } from './trees';
import { BAR } from '../tag-clock-input/trees';
import { COUNT } from './count-patches';

let bad = 0;
// the arm patches on the merge base; the scratch counters and the legs' bar on top (the counters anchor in the arm's text)
const patched: Record<string, string> = {};
const text = (f: string) => (patched[f] ??= execSync(`git show ${MERGE_BASE}:src/${f}`, { maxBuffer: 1e8 }).toString());
for (const [f, a, to] of armPatches('X')) {
  const src = text(f);
  patched[f] = src.replace(a, () => to);
  const n = src.split(a).length - 1;
  if (n !== 1) {
    bad++;
    console.log(`PATCH ${f}: anchor found ${n} times: ${a.slice(0, 100)}`);
  }
}
for (const [f, a] of [...COUNT, BAR]) {
  const n = text(f).split(a).length - 1;
  if (n !== 1) {
    bad++;
    console.log(`PATCH ${f}: anchor found ${n} times: ${a.slice(0, 100)}`);
  }
}
console.log(`${MERGE_BASE}: ${bad} anchors off`);
