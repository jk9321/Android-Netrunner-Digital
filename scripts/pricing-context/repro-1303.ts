/**
 * The g3 deal 1303 repro (the 06:09Z ask): the g3 batch's record of 1303 (corp-losses.ts, results/45548198055.deals.json)
 * differs from O1a bar 6's base leg (trash-floor.ts MODE=play). Both play BASE's src; the batch's driver is lossLog.ts
 * playLogged, which beside the game asks AI code of its own: the alarm tracker (scripts/alarms.ts:116) evaluates the
 * board each main-phase decision was made from, after it, and the opening audit (scripts/opening-audit.ts) ranks the
 * Corp's first main actions with a planner-off HeuristicCorpAI. This plays one deal in one process as one of:
 *
 *   VARIANT=logged    playLogged as the batch ran it (OPENING as the batch: on)
 *   VARIANT=noopen    playLogged with OPENING=0
 *   VARIANT=noalarm   playLogged, OPENING=0, the alarm's evaluate taken out
 *   VARIANT=plain     a plain GameRunner, as trash-floor.ts MODE=play
 *   VARIANT=trace     as noopen, every value cache of count.ts's list wrapped: each read outside the alarm of an entry the
 *                     alarm's evaluate stored is counted by cache and by agent answer (the `alarmReads` of each line)
 *   VARIANT=sandbox   as noopen, the alarm's evaluate neither reads nor stores any cache of that list
 *   VARIANT=only:<cache>  as sandbox, except that the alarm's evaluate may use that one cache
 *
 * and writes every agent answer (method, turn, answer) as JSON lines to OUT, plus at each answer whether the anchor and
 * each known entry it started from were noted inside an audit call. Compare two OUT files for the first differing answer.
 *
 *   npx vite-node scripts/pricing-context/repro-1303.ts -- VARIANT=open SEED=1303 OUT=/tmp/open.jsonl
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

for (const kv of `${process.env.ARGS ?? ''} ${process.argv.slice(2).join(' ')}`.split(/\s+/).filter(x => x.includes('='))) {
  const i = kv.indexOf('=');
  process.env[kv.slice(0, i)] = kv.slice(i + 1);
}
const BASE = process.env.BASE ?? '69f2ab7425af5f16317cc4342b725676ad37bd80';
const VARIANT = process.env.VARIANT ?? 'logged';
const SEED = Number(process.env.SEED ?? 1303);
const GAMES = Number(process.env.GAMES ?? 3);
const OUT = process.env.OUT ?? `/tmp/repro-${SEED}-${VARIANT}.jsonl`;
const root = resolve(process.env.TROOT ?? 'node_modules/.cache/repro-1303', VARIANT);
if (VARIANT !== 'logged' && VARIANT !== 'plain') process.env.OPENING = '0';
else delete process.env.OPENING;

rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
execSync(`git archive ${BASE} src scripts | tar -x -C ${root}`);
const G = globalThis as any;
/** count.ts's list of src/ai's module value caches. */
const CACHES: [file: string, name: string][] = [
  ['ai/valueModel.ts', 'memos'],
  ['ai/valueModel.ts', 'buildTargets'],
  ['ai/valueModel.ts', 'iceMeans'],
  ['ai/iceValues.ts', 'deckShares'],
  ['ai/oracle.ts', 'playedOut'],
  ['ai/handValues.ts', 'deckAverage'],
  ['ai/handValues.ts', 'clickCache'],
  ['ai/effectValues.ts', 'threats'],
  ['ai/prompts.ts', 'runAfters'],
  ['ai/corp/hold.ts', 'turnAnswers'],
  ['ai/corp/hold.ts', 'reachAnswers'],
  ['ai/corp/hold.ts', 'runAnswers'],
  ['ai/turnPlanner.ts', 'runnerViews'],
  ['ai/turnPlanner.ts', 'corpViews'],
  ['ai/turnPlanner.ts', 'corpViewSet'],
];
let inAlarm = 0;
/** WATCH=n: log every read and store of WATCH_CACHE (default deckAverage) made while agent answer n is worked out. */
const WATCH = Number(process.env.WATCH ?? -1);
const WATCH_CACHE = process.env.WATCH_CACHE ?? 'deckAverage';
let watching = false;
const watchLog: Record<string, unknown>[] = [];
let alarmReads: Record<string, number> = {};
/** Entries the alarm's evaluate dropped from a cache (delete, or clear of a non-empty cache), by cache. */
const alarmDrops: Record<string, number> = {};
const blocked = (name: string) => inAlarm > 0 && (VARIANT === 'sandbox' || (VARIANT.startsWith('only:') && VARIANT.slice(5) !== name));
/** A cache that, while the alarm's evaluate runs, is blocked (sandbox, only:) or tags what it stores (trace). */
class AlarmMap {
  private byAlarm: Map<unknown, boolean> | WeakMap<object, boolean>;
  constructor(
    private name: string,
    private m: any
  ) {
    this.byAlarm = m instanceof WeakMap || m instanceof WeakSet ? new WeakMap() : new Map();
  }
  private seen(k: any) {
    if (inAlarm === 0 && (this.byAlarm as any).get(k)) alarmReads[this.name] = (alarmReads[this.name] ?? 0) + 1;
  }
  get(k: any) {
    if (blocked(this.name)) return undefined;
    this.seen(k);
    const v = this.m.get(k);
    if (watching && inAlarm === 0 && this.name === WATCH_CACHE) watchLog.push({ op: 'get', key: String(k), hit: v !== undefined, v });
    return v;
  }
  has(k: any) {
    if (blocked(this.name)) return false;
    this.seen(k);
    return this.m.has(k);
  }
  set(k: any, v: unknown) {
    if (blocked(this.name)) return this;
    if (watching && inAlarm === 0 && this.name === WATCH_CACHE) watchLog.push({ op: 'set', key: String(k), v, size: this.m.size });
    (this.byAlarm as any).set(k, inAlarm > 0);
    this.m.set(k, v);
    return this;
  }
  add(k: any) {
    if (blocked(this.name)) return this;
    (this.byAlarm as any).set(k, inAlarm > 0);
    this.m.add(k);
    return this;
  }
  delete(k: any) {
    if (inAlarm > 0) alarmDrops[`${this.name}.delete`] = (alarmDrops[`${this.name}.delete`] ?? 0) + 1;
    return blocked(this.name) ? false : this.m.delete(k);
  }
  clear() {
    if (inAlarm > 0 && this.m.size) alarmDrops[`${this.name}.clear`] = (alarmDrops[`${this.name}.clear`] ?? 0) + 1;
    if (!blocked(this.name)) this.m.clear();
  }
  get size() {
    return this.m.size;
  }
  forEach(f: any) {
    this.m.forEach(f);
  }
  keys() {
    return this.m.keys();
  }
  values() {
    return this.m.values();
  }
  entries() {
    return this.m.entries();
  }
  [Symbol.iterator]() {
    return this.m[Symbol.iterator]();
  }
}
G.__rpCache = (name: string, m: unknown) => new AlarmMap(name, m);
{
  // Every AI call the logger makes beside the game goes through __audit (to tag what it notes)
  const patch = (file: string, calls: string[]) => {
    const p = join(root, file);
    let t = readFileSync(p, 'utf8');
    for (const call of calls) {
      if (!t.includes(call)) throw new Error(`${file}: ${call} not found`);
      t = t.replace(call, `(globalThis as any).__audit(() => ${call})`);
    }
    writeFileSync(p, t);
  };
  patch('scripts/opening-audit.ts', ["asSide('corp', () => this.ranker.rankMainActions(before))", "asSide('corp', () => evaluate(after, 'corp') - evaluate(before, 'corp'))"]);
  if (VARIANT === 'noalarm') {
    const p = join(root, 'scripts/alarms.ts');
    const call = 'const value = asSide(side, () => evaluate(before, side));';
    const t = readFileSync(p, 'utf8');
    if (!t.includes(call)) throw new Error('alarms.ts: evaluate call not found');
    writeFileSync(p, t.replace(call, 'const value = 0;'));
  } else {
    const p = join(root, 'scripts/alarms.ts');
    const call = 'asSide(side, () => evaluate(before, side))';
    const t = readFileSync(p, 'utf8');
    if (!t.includes(call)) throw new Error('alarms.ts: evaluate call not found');
    writeFileSync(p, t.replace(call, `(globalThis as any).__alarm(() => ${call})`));
  }
}
if (VARIANT === 'trace' || VARIANT === 'sandbox' || VARIANT.startsWith('only:')) {
  for (const [file, name] of CACHES) {
    const p = join(root, 'src', file);
    const text = readFileSync(p, 'utf8');
    const re = new RegExp(`^((?:export )?const ${name}\\s*(?::[^=]+)?=\\s*)(new (?:Weak)?(?:Map|Set)\\b.*?\\));?\\s*$`, 'm');
    if (!re.test(text)) throw new Error(`cache ${name} not found in ${file}`);
    writeFileSync(p, text.replace(re, (_m, a, b) => `${a}(globalThis as any).__rpCache('${name}', ${b});`));
  }
}

async function main() {
  const m = (p: string) => import(/* @vite-ignore */ join(root, p));
  // One at a time, the tree's entry first (concurrent imports of a module cycle can stall and end the process silently)
  const ai = await m('src/ai/index.ts');
  const core = await m('src/core/index.ts');
  const decks = await m('src/data/decks.ts');
  const pricing = await m('src/ai/pricing.ts');
  const vm = await m('src/ai/valueModel.ts');
  const nsg = await m('scripts/nsg-sample-decks.ts');
  const loss = await m('scripts/lossLog.ts');
  const ctx = pricing.pricing() as any;
  // Values noted inside an audit call
  const fromAudit = new WeakSet<object>();
  let auditCalls = 0;
  G.__audit = (fn: () => unknown) => {
    auditCalls++;
    const keep = { anchor: ctx.anchor, known: ctx.known };
    try {
      return fn();
    } finally {
      if (ctx.anchor && ctx.anchor !== keep.anchor) fromAudit.add(ctx.anchor);
      for (const s of ['corp', 'runner']) if (ctx.known[s] && ctx.known[s] !== keep.known?.[s]) fromAudit.add(ctx.known[s]);
    }
  };
  let alarmCalls = 0;
  G.__alarm = (fn: () => unknown) => {
    alarmCalls++;
    inAlarm++;
    try {
      return G.__audit(fn);
    } finally {
      inAlarm--;
    }
  };
  // The deal as corp-losses.ts finds it
  let pairing = 0;
  let found: { c: any; r: any } | null = null;
  for (const c of nsg.ALL_DECKS.filter((x: any) => x.side === 'corp'))
    for (const r of nsg.ALL_DECKS.filter((x: any) => x.side === 'runner')) {
      pairing++;
      for (let g = 0; g < GAMES; g++) if (1000 + (pairing - 1) * Math.max(10, GAMES) + g + 1 === SEED) found = { c, r };
    }
  if (!found) throw new Error(`no deal ${SEED}`);
  const lines: string[] = [];
  let n = 0;
  const tag = (o: object | null | undefined) => (!o ? 'none' : fromAudit.has(o) ? 'audit' : 'game');
  const wrap = (agent: any) =>
    new Proxy(agent, {
      get(t, p) {
        const f = t[p];
        if (typeof f !== 'function' || !['chooseAction', 'chooseRez', 'chooseOffTurn'].includes(String(p))) return f;
        return (state: any, ...rest: any[]) => {
          const at = { anchor: tag(ctx.anchor), corp: tag(ctx.known.corp), runner: tag(ctx.known.runner), anchorTurn: ctx.anchor?.root?.turnNumber ?? null, anchorSide: ctx.anchor?.side ?? null };
          alarmReads = {};
          watching = n === WATCH;
          const a = f.call(t, state, ...rest);
          watching = false;
          if (n === WATCH) writeFileSync(OUT + '.watch.json', JSON.stringify(watchLog));
          lines.push(JSON.stringify({ n: n++, side: agent.side, method: String(p), T: state.turnNumber, prompt: core.activePrompt(state)?.kind ?? null, answer: a, start: at, auditCalls, alarmCalls, alarmReads }));
          return a;
        };
      },
    });
  vm.valueLoops.clear();
  const start = core.createInitialGameState(decks.deckGameSetup(SEED, found.c, found.r));
  const agents = { corp: wrap(ai.createAgent('corp', 'normal', {})), runner: wrap(ai.createAgent('runner', 'normal', {})) };
  if (VARIANT === 'plain') {
    const g = new ai.GameRunner(start, agents);
    const cr: number[] = [];
    const sc: number[] = [];
    let last = -1;
    for (let i = 0; i < 4000; i++) {
      const st = g.state;
      if (st.turnNumber !== last && st.activePlayer === 'corp') {
        cr.push(st.corp.credits);
        sc.push(st.corp.score);
        last = st.turnNumber;
      }
      if (!g.step()) break;
    }
    lines.push(JSON.stringify({ kind: 'record', seed: SEED, variant: VARIANT, winner: g.state.winner ?? null, cr, sc, auditCalls }));
  } else {
    const rec = loss.playLogged(start, agents, { corp: found.c.name, runner: found.r.name });
    lines.push(JSON.stringify({ kind: 'record', seed: SEED, variant: VARIANT, winner: rec.winner, cr: rec.money.creditsAtTurnStart, sc: rec.money.scoreAtTurnStart, auditCalls, alarmDrops }));
  }
  writeFileSync(OUT, lines.join('\n') + '\n');
  console.log(lines[lines.length - 1]);
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
