import { CardInstance, GameAction, GameState, activePrompt, cardDef, executeAction, findCardAnywhere, getLegalActions } from '../core';
import { plan } from './pricing';

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

/** Diagnostics: searches made, searches that found a win, positions expanded. */
export const winNowStats = { searches: 0, wins: 0, nodes: 0 };

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
function places(code: string, text: string): number {
  let n = placesOf.get(code);
  if (n === undefined) {
    const found = [...text.matchAll(/place (\d+|an?|one|two|three|four) advancement counters?/gi)].map(m => WORDS[m[1].toLowerCase()] ?? Number(m[1]));
    n = found.length ? Math.max(...found) : /advancement counter/i.test(text) ? 1 : 0;
    placesOf.set(code, n);
  }
  return n;
}
/**
 * Clicks a card's text can give in one use beyond what the use costs ("gain [click][click]" on an operation: 2 gained, 1
 * spent playing it; Petty Cash's "[click]: play this from Archives ... gain [click]": none).
 */
function clicksOf(card: CardInstance, text: string): number {
  const gained = Math.max(0, ...[...text.matchAll(/gain ((?:\[click\])+)/gi)].map(m => m[1].length / 7));
  if (!gained) return 0;
  const spent = cardDef(card).type_code === 'operation' || /\[click\][^.]*:/i.test(text) ? 1 : 0;
  return Math.max(0, gained - spent);
}

/**
 * Whether some set of the Corp's agendas worth `need` points (by default the points still needed to win) could still be
 * scored this turn: an upper bound, so a line that
 * wins is never cut. Every click (with the clicks the Corp's cards can give) places one counter, and each card that can
 * place counters (an operation or ability in HQ, an installed non-ice card) adds what one use places beyond the click
 * it costs; an agenda in HQ takes a click to install. The cheapest set of agendas worth the points still needed must
 * fit (rule 1.17.3a: scored at its advancement requirement).
 */
function canStillWin(state: GameState, need = 7 - state.corp.score): boolean {
  const corp = state.corp;
  if (need <= 0) return true;
  // A prompt of the Corp's own open (Seamless Launch's target): the card resolving has left HQ and what it places is
  // not on the board yet, so neither side of the count sees it. Not cut there: the bound stays an upper bound (stage 0b,
  // spec-stage0b.md; rules 1.17.2, 1.17.3a), and the line is judged again once the prompt is answered.
  if (activePrompt(state)?.side === 'corp') return true;
  const installed = Object.values(corp.servers).flatMap(s => s.root);
  // What can be used this turn: operations in HQ and cards with an ability from HQ, installed cards other than ice, and
  // cards with an ability from Archives (Petty Cash)
  const usable = (zone: 'HQ' | 'Archives') => (card: CardInstance) =>
    (zone === 'HQ' && cardDef(card).type_code === 'operation') || new RegExp(`from ${zone}`, 'i').test(cardDef(card).stripped_text ?? '');
  const sources = [...corp.hq.filter(usable('HQ')), ...installed.filter(c => cardDef(c).type_code !== 'ice'), ...[...corp.archives.faceUp, ...corp.archives.faceDown].filter(usable('Archives'))];
  let budget = corp.clicks;
  const own = new Map<string, number>();
  for (const card of sources) {
    const text = cardDef(card).stripped_text ?? '';
    const gives = clicksOf(card, text) + Math.max(0, places(card.cardCode, text) - 1);
    budget += gives;
    own.set(card.instanceId, gives);
  }
  const hq = new Set(corp.hq.map(c => c.instanceId));
  // An agenda scored can't also be spent as a source (Slash and Burn Agriculture trashes itself): its own share comes off
  const agendas = [...corp.hq, ...installed]
    .filter(c => cardDef(c).type_code === 'agenda')
    .map(c => ({
      points: cardDef(c).agenda_points ?? 0,
      cost: Math.max(0, (cardDef(c).advancement_cost ?? 0) - (c.advancementCounters ?? 0)) + (hq.has(c.instanceId) ? 1 : 0) + (own.get(c.instanceId) ?? 0),
    }));
  // Smallest total cost reaching the points needed (a handful of agendas: every subset)
  let best = Infinity;
  const n = Math.min(agendas.length, 12);
  for (let mask = 1; mask < 1 << n; mask++) {
    let points = 0;
    let cost = 0;
    for (let i = 0; i < n; i++)
      if (mask & (1 << i)) {
        points += agendas[i].points;
        cost += agendas[i].cost;
      }
    if (points >= need && cost < best) best = cost;
  }
  return best <= budget;
}

/** The actions worth trying, most direct first. */
function steps(state: GameState): GameAction[] {
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
      case 'INSTALL_CARD':
        // A new remote: an agenda scored this turn needs no ice, and an existing remote's agenda or asset would be trashed
        return typeOf(state, id) === 'agenda' && !!(a as { asNewRemote?: boolean }).asNewRemote;
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
  // One agenda install per card is enough (every new remote is alike)
  const seen = new Set<string>();
  return keep
    .filter(a => {
      if (a.type !== 'INSTALL_CARD') return true;
      const id = (a as { cardInstanceId?: string }).cardInstanceId ?? '';
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) => rank(a) - rank(b));
}

/** A position as the search tells them apart. */
function key(state: GameState): string {
  const corp = state.corp;
  const roots = Object.values(corp.servers)
    .flatMap(s => s.root.map(c => `${c.cardCode}:${c.advancementCounters ?? 0}`))
    .sort()
    .join(',');
  const prompt = activePrompt(state);
  return `${corp.clicks}|${corp.credits}|${corp.score}|${corp.hq
    .map(c => c.cardCode)
    .sort()
    .join(',')}|${roots}|${prompt ? prompt.id : ''}`;
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
  winNowStats.searches++;
  const rd = state.corp.rd.map(c => c.instanceId).join();
  const seen = new Set<string>();
  let nodes = 0;
  const search = (s: GameState, depth: number): boolean => {
    if (s.winner === 'corp') return true;
    if (s.winner || s.activePlayer !== 'corp' || s.activeRun || depth >= WIN_NOW.depth || nodes >= WIN_NOW.nodes) return false;
    if (!canStillWin(s)) return false;
    const k = key(s);
    if (seen.has(k)) return false;
    seen.add(k);
    for (const action of steps(s)) {
      nodes++;
      let next: GameState;
      try {
        next = executeAction(s, action);
      } catch {
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
    } catch {
      continue;
    }
    if (next.corp.rd.map(c => c.instanceId).join() !== rd) continue;
    if (search(next, 1)) {
      winNowStats.wins++;
      winNowStats.nodes += nodes;
      return action;
    }
    if (nodes >= WIN_NOW.nodes) break;
  }
  winNowStats.nodes += nodes;
  return null;
}

/** Diagnostics for plan.scoreNow: searches, those that found a score, those where more than one agenda could be scored. */
export const scoreNowStats = { searches: 0, found: 0, choices: 0, nodes: 0 };

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
  if (!plan().scoreNow || state.winner || state.activePlayer !== 'corp' || state.activeRun) return null;
  const prompt = activePrompt(state);
  if (prompt && prompt.side !== 'corp') return null;
  if (state.turnStep?.kind === 'corp_turn_start') return null;
  if (!canStillWin(state, 1)) return null;
  scoreNowStats.searches++;
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
      .filter(id => /\bDividends\b/.test(cardDef(findCardAnywhere(state, id)!).stripped_text ?? '')),
  );
  const scoreable = getLegalActions(state, 'corp').filter(a => a.type === 'SCORE_AGENDA' && !dividends.has((a as { cardInstanceId: string }).cardInstanceId));
  if (scoreable.length) {
    scoreNowStats.found++;
    if (scoreable.length > 1) scoreNowStats.choices++;
    return scoreable.reduce((a, b) => (points(b) > points(a) ? b : a));
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
      } catch {
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
    } catch {
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
  scoreNowStats.nodes += nodes;
  if (!best.first) return null;
  scoreNowStats.found++;
  if (best.agendas.size > 1) scoreNowStats.choices++;
  return best.first;
}
