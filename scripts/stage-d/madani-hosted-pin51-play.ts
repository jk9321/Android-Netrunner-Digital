/** Scratch (count step): report-51 #222 played by hand in the engine. The Corp rezzes N-Pot inst-39; the Runner, memory full
 * (4 of 4), uses Madani to install Chromatophores on it trashing Conduit first (rule 8.5.6c, a trashFirst answer the legal
 * moves never list), then Rising Tide boosts once and breaks the three subroutines, now barrier: the run goes on.
 *   PLAY='"PASS","player":"corp";inst-80;inst-82;HOST;CONTINUE;BOOST;subroutineIndices":[0];subroutineIndices":[1];subroutineIndices":[2];CONTINUE;CONTINUE;CONTINUE' npx vite-node scripts/stage-d/madani-hosted-pin51-play.ts */
import { readFileSync } from 'node:fs';
import { GameAction, GameState, createInitialGameState, executeAction, getLegalActions, cardDef } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
const report = JSON.parse(readFileSync('tests/fixtures/human-games/report-51.json', 'utf8'));
let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
if (report.startStops) s = { ...s, stops: report.startStops };
for (const m of (report.moves as GameAction[]).slice(0, 222)) s = executeAction(s, m);
const script = (process.env.PLAY ?? '').split(';').filter(Boolean);
s = executeAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: 'inst-39' } as GameAction);
for (let i = 0; i < 40 && !s.winner; i++) {
  const run = s.activeRun;
  const acts = [...getLegalActions(s, 'runner'), ...getLegalActions(s, 'corp')];
  const want = script[i];
  console.log(`[${i}] $r${s.runner.credits} run ${run ? `${run.phase} pos ${run.icePosition} enc ${JSON.stringify(run.encounter?.broken ?? null)}` : 'none'} prompts ${s.pendingPrompts.map(p => (p as { message?: string }).message).join('|')}`);
  let pick = want === undefined ? acts[0] : acts.find(a => JSON.stringify(a).includes(want));
  if (pick && want === 'inst-82') pick = { ...(pick as never), choice: { ...((pick as { choice: object }).choice), trashFirst: ['inst-64'] } } as GameAction;
  if (want === 'HOST') pick = acts.find(a => JSON.stringify(a).includes('inst-39')) ?? pick;
  console.log('   rig ' + s.runner.rig.programs.map(c => cardDef(c).title + (c.hostedOnId ? '@' + c.hostedOnId : '')).join(', ') + ' ice ' + s.corp.servers.rd.ice.map(c => cardDef(c).title + (c.hostedCards ?? []).map(h => '+' + cardDef(h).title).join('')).join(', '));
  if (i === 2) console.log('   MEM', s.runner.memoryUnitsUsed, JSON.stringify(s.pendingPrompts).slice(0, 900));
  if (i === 3) console.log('   DEBUG', JSON.stringify({ pp: s.pendingPrompts, pr: s.priority, mad: s.runner.rig.hardware.find(c => c.cardCode === '35028')?.hostedCards?.map(c => c.instanceId), flags: s.turnFlags, log: s.log.slice(-4) }).slice(0, 1500));
  if (want !== undefined || i < 5) console.log('   legal: ' + acts.map(a => JSON.stringify(a).slice(0, 160)).join('\n          '));
  if (!pick) { console.log('no pick for', want); break; }
  console.log('   take ' + JSON.stringify(pick).slice(0, 200));
  s = executeAction(s, pick);
}
console.log('end', s.winner, 'score', s.corp.score, s.runner.score, 'run', !!s.activeRun, 'runs', JSON.stringify(s.runsThisTurn));
