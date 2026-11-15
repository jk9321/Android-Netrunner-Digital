/**
 * Step 4 Stage C debugging aid: the model's play value (evaluate after less before, corp/candidates.ts) of each legal
 * Corp move at the main-phase decisions of one local deal, beside a credit's.
 *   DEAL=1001 TURNS=3-6 npx vite-node scripts/stage-c/play-values.ts
 */
import { GameAction, GameState, cardDef, findCardAnywhere, getLegalActions } from '../../src/core';
import { simulate } from '../../src/ai/prompts';
import { asSide } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { evaluate } from '../../src/ai/evaluate';
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
    asSide('corp', () => {
      decisionContext(s, 'corp');
      const before = evaluate(s, 'corp');
      console.log(`T${s.turnNumber} clicks ${s.corp.clicks} credits ${s.corp.credits} eval ${before.toFixed(2)} -> ${d.action ? name(s, d.action) : null}`);
      for (const a of getLegalActions(s, 'corp')) {
        const after = simulate(s, a);
        if (!after) continue;
        let line = `   ${(evaluate(after, 'corp') - before).toFixed(2)} ${name(s, a)}`;
        // An install then its rez, where the rez is legal at once
        const id = 'cardInstanceId' in a ? (a.cardInstanceId as string) : undefined;
        if (a.type === 'INSTALL_CARD' && id) {
          const rez = getLegalActions(after, 'corp').find(r => r.type === 'REZ_CARD' && r.cardInstanceId === id);
          const rezzed = rez ? simulate(after, rez) : null;
          if (rezzed) line += `  (rezzed ${(evaluate(rezzed, 'corp') - before).toFixed(2)})`;
        }
        console.log(line);
      }
    });
  },
});
