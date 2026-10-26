import { CardInstance } from '../types/card';
import { GameState } from '../types/state';
import { cardDef } from '../cards';
import { getCardScript } from '../scripts';
import { BreakerScript, IceScript, IceSubtype } from '../scripts/types';
import { addLog } from './log';
import { endRun } from './runEnd';
import { fireTrigger } from './triggers';

export function iceScript(ice: CardInstance): IceScript | undefined {
  return getCardScript(ice.cardCode)?.ice;
}

export function breakerScript(card: CardInstance): BreakerScript | undefined {
  return getCardScript(card.cardCode)?.breaker;
}

/** The ice's subtypes, including ones granted by programs hosted on it (Chromatophores) when `state` is given. */
export function iceSubtypes(ice: CardInstance, state?: GameState): IceSubtype[] {
  const keywords = (cardDef(ice).keywords ?? '').toLowerCase();
  const granted = state
    ? state.runner.rig.programs.filter(p => p.hostedOnId === ice.instanceId).flatMap(p => getCardScript(p.cardCode)?.grantsIceSubtypes ?? [])
    : [];
  return (['barrier', 'code gate', 'sentry'] as const).filter(t => keywords.includes(t) || granted.includes(t));
}

/** The cost of one use of a breaker's strength ability (Sang Kancil's depends on the run). */
export function boostCostOf(state: GameState, breaker: CardInstance): number {
  const cost = breakerScript(breaker)?.boostCost ?? 0;
  return typeof cost === 'function' ? cost(state, breaker) : cost;
}

export function isFracter(card: CardInstance): boolean {
  return /fracter/i.test(cardDef(card).keywords ?? '');
}

/**
 * Can a subroutine on this ice be broken by this breaker (null: by a card
 * ability that is not an icebreaker's, like Botulus)? Semak-samun only allows fracters.
 */
export function canBreakSubroutinesWith(ice: CardInstance, breaker: CardInstance | null): boolean {
  if (!iceScript(ice)?.fracterOnly) return true;
  return breaker !== null && isFracter(breaker);
}

export function isBioroid(ice: CardInstance): boolean {
  return /bioroid/i.test(cardDef(ice).keywords ?? '');
}

export function isIcebreaker(card: CardInstance): boolean {
  return /icebreaker/i.test(cardDef(card).keywords ?? '');
}

export function installedIcebreakers(state: GameState): CardInstance[] {
  return state.runner.rig.programs.filter(isIcebreaker);
}

export function iceStrength(state: GameState, ice: CardInstance): number {
  const encounter = state.activeRun?.encounter;
  const encounterMod = encounter?.iceId === ice.instanceId ? encounter.iceStrengthModifier : 0;
  return Math.max(0, (cardDef(ice).strength ?? 0) + (iceScript(ice)?.strengthModifier?.(state, ice) ?? 0) + encounterMod);
}

/** Current breaker strength, including boosts for the encounter in progress. */
export function breakerStrength(state: GameState, breaker: CardInstance): number {
  const base = (cardDef(breaker).strength ?? 0) + (breakerScript(breaker)?.strengthModifier?.(state, breaker) ?? 0);
  // Hosted hardware (GAMEDRAGON™ Pro) can change strength too
  const hosted = state.runner.rig.hardware
    .filter(h => h.hostedOnId === breaker.instanceId)
    .reduce((n, h) => n + (getCardScript(h.cardCode)?.modifiers?.hostStrength ?? 0), 0);
  const run = state.activeRun;
  return base + hosted + (run?.encounter?.boosts[breaker.instanceId] ?? 0) + (run?.runBoosts?.[breaker.instanceId] ?? 0);
}

/**
 * Adds strength to an icebreaker for this encounter, or for the rest of the
 * run if it hosts a card that says so (GAMEDRAGON™ Pro).
 */
export function addBreakerStrength(state: GameState, breaker: CardInstance, amount: number): void {
  const run = state.activeRun;
  if (!run) return;
  const forRun = state.runner.rig.hardware.some(
    h => h.hostedOnId === breaker.instanceId && getCardScript(h.cardCode)?.modifiers?.boostsLastForRun
  );
  if (forRun) run.runBoosts[breaker.instanceId] = (run.runBoosts[breaker.instanceId] ?? 0) + amount;
  else if (run.encounter) run.encounter.boosts[breaker.instanceId] = (run.encounter.boosts[breaker.instanceId] ?? 0) + amount;
}

/** The ice being encountered, if any. */
export function encounteredIce(state: GameState): CardInstance | undefined {
  const run = state.activeRun;
  if (!run?.encounter || run.icePosition === null) return undefined;
  return state.corp.servers[run.server].ice.find(c => c.instanceId === run.encounter!.iceId);
}

/** Starts an encounter with the approached (rezzed) ice and fires "when encountered" effects. */
export function beginEncounter(state: GameState, ice: CardInstance): void {
  const run = state.activeRun!;
  const subs = iceScript(ice)?.subroutines ?? [];
  run.phase = 'encounter_ice';
  run.encounter = {
    iceId: ice.instanceId,
    broken: subs.map(() => false),
    boosts: {},
    resolvingIndex: null,
    iceStrengthModifier: 0,
    onEncounterPending: true,
  };
  addLog(state, 'system', `Runner encounters ${cardDef(ice).title} (strength ${iceStrength(state, ice)}).`);
  // The Runner is the active player, so their "when you encounter" abilities resolve first (Fransofia Ward)
  fireTrigger(state, { type: 'encounter_ice', ice });
  resumeOnEncounter(state);
}

/** Resolves the encountered ice's own "when encountered" ability once nothing else is pending. */
export function resumeOnEncounter(state: GameState): void {
  const encounter = state.activeRun?.encounter;
  if (!encounter?.onEncounterPending || state.pendingPrompts.length > 0 || state.winner) return;
  encounter.onEncounterPending = false;
  const ice = encounteredIce(state);
  if (ice) iceScript(ice)?.onEncounter?.({ state, card: ice, side: 'corp' });
}

/** Bypass the encountered ice: pass it with no subroutines or further "when encountered" abilities. */
export function bypassIce(state: GameState): void {
  const ice = encounteredIce(state);
  if (!ice) return;
  addLog(state, 'runner', `Runner bypassed ${cardDef(ice).title}.`);
  passIce(state);
}

/**
 * The Runner is done breaking: resolve unbroken subroutines in order. A
 * subroutine may queue a prompt; resolution then pauses and resumes from
 * resumeEncounter() once the prompt is answered.
 */
export function startSubroutineResolution(state: GameState): void {
  state.activeRun!.encounter!.resolvingIndex = 0;
  continueSubroutines(state);
}

/** Called after any prompt is answered, to pick up a paused encounter. */
export function resumeEncounter(state: GameState): void {
  if (state.pendingPrompts.length > 0 || state.winner) return;
  if (state.activeRun?.encounter?.resolvingIndex != null) continueSubroutines(state);
}

function continueSubroutines(state: GameState): void {
  while (true) {
    const run = state.activeRun;
    const encounter = run?.encounter;
    if (!run || !encounter || encounter.resolvingIndex === null) return; // run ended
    const ice = encounteredIce(state);
    const subs = ice ? iceScript(ice)?.subroutines ?? [] : [];
    const i = encounter.resolvingIndex;
    if (!ice || i >= subs.length) break;
    encounter.resolvingIndex = i + 1;
    if (encounter.broken[i]) continue;
    run.subroutineResolved = true;
    addLog(state, 'corp', `${cardDef(ice).title} subroutine fires: ${subs[i].label}`);
    subs[i].resolve({ state, card: ice, side: 'corp' });
    if (state.winner) return;
    if (state.pendingPrompts.length > 0) return; // resumes after the answer
  }
  passIce(state);
}

/**
 * Finishes the encounter (or the approach of unrezzed ice): the Runner passes
 * the ice and the run moves to the Movement Phase, where they may jack out
 * before going on (rules 6.9.4a-c).
 */
export function passIce(state: GameState): void {
  const run = state.activeRun;
  if (!run) return;
  run.encounter = null;
  run.icePassed += 1;
  enterMovement(state);
}

/** The Movement Phase: the Runner chooses to jack out or go on (CONTINUE_RUN). */
export function enterMovement(state: GameState): void {
  const run = state.activeRun;
  if (!run) return;
  run.encounter = null;
  run.phase = 'movement';
}

/**
 * The Runner declined to jack out: they move to the next position inward and
 * approach that ice, or, past the innermost ice, get ready to approach the
 * server. The Corp may rez cards before that approach (rules 6.9.4d-f).
 */
export function moveInward(state: GameState): void {
  const run = state.activeRun;
  if (!run) return;
  const next = run.icePosition === null ? -1 : run.icePosition - 1;
  if (next >= 0 && state.corp.servers[run.server].ice[next]) {
    approachIce(state, next);
    return;
  }
  run.phase = 'approach_server';
  run.icePosition = null;
  run.serverApproached = false;
}

/** The Runner approaches the ice at this position of the attacked server ("whenever the Runner approaches"). */
export function approachIce(state: GameState, position: number): void {
  const run = state.activeRun!;
  run.icePosition = position;
  run.phase = 'approach_ice';
  run.encounter = null;
  const ice = state.corp.servers[run.server].ice[position];
  if (ice) fireTrigger(state, { type: 'approach_ice', ice, server: run.server });
}

/**
 * Moves the Runner to the outermost position of a server, approaching its
 * outermost ice or, with no ice, the server (Proprionegation).
 */
export function moveRunnerTo(state: GameState, serverId: string): void {
  const run = state.activeRun;
  if (!run) return;
  run.server = serverId;
  const last = state.runsThisTurn[state.runsThisTurn.length - 1];
  if (last) last.server = serverId;
  const ice = state.corp.servers[serverId].ice;
  addLog(state, 'corp', `The Runner moved to the outermost position of ${state.corp.servers[serverId].name}.`);
  if (ice.length > 0) approachIce(state, ice.length - 1);
  else {
    // No ice: the Runner has no position and the run goes to the Movement Phase (rules 6.2.8b)
    run.icePosition = null;
    enterMovement(state);
  }
}

/**
 * The Runner approaches the attacked server ("whenever the Runner approaches
 * this server"). The run becomes successful once these abilities resolve.
 */
export function approachServer(state: GameState): void {
  const run = state.activeRun!;
  if (run.redirectToHq && run.server === 'archives') {
    // Maintenance Access: the attacked server becomes HQ
    run.server = 'hq';
    run.redirectToHq = false;
    const last = state.runsThisTurn[state.runsThisTurn.length - 1];
    if (last) last.server = 'hq';
    addLog(state, 'runner', 'The attacked server changed to HQ.');
  }
  run.phase = 'approach_server';
  run.icePosition = null;
  run.serverApproached = true;
  fireTrigger(state, { type: 'approach_server', server: run.server });
}

export { endRun };
