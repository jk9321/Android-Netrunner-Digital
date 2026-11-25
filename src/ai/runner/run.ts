import { GameAction, GameState } from '../../core';
import { encounteredIce, iceScript, iceSubroutines, isBioroid } from '../../core/engine/ice';
import { availableCredits, counters } from '../../core/engine/cardEffects';
import { MANEGARM, bestBreakPlan, botulusBreaks, creditsAhead, iceCreditNeed, iceCreditsAhead, planCost, subroutineCost, tankDamage } from '../runs';
import { CARDS } from '../cards';

/**
 * R-B B2 (runner-rework briefs/b2-run.md rev 1): the Runner's decision during a run, moved out of the agent
 * (runnerAI.ts) as it stood at beta 57b02d6, as free functions of (state, legal). runner/core.ts runnerDecide asks
 * runAction for every state with a run under way (else the first legal action). Moved, not rewritten: the bodies are the
 * agent's methods with the rename map of scripts/runner-rework/core-move-check.mjs applied, and that script checks it
 * (0 lines). Nothing here is read at load.
 *
 *   runAction             the encounter (encounterAction, else CONTINUE_RUN); after passing ice, jack out when the
 *                         rezzed ice further in needs more than the credits; else CONTINUE_RUN, else the first action.
 *   encounterAction       what to break on the encountered ice: Banner, the lethal subroutine, Botulus, a bioroid's
 *                         clicks, the full break or only what ends the run, N-Pot's credits.
 *   approachClickReserve  the clicks kept for a rezzed Manegarm Skunkworks.
 *
 * The scope rule (red team 2026-11-25 finding 9): the bodies read no field of the agent, but they read the side scope and
 * plan() through runs.ts (ownRun, the damage rules' draw-back input; the bypass readers). Every caller reaches them
 * inside asSide('runner') today: the agent's chooseAction, and the Hard Runner, which sends every run state to its base.
 * This file does not enter the scope itself, as the ranking does not.
 *
 * Their own hand-picked numbers (the must-break floor `cost >= 1`, the `before < 2` of the cannot-get-through test, the
 * tanking margin `+ 0.5`) are not named here, so that the move stays exact: each is a debt row in
 * docs/ai-priced-quantities.md, for the branches that replace them (branch S, O3, R-C1).
 */

export function runAction(state: GameState, legal: GameAction[]): GameAction | undefined {
  const run = state.activeRun!;
  const find = (type: GameAction['type']) => legal.find(a => a.type === type);
  const server = state.corp.servers[run.server];

  if (run.phase === 'encounter_ice') return encounterAction(state, legal) ?? find('CONTINUE_RUN');

  if (run.phase === 'movement' && run.icePosition !== null && server) {
    // Jack out (only possible after passing ice) if the rezzed ice further in is more than we can pay for.
    const credits = availableCredits(state, 'runner');
    if (creditsAhead(state) > credits && find('JACK_OUT')) return find('JACK_OUT');
  }
  return find('CONTINUE_RUN') ?? legal[0];
}

/** Break what is worth breaking on the encountered ice, cheapest breaker first. */
function encounterAction(state: GameState, legal: GameAction[]): GameAction | undefined {
  const ice = encounteredIce(state);
  const encounter = state.activeRun?.encounter;
  if (!ice || !encounter || encounter.resolvingIndex !== null) return undefined;
  const subs = iceSubroutines(state, ice);
  // Banner: once used, this encounter's subroutines can't end the run
  const unbroken = subs
    .map((s, i) => ({ i, label: s.label, cost: encounter.cannotEndRun && /^end the run\.?$/i.test(s.label.trim()) ? 0 : subroutineCost(state, s.label) }))
    .filter(s => !encounter.broken[s.i]);
  // Each subroutine's own price reads the grip as it stands; together they may be more damage than the grip (rules
  // 9.8.7b, 10.4.4: Empiricist's 1 net then 2 net on 2 cards). The one that would flatline must be broken, as one that ends the run
  const lethal = tankDamage(state, unbroken).lethal;
  for (const s of unbroken) if (s.i === lethal) s.cost = Infinity;
  const mustBreak = unbroken.filter(s => s.cost >= 1);
  if (mustBreak.length === 0) return undefined;

  // Botulus: its counters only break this ice's subroutines, and cost nothing
  if (botulusBreaks(state, ice) > 0) {
    // The hosted program whose entry's holdFacts.breaksHostSubroutine counter it holds (the walk reads the same field)
    const botulus = state.runner.rig.programs.find(c => {
      const breaks = c.hostedOnId === ice.instanceId ? CARDS[c.cardCode]?.holdFacts?.breaksHostSubroutine : undefined;
      return !!breaks && counters(c, breaks.counter) > 0;
    })!;
    const use = legal.find(a => a.type === 'USE_ABILITY' && a.cardInstanceId === botulus.instanceId);
    if (use) return use;
  }

  // Bioroids: spare clicks break the worst subroutines first, run-ending or not (each one costs the Runner at least a credit)
  if (isBioroid(ice)) {
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
  const ahead = creditsAhead(state);
  const credits = availableCredits(state, 'runner') - ahead;
  const tank = mustBreak.reduce((sum, s) => sum + s.cost, 0);
  if (mustBreak.some(s => s.cost === Infinity)) {
    // Can't get through the whole way: paying here is wasted unless what fires before the run ends is worse
    const first = mustBreak.find(s => s.cost === Infinity)!;
    const before = mustBreak.filter(s => s.i < first.i).reduce((sum, s) => sum + s.cost, 0);
    if (credits < iceCreditNeed(state, ice, encounter.broken) && before < 2) return undefined;
  }
  const tryBreaking = (targets: typeof mustBreak): GameAction | undefined => {
    const breakPlan = bestBreakPlan(state, ice, targets.length);
    if (!breakPlan || breakPlan.credits > credits) return undefined;
    const breakerId = breakPlan.breaker.instanceId;
    if (breakPlan.boostsNeeded > 0) {
      if (breakPlan.boostByAbility) return legal.find(a => a.type === 'USE_ABILITY' && a.cardInstanceId === breakerId);
      return legal.find(a => a.type === 'BOOST_BREAKER' && a.breakerInstanceId === breakerId);
    }
    // Lobisomem on barriers, Banner: the card's own ability
    if (breakPlan.breakByAbility) return legal.find(a => a.type === 'USE_ABILITY' && a.cardInstanceId === breakerId);
    const wanted = new Set(targets.map(t => t.i));
    const breaks = legal.filter(
      (a): a is Extract<GameAction, { type: 'BREAK_SUBROUTINE' }> => a.type === 'BREAK_SUBROUTINE' && a.breakerInstanceId === breakerId
    );
    const fitting = breaks.filter(a => a.subroutineIndices.every(i => wanted.has(i)));
    const pool = fitting.length > 0 ? fitting : breaks;
    return pool.sort((a, b) => b.subroutineIndices.length - a.subroutineIndices.length)[0];
  };

  const breakPlan = bestBreakPlan(state, ice, mustBreak.length);
  if (breakPlan && planCost(breakPlan) <= tank + 0.5) {
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
