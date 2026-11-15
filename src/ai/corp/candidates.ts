import { CardInstance, GameAction, GameState, activePrompt, cardDef, getLegalActions } from '../../core';
import { evaluate } from '../evaluate';
import { ScoredAction } from '../agent';
import { answerPrompt, simulate } from '../prompts';
import { cardSynergy } from '../synergyTags';
import { dividendsOf } from '../cards';
import { serverHold } from './hold';
import { rezMoney } from './rezMoney';
import { HeldLine } from './lines';
import { Placement, iceCount, place, placedInstall, placementAction } from './placement';
import { rezAllowed } from './rez';

/**
 * Step 4 Stage C (spec-step4-corp-core.md 1.3, revision 13; stage-c/order.md as approved, c0-rulings.md): the Corp's
 * ordinary move (Q7). Every main-phase action the Corp can take, each complete and at the server `place` gives it, in
 * an order of nine intent lines fixed from evidence, with a counted tie-break inside each line. No hand-set rank: inside
 * a line a candidate is ordered by an owner's output (serverHold, stake, rezMoney) or by the valuation model's own play
 * value (evaluate after the move, less before); the last key is always the instance id, so the order is total and
 * deterministic (no rng is read).
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
 * Behind all nine, in the same order among themselves: a move that leaves fewer credits than rezMoney's keep (1.5), ice
 * the Corp could not also rez (its install cost, rule 8.5.11a, and its rez cost leave less than keep), and a play whose
 * whole value is on the board (an operation, ability, trash or purge) that the model values at or below the credits its
 * clicks would take instead (addendum 03:58Z, P3 b). These are order keys, not filters: the look-ahead
 * still sees them; with no look-ahead they are never played, since a credit is always there.
 *
 * Reads the Corp's own HQ and the public board only (10.2.2a): the owners it reads never look at R&D's order or the
 * Runner's grip.
 */

export interface Candidate {
  action: GameAction;
  /** The intent line, 1 to 9. */
  line: number;
  /** Fails a condition (below keep, ice not paid for, a play below a credit): sorts behind line 7. */
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
function icePaid(state: GameState, card: CardInstance, a: Install, keep: number): boolean {
  const server = a.asNewRemote || !a.targetServerId ? null : state.corp.servers[a.targetServerId];
  const install = server ? server.ice.length : 0;
  return state.corp.credits - install - (cardDef(card).cost ?? 0) >= keep;
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
function placedInstalls(state: GameState, card: CardInstance, installs: Install[], held: HeldLine | null): { action: Install; placement: Placement }[] {
  const seen = new Map<string, { action: Install; placement: Placement }>();
  const counted: { action: Install; placement: Placement }[] = [];
  for (const from of installs) {
    const p = place(state, card, { from, held: held ? structuredClone(held) : null });
    if (!p.length) continue;
    const placement = p[0];
    // An asset line (assetCover) is begun from the asset's own install: Q5 (scoreInTwoPick) plays its ice first
    const clean = placement.reason === 'assetCover' ? from : placedInstall(from, placement);
    const key = JSON.stringify(placementAction(card, { ...placement, server: placement.server }));
    const entry = { action: clean, placement };
    if (!['pick', 'fallback', 'assetLine:econIced', 'assetLine:trapOffScoring'].includes(placement.reason)) counted.push(entry);
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
  const value = (a: GameAction) => {
    const after = resolved(state, a);
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
  const play = (a: GameAction, line: number, creditTest = true) => {
    const r = value(a);
    if (!r) return;
    if (r.clicks <= 0 && opts.freeExhausted) return;
    const below = (creditTest && r.v <= Math.max(0, r.clicks) * creditValue) || (r.after.corp.credits < keep && r.after.corp.credits < corp.credits);
    add({ action: a, line, behind: below, keys: [-r.v, idNum(cardIdOf(a))], card: cardIdOf(a) });
  };

  // Installs, grouped by card so each card gets place's destinations
  const installsByCard = new Map<string, Install[]>();
  for (const a of legal) {
    if (!isInstall(a)) continue;
    // BANGUN's faceup installs and installs over a card in the root are cardRules / placement's (C4); plain installs here
    if (a.faceUp) continue;
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
      case 'TRASH_RESOURCE':
        play(a, 1);
        break;
      case 'PLAY_OPERATION_OR_EVENT':
        play(a, isPettyCash(state, a) ? 1 : tagsBeforeScoring(state, a) ? 3 : 4);
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
        if (!card || !rezAllowed(state, card, keep, after => corpCandidates(after, getLegalActions(after, 'corp'), opts)[0]?.action)) break;
        play(a, 4, false);
        break;
      }
      case 'ADVANCE_CARD': {
        const card = findInstalled(state, a.cardInstanceId);
        if (!card) break;
        if (typeOf(card) === 'agenda') agendaMove(state, a, card, keep, add);
        else play(a, 4);
        break;
      }
      case 'SCORE_AGENDA': {
        const card = findInstalled(state, a.cardInstanceId);
        // Scored first in line 3, unless an advance first turns into Dividends counters, or a tag first sets up its score
        // effect (cardRules.ts: overAdvance, tagFirst, moved from the ranking)
        const wait = card && (overAdvance(state, card, keep) || tagWaits(state, card));
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
    for (const { action } of placedInstalls(state, card, installs, opts.held)) {
      const t = typeOf(card);
      if (t === 'ice') iceMove(state, action, card, keep, add);
      else if (t === 'agenda') {
        const target = action.targetServerId ? corp.servers[action.targetServerId] : null;
        // Not over an agenda or asset already in the root (rule 8.5.6a would trash it): placement's question, not a move
        if (target?.root.some(c => ['agenda', 'asset'].includes(typeOf(c) ?? ''))) continue;
        agendaMove(state, action, card, keep, add);
      } else play(action, 4, false);
    }
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

/** The full order: the nine lines, then the group behind line 7 in the same order, then each line's keys. */
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

const PETTY_CASH = '35081';
/** Petty Cash from HQ: playable only as the turn's first action. */
export const isPettyCash = (state: GameState, a: GameAction): boolean => a.type === 'PLAY_OPERATION_OR_EVENT' && state.corp.hq.find(c => c.instanceId === a.cardInstanceId)?.cardCode === PETTY_CASH;

const findInstalled = (state: GameState, id: string) => Object.values(state.corp.servers).flatMap(v => [...v.root, ...v.ice]).find(c => c.instanceId === id);

/** Lines 2, 6, 8: an ice install at its placement (see the file comment and the tie-break contract, spec 1.3). */
function iceMove(state: GameState, a: Install, card: CardInstance, keep: number, add: (c: Candidate) => void) {
  const paid = icePaid(state, card, a, keep);
  const cost = (a.asNewRemote || !a.targetServerId ? 0 : state.corp.servers[a.targetServerId]?.ice.length ?? 0) + (cardDef(card).cost ?? 0);
  const after = simulate(state, a);
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
  if (count.staked) {
    // The fall in what the Runner can take: stake times entries (a server that comes to hold falls by its entries + 1)
    const fall = loss * (was.entries - now.entries + (now.holds && !was.holds ? 1 : 0));
    add({ action: a, line: 2, behind: !paid, keys: [-fall, cost, -now.margin, id], card: card.instanceId });
  } else add({ action: a, line: 6, behind: !paid, keys: [-loss, -(now.margin - was.margin), cost, id], card: card.instanceId });
}

/** Lines 3 and 9: an agenda install or advance, by whether its server holds after the move (margin as an order key, never a veto). */
function agendaMove(state: GameState, a: GameAction, card: CardInstance, keep: number, add: (c: Candidate) => void) {
  const after = simulate(state, a);
  if (!after) return;
  const server = serverOfCard(after, card.instanceId);
  const hold = server ? serverHold(after, server, { when: 'runnerTurn', corpCredits: after.corp.credits }) : null;
  const placed = findInstalled(after, card.instanceId) ?? card;
  const turns = turnsToScore(after, placed, 0);
  const below = after.corp.credits < keep && after.corp.credits < state.corp.credits;
  add({ action: a, line: hold?.holds ? 3 : 9, behind: below, keys: [turns, -(hold?.margin ?? 0), -(cardDef(card).agenda_points ?? 0), idNum(card.instanceId)], card: card.instanceId });
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

// ------------------------------------------------------------------ card rules the ranking held (C4 moves them to cardRules.ts)

/** Dividends: a scoreable agenda advanced again first while a click and a credit above keep are left (the ranking's overAdvance). */
function overAdvance(state: GameState, card: CardInstance, keep: number): boolean {
  if (dividendsOf(card.cardCode) === 0 || typeOf(card) !== 'agenda') return false;
  const excess = card.advancementCounters - (cardDef(card).advancement_cost ?? 0);
  return excess >= 0 && excess < 2 && state.corp.clicks >= 1 && state.corp.credits >= 1 + keep;
}

/** An agenda better scored with the Runner tagged, while an operation in HQ could tag them this turn (the ranking's tagFirst). */
function tagWaits(state: GameState, agenda: CardInstance): boolean {
  if (state.runner.tags > 0 || state.corp.clicks < 1) return false;
  const when = cardSynergy(cardDef(agenda)).when ?? [];
  if (!when.includes('ifTagged') || !when.includes('onScore')) return false;
  return state.corp.hq.some(c => typeOf(c) === 'operation' && (cardSynergy(cardDef(c)).gives?.tags ?? 0) > 0);
}

/** A tag operation that sets up a scoreable "if tagged" agenda (the ranking's tagsBeforeScore): played in line 3, before the score. */
function tagsBeforeScoring(state: GameState, a: GameAction): boolean {
  const card = state.corp.hq.find(c => c.instanceId === cardIdOf(a));
  if (!card || state.runner.tags > 0 || !(cardSynergy(cardDef(card)).gives?.tags ?? 0)) return false;
  return Object.values(state.corp.servers)
    .flatMap(v => v.root)
    .some(x => {
      const when = cardSynergy(cardDef(x)).when ?? [];
      return typeOf(x) === 'agenda' && x.advancementCounters >= (cardDef(x).advancement_cost ?? 99) && when.includes('ifTagged') && when.includes('onScore');
    });
}
