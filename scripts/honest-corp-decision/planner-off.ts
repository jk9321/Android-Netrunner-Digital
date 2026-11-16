/**
 * ai-honest-corp-decision (red team 2026-11-16 ruling 8b): the planner's rollout Corp and the reply's Corp must not
 * change. Plays each of the 56 local deals (scripts/stage-a/harness.ts dealState) with a planner-off Corp
 * (HeuristicCorpAI planner: false, the rollouts' and the reply's Corp) against the Normal Runner and prints one line per
 * deal: the seed, the number of actions and a hash of every action and rez answer. Run on the base and on the branch
 * (the same file copied into the base checkout); the two outputs must be identical.
 *   SHARD=0/4 npx vite-node scripts/honest-corp-decision/planner-off.ts > off-0.txt
 */
import { createHash } from 'node:crypto';
import { CardInstance, GameAction, GameState } from '../../src/core';
import { HeuristicCorpAI, createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { valueLoops } from '../../src/ai/valueModel';
import { clearCaches, dealState, deals } from '../stage-a/harness';

const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
deals().forEach((seed, k) => {
  if (k % shards !== shard) return;
  valueLoops.clear();
  const hash = createHash('sha256');
  let n = 0;
  const inner = new HeuristicCorpAI({ planner: false });
  const corp: Agent = {
    side: 'corp',
    chooseAction(state: GameState) {
      clearCaches();
      const a = inner.chooseAction(state);
      hash.update(JSON.stringify(a));
      n++;
      return a;
    },
    chooseRez(state: GameState, cards: CardInstance[]) {
      clearCaches();
      const a: GameAction | null = inner.chooseRez(state, cards);
      hash.update(JSON.stringify(a));
      n++;
      return a;
    },
  } as Agent;
  const runner = createAgent('runner', 'normal');
  const game = new GameRunner(dealState(seed), { corp, runner: { side: 'runner', chooseAction: s => (clearCaches(), runner.chooseAction(s)), chooseOffTurn: s => (clearCaches(), runner.chooseOffTurn?.(s) ?? null) } as Agent });
  for (let i = 0; i < 4000 && game.step(); i++);
  console.log(`${seed} ${n} ${hash.digest('hex').slice(0, 16)} ${game.state.winner ?? '-'}`);
});
