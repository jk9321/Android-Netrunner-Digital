import { GameState } from '../types/state';
import { madeSuccessfulRunThisTurn } from '../engine/helpers';
import { cardDef } from '../cards';
import { BreakerScript, CardScript } from './types';

/** Icebreakers from System Gateway. */

function icebreakerCount(state: GameState): number {
  return state.runner.rig.programs.filter(c => /icebreaker/i.test(cardDef(c).keywords ?? '')).length;
}

const breaker = (script: BreakerScript, extra: Partial<CardScript> = {}): CardScript => ({ breaker: script, ...extra });

export const breakerScripts: Record<string, CardScript> = {
  // Buzzsaw (Decoder): Interface -> 1c: Break up to 2 code gate subroutines. 3c: +1 strength.
  '30005': breaker({ breaks: 'code gate', breakMax: 2, breakCost: () => 1, boostCost: 3, boostAmount: () => 1 }),

  // Cleaver (Fracter): Interface -> 1c: Break up to 2 barrier subroutines. 2c: +1 strength.
  '30006': breaker({ breaks: 'barrier', breakMax: 2, breakCost: () => 1, boostCost: 2, boostAmount: () => 1 }),

  // Carmen (Killer): If you made a successful run this turn, this program costs 2c less to
  // install. Interface -> 1c: Break 1 sentry subroutine. 2c: +3 strength.
  '30015': breaker(
    { breaks: 'sentry', breakMax: 1, breakCost: () => 1, boostCost: 2, boostAmount: () => 3 },
    { installCostModifier: state => (madeSuccessfulRunThisTurn(state) ? -2 : 0) }
  ),

  // Marjanah (Fracter): Interface -> 2c: Break 1 barrier subroutine. If you made a successful
  // run this turn, this ability costs 1c less to use. 1c: +1 strength.
  '30016': breaker({
    breaks: 'barrier',
    breakMax: 1,
    breakCost: state => (madeSuccessfulRunThisTurn(state) ? 1 : 2),
    boostCost: 1,
    boostAmount: () => 1,
  }),

  // Echelon (Killer): +1 strength for each installed icebreaker (including this one).
  // Interface -> 1c: Break 1 sentry subroutine. 3c: +2 strength.
  '30025': breaker({
    breaks: 'sentry',
    breakMax: 1,
    breakCost: () => 1,
    boostCost: 3,
    boostAmount: () => 2,
    strengthModifier: state => icebreakerCount(state),
  }),

  // Unity (Decoder): Interface -> 1c: Break 1 code gate subroutine. 1c: +X strength, where X is
  // the number of installed icebreakers (including this one).
  '30026': breaker(
    { breaks: 'code gate', breakMax: 1, breakCost: () => 1, boostCost: 1, boostAmount: icebreakerCount },
    { liveValue: state => `X = ${icebreakerCount(state)}: 1[credit] for +${icebreakerCount(state)} strength` }
  ),

  // Mayfly (AI): Interface -> 1c: Break 1 subroutine. When this run ends, trash this program.
  // 1c: +1 strength.
  '30032': breaker({
    breaks: 'any',
    breakMax: 1,
    breakCost: () => 1,
    boostCost: 1,
    boostAmount: () => 1,
    onBreakUsed: (state, mayfly) => {
      const run = state.activeRun;
      if (run && !run.trashAtRunEnd.includes(mayfly.instanceId)) run.trashAtRunEnd.push(mayfly.instanceId);
    },
  }),
};
