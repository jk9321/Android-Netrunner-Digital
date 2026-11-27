import type { GameAction, GameState, SideCode } from '../core';
import type { TwoTurnLine } from './corp/lines';
import type { SearchRow } from './turnPlanner';
import { installTop, pricing, withPricing } from './pricing';

/**
 * Diagnostics sink (audit Step 3 group B, AI-STATS-IN-SRC). Measurement scripts and tests install one sink in the pricing
 * context. Every counter and hook the AI used to keep in module objects (scoreInTwoStats, threatStats, plannerStats, ...)
 * is written into it. With no sink installed, which is default play, each site costs one undefined check.
 *
 * No decision may read the sink. Code under src/ai only writes to it, through tally, note and inReply here.
 * tests/codeHealth.test.ts checks that no other file reads the sink. Scripts and tests read what they installed.
 */
export interface Diagnostics {
  /** corp/placement.ts scoreInTwoPick and corp/rezMoney.ts lineFloor: two-turn agenda lines begun, stepped, vetoed, dropped, finished. */
  scoreInTwo: { begun: number; steps: number; vetoed: number; dropped: number; finished: number; floorRefused: number; unholdable: number; rolloutDecisions: number; rolloutTaken: number };
  /**
   * corp/core.ts playoutLine (A1): Q4/Q5 asked at the planner's playout steps (the deciding Corp's scoreInTwo counters
   * leave these out), the steps a held line played instead of the order's pick, the agenda picks vetoed, the asset lines begun from the pick, the scores first.
   */
  playoutLine: { q4Asks: number; q4Takes: number; q5Asks: number; q5Steps: number; q5Vetoes: number; assetSteps: number; assetFromPick: number; scoreFirst: number };
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
  /** oracle.ts: oracle turns played out, hits, time. */
  oracle: { turns: number; hits: number; ms: number };
  /** turnPlanner.ts: decisions, added candidates and their wins. */
  planner: { decisions: number; agendaSlot: number; agendaSlotWins: number; buildSlot: number; buildSlotWins: number };
  /** A Runner reply is being sampled (runnerReply.ts; scripts/value-owners/log.ts tags values inside it). Set with inReply. */
  replying: boolean;
  /** Hooks, called with what the site saw. */
  onReplySamples?: (values: number[]) => void;
  onClose?: (top: { action: GameAction; first: number; value: number; samples: number }[], pick: GameAction) => void;
  onCandidates?: (side: SideCode, values: number[], actions: GameAction[]) => void;
  /** corp/core.ts playoutLine (A1, measurement): a playout step where the line played `played` instead of the order's `pick`. */
  onPlayoutLine?: (pick: GameAction | null, played: GameAction, why: string) => void;
  /** Spec-search S1 (measurement only): every Corp decision's continuations (scripts/search-audit.ts, lossLog.ts). */
  onSearch?: (row: SearchRow) => void;
  /** plan.hiddenDraws (S6, measurement): a Corp decision, how many of its candidate lines drew from R&D, and the pick. */
  onDraws?: (state: GameState, drawLines: number, lines: number, pick: GameAction | null) => void;
  /**
   * scripts/oracle-reach.ts: each oracle answer (oracle.ts oracleSteal), keyed by the Corp decision it was given in (its
   * noted HQ set), with the board, the server and the odds told.
   */
  onOracleTold?: (decision: object, state: GameState, serverId: string, told: number) => void;
  /** Valuation V-A (scripts/value-owners): an owner or a copy priced `value` at `site`, asked with `args` (valueModel.ts logValue). */
  onValue?: (quantity: string, site: string, state: GameState | undefined, value: number, args: readonly unknown[]) => void;
}

/** The counter groups: the fields of Diagnostics that hold numbers by name. */
type CounterGroups = { [K in keyof Diagnostics as Diagnostics[K] extends Record<string, number> ? K : never]: Diagnostics[K] };

export const newDiagnostics = (): Diagnostics => ({
  scoreInTwo: { begun: 0, steps: 0, vetoed: 0, dropped: 0, finished: 0, floorRefused: 0, unholdable: 0, rolloutDecisions: 0, rolloutTaken: 0 },
  playoutLine: { q4Asks: 0, q4Takes: 0, q5Asks: 0, q5Steps: 0, q5Vetoes: 0, assetSteps: 0, assetFromPick: 0, scoreFirst: 0 },
  scoreInTwoLines: [],
  assetCover: { asked: 0, scoringShort: 0, iced: 0, clicks: 0, noIce: 0, rezMoney: 0, begun: 0 },
  money: { ops: 0 },
  scoreNow: { searches: 0, found: 0, choices: 0, nodes: 0 },
  reply: { nakedAgendaTurns: 0, nakedAgendaRuns: 0 },
  oracle: { turns: 0, hits: 0, ms: 0 },
  planner: { decisions: 0, agendaSlot: 0, agendaSlotWins: 0, buildSlot: 0, buildSlotWins: 0 },
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

/** Calls `fn` with the sink, if one is installed: hooks and lists. `fn` returns nothing, so no decision can read through it. */
export function note(fn: (d: Diagnostics) => void): void {
  const d = pricing().diagnostics;
  if (d) fn(d);
}

/** Runs `fn` with no sink installed, so what it tallies or notes is not counted (corp/core.ts playoutLine: its own counters). */
export function unsunk<T>(fn: () => T): T {
  return withPricing({ diagnostics: null }, fn);
}

/** Marks a Runner reply as being sampled (runnerReply.ts and the scripts that copy it); returns the undo. */
export function inReply(): () => void {
  const d = pricing().diagnostics;
  if (!d) return () => {};
  const outer = d.replying;
  d.replying = true;
  return () => (d.replying = outer);
}

/** Installs `d` (a fresh sink by default) for the rest of the run: a measurement script's setup, outside every pricing scope (installTop throws inside one). Returns the sink. */
export function installDiagnostics(d: Diagnostics = newDiagnostics()): Diagnostics {
  installTop({ diagnostics: d });
  return d;
}

/** Runs `fn` with a fresh sink installed (a test), and takes the sink away afterwards. */
export function withDiagnostics<T>(fn: (d: Diagnostics) => T): T {
  const d = newDiagnostics();
  return withPricing({ diagnostics: d }, () => fn(d));
}

/**
 * F117 step 0 counts (item 5, bar 10): widened chains by source and depth (`widened`), their prompts answered on the
 * decision's own root by the Runner (`rootRunner`: the 'today' path's class, must be 0), prompts whose chains ran past
 * the budget (`capped`, by source), cards left set aside at a chain's end and priced as held (`aside`, by source and why:
 * another prompt waiting (a cut), no prompt, the depth limit, or one step), and the scored answers per answered prompt
 * whose chains scored any (`used`). Counted only with `on` (off in play, on in the tests (tests/setup.ts) and the scripts that
 * read them: diagnostics out of play, F117 review N5, speed pass lever A); play never reads them. Here, not in prompts.ts
 * (which re-exports them), so the test setup can turn them on without loading the AI before a test's module mocks.
 */
export const chainStats = {
  on: false,
  widened: new Map<string, number>(),
  rootRunner: 0,
  capped: new Map<string, number>(),
  aside: new Map<string, number>(),
  used: [] as number[],
};

/**
 * The run term's asks (a run that stakes something) and the ones it decided (the answers separated), for the time report;
 * with ruling 10's counts: settles stopped at the depth cap (`capped`), at a Runner prompt that is not the encountered
 * ice's (`runnerOther`), and decisions whose pick lets the Runner in with an answer that keeps it out (`inPick`). Counted
 * only with `on`, as chainStats (with runnerOtherKinds); play never reads them.
 */
export const runTermStats = { on: false, asked: 0, decided: 0, capped: 0, runnerOther: 0, inPick: 0 };
/** `runnerOther` by the prompt (its card and step, or its kind) and the run's phase, for the fire run's report (ruling 11.2). */
export const runnerOtherKinds = new Map<string, number>();
