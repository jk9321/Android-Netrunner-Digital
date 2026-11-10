/**
 * #34b (bug report #34, Jeff's Runner test game 2 vs the Normal Corp, 2026-11-09): Jeff's Alarm Clock ran HQ at the start
 * of every turn from turn 8 to 14, and the Corp's threat model, which is our Runner AI's arithmetic, read HQ as never
 * run (its sum declines that run). The Runner's runs are public: it announces the attacked server (rules 6.1.2a,
 * 6.9.1a). plan.runRecord blends the runs the Runner actually made on its last turns into each server's run chance
 * (threatModel.ts recordRun), noted turn by turn by the deciding Corp (corpAI noteRuns).
 * In game 2 itself the Corp's play doesn't change: HQ held no agenda on those turns and the Corp had 0-1 credits, so a
 * second ice it couldn't rez would not have stopped the bypass. This pins the odds.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, actingSide, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { HeuristicCorpAI } from '../src/ai/corpAI';
import { RECORD, recordRun, threat } from '../src/ai/threatModel';
import { withPricing } from '../src/ai/pricing';
import { tuning } from '../src/ai/synergy';
import { inDecision } from './helpers/pricing';

/** Game 2 (report #34) replayed to the Corp's first decision of `turn`, a Normal Corp noting the Runner's runs each Corp turn. */
function noted(turn: number): { s: GameState; record: string[][] } {
  const report = JSON.parse(readFileSync(new URL('./fixtures/human-games/report-34.json', import.meta.url), 'utf8'));
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  const corp = new HeuristicCorpAI();
  let record: string[][] = [];
  let last = -1;
  for (const m of report.moves as GameAction[]) {
    const decision = s.activePlayer === 'corp' && s.corp.clicks > 0 && actingSide(s) === 'corp' && !s.pendingPrompts.length && m.type !== 'START_TURN';
    if (decision && last !== s.turnNumber) {
      last = s.turnNumber;
      record = inDecision(s, 'corp', () => corp.noteRuns(s));
      if (s.turnNumber === turn) break;
    }
    s = executeAction(s, m);
  }
  return { s, record };
}

const hqRun = (s: GameState, record: string[][] | null, on = true): number => {
  const was = tuning.plan.runRecord;
  tuning.plan.runRecord = on;
  try {
    const fresh = structuredClone(s);
    return inDecision(fresh, 'corp', () => withPricing({ runRecord: record }, () => threat(fresh))).servers.hq.run;
  } finally {
    tuning.plan.runRecord = was;
  }
};

describe('the threat reads the Runner’s run record (plan.runRecord, rules 6.1.2a, 6.9.1a)', () => {
  it('game 2 turn 12: after HQ runs on each of the last four turns, HQ is run next turn; the budget alone says never', () => {
    const { s, record } = noted(12);
    expect(record.slice(0, 4).every(turn => turn.includes('hq'))).toBe(true);
    expect(hqRun(s, record, false)).toBe(0);
    expect(hqRun(s, record)).toBe(1);
  });

  it('the record is noted turn by turn, most recent first', () => {
    const { record } = noted(9);
    expect(record[0]).toEqual(['hq']); // turn 8: Alarm Clock's HQ run
    expect(record[1]).toEqual(['rd']); // turn 7: Jailbreak on R&D
  });

  it('one turn of evidence counts a third', () => {
    expect(inDecision(noted(9).s, 'corp', () => withPricing({ runRecord: [['hq']] }, () => recordRun('hq')))).toBeCloseTo(1 / RECORD.full);
  });

  it('with no record the threat is the budget’s', () => {
    const { s } = noted(12);
    expect(hqRun(s, null)).toBe(hqRun(s, null, false));
    expect(hqRun(s, [])).toBe(0);
  });
});
