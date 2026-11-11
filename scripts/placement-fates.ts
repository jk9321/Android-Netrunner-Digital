/**
 * Step 4 G1+G2 (AI Coordinator 2026-11-11 23:25Z): where the agendas the count stopped end up. Plays the game-0 deals
 * Normal v Normal with this branch's switches (PLAN_OFF as in a batch) and follows each agenda whose advance (G1) or
 * remote install (G2) was the Corp's first pick and was stopped (countedScore.ts placementStats.stopped): scored later,
 * stolen from a remote, stolen from HQ, stolen elsewhere, still in HQ at game end, or other. One JSON line per deal.
 *
 *   SEEDS=1001,1011 [PLAN_OFF=placementAdvance] npx vite-node scripts/placement-fates.ts
 */
import { GameState, cardDef, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff } from '../src/ai/synergy';
import { placementStats } from '../src/ai/countedScore';

applyPlanOff(process.env.PLAN_OFF ?? '');

function playDeal(seed: number) {
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  const p = Math.floor((seed - 1001) / 10);
  const c = corpDecks[Math.floor(p / runnerDecks.length)];
  const r = runnerDecks[p % runnerDecks.length];
  valueLoops.clear();
  placementStats.stopped.length = 0;
  const start = createInitialGameState(deckGameSetup(seed, c, r));
  const game = new GameRunner(start, { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  const fate = new Map<string, string>();
  let prev: GameState = start;
  const step = (s: GameState) => {
    const had = new Set(prev.runner.scoreArea.map(x => x.instanceId));
    for (const x of s.runner.scoreArea) {
      if (had.has(x.instanceId) || cardDef(x).type_code !== 'agenda') continue;
      const remote = Object.values(prev.corp.servers).some(v => v.isRemote && v.root.some(y => y.instanceId === x.instanceId));
      fate.set(x.instanceId, remote ? 'stolen from a remote' : prev.corp.hq.some(y => y.instanceId === x.instanceId) ? 'stolen from HQ' : 'stolen elsewhere');
    }
    const scored = new Set(prev.corp.scoreArea.map(x => x.instanceId));
    for (const x of s.corp.scoreArea) if (!scored.has(x.instanceId)) fate.set(x.instanceId, 'scored');
    prev = s;
  };
  for (let i = 0; i < 6000; i++) {
    step(game.state);
    if (!game.step()) break;
  }
  step(game.state);
  const end = game.state;
  const first = new Map<string, { turn: number; kind: string }>();
  for (const x of placementStats.stopped) if (!first.has(x.id)) first.set(x.id, x);
  const stopped = [...first].map(([id, x]) => {
    const f = fate.get(id) ?? (end.corp.hq.some(y => y.instanceId === id) ? 'in HQ at game end' : Object.values(end.corp.servers).some(v => v.root.some(y => y.instanceId === id)) ? 'installed at game end' : 'other');
    return { id, turn: x.turn, kind: x.kind, fate: f };
  });
  return { seed, corp: c.name, runner: r.name, winner: end.winner ?? null, stops: placementStats.stopped.length, stopped };
}

const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
for (const seed of seeds) console.log(JSON.stringify(playDeal(seed)));
