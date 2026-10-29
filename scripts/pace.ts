/**
 * Run pace (Jeff, 2026-10-28): how often the Runner runs, where, and how
 * often it gets in, measured from self-play, for the PACE averages in
 * src/ai/effectValues.ts and AGENDA_RUN in src/ai/evaluate.ts.
 *   SHARD=i/n npx vite-node scripts/pace.ts -- [games per pairing] [normal|hard] > pace-i.json
 *   node scripts/pace-sum.mjs pace-*.json
 */
import { createInitialGameState, GameState, cardDef } from '../src/core';
import { DECKS, deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { applyPlanOff } from '../src/ai/synergy';
applyPlanOff(process.env.PLAN_OFF ?? '');

const [gamesArg, levelArg] = process.argv.slice(2).filter(a => a !== '--');
const games = Number(gamesArg ?? 1);
const level = (levelArg ?? 'normal') as 'normal' | 'hard';
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);

const zero = () => ({ runs: 0, successful: 0 });
const stats = {
  games: 0,
  runnerTurns: 0,
  servers: { hq: zero(), rd: zero(), archives: zero(), remote: zero() } as Record<string, { runs: number; successful: number }>,
  /** Runner turns that began with an advanced agenda in a remote, and how many of those turns ran that remote. */
  agendaRemoteTurns: 0,
  agendaRemoteRun: 0,
  /** Runner turns with Conduit installed, and runs on R&D / all runs on those turns. */
  conduitRuns: 0,
  conduitRdRuns: 0,
  /** Agendas scored or stolen, and ice rezzed, in all (per Runner turn: divide by runnerTurns). */
  agendaEvents: 0,
  rezzes: 0,
};

const kind = (server: string) => (server === 'hq' || server === 'rd' || server === 'archives' ? server : 'remote');
const advancedAgendaRemotes = (s: GameState) =>
  Object.values(s.corp.servers).filter(v => v.isRemote && v.root.some(c => cardDef(c).type_code === 'agenda' && c.advancementCounters > 0)).map(v => v.id);
const rezzedIce = (s: GameState) => Object.values(s.corp.servers).reduce((n, v) => n + v.ice.filter(i => i.isRezzed).length, 0);
const agendasOut = (s: GameState) => s.corp.scoreArea.length + s.runner.scoreArea.length;

let seed = 1000;
let deal = 0;
for (const c of DECKS.filter(d => d.side === 'corp')) for (const r of DECKS.filter(d => d.side === 'runner')) for (let g = 0; g < games; g++) {
  seed++;
  if (deal++ % shards !== shard) continue;
  const agent = (side: 'corp' | 'runner') => createAgent(side, level, level === 'hard' ? { samples: 6, candidates: 3, seed } : {});
  const gr = new GameRunner(createInitialGameState(deckGameSetup(seed, c, r)), { corp: agent('corp'), runner: agent('runner') });
  let start: GameState | null = null;
  try {
    for (let steps = 0; steps < 4000 && gr.state.turnNumber <= 80; steps++) {
      const before = gr.state;
      if (!gr.step()) break;
      const after = gr.state;
      if (before.activePlayer !== 'runner' && after.activePlayer === 'runner') start = after;
      if (before.activePlayer === 'runner' && after.activePlayer !== 'runner' && !before.activeRun && start) {
        const runs = before.runsThisTurn;
        stats.runnerTurns++;
        for (const run of runs) {
          const k = stats.servers[kind(run.server)];
          k.runs++;
          if (run.successful) k.successful++;
        }
        const targets = advancedAgendaRemotes(start);
        if (targets.length) {
          stats.agendaRemoteTurns++;
          if (runs.some(run => targets.includes(run.server))) stats.agendaRemoteRun++;
        }
        if (start.runner.rig.programs.some(p => p.cardCode === '30024')) {
          stats.conduitRuns += runs.length;
          stats.conduitRdRuns += runs.filter(run => run.server === 'rd').length;
        }
        start = null;
      }
      stats.rezzes += Math.max(0, rezzedIce(after) - rezzedIce(before));
    }
  } catch (err) {
    console.error(`deal ${seed}: ${err}`);
    continue;
  }
  stats.games++;
  stats.agendaEvents += agendasOut(gr.state);
}
console.log(JSON.stringify(stats));
