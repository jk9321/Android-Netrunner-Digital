// Module load order: the order the repo's modules are evaluated in (ESM depth-first post-order) from an entry file,
// after esbuild's TS transform, which drops imports used only as types or not at all, as vite and vite-node do.
//
// Why (audit Step 3, 2026-11-14): AI play depends on module load order (39 of 221 batch deals moved when the oracle
// hand-off reordered imports; see that step's hand-off, "known gaps"). Deleting the last named binding of an import
// deletes the import edge, so a pure deletion can reorder modules and change games. A refactor that must keep play
// identical (Step 3's groups, Stage A's identity proofs) compares this output before and after, and keeps a bare
// `import './x';` where an edge would otherwise go.
//
// Usage: node scripts/load-order.mjs [entry] > order.txt   (entry defaults to scripts/corp-losses.ts, the batch entry)
//        diff before.txt after.txt                          (no output: the same order)
// Dynamic imports are left out (they run later). Only relative imports are followed (src, scripts, tests).
import { createRequire } from 'node:module';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = process.argv[2] ?? 'scripts/corp-losses.ts';
const esbuild = createRequire(resolve(repo, 'package.json'))('esbuild');
const seen = new Set();
const order = [];

function resolveImport(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const c of [base, base + '.ts', base + '.tsx', base + '/index.ts', base + '/index.tsx', base + '.js']) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

function visit(file) {
  if (seen.has(file)) return;
  seen.add(file);
  if (!/\.tsx?$/.test(file)) {
    order.push(relative(repo, file));
    return;
  }
  const js = esbuild.transformSync(readFileSync(file, 'utf8'), {
    loader: file.endsWith('x') ? 'tsx' : 'ts',
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    tsconfigRaw: { compilerOptions: { useDefineForClassFields: true } },
  }).code;
  const re = /^\s*(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  let m;
  while ((m = re.exec(js))) {
    const target = resolveImport(file, m[1]);
    if (target) visit(target);
  }
  order.push(relative(repo, file));
}

visit(resolve(repo, entry));
console.log(order.join('\n'));
