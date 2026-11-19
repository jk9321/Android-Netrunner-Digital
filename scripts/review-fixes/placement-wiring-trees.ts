/**
 * Review fixes 2026-11-19, bundle P (placement wiring), count step (brief:
 * /mnt/project-files/netrunner-ai/review-fixes-1119/placement-count/brief.md): the trees. A tree is a copy of this
 * checkout's src/ with text patches, loaded as its own module graph (as stage-d/bait-run-trees.ts).
 *
 * Every tree gets the RECORD patch, which only writes globals the script reads (top level only: the deciding Corp's own
 * order, corpAI.ts rankMainActions with the planner on; never the planner's rollouts or a nested order such as
 * rezAllowed's), plus two exports nothing in src calls:
 *  - placedInstalls records, per HQ card, each proposed install, place's answer (server, reason, pairWith) and whether
 *    one counted destination was returned;
 *  - the planner records its intake and each candidate's playout value (side corp), and corpAI.ts times it;
 *  - with `__pwMeasure` (an untimed extra ask on the beta tree) corpCandidates measures S, C and D on the board it was
 *    given (the deciding Corp's own view): the scoring remote, today's scoringShort and `__scoringShortOnce`, the
 *    centrals' state for each counted ice, the asset cover candidate's play value three ways;
 *  - rezMoney honours `except` without `restOfTurn` too (no caller in src passes it so: rez.ts passes it with
 *    restOfTurn only), and `__lineKeepExcept` is lineKeep with a server left out of the pools.
 *
 * The arms (each a patch on top of RECORD; nothing else differs):
 *  - shortOnce: scoringShort's floor is lineKeep with the scoring remote left out of the pools (rezMoney's `except`, exact).
 *  - coverAtPlace: an 'assetCover' placement's candidate is the install `place` gives where it is one install (the
 *    waiting iced remote: the asset at that server, the move the Corp makes); for the ice-pair form the candidate's
 *    action stays the asset's own install (so Q5, scoreInTwoPick, maps it exactly as on beta: the real decision path is
 *    untouched), its play value is the value of the line's first step (the ice from HQ at the placement's server), and the
 *    planner's playout plays that first step (playoutLine.first returns the step an asset line begun on the first action
 *    plays; turnPlanner.ts plays it instead of the candidate's action). The playout's later steps are the line's own.
 *  - redirectRemoteOnly: when the counted rule is iceRedirect or assetPartner, the card's other destinations at HQ, R&D
 *    and Archives (as place gives them), and an upgrade's install on a remote holding an agenda, stay candidates beside
 *    the counted one. centralIce, scoreLine and assetCover still return their one destination.
 *  - freeKey: freeInstallTarget's cache keyed by pricingKey() too.
 *  - shortCover: shortOnce and coverAtPlace together.
 *  - control: RECORD only (identical to beta; a changed decision is a stop).
 *  - source: RECORD only; plays the source games, never asked.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ARMS = ['beta', 'control', 'source', 'shortOnce', 'coverAtPlace', 'redirectRemoteOnly', 'freeKey', 'shortCover', 'coverWaiting', 'reservedOnce', 'shortReserved', 'shortCoverWaiting'] as const;
export type Arm = (typeof ARMS)[number];
export const PW_ARMS: Arm[] = ['shortOnce', 'coverAtPlace', 'redirectRemoteOnly', 'freeKey', 'shortCover'];
/** Addendum 1 (after the red team): the narrower arms. shortOnce is asked beside them as the reference for shortReserved. */
export const PW_ARMS_1: Arm[] = ['shortOnce', 'coverWaiting', 'reservedOnce', 'shortReserved', 'shortCoverWaiting'];

type Patch = [file: string, at: string, to: string];

function patches(arm: Arm): Patch[] {
  const SHORT = arm === 'shortOnce' || arm === 'shortCover' || arm === 'shortReserved' || arm === 'shortCoverWaiting';
  const COVER = arm === 'coverAtPlace' || arm === 'shortCover';
  // coverWaiting: the waiting form only (no pairWith); the pair form, play's value, core.ts and turnPlanner.ts as beta
  const WAIT = arm === 'coverWaiting' || arm === 'shortCoverWaiting';
  const RESV = arm === 'reservedOnce' || arm === 'shortReserved';
  const REDIR = arm === 'redirectRemoteOnly';
  const FREE = arm === 'freeKey' || arm === 'shortCoverWaiting';
  return [
    // ---------------------------------------------------------------- rezMoney: `except` without restOfTurn (all trees)
    [
      'ai/corp/rezMoney.ts',
      `  if (!opts.without?.length) {
    const money = memo(state, 'rezMoney', () => countRezMoney(state, holding(state)));`,
      `  if (!opts.without?.length && !opts.except) {
    const money = memo(state, 'rezMoney', () => countRezMoney(state, holding(state)));`,
    ],
    [
      'ai/corp/rezMoney.ts',
      `  return countRezMoney(state, holdingRez(state, opts.without));
}`,
      `  return countRezMoney(state, holdingRez(state, opts.without, undefined, opts.except));
}`,
    ],
    [
      'ai/corp/rezMoney.ts',
      `export function lineKeep(state: GameState, agendas: CardInstance[]): number {`,
      `export function __lineKeepExcept(state: GameState, agendas: CardInstance[], except: string): number {
  return agendas.length ? Math.min(...agendas.map(x => rezMoney(state, { without: [x.instanceId], except }).keep)) : rezMoney(state, { except }).keep;
}

export function lineKeep(state: GameState, agendas: CardInstance[]): number {`,
    ],
    // ---------------------------------------------------------------- scoringShort: the arm, and the measure's export
    [
      'ai/corp/placement.ts',
      `import { lineKeep, rezMoney } from './rezMoney';`,
      `import { __lineKeepExcept, lineKeep, rezMoney } from './rezMoney';`,
    ],
    [
      'ai/corp/placement.ts',
      `export function scoringShort(state: GameState): ServerLike | null {`,
      `export function scoringShort(state: GameState, __once: boolean = ${SHORT}): ServerLike | null {`,
    ],
    [
      'ai/corp/placement.ts',
      `function reservedForAgenda(state: GameState): ServerLike | null {`,
      `function reservedForAgenda(state: GameState, __once: boolean = ${RESV}): ServerLike | null {`,
    ],
    [
      'ai/corp/placement.ts',
      `  const floor = lineKeep(state, agendas);
  // The line's money on its next turn`,
      `  const floor = __once ? __lineKeepExcept(state, agendas, scoring.id) : lineKeep(state, agendas);
  // The line's money on its next turn`,
    ],
    [
      'ai/corp/placement.ts',
      `  const floor = lineKeep(state, agendas);
  const end = state.corp.credits + Math.max(0, state.corp.clicks - 1);
  return serverHold(state, scoring.id, { when: 'runnerTurn', corpCredits: end - floor }).holds ? null : scoring;
}`,
      `  const floor = __once ? __lineKeepExcept(state, agendas, scoring.id) : lineKeep(state, agendas);
  const end = state.corp.credits + Math.max(0, state.corp.clicks - 1);
  return serverHold(state, scoring.id, { when: 'runnerTurn', corpCredits: end - floor }).holds ? null : scoring;
}

/** PLACEMENT-WIRING (measure): scoringShort both ways on one board, with its inputs. */
export function __scoringShortBoth(state: GameState) {
  const scoring = scoringRemote(state);
  if (!scoring) return null;
  const agendas = state.corp.hq.filter(isAgenda);
  const end = state.corp.credits + Math.max(0, state.corp.clicks - 1);
  const floor = lineKeep(state, agendas);
  const floorOnce = __lineKeepExcept(state, agendas, scoring.id);
  const today = serverHold(state, scoring.id, { when: 'runnerTurn', corpCredits: end - floor });
  const once = floorOnce === floor ? today : serverHold(state, scoring.id, { when: 'runnerTurn', corpCredits: end - floorOnce });
  const own = rezMoney(state).byServer[scoring.id] ?? null;
  return { id: scoring.id, ice: scoring.ice.length, rootAgenda: scoring.root.some(isAgenda), agendaIds: scoring.root.filter(isAgenda).map(c => c.instanceId), end, floor, floorOnce, own, shortToday: !today.holds, shortOnce: !once.holds, rezCost: today.rezCost ?? null };
}

/**
 * PLACEMENT-WIRING (measure, addendum 1): assetCover's reservation and its gate (\`reserved && scoringShort(state)\`)
 * four ways (reservedForAgenda today/once x scoringShort today/once), on a board where an econ asset waits in HQ.
 * reached: the waiting branch does not return first for the cheapest such asset.
 */
export function __coverGates(state: GameState) {
  const econ = state.corp.hq.filter(c => {
    const p = typeOf(c) === 'asset' ? profileOf(c.cardCode) : undefined;
    return !!p && p.pay > 0 && p.load > (cardDef(c).cost ?? 0);
  });
  // every board: reservedForAgenda also feeds assetPartner; reached and gate read only where an econ asset waits
  const rezCost = econ.length ? Math.min(...econ.map(c => cardDef(c).cost ?? 0)) : 0;
  const income = knownIncome(state);
  const out: any = { econ: econ.length };
  for (const [k, r, s] of [['tt', false, false], ['ot', true, false], ['to', false, true], ['oo', true, true]] as const) {
    const reserved = reservedForAgenda(state, r);
    const waiting = remotes(state).find(v => v.ice.length > 0 && !v.root.some(c => isAgenda(c) || typeOf(c) === 'asset') && v.id !== reserved?.id);
    const takes = !!waiting && state.corp.credits + (state.corp.clicks - 1) + income >= rezCost;
    out[k] = { reserved: reserved?.id ?? null, waiting: waiting?.id ?? null, reached: !takes, gate: !!(reserved && scoringShort(state, s)) };
  }
  return out;
}`,
    ],
    // ---------------------------------------------------------------- the playout's first step (coverAtPlace)
    [
      'ai/corp/core.ts',
      `    first: (state: GameState, action: GameAction) => void (line = unsunk(() => scoreInTwoPick(state, action, line)).held),`,
      `    first: (state: GameState, action: GameAction): GameAction | undefined => {
      const r = unsunk(() => scoreInTwoPick(state, action, line));
      line = r.held;
      if (${COVER} && r.held?.line.kind === 'asset' && r.action !== action) {
        const G = globalThis as any;
        G.__pwFirstSwap = (G.__pwFirstSwap ?? 0) + 1;
        return r.action;
      }
      return undefined;
    },`,
    ],
    [
      'ai/turnPlanner.ts',
      `  corpLine?.first(start, first);
  let state = step(start, first);`,
      `  const __first = ((corpLine?.first(start, first) as unknown) as GameAction | undefined) ?? first;
  let state = step(start, __first);`,
    ],
    // ---------------------------------------------------------------- the planner: intake and values (record), timed
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
    // ---------------------------------------------------------------- the top-level order (record)
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
      'ai/corp/candidates.ts',
      `import { plan } from '../pricing';`,
      `import { plan, pricingKey as __pricingKey } from '../pricing';
import { executeAction as __exec, isLegalAction as __legal } from '../../core';
import { __coverGates, __scoringShortBoth, scoringShort as __scoringShort } from './placement';
import { scoringRemote as __scoringRemote } from './lines';
import { stake as __stake } from './pools';`,
    ],
    [
      'ai/corp/candidates.ts',
      `function placedInstalls(state: GameState, card: CardInstance, installs: Install[], held: HeldLine | null, free?: FreeInstall): { action: Install; placement: Placement }[] {`,
      `function placedInstalls(state: GameState, card: CardInstance, installs: Install[], held: HeldLine | null, free?: FreeInstall, __rec?: any[] | null): { action: Install; placement: Placement; __first?: GameAction }[] {
  const out = __placedInstalls(state, card, installs, held, free);
  if (__rec) {
    const r = (globalThis as any).__pwLast;
    __rec.push({ card: card.instanceId, title: cardDef(card).title, type: typeOf(card), ...r, returned: out.map(e => ({ server: dest(e.action), reason: e.placement.reason, pairWith: e.placement.pairWith ?? null, ...(e.__first ? { first: dest(e.__first as Install) } : {}) })) });
  }
  return out;
}

const dest = (a: Install) => (a.asNewRemote || !a.targetServerId ? 'new' : a.targetServerId);

function __placedInstalls(state: GameState, card: CardInstance, installs: Install[], held: HeldLine | null, free?: FreeInstall): { action: Install; placement: Placement; __first?: GameAction }[] {
  const __from: any[] = [];`,
    ],
    [
      'ai/corp/candidates.ts',
      `    const clean = placement.reason === 'assetCover' ? from : placedInstall(from, placement);`,
      `    __from.push({ from: dest(from), server: placement.server, reason: placement.reason, pairWith: placement.pairWith ?? null });
    // coverAtPlace: one install (the waiting remote) is the candidate itself; the ice pair keeps the asset's own install,
    // valued and played out by its first step (the ice from HQ at the placement's server)
    const __cover = ${COVER} && placement.reason === 'assetCover';
    const __wait = ${WAIT} && placement.reason === 'assetCover' && !placement.pairWith;
    const clean = placement.reason === 'assetCover' && !((__cover || __wait) && !placement.pairWith) ? from : placedInstall(from, placement);
    if (__wait && !__legal(state, clean)) {
      // red team M4 (record only): a waiting-form candidate the engine would refuse
      const G = globalThis as any;
      G.__pwFire = { ...(G.__pwFire ?? {}), waitIllegal: (G.__pwFire?.waitIllegal ?? 0) + 1 };
    }
    const __first: GameAction | undefined =
      __cover && placement.pairWith
        ? ({ type: 'INSTALL_CARD', player: 'corp', cardInstanceId: placement.pairWith, ...(placement.server === 'new' ? { asNewRemote: true } : { targetServerId: placement.server }) } as GameAction)
        : undefined;`,
    ],
    [
      'ai/corp/candidates.ts',
      `    const entry = { action: clean, placement };`,
      `    const entry = { action: clean, placement, ...(__first ? { __first } : {}) };`,
    ],
    [
      'ai/corp/candidates.ts',
      `  if (counted.length) return [counted[0]];
  return [...seen.values()];`,
      `  const __offered = [...seen.values()].map(e => dest(e.action));
  (globalThis as any).__pwLast = { from: __from, offered: __offered, counted: counted.length ? counted[0].placement.reason : null };
  if (counted.length) {
    if (${REDIR} && ['iceRedirect', 'assetPartner'].includes(counted[0].placement.reason)) {
      // redirectRemoteOnly: the counted redirect replaces the remote and new-remote destinations only
      const at = dest(counted[0].action);
      const kept = [...seen.values()].filter(e => {
        const d = dest(e.action);
        if (d === at) return false;
        if (d === 'hq' || d === 'rd' || d === 'archives') return true;
        const v = d === 'new' ? null : state.corp.servers[d];
        return typeOf(card) === 'upgrade' && !!v?.isRemote && v.root.some(c => typeOf(c) === 'agenda');
      });
      if (kept.length) {
        const G = globalThis as any;
        G.__pwFire = { ...(G.__pwFire ?? {}), redirect: (G.__pwFire?.redirect ?? 0) + 1 };
      }
      return [counted[0], ...kept];
    }
    return [counted[0]];
  }
  return [...seen.values()];`,
    ],
    [
      'ai/corp/candidates.ts',
      `  const play = (a: GameAction, line: number, creditTest = true, extra = 0) => {
    const r0 = value(a);`,
      `  const play = (a: GameAction, line: number, creditTest = true, extra = 0, __va?: GameAction) => {
    const r0 = (__va ? value(__va) : null) ?? value(a);`,
    ],
    [
      'ai/corp/candidates.ts',
      `  const corp = state.corp;
  const keep = rezMoney(state).keep;
  const before = evaluate(state, 'corp');`,
      `  const __G = globalThis as any;
  const __top = !!__G.__pwTop;
  __G.__pwTop = false;
  const __rec: any[] | null = __top ? [] : null;
  const corp = state.corp;
  const keep = rezMoney(state).keep;
  const before = evaluate(state, 'corp');`,
    ],
    [
      'ai/corp/candidates.ts',
      `    for (const { action } of placedInstalls(state, card, installs, opts.held, opts.free)) {`,
      `    for (const { action, __first } of placedInstalls(state, card, installs, opts.held, opts.free, __rec)) {`,
    ],
    [
      'ai/corp/candidates.ts',
      `      } else play(action, 4, false);`,
      `      } else play(action, 4, false, 0, __first);`,
    ],
    [
      'ai/corp/candidates.ts',
      `  return sortCandidates(out);
}`,
      `  const __sorted = sortCandidates(out);
  if (__top) {
    __G.__pwMain = { placements: __rec, order: __sorted.slice(0, 12).map(c => ({ a: c.action, line: c.line, behind: c.behind })) };
    if (__G.__pwMeasure) __G.__pwMain.m = __measure(state, legal, __rec!, value, opts);
  }
  return __sorted;
}

/**
 * PLACEMENT-WIRING (measure, the beta tree's untimed extra ask): S, C and D on the board the deciding Corp's order was
 * given (its own view: the Corp's own HQ and the public board, rule 10.2.2a).
 */
function __measure(state: GameState, legal: GameAction[], rec: any[], value: (a: GameAction) => { after: GameState; v: number } | null, opts: CandidateOptions) {
  const out: any = { cr: state.corp.credits, clicks: state.corp.clicks, held: opts.held ? { kind: opts.held.line.kind ?? 'agenda', server: opts.held.line.server } : null };
  // S
  out.s = __scoringShortBoth(state);
  if (out.s) out.s.placementsShort = !!__scoringShort(state);
  // G (addendum 1): assetCover's gate four ways
  out.g = __coverGates(state);
  // D: for each card with a counted destination, the centrals' state (the hold owner) and the dropped destinations by kind
  const kind = (d: string) => {
    if (d === 'hq' || d === 'rd' || d === 'archives' || d === 'new') return d;
    const v = state.corp.servers[d];
    const scoring = __scoringRemote(state);
    if (v?.root.some(c => typeOf(c) === 'agenda')) return d === scoring?.id ? 'agendaRemote(scoring)' : 'agendaRemote';
    return d === scoring?.id ? 'scoringRemote' : 'remote';
  };
  out.d = [];
  for (const r of rec) {
    if (!r.counted) continue;
    const at = r.returned[0]?.server;
    const dropped = [...new Set((r.offered as string[]).filter(d => d !== at))];
    const row: any = { card: r.card, title: r.title, type: r.type, rule: r.counted, to: at, toKind: kind(at), dropped: dropped.map(d => ({ d, k: kind(d) })) };
    if (r.type === 'ice') {
      const card = state.corp.hq.find(c => c.instanceId === r.card)!;
      row.centrals = (['hq', 'rd', 'archives'] as const).map(id => {
        const h = serverHold(state, id, { when: 'runnerTurn' });
        const loss = __stake(state, id, { leaving: card.instanceId }).loss;
        const a = legal.find(x => x.type === 'INSTALL_CARD' && (x as Install).cardInstanceId === card.instanceId && (x as Install).targetServerId === id && !(x as Install).faceUp) as Install | undefined;
        let improves: boolean | null = null;
        if (a) {
          try {
            const after = __exec(state, a);
            improves = __iceCountImproves(state, a, card, after);
          } catch {
            improves = null;
          }
        }
        return { id, ice: state.corp.servers[id].ice.length, holds: h.holds, entries: h.entries, loss, improves };
      });
      row.cls = r.counted === 'iceRedirect' && row.centrals.some((c: any) => c.loss > 0 && !c.holds && c.improves);
    }
    if (r.type === 'upgrade') row.cls = r.counted === 'assetPartner' && dropped.some(d => kind(d).startsWith('agendaRemote'));
    out.d.push(row);
  }
  // C: the asset cover candidates, valued three ways (today: the asset's own install; real: the move Q5 makes first; end: both steps of a pair)
  out.c = [];
  for (const r of rec) {
    for (const f of r.from as any[]) {
      if (f.reason !== 'assetCover') continue;
      const fromA = legal.find(x => x.type === 'INSTALL_CARD' && (x as Install).cardInstanceId === r.card && dest(x as Install) === f.from) as Install | undefined;
      if (!fromA) continue;
      const shape = (id: string, server: string) => ({ type: 'INSTALL_CARD', player: 'corp', cardInstanceId: id, ...(server === 'new' ? { asNewRemote: true } : { targetServerId: server }) }) as GameAction;
      const today = value(fromA);
      const real = value(f.pairWith ? shape(f.pairWith, f.server) : shape(r.card, f.server));
      let end: number | null = null;
      if (f.pairWith && real) {
        const s = Object.values(real.after.corp.servers).find(v => v.ice.some(c => c.instanceId === f.pairWith))?.id;
        const after2 = s ? simulate(real.after, shape(r.card, s)) : null;
        end = after2 ? evaluate(after2, 'corp') - evaluate(state, 'corp') : null;
      }
      out.c.push({ card: r.card, title: r.title, from: f.from, server: f.server, form: f.pairWith ? 'pair' : 'waiting', pairWith: f.pairWith, vToday: today?.v ?? null, vReal: real?.v ?? null, vEnd: end });
    }
  }
  return out;
}

function __iceCountImproves(state: GameState, a: Install, card: CardInstance, after: GameState): boolean | null {
  return iceCount(state, a, card, after)?.improves ?? null;
}`,
    ],
    // ---------------------------------------------------------------- freeKey
    [
      'ai/corp/candidates.ts',
      `  const key = options.join();`,
      `  const key = ${FREE} ? __pricingKey() + '|' + options.join() : options.join();`,
    ],
  ];
}

/** Copies this checkout's src into root/<arm>/src with the arm's patches; each patch must match exactly once. */
export function makeTrees(root: string, arms: readonly Arm[], from = 'src'): Record<string, string> {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const dirs: Record<string, string> = {};
  for (const arm of arms) {
    const dir = join(root, arm);
    mkdirSync(dir, { recursive: true });
    cpSync(from, join(dir, 'src'), { recursive: true });
    for (const [f, at, to] of patches(arm)) {
      const path = join(dir, 'src', f);
      const text = readFileSync(path, 'utf8');
      if (text.split(at).length !== 2) throw new Error(`tree ${arm}: a patch does not match once in ${f}: ${at.slice(0, 80)}`);
      writeFileSync(
        path,
        text.replace(at, () => to),
      );
    }
    dirs[arm] = dir;
  }
  return dirs;
}

export interface Tree {
  name: string;
  createAgent: (side: string, level: string) => any;
  GameRunner: any;
  core: any;
  decks: any;
  clear: () => void;
}

export async function loadTree(name: string, dir: string): Promise<Tree> {
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const mods: any[] = [];
  // One at a time: vite-node never settles concurrent imports of one circular graph
  for (const p of ['ai/index.ts', 'ai/playout.ts', 'core/index.ts', 'data/decks.ts', 'ai/handValues.ts', 'ai/effectValues.ts', 'ai/valueModel.ts', 'ai/iceValues.ts']) mods.push(await m(p));
  const [ai, po, core, decks, hv, ev, vm, iv] = mods;
  return {
    name,
    createAgent: ai.createAgent,
    GameRunner: po.GameRunner,
    core,
    decks,
    clear: () => {
      hv.clearHandCaches();
      ev.clearDamageThreats();
      vm.clearBuildTargets?.();
      iv.clearDeckShares?.();
      vm.valueLoops?.clear();
    },
  };
}
