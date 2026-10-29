import { CardInstance } from '../core/types/card';
import { GameState } from '../core/types/state';
import { cardDef } from '../data/cards';
import { getCardScript } from '../core/scripts';
import { breakerStrength, iceStrength } from '../core/engine/ice';
import { installedIce } from '../core/engine/cardEffects';
import { runnerInstallCost } from '../core/engine/actions/install';

/**
 * Hypothetical state with this program in the rig, for breakers that count
 * installed icebreakers "including this one" (Echelon, Unity) while in the grip.
 */
function withInstalled(state: GameState, card: CardInstance): GameState {
  return { ...state, runner: { ...state.runner, rig: { ...state.runner.rig, programs: [...state.runner.rig.programs, card] } } };
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
