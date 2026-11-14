/**
 * Counted scoring (spec /mnt/project-files/netrunner-ai/redesign/spec-counted-scoring.md): every Corp decision in
 * Jeff's Runner games (human-games reports 33-45, and any others named) where plan.scoreNow or plan.scoreInTwo would
 * play something other than the recorded move. Replays the recorded moves; the held two-turn line is carried as the
 * agent would carry it, against the recorded picks; the recorded pick stands while it keeps a score this turn (winNow.ts
 * keepsScore), as the agents play it. Measurement only.
 *
 *   npx vite-node scripts/counted-jeff-games.ts -- [report numbers, default 33-45]
 */
import { readFileSync } from 'node:fs';
import { GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { tuning } from '../src/ai/synergy';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';
import { keepsScore, scoreNowPlan } from '../src/ai/winNow';
import { installDiagnostics } from '../src/ai/diagnostics';
const diag = installDiagnostics();
import { scoreInTwoPick } from '../src/ai/corp/placement';
import { HeldLine, isCorpMain } from '../src/ai/corp/lines';

const args = process.argv.slice(2).filter(a => a !== '--').map(Number);
const reports = args.length ? args : Array.from({ length: 13 }, (_, i) => 33 + i);
tuning.plan.scoreNow = true;
tuning.plan.scoreInTwo = true;

const title = (s: GameState, id?: string) => (id && findCardAnywhere(s, id) ? cardDef(findCardAnywhere(s, id)!).title : (id ?? ''));
const say = (s: GameState, a: GameAction) => {
  const x = a as unknown as { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean };
  return `${a.type.toLowerCase()}${x.cardInstanceId ? ' ' + title(s, x.cardInstanceId) : ''}${x.targetServerId ? ' > ' + x.targetServerId : x.asNewRemote ? ' > new remote' : ''}`;
};
const same = (a: GameAction, b: GameAction) => JSON.stringify(a) === JSON.stringify(b);
const board = (s: GameState) =>
  `Corp ${s.corp.score} pts ${s.corp.credits} cr ${s.corp.clicks} clicks; Runner ${s.runner.score} pts ${s.runner.credits} cr; remotes ` +
  Object.values(s.corp.servers)
    .filter(v => v.isRemote)
    .map(v => `${v.id}[${v.ice.map(c => cardDef(c).title + (c.isRezzed ? '' : '*')).join(', ')}]${v.root.map(c => ' ' + cardDef(c).title + (c.advancementCounters ? '+' + c.advancementCounters : '')).join('')}`)
    .join('; ');

let changed = 0;
for (const n of reports) {
  const report = JSON.parse(readFileSync(`tests/fixtures/human-games/report-${n}.json`, 'utf8'));
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  let held: HeldLine | null = null;
  const lines: string[] = [];
  for (const m of report.moves as GameAction[]) {
    if (s.activePlayer === 'corp' && actingSide(s) === 'corp' && isCorpMain(s) && m.type !== 'START_TURN') {
      const result = asSide('corp', () => {
        decisionContext(s, 'corp');
        // As the agent: the recorded pick stands while it keeps the score
        const now = scoreNowPlan(s);
        if (now) return { action: keepsScore(s, m, now) ? m : now.first, why: 'scoreNow', held };
        const two = scoreInTwoPick(s, m, held);
        return { action: two.action, why: two.held ? `scoreInTwo ${two.held.line.agenda} (${two.held.line.form}, ${two.held.line.server}, ${two.held.line.advanceNow} now + ${two.held.line.advanceNext} next)` : 'scoreInTwo', held: two.held };
      });
      held = result.held;
      if (!same(result.action, m)) lines.push(`  turn ${s.turnNumber}: played ${say(s, m)}; ${result.why} plays ${say(s, result.action)}\n    ${board(s)}`);
    }
    s = executeAction(s, m);
  }
  changed += lines.length;
  console.log(`report ${n} (${report.config.difficulty}, winner ${s.winner ?? 'none'}): ${lines.length} changed decision(s)`);
  for (const l of lines) console.log(l);
}
console.log(`\n${changed} changed decisions; scoreNow searches ${diag.scoreNow.searches}, found ${diag.scoreNow.found}, more than one agenda scorable ${diag.scoreNow.choices}`);
