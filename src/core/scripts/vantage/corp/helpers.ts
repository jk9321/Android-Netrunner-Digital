import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { findInstalledCorpCard, removeCard } from '../../../engine/helpers';
import { EffectContext } from '../../types';

export const isSelf = (ctx: EffectContext, card: CardInstance) => card.instanceId === ctx.card.instanceId;

export const type = (card: CardInstance) => cardDef(card).type_code;

export const keywords = (card: CardInstance) => cardDef(card).keywords ?? '';

export const title = (card: CardInstance) => cardDef(card).title;

export const ids = (cards: CardInstance[]) => cards.map(c => c.instanceId);

export const onceKey = (card: CardInstance, n = 0) => `once:${card.instanceId}:${n}`;

export const archivesCards = (state: GameState) => [...state.corp.archives.faceUp, ...state.corp.archives.faceDown];

export const serverOf = (state: GameState, card: CardInstance) => findInstalledCorpCard(state, card.instanceId)?.server;

export const isCentral = (serverId: string) => serverId === 'hq' || serverId === 'rd' || serverId === 'archives';

/** A run is in progress against this card's server (not Detente's access outside a run). */
export const runOnServerOf = (state: GameState, card: CardInstance) => {
  const run = state.activeRun;
  return !!run && !run.accessOnly && serverOf(state, card)?.id === run.server;
};

/** Removes a card from whichever of R&D, HQ or Archives holds it. */
export function takeFromCorpZone(state: GameState, card: CardInstance): void {
  const { rd, hq, archives } = state.corp;
  removeCard(rd, card) || removeCard(hq, card) || removeCard(archives.faceUp, card) || removeCard(archives.faceDown, card);
}
