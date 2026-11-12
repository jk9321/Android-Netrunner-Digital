/**
 * Money step M0 (spec-money-generation.md): measurement only. Plays the game-0 deals Normal v Normal on this code and
 * records, one JSON line per deal:
 *  1. turns[]: at each Corp turn start, the best income line, the most credits (1.10) the Corp can be sure to have at its next
 *     turn start from this turn's clicks (a click for a credit, 5.2.6; econ operations in HQ at the turn start at what
 *     they give; econ asset and upgrade abilities; installing and rezzing econ assets, 8.5, 8.1.2), searched with the
 *     engine, counting credits at the turn's end plus the board's known turn-start payments (countedScore knownIncome),
 *     nothing from draws (bestStock / nettedStock: the same with credits hosted on its cards counted as owned, so
 *     taking them is not income, 1.10.4); against what the Corp netted by the same measure at its turn's end; the turn's clicks by kind,
 *     with the instances they touched for their fates; whether a counted line was held (scoreInTwo) at the turn start.
 *  2. econ operations: each Corp turn in HQ, playable (a legal play) or not, and one click short (playable after one
 *     click for a credit, with a click to spare); clicks for a credit on a turn one was playable.
 *  3. econ cards never used and why (in HQ at the end, discarded, never affordable).
 *  4. econ assets: credits back through their abilities and the turn-start gains while rezzed, install and rez paid,
 *     trashed by the Runner (its printed trash cost; bare or behind ice).
 *  5. econ abilities legal at a Corp decision and not used that turn.
 *  6. draws on turns 1-5: ice and econ cards in HQ at each draw.
 * The fates (ice rezzed later or never, asset trashed, advanced agenda scored or stolen) are read at the game's end.
 *
 *   SEEDS=1001,1011 [PLAN_OFF=...] npx vite-node scripts/money-m0.ts
 */
import { CardInstance, GameAction, GameState, cardDef, createInitialGameState, executeAction, getLegalActions } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff } from '../src/ai/synergy';
import { cardSynergy } from '../src/ai/synergyTags';
import { HeldLine, knownIncome } from '../src/ai/countedScore';

applyPlanOff(process.env.PLAN_OFF ?? '');

const typeOf = (c: CardInstance) => cardDef(c).type_code;
const isEcon = (c: CardInstance) => (cardSynergy(cardDef(c)).gives?.econ ?? 0) > 0;
const corpCards = (s: GameState) => [...Object.values(s.corp.servers).flatMap(v => [...v.ice, ...v.root])];
const find = (s: GameState, id: string) => corpCards(s).find(c => c.instanceId === id);

/** The income line's moves at this node: a click for a credit, econ operations from the turn start's HQ, econ abilities, econ asset installs (new remote) and rezzes. */
function incomeMoves(s: GameState, hqAtStart: Set<string>): GameAction[] {
  const out: GameAction[] = [];
  for (const a of getLegalActions(s, 'corp')) {
    const id = (a as { cardInstanceId?: string }).cardInstanceId;
    if (a.type === 'GAIN_CREDIT') out.push(a);
    else if (a.type === 'PLAY_OPERATION_OR_EVENT' && id && hqAtStart.has(id)) {
      const c = s.corp.hq.find(x => x.instanceId === id);
      if (c && isEcon(c)) out.push(a);
    } else if (a.type === 'USE_ABILITY' && id) {
      const c = find(s, id);
      if (c && isEcon(c)) out.push(a);
    } else if (a.type === 'INSTALL_CARD' && id && hqAtStart.has(id) && (a as { asNewRemote?: boolean }).asNewRemote) {
      const c = s.corp.hq.find(x => x.instanceId === id);
      if (c && isEcon(c) && typeOf(c) === 'asset') out.push(a);
    } else if (a.type === 'REZ_CARD' && id) {
      const c = find(s, id);
      if (c && isEcon(c) && typeOf(c) !== 'ice') out.push(a);
    }
  }
  return out;
}

/** Plays prompts out with their first answer (the line's operations give what they print). */
function settle(s: GameState): GameState | null {
  for (let i = 0; i < 20 && s.pendingPrompts.length; i++) {
    const a = getLegalActions(s, s.pendingPrompts[0].player ?? 'corp')[0];
    if (!a) return null;
    try {
      s = executeAction(s, a);
    } catch {
      return null;
    }
  }
  return s.pendingPrompts.length ? null : s;
}

const lineValue = (s: GameState) => s.corp.credits + knownIncome(s);
/** The same with the credits hosted on the Corp's installed cards counted as its own (taking them is not income). */
const stockValue = (s: GameState) => lineValue(s) + corpCards(s).reduce((n, c) => n + (c.tokens?.credit ?? 0), 0);

/** The best income line from a Corp turn start: credits at the turn's end plus known turn-start income. */
function bestLine(s: GameState, hqAtStart: Set<string>, measure = lineValue, depth = 0): { value: number; moves: string[] } {
  let best = { value: measure(s), moves: [] as string[] };
  if (depth > 6 || s.activePlayer !== 'corp' || s.activeRun) return best;
  const seen = new Set<string>();
  for (const a of incomeMoves(s, hqAtStart)) {
    const key = a.type + ':' + ((a as { cardInstanceId?: string }).cardInstanceId ? cardDef(find(s, (a as { cardInstanceId: string }).cardInstanceId) ?? s.corp.hq.find(x => x.instanceId === (a as { cardInstanceId: string }).cardInstanceId)!).code : '') + ':' + ((a as { abilityIndex?: number }).abilityIndex ?? '');
    if (seen.has(key)) continue;
    seen.add(key);
    let next: GameState | null;
    try {
      next = settle(executeAction(s, a));
    } catch {
      continue;
    }
    if (!next || next.turnNumber !== s.turnNumber || next.activePlayer !== 'corp') continue;
    const sub = bestLine(next, hqAtStart, measure, depth + 1);
    if (sub.value > best.value) best = { value: sub.value, moves: [key.split(':').slice(0, 2).join(':'), ...sub.moves] };
  }
  return best;
}

function clickKind(s: GameState, a: GameAction): string {
  const id = (a as { cardInstanceId?: string }).cardInstanceId;
  if (a.type === 'DRAW_CARD') return 'draw';
  if (a.type === 'GAIN_CREDIT') return 'credit';
  if (a.type === 'ADVANCE_CARD') return 'advance';
  if (a.type === 'PLAY_OPERATION_OR_EVENT') {
    const c = s.corp.hq.find(x => x.instanceId === id);
    return c && isEcon(c) ? 'econ operation' : 'operation';
  }
  if (a.type === 'INSTALL_CARD') {
    const c = s.corp.hq.find(x => x.instanceId === id);
    if (!c) return 'install other';
    return typeOf(c) === 'ice' ? 'install ice' : typeOf(c) === 'agenda' ? 'install agenda' : isEcon(c) ? 'install econ' : 'install other';
  }
  if (a.type === 'USE_ABILITY') {
    const c = id ? find(s, id) : undefined;
    return c && isEcon(c) ? 'econ ability' : 'ability';
  }
  return a.type === 'PURGE_VIRUS' ? 'purge' : a.type === 'TRASH_RESOURCE' ? 'trash resource' : '';
}

interface Turn {
  turn: number;
  best: number;
  bestMoves: string[];
  /** The line and the netted credits with hosted credits counted as owned. */
  bestStock: number;
  nettedStock?: number;
  start: number;
  netted?: number;
  held: boolean;
  clicks: Record<string, number>;
  touched: { kind: string; id: string }[];
}

function playDeal(seed: number) {
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  const p = Math.floor((seed - 1001) / 10);
  const c = corpDecks[Math.floor(p / runnerDecks.length)];
  const r = runnerDecks[p % runnerDecks.length];
  valueLoops.clear();
  const start = createInitialGameState(deckGameSetup(seed, c, r));
  const corp = createAgent('corp', 'normal');
  const runner = createAgent('runner', 'normal');
  const heldOf = () => (corp as unknown as { heldLine: HeldLine | null }).heldLine;
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  const ops = new Map<string, { title: string; inHq: number; playable: number; short: number; seen: number; used?: number }>();
  const econ = new Map<string, { title: string; type: string; seen: number; used?: number; everAffordable: boolean }>();
  const assets = new Map<string, { title: string; installed: number; rezzedAt?: number; installPaid: number; rezPaid: number; back: number; trashed?: { turn: number; trashCost: number; iced: boolean } }>();
  const rezzedIds = new Set<string>();
  const advanced = new Map<string, string>(); // agenda id -> turn advanced
  let creditWhilePlayable = 0;
  let abilityUnused = 0;
  const draws: { turn: number; hqIce: number; hqEcon: number }[] = [];
  let abilityLegal = false;
  let abilityUsed = false;

  const closeTurn = (s: GameState) => {
    if (!cur) return;
    cur.netted = lineValue(s);
    cur.nettedStock = stockValue(s);
    if (abilityLegal && !abilityUsed) abilityUnused++;
    cur = null;
  };

  const choose = corp.chooseAction.bind(corp);
  corp.chooseAction = (s: GameState) => {
    const a = choose(s);
    if (s.activePlayer !== 'corp' || s.activeRun || s.pendingPrompts.length || s.turnStep?.kind === 'corp_turn_start') return a;
    if (!cur || cur.turn !== s.turnNumber) {
      // A Corp turn's first main decision: the income line from here, the ops and econ cards in HQ
      const hq = new Set(s.corp.hq.map(x => x.instanceId));
      const line = bestLine(s, hq);
      cur = { turn: s.turnNumber, best: line.value, bestMoves: line.moves, bestStock: bestLine(s, hq, stockValue).value, start: s.corp.credits, held: !!heldOf() && heldOf()!.game === s.id, clicks: {}, touched: [] };
      turns.push(cur);
      abilityLegal = false;
      abilityUsed = false;
      const legal = getLegalActions(s, 'corp');
      for (const x of s.corp.hq) {
        if (isEcon(x)) {
          const e = econ.get(x.instanceId) ?? { title: cardDef(x).title, type: typeOf(x), seen: s.turnNumber, everAffordable: false };
          econ.set(x.instanceId, e);
          if (legal.some(l => (l as { cardInstanceId?: string }).cardInstanceId === x.instanceId && (l.type === 'PLAY_OPERATION_OR_EVENT' || l.type === 'INSTALL_CARD'))) e.everAffordable = true;
        }
        if (isEcon(x) && typeOf(x) === 'operation') {
          const o = ops.get(x.instanceId) ?? { title: cardDef(x).title, inHq: 0, playable: 0, short: 0, seen: s.turnNumber };
          ops.set(x.instanceId, o);
          o.inHq++;
          const playable = legal.some(l => l.type === 'PLAY_OPERATION_OR_EVENT' && (l as { cardInstanceId?: string }).cardInstanceId === x.instanceId);
          if (playable) o.playable++;
          else if (s.corp.clicks >= 2 && legal.some(l => l.type === 'GAIN_CREDIT')) {
            try {
              const after = executeAction(s, legal.find(l => l.type === 'GAIN_CREDIT')!);
              if (getLegalActions(after, 'corp').some(l => l.type === 'PLAY_OPERATION_OR_EVENT' && (l as { cardInstanceId?: string }).cardInstanceId === x.instanceId)) o.short++;
            } catch {
              /* not playable either way */
            }
          }
        }
      }
    }
    const legal = getLegalActions(s, 'corp');
    if (legal.some(l => l.type === 'USE_ABILITY' && (() => { const x = find(s, (l as { cardInstanceId: string }).cardInstanceId); return !!x && isEcon(x); })())) abilityLegal = true;
    const k = clickKind(s, a);
    if (k) {
      cur.clicks[k] = (cur.clicks[k] ?? 0) + 1;
      const id = (a as { cardInstanceId?: string }).cardInstanceId;
      if (id) cur.touched.push({ kind: k, id });
    }
    if (k === 'econ ability') abilityUsed = true;
    if (k === 'credit' && s.corp.hq.some(x => isEcon(x) && typeOf(x) === 'operation' && legal.some(l => l.type === 'PLAY_OPERATION_OR_EVENT' && (l as { cardInstanceId?: string }).cardInstanceId === x.instanceId))) creditWhilePlayable++;
    if (k === 'draw' && s.turnNumber <= 5) draws.push({ turn: s.turnNumber, hqIce: s.corp.hq.filter(x => typeOf(x) === 'ice').length, hqEcon: s.corp.hq.filter(isEcon).length });
    const id = (a as { cardInstanceId?: string }).cardInstanceId ?? '';
    if ((a.type === 'PLAY_OPERATION_OR_EVENT' || a.type === 'INSTALL_CARD') && econ.has(id)) econ.get(id)!.used ??= s.turnNumber;
    if (a.type === 'PLAY_OPERATION_OR_EVENT' && ops.has(id)) ops.get(id)!.used ??= s.turnNumber;
    if (a.type === 'ADVANCE_CARD') {
      const x = find(s, id);
      if (x && typeOf(x) === 'agenda') advanced.set(id, String(s.turnNumber));
    }
    return a;
  };

  let prev: GameState = start;
  const step = (s: GameState) => {
    // The Corp's turn ended: what it netted by the line's measure
    if (cur && prev.activePlayer === 'corp' && s.activePlayer === 'runner') closeTurn(prev);
    for (const x of corpCards(s)) if (x.isRezzed) rezzedIds.add(x.instanceId);
    // Econ assets: installed, rezzed, credits back, trashed by the Runner
    for (const x of corpCards(s)) {
      if (!isEcon(x) || typeOf(x) === 'ice' || typeOf(x) === 'agenda') continue;
      if (!assets.has(x.instanceId)) assets.set(x.instanceId, { title: cardDef(x).title, installed: s.turnNumber, installPaid: 0, rezPaid: 0, back: 0 });
      const e = assets.get(x.instanceId)!;
      const was = find(prev, x.instanceId);
      if (x.isRezzed && !was?.isRezzed) {
        e.rezzedAt = s.turnNumber;
        e.rezPaid = Math.max(0, prev.corp.credits - s.corp.credits);
      }
    }
    const gain = s.corp.credits - prev.corp.credits;
    if (gain > 0) {
      const rezzed = corpCards(prev).filter(x => x.isRezzed && assets.has(x.instanceId));
      // Credits back: a gain while only rezzed econ assets could give it, split among them (turn start and their abilities)
      const startOfTurn = prev.activePlayer !== s.activePlayer || prev.turnStep?.kind === 'corp_turn_start';
      const lost = rezzed.filter(x => (x.tokens?.credit ?? 0) > (find(s, x.instanceId)?.tokens?.credit ?? 0));
      const to = lost.length ? lost : startOfTurn ? rezzed : [];
      for (const x of to) assets.get(x.instanceId)!.back += gain / to.length;
    }
    if (s.activePlayer === 'runner' || s.activeRun)
      for (const v of Object.values(prev.corp.servers)) for (const x of v.root) {
        const e = assets.get(x.instanceId);
        if (e && !e.trashed && !find(s, x.instanceId) && (s.corp.archives.faceUp.some(y => y.instanceId === x.instanceId) || s.corp.archives.faceDown.some(y => y.instanceId === x.instanceId)))
          e.trashed = { turn: s.turnNumber, trashCost: cardDef(x).trash_cost ?? 0, iced: v.ice.length > 0 };
      }
    prev = s;
  };
  const game = new GameRunner(start, { corp, runner });
  for (let i = 0; i < 6000; i++) {
    step(game.state);
    if (!game.step()) break;
  }
  step(game.state);
  if (cur) closeTurn(game.state);
  const s = game.state;
  // Fates of what the turns' clicks touched
  const fate = (t: { kind: string; id: string }): string => {
    if (t.kind === 'install ice') return rezzedIds.has(t.id) ? 'rezzed' : 'never rezzed';
    if (t.kind === 'install econ' || t.kind === 'install other') {
      const e = assets.get(t.id);
      return e?.trashed ? 'trashed' : e && e.back >= e.rezPaid ? 'paid back' : e ? 'not paid back' : 'other';
    }
    if (t.kind === 'advance' || t.kind === 'install agenda') {
      if (s.corp.scoreArea.some(x => x.instanceId === t.id)) return 'scored';
      if (s.runner.scoreArea.some(x => x.instanceId === t.id)) return 'stolen';
      return 'other';
    }
    return '';
  };
  const never = [...econ.entries()].filter(([, e]) => e.used === undefined).map(([id, e]) => ({
    ...e,
    why: s.corp.hq.some(x => x.instanceId === id) ? (e.everAffordable ? 'in HQ at the end' : 'never affordable') : [...s.corp.archives.faceUp, ...s.corp.archives.faceDown].some(x => x.instanceId === id) ? 'discarded' : 'other',
  }));
  return {
    seed, corp: c.name, runner: r.name, winner: s.winner ?? null, lastTurn: s.turnNumber,
    turns: turns.map(t => ({ ...t, fates: t.touched.map(x => ({ kind: x.kind, fate: fate(x) })).filter(x => x.fate), touched: undefined })),
    ops: [...ops.values()], creditWhilePlayable, never, assets: [...assets.values()], abilityUnused, draws,
  };
}

const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
for (const seed of seeds) console.log(JSON.stringify(playDeal(seed)));
