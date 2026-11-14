/**
 * Writes the recorded states tests/corpOwners.test.ts reads, so the test does not play a deal (fast gate, 5 s line):
 *  - tests/fixtures/stage-a-deal-1001.json: { approach: the first 6 approach-ice windows the Corp holds, runs: the first
 *    10 states with a run under way }, from deal 1001 (Normal v Normal, the test's own deal pairing).
 *  - tests/fixtures/stage-a-held-asset-1921-18.json: deal 1921's Corp decision #18 (scripts/stage-a/harness.ts), the
 *    state and the held asset line, where place once returned "a counted line takes the click".
 *
 *   npx vite-node scripts/stage-a/fixtures.ts
 */
import { writeFileSync } from 'node:fs';
import { GameState, createInitialGameState } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { ALL_DECKS } from '../nsg-sample-decks';
import { createAgent } from '../../src/ai';
import { GameRunner } from '../../src/ai/playout';
import { playDeal } from './harness';

const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const p = 0; // seed 1001
const game = new GameRunner(createInitialGameState(deckGameSetup(1001, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length])), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
const approaching = (s: GameState) => !!s.activeRun && s.activeRun.icePosition !== null && s.priority?.step === 'approach_ice' && s.priority.holder === 'corp' && !!s.corp.servers[s.activeRun.server]?.ice[s.activeRun.icePosition];
const approach: GameState[] = [];
const runs: GameState[] = [];
for (let i = 0; i < 2000 && (approach.length < 6 || runs.length < 10) && game.step(); i++) {
  if (approach.length < 6 && approaching(game.state)) approach.push(game.state);
  if (runs.length < 10 && game.state.activeRun) runs.push(game.state);
}
writeFileSync('tests/fixtures/stage-a-deal-1001.json', JSON.stringify({ approach, runs }));

let saved = false;
playDeal(1921, {
  decision: d => {
    if (d.i !== 18 || saved) return;
    writeFileSync('tests/fixtures/stage-a-held-asset-1921-18.json', JSON.stringify({ state: d.state, held: d.before?.heldLine ?? null, played: d.action }));
    saved = true;
  },
});
console.log(`approach ${approach.length}, runs ${runs.length}, 1921 #18 ${saved ? 'saved' : 'MISSING'}`);
