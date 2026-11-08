/**
 * Install-worth side check (Jeff 2026-11-08 16:22: "Sometimes going broke is ok to secure an agenda or rez some crucial
 * ice. As long as it looks to build back up to a place of safety and strength."): replays batch deals and reports how
 * the Corp recovers from each dip below 3 credits at a turn start (the broke alarm's line, scripts/alarms.ts): how many
 * turn starts it stays under 3, and dips that never recover before the game ends.
 *
 *   [PLAN_OFF=...] npx vite-node scripts/broke-recovery.ts -- deals.json [out.json]
 * deals.json: [{ seed, corpDeck, runnerDeck }] (a batch's results/<run>.deals.json, or a slice of one)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createInitialGameState } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { applyPlanOff } from '../src/ai/synergy';
import { ALL_DECKS } from './nsg-sample-decks';

applyPlanOff(process.env.PLAN_OFF ?? '');
const [file, out] = process.argv.slice(2).filter(a => a !== '--');
const deals: { seed: number; corpDeck: string; runnerDeck: string }[] = JSON.parse(readFileSync(file, 'utf8'));
const rows: { seed: number; corpDeck: string; runnerDeck: string; winner: string; starts: number[]; dips: { turn: number; length: number; recovered: boolean }[] }[] = [];
for (const d of deals) {
  const corp = ALL_DECKS.find(x => x.side === 'corp' && x.name === d.corpDeck);
  const runner = ALL_DECKS.find(x => x.side === 'runner' && x.name === d.runnerDeck);
  if (!corp || !runner) continue;
  valueLoops.clear();
  const gr = new GameRunner(createInitialGameState(deckGameSetup(d.seed, corp, runner)), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  const starts: number[] = [];
  let lastTurn = 0;
  for (let i = 0; i < 20000 && !gr.state.winner; i++) {
    const s = gr.state;
    if (s.activePlayer === 'corp' && s.turnNumber !== lastTurn && !s.pendingPrompts.length) {
      lastTurn = s.turnNumber;
      starts[s.turnNumber] = s.corp.credits;
    }
    if (!gr.step()) break;
  }
  const dips: { turn: number; length: number; recovered: boolean }[] = [];
  for (let t = 3; t < starts.length; t++) {
    if (starts[t] === undefined || starts[t] >= 3 || (starts[t - 1] ?? 5) < 3) continue;
    let k = t;
    while (k < starts.length && (starts[k] ?? 5) < 3) k++;
    dips.push({ turn: t, length: k - t, recovered: k < starts.length });
  }
  rows.push({ ...d, winner: gr.state.winner ?? 'none', starts: starts.filter(x => x !== undefined), dips });
}
if (out) writeFileSync(out, JSON.stringify(rows));
const all = rows.flatMap(r => r.dips);
const len = (n: number) => all.filter(x => x.recovered && x.length === n).length;
console.log(`${rows.length} games, ${all.length} dips: recovered after 1 turn start ${len(1)}, 2 ${len(2)}, 3+ ${all.filter(x => x.recovered && x.length >= 3).length}, never ${all.filter(x => !x.recovered).length}; Corp won ${rows.filter(r => r.winner === 'corp').length}`);
