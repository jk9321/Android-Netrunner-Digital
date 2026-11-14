/**
 * Stage B5 labelled log, the decisions (AI Coordinator 21:05Z): at each recorded Corp decision where plan.b5RezOwner on
 * and off answer differently (from the record.ts compare), the board the answer was read on: the Corp's credits and
 * clicks, boardNeed's old count against keep (the Corp's view), the cards the two answers name, and each server's ice.
 *
 *   AT='report-41.json#19,report-43.json#79' npx vite-node scripts/stage-b/b5-decisions.ts
 */
import { GameAction, GameState, cardDef, findCardAnywhere } from '../../src/core';
import { asSide, plan, withPricing } from '../../src/ai/pricing';
import { planWith } from '../../src/ai/synergy';
import { decisionContext } from '../../src/ai/handValues';
import { boardNeed } from '../../src/ai/valueModel';
import { rezMoney } from '../../src/ai/corp/rezMoney';
import { clearCaches, forEachRecorded } from '../stage-a/harness';

const want = new Set((process.env.AT ?? '').split(',').filter(Boolean));
const title = (s: GameState, a: GameAction | null) => {
  const id = (a as { cardInstanceId?: string } | null)?.cardInstanceId;
  const c = id ? findCardAnywhere(s, id) : undefined;
  return c ? cardDef(c).title : '';
};
forEachRecorded({
  decision: d => {
    if (!want.has(`${d.src.replace('human:', '')}#${d.i}`)) return;
    const s = d.state;
    asSide('corp', () => {
      decisionContext(s, 'corp');
      const keep = boardNeed(structuredClone(s), 'corp');
      const old = withPricing({ plan: planWith(plan(), ['b5RezOwner']) }, () => boardNeed(structuredClone(s), 'corp'));
      const money = rezMoney(s);
      const servers = Object.values(s.corp.servers).map(v => `${v.id}[${v.ice.map(c => `${cardDef(c).title}${c.isRezzed ? '*' : ''}`).join(',')}|${v.root.map(c => cardDef(c).title).join(',')}]`);
      console.log(JSON.stringify({ at: `${d.src} #${d.i} T${d.turn} ${d.kind}`, credits: s.corp.credits, clicks: s.corp.clicks, runner: s.runner.credits, keep, oldNeed: old, byServer: money.byServer, played: d.action, card: title(s, d.action), servers, hq: s.corp.hq.map(c => cardDef(c).title) }));
    });
    clearCaches();
  },
});
