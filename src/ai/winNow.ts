import { CardInstance, GameAction, GameState, activePrompt, cardDef, executeAction, findCardAnywhere, getLegalActions, isLegalAction } from '../core';
import { TurnFlag, turnFlag } from '../core/engine/cardEffects';
import { certainHandCards } from '../core/engine/helpers';
import { plan } from './pricing';
import { tally } from './diagnostics';
import { noteSwallowed } from './stepCounts';
import { clicksGivenOf, dividendsOf, placesCountersOf } from './cards';
import { ownTurnDamage } from './effectValues';

/**
 * Win now (bug report #33, Jeff's Runner test game 1, 2026-11-09; plan.winNow): an exact search of the Corp's own turn for
 * a line that wins the game, played before any judgement.
 *
 * At 6-6 with Above the Law and Slash and Burn Agriculture in HQ and 18 credits, the Corp could install Above the Law,
 * use Slash and Burn ("[click], 1[credit], reveal and trash this agenda from HQ: place 2 advancement counters on 1
 * installed card that you can advance") on it, advance it once and score it: 8 points. Neither Normal nor Hard found it:
 * the planner plays each candidate on with the rule ranking, which never chains an HQ ability onto the agenda it just
 * installed, and Hard's look-ahead takes the rule ranking's top four.
 *
 * Rules: an agenda whose advancement counters reach its requirement may be scored, which is not an action and costs no
 * click (1.17.3a-c); a player with 7 or more points wins at the next checkpoint (1.17.2).
 *
 * The search: depth first over the Corp's legal actions that can bring an agenda to scoring this turn: score, advance an
 * agenda, install an agenda in a new remote, play an operation, use an ability, a click for a credit, and the answers
 * to the prompts these raise. A branch that changes R&D (a draw, a shuffle, a mill) is cut, so a line never depends on a
 * card the Corp can't see. The order tried (scores, advances, agenda installs, abilities of cards in HQ, operations,
 * other abilities, credit clicks last) finds the direct line first, so one-shot money (a Petty Cash from Archives) is
 * not spent on the way. Bounded by WIN_NOW.nodes; cheap when no win is possible (canStillWin bounds each position). Returns the first action of a winning line, or null.
 */
export const WIN_NOW = {
  /** Positions expanded at most per decision. */
  nodes: 4000,
  /** Actions in a line at most (a 4-click turn, the free scores and the prompt answers between them). */
  depth: 14,
};

/** Test-only (tests/winNowReach.test.ts, the soundness sweep): `uncut` switches canStillWin off, so every line is searched. */
export const winNowBound = { uncut: false };

const typeOf = (state: GameState, id: string | undefined) => {
  const card = id ? findCardAnywhere(state, id) : undefined;
  return card ? cardDef(card).type_code : undefined;
};

const WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
};
/** Advancement counters a card's text can place at most in one use (1 when it names none), 0 when it places none. */
const placesOf = new Map<string, number>();
function places(code: string, text: string, state: GameState): number {
  // A text that counts the board (Flood the Market) is a fact of the card entry, read on this board: never cached by code.
  // It can grow inside the search: steps() installs an agenda into an empty iced remote while such a card is usable
  // (row 26), and each such install adds one to every later use. The bound, re-derived for that (n: the fact now; k:
  // such installs before a use; F: uses, each a Double of 2 clicks): the budget counts every click as a counter and
  // adds n - 1 for each copy, so F uses are counted as F(n + 1); they place at most F(n + k). An install's click is
  // charged once, by the agenda's cost when that agenda is scored (an agenda in HQ costs a click more) or by the budget
  // where it places no counter (an install that only fills a root), so it pays for nothing else. With k = 1 the
  // Double's second click covers the one more counter (exactly tight: install, Flood the Market, score); with k >= 2 each
  // use can place k - 1 more than counted (two installs, then two copies: 2n + 4 against 2n + 2). So each copy adds
  // k - 1 more, k at most the empty iced remotes and at most the agendas in HQ (the search installs only agendas).
  // Limit: a no-click effect that fills a root.
  const fact = placesCountersOf(code);
  if (fact) return fact(state) + Math.max(0, icedInstalls(state) - 1);
  let n = placesOf.get(code);
  if (n === undefined) {
    const found = [...text.matchAll(/place (\d+|an?|one|two|three|four) advancement counters?/gi)].map(m => WORDS[m[1].toLowerCase()] ?? Number(m[1]));
    n = found.length ? Math.max(...found) : /advancement counter/i.test(text) ? 1 : 0;
    placesOf.set(code, n);
  }
  return n;
}
/** Agenda installs this turn can make into an empty iced remote (steps(), row 26): the fewer of those remotes and agendas in HQ. */
function icedInstalls(state: GameState): number {
  const empty = Object.values(state.corp.servers).filter(s => s.isRemote && s.root.length === 0 && s.ice.length > 0).length;
  return Math.min(empty, state.corp.hq.filter(c => cardDef(c).type_code === 'agenda').length);
}

/**
 * What can be used this turn: operations in HQ and cards with an ability from HQ, installed cards other than ice, and
 * cards with an ability from Archives (Petty Cash).
 */
function usableSources(state: GameState): CardInstance[] {
  const corp = state.corp;
  const usable = (zone: 'HQ' | 'Archives') => (card: CardInstance) =>
    (zone === 'HQ' && cardDef(card).type_code === 'operation') || new RegExp(`from ${zone}`, 'i').test(cardDef(card).stripped_text ?? '');
  const installed = Object.values(corp.servers).flatMap(s => s.root);
  return [...corp.hq.filter(usable('HQ')), ...installed.filter(c => cardDef(c).type_code !== 'ice'), ...[...corp.archives.faceUp, ...corp.archives.faceDown].filter(usable('Archives'))];
}

/**
 * Whether the Corp could still win the game this turn (no `need`: 7 points, or a kill, canStillKill), or score a set of
 * its agendas worth `need` points (score-now's question; a kill is not a score): an upper bound, so a line that
 * wins is never cut. Every click (with the clicks the Corp's cards can give) places one counter, and each card that can
 * place counters (an operation or ability in HQ, an installed non-ice card) adds what one use places beyond the click
 * it costs; an agenda in HQ takes a click to install. The cheapest set of agendas worth the points still needed must
 * fit (rule 1.17.3a: scored at its advancement requirement).
 */
function canStillWin(state: GameState, need?: number): boolean {
  if (winNowBound.uncut) return true;
  const corp = state.corp;
  const target = need ?? 7 - corp.score;
  if (target <= 0) return true;
  // A prompt of the Corp's own open (Seamless Launch's target): the card resolving has left HQ and what it places is
  // not on the board yet, so neither side of the count sees it. Not cut there: the bound stays an upper bound (stage 0b,
  // spec-stage0b.md; rules 1.17.2, 1.17.3a), and the line is judged again once the prompt is answered.
  if (activePrompt(state)?.side === 'corp') return true;
  const installed = Object.values(corp.servers).flatMap(s => s.root);
  const sources = usableSources(state);
  let budget = corp.clicks;
  const own = new Map<string, number>();
  for (const card of sources) {
    const text = cardDef(card).stripped_text ?? '';
    // Clicks from the card entry (step 2: the text match this replaced looked for "[click]", which the stripped text
    // spells "click", so it never counted Nanomanagement; +0.2 ± 0.5 at games=3, run 42862141885)
    const gives = clicksGivenOf(card.cardCode) + Math.max(0, places(card.cardCode, text, state) - 1);
    budget += gives;
    own.set(card.instanceId, gives);
  }
  const hq = new Set(corp.hq.map(c => c.instanceId));
  // An agenda scored can't also be spent as a source (Slash and Burn Agriculture trashes itself): its own share comes off
  const agendas = [...corp.hq, ...installed]
    .filter(c => cardDef(c).type_code === 'agenda')
    .map(c => ({
      card: c,
      points: cardDef(c).agenda_points ?? 0,
      cost: Math.max(0, (cardDef(c).advancement_cost ?? 0) - (c.advancementCounters ?? 0)) + (hq.has(c.instanceId) ? 1 : 0) + (own.get(c.instanceId) ?? 0),
    }));
  // Smallest total cost reaching the points needed (a handful of agendas: every subset); and the most points a set
  // that fits can score (the kill side's Neurospike)
  let best = Infinity;
  let most = 0;
  const n = Math.min(agendas.length, 12);
  for (let mask = 1; mask < 1 << n; mask++) {
    let points = 0;
    let cost = 0;
    for (let i = 0; i < n; i++)
      if (mask & (1 << i)) {
        points += agendas[i].points;
        cost += agendas[i].cost;
      }
    if (points >= target && cost < best) best = cost;
    if (cost <= budget && points > most) most = points;
  }
  if (best <= budget) return true;
  return need === undefined && canStillKill(state, sources, agendas, budget, most);
}

/**
 * The kill side of the win bound (found-list row 24, Jeff's game #56, turn 12: Measured Response flatlined a Runner on 2
 * cards while win-now answered null, since the bound counted agenda points only and cut the search before any move):
 * whether the damage the Corp's cards could still deal this turn is more than the Runner's grip. Rules 1.7.2b and
 * 10.4.4: the Runner is flatlined when it suffers more damage than it has cards in its grip (the grip's size is public);
 * the hits of one turn add up, since each trashes what it can (10.4.2), so their sum is what counts. An upper bound like
 * the points side: costs, play conditions and the Runner's choices (Measured Response's 8 credits) are the search's.
 *
 * A card's damage on the Corp's own turn is ownTurnDamage's (registry V20: the corpTurnDamage fact, else the text),
 * read at its most over the turn: the facts that read the board read it with the inputs the Corp's turn can raise at
 * their most, the Runner's tags (Orbital Superiority, Mindscaping: any number, the Corp's cards can give tags) and the
 * points scored this turn (Neurospike: those scored so far and the most the points side lets the rest of the turn
 * score). Every other own-turn damage fact is a number. Core damage is read as the owner reads it (See How They Run,
 * Salvo Testing when scored): it trashes a card like the rest (10.4.2b).
 *
 * Which cards: the usable sources the points side counts, each copy once (an operation is played once; every other
 * card in the sets with damage on the Corp's turn deals it once a turn at most: Angelique Garza Correa trashes itself,
 * Phật Gioan Baotixita's is the first score each turn, counted without asking whether the turn can score (an upper
 * bound; its fact reads its counters); a card that could deal it more often needs its uses counted
 * here), and the agendas the turn could still score (their cost within the budget), whose damage comes at the score
 * (Orbital Superiority, Fujii Asset Retrieval, See How They Run, Salvo Testing). tests/winNowReach.test.ts lists every
 * Corp card with own-turn damage, so a new one is checked against this. Not counted (limits): damage in the Runner's
 * runs (ice, access, Shackleton Grid: their facts are 0 on the Corp's turn), a scored agenda's damage on later scores
 * (Salvo Testing in the score area), and cards taken from the grip without damage (Touch-ups shuffles up to 2 into the
 * stack). Score-now does not read this side: it asks for a score.
 */
function canStillKill(state: GameState, sources: CardInstance[], agendas: { card: CardInstance; cost: number }[], budget: number, points: number): boolean {
  const most: GameState = {
    ...state,
    runner: { ...state.runner, tags: Infinity },
    turnFlags: { ...state.turnFlags, [TurnFlag.agendaPointsScored]: turnFlag(state, TurnFlag.agendaPointsScored) + points },
  };
  let damage = 0;
  for (const card of sources) if (cardDef(card).type_code !== 'agenda') damage += ownTurnDamage(most, card.cardCode);
  for (const { card, cost } of agendas) if (cost <= budget) damage += ownTurnDamage(most, card.cardCode);
  return damage > state.runner.grip.length;
}

/** Whether a usable card's count reads remotes with a root and ice (the placesCounters fact; row 26). */
const countsIced = (state: GameState): boolean => usableSources(state).some(c => !!placesCountersOf(c.cardCode));

/** The actions worth trying, most direct first (exported for tests/winNowReach.test.ts). */
export function steps(state: GameState): GameAction[] {
  const legal = getLegalActions(state, 'corp');
  if (activePrompt(state)) return legal;
  const keep = legal.filter(a => {
    const id = (a as { cardInstanceId?: string }).cardInstanceId;
    switch (a.type) {
      case 'SCORE_AGENDA':
      case 'PLAY_OPERATION_OR_EVENT':
      case 'USE_ABILITY':
      case 'GAIN_CREDIT':
        return true;
      case 'ADVANCE_CARD':
        return typeOf(state, id) === 'agenda';
      case 'INSTALL_CARD': {
        // A new remote: an agenda scored this turn needs no ice, and an existing remote's agenda or asset would be trashed
        if (typeOf(state, id) !== 'agenda') return false;
        const install = a as { asNewRemote?: boolean; targetServerId?: string };
        if (install.asNewRemote) return true;
        // Found-list row 26 (Jeff's game #42, turn 16): an existing remote with an empty root and ice is not like a new
        // one while a usable card counts remotes with a root and ice (the placesCounters fact, Flood the Market): the
        // install raises that count. Offered only then, so elsewhere the search is as small as before
        const server = install.targetServerId ? state.corp.servers[install.targetServerId] : undefined;
        return !!server?.isRemote && server.root.length === 0 && server.ice.length > 0 && countsIced(state);
      }
      default:
        return false;
    }
  });
  const inHq = new Set(state.corp.hq.map(c => c.instanceId));
  const rank = (a: GameAction): number => {
    const id = (a as { cardInstanceId?: string }).cardInstanceId ?? '';
    switch (a.type) {
      case 'SCORE_AGENDA':
        return 0;
      case 'ADVANCE_CARD':
        return 1;
      case 'INSTALL_CARD': {
        // The agenda nearest its requirement first
        const card = findCardAnywhere(state, id);
        return 2 + (card ? (cardDef(card).advancement_cost ?? 0) / 100 : 0);
      }
      case 'USE_ABILITY':
        return inHq.has(id) ? 3 : 5;
      case 'PLAY_OPERATION_OR_EVENT':
        return 4;
      default:
        return 6;
    }
  };
  // One agenda install per card into a new remote is enough (every new remote is alike), and one into an empty iced
  // remote (alike for the count, and no run is made this turn)
  const seen = new Set<string>();
  return keep
    .filter(a => {
      if (a.type !== 'INSTALL_CARD') return true;
      const k = `${(a as { cardInstanceId?: string }).cardInstanceId ?? ''}:${!!(a as { asNewRemote?: boolean }).asNewRemote}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => rank(a) - rank(b));
}

/**
 * A position as the search tells them apart. `runner`: the win search also tells the Runner's grip and tags apart, so a
 * line that dealt damage or gave a tag is not cut as seen when a line without it reached the same Corp board first
 * (Phật Gioan Baotixita's counters removed or not, which the key does not hold; row 24).
 */
function key(state: GameState, runner = false): string {
  const corp = state.corp;
  // While steps() can install into an empty iced remote (row 26), a card in an iced root is told apart from the same card
  // in a new remote; otherwise the key is as before
  const iced = countsIced(state);
  const roots = Object.values(corp.servers)
    .flatMap(s => s.root.map(c => `${c.cardCode}:${c.advancementCounters ?? 0}${iced && s.ice.length ? ':iced' : ''}`))
    .sort()
    .join(',');
  const prompt = activePrompt(state);
  return `${corp.clicks}|${corp.credits}|${corp.score}|${corp.hq
    .map(c => c.cardCode)
    .sort()
    .join(',')}|${roots}|${prompt ? prompt.id : ''}${runner ? `|${state.runner.grip.length}|${state.runner.tags}` : ''}`;
}

/**
 * The first action of a line that wins the game this turn for the Corp, or null. Only on the Corp's own turn, outside a
 * run, with plan.winNow on.
 */
export function winNowAction(state: GameState): GameAction | null {
  if (!plan().winNow || state.winner || state.activePlayer !== 'corp' || state.activeRun) return null;
  const prompt = activePrompt(state);
  if (prompt && prompt.side !== 'corp') return null;
  if (state.turnStep?.kind === 'corp_turn_start') return null;
  if (!canStillWin(state)) return null;
  const rd = state.corp.rd.map(c => c.instanceId).join();
  // Nothing hidden on the Runner's side either (the AI Coordinator's ruling, 2026-11-17 19:02Z; found-list row 27): a
  // kill counts only on a line that took no grip card the Corp has not seen other than by damage. Touch-ups reveals the
  // grip and shuffles cards of a type the Corp names into the stack; the search plays it in the real engine, so it
  // would name the type knowing the grip and count the kill on the smaller grip. Damage picks its cards at random and
  // only their number matters (rule 10.4.2), so a card gone to the heap is no leak. A win by points does not read the
  // grip, and score-now never does, so neither is cut: Touch-ups still places its counters on those lines.
  // B4a ruling 6: per code, no more grip cards than the Corp surely knows are there (certainHandCards; 10.2.2b, 1.12.3)
  const known = new Set(certainHandCards(state, 'runner').map(c => c.instanceId));
  const hidden = state.runner.grip.filter(c => !known.has(c.instanceId)).map(c => c.instanceId);
  const blind = (s: GameState) => hidden.every(id => s.runner.grip.some(c => c.instanceId === id) || s.runner.heap.some(c => c.instanceId === id));
  const seen = new Set<string>();
  let nodes = 0;
  const search = (s: GameState, depth: number): boolean => {
    if (s.winner === 'corp') return s.corp.score >= 7 || blind(s);
    if (s.winner || s.activePlayer !== 'corp' || s.activeRun || depth >= WIN_NOW.depth || nodes >= WIN_NOW.nodes) return false;
    if (!canStillWin(s)) return false;
    const k = key(s, true);
    if (seen.has(k)) return false;
    seen.add(k);
    for (const action of steps(s)) {
      nodes++;
      let next: GameState;
      try {
        next = executeAction(s, action);
      } catch (e) {
        noteSwallowed(e, 'winNow');
        continue;
      }
      // Nothing hidden is read: R&D as it was (no draw, shuffle or mill)
      if (next.corp.rd.map(c => c.instanceId).join() !== rd) continue;
      if (search(next, depth + 1)) return true;
      if (nodes >= WIN_NOW.nodes) return false;
    }
    return false;
  };
  for (const action of steps(state)) {
    nodes++;
    let next: GameState;
    try {
      next = executeAction(state, action);
    } catch (e) {
      noteSwallowed(e, 'winNow');
      continue;
    }
    if (next.corp.rd.map(c => c.instanceId).join() !== rd) continue;
    if (search(next, 1)) {
      return action;
    }
    if (nodes >= WIN_NOW.nodes) break;
  }
  return null;
}

/**
 * plan.scoreNow (Corp redesign, spec-counted-scoring.md C1; measured as stage 0b's I1 score-this-turn half, +2.9 ± 1.7):
 * the first action of the best line that scores an agenda this turn, or null. The same exact search as winNowAction
 * over the Corp's own turn (the same moves, the same cut of every line that changes R&D), with the target passed in:
 * a line succeeds when an agenda is scored (1.17.3a: once its advancement counters reach its requirement; 1.17.3c not
 * an action, no click), on the real state, so cards that read the Corp's score see it as it is.
 *
 * Which line, when several score: the most points scored this turn, then the most credits left at the last score (a
 * free or click-neutral money action the turn still affords before the score, Petty Cash first, makes the richer line),
 * then the fewest steps (no free ability used for nothing, Spin Doctor removed with no card to shuffle). The search
 * keeps going past a score for a second one and keeps the best line found within WIN_NOW.nodes. An agenda that can be
 * scored now is scored first: scoring costs nothing (1.17.3c), so it never takes a point from the rest of the turn,
 * and nothing played before it can be undone. Not a Dividends agenda already at its requirement: over-advancing it
 * is the Corp's choice (its excess counters become agenda counters), so that one is left to its judgement.
 */
export function scoreNowAction(state: GameState): GameAction | null {
  return plan().scoreNow ? scoreNowLine(state) : null;
}

/** A score this turn: the line's first action, and the points it scores. */
export interface ScoreLine {
  first: GameAction;
  points: number;
}

/** plan.scoreNow's line with its points (the agents' hook: corpAI.ts and search.ts decide), or null. */
export function scoreNowPlan(state: GameState): ScoreLine | null {
  return plan().scoreNow ? bestScoreLine(state, true) : null;
}

/** scoreNowAction's search whatever the switch (the stage 0 measurement scripts read it through countedScore.ts scoreThisTurn). */
export function scoreNowLine(state: GameState): GameAction | null {
  return bestScoreLine(state, true)?.first ?? null;
}

/**
 * Whether the Corp's own pick keeps the line's points this turn (the agents play their pick then, and the search's
 * line only when the pick would cost a score): the pick is the line's first action, or after it the same search still
 * reaches the points (with any the pick itself scored). A pick that changes R&D (a draw) is not followed: what it would
 * show is hidden. The pick's judgement keeps what the search's tie-break cannot see, such as installing Pharos before
 * Send a Message's "when you score" free rez.
 */
export function keepsScore(state: GameState, pick: GameAction, line: ScoreLine): boolean {
  if (JSON.stringify(pick) === JSON.stringify(line.first)) return true;
  if (!isLegalAction(state, pick)) return false;
  let next: GameState;
  try {
    next = executeAction(state, pick);
  } catch (e) {
    noteSwallowed(e, 'winNow');
    return false;
  }
  if (next.corp.rd.map(c => c.instanceId).join() !== state.corp.rd.map(c => c.instanceId).join()) return false;
  const scored = next.corp.scoreArea
    .filter(c => cardDef(c).type_code === 'agenda' && !state.corp.scoreArea.some(x => x.instanceId === c.instanceId))
    .reduce((n, c) => n + (cardDef(c).agenda_points ?? 0), 0);
  if (scored >= line.points) return true;
  if (next.activePlayer !== 'corp' || next.winner) return false;
  return scored + (bestScoreLine(next, false)?.points ?? 0) >= line.points;
}

function bestScoreLine(state: GameState, count: boolean): ScoreLine | null {
  if (state.winner || state.activePlayer !== 'corp' || state.activeRun) return null;
  const prompt = activePrompt(state);
  if (prompt && prompt.side !== 'corp') return null;
  if (state.turnStep?.kind === 'corp_turn_start') return null;
  if (!canStillWin(state, 1)) return null;
  if (count) tally('scoreNow', 'searches');
  const points = (a: GameAction) => {
    const id = (a as { cardInstanceId?: string }).cardInstanceId;
    const card = id ? findCardAnywhere(state, id) : undefined;
    return card ? (cardDef(card).agenda_points ?? 0) : 0;
  };
  // A Dividends agenda already at its requirement is the Corp's to over-advance (its excess counters become agenda
  // counters when scored): left to its judgement, here and in the search
  const dividends = new Set(
    getLegalActions(state, 'corp')
      .filter(a => a.type === 'SCORE_AGENDA')
      .map(a => (a as { cardInstanceId: string }).cardInstanceId)
      .filter(id => dividendsOf(findCardAnywhere(state, id)!.cardCode) > 0),
  );
  const scoreable = getLegalActions(state, 'corp').filter(a => a.type === 'SCORE_AGENDA' && !dividends.has((a as { cardInstanceId: string }).cardInstanceId));
  if (scoreable.length) {
    if (count) {
      tally('scoreNow', 'found');
      if (scoreable.length > 1) tally('scoreNow', 'choices');
    }
    return { first: scoreable.reduce((a, b) => (points(b) > points(a) ? b : a)), points: scoreable.reduce((n, a) => n + points(a), 0) };
  }
  const rd = state.corp.rd.map(c => c.instanceId).join();
  const scoredAt = (s: GameState) => s.corp.scoreArea.filter(c => cardDef(c).type_code === 'agenda' && !dividends.has(c.instanceId) && !state.corp.scoreArea.some(x => x.instanceId === c.instanceId));
  const best = { points: 0, credits: -Infinity, steps: Infinity, first: null as GameAction | null, agendas: new Set<string>() };
  const better = (now: number, credits: number, steps: number) =>
    now > best.points || (now === best.points && (credits > best.credits || (credits === best.credits && steps < best.steps)));
  const seen = new Set<string>();
  let nodes = 0;
  const search = (s: GameState, depth: number, first: GameAction, points: number) => {
    if (s.winner || s.activePlayer !== 'corp' || s.activeRun || depth >= WIN_NOW.depth || nodes >= WIN_NOW.nodes) return;
    // Only lines that can still match the best found go on (an upper bound, as for the win)
    if (!canStillWin(s, Math.max(1, best.points - points))) return;
    const k = key(s);
    if (seen.has(k)) return;
    seen.add(k);
    for (const action of steps(s)) {
      nodes++;
      let next: GameState;
      try {
        next = executeAction(s, action);
      } catch (e) {
        noteSwallowed(e, 'winNow');
        continue;
      }
      // Nothing hidden is read: R&D as it was (no draw, shuffle or mill)
      if (next.corp.rd.map(c => c.instanceId).join() !== rd) continue;
      const scored = scoredAt(next);
      const now = scored.reduce((sum, c) => sum + (cardDef(c).agenda_points ?? 0), 0);
      if (scored.length && now > points) {
        for (const c of scored) best.agendas.add(c.instanceId);
        if (better(now, next.corp.credits, depth + 1)) Object.assign(best, { points: now, credits: next.corp.credits, steps: depth + 1, first });
      }
      if (next.winner) continue;
      search(next, depth + 1, first, scored.length ? now : points);
      if (nodes >= WIN_NOW.nodes) return;
    }
  };
  for (const action of steps(state)) {
    nodes++;
    let next: GameState;
    try {
      next = executeAction(state, action);
    } catch (e) {
      noteSwallowed(e, 'winNow');
      continue;
    }
    if (next.corp.rd.map(c => c.instanceId).join() !== rd) continue;
    const scored = scoredAt(next);
    const now = scored.reduce((sum, c) => sum + (cardDef(c).agenda_points ?? 0), 0);
    if (scored.length) {
      for (const c of scored) best.agendas.add(c.instanceId);
      if (better(now, next.corp.credits, 1)) Object.assign(best, { points: now, credits: next.corp.credits, steps: 1, first: action });
    }
    if (!next.winner) search(next, 1, action, now);
    if (nodes >= WIN_NOW.nodes) break;
  }
  if (count) tally('scoreNow', 'nodes', nodes);
  if (!best.first) return null;
  if (count) {
    tally('scoreNow', 'found');
    if (best.agendas.size > 1) tally('scoreNow', 'choices');
  }
  return { first: best.first, points: best.points };
}
