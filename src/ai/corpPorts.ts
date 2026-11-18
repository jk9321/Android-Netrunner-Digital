import type { CardInstance, GameState } from '../core';

/**
 * The one seam where the valuation layer and prompts.ts read Corp owners (Stage B review R8): readers of the owners, not
 * copies. corpAI.ts fills it once as it loads, so corp/ sits in no import cycle. An unset port throws; no fallback.
 * keep and holdingRezIds: corp/rezMoney.ts; perfectRecallTarget: corp/rez.ts; freeInstallTarget: the order's first
 * install at place's destination, for the prompts (corp/candidates.ts, Stage C1b; Stage D3 moves prompts.ts onto it).
 * runStands: where the Runner stands in a run and the hold owner's verdict from there (corp/hold.ts, its walk key with
 * it); runLoss: what letting the Runner in takes (corp/pools.ts). Both for prompts.ts's run term (Stage D item 1 follow-up 3).
 */
export interface CorpPorts {
  keep(state: GameState): number;
  holdingRezIds(state: GameState): Record<string, string[]>;
  freeInstallTarget(state: GameState, card: CardInstance, options: string[]): { server: string; score: number } | undefined;
  perfectRecallTarget(state: GameState): string | undefined;
  runStands(state: GameState, server: string): { key: string; verdict(): 'in' | 'out' } | null;
  runLoss(state: GameState): number;
}
const unset = (name: string) => (): never => {
  throw new Error(`corpPorts.${name} is not registered: src/ai/corpAI.ts (which fills it from corp/) has not loaded; import src/ai, not one module alone`);
};
export const corpPorts: CorpPorts = { keep: unset('keep'), holdingRezIds: unset('holdingRezIds'), freeInstallTarget: unset('freeInstallTarget'), perfectRecallTarget: unset('perfectRecallTarget'), runStands: unset('runStands'), runLoss: unset('runLoss') };
export const registerCorpPorts = (ports: CorpPorts): void => void Object.assign(corpPorts, ports);
