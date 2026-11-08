/**
 * Install-worth side check (AI Coordinator, 2026-11-08): is the agenda side valued too low at the planner's leaf?
 * For every one of Jeff's agenda installs and advances (tests/fixtures/human-games), at his position:
 *   - net: the one-step evaluate(corp) change of his move, priced as the planner's leaf (no Runner reply);
 *   - line: the planner's leaf of his move played to the end of the turn (scripts/leaf-decompose.ts playout), with the
 *     Runner reply (runnerReply.ts, REPLY.samples guesses), and in how many samples the reply stole that agenda;
 *   - outcome in his game: scored by the Corp, stolen within 2 Runner turns, stolen later, or neither by the game's end.
 *
 * Usage: npx vite-node scripts/agenda-moves.ts -- [--json=out.json]
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GameAction, GameState, actingSide, activePrompt, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { HeuristicCorpAI } from '../src/ai';
import { evaluate } from '../src/ai/evaluate';
import { asSide, plan, pricing, withPricing } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';
import { discardStep, searchPiece } from '../src/ai/turnPlanner';
import { threatStats, turnSeed } from '../src/ai/threatModel';
import { GameRunner } from '../src/ai/playout';
import { HeuristicRunnerAI } from '../src/ai/runnerAI';
import { REPLY, guessHidden } from '../src/ai/runnerReply';
import { applyPlanOff } from '../src/ai/synergy';

applyPlanOff(process.env.PLAN_OFF ?? '');
const args = process.argv.slice(2).filter(a => a !== '--');
const opt = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const dir = 'tests/fixtures/human-games';
const mainPhase = (s: GameState) => !s.activeRun && s.pendingPrompts.length === 0 && !(s.priority && s.priority.holder !== s.activePlayer);
const cardOf = (s: GameState, a: GameAction) => ('cardInstanceId' in a && a.cardInstanceId ? findCardAnywhere(s, a.cardInstanceId) : undefined);
const leafEval = (s: GameState) => withPricing({ leaves: [...pricing().leaves, { side: 'corp', plan: plan() }] }, () => evaluate(s, 'corp'));

function playout(start: GameState, first: GameAction): GameState {
  const rollout = new HeuristicCorpAI({ synergy: true, planner: false, searching: true });
  let s = executeAction(start, first);
  for (let i = 0; i < 12 && !s.winner; i++) {
    if (s.activePlayer !== 'corp' || s.activeRun) break;
    if (activePrompt(s)) {
      try { s = executeAction(s, rollout.chooseAction(s)); } catch { break; }
      continue;
    }
    const out = s.corp.clicks <= 0;
    const best = rollout.rankMainActions(s).find(r => r.score > -Infinity && r.action.type !== 'END_TURN' && (!out || r.action.type === 'SCORE_AGENDA'));
    if (!best) break;
    try { s = executeAction(s, best.action); } catch { break; }
  }
  if (searchPiece('plannerDiscard') && !s.winner) s = discardStep(s, 'corp', { rank: x => rollout.rankMainActions(x), answer: x => rollout.chooseAction(x) });
  return s;
}

/** The reply's leaf (averaged) and the samples in which the Runner took the agenda (or won). */
function reply(end: GameState, agendaId: string): { value: number; stolen: number; scored: boolean } {
  const scored = end.corp.scoreArea.some(c => c.instanceId === agendaId);
  if (end.winner) return { value: end.winner === 'corp' ? 1000 : -1000, stolen: 0, scored };
  let total = 0;
  let stolen = 0;
  const outer = threatStats.inReply;
  threatStats.inReply = true;
  try {
    for (let k = 0; k < REPLY.samples; k++) {
      const gr = new GameRunner(guessHidden(end, k), { corp: new HeuristicCorpAI({ synergy: true, planner: false }), runner: new HeuristicRunnerAI({ synergy: true, planner: false }) });
      let runnerTurn = false;
      try {
        for (let i = 0; i < REPLY.maxSteps && !gr.state.winner; i++) {
          if (!gr.step()) break;
          if (gr.state.activePlayer === 'runner') runnerTurn = true;
          else if (runnerTurn && !gr.state.activeRun) break;
        }
      } catch { /* scored where it stopped */ }
      if (gr.state.runner.scoreArea.some(c => c.instanceId === agendaId)) stolen++;
      total += leafEval(gr.state);
    }
  } finally {
    threatStats.inReply = outer;
  }
  return { value: total / REPLY.samples, stolen, scored };
}

type Row = { file: string; turn: number; move: string; agenda: string; net: number; line: number; replySteals: number; scoredInLine: boolean; outcome: string; outcomeTurn?: number };
const rows: Row[] = [];
for (const file of readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
  const report = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  if (!report.moves?.length || report.config.ai !== 'runner') continue;
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  const states: GameState[] = [];
  const pending: { row: Row; id: string; at: number }[] = [];
  for (const move of report.moves as GameAction[]) {
    const main = move.player === 'corp' && s.activePlayer === 'corp' && mainPhase(s) && actingSide(s) === 'corp';
    const card = cardOf(s, move);
    if (main && card && cardDef(card).type_code === 'agenda' && (move.type === 'INSTALL_CARD' || move.type === 'ADVANCE_CARD')) {
      const before = s;
      const seed = (turnSeed(before) ^ Math.imul(before.corp.clicks + 1, 0x85ebca6b)) >>> 0;
      const { net, line } = asSide('corp', () => {
        decisionContext(before, 'corp');
        return withPricing({ frozen: true, decisionSeed: seed }, () => {
          const after = executeAction(before, move);
          const net = leafEval(after) - leafEval(before);
          const r = reply(playout(before, move), card.instanceId);
          return { net, line: r };
        });
      });
      const row: Row = { file, turn: before.turnNumber, move: move.type === 'INSTALL_CARD' ? 'install' : 'advance', agenda: cardDef(card).title, net, line: line.value, replySteals: line.stolen, scoredInLine: line.scored, outcome: 'open' };
      rows.push(row);
      pending.push({ row, id: card.instanceId, at: before.turnNumber });
    }
    s = executeAction(s, move);
    states.push(s);
  }
  // The outcome in Jeff's game: where each agenda went, and on which turn (turnNumber counts each side's turn)
  for (const p of pending) {
    for (const st of states) {
      if (st.corp.scoreArea.some(c => c.instanceId === p.id)) { p.row.outcome = 'scored'; p.row.outcomeTurn = st.turnNumber; break; }
      // turnNumber counts rounds (turn.ts: +1 after the Runner's turn): within 2 Runner turns is this round or the next
      if (st.runner.scoreArea.some(c => c.instanceId === p.id)) { p.row.outcome = st.turnNumber - p.at <= 1 ? 'stolen<=2' : 'stolen later'; p.row.outcomeTurn = st.turnNumber; break; }
    }
    if (p.row.outcome === 'open') p.row.outcome = s.winner ? 'neither (game over)' : 'neither (report ends)';
  }
}

const q = (xs: number[], f: number) => { const v = [...xs].sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor(f * v.length))] : NaN; };
for (const kind of ['install', 'advance']) {
  const r = rows.filter(x => x.move === kind);
  const fin = (xs: number[]) => xs.filter(Number.isFinite);
  console.log(`\n${kind}: ${r.length} of Jeff's moves`);
  console.log(`  one-step leaf net: p25 ${q(r.map(x => x.net), 0.25).toFixed(2)} median ${q(r.map(x => x.net), 0.5).toFixed(2)} p75 ${q(r.map(x => x.net), 0.75).toFixed(2)}`);
  const lines = fin(r.map(x => x.line)).filter(v => Math.abs(v) < 900);
  console.log(`  turn line + reply leaf: p25 ${q(lines, 0.25).toFixed(2)} median ${q(lines, 0.5).toFixed(2)} p75 ${q(lines, 0.75).toFixed(2)} (${r.length - lines.length} won/lost lines left out)`);
  const open = r.filter(x => !x.scoredInLine);
  console.log(`  reply stole it in >= 1 of ${REPLY.samples} samples: ${open.filter(x => x.replySteals > 0).length} of ${open.length} not scored in the line (both samples: ${open.filter(x => x.replySteals === REPLY.samples).length})`);
  const out = (o: string) => r.filter(x => x.outcome === o).length;
  console.log(`  in Jeff's game: scored ${out('scored')}, stolen within 2 Runner turns ${out('stolen<=2')}, stolen later ${out('stolen later')}, neither ${out('neither (game over)') + out('neither (report ends)')}`);
  const stoleReply = open.filter(x => x.replySteals > 0);
  console.log(`  of the reply's steals, really stolen within 2 turns: ${stoleReply.filter(x => x.outcome === 'stolen<=2').length} of ${stoleReply.length}`);
}
if (opt('json')) writeFileSync(opt('json')!, JSON.stringify(rows, null, 1));
