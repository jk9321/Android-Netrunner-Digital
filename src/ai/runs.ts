import { CardInstance, GameState, cardDef, getCardDefinition, getCardScript, knownInHand, knownInRd } from '../core';
import {
  boostCostOf,
  breakerScript,
  breakerStrength,
  canBreakSubroutinesWith,
  iceScript,
  iceStrength,
  iceSubroutines,
  iceSubtypes,
  installedIcebreakers,
  isBioroid,
} from '../core/engine/ice';
import { availableCredits, counters, rezCost, stealthCredits, threatLevel, turnFlag } from '../core/engine/cardEffects';
import { stealCost } from '../core/engine/actions/run';
import { spikeKey } from '../core/scripts/liberationRunner';
import { corpCardValue, hiddenCardOdds, tagsWorth } from './evaluate';
import { agendaOdds, coreDamageWorth, counterWorthOf, damageWorth, flatlineOdds, runnerEffect } from './effectValues';
import { clickPrice } from './handValues';
import { clickRate, creditNeed, creditSlide, flatlineWorth, payoutSlide, pointValue } from './valueModel';
import { plan } from './pricing';
import { CARDS } from './cards';
import type { Subroutine } from '../core/scripts/types';

/**
 * What the Runner AI knows about runs. It only reads public information:
 * rezzed ice, rezzed cards and advancement counters. Unrezzed ice and
 * unrezzed root cards are guesses.
 */

export const BLOCK = Infinity;

/**
 * The subroutines the Runner plans a run against: the ones the ice has now, plus any it would gain when the
 * encounter begins by the state now (CardAI gainsOnEncounter: Starlit Knight's X "End the run." at threat 4,
 * rules 9.8.3e after its other subroutines). The engine adds those only once the encounter starts, so without
 * this the Runner chose the run and its price against the printed subroutines alone.
 */
export function plannedSubroutines(state: GameState, ice: CardInstance): Subroutine[] {
  const subs = iceSubroutines(state, ice);
  if (!ice.isRezzed) return subs;
  const gains = CARDS[ice.cardCode]?.gainsOnEncounter?.(state, ice) ?? [];
  return gains.length ? [...subs, ...gains] : subs;
}
const MAYFLY = '30032';
const BANGUN = '35068';
const HANTU = '35008'; // boosts by spending hosted virus counters (+2 each), not credits
export const BOTULUS = '30004';
export const TRANQUILIZER = '30017';

/** The Runner's trojans of one kind (Botulus, Tranquilizer) hosted on this ice. */
export function hostedTrojans(state: GameState, ice: CardInstance, code: string): CardInstance[] {
  return state.runner.rig.programs.filter(c => c.cardCode === code && c.hostedOnId === ice.instanceId);
}

/** Subroutines Botulus breaks on this ice for free: the virus counters on the Botulus programs it hosts. */
export function botulusBreaks(state: GameState, ice: CardInstance): number {
  return hostedTrojans(state, ice, BOTULUS).reduce((n, c) => n + counters(c, 'virus'), 0);
}

/** Credits-equivalent cost of letting one subroutine resolve (Infinity: it ends the run). */
export function subroutineCost(state: GameState, label: string): number {
  return knownSubroutineCost(state, label) ?? 2;
}

/** A rule's answer that passes to the next rule (the trash-a-type rule with no card of that type). */
const NEXT = Symbol('next');
type SubRule = [RegExp, (state: GameState, m: RegExpMatchArray) => number | undefined | typeof NEXT];

/**
 * knownSubroutineCost's patterns, in order: the first that matches the label (and doesn't pass) prices it. Which
 * patterns match depends on the label alone, so it is worked out once per label (planner speed 2026-11-12: the
 * regex chain was ~4% of the Corp's decision time); the prices still read the board each time.
 */
const SUB_RULES: SubRule[] = [
  [/cannot steal or trash/i, () => BLOCK],
  // Mycoweb: as bad as the worst subroutine on a rezzed ice of that type
  [/resolve 1 subroutine on (?:a|another) rezzed (barrier|code gate|sentry)/i, (state, borrowed) => {
    const type = borrowed[1].toLowerCase();
    const costs = Object.values(state.corp.servers)
      .flatMap(server => server.ice)
      .filter(ice => ice.isRezzed && iceSubtypes(ice, state).some(t => t === type))
      .flatMap(ice => (iceSubroutines(state, ice)).filter(sub => !/resolve 1 subroutine on/i.test(sub.label)))
      .map(sub => subroutineCost(state, sub.label));
    return costs.length > 0 ? Math.max(...costs) : 0;
  }],
  // Elevation conditions
  [/end the run unless the runner suffers (\d+) net damage/i, (state, unless) => (Number(unless[1]) >= state.runner.grip.length ? BLOCK : 2 * Number(unless[1]))],
  [/threat level is (\d+) or greater, end the run/i, (state, threat) => (Math.max(state.corp.score, state.runner.score) >= Number(threat[1]) ? BLOCK : 0)],
  [/end the run if the runner is tagged/i, state => (state.runner.tags > 0 ? BLOCK : 1)],
  [/if the runner has at least 2 tags/i, state => (state.runner.tags >= 2 ? (2 >= state.runner.grip.length ? BLOCK : 4) : 0)],
  // Vantage Point: "... unless the Runner pays N credits": the cheaper of paying and letting the rest resolve
  [/^(.*?)\s*unless the runner pays (\d+) (?:\[credit\]|credits?)\.?$/i, (state, pays) => {
    const n = Number(pays[2]);
    const rest = /^end the run$/i.test(pays[1]) ? BLOCK : knownSubroutineCost(state, pays[1]) ?? 2;
    return state.runner.credits >= n ? Math.min(creditCost(state, n), rest) : rest;
  }],
  [/^(.*?)\s*unless the runner jacks out\.?$/i, (state, jacks) => knownSubroutineCost(state, jacks[1])],
  [/do x net damage and give the runner x tags/i, state => {
    // Vicsek: X is the Runner's tags
    const x = state.runner.tags;
    if (x === 0) return 0;
    return x >= state.runner.grip.length ? BLOCK : damageWorth(state, x) + tagCost(state) * x;
  }],
  [/loses? \[click\]/i, () => clickRate()],
  [/gets \+1 strength for the remainder of this run/i, () => 1.5], // ezaM: every ice after it costs more to break
  [/each piece of ice gets \+2 strength for the remainder of this run/i, () => 2.5], // Tributary: every ice costs more to break
  [/installed runner card to the grip/i, state => 0.5 * trashedCardCost(state) + 1], // Lethe: a reinstall, not a loss
  [/remove 1 card in the heap from the game/i, () => 0.3],
  [/place 1 virus counter on this ice/i, () => 0], // Knowledge Seeker: counts down to its own derez
  [/look at the top \d+ cards? of r&d|arrange|to the (?:top or )?bottom of r&d|shuffle 1 card from hq or archives into r&d/i, () => 0.4], // Corp card selection
  [/core damage/i, state => coreDamageWorth(state) + damageWorth(state, 1)],
  [/unless they pay 3 credits/i, state => creditCost(state, 3)],
  [/loses? (\d+) (?:\[credit\]|credits?)/i, (state, loses) => creditCost(state, Math.min(Number(loses[1]), state.runner.credits))],
  [/or end the run/i, state => (state.runner.rig.programs.length > 0 ? 5 : BLOCK)],
  [/odd cost/i, state => (state.runner.grip.length <= 1 ? BLOCK : 4)], // Diviner: half the time it ends the run
  [/6 credits or less/i, state => (state.runner.credits - 3 <= 6 ? BLOCK : 0)],
  // Liberation conditions
  [/end the run if you have more credits than the runner/i, state => (state.corp.credits > state.runner.credits ? BLOCK : 1)], // Valentão
  [/end the run if there are more cards in hq than in the grip/i, state => (state.corp.hq.length > state.runner.grip.length ? BLOCK : 0)], // Piranhas
  [/trash 1 card from hq to end the run/i, state => (state.corp.hq.length > 0 ? BLOCK : 0)], // Boto
  [/end the run/i, () => BLOCK],
  [/(\d+) (net|meat) damage/i, (state, damage) => {
    const n = Number(damage[1]);
    return n >= state.runner.grip.length ? BLOCK : damageWorth(state, n);
  }],
  [/gain 1 \[credit\] for each tag/i, state => 0.3 * state.runner.tags], // Capacitor: Corp credits
  [/tag/i, state => tagCost(state)],
  [/trash 1 installed runner card/i, state => trashedCardCost(state)],
  [/gain 1 credit/i, () => 0.3],
  [/gain 1 \[credit\]/i, () => 0.8], // Flywheel: a credit and maybe a card
  [/^gain (\d+) \[credit\]/i, (_state, gains) => 0.4 * Number(gains[1])], // Valentão: Corp credits
  // Sorocaban Blade, Hammer, Lycian: a rig card lost, when there is one of that type (with none, the old flat 1.5 below)
  [/trash 1 installed (resource|piece of hardware|program)/i, (state, trashType) => {
    const rig = state.runner.rig;
    const zone = { resource: rig.resources, 'piece of hardware': rig.hardware, program: rig.programs }[trashType[1].toLowerCase() as 'resource'];
    return zone.length > 0 ? trashedCardCost(state) : NEXT;
  }],
  [/^(?:you may )?draw 1 card/i, () => 0.5], // Empiricist: helps the Corp a little
  [/install/i, () => 1.5],
];

/** The rules whose pattern matches each label seen, in order, with their matches. */
const labelRules = new Map<string, [SubRule[1], RegExpMatchArray][]>();

/**
 * The cost of a subroutine whose wording one of the patterns above
 * recognises, or undefined for wording none of them knows (counted as 2).
 * A test checks every subroutine in the card pool is recognised.
 */
export function knownSubroutineCost(state: GameState, label: string): number | undefined {
  let rules = labelRules.get(label);
  if (!rules) {
    rules = [];
    for (const [re, price] of SUB_RULES) {
      const m = label.match(re);
      if (m) rules.push([price, m]);
    }
    labelRules.set(label, rules);
  }
  for (const [price, m] of rules) {
    const cost = price(state, m);
    if (cost !== NEXT) return cost;
  }
  return undefined;
}

/**
 * Worth to the Runner of spending `credits` now, on the credit slide its
 * board score uses.
 */
export function creditCost(state: GameState, credits: number): number {
  if (credits <= 0) return 0;
  const have = state.runner.credits;
  const need = creditNeed(state, 'runner');
  return creditSlide(have, need) - creditSlide(have - credits, need);
}

/** Credits spent on a run, in runScore's units (the credit slide). */
export const spendCost = (state: GameState, credits: number): number => creditCost(state, credits);

/** A click spent on a run, in runScore's units. */
export const runClick = (state?: GameState): number => (state ? clickPrice(state, 'runner', 'runner') : clickRate());

/** A tag taken (Jeff): the cheaper of clearing it (a click and 2 credits) and what it costs to keep it. */
export function tagCost(state: GameState): number {
  // A run still to start takes its click first (plan.tagNoClear: what's left to clear the tag with)
  const s = !state.activeRun ? { ...state, runner: { ...state.runner, clicks: state.runner.clicks - 1 } } : state;
  return tagsWorth(s, 'runner', s.runner.tags + 1) - tagsWorth(s, 'runner', s.runner.tags); // both priced as given (plan.tagTrashNow)
}

/** An installed card the Corp gets to trash: about the Runner's best, a breaker at its install cost and the time to replace it. */
export function trashedCardCost(state: GameState): number {
  const rig = [...state.runner.rig.programs, ...state.runner.rig.hardware, ...state.runner.rig.resources];
  if (rig.length === 0) return 0;
  return Math.min(8, Math.max(...rig.map(c => (cardDef(c).cost ?? 0) + clickRate() + 1)));
}

export interface BreakPlan {
  breaker: CardInstance;
  /** Credits to break every subroutine in `indices`, boosts included. */
  credits: number;
  boostsNeeded: number;
  /** Boost with the breaker's card ability (Hantu's virus counters) instead of BOOST_BREAKER. */
  boostByAbility?: boolean;
  /** Break with the card's ability instead of BREAK_SUBROUTINE (Lobisomem on barriers, Banner). */
  breakByAbility?: boolean;
}

/** Liberation breakers the generic plan can't price. */
export const AUDREY = '34004';
export const BANNER = '34005';
export const LOBISOMEM = '34090';
export const PRESSURE_SPIKE = '34092';
/** A card trashed from the grip for Audrey's +3 strength, in credits. */
const AUDREY_DISCARD = 1.5;
/** Each of Audrey's virus counters, in credits (it gains them only on trashes). */
const AUDREY_COUNTER = 1;

const CORSAIR = '36004';
const SLAP_VANDAL = '34026';

/**
 * Credits for `boosts` strength boosts: none cost nothing, also for a breaker that cannot boost (Slap Vandal, Umbrella:
 * boostCost Infinity, where 0 * Infinity was NaN and made the Corp's whole board value NaN, issue #47).
 */
function boostCredits(state: GameState, breaker: CardInstance, boosts: number): number {
  return boosts > 0 ? boosts * boostCostOf(state, breaker) : 0;
}

/**
 * Credits the Runner can spend on a run it is planning: what it can spend
 * now, plus, before the run starts, the credits on cards that pay only
 * during runs (Methuselah, Touchstone), which availableCredits leaves out then.
 */
export function runBudget(state: GameState): number {
  const now = availableCredits(state, 'runner');
  if (state.activeRun) return now;
  const rig = [...state.runner.rig.hardware, ...state.runner.rig.programs, ...state.runner.rig.resources];
  return now + rig.filter(c => getCardScript(c.cardCode)?.paysDuringRuns).reduce((n, c) => n + counters(c, 'credit'), 0);
}

/** Credits from stealth cards the Runner can spend on a run: now, during one, or what its stealth cards hold before it starts. */
export function runStealthCredits(state: GameState): number {
  if (state.activeRun) return stealthCredits(state);
  const rig = [...state.runner.rig.hardware, ...state.runner.rig.programs, ...state.runner.rig.resources];
  return rig.filter(c => /stealth/i.test(cardDef(c).keywords ?? '')).reduce((n, c) => n + counters(c, 'credit'), 0);
}

/**
 * The cheapest installed icebreaker that can break the given subroutines of
 * this ice, counting strength boosts already bought this encounter.
 */
export function bestBreakPlan(state: GameState, ice: CardInstance, subCount: number): BreakPlan | null {
  if (subCount === 0) return null;
  const types = iceSubtypes(ice, state);
  const iceStr = iceStrength(state, ice);
  let best: BreakPlan | null = null;
  for (const breaker of installedIcebreakers(state)) {
    const script = breakerScript(breaker);
    const strength = breakerStrength(state, breaker);
    // Banner (no break ability): 2 credits and a barrier's subroutines can't end the run; only for barriers whose every subroutine just ends the run
    if (breaker.cardCode === BANNER) {
      const subs = plannedSubroutines(state, ice);
      if (types.includes('barrier') && strength >= iceStr && subs.length > 0 && subs.every(sub => /^end the run\.?$/i.test(sub.label.trim()))) {
        if (!best || 2 < best.credits) best = { breaker, credits: 2, boostsNeeded: 0, breakByAbility: true };
      }
      continue;
    }
    // Lobisomem on a barrier: X credits and a power counter break X subroutines (rules: its second interface ability)
    if (breaker.cardCode === LOBISOMEM && script && types.includes('barrier') && counters(breaker, 'power') > 0 && canBreakSubroutinesWith(ice, breaker)) {
      const boosts = Math.max(0, Math.ceil((iceStr - strength) / Math.max(1, script.boostAmount(state, breaker))));
      const credits = boostCredits(state, breaker, boosts) + subCount + 1; // the counter is worth about a credit
      if (!best || credits < best.credits) best = { breaker, credits, boostsNeeded: boosts, breakByAbility: true };
      continue;
    }
    if (!script || (script.breaks !== 'any' && !types.includes(script.breaks))) continue;
    if (!canBreakSubroutinesWith(ice, breaker)) continue; // Semak-samun: fracters only
    if (script.canInterface?.(state, breaker, ice)) continue; // Slap Vandal, Living Mural, Umbrella
    // Slap Vandal: "Interface -> 1 credit: Break 1 subroutine on host ice. Use this ability only once per encounter." One
    // subroutine is all it breaks; a plan for more is another breaker's (the Runner tanks the rest, iceCreditNeed BLOCKs)
    if (breaker.cardCode === SLAP_VANDAL && subCount > 1) continue;
    if (breaker.cardCode === AUDREY) {
      // Audrey v2: a virus counter breaks up to 2; a card from the grip is +3 strength
      const uses = Math.ceil(subCount / script.breakMax);
      const boosts = Math.max(0, Math.ceil((iceStr - strength) / 3));
      if (uses > counters(breaker, 'virus') || boosts > state.runner.grip.length) continue;
      const credits = uses * AUDREY_COUNTER + boosts * AUDREY_DISCARD;
      if (!best || credits < best.credits) best = { breaker, credits, boostsNeeded: boosts };
      continue;
    }
    if (breaker.cardCode === PRESSURE_SPIKE && strength < iceStr && Math.max(state.corp.score, state.runner.score) >= 4 && !state.activeRun?.runFlags?.[spikeKey(breaker)]) {
      // Pressure Spike at threat 4: +9 for 2 credits once a run
      const boosts = Math.ceil((iceStr - strength) / 9);
      if (boosts === 1) {
        const credits = 2 + Math.ceil(subCount / script.breakMax) * script.breakCost(state, breaker);
        if (!best || credits < best.credits) best = { breaker, credits, boostsNeeded: 1, boostByAbility: true };
      }
    }
    if (breaker.cardCode === HANTU) {
      const boosts = Math.max(0, Math.ceil((iceStr - strength) / 2));
      if (boosts > counters(breaker, 'virus')) continue;
      const credits = boosts * 1.5 + Math.ceil(subCount / script.breakMax) * script.breakCost(state, breaker);
      if (!best || credits < best.credits) best = { breaker, credits, boostsNeeded: boosts, boostByAbility: true };
      continue;
    }
    if (breaker.cardCode === CORSAIR) {
      // Corsair: -3 strength on the barrier per stealth credit (its own ability), then 1 credit a subroutine
      const lowers = Math.max(0, Math.ceil((iceStr - strength) / 3));
      if (lowers > runStealthCredits(state)) continue;
      const credits = lowers + Math.ceil(subCount / script.breakMax) * script.breakCost(state, breaker);
      if (!best || credits < best.credits) best = { breaker, credits, boostsNeeded: lowers, boostByAbility: true };
      continue;
    }
    const amount = script.boostAmount(state, breaker);
    if (strength < iceStr && amount <= 0) continue;
    const boostsNeeded = Math.max(0, Math.ceil((iceStr - strength) / Math.max(amount, 1)));
    const credits =
      boostCredits(state, breaker, boostsNeeded) +
      Math.ceil(subCount / script.breakMax) * script.breakCost(state, breaker) +
      (breaker.cardCode === MAYFLY ? 2 : 0); // Mayfly is trashed after the run
    if (!best || credits < best.credits) best = { breaker, credits, boostsNeeded };
  }
  return best;
}

/** Estimated cost to get past one piece of ice, as the Runner sees it. */
export function iceCost(state: GameState, ice: CardInstance): number {
  if (!ice.isRezzed) return state.corp.credits >= 3 ? 1.5 : 0.5;
  const physarum = physarumCost(state, ice);
  if (physarum !== undefined) return Math.min(physarum, plainIceCost(state, ice));
  return plainIceCost(state, ice);
}

const PHYSARUM = '34082';

/**
 * Physarum Entangler on this ice: a credit a subroutine bypasses it on every
 * encounter (rules 6.5.8a), unless it is a barrier. Undefined when none is hosted
 * or the Runner can't pay.
 */
export function physarumCost(state: GameState, ice: CardInstance): number | undefined {
  if (!plan().bypass || !ice.isRezzed || iceSubtypes(ice, state).includes('barrier')) return undefined;
  if (!state.runner.rig.programs.some(p => p.cardCode === PHYSARUM && p.hostedOnId === ice.instanceId)) return undefined;
  const credits = plannedSubroutines(state, ice).length;
  return credits <= runBudget(state) ? credits : undefined;
}

function plainIceCost(state: GameState, ice: CardInstance): number {
  // Botulus breaks the worst subroutines for free; the rest are tanked or broken
  const costs = (plannedSubroutines(state, ice)).map(s => subroutineCost(state, s.label)).sort((a, b) => b - a);
  const subs = costs.slice(botulusBreaks(state, ice));
  const funhouse = ice.cardCode === '30054' ? tagCost(state) : 0; // Funhouse: take a tag or the run ends
  if (subs.length === 0) return funhouse;
  let tank = subs.reduce((sum, cost) => sum + cost, 0);
  tank += funhouse;
  const plan = bestBreakPlan(state, ice, subs.length);
  const breakCost = plan ? plan.credits + funhouse : BLOCK;
  return Math.min(tank, breakCost, selfBreakCost(ice, subs.length));
}

/**
 * Credits the Runner must spend to get past this rezzed ice without the
 * run ending: breaking its run-ending subroutines (0 when it has none, or
 * when a bioroid can be broken with the clicks left). Subroutines already
 * broken in `broken` don't count. BLOCK when it can't be got past.
 */
export function iceCreditNeed(state: GameState, ice: CardInstance, broken: boolean[] = []): number {
  const need = plainCreditNeed(state, ice, broken);
  // Physarum Entangler: bypassing costs its credits, before any subroutine is broken
  const physarum = need > 0 && !broken.some(Boolean) ? physarumCost(state, ice) : undefined;
  return physarum !== undefined ? Math.min(need, physarum) : need;
}

function plainCreditNeed(state: GameState, ice: CardInstance, broken: boolean[] = []): number {
  const subs = plannedSubroutines(state, ice);
  const blocking = Math.max(0, subs.filter((s, i) => !broken[i] && subroutineCost(state, s.label) === BLOCK).length - botulusBreaks(state, ice));
  if (blocking === 0) return 0;
  const plan = bestBreakPlan(state, ice, blocking);
  const self = iceScript(ice)?.runnerBreakCost;
  if (self !== undefined) return Math.min(plan?.credits ?? BLOCK, blocking * self);
  if (isBioroid(ice) && state.runner.clicks >= bioroidBreakClicks(ice, blocking)) return 0;
  return plan ? plan.credits : BLOCK;
}

/**
 * Credits to keep for the rezzed ice the Runner still has to pass further
 * in on this run, from the position it is at now (BLOCK: some of it can't
 * be got past). Breaker boosts bought for the current encounter don't
 * carry over, so the ice ahead is costed without them.
 */
export function creditsAhead(state: GameState): number {
  const run = state.activeRun;
  const server = run ? state.corp.servers[run.server] : undefined;
  if (!run || !server || run.icePosition === null) return 0;
  const ice = iceCreditsAhead(state);
  // Manegarm Skunkworks: 5 credits on approach unless the clicks cover it
  const approach = approachCost(state, run.server, state.runner.clicks - bioroidClicks(state, server.ice.slice(0, run.icePosition)), Infinity);
  return ice + (approach?.credits ?? 0);
}

/** creditsAhead without the server's approach costs: just the rezzed ice further in. */
export function iceCreditsAhead(state: GameState): number {
  const run = state.activeRun;
  const server = run ? state.corp.servers[run.server] : undefined;
  if (!run || !server || run.icePosition === null) return 0;
  const outside: GameState = { ...state, activeRun: { ...run, encounter: null } };
  const inner = server.ice.slice(0, run.icePosition);
  const skip = bypassesAhead(outside, inner, !!run.encounter);
  return inner.reduce((sum, ice) => sum + (ice.isRezzed && !skip.has(ice.instanceId) ? iceCreditNeed(outside, ice) : 0), 0);
}

const S_DOBRADO = '34012';
export const ALARM_CLOCK = '34078';

/**
 * During a run, the ice further in that the Runner's bypasses will skip (plan.bypass;
 * rules 6.5.8a): the run's S-Dobrado or Alarm Clock while their encounter is still to
 * come, and rig bypasses not used yet. The current ice, if rezzed and not yet
 * encountered, counts as the next encounter (it is approached first, 6.9.2c).
 */
export function bypassesAhead(state: GameState, inner: CardInstance[], encountering: boolean): Set<string> {
  const run = state.activeRun;
  if (!plan().bypass || !run || run.icePosition === null) return new Set();
  const current = state.corp.servers[run.server]?.ice[run.icePosition];
  // Approaching (or just past) rezzed ice not being encountered: counted as encountered, to be safe
  const encounters = (run.runFlags?.encounters ?? 0) + (current?.isRezzed && !encountering ? 1 : 0);
  const options: RunOptions = {
    bypassFirst: run.eventCode === S_DOBRADO,
    alarmClock: run.runEffects.some(r => findRigCard(state, r.instanceId)?.cardCode === ALARM_CLOCK),
  };
  return runBypasses(state, run.server, options, { ice: [...inner].reverse(), encounters }).ids;
}

function findRigCard(state: GameState, id: string): CardInstance | undefined {
  return [...state.runner.rig.hardware, ...state.runner.rig.programs, ...state.runner.rig.resources].find(c => c.instanceId === id);
}

export const MANEGARM = '30042';

/**
 * What the rezzed upgrades in this server's root charge the Runner on
 * approaching it (rules 6.9.4g). Manegarm Skunkworks: "end the run unless
 * they either spend 2 clicks or pay 5 credits", a nested cost (rules
 * 1.16.11b) the Runner pays to keep the run going. `clicks` and `credits`
 * are what the Runner will have left by then. The cheaper way in, in
 * runScore's units (a click 1, a credit 0.6), and the credits it takes;
 * null when the Runner can pay neither.
 */
export function approachCost(state: GameState, serverId: string, clicks: number, credits: number): { cost: number; credits: number } | null {
  let cost = 0;
  let paid = 0;
  for (const card of state.corp.servers[serverId]?.root ?? []) {
    if (!card.isRezzed || card.cardCode !== MANEGARM) continue;
    const byClicks = clicks >= 2 ? 2 * runClick(state) : Infinity;
    const byCredits = credits - paid >= 5 ? spendCost(state, paid + 5) - spendCost(state, paid) : Infinity;
    if (byClicks === Infinity && byCredits === Infinity) return null;
    if (byClicks <= byCredits) clicks -= 2;
    else paid += 5;
    cost += Math.min(byClicks, byCredits);
  }
  return { cost, credits: paid };
}

/** Clicks the Runner must spend on these rezzed bioroids' run-ending subroutines, having no breaker for them. */
export function bioroidClicks(state: GameState, ice: CardInstance[]): number {
  let clicks = 0;
  for (const card of ice) {
    if (!card.isRezzed || !isBioroid(card)) continue;
    const blocking = plannedSubroutines(state, card).filter(s => subroutineCost(state, s.label) === BLOCK).length - botulusBreaks(state, card);
    if (blocking > 0 && !bestBreakPlan(state, card, blocking)) clicks += bioroidBreakClicks(card, blocking);
  }
  return clicks;
}

/** Clicks a bioroid's own ability takes to break `subCount` subroutines: one each, or the ice's own rate (Ansel 2.0: 2 clicks for up to 2). */
export function bioroidBreakClicks(ice: CardInstance, subCount: number): number {
  const own = iceScript(ice)?.clickBreak;
  return own ? Math.ceil(subCount / own.max) * own.clicks : subCount;
}

/** Breaking the ice with its own ability: a click per subroutine (bioroids) or credits (N-Pot). */
export function selfBreakCost(ice: CardInstance, subCount: number): number {
  const credits = iceScript(ice)?.runnerBreakCost;
  if (credits !== undefined) return subCount * credits;
  return isBioroid(ice) ? bioroidBreakClicks(ice, subCount) * 1.5 : BLOCK;
}

/** Cards the Runner has already accessed (instance id -> card code), so it doesn't keep checking them. */
export type RunnerMemory = Map<string, string>;

/** Corp assets that punish the Runner for accessing or leaving them (the cards an empty-looking remote bluffs with). */
export function isTrap(code: string): boolean {
  const def = getCardDefinition(code);
  return def.type_code === 'asset' && /ambush|hostile/i.test(def.keywords ?? '') && code !== '35061'; // Idiosyncresis isn't sprung by access
}

/**
 * A trap that springs when the Runner accesses it (Urtica Cipher, Byte!, Esca), not one that fires on the Corp's turn
 * (Clearinghouse): once seen, never worth coming back to access (Gemini audit, 2026-11-01).
 */
export const accessTrap = (code: string): boolean => isTrap(code) && /when the runner accesses this/i.test(getCardDefinition(code).stripped_text ?? '');

/**
 * How likely an unknown installed Corp card is a trap rather than an
 * agenda, counted from the Corp's decklist: the traps still unaccounted for
 * against the traps and agendas still unaccounted for. Unaccounted for
 * means in HQ, R&D, facedown in Archives or installed facedown, and not
 * already accessed by the Runner. Cards that come back to HQ or R&D count
 * again; once every trap is accounted for the odds are 0.
 */
export function trapOdds(state: GameState, memory?: RunnerMemory): number {
  const corp = state.corp;
  const installed = Object.values(corp.servers).flatMap(server => server.root.filter(c => !c.isRezzed && !c.faceUp));
  let traps = 0;
  let agendas = 0;
  for (const card of [...corp.hq, ...corp.rd, ...corp.archives.faceDown, ...installed]) {
    if (memory?.has(card.instanceId)) continue;
    if (isTrap(card.cardCode)) traps++;
    else if (cardDef(card).type_code === 'agenda') agendas++;
  }
  return traps + agendas > 0 ? traps / (traps + agendas) : 0;
}

/**
 * Run scoring in the model's units (Jeff, 2026-10-28): stealing p points is
 * worth what they add to the Runner's score on the point clock, plus a share
 * of what they would have added to the Corp's (an agenda stolen is one the
 * Corp doesn't score). The share is larger in a remote, where the Corp is
 * about to score it.
 */
export const DENY = { remote: 0.6, central: 0.3 };

function stealWorth(state: GameState, points: number, deny: number): number {
  const runner = pointValue(state.runner.score + points) - pointValue(state.runner.score);
  const corp = pointValue(state.corp.score + points) - pointValue(state.corp.score);
  return runner + deny * corp;
}

/** Chance an unseen card in a remote's root is an agenda (Jeff: higher the more the Corp has put into the server). */
export function remoteAgendaOdds(state: GameState, server: { ice: CardInstance[] }, card: CardInstance, trap: number): number {
  if (card.advancementCounters > 0) return Math.max(0, 1 - trap);
  // plan.oneAgendaGuess (code audit cleanup item 9): the board's own odds for a facedown card (evaluate hiddenCardOdds,
  // the same unseen pool), so the Runner's run choice and its board score start from one guess
  if (plan().oneAgendaGuess) return iceBump(hiddenCardOdds(state).agenda, server);
  const corp = [...state.corp.hq, ...state.corp.rd, ...state.corp.archives.faceDown, ...Object.values(state.corp.servers).flatMap(s => s.root.filter(c => !c.isRezzed && !c.faceUp && !c.runnerKnows))];
  const kinds = corp.map(c => cardDef(c).type_code);
  const agendas = kinds.filter(t => t === 'agenda').length;
  const roots = kinds.filter(t => t === 'agenda' || t === 'asset' || t === 'upgrade').length;
  return iceBump(roots > 0 ? agendas / roots : 0, server);
}

/** Ice in front of it: the Corp guards agendas more than assets. */
const iceBump = (base: number, server: { ice: CardInstance[] }) => Math.min(0.9, base + (1 - base) * Math.min(0.45, 0.15 * server.ice.length));

/**
 * The R&D accesses priced card by card from what the Runner remembers (rules
 * 7.4.7a: R&D is accessed from the top down): a remembered card counts by
 * the share of its possible places this position is, the rest of each place
 * by the odds for an unseen card. Remembered non-agendas are worth nothing
 * here, so a second run on the same top cards is not worth making.
 */
function rdWorth(state: GameState, accesses: number, odds: number, central: number): number {
  const known = knownInRd(state);
  let value = 0;
  for (let i = 0; i < Math.min(accesses, state.corp.rd.length); i++) {
    let seen = 0;
    for (const e of known) {
      if (i < e.lo || i > e.hi) continue;
      const share = 1 / (e.hi - e.lo + 1);
      seen += share;
      const def = getCardDefinition(e.code);
      if (def.type_code === 'agenda') value += share * stealWorth(state, def.agenda_points ?? 1, DENY.central);
    }
    value += Math.max(0, 1 - seen) * odds * central;
  }
  return value;
}

/**
 * Share of the deck's agenda odds a facedown card in an Archives with no ice keeps (plan.archivesChosen).
 * Jeff (2026-11-04): Vic still ran Archives far too often against Startup Regards. Measured in self-play
 * (Vic vs Startup Regards 6 games, Kessleroid vs Big Brain 4): 33 Archives runs for 0 steals, 0 agendas
 * among the 57 facedown cards there. 0.3 -> 0.05: a Corp flooded with agendas still discards one now and then.
 */
const ARCHIVES_CHOSEN_ODDS = 0.05;
/**
 * The same with ice on Archives: the AI Corp discards the same way behind ice (the 57 included cards behind
 * ice, which the Runner still valued at the deck's full agenda odds); a human Corp may trust ice a little more.
 */
const ARCHIVES_CHOSEN_ODDS_ICED = 0.1;

/** serverValue in credits. */
/** Stands in for an agenda the Runner can't see: only other cards' additional costs to steal count (Magistrate Revontulet). */
const UNSEEN_AGENDA = { instanceId: '', cardCode: '' } as CardInstance;

/**
 * The additional costs to steal an agenda on this server (rules 1.16.10a-b;
 * the engine's stealCost: Méliès City Luxury Line's click, only once the
 * Runner knows the card, and Magistrate Revontulet's 3 credits), priced for
 * what the Runner will have left at the access: its clicks after the run's
 * own, and its credits after the rezzed ice. Null: it can't pay them all, so
 * it can't steal (plan.stealCosts; Gemini audit, 2026-11-01).
 */
export function stealTax(state: GameState, serverId: string, agenda: CardInstance = UNSEEN_AGENDA): number | null {
  const cost = stealCost(state, agenda);
  if (!cost.clicks && !cost.credits) return 0;
  const server = state.corp.servers[serverId];
  const clicks = state.activeRun ? state.runner.clicks : state.runner.clicks - 1 - bioroidClicks(state, server?.ice ?? []);
  const ice = state.activeRun || !server ? 0 : server.ice.reduce((n, c) => n + (c.isRezzed ? iceCost(state, c) : 0), 0);
  const credits = (state.activeRun ? availableCredits(state, 'runner') : runBudget(state)) - ice;
  if (clicks < cost.clicks || credits < cost.credits) return null;
  return cost.clicks * clickRate() + creditCost(state, cost.credits);
}

/**
 * plan.knownHq (Jeff, 2026-11-04: against a Teia with an open HQ the Runner kept running it for nothing):
 * the chance a random HQ access is an agenda, counting the cards the Runner knows are in HQ (accessed there,
 * or revealed) at what they are and only the rest at the deck's odds. Without it every HQ card was a
 * random unseen card however often the Runner had looked.
 */
export function hqAgendaOdds(state: GameState, odds: number): number {
  const size = state.corp.hq.length;
  if (size === 0) return odds;
  const known = knownInHand(state, 'corp').slice(-size);
  const agendas = known.filter(k => getCardDefinition(k.code).type_code === 'agenda').length;
  return (agendas + (size - known.length) * odds) / size;
}

/** A steal's worth less its additional costs (0 when they can't be paid). */
const taxedSteal = (worth: number, tax: number | null) => (tax === null ? 0 : Math.max(0, worth - tax));

function serverWorth(state: GameState, serverId: string, extraAccesses: number, memory: RunnerMemory | undefined, wary: boolean, repeat: number): number {
  const server = state.corp.servers[serverId];
  const { odds, points } = agendaOdds(state);
  const unseenTax = stealTax(state, serverId);
  const central = taxedSteal(stealWorth(state, points, DENY.central), unseenTax);
  let value = 0;
  if (serverId === 'rd') {
    value = rdWorth(state, 1 + extraAccesses, odds, central);
  }
  else if (serverId === 'hq') value = state.corp.hq.length === 0 ? 0 : Math.min(1 + extraAccesses, state.corp.hq.length) * hqAgendaOdds(state, odds) * central * 0.5 ** repeat;
  else if (serverId === 'archives') {
    if (repeat > 0) return 0;
    const faceUp = state.corp.archives.faceUp.filter(c => cardDef(c).type_code === 'agenda');
    // plan.archivesChosen (Jeff, bug report #5): facedown cards are ones the Corp chose to put there (discards,
    // Hansei Review); a Corp rarely chooses an agenda, with or without ice there
    const chosen = state.corp.servers.archives.ice.length === 0 ? ARCHIVES_CHOSEN_ODDS : ARCHIVES_CHOSEN_ODDS_ICED;
    value = faceUp.reduce((n, c) => n + taxedSteal(stealWorth(state, cardDef(c).agenda_points ?? 1, 0), stealTax(state, serverId, c)), 0) + Math.min(3, state.corp.archives.faceDown.length) * odds * chosen * taxedSteal(stealWorth(state, points, 0), unseenTax);
  }
  if (repeat > 0 && server.isRemote) return 0;
  const trap = wary ? trapOdds(state, memory) : 1 / 3;
  for (const card of server.root) {
    if (card.faceUp && cardDef(card).type_code === 'agenda') {
      // A faceup agenda: a sure steal, public to both sides. Under BANGUN it costs 2 meat damage and a tag;
      // installed faceup by its own text (Sacrifice Zone Expansion, rules 3.2.3a) it costs nothing extra
      const bangun = state.corp.identity.cardCode === BANGUN;
      if (bangun && state.runner.grip.length < 2) return 0;
      const tax = stealTax(state, serverId, card);
      if (tax === null) continue;
      value += stealWorth(state, cardDef(card).agenda_points ?? 1, DENY.remote) - tax - (bangun ? damageWorth(state, 2) + tagCost(state) : 0);
      continue;
    }
    if (!card.isRezzed && memory?.has(card.instanceId)) {
      // Seen it: only worth coming back to trash it, and never into a known trap
      if (accessTrap(card.cardCode)) return 0;
      // An agenda left behind (its additional cost to steal unpaid, Méliès City Luxury Line): back for it when it can pay
      if (cardDef(card).type_code === 'agenda') {
        value += taxedSteal(stealWorth(state, cardDef(card).agenda_points ?? 1, DENY.remote), stealTax(state, serverId, card));
        continue;
      }
      const trash = cardDef(card).trash_cost;
      if (trash != null && trash <= state.runner.credits) value += Math.max(0, corpCardValue(card, state, 'runner') - creditCost(state, trash));
    } else if (!card.isRezzed) {
      const agenda = remoteAgendaOdds(state, server, card, trap);
      // Not an agenda: a trap (Urtica: 2 net damage plus its counters) or an asset to trash
      const trapShare = Math.min(1 - agenda, trap);
      // plan.oneAgendaGuess: the points of the agendas still unseen, as the board counts them (not the whole decklist's)
      const hiddenPoints = plan().oneAgendaGuess ? hiddenCardOdds(state).agendaPoints : points;
      value += agenda * taxedSteal(stealWorth(state, hiddenPoints, card.advancementCounters > 0 ? DENY.remote : DENY.central), unseenTax) - trapShare * damageWorth(state, 2 + card.advancementCounters) + (1 - agenda - trapShare) * 1;
    } else {
      const trash = cardDef(card).trash_cost;
      if (trash != null && trash <= state.runner.credits) value += Math.max(0.5, corpCardValue(card, state, 'runner') - creditCost(state, trash));
    }
  }
  return value;
}

/** What accessing this server is worth to the Runner right now. */
export function serverValue(state: GameState, serverId: string, extraAccesses = 0, memory?: RunnerMemory, wary = false): number {
  const server = state.corp.servers[serverId];
  if (!server) return 0;
  // The run in progress is already listed (as not yet successful): only earlier runs count
  const earlier = state.activeRun ? state.runsThisTurn.slice(0, -1) : state.runsThisTurn;
  const priorRuns = earlier.filter(r => r.server === serverId);
  if (priorRuns.some(r => !r.successful)) return 0; // it stopped us once already this turn
  const repeat = priorRuns.length;
  // Priced in credits on the point clock (plan.runModel, 2026-10-28; the older flat table was deleted 2026-11-06)
  return serverWorth(state, serverId, extraAccesses, memory, wary, repeat);
}

/** A remote worth running that the Runner's hand is too small to risk (draw first). */
export function needsBiggerHand(state: GameState, memory?: RunnerMemory): boolean {
  return Object.values(state.corp.servers).some(server =>
    server.root.some(
      c => !c.isRezzed && !memory?.has(c.instanceId) && c.advancementCounters > 0 && state.runner.grip.length <= 2 + c.advancementCounters
    )
  );
}

export interface RunOptions {
  bonusCredits?: number;
  extraAccesses?: number;
  /** Tread Lightly: unrezzed ice costs 3 more to rez, so it's less likely to be rezzed. */
  rezTax?: boolean;
  /** Worth (in credits) the run's card adds if the run is successful, beyond the breach. */
  successBonus?: number;
  /**
   * Credits the Runner gains if the run is successful (Clean Getaway, Transfer of Wealth, Red Team), priced on the
   * credit slide like the credits the run costs (plan.runCreditsSlide; Jeff, 2026-11-05): a broke Runner's 6 credits
   * from Clean Getaway are worth more than 6, a rich one's less. With the flag off they count flat.
   */
  successCredits?: number;
  /** Shred: the first "end the run" is prevented unless the Corp trashes cards from HQ. */
  shred?: boolean;
  /** Aircheck: only the run's own credits can be spent, not the pool. */
  poolLocked?: boolean;
  /** Baker: with a stealth credit, the run on Archives can approach HQ or R&D instead after its ice. */
  baker?: boolean;
  /** Eru, Beatriz, Maintenance Access: a successful run breaches this server instead (with extraAccesses there). */
  breachAs?: string;
  /** S-Dobrado: the first ice encountered is bypassed (plan.bypass). */
  bypassFirst?: boolean;
  /** Alarm Clock's run: the first ice encountered can be bypassed for 2 clicks (plan.bypass). */
  alarmClock?: boolean;
  /** Window of Opportunity: a rezzed ice is derezzed as the run begins (plan.bypass). */
  derezOne?: boolean;
  /** Privileged Access, Burner: a successful run breaches nothing (its worth is successBonus). */
  noBreach?: boolean;
  /** Deck-aware AI: weigh trap risk by the traps this Corp may still have (see trapOdds). */
  wary?: boolean;
  memory?: RunnerMemory;
}

const MALANDRAGEM = '34081';
const LASER_POINTER = '34016';
const CURUPIRA = '34015';
const FRANSOFIA_WARD = '35021';

/** The ice on a run the Runner bypasses (rules 6.5.8a: no subroutines resolve), and what the bypasses cost it in credits' worth. */
export interface Bypasses {
  ids: Set<string>;
  price: number;
}

/**
 * The bypasses the Runner would use on a run on this server (plan.bypass):
 * S-Dobrado's on the first ice encountered, which is the outermost rezzed
 * ice (unrezzed ice is only encountered if rezzed on approach, 6.9.2c), and
 * at threat 4 a click for the next; then each bypass card in the rig on the
 * rezzed ice it fits where it saves more than it costs, greediest first.
 * Rig bypasses fit only rezzed ice: the Runner can't see what unrezzed ice is.
 * Physarum Entangler is in iceCost (it bypasses its host on every encounter).
 */
export function runBypasses(state: GameState, serverId: string, options: RunOptions = {}, ahead?: { ice: CardInstance[]; encounters: number }): Bypasses {
  const out: Bypasses = { ids: new Set(), price: 0 };
  const server = state.corp.servers[serverId];
  if (!plan().bypass || !server) return out;
  // Before the run: all of its ice; during it, the ice still ahead (outermost first) after the encounters so far
  const outward = ahead?.ice ?? [...server.ice].reverse();
  const done = ahead?.encounters ?? 0;
  const rezzed = outward.filter(ice => ice.isRezzed);
  // The click S-Dobrado or Alarm Clock spends; before the run the play's click is spent too
  const clicks = state.runner.clicks - (ahead ? 0 : 1);
  if (options.bypassFirst) {
    if (done === 0) {
      const first = rezzed[0] ?? (ahead ? undefined : outward[0]);
      if (first) out.ids.add(first.instanceId);
    }
    // Threat 4: the second ice encountered, for a click
    const second = done === 0 ? rezzed[1] : done === 1 ? rezzed[0] : undefined;
    if (second && (done === 1 || rezzed[0]) && threatLevel(state) >= 4 && clicks >= 1 && iceCost(state, second) > runClick(state)) {
      out.ids.add(second.instanceId);
      out.price += runClick(state);
    }
  }
  // Alarm Clock's run: the first ice encountered, for 2 clicks
  if (options.alarmClock && done === 0 && rezzed[0] && clicks >= 2 && iceCost(state, rezzed[0]) > 2 * runClick(state)) {
    out.ids.add(rezzed[0].instanceId);
    out.price += 2 * runClick(state);
  }
  const uses: { fits: (ice: CardInstance) => boolean; price: number; uses: number }[] = [];
  for (const card of [...state.runner.rig.programs, ...state.runner.rig.resources]) {
    if (card.cardCode === MALANDRAGEM && counters(card, 'power') > 0 && turnFlag(state, `once:${card.instanceId}:0`) === 0) {
      uses.push({ fits: ice => iceStrength(state, ice) <= 3, price: counterWorthOf(state, MALANDRAGEM, 'power'), uses: 1 });
    } else if (card.cardCode === MALANDRAGEM && threatLevel(state) >= 4) {
      uses.push({ fits: () => true, price: runnerEffect(state, MALANDRAGEM, card) ?? 1, uses: 1 });
    }
    if (card.cardCode === LASER_POINTER) {
      uses.push({ fits: ice => /\b(ap|destroyer|observer)\b/i.test(cardDef(ice).keywords ?? ''), price: runnerEffect(state, LASER_POINTER, card) ?? 2, uses: 1 });
    }
    if (card.cardCode === CURUPIRA && counters(card, 'power') >= 3) {
      uses.push({ fits: ice => iceSubtypes(ice, state).includes('barrier'), price: 3 * counterWorthOf(state, CURUPIRA, 'power'), uses: Math.floor(counters(card, 'power') / 3) });
    }
    if (card.cardCode === FRANSOFIA_WARD && state.corp.credits >= 15) {
      uses.push({ fits: () => true, price: runnerEffect(state, FRANSOFIA_WARD, card) ?? 3, uses: 1 });
    }
  }
  for (const use of uses) {
    for (let n = 0; n < use.uses; n++) {
      let best: { ice: CardInstance; saving: number } | undefined;
      for (const ice of outward) {
        if (!ice.isRezzed || out.ids.has(ice.instanceId) || !use.fits(ice)) continue;
        const cost = iceCost(state, ice);
        const saving = (cost === BLOCK ? 100 : cost) - use.price;
        if (saving > 0 && (!best || saving > best.saving)) best = { ice, saving };
      }
      if (!best) break;
      out.ids.add(best.ice.instanceId);
      out.price += use.price;
    }
  }
  return out;
}

/**
 * Window of Opportunity: the rezzed ice it derezzes as the run begins (6.9.1c), the
 * one costing the Runner most. Ice the Corp can't pay to rez again is not
 * encountered (6.9.2c); ice it can rez again costs the Corp its rez cost.
 */
export function windowDerez(state: GameState, serverId: string): { ice: CardInstance; rerez: boolean } | undefined {
  const rezzed = (state.corp.servers[serverId]?.ice ?? []).filter(ice => ice.isRezzed);
  const ranked = rezzed.map(ice => ({ ice, cost: iceCost(state, ice) })).sort((a, b) => b.cost - a.cost);
  const top = ranked[0];
  if (!top) return undefined;
  return { ice: top.ice, rerez: state.corp.credits >= rezCost(state, top.ice) };
}

/**
 * Credits the Runner is short of getting past the rezzed ice on this
 * server (0 or less: it can afford it now). Null when some rezzed ice
 * can't be got past at any price (no breaker for an end-the-run).
 */
export function runShortfall(state: GameState, serverId: string): number | null {
  const server = state.corp.servers[serverId];
  if (!server) return null;
  let known = 0;
  const bypassed = runBypasses(state, serverId);
  for (const ice of server.ice) {
    if (!ice.isRezzed || bypassed.ids.has(ice.instanceId)) continue;
    const cost = iceCost(state, ice);
    if (cost === BLOCK) return null;
    known += cost;
  }
  // Manegarm Skunkworks: 5 credits too when a run won't leave 2 clicks for it
  if (state.runner.clicks - 1 - bioroidClicks(state, server.ice) < 2) known += 5 * server.root.filter(c => c.isRezzed && c.cardCode === MANEGARM).length;
  return known - runBudget(state);
}

/**
 * Credits a run on this server is expected to spend getting in (plan.plannerRunCredits): what the rezzed ice it
 * doesn't bypass needs to be got past, less the run's own credits, and Manegarm's toll when paid in credits.
 */
export function runCreditSpend(state: GameState, serverId: string, options: RunOptions = {}): number {
  const server = state.corp.servers[serverId];
  if (!server) return 0;
  const bypassed = runBypasses(state, serverId, options);
  let need = 0;
  for (const ice of server.ice) {
    if (!ice.isRezzed || bypassed.ids.has(ice.instanceId)) continue;
    const n = iceCreditNeed(state, ice);
    if (n !== BLOCK) need += n;
  }
  need = Math.max(0, need - (options.bonusCredits ?? 0));
  const approach = approachCost(state, serverId, state.runner.clicks - 1 - bioroidClicks(state, server.ice), runBudget(state) - need);
  return need + (approach?.credits ?? 0);
}

/**
 * How good a run on this server is now, net of the click and expected costs.
 * -Infinity when the Runner can't get in.
 */
export function runScore(state: GameState, serverId: string, options: RunOptions = {}): number {
  const server = state.corp.servers[serverId];
  if (!server) return -Infinity;
  const breached = options.noBreach ? 0 : serverValue(state, options.breachAs ?? serverId, options.extraAccesses ?? 0, options.memory, options.wary);
  const gained = options.successCredits ?? 0;
  const credits = gained > 0 && plan().runCreditsSlide ? gained * payoutSlide(state, 'runner', gained) : gained;
  let value = breached + ((options.successBonus ?? 0) + credits);
  if (options.baker && serverId === 'archives' && runStealthCredits(state) >= 1) {
    // Baker: after Archives' ice, a stealth credit turns the run on HQ or R&D, whose ice it skipped
    const redirect = Math.max(...['hq', 'rd'].map(id => serverValue(state, id, 0, options.memory, options.wary)));
    value = Math.max(value, redirect - spendCost(state, 1));
  }
  // One net damage from flatlining. plan.emptyGripRuns (2026-11-06, thread "Find why self-play games end decked"): with an
  // empty grip that damage is a flatline only as often as the Corp has a hit to land (flatlineOdds), not every time; priced as
  // a sure flatline, every run scored below zero, and a Runner with no cards left in grip or Stack never ran again while the
  // Corp decked out (rules 4.2.7b, 10.4.4)
  if (state.runner.grip.length === 0) value -= 0.25 * flatlineWorth(state) * flatlineOdds(state, 0);
  else if (state.runner.grip.length <= 1) value -= 0.25 * damageWorth(state, 1);
  if (value <= 0) return -Infinity;
  let known = 0;
  let expected = 0;
  let shredLeft = !!options.shred && server.root.length > 0;
  const budget = (options.poolLocked ? runBudget(state) - availableCredits(state, 'runner') : runBudget(state)) + (options.bonusCredits ?? 0);
  // Runner (rez allowance): credits paid on the way in are lost if unrezzed ice further in is rezzed and can't be paid for
  let paidOutside = 0;
  let waste = 0;
  const canRez = state.corp.credits >= (options.rezTax ? 4 : 1);
  // Bypassed ice costs nothing to pass (rules 6.5.8a); Window of Opportunity's derezzed ice is
  // passed unencountered unless the Corp rezzes it again (6.9.2b-c), which costs it the rez
  const bypassed = runBypasses(state, serverId, options);
  const derez = options.derezOne && plan().bypass ? windowDerez(state, serverId) : undefined;
  if (derez && !derez.rerez) bypassed.ids.add(derez.ice.instanceId);
  if (derez?.rerez) value += 0.5 * rezCost(state, derez.ice); // the Corp pays it about half the time
  for (const ice of [...server.ice].reverse()) {
    if (bypassed.ids.has(ice.instanceId)) continue;
    if (ice.isRezzed) paidOutside += Math.min(iceCreditNeed(state, ice), budget);
    else if (canRez && paidOutside > 0) {
      const spare = budget - paidOutside;
      waste += paidOutside * (spare < 2 ? 0.5 : spare < 4 ? 0.25 : 0.1);
    }
  }
  for (const ice of server.ice) {
    if (bypassed.ids.has(ice.instanceId)) continue;
    let cost = iceCost(state, ice);
    if (cost === BLOCK && shredLeft) {
      // The Corp either lets the run go on or trashes HQ cards: worth it either way
      shredLeft = false;
      cost = 1;
    }
    if (cost === BLOCK) return -Infinity;
    if (ice.isRezzed) known += cost;
    expected += !ice.isRezzed && options.rezTax ? cost * 0.3 : cost;
  }
  if (known > budget) return -Infinity;
  // Known costs of approaching the server, after the ice (Manegarm Skunkworks)
  const approach = approachCost(state, serverId, state.runner.clicks - 1 - bioroidClicks(state, server.ice), budget - known);
  if (!approach) return -Infinity;
  const paid = Math.max(0, expected - (options.bonusCredits ?? 0));
  return value - spendCost(state, paid) - spendCost(state, waste) - approach.cost - runClick(state) - bypassed.price;
}

/**
 * What the rest of a run in progress is still worth to the Runner (plan.runRest; Jeff, 2026-11-05, thread
 * "Find why AI card valuation misses cards"): the breach, less what the ice still ahead will cost to get past
 * (none if some of it can't be). A choice made during a run (pay or end the run, gain credits, derez or skip
 * an ice further in) changes this; the board alone never saw it, only that the run was still going.
 */
export function runRestWorth(state: GameState, memory?: RunnerMemory, wary?: boolean): number {
  const run = state.activeRun;
  if (!run || run.isJackedOut) return 0;
  const server = state.corp.servers[run.server];
  if (!server) return 0;
  const pos = run.icePosition;
  // Ice not yet passed: further in, and the one being approached (an encounter in progress is priced by its own answer)
  const ahead = server.ice.filter((_, i) => pos === null || i < pos || (i === pos && run.phase === 'approach_ice'));
  let cost = 0;
  for (const ice of ahead) {
    const c = iceCost(state, ice);
    if (c === BLOCK) return 0;
    cost += c;
  }
  return Math.max(0, serverValue(state, run.server, 0, memory, wary) - spendCost(state, cost));
}

const CHAIN_REACTION = '36001';
const CENTRALS = ['hq', 'rd', 'archives'];

/**
 * Chain Reaction (plays only after successful runs on HQ, R&D and Archives
 * this turn): the share of its worth a run on one of the centrals still
 * needed earns, while the clicks left cover the other runs and the play.
 * Its worth: the 2 Corp cards it trashes (rezzed ice at its rez cost and the install to replace it, other
 * cards as the Runner prices them), less the cheapest Runner card the Corp trashes back.
 */
export function chainReactionBonus(state: GameState, serverId: string): number {
  if (!state.runner.grip.some(c => c.cardCode === CHAIN_REACTION) || !CENTRALS.includes(serverId)) return 0;
  const needed = CENTRALS.filter(id => !state.runsThisTurn.some(r => r.server === id && r.successful));
  if (!needed.includes(serverId) || state.runner.clicks < needed.length + 1 || state.runner.credits < 1) return 0;
  const installed = Object.values(state.corp.servers).flatMap(s => [...s.ice, ...s.root]);
  const worth = installed
    // Rezzed ice: the Corp pays its rez cost, a click and an install again to replace it
    .map(c => (!c.isRezzed ? 1.5 : cardDef(c).type_code === 'ice' ? (cardDef(c).cost ?? 0) + 2 : corpCardValue(c, state, 'runner')))
    .sort((a, b) => b - a);
  const mine = [...state.runner.rig.programs, ...state.runner.rig.hardware, ...state.runner.rig.resources].map(c => cardDef(c).cost ?? 0);
  const value = (worth[0] ?? 0) + (worth[1] ?? 0) - (mine.length ? Math.min(...mine) + 0.5 : 0) - 1;
  return value > 0 ? value / needed.length : 0;
}

/** Rezzed ice the Runner gets through for this much or less is worth trashing to make room. */
const WEAK_ICE = 2;

/** The rezzed ice on a server that is cheapest for the Runner to get through, if it is weak enough to trash. */
export function weakestIce(state: GameState, serverId: string): CardInstance | undefined {
  const rezzed = (state.corp.servers[serverId]?.ice ?? []).filter(ice => ice.isRezzed).map(ice => ({ ice, cost: iceCost(state, ice) }));
  rezzed.sort((a, b) => a.cost - b.cost);
  return rezzed[0] && rezzed[0].cost <= WEAK_ICE ? rezzed[0].ice : undefined;
}
