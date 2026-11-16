/**
 * ai-hold-reentry: one finish-test game timed turn by turn in a measurement tree (AI Coordinator 2026-11-16: Quick and
 * Dirty vs Bowel Movements, tests/aiGames.ts index 4, seed 104, "total time and turn 18 before and after").
 *   ARM=beta|c1|c2 [INDEX=4] npx vite-node scripts/hold-reentry/game-time.ts
 * Plays as tests/aiGames.ts does (playAIGame's default agents, seed 100 + index), with every agent call timed; prints
 * per turn and side the time, the slowest decision and the probe's hold counts (deepest nesting, at depth 2+).
 */
import { join } from 'node:path';
import type { GameState } from '../../src/core';
import { ALL_DECKS } from '../nsg-sample-decks';
import { Arm, Probe, installProbe, makeTrees, treeRoot } from './trees';

const arm = (process.env.ARM ?? 'c2') as Arm;
const index = Number(process.env.INDEX ?? 4);
const probe = installProbe(new Probe(0, 1e9));

async function main() {
  const dir = makeTrees(treeRoot(`game-${arm}-${process.pid}`), [arm])[arm];
  const m = (p: string) => import(/* @vite-ignore */ join(dir, 'src', p));
  const core = await m('core/index.ts');
  const decks = await m('data/decks.ts');
  const ai = await m('ai/index.ts');
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  const corpDeck = corpDecks[index], runnerDeck = runnerDecks[index % runnerDecks.length];
  const start: GameState = core.createInitialGameState(decks.deckGameSetup(100 + index, corpDeck, runnerDeck));
  const rows = new Map<string, { ms: number; n: number; max: number; counts: number; deep: number; depth: number }>();
  const wrap = (side: 'corp' | 'runner') => {
    const inner = ai.createAgent(side);
    return new Proxy(inner, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (typeof v !== 'function') return v;
        return (...args: unknown[]) => {
          const s = args[0] as GameState;
          if (!s || typeof s !== 'object' || !('turnNumber' in s)) return v.apply(target, args);
          probe.reset();
          const t = performance.now();
          const out = v.apply(target, args);
          const ms = performance.now() - t;
          const tally = probe.reset();
          const key = `${s.turnNumber} ${side}`;
          const r = rows.get(key) ?? { ms: 0, n: 0, max: 0, counts: 0, deep: 0, depth: 0 };
          r.ms += ms; r.n++; r.max = Math.max(r.max, ms); r.counts += tally.turns; r.deep += tally.d2 + tally.d3 + tally.d4; r.depth = Math.max(r.depth, tally.maxDepth);
          rows.set(key, r);
          return out;
        };
      },
    });
  };
  const t0 = performance.now();
  const { state } = ai.playAIGame(start, 3000, 80, { corp: wrap('corp'), runner: wrap('runner') });
  const total = performance.now() - t0;
  console.log(`${arm}: ${corpDeck.name} vs ${runnerDeck.name}, seed ${100 + index}: winner ${state.winner}, turn ${state.turnNumber}, score ${state.corp.score}-${state.runner.score}, total ${(total / 1000).toFixed(1)} s`);
  for (const [k, r] of rows) console.log(`  T${k}: ${(r.ms / 1000).toFixed(1)} s in ${r.n} calls, slowest ${(r.max / 1000).toFixed(1)} s; hold counts ${r.counts}, at depth 2+ ${r.deep}, deepest ${r.depth}`);
}
void main();
