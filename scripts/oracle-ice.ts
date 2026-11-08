/**
 * Round 2 oracle 3 (spec-round2.md, ORACLE_ICE): a board setup for one batch, not an AI change. Before turn 1, the
 * first ice in the Corp's R&D (by R&D order: the deck's own ice, no card code) is installed rezzed and paid for,
 * protecting HQ, Archives or a new remote. It stays the Corp's own instance (no new instances, so inst-N numbering is
 * unchanged) and HQ is untouched (the ice comes from R&D below the dealt hand). Done on the freshly created state,
 * before any legality query, so nothing cached is mutated. Measures "protect HQ" (Jeff), "cheap spare ice on Archives"
 * (Jeff 2026-11-08 02:49) and "an iced remote always ready". Rules: ice is installed protecting a server (rules 3.4.2, 4.6.9)
 * and a rezzed card is faceup and open information (rules 4.6.3).
 */
import { CardInstance, GameState, cardDef } from '../src/core';

export type OracleIce = 'hq' | 'archives' | 'remote';

/**
 * The batch-only tokens in PLAN_OFF (the ai-batch workflow has no other input for them), split from the plan switches
 * that applyPlanOff takes: +oracle.ice.hq|archives|remote (this file) and +oracle.money (oracle-money.ts). Every script
 * that reads PLAN_OFF strips them here, so a token never reaches applyPlanOff (where it would throw).
 */
export function batchTokens(planOff: string): { ice?: OracleIce; money: boolean; plan: string } {
  const keys = planOff.split(',').filter(Boolean);
  const ice = keys.find(k => /^\+oracle\.ice\./.test(k))?.replace('+oracle.ice.', '') as OracleIce | undefined;
  if (ice && !['hq', 'archives', 'remote'].includes(ice)) throw new Error(`oracle.ice.${ice}: hq, archives or remote`);
  const money = keys.includes('+oracle.money');
  return { ice, money, plan: keys.filter(k => !/^\+oracle\.ice\./.test(k) && k !== '+oracle.money').join(',') };
}

/** Places the cheat ice on `target`. False when the Corp's R&D holds no ice (the deal is played without the cheat). */
export function placeOracleIce(state: GameState, target: OracleIce): boolean {
  const corp = state.corp;
  const at = corp.rd.findIndex(c => cardDef(c).type_code === 'ice');
  if (at === -1) return false;
  const [ice] = corp.rd.splice(at, 1) as [CardInstance];
  ice.isRezzed = true;
  ice.runnerKnows = true;
  delete ice.faceUp;
  let id: string = target;
  if (target === 'remote') {
    corp.remoteCounter += 1;
    id = `remote-${corp.remoteCounter}`;
    corp.servers[id] = { id, name: `Remote Server ${corp.remoteCounter}`, isRemote: true, ice: [], root: [] };
  }
  corp.servers[id].ice.push(ice);
  return true;
}
