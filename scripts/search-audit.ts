/**
 * Spec-search S1 (/mnt/project-files/netrunner-ai/tuning-pass/spec-search.md): the Corp planner's continuations,
 * measured on the batch deals with no play change. turnPlanner.ts auditSearch plays every candidate of a Corp decision
 * on three lines (rule, hold, finish-first) after the pick is made; lossLog.ts keeps one compact tuple per decision
 * (batch token +audit.search in PLAN_OFF); scripts/search-audit-sum.mjs prints the report from a batch's records.
 */
import { SearchRow } from '../src/ai/turnPlanner';

/**
 * [type, agenda 1/0, rule, hold, hold distinct 1/0, finish, finish distinct 1/0, rule line re-sampled on two fresh reply
 * deals (the noise floor)] (values: null when the first action failed, or no sampled reply)
 */
export type CandidateTuple = [string, 0 | 1, number | null, number | null, 0 | 1, number | null, 0 | 1, number | null];
/** [kind, turnNumber, clicks, credits, chosen value, pick index, candidates, ms, reply ms, extra ms] */
export type SearchTuple = [SearchRow['kind'], number, number, number, number, number, CandidateTuple[], number, number, number];

export function searchTuple(r: SearchRow): SearchTuple {
  const cands = r.candidates.map(c => {
    const [rule, hold, finish] = (['rule', 'hold', 'finish'] as const).map(m => c.lines.find(l => l.mode === m)!);
    return [c.type, c.agenda ? 1 : 0, rule.value, hold.value, hold.distinct ? 1 : 0, finish.value, finish.distinct ? 1 : 0, c.resample] as CandidateTuple;
  });
  return [r.kind, r.turn, r.clicks, r.credits, r.chosen, r.pick, cands, r.ms, r.replyMs, r.extraMs];
}
