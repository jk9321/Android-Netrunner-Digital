import { CardInstance, GameState, cardDef } from '../core';
import { rezCost } from '../core/engine/cardEffects';
import { CARDS } from './cards';

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
 *   additional cost): a card whose tag use (CardAI tagUse, F119) rezzes
 *   ice, each use paid with the tags it spends.
 *
 * Each such source lets one unrezzed ice the Corp can't pay for still count
 * as ice it will have: the costliest ones, one per source.
 */
export const SEND_A_MESSAGE = '30069';

/** Free rezzes the Corp can count on: installed Send a Message, and a free-rez tag use in HQ (Unleash) it can pay for with
 * the Runner's tags. Corp-view only: it reads HQ. */
export function pendingFreeRezzes(state: GameState): number {
  const corp = state.corp;
  let n = 0;
  for (const server of Object.values(corp.servers)) n += server.root.filter(c => c.cardCode === SEND_A_MESSAGE).length;
  // F119: each use from HQ while the tags left meet its need, paying the tags it spends (Unleash: 1 each, so min(tags, copies))
  let tags = state.runner.tags;
  for (const card of corp.hq) {
    const use = CARDS[card.cardCode]?.tagUse;
    if (!use || use.from !== 'hq' || tags < use.needs) continue;
    const rezzes = use.does(state, tags).freeRez ?? 0;
    if (rezzes <= 0) continue;
    n += rezzes;
    tags -= use.spends(state, tags);
  }
  return n;
}

/**
 * Installed unrezzed ice (and `extra`, an ice about to be installed) that the
 * pending free rezzes will pay for: the costliest ones, one per free rez.
 */
export function freeRezTargets(state: GameState, extra?: CardInstance): Set<string> {
  const n = pendingFreeRezzes(state);
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
