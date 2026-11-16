/**
 * Step S-1 decision time per family (the bar's "decision time per arm"; the fire count's ratios were biased low because its
 * base decision paid the warm-up). At every EVERY-th Corp decision of the 56 local deals (Normal v Normal, nothing
 * ablated), one untimed warm-up decision, then the decision timed with nothing ablated, with each listed family ablated
 * for the Corp, and with nothing ablated again (base = the mean of the two). Caches cleared before each. One JSON line
 * per decision. ARGS: comma list of families (default all). SHARD=k/n takes every n-th deal; EVERY (default 5).
 *   SHARD=0/4 npx vite-node scripts/step-s/arm-time.ts -- threatValues
 */
import { CardInstance, GameState } from '../../src/core';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { ABLATE_FAMILIES, applyAblate } from '../../src/ai/pricing';
import { valueLoops } from '../../src/ai/valueModel';
import { clearCaches, dealState, deals } from '../stage-a/harness';

const only = (process.env.ARGS ?? process.argv.slice(2).join(' ')).split(/[\s,]+/).filter(Boolean);
const families = only.length ? ABLATE_FAMILIES.filter(f => only.includes(f)) : [...ABLATE_FAMILIES];
const every = Number(process.env.EVERY ?? 5);

function timed(s: GameState, kind: 'action' | 'rez', cards: CardInstance[] | undefined, ablate: string): number {
  applyAblate(ablate);
  clearCaches();
  const t = performance.now();
  try {
    const agent = createAgent('corp', 'normal');
    if (kind === 'rez') agent.chooseRez?.(structuredClone(s), cards ?? []);
    else agent.chooseAction(structuredClone(s));
  } catch {
    // an error is the fire count's business; time what ran
  } finally {
    applyAblate('');
  }
  return performance.now() - t;
}

function watched(src: string): Agent {
  const inner = createAgent('corp', 'normal');
  let i = 0;
  const measure = (s: GameState, kind: 'action' | 'rez', cards?: CardInstance[]) => {
    if (i++ % every) return;
    timed(s, kind, cards, '');
    const a = timed(s, kind, cards, '');
    const ms: Record<string, number> = {};
    for (const f of families) ms[f] = Math.round(timed(s, kind, cards, `corp:${f}`));
    const b = timed(s, kind, cards, '');
    console.log(JSON.stringify({ src, i: i - 1, kind, base: Math.round((a + b) / 2), ms }));
  };
  return {
    side: 'corp',
    chooseAction(state: GameState) {
      if (!state.winner) measure(state, 'action');
      clearCaches();
      return inner.chooseAction(state);
    },
    chooseRez(state: GameState, cards: CardInstance[]) {
      measure(state, 'rez', cards);
      clearCaches();
      return inner.chooseRez?.(state, cards) ?? null;
    },
  } as Agent;
}

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
deals().forEach((seed, k) => {
  if (k % shards !== shard) return;
  valueLoops.clear();
  const runner = createAgent('runner', 'normal');
  const game = new GameRunner(dealState(seed), { corp: watched(`deal:${seed}`), runner });
  for (let n = 0; n < 4000 && game.step(); n++);
});
