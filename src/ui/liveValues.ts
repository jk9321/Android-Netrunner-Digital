import { createContext, useContext } from 'react';
import { CardInstance } from '../core/types/card';
import { GameState } from '../core/types/state';
import { cardDef } from '../data/cards';
import { getCardScript } from '../core/scripts';
import { breakerStrength, iceStrength } from '../core/engine/ice';
import { installedIce, rezCost } from '../core/engine/cardEffects';
import { playableHostZones, runnerInstallCost } from '../core/engine/actions/install';
import { playCost } from '../core/engine/actions/play';
import { findCardAnywhere } from '../core/engine/helpers';

/** Provides the live GameState to CardView, CardPopout, and ServerColumn without prop-drilling. */
export const GameStateContext = createContext<GameState | null>(null);
export const useLiveGameState = () => useContext(GameStateContext);

export interface LiveCardModifiers {
  cost?: { current: number; printed: number; label: 'Install cost' | 'Play cost' | 'Rez cost' };
  strength?: { current: number; printed: number; onceInstalled?: boolean };
}

/**
 * Hypothetical state with this program in the rig, for breakers that count
 * installed icebreakers "including this one" (Echelon, Unity) while in the grip.
 */
function withInstalled(state: GameState, card: CardInstance): GameState {
  return { ...state, runner: { ...state.runner, rig: { ...state.runner.rig, programs: [...state.runner.rig.programs, card] } } };
}

/**
 * Computes any active cost or strength delta on `card` relative to its printed numbers.
 * Returns undefined fields when the live stat equals the printed stat, so the UI only
 * badges cards whose numbers are actively modified.
 */
export function liveCardModifiers(state: GameState, card: CardInstance): LiveCardModifiers {
  const liveCard = findCardAnywhere(state, card.instanceId) ?? card;
  const def = cardDef(liveCard);
  const script = getCardScript(liveCard.cardCode);
  const out: LiveCardModifiers = {};

  const inRig =
    state.runner.rig.programs.some(p => p.instanceId === liveCard.instanceId) ||
    state.runner.rig.hardware.some(h => h.instanceId === liveCard.instanceId) ||
    state.runner.rig.resources.some(r => r.instanceId === liveCard.instanceId);
  const inGrip =
    state.runner.grip.some(c => c.instanceId === liveCard.instanceId) ||
    playableHostZones(state).some(z => z.some(c => c.instanceId === liveCard.instanceId));
  const inHq = state.corp.hq.some(c => c.instanceId === liveCard.instanceId);
  const inIce = installedIce(state).some(i => i.instanceId === liveCard.instanceId);
  const inRoot = Object.values(state.corp.servers).some(s => s.root.some(r => r.instanceId === liveCard.instanceId));

  // 1. Cost modifiers (install cost in grip, play cost in grip/HQ, rez cost on unrezzed installed Corp card)
  if (inGrip && ['program', 'hardware', 'resource'].includes(def.type_code) && def.cost != null) {
    const current = runnerInstallCost(state, liveCard);
    if (current !== def.cost) out.cost = { current, printed: def.cost, label: 'Install cost' };
  } else if (((inGrip && def.type_code === 'event') || (inHq && def.type_code === 'operation')) && def.cost != null) {
    const current = playCost(state, liveCard);
    if (current !== def.cost) out.cost = { current, printed: def.cost, label: 'Play cost' };
  } else if ((inIce || inRoot) && !liveCard.isRezzed && def.cost != null && ['ice', 'asset', 'upgrade'].includes(def.type_code)) {
    const current = rezCost(state, liveCard);
    if (current !== def.cost) out.cost = { current, printed: def.cost, label: 'Rez cost' };
  }

  // 2. Strength modifiers (installed breaker, breaker in grip, or installed ice)
  if (script?.breaker && def.strength != null) {
    if (inRig) {
      const current = breakerStrength(state, liveCard);
      if (current !== def.strength) out.strength = { current, printed: def.strength };
    } else if (inGrip) {
      const current = breakerStrength(withInstalled(state, liveCard), liveCard);
      if (current !== def.strength) out.strength = { current, printed: def.strength, onceInstalled: true };
    }
  } else if (inIce && def.type_code === 'ice' && def.strength != null) {
    const current = iceStrength(state, liveCard);
    if (current !== def.strength) out.strength = { current, printed: def.strength };
  }

  return out;
}

/**
 * What a card's variable numbers come to right now ("+1 strength for each
 * fracter in your heap" and the like), for the hover zoom. Every value comes
 * from the engine's own functions or the card script's liveValue, never a
 * second copy of the card's formula. `card` must be the instance from `state`.
 */
export function liveValues(state: GameState, card: CardInstance): string[] {
  const def = cardDef(card);
  const script = getCardScript(card.cardCode);
  const lines: string[] = [];
  const inRig = state.runner.rig.programs.some(p => p.instanceId === card.instanceId);
  const inGrip = state.runner.grip.some(c => c.instanceId === card.instanceId);

  if (script?.breaker) {
    if (!inRig && !inGrip) return lines;
    // Static strength abilities apply only while the card is active (rule 9.4.1), so from the grip
    // say what the strength would be once installed
    const view = inRig ? state : withInstalled(state, card);
    const strength = breakerStrength(view, card);
    if (script.breaker.strengthModifier || strength !== (def.strength ?? 0)) {
      lines.push(`${inRig ? 'Strength' : 'Strength once installed'}: ${strength} (printed ${def.strength ?? 0})`);
    }
    const live = script.liveValue?.(view, card);
    if (live) lines.push(live);
  } else {
    const live = script?.liveValue?.(state, card);
    if (live) lines.push(live);
  }

  if (script?.ice?.strengthModifier && installedIce(state).some(i => i.instanceId === card.instanceId)) {
    lines.push(`Strength: ${iceStrength(state, card)} (printed ${def.strength ?? 0})`);
  }

  if (inGrip && ['program', 'hardware', 'resource'].includes(def.type_code)) {
    const cost = runnerInstallCost(state, card);
    if (cost !== (def.cost ?? 0)) lines.push(`Install cost now: ${cost}[credit] (printed ${def.cost ?? 0})`);
  }
  return lines;
}
