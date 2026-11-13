/**
 * The Corp AI's pick before move N of a report-format game (fresh agent), with holdCost for each iced remote against
 * what the Corp has (measurement, spec jeff-games-48-50 Part A). 
 *   FIX=report.json AT=60,76 [PLAN_OFF=+bypassHold] npx vite-node scripts/pick-at.ts
 */
import { readFileSync } from 'node:fs';
import { GameAction, GameState, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { applyPlanOff } from '../src/ai/synergy';
import { asSide } from '../src/ai/pricing';
import { holdCost } from '../src/ai/countedScore';

applyPlanOff(process.env.PLAN_OFF ?? '');
const report = JSON.parse(readFileSync(process.env.FIX!, 'utf8'));
for (const at of process.env.AT!.split(',').map(Number)) {
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  for (const [i, m] of (report.moves as GameAction[]).entries()) { if (i === at) break; s = executeAction(s, m); }
  const st = s;
  const holds = Object.values(st.corp.servers).filter(v => v.ice.length > 0).map(v => `${v.id}:${asSide('corp', () => holdCost(st, v.ice, st.corp.credits))}`).join(' ');
  const a = createAgent('corp', 'normal').chooseAction(structuredClone(st)) as GameAction & Record<string, unknown>;
  const id = (a.cardInstanceId ?? (a as { choice?: { cardInstanceIds?: string[] } }).choice?.cardInstanceIds?.[0]) as string | undefined;
  const c = id ? findCardAnywhere(st, id) : undefined;
  console.log(`#${at} T${st.turnNumber} credits ${st.corp.credits}: AI ${a.type} ${c ? cardDef(c).title : ''} ${a.targetServerId ?? ''}; game ${JSON.stringify(report.moves[at]).slice(0, 120)}; holdCost(credits) ${holds}`);
}
