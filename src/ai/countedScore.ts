import { CardInstance, GameAction, GameState, activePrompt, cardDef, executeAction, getLegalActions, rezCostOf } from '../core';
import { winNowAction } from './winNow';
import { iceCreditNeed } from './runs';
import { plan } from './pricing';

/**
 * Counted scores (Corp redesign stage 0, /mnt/project-files/netrunner-ai/redesign/spec-stage0.md M2; moved here from
 * scripts/plan-measure-lib.ts for stage 0b, spec-stage0b.md): can the Corp score an agenda this turn, or by the end of
 * its next turn with the server holding through the Runner's turn, by counting only?
 *
 * Viewpoint: the Corp's own cards and HQ, the public board, the Runner's installed cards, credits and clicks. Nothing
 * reads the Runner's grip or either deck's order; the one engine search (winNowAction) cuts every line that changes R&D.
 * Every function reads states and never edits one (a state some check needs changed is a structuredClone).
 *
 * Stage 0b's two measurement instruments live here too (oracleCorpPick, plan.oracle.countedScore / centralsLight):
 * default off and off for the Runner (sideOff.runner 'oracle'), never a shipping default (codeHealth OFF_SWITCHES).
 */

const typeOf = (c: CardInstance | undefined) => (c ? cardDef(c).type_code : undefined);
const isAgenda = (c: CardInstance | undefined) => typeOf(c) === 'agenda';
const text = (c: CardInstance) => cardDef(c).stripped_text ?? '';
const remotes = (s: GameState) => Object.values(s.corp.servers).filter(v => v.isRemote);
const installedAgendas = (s: GameState) => Object.values(s.corp.servers).flatMap(v => v.root.filter(isAgenda).map(c => ({ card: c, server: v.id })));
const serverOf = (s: GameState, id: string): string | undefined =>
  Object.values(s.corp.servers).find(v => v.root.some(c => c.instanceId === id) || v.ice.some(c => c.instanceId === id))?.id;

/** The Corp's main phase, outside a run and every prompt and window (where a line's next action is taken). */
export const isCorpMain = (s: GameState) =>
  s.activePlayer === 'corp' && !s.activeRun && s.pendingPrompts.length === 0 && !s.turnStep && !(s.priority && s.priority.holder !== 'corp') && !s.winner;

export interface ThisTurn {
  feasible: boolean;
  /** The line found (plan.winNow's search): its actions, and whether it used a card ability or an operation. */
  line: GameAction[];
  usedCard: boolean;
  agenda?: string;
  agendaId?: string;
}

/**
 * Can the Corp score an agenda this turn with the clicks and credits it has (rules 1.17.3a-c: scored once its
 * advancement counters reach the requirement, not an action, no click; 5.2.6f / 1.18.1: [click], 1[credit]: advance 1
 * installed card)? The exact search of plan.winNow (src/ai/winNow.ts, called unchanged): with the Corp's score set to 6
 * on a copy, a line that scores any agenda wins (1.17.2), so its win search becomes a score search. It plays only the
 * Corp's own turn and cuts every line that changes R&D. Blind spot: cards whose text reads the Corp's score.
 */
export function scoreThisTurn(state: GameState): ThisTurn {
  if (!isCorpMain(state) || state.corp.clicks <= 0) return { feasible: false, line: [], usedCard: false };
  const agendas = [...state.corp.hq.filter(isAgenda), ...installedAgendas(state).map(a => a.card)];
  if (!agendas.length) return { feasible: false, line: [], usedCard: false };
  // The engine adds the agenda's points to the score (actions/corp.ts), so from 6 any 1-point agenda wins
  let s: GameState = structuredClone(state);
  s.corp.score = 6;
  const line: GameAction[] = [];
  for (let i = 0; i < 20 && !s.winner; i++) {
    const a = winNowAction(s);
    if (!a) break;
    line.push(a);
    s = executeAction(s, a);
  }
  // A win some other way (a flatline, points added without scoring: 1.17.3e) is not a score line
  const scored = s.winner === 'corp' ? s.corp.scoreArea.find(c => isAgenda(c) && !state.corp.scoreArea.some(x => x.instanceId === c.instanceId)) : undefined;
  const won = !!scored;
  return { feasible: won, line: won ? line : [], usedCard: won && line.some(a => a.type === 'USE_ABILITY' || a.type === 'PLAY_OPERATION_OR_EVENT'), agenda: scored ? cardDef(scored).title : undefined, agendaId: scored?.instanceId };
}

/** Credits the Corp can count on next turn: rezzed cards whose text pays it as its turn begins. */
export function knownIncome(state: GameState): number {
  let n = 0;
  for (const c of Object.values(state.corp.servers).flatMap(v => v.root)) {
    if (!c.isRezzed) continue;
    const m = /when your turn begins, (?:you may )?(?:take|gain) (\d+)\s*\[credit\]/i.exec(text(c));
    if (m) n += Number(m[1]);
  }
  return n;
}

/** Sensitivity knob for the stage 0 report: extra credits granted to the Runner's run (an economy event from the grip it may hold). */
export const CHECK = { runnerExtra: 0 };

/** The Runner's budget for one run on its next turn, from public facts: its credits, and every click but the run's spent on credits (5.2.7a). */
export const runnerBudget = (s: GameState) => s.runner.credits + Math.max(0, s.runner.maxClicks - 1) + CHECK.runnerExtra;

/**
 * The cheapest rez spend that keeps the Runner out of a server with these ice, or null when no affordable set does. The
 * Corp rezzes ice as it is approached (rules 3.4.3a, 6.9.2b); unrezzed ice is passed (6.9.2c). With a set S rezzed, the
 * Runner needs the sum of iceCreditNeed (runs.ts: the credits to break the ice's run-ending subroutines with its
 * installed breakers, the engine's breaker scripts; BLOCK when none can) over S, against runnerBudget. Capability, not
 * our Runner AI's choice.
 */
export function holdCost(state: GameState, ice: CardInstance[], corpCredits: number): number | null {
  const budget = runnerBudget(state);
  // The Runner's turn: its clicks back (a bioroid broken by clicks, runs.ts plainCreditNeed), one kept for the run
  const view: GameState = { ...state, runner: { ...state.runner, clicks: Math.max(0, state.runner.maxClicks - 1) } };
  const n = Math.min(ice.length, 10);
  let best: number | null = null;
  for (let mask = 0; mask < 1 << n; mask++) {
    let rez = 0;
    let need = 0;
    for (let i = 0; i < n; i++) {
      const c = ice[i];
      const on = !!(mask & (1 << i));
      if (c.isRezzed && on) {
        rez = Infinity; // each set once: a rezzed ice's bit stays clear
        break;
      }
      if (!c.isRezzed && !on) continue;
      if (!c.isRezzed) rez += rezCostOf(view, c);
      const up = c.isRezzed ? c : { ...c, isRezzed: true };
      need += iceCreditNeed(withIce(view, up), up);
    }
    if (rez <= corpCredits && need > budget && (best === null || rez < best)) best = rez;
  }
  return best;
}

/** A copy-free view with this one ice standing in for its unrezzed self (iceCreditNeed reads the board for strength). */
function withIce(state: GameState, ice: CardInstance): GameState {
  const server = Object.values(state.corp.servers).find(v => v.ice.some(c => c.instanceId === ice.instanceId));
  if (!server) return state;
  return { ...state, corp: { ...state.corp, servers: { ...state.corp.servers, [server.id]: { ...server, ice: server.ice.map(c => (c.instanceId === ice.instanceId ? ice : c)) } } } };
}

export interface TwoTurnLine {
  agenda: string;
  agendaId: string;
  /** The server's id, or 'new remote' */
  server: string;
  /** 'installed' | 'install' (from HQ into an iced remote) | 'install+ice' (with an ice from HQ in front) */
  form: 'installed' | 'install' | 'install+ice';
  /** The ice from HQ installed in front ('install+ice') */
  iceId?: string;
  advanceNow: number;
  advanceNext: number;
  rez: number;
}

/**
 * Can the Corp score an agenda by the end of its next turn, by counting only (spec M2 "feasible in two turns")? This
 * turn: (install it and) advance it a times, the rest of the clicks for credits (5.2.6a); next turn advance the rest
 * (1.18.1, 5.2.6f) and score (1.17.3a-c). In between, the server must hold through the Runner's turn: holdCost finds a
 * rez set it can afford with what it ends the turn with. Next turn's credits: what is left after that rez, its known
 * income and any clicks spare. Agendas only go in a remote with no agenda or asset in its root (a new one only with an
 * ice from HQ in front: 8.5.11a, 1 credit per ice already protecting it). No card abilities: those are the blind spot.
 */
export function scoreInTwo(state: GameState): TwoTurnLine | null {
  if (!isCorpMain(state)) return null;
  const C = state.corp.clicks;
  const N = state.corp.maxClicks + (state.corp.bonusClicksNextTurn ?? 0);
  const K = state.corp.credits;
  const income = knownIncome(state);
  const hqIce = state.corp.hq.filter(c => typeOf(c) === 'ice');
  const open = remotes(state).filter(v => !v.root.some(c => isAgenda(c) || typeOf(c) === 'asset'));
  type Try = { agenda: CardInstance; server: string; ice: CardInstance[]; clicks: number; credits: number; form: TwoTurnLine['form']; iceId?: string };
  const tries: Try[] = [];
  for (const a of installedAgendas(state)) tries.push({ agenda: a.card, server: a.server, ice: state.corp.servers[a.server].ice, clicks: 0, credits: 0, form: 'installed' });
  for (const agenda of state.corp.hq.filter(isAgenda)) {
    for (const v of open) {
      if (v.ice.length) tries.push({ agenda, server: v.id, ice: v.ice, clicks: 1, credits: 0, form: 'install' });
      for (const ice of uniqueByCode(hqIce)) tries.push({ agenda, server: v.id, ice: [...v.ice, ice], clicks: 2, credits: v.ice.length, form: 'install+ice', iceId: ice.instanceId });
    }
    for (const ice of uniqueByCode(hqIce)) tries.push({ agenda, server: 'new remote', ice: [ice], clicks: 2, credits: 0, form: 'install+ice', iceId: ice.instanceId });
  }
  let best: TwoTurnLine | null = null;
  for (const t of tries) {
    const left = (cardDef(t.agenda).advancement_cost ?? 0) - t.agenda.advancementCounters;
    if (left <= 0) continue; // scorable now: the this-turn check's case
    for (let a = 0; a <= Math.min(left - 1, C - t.clicks); a++) {
      const r = left - a;
      if (r > N) continue;
      const end = K - t.credits - a + (C - t.clicks - a);
      if (end < 0) continue;
      const rez = holdCost(state, t.ice, end);
      if (rez === null) continue;
      const nextCredits = end - rez + income + (N - r);
      if (nextCredits < r) continue;
      const line: TwoTurnLine = { agenda: cardDef(t.agenda).title, agendaId: t.agenda.instanceId, server: t.server, form: t.form, ...(t.iceId ? { iceId: t.iceId } : {}), advanceNow: a, advanceNext: r, rez };
      if (!best || r < best.advanceNext) best = line;
      break;
    }
  }
  return best;
}

const uniqueByCode = (cards: CardInstance[]) => [...new Map(cards.map(c => [c.cardCode, c])).values()];

/**
 * Whether an installed agenda's line still holds from `state` (a line under way, spec stage 0b I1): the clicks left
 * this turn all go to credits, the server holds through the Runner's turn (holdCost, with what the Corp ends on), and
 * next turn's clicks and credits finish it. Same counting as scoreInTwo's 'installed' form with no advance now.
 */
export function lineHolds(state: GameState, agendaId: string): boolean {
  const server = installedAgendas(state).find(a => a.card.instanceId === agendaId);
  if (!server) return false;
  const card = server.card;
  const r = (cardDef(card).advancement_cost ?? 0) - card.advancementCounters;
  const N = state.corp.maxClicks + (state.corp.bonusClicksNextTurn ?? 0);
  if (r <= 0) return true;
  if (r > N) return false;
  const end = state.corp.credits + (state.activePlayer === 'corp' ? state.corp.clicks : 0);
  const rez = holdCost(state, state.corp.servers[server.server].ice, end);
  return rez !== null && end - rez + knownIncome(state) + (N - r) >= r;
}

// ------------------------------------------------------------------------------------------- stage 0b instruments

/** One forced two-turn line (I1), and what became of it (filled in as the game goes; scripts/corp-losses.ts reads it). */
export interface ForcedLine {
  turn: number;
  agendaId: string;
  form: TwoTurnLine['form'];
  /** At the Corp's next turn: the check found the score ('scorable'), did not ('dropped'), or the agenda had gone ('gone'). */
  next?: 'scorable' | 'dropped' | 'gone';
}

/**
 * Diagnostics for one game at a time (scripts/corp-losses.ts resets them per deal): Corp decisions where the
 * instruments changed the pick, by why; forced two-turn lines; central-ice installs held back.
 */
export const countedStats = {
  /** Decisions where a score this turn was found and its next action played over the Corp's own pick. */
  nowForced: 0,
  /** Decisions where a score-this-turn line was found (forced or the Corp's own pick already). */
  nowFound: 0,
  /** Two-turn lines begun. */
  lines: [] as ForcedLine[],
  /** Decisions where a line's next step (install ice, install the agenda, advance) was played over the Corp's own pick. */
  stepsForced: 0,
  /** Decisions where the Corp's own pick would have broken a line under way, and a click for a credit was taken. */
  restVetoed: 0,
  /** Central ice installs held back (I2). */
  centralHeld: 0,
};
export function resetCountedStats() {
  countedStats.nowForced = 0;
  countedStats.nowFound = 0;
  countedStats.lines = [];
  countedStats.stepsForced = 0;
  countedStats.restVetoed = 0;
  countedStats.centralHeld = 0;
  mem.lock = null;
  mem.successes = { game: '', turns: new Map() };
}

interface Lock {
  game: string;
  turn: number;
  line: TwoTurnLine;
  /** The server once known (a new remote's id after its ice goes in). */
  server: string | null;
  /** Counters on the agenda when the line began (installed form), or 0. */
  counters: number;
  record: ForcedLine;
}
/** The instruments' memory across one game's decisions (a lock on a line, the run record): one holder, reset per game. */
const mem: { lock: Lock | null; successes: { game: string; turns: Map<number, Set<string>> } } = { lock: null, successes: { game: '', turns: new Map() } };

const sameAction = (a: GameAction, want: Partial<GameAction> & Record<string, unknown>) =>
  Object.entries(want).every(([k, v]) => (a as unknown as Record<string, unknown>)[k] === v) && !(a as { trashFirst?: string[] }).trashFirst?.length && !(a as { faceUp?: boolean }).faceUp;

/** The legal action of this shape, or undefined. */
function legalOf(state: GameState, want: Partial<GameAction> & Record<string, unknown>): GameAction | undefined {
  return getLegalActions(state, 'corp').find(a => sameAction(a, want));
}

/** The locked line's next concrete step this turn (ice, agenda, advance), null when only the spare clicks remain, 'drop' when it can't go on. */
function lockStep(state: GameState, l: Lock): GameAction | null | 'drop' {
  const { line } = l;
  const id = line.agendaId;
  const inHq = state.corp.hq.some(c => c.instanceId === id);
  if (l.server === null && line.server !== 'new remote') l.server = line.server;
  if (l.server === null && line.iceId) l.server = serverOf(state, line.iceId) ?? null;
  if (inHq) {
    if (line.form === 'install+ice' && line.iceId && state.corp.hq.some(c => c.instanceId === line.iceId)) {
      const want = l.server ? { type: 'INSTALL_CARD', cardInstanceId: line.iceId, targetServerId: l.server } : { type: 'INSTALL_CARD', cardInstanceId: line.iceId, asNewRemote: true };
      return legalOf(state, want as Record<string, unknown>) ?? 'drop';
    }
    if (!l.server) return 'drop';
    return legalOf(state, { type: 'INSTALL_CARD', cardInstanceId: id, targetServerId: l.server } as Record<string, unknown>) ?? 'drop';
  }
  const at = installedAgendas(state).find(a => a.card.instanceId === id);
  if (!at) return 'drop';
  if (at.card.advancementCounters - l.counters < line.advanceNow) return legalOf(state, { type: 'ADVANCE_CARD', cardInstanceId: id } as Record<string, unknown>) ?? 'drop';
  return null;
}

/** plan.oracle.centralsLight: the servers the Runner ran successfully on, by the Corp turn it was noted on (the public run record, rules 6.9.1a). */
function recentSuccess(state: GameState, server: string): boolean {
  if (mem.successes.game !== state.id || [...mem.successes.turns.keys()].some(t => t > state.turnNumber)) mem.successes = { game: state.id, turns: new Map() };
  if (state.activePlayer === 'corp' && !mem.successes.turns.has(state.turnNumber))
    mem.successes.turns.set(state.turnNumber, new Set(state.runnerLastTurnRuns.filter(r => r.successful).map(r => r.server)));
  // The Runner's last two turns: the two latest Corp turns noted
  const latest = [...mem.successes.turns.keys()].sort((a, b) => b - a).slice(0, 2);
  return latest.some(t => mem.successes.turns.get(t)!.has(server));
}

const CENTRALS = new Set(['hq', 'rd', 'archives']);

/** plan.oracle.centralsLight: an ice install the instrument forbids (a second or later ice on a central, no recent successful run there, not lethal HQ). */
function heavyCentral(state: GameState, a: GameAction, lethalHq: (s: GameState) => boolean): boolean {
  if (a.type !== 'INSTALL_CARD') return false;
  const target = (a as { targetServerId?: string }).targetServerId;
  if (!target || !CENTRALS.has(target)) return false;
  const card = state.corp.hq.find(c => c.instanceId === a.cardInstanceId);
  if (typeOf(card) !== 'ice') return false;
  const ice = state.corp.servers[target].ice.length - ((a as { trashFirst?: string[] }).trashFirst?.length ?? 0);
  if (ice < 1) return false;
  if (recentSuccess(state, target)) return false;
  return !(target === 'hq' && lethalHq(state));
}

/**
 * Stage 0b's instruments (spec-stage0b.md), called by the Corp after its own pick (corpAI.ts decide, after the winNow
 * hook): `chosen` is the Corp's pick, `ranked` its ranked main actions. Measurement only, default off.
 *
 *  - plan.oracle.centralsLight (I2): no ice on HQ, R&D or Archives beyond the first piece each, unless the Runner ran
 *    successfully on that server in its last two turns or the lethal-HQ rule applies; the next-ranked action instead.
 *  - plan.oracle.countedScore (I1): a score this turn the check finds is played (its next action); otherwise a two-turn
 *    line that holds (scoreInTwo) is begun and its steps played (ice, agenda, advances), and the turn's spare clicks go
 *    to the Corp's own pick only while the line still holds after it (lineHolds), a click for a credit otherwise.
 *    With plan.oracle.countedStrict on too, every hold is judged with the Runner on STRICT_EXTRA credits more.
 *    countedNowOnly / countedTwoOnly (AI Coordinator 2026-11-10: I1's two halves apart) keep only the score-this-turn
 *    half or only the two-turn half.
 */
export function oracleCorpPick(state: GameState, chosen: GameAction, ranked: { action: GameAction; score: number }[], lethalHq: (s: GameState) => boolean): GameAction {
  const o = plan().oracle as { countedScore?: boolean; countedStrict?: boolean; countedNowOnly?: boolean; countedTwoOnly?: boolean; centralsLight?: boolean } | undefined;
  if (!o?.countedScore && !o?.centralsLight) return chosen;
  if (activePrompt(state)) return chosen;
  let pick = chosen;
  if (o.centralsLight && heavyCentral(state, pick, lethalHq)) {
    countedStats.centralHeld++;
    pick = ranked.find(r => r.score > -Infinity && !heavyCentral(state, r.action, lethalHq))?.action ?? getLegalActions(state, 'corp').find(a => a.type === 'END_TURN') ?? pick;
  }
  if (!o.countedScore || !isCorpMain(state)) return pick;
  // plan.oracle.countedStrict (the dial's strict setting, AI Coordinator 2026-11-10): the line must hold with the
  // Runner on 4 credits more than it has (an economy event it may hold); loose: against its credits as they stand
  const saved = CHECK.runnerExtra;
  if (o.countedStrict) CHECK.runnerExtra = saved + STRICT_EXTRA;
  try {
    return countedPick(state, pick, { now: !o.countedTwoOnly, two: !o.countedNowOnly });
  } finally {
    CHECK.runnerExtra = saved;
  }
}

/** The strict setting's extra Runner credits (stage 0's runnerExtra=4 sensitivity check). */
export const STRICT_EXTRA = 4;

function countedPick(state: GameState, pick: GameAction, halves: { now: boolean; two: boolean }): GameAction {
  noteNextTurn(state);
  if (state.corp.clicks <= 0) return pick;
  const now = halves.now ? scoreThisTurn(state) : null;
  if (now?.feasible && now.line.length) {
    countedStats.nowFound++;
    if (mem.lock?.line.agendaId !== now.agendaId) mem.lock = null;
    if (!sameAction(pick, now.line[0] as unknown as Record<string, unknown>)) countedStats.nowForced++;
    return now.line[0];
  }
  if (mem.lock && (mem.lock.game !== state.id || mem.lock.turn !== state.turnNumber)) mem.lock = null;
  if (!halves.two) return pick;
  if (!mem.lock) {
    const line = scoreInTwo(state);
    if (!line) return pick;
    const card = installedAgendas(state).find(a => a.card.instanceId === line.agendaId)?.card;
    const record: ForcedLine = { turn: state.turnNumber, agendaId: line.agendaId, form: line.form };
    countedStats.lines.push(record);
    mem.lock = { game: state.id, turn: state.turnNumber, line, server: line.server === 'new remote' ? null : line.server, counters: card?.advancementCounters ?? 0, record };
  }
  const lock = mem.lock;
  const step = lockStep(state, lock);
  if (step === 'drop') {
    mem.lock = null;
    return pick;
  }
  if (step) {
    if (!sameAction(pick, step as unknown as Record<string, unknown>)) countedStats.stepsForced++;
    return step;
  }
  // The spare clicks: the Corp's own pick while the line still holds after it
  let after: GameState | null;
  try {
    after = executeAction(state, pick);
  } catch {
    after = null;
  }
  if (after && lineHolds(after, lock.line.agendaId)) return pick;
  const credit = legalOf(state, { type: 'GAIN_CREDIT' } as Record<string, unknown>);
  if (!credit) return pick;
  countedStats.restVetoed++;
  return credit;
}

/** At the Corp's first decision of a later turn: what the check says now of each line begun on an earlier turn. */
function noteNextTurn(state: GameState) {
  for (const l of countedStats.lines) {
    if (l.next || l.turn >= state.turnNumber) continue;
    const installed = installedAgendas(state).some(a => a.card.instanceId === l.agendaId);
    if (!installed) l.next = 'gone';
    else {
      const now = scoreThisTurn(state);
      l.next = now.feasible && now.agendaId === l.agendaId ? 'scorable' : 'dropped';
    }
  }
}
