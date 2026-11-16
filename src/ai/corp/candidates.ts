import { CardInstance, GameAction, GameState, activePrompt, cardDef, getLegalActions } from '../../core';
import { evaluate, handValue, hqTrashCardsLoss } from '../evaluate';
import { resourceTrashHqCost } from '../../core/engine/actions/basic';
import { plan } from '../pricing';
import { ScoredAction } from '../agent';
import { answerPrompt, simulate } from '../prompts';
import { serverHold } from './hold';
import { rezMoney } from './rezMoney';
import { HeldLine } from './lines';
import { FreeInstall, Placement, iceCount, icePaidAt, place, placedInstall, placementAction } from './placement';
import { archivesWantsIce, rezAllowed } from './rez';
import { advancesAsIce, iceAdvanceValue, isPettyCash, overAdvance, trapAdvanceCap } from './cardRules';
import { placedCounterWorth } from '../effectValues';
export { isPettyCash } from './cardRules';


/**
 * Step 4 Stage C (spec-step4-corp-core.md 1.3, revision 13; stage-c/order.md as approved, c0-rulings.md): the Corp's
 * ordinary move (Q7). Every main-phase action the Corp can take, each complete and at the server `place` gives it, in
 * an order of nine intent lines fixed from evidence, with a counted tie-break inside each line. No hand-set rank: inside
 * a line a candidate is ordered by an owner's output (serverHold, stake, rezMoney) or by the valuation model's own play
 * value (evaluate after the move, less before); the last key is always the instance id, so the order is total and
 * deterministic for a given state (it draws no rng of its own; a simulated play resolves on the state's rng).
 *
 *   1 a play gone if not made now (a resource trash while the Runner is tagged, rule 5.2.6; Petty Cash)
 *   2 ice that improves the hold count on a server at stake (a stake loss, or the scoring remote while it does not hold:
 *     the ice redirect's question, c0-rulings.md addendum 03:40Z), paid for
 *   3 an agenda installed or advanced behind a server that holds (and a score)
 *   4 every other play, by the model's play value
 *   5 a purge (rule 5.2.6h)
 *   6 ice that changes no count, paid for
 *   7 draw (while the Corp holds fewer cards it can use than clicks to use them) or credit (rule 5.2.6a)
 *   8 a build pair: ice into a new remote with an agenda or asset in HQ to go behind it, paid for
 *   9 an agenda into a server that does not hold
 *
 * Behind all nine and ending the turn, in the same order among themselves: a move that leaves fewer credits than
 * rezMoney's keep (1.5), ice the Corp could not also rez (its install cost, rule 8.5.11a, and its rez cost leave less
 * than keep), and a play whose whole value is on the board (an operation, ability, trash or purge) that the model values
 * at or below the credits its clicks would take instead (addendum 03:58Z, P3 b). These are order keys, not filters: the
 * look-ahead still sees them; with no look-ahead they are never played, since a credit is always there.
 *
 * Reads only the state it is given (10.2.2a); the deciding Corp gives it its own view (turnPlanner.ts corpDecisionView:
 * R&D's order, the Runner's unseen grip and the rng a guess), the rollouts and the reply's Corp their playout's deal.
 */

export interface Candidate {
  action: GameAction;
  /** The intent line, 1 to 9. */
  line: number;
  /** Fails a condition (below keep, ice not paid for, a play below a credit): sorts after every line and ending the turn. */
  behind: boolean;
  /** The tie-break inside the line, lowest first (owner outputs and play values only). */
  keys: number[];
  /** The card the move installs, plays or uses (the planner's "two placements of one card" cap). */
  card?: string;
}

export interface CandidateOptions {
  /** The held two-turn line (place reads it). */
  held: HeldLine | null;
  /** The free-action guard has run out (loop safety): moves that spend no click are left out. */
  freeExhausted: boolean;
  /** A free install outside the main phase (placement.ts FreeInstall): `legal` holds the installs it offers, and the board after one is its own. */
  free?: FreeInstall;
}

const typeOf = (c: CardInstance | undefined) => (c ? cardDef(c).type_code : undefined);
const idNum = (id: string | undefined) => Number((id ?? '').replace(/\D/g, '')) || 0;
const cardIdOf = (a: GameAction): string | undefined => ('cardInstanceId' in a ? (a.cardInstanceId as string | undefined) : undefined);
type Install = GameAction & { type: 'INSTALL_CARD'; cardInstanceId: string; targetServerId?: string; asNewRemote?: boolean; faceUp?: boolean; trashFirst?: string[] };
const isInstall = (a: GameAction): a is Install => a.type === 'INSTALL_CARD';

/** The board after the Corp's move with its own prompts answered (Predictive Planogram, Seamless Launch), or null. */
function resolved(state: GameState, action: GameAction): GameState | null {
  let after = simulate(state, action);
  // As the old playScore did: the Corp's own prompts followed a few steps (carried number: three, registry)
  for (let i = 0; after && i < 3 && activePrompt(after)?.side === 'corp'; i++) {
    const next = simulate(after, answerPrompt(after, 'corp'));
    if (!next) break;
    after = next;
  }
  return after;
}

/** Ice the Corp can install and still rez within keep (rule 8.5.11a: 1 credit per ice already protecting the server). */
function icePaid(state: GameState, card: CardInstance, a: Install, keep: number, free?: FreeInstall): boolean {
  const server = a.asNewRemote || !a.targetServerId || free ? null : state.corp.servers[a.targetServerId];
  return icePaidAt(state, card, server ? server.ice.length : 0, keep);
}

/** The server a just-installed card sits in after `after`. */
const serverOfCard = (s: GameState, id: string) => Object.values(s.corp.servers).find(v => v.root.some(c => c.instanceId === id) || v.ice.some(c => c.instanceId === id))?.id;

/** Corp turns until an agenda can be scored (advancements short against this turn's clicks and credits, then full turns). */
function turnsToScore(state: GameState, agenda: CardInstance, clicksUsed: number): number {
  const short = Math.max(0, (cardDef(agenda).advancement_cost ?? 0) - agenda.advancementCounters);
  const now = Math.max(0, Math.min(state.corp.clicks - clicksUsed, state.corp.credits));
  if (short <= now) return 0;
  return Math.ceil((short - now) / Math.max(1, state.corp.maxClicks));
}

/** The destinations `place` gives a card's installs: the counted rule's alone where one applies (spec 1.3, authority 3). */
function placedInstalls(state: GameState, card: CardInstance, installs: Install[], held: HeldLine | null, free?: FreeInstall): { action: Install; placement: Placement }[] {
  const seen = new Map<string, { action: Install; placement: Placement }>();
  const counted: { action: Install; placement: Placement }[] = [];
  for (const from of installs) {
    const p = place(state, card, { from, held: held ? structuredClone(held) : null, ...(free ? { free } : {}) });
    if (!p.length) continue;
    const placement = p[0];
    // An asset line (assetCover) is begun from the asset's own install: Q5 (scoreInTwoPick) plays its ice first
    const clean = placement.reason === 'assetCover' ? from : placedInstall(from, placement);
    const key = JSON.stringify(placementAction(card, { ...placement, server: placement.server }));
    const entry = { action: clean, placement };
    if (!['pick', 'fallback', 'fallback:unpaid', 'assetLine:econIced', 'assetLine:trapOffScoring'].includes(placement.reason)) counted.push(entry);
    if (!seen.has(key)) seen.set(key, entry);
  }
  if (counted.length) return [counted[0]];
  return [...seen.values()];
}

/**
 * The candidate moves at a Corp main-phase decision, in order (see the file comment). `legal` is the engine's list.
 */
export function corpCandidates(state: GameState, legal: GameAction[], opts: CandidateOptions): Candidate[] {
  const corp = state.corp;
  const keep = rezMoney(state).keep;
  const before = evaluate(state, 'corp');
  const afterOf = (a: GameAction) => (opts.free && isInstall(a) ? opts.free(a) : simulate(state, a));
  const value = (a: GameAction) => {
    const after = opts.free && isInstall(a) ? opts.free(a) : resolved(state, a);
    return after ? { after, v: evaluate(after, 'corp') - before, clicks: corp.clicks - after.corp.clicks } : null;
  };
  const credit = legal.find(a => a.type === 'GAIN_CREDIT');
  const creditValue = credit ? value(credit)?.v ?? 0 : 0;
  const out: Candidate[] = [];
  const add = (c: Candidate) => out.push(c);

  /**
   * A play: lines 1, 4, 5. Behind when it leaves less than keep, or (`creditTest`) its value is not above the credits its
   * clicks would take. The credit test is for plays whose whole value is on the board once played (operations,
   * abilities, trashes, a purge); an asset or upgrade install, or a rez, pays later and is ordered by its play value
   * without it (c0-rulings addendum 03:58Z, P3 b).
   */
  const play = (a: GameAction, line: number, creditTest = true, extra = 0) => {
    const r0 = value(a);
    if (!r0) return;
    const r = { ...r0, v: r0.v + extra };
    if (r.clicks <= 0 && opts.freeExhausted) return;
    const below = (creditTest && r.v <= Math.max(0, r.clicks) * creditValue) || (r.after.corp.credits < keep && r.after.corp.credits < corp.credits);
    add({ action: a, line, behind: below, keys: [-r.v, idNum(cardIdOf(a))], card: cardIdOf(a) });
  };

  // Installs, grouped by card so each card gets place's destinations
  const installsByCard = new Map<string, Install[]>();
  const faceUp: { a: Install; card: CardInstance }[] = [];
  for (const a of legal) {
    if (!isInstall(a)) continue;
    // BANGUN's faceup agenda installs (C4): an agenda candidate like the facedown one at the same server, ordered just
    // after it (the bait's hand-set worth, bangunBait, went with the ranking in C7: the look-ahead prices the tag and damage)
    if (a.faceUp) {
      const card = corp.hq.find(c => c.instanceId === a.cardInstanceId);
      if (card && typeOf(card) === 'agenda') faceUp.push({ a, card });
      continue;
    }
    (installsByCard.get(a.cardInstanceId) ?? installsByCard.set(a.cardInstanceId, []).get(a.cardInstanceId)!).push(a);
  }

  for (const a of legal) {
    switch (a.type) {
      case 'END_TURN':
      case 'START_TURN':
        // After the nine lines and before the group behind them: a move that fails its condition is never played over
        // ending the turn (or starting it, after the turn-start rezzes worth making, rule 5.6.1b)
        add({ action: a, line: 10, behind: false, keys: [], card: undefined });
        break;
      case 'INSTALL_CARD':
        break;
      case 'TRASH_RESOURCE': {
        // plan.hqTrashCost (moved from the ranking's trashScore): the board took the HQ cards a resource's trash cost
        // (Sebastião Souza Pessoa, Manuel Lattes de Moura) off at the flat worth of a card in hand; they are the Corp's
        // least useful cards, priced by hqTrashCardsLoss
        const resource = state.runner.rig.resources.find(c => c.instanceId === a.cardInstanceId);
        const k = resource ? resourceTrashHqCost(state, resource) : 0;
        const size = corp.hq.length;
        const extra = resource && k > 0 && plan().hqTrashCost ? handValue(size, corp.handSizeLimit, 'corp') - handValue(size - k, corp.handSizeLimit, 'corp') - hqTrashCardsLoss(state, resource) : 0;
        play(a, 1, true, extra);
        break;
      }
      case 'PLAY_OPERATION_OR_EVENT':
        play(a, isPettyCash(state, a) ? 1 : 4);
        break;
      case 'USE_ABILITY':
        play(a, 4);
        break;
      case 'PURGE_VIRUS':
        play(a, 5);
        break;
      case 'REZ_CARD': {
        if (state.activeRun) break;
        const card = Object.values(corp.servers).flatMap(v => v.root).find(c => c.instanceId === a.cardInstanceId);
        // Ice waits for a run (6.9.2b); a root card only in its window and while it is worth rezzing at all
        if (!card) break;
        const allowed = rezAllowed(state, card, keep, after => corpCandidates(after, getLegalActions(after, 'corp'), opts)[0]?.action);
        // In the window before the turn begins a no joins the group behind (c0-rulings 15:50Z (3)); elsewhere it is not offered
        if (!allowed && state.turnStep?.kind !== 'corp_turn_start') break;
        if (allowed) play(a, 4, false);
        else add({ action: a, line: 4, behind: true, keys: [0, idNum(a.cardInstanceId)], card: a.cardInstanceId });
        break;
      }
      case 'ADVANCE_CARD': {
        const card = findInstalled(state, a.cardInstanceId);
        if (!card) break;
        if (typeOf(card) === 'agenda') agendaMove(state, a, card, keep, add, afterOf);
        else {
          // An advance on an asset or on ice (C4, registry row "an advance on an unknown asset"): the board's value of the
          // click and credit, plus what the counter is worth by its owner, which the board does not price
          // (placedCounterWorth; Pharos and Syailendra: iceAdvanceValue); a trap stops at its cap (cardRules)
          const server = Object.values(corp.servers).find(v => v.root.some(c => c.instanceId === card.instanceId));
          if (typeOf(card) === 'asset' && server && card.advancementCounters < trapAdvanceCap(state, card)) play(a, 4, true, placedCounterWorth(state, card, server.ice.length > 0));
          else if (typeOf(card) === 'ice' && advancesAsIce(card)) play(a, 4, true, iceAdvanceValue(state, card));
        }
        break;
      }
      case 'SCORE_AGENDA': {
        const card = findInstalled(state, a.cardInstanceId);
        // Scored first in line 3, unless an advance first turns into Dividends counters (cardRules.ts overAdvance, moved from
        // the ranking). The tag-first wait (tagFirst, tagsBeforeScore) never reached a recorded decision: deleted in C7
        const wait = card && overAdvance(state, card.instanceId, keep);
        add({ action: a, line: 3, behind: false, keys: [wait ? 1 : -2, idNum(a.cardInstanceId)], card: a.cardInstanceId });
        break;
      }
      case 'DRAW_CARD':
      case 'GAIN_CREDIT':
        // Line 7 is added after the rest: its draw half counts the cards the other lines can use (below)
        break;
      default:
        play(a, 4);
    }
  }

  for (const [id, installs] of installsByCard) {
    const card = corp.hq.find(c => c.instanceId === id);
    if (!card) continue;
    for (const { action } of placedInstalls(state, card, installs, opts.held, opts.free)) {
      const t = typeOf(card);
      if (t === 'ice') iceMove(state, action, card, keep, add, afterOf, opts.free);
      else if (t === 'agenda') {
        const target = action.targetServerId ? corp.servers[action.targetServerId] : null;
        // Not over an agenda or asset already in the root (rule 8.5.6a would trash it): placement's question, not a move
        if (target?.root.some(c => ['agenda', 'asset'].includes(typeOf(c) ?? ''))) continue;
        agendaMove(state, action, card, keep, add, afterOf);
      } else play(action, 4, false);
    }
  }

  for (const { a, card } of faceUp) {
    const target = a.targetServerId ? corp.servers[a.targetServerId] : null;
    if (!target?.root.some(c => ['agenda', 'asset'].includes(typeOf(c) ?? ''))) agendaMove(state, a, card, keep, add, afterOf, 1);
  }
  // Line 7: draw while the Corp holds fewer cards it can use than clicks to use them, else a credit
  const draw = drawFirst(state, out);
  for (const a of legal) if (a.type === 'DRAW_CARD' || a.type === 'GAIN_CREDIT') add({ action: a, line: 7, behind: false, keys: [draw === (a.type === 'DRAW_CARD') ? 0 : 1], card: undefined });
  return sortCandidates(out);
}

/**
 * The order as the look-ahead's interface takes it: each candidate's score is its position (count down from the
 * length), which nothing reads as a value. A first candidate that is a resource trash while tagged keeps the planner's
 * tagFirst mark (plan.tagFirst, corp/core.ts; C4 and leave-one-out decide it).
 */
export function asRanked(state: GameState, list: Candidate[]): RankedCandidate[] {
  return list.map((c, i) => ({
    action: c.action,
    score: list.length - i,
    line: c.line,
    behind: c.behind,
    card: c.card,
    ...(i === 0 && c.line === 1 && !c.behind && c.action.type === 'TRASH_RESOURCE' && state.runner.tags > 0 ? { tagFirst: true } : {}),
  }));
}

/** A candidate as the look-ahead takes it: the shared interface's action and position, with its line kept for the caps. */
export interface RankedCandidate extends ScoredAction {
  line: number;
  behind: boolean;
  card?: string;
}

const isRankedCandidate = (r: ScoredAction): r is RankedCandidate => typeof (r as Partial<RankedCandidate>).line === 'number';

/** Which of the two always-in-K slots a candidate fills (spec 1.3, c0-rulings b1 and e). */
export type IntakeSlot = 'agenda' | 'build';

/**
 * The planner's Corp intake (spec 1.3, brief C3): the first `k` of the full order, at most the first two placements of
 * one card and at most two candidates of one line (the next candidate in the order takes each freed slot); then the two
 * candidates always in K, when they exist and are not in already, in its last places: the best agenda candidate (line 3,
 * else 9) and the best build pair (line 8). `open` is the order as the planner filtered it (no turn end, nothing
 * dominated). Each returned entry says which slot brought it in, if one did.
 */
export function plannerIntake(open: ScoredAction[], k: number): { picked: ScoredAction[]; slots: Map<ScoredAction, IntakeSlot> } {
  const list = open.filter(isRankedCandidate);
  const perLine = new Map<number, number>();
  const perCard = new Map<string, number>();
  const picked: ScoredAction[] = [];
  for (const c of list) {
    if (picked.length >= k) break;
    if ((perLine.get(c.line) ?? 0) >= 2) continue;
    if (c.card && (perCard.get(c.card) ?? 0) >= 2) continue;
    picked.push(c);
    perLine.set(c.line, (perLine.get(c.line) ?? 0) + 1);
    if (c.card) perCard.set(c.card, (perCard.get(c.card) ?? 0) + 1);
  }
  const slots = new Map<ScoredAction, IntakeSlot>();
  const agenda = list.find(c => c.line === 3) ?? list.find(c => c.line === 9);
  const build = list.find(c => c.line === 8);
  for (const [slot, c] of [['agenda', agenda], ['build', build]] as const) {
    if (!c || picked.includes(c)) continue;
    picked.push(c);
    slots.set(c, slot);
  }
  return { picked, slots };
}

/** The full order: the nine lines, then ending the turn, then the behind group in the same order, then each line's keys. */
export function sortCandidates(list: Candidate[]): Candidate[] {
  const rank = (c: Candidate) => (c.line === 10 ? 99 : c.behind ? 100 + c.line : c.line <= 7 ? c.line : 50 + c.line);
  return [...list].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d) return d;
    for (let i = 0; i < Math.max(a.keys.length, b.keys.length); i++) {
      const k = (a.keys[i] ?? 0) - (b.keys[i] ?? 0);
      if (k) return k;
    }
    return JSON.stringify(a.action) < JSON.stringify(b.action) ? -1 : JSON.stringify(a.action) > JSON.stringify(b.action) ? 1 : 0;
  });
}


const findInstalled = (state: GameState, id: string) => Object.values(state.corp.servers).flatMap(v => [...v.root, ...v.ice]).find(c => c.instanceId === id);

/** Lines 2, 6, 8: an ice install at its placement (see the file comment and the tie-break contract, spec 1.3). */
function iceMove(state: GameState, a: Install, card: CardInstance, keep: number, add: (c: Candidate) => void, afterOf: (a: GameAction) => GameState | null, free?: FreeInstall) {
  const paid = icePaid(state, card, a, keep, free);
  const cost = (a.asNewRemote || !a.targetServerId || free ? 0 : state.corp.servers[a.targetServerId]?.ice.length ?? 0) + (cardDef(card).cost ?? 0);
  const after = afterOf(a);
  if (!after) return;
  const id = idNum(card.instanceId);
  if (a.asNewRemote || !a.targetServerId) {
    const server = serverOfCard(after, card.instanceId);
    const margin = server ? serverHold(after, server, { when: 'runnerTurn', corpCredits: after.corp.credits }).margin : 0;
    const root = state.corp.hq.some(c => c.instanceId !== card.instanceId && ['agenda', 'asset'].includes(typeOf(c) ?? ''));
    add({ action: a, line: root ? 8 : 6, behind: !paid, keys: root ? [-margin, cost, id] : [0, -margin, cost, id], card: card.instanceId });
    return;
  }
  const count = iceCount(state, a, card, after);
  if (!count) return;
  const { loss, was, now } = count;
  // R6 (countedRez; c0-rulings 15:50Z and 16:00Z (4)): ice on Archives only while Archives is worth ice (the rez owner)
  const bare = a.targetServerId === 'archives' && !archivesWantsIce(state);
  if (count.staked) {
    // The fall in what the Runner can take: stake times entries (a server that comes to hold falls by its entries + 1)
    const fall = loss * (was.entries - now.entries + (now.holds && !was.holds ? 1 : 0));
    add({ action: a, line: 2, behind: !paid || bare, keys: [-fall, cost, -now.margin, id], card: card.instanceId });
  } else add({ action: a, line: 6, behind: !paid || bare, keys: [-loss, -(now.margin - was.margin), cost, id], card: card.instanceId });
}

/** Lines 3 and 9: an agenda install or advance, by whether its server holds after the move (margin as an order key, never a veto). */
function agendaMove(state: GameState, a: GameAction, card: CardInstance, keep: number, add: (c: Candidate) => void, afterOf: (a: GameAction) => GameState | null, shown = 0) {
  const after = afterOf(a);
  if (!after) return;
  const server = serverOfCard(after, card.instanceId);
  const hold = server ? serverHold(after, server, { when: 'runnerTurn', corpCredits: after.corp.credits }) : null;
  const placed = findInstalled(after, card.instanceId) ?? card;
  const turns = turnsToScore(after, placed, 0);
  const below = after.corp.credits < keep && after.corp.credits < state.corp.credits;
  add({ action: a, line: hold?.holds ? 3 : 9, behind: below, keys: [turns, -(hold?.margin ?? 0), -(cardDef(card).agenda_points ?? 0), shown, idNum(card.instanceId)], card: card.instanceId });
}

/**
 * Line 7's condition (spec 1.3): draw while the Corp holds fewer cards it can use now than the clicks after this one to
 * use them, and HQ is under its hand size (4.3.6); otherwise a credit. A card it can use is a card in HQ with a
 * candidate in lines 1 to 6 that is not in the behind group (c0-rulings addendum 03:58Z, P2): one whose only moves are
 * a build (8) or an open agenda (9) does not count. Counts only.
 */
function drawFirst(state: GameState, out: Candidate[]): boolean {
  const hq = new Set(state.corp.hq.map(c => c.instanceId));
  const usable = new Set(out.filter(c => c.line <= 6 && !c.behind && c.card && hq.has(c.card)).map(c => c.card)).size;
  return state.corp.hq.length < state.corp.handSizeLimit && usable < state.corp.clicks - 1;
}

/**
 * A free install from HQ ignoring all costs (Synapse Global; Stage C1b, c0-rulings addendum 08:10Z; registry row
 * "placement"): the order's own moves for the HQ cards that are not agendas (an agenda would be revealed), each
 * at place's destination with the free option, and the board after each from the engine's own prompt. The card goes
 * to its first move in the order; the score is that move's position counted down from the list's length, read as
 * "which first", never as a value. Nothing is installed only when the order offers no install at all. The model's play
 * value is not read as a gate: it prices a card leaving HQ above unrezzed ice (Doomscroll on bare R&D, bug report #13).
 */
const freeOrders = new WeakMap<GameState, Map<string, Candidate[]>>();
export function freeInstallTarget(state: GameState, card: CardInstance, options: string[]): { server: string; score: number } | undefined {
  if (typeOf(card) === 'agenda') return undefined;
  const key = options.join();
  const cached = freeOrders.get(state)?.get(key);
  const order = cached ?? freeInstallOrder(state, options);
  if (!cached) (freeOrders.get(state) ?? freeOrders.set(state, new Map()).get(state)!).set(key, order);
  const i = order.findIndex(c => c.card === card.instanceId);
  if (i < 0) return undefined;
  const a = order[i].action as Install;
  return { server: a.asNewRemote || !a.targetServerId ? 'new' : a.targetServerId, score: order.length - i };
}

export function freeInstallOrder(state: GameState, options: string[]): Candidate[] {
  const free: FreeInstall = a => freeAfter(state, a as Install);
  const legal: GameAction[] = [];
  for (const c of state.corp.hq) {
    if (!['ice', 'asset', 'upgrade'].includes(typeOf(c) ?? '')) continue;
    for (const o of options) legal.push(o === 'new' ? { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: c.instanceId, asNewRemote: true } : { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: c.instanceId, targetServerId: o });
  }
  const where = (a: Install) => (a.asNewRemote || !a.targetServerId ? 'new' : a.targetServerId);
  return corpCandidates(state, legal, { held: null, freeExhausted: false, free }).filter(c => isInstall(c.action) && options.includes(where(c.action)));
}

/** The board after the free install of `a`, answered through the open prompt (the card pick, then its server), or null. */
function freeAfter(state: GameState, a: Install): GameState | null {
  const answer = (s: GameState, choice: object) => {
    const p = activePrompt(s);
    return p ? simulate(s, { type: 'RESOLVE_PROMPT', player: 'corp', promptId: p.id, choice } as GameAction) : null;
  };
  let s: GameState | null = state;
  const pick = activePrompt(state);
  if (pick?.kind === 'effect_cards') {
    if (!pick.candidateIds.includes(a.cardInstanceId)) return null;
    s = answer(state, { kind: 'effect_cards', cardInstanceIds: [a.cardInstanceId] });
  }
  const at = s && activePrompt(s);
  const server = a.asNewRemote || !a.targetServerId ? 'new' : a.targetServerId;
  if (!s || at?.kind !== 'effect_choice' || String(at.source.data?.cardId) !== a.cardInstanceId || !at.options.some(o => o.id === server)) return null;
  return answer(s, { kind: 'effect_choice', optionId: server });
}
