import type { GameAction, GameState, SideCode } from '../core';
import type { TwoTurnLine } from './corp/lines';
import type { SearchRow } from './turnPlanner';
import { holdPricing, pricing, withPricing } from './pricing';

/**
 * Diagnostics sink (audit Step 3 group B, AI-STATS-IN-SRC). Measurement scripts and tests install one sink in the pricing
 * context. Every counter and hook the AI used to keep in module objects (scoreInTwoStats, threatStats, plannerStats, ...)
 * is written into it. With no sink installed, which is default play, each site costs one undefined check.
 *
 * No decision may read the sink. Code under src/ai only writes to it, through tally, clockOn and note here.
 * tests/codeHealth.test.ts checks that no other file reads the sink. Scripts and tests read what they installed.
 */
export interface Diagnostics {
  /** corp/placement.ts scoreInTwoPick and corp/rezMoney.ts lineFloor: two-turn agenda lines begun, stepped, vetoed, dropped, finished. */
  scoreInTwo: { begun: number; steps: number; vetoed: number; dropped: number; finished: number; floorRefused: number; unholdable: number };
  /** The two-turn agenda lines begun, in order. */
  scoreInTwoLines: { turn: number; agendaId: string; form: TwoTurnLine['form'] }[];
  /** corp/placement.ts assetCover: asked, and why it gave no line. */
  assetCover: { asked: number; scoringShort: number; iced: number; clicks: number; noIce: number; rezMoney: number; begun: number };
  /** incomeLine.ts: money operations priced. */
  money: { ops: number };
  /** winNow.ts scoreNow searches. */
  scoreNow: { searches: number; found: number; choices: number; nodes: number };
  /** runnerReply.ts: naked agenda remotes in the reply, and how many it ran. */
  reply: { nakedAgendaTurns: number; nakedAgendaRuns: number };
  /** threatModel.ts threat: calls, keyed lookups, budgets (and their time, when `timing`). */
  threat: { calls: number; keyed: number; budgeted: number; keyMs: number; budgetMs: number; replyBudgeted: number; replyBudgetMs: number };
  /** oracle.ts: oracle turns played out, hits, time. */
  oracle: { turns: number; hits: number; ms: number };
  /** turnPlanner.ts: decisions, added candidates and their wins. */
  planner: { decisions: number; withAdded: number; added: number; addedWins: number };
  /** Time the threat's lookups and budgets (performance.now on each). */
  timing: boolean;
  /** A Runner reply is being sampled (runnerReply.ts): budgets inside count as reply budgets. Set with inReply. */
  replying: boolean;
  /** Hooks, called with what the site saw. */
  onReplySamples?: (values: number[]) => void;
  /** A threat budget about to be worked out, with its key (scripts/threat-profile.ts counts repeats). Only with `timing`. */
  onThreatBudget?: (key: string, state: GameState) => void;
  onClose?: (top: { action: GameAction; first: number; value: number; samples: number }[], pick: GameAction) => void;
  onAddedWin?: (state: GameState, action: GameAction) => void;
  onCandidates?: (side: SideCode, values: number[], actions: GameAction[]) => void;
  /** Spec-search S1 (measurement only): every Corp decision's continuations (scripts/search-audit.ts, lossLog.ts). */
  onSearch?: (row: SearchRow) => void;
  /** plan.hiddenDraws (S6, measurement): a Corp decision, how many of its candidate lines drew from R&D, and the pick. */
  onDraws?: (state: GameState, drawLines: number, lines: number, pick: GameAction | null) => void;
  /**
   * scripts/oracle-reach.ts: each oracle answer (oracle.ts oracleSteal), keyed by the Corp decision it was given in (its
   * noted HQ set), with the board, the server and the odds told.
   */
  onOracleTold?: (decision: object, state: GameState, serverId: string, told: number) => void;
}

/** The counter groups: the fields of Diagnostics that hold numbers by name. */
type CounterGroups = { [K in keyof Diagnostics as Diagnostics[K] extends Record<string, number> ? K : never]: Diagnostics[K] };

export const newDiagnostics = (): Diagnostics => ({
  scoreInTwo: { begun: 0, steps: 0, vetoed: 0, dropped: 0, finished: 0, floorRefused: 0, unholdable: 0 },
  scoreInTwoLines: [],
  assetCover: { asked: 0, scoringShort: 0, iced: 0, clicks: 0, noIce: 0, rezMoney: 0, begun: 0 },
  money: { ops: 0 },
  scoreNow: { searches: 0, found: 0, choices: 0, nodes: 0 },
  reply: { nakedAgendaTurns: 0, nakedAgendaRuns: 0 },
  threat: { calls: 0, keyed: 0, budgeted: 0, keyMs: 0, budgetMs: 0, replyBudgeted: 0, replyBudgetMs: 0 },
  oracle: { turns: 0, hits: 0, ms: 0 },
  planner: { decisions: 0, withAdded: 0, added: 0, addedWins: 0 },
  timing: false,
  replying: false,
});

/** Adds `by` to one counter, if a sink is installed. */
export function tally<G extends keyof CounterGroups>(group: G, field: keyof CounterGroups[G] & string, by = 1): void {
  const d = pricing().diagnostics;
  if (!d) return;
  const groups: CounterGroups = d;
  const counters: Record<string, number> = groups[group];
  counters[field] += by;
}

/** Whether the installed sink asks for timings (`timing`). False with no sink. */
export const clockOn = (): boolean => pricing().diagnostics?.timing === true;

/** Calls `fn` with the sink, if one is installed: hooks and lists. `fn` returns nothing, so no decision can read through it. */
export function note(fn: (d: Diagnostics) => void): void {
  const d = pricing().diagnostics;
  if (d) fn(d);
}

/** Marks a Runner reply as being sampled (runnerReply.ts and the scripts that copy it); returns the undo. */
export function inReply(): () => void {
  const d = pricing().diagnostics;
  if (!d) return () => {};
  const outer = d.replying;
  d.replying = true;
  return () => (d.replying = outer);
}

/** Installs `d` (a fresh sink by default) for the rest of the run: a measurement script's setup. Returns the sink. */
export function installDiagnostics(d: Diagnostics = newDiagnostics()): Diagnostics {
  holdPricing({ diagnostics: d });
  return d;
}

/** Runs `fn` with a fresh sink installed (a test), and takes the sink away afterwards. */
export function withDiagnostics<T>(fn: (d: Diagnostics) => T): T {
  const d = newDiagnostics();
  return withPricing({ diagnostics: d }, () => fn(d));
}
