/** ai-tag-loss-time: builds every arm's tree and imports it (a patch that no longer matches throws).  npx vite-node scripts/tag-loss-time/check-trees.ts */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { ARMS, makeTrees, treeRoot } from './trees';

async function main() {
  const root = treeRoot(`check-${process.pid}`);
  const dirs = makeTrees(root);
  for (const a of ARMS) {
    await import(/* @vite-ignore */ join(dirs[a], 'src', 'ai/index.ts'));
    console.log('ok', a);
  }
  if (!process.env.KEEP) rmSync(root, { recursive: true, force: true });
  else console.log(root);
}
void main();
