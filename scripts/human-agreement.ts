/**
 * How closely the Corp AI plays like a human (Jeff, 2026-11-05: his Corp games as the teacher, instead of fixing one
 * hole at a time). Each saved bug report with moves (tests/fixtures/human-games/*.json, decoded with
 * scripts/bug-report-state.mjs) is replayed; at every Corp turn the AI plays the turn from the human's position, and at
 * every Corp main-phase decision the AI picks its own action.
 *
 * Two numbers:
 *   - decisions: share of the human's main-phase actions the AI would also have taken, agenda moves (install, advance,
 *     score an agenda) counted 3 times;
 *   - agenda turns: on how many turns the AI's own whole turn matched the human's agenda progress (points scored,
 *     and whether it advanced at all). Order inside a turn doesn't count (Nico before Seamless Launch is the same turn).
 * The turns where they differ are listed, so a sweep shows what a setting fixes and what it breaks.
 *
 * Usage: npx vite-node scripts/human-agreement.ts -- [dir] [--agendaClick=2] [--corpPoints=1] [--quiet]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { setAgendaClick } from '../src/ai/evaluate';
import { KNOBS } from '../src/ai/valueModel';

const args = process.argv.slice(2).filter(a => a !== '--');
const dir = args.find(a => !a.startsWith('--')) ?? 'tests/fixtures/human-games';
const opt = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
if (opt('agendaClick')) setAgendaClick(Number(opt('agendaClick')));
if (opt('corpPoints')) KNOBS.corpPoints = Number(opt('corpPoints'));
const quiet = args.includes('--quiet');

const same = (a: GameAction, b: GameAction) => JSON.stringify({ ...a, player: 0 }) === JSON.stringify({ ...b, player: 0 });
const mainPhase = (s: GameState) => !s.activeRun && s.pendingPrompts.length === 0 && !(s.priority && s.priority.holder !== s.activePlayer);
const cardOf = (s: GameState, a: GameAction) => ('cardInstanceId' in a && a.cardInstanceId ? findCardAnywhere(s, a.cardInstanceId) : undefined);
const isAgendaMove = (s: GameState, a: GameAction) => {
  const card = cardOf(s, a);
  return !!card && cardDef(card).type_code === 'agenda' && ['INSTALL_CARD', 'ADVANCE_CARD', 'SCORE_AGENDA'].includes(a.type);
};

/** Agenda progress over one Corp turn: points scored, advancement counters placed on agendas. */
function progress(before: GameState, after: GameState) {
  const counters = (s: GameState) =>
    Object.values(s.corp.servers)
      .flatMap(v => v.root)
      .filter(c => cardDef(c).type_code === 'agenda')
      .reduce((n, c) => n + c.advancementCounters, 0);
  const points = after.corp.score - before.corp.score;
  return { points, advanced: points > 0 || counters(after) > counters(before) };
}

function aiTurn(start: GameState): GameState {
  const corp = createAgent('corp', 'normal');
  const runner = createAgent('runner', 'normal');
  let s = start;
  for (let i = 0; i < 40 && s.activePlayer === 'corp' && s.turnNumber === start.turnNumber && !s.winner; i++) {
    const side = actingSide(s);
    s = executeAction(s, (side === 'runner' ? runner : corp).chooseAction(s));
  }
  return s;
}

let weight = 0;
let agreed = 0;
let turns = 0;
let turnsMatched = 0;
const misses: string[] = [];
for (const file of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  const report = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  if (report.config.ai !== 'runner' || !report.moves?.length) continue;
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  let turnStart: GameState | null = null;
  const finishTurn = (end: GameState) => {
    if (!turnStart) return;
    const human = progress(turnStart, end);
    const ai = progress(turnStart, aiTurn(turnStart));
    turns++;
    if (human.points === ai.points && human.advanced === ai.advanced) turnsMatched++;
    const say = (p: { points: number; advanced: boolean }) => (p.points ? `scored ${p.points}` : p.advanced ? 'advanced' : 'no agenda move');
    if (!(human.points === ai.points && human.advanced === ai.advanced)) misses.push(`${file} T${turnStart.turnNumber}: you ${say(human)}, AI ${say(ai)}`);
    turnStart = null;
  };
  for (const move of report.moves as GameAction[]) {
    const corpMain = move.player === 'corp' && s.activePlayer === 'corp' && mainPhase(s) && actingSide(s) === 'corp';
    if (corpMain && move.type !== 'START_TURN' && !turnStart && s.corp.clicks > 0) turnStart = s;
    if (corpMain && move.type !== 'START_TURN' && move.type !== 'END_TURN') {
      const ai = createAgent('corp', 'normal').chooseAction(s);
      const w = isAgendaMove(s, move) || isAgendaMove(s, ai) ? 3 : 1;
      weight += w;
      if (same(move, ai)) agreed += w;
    }
    const before = s;
    s = executeAction(s, move);
    if (turnStart && (s.activePlayer !== 'corp' || s.turnNumber !== before.turnNumber || s.winner)) finishTurn(s.winner || s.activePlayer !== 'corp' ? s : before);
  }
  finishTurn(s);
}

console.log(`decisions ${((100 * agreed) / Math.max(1, weight)).toFixed(1)}% (weighted, agenda moves x3) | agenda turns ${turnsMatched}/${turns} | agendaClick ${opt('agendaClick') ?? 'default'} corpPoints ${KNOBS.corpPoints}`);
if (!quiet) for (const m of misses) console.log('  ' + m);
