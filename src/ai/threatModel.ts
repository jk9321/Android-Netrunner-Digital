import { CardInstance, GameState, cardDef } from '../core';
import { unseenInHand, unseenKey } from './handValues';
import { memo, pointGain } from './valueModel';

/**
 * What is left of the Corp's threat model (structural review item 3, 2026-11-07), deleted 2026-11-16 (ai-threat-delete,
 * Step S: Corp threatValues off on beta 514eeac, g10 +0.8 ± 0.8 over 2,209 deals, 0.65x play time). Its off path is
 * what the Corp plays: STEAL.run times the pass odds for a remote (effectValues stealOdds), PACE shares for HQ and R&D
 * (iceValues serverStake). Two helpers it shared stay here, unmoved: the turn's seed (the planner and the Runner reply
 * deal their hidden cards from it) and one access to HQ and to a card the Corp can't place (iceValues, evaluate).
 */

/** A seed fixed for the game and turn: every candidate of one decision sees the same guessed grip. */
export function turnSeed(state: GameState): number {
  let h = 2166136261 ^ state.turnNumber;
  for (let i = 0; i < state.id.length; i++) h = Math.imul(h ^ state.id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * One access to HQ as it is and to a card the Corp can't place (R&D, or a card drawn in a look-ahead), in the Runner's
 * points on the clock: the agendas over the cards (serverStake's pool: the Corp knows what R&D holds but
 * not its order, and nothing about a card it drew in a look-ahead).
 */
export function centralAccess(state: GameState): { hqNow: number; density: number } {
  const unseen = unseenInHand(state, 'corp');
  return memo(state, `centralAccess:${unseenKey(state)}`, () => {
    const corp = state.corp;
    const gain = (c: CardInstance) => (cardDef(c).type_code === 'agenda' ? pointGain(state.runner.score, cardDef(c).agenda_points ?? 1) : 0);
    const ids = new Set(unseen.map(c => c.instanceId));
    const pool = [...corp.rd, ...unseen];
    const density = pool.length ? pool.reduce((n, c) => n + gain(c), 0) / pool.length : 0;
    const known = corp.hq.filter(c => !ids.has(c.instanceId));
    const hqNow = corp.hq.length ? (known.reduce((n, c) => n + gain(c), 0) + unseen.length * density) / corp.hq.length : 0;
    return { hqNow, density };
  });
}
