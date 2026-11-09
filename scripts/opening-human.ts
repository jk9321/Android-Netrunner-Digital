/**
 * Phase 2 O1/O3 on Jeff's human Corp games (tests/fixtures/human-games, the ones where the AI played the Runner):
 * replays each game's moves through the same OpeningTracker and SpendTracker the batches use (opening-audit.ts), so
 * his openings, agenda windows and card returns print in the same tables as the AI's. At every agenda-window decision
 * it also asks the shipped Corp AI what it would have done there (its pick's kind is the window row's 11th field).
 *
 *   npx vite-node scripts/opening-human.ts -- [dir] [--json=out.json]
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GameAction, GameState, createInitialGameState, executeAction } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { OpeningTracker, actionKind, corpMainPhase } from './opening-audit';
import { SpendTracker } from './spend-audit';
// @ts-expect-error plain JS module
import { printOpeningAudit, printValueAudit } from './opening-summary.mjs';

const args = process.argv.slice(2).filter(a => a !== '--');
const dir = args.find(a => !a.startsWith('--')) ?? 'tests/fixtures/human-games';
const out = args.find(a => a.startsWith('--json='))?.split('=')[1];

const games: unknown[] = [];
for (const file of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  const report = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  if (report.config?.ai !== 'runner' || !report.moves?.length) continue;
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  const tracker = new OpeningTracker();
  const spend = new SpendTracker(tracker.listener);
  let stopped = '';
  for (const move of report.moves as GameAction[]) {
    const before = s;
    // The AI's own pick at a window decision, asked before the human's move is played
    const aiKind = move.player === 'corp' && corpMainPhase(before) && move.type !== 'START_TURN' && tracker.windowAt(before) ? actionKind(before, createAgent('corp', 'normal').chooseAction(before)) : null;
    try {
      s = executeAction(s, move);
    } catch (e) {
      stopped = `${file}: replay stopped at turn ${s.turnNumber} (${(e as Error).message})`;
      break;
    }
    const rows = (tracker as unknown as { rec: { windows: unknown[][] } }).rec.windows;
    const had = rows.length;
    spend.step(before, s, move);
    tracker.step(before, s, move);
    if (aiKind && rows.length > had) rows[rows.length - 1].push(aiKind);
  }
  if (stopped) console.log(stopped);
  spend.done(s);
  games.push({ file, winner: s.winner ?? 'unfinished', corpScore: s.corp.score, runnerScore: s.runner.score, opening: tracker.done(s) });
  console.log(`${file}: ${report.config.corpDeck?.name ?? ''} vs ${report.config.runnerDeck?.name ?? ''}: ${s.winner ?? 'unfinished'} ${s.corp.score}-${s.runner.score}, turn ${s.turnNumber}`);
}
const label = `JEFF'S CORP GAMES`;
printOpeningAudit(games, { human: true, label: `${label}: opening audit` });
// Jeff's window decisions against what the AI would have done there
const rows = (games as { opening: { windows: unknown[][] } }[]).flatMap(g => g.opening.windows).filter(r => r.length > 10);
const both = new Map<string, number>();
for (const r of rows) {
  const key = `${(r[2] as string).startsWith('agenda:') ? 'Jeff agenda move' : 'Jeff other'} / ${(r[10] as string).startsWith('agenda:') ? 'AI agenda move' : 'AI other'}`;
  both.set(key, (both.get(key) ?? 0) + 1);
}
console.log(`Window decisions, Jeff vs the AI at the same position (${rows.length}): ${[...both].map(([k, n]) => `${k} ${n}`).join(', ')}`);
const kinds = new Map<string, number>();
for (const r of rows.filter(r => (r[2] as string).startsWith('agenda:') && !(r[10] as string).startsWith('agenda:'))) kinds.set(r[10] as string, (kinds.get(r[10] as string) ?? 0) + 1);
console.log(`  where Jeff made an agenda move and the AI didn't, the AI chose: ${[...kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
const kinds2 = new Map<string, number>();
for (const r of rows.filter(r => !(r[2] as string).startsWith('agenda:') && (r[10] as string).startsWith('agenda:'))) kinds2.set(r[2] as string, (kinds2.get(r[2] as string) ?? 0) + 1);
console.log(`  where the AI made an agenda move and Jeff didn't, Jeff chose: ${[...kinds2].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
printValueAudit(games, { human: true, label: `${label}: card value audit` });
if (out) writeFileSync(out, JSON.stringify(games));
