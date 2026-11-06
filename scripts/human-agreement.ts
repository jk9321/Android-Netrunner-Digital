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
 * Runner games (the AI plays the Corp) are compared the same way from the Runner's side: decisions (runs counted 3
 * times) and turns whose runs and steals match (the servers run, points stolen).
 *
 * Usage: npx vite-node scripts/human-agreement.ts -- [dir] [--agendaClick=2] [--corpPoints=1] [--quiet] [--dump=file.json]
 * --dump writes every compared decision (file, turn, clicks left, the human's move, the AI's pick), so two runs (a switch
 * on and off) can be diffed decision by decision.
 */
import { writeFileSync } from 'node:fs';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GameAction, GameState, actingSide, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { HeuristicCorpAI, createAgent } from '../src/ai';
import { setAgendaClick } from '../src/ai/evaluate';
import { KNOBS } from '../src/ai/valueModel';
import { applyPlanOff } from '../src/ai/synergy';

// PLAN_OFF=a,b as in the batch scripts (PLAN_OFF=oneCurrency: the old Corp ranking)
applyPlanOff(process.env.PLAN_OFF ?? '');

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

/** Runs over one Runner turn: the servers run and the points stolen. */
function runs(start: GameState, moves: GameAction[]) {
  const servers = [...new Set(moves.filter(m => m.type === 'INITIATE_RUN').map(m => (m as { targetServerId: string }).targetServerId))].sort();
  return { servers, stolen: 0 } as { servers: string[]; stolen: number };
}

function aiTurn(start: GameState, side: 'corp' | 'runner' = 'corp', taken: GameAction[] = []): GameState {
  const corp = createAgent('corp', 'normal');
  const runner = createAgent('runner', 'normal');
  let s = start;
  for (let i = 0; i < 60 && s.activePlayer === side && s.turnNumber === start.turnNumber && !s.winner; i++) {
    const side = actingSide(s);
    const actor = actingSide(s);
    const action = (actor === 'runner' ? runner : corp).chooseAction(s);
    if (actor === side) taken.push(action);
    s = executeAction(s, action);
  }
  return s;
}

let weight = 0;
let agreed = 0;
let turns = 0;
let turnsMatched = 0;
const misses: string[] = [];
const dump: { file: string; turn: number; clicks: number; side: string; human: string; ai: string; w: number; same: boolean }[] = [];
const describe = (st: GameState, a: GameAction) => {
  const card = cardOf(st, a);
  return `${a.type}${card ? ' ' + cardDef(card).title : ''}${'targetServerId' in a && a.targetServerId ? ' @' + a.targetServerId : ''}`;
};
for (const file of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  if (opt('at') && !opt('at')!.startsWith(file + ':')) continue;
  const report = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  if (!report.moves?.length) continue;
  const human: 'corp' | 'runner' = report.config.ai === 'corp' ? 'runner' : 'corp';
  if (report.config.ai !== 'corp' && report.config.ai !== 'runner') continue;
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  let turnStart: GameState | null = null;
  let humanMoves: GameAction[] = [];
  const finishTurn = (end: GameState) => {
    if (!turnStart) return;
    if (human === 'runner') {
      const taken: GameAction[] = [];
      const aiEnd = aiTurn(turnStart, 'runner', taken);
      const mine = { ...runs(turnStart, humanMoves), stolen: end.runner.score - turnStart.runner.score };
      const its = { ...runs(turnStart, taken), stolen: aiEnd.runner.score - turnStart.runner.score };
      turns++;
      const say = (r: { servers: string[]; stolen: number }) => `${r.servers.length ? 'ran ' + r.servers.join(', ') : 'no runs'}${r.stolen ? `, stole ${r.stolen}` : ''}`;
      if (mine.servers.join() === its.servers.join() && mine.stolen === its.stolen) turnsMatched++;
      else misses.push(`${file} T${turnStart.turnNumber}: you ${say(mine)}, AI ${say(its)}`);
      turnStart = null;
      humanMoves = [];
      return;
    }
    const yours = progress(turnStart, end);
    const ai = progress(turnStart, aiTurn(turnStart));
    turns++;
    if (yours.points === ai.points && yours.advanced === ai.advanced) turnsMatched++;
    const say = (p: { points: number; advanced: boolean }) => (p.points ? `scored ${p.points}` : p.advanced ? 'advanced' : 'no agenda move');
    if (!(yours.points === ai.points && yours.advanced === ai.advanced)) misses.push(`${file} T${turnStart.turnNumber}: you ${say(yours)}, AI ${say(ai)}`);
    turnStart = null;
  };
  for (const move of report.moves as GameAction[]) {
    const clicks = human === 'corp' ? s.corp.clicks : s.runner.clicks;
    const main = move.player === human && s.activePlayer === human && mainPhase(s) && actingSide(s) === human;
    if (main && move.type !== 'START_TURN' && !turnStart && clicks > 0) turnStart = s;
    if (turnStart && move.player === human) humanMoves.push(move);
    if (main && move.type !== 'START_TURN' && move.type !== 'END_TURN') {
      const ai = createAgent(human, 'normal').chooseAction(s);
      if (opt('at') === `${file}:${s.turnNumber}:${clicks}` && human === 'corp') {
        // --at=file:turn:clicks prints the one-step ranking there (the planner's input) and the human's move
        const ranked = new HeuristicCorpAI({ synergy: true, planner: false }).rankMainActions(s);
        console.log(`at ${opt('at')}: human ${describe(s, move)}, AI ${describe(s, ai)}`);
        for (const r of ranked.slice(0, 10)) console.log(`  ${r.score.toFixed(2)}  ${describe(s, r.action)}`);
        const h = ranked.find(r => same(r.action, move));
        if (h) console.log(`  human's move scored ${h.score.toFixed(2)}`);
        const rig = [...s.runner.rig.programs, ...s.runner.rig.hardware, ...s.runner.rig.resources].map(c => `${cardDef(c).title}${Object.entries(c.tokens ?? {}).filter(([, n]) => n).map(([k, n]) => ` ${k}:${n}`).join('')}`);
        const hosted = Object.values(s.corp.servers).flatMap(sv => sv.ice.map(i => `${sv.id}:${cardDef(i).title}${i.isRezzed ? '' : '(u)'}${(i.hostedCards ?? []).map(h => '+' + cardDef(h).title + JSON.stringify(h.tokens ?? {})).join('')}`));
        console.log(`  rig: ${rig.join(', ')}\n  ice: ${hosted.join(', ')}\n  credits corp ${s.corp.credits} runner ${s.runner.credits}, score ${s.corp.score}-${s.runner.score}`);
      }
      const key = (st: GameState, a: GameAction) => (human === 'corp' ? isAgendaMove(st, a) : a.type === 'INITIATE_RUN');
      const w = key(s, move) || key(s, ai) ? 3 : 1;
      weight += w;
      if (same(move, ai)) agreed += w;
      dump.push({ file, turn: s.turnNumber, clicks, side: human, human: describe(s, move), ai: describe(s, ai), w, same: same(move, ai) });
    }
    const before = s;
    s = executeAction(s, move);
    if (turnStart && (s.activePlayer !== human || s.turnNumber !== before.turnNumber || s.winner)) finishTurn(s.winner || s.activePlayer !== human ? s : before);
  }
  finishTurn(s);
}

console.log(`decisions ${((100 * agreed) / Math.max(1, weight)).toFixed(1)}% (weighted, agenda moves and runs x3) | turns ${turnsMatched}/${turns} | agendaClick ${opt('agendaClick') ?? 'default'} corpPoints ${KNOBS.corpPoints}`);
if (opt('dump')) writeFileSync(opt('dump')!, JSON.stringify(dump, null, 1));
if (!quiet) for (const m of misses) console.log('  ' + m);
