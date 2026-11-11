/**
 * Pressure Runner look (step 4, spec-step4-placement.md; AI Coordinator 2026-11-11): plays deals Normal v Normal with
 * the Runner as it is, or as the pressure Runner (PRESSURE=1, plan.pressureRunner), and records per deal the winner,
 * the Runner's runs, the runs the pressure Runner forced and how many of those ended in a breach (successful, rule 6.9.5),
 * and the agenda points the Runner took by where they came from (HQ, R&D, Archives, a remote). One JSON line per deal.
 *
 *   SEEDS=1001,1011 PRESSURE=1 npx vite-node scripts/pressure-look.ts
 */
import { GameState, cardDef, createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff } from '../src/ai/synergy';
import { pressureStats } from '../src/ai/runnerAI';

if (process.env.PRESSURE === '1') applyPlanOff('+pressureRunner');

function where(prev: GameState, id: string): string {
  if (prev.corp.hq.some(c => c.instanceId === id)) return 'hq';
  if (prev.corp.rd.some(c => c.instanceId === id)) return 'rd';
  if ([...prev.corp.archives.faceUp, ...prev.corp.archives.faceDown].some(c => c.instanceId === id)) return 'archives';
  if (Object.values(prev.corp.servers).some(v => v.isRemote && v.root.some(c => c.instanceId === id))) return 'remote';
  return 'other';
}

function playDeal(seed: number) {
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  const p = Math.floor((seed - 1001) / 10);
  const c = corpDecks[Math.floor(p / runnerDecks.length)];
  const r = runnerDecks[p % runnerDecks.length];
  valueLoops.clear();
  pressureStats.runs.length = 0;
  const start = createInitialGameState(deckGameSetup(seed, c, r));
  const corp = createAgent('corp', 'normal');
  const runner = createAgent('runner', 'normal');
  let forcedNext = false;
  const chooseR = runner.chooseAction.bind(runner);
  runner.chooseAction = (s: GameState) => {
    const before = pressureStats.runs.length;
    const a = chooseR(s);
    if (pressureStats.runs.length > before) forcedNext = true;
    return a;
  };
  const points: Record<string, number> = {};
  let runs = 0;
  let forced = 0;
  let forcedBreached = 0;
  let current: { forced: boolean } | null = null;
  let prev = start;
  const game = new GameRunner(start, { corp, runner });
  const step = (s: GameState) => {
    if (s.activeRun && !prev.activeRun) {
      runs++;
      current = { forced: forcedNext };
      if (forcedNext) forced++;
      forcedNext = false;
    }
    if (!s.activeRun && prev.activeRun && current) {
      const last = s.runsThisTurn[s.runsThisTurn.length - 1];
      if (current.forced && last?.successful) forcedBreached++;
      current = null;
    }
    const had = new Set(prev.runner.scoreArea.map(x => x.instanceId));
    for (const x of s.runner.scoreArea) {
      if (had.has(x.instanceId) || cardDef(x).type_code !== 'agenda') continue;
      const k = where(prev, x.instanceId);
      points[k] = (points[k] ?? 0) + (cardDef(x).agenda_points ?? 0);
    }
    prev = s;
  };
  for (let i = 0; i < 6000; i++) {
    step(game.state);
    if (!game.step()) break;
  }
  step(game.state);
  return { seed, corp: c.name, runner: r.name, winner: game.state.winner ?? null, turns: game.state.turnNumber, runs, forced, forcedBreached, points };
}

const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
for (const seed of seeds) console.log(JSON.stringify(playDeal(seed)));
