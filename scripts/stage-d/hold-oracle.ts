/**
 * Stage D item 1 (brief rev 2, section 4.1): the engine oracle for "does this server keep the Runner out".
 *
 * For a state, a server and a rez set S, the Runner's turn is played IN THE ENGINE and searched:
 *  - 'runnerTurn': from the Corp's end of turn (its clicks left unused, so the board is the one the count reads), the
 *    Corp ends its turn and the Runner's turn begins (rules 5.6.3, 5.7.1: its turn-start abilities fire in the
 *    engine: Botulus, Tranquilizer, drip economy);
 *  - 'thisRun': from the run under way, at the Corp's rez window it holds now.
 * The Corp is forced to rez exactly the ice of S, each as it is approached (6.4.3, 6.9.2b), and nothing else; its
 * prompts take the answer worst for the Runner (ruling 6: an AND node), except a discard down to hand size, which
 * cannot change a run and takes the first answer.
 * The Runner's choices are an OR node over its legal actions, limited to public capability (10.2.2): gain a credit,
 * draw, remove a tag, use an installed card's ability, run the asked server, and inside the run every break, boost,
 * pay, bioroid click and prompt answer. Never an install or an event from the grip, never another server, never
 * jacking out (it cannot help the Runner get in on that run).
 *
 * The answer is the number of the asked servers (a list, run in order: one entry for a hold question, the same server
 * several times for `entries`, several servers for a run sequence) the Runner can breach in order (6.9.5: a run is
 * successful and the breach begins; counted when `activeRun.breached` turns true on the server asked next). The search
 * stops at its work cap (executeAction calls) and answers 'unknown'.
 *
 * The engine fires every card's own text, so the oracle shares none of the count's assumptions. Its limits: what the
 * engine does not model is not seen either, and the Runner's grip is never played (by the definition of the count).
 */
import { GameAction, GameState, actingSide, activePrompt, executeAction, getLegalActions, rezCostOf } from '../../src/core';
import { createHash } from 'node:crypto';

export interface OracleAsk {
  when: 'runnerTurn' | 'thisRun';
  /** The servers to breach, in order (a hold question: one). */
  targets: string[];
  /** The ice the Corp rezzes when approached (instance ids), on any of the targets. */
  rez: Set<string>;
  /** The Corp's credits for the search (default its credits now). */
  corpCredits?: number;
  /** The work cap in executeAction calls (default 40,000). */
  cap?: number;
  /**
   * Retries: the Runner may run a target again after a run on it failed (the turn's whole truth: a rez-time tag such
   * as Ping's is spent on the first run). Default off: one run per target, the count's own definition (5.5: `need` is
   * for one run; `entries` counts runs that each get in).
   */
  retries?: boolean;
}

export interface OracleAnswer {
  /** How many of the targets the Runner can breach in order; null when the search hit its cap. */
  reached: number | null;
  /** executeAction calls spent. */
  work: number;
  /** Why the board could not be asked at all. */
  skipped?: string;
  /** A runnerTurn question asked during the Runner's turn, a prompt or a turn transition: the board was moved to a Corp end of turn. */
  moved?: boolean;
}

class Capped extends Error {}

const RUNNER_ALLOWED = new Set<GameAction['type']>([
  'GAIN_CREDIT', 'DRAW_CARD', 'REMOVE_TAG', 'USE_ABILITY', 'INITIATE_RUN', 'CONTINUE_RUN', 'BREAK_SUBROUTINE', 'BOOST_BREAKER',
  'BIOROID_BREAK', 'RESOLVE_PROMPT', 'PASS',
]);

/** Move order: the most preparation first (earn, then run), so a line that gets in is found early. */
const ORDER: Partial<Record<GameAction['type'], number>> = { GAIN_CREDIT: 0, USE_ABILITY: 1, REMOVE_TAG: 2, INITIATE_RUN: 3, CONTINUE_RUN: 4, PASS: 4, RESOLVE_PROMPT: 5, BREAK_SUBROUTINE: 6, BIOROID_BREAK: 6, BOOST_BREAKER: 7, DRAW_CARD: 8 };

/** A transposition key: the whole state but its log (two paths to the same board are one node). */
function keyOf(s: GameState, k: number, seen: boolean): string {
  const rest: Partial<GameState> = { ...s };
  delete rest.log;
  // The grip and the stack by size only: the Runner never plays its grip here, so which cards it holds or draws is
  // not capability (an ability that spends a grip card spends one of a count), and two lines that differ only in which
  // card went are one node
  const runner = { ...s.runner, grip: s.runner.grip.length, stack: s.runner.stack.length };
  return createHash('sha1').update(JSON.stringify({ ...rest, runner })).update(`|${k}|${seen ? 1 : 0}`).digest('base64');
}

/** The board the oracle starts from, or why it cannot. */
export function oracleStart(state: GameState, ask: OracleAsk): { state: GameState; moved: boolean } | { skipped: string } {
  const s = structuredClone(state);
  let moved = false;
  if (ask.corpCredits !== undefined) {
    // The credits the Corp may spend on rezzes (the count's corpCredits); Infinity: enough for every unrezzed ice asked
    const all = ask.targets.flatMap(t => s.corp.servers[t]?.ice ?? []).filter(c => !c.isRezzed).reduce((n, c) => n + rezCostOf(s, c), 0);
    s.corp.credits = Number.isFinite(ask.corpCredits) ? Math.max(0, ask.corpCredits) : s.corp.credits + all;
  }
  if (ask.when === 'thisRun') {
    if (!s.activeRun) return { skipped: 'no run' };
    return { state: s, moved };
  }
  if (s.winner) return { skipped: 'game over' };
  // Asked during the Runner's turn, a Corp prompt or a turn transition (the count's own question: "the Runner's next
  // turn on the board as it is now"): the board is moved to a Corp end of turn first (no run, no prompt, no window);
  // the answer says so (`moved`)
  if (s.activePlayer !== 'corp' || s.activeRun || s.pendingPrompts.length || s.turnStep) {
    s.activeRun = null;
    s.pendingPrompts = [];
    s.turnStep = null;
    s.activePlayer = 'corp';
    s.phase = 'corp_turn';
    moved = true;
  }
  // The rest of the Corp's turn is not the count's business: its clicks go unused and it ends its turn (5.6.3)
  s.corp.clicks = 0;
  s.priority = null;
  let next: GameState;
  try {
    next = executeAction(s, { type: 'END_TURN', player: 'corp' });
  } catch (e) {
    return { skipped: `END_TURN: ${(e as Error).message}` };
  }
  return { state: next, moved };
}

/** Asks the oracle (see the file comment). */
export function oracle(state: GameState, ask: OracleAsk): OracleAnswer {
  const start = oracleStart(state, ask);
  if ('skipped' in start) return { reached: null, work: 0, skipped: start.skipped };
  const cap = ask.cap ?? 40_000;
  let work = 0;
  const memo = new Map<string, number>();
  const n = ask.targets.length;
  const turn = start.state.turnNumber;

  const apply = (s: GameState, a: GameAction): GameState | null => {
    if (++work > cap) throw new Capped();
    try {
      return executeAction(s, a);
    } catch {
      return null;
    }
  };

  // seen: the Runner's turn has begun ('runnerTurn'); k: targets breached so far
  const solve = (s: GameState, k: number, seen: boolean, depth: number): number => {
    if (k >= n) return n;
    if (s.winner) return k;
    if (depth > 400) throw new Capped();
    if (ask.when === 'thisRun' && !s.activeRun) return k;
    if (s.activePlayer === 'runner') seen = true;
    else if (seen && !s.activeRun) return k; // the Runner's turn is over
    if (s.turnNumber > turn + 2) return k;
    // One run per target: a run that ended without the breach spent its attempt
    if (!ask.retries && ask.when === 'runnerTurn' && seen && !s.activeRun && s.runsThisTurn.length > k) return k;
    const side = actingSide(s);
    if (!side) return k;
    const key = keyOf(s, k, seen);
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const step = (a: GameAction): number | null => {
      const t = apply(s, a);
      if (!t) return null;
      // The breach (6.9.5): the run reaches its Success Phase on the server asked next. A run with nothing to access
      // ends in the same action, so a run that ended successful counts too (runsThisTurn's flag, 6.9.5a)
      const run = s.activeRun;
      const before = !!run && run.server === ask.targets[k] && run.phase !== 'access' && !run.breached;
      const now = !!t.activeRun && (t.activeRun.phase === 'access' || t.activeRun.breached);
      const ended = !t.activeRun && !!t.runsThisTurn.at(-1)?.successful && t.runsThisTurn.length === s.runsThisTurn.length;
      const breachedNow = before && (now || ended);
      return solve(t, k + (breachedNow ? 1 : 0), seen, depth + 1);
    };
    let value: number;
    if (side === 'corp') value = corpNode(s, k, step);
    else value = runnerNode(s, k, step);
    memo.set(key, value);
    return value;
  };

  const corpNode = (s: GameState, k: number, step: (a: GameAction) => number | null): number => {
    const prompt = activePrompt(s);
    if (prompt && prompt.side === 'corp') {
      const answers = getLegalActions(s, 'corp');
      if (prompt.kind === 'discard') return step(answers[0]) ?? k;
      let worst = Infinity;
      for (const a of answers) {
        const v = step(a);
        if (v === null) continue;
        worst = Math.min(worst, v);
        if (worst <= k) break;
      }
      return worst === Infinity ? k : worst;
    }
    const legal = getLegalActions(s, 'corp');
    // The forced rez: the approached ice of S, while it is approached (6.4.3)
    const run = s.activeRun;
    const window = s.priority;
    if (run && window?.holder === 'corp' && window.step === 'approach_ice' && run.icePosition !== null) {
      const ice = s.corp.servers[run.server]?.ice[run.icePosition];
      if (ice && !ice.isRezzed && ask.rez.has(ice.instanceId)) {
        const rez = legal.find(a => a.type === 'REZ_CARD' && a.cardInstanceId === ice.instanceId);
        if (rez) {
          const v = step(rez);
          if (v !== null) return v;
        }
      }
    }
    const pass = legal.find(a => a.type === 'PASS') ?? legal.find(a => a.type === 'START_TURN') ?? legal.find(a => a.type === 'END_TURN');
    if (!pass) return k;
    return step(pass) ?? k;
  };

  const runnerNode = (s: GameState, k: number, step: (a: GameAction) => number | null): number => {
    const target = ask.targets[k];
    const legal = getLegalActions(s, 'runner').filter(a => {
      if (!RUNNER_ALLOWED.has(a.type)) return false;
      if (a.type === 'INITIATE_RUN') return a.targetServerId === target && (ask.retries || s.runsThisTurn.length === k);
      if (a.type === 'PASS') return !a.restOfRun;
      // An installed card's ability, not the identity's: Topan's and Arissana's install from the grip, which the count's
      // definition leaves out (found reading the baseline's unread disagreements, found-during-stage-d.md row 5)
      if (a.type === 'USE_ABILITY') return a.cardInstanceId !== s.runner.identity.instanceId;
      return true;
    });
    legal.sort((a, b) => (ORDER[a.type] ?? 9) - (ORDER[b.type] ?? 9));
    let best = k; // ending the turn (or the run) here
    for (const a of legal) {
      const v = step(a);
      if (v === null) continue;
      if (v > best) best = v;
      if (best >= n) break;
    }
    return best;
  };

  try {
    const reached = solve(start.state, 0, false, 0);
    return { reached, work, moved: start.moved };
  } catch (e) {
    if (e instanceof Capped) return { reached: null, work, moved: start.moved };
    throw e;
  }
}

/** One hold question: does the Runner get in through `server` with exactly `rez` rezzed? 'unknown' at the cap. */
export function oracleGetsIn(state: GameState, server: string, when: 'runnerTurn' | 'thisRun', rez: Iterable<string>, corpCredits?: number, cap?: number): { answer: 'getsIn' | 'holds' | 'unknown' | 'skipped'; work: number; skipped?: string } {
  const a = oracle(state, { when, targets: [server], rez: new Set(rez), corpCredits, cap });
  if (a.skipped) return { answer: 'skipped', work: 0, skipped: a.skipped };
  if (a.reached === null) return { answer: 'unknown', work: a.work };
  return { answer: a.reached >= 1 ? 'getsIn' : 'holds', work: a.work };
}
