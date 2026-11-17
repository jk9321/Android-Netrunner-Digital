/**
 * Stage D item 1 (brief rev 2, 4.6 and 7): decision time on whole games, every agent call timed, for a tree against
 * another checkout of the base (run this file in each; play is identical in branch 1, so the decisions line up).
 * GAMES: the tests/aiGames.ts games by index (default 4: seed 104, Quick and Dirty vs Bowel Movements), played as
 * playAIGame does (seed 100 + index); DEALS: batch deals (scripts/stage-a/harness.ts dealState). Prints one JSON line
 * per side: decisions, total, mean, p95, max ms, and the per-decision times (for pairing).
 *   GAMES=4 npx vite-node scripts/stage-d/time-game.ts
 */
import { GameState, createInitialGameState } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner } from '../../src/ai/playout';
import { ALL_DECKS } from '../nsg-sample-decks';
import { dealState } from '../stage-a/harness';

const games = (process.env.GAMES ?? '4').split(',').filter(Boolean).map(Number);
const dealSeeds = (process.env.DEALS ?? '').split(',').filter(Boolean).map(Number);

function timed(side: 'corp' | 'runner', times: number[]): Agent {
  const inner = createAgent(side, 'normal');
  return new Proxy(inner, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== 'function' || !['chooseAction', 'chooseRez', 'chooseOffTurn'].includes(String(prop))) return v;
      return (...args: unknown[]) => {
        const t = performance.now();
        const r = v.apply(target, args);
        times.push(performance.now() - t);
        return r;
      };
    },
  });
}

function play(name: string, start: GameState) {
  const times = { corp: [] as number[], runner: [] as number[] };
  const game = new GameRunner(start, { corp: timed('corp', times.corp), runner: timed('runner', times.runner) });
  const t = performance.now();
  for (let n = 0; n < 4000 && game.step(); n++);
  const total = performance.now() - t;
  for (const side of ['corp', 'runner'] as const) {
    const xs = times[side];
    const sorted = [...xs].sort((a, b) => a - b);
    const sum = xs.reduce((a, b) => a + b, 0);
    console.log(JSON.stringify({ game: name, side, winner: game.state.winner, turn: game.state.turnNumber, total: Math.round(total), decisions: xs.length, sum: Math.round(sum), mean: +(sum / xs.length).toFixed(2), p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1), max: Math.round(sorted.at(-1)!), times: xs.map(x => Math.round(x)) }));
  }
}

const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
for (const index of games) play(`aiGames-${index}`, createInitialGameState(deckGameSetup(100 + index, corpDecks[index], runnerDecks[index % runnerDecks.length])));
for (const seed of dealSeeds) play(`deal-${seed}`, dealState(seed));
