import { CardInstance } from '../../../types/card';
import { cardDef } from '../../../cards';
import { EffectContext } from '../../types';

export const isSelf = (ctx: EffectContext, card: CardInstance) => card.instanceId === ctx.card.instanceId;

export const keywords = (card: CardInstance) => cardDef(card).keywords ?? '';

export const onceKey = (card: CardInstance) => `once:${card.instanceId}`;
