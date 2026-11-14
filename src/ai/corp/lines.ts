import { CardInstance, GameAction, GameState, cardDef, getLegalActions } from '../../core';
import { counters } from '../../core/engine/cardEffects';
import { withIceInstalled } from '../iceValues';
import { dividendsOf, scoreCreditsOf, turnIncomeOf } from '../cards';
import { plan } from '../pricing';
import { tally } from '../diagnostics';
import { serverHold } from './hold';
import { lineFloor } from './rezMoney';

/**
 * The counted scoring lines (Step 4 Stage A, spec-step4-corp-core.md 1.3 Q4 and Q5, 2.2), moved here from
 * countedScore.ts with their readers: can the Corp score an agenda by the end of its next turn with the server holding
 * through the Runner's turn (scoreInTwo), does a line under way still hold (lineHolds), the held line's step on a later
 * turn (heldLaterStep), the money they count on (knownIncome, nextTurnCredits) and the scoring remote.
 *
 * They read the owners: what holds a server is serverHold (corp/hold.ts), the money a line must leave once it has
 * scored is lineFloor, rezMoney's byServer sum (corp/rezMoney.ts). Same counts as before Stage A, same order of calls.
 *
 * Viewpoint: the Corp's own cards and HQ, the public board, the Runner's installed cards, credits and clicks. Nothing
 * reads the Runner's grip or either deck's order (10.2.2a). Every function reads states and never edits one.
 */

const typeOf = (c: CardInstance | undefined) => (c ? cardDef(c).type_code : undefined);
const isAgenda = (c: CardInstance | undefined) => typeOf(c) === 'agenda';
const remotes = (s: GameState) => Object.values(s.corp.servers).filter(v => v.isRemote);
export const installedAgendas = (s: GameState) => Object.values(s.corp.servers).flatMap(v => v.root.filter(isAgenda).map(c => ({ card: c, server: v.id })));

/** The Corp's main phase, outside a run and every prompt and window (where a line's next action is taken). */
export const isCorpMain = (s: GameState) =>
  s.activePlayer === 'corp' && !s.activeRun && s.pendingPrompts.length === 0 && !s.turnStep && !(s.priority && s.priority.holder !== 'corp') && !s.winner;

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

/** The clicks the Corp has on its next turn (5.2.6; bonus clicks given for it). */
const nextClicks = (state: GameState) => state.corp.maxClicks + (state.corp.bonusClicksNextTurn ?? 0);

/**
 * A two-turn line's money on its next turn: what the Corp ends this turn on, less the rez spend that holds the server
 * through the Runner's turn, plus its known income and the next turn's clicks the line does not spend (r) as credits
 * (5.2.6a). scoreInTwo, lineHolds and reservedForAgenda read it, so their horizons cannot drift.
 */
export const nextTurnCredits = (state: GameState, end: number, rez: number, r: number) => end - rez + knownIncome(state) + (nextClicks(state) - r);

/** The rez spend that holds `server` through the Runner's next turn with `credits` to spend (serverHold), or null. */
const holdingSpend = (state: GameState, server: string, credits: number): number | null => {
  const h = serverHold(state, server, { when: 'runnerTurn', corpCredits: credits });
  return h.holds ? h.rezCost : null;
};

/**
 * Can the Corp score an agenda by the end of its next turn, by counting only (spec M2 "feasible in two turns")? This
 * turn: (install it and) advance it a times, the rest of the clicks for credits (5.2.6a); next turn advance the rest
 * (1.18.1, 5.2.6f) and score (1.17.3a-c). In between, the server must hold through the Runner's turn: serverHold finds a
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
  // view: the board with the new ice in place, so the hold count reads its strength there (a remote's bonus: Palisade +2);
  // at: the server whose ice holds ('remote-placed' for a new remote's view)
  type Try = { agenda: CardInstance; server: string; at: string; clicks: number; credits: number; form: TwoTurnLine['form']; iceId?: string; view: GameState };
  const tries: Try[] = [];
  for (const a of installedAgendas(state)) tries.push({ agenda: a.card, server: a.server, at: a.server, clicks: 0, credits: 0, form: 'installed', view: state });
  for (const agenda of state.corp.hq.filter(isAgenda)) {
    for (const v of open) {
      if (v.ice.length) tries.push({ agenda, server: v.id, at: v.id, clicks: 1, credits: 0, form: 'install', view: state });
      for (const ice of uniqueByCode(hqIce)) {
        const view = withIceInstalled(state, ice, v);
        tries.push({ agenda, server: v.id, at: v.id, clicks: 2, credits: v.ice.length, form: 'install+ice', iceId: ice.instanceId, view });
      }
    }
    for (const ice of uniqueByCode(hqIce)) {
      const view = withIceInstalled(state, ice, null);
      tries.push({ agenda, server: 'new remote', at: 'remote-placed', clicks: 2, credits: 0, form: 'install+ice', iceId: ice.instanceId, view });
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
      const rez = holdingSpend(t.view, t.at, end);
      if (rez === null) continue;
      const nextCredits = nextTurnCredits(state, end, rez, r);
      if (nextCredits < r) continue;
      // The money once it scores (the agenda's own score credits and the turn after's income with it) keeps the board held
      if (nextCredits - r + scoreCreditsOf(t.agenda.cardCode) + income < lineFloor(t.view, t.agenda.instanceId)) {
        tally('scoreInTwo', 'floorRefused');
        continue;
      }
      const line: TwoTurnLine = { agenda: cardDef(t.agenda).title, agendaId: t.agenda.instanceId, server: t.server, form: t.form, ...(t.iceId ? { iceId: t.iceId } : {}), advanceNow: a, advanceNext: r, rez };
      if (!best || r < best.advanceNext) best = line;
      break;
    }
  }
  return best;
}

export const uniqueByCode = (cards: CardInstance[]) => [...new Map(cards.map(c => [c.cardCode, c])).values()];

/**
 * Whether an installed agenda's line still holds from `state` (a line under way, spec stage 0b I1): the clicks left
 * this turn all go to credits, the server holds through the Runner's turn (serverHold, with what the Corp ends on), and
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
  const rez = holdingSpend(state, server.server, end);
  if (rez === null) return false;
  const income = knownIncome(state);
  const next = nextTurnCredits(state, end, rez, r);
  if (next < r) return false;
  return next - r + scoreCreditsOf(card.cardCode) + income >= lineFloor(state, agendaId);
}

/** The action `want` describes, plain (no trash first, facedown). */
export const sameAction = (a: GameAction, want: Partial<GameAction> & Record<string, unknown>) =>
  Object.entries(want).every(([k, v]) => (a as unknown as Record<string, unknown>)[k] === v) && !(a as { trashFirst?: string[] }).trashFirst?.length && !(a as { faceUp?: boolean }).faceUp;

/** The legal Corp action of this shape, if any. */
export const legalShape = (state: GameState, want: Record<string, unknown>) => getLegalActions(state, 'corp').find(a => sameAction(a, want));

/**
 * On a later turn: score the agenda once its counters reach the requirement (1.17.3a), advance it while the turn can
 * finish it (5.2.6f); 'drop' otherwise; 'done' for a Dividends agenda at its requirement (left to the Corp's pick).
 */
export function finishTurnStep(state: GameState, held: HeldLine): GameAction | 'drop' | 'done' {
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

type ServerLike = GameState['corp']['servers'][string];

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
