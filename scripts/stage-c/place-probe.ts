/**
 * Stage C debugging aid: where `place` puts one card of HQ on a saved state, from each legal install of it, with keep,
 * each central's ice and stake, the count at each proposed server (iceCount) and the scoring remote.
 *   STATE=tests/fixtures/bug-report-4-turn13.json TITLE=Palisade npx vite-node scripts/stage-c/place-probe.ts
 */
import { readFileSync } from 'node:fs';
import '../../src/ai';
import { GameAction, GameState, cardDef, executeAction, getLegalActions, rezCostOf } from '../../src/core';
import { asSide, plan, withPricing } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { iceCount, place } from '../../src/ai/corp/placement';
import { rezMoney } from '../../src/ai/corp/rezMoney';
import { centralStake } from '../../src/ai/corp/pools';
import { scoringRemote } from '../../src/ai/corp/lines';
import { needsOldTree } from './old-tree';
needsOldTree('scripts/stage-c/place-probe.ts');

const s: GameState = JSON.parse(readFileSync(process.env.STATE ?? '', 'utf8'));
withPricing({ plan: { ...plan(), corpCore: true, rolloutLines: true } }, () =>
  asSide('corp', () => {
    decisionContext(s, 'corp');
    const card = s.corp.hq.find(c => cardDef(c).title === process.env.TITLE)!;
    const keep = rezMoney(s).keep;
    const stakes = centralStake(s, card.instanceId);
    console.log(`${cardDef(card).title}: credits ${s.corp.credits}, clicks ${s.corp.clicks}, keep ${keep}, rez ${rezCostOf(s, card)}; runner ${s.runner.credits} credits, ${s.runner.score} points`);
    for (const id of ['hq', 'rd'] as const) console.log(`  ${id}: ice ${s.corp.servers[id].ice.length}, stake ${JSON.stringify(stakes[id])}`);
    console.log(`  scoring remote ${scoringRemote(s)?.id ?? 'none'}`);
    const installs = getLegalActions(s, 'corp').filter((a): a is GameAction & { type: 'INSTALL_CARD' } => a.type === 'INSTALL_CARD' && a.cardInstanceId === card.instanceId && !a.trashFirst?.length);
    for (const a of installs) {
      const count = iceCount(s, a as never, card, executeAction(s, a));
      const p = place(s, card, { from: a as never, held: null });
      console.log(`  from ${a.targetServerId ?? 'new'}: count ${count ? `was ${count.was.holds}/${count.was.entries} now ${count.now.holds}/${count.now.entries}` : 'none'}; place ${JSON.stringify(p.map(x => ({ server: x.server, reason: x.reason })))}`);
    }
  }),
);
