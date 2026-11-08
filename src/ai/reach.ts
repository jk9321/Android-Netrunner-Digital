import { CardInstance, GameState, cardDef } from '../core';
import { breakerScript, iceSubtypes, installedIcebreakers, isIcebreaker } from '../core/engine/ice';
import { passOddsOf } from './effectValues';
import { RUNNER_TURN_INCOME, rezBudget, REZ_NOW_SHARE } from './iceValues';
import { corpSeenGrip } from './oracle';
import { actingSide, plan, pricing, withPricing } from './pricing';
import { probedState, remoteRunChance, wouldRun } from './threatModel';
import { memo } from './valueModel';
import { RunOptions, runBypasses } from './runs';
import { runEventOptions } from './prompts';

/**
 * The Runner capability model (round 2 Phase 2 K, plan.reach; spec-phase2.md K, design-k1.md).
 *
 * The threat (threatModel.ts) budgets the Runner's next turn on the rig as it is: a breaker in the Runner's grip is never
 * installed there, and threatStanding's later turns add credits, never breakers. The Corp can't see the grip (rule
 * 10.2.2a hidden information; its size is open, 10.2.3a), but the decklists are public (as buildTarget assumes), so the
 * Runner's unseen cards, grip and stack together, are a known pool, and the grip is a uniform draw from it. reach asks,
 * for each breaker type a server's ice needs that the rig lacks, how likely the Runner is to hold or draw one by its
 * t-th turn (hypergeometric), and prices the server in each case with that breaker installed (rule 5.2.7d: a click and
 * its install cost) and the credits the Runner has by then. The expectation over those cases replaces the threat's
 * single guess.
 *
 * Inputs are the pool, the rig, the Runner's credits and what the Corp has seen. Nothing is read from the real grip's order or contents
 * beyond what corpSeenGrip allows.
 */

/** Cards the Runner draws a turn, besides its grip (rule 5.2.7c). Unverified: a first figure, to be measured from self-play. */
export const RUNNER_TURN_DRAWS = 1;

type BreakType = 'barrier' | 'code gate' | 'sentry';
const TYPES: BreakType[] = ['barrier', 'code gate', 'sentry'];

/** plan.reach for the deciding Corp, outside its own computation. */
export const reachOn = (): boolean => !!plan().reach && actingSide() === 'corp' && !pricing().reaching && pricing().computingThreat === 0 && !pricing().pricingIce;

/** P(at least one of `hits` cards among `n` dealt from `pool`): 1 - C(pool - hits, n) / C(pool, n). */
export function atLeastOne(pool: number, hits: number, n: number): number {
  if (hits <= 0 || n <= 0 || pool <= 0) return 0;
  if (n > pool - hits) return 1;
  let miss = 1;
  for (let i = 0; i < n; i++) miss *= (pool - hits - i) / (pool - i);
  return 1 - miss;
}

/** What a breaker breaks ('any' for an AI breaker). */
const breaks = (card: CardInstance): BreakType | 'any' | undefined => breakerScript(card)?.breaks as BreakType | 'any' | undefined;

interface Pool {
  /** The cards the Corp can't place: the unseen part of the grip and the stack. */
  unseen: CardInstance[];
  /** Grip cards the Corp has seen there. */
  seen: CardInstance[];
  /** Grip cards it hasn't. */
  gripUnseen: number;
}

function runnerPool(state: GameState): Pool {
  const known = corpSeenGrip(state, 'threat');
  const seen = state.runner.grip.filter(c => known.has(c.instanceId));
  const unseen = [...state.runner.grip.filter(c => !known.has(c.instanceId)), ...state.runner.stack];
  return { unseen, seen, gripUnseen: state.runner.grip.length - seen.length };
}

/** The breaker of a type the Runner is likeliest to find: the code with the most copies in the pool, then the cheapest. */
const representative = (cards: CardInstance[], type: BreakType | 'any'): CardInstance | undefined => mostCopies(cards.filter(c => isIcebreaker(c) && breaks(c) === type));

/** One way the Runner's rig may stand by its t-th turn, and how likely. */
export interface Case {
  weight: number;
  /** The breakers it has installed for this case (none: the rig as it is). */
  added: CardInstance[];
  /** The board with them installed, their costs paid and the Runner's income by then. */
  view: GameState;
  /** The run event it plays for this case, and the run's riders (runEventOptions). */
  event?: CardInstance;
  options?: RunOptions;
}

/** The ice of `serverId` as the Corp prices it: with plan.reachStrength its own unrezzed ice as the real ice when its rez budget covers it by then (rule 3.4.3a: rezzed on approach), else passed. */
function knownIce(state: GameState, serverId: string, t: number): CardInstance[] {
  const server = state.corp.servers[serverId];
  if (!server) return [];
  if (!plan().reachStrength) return server.ice;
  const budget = rezBudget(state);
  return server.ice.flatMap(ice => {
    if (ice.isRezzed) return [ice];
    const share = budget.get(ice.instanceId);
    const rezzable = share !== undefined && (share >= REZ_NOW_SHARE || t > 1);
    return rezzable ? [{ ...ice, isRezzed: true }] : [];
  });
}

/**
 * The cases for the Runner's t-th turn from now (t = 1: its next turn, or this one on its turn) on `serverId`: the rig as
 * it is, and each set of the missing breaker types it finds and of a run event that helps (taken as independent: the
 * pool is 30 cards or more).
 */
export function cases(state: GameState, serverId: string, t: number): Case[] {
  return memo(state, `reach:cases:${serverId}:${t}:${plan().reachStrength ? 's' : ''}`, () => {
    return withPricing({ reaching: true }, () => buildCases(state, serverId, t));
  });
}

function buildCases(state: GameState, serverId: string, t: number): Case[] {
  const ice = knownIce(state, serverId, t);
  const server = state.corp.servers[serverId];
  const corp = server ? { ...state.corp, servers: { ...state.corp.servers, [serverId]: { ...server, ice } } } : state.corp;
  const income = (t - 1) * RUNNER_TURN_INCOME;
  const base: GameState = { ...state, corp, runner: { ...state.runner, credits: state.runner.credits + income } };
  if (!ice.some(c => c.isRezzed)) return [{ weight: 1, added: [], view: base }];
  const rig = installedIcebreakers(state).map(breaks);
  const covered = (type: BreakType) => rig.includes(type) || rig.includes('any');
  const needed = TYPES.filter(type => !covered(type) && ice.some(c => c.isRezzed && iceSubtypes(c, state).includes(type)));
  const pool = runnerPool(state);
  const all = [...pool.seen, ...pool.unseen];
  const n = pool.gripUnseen + RUNNER_TURN_DRAWS * t;
  const odds = (fits: (c: CardInstance) => boolean) => (pool.seen.some(fits) ? 1 : atLeastOne(pool.unseen.length, pool.unseen.filter(fits).length, n));
  const found: { p: number; card?: CardInstance; event?: boolean }[] = needed.map(type => {
    const fits = (c: CardInstance) => isIcebreaker(c) && (breaks(c) === type || breaks(c) === 'any');
    return { p: odds(fits), card: representative(all, type) ?? representative(all, 'any') };
  });
  // A run event that helps get in (a bypass, a derez, credits for the run, Tread Lightly's tax: runEventOptions), the
  // pool's commonest one: played for a click and its cost (rule 5.2.7e)
  const helps = (c: CardInstance) => cardDef(c).type_code === 'event' && helpsIn(runEventOptions(c.cardCode, state));
  const event = mostCopies(all.filter(helps));
  if (event) found.push({ p: odds(c => c.cardCode === event.cardCode || helps(c)), card: event, event: true });
  if (!found.length) return [{ weight: 1, added: [], view: base }];
  const out: Case[] = [];
  for (let mask = 0; mask < 1 << found.length; mask++) {
    let weight = 1;
    const added: CardInstance[] = [];
    let played: CardInstance | undefined;
    found.forEach((f, i) => {
      const has = !!(mask & (1 << i));
      weight *= has ? f.p : 1 - f.p;
      if (!has || !f.card) return;
      if (f.event) played = f.card;
      else if (!added.some(a => a.cardCode === f.card!.cardCode)) added.push(f.card);
    });
    if (weight <= 0) continue;
    const cost = [...added, ...(played ? [played] : [])].reduce((sum, c) => sum + (cardDef(c).cost ?? 0), 0);
    const programs = [...base.runner.rig.programs, ...added.map((c, i) => ({ ...c, instanceId: `reach-${i}-${c.cardCode}`, isRezzed: true, faceUp: true, hostedOnId: undefined, tokens: {} }) as CardInstance)];
    // Each install is a click this turn (rule 5.2.7d), the event's play is the run's click; later turns have clicks to spare
    const clicks = t === 1 ? Math.max(0, base.runner.clicks - added.length) : base.runner.clicks;
    const changed = added.length || played;
    const view: GameState = changed
      ? { ...base, runner: { ...base.runner, credits: Math.max(0, base.runner.credits - cost), clicks, rig: { ...base.runner.rig, programs } } }
      : base;
    out.push({ weight, added, view, ...(played ? { event: played, options: runEventOptions(played.cardCode, view) } : {}) });
  }
  return out;
}

/** A run event's riders that make getting in easier. */
const helpsIn = (o: RunOptions): boolean => !!(o.bypassFirst || o.derezOne || o.alarmClock || o.shred || o.rezTax || (o.bonusCredits ?? 0) > 0);

/** The card with the most copies among `cards`, then the cheapest. */
function mostCopies(cards: CardInstance[]): CardInstance | undefined {
  const byCode = new Map<string, { card: CardInstance; n: number }>();
  for (const c of cards) {
    const e = byCode.get(c.cardCode);
    if (e) e.n++;
    else byCode.set(c.cardCode, { card: c, n: 1 });
  }
  return [...byCode.values()].sort((a, b) => b.n - a.n || (cardDef(a.card).cost ?? 0) - (cardDef(b.card).cost ?? 0))[0]?.card;
}

/**
 * A case's board for pricing the ice: the ice its run event bypasses taken out (runBypasses; rule 6.5.8a: bypassed ice
 * is passed) and its run credits added; the case's own view otherwise.
 */
function priced(c: Case, serverId: string): GameState {
  if (!c.options) return c.view;
  const server = c.view.corp.servers[serverId];
  if (!server) return c.view;
  const skipped = runBypasses(c.view, serverId, c.options).ids;
  const ice = server.ice.filter(i => !skipped.has(i.instanceId));
  return { ...c.view, corp: { ...c.view.corp, servers: { ...c.view.corp.servers, [serverId]: { ...server, ice } } }, runner: { ...c.view.runner, credits: c.view.runner.credits + (c.options.bonusCredits ?? 0) } };
}

/**
 * Chance the Runner gets in to `serverId` (runs it and passes its ice) on its t-th turn, over the cases: each case's
 * run (the threat's own decision on that rig: wouldRun; on the rig as it is at t = 1, the threat's budget itself) times
 * its pass odds (passOddsOf, the Corp's pricing of the ice against that rig: one pricing, not a copy).
 */
export function getIn(state: GameState, serverId: string, t = 1): number {
  return memo(state, `reach:getIn:${serverId}:${t}:${plan().reachStrength ? 's' : ''}`, () => {
    const probed = probedState(state, serverId);
    let total = 0;
    for (const c of cases(probed, serverId, t)) {
      // Both read with the threat's and the ice pricing's guards up, so neither asks reach again (reachOn)
      const plain = !c.added.length && !c.event;
      const run = plain && t === 1 ? remoteRunChance(state, serverId) : wouldRun(c.view, serverId, c.options);
      if (run > 0) total += c.weight * run * passOddsOf(priced(c, serverId), serverId);
    }
    return Math.max(0, Math.min(1, total));
  });
}

/** The chance an agenda in `serverId` stands through `turns` Runner turns (K3, plan.reachTime): each turn's getIn at that horizon. A scored agenda has left the board and pays nothing. */
export function reachStanding(state: GameState, serverId: string, turns: number): number {
  let standing = 1;
  for (let t = 1; t <= turns; t++) standing *= 1 - getIn(state, serverId, t);
  return standing;
}
