/**
 * The race clock (tuning pass 1, plan.raceClock; Fable spec 2026-11-07, /mnt/project-files/netrunner-ai/tuning-pass/spec.md):
 * one place that says how fast each side is scoring on this board, as the Corp sees it, so the Corp's time can be priced
 * from the race instead of from four separate guesses (agendaWorth's 1/turnsLeft, payouts over turnsLeft,
 * centralExposure's turns, the credit slide's horizon).
 *
 * runnerRate: the agenda points the Runner is expected to take on its next turn, the same terms centralExposure prices in
 * value, here in points (rule 1.17.3: a stolen agenda adds its points to the Runner's score area):
 *   - HQ: the threat's run chance x the run's success x the points one access finds (rule 7.4.1b: a random card from HQ),
 *   - R&D: the same with the points of the average card the Corp can't place (it knows R&D's composition, not its order),
 *   - each remote holding an agenda: its steal odds (threat run chance x passOdds) x the agenda's points,
 *   - Archives: its run chance x success x the facedown agendas' points (rule 7.4.6: every card in Archives is accessed).
 * The threat's run chances are the Runner's own (its view, no peeking: threatModel.ts), calibrated by item 3.
 *
 * corpRate: the Corp's own pace, read from a measured table by the Corp's score (scripts/race-calibration.ts), not a model.
 */
import { CardInstance, GameState, cardDef } from '../core';
import { PACE, runSuccess, stealOdds } from './effectValues';
import { unseenInHand } from './handValues';
import { runChance, threatOn } from './threatModel';
import { guardLoop, memo, setCorpNeedScale } from './valueModel';
import { plan, pricing, withPricing } from './pricing';

export const WIN_POINTS = 7; // rule 1.3.1 (a standard game is won at 7 agenda points)

export interface Clock {
  /** Agenda points the Runner is expected to take per turn on this board, as the Corp sees it. */
  runnerRate: number;
  /** Agenda points the Corp expects to score per turn (measured, by its score). */
  corpRate: number;
  /** The Runner's expected turns to win: (7 - its score) / runnerRate, capped. */
  runnerTurns: number;
  /** The Corp's expected turns to win, capped. */
  corpTurns: number;
  /** Chance the game is still open (the Runner hasn't won) after t more Runner turns at this rate, floored. */
  open(t: number): number;
}

/** No clock runs longer than this (the measured turns left at 0-0, cardProfiles MEASURED_TURNS_LEFT). */
export const CLOCK_CAP = 14;
/** open() never drops below this: a rate read off one board is not a certainty the game is over. */
export const OPEN_FLOOR = 0.25;
/** Below this the Runner is treated as not scoring at all on this board (turns capped). */
const MIN_RATE = 0.05;

/**
 * The Corp's points per Corp turn, by its score (0..6). Measured in self-play (scripts/race-calibration.ts); until that
 * is in, 7 points over the measured 14 turns.
 */
export const CORP_RATE: number[] = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];

export interface RunnerRateParts { hq: number; rd: number; remotes: number; archives: number }

/** The Runner's expected points next turn, by server kind (the race-calibration script prints the parts). */
export function runnerRateParts(state: GameState): RunnerRateParts {
  const corp = state.corp;
  const points = (c: CardInstance) => (cardDef(c).type_code === 'agenda' ? cardDef(c).agenda_points ?? 1 : 0);
  // The cards the Corp can't place: R&D and any card drawn in a look-ahead (handValues unseenInHand), pooled
  const unseen = unseenInHand(state, 'corp');
  const ids = new Set(unseen.map(c => c.instanceId));
  const pool = [...corp.rd, ...unseen];
  const density = pool.length ? pool.reduce((n, c) => n + points(c), 0) / pool.length : 0;
  const known = corp.hq.filter(c => !ids.has(c.instanceId));
  const hqNow = corp.hq.length ? (known.reduce((n, c) => n + points(c), 0) + unseen.length * density) / corp.hq.length : 0;
  const threat = threatOn();
  const chance = (id: string, share: number) => (threat ? runChance(state, id) : PACE.runs * share);
  const hq = corp.hq.length ? chance('hq', PACE.hqShare) * runSuccess(state, 'hq') * hqNow : 0;
  const rd = corp.rd.length ? chance('rd', PACE.rdShare) * runSuccess(state, 'rd') * density : 0;
  let remotes = 0;
  for (const server of Object.values(corp.servers)) {
    if (!server.isRemote) continue;
    const pts = server.root.reduce((n, c) => n + points(c), 0);
    if (pts > 0) remotes += stealOdds(state, server.id) * pts;
  }
  const archived = corp.archives.faceDown.reduce((n, c) => n + points(c), 0);
  const archives = archived > 0 ? (threat ? runChance(state, 'archives') : PACE.runs * 0.1) * runSuccess(state, 'archives') * archived : 0;
  return { hq, rd, remotes, archives };
}

export type RacePart = 'agendas' | 'tempo' | 'horizon' | 'money';

/** plan.raceClock's piece `part` is on (the switch is an object of parts; sideOff can set it false for a side). */
export function raceOn(part: RacePart): boolean {
  const race = plan().raceClock as Partial<Record<RacePart, boolean>> | false | undefined;
  return !!race && !!race[part];
}

/** The clock is being worked out: what reads it (turnsLeft) falls back to its own guess inside (pricing buildingClock). */
export const clockBuilding = (): boolean => pricing().buildingClock;

/** A clock from the score alone (inside its own computation): the measured pace, both sides. */
const flatClock = (state: GameState): Clock => {
  const need = Math.max(1, WIN_POINTS - state.runner.score);
  const step = 1 - 0.5 / need;
  return { runnerRate: 0.5, corpRate: 0.5, runnerTurns: Math.min(CLOCK_CAP, need / 0.5), corpTurns: Math.min(CLOCK_CAP, Math.max(1, WIN_POINTS - state.corp.score) / 0.5), open: t => Math.max(OPEN_FLOOR, step ** t) };
};

export function clock(state: GameState): Clock {
  if (clockBuilding()) return flatClock(state);
  return guardLoop(state, 'raceClock', () => flatClock(state), () => memo(state, 'raceClock', () => withPricing({ buildingClock: true }, () => buildClock(state))));
}

function buildClock(state: GameState): Clock {
  {
    const parts = runnerRateParts(state);
    const runnerRate = parts.hq + parts.rd + parts.remotes + parts.archives;
    const runnerNeed = Math.max(1, WIN_POINTS - state.runner.score);
    const corpNeed = Math.max(1, WIN_POINTS - state.corp.score);
    const corpRate = CORP_RATE[Math.min(CORP_RATE.length - 1, state.corp.score)] ?? 0.5;
    const turns = (need: number, rate: number) => Math.min(CLOCK_CAP, rate > MIN_RATE ? need / rate : CLOCK_CAP);
    const step = 1 - Math.min(runnerRate, runnerNeed) / runnerNeed;
    return {
      runnerRate,
      corpRate,
      runnerTurns: turns(runnerNeed, runnerRate),
      corpTurns: turns(corpNeed, corpRate),
      open: (t: number) => Math.max(OPEN_FLOOR, step ** t),
    };
  }
}

// plan.raceClock.money: the Corp's credit need (valueModel creditNeed) by min(1, corpTurns / 8)
setCorpNeedScale(state => (raceOn('money') ? Math.min(1, clock(state).corpTurns / 8) : 1));
