import { CardInstance, GameState, cardDef } from '../core';
import { rezCost } from '../core/engine/cardEffects';
import { tuning } from './synergy';

/**
 * Free rezzes the Corp can count on (plan.freeRez, Jeff 2026-10-31: "cheat
 * out" expensive ice). "Rez 1 installed piece of ice, ignoring all costs"
 * removes the whole rez cost (rules 1.16.5c), so the ice it rezzes is best
 * the costliest one: Pharos for free, not Palisade.
 *
 * - Send a Message (30069): installed, it rezzes an ice when scored, and
 *   also when stolen (the Runner must steal an agenda it accesses, rules
 *   7.1.6 and 7.2.3), so one is coming either way.
 * - Unleash (36044) in HQ while the Runner has a tag to remove (its
 *   additional cost).
 *
 * Each such source lets one unrezzed ice the Corp can't pay for still count
 * as ice it will have: the costliest ones, one per source.
 */
export const SEND_A_MESSAGE = '30069';
export const UNLEASH = '36044';

export const freeRezOn = (): boolean => !!tuning.plan.freeRez;

/** Free rezzes the Corp can count on: installed Send a Message, and Unleash in HQ it can pay for with a Runner tag. */
export function pendingFreeRezzes(state: GameState): number {
  const corp = state.corp;
  let n = 0;
  for (const server of Object.values(corp.servers)) n += server.root.filter(c => c.cardCode === SEND_A_MESSAGE).length;
  n += Math.min(state.runner.tags, corp.hq.filter(c => c.cardCode === UNLEASH).length);
  return n;
}

/**
 * Installed unrezzed ice (and `extra`, an ice about to be installed) that the
 * pending free rezzes will pay for: the costliest ones, one per free rez.
 */
export function freeRezTargets(state: GameState, extra?: CardInstance): Set<string> {
  const n = freeRezOn() ? pendingFreeRezzes(state) : 0;
  if (n === 0) return new Set();
  const unrezzed = Object.values(state.corp.servers)
    .flatMap(s => s.ice)
    .filter(c => !c.isRezzed)
    .map(c => ({ id: c.instanceId, cost: rezCost(state, c) }));
  if (extra) unrezzed.push({ id: extra.instanceId, cost: cardDef(extra).cost ?? 0 });
  unrezzed.sort((a, b) => b.cost - a.cost);
  return new Set(unrezzed.slice(0, n).map(x => x.id));
}

/** Rez credits the pending free rezzes cover among installed unrezzed ice and `extra`. */
export function freeRezCover(state: GameState, extra?: CardInstance): number {
  const targets = freeRezTargets(state, extra);
  if (targets.size === 0) return 0;
  let cover = 0;
  for (const ice of Object.values(state.corp.servers).flatMap(s => s.ice)) if (targets.has(ice.instanceId)) cover += rezCost(state, ice);
  if (extra && targets.has(extra.instanceId)) cover += cardDef(extra).cost ?? 0;
  return cover;
}
