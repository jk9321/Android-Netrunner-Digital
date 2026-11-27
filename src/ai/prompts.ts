import { CardInstance, GameAction, GameState, Prompt, SideCode, activePrompt, cardDef, executeAction, findCardAnywhere, getCardDefinition, getLegalActions, isLegalAction, knownInHand } from '../core';
import { corpBoardValue, evaluate, handCount, keepValue, rigCoverage } from './evaluate';
import { CARDS } from './cards';
import { PACE, placedCounterWorth } from './effectValues';
import { turnsLeft } from './cardProfiles';
import { BLOCK, MANEGARM, RunOptions, RunnerMemory, iceCost, runClick, runRestWorth, runScore, serverValue, spendCost, weakestIce } from './runs';
import { encounteredIce } from '../core/engine/ice';
import { keepBonus, tuning } from './synergy';
import { corpPorts } from './corpPorts';
import { iceWorth } from './iceValues';
import { rezCost } from '../core/engine/cardEffects';
import { isPsiStep } from '../core/scripts/effects';
import { frameKeys, plan, pricing } from './pricing';
import { handByCard, ownHandValue, withKnownCards } from './handValues';
import { SHRED_STEP } from '../core/engine/runEnd';
import { promptCardFaces, viewShownBeforePrompts } from '../core/view';
import { knownToCorpInRd } from '../core/engine/rdKnowledge';
import { memo } from './valueModel';
import { chainStats, runTermStats, runnerOtherKinds } from './diagnostics';
export { chainStats, runTermStats, runnerOtherKinds };

/** Applies an action, or returns null if the engine rejects it. */
export function simulate(state: GameState, action: GameAction): GameState | null {
  try {
    return executeAction(state, action);
  } catch {
    return null;
  }
}

const hand = (state: GameState, side: SideCode) => (side === 'corp' ? state.corp.hq : state.runner.grip);
/** How much a side wants to keep a card, plus (deck-aware AI) how well it fits the deck's plan. */
const keep = (state: GameState, card: CardInstance, synergy: boolean) => keepValue(state, card) + (synergy ? keepBonus(state, card) : 0);
/** Agendas first (most points first), then keep: Peer Review's hidden card and the Archives shuffles. */
const agendaFirst = (state: GameState, c: CardInstance, synergy: boolean) => (cardDef(c).type_code === 'agenda' ? 100 + (cardDef(c).agenda_points ?? 0) : keep(state, c, synergy));
/** The card was on top of R&D or the stack before (so it was drawn, not fetched by name). */
const fromDeck = (state: GameState, side: SideCode, card: CardInstance) =>
  (side === 'corp' ? state.corp.rd : state.runner.stack).some(c => c.instanceId === card.instanceId);
const sumKeep = (state: GameState, cards: CardInstance[], synergy: boolean) => cards.reduce((n, c) => n + keep(state, c, synergy), 0);

/**
 * Position value after an answer, from `side`'s point of view. Beyond the
 * board evaluation it counts which cards are in hand (so the AI discards
 * its least useful cards) and, for the Runner, the run still in progress.
 */
export function scoreOutcome(before: GameState, after: GameState, side: SideCode, memory?: RunnerMemory, synergy = false, arrivals: AnswerFrame | false = false): number {
  let score = evaluate(after, side);
  if (arrivals) score += arrivalTerms(before, after, side, synergy, arrivals);
  else {
    // Cards that came from the deck are unknown until drawn: only the cards that left the hand count (plan.blindDraws)
    const drawn = (c: CardInstance) => !hand(before, side).some(b => b.instanceId === c.instanceId) && fromDeck(before, side, c);
    score += 0.5 * (sumKeep(after, hand(after, side).filter(c => !drawn(c)), synergy) - sumKeep(before, hand(before, side), synergy));
  }
  if (side === 'runner' && before.activeRun) {
    // While ice is still ahead the rest of the run may not happen (0.8); once the breach has begun (the Success Phase,
    // rules 6.9.5b: the Runner breaches the server, 7.3.1) no ice is left and its accesses are counted in full
    const breaching = before.activeRun.phase === 'access';
    score += (breaching ? 1 : 0.8) * runRestWorth(after, memory, synergy && tuning.wary);
  }
  return score;
}

/**
 * F117 / R-93 D2 (brief netrunner-ai/f117-deck-arrivals/design-brief.md rev 2; addendum-departures.md): the hand terms of
 * an answer's score in its answer frame (scoreAnswer). Where the hand is priced by count (every prompt score today), the
 * cards that move in or out of the side's own hand are priced by the hand's owner in place of the count:
 *  - the seen arrivals A (in the hand after, not before, and known to the frame: the caller's set and every seen arrival
 *    still in the hand): M - C, M the owner's difference (ownHandValue of the board less the same board without A, its
 *    sort and hand limit with it) and C the count's (handCount, on both boards: the reach card can differ);
 *  - the chosen departures D (in the hand before, not after: installed, played, or named by an answer of the side: a
 *    discard, a cost), the mirror: less (M_D - C_D), M_D the owner's difference on the board before (ownHandValue of it
 *    less the same board without D: where the cards were held, so a card now installed is not also priced in the hand
 *    of a board that holds it on a server) and C_D the count's on the board after at the board before's hand size limit
 *    (handCount with D back in the hand less without: what evaluate's count took for them, a moved limit left to its
 *    own price).
 * Chance departures (byChance: no answer named it and it is in the discard pile or deck: damage, a trash at random)
 * keep base's term, the count and the half keep (the departures red team, ruled 09:32Z: the damage's own owner is
 * damageWorth, tracker F121), on the scored board exactly as base prices them (ruling "Time per kind and the chance
 * averaging", 15:45Z: the board's read of which cards the simulated RNG took is older than F117, R-C1's R-111).
 * Where the frame prices the hand by card (handByCard), the owner already holds the arrivals and chosen departures. The
 * half-keep term is the code's over the staying cards (in the hand before and after) and the chance departures (base's): no arrival in its list, seen or not, from any zone, and no chosen departure, whose keep is inside the
 * owner's difference (ruling, condition 1); seen arrivals are taken on the board without A (what A does to the staying
 * cards is in M), and the before sum on the board before without the chosen D (the mirror). The cards a chain's later
 * steps brought (in the hand at its end, not after its first answer, and not seen: a rez's draws) are put back in the
 * deck on that board: the staying cards' keep reads the hand and the deck, which would tell it which cards the
 * simulated deck gave (bar 6, Eminent Domain fetching Spin Doctor). With no arrival seen, no departure and no chain it
 * is today's term to the digit. Own hand only: the null slot (the other side's hand, every card known) keeps today's
 * term (scoreAnswer). `first`: the board after the answer itself, and the cards the side's answers named.
 */
/** An answer's frame for its hand terms: the board after the answer itself, and the cards the side's own answers named (the first and each followed step's). */
export interface AnswerFrame {
  readonly first: GameState;
  readonly named: ReadonlySet<string>;
}
function arrivalTerms(before: GameState, after: GameState, side: SideCode, synergy: boolean, { first, named }: AnswerFrame): number {
  const had = new Set(hand(before, side).map(c => c.instanceId));
  const now = new Set(hand(after, side).map(c => c.instanceId));
  const known = pricing().known[side];
  const seen = known ? hand(after, side).filter(c => !had.has(c.instanceId) && known.has(c.instanceId)) : [];
  const gone = hand(before, side).filter(c => !now.has(c.instanceId));
  const late = after === first ? [] : hand(after, side).filter(c => !had.has(c.instanceId) && !known?.has(c.instanceId) && !hand(first, side).some(f => f.instanceId === c.instanceId));
  const without = (cs: CardInstance[]) => {
    const ids = new Set(cs.map(c => c.instanceId));
    return withHand(after, side, hand(after, side).filter(c => !ids.has(c.instanceId)));
  };
  let term = 0;
  if (seen.length && !handByCard(side)) {
    const mBoard = without(seen);
    term += ownHandValue(after, side) - ownHandValue(mBoard, side) - (handCount(after, side, side) - handCount(mBoard, side, side));
  }
  const chance = gone.filter(c => byChance(after, side, named, c));
  const chosen = gone.filter(c => !chance.includes(c));
  if (chosen.length && known && !handByCard(side)) {
    // The chosen departures by the owner's difference on the board before, in place of what the count took for them (C
    // read at the board before's hand size limit: a step that moves the limit is priced where the limit is)
    const ids = new Set(chosen.map(c => c.instanceId));
    const owner = ownHandBefore(before, side) - ownHandValue(withHand(before, side, hand(before, side).filter(c => !ids.has(c.instanceId))), side);
    const at = withLimit(after, side, before);
    term -= owner - (handCount(withHand(at, side, [...hand(at, side), ...chosen]), side, side) - handCount(at, side, side));
  }
  // The staying cards' half keep, its before sum on the board before without the chosen departures (what they did to the
  // staying cards is in the owner's difference). Chance departures keep base's term, the count and the half keep: they
  // stay in the before sum, priced on the scored board as base prices them (ruling "Time per kind and the chance
  // averaging": the simulated RNG's read is older than F117, R-C1's R-111)
  const was = chosen.length ? withHand(before, side, hand(before, side).filter(c => !chosen.includes(c))) : before;
  const keepBoard = late.length ? toDeck(without(seen), side, late) : seen.length ? without(seen) : after;
  return term + 0.5 * (sumKeep(keepBoard, hand(keepBoard, side).filter(c => had.has(c.instanceId)), synergy) - sumKeep(was, hand(was, side).filter(c => now.has(c.instanceId) || chance.includes(c)), synergy));
}

/**
 * The owner's price of the hand on the board before a prompt's answers: the same for every answer, so worked out once per
 * prompt state and frame (the departures red team's finding 10). Keyed with the frame's whole context (frameKeys().context:
 * frozen, both known hands, the anchor, the decision seed, rezzingToUse), not only the known hands: ownHandValue prices an
 * unseen card at the root's deck prices under `frozen` and reads the anchor's credits (tracker F128; speed pass red team
 * finding 4). Exported for tests/speedPassKeys.test.ts.
 */
export function ownHandBefore(before: GameState, side: SideCode): number {
  return memo(before, `ownHandBefore:${side}:${frameKeys().context}`, () => ownHandValue(before, side));
}

/** `board` with `side`'s hand size limit read from `from` (a copy, only priced). */
function withLimit(board: GameState, side: SideCode, from: GameState): GameState {
  return side === 'corp' ? { ...board, corp: { ...board.corp, handSizeLimit: from.corp.handSizeLimit } } : { ...board, runner: { ...board.runner, handSizeLimit: from.runner.handSizeLimit } };
}

/** `state` with `cards` taken from `side`'s hand and put at the bottom of its deck (a copy, only priced). */
function toDeck(state: GameState, side: SideCode, cards: CardInstance[]): GameState {
  const ids = new Set(cards.map(c => c.instanceId));
  const board = withHand(state, side, hand(state, side).filter(c => !ids.has(c.instanceId)));
  return side === 'corp' ? { ...board, corp: { ...board.corp, rd: [...board.corp.rd, ...cards] } } : { ...board, runner: { ...board.runner, stack: [...board.runner.stack, ...cards] } };
}

/** `state` with `side`'s hand set to `cards` (a copy, only priced). */
function withHand(state: GameState, side: SideCode, cards: CardInstance[]): GameState {
  return side === 'corp' ? { ...state, corp: { ...state.corp, hq: cards } } : { ...state, runner: { ...state.runner, grip: cards } };
}

/**
 * How a step is read for seenArrivals (F117 D1): `real`, the step answers the prompt the decision itself is answering (its
 * root, or the Runner's honest view of it: the same moment of the same game), not a simulated one (a chain past its first
 * answer, a ranking's look-ahead, a planner playout); `rootRd`, the Corp's R&D cards whose place it knows at the
 * decision's root (the place and the id agree: runnerReply.ts corpKnownRdSlots' test, which prompts.ts cannot import).
 */
export interface ArrivalHow {
  readonly real: boolean;
  readonly rootRd: ReadonlySet<string>;
}
const NONE: ReadonlySet<string> = new Set();
const rootRdIds = new WeakMap<GameState, ReadonlySet<string>>();
/** The R&D cards the Corp knows the place of on `state` (rdKnownToCorp, where the place and the id agree: 4.2.3). */
function knownRdIds(state: GameState): ReadonlySet<string> {
  let ids = rootRdIds.get(state);
  if (!ids) rootRdIds.set(state, (ids = new Set(knownToCorpInRd(state).filter(e => state.corp.rd[e.at]?.instanceId === e.id).map(e => e.id))));
  return ids;
}
/** The decision's own prompt: its root, or a copy of it at the same moment (the Runner's honest view), outside a playout. */
function realPrompt(state: GameState, side: SideCode): boolean {
  const p = pricing();
  const root = p.anchor?.root;
  if (p.frozen || !root || p.anchor?.side !== side) return false;
  return root === state || (root.id === state.id && root.log.length === state.log.length && activePrompt(root)?.id === activePrompt(state)?.id);
}
export function arrivalHow(state: GameState, side: SideCode, real: boolean): ArrivalHow {
  const root = pricing().anchor?.root;
  return { real: real && realPrompt(state, side), rootRd: side === 'corp' && root ? knownRdIds(root) : NONE };
}

const facesShown = new WeakMap<GameState, ReadonlySet<string>>();
/**
 * The cards `before`'s active prompt shows `side` by face (core/view.ts's face rule), once per prompt state: the one copy
 * (D1's seen arrivals here, and runner/prompt.ts promptShownIds, which reads it with its own filter and F3's freeze).
 */
export function shownByPrompt(before: GameState, side: SideCode): ReadonlySet<string> {
  const prompt = activePrompt(before);
  if (!prompt || prompt.side !== side) return NONE; // the other side's prompt shows it nothing (and is not memoised under its side)
  let shown = facesShown.get(before);
  if (shown) return shown;
  const out = new Set<string>();
  const { faced, onTable } = viewShownBeforePrompts(before, side);
  for (const [id, face] of promptCardFaces(prompt, x => faced.has(x), x => onTable.has(x))) if (face) out.add(id);
  facesShown.set(before, (shown = out));
  return shown;
}
/** The card ids an answer names: its chosen cards, the inst ids in its option, and the prompt's install data. */
function answerNames(prompt: Prompt | undefined, action: GameAction | undefined): Set<string> {
  const ids = new Set<string>();
  if (action?.type === 'RESOLVE_PROMPT') {
    const c = action.choice;
    if (c.kind === 'effect_cards') c.cardInstanceIds.forEach(id => ids.add(id));
    if (c.kind === 'effect_choice') for (const m of c.optionId.match(/inst-\d+/g) ?? []) ids.add(m);
  }
  if (prompt && 'source' in prompt && prompt.source.data?.install && typeof prompt.source.data.cardId === 'string') ids.add(prompt.source.data.cardId);
  return ids;
}

/** The cards the active prompt shows the Runner in place: its source entry's `promptShows.inPlace` key of the prompt's data (runner/prompt.ts reads it from here). */
export function promptInPlaceIds(state: GameState): Set<string> {
  const prompt = activePrompt(state);
  const out = new Set<string>();
  if (!prompt || prompt.side !== 'runner' || !('source' in prompt)) return out;
  const key = CARDS[prompt.source.cardCode]?.promptShows?.inPlace;
  const id = key ? prompt.source.data?.[key] : undefined;
  if (typeof id === 'string') out.add(id);
  return out;
}

/**
 * F117 D1: the seen arrivals of one step (`action` on `before` gave `after`), for `side`. An arrival is a card in the
 * side's hand after the step that was not in it before. It is unseen only if it was in the side's own deck (R&D, the
 * stack) before the step and none of these holds:
 *  (i)   the answer names it, or the prompt's install data does, and the prompt shows it by face (the screen's rule,
 *        core/view.ts promptCardFaces): a card a search names is the same card in any deal;
 *  (ii)  real prompts, the Corp only: it was drawn from an R&D place the Corp knew before the step (rdKnownToCorp);
 *  (iii) real prompts, the Runner only: its source's entry shows it in place (`promptShows.inPlace`, promptInPlaceIds);
 *  on a simulated step, the Corp only: it was drawn from an R&D place known at the decision's root (not the simulated
 *        state's rdKnownToCorp, which the playout itself writes).
 * Every other arrival is seen: from its own Archives, the table, the heap, a host, or the set-aside place of its own
 * search; a side knows its own card. A look inside a playout makes nothing seen (ruling, rev 2 point 3: AU Co.'s
 * looked-at cards are a named debt, an under-read).
 */
export function seenArrivals(before: GameState, action: GameAction | undefined, after: GameState, side: SideCode, how: ArrivalHow): string[] {
  const had = new Set(hand(before, side).map(c => c.instanceId));
  const arrivals = hand(after, side).filter(c => !had.has(c.instanceId));
  if (!arrivals.length) return [];
  const deck = new Set((side === 'corp' ? before.corp.rd : before.runner.stack).map(c => c.instanceId));
  let named: Set<string> | undefined;
  const out: string[] = [];
  for (const c of arrivals) {
    const id = c.instanceId;
    if (!deck.has(id)) {
      out.push(id);
      continue;
    }
    named ??= answerNames(activePrompt(before), action);
    if (named.has(id) && shownByPrompt(before, side).has(id)) out.push(id);
    else if (how.real ? (side === 'corp' ? knownRdIds(before).has(id) : promptInPlaceIds(before).has(id)) : side === 'corp' && how.rootRd.has(id)) out.push(id);
  }
  return out;
}

/**
 * The answers to price: the engine's legal list, which also holds the Runner's make-room answers (trash programs first
 * so an installed program fits, rules 8.5.6c; makeRoomSets in src/core/engine/legalActions.ts owns them), plus the
 * Corp's trash-first ice answers (rules 8.5.6b), which the engine does not list.
 */
export function promptAnswers(state: GameState, side: SideCode, synergy = false): GameAction[] {
  const legal = getLegalActions(state, side).filter(a => a.type === 'RESOLVE_PROMPT').slice(0, 200);
  const iceTrash = synergy;
  return [...legal, ...(iceTrash ? iceTrashAnswers(state) : [])];
}

/**
 * A Corp effect installing ice (Mercia B4LL4RD, Ansel 1.0): also answer
 * each server by trashing its weakest rezzed ice first (rules 8.5.6b),
 * which can make a server affordable. The outcome decides.
 */
export function iceTrashAnswers(state: GameState): GameAction[] {
  const prompt = activePrompt(state);
  if (!prompt || prompt.side !== 'corp' || prompt.kind !== 'effect_choice' || !prompt.source.data?.install) return [];
  const card = findCardAnywhere(state, String(prompt.source.data.cardId));
  if (!card || cardDef(card).type_code !== 'ice') return [];
  return prompt.options.flatMap(o => {
    const weak = o.id === 'new' ? undefined : weakestIce(state, o.id);
    if (!weak) return [];
    const action: GameAction = { type: 'RESOLVE_PROMPT', player: 'corp', promptId: prompt.id, choice: { kind: 'effect_choice', optionId: o.id, trashFirst: [weak.instanceId] } };
    return isLegalAction(state, action) ? [action] : [];
  });
}

function mulligan(state: GameState, prompt: Prompt, synergy: boolean): boolean {
  const cards = hand(state, prompt.side);
  // (Jeff) a Corp hand needs ice it can rez early (on 5 credits, with a credit to spare), not just any ice
  if (prompt.side === 'corp') return !cards.some(c => cardDef(c).type_code === 'ice' && (!synergy || (cardDef(c).cost ?? 0) <= 4));
  const useful = cards.some(c => /icebreaker/i.test(cardDef(c).keywords ?? '') || /gain \d+|load \d+/i.test(cardDef(c).stripped_text ?? ''));
  return !useful;
}

/** The server option ids of a "run any server" choice, if this prompt is one. */
function serverOptions(state: GameState, prompt: Prompt): string[] | null {
  if (prompt.kind !== 'effect_choice') return null;
  const ids = prompt.options.map(o => o.id);
  return ids.length > 0 && ids.every(id => state.corp.servers[id]) ? ids : null;
}

/**
 * A bad publicity the Runner gives the Corp: a credit on each run for the rest of the game
 * (rules 10.6), or the Corp derezzing ice instead (Kompromat), whichever is cheaper for it.
 */
export function badPublicityWorth(state: GameState): number {
  return Math.min(3, 0.8 * PACE.runs * turnsLeft(state));
}

/**
 * A run card's riders, by the code of the card that starts the run (run events, Red Team, Conduit,
 * Baker, Eru...): each card's `run` entry in src/ai/cards/ (2026-11-05, moved from a switch here so a
 * card's worth and its run live in one place; tests/useAudit.test.ts checks every run card has one).
 */
export function runEventOptions(cardCode: string, state?: GameState): RunOptions {
  return CARDS[cardCode]?.run?.(state) ?? {};
}

/**
 * Picks an answer to the active prompt, which belongs to `side`. `at`: where it is asked inside an answered prompt's chain
 * (followChain); left out, the prompt is answered on its own, with a new budget of chained work (withChainWork).
 */
export function answerPrompt(state: GameState, side: SideCode, memory?: RunnerMemory, synergy = false, at?: ChainAt): GameAction {
  return at ? answerAt(state, side, memory, synergy, at) : withChainWork(state, w => answerAt(state, side, memory, synergy, w));
}

function answerAt(state: GameState, side: SideCode, memory: RunnerMemory | undefined, synergy: boolean, at: ChainAt): GameAction {
  // The run under way first (follow-up 3): when it separates the answers, it decides, ahead of the per-card blocks; a tie
  // goes to today's answer (a block's or the fallback's)
  const run = side === 'corp' ? runAnswer(state, memory, synergy, at) : null;
  if (run?.length === 1) return run[0];
  const today = todayAnswer(state, side, memory, synergy, at);
  return run?.find(a => JSON.stringify(a) === JSON.stringify(today)) ?? run?.[0] ?? today;
}

/**
 * F117 D3 (ruling 4): the chained work under one answered prompt is a total, `left` scored answers shared by every chain
 * nested under it (each answer scored inside a chain counts 1), carried as an argument, never a module counter. Past it,
 * every answer of that prompt is scored at one step (`oneStep`), and a card one step leaves set aside is priced as held
 * (scoreAnswer): a bound on work never decides a pick between answers. `used`: what the prompt's chains scored.
 */
export interface ChainWork {
  left: number;
  used: number;
  readonly oneStep: boolean;
}
/** Where an answer is scored: the prompt's work, and how deep in its chain (0: the prompt itself). */
export interface ChainAt {
  readonly work: ChainWork;
  readonly depth: number;
}
/**
 * The budget of chained work per answered prompt (F117 D3, ruling 4): a bound on work, not a value (as the settle's
 * SETTLE_DEPTH). Its size is the brief's lead, 150, kept after step 0 item 5 counted it (the scored answers per answered
 * prompt, 331 deals): every real prompt fits (max 135), and 10 nested chains in rankings and playouts go past it
 * (Poétrï 8, Off the Books 2), each then scored at one step. An object so a measurement script can lift it; play never
 * writes it.
 */
export const CHAIN_BUDGET = { size: 150 };
class ChainBudgetOut extends Error {}
// The chain counts (chainStats) and the run term's (runTermStats, runnerOtherKinds) live in diagnostics.ts
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
const sourceOf = (state: GameState) => {
  const p = activePrompt(state);
  return p && 'source' in p ? `${p.source.cardCode}:${p.source.step ?? ''}` : (p?.kind ?? '-');
};
/** Runs `fn` as the scoring of one answered prompt on `state`, with a new budget; past it, again at one step (counted). */
export function withChainWork<T>(state: GameState, fn: (at: ChainAt) => T): T {
  const work: ChainWork = { left: CHAIN_BUDGET.size, used: 0, oneStep: false };
  try {
    const out = fn({ work, depth: 0 });
    if (chainStats.on && work.used > 0 && chainStats.used.length < 1e6) chainStats.used.push(work.used);
    return out;
  } catch (e) {
    if (!(e instanceof ChainBudgetOut)) throw e;
    if (chainStats.on) bump(chainStats.capped, sourceOf(state));
    return fn({ work: { left: Infinity, used: 0, oneStep: true }, depth: 0 });
  }
}

/**
 * F117 D1 and D3: one answer's score, the one-answer scorer every site that scores an answer calls (the fallback below,
 * greedyCards, the run term's runPrice, the Runner's 'again' path). It follows the answer's chain (followChain), and
 * makes ONE answer frame: the caller's known set and every seen arrival of the chain still in the hand
 * (handValues.ts withKnownCards; none where the slot is null), around everything that prices the end board: evaluate,
 * the hand terms (scoreOutcome's arrivalTerms) and the caller's own terms (`finish`: freeRezSaving, rigMove, the bypass
 * skip). A card of the side's own search still set aside at the chain's end (a cut, the depth limit, or one step) is
 * priced as held: the board with it in the hand, as a seen arrival. `finish` gets the score and the end board.
 */
export function scoreAnswer(
  state: GameState,
  prompt: Prompt,
  action: GameAction,
  after: GameState,
  side: SideCode,
  memory: RunnerMemory | undefined,
  synergy: boolean,
  at: ChainAt,
  finish?: (score: number, board: GameState) => number
): number {
  if (at.depth > 0) {
    at.work.used++;
    if (--at.work.left < 0) throw new ChainBudgetOut();
  }
  if (!pricing().known[side]) {
    // The null slot (the modelled other side): no frame, nothing added, today's hand term
    const board = followChain(prompt, state, action, after, side, memory, synergy, at, null).board;
    const score = scoreOutcome(state, board, side, memory, synergy);
    return finish ? finish(score, board) : score;
  }
  const chain = followChain(prompt, state, action, after, side, memory, synergy, at, arrivalHow(state, side, at.depth === 0));
  const kept = (chain.board.setAside ?? []).filter(c => !(state.setAside ?? []).some(b => b.instanceId === c.instanceId) && cardDef(c).side_code === side);
  let board = chain.board;
  if (kept.length) {
    if (chainStats.on) bump(chainStats.aside, `${'source' in prompt ? prompt.source.cardCode : prompt.kind}:${chain.stop}`);
    const ids = new Set(kept.map(c => c.instanceId));
    board = withHand({ ...board, setAside: (board.setAside ?? []).filter(c => !ids.has(c.instanceId)) }, side, [...hand(board, side), ...kept]);
  }
  const frame = { first: after, named: chain.named };
  return withKnownCards(side, kept.length ? [...chain.seen, ...kept.map(c => c.instanceId)] : chain.seen, () => {
    const score = scoreOutcome(state, board, side, memory, synergy, frame);
    return finish ? finish(score, board) : score;
  });
}

/**
 * F117 departures, the chance ones (the Runner rework coordinator's condition 1, ruled 2026-11-27 09:15Z; the departures
 * red team, ruled 09:32Z): a card that left the side's own hand on the scored board that no answer of the side named,
 * and that is now in its discard pile or deck (net, meat, core or brain damage; an "at random" trash), left by chance.
 * arrivalTerms keeps base's term for them, the count and the half keep (the simulated board holds the very cards the
 * engine's RNG took, as base reads it: R-C1's R-111, `RULE-HIDDEN-INFO`).
 */
function byChance(board: GameState, side: SideCode, named: ReadonlySet<string>, card: CardInstance): boolean {
  if (named.has(card.instanceId)) return false;
  const id = card.instanceId;
  const has = (cs: CardInstance[]) => cs.some(c => c.instanceId === id);
  return side === 'corp' ? has(board.corp.archives.faceUp) || has(board.corp.archives.faceDown) || has(board.corp.rd) : has(board.runner.heap) || has(board.runner.stack);
}

/** The answer of the per-card blocks and the fallback (answerPrompt before the run term). */
function todayAnswer(state: GameState, side: SideCode, memory: RunnerMemory | undefined, synergy: boolean, at: ChainAt): GameAction {
  const prompt = activePrompt(state)!;
  const base = { type: 'RESOLVE_PROMPT' as const, player: side, promptId: prompt.id };

  if (prompt.kind === 'mulligan') {
    return { ...base, choice: { kind: 'mulligan', mulligan: mulligan(state, prompt, synergy) } };
  }
  // Psi Game (Liberation): a secret bid from a mixed strategy, never from the other side's bid
  if (prompt.kind === 'effect_choice' && isPsiStep(prompt.source.step)) {
    return { ...base, choice: { kind: 'effect_choice', optionId: psiBid(state, side, prompt.options.map(o => o.id)) } };
  }
  // Salvo Testing's core damage, a "may" the Corp always takes (the Runner's Strike Fund and "Pretty" Mary: their entries)
  if (prompt.kind === 'effect_choice' && prompt.source.cardCode === '34031' && prompt.source.step === 'damage') {
    return { ...base, choice: { kind: 'effect_choice', optionId: 'yes' } };
  }
  // AirbladeX: prevent all the net damage it can, but keep the last counter (and the card) when 1 damage would only cost a card from a full grip.
  if (side === 'runner' && prompt.kind === 'effect_choice' && prompt.source.step === 'prevent_damage') {
    const most = Math.max(...prompt.options.map(o => Number(o.id)));
    const counters = findCardAnywhere(state, prompt.source.instanceId)?.tokens.power ?? 0;
    const save = Number(prompt.source.data?.amount) === 1 && counters === 1 && state.runner.grip.length >= 5;
    return { ...base, choice: { kind: 'effect_choice', optionId: String(save ? 0 : most) } };
  }
  // Lycian Multi-Munition: the subtypes the Runner has no breaker for; all three when it covers them all
  // (more subroutines), or when an AI breaker breaks anything anyway
  if (side === 'corp' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '34100' && prompt.source.step === 'subtypes') {
    const { covered, anyBreakers } = rigCoverage(state.runner.rig.programs);
    const open = anyBreakers > 0 ? [] : ['barrier', 'code gate', 'sentry'].filter(t => !covered.has(t));
    const id = open.length === 0 ? 'all' : open.join('+');
    return { ...base, choice: { kind: 'effect_choice', optionId: prompt.options.some(o => o.id === id) ? id : 'all' } };
  }
  // Balanced Coverage: name the commonest non-agenda type left in R&D (the Corp knows its deck, not the order);
  // reveal it for the 2 credits (an agenda would never be named, so revealing tells the Runner little)
  if (side === 'corp' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '34050') {
    if (prompt.source.step === 'reveal') return { ...base, choice: { kind: 'effect_choice', optionId: 'yes' } };
    if (prompt.source.step === 'type') {
      const counts = new Map<string, number>();
      for (const c of state.corp.rd) {
        const t = cardDef(c).type_code;
        if (t !== 'agenda') counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      const best = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
      return { ...base, choice: { kind: 'effect_choice', optionId: best && prompt.options.some(o => o.id === best) ? best : 'no' } };
    }
  }
  // Cohort Guidance Program: with 2 or more cards in HQ, swap the least useful for 2 credits and a draw
  if (side === 'corp' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '34108' && prompt.source.step === 'mode') {
    const trash = state.corp.hq.length >= 2 && prompt.options.some(o => o.id === 'trash');
    return { ...base, choice: { kind: 'effect_choice', optionId: trash ? 'trash' : 'no' } };
  }
  // Synapse Global: a free install from HQ, judged like the Corp's own install choice; never an agenda,
  // which it would reveal (plan.freeInstallPick, bug report #13)
  if (side === 'corp' && (prompt.kind === 'effect_cards' || prompt.kind === 'effect_choice') && prompt.source.cardCode === SYNAPSE) {
    const servers = [...Object.keys(state.corp.servers), 'new'];
    if (prompt.kind === 'effect_cards' && prompt.source.step === 'pick') {
      const picks = prompt.candidateIds
        .map(id => findCardAnywhere(state, id))
        .filter((c): c is CardInstance => !!c && cardDef(c).type_code !== 'agenda')
        .map(c => ({ c, score: corpPorts.freeInstallTarget(state, c, servers)?.score ?? -Infinity }))
        .filter(p => p.score > 0)
        .sort((a, b) => b.score - a.score);
      return { ...base, choice: { kind: 'effect_cards', cardInstanceIds: picks.length > 0 ? [picks[0].c.instanceId] : [] } };
    }
    const card = prompt.kind === 'effect_choice' && prompt.source.data?.install ? findCardAnywhere(state, String(prompt.source.data.cardId)) : undefined;
    const target = card && prompt.kind === 'effect_choice' ? corpPorts.freeInstallTarget(state, card, prompt.options.map(o => o.id)) : undefined;
    if (target) return { ...base, choice: { kind: 'effect_choice', optionId: target.server } };
  }
  // Warm Reception, Janaína: a free install from HQ; ice the Corp can afford first, then an asset or upgrade, never an agenda
  if (side === 'corp' && prompt.kind === 'effect_cards' && ['34098', '34115'].includes(prompt.source.cardCode) && prompt.source.step === 'pick') {
    const cards = prompt.candidateIds.map(id => findCardAnywhere(state, id)).filter((c): c is CardInstance => !!c);
    const ice = cards.filter(c => cardDef(c).type_code === 'ice' && (cardDef(c).cost ?? 0) <= state.corp.credits).sort((a, b) => (cardDef(b).cost ?? 0) - (cardDef(a).cost ?? 0));
    const root = cards.filter(c => ['asset', 'upgrade'].includes(cardDef(c).type_code) && (cardDef(c).cost ?? 0) <= state.corp.credits);
    const pick = ice[0] ?? root[0];
    return { ...base, choice: { kind: 'effect_cards', cardInstanceIds: pick ? [pick.instanceId] : [] } };
  }
  // Liberation install effects placing an agenda: into the best-iced empty remote, not a bare new one
  if (side === 'corp' && prompt.kind === 'effect_choice' && prompt.source.data?.install && LIB_INSTALLERS.includes(prompt.source.cardCode)) {
    const card = findCardAnywhere(state, String(prompt.source.data.cardId));
    if (card && cardDef(card).type_code === 'agenda') {
      const remote = safeAgendaRemote(state, prompt.options.map(o => o.id));
      if (remote) return { ...base, choice: { kind: 'effect_choice', optionId: remote } };
    }
  }
  // Epiphany Analytica: of the top 3 of R&D, ice or an asset or upgrade; an agenda only with an iced empty remote to put it in
  if (side === 'corp' && prompt.kind === 'effect_cards' && prompt.source.cardCode === '34048' && prompt.source.step === 'pick') {
    const cards = prompt.candidateIds.map(id => findCardAnywhere(state, id)).filter((c): c is CardInstance => !!c);
    const agenda = safeAgendaRemote(state, Object.keys(state.corp.servers)) ? cards.find(c => cardDef(c).type_code === 'agenda') : undefined;
    const ice = cards.find(c => cardDef(c).type_code === 'ice' && (cardDef(c).cost ?? 0) <= state.corp.credits);
    const root = cards.find(c => ['asset', 'upgrade'].includes(cardDef(c).type_code));
    const pick = agenda ?? ice ?? root;
    return { ...base, choice: { kind: 'effect_cards', cardInstanceIds: pick ? [pick.instanceId] : [] } };
  }
  // Lightning Laboratory: its one counter rezzes ice free for a turn; spend it on a run that threatens
  // something (HQ, R&D, a remote with cards in it) and on ice that costs at least 3 to rez
  if (side === 'corp' && prompt.kind === 'effect_cards' && prompt.source.cardCode === '34097' && prompt.source.step === 'rez') {
    const server = state.activeRun ? state.corp.servers[state.activeRun.server] : undefined;
    const threatened = !!server && (server.id === 'hq' || server.id === 'rd' || (server.isRemote && server.root.length > 0));
    const ice = prompt.candidateIds
      .map(id => findCardAnywhere(state, id))
      .filter((c): c is CardInstance => !!c)
      .sort((a, b) => rezCost(state, b) - rezCost(state, a))
      .slice(0, 2);
    const worth = ice.reduce((n, c) => n + rezCost(state, c), 0);
    return { ...base, choice: { kind: 'effect_cards', cardInstanceIds: threatened && worth >= 3 ? ice.map(c => c.instanceId) : [] } };
  }
  // Breach order: the cards in the root first, then the central zone, without peeking at what comes up
  if (prompt.kind === 'access_order') {
    return { ...base, choice: { kind: 'access_order', optionId: prompt.options[0].id } };
  }
  if (prompt.kind === 'discard') {
    const cards = [...hand(state, side)].sort((a, b) => keep(state, a, synergy) - keep(state, b, synergy));
    return { ...base, choice: { kind: 'discard', cardInstanceIds: cards.slice(0, prompt.count).map(c => c.instanceId) } };
  }

  const servers = side === 'runner' ? serverOptions(state, prompt) : null;
  if (servers && prompt.kind === 'effect_choice') {
    const scored = servers.map(id => ({ id, score: runScore(state, id, { ...runEventOptions(prompt.source.cardCode, state), memory, wary: synergy && tuning.wary }) }));
    scored.sort((a, b) => b.score - a.score);
    return { ...base, choice: { kind: 'effect_choice', optionId: scored[0].id } };
  }

  // The Runner's per-card answers (B3 commit 1): each Runner card's entry (src/ai/cards, `promptAnswer`), read here in the
  // chain's order; an entry with no answer leaves the prompt to the rest of the chain
  if ('source' in prompt) {
    const own = CARDS[prompt.source.cardCode]?.promptAnswer?.({ state, side, prompt, memory, synergy });
    if (own) return { ...base, choice: own };
  }

  // Manegarm Skunkworks: pay the cheaper way in if the access is worth it, on the scale runScore planned the run with
  if (side === 'runner' && prompt.kind === 'effect_choice' && prompt.source.cardCode === MANEGARM && state.activeRun) {
    const value = serverValue(state, state.activeRun.server, 0, memory, synergy && tuning.wary);
    const cost: Record<string, number> = { clicks: 2 * runClick(state), pay: spendCost(state, 5) };
    const ways = prompt.options.filter(o => o.id in cost && cost[o.id] < value).sort((a, b) => cost[a.id] - cost[b.id]);
    return { ...base, choice: { kind: 'effect_choice', optionId: ways[0]?.id ?? 'end' } };
  }

  // The Holo Man (Jeff's Corp game 1, bug report #17: the AI moved it off the remote holding Offworld Office, so it
  // never advanced it): it goes where its 3 counters do most, the server with the agenda they bring closest to scored
  // (one they finish counts its points), and stays put when no server has one (the board score had no sense of it)
  if (side === 'corp' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '34120' && prompt.source.step === 'move') {
    const holo = findCardAnywhere(state, prompt.source.instanceId);
    const here = holo ? Object.values(state.corp.servers).find(v => v.root.some(c => c.instanceId === holo.instanceId))?.id : undefined;
    const pull = (serverId: string) =>
      Math.max(
        0,
        ...(state.corp.servers[serverId]?.root ?? [])
          .filter(c => cardDef(c).type_code === 'agenda')
          .map(c => {
            const cost = cardDef(c).advancement_cost ?? 3;
            const points = cardDef(c).agenda_points ?? 1;
            return c.advancementCounters + 3 >= cost ? points : (0.5 * points * (c.advancementCounters + 3)) / cost;
          })
      );
    let best = { id: 'no', pull: here ? pull(here) : 0 };
    for (const o of prompt.options) if (o.id !== 'no' && pull(o.id) > best.pull) best = { id: o.id, pull: pull(o.id) };
    return { ...base, choice: { kind: 'effect_choice', optionId: best.id } };
  }

  // Méliès U: the secret side is the central the Runner is likeliest to run first (its share of runs), varied by turn so it can't be read
  if (side === 'corp' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '36036' && prompt.source.step === 'set') {
    return { ...base, choice: { kind: 'effect_choice', optionId: meliesSide(state) } };
  }

  // Caveat Emptor: the board score doesn't see next turn's clicks, so weigh them here: the 4 extra
  // credits are worth a 2-click swing to the Runner only when the Corp is nearly broke
  if (side === 'corp' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '36032' && prompt.source.step === 'mode') {
    return { ...base, choice: { kind: 'effect_choice', optionId: state.corp.credits < 4 ? 'ten' : 'six' } };
  }

  // Perfect Recall: reveal the agenda the Runner is after
  if (side === 'corp' && prompt.kind === 'effect_cards' && prompt.source.cardCode === '36035' && prompt.source.step === 'reveal') {
    const pick = corpPorts.perfectRecallTarget(state) ?? prompt.candidateIds[0];
    return { ...base, choice: { kind: 'effect_cards', cardInstanceIds: [pick] } };
  }

  // Peer Review: keep the best agenda hidden (the Runner already knows the other cards it might
  // hide); with no unknown agenda, the card the Corp most wants to keep. The board score can't
  // see hidden information, so trying each answer would not tell them apart.
  if (side === 'corp' && prompt.kind === 'effect_cards' && prompt.source.cardCode === PEER_REVIEW && prompt.source.step === 'hide') {
    const known = new Set(knownInHand(state, 'corp').map(e => e.id));
    const cards = prompt.candidateIds.map(id => state.corp.hq.find(c => c.instanceId === id)!).filter(Boolean);
    const unknown = cards.filter(c => !known.has(c.instanceId));
    const pool = unknown.length > 0 ? unknown : cards;
    const pick = [...pool].sort((a, b) => agendaFirst(state, b, synergy) - agendaFirst(state, a, synergy))[0]?.instanceId ?? prompt.candidateIds[0];
    return { ...base, choice: { kind: 'effect_cards', cardInstanceIds: [pick] } };
  }

  // IP Enforcement: simulating stops before the agenda leaves the score area, so the try-each
  // search only sees the tags it costs. Take back the most points, then the quickest to re-score.
  if (side === 'corp' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '35066' && prompt.source.step === 'agenda') {
    const worth = (id: string) => {
      const def = cardDef(state.runner.scoreArea.find(a => a.instanceId === id)!);
      return (def.agenda_points ?? 0) * 10 - (def.advancement_cost ?? 0);
    };
    const best = [...prompt.options].sort((a, b) => worth(b.id) - worth(a.id))[0];
    return { ...base, choice: { kind: 'effect_choice', optionId: best.id } };
  }

  // AU Co.: the power counters do nothing else, so 2 cards now beat 2 cards later. (Scored as an outcome
  // the cards drawn count for nothing: plan.blindDraws hides cards from R&D.)
  if (side === 'corp' && prompt.kind === 'effect_choice' && prompt.source.cardCode === '35046' && prompt.source.step === 'use') {
    return { ...base, choice: { kind: 'effect_choice', optionId: 'use' } };
  }

  // Deck-aware AI: PT Untaian's paid advancement goes where it does the most
  if (synergy && side === 'corp' && prompt.kind === 'effect_cards' && prompt.source.cardCode === '35047') {
    return { ...base, choice: { kind: 'effect_cards', cardInstanceIds: untaianPick(state, prompt.candidateIds) } };
  }

  // Shuffling the Corp's own Archives cards into R&D (Jeff, AI Coordinator 2026-11-15): the board score cannot tell which card
  // comes back, so none is scored; the ability is paid for, so up to max, agendas first (most points), then by keep
  if (side === 'corp' && prompt.kind === 'effect_cards' && shufflesArchivesIntoRD(state, prompt)) {
    const cards = prompt.candidateIds.map(id => findCardAnywhere(state, id)!).sort((a, b) => agendaFirst(state, b, synergy) - agendaFirst(state, a, synergy));
    return { ...base, choice: { kind: 'effect_cards', cardInstanceIds: cards.slice(0, prompt.max).map(c => c.instanceId) } };
  }

  // Two or more cards beyond the minimum (Spin Doctor's up to 2 tried every subset): build the answer one card at a time
  if (prompt.kind === 'effect_cards' && prompt.max - prompt.min >= 2 && prompt.candidateIds.length > 4) {
    return greedyCards(state, side, prompt, base, memory, synergy, at);
  }

  // Everything else: try each answer and keep the best outcome.
  const options = promptAnswers(state, side, synergy);
  let best: GameAction = options[0];
  let bestScore = -Infinity;
  const skip = bypassSkips(state, side, prompt, memory, synergy);
  const simulated = side === 'corp' ? runAfters.get(state) : undefined;
  for (const action of options) {
    const after = simulated?.get(JSON.stringify(action)) ?? simulate(state, action);
    if (!after) continue;
    const score = scoreAnswer(state, prompt, action, after, side, memory, synergy, at, s => {
      if (side === 'corp') s += freeRezSaving(state, after);
      if (skip && after.activeRun?.encounter?.iceId === skip.iceId) s -= skip.cost;
      return s;
    });
    if (score > bestScore || (score === bestScore && deckTie(state, action, best))) {
      bestScore = score;
      best = action;
    }
  }
  return best;
}

/**
 * F117 bar 7: a tie between two answers that each name a card of a deck (a search's candidates, listed in the deck's
 * order: a guess in a dealt view) goes to the one whose named codes sort first, not to the list's order. Answers naming
 * the same codes stay in the prompt's order (either is the same play); every other tie keeps the list's order, as today.
 */
function deckTie(state: GameState, action: GameAction, best: GameAction): boolean {
  const deck = new Set([...state.corp.rd, ...state.runner.stack].map(c => c.instanceId));
  const key = (a: GameAction) => {
    const ids = [...answerNames(undefined, a)];
    return ids.some(id => deck.has(id)) ? ids.map(id => findCardAnywhere(state, id)?.cardCode ?? id).sort().join(',') : null;
  };
  const [k, b] = [key(action), key(best)];
  return k !== null && b !== null && k < b;
}

/**
 * A "bypass this ice?" prompt (S-Dobrado, Alarm Clock, Malandragem, Curupira, Laser Pointer,
 * Physarum Entangler, Fransofia Ward; plan.bypass). The board score only sees what the bypass
 * costs (a click, a counter, the card trashed), so an answer that leaves the ice encountered
 * also pays what the encounter costs: its subroutines broken or resolved (rules 6.5.8b), or,
 * when it can't be got past, the run itself (scoreOutcome counts a run still going).
 */
function bypassSkips(state: GameState, side: SideCode, prompt: Prompt, memory?: RunnerMemory, synergy = false): { iceId: string; cost: number } | undefined {
  if (side !== 'runner' || !plan().bypass || prompt.kind !== 'effect_choice' || prompt.source.step !== 'bypass' || !state.activeRun) return undefined;
  const ice = encounteredIce(state);
  if (!ice) return undefined;
  const cost = iceCost(state, ice);
  const run = serverValue(state, state.activeRun.server, 0, memory, synergy && tuning.wary) * 0.8;
  return { iceId: ice.instanceId, cost: cost === BLOCK ? run : spendCost(state, cost) };
}

/**
 * Méliès U's secret side, picked in proportion to the share of runs each
 * central gets in self-play (PACE), from a hash of the game and turn: a
 * fixed pick would let a human read it.
 */
/**
 * Psi Game bid (rules 10.14): neither side may see the
 * other's bid, so the AI mixes. The Corp wants the bids to differ and the
 * Runner wants them to match; with both paying their bid, cheap bids come up
 * more often (0: 45%, 1: 35%, 2: 20%), spread by the game, turn and side so
 * a human can't read it, and never more than the side can pay.
 */
/** Liberation cards whose effects install a card from HQ or R&D (their install-where prompts). */
const LIB_INSTALLERS = ['34037', '34039', '34048', '34062', '34098', '34102', '34115', '34122', '34130'];

/** The remote among these options with the most ice and nothing in its root, for an agenda (undefined: none has ice). */
function safeAgendaRemote(state: GameState, options: string[]): string | undefined {
  return options
    .map(id => state.corp.servers[id])
    .filter(s => !!s && s.isRemote && s.root.length === 0 && s.ice.length > 0)
    .sort((a, b) => b.ice.length - a.ice.length)[0]?.id;
}

export function psiBid(state: GameState, side: SideCode, options: string[]): string {
  const weights: [string, number][] = (
    [['0', 0.45], ['1', 0.35], ['2', 0.2]] as [string, number][]
  ).filter(([id]) => options.includes(id));
  if (weights.length === 0) return options[0];
  const total = weights.reduce((n, [, w]) => n + w, 0);
  let h = 2166136261;
  for (const ch of `${state.id}:${state.turnNumber}:${side}:${state.log.length}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let roll = (((h >>> 0) % 10000) / 10000) * total;
  for (const [id, w] of weights) {
    if (roll < w) return id;
    roll -= w;
  }
  return weights[0][0];
}

export function meliesSide(state: GameState): 'hq' | 'rd' | 'archives' {
  const shares: ['hq' | 'rd' | 'archives', number][] = [['hq', PACE.hqShare], ['rd', PACE.rdShare], ['archives', PACE.archivesShare]];
  const total = shares.reduce((n, [, w]) => n + w, 0);
  let h = 2166136261;
  for (const ch of `${state.id}:${state.turnNumber}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let roll = ((h >>> 0) % 10000) / 10000 * total;
  for (const [id, w] of shares) {
    if (roll < w) return id;
    roll -= w;
  }
  return 'hq';
}

/**
 * PT Untaian: 1 credit for an advancement counter on an unrezzed card. An
 * agenda behind ice gets closer to scoring, a trap hits harder (Urtica
 * Cipher) or reads as an agenda; nothing worth it, or no spare credit: skip.
 */
export function untaianPick(state: GameState, candidateIds: string[]): string[] {
  if (state.corp.credits < 2) return [];
  let best: { id: string; value: number } | null = null;
  for (const server of Object.values(state.corp.servers)) {
    for (const card of [...server.root, ...server.ice]) {
      if (!candidateIds.includes(card.instanceId)) continue;
      const def = cardDef(card);
      // Model: what the counter adds on this card (Pharos and Syailendra use theirs; other ice, little)
      const value =
        def.type_code !== 'ice' ? placedCounterWorth(state, card) : card.cardCode === '30063' || card.cardCode === '35076' ? 0.5 : 0.3;
      if (!best || value > best.value) best = { id: card.instanceId, value };
    }
  }
  return best && best.value >= 1 ? [best.id] : [];
}

/**
 * An answer that opens the same card's next choice (AU Co.: which card to trash; Poétrï and
 * Synapse Global: which server) is judged after the AI answers that too, so the first step of a
 * good ability doesn't look like a loss on its own (plan.promptChains).
 * An identity's prompts follow any next prompt of the same instance, as before (following every card's chain made AI
 * games about 4x slower). F117 D3, the narrow test: any other card's prompt is followed when the next prompt is for the
 * same side, of the same source instance, and its source data names a card the answer named (`data.cardId`: Eminent
 * Domain's and Mutual Favor's install of the card they found, Muse's host step). Up to 3 follow-ups, each answered
 * inside the chain's work (ChainAt) and in a frame with the seen arrivals so far (`how`; null: the null slot, none
 * kept). The seen set is cut to the cards still in the hand at each step (the stale rule for the chain's own marks).
 * `stop`: why the chain ended (for the set-aside count): 'other' a prompt of another source or side waits (a cut),
 * 'none' no prompt, 'depth' the limit, 'one' one step (past the budget), 'end' the next prompt names no answered card.
 */
function followChain(
  prompt: Prompt,
  before: GameState,
  action: GameAction,
  after: GameState,
  side: SideCode,
  memory: RunnerMemory | undefined,
  synergy: boolean,
  at: ChainAt,
  how: ArrivalHow | null
): { board: GameState; seen: string[]; named: Set<string>; stop: 'other' | 'none' | 'depth' | 'one' | 'end' } {
  let seen = how ? seenArrivals(before, action, after, side, how) : [];
  // The cards the side's own answers named, the first and each followed step's (chanceBack: a departure no answer named is chance)
  const named = answerNames(prompt, action);
  const out = (board: GameState, stop: 'other' | 'none' | 'depth' | 'one' | 'end') => ({ board, seen, named, stop });
  if (at.work.oneStep) return out(after, 'one');
  const identity = 'source' in prompt && getCardDefinition(prompt.source.cardCode).type_code === 'identity';
  if (!('source' in prompt)) return out(after, 'end');
  let state = after;
  let last = action;
  for (let depth = 0; depth < 3; depth++) {
    const next = activePrompt(state);
    if (!next) return out(state, 'none');
    if (next.side !== side || !('source' in next) || next.source.instanceId !== prompt.source.instanceId) return out(state, 'other');
    if (!identity) {
      const id = next.source.data?.cardId;
      if (typeof id !== 'string' || !answerNames(undefined, last).has(id)) return out(state, 'end');
      if (chainStats.on) {
        bump(chainStats.widened, `${prompt.source.cardCode}:${next.source.step ?? ''}:${at.depth + depth + 1}`);
        if (at.depth === 0 && depth === 0 && side === 'runner' && !pricing().frozen && pricing().anchor?.root === before) chainStats.rootRunner++;
      }
    }
    const inner: ChainAt = { work: at.work, depth: at.depth + depth + 1 };
    const answer = withKnownCards(side, seen, () => answerPrompt(state, side, memory, synergy, inner));
    const resolved = simulate(state, answer);
    if (!resolved) return out(state, 'end');
    for (const id of answerNames(next, answer)) named.add(id);
    if (how) {
      const inHand = new Set(hand(resolved, side).map(c => c.instanceId));
      seen = [...new Set([...seen, ...seenArrivals(state, answer, resolved, side, { real: false, rootRd: how.rootRd })])].filter(id => inHand.has(id));
    }
    state = resolved;
    last = answer;
  }
  return out(state, 'depth');
}

/**
 * The run under way (Stage D item 1 follow-up 3, found-list row 13; followup3-run-answers/design-answer.md). A Corp
 * prompt answered during a run can decide whether the Runner gets in, and the outcome the fallback scores leaves the run
 * out (the Runner's branch has runRestWorth; the Corp's had no run term): Ballista's "trash 1 installed program or end
 * the run", Boto's and Anoetic Void's HQ trash, Shred's reveal, Lycian's subtypes and Lightning Laboratory's free rez
 * (the last two answered by per-card blocks that leave the run out the same way, ruling 8.1).
 * The hold owner says whether the Runner gets in after each answer (settledStand below: the 'thisRun' walk from where
 * the run stands, through the Corp's own choices still ahead), once per board it tells apart. When some answers let the
 * Runner in and some keep it out, each is priced: today's one-step score (scoreOutcome after followChain, and
 * freeRezSaving, as the fallback scores it; ruling 8.2) less what the access takes (runLoss, pools.ts) on the answers
 * that let it in. The best answers are returned (several on a tie: today's
 * answer among them wins). Null, and today's answer, when the run stakes nothing (runLoss 0: nothing to price), when the
 * walk cannot say for an answer, or when the answers do not separate.
 */
/** The one-step boards the run term simulated, by answer, for the fallback on the same state (the same simulate, not done twice). */
const runAfters = new WeakMap<GameState, Map<string, GameState>>();

function runAnswer(state: GameState, memory: RunnerMemory | undefined, synergy: boolean, at: ChainAt): GameAction[] | null {
  const prompt = activePrompt(state);
  const run = state.activeRun;
  if (!prompt || prompt.side !== 'corp' || prompt.kind === 'mulligan' || !run || state.winner) return null;
  const loss = corpPorts.runLoss(state);
  if (!(loss > 0)) return null;
  const options = promptAnswers(state, 'corp', synergy);
  if (options.length < 2) return null;
  if (runTermStats.on) runTermStats.asked++;
  const outs: { action: GameAction; after: GameState; key: string; verdict: () => 'in' | 'out' }[] = [];
  const afters = new Map<string, GameState>();
  runAfters.set(state, afters);
  for (const action of options) {
    const after = simulate(state, action);
    if (!after) continue;
    afters.set(JSON.stringify(action), after);
    const stand = settledStand(after, run.server, synergy);
    // Not known (past the cap, ruling 12): the rule is silent on this prompt and today's answer stands
    if (!stand || stand.key === NOT_KNOWN) return null;
    outs.push({ action, after, key: stand.key, verdict: stand.verdict as () => 'in' | 'out' });
  }
  // The walk is asked only of boards it tells apart (equal keys, equal verdicts)
  if (new Set(outs.map(o => o.key)).size < 2) return null;
  const verdicts = outs.map(o => o.verdict());
  if (!verdicts.includes('in') || !verdicts.includes('out')) return null;
  const priced = outs.map((o, k) => runPrice(state, prompt, o.action, o.after, memory, synergy, at) - (verdicts[k] === 'in' ? loss : 0));
  const best = Math.max(...priced);
  if (runTermStats.on) runTermStats.decided++;
  const picks = outs.filter((_, k) => priced[k] >= best - 1e-9);
  if (runTermStats.on && picks.some(o => verdicts[outs.indexOf(o)] === 'in')) runTermStats.inPick++;
  return picks.map(o => o.action);
}

/**
 * The Corp follow-ups a settle goes through (ruling 11.1): a bound on work, not a value. The recorded chains of run
 * choices are 1 to 2 deep (Boto's second subroutine, Shred's reveal after Ballista's end); 3 is one more. The chain
 * that reached the old cap of 8 is an install's prompts (Mycoweb's borrowed install in deal 2041: which ice, which
 * server, rez or not), which do not decide this run, and it cost single decisions up to 7.7x. Past it the verdict is
 * not known (ruling 12): a bound on work never decides a pick.
 */
const SETTLE_DEPTH = 3;
/** The settle's third verdict: the cap reached (ruling 12). Its key; no walk key is this string. */
const NOT_KNOWN = 'not known';
/** Where the run stands after an answer: "in", "out", or not known (the cap reached). */
export interface SettledStand {
  key: string;
  verdict(): 'in' | 'out' | typeof NOT_KNOWN;
}

/**
 * Where the run stands after an answer, by the walk's own model of the choices still ahead (ruling 10, option A; the
 * count models both sides so: the Runner takes its best line, the Corp's choices are the worst for the Runner):
 *  - a Corp prompt of the same run (Boto's second subroutine, Shred's reveal): the Corp chooses, so the stand is "out" if
 *    any legal answer leads to "out" (each answer simulated and stood again; an answer simulate refuses is no answer, and
 *    a prompt with none left is read as the board is). Its key is the set of its answers' keys;
 *  - a Runner prompt: the settle stops and the walk reads the board from there. Inside an encounter the subroutine being
 *    resolved is still ahead (runStands marks only the ones before it as resolved) and the walk prices the Runner's
 *    choice in it (the subroutines after it resolve too: the break window is over, 6.9.3c). A Runner prompt open while the
 *    ice's subroutines resolve is a subroutine's choice whatever card it names (a granted subroutine is the ice's own,
 *    9.8.3e; ruling 11.2); one open outside them (an ice's encounter ability, a trigger such as Botulus's break) the walk
 *    cannot read: runStands gives "in", the Runner's side (counted, `runnerOther`);
 *  - no prompt, or the run over or moved: the board as it is;
 *  - past the cap (counted, `capped`): not known (ruling 12). A Corp follow-up with an answer not known is not known
 *    (not "out" beside it: the Corp will not be deciding that follow-up by this rule), and its other answers are not
 *    walked; the run term does not decide a prompt with an answer not known, so today's answer stands there. Neither
 *    "in" nor the board as it is: at Mycoweb's rez step one answer ends the chain and another reaches the cap, so either
 *    reading would separate the answers by the chain's length, not by the board.
 * Known side (ruling 10.3, found row 48): where an answer of a follow-up keeps the Runner out, the stand is "out" even if
 * the Corp's priced pick at that follow-up would let it in; the first answer is then not charged runLoss (counted,
 * `inPick`, at the follow-up when the game reaches it).
 */
export function settledStand(board: GameState, server: string, synergy = false, depth = 0): SettledStand | null {
  const p = activePrompt(board);
  const run = board.activeRun;
  if (p && p.side === 'corp' && run && run.server === server && !board.winner) {
    if (depth >= SETTLE_DEPTH) {
      if (runTermStats.on) runTermStats.capped++;
      return { key: NOT_KNOWN, verdict: () => NOT_KNOWN };
    }
    const subs: SettledStand[] = [];
    for (const a of promptAnswers(board, 'corp', synergy)) {
      const next = simulate(board, a);
      if (!next) continue;
      const sub = settledStand(next, server, synergy, depth + 1);
      if (!sub || sub.key === NOT_KNOWN) return sub;
      subs.push(sub);
    }
    if (subs.length === 0) return corpPorts.runStands({ ...board, pendingPrompts: [] }, server);
    const key = JSON.stringify(['or', [...new Set(subs.map(x => x.key))].sort()]);
    return { key, verdict: () => (subs.some(x => x.verdict() === 'out') ? 'out' : 'in') };
  }
  const stand = corpPorts.runStands(board, server);
  if (runTermStats.on && p && p.side === 'runner' && run?.server === server && stand?.key === 'in' && !board.winner && !run.breached && !run.isSuccessful && run.phase !== 'access') {
    runTermStats.runnerOther++;
    const kind = `${'source' in p ? `${p.source.cardCode}:${p.source.step}` : p.kind} ${run.phase}`;
    runnerOtherKinds.set(kind, (runnerOtherKinds.get(kind) ?? 0) + 1);
  }
  return stand;
}

/**
 * An answer's price for the run term: today's score of its one-step board (the fallback's), less the ice's movement
 * when Runner programs left the rig (rigMove, the run term's correction). Shred's reveal ("reveals and
 * trashes X cards from HQ at random") is chance, never the simulated pick (ruling 3): the board with the trashed cards
 * still in HQ, less the expected loss of X random cards of the Corp's own hand by the hand's owner (ownHandValue, the
 * registry row "a card held in HQ"), every set of X cards alike.
 */
function runPrice(state: GameState, prompt: Prompt, action: GameAction, after: GameState, memory: RunnerMemory | undefined, synergy: boolean, at: ChainAt): number {
  const shredTrash = 'source' in prompt && prompt.source.step === SHRED_STEP && action.type === 'RESOLVE_PROMPT' && action.choice.kind === 'effect_choice' && action.choice.optionId === 'trash';
  if (!shredTrash) return scoreAnswer(state, prompt, action, after, 'corp', memory, synergy, at, (s, board) => s + freeRezSaving(state, after) - rigMove(state, board));
  const kept = new Set(after.corp.hq.map(c => c.instanceId));
  const gone = state.corp.hq.filter(c => !kept.has(c.instanceId));
  const ids = new Set(gone.map(c => c.instanceId));
  const archives = { ...after.corp.archives, faceUp: after.corp.archives.faceUp.filter(c => !ids.has(c.instanceId)), faceDown: after.corp.archives.faceDown.filter(c => !ids.has(c.instanceId)) };
  const board: GameState = { ...after, corp: { ...after.corp, hq: state.corp.hq, archives } };
  return scoreOutcome(state, board, 'corp', memory, synergy) + freeRezSaving(state, after) - hqChanceLoss(state, gone.length);
}

/**
 * The run term's correction (V-C item 1, Jeff 2026-11-19; registry V5 and V22, DEBT): a board on which Runner programs
 * are gone is priced by the rig's movement alone. A breaker is counted on both sides of `evaluate` (iceCost reads the rig
 * the rig's own value prices, and Ballista's "or end the run" price jumps with the last program), so a program trash
 * read the ice's rise as a Corp gain on top of the rig's fall. This takes the Corp-view board's movement back out: the
 * board less the same board with the gone programs back in the rig (the objects from `state`, which keep their host and
 * counters; a copy only priced). 0 when no program left. Every other reader of `evaluate` still counts the breaker twice;
 * this is deleted when the two terms have one owner (the guards in tests/runAnswers.test.ts fail then).
 */
function rigMove(state: GameState, board: GameState): number {
  const left = new Set(board.runner.rig.programs.map(p => p.instanceId));
  const gone = state.runner.rig.programs.filter(p => !left.has(p.instanceId));
  if (gone.length === 0) return 0;
  const back: GameState = { ...board, runner: { ...board.runner, rig: { ...board.runner.rig, programs: [...board.runner.rig.programs, ...gone] } } };
  return corpBoardValue(board, 'corp') - corpBoardValue(back, 'corp');
}

/** The expected loss of `x` cards of HQ at random, by ownHandValue: every set of x alike (up to 70 sets; past that, x times a single card's mean). */
function hqChanceLoss(state: GameState, x: number): number {
  const hq = state.corp.hq;
  if (x <= 0 || hq.length === 0) return 0;
  const full = ownHandValue(state, 'corp');
  const without = (ids: Set<string>) => full - ownHandValue({ ...state, corp: { ...state.corp, hq: hq.filter(c => !ids.has(c.instanceId)) } }, 'corp');
  const sets: string[][] = [];
  const pick = (from: number, chosen: string[]) => {
    if (sets.length > 70) return;
    if (chosen.length === x) {
      sets.push(chosen);
      return;
    }
    for (let i = from; i < hq.length; i++) pick(i + 1, [...chosen, hq[i].instanceId]);
  };
  pick(0, []);
  if (sets.length <= 70) return sets.reduce((n, ids) => n + without(new Set(ids)), 0) / sets.length;
  return (x * hq.reduce((n, c) => n + without(new Set([c.instanceId])), 0)) / hq.length;
}

/** A Corp "shuffle" (into R&D on every Corp card; Touch-ups' picks Runner cards) of Archives cards only; Descent with an HQ agenda is not one. */
export function shufflesArchivesIntoRD(state: GameState, prompt: Extract<Prompt, { kind: 'effect_cards' }>): boolean {
  const archived = new Set([...state.corp.archives.faceUp, ...state.corp.archives.faceDown].map(c => c.instanceId));
  return prompt.side === 'corp' && prompt.source.step === 'shuffle' && prompt.candidateIds.length > 0 && prompt.candidateIds.every(id => archived.has(id));
}

/** Adds the card that helps most until no card helps (and at least `min` are chosen). */
function greedyCards(
  state: GameState,
  side: SideCode,
  prompt: Extract<Prompt, { kind: 'effect_cards' }>,
  base: { type: 'RESOLVE_PROMPT'; player: SideCode; promptId: string },
  memory: RunnerMemory | undefined,
  synergy: boolean,
  at: ChainAt
): GameAction {
  const answer = (ids: string[]): GameAction => ({ ...base, choice: { kind: 'effect_cards', cardInstanceIds: ids } });
  const value = (ids: string[]) => {
    const a = answer(ids);
    const after = simulate(state, a);
    return after ? scoreAnswer(state, prompt, a, after, side, memory, synergy, at) : -Infinity;
  };
  let chosen: string[] = [];
  let current = prompt.min === 0 ? value([]) : -Infinity;
  while (chosen.length < prompt.max) {
    let bestId: string | null = null;
    let bestScore = -Infinity;
    for (const id of prompt.candidateIds) {
      if (chosen.includes(id)) continue;
      const score = value([...chosen, id]);
      if (score > bestScore || (score === bestScore && bestId !== null && deckTie(state, answer([...chosen, id]), answer([...chosen, bestId])))) {
        bestScore = score;
        bestId = id;
      }
    }
    if (!bestId || (chosen.length >= prompt.min && bestScore <= current)) break;
    chosen = [...chosen, bestId];
    current = bestScore;
  }
  return answer(chosen);
}

const PEER_REVIEW = '35055';
const SYNAPSE = '35058';

/**
 * plan.freeRez: an answer that rezzes ice ignoring all costs (Send a Message,
 * Unleash; rules 1.16.5c). Ice the Corp could pay for anyway would have cost
 * its rez: the free rez saves that much, where the board score only sees the
 * ice's worth go from "still to pay for" to rezzed. Ice it couldn't pay for
 * gains its whole worth on the board already. So the free rez goes to the ice
 * that saves the most.
 */
export function freeRezSaving(before: GameState, after: GameState): number {
  if (after.corp.credits < before.corp.credits) return 0;
  let saving = 0;
  for (const server of Object.values(before.corp.servers)) {
    for (const ice of server.ice) {
      if (ice.isRezzed) continue;
      const now = after.corp.servers[server.id]?.ice.find(c => c.instanceId === ice.instanceId);
      if (!now?.isRezzed) continue;
      const cost = rezCost(before, ice);
      if (before.corp.credits < cost) continue;
      saving += Math.max(0, cost - (iceWorth(after, now, 'corp') - iceWorth(before, ice, 'corp')));
    }
  }
  return saving;
}
