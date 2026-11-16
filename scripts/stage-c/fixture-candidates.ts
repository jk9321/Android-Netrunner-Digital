/**
 * Stage C debugging aid: the candidate list on one test fixture under plan.corpCore, each with its line, behind flag
 * and keys, the planner's K and slots, and what the Normal Corp plays (with and without the look-ahead).
 *   FIXTURE=ice-redirect-1001-t10.json npx vite-node scripts/stage-c/fixture-candidates.ts
 */
import { readFileSync } from 'node:fs';
import '../../src/ai';
import { GameAction, GameState, cardDef, findCardAnywhere, getLegalActions } from '../../src/core';
import { HeuristicCorpAI } from '../../src/ai/corpAI';
import { asSide, plan, withPricing } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { asRanked, corpCandidates, plannerIntake } from '../../src/ai/corp/candidates';
import { PLANNER } from '../../src/ai/turnPlanner';
import { newDiagnostics } from '../../src/ai/diagnostics';

const s: GameState = JSON.parse(readFileSync(`tests/fixtures/${process.env.FIXTURE}`, 'utf8'));
const name = (a: GameAction) => {
  const id = 'cardInstanceId' in a ? (a.cardInstanceId as string) : undefined;
  const c = id ? findCardAnywhere(s, id) : undefined;
  const at = 'targetServerId' in a && a.targetServerId ? '@' + a.targetServerId : 'asNewRemote' in a && a.asNewRemote ? '@new' : '';
  return `${a.type}${c ? ' ' + cardDef(c).title + ' ' + id : ''}${at}`;
};
const core = { ...plan(), corpCore: true, rolloutLines: true };
withPricing({ plan: core }, () =>
  asSide('corp', () => {
    decisionContext(s, 'corp');
    console.log(`T${s.turnNumber} clicks ${s.corp.clicks} credits ${s.corp.credits} HQ ${s.corp.hq.map(c => cardDef(c).title).join(', ')}`);
    const list = corpCandidates(s, getLegalActions(s, 'corp'), { held: null, freeExhausted: false });
    for (const c of list) console.log(`   L${c.line}${c.behind ? ' behind' : ''} [${c.keys.map(k => +k.toFixed(2)).join(' ')}] ${name(c.action)}`);
    const open = asRanked(s, list).filter(r => r.score > -Infinity && r.action.type !== 'END_TURN' && r.action.type !== 'START_TURN');
    const { picked, slots } = plannerIntake(open, PLANNER.candidates);
    console.log('K:', picked.map(r => name(r.action) + (slots.has(r) ? ` (${slots.get(r)} slot)` : '')).join('; '));
  }),
);
const diag = newDiagnostics();
diag.onCandidates = (side, values, actions) => {
  if (side === 'corp') console.log('planner values:', actions.map((a, i) => `${name(a)} ${values[i].toFixed(2)}`).join('; '));
};
console.log('planner plays', name(withPricing({ plan: core, diagnostics: diag }, () => new HeuristicCorpAI({ synergy: true }).chooseAction(structuredClone(s)))));
const off = { ...core, turnPlanner: { ...(core.turnPlanner ?? {}), corp: false } };
console.log('no look-ahead plays', name(withPricing({ plan: off }, () => new HeuristicCorpAI({ synergy: true }).chooseAction(structuredClone(s)))));
