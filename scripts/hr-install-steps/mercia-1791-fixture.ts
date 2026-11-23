// Writes tests/fixtures/hq-steps/mercia-1791-t2.json: the red team's seed 1791 board (Agency vs Party Hard, Corp turn 2,
// Mercia B4LL4RD's server step), played by GameRunner with the Normal agents. npx vite-node scripts/hr-install-steps/mercia-1791-fixture.ts
import { writeFileSync } from 'node:fs';
import { GameAction, GameState, activePrompt, cardDef, createInitialGameState } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { ALL_DECKS } from '../nsg-sample-decks';
import { createAgent } from '../../src/ai';
import { GameRunner } from '../../src/ai/playout';

const seed = 1791;
const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const p = Math.floor((seed - 1001) / 10);
const cd = corpDecks[Math.floor(p / runnerDecks.length)], rd = runnerDecks[p % runnerDecks.length];
const corp = createAgent('corp', 'normal');
const own = corp.chooseAction.bind(corp);
let saved: GameState | null = null;
corp.chooseAction = (s: GameState): GameAction => {
  const pr = activePrompt(s);
  if (!saved && pr && 'source' in pr && pr.source.cardCode === '35045' && pr.kind === 'effect_choice' && s.turnNumber === 2) saved = structuredClone(s);
  return own(s);
};
const game = new GameRunner(createInitialGameState(deckGameSetup(seed, cd, rd)), { corp, runner: createAgent('runner', 'normal') });
for (let i = 0; i < 6000 && !saved && game.step(); i++);
if (!saved) throw new Error('no Mercia server step on turn 2');
const s = saved as GameState;
console.log(cd.name, 'vs', rd.name, 'credits', s.corp.credits);
for (const v of Object.values(s.corp.servers)) console.log(' ', v.id, 'ice', v.ice.map(c => cardDef(c).title).join(','), 'root', v.root.map(c => cardDef(c).title).join(','));
writeFileSync('tests/fixtures/hq-steps/mercia-1791-t2.json', JSON.stringify(s));
