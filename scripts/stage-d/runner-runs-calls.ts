/**
 * Stage D item 2, brief rev 2 3.9: how often an owner of "where the Runner runs" would be asked in a Corp decision, on
 * recorded decisions (the planner's playouts and the reply's leaves included: every value is reported through the
 * diagnostics sink while the decision runs). Its readers sit in iceWorth (the Corp's: protectsIn -> serverStake, once
 * per state and server by its memo) and agendaWorth (stealOdds, once per state and remote by its memo). Counted per
 * decision: iceWorth and agendaWorth values, and the distinct (state, server) pairs they price, which is how many times
 * a memoised owner would be computed. The hold count is not called by the design in the note (reach does not set the
 * price, rev 2 3.7), so it adds no hold calls; this counts what it does add.
 *   HUMAN=report-43,report-50 npx vite-node scripts/stage-d/runner-runs-calls.ts
 */
import { readFileSync } from 'node:fs';
import { GameAction, GameState, CardInstance, actingSide, createInitialGameState, executeAction } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { createAgent } from '../../src/ai';
import { withDiagnostics } from '../../src/ai/diagnostics';
import { clearCaches, humanFiles } from '../stage-a/harness';
import { clearBuildTargets, valueLoops } from '../../src/ai/valueModel';
import { clearDeckShares } from '../../src/ai/iceValues';

const rows: { ice: number; agenda: number; pairs: number; states: number; ms: number }[] = [];
for (const file of humanFiles()) {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  if (report.config.ai !== 'corp') continue;
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  valueLoops.clear();
  for (const move of report.moves as GameAction[]) {
    if (actingSide(s) === 'corp' && s.activePlayer === 'corp' && !s.winner && !s.activeRun) {
      clearCaches();
      clearBuildTargets();
      clearDeckShares();
      const pairs = new WeakMap<GameState, Set<string>>();
      const states = new Set<GameState>();
      let ice = 0;
      let agenda = 0;
      let n = 0;
      const t = performance.now();
      withDiagnostics(d => {
        d.onValue = (_q, site, st, _v, args) => {
          if (!st) return;
          let server: string | undefined;
          if (site === 'iceWorth' && args[1] === 'corp') {
            ice++;
            const id = (args[0] as CardInstance).instanceId;
            server = Object.values(st.corp.servers).find(v => v.ice.some(c => c.instanceId === id))?.id;
          } else if (site === 'agendaWorth' && typeof args[3] === 'string') {
            agenda++;
            server = args[3] as string;
          }
          if (!server) return;
          states.add(st);
          const set = pairs.get(st) ?? new Set<string>();
          if (!set.has(server)) n++;
          set.add(server);
          pairs.set(st, set);
        };
        createAgent('corp', 'normal').chooseAction(structuredClone(s));
      });
      rows.push({ ice, agenda, pairs: n, states: states.size, ms: performance.now() - t });
    }
    try {
      s = executeAction(s, move);
    } catch {
      break;
    }
  }
}
const mean = (k: keyof (typeof rows)[number]) => rows.reduce((a, r) => a + r[k], 0) / rows.length;
const max = (k: keyof (typeof rows)[number]) => Math.max(...rows.map(r => r[k]));
console.log(JSON.stringify({ decisions: rows.length, mean: { iceWorth: mean('ice'), agendaWorth: mean('agenda'), ownerPairs: mean('pairs'), states: mean('states'), ms: mean('ms') }, max: { ownerPairs: max('pairs'), ms: max('ms') } }));
