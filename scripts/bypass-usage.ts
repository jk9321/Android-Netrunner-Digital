/**
 * Bypass usage in self-play: Mercury decks (and other bypass decks) against
 * the shipped Corp decks. Counts bypass prompts offered and taken, and how
 * often the bypass run events (S-Dobrado, Window of Opportunity) are played.
 *
 *   npx vite-node scripts/bypass-usage.ts -- [games per Corp deck]
 */
import { createInitialGameState } from '../src/core';
import { activePrompt } from '../src/core/engine/prompts';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../src/data/testDecks/nrdb';
import { IDENTITY_TEST_DECKS } from '../src/data/testDecks/identityDecks';
import { createAgent, playAIGame } from '../src/ai';
import { GameState } from '../src/core/types';

const games = Number(process.argv.slice(2).filter(a => a !== '--')[0] ?? 2);
const runners = [...NRDB_TEST_DECKS, ...IDENTITY_TEST_DECKS].filter(d => ['lib-a-job-well-done', 'nrdb-bypass-orris-bypass'].includes(d.id));
const corps = ALL_DECKS.filter(d => d.side === 'corp');
const offered = new Map<string, number>();
const taken = new Map<string, number>();
const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
let runnerWins = 0, n = 0, bypassed = 0;
const played = { dobrado: 0, window: 0 }, held = { dobrado: 0, window: 0 };
for (const r of runners) for (const c of corps) for (let g = 0; g < games; g++) {
  const seed = 5000 + n;
  let state: GameState = createInitialGameState(deckGameSetup(seed, c, r));
  const runner = createAgent('runner');
  const choose = runner.chooseAction.bind(runner);
  runner.chooseAction = (st: GameState) => {
    const prompt = activePrompt(st);
    if (!prompt && st.runner.clicks > 0 && !st.activeRun && st.activePlayer === 'runner') {
      if (st.runner.grip.some(x => x.cardCode === '34012')) held.dobrado++;
      if (st.runner.grip.some(x => x.cardCode === '34077')) held.window++;
    }
    const action = choose(st);
    if (prompt && prompt.kind === 'effect_choice' && 'source' in prompt && prompt.source.cardCode === '34078' && prompt.source.step === 'run') {
      inc(offered, 'alarmRun');
      if (action.type === 'RESOLVE_PROMPT' && action.choice.kind === 'effect_choice' && action.choice.optionId === 'yes') inc(taken, 'alarmRun');
    }
    if (prompt && prompt.kind === 'effect_choice' && 'source' in prompt && prompt.source.step === 'bypass') {
      inc(offered, prompt.source.cardCode);
      const id = action.type === 'RESOLVE_PROMPT' && action.choice.kind === 'effect_choice' ? action.choice.optionId : 'no';
      if (id !== 'no') inc(taken, prompt.source.cardCode);
    }
    if (action.type === 'PLAY_OPERATION_OR_EVENT') {
      const card = st.runner.grip.find(x => x.instanceId === action.cardInstanceId);
      if (card?.cardCode === '34012') played.dobrado++;
      if (card?.cardCode === '34077') played.window++;
    }
    return action;
  };
  state = playAIGame(state, 3000, 80, { corp: createAgent('corp'), runner }).state;
  bypassed += state.log.filter(l => /bypassed/.test(l.message)).length;
  if (state.winner === 'runner') runnerWins++;
  n++;
}
console.log(JSON.stringify({ games: n, runnerWins, played, heldTurnSteps: held, bypassed, offered: Object.fromEntries(offered), taken: Object.fromEntries(taken) }, null, 1));
