/**
 * F3 build (brief-build.md rev 1, note 1): the three maps' arms as POINT patches. Only the key line, the lookup lines,
 * the set line and the cap clear are rewritten; the lines that work the value out are never touched, so an arm stays
 * honest on a base whose value code moved (R-14h: drawWorth's `when` and money, clickWorth's `repeatable` line).
 *
 * Each point is a regex that must match exactly once in its file (a stop otherwise). Variants: 'base' (src's key, with
 * the count's hooks) and 'byState' (the map on the GameState object, the inner key only what is not in the state).
 * On a base with R-14h's drawWorth (third argument `when`, a `money` local), deckAverage's inner key takes the money,
 * not `when` (rev 1, finding 3), and the audit's recompute is passed [side, when].
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type PointVariant = 'base' | 'byState';
const H = `(globalThis as any).__ck`;

function point(dir: string, file: string, re: RegExp, to: string | ((m: string) => string), what: string) {
  const path = join(dir, 'src', file);
  const src = readFileSync(path, 'utf8');
  const all = [...src.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))];
  if (all.length !== 1) throw new Error(`${what}: ${all.length} matches (want 1) in ${file}: ${re.source.slice(0, 100)}`);
  const m = all[0];
  const text = typeof to === 'string' ? to : to(m[0]);
  writeFileSync(path, src.slice(0, m.index!) + text + src.slice(m.index! + m[0].length));
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether this tree's drawWorth takes `when` (R-14h). */
export const hasWhen = (dir: string) => /function drawWorth\(state: GameState, side: SideCode, when: DrawWhen\)/.test(readFileSync(join(dir, 'src/ai/handValues.ts'), 'utf8'));

export function threatsPoints(dir: string, tree: string, v: PointVariant) {
  const F = 'ai/effectValues.ts';
  const w = (what: string) => `${tree} threats ${what}`;
  // The key line (and, for byState, the count only it read)
  point(dir, F, /^ {2}const key = `\$\{state\.id\}:\$\{state\.corp\.archives\.faceUp\.length\}:.*`;\n/m, m => (v === 'byState' ? '  const key = `${skipIce}:${own}`;\n' : m) + `  const __H = ${H};\n  __H?.call('${tree}', 'threats');\n`, w('key'));
  if (v === 'byState') point(dir, F, /^ {2}const count = corp\.hq\.length \+ .*;\n/m, '', w('count'));
  const get = v === 'byState' ? `  let __in = __threatsBS.get(state);\n  if (!__in) __threatsBS.set(state, (__in = new Map()));\n  const cached = __in.get(key);` : '  const cached = threats.get(key);';
  const ref = v === 'byState' ? '[state, key]' : 'key';
  point(dir, F, new RegExp(esc('  scopeToGame(threats, state);\n  const cached = threats.get(key);\n  if (cached && !threatsAudit.on) return cached;\n')), `${v === 'byState' ? '' : '  scopeToGame(threats, state);\n'}${get}\n  if (cached && !threatsAudit.on) return __H ? __H.hit('${tree}', 'threats', cached, state, corpTurn, ${ref}) : cached;\n  __H?.miss('${tree}', 'threats');\n`, w('lookup'));
  point(dir, F, new RegExp(esc('  if (threats.size > 200) threats.clear();\n')), v === 'byState' ? '' : `  if (threats.size > 200) {\n    threats.clear();\n    __H?.clear('${tree}', 'threats');\n  }\n`, w('cap'));
  point(dir, F, new RegExp(esc('  threats.set(key, threat);\n')), `  ${v === 'byState' ? '__in' : 'threats'}.set(key, threat);\n  __H?.fill('${tree}', 'threats', threat, state, corpTurn, ${ref});\n`, w('set'));
}

export function deckPoints(dir: string, tree: string, v: PointVariant) {
  const F = 'ai/handValues.ts';
  const w = (what: string) => `${tree} deckAverage ${what}`;
  const when = hasWhen(dir);
  const x = when ? '[side, when]' : 'side';
  point(dir, F, /^ {2}const key = `\$\{deckPricingKey\(\)\}:\$\{side\}:\$\{state\.id\}:.*`;\n/m, m => (v === 'byState' ? `  const key = \`\${deckPricingKey()}:\${side}:${when ? '${money}:' : ''}\${__ckCtx(true)}\`;\n` : m) + `  const __H = ${H};\n  __H?.call('${tree}', 'deckAverage');\n`, w('key'));
  if (v === 'byState') {
    // What only the string key read (the credits and the board print), dropped as the branch drops it
    point(dir, F, /^ {2}const credits = `\$\{side === 'corp' \? state\.corp\.credits : state\.runner\.credits\}:.*`;\n/m, '', w('credits'));
    point(dir, F, new RegExp(esc('  const board = `${fingerprint(state)}:`;\n')), '', w('board'));
  }
  const get = v === 'byState' ? `  let __in = __deckBS.get(state);\n  if (!__in) __deckBS.set(state, (__in = new Map()));\n  const cached = __in.get(key);` : '  const cached = deckAverage.get(key);';
  const ref = v === 'byState' ? '[state, key]' : 'key';
  point(dir, F, new RegExp(esc('  scopeToGame(deckAverage, state);\n  const cached = deckAverage.get(key);\n  if (cached !== undefined && !drawAudit.on) return cached;\n')), `${v === 'byState' ? '' : '  scopeToGame(deckAverage, state);\n'}${get}\n  if (cached !== undefined && !drawAudit.on) return __H ? __H.hit('${tree}', 'deckAverage', cached, state, ${x}, ${ref}) : cached;\n  __H?.miss('${tree}', 'deckAverage');\n`, w('lookup'));
  point(dir, F, new RegExp(esc('  if (deckAverage.size > 500) deckAverage.clear();\n')), v === 'byState' ? '' : `  if (deckAverage.size > 500) {\n    deckAverage.clear();\n    __H?.clear('${tree}', 'deckAverage');\n  }\n`, w('cap'));
  point(dir, F, new RegExp(esc('  deckAverage.set(key, value);\n')), `  ${v === 'byState' ? '__in' : 'deckAverage'}.set(key, value);\n  __H?.fill('${tree}', 'deckAverage', value, state, ${x}, ${ref});\n`, w('set'));
}

export function clickPoints(dir: string, tree: string, v: PointVariant) {
  const F = 'ai/handValues.ts';
  const w = (what: string) => `${tree} clickCache ${what}`;
  point(dir, F, /^ {2}const key = `\$\{pricingKey\(\)\}:\$\{side\}:\$\{state\.id\}:\$\{state\.turnNumber\}:\$\{player\.clicks\}:.*`;\n/m, m => (v === 'byState' ? '  const key = `${pricingKey()}:${side}:${__ckCtx(true)}`;\n' : m) + `  const __H = ${H};\n  __H?.call('${tree}', 'clickCache');\n`, w('key'));
  const get = v === 'byState' ? `  let __in = __clickBS.get(state);\n  if (!__in) __clickBS.set(state, (__in = new Map()));\n  const cached = __in.get(key);` : '  const cached = clickCache.get(key);';
  const ref = v === 'byState' ? '[state, key]' : 'key';
  point(dir, F, new RegExp(esc('  scopeToGame(clickCache, state);\n  const cached = clickCache.get(key);\n  if (cached !== undefined && !clickAudit.on) return cached;\n')), `${v === 'byState' ? '' : '  scopeToGame(clickCache, state);\n'}${get}\n  if (cached !== undefined && !clickAudit.on) return __H ? __H.hit('${tree}', 'clickCache', cached, state, side, ${ref}) : cached;\n  __H?.miss('${tree}', 'clickCache');\n`, w('lookup'));
  point(dir, F, new RegExp(esc('  if (clickCache.size > 2000) clickCache.clear();\n')), v === 'byState' ? '' : `  if (clickCache.size > 2000) {\n    clickCache.clear();\n    __H?.clear('${tree}', 'clickCache');\n  }\n`, w('cap'));
  point(dir, F, new RegExp(esc('  clickCache.set(key, value);\n')), `  ${v === 'byState' ? '__in' : 'clickCache'}.set(key, value);\n  __H?.fill('${tree}', 'clickCache', value, state, side, ${ref});\n`, w('set'));
}

/**
 * The build branch's own lines (F3 build, ai-cache-keys): the same hooks as a byState arm, laid on the branch's key,
 * lookup and set lines unchanged, so bar 1 compares the branch's calls, hits and misses with allP.byState's.
 */
export function branchPoints(dir: string, tree: string) {
  const sites: [string, string, string, string, string][] = [
    ['ai/effectValues.ts', 'threats', 'cached && !threatsAudit.on', 'threat', 'corpTurn'],
    ['ai/handValues.ts', 'deckAverage', 'cached !== undefined && !drawAudit.on', 'value', hasWhen(dir) ? '[side, when]' : 'side'],
    ['ai/handValues.ts', 'clickCache', 'cached !== undefined && !clickAudit.on', 'value', 'side'],
  ];
  for (const [F, map, test, v, x] of sites) {
    const w = (what: string) => `${tree} ${map} ${what}`;
    point(dir, F, new RegExp(`^ {2}const entries = stateEntries\\(${map}, state\\);\\n {2}const cached = entries\\.get\\(key\\);\\n {2}if \\(${esc(test)}\\) return cached;\\n`, 'm'), `  const __H = ${H};\n  __H?.call('${tree}', '${map}');\n  const entries = stateEntries(${map}, state);\n  const cached = entries.get(key);\n  if (${test}) return __H ? __H.hit('${tree}', '${map}', cached, state, ${x}, [state, key]) : cached;\n  __H?.miss('${tree}', '${map}');\n`, w('lookup'));
    // The set line: the one `entries.set(key, <v>);` after this map's lookup
    const path = join(dir, 'src', F);
    const src = readFileSync(path, 'utf8');
    const at = src.indexOf(`__H?.miss('${tree}', '${map}');`);
    const set = `  entries.set(key, ${v});\n`;
    const i = src.indexOf(set, at);
    if (at < 0 || i < 0) throw new Error(`${w('set')}: not found in ${F}`);
    writeFileSync(path, src.slice(0, i) + set + `  __H?.fill('${tree}', '${map}', ${v}, state, ${x}, [state, key]);\n` + src.slice(i + set.length));
  }
}
