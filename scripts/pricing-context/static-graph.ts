/**
 * R-B B1b's first step (brief netrunner-ai/runner-rework/briefs/b1b-context-table.md rev 0, tracker R-12a), part 1: the
 * static table of src/ai/pricing.ts's context. Reads the source with the TypeScript checker (no run, no change to src):
 *
 *   units    every named function-like body of src (functions, methods, arrow consts, object-literal callbacks, class
 *            fields holding a function); an anonymous function belongs to the unit it is written in, except where it is
 *            the callback of a setter, whose scope it is.
 *   edges    unit -> unit for every call (and every function passed as a value, which may be called), resolved through
 *            imports and re-exports (synergy.ts re-exports asSide), interface members to the classes that implement them
 *            (Agent.chooseAction -> each agent), base methods to overrides, object-literal callbacks to the property of
 *            the interface they fill (RunnerContext.rank -> runnerContext's rank), and module variables set through a
 *            registrar (setDeckCard, setRunnerAgendaOdds, setOraclePlayout's hook) to the functions handed to it.
 *            Each edge carries the setter scopes it sits in, in its own unit (lexically).
 *   setters  every call of withPricing, holdPricing, asSide, noteDecision outside pricing.ts: fields, value text, restore.
 *   readers  every read of a context field (pricing().f, or a local holding pricing()) and every call of an exported
 *            reader (plan, actingSide, planSide, pricingKey, deckPricingKey, leafHandByCard).
 *
 * Static and over-approximate: "can be above" means a path exists in this graph, not that a game takes it (part 2 counts
 * that). Output: JSON to OUT (default /tmp/pricing-static.json); static-table.ts renders it.
 *
 *   npx vite-node scripts/pricing-context/static-graph.ts -- OUT=/tmp/pricing-static.json
 */
import ts from 'typescript';
import { writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).filter(a => a.includes('=')).map(a => a.split('=') as [string, string]));
const OUT = args.OUT ?? '/tmp/pricing-static.json';
const ROOT = resolve('.');
const PRICING = resolve('src/ai/pricing.ts');

const cfg = ts.getParsedCommandLineOfConfigFile(resolve('tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })!;
const program = ts.createProgram(
  cfg.fileNames.filter(f => f.startsWith(resolve('src'))),
  cfg.options
);
const checker = program.getTypeChecker();
const files = program.getSourceFiles().filter(f => f.fileName.startsWith(resolve('src')) && !f.isDeclarationFile);
const rel = (f: string) => relative(ROOT, f);
const lineOf = (n: ts.Node) => n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line + 1;

const SETTERS = ['withPricing', 'holdPricing', 'asSide', 'noteDecision'] as const;
const READERS = ['pricing', 'plan', 'actingSide', 'planSide', 'pricingKey', 'deckPricingKey', 'leafHandByCard'] as const;
type SetterName = (typeof SETTERS)[number];

function resolveAlias(s: ts.Symbol | undefined): ts.Symbol | undefined {
  if (!s) return s;
  while (s.flags & ts.SymbolFlags.Alias) {
    const t = checker.getAliasedSymbol(s);
    if (!t || t === s) break;
    s = t;
  }
  return s;
}
/** The pricing.ts export a symbol is, if any. */
function pricingExport(s: ts.Symbol | undefined): string | null {
  s = resolveAlias(s);
  const d = s?.declarations?.[0];
  if (!d || resolve(d.getSourceFile().fileName) !== PRICING) return null;
  return s!.name;
}

// ------------------------------------------------------------------------------------------------ units
type Unit = { id: string; file: string; name: string; line: number; node: ts.Node };
const units: Unit[] = [];
const unitOfNode = new Map<ts.Node, Unit>();
const isFn = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n);

function nameOf(n: ts.Node): string | null {
  const p = n.parent;
  if (ts.isFunctionDeclaration(n)) return n.name?.text ?? 'default';
  if (ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n)) {
    const cls = ts.isClassLike(p) ? (p.name?.text ?? '<class>') : ts.isObjectLiteralExpression(p) ? objName(p) : '?';
    return `${cls}.${n.name.getText()}`;
  }
  if (ts.isConstructorDeclaration(n)) return `${(p as ts.ClassLikeDeclaration).name?.text ?? '<class>'}.constructor`;
  if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    if (ts.isPropertyDeclaration(p)) return `${(p.parent as ts.ClassLikeDeclaration).name?.text ?? '<class>'}.${p.name.getText()}`;
    if (ts.isPropertyAssignment(p) && ts.isObjectLiteralExpression(p.parent)) return `${objName(p.parent)}.${p.name.getText()}`;
  }
  return null;
}
function objName(o: ts.ObjectLiteralExpression): string {
  // the unit that builds the literal, or the variable it is assigned to
  let p: ts.Node = o.parent;
  while (p && !ts.isSourceFile(p)) {
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    const n = isFn(p) ? nameOf(p) : null;
    if (n) return n;
    if (ts.isPropertyAssignment(p) && ts.isObjectLiteralExpression(p.parent)) return `${objName(p.parent)}.${p.name.getText()}`;
    p = p.parent;
  }
  return '<literal>';
}

for (const sf of files) {
  const mod: Unit = { id: `${rel(sf.fileName)}:<module>`, file: rel(sf.fileName), name: '<module>', line: 1, node: sf };
  units.push(mod);
  unitOfNode.set(sf, mod);
  const visit = (n: ts.Node) => {
    if (isFn(n)) {
      const name = nameOf(n);
      if (name) {
        const u: Unit = { id: `${rel(sf.fileName)}:${name}@${lineOf(n)}`, file: rel(sf.fileName), name, line: lineOf(n), node: n };
        units.push(u);
        unitOfNode.set(n, u);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
// Anonymous functions written in a module-level table (runs.ts SUB_RULES: [regex, price, lethal] rows, called as rule[1](...)):
// each is a unit, and a function that reads the table may call any of them
const tableFns = new Map<ts.Symbol, Unit[]>();
for (const sf of files) {
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer || unitOfNode.get(d.initializer)) continue;
      const found: Unit[] = [];
      const visit = (n: ts.Node) => {
        if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && !unitOfNode.get(n)) {
          const u: Unit = { id: `${rel(sf.fileName)}:${(d.name as ts.Identifier).text}[fn]@${lineOf(n)}`, file: rel(sf.fileName), name: `${(d.name as ts.Identifier).text}[fn]`, line: lineOf(n), node: n };
          units.push(u);
          unitOfNode.set(n, u);
          found.push(u);
          return;
        }
        if (unitOfNode.get(n)) return; // a named callback (a card table's method) is already its own unit
        ts.forEachChild(n, visit);
      };
      visit(d.initializer);
      if (found.length) tableFns.set(checker.getSymbolAtLocation(d.name)!, found);
    }
  }
}
/** The unit a node is written in. */
function unitAt(n: ts.Node): Unit {
  let p: ts.Node | undefined = n.parent;
  while (p) {
    const u = unitOfNode.get(p);
    if (u) return u;
    p = p.parent;
  }
  throw new Error('no unit');
}
/** The unit a function-valued declaration stands for. */
function unitOfDecl(d: ts.Declaration): Unit[] {
  const u = unitOfNode.get(d);
  if (u) return [u];
  if ((ts.isVariableDeclaration(d) || ts.isPropertyDeclaration(d) || ts.isPropertyAssignment(d)) && d.initializer) {
    return valueUnits(d.initializer);
  }
  return [];
}
/** The function units an expression's value can be (a function, a reference, either branch of a choice). */
function valueUnits(i: ts.Expression): Unit[] {
  while (ts.isParenthesizedExpression(i) || ts.isNonNullExpression(i) || ts.isAsExpression(i)) i = i.expression;
  if (unitOfNode.get(i)) return [unitOfNode.get(i)!];
  if (ts.isIdentifier(i) || ts.isPropertyAccessExpression(i)) return targetsOf(i);
  if (ts.isConditionalExpression(i)) return [...valueUnits(i.whenTrue), ...valueUnits(i.whenFalse)];
  if (ts.isBinaryExpression(i) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(i.operatorToken.kind)) return [...valueUnits(i.left), ...valueUnits(i.right)];
  return [];
}

// Interface/base member -> implementing members; module variable -> functions handed to it
const impls = new Map<ts.Symbol, Unit[]>();
const literalOf = new Map<string, { iface: string[]; builder: string }>();
const addImpl = (s: ts.Symbol | undefined, u: Unit[]) => {
  if (!s || !u.length) return;
  impls.set(s, [...(impls.get(s) ?? []), ...u]);
};
// registrar: function symbol -> [param index, module symbol it assigns to]
const registrars = new Map<ts.Symbol, { param: number; target: ts.Symbol }[]>();

function scan1(n: ts.Node) {
  // classes: members to the members of what they implement or extend
  if (ts.isClassLike(n) && n.heritageClauses) {
    for (const h of n.heritageClauses)
      for (const t of h.types) {
        const ty = checker.getTypeAtLocation(t);
        for (const m of n.members) {
          if (!m.name || !(ts.isMethodDeclaration(m) || ts.isPropertyDeclaration(m))) continue;
          const base = ty.getProperty(m.name.getText());
          const own = ts.isMethodDeclaration(m) ? [unitOfNode.get(m)!].filter(Boolean) : unitOfDecl(m);
          addImpl(base, own);
        }
      }
  }
  // object literals: a property's function to the property of the type it fills
  if (ts.isObjectLiteralExpression(n)) {
    const ty = checker.getContextualType(n);
    if (!ty)
      // a literal of callbacks with no declared type (corp/lines.ts playoutLine's { first, step, rank }): its callbacks
      // dispatch only below a call of the function that builds it (static-table.ts)
      for (const p of n.properties) {
        const fnNode = ts.isMethodDeclaration(p) ? p : ts.isPropertyAssignment(p) ? p.initializer : null;
        const lu = fnNode && unitOfNode.get(fnNode);
        if (lu) literalOf.set(lu.id, { iface: [`ret:${unitAt(n).id}`], builder: unitAt(n).id });
      }
    if (ty)
      for (const p of n.properties) {
        if (!p.name) continue;
        const name = p.name.getText();
        const props = ty.isUnion() ? ty.types.map(t => t.getProperty(name)) : [ty.getProperty(name)];
        let own: Unit[] = [];
        if (ts.isMethodDeclaration(p)) own = [unitOfNode.get(p)!].filter(Boolean);
        else if (ts.isPropertyAssignment(p)) own = unitOfDecl(p);
        else if (ts.isShorthandPropertyAssignment(p)) {
          const v = checker.getShorthandAssignmentValueSymbol(p);
          own = (resolveAlias(v)?.declarations ?? []).flatMap(unitOfDecl);
        }
        for (const s of props) addImpl(s, own);
        // the literal's callbacks dispatch only where its builder was called: recorded for the reach (static-table.ts)
        if (ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p)) {
          const fnNode = ts.isMethodDeclaration(p) ? p : p.initializer;
          const lu = unitOfNode.get(fnNode);
          const ifaces = props.filter((x): x is ts.Symbol => !!x).map(x => `${(x as ts.Symbol & { parent?: ts.Symbol }).parent?.name ?? '?'}.${x.name}`);
          if (lu && ifaces.length) literalOf.set(lu.id, { iface: ifaces, builder: unitAt(n).id });
        }
      }
  }
  // registrars: `x = param` inside a function, x a module-level variable (or a module object's property: hooks.playout)
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.right)) {
    const fn = unitAt(n);
    const param = checker.getSymbolAtLocation(n.right);
    const pd = param?.declarations?.[0];
    if (pd && ts.isParameter(pd) && isFn(pd.parent) && unitOfNode.get(pd.parent) === fn) {
      const idx = pd.parent.parameters.indexOf(pd);
      const target = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(n.left) ? n.left.name : n.left);
      const fsym = fnSymbol(pd.parent);
      if (target && fsym) registrars.set(fsym, [...(registrars.get(fsym) ?? []), { param: idx, target }]);
    }
  }
  ts.forEachChild(n, scan1);
}
function fnSymbol(f: ts.FunctionLikeDeclaration): ts.Symbol | undefined {
  if (f.name) return checker.getSymbolAtLocation(f.name);
  const p = f.parent;
  if (ts.isVariableDeclaration(p)) return checker.getSymbolAtLocation(p.name);
  return undefined;
}
for (const sf of files) scan1(sf);
// registrar calls: the function handed in becomes a target of the variable
function scan2(n: ts.Node) {
  if (ts.isCallExpression(n)) {
    const s = resolveAlias(checker.getSymbolAtLocation(ts.isPropertyAccessExpression(n.expression) ? n.expression.name : n.expression));
    for (const r of (s && registrars.get(s)) ?? []) {
      const a = n.arguments[r.param];
      if (!a) continue;
      if ((ts.isArrowFunction(a) || ts.isFunctionExpression(a)) && !unitOfNode.get(a)) {
        // an anonymous callback handed to a registrar is its own unit (setDeckCard(fn), setOraclePlayout(fn))
        const file = rel(a.getSourceFile().fileName);
        const name = `${s!.name}(callback)`;
        const nu: Unit = { id: `${file}:${name}@${lineOf(a)}`, file, name, line: lineOf(a), node: a };
        units.push(nu);
        unitOfNode.set(a, nu);
      }
      const u = unitOfNode.get(a) ? [unitOfNode.get(a)!] : targetsOf(a);
      addImpl(r.target, u);
    }
  }
  ts.forEachChild(n, scan2);
}
for (const sf of files) scan2(sf);

/** The units a callee expression (or a function value) can be. */
function targetsOf(e: ts.Expression): Unit[] {
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)) e = e.expression;
  if (ts.isElementAccessExpression(e)) return [];
  const at = ts.isPropertyAccessExpression(e) ? e.name : e;
  const s0 = checker.getSymbolAtLocation(at);
  const s = resolveAlias(s0);
  if (!s) return [];
  const out = new Set<Unit>();
  const add = (s1: ts.Symbol) => {
    for (const d of s1.declarations ?? []) for (const u of unitOfDecl(d)) out.add(u);
    for (const u of impls.get(s1) ?? []) out.add(u);
  };
  add(s);
  // overrides and implementations of overrides (one level more)
  for (const u of [...out]) {
    const d = u.node;
    if (ts.isMethodDeclaration(d) && d.name) {
      const ms = checker.getSymbolAtLocation(d.name);
      if (ms) for (const v of impls.get(ms) ?? []) out.add(v);
    }
  }
  return [...out];
}

// ------------------------------------------------------------------------------------------------ setters, readers, edges
type Scope = { id: string; setter: SetterName; file: string; unit: string; line: number; node: ts.Node; cb: ts.Node | null; fields: string[]; values: Record<string, string>; callee: [number, number] };
const scopes: Scope[] = [];
type Edge = { from: string; to: string; line: number; scopes: string[]; kind: 'call' | 'value' | 'name' };
const edges: Edge[] = [];
type Read = { what: string; field: string; file: string; unit: string; line: number; scopes: string[]; use: string; text: string; at: [number, number] };
const reads: Read[] = [];

/** Setter scopes (callbacks of setters in the same unit) that lexically hold `n`. */
function scopesAt(n: ts.Node): string[] {
  const out: string[] = [];
  const u = unitAt(n);
  for (let p: ts.Node | undefined = n; p && p !== u.node; p = p.parent) {
    const sc = scopeByCb.get(p);
    if (sc) out.push(sc.id);
  }
  // holdPricing: the rest of its unit after the call
  for (const sc of scopes) if (sc.setter === 'holdPricing' && sc.unit === u.id && n.getStart() > sc.node.getEnd()) out.push(sc.id);
  return out;
}
const scopeByCb = new Map<ts.Node, Scope>();

function useOf(n: ts.Node): string {
  // climb to the expression that consumes the read
  let c: ts.Node = n;
  for (let p = n.parent; p; c = p, p = p.parent) {
    if (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p) || ts.isNonNullExpression(p) || ts.isParenthesizedExpression(p) || ts.isAsExpression(p)) continue;
    if (ts.isCallExpression(p) && p.expression === c) continue; // a method of the value (known[side].has(...))
    if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) return 'branches';
    if (ts.isBinaryExpression(p)) {
      const k = p.operatorToken.kind;
      if (k === ts.SyntaxKind.AmpersandAmpersandToken || k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.QuestionQuestionToken) {
        if (p.left === c) return k === ts.SyntaxKind.QuestionQuestionToken ? 'value' : 'branches';
        continue; // the right operand: its value is the expression's (the loop moves c up to p)
      }
      if (k === ts.SyntaxKind.EqualsEqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsEqualsToken || k === ts.SyntaxKind.EqualsEqualsToken) return 'branches';
      if (k === ts.SyntaxKind.PlusToken) return 'key';
      if (k === ts.SyntaxKind.EqualsToken) return 'value';
      return 'value';
    }
    if (ts.isConditionalExpression(p)) return p.condition === c ? 'branches' : 'value';
    if (ts.isIfStatement(p) || ts.isWhileStatement(p)) return 'branches';
    if (ts.isTemplateSpan(p) || ts.isTemplateExpression(p)) return 'key';
    if (ts.isArrayLiteralExpression(p)) return 'key';
    if (ts.isCallExpression(p) || ts.isNewExpression(p)) return 'passed on';
    if (ts.isReturnStatement(p) || ts.isArrowFunction(p)) return 'returned';
    if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isSpreadAssignment(p)) return 'value';
    return ts.SyntaxKind[p.kind];
  }
  return '?';
}
/** The switch or member read from plan() (plan().x -> x). */
function planMember(call: ts.CallExpression): string {
  const p = call.parent;
  return ts.isPropertyAccessExpression(p) ? p.name.text : ts.isElementAccessExpression(p) ? `[${p.argumentExpression.getText()}]` : '(whole)';
}

// pass 1: setter scopes
function scanSetters(n: ts.Node) {
  if (ts.isCallExpression(n) && resolve(n.getSourceFile().fileName) !== PRICING) {
    const ex = pricingExport(checker.getSymbolAtLocation(ts.isPropertyAccessExpression(n.expression) ? n.expression.name : n.expression));
    if (ex && (SETTERS as readonly string[]).includes(ex)) {
      const setter = ex as SetterName;
      const u = unitAt(n);
      const values: Record<string, string> = {};
      let fields: string[] = [];
      let cb: ts.Node | null = null;
      if (setter === 'asSide') {
        fields = ['side', 'plan'];
        values.side = n.arguments[0].getText();
        values.plan = 'planWith(base, sideOff[side]) or base';
        cb = n.arguments[1];
      } else if (setter === 'noteDecision') {
        fields = ['known', 'anchor'];
        values.known = n.arguments[0].getText();
        values.anchor = n.arguments[1].getText();
      } else {
        const patch = n.arguments[0];
        if (ts.isObjectLiteralExpression(patch))
          for (const p of patch.properties) {
            const k = p.name?.getText() ?? '?';
            fields.push(k);
            values[k] = ts.isPropertyAssignment(p) ? p.initializer.getText() : ts.isShorthandPropertyAssignment(p) ? k : p.getText();
          }
        else fields.push(`(${patch.getText()})`);
        if (setter === 'withPricing') cb = n.arguments[1];
      }
      const sc: Scope = { id: `${u.file}:${lineOf(n)}:${setter}`, setter, file: u.file, unit: u.id, line: lineOf(n), node: n, cb, fields, values, callee: [n.expression.getStart(), n.expression.getEnd()] };
      scopes.push(sc);
      if (cb) scopeByCb.set(cb, sc);
    }
  }
  ts.forEachChild(n, scanSetters);
}
for (const sf of files) scanSetters(sf);

// pass 2: reads and edges
const byName: { at: string; name: string; n: number }[] = [];
function scanCalls(n: ts.Node) {
  const inPricing = resolve(n.getSourceFile().fileName) === PRICING;
  if (ts.isIdentifier(n) && !(ts.isVariableDeclaration(n.parent) && n.parent.name === n)) {
    const fns = tableFns.get(resolveAlias(checker.getSymbolAtLocation(n))!);
    if (fns) for (const t of fns) edges.push({ from: unitAt(n).id, to: t.id, line: lineOf(n), scopes: scopesAt(n), kind: 'value' });
  }
  if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
    const callee = n.expression;
    const ex = pricingExport(checker.getSymbolAtLocation(ts.isPropertyAccessExpression(callee) ? callee.name : callee));
    const u = unitAt(n);
    if (ex && (READERS as readonly string[]).includes(ex) && !inPricing && ts.isCallExpression(n)) {
      if (ex === 'pricing') {
        const p = n.parent;
        const push = (field: string, at: ts.Node) => reads.push({ what: 'pricing()', field, file: u.file, unit: u.id, line: lineOf(at), scopes: scopesAt(at), use: useOf(at), text: at.parent.getText().slice(0, 140), at: [at.getStart(), at.getEnd()] });
        if (ts.isPropertyAccessExpression(p)) push(p.name.text, p);
        else if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) {
          // a local holding the context: each c.field read in the unit
          const local = checker.getSymbolAtLocation(p.name);
          const walk = (m: ts.Node) => {
            if (ts.isPropertyAccessExpression(m) && ts.isIdentifier(m.expression) && checker.getSymbolAtLocation(m.expression) === local) push(m.name.text, m);
            ts.forEachChild(m, walk);
          };
          walk(u.node);
        } else push('(whole)', n);
      } else {
        const field = ex === 'plan' ? `plan.${planMember(n)}` : ex === 'actingSide' ? 'side' : ex === 'planSide' ? 'side' : ex === 'leafHandByCard' ? 'leaves' : '(key)';
        reads.push({ what: `${ex}()`, field, file: u.file, unit: u.id, line: lineOf(n), scopes: scopesAt(n), use: useOf(n), text: n.parent.getText().slice(0, 140), at: [n.getStart(), n.getEnd()] });
      }
    } else if (!ex) {
      let ts_ = targetsOf(callee);
      // A member the checker resolves only to a signature of a structural type (`{ verdict(): ... }` built in one file and
      // read through another's type): every src/ai member of that name
      if (!ts_.length && u.file.startsWith('src/ai/')) {
        let c: ts.Expression = callee;
        while (ts.isParenthesizedExpression(c) || ts.isNonNullExpression(c)) c = c.expression;
        if (ts.isPropertyAccessExpression(c)) {
          const sym = resolveAlias(checker.getSymbolAtLocation(c.name));
          const sigOnly = !!sym?.declarations?.length && sym.declarations.every(d => (ts.isMethodSignature(d) || ts.isPropertySignature(d)) && d.getSourceFile().fileName.startsWith(resolve('src')));
          if (sigOnly) {
            ts_ = units.filter(x => x.file.startsWith('src/ai/') && x.name.endsWith(`.${c.name.text}`));
            if (ts_.length) byName.push({ at: `${u.file}:${lineOf(n)}`, name: c.name.text, n: ts_.length });
          }
        }
      }
      const kind = byName.length && byName[byName.length - 1].at === `${u.file}:${lineOf(n)}` && ts_.length && !targetsOf(callee).length ? 'name' : 'call';
      for (const t of ts_) edges.push({ from: u.id, to: t.id, line: lineOf(n), scopes: scopesAt(n), kind });
    }
    // function values handed to a call (callbacks), including the setter's own callback when it is a reference
    for (const a of n.arguments ?? []) {
      if (ts.isIdentifier(a) || ts.isPropertyAccessExpression(a)) {
        const ts_ = targetsOf(a).filter(t => isFn(t.node) || ts.isMethodDeclaration(t.node));
        const sc = scopeByCb.get(a);
        for (const t of ts_) edges.push({ from: u.id, to: t.id, line: lineOf(n), scopes: [...(sc ? [sc.id] : []), ...scopesAt(n)], kind: 'value' });
      }
    }
  }
  ts.forEachChild(n, scanCalls);
}
for (const sf of files) scanCalls(sf);

// memo(state, key, work) calls (valueModel.ts): the work's line span, so a cache's fill can be read from the edges in it
type MemoCall = { unit: string; line: number; key: string; from: number; to: number };
const memoCalls: MemoCall[] = [];
// Module-level variables of src/ai and every place that writes or reads them (part 1 item 8)
type VarRef = { unit: string; line: number; write: string | null };
type ModVar = { id: string; file: string; name: string; line: number; kind: string; init: string; refs: VarRef[] };
const modVars: ModVar[] = [];
const MUTATORS = new Set(['set', 'add', 'delete', 'clear', 'push', 'pop', 'splice', 'shift', 'unshift', 'sort', 'length']);
{
  const bySym = new Map<ts.Symbol, ModVar>();
  for (const sf of files) {
    if (!rel(sf.fileName).startsWith('src/ai/')) continue;
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st)) continue;
      const kind = st.declarationList.flags & ts.NodeFlags.Let ? 'let' : 'const';
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        const i = d.initializer;
        // functions, literals of data and plain constants are not state: keep lets, and consts holding a collection or an object
        if (kind === 'const' && !(ts.isNewExpression(i) || ts.isObjectLiteralExpression(i) || ts.isArrayLiteralExpression(i))) continue;
        const sym = checker.getSymbolAtLocation(d.name);
        if (!sym) continue;
        const v: ModVar = { id: `${rel(sf.fileName)}:${d.name.text}`, file: rel(sf.fileName), name: d.name.text, line: lineOf(d), kind, init: i.getText().slice(0, 80), refs: [] };
        modVars.push(v);
        bySym.set(sym, v);
      }
    }
  }
  const walk = (n: ts.Node) => {
    if (ts.isIdentifier(n) && !(ts.isVariableDeclaration(n.parent) && n.parent.name === n)) {
      const v = bySym.get(resolveAlias(checker.getSymbolAtLocation(n))!);
      if (v) {
        let write: string | null = null;
        const p = n.parent;
        const assignOp = (b: ts.Node) => ts.isBinaryExpression(b) && b.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && b.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
        if (assignOp(p) && (p as ts.BinaryExpression).left === n) write = 'assigned';
        else if ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(p.operator)) write = 'assigned';
        else if (ts.isPropertyAccessExpression(p) && p.expression === n) {
          const pp = p.parent;
          if (ts.isCallExpression(pp) && pp.expression === p && MUTATORS.has(p.name.text)) write = `.${p.name.text}()`;
          else if (assignOp(pp) && (pp as ts.BinaryExpression).left === p) write = `.${p.name.text} =`;
          else if ((ts.isPrefixUnaryExpression(pp) || ts.isPostfixUnaryExpression(pp)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(pp.operator)) write = `.${p.name.text}++`;
          else if (ts.isPropertyAccessExpression(pp) || ts.isElementAccessExpression(pp)) {
            // counters a level down: stats.group.field++ / x.y[z] = ...
            const q = pp.parent;
            if ((assignOp(q) && (q as ts.BinaryExpression).left === pp) || ((ts.isPrefixUnaryExpression(q) || ts.isPostfixUnaryExpression(q)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(q.operator))) write = `.${p.name.text}.* =`;
          }
        } else if (ts.isElementAccessExpression(p) && p.expression === n && assignOp(p.parent) && (p.parent as ts.BinaryExpression).left === p) write = '[k] =';
        else if (ts.isCallExpression(p) && p.arguments.includes(n as ts.Expression) && /scopeToGame/.test(p.expression.getText())) write = 'scopeToGame()';
        v.refs.push({ unit: unitAt(n).id, line: lineOf(n), write });
      }
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'memo' && n.arguments.length === 3) {
      const w = n.arguments[2];
      const sfx = n.getSourceFile();
      memoCalls.push({ unit: unitAt(n).id, line: lineOf(n), key: n.arguments[1].getText().slice(0, 90), from: sfx.getLineAndCharacterOfPosition(w.getStart()).line + 1, to: sfx.getLineAndCharacterOfPosition(w.getEnd()).line + 1 });
    }
    ts.forEachChild(n, walk);
  };
  for (const sf of files) walk(sf);
}

// Calls the checker cannot follow, added by hand (each with its reason)
const MANUAL: [from: string, to: string, why: string][] = [
  // oracle.ts holds the play-out's runner as a structural type ({ step(): boolean; state }): its step() is GameRunner.step
  ['src/ai/oracle.ts:runnerNextTurn@', 'src/ai/playout.ts:GameRunner.step@', 'OraclePlayout is a structural type; runnerReply.ts:16 hands in a GameRunner'],
];
for (const [from, to, why] of MANUAL) {
  const f = units.find(u => u.id.startsWith(from));
  const t = units.find(u => u.id.startsWith(to));
  if (!f || !t) throw new Error(`manual edge not found: ${from} -> ${to}`);
  const line = edges.find(e => e.from === f.id && e.to.includes('setOraclePlayout(callback)'))?.line ?? f.line;
  edges.push({ from: f.id, to: t.id, line, scopes: edges.find(e => e.from === f.id && e.line === line)?.scopes ?? [], kind: 'call' });
  console.log(`manual edge ${f.id} -> ${t.id}: ${why}`);
}

// Readers inside pricing.ts's exported readers are the readers themselves: their fields, for the table
const readerFields: Record<string, string[]> = {
  plan: ['plan'],
  actingSide: ['side'],
  planSide: ['side'],
  leafHandByCard: ['leaves', 'plan', '(basePlan)'],
  pricingKey: ['side', 'plan', 'leaves', 'averaging', 'pricingRootDeck', 'pricingTagLoss', 'pricingIce', 'countingHold', 'planning', 'oracleRunning', 'pricingBreaker'],
  deckPricingKey: ['(pricingKey less pricingBreaker)'],
};

writeFileSync(
  OUT,
  JSON.stringify(
    {
      units: units.map(u => ({ id: u.id, file: u.file, name: u.name, line: u.line, literal: literalOf.get(u.id) })),
      edges,
      scopes: scopes.map(({ cb, ...s }) => ({ ...s, node: undefined, cb: cb ? cb.getText().slice(0, 100) : null })),
      reads,
      readerFields,
      memoCalls,
      modVars,
      byName,
    },
    null,
    1
  )
);
console.log(`units ${units.length}, edges ${edges.length}, setter calls ${scopes.length}, reads ${reads.length} -> ${OUT}`);
