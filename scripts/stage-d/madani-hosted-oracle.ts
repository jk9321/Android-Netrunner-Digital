/**
 * Stage D, Madani's hosted programs (count step), the AI Coordinator's ruling 2026-11-18 19:15Z: the engine oracle of
 * scripts/stage-d/hold-oracle.ts (copied unchanged but for one move rule, marked "madani-hosted extension") with the
 * installs over a full memory it could not play. Rule 8.5.6c: "When installing a program, the Runner may first trash any
 * number of programs already installed. They must do so if installing the new program would exceed their memory limit"
 * (also 3.9.3b). getLegalActions lists no prompt answer with trashFirst, so the plain oracle never installs a program
 * that does not fit, and the answer without it installs nothing (found: at Madani it spends the once-per-turn). Here, at
 * a Runner prompt whose source installs the chosen card (source.data.install), when the chosen program does not fit the
 * answer is replaced by one answer per minimal trashFirst set (installed programs, rule 8.5.6c's "programs already
 * installed", whose memory frees enough and of which none can be left out); the plain answer, which installs nothing,
 * is dropped. Every other move is the plain oracle's.
 *
 * The plain oracle's comment follows.
 */
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
 * pay, bioroid click and prompt answer. Never an install or an event from the grip, never another server, and no
 * jacking out unless `jackOut` (it cannot help the Runner get in on that run; with retries it can help the turn: the
 * outer ice rezzed and paid for on a run the Runner leaves, 6.1.5, 6.9.4c, before an inner toll it cannot meet).
 *
 * The answer is the number of the asked servers (a list, run in order: one entry for a hold question, the same server
 * several times for `entries`, several servers for a run sequence) the Runner can breach in order (6.9.5: a run is
 * successful and the breach begins; counted when `activeRun.breached` turns true on the server asked next). The search
 * stops at its work cap (executeAction calls) and answers 'unknown'.
 *
 * The engine fires every card's own text, so the oracle shares none of the count's assumptions. Its limits: what the
 * engine does not model is not seen either, and the Runner's grip is never played (by the definition of the count).
 */
import { GameAction, GameState, actingSide, activePrompt, executeAction, findCardAnywhere, getCardScript, getLegalActions, rezCostOf } from '../../src/core';
import { createHash } from 'node:crypto';
import { cardDef } from '../../src/core';
import { trashableFirst } from '../../src/core/engine/actions/install';
import { memoryLimit } from '../../src/core/engine/cardEffects';

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
  /**
   * Jacking out (6.1.5, 6.9.4c: after passing an ice the Runner may end the run): measured for the hold-retry brief
   * (section 2), behind this argument. Default off. It changes nothing without `retries` (a run left gets nothing in).
   */
  jackOut?: boolean;
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

/** An ability whose text installs or plays a card from the grip. */
function fromGrip(s: GameState, a: Extract<GameAction, { type: 'USE_ABILITY' }>): boolean {
  const card = findCardAnywhere(s, a.cardInstanceId);
  const label = card ? getCardScript(card.cardCode)?.abilities?.[a.abilityIndex]?.label ?? '' : '';
  return /\b(install|play)\b[^.]*\bfrom (?:your )?grip\b/i.test(label);
}

/** A card of the Runner's grip in `s` is installed or hosted in `t` (in the rig, or hosted on a rig card). */
function gripToTable(s: GameState, t: GameState): boolean {
  if (t.runner.grip.length >= s.runner.grip.length) return false;
  const grip = new Set(s.runner.grip.map(c => c.instanceId));
  const rig = [...t.runner.rig.programs, ...t.runner.rig.hardware, ...t.runner.rig.resources];
  return rig.some(c => grip.has(c.instanceId) || (c.hostedCards ?? []).some(h => grip.has(h.instanceId)));
}

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
  // The credits the Corp may spend on rezzes (the count's corpCredits); Infinity: enough for every ice asked that is
  // unrezzed when the Runner's turn begins (row 56 fault D, Stage D item 1 follow-up 4: counted after END_TURN, so an ice
  // a turn-end ability derezzes, Lycian's or Lightning Laboratory's, is paid for too; before, Vovô's board had $0 to rez)
  const unlimited = (t: GameState) => t.corp.credits + ask.targets.flatMap(x => t.corp.servers[x]?.ice ?? []).filter(c => !c.isRezzed).reduce((n, c) => n + rezCostOf(t, c), 0);
  const infinite = ask.corpCredits !== undefined && !Number.isFinite(ask.corpCredits);
  if (ask.corpCredits !== undefined && !infinite) s.corp.credits = Math.max(0, ask.corpCredits);
  if (ask.when === 'thisRun') {
    if (!s.activeRun) return { skipped: 'no run' };
    if (infinite) s.corp.credits = unlimited(s);
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
  if (infinite) next = { ...next, corp: { ...next.corp, credits: unlimited(next) } };
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
      // Row 56 fault E: no Runner action that moves a card from the grip onto the table, whatever its label (Madani's
      // "Host ... from your grip", Barry Wong's prompt on a rez): the count's capability is the rig at the turn's start
      if (side === 'runner' && gripToTable(s, t)) return null;
      // The breach (6.9.5): the run reaches its Success Phase on the server asked next. A run with nothing to access
      // ends in the same action, so a run that ended successful counts too (runsThisTurn's flag, 6.9.5a)
      const run = s.activeRun;
      const before = !!run && run.server === ask.targets[k] && run.phase !== 'access' && !run.breached;
      const now = !!t.activeRun && (t.activeRun.phase === 'access' || t.activeRun.breached);
      const ended = !t.activeRun && !!t.runsThisTurn.at(-1)?.successful && t.runsThisTurn.length === s.runsThisTurn.length;
      // Row 56 fault B: a breach under "cannot steal or trash for the rest of this run" (Ansel 1.0) reaches the server
      // (6.9.5b) but takes nothing the hold question is about: not getting in, as the count's walk has it
      const barred = !!(t.activeRun ?? run)?.cannotStealOrTrash;
      const breachedNow = before && (now || ended) && !barred;
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
      if (a.type === 'JACK_OUT') return !!ask.jackOut;
      if (!RUNNER_ALLOWED.has(a.type)) return false;
      if (a.type === 'INITIATE_RUN') return a.targetServerId === target && (ask.retries || s.runsThisTurn.length === k);
      if (a.type === 'PASS') return !a.restOfRun;
      // No ability that installs or plays a card from the grip, on any card (Topan's and Arissana's identities): the
      // count's capability is the rig installed at the turn's start (found reading the baseline's unread disagreements,
      // found-during-stage-d.md row 5; narrowed to these abilities by the AI Coordinator's ruling). Every other ability
      // stays in, an identity's too. The pool's 15 Runner identities, checked 2026-11-17: three have an ability, Topan
      // and Arissana (left out here) and Virtual Intelligence, P.I. ("Draw 1 card and remove 1 tag": kept, public
      // capability); René Arcemont, Zahya Sadeghi, Tāo Salonga, The Catalyst, Ryō Ōno, Barry Wong, MuslihaT, Dewi
      // Subrotoputri, Magdalene Keino-Chemutai, Hiram Svensson, Mercury and Sebastião Souza Pessoa have none
      if (a.type === 'USE_ABILITY') return !fromGrip(s, a);
      return true;
    });
    legal.splice(0, legal.length, ...legal.flatMap(a => overMemory(s, a)));
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
export function oracleGetsIn(state: GameState, server: string, when: 'runnerTurn' | 'thisRun', rez: Iterable<string>, corpCredits?: number, cap?: number, retries = false, jackOut = false): { answer: 'getsIn' | 'holds' | 'unknown' | 'skipped'; work: number; skipped?: string } {
  const a = oracle(state, { when, targets: [server], rez: new Set(rez), corpCredits, cap, retries, jackOut });
  if (a.skipped) return { answer: 'skipped', work: 0, skipped: a.skipped };
  if (a.reached === null) return { answer: 'unknown', work: a.work };
  return { answer: a.reached >= 1 ? 'getsIn' : 'holds', work: a.work };
}

// madani-hosted extension: a prompt answer that installs a program over the memory limit, one per minimal trashFirst set
const memOf = (c: { cardCode: string }) => (cardDef(c as never).type_code === 'program' ? cardDef(c as never).memory_cost || 0 : 0);
export const extensionStats = { replaced: 0, variants: 0 };
function overMemory(s: GameState, a: GameAction): GameAction[] {
  if (a.type !== 'RESOLVE_PROMPT') return [a];
  const prompt = activePrompt(s);
  const choice = a.choice as { kind: string; cardInstanceIds?: string[]; trashFirst?: string[] };
  if (!prompt || !prompt.source?.data?.install || choice.kind !== 'effect_cards' || choice.cardInstanceIds?.length !== 1 || choice.trashFirst) return [a];
  const card = findCardAnywhere(s, choice.cardInstanceIds[0]);
  if (!card || cardDef(card).type_code !== 'program') return [a];
  const excess = s.runner.memoryUnitsUsed + memOf(card) - memoryLimit(s);
  if (excess <= 0) return [a];
  const pool = trashableFirst(s, card, null).filter(c => memOf(c) > 0 && c.instanceId !== card.instanceId);
  const sets: string[][] = [];
  for (let mask = 1; mask < 1 << Math.min(pool.length, 10); mask++) {
    const pick = pool.filter((_, i) => mask & (1 << i));
    const freed = pick.reduce((n, c) => n + memOf(c), 0);
    if (freed < excess || pick.some(c => freed - memOf(c) >= excess)) continue;
    sets.push(pick.map(c => c.instanceId));
  }
  extensionStats.replaced++;
  extensionStats.variants += sets.length;
  return sets.map(ids => ({ ...a, choice: { ...choice, trashFirst: ids } }) as GameAction);
}
