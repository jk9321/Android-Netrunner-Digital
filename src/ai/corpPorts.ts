import type { CardInstance, GameState } from '../core';

/**
 * The one seam where the valuation layer and prompts.ts read Corp owners (Stage B review R8): readers of the owners, not
 * copies. corpAI.ts fills it once as it loads, so corp/ sits in no import cycle. An unset port throws; no fallback.
 * keep and holdingRezIds: corp/rezMoney.ts; perfectRecallTarget: corp/rez.ts; freeInstallTarget: the ranking's install
 * choice for the prompts (corpAI.ts; Stage D3 deletes this port).
 */
export interface CorpPorts {
  keep(state: GameState): number;
  holdingRezIds(state: GameState): Record<string, string[]>;
  freeInstallTarget(state: GameState, card: CardInstance, options: string[]): { server: string; score: number } | undefined;
  perfectRecallTarget(state: GameState): string | undefined;
}
const unset = (name: string) => (): never => {
  throw new Error(`corpPorts.${name} is not registered: src/ai/corpAI.ts (which fills it from corp/) has not loaded; import src/ai, not one module alone`);
};
export const corpPorts: CorpPorts = { keep: unset('keep'), holdingRezIds: unset('holdingRezIds'), freeInstallTarget: unset('freeInstallTarget'), perfectRecallTarget: unset('perfectRecallTarget') };
export const registerCorpPorts = (ports: CorpPorts): void => void Object.assign(corpPorts, ports);
