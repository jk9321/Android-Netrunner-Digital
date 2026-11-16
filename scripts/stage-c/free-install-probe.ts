/** C1b probe: the free-install score (evaluate after a free install less before) on the Synapse #13 fixture. */
import { centralStake } from '../../src/ai/corp/pools';
import { readFileSync } from 'node:fs';
import { GameState, cardDef } from '../../src/core';
import { evaluate } from '../../src/ai/evaluate';
import { asSide } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import { freeInstallTarget } from '../../src/ai/corpAI';
const s: GameState = JSON.parse(readFileSync('tests/fixtures/bug-report-13-synapse.json', 'utf8'));
const free = (st: GameState, id: string, server: string): GameState => {
  const c = structuredClone(st);
  const card = c.corp.hq.find(x => x.instanceId === id)!;
  c.corp.hq = c.corp.hq.filter(x => x !== card);
  const ice = cardDef(card).type_code === 'ice';
  const v = server === 'new' ? (c.corp.servers['remote-free'] = { id: 'remote-free', name: 'New', isRemote: true, ice: [], root: [] }) : c.corp.servers[server];
  (ice ? v.ice : v.root).push({ ...card, isRezzed: false });
  return c;
};
asSide('corp', () => {
  decisionContext(s, 'corp');
  const base = evaluate(s, 'corp');
  for (const card of s.corp.hq) {
    if (cardDef(card).type_code === 'agenda') continue;
    const row = [...Object.keys(s.corp.servers), 'new'].map(id => `${id} ${(evaluate(free(s, card.instanceId, id), 'corp') - base).toFixed(2)}`);
    console.log(cardDef(card).title, row.join(' | '), 'old:', JSON.stringify(freeInstallTarget(s, card, [...Object.keys(s.corp.servers), 'new'])));
  }
});

// The pin with plan.corpCore on: the order's free install (corp/candidates.ts freeInstallTarget)
import { executeAction } from '../../src/core';
import { createAgent } from '../../src/ai';
import { plan, withPricing } from '../../src/ai/pricing';
withPricing({ plan: { ...plan(), corpCore: true } }, () => {
  let t: GameState = JSON.parse(readFileSync('tests/fixtures/bug-report-13-synapse.json', 'utf8'));
  const agent = createAgent('corp', 'normal');
  for (let i = 0; i < 4 && t.pendingPrompts[0]?.side === 'corp'; i++) t = executeAction(t, agent.chooseAction(t));
  console.log('corpCore:', Object.values(t.corp.servers).map(v => v.id + ':' + v.ice.map(c => cardDef(c).title).join(',')).join(' '), 'hq', t.corp.hq.map(c => cardDef(c).title), JSON.stringify(withPricing({ plan: { ...plan(), corpCore: true } }, () => asSide('corp', () => centralStake(s, 'x')))), s.corp.credits, s.runner.credits);
});
