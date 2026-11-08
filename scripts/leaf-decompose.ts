/**
 * Install-worth side check, step 1b (AI Coordinator, 2026-11-08): at Jeff's own Corp positions where he advanced or
 * installed an agenda and the planner picked an install instead, which part of the planner's leaf made the install win.
 *
 * For each position the AI's pick and Jeff's move are each played to the end of the turn the way turnPlanner.ts playout
 * plays a candidate (the rest of the turn by the planner-off Corp AI, prompts answered by it, the discard step), and the
 * leaf is split into its parts. The leaf in the shipped config (threatLeaf off, runnerReply on: corpAI.ts plan) is
 * evaluate(corp) after the Runner's next turn, played out from REPLY.samples guesses of the hidden cards (runnerReply.ts),
 * averaged; the parts here are averaged the same way, with the Runner's points stolen in the reply. The planner's own
 * candidate values (plannerStats.onCandidates) are printed beside it so the replication can be checked.
 *
 * Usage: npx vite-node scripts/leaf-decompose.ts -- [--n=10] [--per=2] [--at=file:turn:clicks] [--json=out.json]
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GameAction, GameState, actingSide, activePrompt, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { HeuristicCorpAI, createAgent } from '../src/ai';
import { corpBoardValue, corpCardValue, evaluate, handAndClicks, sideStrength } from '../src/ai/evaluate';
import { iceWorth } from '../src/ai/iceValues';
import { sideCreditValue, pointValue, KNOBS } from '../src/ai/valueModel';
import { threatStats, turnSeed } from '../src/ai/threatModel';
import { GameRunner } from '../src/ai/playout';
import { HeuristicRunnerAI } from '../src/ai/runnerAI';
import { REPLY, guessHidden } from '../src/ai/runnerReply';
import { asSide, plan, pricing, withPricing } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';
import { discardStep, plannerStats, searchPiece } from '../src/ai/turnPlanner';
import { applyPlanOff } from '../src/ai/synergy';

applyPlanOff(process.env.PLAN_OFF ?? '');
const args = process.argv.slice(2).filter(a => a !== '--');
const opt = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const dir = 'tests/fixtures/human-games';
const N = Number(opt('n') ?? 10);
const PER = Number(opt('per') ?? 2);

const cardOf = (s: GameState, a: GameAction) => ('cardInstanceId' in a && a.cardInstanceId ? findCardAnywhere(s, a.cardInstanceId) : undefined);
const typeOf = (s: GameState, a: GameAction) => { const c = cardOf(s, a); return c ? cardDef(c).type_code : undefined; };
const describe = (s: GameState, a: GameAction) => {
  const c = cardOf(s, a);
  return `${a.type}${c ? ' ' + cardDef(c).title : ''}${'targetServerId' in a && a.targetServerId ? ' @' + a.targetServerId : ''}`;
};
const same = (a: GameAction, b: GameAction) => JSON.stringify({ ...a, player: 0 }) === JSON.stringify({ ...b, player: 0 });
const mainPhase = (s: GameState) => !s.activeRun && s.pendingPrompts.length === 0 && !(s.priority && s.priority.holder !== s.activePlayer);
const jeffAgendaMove = (s: GameState, a: GameAction) => (a.type === 'ADVANCE_CARD' && typeOf(s, a) === 'agenda') || (a.type === 'INSTALL_CARD' && typeOf(s, a) === 'agenda');
const aiInstall = (s: GameState, a: GameAction) => a.type === 'INSTALL_CARD' && ['asset', 'upgrade', 'ice'].includes(typeOf(s, a) ?? '');

/** The rest of the turn as turnPlanner.ts playout plays it (no runs for the Corp; dominated() not applied). */
function playout(start: GameState, first: GameAction): { end: GameState; line: string[] } {
  const rollout = new HeuristicCorpAI({ synergy: true, planner: false, searching: true });
  const line: string[] = [describe(start, first)];
  let s = executeAction(start, first);
  for (let i = 0; i < 12 && !s.winner; i++) {
    if (s.activePlayer !== 'corp' || s.activeRun) break;
    if (activePrompt(s)) {
      const answer = rollout.chooseAction(s);
      try { s = executeAction(s, answer); } catch { break; }
      continue;
    }
    const out = s.corp.clicks <= 0;
    const best = rollout.rankMainActions(s).find(r => r.score > -Infinity && r.action.type !== 'END_TURN' && (!out || r.action.type === 'SCORE_AGENDA'));
    if (!best) break;
    line.push(describe(s, best.action));
    try { s = executeAction(s, best.action); } catch { break; }
  }
  if (searchPiece('plannerDiscard') && !s.winner) s = discardStep(s, 'corp', { rank: x => rollout.rankMainActions(x), answer: x => rollout.chooseAction(x) });
  return { end: s, line };
}

type Parts = Record<string, number>;
/** One state's evaluate(corp) split into its parts, priced as the planner's leaf (turnPlanner.ts leafValue). */
function parts(s: GameState): Parts {
  return withPricing({ leaves: [...pricing().leaves, { side: 'corp', plan: plan() }] }, () => {
    if (s.winner) return { total: s.winner === 'corp' ? 1000 : -1000 };
    const ice = Object.values(s.corp.servers).reduce((n, sv) => n + sv.ice.reduce((m, c) => m + iceWorth(s, c, 'corp'), 0), 0);
    const roots = Object.values(s.corp.servers).reduce((n, sv) => n + sv.root.filter(c => cardDef(c).type_code !== 'agenda').reduce((m, c) => m + corpCardValue(c, s, 'corp'), 0), 0);
    const board = corpBoardValue(s, 'corp');
    const corpSide = sideStrength(s, 'corp', 'corp');
    const credits = sideCreditValue(s, 'corp', 'corp');
    const hand = handAndClicks(s, 'corp', 'corp');
    const points = pointValue(s.corp.score, KNOBS.corpPoints);
    const runner = sideStrength(s, 'runner', 'corp');
    return {
      total: evaluate(s, 'corp'), credits, handClicks: hand, points, ice, assetsUpgrades: roots, agendasEtc: board - ice - roots,
      otherCorp: corpSide - credits - hand - points - board, runnerSide: -runner,
    };
  });
}

/** The leaf as runnerReply.ts scores it: the Runner's next turn from each guess, parts averaged (openSteal not split out). */
function replyParts(end: GameState): { parts: Parts; stolen: number; ran: string } {
  const sum: Parts = {};
  let stolen = 0;
  const ran = new Set<string>();
  const outer = threatStats.inReply;
  threatStats.inReply = true;
  try {
    for (let k = 0; k < REPLY.samples; k++) {
      const gr = new GameRunner(guessHidden(end, k), { corp: new HeuristicCorpAI({ synergy: true, planner: false }), runner: new HeuristicRunnerAI({ synergy: true, planner: false }) });
      let runnerTurn = false;
      try {
        for (let i = 0; i < REPLY.maxSteps && !gr.state.winner; i++) {
          if (!gr.step()) break;
          const st = gr.state;
          if (st.activeRun) ran.add(st.activeRun.server);
          if (st.activePlayer === 'runner') runnerTurn = true;
          else if (runnerTurn && !st.activeRun) break;
        }
      } catch { /* scored where it stopped */ }
      stolen += (gr.state.runner.score - end.runner.score) / REPLY.samples;
      for (const [key, v] of Object.entries(parts(gr.state))) sum[key] = (sum[key] ?? 0) + v / REPLY.samples;
    }
  } finally {
    threatStats.inReply = outer;
  }
  return { parts: sum, stolen, ran: [...ran].join(',') };
}

const picks: { file: string; turn: number; clicks: number; s: GameState; jeff: GameAction; ai: GameAction }[] = [];
const at = opt('at');
for (const file of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  if (at && !at.startsWith(file + ':')) continue;
  const report = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  if (!report.moves?.length || report.config.ai !== 'runner') continue; // Jeff played the Corp
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  let taken = 0;
  for (const move of report.moves as GameAction[]) {
    const main = move.player === 'corp' && s.activePlayer === 'corp' && mainPhase(s) && actingSide(s) === 'corp' && move.type !== 'START_TURN' && move.type !== 'END_TURN';
    if (main && taken < PER && (at ? at === `${file}:${s.turnNumber}:${s.corp.clicks}` : jeffAgendaMove(s, move))) {
      const ai = createAgent('corp', 'normal').chooseAction(s);
      if (at || (aiInstall(s, ai) && !same(ai, move))) {
        picks.push({ file, turn: s.turnNumber, clicks: s.corp.clicks, s, jeff: move, ai });
        taken++;
      }
    }
    s = executeAction(s, move);
  }
}
// Spread over games: round-robin by file
const byFile = new Map<string, typeof picks>();
for (const p of picks) byFile.set(p.file, [...(byFile.get(p.file) ?? []), p]);
const chosen: typeof picks = [];
for (let k = 0; chosen.length < N && k < PER; k++) for (const list of byFile.values()) if (list[k] && chosen.length < N) chosen.push(list[k]);

const fmt = (x: number) => (typeof x === 'number' ? x.toFixed(2).padStart(7) : String(x));
const out: unknown[] = [];
for (const p of chosen) {
  const s = p.s;
  let planner: number[] = [];
  plannerStats.onCandidates = (side, values) => { if (side === 'corp') planner = values; };
  const agent = createAgent('corp', 'normal');
  const pick = agent.chooseAction(s);
  plannerStats.onCandidates = undefined;
  const seed = (turnSeed(s) ^ Math.imul(s.corp.clicks + 1, 0x85ebca6b)) >>> 0;
  const run = (a: GameAction) => asSide('corp', () => { decisionContext(s, 'corp'); return withPricing({ frozen: true, decisionSeed: seed }, () => { const r = playout(s, a); return { ...r, before: parts(r.end), ...replyParts(r.end) }; }); });
  const A = run(pick);
  const J = run(p.jeff);
  console.log(`\n== ${p.file} T${p.turn} clicks ${p.clicks} | corp ${s.corp.credits}cr score ${s.corp.score}-${s.runner.score}`);
  console.log(`  AI   line: ${A.line.join(' > ')}`);
  console.log(`  Jeff line: ${J.line.join(' > ')}`);
  console.log(`  planner candidate values: ${planner.map(v => v.toFixed(2)).join(', ')}`);
  console.log(`  ${'part'.padEnd(15)} ${'AI'.padStart(7)} ${'Jeff'.padStart(7)} ${'AI-Jeff'.padStart(7)}`);
  console.log(`  end of Corp turn: total AI ${fmt(A.before.total)} Jeff ${fmt(J.before.total)} | reply ran AI [${A.ran}] stole ${A.stolen.toFixed(2)}, Jeff [${J.ran}] stole ${J.stolen.toFixed(2)}`);
  for (const k of Object.keys(A.parts)) console.log(`  ${k.padEnd(15)} ${fmt(A.parts[k])} ${fmt(J.parts[k] ?? NaN)} ${fmt(A.parts[k] - (J.parts[k] ?? NaN))}`);
  out.push({ file: p.file, turn: p.turn, clicks: p.clicks, credits: s.corp.credits, ai: A.line, jeff: J.line, planner, aiParts: A.parts, jeffParts: J.parts, aiBefore: A.before, jeffBefore: J.before, aiStolen: A.stolen, jeffStolen: J.stolen, aiRan: A.ran, jeffRan: J.ran });
}
if (opt('json')) writeFileSync(opt('json')!, JSON.stringify(out, null, 1));
