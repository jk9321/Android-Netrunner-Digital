import { UseAbilityAction } from '../../types/actions';
import { GameState } from '../../types/state';
import { cardDef } from '../../cards';
import { getCardScript } from '../../scripts';
import { addLog } from '../log';
import { illegal, requireActionPhase, requireClicks } from '../helpers';
import { activeCards } from '../triggers';
import { CardInstance, SideCode } from '../../types/card';
import { CardAbility } from '../../scripts/types';
import { effectResolved, effectResolving } from '../uncommitted';
import { availableCredits, counters, removeCounters, removeFromGame, spendCredits, trashInstalledCard, turnFlag } from '../cardEffects';

/** Turn-flag key for a "once per turn" ability. */
export function abilityUsedKey(instanceId: string, index: number): string {
  return `ability:${instanceId}:${index}`;
}

type AbilityZone = 'active' | 'archives' | 'runnerScoreArea' | 'hq';

/**
 * Cards whose abilities `side` might use: its active cards, the Corp's
 * cards in Archives (Petty Cash) and agendas in the Runner's score area
 * (Next Big Thing), and the other side's cards with "any player" abilities (Detente).
 */
export function abilitySources(state: GameState, side: SideCode): { card: CardInstance; where: AbilityZone }[] {
  const has = (card: CardInstance, test: (a: CardAbility) => boolean) => (getCardScript(card.cardCode)?.abilities ?? []).some(test);
  const sources: { card: CardInstance; where: AbilityZone }[] = activeCards(state, side).map(card => ({ card, where: 'active' }));
  const other: SideCode = side === 'corp' ? 'runner' : 'corp';
  for (const card of activeCards(state, other)) if (has(card, a => !!a.anyPlayer)) sources.push({ card, where: 'active' });
  if (side === 'corp') {
    const { faceUp, faceDown } = state.corp.archives;
    for (const card of [...faceUp, ...faceDown]) if (has(card, a => !!a.fromArchives)) sources.push({ card, where: 'archives' });
    for (const card of state.runner.scoreArea) if (has(card, a => !!a.fromRunnerScoreArea)) sources.push({ card, where: 'runnerScoreArea' });
    for (const card of state.corp.hq) if (has(card, a => !!a.fromHQ)) sources.push({ card, where: 'hq' });
  }
  return sources;
}

/** Can this ability be used from where its card is, by its controller (own) or the other player? */
export function abilityUsableFrom(ability: CardAbility, where: AbilityZone, own: boolean): boolean {
  if (where === 'archives') return !!ability.fromArchives;
  if (ability.fromArchives) return false;
  if (where === 'hq') return !!ability.fromHQ;
  if (ability.fromHQ) return false;
  if (where === 'runnerScoreArea') return !!ability.fromRunnerScoreArea;
  return own || !!ability.anyPlayer;
}

/**
 * Uses an ability on an active card. Click abilities follow the timing of
 * click actions (controller's action phase, not during a run); other paid
 * abilities can be used whenever the controller could act.
 */
export function useAbility(state: GameState, action: UseAbilityAction): void {
  const source = abilitySources(state, action.player).find(s => s.card.instanceId === action.cardInstanceId);
  if (!source) illegal('That card is not active');
  const card = source.card;
  const ability = getCardScript(card.cardCode)?.abilities?.[action.abilityIndex];
  if (!ability || !abilityUsableFrom(ability, source.where, cardDef(card).side_code === action.player)) illegal('No such ability');
  const side = action.player;
  const ctx = { state, card, side };
  const title = cardDef(card).title;

  const clicks = ability.clicks ?? 0;
  if (clicks > 0) {
    requireActionPhase(state, side);
    requireClicks(state, side, clicks);
  }
  const key = abilityUsedKey(card.instanceId, action.abilityIndex);
  if (ability.oncePerTurn && turnFlag(state, key) > 0) illegal(`${title}: once per turn`);
  const credits = ability.credits ?? 0;
  const purpose = ability.stealthOnly ? ({ kind: 'stealth' } as const) : undefined;
  if (availableCredits(state, side, purpose) < credits) illegal(ability.stealthOnly ? `Need ${credits} credits from stealth cards` : `Need ${credits} credits`);
  if (ability.counters && counters(card, ability.counters.type) < ability.counters.count) {
    illegal(`${title} needs ${ability.counters.count} ${ability.counters.type} counter(s)`);
  }
  const reason = ability.canUse?.(ctx);
  if (reason) illegal(reason);

  state[side].clicks -= clicks;
  spendCredits(state, side, credits, purpose);
  if (ability.counters) removeCounters(card, ability.counters.type, ability.counters.count);
  if (ability.oncePerTurn) state.turnFlags[key] = 1;
  addLog(state, side, `${side === 'corp' ? 'Corp' : 'Runner'} used ${title}: ${ability.label}`, card.cardCode);

  effectResolving(state);
  ability.resolve(ctx);
  effectResolved(state);
  if (ability.trashSelf) trashInstalledCard(state, card);
  if (ability.removeSelfFromGame) removeFromGame(state, card);
}
