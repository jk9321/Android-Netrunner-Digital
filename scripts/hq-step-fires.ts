/**
 * ai-hr-install-steps (Jeff 2026-11-22, Humanoid Resources): how often the deciding Corp's HQ steps (corp/hqSteps.ts,
 * Q0a) answer a prompt, and how often that answer differs from the fallback's (answerPrompt), by the prompt's card and
 * step. One JSON line per deal. Seeds pick the deck pair as the batch does (scripts/money-fires.ts).
 *
 *   SEEDS=1001,1011 npx vite-node scripts/hq-step-fires.ts
 *   CORP_HAS='Humanoid Resources' COUNT=10 npx vite-node scripts/hq-step-fires.ts   # the first COUNT batch seeds whose Corp deck holds the card (by title)
 */
import { GameAction, GameState, activePrompt, createInitialGameState, getCardDefinition } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { Agent } from '../src/ai/agent';
import { GameRunner } from '../src/ai/playout';
import { answerPrompt } from '../src/ai/prompts';
import { hqStepAnswer } from '../src/ai/corp/hqSteps';
import { valueLoops } from '../src/ai/valueModel';

const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const pair = (seed: number) => {
  const p = Math.floor((seed - 1001) / 10);
  return { corp: corpDecks[Math.floor(p / runnerDecks.length)], runner: runnerDecks[p % runnerDecks.length] };
};
const has = process.env.CORP_HAS;
let seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
if (has) {
  seeds = [];
  for (let seed = 1001; seeds.length < Number(process.env.COUNT ?? 10) && pair(seed).corp; seed += 10) {
    if (pair(seed).corp.cards[has]) seeds.push(seed);
  }
}
for (const seed of seeds) {
  const { corp: cd, runner: rd } = pair(seed);
  valueLoops.clear();
  const fires: Record<string, number> = {};
  const changed: Record<string, number> = {};
  const corp: Agent = createAgent('corp', 'normal');
  const own = corp.chooseAction.bind(corp);
  corp.chooseAction = (state: GameState): GameAction => {
    const p = activePrompt(state);
    if (p && p.side === 'corp' && 'source' in p) {
      const mine = hqStepAnswer(state);
      if (mine) {
        const key = `${getCardDefinition(p.source.cardCode).title}/${p.source.step}`;
        fires[key] = (fires[key] ?? 0) + 1;
        if (JSON.stringify(mine) !== JSON.stringify(answerPrompt(state, 'corp', undefined, true))) changed[key] = (changed[key] ?? 0) + 1;
      }
    }
    return own(state);
  };
  const t0 = Date.now();
  const game = new GameRunner(createInitialGameState(deckGameSetup(seed, cd, rd)), { corp, runner: createAgent('runner', 'normal') });
  for (let i = 0; i < 6000 && game.step(); i++);
  console.log(JSON.stringify({ seed, corp: cd.name, winner: game.state.winner ?? null, turns: game.state.turnNumber, fires, changed, ms: Date.now() - t0 }));
}
