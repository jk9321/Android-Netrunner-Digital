import { GameState, cardDef, knownInHand } from '../core';
import { actingSide, plan, pricing, withPricing } from './pricing';
import { note, tally } from './diagnostics';
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
 * information, rules 10.2.2a-b), or every card in the grip with plan.oracle.grip on. `channel` is the caller's deal:
 * plan.oracle.gripThreat opens the grip to the threat's and the Hard search's deals only, gripReply to the planner's
 * played-out Runner reply only (Phase 2 K0: where the grip's worth flows). The stack and its order stay hidden either way.
 */
export function corpSeenGrip(state: GameState, channel: 'threat' | 'reply'): Set<string> {
  const o = plan().oracle;
  if (o?.grip || (channel === 'threat' ? o?.gripThreat : o?.gripReply)) return new Set(state.runner.grip.map(c => c.instanceId));
  return new Set(knownInHand(state, 'runner').map(k => k.id));
}

/**
 * The play-out's game runner, handed in by runnerReply.ts (which already imports the AIs): oracle.ts imports no AI module
 * itself, because a new import edge changes the AI modules' load order, and play depended on that order (hand-off
 * identical check 2026-11-08: 39 of 221 deals moved with every oracle off). Unset, the oracle answers nothing.
 */
export type OraclePlayout = (start: GameState) => { step(): boolean; state: GameState };
const hooks: { playout?: OraclePlayout } = {};
export function setOraclePlayout(fn: OraclePlayout): void {
  hooks.playout = fn;
}

/** What the Runner AI did on its next turn from one position: the agendas it stole. */
interface RunnerTurn {
  stolen: Set<string>;
}

/** Positions already played out for plan.oracle.safestRemote (a planner meets the same end state from several lines). */
const playedOut = new Map<string, RunnerTurn | null>();
const ORACLE_STEPS = 400;

/**
 * The whole position as a key (review 1 R2: a partial key let a sibling line with a different shuffle or deeper deck
 * order share a cached turn): the state itself (every zone in order, counters, the shuffler's state, the heap) and the
 * cards the deciding sides had noted, which the play-out's decisions read, hashed (cyrb53).
 */
function positionKey(state: GameState): string {
  const c = pricing();
  // fingerprint kept in: the import stays, and with it the AI modules' load order (see the play-out hook below)
  const text = fingerprint(state) + '|' + JSON.stringify(state) + '|' + [...(c.known.corp ?? [])].join(',') + '|' + [...(c.known.runner ?? [])].join(',');
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${text.length}:${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}`;
}

/**
 * plan.oracle.safestRemote: plays the Runner AI's next turn from `state` with the real hidden cards (the grip, the
 * stack, R&D and every facedown card as they are), the Corp giving up any clicks it has left, and reads what the Runner
 * did. The Runner plays as the Normal batch Runner does (HeuristicRunnerAI, its planner on; a Hard batch's Runner
 * differs, and only Normal batches were run); the Corp answers its rez windows and prompts with the rule-based Corp. Null when the engine refuses the position (a look-ahead's hand-built board).
 */
function runnerNextTurn(state: GameState): RunnerTurn | null {
  const key = positionKey(state);
  if (!hooks.playout) return null;
  if (playedOut.has(key)) {
    tally('oracle', 'hits');
    return playedOut.get(key) ?? null;
  }
  const t0 = performance.now();
  const c = pricing();
  // The sim's decisions note their own hands and the Runner's credits: the deciding Corp's are put back afterwards
  const result = withPricing({ oracleRunning: true, frozen: false, leaves: [], known: { ...c.known }, anchor: c.anchor, decisionSeed: null }, () => {
    const start = state.activePlayer === 'corp' && !state.activeRun ? { ...state, corp: { ...state.corp, clicks: 0 } } : state;
    const before = new Set(start.runner.scoreArea.map(a => a.instanceId));
    const game = hooks.playout!(start);
    let runnerTurn = start.activePlayer === 'runner';
    try {
      for (let i = 0; i < ORACLE_STEPS && !game.state.winner; i++) {
        if (!game.step()) break;
        const s = game.state;
        if (s.activePlayer === 'runner') runnerTurn = true;
        else if (runnerTurn && !s.activeRun) break;
      }
    } catch {
      return null;
    }
    const stolen = new Set(game.state.runner.scoreArea.map(a => a.instanceId).filter(id => !before.has(id)));
    return { stolen };
  });
  // A position the engine refused is cached too, so it isn't played again on every evaluation; only real turns count
  if (result) {
    tally('oracle', 'turns');
    tally('oracle', 'ms', performance.now() - t0);
  }
  if (playedOut.size > 2000) playedOut.clear();
  playedOut.set(key, result);
  return result;
}

/**
 * plan.oracle.safestRemote (spec-round2.md oracle 2: Jeff's "put it somewhere safe" measured): the Runner's chance to
 * steal an agenda in remote `serverId` on its next turn, as the Runner AI's own next turn from this position says: 1
 * if it stole an agenda there, else 0 (a server with no agenda in it is not told). Undefined (the honest estimate
 * stands) with the switch off, for the Runner, inside the oracle's own play-out or another pricing guard, or for a
 * central server. Only the next turn is told; later turns keep the Corp's own estimate (evaluate.ts threatStanding).
 */
export function oracleSteal(state: GameState, serverId: string): number | undefined {
  if (!plan().oracle?.safestRemote || actingSide() !== 'corp') return undefined;
  const c = pricing();
  if (c.oracleRunning || c.averaging || c.pricingIce || c.pricingTagLoss || c.projecting || c.pricingEffect || c.planning || c.computingThreat) return undefined;
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
  const told = agendas.some(a => turn.stolen.has(a.instanceId)) ? 1 : 0;
  note(d => d.onOracleTold?.(fresh, state, serverId, told));
  return told;
}

/**
 * plan.oracle.rd (spec-round2.md oracle 4): the Corp deciding knows its own R&D order (hidden information to both
 * players, rules 10.2.2a; the Hard Runner already has this edge). Off, or for the Runner, false.
 */
export const corpKnowsRd = (): boolean => !!plan().oracle?.rd && actingSide() === 'corp';

/**
 * The Corp's cards a draw brings, as the deciding Corp can know them: R&D's contents, never its order (each card is
 * as likely); with plan.oracle.rd, the top card itself. The Runner's stack is unchanged.
 */
export function corpDrawPool(state: GameState): GameState['corp']['rd'] {
  return corpKnowsRd() && state.corp.rd.length ? state.corp.rd.slice(0, 1) : state.corp.rd;
}

/**
 * plan.oracle.think (AI Coordinator 2026-11-08: the "think harder" ceiling): the same knowledge, more search. The
 * Corp planner's candidate count and Runner-reply samples for the deciding side; the shipped values otherwise.
 */
export const THINK = { candidates: 8, samples: 4 };
const thinking = (): boolean => !!plan().oracle?.think && actingSide() === 'corp';
export const plannerCandidates = (side: string, base: number): number => (side === 'corp' && thinking() ? THINK.candidates : base);
export const replySamples = (base: number): number => (thinking() ? THINK.samples : base);
export const thinkAlwaysTries = (side: string): boolean => side === 'corp' && thinking();
