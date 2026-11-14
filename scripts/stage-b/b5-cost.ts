/**
 * Stage B5 cost: at recorded human-game states, the Normal Corp's decision time with plan.b5RezOwner on, how many times
 * boardNeed asked rez money's keep, how many distinct state objects it asked on, and the time spent inside it.
 *
 *   [PLAN_OFF=b5RezOwner] AT=49:82,53:76 npx vite-node scripts/stage-b/b5-cost.ts
 */
import { readFileSync } from 'node:fs';
import { GameAction, GameState, createInitialGameState, executeAction } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { createAgent } from '../../src/ai';
import { setRezKeep } from '../../src/ai/valueModel';
import { applyPlanOff } from '../../src/ai/synergy';
import { rezMoney } from '../../src/ai/corp/rezMoney';
import { clearCaches } from '../stage-a/harness';

const at = (n: number, move: number): GameState => {
  const r = JSON.parse(readFileSync(`tests/fixtures/human-games/report-${n}.json`, 'utf8'));
  let s: GameState = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  for (const m of (r.moves as GameAction[]).slice(0, move)) s = executeAction(s, m);
  return s;
};
applyPlanOff(process.env.PLAN_OFF ?? '');
let calls = 0;
let inside = 0;
let seen = new WeakSet<GameState>();
let distinct = 0;
setRezKeep(state => {
  calls++;
  if (!seen.has(state)) {
    seen.add(state);
    distinct++;
  }
  const t = performance.now();
  const k = rezMoney(state).keep;
  inside += performance.now() - t;
  return k;
});
for (const spec of (process.env.AT ?? '49:82').split(',')) {
  const [n, m] = spec.split(':').map(Number);
  const s = at(n, m);
  calls = 0; inside = 0; distinct = 0; seen = new WeakSet();
  clearCaches();
  const t = performance.now();
  createAgent('corp', 'normal').chooseAction(s);
  console.log(`report-${n} #${m}: ${(performance.now() - t).toFixed(0)} ms, keep asked ${calls} times on ${distinct} states, ${inside.toFixed(0)} ms inside`);
}
