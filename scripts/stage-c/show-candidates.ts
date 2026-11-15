/**
 * Step 4 Stage C debugging aid: the Corp's candidate list (corp/candidates.ts) at its main-phase decisions of one local
 * deal, with each candidate's line, its "behind" flag and keys, and the move made.
 *   DEAL=1001 TURNS=3-6 npx vite-node scripts/stage-c/show-candidates.ts
 */
import { GameAction, GameState, cardDef, findCardAnywhere, getLegalActions } from '../../src/core';
import { asSide } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { corpCandidates } from '../../src/ai/corp/candidates';
import { isCorpMain } from '../../src/ai/corp/lines';
import { playDeal } from '../stage-a/harness';
import { applyPlanOff } from '../../src/ai/synergy';

const [lo, hi] = (process.env.TURNS ?? '1-99').split('-').map(Number);
const name = (s: GameState, a: GameAction) => {
  const id = 'cardInstanceId' in a ? (a.cardInstanceId as string) : undefined;
  const c = id ? findCardAnywhere(s, id) : undefined;
  const at = 'targetServerId' in a && a.targetServerId ? '@' + a.targetServerId : 'asNewRemote' in a && a.asNewRemote ? '@new' : '';
  return `${a.type}${c ? ' ' + cardDef(c).title : ''}${at}`;
};
applyPlanOff(process.env.PLAN_OFF ?? '');
playDeal(Number(process.env.DEAL ?? 1001), {
  decision: d => {
    const s = d.state;
    if (d.kind !== 'action' || !isCorpMain(s) || s.turnNumber < lo || s.turnNumber > hi) return;
    const list = asSide('corp', () => (decisionContext(s, 'corp'), corpCandidates(s, getLegalActions(s, 'corp'), { held: (d.before?.heldLine ?? null) as never, freeExhausted: false })));
    console.log(`T${s.turnNumber} clicks ${s.corp.clicks} credits ${s.corp.credits} HQ ${s.corp.hq.map(c => cardDef(c).title).join(', ')} -> ${d.action ? name(s, d.action) : null}`);
    for (const c of list.slice(0, 14)) console.log(`   L${c.line}${c.behind ? ' behind' : ''} [${c.keys.map(k => +k.toFixed(2)).join(' ')}] ${name(s, c.action)}`);
  },
});
