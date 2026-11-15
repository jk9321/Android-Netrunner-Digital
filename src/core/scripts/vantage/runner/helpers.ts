import { CardInstance } from '../../../types/card';
import { GameState } from '../../../types/state';
import { cardDef } from '../../../cards';
import { installedRunnerCards } from '../../../engine/damage';
import { EffectContext } from '../../types';

export const isSelf = (ctx: EffectContext, card: CardInstance) => card.instanceId === ctx.card.instanceId;

export const keywords = (card: CardInstance) => cardDef(card).keywords ?? '';

export const ids = (cards: CardInstance[]) => cards.map(c => c.instanceId);

export const onceKey = (card: CardInstance) => `once:${card.instanceId}`;

export const isInstalled = (state: GameState, card: CardInstance) => installedRunnerCards(state).some(c => c.instanceId === card.instanceId);
