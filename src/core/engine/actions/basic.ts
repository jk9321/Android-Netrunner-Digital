import { DrawCardAction, GainCreditAction, PurgeVirusAction, RemoveTagAction, TrashResourceAction } from '../../types/actions';
import { GameState } from '../../types/state';
import { CardInstance } from '../../types/card';
import { cardDef } from '../../cards';
import { addLog } from '../log';
import { drawCards, illegal, requireActionPhase, requireClicks } from '../helpers';
import { getCardScript } from '../../scripts';
import { activeCards } from '../triggers';
import { bumpTurnFlag, corpTrashFromHQ, purgeVirusCounters, removeTags, TurnFlag } from '../cardEffects';
import { pushPrompt } from '../prompts';
import { trashInstalledRunnerCard } from '../damage';

export function gainCredit(state: GameState, action: GainCreditAction): void {
  const side = action.player;
  requireActionPhase(state, side);
  requireClicks(state, side);
  state[side].clicks -= 1;
  state[side].credits += 1;
  addLog(state, side, `${side === 'corp' ? 'Corp' : 'Runner'} spent [click] to gain 1 credit.`);
}

export function drawCard(state: GameState, action: DrawCardAction): void {
  requireActionPhase(state, action.player);
  requireClicks(state, action.player);
  if (action.player === 'corp') {
    if (state.corp.rd.length === 0) {
      state.winner = 'runner';
      state.winReason = 'Corp decked out (R&D is empty)';
      addLog(state, 'system', 'Runner wins: Corp attempted to draw from an empty R&D.');
      return;
    }
    state.corp.clicks -= 1;
    const drawn = state.corp.rd.shift()!;
    state.corp.hq.push(drawn);
    addLog(state, 'corp', 'Corp spent [click] to draw 1 card.');
  } else {
    if (state.runner.stack.length === 0) illegal('Stack is empty');
    state.runner.clicks -= 1;
    // Replacement effects such as Verbal Plasticity change how many cards the basic action draws.
    const first = bumpTurnFlag(state, TurnFlag.basicDraws) === 1;
    const count = activeCards(state, 'runner').reduce(
      (n, c) => Math.max(n, (first && getCardScript(c.cardCode)?.modifiers?.firstBasicDraw) || 1),
      1
    );
    const before = state.runner.grip.length;
    drawCards(state, 'runner', count);
    const drawn = state.runner.grip.slice(before);
    addLog(state, 'runner', `Runner spent [click] to draw ${drawn.length} card(s).`);
  }
}

/** Runner basic action: [click] + 2 credits: remove 1 tag. */
export function removeTag(state: GameState, action: RemoveTagAction): void {
  if (action.player !== 'runner') illegal('Only the Runner can remove tags');
  requireActionPhase(state, 'runner');
  requireClicks(state, 'runner');
  if (state.runner.tags === 0) illegal('The Runner has no tags');
  if (state.runner.credits < 2) illegal('Need 2 credits to remove a tag');
  state.runner.clicks -= 1;
  state.runner.credits -= 2;
  addLog(state, 'runner', `Runner spent [click] and 2 [credit] to remove 1 tag (now ${state.runner.tags - 1}).`);
  removeTags(state, 1);
}

/** Corp basic action: [click] + 2 credits: trash 1 installed resource, if the Runner is tagged. */
export function trashResource(state: GameState, action: TrashResourceAction): void {
  if (action.player !== 'corp') illegal('Only the Corp can trash resources this way');
  requireActionPhase(state, 'corp');
  requireClicks(state, 'corp');
  if (state.runner.tags === 0) illegal('The Runner must be tagged');
  if (state.corp.credits < 2) illegal('Need 2 credits to trash a resource');
  const card = state.runner.rig.resources.find(c => c.instanceId === action.cardInstanceId);
  if (!card) illegal('Not an installed resource');
  // Additional cost: cards from HQ (Sebastião Souza Pessoa, Manuel Lattes de Moura)
  const imposers = hqCostImposers(state, card);
  const hqCost = resourceTrashHqCost(state, card);
  if (state.corp.hq.length < hqCost) illegal(`Trashing ${cardDef(card).title} also costs ${hqCost} card(s) from HQ`);
  state.corp.clicks -= 1;
  state.corp.credits -= 2;
  if (hqCost > 0) {
    pushPrompt(state, {
      kind: 'effect_cards',
      side: 'corp',
      message: `Trash ${hqCost} card(s) from HQ to trash ${cardDef(card).title} (${cardDef(imposers[0]).title}).`,
      candidateIds: state.corp.hq.map(c => c.instanceId),
      min: hqCost,
      max: hqCost,
      source: { cardCode: imposers[0].cardCode, instanceId: imposers[0].instanceId, step: RESOURCE_TRASH_STEP, data: { resourceId: card.instanceId } },
    });
    return;
  }
  trashInstalledRunnerCard(state, card);
  addLog(state, 'corp', `Corp spent [click] and 2 [credit] to trash ${cardDef(card).title}.`);
}

const hqCostImposers = (state: GameState, resource: CardInstance) =>
  activeCards(state).filter(c => (getCardScript(c.cardCode)?.modifiers?.resourceTrashHqCost?.(state, c, resource) ?? 0) > 0);

/** Cards the Corp must also trash from HQ to trash this resource with the basic action (Sebastião Souza Pessoa, Manuel Lattes de Moura). */
export function resourceTrashHqCost(state: GameState, resource: CardInstance): number {
  return hqCostImposers(state, resource).reduce((n, c) => n + getCardScript(c.cardCode)!.modifiers!.resourceTrashHqCost!(state, c, resource), 0);
}

/** The step of the engine's "trash cards from HQ to trash this resource" prompt (see trashResource). */
export const RESOURCE_TRASH_STEP = 'resource-trash-cost';

/** The Corp paid the HQ cards: the resource is trashed. */
export function finishResourceTrash(state: GameState, resourceId: string, hqIds: string[]): void {
  corpTrashFromHQ(state, hqIds);
  const card = state.runner.rig.resources.find(c => c.instanceId === resourceId);
  if (!card) return;
  trashInstalledRunnerCard(state, card);
  addLog(state, 'corp', `Corp spent [click], 2 [credit] and ${hqIds.length} card(s) from HQ to trash ${cardDef(card).title}.`);
}

/** Corp basic action: [click][click][click]: purge virus counters. */
export function purgeVirus(state: GameState, action: PurgeVirusAction): void {
  if (action.player !== 'corp') illegal('Only the Corp can purge virus counters');
  requireActionPhase(state, 'corp');
  requireClicks(state, 'corp', 3);
  state.corp.clicks -= 3;
  const removed = purgeVirusCounters(state);
  addLog(state, 'corp', `Corp spent [click][click][click] to purge virus counters (${removed} removed).`);
}
