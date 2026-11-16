/** C1b trace on the Synapse #13 fixture: the free-install order with its lines and keys, and the central hold counts. */
import { readFileSync } from 'node:fs';
import '../../src/ai';
import { GameState, cardDef } from '../../src/core';
import { asSide, plan, withPricing } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { serverHold } from '../../src/ai/corp/hold';
import { freeInstallOrder } from '../../src/ai/corp/candidates';
import { rezMoney } from '../../src/ai/corp/rezMoney';
import { needsOldTree } from './old-tree';
needsOldTree('scripts/stage-c/free-install-trace.ts');

const s: GameState = JSON.parse(readFileSync('tests/fixtures/bug-report-13-synapse.json', 'utf8'));
const servers = Object.values(s.corp.servers).map(v => `${v.id}[${v.ice.map(c => cardDef(c).title + (c.isRezzed ? '*' : '')).join(',')}|${v.root.map(c => cardDef(c).title).join(',')}]`);
console.log(servers.join(' '), 'corp credits', s.corp.credits, 'runner credits', s.runner.credits);
withPricing({ plan: { ...plan(), corpCore: true } }, () =>
  asSide('corp', () => {
    decisionContext(s, 'corp');
    console.log('keep', rezMoney(s).keep);
    for (const id of ['hq', 'rd']) {
      const h = serverHold(s, id, { when: 'runnerTurn' });
      console.log(id, 'holds', h.holds, 'entries', h.entries, 'margin', h.margin);
    }
    for (const c of freeInstallOrder(s, [...Object.keys(s.corp.servers), 'new'])) console.log(JSON.stringify(c));
  }),
);
