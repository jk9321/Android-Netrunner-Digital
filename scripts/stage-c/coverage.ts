/**
 * Step 4 Stage C coverage (brief, "Coverage"; stage-c/c2-coverage.md): on the recorded Corp main-phase decisions that
 * reach Q7 under plan.corpCore (no win now, no score now, no held line's later step, no line step before the look-ahead,
 * not the turn-start window), is the move the old Corp played (planner on) in the new candidate list
 * (corp/candidates.ts), the first candidate, or within the planner's K (the intake under its two caps)? Each miss is
 * listed by kind with examples: the same card at place's server, or not offered at all.
 *   SHARD=0/4 npx vite-node scripts/stage-c/coverage.ts > cov-0.json
 */
import { GameAction, GameState, cardDef, findCardAnywhere, getLegalActions } from '../../src/core';
import { asSide, plan, withPricing } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { asRanked, corpCandidates, plannerIntake } from '../../src/ai/corp/candidates';
import { HeldLine, heldLaterStep, isCorpMain } from '../../src/ai/corp/lines';
import { lineStep } from '../../src/ai/corp/placement';
import { scoreNowPlan, winNowAction } from '../../src/ai/winNow';
import { PLANNER } from '../../src/ai/turnPlanner';
import { forEachRecorded } from '../stage-a/harness';
import { needsOldTree } from './old-tree';
needsOldTree('scripts/stage-c/coverage.ts');

type Tally = Record<string, number>;
const out = { decisions: 0, reachQ7: 0, inSet: 0, first: 0, inK: 0, otherServer: 0, missing: 0, behind: 0, missBy: {} as Tally, otherBy: {} as Tally, examples: {} as Record<string, string[]> };
const inc = (t: Tally, k: string) => (t[k] = (t[k] ?? 0) + 1);
const key = (a: GameAction) => JSON.stringify(Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'player').sort()));
const cardKey = (a: GameAction) => ('cardInstanceId' in a ? `${a.type}:${a.cardInstanceId}` : a.type);
const kindOf = (s: GameState, a: GameAction) => {
  const id = 'cardInstanceId' in a ? (a.cardInstanceId as string) : undefined;
  const c = id ? findCardAnywhere(s, id) : undefined;
  return `${a.type}${c ? ':' + cardDef(c).type_code : ''}`;
};
const label = (s: GameState, a: GameAction) => {
  const id = 'cardInstanceId' in a ? (a.cardInstanceId as string) : undefined;
  const c = id ? findCardAnywhere(s, id) : undefined;
  const at = 'targetServerId' in a && a.targetServerId ? '@' + a.targetServerId : 'asNewRemote' in a && a.asNewRemote ? '@new' : '';
  return `${a.type}${c ? ' ' + cardDef(c).title : ''}${at}${'trashFirst' in a && (a.trashFirst as string[] | undefined)?.length ? ' (trash first)' : ''}`;
};
const example = (k: string, text: string) => {
  const list = (out.examples[k] ??= []);
  if (list.length < 4) list.push(text);
};

forEachRecorded({
  decision: d => {
    const s = d.state;
    const played = d.action;
    if (d.kind !== 'action' || !played || !isCorpMain(s)) return;
    out.decisions++;
    const held = (d.before?.heldLine ?? null) as HeldLine | null;
    withPricing({ plan: { ...plan(), corpCore: true, rolloutLines: true } }, () =>
      asSide('corp', () => {
        decisionContext(s, 'corp');
        if (s.turnStep?.kind === 'corp_turn_start') return;
        if (winNowAction(s) || scoreNowPlan(s) || heldLaterStep(s, held) || lineStep(s, held ? structuredClone(held) : null)) return;
        out.reachQ7++;
        const list = corpCandidates(s, getLegalActions(s, 'corp'), { held, freeExhausted: false });
        const i = list.findIndex(c => key(c.action) === key(played));
        const where = `${d.src} T${s.turnNumber} c${s.corp.clicks} $${s.corp.credits}: played ${label(s, played)}; first ${list.slice(0, 3).map(c => label(s, c.action) + ' L' + c.line + (c.behind ? 'b' : '')).join('; ')}`;
        if (i < 0) {
          const other = list.find(c => cardKey(c.action) === cardKey(played));
          if (other) {
            out.otherServer++;
            inc(out.otherBy, kindOf(s, played));
            example(`other:${kindOf(s, played)}`, `${where} | new has ${label(s, other.action)}`);
          } else {
            out.missing++;
            inc(out.missBy, kindOf(s, played));
            example(`missing:${kindOf(s, played)}`, where);
          }
          return;
        }
        out.inSet++;
        if (list[i].behind) out.behind++;
        if (i === 0) out.first++;
        const open = asRanked(s, list).filter(r => r.score > -Infinity && r.action.type !== 'END_TURN' && r.action.type !== 'START_TURN');
        const picked = plannerIntake(open, PLANNER.candidates).picked;
        if (picked.some(r => key(r.action) === key(played))) out.inK++;
      }),
    );
  },
});
console.log(JSON.stringify(out));
