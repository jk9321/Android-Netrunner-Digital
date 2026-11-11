import { CardInstance, GameAction, GameState, cardDef, executeAction, getLegalActions, isLegalAction, rezCostOf } from '../core';
import { scoreNowLine, scoreNowPlan } from './winNow';
import { memo } from './valueModel';
import { iceCreditNeed } from './runs';
import { plan } from './pricing';
import { withIceInstalled } from './iceValues';
import { clickMoneyOf, dividendsOf, scoreCreditsOf, turnIncomeOf } from './cards';
import { counters } from '../core/engine/cardEffects';

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
 * installed card)? plan.scoreNow's search (winNow.ts scoreNowLine), played out on the real state until the score: it
 * plays only the Corp's own turn and cuts every line that changes R&D. For the stage 0 measurement scripts.
 */
export function scoreThisTurn(state: GameState): ThisTurn {
  if (!isCorpMain(state) || state.corp.clicks <= 0) return { feasible: false, line: [], usedCard: false };
  let s = state;
  const line: GameAction[] = [];
  let scored: CardInstance | undefined;
  for (let i = 0; i < 20 && !s.winner && !scored; i++) {
    const a = scoreNowLine(s);
    if (!a) break;
    line.push(a);
    s = executeAction(s, a);
    scored = s.corp.scoreArea.find(c => isAgenda(c) && !state.corp.scoreArea.some(x => x.instanceId === c.instanceId));
  }
  if (!scored) return { feasible: false, line: [], usedCard: false };
  return { feasible: true, line, usedCard: line.some(a => a.type === 'USE_ABILITY' || a.type === 'PLAY_OPERATION_OR_EVENT'), agenda: cardDef(scored).title, agendaId: scored.instanceId };
}

/**
 * Credits the Corp can count on next turn: rezzed cards that pay it as its turn begins (the card entry's turnIncome;
 * a campaign pays no more than the credits it holds). The card-text match this replaced never matched ("take 3
 * credits" has no [credit] symbol in the stripped text), so it counted nothing.
 */
export function knownIncome(state: GameState): number {
  let n = 0;
  for (const c of Object.values(state.corp.servers).flatMap(v => v.root)) {
    const pay = c.isRezzed ? turnIncomeOf(c.cardCode) : undefined;
    if (pay) n += pay.hosted ? Math.min(pay.credits, counters(c, 'credit')) : pay.credits;
  }
  return n;
}

/** Sensitivity knob for the stage 0 report: extra credits granted to the Runner's run (an economy event from the grip it may hold). */
export const CHECK = { runnerExtra: 0 };

/**
 * The Runner's budget for one run on its next turn, from public facts: its credits, and what its installed cards and
 * every click but the run's make (runnerMoney: card entries, never the grip; 5.2.7a). Count inputs F2: before it, 1
 * credit a click, so a loaded Telework Contract was missed (paired +0.0 ± 0.4 at games=3, run 42918973725).
 */
export const runnerBudget = (s: GameState) => s.runner.credits + runnerMoney(s) + CHECK.runnerExtra;

const hosted = (c: CardInstance) => counters(c, 'credit');

/**
 * The credits the Runner's installed cards and its clicks but the run's make on its next turn: each installed card's
 * turn-start payment (no more than it holds), then the best set of its paying click abilities (one use each: Telework
 * Contract is once per turn, Fermenter and Rent Rioters are trashed, Pennyshaver pays 1 after its first use), the
 * other clicks 1 credit each (5.2.7a).
 */
export function runnerMoney(s: GameState): number {
  const rig = [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources];
  let drip = 0;
  const uses: { clicks: number; credits: number }[] = [];
  for (const c of rig) {
    const pay = turnIncomeOf(c.cardCode);
    if (pay) drip += pay.hosted ? Math.min(pay.credits, hosted(c)) : pay.credits;
    const m = clickMoneyOf(c.cardCode);
    if (!m) continue;
    let credits = m.credits;
    if (m.hosted === 'cap') credits = Math.min(credits, hosted(c));
    if (m.hosted === 'add') credits += hosted(c);
    if (m.perVirus) credits += m.perVirus.credits * (counters(c, 'virus') + m.perVirus.turnStart);
    if (credits > m.clicks) uses.push({ clicks: m.clicks, credits });
  }
  const clicks = Math.max(0, s.runner.maxClicks - 1);
  let best = clicks;
  const n = Math.min(uses.length, 10);
  for (let mask = 1; mask < 1 << n; mask++) {
    let k = 0;
    let got = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) {
      k += uses[i].clicks;
      got += uses[i].credits;
    }
    if (k <= clicks) best = Math.max(best, got + clicks - k);
  }
  return drip + best;
}

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
  // view: the board with the new ice in place, so holdCost reads its strength there (a remote's bonus: Palisade +2)
  type Try = { agenda: CardInstance; server: string; ice: CardInstance[]; clicks: number; credits: number; form: TwoTurnLine['form']; iceId?: string; view: GameState };
  const tries: Try[] = [];
  for (const a of installedAgendas(state)) tries.push({ agenda: a.card, server: a.server, ice: state.corp.servers[a.server].ice, clicks: 0, credits: 0, form: 'installed', view: state });
  for (const agenda of state.corp.hq.filter(isAgenda)) {
    for (const v of open) {
      if (v.ice.length) tries.push({ agenda, server: v.id, ice: v.ice, clicks: 1, credits: 0, form: 'install', view: state });
      for (const ice of uniqueByCode(hqIce)) {
        const view = withIceInstalled(state, ice, v);
        tries.push({ agenda, server: v.id, ice: view.corp.servers[v.id].ice, clicks: 2, credits: v.ice.length, form: 'install+ice', iceId: ice.instanceId, view });
      }
    }
    for (const ice of uniqueByCode(hqIce)) {
      const view = withIceInstalled(state, ice, null);
      tries.push({ agenda, server: 'new remote', ice: view.corp.servers['remote-placed'].ice, clicks: 2, credits: 0, form: 'install+ice', iceId: ice.instanceId, view });
    }
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
      const rez = holdCost(t.view, t.ice, end);
      if (rez === null) continue;
      const nextCredits = end - rez + income + (N - r);
      if (nextCredits < r) continue;
      // The money once it scores (the agenda's own score credits and the turn after's income with it) keeps the board held
      if (nextCredits - r + scoreCreditsOf(t.agenda.cardCode) + income < afterLineFloor(t.view, t.agenda.instanceId)) {
        scoreInTwoStats.floorRefused++;
        continue;
      }
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
  if (rez === null) return false;
  const income = knownIncome(state);
  const next = end - rez + income + (N - r);
  if (next < r) return false;
  return next - r + scoreCreditsOf(card.cardCode) + income >= afterLineFloor(state, agendaId);
}

/**
 * Count inputs F1 (spec-count-inputs.md): the credits the Corp needs left once a two-turn line has scored (its credits then,
 * the agenda's own scoreCredits and the next turn's income count against it), for the Runner's
 * turn after it: the cheapest rez spend that keeps the Runner out (holdCost) of R&D, of HQ while an agenda stays there,
 * and of each other remote holding an unscored agenda, summed. Rezzed ice that holds costs 0; a server no set holds
 * costs 0 too (money can't fix it, and it must not veto every line), counted in scoreInTwoStats.unholdable. Measured
 * alone -1.1 ± 0.7 (games=3, run 42918968349); with F2 at 10 games +0.2 ± 0.4 (run 42940051464 vs 42940033908).
 */
export function afterLineFloor(state: GameState, agendaId: string): number {
  const ice: CardInstance[][] = [state.corp.servers.rd.ice];
  if (state.corp.hq.some(c => isAgenda(c) && c.instanceId !== agendaId)) ice.push(state.corp.servers.hq.ice);
  for (const v of remotes(state)) if (v.root.some(c => isAgenda(c) && c.instanceId !== agendaId)) ice.push(v.ice);
  let floor = 0;
  for (const set of ice) {
    const cost = holdCost(state, set, Infinity);
    if (cost === null) scoreInTwoStats.unholdable++;
    else floor += cost;
  }
  return floor;
}

const sameAction = (a: GameAction, want: Partial<GameAction> & Record<string, unknown>) =>
  Object.entries(want).every(([k, v]) => (a as unknown as Record<string, unknown>)[k] === v) && !(a as { trashFirst?: string[] }).trashFirst?.length && !(a as { faceUp?: boolean }).faceUp;

// ------------------------------------------------------------------------------------------- plan.scoreInTwo (C2)

/**
 * A two-turn line the Corp holds (counted scoring C2): kept in the Corp agent's own memory (corpAI.ts heldLine), keyed
 * by game id, re-checked at every decision.
 */
export interface HeldLine {
  game: string;
  /** The Corp turn (state.turnNumber) the line began on. */
  turn: number;
  line: TwoTurnLine;
  /** The server once known (a new remote's id after its ice goes in). */
  server: string | null;
  /** Counters on the agenda when the line began (0 for an agenda from HQ). */
  counters: number;
}

/** Diagnostics for plan.scoreInTwo (scripts read them): lines begun, steps played over the Corp's pick, picks vetoed, lines dropped, scored, and each line begun. */
export const scoreInTwoStats = { begun: 0, steps: 0, vetoed: 0, dropped: 0, finished: 0, floorRefused: 0, unholdable: 0, lines: [] as { turn: number; agendaId: string; form: TwoTurnLine['form'] }[] };
/** Clears scoreInTwoStats (scripts/score-ceiling-measure.ts, before each game). */
export function resetScoreInTwoStats() {
  Object.assign(scoreInTwoStats, { begun: 0, steps: 0, vetoed: 0, dropped: 0, finished: 0, floorRefused: 0, unholdable: 0, lines: [] });
}

const legalShape = (state: GameState, want: Record<string, unknown>) => getLegalActions(state, 'corp').find(a => sameAction(a, want));

/** The held line's next step on the turn it began: ice, agenda, the advances now; null when only spare clicks remain; 'drop' when it can't go on. */
function startTurnStep(state: GameState, held: HeldLine): GameAction | null | 'drop' {
  const { line } = held;
  const id = line.agendaId;
  if (held.server === null && line.server !== 'new remote') held.server = line.server;
  if (held.server === null && line.iceId) held.server = serverOf(state, line.iceId) ?? null;
  if (state.corp.hq.some(c => c.instanceId === id)) {
    if (line.form === 'install+ice' && line.iceId && state.corp.hq.some(c => c.instanceId === line.iceId))
      return legalShape(state, held.server ? { type: 'INSTALL_CARD', cardInstanceId: line.iceId, targetServerId: held.server } : { type: 'INSTALL_CARD', cardInstanceId: line.iceId, asNewRemote: true }) ?? 'drop';
    if (!held.server) return 'drop';
    return legalShape(state, { type: 'INSTALL_CARD', cardInstanceId: id, targetServerId: held.server }) ?? 'drop';
  }
  const at = installedAgendas(state).find(a => a.card.instanceId === id);
  if (!at) return 'drop';
  if (at.card.advancementCounters - held.counters < line.advanceNow) return legalShape(state, { type: 'ADVANCE_CARD', cardInstanceId: id }) ?? 'drop';
  return null;
}

/**
 * On a later turn: score the agenda once its counters reach the requirement (1.17.3a), advance it while the turn can
 * finish it (5.2.6f); 'drop' otherwise; 'done' for a Dividends agenda at its requirement (left to the Corp's pick).
 */
function finishTurnStep(state: GameState, held: HeldLine): GameAction | 'drop' | 'done' {
  const at = installedAgendas(state).find(a => a.card.instanceId === held.line.agendaId);
  // Scored already (plan.scoreNow, which the Corp consults first, may finish it)
  if (!at) return state.corp.scoreArea.some(c => c.instanceId === held.line.agendaId) ? 'done' : 'drop';
  const left = (cardDef(at.card).advancement_cost ?? 0) - at.card.advancementCounters;
  // A Dividends agenda at its requirement: over-advancing it is the Corp's choice (excess counters become agenda counters)
  if (left <= 0 && dividendsOf(at.card.cardCode) > 0) return 'done';
  if (left <= 0) return legalShape(state, { type: 'SCORE_AGENDA', cardInstanceId: at.card.instanceId }) ?? 'drop';
  if (left > state.corp.clicks || left > state.corp.credits) return 'drop';
  return legalShape(state, { type: 'ADVANCE_CARD', cardInstanceId: at.card.instanceId }) ?? 'drop';
}

/**
 * Step 4 G1 (spec-step4-placement.md, temporary plan.placementAdvance): an agenda is advanced only as a step of a counted
 * line, scoreNow's (this turn scores) or the held two-turn line on this agenda (1.17.3a, 5.2.6f). The Corp ranking and
 * every planner candidate and playout read it through corpAI.ts rankMainActions; scoreInTwoPick still plays a line's
 * own steps over the pick. Non-agenda advanceables are not asked (the Runner sees the same thing either way).
 */
export function advanceCounted(state: GameState, agendaId: string, held: HeldLine | null): boolean {
  if (held && held.game === state.id && held.line.agendaId === agendaId) return true;
  return memo(state, 'advanceCounted:scoreNow', () => !!scoreNowPlan(state));
}

/** Step 4 G1/G2 diagnostics (scripts read them): hand-size installs let through; agendas whose advance or install was the Corp's first pick and was stopped. */
export const placementStats = { handSize: 0, stopped: [] as { game: string; turn: number; id: string; kind: 'advance' | 'install' }[] };

/**
 * Step 4 G2 (spec-step4-placement.md, temporary plan.placementInstall): an agenda goes into a remote only as the first
 * step of a counted line (scoreNow's; scoreInTwoPick plays a two-turn line's own install over the pick), or into a
 * remote that holds for the Runner's coming turn by the count: holdCost non-null against runnerBudget with what the Corp
 * ends the turn on (the clicks after this one to credits, scoreInTwo's assumption) less afterLineFloor's money for the
 * rest of the board. A remote the Runner can pay through gives the agenda up for certain; HQ gives it up at most as one
 * random card of several (7.1, 7.4.1), so otherwise the agenda stays in HQ. Hand size (1.7.2b): on the last click, when
 * the end-of-turn discard would have to take an agenda (to Archives, where every card is accessed), it may go to the
 * remote with the most ice instead. HQ, R&D and Archives installs are not agendas' (only remotes take them).
 */
export function installCounted(state: GameState, agenda: CardInstance, serverId: string | null, held: HeldLine | null): boolean {
  if (held && held.game === state.id && held.line.agendaId === agenda.instanceId) return true;
  if (memo(state, 'advanceCounted:scoreNow', () => !!scoreNowPlan(state))) return true;
  const server = serverId ? state.corp.servers[serverId] : null;
  const ice = server?.ice ?? [];
  const end = state.corp.credits + Math.max(0, state.corp.clicks - 1);
  if (ice.length && holdCost(state, ice, end - afterLineFloor(state, agenda.instanceId)) !== null) return true;
  // Hand size: the discard would take an agenda; the remote with the most ice takes it instead
  const excess = state.corp.hq.length - state.corp.handSizeLimit;
  if (state.corp.clicks === 1 && excess > 0 && state.corp.hq.filter(c => !isAgenda(c)).length < excess) {
    const most = Math.max(0, ...remotes(state).filter(v => !v.root.some(c => isAgenda(c) || typeOf(c) === 'asset')).map(v => v.ice.length));
    if (ice.length >= most) {
      placementStats.handSize++;
      return true;
    }
  }
  return false;
}

/**
 * plan.scoreInTwo (counted scoring C2; stage 0b's two-turn half measured +3.0 ± 1.8): called with the Corp's own pick at
 * a main-phase decision and the line it holds. A held line is re-checked every decision and continued while the count
 * still holds (dropped otherwise); with none held, scoreInTwo may begin one. On the line's first turn its steps are
 * played (ice from HQ, the agenda, the advances now), and the spare clicks follow the Corp's pick only while the line
 * still holds after it (lineHolds: the rez money the line keeps for the Runner's turn stays; a click for a credit
 * otherwise). On a later turn the agenda is advanced and scored (1.17.3a-c, 1.18.1, 5.2.6f). The hold is judged by
 * capability against the Runner's credits as they stand plus its clicks' credits (holdCost; 3.4.3a, 6.9.2b-c).
 */
export function scoreInTwoPick(state: GameState, pick: GameAction, held: HeldLine | null): { action: GameAction; held: HeldLine | null } {
  if (!plan().scoreInTwo || !isCorpMain(state) || state.corp.clicks <= 0) return { action: pick, held: held && held.game === state.id ? held : null };
  let h = held && held.game === state.id && held.turn <= state.turnNumber ? held : null;
  if (h && h.turn < state.turnNumber) {
    const step = finishTurnStep(state, h);
    if (step === 'done') {
      scoreInTwoStats.finished++;
      return { action: pick, held: null };
    }
    if (step === 'drop') {
      scoreInTwoStats.dropped++;
      h = null;
    } else {
      if (step.type === 'SCORE_AGENDA') {
        scoreInTwoStats.finished++;
        return { action: step, held: null };
      }
      if (!sameAction(pick, step as unknown as Record<string, unknown>)) scoreInTwoStats.steps++;
      return { action: step, held: h };
    }
  }
  if (h && h.turn === state.turnNumber && !state.corp.hq.some(c => c.instanceId === h!.line.agendaId) && !lineHolds(state, h.line.agendaId)) {
    scoreInTwoStats.dropped++;
    h = null;
  }
  if (!h) {
    const line = scoreInTwo(state);
    if (!line) return { action: pick, held: null };
    const card = installedAgendas(state).find(a => a.card.instanceId === line.agendaId)?.card;
    h = { game: state.id, turn: state.turnNumber, line, server: line.server === 'new remote' ? null : line.server, counters: card?.advancementCounters ?? 0 };
    scoreInTwoStats.begun++;
    scoreInTwoStats.lines.push({ turn: state.turnNumber, agendaId: line.agendaId, form: line.form });
  }
  const step = startTurnStep(state, h);
  if (step === 'drop') {
    scoreInTwoStats.dropped++;
    return { action: pick, held: null };
  }
  if (step) {
    if (!sameAction(pick, step as unknown as Record<string, unknown>)) scoreInTwoStats.steps++;
    return { action: step, held: h };
  }
  // The spare clicks: the Corp's pick while the line still holds after it (an illegal pick is the engine's to refuse)
  if (lineHolds(spareAfter(state, pick), h.line.agendaId)) return { action: pick, held: h };
  const credit = legalShape(state, { type: 'GAIN_CREDIT' });
  if (!credit) return { action: pick, held: h };
  scoreInTwoStats.vetoed++;
  return { action: credit, held: h };
}

/** The state after the Corp's pick, for the hold check; a pick the engine refuses leaves the state as it is. */
function spareAfter(state: GameState, pick: GameAction): GameState {
  if (!isLegalAction(state, pick)) return state;
  return executeAction(state, pick);
}
