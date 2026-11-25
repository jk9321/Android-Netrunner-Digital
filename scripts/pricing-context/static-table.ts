/**
 * R-B B1b's first step (brief b1b-context-table.md rev 0, tracker R-12a), part 1: renders static-graph.ts's JSON as the
 * table's generated sections (setters, readers, what can be above each reader by side, reads that can see the default
 * context, caches, module state). The one-line "what it is" per field and the reading of the table are written by hand in
 * the note (b1b/part1-static-table.md); this file only computes.
 *
 *   npx vite-node scripts/pricing-context/static-graph.ts -- OUT=/tmp/pricing-static.json
 *   npx vite-node scripts/pricing-context/static-table.ts -- IN=/tmp/pricing-static.json OUT=/tmp/pricing-static.md
 *
 * Reach: BFS over the call graph (static-graph.ts: over-approximate, a path in the graph is not a path a game takes).
 *   R  units reachable from an asSide('runner') callback (HeuristicRunnerAI.chooseAction, chooseOffTurn)
 *   C  units reachable from an asSide('corp') callback (HeuristicCorpAI.chooseAction, chooseRez)
 *   H  units reachable from SearchAI's asSide(this.side) (the Hard AI, either side)
 *   R° / C°  the same, not crossing the other side's asSide (the deciding side is still the outer one at the read)
 * Default: a unit reachable from the play roots (GameRunner, the worker, the UI) along edges outside every scope that sets
 * the field; "tests/scripts" if only from a unit with no caller in src (an export a test or script calls).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).filter(a => a.includes('=')).map(a => a.split('=') as [string, string]));
const J = JSON.parse(readFileSync(args.IN ?? '/tmp/pricing-static.json', 'utf8'));
const OUT = args.OUT ?? '/tmp/pricing-static.md';

type Edge = { from: string; to: string; line: number; scopes: string[]; kind: string };
type Scope = { id: string; setter: string; file: string; unit: string; line: number; fields: string[]; values: Record<string, string>; cb: string | null };
type Read = { what: string; field: string; file: string; unit: string; line: number; scopes: string[]; use: string; text: string };
const edges: Edge[] = J.edges;
const scopes: Scope[] = J.scopes;
const reads: Read[] = J.reads;
const units: { id: string; file: string; name: string; line: number }[] = J.units;
const out: string[] = [];
const p = (s = '') => out.push(s);
const short = (u: string) => u.replace(/^src\/ai\//, '').replace(/^src\//, '');
const fnName = (u: string) => u.split(':').slice(1).join(':').replace(/@\d+$/, '');

// Setter ids: S1.. in file order
scopes.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
const sid = new Map(scopes.map((s, i) => [s.id, `S${i + 1}`]));
const byFrom = new Map<string, Edge[]>();
for (const e of edges) byFrom.set(e.from, [...(byFrom.get(e.from) ?? []), e]);
const startsOf = new WeakMap<Map<string, Edge | null>, Set<Edge>>();
const callers = new Map<string, Edge[]>();
for (const e of edges) callers.set(e.to, [...(callers.get(e.to) ?? []), e]);

/**
 * Inside a decision every GameRunner is built with the rule-based agents (search.ts:128 heuristicFor, runnerReply.ts:16
 * and :253): its calls through the Agent interface reach HeuristicCorpAI and HeuristicRunnerAI, never SearchAI (only
 * index.ts:36 playGame, which no decision calls, takes agents from outside). So a reach that starts inside a setter's
 * scope does not follow GameRunner -> SearchAI; a reach from the play roots does.
 */
const innerDispatch = (e: Edge) => !(/^src\/ai\/playout\.ts:GameRunner\./.test(e.from) && /^src\/ai\/search\.ts:SearchAI\./.test(e.to));
/** BFS from the edges inside `start` scopes; edges inside a `block` scope are not followed. Returns unit -> parent edge. */
// A callback written in an object literal (PlannerAI.rank, RunnerContext.remember, CorpContext.rank, RunStand.verdict)
// is reached only below a call of the function that builds the literal: the Runner's planner hands planTurn its own
// literal, not the Corp's. The reach carries, per interface member, the builders called on the path so far.
type Lit = { iface: string[]; builder: string };
// keyed by the interface (PlannerAI), not the member: the Runner's literal has no `line`, the Corp's does
const literal = new Map<string, Lit>(
  units
    .filter(u => (u as { literal?: Lit }).literal && u.file.startsWith('src/ai/') && !(u as { literal?: Lit }).literal!.builder.endsWith(':<module>'))
    .map(u => {
      const l = (u as unknown as { literal: Lit }).literal;
      return [u.id, { iface: [...new Set(l.iface.map(i => i.split('.')[0]))].filter(i => i !== '?' && i !== '__type').map(i => (i.startsWith('ret:') ? l.iface.find(x => x.startsWith('ret:'))! : i)), builder: l.builder }];
    })
);
const buildsFor = new Map<string, string[]>(); // builder unit -> interface members it builds
for (const [, l] of literal) for (const i of l.iface) buildsFor.set(l.builder, [...new Set([...(buildsFor.get(l.builder) ?? []), i])]);
type Ctx = Record<string, string[]>;
const withBuilders = (c: Ctx, u: string): Ctx => {
  // u itself, and every builder u calls, are on the path for u's descendants
  let out = c;
  const add = (b: string) => {
    for (const i of buildsFor.get(b) ?? []) {
      const have = out[i] ?? [];
      if (!have.includes(b)) out = { ...out, [i]: [...have, b].sort() };
    }
  };
  add(u);
  for (const e of byFrom.get(u) ?? []) {
    if (buildsFor.has(e.to)) add(e.to);
    // a builder called from a callback u calls (planTurn's ai.line() -> HeuristicCorpAI.plan.line -> playoutLine)
    if (literal.has(e.to) && allowed(c, e.to, e)) for (const f of byFrom.get(e.to) ?? []) if (buildsFor.has(f.to)) add(f.to);
  }
  return out;
};
const allowed = (c: Ctx, to: string, e?: Edge) => {
  const l = literal.get(to);
  if (!l) return true;
  // a call matched by member name only (static-graph.ts: a structural type) reaches a literal only below its builder
  if (e?.kind === 'name') return l.iface.some(i => c[i]?.includes(l.builder));
  return l.iface.some(i => !c[i] || c[i].includes(l.builder));
};
const ctxKey = (c: Ctx) => Object.keys(c).sort().map(k => `${k}=${c[k].join(',')}`).join(';');
/** BFS from the edges inside `start` scopes; edges inside a `block` scope are not followed. Returns unit -> parent edge. */
function reach(start: Set<string>, block: Set<string> = new Set(), fromUnits: string[] = [], also: (e: Edge) => boolean = () => true): Map<string, Edge | null> {
  const ok = start.size ? (e: Edge) => innerDispatch(e) && also(e) : also;
  const seen = new Map<string, Edge | null>();
  const states = new Set<string>();
  const startEdges = new Set<Edge>();
  startsOf.set(seen, startEdges);
  const queue: [string, Ctx][] = [];
  const push = (u: string, c: Ctx, e: Edge | null) => {
    const c2 = withBuilders(c, u);
    const k = `${u}|${ctxKey(c2)}`;
    if (states.has(k)) return;
    states.add(k);
    if (!seen.has(u)) seen.set(u, e);
    queue.push([u, c2]);
  };
  for (const u of fromUnits) push(u, {}, null);
  for (const e of edges)
    if (e.scopes.some(s => start.has(s)) && !e.scopes.some(s => block.has(s)) && ok(e)) {
      const c0 = withBuilders({}, e.from);
      if (!allowed(c0, e.to, e)) continue;
      if (!seen.has(e.to)) startEdges.add(e);
      push(e.to, c0, e);
    }
  while (queue.length) {
    const [u, c] = queue.shift()!;
    for (const e of byFrom.get(u) ?? []) {
      if (e.scopes.some(s => block.has(s)) || !ok(e) || !allowed(c, e.to, e)) continue;
      push(e.to, c, e);
    }
  }
  return seen;
}
const asSides = scopes.filter(s => s.setter === 'asSide');
const runnerSites = new Set(asSides.filter(s => s.values.side === "'runner'").map(s => s.id));
const corpSites = new Set(asSides.filter(s => s.values.side === "'corp'").map(s => s.id));
const hardSites = new Set(asSides.filter(s => s.values.side === 'this.side').map(s => s.id));
const R = reach(runnerSites);
const C = reach(corpSites);
const H = reach(hardSites);
// ° = the side's own paths: no GameRunner (no reply sample, oracle or Hard playout: the other side's agent is not asked)
// and not inside the other side's asSide
const noRunner = (e: Edge) => !/^src\/ai\/playout\.ts:GameRunner\./.test(e.to);
const Ri = reach(runnerSites, new Set([...corpSites, ...hardSites]), [], noRunner);
const Ci = reach(corpSites, new Set([...runnerSites, ...hardSites]), [], noRunner);
const sideTag = (unit: string, lex: string[] = []) => {
  const t: string[] = [];
  const lr = lex.some(s => runnerSites.has(s));
  const lc = lex.some(s => corpSites.has(s));
  const lh = lex.some(s => hardSites.has(s));
  if (lr || R.has(unit)) t.push(lr || Ri.has(unit) ? 'R°' : 'R');
  if (lc || C.has(unit)) t.push(lc || Ci.has(unit) ? 'C°' : 'C');
  if (lh || H.has(unit)) t.push('H');
  return t.join(' ') || '-';
};

// Play roots and other roots
const PLAY = (u: string) => /^src\/ai\/playout\.ts:GameRunner\.step@|^src\/ai\/worker\.ts:|^src\/ui\/|^src\/App\.tsx|^src\/main\.tsx/.test(u);
const playRoots = units.filter(u => PLAY(u.id)).map(u => u.id);
const noCaller = units.filter(u => !callers.has(u.id) && !u.name.startsWith('<module>') && u.file.startsWith('src/ai/')).map(u => u.id);

/** The chain of units from a root to `u` (from a reach map). */
function chain(m: Map<string, Edge | null>, u: string): string {
  const path: string[] = [];
  const seen = new Set<string>();
  for (let at: string | undefined = u; at && !seen.has(at); ) {
    seen.add(at);
    path.unshift(fnName(at));
    const e = m.get(at);
    if (!e) break;
    if (startsOf.get(m)?.has(e)) {
      path.unshift(`${fnName(e.from)}[${e.scopes.map(x => sid.get(x) ?? x).join(',')}]`);
      break;
    }
    at = e.from;
  }
  return path.join(' > ');
}

// Which setter sites set each field
const FIELDS = ['side', 'plan', 'frozen', 'known', 'anchor', 'leaves', 'averaging', 'pricingRootDeck', 'pricingTagLoss', 'pricingIce', 'countingHold', 'planning', 'decisionSeed', 'rezzingToUse', 'pricingBreaker', 'oracleRunning', 'diagnostics'];
const settersOf = (f: string) => scopes.filter(s => s.fields.includes(f));
const scopeSetters = new Map(FIELDS.map(f => [f, new Set(settersOf(f).filter(s => s.setter !== 'noteDecision').map(s => s.id))]));
const readField = (r: Read) => (r.field.startsWith('plan.') ? 'plan' : r.field === '(key)' ? 'side' : r.field);
const reachSetter = new Map(scopes.map(s => [s.id, reach(new Set([s.id]))]));

// ------------------------------------------------------------------------------------------------ setters
p('## Generated: the setters (part 1 items 2 and 7)');
p();
p('Every call of the four entry points outside `pricing.ts` (the checker resolves imports and re-exports; a comment that names one is not a call). Side: R/C/H as in the header (° = the deciding side has not changed between the asSide and this call). Restore: what puts the value back.');
p();
p('| id | file:line | function | entry | fields = value | restore | whose decision (R/C/H) |');
p('|---|---|---|---|---|---|---|');
const RESTORE: Record<string, string> = { withPricing: 'finally (holdPricing undo in withPricing)', asSide: 'finally (withPricing); basePlan reset by the outermost', holdPricing: 'an undo the caller runs (installDiagnostics: never)', noteDecision: 'never (stays until the next note)' };
for (const s of scopes) {
  const vals = s.fields.map(f => `${f} = \`${(s.values[f] ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, 70)}\``).join('; ');
  p(`| ${sid.get(s.id)} | ${short(s.file)}:${s.line} | ${fnName(s.unit)} | ${s.setter} | ${vals} | ${RESTORE[s.setter]} | ${s.setter === 'asSide' ? (s.values.side === 'this.side' ? 'H (either)' : s.values.side === "'runner'" ? 'R (sets it)' : 'C (sets it)') : sideTag(s.unit)} |`);
}
const files = new Set(scopes.map(s => s.file));
p();
p(`${scopes.length} calls in ${files.size} files (${[...files].map(short).join(', ')}). By entry point: ${['asSide', 'withPricing', 'holdPricing', 'noteDecision'].map(e => `${e} ${scopes.filter(s => s.setter === e).length}`).join(', ')}.`);
p();

// ------------------------------------------------------------------------------------------------ readers
p('## Generated: the readers (part 1 items 3 and 5)');
p();
p('Every read of a field (`pricing().f`, or a local holding `pricing()`) and every call of an exported reader outside `pricing.ts`. Use: what the expression does with the value (from the syntax, checked by hand in the note). Above: the setter calls that can be on the stack above the read (lexically around it, or with the read\'s function reachable from the setter\'s callback); sides as above. Default: whether the read can run with no setter of its field above it, from a play root (GameRunner, worker, UI) or only from an export with no caller in src (tests and scripts). `plan()` reads are listed by switch; their default is `tuning.plan`.');
p();
p('| file:line | function | reads | use | sides | setters that can be above | default (no setter of the field above) |');
p('|---|---|---|---|---|---|---|');
const sortedReads = [...reads].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
const defaultOf = new Map<string, string>();
for (const f of FIELDS) {
  const block = scopeSetters.get(f)!;
  const inPlay = reach(new Set(), block, playRoots);
  const inAny = reach(new Set(), block, noCaller);
  for (const r of reads.filter(r => readField(r) === f)) {
    const k = `${r.file}:${r.line}:${r.field}`;
    if (f === 'known' || f === 'anchor') {
      defaultOf.set(k, 'not scoped: the last noteDecision (null before the first)');
      continue;
    }
    if (f === 'diagnostics' || f === 'rezzingToUse') {
      defaultOf.set(k, f === 'rezzingToUse' ? 'the shared Set (mutated in place)' : 'null in play');
      continue;
    }
    if (r.scopes.some(s => block.has(s))) defaultOf.set(k, 'no (a setter wraps it)');
    else if (inPlay.has(r.unit)) defaultOf.set(k, `**play**: ${chain(inPlay, r.unit)}`);
    else if (inAny.has(r.unit)) defaultOf.set(k, `tests/scripts only: ${chain(inAny, r.unit)}`);
    else defaultOf.set(k, 'no');
  }
}
for (const r of sortedReads) {
  const above = scopes.filter(s => r.scopes.includes(s.id) || reachSetter.get(s.id)!.has(r.unit)).map(s => sid.get(s.id)!);
  const k = `${r.file}:${r.line}:${r.field}`;
  p(`| ${short(r.file)}:${r.line} | ${fnName(r.unit)} | ${r.what === 'pricing()' ? `\`${r.field}\`` : r.what === 'plan()' ? `plan() .${r.field.slice(5)}` : `${r.what}`} | ${r.use} | ${sideTag(r.unit, r.scopes)} | ${above.join(' ') || '-'} | ${defaultOf.get(k) ?? '-'} |`);
}
p();
const per: Record<string, number> = {};
for (const r of reads) per[r.what] = (per[r.what] ?? 0) + 1;
p(`${reads.length} reads: ${Object.entries(per).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
p();

// Per field: setters, reads, sides that reach a read
p('## Generated: per field');
p();
p('| field | setter calls | reads (direct) | reads in R / C / H | setter calls in R / C / H | a read can see the default in play |');
p('|---|---|---|---|---|---|');
for (const f of FIELDS) {
  const ss = settersOf(f);
  const rs = reads.filter(r => readField(r) === f);
  const inS = (m: Map<string, unknown>, sites: Set<string>) => (r: Read) => m.has(r.unit) || r.scopes.some(s => sites.has(s));
  const rr = rs.filter(inS(R, runnerSites)).length, rc = rs.filter(inS(C, corpSites)).length, rh = rs.filter(inS(H, hardSites)).length;
  const sr = ss.filter(s => R.has(s.unit)).length, sc = ss.filter(s => C.has(s.unit)).length, sh = ss.filter(s => H.has(s.unit)).length;
  const play = rs.filter(r => (defaultOf.get(`${r.file}:${r.line}:${r.field}`) ?? '').startsWith('**play**')).length;
  p(`| ${f} | ${ss.map(s => sid.get(s.id)).join(' ') || '-'} | ${rs.length} | ${rr} / ${rc} / ${rh} | ${sr} / ${sc} / ${sh} | ${play ? `${play} of ${rs.length}` : 'none'} |`);
}
p();

// ------------------------------------------------------------------------------------------------ exported readers' callers
p('## Generated: the exported readers and their wrappers');
p();
const wrappers = [
  ['src/ai/effectValues.ts:pricingIce@', 'pricingIce (effectValues.ts:156, wraps the field)'],
  ['src/ai/turnPlanner.ts:currentDecisionSeed@', 'currentDecisionSeed (turnPlanner.ts:109)'],
  ['src/ai/turnPlanner.ts:decisionSeedFor@', 'decisionSeedFor (turnPlanner.ts:326)'],
  ['src/ai/handValues.ts:decisionContext@', 'decisionContext (handValues.ts:112, the only noteDecision)'],
  ['src/ai/corp/hold.ts:counted@', 'counted (corp/hold.ts:208, the only countingHold setter)'],
  ['src/ai/valueModel.ts:memo@', 'memo (valueModel.ts:150, keys by pricingKey)'],
  ['src/ai/diagnostics.ts:tally@', 'tally (diagnostics.ts:74)'],
  ['src/ai/diagnostics.ts:note@', 'note (diagnostics.ts:83)'],
  ['src/ai/diagnostics.ts:inReply@', 'inReply (diagnostics.ts:94)'],
];
p('| wrapper | call sites in src | callers in R / C / H |');
p('|---|---|---|');
for (const [prefix, label] of wrappers) {
  const u = units.find(x => x.id.startsWith(prefix));
  if (!u) continue;
  const cs = (callers.get(u.id) ?? []).filter(e => e.from !== u.id);
  const fromUnits = [...new Set(cs.map(e => e.from))];
  const tag = (m: Map<string, unknown>, sites: Set<string>) => cs.filter(e => m.has(e.from) || e.scopes.some(s => sites.has(s))).length;
  p(`| ${label} | ${cs.length} (${fromUnits.length} functions) | ${tag(R, runnerSites)} / ${tag(C, corpSites)} / ${tag(H, hardSites)} |`);
}
p();

// ------------------------------------------------------------------------------------------------ caches
p('## Generated: caches (part 1 item 4)');
p();
p('For each cache that holds a priced value: what its key carries of the context, and the context fields its fill can read (reach from the fill\'s function, or from the edges inside a memo callback). "Not in the key" = a field the fill can read that the key does not carry (static: can, not does).');
p();
type Cache = { name: string; fill: string; key: string[]; note: string };
const CACHES: Cache[] = [
  { name: 'valueModel.ts memos (memo())', fill: '', key: ['side', 'plan', 'leaves', 'averaging', 'pricingRootDeck', 'pricingTagLoss', 'pricingIce', 'countingHold', 'planning', 'oracleRunning', 'pricingBreaker'], note: 'pricingKey + the caller\'s key, per state object (fingerprint). R-20: omits the Runner\'s memory (deal 1151)' },
  { name: 'handValues.ts clickCache', fill: 'src/ai/handValues.ts:clickWorth@', key: ['side', 'plan', 'leaves', 'averaging', 'pricingRootDeck', 'pricingTagLoss', 'pricingIce', 'countingHold', 'planning', 'oracleRunning', 'pricingBreaker'], note: 'pricingKey; scopeToGame' },
  { name: 'handValues.ts deckAverage', fill: 'src/ai/handValues.ts:drawWorth@', key: ['side', 'plan', 'leaves', 'averaging', 'pricingRootDeck', 'pricingTagLoss', 'pricingIce', 'countingHold', 'planning', 'oracleRunning'], note: 'deckPricingKey (pricingKey less pricingBreaker); scopeToGame' },
  { name: 'anchor.deckValues (rootDeckAverage)', fill: 'src/ai/handValues.ts:priceAtRoot@', key: ['anchor', 'side', 'plan', 'leaves', 'averaging', 'pricingRootDeck', 'pricingTagLoss', 'pricingIce', 'countingHold', 'planning', 'oracleRunning'], note: 'on the anchor object (one per noted board), keyed deckPricingKey + side, then the card; the fill runs under averaging + pricingRootDeck' },
  { name: 'corp/hold.ts turnAnswers', fill: 'src/ai/corp/hold.ts:walkPick@', key: ['anchor'], note: 'WeakMap on the anchor object, then questionKey; no anchor = no cache' },
  { name: 'corp/hold.ts reachAnswers', fill: 'src/ai/corp/hold.ts:reachSetsOf@', key: ['anchor'], note: 'WeakMap on the anchor object' },
  { name: 'corp/hold.ts runAnswers', fill: 'src/ai/corp/hold.ts:runStands.verdict@', key: ['anchor'], note: 'WeakMap on the anchor object, then questionKey' },
  { name: 'oracle.ts playedOut', fill: 'src/ai/oracle.ts:runnerNextTurn@', key: ['known'], note: 'positionKey: the whole state + known.corp + known.runner' },
  { name: 'turnPlanner.ts runnerViews', fill: 'src/ai/turnPlanner.ts:runnerDecisionView@', key: ['decisionSeed', 'plan'], note: 'per state; sig = decisionSeedFor + board + memory + JSON of plan()' },
  { name: 'turnPlanner.ts corpViews', fill: 'src/ai/turnPlanner.ts:corpDecisionView@', key: ['decisionSeed', 'plan'], note: 'per state; sig = decisionSeedFor + board + JSON of plan()' },
  { name: 'effectValues.ts threats', fill: 'src/ai/effectValues.ts:damageThreat@', key: ['plan'], note: 'found row 90 (shared between the AIs in self-play; key incomplete by ruling, V-B B1 ruling 1); plan().corpTurnDamageOwn in the key' },
  { name: 'iceValues.ts deckShares', fill: 'src/ai/iceValues.ts:deckIceShare@', key: [], note: 'found row 90; game id + identity' },
  { name: 'valueModel.ts buildTargets', fill: 'src/ai/valueModel.ts:buildTarget@', key: [], note: 'found row 90; game id + identities' },
  { name: 'valueModel.ts iceMeans', fill: 'src/ai/valueModel.ts:corpIceMean@', key: [], note: 'found row 90; game id + identity' },
  { name: 'prompts.ts runAfters', fill: 'src/ai/prompts.ts:runAnswer@', key: [], note: 'per state; the one-step boards the Corp\'s run term simulated (side corp only)' },
  { name: 'effectValues.ts boardFactCodes', fill: 'src/ai/effectValues.ts:boardFacts@', key: [], note: 'card codes, scopeToGame' },
];
const fieldsReachable = (startUnits: string[], startEdges: Edge[] = []) => {
  const m = new Map<string, Edge | null>();
  const q: string[] = [];
  const add = (u: string, e: Edge | null) => {
    if (m.has(u)) return;
    m.set(u, e);
    q.push(u);
  };
  for (const u of startUnits) add(u, null);
  for (const e of startEdges) add(e.to, e);
  while (q.length) for (const e of byFrom.get(q.shift()!) ?? []) add(e.to, e);
  return m;
};
p('| cache | key carries | fill can read (not in the key) | note |');
p('|---|---|---|---|');
for (const c of CACHES) {
  let m: Map<string, Edge | null>;
  const extraReads: Read[] = [];
  if (c.fill === '') {
    // every memo call: the edges and reads inside its callback's lines
    const starts: Edge[] = [];
    for (const mc of J.memoCalls as { unit: string; from: number; to: number }[]) {
      starts.push(...(byFrom.get(mc.unit) ?? []).filter(e => e.line >= mc.from && e.line <= mc.to));
      extraReads.push(...reads.filter(r => r.unit === mc.unit && r.line >= mc.from && r.line <= mc.to));
    }
    m = fieldsReachable([], starts);
  } else {
    const u = units.find(x => x.id.startsWith(c.fill));
    if (!u) {
      p(`| ${c.name} | ? | fill ${c.fill} not found | ${c.note} |`);
      continue;
    }
    m = fieldsReachable([u.id]);
  }
  const fs = new Set([...reads.filter(r => m.has(r.unit)), ...extraReads].map(readField));
  const not = [...fs].filter(f => !c.key.includes(f) && f !== 'diagnostics').sort();
  p(`| ${c.name} | ${c.key.join(', ') || 'none'} | ${not.join(', ') || '-'} | ${c.note} |`);
}
p();
p(`memo() is called at ${J.memoCalls.length} sites: ${(J.memoCalls as { unit: string; line: number; key: string }[]).map(m => `${short(m.unit.split(':')[0])}:${m.line}`).join(', ')}.`);
p();

// ------------------------------------------------------------------------------------------------ module state
p('## Generated: module-level state of src/ai outside the context (part 1 item 8; listed, not counted)');
p();
p('Every module-level `let`, and every module-level `const` holding a collection or an object that something writes. Writers/readers: functions, with R/C/H. Static tables nothing writes are left out; caches are in the table above as well. Not caught by the detector (written through an alias or an element): turnPlanner.ts:131 `sharedPlan` (planTurn writes `memory.line` when the AI keeps no memory of its own), synergy.ts:589-590 `ownCache`/`oppCache` (`ownCache[side].set`), and the diagnostics sink\'s `replying` flag (diagnostics.ts:94, on the sink object, not module-level).');
p();
p('| variable | kind | written by | read by |');
p('|---|---|---|---|');
type ModVar = { id: string; file: string; name: string; line: number; kind: string; init: string; refs: { unit: string; line: number; write: string | null }[] };
for (const v of J.modVars as ModVar[]) {
  const w = v.refs.filter(r => r.write);
  if (v.kind === 'const' && !w.length) continue;
  const fmt = (rs: typeof v.refs) => [...new Set(rs.map(r => `${fnName(r.unit)} (${sideTag(r.unit)})`))].slice(0, 6).join(', ') + (new Set(rs.map(r => r.unit)).size > 6 ? ', ...' : '');
  p(`| ${short(v.file)}:${v.line} \`${v.name}\` | ${v.kind} | ${fmt(w)} ${[...new Set(w.map(r => r.write))].join(' ')} | ${fmt(v.refs.filter(r => !r.write)) || '-'} |`);
}
p();
p(`Module-level \`let\` lines in src/ai: ${(J.modVars as ModVar[]).filter(v => v.kind === 'let').length} (${(J.modVars as ModVar[]).filter(v => v.kind === 'let').map(v => `${short(v.file)}:${v.name}`).join(', ')}).`);
writeFileSync(OUT, out.join('\n') + '\n');
console.log(`-> ${OUT} (${out.length} lines); R ${R.size}, C ${C.size}, H ${H.size} units; play roots ${playRoots.length}, no-caller roots ${noCaller.length}`);
if (args.WHY) {
  for (const [label, m] of [['R', R], ['C', C], ['Ri', Ri], ['Ci', Ci], ['H', H]] as const) {
    const u = units.find(x => x.id.startsWith(args.WHY));
    console.log(label, u && m.has(u.id) ? chain(m, u.id) : 'not reached');
  }
}

// ------------------------------------------------------------------------------------------------ tests and scripts (item 6)
{
  const { readdirSync, statSync } = await import('node:fs');
  const list = (d: string): string[] => readdirSync(d).flatMap(f => (statSync(`${d}/${f}`).isDirectory() ? (f === 'fixtures' || f === 'pricing-context' ? [] : list(`${d}/${f}`)) : /\.(ts|mjs|js)$/.test(f) ? [`${d}/${f}`] : []));
  const ENTRY = ['asSide', 'withPricing', 'holdPricing', 'noteDecision', 'pricing', 'plan', 'actingSide', 'planSide', 'pricingKey', 'deckPricingKey', 'leafHandByCard', 'decisionContext', 'inDecision', 'inPlayout', 'installDiagnostics', 'withDiagnostics', 'unsunk'];
  const imports = (t: string) => /from ['"][^'"]*ai\/pricing['"]/.test(t);
  const viaHelper = (t: string) => /from ['"][^'"]*helpers\/pricing['"]/.test(t);
  const viaSynergy = (t: string) => /import \{[^}]*\b(asSide|actingSide|planSide)\b[^}]*\} from ['"][^'"]*synergy['"]/.test(t);
  p();
  p('## Generated: tests and scripts that set or read the context (part 1 item 6)');
  p();
  p('Files under tests/ and scripts/ (fixtures and this folder left out) that import pricing.ts, tests/helpers/pricing.ts (inDecision = asSide + decisionContext, inPlayout = that + frozen) or asSide/actingSide/planSide through synergy.ts, with a regex count of `name(` per file (a name in a comment counts too; `plan(` also matches a local of that name). decisionContext and the diagnostics installers are counted because they set the context for the caller. A change of the entry points moves every file in this list.');
  p();
  for (const dir of ['tests', 'scripts']) {
    const rows: string[] = [];
    const sum: Record<string, number> = {};
    for (const f of list(dir).sort()) {
      const t = readFileSync(f, 'utf8');
      const direct = imports(t);
      const helper = viaHelper(t);
      const syn = viaSynergy(t);
      const counts = ENTRY.map(e => [e, (t.match(new RegExp(`(?<![\\w.])${e}\\(`, 'g')) ?? []).length] as const).filter(([, n]) => n > 0);
      const setsOrReads = counts.some(([e]) => ['asSide', 'withPricing', 'holdPricing', 'noteDecision', 'pricing', 'pricingKey', 'deckPricingKey', 'leafHandByCard', 'actingSide', 'planSide'].includes(e));
      if (!direct && !syn && !helper) continue;
      void setsOrReads;
      for (const [e, n] of counts) sum[e] = (sum[e] ?? 0) + n;
      rows.push(`| ${f} | ${[direct && 'pricing.ts', helper && 'helpers/pricing.ts', syn && 'synergy.ts'].filter(Boolean).join(', ')} | ${counts.map(([e, n]) => `${e} ${n}`).join(', ') || '-'} |`);
    }
    p(`### ${dir}: ${rows.length} files (${rows.filter(r => r.includes('| pricing.ts')).length} import pricing.ts itself)`);
    p();
    p(`Totals: ${Object.entries(sum).map(([e, n]) => `${e} ${n}`).join(', ')}.`);
    p();
    p('| file | imports from | calls |');
    p('|---|---|---|');
    for (const r of rows) p(r);
    p();
  }
  writeFileSync(OUT, out.join('\n') + '\n');
}
