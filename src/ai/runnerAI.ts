import { CardInstance, GameAction, GameState, activePrompt, cardDef, getCardScript, getLegalActions, isLegalAction } from '../core';
import { runnerInstallBlocker } from '../core/engine/actions/install';
import { encounteredIce, iceScript, iceSubroutines, isBioroid } from '../core/engine/ice';
import { availableCredits, counters } from '../core/engine/cardEffects';
import { Agent, FreeActionGuard, ScoredAction } from './agent';
import { digValue, evaluate, rigCoverage } from './evaluate';
import { answerPrompt, runEventOptions, simulate } from './prompts';
import type { HeuristicOptions } from './corpAI';
import { asSide, logNudge, nudge, tuning } from './synergy';
import { noteKnownHand } from './handValues';
import { PlanMemory, planTurn, plannerOn } from './turnPlanner';
import { BOTULUS, RunnerMemory, TRANQUILIZER, MANEGARM, bestBreakPlan, botulusBreaks, hostedTrojans, creditsAhead, iceCreditsAhead, iceCost, iceCreditNeed, needsBiggerHand, runScore, runShortfall, serverValue, spendCost, subroutineCost } from './runs';
import { RATES } from './valueModel';

const TROJANS = [BOTULUS, TRANQUILIZER];

/**
 * Rule-based Runner: builds economy, installs icebreakers for the ice
 * subtypes it can't break yet, and runs the server with the best expected
 * value for its cost. It only looks at public information when planning runs.
 */
export class HeuristicRunnerAI implements Agent {
  readonly side = 'runner' as const;
  private freeActions = new FreeActionGuard(['END_TURN', 'INITIATE_RUN']);
  private memory: RunnerMemory = new Map();
  private digForBreakers = false;
  /** A run worth making that the Runner can't afford yet (deck-aware AI: take money toward it). */
  private savingFor: string | null = null;
  readonly synergy: boolean;
  private debug: boolean;
  private planner: boolean;
  private planMemory: PlanMemory = { line: [] };

  constructor(options: HeuristicOptions = {}) {
    this.synergy = options.synergy ?? true;
    this.debug = options.debug ?? false;
    this.planner = options.planner ?? true;
  }

  chooseAction(state: GameState): GameAction {
    return asSide('runner', () => this.decide(state));
  }

  private decide(state: GameState): GameAction {
    noteKnownHand(state, 'runner');
    this.remember(state);
    if (activePrompt(state)) return answerPrompt(state, 'runner', this.memory, this.synergy);
    const legal = getLegalActions(state, 'runner');
    if (state.activeRun) return this.runAction(state, legal) ?? legal[0];
    return this.mainAction(state, legal);
  }

  /** After a successful run, the Runner has seen every card in that server's root. */
  private remember(state: GameState) {
    const run = state.activeRun;
    const breached = state.runsThisTurn.filter(r => r.successful).map(r => r.server);
    if (run?.isSuccessful) breached.push(run.server);
    for (const id of breached) {
      for (const card of state.corp.servers[id]?.root ?? []) this.memory.set(card.instanceId, card.cardCode);
    }
    // Cards it accessed that the Corp then installed during the breach (Poétrï)
    for (const server of Object.values(state.corp.servers)) {
      for (const card of server.root) if (card.runnerKnows) this.memory.set(card.instanceId, card.cardCode);
    }
  }

  private runAction(state: GameState, legal: GameAction[]): GameAction | undefined {
    const run = state.activeRun!;
    const find = (type: GameAction['type']) => legal.find(a => a.type === type);
    const server = state.corp.servers[run.server];

    if (run.phase === 'encounter_ice') return this.encounterAction(state, legal) ?? find('CONTINUE_RUN');

    if (run.phase === 'movement' && run.icePosition !== null && server) {
      // Jack out (only possible after passing ice) if the rezzed ice further in is more than we can pay for.
      const credits = availableCredits(state, 'runner');
      if (tuning.plan.runBudget) {
        if (creditsAhead(state) > credits && find('JACK_OUT')) return find('JACK_OUT');
      } else {
        const remaining = server.ice.slice(0, run.icePosition).filter(c => c.isRezzed);
        const cost = remaining.reduce((sum, ice) => sum + iceCost(state, ice), 0);
        if (cost > credits + 0.5 && find('JACK_OUT')) return find('JACK_OUT');
      }
    }
    return find('CONTINUE_RUN') ?? legal[0];
  }

  /** Break what is worth breaking on the encountered ice, cheapest breaker first. */
  private encounterAction(state: GameState, legal: GameAction[]): GameAction | undefined {
    const ice = encounteredIce(state);
    const encounter = state.activeRun?.encounter;
    if (!ice || !encounter || encounter.resolvingIndex !== null) return undefined;
    const subs = iceSubroutines(state, ice);
    const unbroken = subs.map((s, i) => ({ i, cost: subroutineCost(state, s.label) })).filter(s => !encounter.broken[s.i]);
    const mustBreak = unbroken.filter(s => s.cost >= 1);
    if (mustBreak.length === 0) return undefined;

    // Botulus: its counters only break this ice's subroutines, and cost nothing
    if (botulusBreaks(state, ice) > 0) {
      const botulus = hostedTrojans(state, ice, BOTULUS).find(c => counters(c, 'virus') > 0)!;
      const use = legal.find(a => a.type === 'USE_ABILITY' && a.cardInstanceId === botulus.instanceId);
      if (use) return use;
    }

    // Bioroids: spare clicks break the worst subroutines first, run-ending or not (each one costs the Runner at least a credit)
    if (tuning.plan.bioroidClicks && isBioroid(ice)) {
      const sorted = [...mustBreak].sort((a, b) => b.cost - a.cost);
      const worst = sorted[0];
      // Ansel 2.0: its clicks break up to 2 at once, so take the worst two together
      const own = iceScript(ice)?.clickBreak;
      const targets = own ? sorted.slice(0, own.max).map(s => s.i) : [worst.i];
      const click =
        (targets.length > 1 &&
          legal.find(a => a.type === 'BIOROID_BREAK' && a.subroutineIndices?.length === targets.length && targets.every(i => a.subroutineIndices!.includes(i)))) ||
        legal.find(a => a.type === 'BIOROID_BREAK' && !a.subroutineIndices && a.subroutineIndex === worst.i);
      // ...but not the 2 clicks a Manegarm Skunkworks needs when the credits can't cover it
      if (click && (worst.cost === Infinity || state.runner.clicks - (own?.clicks ?? 1) >= approachClickReserve(state))) return click;
    }

    // Runner (run budget): keep what the rezzed ice further in needs
    const ahead = tuning.plan.runBudget ? creditsAhead(state) : 0;
    const credits = availableCredits(state, 'runner') - ahead;
    const tank = mustBreak.reduce((sum, s) => sum + s.cost, 0);
    if (tuning.plan.runBudget && mustBreak.some(s => s.cost === Infinity)) {
      // Can't get through the whole way: paying here is wasted unless what fires before the run ends is worse
      const first = mustBreak.find(s => s.cost === Infinity)!;
      const before = mustBreak.filter(s => s.i < first.i).reduce((sum, s) => sum + s.cost, 0);
      if (credits < iceCreditNeed(state, ice, encounter.broken) && before < 2) return undefined;
    }
    const tryBreaking = (targets: typeof mustBreak): GameAction | undefined => {
      const plan = bestBreakPlan(state, ice, targets.length);
      if (!plan || plan.credits > credits) return undefined;
      const breakerId = plan.breaker.instanceId;
      if (plan.boostsNeeded > 0) {
        if (plan.boostByAbility) return legal.find(a => a.type === 'USE_ABILITY' && a.cardInstanceId === breakerId);
        return legal.find(a => a.type === 'BOOST_BREAKER' && a.breakerInstanceId === breakerId);
      }
      const wanted = new Set(targets.map(t => t.i));
      const breaks = legal.filter(
        (a): a is Extract<GameAction, { type: 'BREAK_SUBROUTINE' }> => a.type === 'BREAK_SUBROUTINE' && a.breakerInstanceId === breakerId
      );
      const fitting = breaks.filter(a => a.subroutineIndices.every(i => wanted.has(i)));
      const pool = fitting.length > 0 ? fitting : breaks;
      return pool.sort((a, b) => b.subroutineIndices.length - a.subroutineIndices.length)[0];
    };

    const plan = bestBreakPlan(state, ice, mustBreak.length);
    if (plan && plan.credits <= tank + 0.5) {
      const action = tryBreaking(mustBreak);
      if (action) return action;
    }
    // Can't afford everything: break just the subroutines that would end the run.
    const blocking = mustBreak.filter(s => s.cost === Infinity);
    if (blocking.length > 0) {
      const action = tryBreaking(blocking);
      if (action) return action;
      if (isBioroid(ice) || iceScript(ice)?.runnerBreakCost !== undefined) {
        // Bioroids: spend a click; N-Pot: pay credits
        const bioroid = legal.find(a => a.type === 'BIOROID_BREAK' && !a.subroutineIndices && a.subroutineIndex === blocking[0].i);
        if (bioroid) return bioroid;
      }
    }
    return undefined;
  }

  private mainAction(state: GameState, legal: GameAction[]): GameAction {
    const ranked = this.rankMainActions(state, legal);
    const planned = this.planner && plannerOn('runner') ? this.plan(state, ranked) : null;
    const chosen = planned ?? (ranked[0]?.score > -Infinity ? ranked[0].action : legal.find(a => a.type === 'END_TURN') ?? legal[0]);
    this.notePlayed(chosen);
    if (this.debug) logNudge(state, 'runner', chosen);
    return chosen;
  }

  /** Counts actions in a row that spent no click (loop guard). */
  notePlayed(action: GameAction) {
    this.freeActions.played(action);
  }

  /** The whole-turn planner's pick (plan.turnPlanner), its playouts by a fresh copy of this AI with what it has seen. */
  private plan(state: GameState, ranked: ScoredAction[]): GameAction | null {
    const rollout = new HeuristicRunnerAI({ synergy: this.synergy, planner: false });
    rollout.memory = new Map(this.memory);
    const options = { memory: this.memory, wary: this.synergy && tuning.wary, urgent: this.synergy && tuning.plan.urgency };
    return planTurn(
      state,
      'runner',
      ranked,
      { rank: s => rollout.rankMainActions(s), answer: s => rollout.chooseAction(s), runWorth: (s, id) => runScore(s, id, options), memory: this.planMemory },
      this.synergy,
    );
  }

  /** Main-phase actions, best first, with this AI's score for each (the search AI starts from these). */
  rankMainActions(state: GameState, legal = getLegalActions(state, 'runner')): ScoredAction[] {
    noteKnownHand(state, 'runner');
    this.freeActions.start(state, state.runner.clicks);
    const before = evaluate(state, 'runner', this.synergy);
    // Nowhere worth running and breakers missing: dig for them
    this.digForBreakers =
      rigCoverage(state.runner.rig.programs).covered.size < 3 &&
      !legal.some(a => a.type === 'INITIATE_RUN' && runScore(state, a.targetServerId, { memory: this.memory, wary: this.synergy && tuning.wary, urgent: this.synergy && tuning.plan.urgency }) > 0);
    this.savingFor = this.synergy && tuning.plan.saveUp ? saveUpTarget(state, this.memory) : null;
    return [...legal, ...makeRoomInstalls(state)]
      .map(action => {
        let score = this.scoreMain(state, action, before);
        // Deck-aware nudge: small, and only for moves the AI would consider anyway
        if (this.synergy && Number.isFinite(score) && action.type !== 'END_TURN') score += nudge(state, 'runner', action).bonus;
        return { action, score };
      })
      .sort((a, b) => b.score - a.score);
  }

  /** Cards seen so far (for the search AI's guesses about hidden cards). */
  knownCards(): RunnerMemory {
    return this.memory;
  }

  /** Lets the search AI record what the Runner has seen before it ranks actions. */
  observe(state: GameState) {
    this.remember(state);
  }

  private scoreMain(state: GameState, action: GameAction, before: number): number {
    switch (action.type) {
      case 'END_TURN':
        return -0.5;
      case 'INITIATE_RUN':
        return runScore(state, action.targetServerId, { memory: this.memory, wary: this.synergy && tuning.wary, urgent: this.synergy && tuning.plan.urgency });
      case 'REMOVE_TAG':
        return state.runner.rig.resources.length > 0 ? 1.2 : 0.3;
    }
    const after = simulate(state, action);
    if (!after) return -Infinity;
    const spendsClick = after.runner.clicks < state.runner.clicks;
    if (!spendsClick && this.freeActions.exhausted) return -Infinity;

    // Run events and run abilities (Jailbreak, Overclock, Conduit, Red Team)
    const prompt = activePrompt(after);
    const cardCode = 'cardInstanceId' in action ? state.runner.grip.concat(state.runner.rig.resources, state.runner.rig.programs).find(c => c.instanceId === action.cardInstanceId)?.cardCode : undefined;
    const paid = state.runner.credits - after.runner.credits;
    if (prompt?.kind === 'effect_choice' && prompt.side === 'runner' && prompt.options.every(o => after.corp.servers[o.id])) {
      const options = { ...runEventOptions(prompt.source.cardCode, state), memory: this.memory, wary: this.synergy && tuning.wary, urgent: this.synergy && tuning.plan.urgency };
      const best = Math.max(...prompt.options.map(o => runScore(state, o.id, options)));
      return best - spendCost(state, paid) + (prompt.source.cardCode === '30028' ? (tuning.plan.runModel ? RATES.drawnCard : tuning.plan.drawValue?.runner ? 1.3 : 0.5) : 0); // Jailbreak draws a card
    }
    if (!state.activeRun && after.activeRun) {
      return runScore(state, after.activeRun.server, { ...runEventOptions(cardCode ?? '', state), memory: this.memory, wary: this.synergy && tuning.wary, urgent: this.synergy && tuning.plan.urgency }) - spendCost(state, paid) + 0.3;
    }

    // Follow our own prompts (Lie Low, Scrounge, Madani) a few steps
    let resolved = after;
    for (let i = 0; i < 3 && activePrompt(resolved)?.side === 'runner'; i++) {
      const next = simulate(resolved, answerPrompt(resolved, 'runner', this.memory, this.synergy));
      if (!next) break;
      resolved = next;
    }
    let score = evaluate(resolved, 'runner', this.synergy) - before;
    if (action.type === 'DRAW_CARD' && needsBiggerHand(state, this.memory)) score += 1.5;
    if (action.type === 'DRAW_CARD' && this.digForBreakers && state.runner.stack.length > 5) score += 1.2;
    if (action.type === 'DRAW_CARD' && this.synergy && tuning.plan.dig?.runner && state.runner.grip.length < state.runner.handSizeLimit) score += digValue(state, 'runner');
    if (action.type === 'INSTALL_CARD' && action.hostInstanceId && cardCode && TROJANS.includes(cardCode)) {
      const host = Object.values(state.corp.servers).flatMap(s => s.ice).find(c => c.instanceId === action.hostInstanceId);
      score += host?.isRezzed ? (tuning.plan.trojans ? trojanHostValue(state, cardCode, host) : 1.5) : -3;
    }
    // Saving up for a run: money now beats spending it elsewhere
    if (this.savingFor) {
      const gained = resolved.runner.credits - state.runner.credits;
      if (gained > 0) score += 0.8;
      else if (gained < -1) score -= 0.4;
    }
    if (!spendsClick && score <= 0.3) return -Infinity; // free actions only when clearly good
    return score;
  }
}

/**
 * Worth of a trojan on this rezzed ice: more on ice that is costly to get
 * past. A second Botulus only speeds up counters the first is already
 * piling up there; a second Tranquilizer does nothing the first doesn't
 * (each derezzes at its own 3 counters).
 */
export function trojanHostValue(state: GameState, code: string, host: CardInstance): number {
  const value = 1 + 0.15 * Math.min(8, iceCost(state, host));
  const doubled = hostedTrojans(state, host, code).length;
  return code === TRANQUILIZER ? value - 3 * doubled : value - 1.5 * doubled;
}

/**
 * Programs only the memory limit keeps out: install them by trashing one
 * or two installed programs first (rules 8.5.6c). Scoring the position afterwards
 * decides whether the swap is worth it.
 */
export function makeRoomInstalls(state: GameState): GameAction[] {
  if (state.activeRun || state.activePlayer !== 'runner' || state.runner.clicks < 1) return [];
  const installs: GameAction[] = [];
  for (const card of state.runner.grip) {
    if (cardDef(card).type_code !== 'program' || getCardScript(card.cardCode)?.installsOnIce) continue;
    // Blocked now, but not with all the memory back: memory is the only thing in the way
    if (!runnerInstallBlocker(state, card) || runnerInstallBlocker(state, card, undefined, 0, Infinity)) continue;
    // One program if that is enough, else two
    const programs = state.runner.rig.programs.map(c => c.instanceId);
    const singles = programs.map(id => [id]);
    const pairs = programs.flatMap((a, i) => programs.slice(i + 1).map(b => [a, b]));
    for (const options of [singles, pairs]) {
      const legal = options
        .map((trashFirst): GameAction => ({ type: 'INSTALL_CARD', player: 'runner', cardInstanceId: card.instanceId, trashFirst }))
        .filter(action => isLegalAction(state, action));
      installs.push(...legal);
      if (legal.length > 0) break;
    }
  }
  return installs;
}

/**
 * The best server worth running (value 4+) that the Runner can't afford to
 * get into yet but could within about two turns of money, if any.
 */
function saveUpTarget(state: GameState, memory: RunnerMemory): string | null {
  let best: string | null = null;
  let bestValue = 4;
  for (const id of Object.keys(state.corp.servers)) {
    const short = runShortfall(state, id);
    if (short === null || short <= 0 || short > 7) continue;
    const value = serverValue(state, id, 0, memory, tuning.wary, tuning.plan.urgency);
    if (value >= bestValue) {
      best = id;
      bestValue = value;
    }
  }
  return best;
}

/**
 * Clicks to keep for a rezzed Manegarm Skunkworks on the server being run
 * (2 each), when the credits left after the rezzed ice further in can't pay
 * its 5 credits instead.
 */
export function approachClickReserve(state: GameState): number {
  const run = state.activeRun;
  const server = run ? state.corp.servers[run.server] : undefined;
  if (!server) return 0;
  const count = server.root.filter(c => c.isRezzed && c.cardCode === MANEGARM).length;
  if (count === 0) return 0;
  const spare = availableCredits(state, 'runner') - iceCreditsAhead(state);
  return spare >= 5 * count ? 0 : 2 * count;
}
