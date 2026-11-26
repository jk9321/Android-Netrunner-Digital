import { CardInstance, PromptChoice, findCardAnywhere } from '../../core';

/** The cards a prompt offers, as found on the state (an entry's `promptAnswer`; B3 commit 1). */
export const promptCards = (state: Parameters<typeof findCardAnywhere>[0], ids: string[]): CardInstance[] => ids.map(id => findCardAnywhere(state, id)).filter((c): c is CardInstance => !!c);

/** An effect_cards answer of one card, or of none. */
export const cardsPick = (card?: CardInstance): PromptChoice => ({ kind: 'effect_cards', cardInstanceIds: card ? [card.instanceId] : [] });
