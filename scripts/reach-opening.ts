/**
 * Phase 2 K2/K3 (AI Coordinator 2026-11-09): the Corp's opening and tempo with plan.reach's pieces on vs off. The money
 * ceiling's first divergence is turns 1-2 (score-budget/money-diff.md): with money the Corp ices a central where the honest one
 * plays an asset or upgrade, and scores by turn 6.4 vs 8.7. This plays each deal both ways (seeds as corp-losses.ts
 * games=3) and prints, per arm: the first agenda installed and scored, the Corp's mean credits at its turn starts 1-6,
 * its installs on turns 1-4 by kind, and whether ice (a central or the first remote's) came before its first asset or
 * upgrade.
 *
 *   SEEDS=1212,1423 ARM=+reach,+reachStrength npx vite-node scripts/reach-opening.ts
 */
import { GameState, createInitialGameState } from '../src/core';
import { cardDef } from '../src/core/cards';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { GameRunner, createAgent } from '../src/ai';
import { applyPlanOff, tuning } from '../src/ai/synergy';

const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
const dealOf = (seed: number) => {
  const pairing = Math.floor((seed - 1001) / 10);
  return { corp: corpDecks[Math.floor(pairing / runnerDecks.length)], runner: runnerDecks[pairing % runnerDecks.length] };
};

interface Opening {
  winner: string;
  firstInstall?: number;
  firstScore?: number;
  startCredits: number[];
  installs: Record<string, number>;
  iceFirst: boolean | null;
}

function play(seed: number): Opening {
  const { corp, runner } = dealOf(seed);
  const game = new GameRunner(createInitialGameState(deckGameSetup(seed, corp, runner)), { corp: createAgent('corp', 'normal', {}), runner: createAgent('runner', 'normal', {}) });
  const out: Opening = { winner: 'draw', startCredits: [], installs: {}, iceFirst: null };
  let corpTurn = -1;
  const roots = (s: GameState) => new Set(Object.values(s.corp.servers).flatMap(v => [...v.root, ...v.ice]).map(c => c.instanceId));
  for (let steps = 0; steps < 6000 && !game.state.winner; steps++) {
    const before = game.state;
    if (before.activePlayer === 'corp' && before.turnNumber !== corpTurn && !before.activeRun) {
      corpTurn = before.turnNumber;
      if (out.startCredits.length < 6) out.startCredits.push(before.corp.credits);
    }
    const had = roots(before);
    if (!game.step()) break;
    const after = game.state;
    const turn = before.turnNumber;
    for (const v of Object.values(after.corp.servers)) {
      for (const c of [...v.root, ...v.ice]) {
        if (had.has(c.instanceId) || before.activePlayer !== 'corp') continue;
        const type = cardDef(c).type_code;
        if (type === 'agenda' && out.firstInstall === undefined) out.firstInstall = turn;
        if (turn <= 4) {
          const kind = type === 'ice' ? `ice ${v.isRemote ? 'remote' : 'central'}` : type;
          out.installs[kind] = (out.installs[kind] ?? 0) + 1;
          if (out.iceFirst === null && (type === 'ice' || type === 'asset' || type === 'upgrade')) out.iceFirst = type === 'ice';
        }
      }
    }
    if (out.firstScore === undefined && after.corp.scoreArea.length > before.corp.scoreArea.length) out.firstScore = turn;
  }
  out.winner = game.state.winner ?? 'draw';
  return out;
}

const seeds = (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number);
const arm = process.env.ARM ?? '';
const saved = structuredClone(tuning.plan);
const run = (planOff: string) =>
  seeds.map(seed => {
    tuning.plan = structuredClone(saved);
    if (planOff) applyPlanOff(planOff);
    return play(seed);
  });
const summary = (games: Opening[]) => {
  const mean = (xs: number[]) => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : null);
  const installs: Record<string, number> = {};
  for (const g of games) for (const [k, n] of Object.entries(g.installs)) installs[k] = (installs[k] ?? 0) + n;
  return {
    corpWins: games.filter(g => g.winner === 'corp').length,
    firstInstall: mean(games.flatMap(g => (g.firstInstall === undefined ? [] : [g.firstInstall]))),
    firstScore: mean(games.flatMap(g => (g.firstScore === undefined ? [] : [g.firstScore]))),
    scored: games.filter(g => g.firstScore !== undefined).length,
    startCredits: mean(games.flatMap(g => g.startCredits)),
    iceBeforeAsset: games.filter(g => g.iceFirst === true).length,
    assetBeforeIce: games.filter(g => g.iceFirst === false).length,
    installsTurns1to4: installs,
  };
};
const base = run('');
const on = run(arm);
console.log(JSON.stringify({ seeds: seeds.length, arm, base: summary(base), on: summary(on), flips: seeds.filter((_, i) => base[i].winner !== on[i].winner) }, null, 1));
