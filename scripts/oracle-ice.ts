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
import { THINK } from '../src/ai/oracle';
import { PLANNER } from '../src/ai/turnPlanner';
import { REPLY } from '../src/ai/runnerReply';

export type OracleIce = 'hq' | 'archives' | 'remote';

/**
 * The batch-only tokens in PLAN_OFF (the ai-batch workflow has no other input for them), split from the plan switches
 * that applyPlanOff takes: +oracle.ice.hq|archives|remote (this file) and +oracle.money (oracle-money.ts). Every script
 * that reads PLAN_OFF strips them here, so a token never reaches applyPlanOff (where it would throw).
 */
export function batchTokens(planOff: string): { ice?: OracleIce; money: boolean; skip: number[]; plan: string } {
  const keys = planOff.split(',').filter(Boolean);
  const ice = keys.find(k => /^\+oracle\.ice\./.test(k))?.replace('+oracle.ice.', '') as OracleIce | undefined;
  if (ice && !['hq', 'archives', 'remote'].includes(ice)) throw new Error(`oracle.ice.${ice}: hq, archives or remote`);
  const money = keys.includes('+oracle.money');
  // +audit.search (spec-search S1): log every Corp planner decision's continuations (lossLog.ts SEARCH_AUDIT); no play change
  if (keys.includes('+audit.search')) process.env.SEARCH_AUDIT = '1';
  // Step S-2 (branch ai-search-first, measurement only): s2:width=N plays the Corp planner N times as wide (N x 4
  // candidates, N x 2 reply samples, through plan.oracle.think's THINK); s2:depth=2 plays two Runner turns in each reply
  const s2 = keys.filter(k => k.startsWith('s2:'));
  for (const k of s2) {
    const m = k.match(/^s2:(width|depth)=(\d+)$/);
    if (!m) throw new Error(`bad Step S-2 token ${k}: s2:width=N or s2:depth=N`);
    if (m[1] === 'width') {
      THINK.candidates = PLANNER.candidates * Number(m[2]);
      THINK.samples = REPLY.samples * Number(m[2]);
      keys.push('+oracle.think');
    } else REPLY.turns = Number(m[2]);
  }
  // Step S (ai-search-first): skip:<seed> leaves that deal out of a batch (a deal that hangs at default switches, so a
  // paired base and its arms all miss the same deal; hang-deal2138.md); read by corp-losses.ts
  const skip = keys.filter(k => k.startsWith('skip:')).map(k => Number(k.slice(5)));
  if (skip.some(n => !Number.isInteger(n) || n <= 0)) throw new Error('bad skip token: skip:<seed>');
  return { ice, money, skip, plan: keys.filter(k => !/^\+oracle\.ice\./.test(k) && k !== '+oracle.money' && k !== '+audit.search' && !k.startsWith('s2:') && !k.startsWith('skip:')).join(',') };
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
