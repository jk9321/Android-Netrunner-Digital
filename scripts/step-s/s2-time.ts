/**
 * Step S-2 time check before any batch (brief-step-s.md: "check the workflow's time limit before launching"): at every
 * Corp decision of the local deals (played Normal v Normal, shipped settings), the decision is timed with the shipped
 * planner and with each S-2 setting (2x and 4x width, 2x depth). One JSON line per decision. ARGS: a comma list of
 * settings (default all). SHARD=k/n takes every n-th deal.
 *   DEALS=1001 npx vite-node scripts/step-s/s2-time.ts
 */
import { CardInstance, GameState } from '../../src/core';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { tuning } from '../../src/ai/synergy';
import { THINK } from '../../src/ai/oracle';
import { PLANNER } from '../../src/ai/turnPlanner';
import { REPLY } from '../../src/ai/runnerReply';
import { clearCaches, dealState, deals } from '../stage-a/harness';

const SETTINGS: Record<string, { width: number; depth: number }> = { base: { width: 1, depth: 1 }, w2: { width: 2, depth: 1 }, w4: { width: 4, depth: 1 }, d2: { width: 1, depth: 2 } };
const want = (process.env.ARGS ?? process.argv.slice(2).join(' ')).split(/[\s,]+/).filter(Boolean);
const settings = Object.keys(SETTINGS).filter(k => !want.length || want.includes(k) || k === 'base');
const shipped = tuning.plan;

function timed(s: GameState, kind: 'action' | 'rez', cards: CardInstance[] | undefined, key: string): number {
  const { width, depth } = SETTINGS[key];
  THINK.candidates = PLANNER.candidates * width;
  THINK.samples = REPLY.samples * width;
  REPLY.turns = depth;
  tuning.plan = width > 1 ? { ...shipped, oracle: { ...shipped.oracle, think: true } } : shipped;
  clearCaches();
  const t = performance.now();
  const agent = createAgent('corp', 'normal');
  try {
    if (kind === 'rez') agent.chooseRez?.(structuredClone(s), cards ?? []);
    else agent.chooseAction(structuredClone(s));
  } finally {
    tuning.plan = shipped;
    REPLY.turns = 1;
  }
  return Math.round(performance.now() - t);
}

function watched(src: string): Agent {
  const inner = createAgent('corp', 'normal');
  let i = 0;
  const measure = (s: GameState, kind: 'action' | 'rez', cards?: CardInstance[]) => {
    const ms: Record<string, number> = {};
    for (const k of settings) ms[k] = timed(s, kind, cards, k);
    console.log(JSON.stringify({ src, i: i++, kind, T: s.turnNumber, ms }));
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
  const runner = createAgent('runner', 'normal');
  const game = new GameRunner(dealState(seed), { corp: watched(`deal:${seed}`), runner });
  for (let n = 0; n < 4000 && game.step(); n++);
});
