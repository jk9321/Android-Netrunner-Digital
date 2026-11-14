/**
 * Phase 2 item O (spec-phase2.md "O. Opening and valuation audit", Jeff 2026-11-09: is advancing undervalued, or are
 * assets and upgrades overvalued?). Watches a game step by step, like SpendTracker, and records:
 *
 * O1 openings: per Corp turn 1-6 the credits it started with and what each click went on (by kind); the Corp turn of
 *   its first ice (central or remote), first remote, first agenda install, first advance and first score.
 *   Agenda windows: every Corp main-phase decision where an agenda move was open in a safe window, and what was
 *   chosen there. A window is
 *   - 'advance': an agenda installed in a remote, a click and a credit to advance it (rules 5.2.6f, 1.18.3), and the
 *     server safe: never run since the agenda went in, or holding ice that is rezzed or that the Corp can pay to rez;
 *   - 'install': an agenda in HQ, a click (rule 5.2.6d), and an agenda-free remote with ice the Corp can rez or has
 *     rezzed (installing over an asset trashes it, rule 8.5.6a, so a remote with an asset counts too).
 *   At each window decision the chosen action's kind and its one-step score (the rule-based ranking the planner starts
 *   from, rankMainActions), the best agenda move's one-step score, and whether the planner overrode the one-step top.
 *
 * O3 card values: every card the Corp installs or plays on its own turn, with two "assigned worths": the one-step rule
 *   score of the action (rankMainActions: installScore/advanceScore
 *   points, the filter that picks the planner's candidates) and the evaluate delta of the move (the board worth the
 *   planner's leaf sees, in the AI's credit-equivalent units). Against them, what it returned over its life: credits
 *   paid out less the rez cost (assets/upgrades), fired or not; runs stopped, subroutines fired and credits taxed
 *   (ice); credits and cards back less the play cost (operations); scored or stolen
 *   (agendas). Lives come from SpendTracker's settle hooks, so both audits judge a card the same way.
 *
 * Measurement only: the ranking is read-only (rankMainActions on a fresh rule-based Corp AI, the call the agent itself
 * made on the same state; the decision context it notes is the one the agent noted for that state), and an identical
 * check (games=1 / 3 against the base batch) proves play does not change.
 */
import { CardInstance, GameAction, GameState } from '../src/core';
import { cardDef } from '../src/core/cards';
import { rezCost } from '../src/core/engine/cardEffects';
import { HeuristicCorpAI } from '../src/ai';
import { asSide } from '../src/ai/synergy';
import { moneyOpGain } from '../src/ai/corpAI';
import { evaluate } from '../src/ai/evaluate';
import { SpendListener } from './spend-audit';

type Server = GameState['corp']['servers'][string];

/** [corp turn, window ('advance' | 'install'), chosen kind, chosen one-step score, best agenda-move score (-999: all ruled out), best agenda kind, planner overrode the one-step top (1/0), one-step top kind, credits, clicks left] */
export type WindowRow = [number, string, string, number, number, string, 0 | 1, string, number, number];

/** [title, type, how it came in ('install' | 'play' | 'rez' | 'advance'), corp turn, one-step score, where (central / remote / '')] plus the life, filled when it settles */
export interface ValueRow {
  title: string;
  type: string;
  via: string;
  turn: number;
  score: number;
  /** evaluate(after) - evaluate(before) for the Corp: the move's worth in the AI's credit-equivalent units */
  worth: number;
  where: string;
  /** The one-step score of its rez on the Corp's own turn, when it was rezzed that way */
  rezScore?: number;
  /** Rez cost paid (roots, ice) */
  rez?: number;
  /** Credits it paid out / returned (assets, upgrades, operations gross back) */
  out?: number;
  /** Operations: credits paid to play, cards drawn */
  paid?: number;
  drew?: number;
  fired?: boolean;
  /** Ice: runs it ended, subroutines fired, credits the Runner paid to get past it */
  stops?: number;
  subs?: number;
  tax?: number;
  rezzed?: boolean;
  /** Agendas: scored / stolen / out / gone */
  fate?: string;
}

export interface OpeningRecord {
  /** Credits at the start of Corp turns 1-6 */
  startCredits: number[];
  /** Kinds of the Corp's click actions on turns 1-6, one array per turn */
  clicks: string[][];
  /** Corp turn of each first (0: never) */
  firstIce: number;
  firstIceWhere: string;
  firstRemote: number;
  firstAgendaInstall: number;
  firstAdvance: number;
  firstScore: number;
  windows: WindowRow[];
  /** Window supply: one row per Corp turn, at its first main-phase decision: [corp turn, status, credits, iced agenda-free remotes, of them holding an asset, agendas in HQ] (supplyAt) */
  supply?: [number, string, number, number, number, number][];
  /** Corp turn of the first supply row with a window (0: none) */
  firstWindow?: number;
  values: ValueRow[];
  /** Corp turns played */
  corpTurns: number;
}

const isAgenda = (c: CardInstance) => cardDef(c).type_code === 'agenda';
const CENTRAL = new Set(['hq', 'rd', 'archives']);

export function corpMainPhase(s: GameState): boolean {
  return s.activePlayer === 'corp' && !s.activeRun && s.pendingPrompts.length === 0 && !(s.priority && s.priority.holder !== 'corp') && s.turnStep?.kind !== 'corp_turn_start';
}

const cardIn = (s: GameState, id: string | undefined): CardInstance | undefined => {
  if (!id) return undefined;
  return s.corp.hq.find(c => c.instanceId === id) ?? Object.values(s.corp.servers).flatMap(sv => [...sv.root, ...sv.ice]).find(c => c.instanceId === id);
};
const serverOf = (s: GameState, id: string): Server | undefined => Object.values(s.corp.servers).find(sv => sv.root.some(c => c.instanceId === id) || sv.ice.some(c => c.instanceId === id));

/** A main-phase Corp action by kind (the O1 table's columns). */
export function actionKind(s: GameState, a: GameAction): string {
  switch (a.type) {
    case 'GAIN_CREDIT':
      return 'credit click';
    case 'DRAW_CARD':
      return 'draw';
    case 'END_TURN':
      return 'end turn';
    case 'SCORE_AGENDA':
      return 'agenda: score';
    case 'PURGE_VIRUS':
      return 'purge';
    case 'TRASH_RESOURCE':
      return 'trash resource';
    case 'USE_ABILITY':
      return 'ability';
    case 'INSTALL_CARD': {
      const c = cardIn(s, a.cardInstanceId);
      const t = c ? cardDef(c).type_code : '?';
      if (t === 'agenda') return 'agenda: install';
      if (t === 'ice') return CENTRAL.has(a.targetServerId ?? '') && !a.asNewRemote ? 'ice: central' : 'ice: remote';
      return t === 'asset' ? 'asset' : t === 'upgrade' ? 'upgrade' : t;
    }
    case 'ADVANCE_CARD': {
      const c = cardIn(s, a.cardInstanceId);
      if (!c) return 'advance: ?';
      return isAgenda(c) ? 'agenda: advance' : `advance: ${cardDef(c).type_code}`;
    }
    case 'PLAY_OPERATION_OR_EVENT': {
      const c = cardIn(s, a.cardInstanceId);
      return c && moneyOpGain(c.cardCode) !== undefined ? 'operation: money' : 'operation: other';
    }
    case 'REZ_CARD': {
      const c = cardIn(s, a.cardInstanceId);
      return `rez ${c ? cardDef(c).type_code : '?'}`;
    }
  }
  return a.type.toLowerCase();
}

const agendaMove = (kind: string) => kind.startsWith('agenda:');

/** Ice on the server the Corp can hold it with: rezzed already, or it can pay to rez what isn't. */
function holdable(s: GameState, sv: Server): boolean {
  if (sv.ice.length === 0) return false;
  const unrezzed = sv.ice.filter(i => !i.isRezzed).reduce((n, i) => n + rezCost(s, i), 0);
  return unrezzed <= s.corp.credits;
}

export class OpeningTracker {
  private corpTurn = 0;
  private lastTurnNumber = -1;
  private rec: OpeningRecord = { startCredits: [], clicks: [], firstIce: 0, firstIceWhere: '', firstRemote: 0, firstAgendaInstall: 0, firstAdvance: 0, firstScore: 0, windows: [], supply: [], values: [], corpTurns: 0 };
  private suppliedTurn = -1;
  /** Remote id -> run since its agenda went in */
  private runSince = new Map<string, boolean>();
  private byId = new Map<string, ValueRow>();
  private ranker = new HeuristicCorpAI({ synergy: true, planner: false });
  /** Operations played, waiting for SpendTracker's window to close (first in, first out by title) */
  private ops: ValueRow[] = [];

  /** Hooks for SpendTracker: each card's life as it settles. */
  readonly listener: SpendListener = {
    ice: (id, life) => {
      const row = this.byId.get(id);
      if (row) Object.assign(row, { stops: life.stops, subs: life.fired, tax: life.tax, rezzed: life.rezzed });
    },
    root: (id, life) => {
      const row = this.byId.get(id);
      if (row && !life.agenda) Object.assign(row, { rez: life.rezCost ?? undefined, out: life.paidOut, fired: life.fired, rezzed: life.rezCost !== null });
    },
    operation: (title, paid, returned, drew) => {
      const i = this.ops.findIndex(r => r.title === title);
      if (i < 0) return;
      const [row] = this.ops.splice(i, 1);
      Object.assign(row, { paid, out: returned, drew });
    },
  };

  /** Call with the state before the step, the state after and the action taken (GameRunner.last). */
  step(before: GameState, after: GameState, action?: GameAction, opts: { rank?: boolean } = {}) {
    if (before.activePlayer === 'corp' && before.turnNumber !== this.lastTurnNumber) {
      this.lastTurnNumber = before.turnNumber;
      this.corpTurn++;
      if (this.corpTurn <= 6) {
        this.rec.startCredits.push(before.corp.credits);
        this.rec.clicks.push([]);
      }
    }
    // Runs: a remote's agenda counts as unsafe once the Runner has run it
    if (!before.activeRun && after.activeRun && this.runSince.has(after.activeRun.server)) this.runSince.set(after.activeRun.server, true);
    for (const sv of Object.values(after.corp.servers)) {
      if (!sv.isRemote) continue;
      const has = sv.root.some(isAgenda);
      if (has && !this.runSince.has(sv.id)) this.runSince.set(sv.id, false);
      if (!has) this.runSince.delete(sv.id);
    }
    const k = this.corpTurn;
    // Firsts
    if (!this.rec.firstScore && after.corp.score > before.corp.score && after.corp.scoreArea.length > before.corp.scoreArea.length) this.rec.firstScore = k;
    if (!this.rec.firstRemote && Object.values(after.corp.servers).some(sv => sv.isRemote && sv.root.length + sv.ice.length > 0)) this.rec.firstRemote = k;

    if (!action || !corpMainPhase(before) || action.player !== 'corp' || action.type === 'START_TURN' || action.type === 'SET_STOPS') return;
    if (this.suppliedTurn !== k) {
      this.suppliedTurn = k;
      this.rec.supply!.push(this.supplyAt(before, k));
    }
    const kind = actionKind(before, action);
    if (k <= 6 && before.corp.clicks > after.corp.clicks) this.rec.clicks[k - 1]?.push(kind);
    if (!this.rec.firstIce && (kind === 'ice: central' || kind === 'ice: remote')) {
      this.rec.firstIce = k;
      this.rec.firstIceWhere = kind === 'ice: central' ? 'central' : 'remote';
    }
    if (!this.rec.firstAgendaInstall && kind === 'agenda: install') this.rec.firstAgendaInstall = k;
    if (!this.rec.firstAdvance && kind === 'agenda: advance') this.rec.firstAdvance = k;

    const window = this.windowAt(before);
    const cardAction = ['INSTALL_CARD', 'PLAY_OPERATION_OR_EVENT', 'REZ_CARD', 'ADVANCE_CARD'].includes(action.type);
    if (!window && !cardAction) return;
    if (opts.rank === false) return;
    const ranked = asSide('corp', () => this.ranker.rankMainActions(before));
    const same = (a: GameAction, b: GameAction) => JSON.stringify(a) === JSON.stringify(b);
    const chosen = ranked.find(r => same(r.action, action));
    const score = chosen ? chosen.score : NaN;
    const live = ranked.filter(r => r.score > -Infinity);
    if (window && process.env.OPENING_DEBUG) {
      console.error(`T${k} ${window} chose ${kind} (${round(score)}) credits ${before.corp.credits} clicks ${before.corp.clicks}`);
      for (const r of ranked.slice(0, 40)) console.error(`   ${round(r.score)}  ${actionKind(before, r.action)} ${JSON.stringify(r.action).slice(0, 140)}`);
    }
    if (window) {
      // The best agenda move by the one-step rule score, -999 when every agenda move is ruled out (-Infinity: e.g. an
      // advance that can't finish this turn with no ice to guard it, corpAI advanceScore)
      const bestAgenda = ranked.find(r => agendaMove(actionKind(before, r.action)));
      const top = live[0];
      this.rec.windows.push([
        k,
        window,
        kind,
        round(score),
        bestAgenda ? (bestAgenda.score === -Infinity ? -999 : round(bestAgenda.score)) : NaN,
        bestAgenda ? actionKind(before, bestAgenda.action) : '',
        top && !same(top.action, action) ? 1 : 0,
        top ? actionKind(before, top.action) : '',
        before.corp.credits,
        before.corp.clicks,
      ]);
    }
    if (cardAction && 'cardInstanceId' in action) this.noteValue(before, after, action, score, k);
  }

  private noteValue(before: GameState, after: GameState, action: GameAction & { cardInstanceId: string }, score: number, k: number) {
    const card = cardIn(before, action.cardInstanceId);
    if (!card) return;
    const def = cardDef(card);
    const via = action.type === 'INSTALL_CARD' ? 'install' : action.type === 'PLAY_OPERATION_OR_EVENT' ? 'play' : action.type === 'REZ_CARD' ? 'rez' : 'advance';
    // One row per card: its install (or play). A rez or advance of a card already listed adds nothing new here.
    if (via !== 'install' && via !== 'play') {
      const row = this.byId.get(card.instanceId);
      if (row && via === 'rez') row.rezScore = round(score);
      return;
    }
    const sv = via === 'install' ? serverOf(after, card.instanceId) : undefined;
    // The board worth the planner's leaf sees for the move: the evaluate delta, in the AI's credit-equivalent units
    const worth = asSide('corp', () => evaluate(after, 'corp') - evaluate(before, 'corp'));
    const row: ValueRow = { title: def.title, type: def.type_code, via, turn: k, score: round(score), worth: round(worth), where: sv ? (CENTRAL.has(sv.id) ? 'central' : 'remote') : '' };
    this.rec.values.push(row);
    if (via === 'play') this.ops.push(row);
    else this.byId.set(card.instanceId, row);
  }

  /**
   * Window supply (AI Coordinator 2026-11-09): how a Corp turn opens, tagged with ONE thing in a fixed order so the shares
   * sum to 100%. 'window: advance' (windowAt) or 'window: install' (an agenda in HQ and a remote with no agenda or asset
   * in its root, ice on it and that ice rezzed or affordable: an upgrade can share the root with an agenda, rule 8.5.6a,
   * an asset is trashed by the install, so a remote holding one is counted apart). Otherwise the missing thing:
   * 'installed agenda, unsafe' (one is out, none in HQ, its server run since and its ice not holdable) | 'no agenda in HQ'
   * | 'no remote' | 'remote holds an asset' (iced, holdable) | 'remote empty, no ice' | 'ice not holdable' | 'bare remote
   * holds an asset' | 'iced remotes hold agendas' | 'other'.
   */
  supplyAt(s: GameState, k: number): [number, string, number, number, number, number] {
    const remotes = Object.values(s.corp.servers).filter(sv => sv.isRemote);
    const free = remotes.filter(sv => !sv.root.some(isAgenda));
    const hasAsset = (sv: Server) => sv.root.some(c => cardDef(c).type_code === 'asset');
    const iced = free.filter(sv => sv.ice.length > 0);
    const hqAgendas = s.corp.hq.filter(isAgenda).length;
    const row = (status: string): [number, string, number, number, number, number] => [k, status, s.corp.credits, iced.length, iced.filter(hasAsset).length, hqAgendas];
    if (s.corp.clicks > 0 && hqAgendas && iced.some(sv => !hasAsset(sv) && holdable(s, sv))) return row('window: install');
    if (this.windowAt(s) === 'advance') return row('window: advance');
    if (!hqAgendas) return row(remotes.some(sv => sv.root.some(isAgenda)) ? 'installed agenda, unsafe' : 'no agenda in HQ');
    if (!remotes.length) return row('no remote');
    if (iced.some(sv => hasAsset(sv) && holdable(s, sv))) return row('remote holds an asset');
    if (free.some(sv => sv.ice.length === 0 && !hasAsset(sv))) return row('remote empty, no ice');
    if (iced.length) return row('ice not holdable');
    if (free.some(sv => sv.ice.length === 0 && hasAsset(sv))) return row('bare remote holds an asset');
    if (remotes.some(sv => sv.ice.length > 0)) return row('iced remotes hold agendas');
    return row('other');
  }

  /** The Corp turn of the first 'window: install' or 'window: advance' (supplyAt), 0 if none. */
  firstWindow(): number {
    return this.rec.supply?.find(r => r[1].startsWith('window'))?.[0] ?? 0;
  }

  windowAt(s: GameState): string | null {
    if (s.corp.clicks <= 0) return null;
    const remotes = Object.values(s.corp.servers).filter(sv => sv.isRemote);
    if (s.corp.credits >= 1) {
      for (const sv of remotes) {
        if (!sv.root.some(isAgenda)) continue;
        if (this.runSince.get(sv.id) === false || holdable(s, sv) || sv.ice.some(i => i.isRezzed)) return 'advance';
      }
    }
    if (s.corp.hq.some(isAgenda) && remotes.some(sv => !sv.root.some(isAgenda) && holdable(s, sv))) return 'install';
    return null;
  }

  done(final: GameState): OpeningRecord {
    for (const [id, row] of this.byId) {
      if (row.type !== 'agenda') continue;
      row.fate = final.corp.scoreArea.some(c => c.instanceId === id) ? 'scored' : final.runner.scoreArea.some(c => c.instanceId === id) ? 'stolen' : serverOf(final, id) ? 'out' : 'gone';
    }
    this.rec.corpTurns = this.corpTurn;
    this.rec.firstWindow = this.firstWindow();
    return this.rec;
  }
}

const round = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : n);
