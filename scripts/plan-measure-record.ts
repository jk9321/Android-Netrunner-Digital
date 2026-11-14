/**
 * Corp redesign stage 0 (spec /mnt/project-files/netrunner-ai/redesign/spec-stage0.md): plays the corp-losses deals
 * exactly as scripts/corp-losses.ts does (same seeds, agents, playLogged, shard layout) and also writes every move of
 * every game, so scripts/plan-measure.ts can replay the AI games the same way it replays Jeff's saved reports.
 *
 *   SHARD=i/64 npx vite-node scripts/plan-measure-record.ts -- [games per pairing] > out/i.json
 *
 * Output: a JSON array of { config: { seed, corpDeck, runnerDeck, ai: 'both', difficulty }, moves, winner, reason,
 * turns } (the human-games report shape, with the deck lists in full). Measurement only: the moves are taken from
 * GameRunner.apply, which this script wraps; nothing the agents see or decide changes.
 */
import { GameAction, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff } from '../src/ai/synergy';
import { playLogged } from './lossLog';

const games = Number(process.argv.slice(2).filter(a => a !== '--')[0] ?? 1);
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
applyPlanOff(process.env.PLAN_OFF ?? '');

let moves: GameAction[] = [];
// Only the game's own runner records: the AI's look-ahead plays its own GameRunners with other agents
let agents: object | null = null;
const apply = GameRunner.prototype.apply;
GameRunner.prototype.apply = function (this: GameRunner, action: GameAction) {
  if ((this as unknown as { agents: object }).agents === agents) moves.push(action);
  apply.call(this, action);
};

const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const stride = Math.max(10, games);
const out: unknown[] = [];
let pairing = 0;
let deal = 0;
for (const c of corpDecks) {
  for (const r of runnerDecks) {
    pairing++;
    for (let g = 0; g < games; g++) {
      const seed = 1000 + (pairing - 1) * stride + g + 1;
      if (deal++ % shards !== shard) continue;
      valueLoops.clear();
      moves = [];
      try {
        const pair = { corp: createAgent('corp', 'normal', {}), runner: createAgent('runner', 'normal', {}) };
        agents = pair;
        const record = playLogged(createInitialGameState(deckGameSetup(seed, c, r)), pair, { corp: c.name, runner: r.name });
        out.push({ config: { seed, corpDeck: c, runnerDeck: r, ai: 'both', difficulty: 'normal' }, moves, winner: record.winner, reason: record.reason, turns: record.turns });
      } catch (err) {
        out.push({ config: { seed, corpDeck: c, runnerDeck: r, ai: 'both', difficulty: 'normal' }, crashed: `${err}`.slice(0, 200) });
      }
    }
  }
}
console.log(JSON.stringify(out));
