import { CardInstance, GameAction, GameState, cardDef, executeAction, getLegalActions, isLegalAction, rezCostOf } from '../core';
import { scoreNowLine } from './winNow';
import { iceCreditNeed, runBypasses } from './runs';
import { plan } from './pricing';
import { withIceInstalled } from './iceValues';
import { clickMoneyOf, dividendsOf, scoreCreditsOf, turnIncomeOf } from './cards';
import { counters } from '../core/engine/cardEffects';
import { profileOf } from './cardProfiles';
import { rdAgendaOdds } from './rezModel';
import { pointGain } from './valueModel';

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
  const serverId = Object.values(state.corp.servers).find(v => v.ice.some(c => c.instanceId === ice[0]?.instanceId))?.id;
  let best: number | null = null;
  for (let mask = 0; mask < 1 << n; mask++) {
    let rez = 0;
    let need = 0;
    // The ice the Runner's installed bypasses pass with this set rezzed (runs.ts runBypasses: rig cards, their counters
    // and the threat level, all public; 6.5.8a: a bypassed ice's subroutines never resolve), and what those bypasses
    // cost it in credits' worth (spec jeff-games-48-50 Part A, folded 2026-11-13: g3 +0.3 ± 0.2, run 43382962736)
    const bypassed = serverId ? runBypasses(rezzedSet(view, serverId, ice, mask, n), serverId) : undefined;
    if (bypassed) need += bypassed.price;
    for (let i = 0; i < n; i++) {
      const c = ice[i];
      const on = !!(mask & (1 << i));
      if (c.isRezzed && on) {
        rez = Infinity; // each set once: a rezzed ice's bit stays clear
        break;
      }
      if (!c.isRezzed && !on) continue;
      if (!c.isRezzed) rez += rezCostOf(view, c);
      if (bypassed?.ids.has(c.instanceId)) continue;
      const up = c.isRezzed ? c : { ...c, isRezzed: true };
      need += iceCreditNeed(withIce(view, up), up);
    }
    if (rez <= corpCredits && need > budget && (best === null || rez < best)) best = rez;
  }
  return best;
}

/** The board with the ice of this rez set rezzed on its server (holdCost's mask over the first n ice). */
function rezzedSet(state: GameState, serverId: string, ice: CardInstance[], mask: number, n: number): GameState {
  const on = new Set(ice.slice(0, n).filter((c, i) => !c.isRezzed && mask & (1 << i)).map(c => c.instanceId));
  const server = state.corp.servers[serverId];
  return { ...state, corp: { ...state.corp, servers: { ...state.corp.servers, [serverId]: { ...server, ice: server.ice.map(c => (on.has(c.instanceId) ? { ...c, isRezzed: true } : c)) } } } };
}

/** A copy-free view with this one ice standing in for its unrezzed self (iceCreditNeed reads the board for strength). */
function withIce(state: GameState, ice: CardInstance): GameState {
  const server = Object.values(state.corp.servers).find(v => v.ice.some(c => c.instanceId === ice.instanceId));
  if (!server) return state;
  return { ...state, corp: { ...state.corp, servers: { ...state.corp.servers, [server.id]: { ...server, ice: server.ice.map(c => (c.instanceId === ice.instanceId ? ice : c)) } } } };
}

export interface TwoTurnLine {
  /** plan.assetCover: 'asset', a drip asset with an ice in front (assetCover; agenda and agendaId then name the asset). */
  kind?: 'asset';
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

/** The clicks the Corp has on its next turn (5.2.6; bonus clicks given for it). */
const nextClicks = (state: GameState) => state.corp.maxClicks + (state.corp.bonusClicksNextTurn ?? 0);

/**
 * A two-turn line's money on its next turn: what the Corp ends this turn on, less the rez spend that holds the server
 * through the Runner's turn, plus its known income and the next turn's clicks the line does not spend (r) as credits
 * (5.2.6a). scoreInTwo, lineHolds and reservedForAgenda read it, so their horizons cannot drift.
 */
const nextTurnCredits = (state: GameState, end: number, rez: number, r: number) => end - rez + knownIncome(state) + (nextClicks(state) - r);

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
  const N = nextClicks(state);
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
      const nextCredits = nextTurnCredits(state, end, rez, r);
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
  const N = nextClicks(state);
  if (r <= 0) return true;
  if (r > N) return false;
  const end = state.corp.credits + (state.activePlayer === 'corp' ? state.corp.clicks : 0);
  const rez = holdCost(state, state.corp.servers[server.server].ice, end);
  if (rez === null) return false;
  const income = knownIncome(state);
  const next = nextTurnCredits(state, end, rez, r);
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
 * The held line's step on a later turn (score or advance), or null when there is none (no line, the line's own turn,
 * done or dropped). It does not depend on the Corp's pick, so the planner's search can be skipped (planner speed P1,
 * corpAI.ts); scoreInTwoPick then plays it and counts it. Reads and changes nothing else.
 */
export function heldLaterStep(state: GameState, held: HeldLine | null): GameAction | null {
  if (!plan().scoreInTwo || !isCorpMain(state) || state.corp.clicks <= 0) return null;
  if (!held || held.game !== state.id || held.turn >= state.turnNumber) return null;
  const step = finishTurnStep(state, held);
  return step === 'done' || step === 'drop' ? null : step;
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
  if (h && h.turn < state.turnNumber && h.line.kind !== 'asset') {
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
  // An asset line (plan.assetCover) is done once the asset is installed
  if (h && h.line.kind === 'asset' && (h.turn < state.turnNumber || !state.corp.hq.some(c => c.instanceId === h!.line.agendaId))) h = null;
  if (h && h.turn === state.turnNumber && !state.corp.hq.some(c => c.instanceId === h!.line.agendaId) && !lineHolds(state, h.line.agendaId)) {
    scoreInTwoStats.dropped++;
    h = null;
  }
  if (!h) {
    const line = scoreInTwo(state) ?? assetCover(state, pick);
    if (!line) return { action: pick, held: null };
    const card = installedAgendas(state).find(a => a.card.instanceId === line.agendaId)?.card;
    h = { game: state.id, turn: state.turnNumber, line, server: line.server === 'new remote' ? null : line.server, counters: card?.advancementCounters ?? 0 };
    if (!line.kind) {
      scoreInTwoStats.begun++;
      scoreInTwoStats.lines.push({ turn: state.turnNumber, agendaId: line.agendaId, form: line.form });
    }
  }
  // scoreInTwoStats counts agenda lines only: an asset line's agendaId names an asset (assetCoverStats counts those)
  const agendaLine = !h.line.kind;
  const step = startTurnStep(state, h);
  if (step === 'drop') {
    if (agendaLine) scoreInTwoStats.dropped++;
    return { action: pick, held: null };
  }
  if (step) {
    if (agendaLine && !sameAction(pick, step as unknown as Record<string, unknown>)) scoreInTwoStats.steps++;
    return { action: step, held: h };
  }
  // The spare clicks: the Corp's pick while the line still holds after it (an illegal pick is the engine's to refuse)
  if (lineHolds(spareAfter(state, pick), h.line.agendaId)) return { action: pick, held: h };
  const credit = legalShape(state, { type: 'GAIN_CREDIT' });
  if (!credit) return { action: pick, held: h };
  if (agendaLine) scoreInTwoStats.vetoed++;
  return { action: credit, held: h };
}

/** The state after the Corp's pick, for the hold check; a pick the engine refuses leaves the state as it is. */
function spareAfter(state: GameState, pick: GameAction): GameState {
  if (!isLegalAction(state, pick)) return state;
  return executeAction(state, pick);
}

type ServerLike = GameState['corp']['servers'][string];

/** Ice redirect diagnostics: redirects made by the top-level Corp (corpAI counts them). */
export const iceRedirectStats = { fired: 0 };

/**
 * The scoring remote (ice redirect): the remote with the most ice; on a tie the one holding an agenda or an advanced
 * card, then the lowest id. None while no remote has ice. Not a
 * remote whose root holds an asset, where no agenda can be installed without trashing the asset (rule 3.3.1: one agenda
 * or asset per remote root); it can be the scoring remote again once the asset leaves.
 */
export function scoringRemote(state: GameState): ServerLike | null {
  const key = (v: ServerLike) => [v.ice.length, v.root.some(c => isAgenda(c) || (c.advancementCounters ?? 0) > 0) ? 1 : 0] as const;
  const num = (v: ServerLike) => Number(v.id.replace(/\D/g, '')) || 0;
  const iced = remotes(state).filter(v => v.ice.length > 0 && !v.root.some(c => typeOf(c) === 'asset'));
  iced.sort((a, b) => key(b)[0] - key(a)[0] || key(b)[1] - key(a)[1] || num(a) - num(b));
  return iced[0] ?? null;
}

/** The scoring remote when it does not hold by the count (holdCost against runnerBudget with what the Corp ends the turn on, less afterLineFloor for its agendas); null when it holds or there is none. iceRedirect and assetCover read it. */
function scoringShort(state: GameState): ServerLike | null {
  const scoring = scoringRemote(state);
  if (!scoring) return null;
  const agendas = state.corp.hq.filter(isAgenda);
  const floor = agendas.length ? Math.min(...agendas.map(x => afterLineFloor(state, x.instanceId))) : afterLineFloor(state, '');
  const end = state.corp.credits + Math.max(0, state.corp.clicks - 1);
  return holdCost(state, scoring.ice, end - floor) !== null ? null : scoring;
}

/**
 * Ice redirect (step 4 G3', Jeff 2026-11-12 "ice spread thin"; +2.1 ± 0.7 over 2,873 paired games, runs 43158129121 + 43164127215): when the Corp's
 * own pick installs ice onto a remote or a new remote, and the scoring remote does not hold by the count (holdCost
 * against runnerBudget with what the Corp ends the turn on: credits and the clicks after this one, less afterLineFloor
 * for its agendas), the ice goes to the scoring remote instead, outermost. Its install cost there is 1 credit for each
 * ice already protecting it (8.5.11a), against none on a new remote. Measured and not kept: redirecting only while the
 * Corp still covers the holding rez after that cost (+0.5 ± 0.6, run 43158132282: it removes most fires), and keeping the
 * first ice on a server with a card in its root (-1.4 ± 0.8 against this, run 43167848111). Central ice and the choice to install ice at all are the
 * pick's: a pure redirect, no veto, no extra install. Null: no change.
 */
export function iceRedirect(state: GameState, pick: GameAction): GameAction | null {
  if (pick.type !== 'INSTALL_CARD' || !isCorpMain(state)) return null;
  const a = pick as GameAction & { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean };
  const card = state.corp.hq.find(c => c.instanceId === a.cardInstanceId);
  if (!card || typeOf(card) !== 'ice') return null;
  const target = a.asNewRemote ? null : a.targetServerId ? state.corp.servers[a.targetServerId] : null;
  if (!a.asNewRemote && !target?.isRemote) return null;
  const scoring = scoringShort(state);
  if (!scoring || scoring.id === target?.id) return null;
  return legalShape(state, { type: 'INSTALL_CARD', cardInstanceId: card.instanceId, targetServerId: scoring.id }) ?? null;
}

/**
 * The scoring remote while it is kept free of assets for an agenda (asset cover reservation arm, play test round 3 G1
 * T7-T10: remote-2 sat empty five turns with 3-4 agendas in HQ and no line on it, and the assets went bare): an agenda
 * waits in HQ and a counted line could use the remote, that is holdCost finds a rez set for its ice, or its ice with
 * one ice from HQ in front (scoreInTwo's install+ice form, 8.5.11a: 1 credit per ice already protecting it), within the
 * line's horizon: what the Corp ends this turn on, its known income and next turn's clicks as credits (5.2.6a), less
 * afterLineFloor. Otherwise an asset may take its root (3.3.1); an agenda can still replace it later by trashing it
 * (8.5.6a). Null: not reserved. Folded 2026-11-13 (plan.assetReserve, g3 +0.5 ± 1.6, run 43354222438; before it the
 * remote was reserved whenever an agenda waited in HQ).
 */
function reservedForAgenda(state: GameState): ServerLike | null {
  const agendas = state.corp.hq.filter(isAgenda);
  const scoring = agendas.length ? scoringRemote(state) : null;
  if (!scoring) return scoring;
  const floor = Math.min(...agendas.map(x => afterLineFloor(state, x.instanceId)));
  // The line's money on its next turn with no rez spent and no click on the agenda yet (the most a line could have)
  const horizon = nextTurnCredits(state, state.corp.credits + Math.max(0, state.corp.clicks - 1), 0, 0) - floor;
  if (holdCost(state, scoring.ice, horizon) !== null) return scoring;
  for (const ice of uniqueByCode(state.corp.hq.filter(c => typeOf(c) === 'ice'))) {
    const view = withIceInstalled(state, ice, scoring);
    if (holdCost(view, view.corp.servers[scoring.id].ice, horizon - scoring.ice.length) !== null) return scoring;
  }
  return null;
}

/** Asset cover diagnostics (any caller, search included): econ installs asked about, and why no line: an agenda in HQ while the scoring remote is short, the pick's place already iced, under 2 clicks, no ice in HQ, not the asset's rez next turn (rezMoney); lines begun. */
export const assetCoverStats = { asked: 0, scoringShort: 0, iced: 0, clicks: 0, noIce: 0, rezMoney: 0, begun: 0 };

/**
 * plan.assetCover (asset cover step 2, redesign/spec-asset-cover.md, form A): the Corp's own pick installs an econ asset
 * (its card entry's profile pays credits, when the turn begins or for a click, and loads more than its rez cost) on a
 * remote with no ice. This is Jeff's rule with a counted affordability check, not a hold count: a deterministic hold
 * count cannot express what his games show (an unknown ice is a risk to the Runner, not a known price). As Runner
 * against the AI Corp he trashed 9 of its 17 bare econ assets and 0 of its 2 iced ones, paying 1-3 credits each (2.6.1)
 * against up to 15 left on them; Jeff 2026-11-12: "I trash unused regoliths regularly against the AI. Usually because
 * they are easy to get to", and as Corp he puts them behind ice, "not my best ICE". So the line is
 * the cheapest ice from HQ (rez cost, then install cost, 8.5.11a) in front first, then the asset ('install+ice'),
 * counted for affordability only: 2 clicks, the ice's install cost, and after it the asset's rez on the next turn
 * (5.6.1b, 5.6.2a) out of what the Corp ends on plus its known income. Not the ice's rez too (3.4.3a): with it the line
 * began on 1 of 22 econ installs in 12 deals, without it on 3 (asset-cover-fires.ts); an ice the Corp cannot rez
 * deters a human Runner, not ours. Not a hold count: one ice that a rigged Runner breaks for 1-3 credits never holds by holdCost, and that arm
 * fired 0 times in 12 deals. On the pick's own place (a new remote, or its remote; one asset per root, 3.3.1), never
 * the scoring remote. While an agenda waits in HQ and the scoring remote does not hold (iceRedirect's count), the ice
 * goes there and no line begins. No line: the pick stands. Null: no change.
 */
export function assetCover(state: GameState, pick: GameAction): TwoTurnLine | null {
  if (pick.type !== 'INSTALL_CARD') return null;
  const a = pick as GameAction & { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean };
  const asset = state.corp.hq.find(c => c.instanceId === a.cardInstanceId);
  const p = asset && typeOf(asset) === 'asset' ? profileOf(asset.cardCode) : undefined;
  const rezCost = asset ? (cardDef(asset).cost ?? 0) : 0;
  if (!asset || !p || p.pay <= 0 || p.load <= rezCost) return null;
  assetCoverStats.asked++;
  const target = a.asNewRemote ? null : a.targetServerId ? state.corp.servers[a.targetServerId] : null;
  const scoring = scoringRemote(state);
  if (target && (!target.isRemote || target.ice.length > 0 || target.id === scoring?.id)) return (assetCoverStats.iced++, null);
  const income = knownIncome(state);
  const line = (server: string, form: TwoTurnLine['form'], ice?: { id: string; rez: number }): TwoTurnLine => ({ kind: 'asset', agenda: cardDef(asset).title, agendaId: asset.instanceId, server, form, ...(ice ? { iceId: ice.id } : {}), advanceNow: 0, advanceNext: 0, rez: ice?.rez ?? 0 });
  // assetPartner's econ case: an iced remote waiting with an open root (3.3.1) takes the asset, one click; not the
  // scoring remote while an agenda waits in HQ
  const reserved = reservedForAgenda(state);
  const waiting = remotes(state).find(v => v.ice.length > 0 && !v.root.some(c => isAgenda(c) || typeOf(c) === 'asset') && v.id !== reserved?.id);
  if (waiting && state.corp.credits + (state.corp.clicks - 1) + income >= rezCost) return (assetPartnerStats.moved++, line(waiting.id, 'install'));
  if (reserved && scoringShort(state)) return (assetCoverStats.scoringShort++, null);
  if (state.corp.clicks < 2) return (assetCoverStats.clicks++, null);
  const end = state.corp.credits + (state.corp.clicks - 2);
  const all = uniqueByCode(state.corp.hq.filter(c => typeOf(c) === 'ice')).map(c => ({ c, rez: rezCostOf(state, c) }));
  if (!all.length) return (assetCoverStats.noIce++, null);
  if (end + income < rezCost) return (assetCoverStats.rezMoney++, null);
  const ice = all.sort((x, y) => x.rez - y.rez)[0];
  assetCoverStats.begun++;
  return line(target ? target.id : 'new remote', 'install+ice', { id: ice.c.instanceId, rez: ice.rez });
}

/** plan.assetPartner diagnostics (any caller, search included): asset or upgrade installs moved onto a waiting iced remote. */
export const assetPartnerStats = { moved: 0 };

/**
 * plan.assetPartner (asset cover alternative; Claude's play test round 2, 2026-11-12: six times in two games the Corp had
 * a remote with 2-3 ice and an empty root and put Humanoid Resources, Clearinghouse and Spin Doctor into new bare
 * remotes, and the Runner trashed them): the Corp's own pick installs an asset or an upgrade on a new remote, and a
 * remote with ice and no agenda or asset in its root waits (one agenda or asset per root, 3.3.1; any number of upgrades,
 * 3.6.2); then the card goes there instead, the one with the most ice. Never the scoring remote
 * while an agenda waits in HQ. A pure redirect: no click or credit more (installing in a remote costs nothing for a
 * root card, 8.5.11a counts ice only). Econ assets take the same move in assetCover, ahead of a cover pair. Null: no change.
 */
export function assetPartner(state: GameState, pick: GameAction): GameAction | null {
  if (!isCorpMain(state) || pick.type !== 'INSTALL_CARD' || !(pick as { asNewRemote?: boolean }).asNewRemote) return null;
  const card = state.corp.hq.find(c => c.instanceId === pick.cardInstanceId);
  if (!card || (typeOf(card) !== 'asset' && typeOf(card) !== 'upgrade')) return null;
  const reserved = reservedForAgenda(state);
  const waiting = remotes(state)
    .filter(v => v.ice.length > 0 && !v.root.some(c => isAgenda(c) || typeOf(c) === 'asset') && v.id !== reserved?.id)
    .sort((x, y) => y.ice.length - x.ice.length)[0];
  const move = waiting ? legalShape(state, { type: 'INSTALL_CARD', cardInstanceId: card.instanceId, targetServerId: waiting.id }) : undefined;
  if (move) assetPartnerStats.moved++;
  return move ?? null;
}

/**
 * Central ice before remote ice (spec-central-ice.md variant (6), bars/central-ice-bare.md; Jeff 2026-11-13: "fix the
 * icing remotes while HQ and R&D were thin"; his #51 had R&D bare for turns 1-5 on 13-17 credits). When the Corp's own
 * pick installs ice from HQ onto a remote or a new remote (the callers skip a held counted line's own steps), and HQ or
 * R&D has no ice at all, the ice goes to that central instead, when the Corp can still pay the ice's rez after the
 * install (none to pay on a central with no ice, 8.5.11a). Both bare: the one with more points at stake for one access
 * (HQ: its agendas' pointGain over the cards left in HQ, the Corp's own hand, 10.2.2a; R&D: the deck list's agendas not
 * yet seen over R&D's cards, times their average pointGain (rezModel rdAgendaOdds, the Corp's one R&D pool), never
 * R&D's order). At most once per central, as the central then has ice. A pure redirect (5.2.6: the same install action, one
 * click): no veto, no extra install. Null: no change.
 */
export function centralIce(state: GameState, pick: GameAction): GameAction | null {
  if (pick.type !== 'INSTALL_CARD' || !isCorpMain(state)) return null;
  const a = pick as GameAction & { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean };
  const card = state.corp.hq.find(c => c.instanceId === a.cardInstanceId);
  if (!card || typeOf(card) !== 'ice') return null;
  if (!a.asNewRemote && !state.corp.servers[a.targetServerId ?? '']?.isRemote) return null;
  if (state.corp.credits < rezCostOf(state, card)) return null;
  const bare = (['hq', 'rd'] as const).filter(id => state.corp.servers[id].ice.length === 0);
  if (!bare.length) return null;
  const stake = centralStake(state, card.instanceId);
  const to = bare.sort((x, y) => stake[y] - stake[x])[0];
  return legalShape(state, { type: 'INSTALL_CARD', cardInstanceId: card.instanceId, targetServerId: to }) ?? null;
}

/**
 * The points at stake for one access to each central (centralIce's order): HQ, its agendas' pointGain over the cards left
 * in HQ once `leaving` goes (the Corp's own hand, 10.2.2a); R&D, the deck list's agendas not yet seen over R&D's cards,
 * times their average pointGain (rezModel rdAgendaOdds: the Corp's one R&D pool), never R&D's order.
 */
export function centralStake(state: GameState, leaving: string): { hq: number; rd: number } {
  const score = state.runner.score;
  const hand = state.corp.hq.filter(c => c.instanceId !== leaving);
  const rd = rdAgendaOdds(state);
  return {
    hq: hand.length ? hand.filter(isAgenda).reduce((n, c) => n + pointGain(score, cardDef(c).agenda_points ?? 0), 0) / hand.length : 0,
    rd: rd.odds * pointGain(score, rd.points),
  };
}
