/**
 * Stage C1b log (brief C1b; written at C8): the install prompts that read the Corp's port `freeInstallTarget` (Synapse
 * Global's free install: the card pick and the server choice, prompts.ts) on every recorded Corp decision, answered by a
 * fresh Normal Corp of each core on a copy of the state: old = the ranking's port (installScore), new = the order's
 * (corp/candidates.ts freeInstallTarget). One JSON line per prompt. Needs plan.corpCore: run on 5b326b9 + beta or
 * `ai-corp-core-c-g1base` (e32341d), where the port switches on corpCore.
 *   SHARD=k/n npx vite-node scripts/stage-c/c1b-prompts.ts
 */
import { GameAction, GameState, activePrompt, cardDef, findCardAnywhere } from '../../src/core';
import { createAgent } from '../../src/ai';
import { plan, withPricing } from '../../src/ai/pricing';
import { clearCaches, forEachRecorded } from '../stage-a/harness';
import { needsOldTree } from './old-tree';

needsOldTree('scripts/stage-c/c1b-prompts.ts');
// Synapse Global: Faster than Thought (prompts.ts SYNAPSE)
const SYNAPSE = '35058';

const answer = (core: 'old' | 'new', s: GameState) =>
  withPricing({ plan: { ...plan(), corpCore: core === 'new', rolloutLines: core === 'new' } }, () => {
    clearCaches();
    return createAgent('corp', 'normal').chooseAction(structuredClone(s));
  });
const show = (s: GameState, a: GameAction) => {
  const c = (a as { choice?: { kind: string; optionId?: string; cardInstanceIds?: string[] } }).choice;
  if (!c) return a.type;
  if (c.optionId) return `option ${c.optionId}`;
  return `cards [${(c.cardInstanceIds ?? []).map(id => { const x = findCardAnywhere(s, id); return x ? cardDef(x).title : id; }).join(', ')}]`;
};

forEachRecorded({
  decision: d => {
    const p = activePrompt(d.state) as (ReturnType<typeof activePrompt> & { source?: { cardCode: string; step?: string } }) | undefined;
    if (!p || p.side !== 'corp' || !p.source) return;
    if (p.source.cardCode !== SYNAPSE) return;
    const o = answer('old', d.state);
    const n = answer('new', d.state);
    console.log(JSON.stringify({ src: d.src, i: d.i, T: d.state.turnNumber, step: p.source.step ?? '', kind: p.kind, old: show(d.state, o), new: show(d.state, n) }));
  },
});
