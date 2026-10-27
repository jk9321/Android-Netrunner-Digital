import { CardInstance, GameState, cardDef, getCardDefinition } from '../core';
import {
  boostCostOf,
  breakerScript,
  breakerStrength,
  canBreakSubroutinesWith,
  iceScript,
  iceStrength,
  iceSubtypes,
  installedIcebreakers,
  isBioroid,
} from '../core/engine/ice';
import { availableCredits, counters } from '../core/engine/cardEffects';
import { corpCardValue } from './evaluate';
import { tuning } from './synergy';

/**
 * What the Runner AI knows about runs. It only reads public information:
 * rezzed ice, rezzed cards and advancement counters. Unrezzed ice and
 * unrezzed root cards are guesses.
 */

const BLOCK = Infinity;
const MAYFLY = '30032';
const HANTU = '35008'; // boosts by spending hosted virus counters (+2 each), not credits
export const BOTULUS = '30004';
export const TRANQUILIZER = '30017';

/** The Runner's trojans of one kind (Botulus, Tranquilizer) hosted on this ice. */
export function hostedTrojans(state: GameState, ice: CardInstance, code: string): CardInstance[] {
  return state.runner.rig.programs.filter(c => c.cardCode === code && c.hostedOnId === ice.instanceId);
}

/** Subroutines Botulus breaks on this ice for free: the virus counters on the Botulus programs it hosts. */
export function botulusBreaks(state: GameState, ice: CardInstance): number {
  if (!tuning.plan.trojans) return 0;
  return hostedTrojans(state, ice, BOTULUS).reduce((n, c) => n + counters(c, 'virus'), 0);
}

/** Credits-equivalent cost of letting one subroutine resolve (Infinity: it ends the run). */
export function subroutineCost(state: GameState, label: string): number {
  return knownSubroutineCost(state, label) ?? 2;
}

/**
 * The cost of a subroutine whose wording one of the patterns below
 * recognises, or undefined for wording none of them knows (counted as 2).
 * A test checks every subroutine in the card pool is recognised.
 */
export function knownSubroutineCost(state: GameState, label: string): number | undefined {
  const runner = state.runner;
  if (/cannot steal or trash/i.test(label)) return BLOCK;
  // Mycoweb: as bad as the worst subroutine on a rezzed ice of that type
  const borrowed = label.match(/resolve 1 subroutine on (?:a|another) rezzed (barrier|code gate|sentry)/i);
  if (borrowed) {
    const type = borrowed[1].toLowerCase();
    const costs = Object.values(state.corp.servers)
      .flatMap(server => server.ice)
      .filter(ice => ice.isRezzed && iceSubtypes(ice, state).some(t => t === type))
      .flatMap(ice => (iceScript(ice)?.subroutines ?? []).filter(sub => !/resolve 1 subroutine on/i.test(sub.label)))
      .map(sub => subroutineCost(state, sub.label));
    return costs.length > 0 ? Math.max(...costs) : 0;
  }
  // Elevation conditions
  const unless = label.match(/end the run unless the runner suffers (\d+) net damage/i);
  if (unless) return Number(unless[1]) >= runner.grip.length ? BLOCK : 2 * Number(unless[1]);
  const threat = label.match(/threat level is (\d+) or greater, end the run/i);
  if (threat) return Math.max(state.corp.score, runner.score) >= Number(threat[1]) ? BLOCK : 0;
  if (/end the run if the runner is tagged/i.test(label)) return runner.tags > 0 ? BLOCK : 1;
  if (/if the runner has at least 2 tags/i.test(label)) return runner.tags >= 2 ? (2 >= runner.grip.length ? BLOCK : 4) : 0;
  if (/core damage/i.test(label)) return 6;
  if (/unless they pay 3 credits/i.test(label)) return 3;
  const loses = label.match(/loses? (\d+) credits?/i);
  if (loses) return Math.min(Number(loses[1]), runner.credits);
  if (/or end the run/i.test(label)) return runner.rig.programs.length > 0 ? 5 : BLOCK;
  if (/odd cost/i.test(label)) return runner.grip.length <= 1 ? BLOCK : 4; // Diviner: half the time it ends the run
  if (/6 credits or less/i.test(label)) return runner.credits - 3 <= 6 ? BLOCK : 0;
  if (/end the run/i.test(label)) return BLOCK;
  const damage = label.match(/(\d+) (net|meat) damage/i);
  if (damage) {
    const n = Number(damage[1]);
    return n >= runner.grip.length ? BLOCK : 2 * n;
  }
  if (/tag/i.test(label)) return 3;
  if (/trash 1 installed runner card/i.test(label)) return 4;
  if (/gain 1 credit/i.test(label)) return 0.3;
  if (/^draw 1 card/i.test(label)) return 0.5; // Empiricist: helps the Corp a little
  if (/install/i.test(label)) return 1.5;
  return undefined;
}

export interface BreakPlan {
  breaker: CardInstance;
  /** Credits to break every subroutine in `indices`, boosts included. */
  credits: number;
  boostsNeeded: number;
  /** Boost with the breaker's card ability (Hantu's virus counters) instead of BOOST_BREAKER. */
  boostByAbility?: boolean;
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
    if (!script || (script.breaks !== 'any' && !types.includes(script.breaks))) continue;
    if (!canBreakSubroutinesWith(ice, breaker)) continue; // Semak-samun: fracters only
    const strength = breakerStrength(state, breaker);
    if (breaker.cardCode === HANTU) {
      const boosts = Math.max(0, Math.ceil((iceStr - strength) / 2));
      if (boosts > counters(breaker, 'virus')) continue;
      const credits = boosts * 1.5 + Math.ceil(subCount / script.breakMax) * script.breakCost(state, breaker);
      if (!best || credits < best.credits) best = { breaker, credits, boostsNeeded: boosts, boostByAbility: true };
      continue;
    }
    const amount = script.boostAmount(state, breaker);
    if (strength < iceStr && amount <= 0) continue;
    const boostsNeeded = Math.max(0, Math.ceil((iceStr - strength) / Math.max(amount, 1)));
    const credits =
      boostsNeeded * boostCostOf(state, breaker) +
      Math.ceil(subCount / script.breakMax) * script.breakCost(state, breaker) +
      (breaker.cardCode === MAYFLY ? 2 : 0); // Mayfly is trashed after the run
    if (!best || credits < best.credits) best = { breaker, credits, boostsNeeded };
  }
  return best;
}

/** Estimated cost to get past one piece of ice, as the Runner sees it. */
export function iceCost(state: GameState, ice: CardInstance): number {
  if (!ice.isRezzed) return state.corp.credits >= 3 ? 1.5 : 0.5;
  // Botulus breaks the worst subroutines for free; the rest are tanked or broken
  const costs = (iceScript(ice)?.subroutines ?? []).map(s => subroutineCost(state, s.label)).sort((a, b) => b - a);
  const subs = costs.slice(botulusBreaks(state, ice));
  if (subs.length === 0) return ice.cardCode === '30054' ? 3 : 0;
  let tank = subs.reduce((sum, cost) => sum + cost, 0);
  if (ice.cardCode === '30054') tank += 3; // Funhouse: take a tag or the run ends
  const plan = bestBreakPlan(state, ice, subs.length);
  const breakCost = plan ? plan.credits + (ice.cardCode === '30054' ? 3 : 0) : BLOCK;
  return Math.min(tank, breakCost, selfBreakCost(ice, subs.length));
}

/**
 * Credits the Runner must spend to get past this rezzed ice without the
 * run ending: breaking its run-ending subroutines (0 when it has none, or
 * when a bioroid can be broken with the clicks left). Subroutines already
 * broken in `broken` don't count. BLOCK when it can't be got past.
 */
export function iceCreditNeed(state: GameState, ice: CardInstance, broken: boolean[] = []): number {
  const subs = iceScript(ice)?.subroutines ?? [];
  const blocking = Math.max(0, subs.filter((s, i) => !broken[i] && subroutineCost(state, s.label) === BLOCK).length - botulusBreaks(state, ice));
  if (blocking === 0) return 0;
  const plan = bestBreakPlan(state, ice, blocking);
  const self = iceScript(ice)?.runnerBreakCost;
  if (self !== undefined) return Math.min(plan?.credits ?? BLOCK, blocking * self);
  if (isBioroid(ice) && state.runner.clicks >= blocking) return 0;
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
  return server.ice.slice(0, run.icePosition).reduce((sum, ice) => sum + (ice.isRezzed ? iceCreditNeed(outside, ice) : 0), 0);
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
    const byClicks = clicks >= 2 ? 2 : Infinity;
    const byCredits = credits - paid >= 5 ? 0.6 * 5 : Infinity;
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
    const blocking = (iceScript(card)?.subroutines ?? []).filter(s => subroutineCost(state, s.label) === BLOCK).length - botulusBreaks(state, card);
    if (blocking > 0 && !bestBreakPlan(state, card, blocking)) clicks += blocking;
  }
  return clicks;
}

/** Breaking the ice with its own ability: a click per subroutine (bioroids) or credits (N-Pot). */
export function selfBreakCost(ice: CardInstance, subCount: number): number {
  const credits = iceScript(ice)?.runnerBreakCost;
  if (credits !== undefined) return subCount * credits;
  return isBioroid(ice) ? subCount * 1.5 : BLOCK;
}

/** Cards the Runner has already accessed (instance id -> card code), so it doesn't keep checking them. */
export type RunnerMemory = Map<string, string>;

const URTICA = '30045';

/** Corp assets that punish the Runner for accessing or leaving them (the cards an empty-looking remote bluffs with). */
export function isTrap(code: string): boolean {
  const def = getCardDefinition(code);
  return def.type_code === 'asset' && /ambush|hostile/i.test(def.keywords ?? '') && code !== '35061'; // Idiosyncresis isn't sprung by access
}

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

/** What accessing this server is worth to the Runner right now. */
export function serverValue(state: GameState, serverId: string, extraAccesses = 0, memory?: RunnerMemory, wary = false, urgent = false): number {
  const server = state.corp.servers[serverId];
  if (!server) return 0;
  // The run in progress is already listed (as not yet successful): only earlier runs count
  const earlier = state.activeRun ? state.runsThisTurn.slice(0, -1) : state.runsThisTurn;
  const priorRuns = earlier.filter(r => r.server === serverId);
  if (priorRuns.some(r => !r.successful)) return 0; // it stopped us once already this turn
  const repeat = priorRuns.length;

  let value = 0;
  if (serverId === 'rd') value = 3.5 + 1.5 * extraAccesses - 1 * repeat;
  else if (serverId === 'hq') value = state.corp.hq.length === 0 ? 0 : 2.8 + 1.2 * extraAccesses - 1 * repeat;
  else if (serverId === 'archives') {
    if (repeat > 0) return 0;
    const faceUpAgendas = state.corp.archives.faceUp.filter(c => cardDef(c).type_code === 'agenda').length;
    value = Math.min(3, 0.6 * state.corp.archives.faceDown.length) + 6 * faceUpAgendas;
  }
  if (repeat > 0 && server.isRemote) return 0;
  // Deck-aware AI: caution follows the traps this Corp may still have, more so on a remote with no ice (a classic bluff)
  const caution = wary ? (trapOdds(state, memory) / (1 / 3)) * (server.isRemote && server.ice.length === 0 ? 1.25 : 1) : 1;
  const handMargin = wary && caution > 1.4 ? 1 : 0;
  for (const card of server.root) {
    if (wary && card.faceUp && cardDef(card).type_code === 'agenda') {
      // Deck-aware AI: a faceup agenda (BANGUN) is a sure steal, for 2 meat damage and a tag
      if (state.runner.grip.length < 2) return 0;
      value += 2.5 * (cardDef(card).agenda_points ?? 1) + 0.5 * Math.min(card.advancementCounters, 4) - 2;
      continue;
    }
    if (!card.isRezzed && memory?.has(card.instanceId)) {
      // Seen it: only worth coming back to trash it, and never into a known trap
      if (card.cardCode === URTICA) return 0;
      const trash = cardDef(card).trash_cost;
      if (trash != null && trash <= state.runner.credits) value += Math.max(0, corpCardValue(card) - trash) * 0.6;
    } else if (!card.isRezzed) {
      if (card.advancementCounters === 0 && state.runner.grip.length <= 3 + handMargin) value -= 3 * caution; // might be a trap
      // Advanced and unrezzed: an agenda, or a trap (Urtica Cipher does 2 + counters net damage)
      if (card.advancementCounters > 0 && caution > 0 && state.runner.grip.length <= 2 + card.advancementCounters + handMargin) return 0;
      // The more traps, the less likely it's the agenda we're hoping for
      value += (3 + 2.5 * Math.min(card.advancementCounters, 4)) * (wary ? Math.min(1.2, Math.max(0.6, 1 - (caution - 1) * 0.33)) : 1);
      // Deck-aware AI: 2+ counters and the Corp could finish it next turn, so now is the time
      if (urgent && card.advancementCounters >= 2) value += 2;
    } else {
      const trash = cardDef(card).trash_cost;
      if (trash != null && trash <= state.runner.credits) value += Math.max(0.5, corpCardValue(card) - trash) * 0.6;
    }
  }
  // Deck-aware AI: close to losing, every access matters more
  if (urgent && state.corp.score >= 5) value *= 1 + 0.1 * (state.corp.score - 4);
  return value;
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
  /** Credits gained if the run is successful (Clean Getaway). */
  successBonus?: number;
  /** Shred: the first "end the run" is prevented unless the Corp trashes cards from HQ. */
  shred?: boolean;
  /** Deck-aware AI: weigh trap risk by the traps this Corp may still have (see trapOdds). */
  wary?: boolean;
  /** Deck-aware AI: urgency on agendas the Corp could finish next turn, and late-game defence. */
  urgent?: boolean;
  memory?: RunnerMemory;
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
  for (const ice of server.ice) {
    if (!ice.isRezzed) continue;
    const cost = iceCost(state, ice);
    if (cost === BLOCK) return null;
    known += cost;
  }
  // Manegarm Skunkworks: 5 credits too when a run won't leave 2 clicks for it
  if (state.runner.clicks - 1 - bioroidClicks(state, server.ice) < 2) known += 5 * server.root.filter(c => c.isRezzed && c.cardCode === MANEGARM).length;
  return known - availableCredits(state, 'runner');
}

/**
 * How good a run on this server is now, net of the click and expected costs.
 * -Infinity when the Runner can't get in.
 */
export function runScore(state: GameState, serverId: string, options: RunOptions = {}): number {
  const server = state.corp.servers[serverId];
  if (!server) return -Infinity;
  let value = serverValue(state, serverId, options.extraAccesses ?? 0, options.memory, options.wary, options.urgent) + 0.8 * (options.successBonus ?? 0);
  if (state.runner.grip.length <= 1) value -= 2; // one net damage from flatlining
  if (value <= 0) return -Infinity;
  let known = 0;
  let expected = 0;
  let shredLeft = !!options.shred && server.root.length > 0;
  const budget = availableCredits(state, 'runner') + (options.bonusCredits ?? 0);
  // Runner (rez allowance): credits paid on the way in are lost if unrezzed ice further in is rezzed and can't be paid for
  let paidOutside = 0;
  let waste = 0;
  const canRez = state.corp.credits >= (options.rezTax ? 4 : 1);
  for (const ice of [...server.ice].reverse()) {
    if (ice.isRezzed) paidOutside += Math.min(iceCreditNeed(state, ice), budget);
    else if (tuning.plan.rezAllowance && canRez && paidOutside > 0) {
      const spare = budget - paidOutside;
      waste += paidOutside * (spare < 2 ? 0.5 : spare < 4 ? 0.25 : 0.1);
    }
  }
  for (const ice of server.ice) {
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
  return value - 0.6 * paid - 0.6 * waste - approach.cost - 1;
}

/** Rezzed ice the Runner gets through for this much or less is worth trashing to make room. */
const WEAK_ICE = 2;

/** The rezzed ice on a server that is cheapest for the Runner to get through, if it is weak enough to trash. */
export function weakestIce(state: GameState, serverId: string): CardInstance | undefined {
  const rezzed = (state.corp.servers[serverId]?.ice ?? []).filter(ice => ice.isRezzed).map(ice => ({ ice, cost: iceCost(state, ice) }));
  rezzed.sort((a, b) => a.cost - b.cost);
  return rezzed[0] && rezzed[0].cost <= WEAK_ICE ? rezzed[0].ice : undefined;
}
