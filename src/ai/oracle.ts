import { GameState, cardDef, knownInHand } from '../core';
import { HeuristicCorpAI } from './corpAI';
import { GameRunner } from './playout';
import { actingSide, plan, pricing, withPricing } from './pricing';
import { HeuristicRunnerAI } from './runnerAI';
import { fingerprint } from './valueModel';

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

/** What the Runner AI did on its next turn from one position: the agendas it stole and the servers it breached. */
interface RunnerTurn {
  stolen: Set<string>;
  breached: Set<string>;
}

/** Positions already played out for plan.oracle.safestRemote (a planner meets the same end state from several lines). */
const playedOut = new Map<string, RunnerTurn>();
/** Diagnostics for scripts/threat-profile.ts: Runner turns played out for the oracle, cache hits, and their time. */
export const oracleStats = { turns: 0, hits: 0, ms: 0 };
const ORACLE_STEPS = 400;

/** Everything a Runner turn from `state` can depend on, as a key (the real hidden cards and the shuffler included). */
function positionKey(state: GameState): string {
  const roots = Object.values(state.corp.servers).map(v => v.root.map(c => `${c.instanceId}${c.advancementCounters}${c.runnerKnows ? 'k' : ''}`).join('.')).join(';');
  return [
    state.id, fingerprint(state), roots, state.phase, state.corp.hq.map(c => c.instanceId).join(','), state.runner.grip.map(c => c.instanceId).join(','),
    state.corp.rd.slice(0, 5).map(c => c.instanceId).join(','), state.runner.stack.slice(0, 5).map(c => c.instanceId).join(','),
    state.runsThisTurn.map(r => r.server + (r.successful ? '+' : '-')).join(','),
  ].join('|');
}

/**
 * plan.oracle.safestRemote: plays the Runner AI's next turn from `state` with the real hidden cards (the grip, the
 * stack, R&D and every facedown card as they are), the Corp giving up any clicks it has left, and reads what the Runner
 * did. The Runner plays as the batch Runner does (HeuristicRunnerAI, its planner on); the Corp answers its rez windows
 * and prompts with the rule-based Corp. Null when the engine refuses the position (a look-ahead's hand-built board).
 */
function runnerNextTurn(state: GameState): RunnerTurn | null {
  const key = positionKey(state);
  const hit = playedOut.get(key);
  if (hit) {
    oracleStats.hits++;
    return hit;
  }
  const t0 = performance.now();
  const c = pricing();
  // The sim's decisions note their own hands and the Runner's credits: the deciding Corp's are put back afterwards
  const result = withPricing({ oracleRunning: true, frozen: false, leaves: [], known: { ...c.known }, anchor: c.anchor, decisionSeed: null }, () => {
    const start = state.activePlayer === 'corp' && !state.activeRun ? { ...state, corp: { ...state.corp, clicks: 0 } } : state;
    const before = new Set(start.runner.scoreArea.map(a => a.instanceId));
    const game = new GameRunner(start, { corp: new HeuristicCorpAI({ planner: false }), runner: new HeuristicRunnerAI({}) });
    const breached = new Set<string>();
    let runnerTurn = start.activePlayer === 'runner';
    try {
      for (let i = 0; i < ORACLE_STEPS && !game.state.winner; i++) {
        if (!game.step()) break;
        const s = game.state;
        if (s.activeRun?.isSuccessful) breached.add(s.activeRun.server);
        for (const r of s.runsThisTurn) if (r.successful) breached.add(r.server);
        if (s.activePlayer === 'runner') runnerTurn = true;
        else if (runnerTurn && !s.activeRun) break;
      }
    } catch {
      return null;
    }
    const stolen = new Set(game.state.runner.scoreArea.map(a => a.instanceId).filter(id => !before.has(id)));
    return { stolen, breached };
  });
  oracleStats.turns++;
  oracleStats.ms += performance.now() - t0;
  if (playedOut.size > 2000) playedOut.clear();
  if (result) playedOut.set(key, result);
  return result;
}

/**
 * plan.oracle.safestRemote (spec-round2.md oracle 2: Jeff's "put it somewhere safe" measured): the Runner's chance to
 * steal an agenda in remote `serverId` on its next turn, as the Runner AI's own next turn from this position says: 1
 * if it stole an agenda there (or, with none there yet, got into the server), else 0. Undefined (the honest estimate
 * stands) with the switch off, for the Runner, inside the oracle's own play-out or another pricing guard, or for a
 * central server. Only the next turn is told; later turns keep the Corp's own estimate (evaluate.ts threatStanding).
 */
export function oracleSteal(state: GameState, serverId: string): number | undefined {
  if (!plan().oracle?.safestRemote || actingSide() !== 'corp') return undefined;
  const c = pricing();
  if (c.oracleRunning || c.averaging || c.pricingIce || c.pricingTagLoss || c.projecting || c.pricingEffect || c.planning || c.computingThreat || c.buildingClock) return undefined;
  // The end of the Corp's turn (a planner leaf, or the last click's ranking): the Runner's next turn is the one told
  if (state.activePlayer !== 'corp' || state.activeRun || state.corp.clicks > 0) return undefined;
  const server = state.corp.servers[serverId];
  if (!server?.isRemote) return undefined;
  // A steal moves the agenda to the Runner's score area (rules 8.2.10), read from the played-out turn
  // Limited to agenda installs (the spec's fallback when the full oracle costs over 2x a decision): only an agenda this
  // line installs, one in HQ as the decision started, is told; an agenda already installed keeps the honest estimate
  const agendas = server.root.filter(card => cardDef(card).type_code === 'agenda');
  const fresh = c.known.corp;
  if (!agendas.length || !fresh || !agendas.some(a => fresh.has(a.instanceId))) return undefined;
  const turn = runnerNextTurn(state);
  if (!turn) return undefined;
  return agendas.some(a => turn.stolen.has(a.instanceId)) ? 1 : 0;
}
