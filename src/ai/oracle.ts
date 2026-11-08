import { GameState, knownInHand } from '../core';
import { plan } from './pricing';

/**
 * Measurement oracles (tuning pass round 2, phase 1: /mnt/project-files/netrunner-ai/tuning-pass/spec-round2.md).
 *
 * Each oracle gives the Corp, for one batch, an answer it can't honestly have, to measure what that knowledge would be
 * worth before an honest estimate of it is built. They change only what the Corp KNOWS, never the rules the Runner
 * plays under. Every hidden read an oracle makes is in this file; the generic AI files call it behind
 * plan().oracle.<name>. All are off by default and off for the Runner (sideOff.runner), and a codeHealth test keeps
 * them off: an oracle never ships on.
 */

/**
 * The Runner's grip cards the deciding Corp counts as seen: those it has seen there (knownInHand; the rest is hidden
 * information, rules 10.2.2a-b), or every card in the grip with plan.oracle.grip on.
 * The stack and its order stay hidden either way.
 */
export function corpSeenGrip(state: GameState): Set<string> {
  if (plan().oracle?.grip) return new Set(state.runner.grip.map(c => c.instanceId));
  return new Set(knownInHand(state, 'runner').map(k => k.id));
}
