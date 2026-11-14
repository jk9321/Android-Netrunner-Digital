// Module load order: the order the repo's modules are evaluated in (ESM depth-first post-order) from an entry file,
// after esbuild's TS transform, which drops imports used only as types or not at all, as vite and vite-node do.
//
// Why (audit Step 3, 2026-11-14): AI play depended on module load order. runnerAI.ts built its trojan list at load from
// runs.ts's constants, and under the batch entry runnerAI loads inside runs.ts's import cycle, before those constants
// are set (vite-node then reads undefined). Deleting the last named binding of an import deletes the import edge, so a
// pure deletion can reorder modules. A refactor that must keep play identical compares this output before and after.
//
// Usage:
//   node scripts/load-order.mjs [entry] > order.txt
//       The order from `entry` (default scripts/corp-losses.ts, the batch entry). diff two outputs: no output, same order.
//   node scripts/load-order.mjs --reads [entry ...]
//       Every read of an imported value that runs while a module loads (top-level code, not inside a function), in
//       src/ai. A read is UNSAFE when its provider is in the same import cycle as the reader: then some entry order
//       loads the reader before the provider has set its exports. For each entry (default: the batch entry, the
//       browser worker src/ai/worker.ts and the app src/main.tsx) it also says whether that read is reached unset there.
//       Exit code 1 when any unsafe read is found (tests/loadOrder.test.ts runs it).
// Dynamic imports are left out (they run later). Only relative imports are followed (src, scripts, tests).
import { createRequire } from 'node:module';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(repo, 'package.json'));
const esbuild = require('esbuild');

export const ENTRIES = ['scripts/corp-losses.ts', 'src/ai/worker.ts', 'src/main.tsx'];

function resolveImport(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const c of [base, base + '.ts', base + '.tsx', base + '/index.ts', base + '/index.tsx', base + '.js']) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

const edgeCache = new Map();
/** The modules a file imports at load, in source order, as esbuild leaves them (type-only and unused imports dropped). */
function edges(file) {
  if (edgeCache.has(file)) return edgeCache.get(file);
  const out = [];
  if (/\.tsx?$/.test(file)) {
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
      if (target) out.push(target);
    }
  }
  edgeCache.set(file, out);
  return out;
}

/** Evaluation order (absolute paths) from an entry, repo-relative or absolute. */
export function loadOrder(entry) {
  const seen = new Set();
  const order = [];
  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const target of edges(file)) visit(target);
    order.push(file);
  };
  visit(resolve(repo, entry));
  return order;
}

/** Strongly connected components of the import graph reached from the entries (Tarjan): file -> component id. */
function components(files) {
  const index = new Map();
  const low = new Map();
  const comp = new Map();
  const stack = [];
  const on = new Set();
  let n = 0;
  let c = 0;
  const strong = v => {
    index.set(v, n);
    low.set(v, n++);
    stack.push(v);
    on.add(v);
    for (const w of edges(v)) {
      if (!index.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
    }
    if (low.get(v) === index.get(v)) {
      let w;
      do {
        w = stack.pop();
        on.delete(w);
        comp.set(w, c);
      } while (w !== v);
      c++;
    }
  };
  for (const f of files) if (!index.has(f)) strong(f);
  return comp;
}

/** Reads of imported values that run at load in `file` (TypeScript AST): [{ name, provider, line }]. */
function loadTimeReads(file, ts) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imported = new Map(); // local name -> provider file
  for (const st of source.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause || st.importClause.isTypeOnly) continue;
    const provider = resolveImport(file, st.moduleSpecifier.text);
    if (!provider) continue;
    const clause = st.importClause;
    if (clause.name) imported.set(clause.name.text, provider);
    const named = clause.namedBindings;
    if (named && ts.isNamespaceImport(named)) imported.set(named.name.text, provider);
    if (named && ts.isNamedImports(named)) for (const el of named.elements) if (!el.isTypeOnly) imported.set(el.name.text, provider);
  }
  // Top-level local functions (declarations and const arrows/functions): their bodies run at load when called at load
  const locals = new Map();
  for (const st of source.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.body) locals.set(st.name.text, st.body);
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) locals.set(d.name.text, d.initializer.body);
  }
  const entered = new Set();
  const reads = [];
  const deferred = node =>
    ts.isFunctionLike(node) || // function bodies, arrows, methods, accessors, constructors: run later
    (ts.isPropertyDeclaration(node) && !node.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword)) || // instance fields: at construction
    ts.isTypeNode(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isImportDeclaration(node) ||
    ts.isExportDeclaration(node);
  const walk = node => {
    if (deferred(node)) return;
    // A local function called at load runs its body at load too (one level per function, each body walked once)
    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && ts.isIdentifier(node.expression) && locals.has(node.expression.text) && !entered.has(node.expression.text)) {
      entered.add(node.expression.text);
      ts.forEachChild(locals.get(node.expression.text), walk);
    }
    if (ts.isIdentifier(node) && imported.has(node.text)) {
      const parent = node.parent;
      const isName = (ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isPropertyAssignment(parent) && parent.name === node) || (ts.isVariableDeclaration(parent) && parent.name === node);
      if (!isName) reads.push({ name: node.text, provider: imported.get(node.text), line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
    }
    ts.forEachChild(node, walk);
  };
  for (const st of source.statements) walk(st);
  return reads;
}

/** Every load-time read in src/ai, marked unsafe when its provider shares an import cycle with the reader. */
export function loadReads(entries = ENTRIES) {
  const ts = require('typescript');
  const orders = Object.fromEntries(entries.map(e => [e, loadOrder(e)]));
  const files = [...new Set(Object.values(orders).flat())];
  const comp = components(files);
  const rows = [];
  for (const file of files) {
    const rel = relative(repo, file);
    if (!rel.startsWith('src/ai/') || !/\.tsx?$/.test(file)) continue;
    for (const r of loadTimeReads(file, ts)) {
      const unsafe = comp.get(r.provider) === comp.get(file);
      const unset = Object.fromEntries(entries.map(e => [e, orders[e].includes(file) && orders[e].includes(r.provider) && orders[e].indexOf(r.provider) > orders[e].indexOf(file)]));
      rows.push({ at: `${rel}:${r.line}`, name: r.name, provider: relative(repo, r.provider), unsafe, unset });
    }
  }
  return rows;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === '--reads') {
    const entries = args.length > 1 ? args.slice(1) : ENTRIES;
    const rows = loadReads(entries);
    const bad = rows.filter(r => r.unsafe);
    console.log(`${rows.length} load-time reads of imported values in src/ai; ${bad.length} unsafe (provider in the reader's import cycle)`);
    for (const r of bad) console.log(`UNSAFE ${r.at} ${r.name} from ${r.provider}; unset under: ${entries.filter(e => r.unset[e]).join(', ') || 'none of these entries'}`);
    process.exit(bad.length ? 1 : 0);
  }
  console.log(loadOrder(args[0] ?? 'scripts/corp-losses.ts').map(f => relative(repo, f)).join('\n'));
}
