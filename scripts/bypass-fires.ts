/**
 * Part A fire count (spec jeff-games-48-50): plays deals as PLAN_OFF gives and, with plan.bypassHold off and on,
 * compares per Corp decision: holdCost's verdict for each iced server (holds or not, with what the Corp has),
 * scoreInTwo's line, and at an in-run rez window countedRez and whether modelRez rezzes. RUNNER_FIX takes the Runner
 * deck from a report fixture (Jeff's #48 Orris bypass deck) against each Corp deck.
 *   SEEDS=1001,1041 [RUNNER_FIX=tests/fixtures/human-games/report-48.json] [PLAN_OFF=+bypassHold] [SHARD=0/4] npx vite-node scripts/bypass-fires.ts
 */
import { readFileSync } from 'node:fs';
import { GameState, activePrompt, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff, tuning } from '../src/ai/synergy';
import { asSide } from '../src/ai/pricing';
import { holdCost, isCorpMain, scoreInTwo } from '../src/ai/countedScore';
import { countedRez, modelRezGain } from '../src/ai/rezModel';

applyPlanOff(process.env.PLAN_OFF ?? '');
const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const fixRunner = process.env.RUNNER_FIX ? JSON.parse(readFileSync(process.env.RUNNER_FIX, 'utf8')).config.runnerDeck : undefined;
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
const both = <T>(f: () => T): [string, string] => {
  const keep = tuning.plan;
  try {
    tuning.plan = { ...keep, bypassHold: false };
    const off = JSON.stringify(asSide('corp', f));
    tuning.plan = { ...keep, bypassHold: true };
    const on = JSON.stringify(asSide('corp', f));
    return [off, on];
  } finally {
    tuning.plan = keep;
  }
};
for (const [i, seed] of seeds.entries()) {
  if (i % shards !== shard) continue;
  const p = Math.floor((seed - 1001) / 10);
  const corpDeck = fixRunner ? corpDecks[i % corpDecks.length] : corpDecks[Math.floor(p / runnerDecks.length)];
  const runnerDeck = fixRunner ?? runnerDecks[p % runnerDecks.length];
  valueLoops.clear();
  const game = new GameRunner(createInitialGameState(deckGameSetup(seed, corpDeck, runnerDeck)), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  const n = { mainTurns: 0, holdChanged: 0, holdToNull: 0, scoreInTwo: 0, rezWindows: 0, countedRez: 0, modelRez: 0 };
  let turn = -1;
  const seen = new Set<string>();
  try {
    for (let k = 0; k < 8000; k++) {
      const s: GameState = game.state;
      if (s.activePlayer === 'corp' && isCorpMain(s) && !activePrompt(s) && s.turnNumber !== turn) {
        turn = s.turnNumber;
        n.mainTurns++;
        for (const v of Object.values(s.corp.servers).filter(x => x.ice.length > 0)) {
          const [off, on] = both(() => holdCost(s, v.ice, s.corp.credits));
          if (off !== on) n.holdChanged++;
          if (off !== 'null' && on === 'null') n.holdToNull++;
        }
        const [a, b] = both(() => scoreInTwo(s));
        if (a !== b) n.scoreInTwo++;
      }
      const run = s.activeRun;
      if (run && run.phase === 'approach_ice' && run.icePosition !== null && !activePrompt(s)) {
        const ice = s.corp.servers[run.server]?.ice[run.icePosition];
        const key = `${s.turnNumber}:${run.server}:${run.icePosition}:${ice?.instanceId}`;
        if (ice && !ice.isRezzed && !seen.has(key)) {
          seen.add(key);
          n.rezWindows++;
          const [a, b] = both(() => countedRez(s, ice));
          if (a !== b) n.countedRez++;
          const [c, d] = both(() => modelRezGain(s, ice, true) > 0);
          if (c !== d) n.modelRez++;
        }
      }
      if (!game.step()) break;
    }
  } catch (err) {
    console.error(`deal ${seed}: ${err}`);
    continue;
  }
  console.log(JSON.stringify({ seed, corp: corpDeck.name, runner: runnerDeck.name, winner: game.state.winner ?? null, turns: game.state.turnNumber, ...n }));
}
