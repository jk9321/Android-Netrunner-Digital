/**
 * Stage C debugging aid: the hold owner's answer (runner's next turn) for every server of a saved state.
 *   STATE=tests/fixtures/bug-report-15-turn10.json npx vite-node scripts/stage-c/hold-probe.ts
 */
import { readFileSync } from 'node:fs';
import '../../src/ai';
import { GameState, cardDef } from '../../src/core';
import { asSide, plan, withPricing } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { serverHold } from '../../src/ai/corp/hold';

const s: GameState = JSON.parse(readFileSync(process.env.STATE ?? '', 'utf8'));
withPricing({ plan: { ...plan(), corpCore: true, rolloutLines: true } }, () =>
  asSide('corp', () => {
    decisionContext(s, 'corp');
    console.log(`corp $${s.corp.credits}, runner $${s.runner.credits}, last turn runs ${JSON.stringify(s.runnerLastTurnRuns)}`);
    for (const [id, v] of Object.entries(s.corp.servers)) {
      const h = serverHold(s, id, { when: 'runnerTurn' });
      console.log(`  ${id} [${v.ice.map(c => cardDef(c).title + (c.isRezzed ? '*' : '')).join(', ')}]: holds ${h.holds}, need ${h.need}, budget ${h.budget}, entries ${h.entries}`);
    }
  }),
);
