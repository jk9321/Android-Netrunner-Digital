/**
 * Install-worth side check (2026-11-08): at the start of a Corp turn in one of Jeff's games, each installed ice's worth to the
 * Corp (iceWorth) and, for each remote, what a 2-point, 4-cost agenda there is worth at the end of the turn with 0..3
 * counters (agendaWorth), so one advance can be set beside one install. Points on the clock: 1pt / 2pt.
 * Usage: npx vite-node scripts/advance-worth.ts -- report-21.json 6
 */
import { readFileSync } from 'node:fs';
import { GameAction, GameState, cardDef, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { agendaWorth } from '../src/ai/evaluate';
import { iceWorth } from '../src/ai/iceValues';
import { pointValue, KNOBS } from '../src/ai/valueModel';
import { stealOdds } from '../src/ai/effectValues';
import { turnsLeft } from '../src/ai/cardProfiles';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';
const [file, turn] = [process.argv.find(a => a.endsWith('.json'))!, Number(process.argv[process.argv.length - 1])];
const report = JSON.parse(readFileSync('tests/fixtures/human-games/' + file, 'utf8'));
let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
if (report.startStops) s = { ...s, stops: report.startStops };
for (const m of report.moves as GameAction[]) { if (s.turnNumber === turn && s.activePlayer === 'corp' && m.player === 'corp' && m.type !== 'START_TURN' && !s.activeRun && s.pendingPrompts.length === 0) break; s = executeAction(s, m); }
asSide('corp', () => {
  decisionContext(s, 'corp');
  console.log(`${file} T${s.turnNumber} corp ${s.corp.credits}cr score ${s.corp.score}-${s.runner.score} turnsLeft ${turnsLeft(s)} 1pt=${(pointValue(s.corp.score + 1, KNOBS.corpPoints) - pointValue(s.corp.score, KNOBS.corpPoints)).toFixed(2)} 2pt=${(pointValue(s.corp.score + 2, KNOBS.corpPoints) - pointValue(s.corp.score, KNOBS.corpPoints)).toFixed(2)}`);
  for (const sv of Object.values(s.corp.servers)) {
    for (const ice of sv.ice) console.log(`  ice ${sv.id} ${cardDef(ice).title}${ice.isRezzed ? '' : '(u)'} worth ${iceWorth(s, ice, 'corp').toFixed(2)}`);
    if (!sv.isRemote) continue;
    const steal = stealOdds(s, sv.id);
    const end = { clicks: 0, credits: s.corp.credits };
    const w = (k: number) => agendaWorth(s, k, 4, 2, sv.id, undefined, false, end);
    console.log(`  ${sv.id} (${sv.ice.length} ice) steal ${steal.toFixed(2)}: 2pt cost-4 agenda at end of turn, counters 0..3: ${[0, 1, 2, 3].map(k => w(k).toFixed(2)).join(' ')} | advance 2 turns->1 (0->1): ${(w(1) - w(0)).toFixed(2)}, 1->2: ${(w(2) - w(1)).toFixed(2)}`);
  }
});
