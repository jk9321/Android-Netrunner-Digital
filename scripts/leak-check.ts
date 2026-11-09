/**
 * The leak fuzzer's checks (multiplayer phase 1), shared by scripts/leak-fuzz.ts
 * and tests/leakFuzz.test.ts. Plays games and, after every action, builds both
 * players' views and checks that neither carries anything its side may not
 * see. What each side may see is worked out here from the full state, on its
 * own, not with view.ts's code, so the two can catch each other out.
 */
import {
  CardInstance,
  GameAction,
  GameState,
  SideCode,
  ViewIds,
  actingSide,
  createInitialGameState,
  createRng,
  fromEngineAction,
  getCardDefinition,
  getCardScript,
  getLegalActions,
  nextInt,
  newViewIds,
  toEngineAction,
  viewFor,
} from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import type { DeckList } from '../src/data/decks';
import { createAgent } from '../src/ai';
import type { Agent } from '../src/ai/agent';
import { GameRunner } from '../src/ai/playout';
import { reconChecks, type ReconStats } from './leak-check-recon';

export interface LeakFailure {
  seed: number;
  step: number;
  viewer: SideCode;
  check: 'hidden-card' | 'hidden-code' | 'hidden-title' | 'view-id-shape' | 'internal' | 'ids' | 'round-trip' | 'purity' | 'crash' | 'recon' | 'seat' | 'twin';
  detail: string;
  /** JSON path in the view where it appeared. */
  path?: string;
}

const SIDES: SideCode[] = ['corp', 'runner'];

export const titleOf = (code: string): string => {
  try {
    return getCardDefinition(code).title;
  } catch {
    return '';
  }
};

const withHosted = (list: CardInstance[]): CardInstance[] => list.flatMap(c => [c, ...withHosted(c.hostedCards ?? [])]);

/**
 * What `side` may see now. `hidden`: cards in zones hidden from it (rules 4.2.2, 4.3.2, 4.4.6c, 4.6.3)
 * that it has not been shown. `shownIds`: hidden-zone cards it is shown or knows by instance (its
 * prompts, what it remembers of the other hand or R&D). `allowed`: codes it may see in the view now;
 * per code only where the allowance comes from text (a log line, a prompt's wording) or an open card.
 */
export function visibility(state: GameState, side: SideCode): { hidden: CardInstance[]; hiddenIds: Set<string>; shownIds: Set<string>; allowed: Set<string>; textCodes: Set<string>; openCodes: Set<string> } {
  const c = state.corp;
  const r = state.runner;
  const hidden: CardInstance[] = [...c.rd, ...r.stack];
  const open: CardInstance[] = [c.identity, r.identity, ...c.archives.faceUp, ...c.scoreArea, ...r.scoreArea, ...r.heap, ...r.rig.programs, ...r.rig.hardware, ...r.rig.resources, ...state.removedFromGame];
  const installed = Object.values(c.servers).flatMap(s => [...s.ice, ...s.root]);
  if (side === 'corp') {
    open.push(...c.hq, ...c.archives.faceDown, ...installed);
    hidden.push(...r.grip);
  } else {
    open.push(...r.grip, ...installed.filter(x => x.isRezzed || x.faceUp || x.runnerKnows));
    hidden.push(...c.hq, ...c.archives.faceDown, ...installed.filter(x => !(x.isRezzed || x.faceUp || x.runnerKnows)));
  }
  const openCodes = new Set(withHosted(open).map(x => x.cardCode));
  const allowed = new Set(openCodes);
  /** Codes allowed by text (log lines, prompt wording): these can't be tied to an instance. */
  const textCodes = new Set<string>();
  const shownIds = new Set<string>();
  // Hosted faceup cards show whatever the host is (4.6.3)
  for (const x of hidden) for (const h of withHosted(x.hostedCards ?? [])) shownIds.add(h.instanceId);
  // What the side remembers, by instance: cards seen in the other hand, the Runner's R&D knowledge
  for (const k of (side === 'corp' ? r.knownToCorp : c.knownToRunner) ?? []) shownIds.add(k.id);
  if (side === 'runner') for (const k of c.rdKnownToRunner ?? []) shownIds.add(k.id);
  // The side's own prompts may show it cards from hidden zones (the top of R&D, the card being accessed)
  const all = new Map(withHosted([...hidden, ...open, ...installed]).map(x => [x.instanceId, x]));
  for (const p of state.pendingPrompts) {
    if (p.side !== side) continue;
    const text = JSON.stringify(p);
    for (const id of text.match(/inst-\d+/g) ?? []) if (all.has(id)) shownIds.add(id);
    for (const x of all.values()) {
      const t = titleOf(x.cardCode);
      if (t && text.includes(t)) textCodes.add(x.cardCode);
    }
    if ('source' in p) {
      if (p.source.instanceId && all.has(p.source.instanceId)) shownIds.add(p.source.instanceId);
      else textCodes.add(p.source.cardCode);
    }
  }
  // Cards revealed to both players (rules 1.21.3): a log line that says so, or an R&D access that is revealed (Byte!)
  for (const e of state.log) {
    // A line kept from the other side was written for this one (the Runner looking at the top of R&D)
    if (e.secret && e.secret.from !== side && e.cardCode) textCodes.add(e.cardCode);
    if (e.secret) continue;
    if (e.event === 'access' && e.cardCode && getCardScript(e.cardCode)?.revealedOnRdAccess) textCodes.add(e.cardCode);
    if (/\breveal/i.test(e.message)) for (const x of all.values()) if (titleOf(x.cardCode) && e.message.includes(titleOf(x.cardCode))) textCodes.add(x.cardCode);
  }
  const hiddenIds = new Set(hidden.map(x => x.instanceId));
  // A card shown by instance lets its code appear (the view can't say which copy a code means)
  for (const x of withHosted(hidden)) if (shownIds.has(x.instanceId)) allowed.add(x.cardCode);
  for (const code of textCodes) allowed.add(code);
  return { hidden: withHosted(hidden).filter(x => !shownIds.has(x.instanceId) && !allowed.has(x.cardCode)), hiddenIds, shownIds, allowed, textCodes, openCodes };
}

/** Every path in `value` whose string contains `needle` (or whose key is `needle`). */
export function findPaths(value: unknown, test: (s: string) => boolean, path = '$', out: string[] = []): string[] {
  if (out.length >= 3) return out;
  if (typeof value === 'string') {
    if (test(value)) out.push(`${path} "${value.slice(0, 140)}"`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => findPaths(v, test, `${path}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (test(k)) out.push(`${path}.${k} (key)`);
      findPaths(v, test, `${path}.${k}`, out);
    }
  }
  return out;
}

const VIEW_ID_SHAPE = /\b[cr]\d+\b/;

/** Every string in a value, with its path (keys included). */
function strings(value: unknown, path = '$', out: [string, string][] = []): [string, string][] {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) strings(v, `${path}.${k}`, out);
  return out;
}

/** Every card object in a view (anything with a string instanceId), with its path. */
export function cardObjects(value: unknown, path = '$', out: [string, { instanceId: string; cardCode?: string }][] = []) {
  if (Array.isArray(value)) value.forEach((v, i) => cardObjects(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.instanceId === 'string' && 'isRezzed' in o) out.push([path, o as { instanceId: string; cardCode?: string }]);
    for (const [k, v] of Object.entries(o)) cardObjects(v, `${path}.${k}`, out);
  }
  return out;
}

export const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Follows one game, checking both views after each action. */
export class LeakChecker {
  ids: Record<SideCode, ViewIds> = { corp: newViewIds(), runner: newViewIds() };
  /** Codes each side has seen in text or an open place so far this game: per code, as text names no copy. */
  seen: Record<SideCode, Set<string>> = { corp: new Set(), runner: new Set() };
  /** Cards each side has been shown so far this game (prompts, knowledge), per instance. */
  seenIds: Record<SideCode, Set<string>> = { corp: new Set(), runner: new Set() };
  /** The viewer id each real card had when last in sight, and whether it was in sight at the last step. */
  last: Record<SideCode, Map<string, { vid: string; inSight: boolean }>> = { corp: new Map(), runner: new Map() };
  /** Viewer ids ever handed out, to the real card they named. */
  issued: Record<SideCode, Map<string, string>> = { corp: new Map(), runner: new Map() };
  failures: LeakFailure[] = [];
  /** With `recon`: the screen's reconstructions and seats are checked too (chunk 2, leak-check-recon.ts). */
  stats: ReconStats = { probes: 0, probeDisagreements: [], uiShapes: 0 };
  private prevRecon: Partial<Record<SideCode, GameState>> = {};

  constructor(private seed: number, private recon = false) {}

  seedOf(): number {
    return this.seed;
  }

  fail(step: number, viewer: SideCode, check: LeakFailure['check'], detail: string, path?: string) {
    if (this.failures.length < 50) this.failures.push({ seed: this.seed, step, viewer, check, detail, ...(path && { path }) });
  }

  check(state: GameState, step: number): void {
    const before = JSON.stringify(state);
    for (const side of SIDES) {
      const prevIds = this.ids[side];
      const prevIdsJson = JSON.stringify(prevIds);
      const { view, ids } = viewFor(state, side, prevIds, 'game');
      const again = viewFor(state, side, prevIds, 'game');
      const json = JSON.stringify(view);
      // 5. Pure
      if (JSON.stringify(again.view) !== json || JSON.stringify(again.ids) !== JSON.stringify(ids)) this.fail(step, side, 'purity', 'same input gave a different view');
      if (JSON.stringify(prevIds) !== prevIdsJson) this.fail(step, side, 'purity', 'viewFor changed the id map passed in');
      this.ids[side] = ids;

      // 2. No engine internals
      for (const bad of ['inst-', '"rng"', '"seed"', '"nextInstanceId"', '"nextPromptId"', '"rdNotes"', '"secret"']) {
        if (json.includes(bad)) this.fail(step, side, 'internal', bad, findPaths(view, s => s.includes(bad.replace(/"/g, '')))[0]);
      }

      // 1. No hidden card's code or title, unless seen before
      const { hidden, hiddenIds, shownIds, textCodes, openCodes } = visibility(state, side);
      // 1a. Instance level: no card object with a face may be a card hidden from this side now (prompts may show them)
      for (const [path, obj] of cardObjects(view)) {
        if (path.startsWith('$.pendingPrompts')) continue;
        const real = ids.real[obj.instanceId];
        if (real === undefined) this.fail(step, side, 'ids', `${obj.instanceId} not in the id map`, path);
        else if (obj.cardCode !== undefined && hiddenIds.has(real)) this.fail(step, side, 'hidden-card', `${obj.cardCode} ${titleOf(obj.cardCode)} is in a zone hidden from ${side}`, path);
      }
      // Codes seen in text or in an open place stay allowed (old log lines name them); cards shown in a hidden place, per instance
      for (const code of [...textCodes, ...openCodes]) this.seen[side].add(code);
      for (const id of shownIds) this.seenIds[side].add(id);
      const unseen = (x: CardInstance) => !this.seenIds[side].has(x.instanceId) && !this.seen[side].has(x.cardCode);
      // A code some copy of which was shown may appear: the view can't tie a code to a copy
      const shownCodes = new Set(withHosted([...state.corp.rd, ...state.corp.hq, ...state.runner.grip, ...state.runner.stack, ...state.corp.archives.faceDown, ...Object.values(state.corp.servers).flatMap(s => [...s.ice, ...s.root])]).filter(x => this.seenIds[side].has(x.instanceId)).map(x => x.cardCode));
      const leaked = new Set(hidden.filter(unseen).map(x => x.cardCode).filter(code => !shownCodes.has(code)));
      for (const code of leaked) {
        if (json.includes(`"${code}"`)) this.fail(step, side, 'hidden-code', `${code} ${titleOf(code)}`, findPaths(view, s => s === code)[0]);
        const title = titleOf(code);
        if (title.length >= 4 && json.includes(title)) {
          const re = new RegExp(`(^|[^\\w])${escape(title)}($|[^\\w])`);
          const paths = findPaths(view, s => re.test(s));
          if (paths.length) this.fail(step, side, 'hidden-title', `${code} ${title}`, paths[0]);
        }
      }

      if (this.recon) {
        this.prevRecon[side] = reconChecks(this, { state, side, view, ids, hiddenIds, leakedCodes: leaked, step, prev: this.prevRecon[side] });
      }

      // 3. Ids: one card per id, ids never reused, a card back from out of sight gets a new id
      const last = this.last[side];
      const issued = this.issued[side];
      for (const [vid, real] of Object.entries(ids.real)) {
        if (ids.view[real] !== vid) this.fail(step, side, 'ids', `map not one-to-one at ${vid}`);
        const was = issued.get(vid);
        if (was !== undefined && was !== real) this.fail(step, side, 'ids', `${vid} named another card before`);
        issued.set(vid, real);
        const prev = last.get(real);
        if (prev && !prev.inSight && prev.vid === vid) this.fail(step, side, 'ids', `${vid} kept its id after leaving sight`);
        if (prev && prev.inSight && prev.vid !== vid) this.fail(step, side, 'ids', `${vid} changed id while in sight (was ${prev.vid})`);
      }
      for (const [real, entry] of last) entry.inSight = real in ids.view;
      for (const [real, vid] of Object.entries(ids.view)) last.set(real, { vid, inSight: true });
    }
    // 3b. view.ts maps option ids token by token on /\b[cr]\d+\b/: no engine id may have that shape
    for (const p of state.pendingPrompts) {
      const ids = [...('options' in p ? p.options.map(o => o.id) : []), ...(p.kind === 'access_trash' ? (p.alternatives ?? []).map(a => a.id) : [])];
      for (const id of ids) if (VIEW_ID_SHAPE.test(id)) this.fail(step, p.side, 'view-id-shape', `engine option id ${id} looks like a viewer id`);
    }
    // 4. The acting side's legal actions round-trip through its ids
    const actor = actingSide(state);
    if (actor) {
      for (const a of getLegalActions(state, actor)) {
        if (a.player !== actor) continue;
        for (const [path, str] of strings(a)) if (VIEW_ID_SHAPE.test(str)) this.fail(step, actor, 'view-id-shape', `action string ${str} looks like a viewer id`, path);
        const mine = fromEngineAction(a, this.ids[actor]);
        if (!mine) {
          this.fail(step, actor, 'round-trip', `legal action names a card not in view: ${JSON.stringify(a)}`);
          continue;
        }
        let back: GameAction | null = null;
        try {
          back = toEngineAction(mine, this.ids[actor]);
        } catch (e) {
          this.fail(step, actor, 'round-trip', `${e}: ${JSON.stringify(mine)}`);
        }
        if (back && JSON.stringify(back) !== JSON.stringify(a)) this.fail(step, actor, 'round-trip', `${JSON.stringify(a)} came back as ${JSON.stringify(back)}`);
      }
    }
    if (JSON.stringify(state) !== before) this.fail(step, 'corp', 'purity', 'viewFor changed the state');
  }
}

/** A player that picks any legal move (seeded): finds odd states the AI never reaches. */
export class RandomAgent implements Agent {
  private rng;
  constructor(readonly side: SideCode, seed: number) {
    this.rng = createRng(seed * 2 + (side === 'corp' ? 0 : 1));
  }
  chooseAction(state: GameState): GameAction {
    const legal = getLegalActions(state, this.side).filter(a => a.type !== 'CONCEDE' && a.type !== 'SET_STOPS');
    // Prefer doing things to ending the turn, so games get somewhere
    const busy = legal.filter(a => a.type !== 'END_TURN' && a.type !== 'PASS');
    const pool = busy.length > 0 && nextInt(this.rng, 4) > 0 ? busy : legal;
    if (pool.length === 0) return { type: 'PASS', player: this.side };
    return pool[nextInt(this.rng, pool.length)];
  }
  chooseRez(_state: GameState, cards: CardInstance[]): GameAction | null {
    return cards.length > 0 && nextInt(this.rng, 2) === 0 ? { type: 'REZ_CARD', player: 'corp', cardInstanceId: cards[nextInt(this.rng, cards.length)].instanceId } : null;
  }
}

export interface FuzzResult {
  seed: number;
  corp: string;
  runner: string;
  steps: number;
  winner: SideCode | null;
  failures: LeakFailure[];
  stats: ReconStats;
}

/** Plays one game with leak checks after every action. */
export function fuzzGame(seed: number, corp: DeckList, runner: DeckList, players: 'ai' | 'random', maxSteps = 4000, recon = false): FuzzResult {
  const agent = (side: SideCode): Agent => (players === 'ai' ? createAgent(side, 'normal') : new RandomAgent(side, seed));
  const game = new GameRunner(createInitialGameState(deckGameSetup(seed, corp, runner)), { corp: agent('corp'), runner: agent('runner') });
  const checker = new LeakChecker(seed, recon);
  let steps = 0;
  checker.check(game.state, 0);
  try {
    while (steps < maxSteps && game.step()) {
      steps++;
      checker.check(game.state, steps);
    }
  } catch (e) {
    checker.failures.push({ seed, step: steps, viewer: 'corp', check: 'crash', detail: `${e}`.slice(0, 200) });
  }
  return { seed, corp: corp.id, runner: runner.id, steps, winner: game.state.winner, failures: checker.failures, stats: checker.stats };
}
