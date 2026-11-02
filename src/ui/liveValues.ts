import { createContext, useContext } from 'react';
import { CardInstance } from '../core/types/card';
import { GameState } from '../core/types/state';
import { cardDef, getCardDefinition } from '../core/cards';
import { getCardScript } from '../core/scripts';
import { breakerStrength, iceStrength } from '../core/engine/ice';
import { availableCredits, counters, creditSources, installedIce, rezCost } from '../core/engine/cardEffects';
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

export interface RunPoolBreakdown {
  total: number;
  pool: number;
  bonus: number;
  poolLocked: boolean;
  sources: { label: string; amount: number }[];
}

/**
 * Computes spendable credit pools during an active run when they differ from a
 * player's normal credit pool (e.g. Overclock, Bad Publicity, Methuselah,
 * Touchstone, Aircheck locking the Runner's pool, or Corp's Mahkota Langit Grid
 * on the attacked server).
 */
export function runCreditPools(state: GameState): { runner?: RunPoolBreakdown; corpRez?: RunPoolBreakdown } {
  const run = state.activeRun;
  if (!run || run.accessOnly) return {};
  const out: { runner?: RunPoolBreakdown; corpRez?: RunPoolBreakdown } = {};

  // 1. Runner spendable run pool
  const runnerSources: { label: string; amount: number }[] = [];
  if ((run.badPublicityCredits ?? 0) > 0) {
    runnerSources.push({ label: 'bad publicity', amount: run.badPublicityCredits! });
  }
  if (run.bonusCredits > 0) {
    const eventTitle = run.eventCode ? getCardDefinition(run.eventCode).title : 'run bonus';
    runnerSources.push({ label: eventTitle, amount: run.bonusCredits });
  }
  for (const src of creditSources(state, 'runner', { kind: 'other' })) {
    const amt = counters(src, 'credit');
    if (amt > 0) runnerSources.push({ label: cardDef(src).title, amount: amt });
  }
  const runnerBonus = runnerSources.reduce((n, s) => n + s.amount, 0);
  const poolLocked = !!run.poolLocked;
  const runnerTotal = availableCredits(state, 'runner');
  if (runnerTotal !== state.runner.credits || poolLocked || runnerSources.length > 0) {
    out.runner = {
      total: runnerTotal,
      pool: state.runner.credits,
      bonus: runnerBonus,
      poolLocked,
      sources: runnerSources,
    };
  }

  // 2. Corp server-specific rez pool on the attacked server (e.g. Mahkota Langit Grid)
  const server = state.corp.servers[run.server];
  if (server) {
    const sampleTargets = [...server.ice, ...server.root.filter(c => cardDef(c).type_code === 'asset')];
    const seen = new Set<string>();
    const corpSources: { label: string; amount: number }[] = [];
    for (const target of sampleTargets) {
      for (const src of creditSources(state, 'corp', { kind: 'rez', card: target })) {
        if (seen.has(src.instanceId)) continue;
        seen.add(src.instanceId);
        const amt = counters(src, 'credit');
        if (amt > 0) corpSources.push({ label: cardDef(src).title, amount: amt });
      }
    }
    const corpBonus = corpSources.reduce((n, s) => n + s.amount, 0);
    if (corpBonus > 0) {
      out.corpRez = {
        total: state.corp.credits + corpBonus,
        pool: state.corp.credits,
        bonus: corpBonus,
        poolLocked: false,
        sources: corpSources,
      };
    }
  }

  return out;
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
