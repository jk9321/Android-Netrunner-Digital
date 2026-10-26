import { CardDefinition, CardInstance, FactionCode } from '../core/types/card';
import { GameState } from '../core/types/state';
import { findCardAnywhere } from '../core';

export const FACTION_LABEL: Record<FactionCode, string> = {
  'haas-bioroid': 'Haas-Bioroid', jinteki: 'Jinteki', nbn: 'NBN', 'weyland-consortium': 'Weyland',
  'neutral-corp': 'Neutral', anarch: 'Anarch', criminal: 'Criminal', shaper: 'Shaper', 'neutral-runner': 'Neutral',
};

export const FACTION_COLOR: Record<FactionCode, string> = {
  'haas-bioroid': 'text-violet-400', jinteki: 'text-red-400', nbn: 'text-amber-300', 'weyland-consortium': 'text-emerald-400',
  'neutral-corp': 'text-slate-400', anarch: 'text-orange-400', criminal: 'text-blue-400', shaper: 'text-lime-400',
  'neutral-runner': 'text-slate-400',
};

/** The printed type line, e.g. "Ice: Barrier", or just "Upgrade" for a card with no subtypes. */
export function typeLine(def: CardDefinition): string {
  const type = def.type_code === 'ice' ? 'Ice' : def.type_code[0].toUpperCase() + def.type_code.slice(1);
  return def.keywords ? `${type}: ${def.keywords}` : type;
}

/**
 * Where a card sits, in words, e.g. "HQ, ice 2 of 2 (outermost)" or
 * "Rig, programs". Never names the card, so it is safe for facedown cards.
 */
export function cardPositionLabel(state: GameState, card: CardInstance): string | null {
  for (const server of Object.values(state.corp.servers)) {
    const i = server.ice.findIndex(c => c.instanceId === card.instanceId);
    if (i >= 0) {
      const n = server.ice.length;
      // Ice is counted out from the server: 1 is innermost, the last one is what a run meets first
      const end = n === 1 ? ' (only ice)' : i === 0 ? ' (innermost)' : i === n - 1 ? ' (outermost)' : '';
      return `${server.name}, ice ${i + 1} of ${n}${end}`;
    }
    const r = server.root.findIndex(c => c.instanceId === card.instanceId);
    if (r >= 0) {
      const where = server.isRemote ? `${server.name}, in the server` : `${server.name}, upgrade`;
      return server.root.length > 1 ? `${where} (${r + 1} of ${server.root.length})` : where;
    }
  }
  const { corp, runner } = state;
  const has = (zone: CardInstance[]) => zone.some(c => c.instanceId === card.instanceId);
  if (has(corp.hq)) return 'HQ (Corp hand)';
  if (has(corp.rd)) return 'R&D';
  if (has(corp.archives.faceUp) || has(corp.archives.faceDown)) return 'Archives';
  if (has(runner.grip)) return 'Grip (Runner hand)';
  if (has(runner.heap)) return 'Heap';
  if (has(runner.stack)) return 'Stack';
  const host = card.hostedOnId ? findCardAnywhere(state, card.hostedOnId) : undefined;
  const hostedOn = host ? `, on ${cardPositionLabel(state, host) ?? 'another card'}` : '';
  if (has(runner.rig.programs)) return `Rig, programs${hostedOn}`;
  if (has(runner.rig.hardware)) return `Rig, hardware${hostedOn}`;
  if (has(runner.rig.resources)) return `Rig, resources${hostedOn}`;
  if (has(corp.scoreArea)) return 'Corp score area';
  if (has(runner.scoreArea)) return 'Runner score area';
  return null;
}
