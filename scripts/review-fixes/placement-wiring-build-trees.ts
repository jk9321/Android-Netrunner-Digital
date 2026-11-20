/**
 * Bundle P build (review-fixes-1119/placement-build/brief.md rev 3, "Judged by"): the trees of the build's reading. The
 * count's reading again, with the built commits as arms against the merge base. A tree is a commit's src/ (git archive)
 * with the RECORD patches below, loaded as its own module graph (as placement-wiring-trees.ts); the counted arms are the
 * count's own trees (placement-wiring-trees.ts makeTrees) made from the merge base's src.
 *
 * Arms: beta, control, source = the merge base (BASE, daffc389); c1, c2, head = the build's commits (fix 1; fix 2; fixes
 * 3 and 4 on top, head); shortOnce, shortCoverWaiting = the count's arms on the merge base (the trees the build must
 * reproduce: c1 against shortOnce is fix 1's memo against the arm's uncached form; head against shortCoverWaiting is
 * the whole build, freeKey included).
 *
 * RECORD (record only: it writes globals the script reads, changes no answer; every anchor is a line the build does not
 * touch, so the same patch fits the merge base and every commit):
 *  - corpAI.ts: the deciding Corp's own order marked top level (`__pwTop`), and the planner timed (`__pwPlanMs`);
 *  - turnPlanner.ts: the Corp planner's intake and values (`__pwPlan`); with `__pwLog` an array, every Corp playout
 *    logged: its depth (nested playouts inside the Runner reply count deeper), its first action, each Corp step played
 *    with two flags read by the tree's own hooks on the playout's board (the deciding Corp's view): `w` the step is an
 *    asset's install at an iced remote with an open root (the waiting form's move), `s` the board is in fix 1's class
 *    (scoringShort short with the remote's rez kept, not short with it out), and the playout's value;
 *  - candidates.ts: at the top level, the order (`__pwMain.order`, its first 12, and `key`, the whole order's actions) and,
 *    with `__pwMeasure`, the tree's measure hook (`__pwHook`, the classes on the decision's board); on the trees that have
 *    fix 2, each waiting-form candidate made (top level or inside a playout) and each the engine would refuse
 *    (`__pwFire`: waitTop, waitLookahead, waitRefused).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTrees } from './placement-wiring-trees';

export const BASE = 'daffc389e85ad5835635d0c588c5233cd6b0dabf';
export const COMMITS: Record<string, string> = {
  c1: '6c1ce8b3dca93e98f91260219007df2e4437f5a3',
  c2: 'fc71ecd5755669bf1caf20100351f19831588072',
  head: 'f1350562d2839313806ba1a67d928fcb9a3aad52',
};
export const BUILD_ARMS = ['beta', 'control', 'source', 'c1', 'c2', 'head', 'shortOnce', 'shortCoverWaiting'] as const;
export type BuildArm = (typeof BUILD_ARMS)[number];
const COUNTED = new Set<BuildArm>(['shortOnce', 'shortCoverWaiting']);
export const isCounted = (a: string) => COUNTED.has(a as BuildArm);

type Patch = [file: string, at: string, to: string, optional?: boolean];

const RECORD: Patch[] = [
  [
    'ai/corpAI.ts',
    `    const reply = plan().runnerReply ? (s: GameState, leaf: (s: GameState) => number) => runnerReply(s, this.synergy, leaf) : undefined;
    return planTurn(`,
    `    const reply = plan().runnerReply ? (s: GameState, leaf: (s: GameState) => number) => runnerReply(s, this.synergy, leaf) : undefined;
    const __G = globalThis as any;
    const __t = performance.now();
    try {
      return this.__plan(state, ranked, rollout, reply);
    } finally {
      __G.__pwPlanMs = (__G.__pwPlanMs ?? 0) + performance.now() - __t;
    }
  }

  private __plan(state: GameState, ranked: ScoredAction[], rollout: HeuristicCorpAI, reply: any): GameAction | null {
    return planTurn(`,
  ],
  [
    'ai/corpAI.ts',
    `    return asRanked(view, corpCandidates(view, legal, { held, freeExhausted: this.freeActions.exhausted }));`,
    `    const __G = globalThis as any;
    const __was = __G.__pwTop;
    __G.__pwTop = this.planner;
    try {
      return asRanked(view, corpCandidates(view, legal, { held, freeExhausted: this.freeActions.exhausted }));
    } finally {
      __G.__pwTop = __was;
    }`,
  ],
  [
    'ai/turnPlanner.ts',
    `  if (next && next.key === key && ranked.some(r => r.score > -Infinity && sameAction(r.action, next.action))) {
    memory.line.shift();`,
    `  if (next && next.key === key && ranked.some(r => r.score > -Infinity && sameAction(r.action, next.action))) {
    if (side === 'corp') (globalThis as any).__pwPlan = { memo: true, pick: next.action };
    memory.line.shift();`,
  ],
  [
    'ai/turnPlanner.ts',
    `    if (!best || best.value === -Infinity) return null;
    const slot = intake ? [...intake.slots].find(([c]) => c.action === best!.action)?.[1] : undefined;`,
    `    if (side === 'corp') (globalThis as any).__pwPlan = { intake: candidates.map(c => c.action), values: scored.map(x => x.value), pick: best?.action ?? null };
    if (!best || best.value === -Infinity) return null;
    const slot = intake ? [...intake.slots].find(([c]) => c.action === best!.action)?.[1] : undefined;`,
  ],
  [
    'ai/turnPlanner.ts',
    `export function playout(start: GameState, side: SideCode, first: GameAction, ai: PlannerAI, line: Line = [], ends?: Ends, mode: LineMode = 'rule'): number {`,
    `export function playout(start: GameState, side: SideCode, first: GameAction, ai: PlannerAI, line: Line = [], ends?: Ends, mode: LineMode = 'rule'): number {
  const __G = globalThis as any;
  const __log = side === 'corp' && __G.__pwLog ? { d: __G.__pwDepth ?? 0, first, w: !!__G.__pwW?.(start, first), s: !!__G.__pwS?.(start), steps: [] as any[], v: 0 } : null;
  const __was = __G.__pwSteps;
  __G.__pwSteps = __log ? __log.steps : null;
  __G.__pwDepth = (__G.__pwDepth ?? 0) + 1;
  try {
    const v = __playout(start, side, first, ai, line, ends, mode);
    if (__log) {
      __log.v = v;
      __G.__pwLog.push(__log);
    }
    return v;
  } finally {
    __G.__pwSteps = __was;
    __G.__pwDepth--;
  }
}

function __playout(start: GameState, side: SideCode, first: GameAction, ai: PlannerAI, line: Line = [], ends?: Ends, mode: LineMode = 'rule'): number {`,
  ],
  [
    'ai/turnPlanner.ts',
    `    if (!played) break;
    if (ends && agendaInstall(now, played)) ends.installedAgenda = true;`,
    `    if (!played) break;
    {
      const __G = globalThis as any;
      if (__G.__pwSteps) __G.__pwSteps.push({ a: played, w: !!__G.__pwW?.(now, played), s: !!__G.__pwS?.(now) });
    }
    if (ends && agendaInstall(now, played)) ends.installedAgenda = true;`,
  ],
  [
    'ai/corp/candidates.ts',
    `  const corp = state.corp;
  const keep = rezMoney(state).keep;
  const before = evaluate(state, 'corp');`,
    `  const __G = globalThis as any;
  const __top = !!__G.__pwTop;
  __G.__pwTop = false;
  __G.__pwInTop = __top;
  if (__top && __G.__pwMeasure && __G.__pwHook) __G.__pwM = __G.__pwHook(state, legal, opts);
  const corp = state.corp;
  const keep = rezMoney(state).keep;
  const before = evaluate(state, 'corp');`,
  ],
  [
    'ai/corp/candidates.ts',
    `  return sortCandidates(out);
}`,
    `  const __sorted = sortCandidates(out);
  if (__top) (globalThis as any).__pwMain = { order: __sorted.slice(0, 12).map(c => ({ a: c.action, line: c.line, behind: c.behind })), key: JSON.stringify(__sorted.map(c => c.action)) };
  (globalThis as any).__pwInTop = false;
  return __sorted;
}`,
  ],
  [
    'ai/corp/candidates.ts',
    `const legalOr = (state: GameState, a: Install, otherwise: Install): Install => (isLegalAction(state, a) ? a : otherwise);`,
    `const legalOr = (state: GameState, a: Install, otherwise: Install): Install => {
  const G = globalThis as any;
  const k = G.__pwInTop ? 'waitTop' : 'waitLookahead';
  const ok = isLegalAction(state, a);
  G.__pwFire = { ...(G.__pwFire ?? {}), [k]: (G.__pwFire?.[k] ?? 0) + 1, ...(ok ? {} : { waitRefused: (G.__pwFire?.waitRefused ?? 0) + 1 }) };
  return ok ? a : otherwise;
};`,
    true,
  ],
];

function git(cmd: string): string {
  return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
/** The commit's src/ written to `dir`/src (fetched first when the shallow checkout lacks it). */
function srcOf(sha: string, dir: string) {
  try {
    git(`cat-file -e ${sha}^{commit}`);
  } catch {
    git(`fetch -q --depth=1 origin ${sha}`);
  }
  mkdirSync(dir, { recursive: true });
  execSync(`git archive ${sha} src | tar -x -C ${JSON.stringify(dir)}`);
}

/** The trees of `arms` under `root`; each RECORD patch must match once (an optional one at most once). */
export function makeBuildTrees(root: string, arms: readonly BuildArm[]): Record<string, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const base = join(root, '_base');
  srcOf(BASE, base);
  const dirs: Record<string, string> = {};
  const counted = arms.filter(a => COUNTED.has(a));
  if (counted.length) Object.assign(dirs, makeTrees(join(root, '_counted'), counted as any, join(base, 'src')));
  for (const arm of arms) {
    if (COUNTED.has(arm)) continue;
    const dir = join(root, arm);
    srcOf(COMMITS[arm] ?? BASE, dir);
    for (const [f, at, to, optional] of RECORD) {
      const path = join(dir, 'src', f);
      const text = readFileSync(path, 'utf8');
      const n = text.split(at).length - 1;
      if (n === 0 && optional) continue;
      if (n !== 1) throw new Error(`tree ${arm}: a RECORD patch matches ${n} times in ${f}: ${at.slice(0, 80)}`);
      writeFileSync(
        path,
        text.replace(at, () => to),
      );
    }
    dirs[arm] = dir;
  }
  return dirs;
}

/**
 * The hooks a tree's RECORD reads, made from that tree's own modules (so they run in its pricing context):
 *  - `W(state, action)`: the action installs an asset at an iced remote with an open root (no agenda or asset; 3.3.1);
 *  - `S(state)`: fix 1's class, scoringShort short with the remote's rez kept in the floor and not short with it out
 *    (only on trees whose lineKeep takes the server; else false);
 *  - `measure(state, legal, opts)` (the head tree's, asked once more untimed at a main decision): S's inputs, and the
 *    asset cover placements on the board by form (waiting, pair), from place for each econ asset's legal install.
 */
export async function hooksOf(dir: string) {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const core = await m('core/index.ts');
  const placement = await m('ai/corp/placement.ts');
  const rezMoney = await m('ai/corp/rezMoney.ts');
  const hold = await m('ai/corp/hold.ts');
  const lines = await m('ai/corp/lines.ts');
  const cardValues = await m('ai/cardValues.ts');
  const typeOf = (c: any) => (c ? core.cardDef(c).type_code : undefined);
  const W = (s: any, a: any) => {
    if (!a || a.type !== 'INSTALL_CARD' || a.asNewRemote || !a.targetServerId) return false;
    const card = s.corp.hq.find((c: any) => c.instanceId === a.cardInstanceId);
    const v = s.corp.servers[a.targetServerId];
    return typeOf(card) === 'asset' && !!v?.isRemote && v.ice.length > 0 && !v.root.some((c: any) => ['agenda', 'asset'].includes(typeOf(c)));
  };
  const takesServer = rezMoney.lineKeep.length >= 3 || /server\?/.test(String(rezMoney.lineKeep));
  const sBoth = (s: any) => {
    const scoring = lines.scoringRemote(s);
    if (!scoring || !takesServer) return null;
    const agendas = s.corp.hq.filter((c: any) => typeOf(c) === 'agenda');
    const end = s.corp.credits + Math.max(0, s.corp.clicks - 1);
    const floor = rezMoney.lineKeep(s, agendas);
    const floorOnce = rezMoney.lineKeep(s, agendas, scoring.id);
    const today = hold.serverHold(s, scoring.id, { when: 'runnerTurn', corpCredits: end - floor });
    const once = floorOnce === floor ? today : hold.serverHold(s, scoring.id, { when: 'runnerTurn', corpCredits: end - floorOnce });
    return { id: scoring.id, rootAgenda: scoring.root.some((c: any) => typeOf(c) === 'agenda'), end, floor, floorOnce, shortToday: !today.holds, shortOnce: !once.holds };
  };
  const S = (s: any) => {
    if (!lines.isCorpMain(s)) return false;
    const b = sBoth(s);
    return !!b && b.shortToday && !b.shortOnce;
  };
  const measure = (s: any, legal: any[], opts: any) => {
    const out: any = { s: sBoth(s), c: [] as any[] };
    for (const card of s.corp.hq.filter((c: any) => typeOf(c) === 'asset' && cardValues.isEconAsset(c.cardCode))) {
      for (const from of legal.filter((a: any) => a.type === 'INSTALL_CARD' && a.cardInstanceId === card.instanceId && !a.faceUp)) {
        const p = placement.place(s, card, { from, held: opts.held ? structuredClone(opts.held) : null })[0];
        if (p?.reason !== 'assetCover') continue;
        out.c.push({ card: card.instanceId, title: core.cardDef(card).title, from: from.asNewRemote ? 'new' : from.targetServerId, server: p.server, form: p.pairWith ? 'pair' : 'waiting', pairWith: p.pairWith ?? null });
      }
    }
    return out;
  };
  return { W, S, measure };
}
