/**
 * The leak fuzzer's twin-state check (multiplayer phase 2, chunk 2a). The
 * other checks look at what a view holds; this one looks at its shape. From a
 * state S and a blind side X, build a twin S' that differs from S only in
 * cards X may not see (two hidden cards with their codes swapped). X's views
 * of S and S' must be byte-identical, and stay so after the same action is
 * applied to both, until one of the swapped cards is shown to X. Anything
 * else (a log line more, a prompt that waits on the other side, a count) is a
 * difference X could read the hidden card from (rules 4.2.2, 7.1.2, 4.6.3).
 *
 *   R&D cards: hidden from both sides (4.2.2).
 *   HQ cards, facedown installed cards: hidden from the Runner (4.3.2, 4.6.3);
 *   an installed card swaps only with one of its install class (ice, upgrade, agenda or asset).
 *   Grip cards: hidden from the Corp (4.3.2).
 *
 * Twin games are played by random legal players with both sides' stops at
 * 'full': at 'auto' the Runner's game skips steps it has nothing to do in,
 * which is a tell Jeff accepted (2026-11-04, 2026-11-08); 'ai' is the AI's.
 */
import {
  CardInstance,
  GameAction,
  GameState,
  SideCode,
  ViewIds,
  actingSide,
  addLog,
  createInitialGameState,
  createRng,
  executeAction,
  fromEngineAction,
  getLegalActions,
  getCardDefinition,
  nextInt,
  viewFor,
} from '../src/core';
import type { RngState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import type { DeckList } from '../src/data/decks';
import { LeakChecker, RandomAgent, titleOf, visibility, type FuzzResult } from './leak-check';

export interface TwinStats {
  /** Twins built (S' differs from S in two hidden cards). */
  built: number;
  /** Twins whose views after the action were compared. */
  compared: number;
  /** Skipped: a swapped card was shown to the blind side by the action. */
  revealed: number;
  /** Skipped: the action was not legal in the twin, or threw. */
  illegal: number;
  /** Of those, actions taken by the blind side itself (it chose from its own view, so these deserve a look). */
  illegalBlind: number;
  /** A few examples of those, for the report. */
  illegalBlindExamples: string[];
  /** Steps where the blind side was to act and its legal lists in S and the twin were compared. */
  legalCompared: number;
}

export const newTwinStats = (): TwinStats => ({ built: 0, compared: 0, revealed: 0, illegal: 0, illegalBlind: 0, illegalBlindExamples: [], legalCompared: 0 });

type Kind = 'rd' | 'hq' | 'grip' | 'installed';
const KINDS: Record<SideCode, Kind[]> = { corp: ['rd', 'grip'], runner: ['rd', 'hq', 'installed'] };

const typeOf = (code: string) => {
  try {
    return getCardDefinition(code).type_code;
  } catch {
    return '';
  }
};

/** The first JSON path where two values differ. */
export function firstDiff(a: unknown, b: unknown, path = '$'): string | null {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return `${path}: ${JSON.stringify(a)?.slice(0, 120)} vs ${JSON.stringify(b)?.slice(0, 120)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array vs object`;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    for (let i = 0; i < Math.max(a.length, bb.length); i++) {
      const d = firstDiff(a[i], bb[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(ao), ...Object.keys(bo)])];
  for (const k of keys) {
    const d = firstDiff(ao[k], bo[k], `${path}.${k}`);
    if (d) return d;
  }
  // Same keys and values in a different order
  return JSON.stringify(a) === JSON.stringify(b) ? null : `${path}: key order`;
}

/** Two cards hidden from `blind` with different codes, of one kind; null when there are none. */
function pickPair(state: GameState, blind: SideCode, rng: RngState): [CardInstance, CardInstance] | null {
  const { hiddenIds, shownIds } = visibility(state, blind);
  // A card a declared intent or a pending prompt names was chosen for what it is: in the twin that choice could be
  // impossible and silently dropped (an install intent of an asset as ice), which says nothing about the views
  const named = new Set(JSON.stringify([state.priority?.intent ?? null, state.pendingPrompts]).match(/inst-\d+/g) ?? []);
  const free = (x: CardInstance) => hiddenIds.has(x.instanceId) && !shownIds.has(x.instanceId) && !named.has(x.instanceId) && !(x.hostedCards?.length);
  const kinds = KINDS[blind];
  const kind = kinds[nextInt(rng, kinds.length)];
  const pairs: [CardInstance, CardInstance][] = [];
  const within = (list: CardInstance[]) => {
    const cards = list.filter(free);
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) if (cards[i].cardCode !== cards[j].cardCode) pairs.push([cards[i], cards[j]]);
  };
  if (kind === 'rd') {
    // Half the time one of the pair is the top card, the one a run on R&D accesses
    const rd = state.corp.rd.filter(free);
    const top = rd[0];
    if (top && state.corp.rd[0] === top && nextInt(rng, 2) === 0) {
      for (const x of rd.slice(1)) if (x.cardCode !== top.cardCode) pairs.push([top, x]);
    } else within(state.corp.rd);
  }
  else if (kind === 'hq') within(state.corp.hq);
  else if (kind === 'grip') within(state.runner.grip);
  else {
    // A facedown installed card with an HQ card of the same install class: ice, upgrade, or agenda/asset. Installing
    // an agenda or asset trashes one in the root (8.5.6), which the Runner sees, so a root's class is not hidden by the twin
    const cls = (code: string) => ({ agenda: 'root-1', asset: 'root-1' })[typeOf(code) as 'agenda' | 'asset'] ?? typeOf(code);
    const hq = state.corp.hq.filter(free);
    for (const s of Object.values(state.corp.servers)) {
      for (const x of [...s.ice, ...s.root].filter(free)) {
        for (const h of hq) if (h.cardCode !== x.cardCode && cls(h.cardCode) === cls(x.cardCode)) pairs.push([x, h]);
      }
    }
  }
  return pairs.length ? pairs[nextInt(rng, pairs.length)] : null;
}

/** Every card instance in a state by id (hosted ones too). */
function cardsById(state: GameState): Map<string, CardInstance> {
  const out = new Map<string, CardInstance>();
  const add = (c: CardInstance) => {
    out.set(c.instanceId, c);
    c.hostedCards?.forEach(add);
  };
  const { corp, runner } = state;
  [corp.identity, runner.identity].forEach(add);
  for (const s of Object.values(corp.servers)) [...s.ice, ...s.root].forEach(add);
  for (const l of [corp.hq, corp.rd, corp.archives.faceUp, corp.archives.faceDown, corp.scoreArea, runner.grip, runner.stack, runner.heap, runner.rig.programs, runner.rig.hardware, runner.rig.resources, runner.scoreArea, state.removedFromGame]) l.forEach(add);
  return out;
}

/** A copy of the state with one more public log line. */
function withProbeLine(state: GameState): GameState {
  const copy = { ...state, log: state.log.slice() };
  addLog(copy, 'corp', 'Twin probe line.');
  return copy;
}

/** S with the codes of cards `a` and `b` swapped. */
function twinOf(state: GameState, a: string, b: string): GameState {
  const twin = structuredClone(state);
  const cards = cardsById(twin);
  const x = cards.get(a)!;
  const y = cards.get(b)!;
  [x.cardCode, y.cardCode] = [y.cardCode, x.cardCode];
  return twin;
}

/** Has either swapped card been shown to `blind` by the action (left the hidden set, shown by instance, named in its prompt or by a new log line it may read)? */
function shown(before: GameState, after: GameState, blind: SideCode, ids: string[]): boolean {
  const post = visibility(after, blind);
  const cards = cardsById(after);
  const codes = ids.map(id => cards.get(id)?.cardCode).filter((x): x is string => !!x);
  if (ids.some(id => !post.hiddenIds.has(id) || post.shownIds.has(id))) return true;
  // A prompt of the blind side's that names one of them (Méliès U looks at the top of R&D)
  const prompts = JSON.stringify(after.pendingPrompts.filter(p => p.side === blind));
  if (codes.some(code => titleOf(code).length >= 4 && prompts.includes(titleOf(code)))) return true;
  // A line written since that names one of the codes (Byte! is revealed when accessed, a card revealed by an effect)
  return after.log.slice(before.log.length).some(e => {
    if (e.secret?.from === blind) return false;
    return codes.some(code => e.cardCode === code || (titleOf(code).length >= 4 && e.message.includes(titleOf(code))));
  });
}

export type TwinOutcome = { kind: 'same' | 'revealed' | 'illegal'; legalCompared?: boolean } | { kind: 'differ'; before: boolean; path: string; legalCompared?: boolean };

/**
 * The twin check for one pair: `blind`'s views of S (`state`) and of its twin with the codes of cards `a` and `b`
 * swapped, before and after `action` (`next` is S after it). `ids` is the blind side's id map for S.
 */
export function twinCompare(state: GameState, action: GameAction, next: GameState, ids: ViewIds, blind: SideCode, a: string, b: string): TwinOutcome {
  const twin = twinOf(state, a, b);
  const v1 = viewFor(state, blind, ids, 'game');
  const v2 = viewFor(twin, blind, ids, 'game');
  const d0 = firstDiff(v1.view, v2.view) ?? firstDiff(v1.ids, v2.ids);
  if (d0) return { kind: 'differ', before: true, path: d0 };
  // The blind side to act: what it may do must not depend on the hidden cards either (in its own ids)
  const legalCompared = actingSide(state) === blind;
  if (legalCompared) {
    const mine = (s: GameState, vids: ViewIds) => getLegalActions(s, blind).map(x => fromEngineAction(x, vids));
    const d = firstDiff(mine(state, v1.ids), mine(twin, v2.ids));
    if (d) return { kind: 'differ', before: true, path: `legal actions ${d}`, legalCompared };
  }
  let nextTwin: GameState;
  try {
    nextTwin = executeAction(twin, action);
  } catch {
    return { kind: 'illegal', legalCompared };
  }
  if (shown(state, next, blind, [a, b]) || shown(twin, nextTwin, blind, [a, b])) return { kind: 'revealed', legalCompared };
  // The next public line, whoever writes it, shows how the log is numbered: a line dropped from the view must leave no gap
  const w1 = viewFor(withProbeLine(next), blind, v1.ids, 'game');
  const w2 = viewFor(withProbeLine(nextTwin), blind, v2.ids, 'game');
  const d = firstDiff(w1.view, w2.view) ?? firstDiff(w1.ids, w2.ids);
  return d ? { kind: 'differ', before: false, path: d, legalCompared } : { kind: 'same', legalCompared };
}

/**
 * One twin check per side at a step: S is `state`, `next` is S after
 * `action`, `ids` the checker's id maps for S. Failures go to the checker.
 */
export function twinStep(checker: LeakChecker, state: GameState, action: GameAction, next: GameState, ids: Record<SideCode, ViewIds>, step: number, rng: RngState, stats: TwinStats): void {
  for (const blind of ['corp', 'runner'] as SideCode[]) {
    const pair = pickPair(state, blind, rng);
    if (!pair) continue;
    const [a, b] = pair;
    const label = `${a.cardCode} ${titleOf(a.cardCode)} <-> ${b.cardCode} ${titleOf(b.cardCode)}`;
    stats.built++;
    const res = twinCompare(state, action, next, ids[blind], blind, a.instanceId, b.instanceId);
    if (res.legalCompared) stats.legalCompared++;
    if (res.kind === 'illegal') {
      stats.illegal++;
      if (action.player === blind) {
        stats.illegalBlind++;
        if (stats.illegalBlindExamples.length < 5) stats.illegalBlindExamples.push(`seed ${checker.seedOf()} step ${step}: ${JSON.stringify(action)} (${label})`);
      }
    }
    else if (res.kind === 'revealed') stats.revealed++;
    else {
      if (!(res.kind === 'differ' && res.before)) stats.compared++;
      if (res.kind === 'differ') checker.fail(step, blind, 'twin', res.before ? `views of S and its twin differ before the action (${label})` : `${action.type} by ${action.player}: views differ (${label})`, res.path);
    }
  }
}

/** Plays one random game with both sides' stops at 'full', with the usual checks and a twin check after every action. */
export function fuzzTwinGame(seed: number, corp: DeckList, runner: DeckList, maxSteps = 1500, recon = false): FuzzResult & { twin: TwinStats } {
  let state: GameState = { ...createInitialGameState(deckGameSetup(seed, corp, runner)), stops: { corp: 'full', runner: 'full' } };
  const agents = { corp: new RandomAgent('corp', seed), runner: new RandomAgent('runner', seed) };
  const checker = new LeakChecker(seed, recon);
  const rng = createRng(seed * 7 + 3);
  const twin = newTwinStats();
  let steps = 0;
  checker.check(state, 0);
  try {
    while (steps < maxSteps && !state.winner) {
      const side = actingSide(state);
      if (!side) break;
      const action = agents[side].chooseAction(state);
      const next = executeAction(state, action);
      twinStep(checker, state, action, next, checker.ids, steps + 1, rng, twin);
      state = next;
      steps++;
      checker.check(state, steps);
    }
  } catch (e) {
    checker.failures.push({ seed, step: steps, viewer: 'corp', check: 'crash', detail: `${e}`.slice(0, 200) });
  }
  return { seed, corp: corp.id, runner: runner.id, steps, winner: state.winner, failures: checker.failures, stats: checker.stats, twin };
}
