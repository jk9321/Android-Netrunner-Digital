/**
 * Money W2 probe (AI Coordinator 2026-11-12): what plan.drawQueue does to the Corp's draw decisions, one decision at a
 * time, before any batch. MODE=record plays the Normal Corp AI on the decks of Jeff's Corp games (tests/fixtures/
 * human-games, config.ai 'runner'; same seed plus EXTRA more) to turn 10 as shipped and writes each game's actions and
 * the indexes of its main-phase draw clicks (rule 5.6.2). MODE=probe replays those actions (executeAction: the same
 * states) and at each draw decision runs a fresh Corp AI's planner search there, in this process's plan (PLAN_OFF=+drawQueue
 * for the arm, nothing for the base, so the two never share a cache): the class it picks, the draw's value, the best
 * other candidate's class and value. scripts/money-w2-probe-sum.mjs pairs the two.
 *
 *   MODE=record [EXTRA=3] [SHARD=0/4] npx vite-node scripts/money-w2-probe.ts > rec.jsonl
 *   MODE=probe REC=rec.jsonl [PLAN_OFF=+drawQueue] npx vite-node scripts/money-w2-probe.ts > probe.jsonl
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CardInstance, GameAction, GameState, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { HeuristicCorpAI, createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { cardSynergy } from '../src/ai/synergyTags';
import { plannerStats } from '../src/ai/turnPlanner';
import { applyPlanOff } from '../src/ai/synergy';
import { asSide } from '../src/ai/pricing';
import { decisionContext } from '../src/ai/handValues';

applyPlanOff(process.env.PLAN_OFF ?? '');
const DIR = 'tests/fixtures/human-games';
const TURNS = 10;
const EXTRA = Number(process.env.EXTRA ?? 3);

const econ = (c: CardInstance) => (cardSynergy(cardDef(c)).gives?.econ ?? 0) > 0;
function classOf(s: GameState, a: GameAction): string {
  const id = 'cardInstanceId' in a ? (a as { cardInstanceId?: string }).cardInstanceId : undefined;
  const card = id ? findCardAnywhere(s, id) : undefined;
  const t = card ? cardDef(card).type_code : undefined;
  switch (a.type) {
    case 'DRAW_CARD': return 'draw';
    case 'GAIN_CREDIT': return 'money';
    case 'ADVANCE_CARD': return 'advance';
    case 'INSTALL_CARD': return t === 'ice' ? 'install ice' : t === 'agenda' ? 'install agenda' : 'install asset/upgrade';
    case 'PLAY_OPERATION_OR_EVENT':
    case 'USE_ABILITY': return card && econ(card) ? 'money' : 'other';
    default: return 'other';
  }
}

const start = (report: { config: { seed: number; corpDeck: unknown; runnerDeck: unknown } }, seed: number) =>
  createInitialGameState(deckGameSetup(seed, report.config.corpDeck as never, report.config.runnerDeck as never));

if (process.env.MODE === 'record') {
  const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
  const files = readdirSync(DIR).filter(f => f.endsWith('.json')).sort().filter(f => JSON.parse(readFileSync(join(DIR, f), 'utf8')).config.ai === 'runner');
  for (const [index, file] of files.entries()) {
    if (index % shards !== shard) continue;
    const report = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
    for (let k = 0; k <= EXTRA; k++) {
      valueLoops.clear();
      const game = new GameRunner(start(report, report.config.seed + k), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
      const moves: GameAction[] = [];
      const draws: number[] = [];
      for (let i = 0; i < 6000 && game.state.turnNumber <= TURNS; i++) {
        const before = game.state;
        if (!game.step()) break;
        const a = game.last!;
        if (a.type === 'DRAW_CARD' && a.player === 'corp' && before.activePlayer === 'corp' && !before.activeRun && before.pendingPrompts.length === 0 && !before.turnStep) draws.push(moves.length);
        moves.push(a);
      }
      console.log(JSON.stringify({ game: file, seed: report.config.seed + k, moves, draws }));
    }
  }
} else {
  const recs = readFileSync(process.env.REC!, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const reports = new Map<string, { config: { seed: number; corpDeck: unknown; runnerDeck: unknown } }>();
  for (const rec of recs) {
    if (!reports.has(rec.game)) reports.set(rec.game, JSON.parse(readFileSync(join(DIR, rec.game), 'utf8')));
    let s = start(reports.get(rec.game)!, rec.seed);
    const at = new Set<number>(rec.draws);
    const out: object[] = [];
    for (const [i, move] of (rec.moves as GameAction[]).entries()) {
      if (at.has(i)) {
        valueLoops.clear();
        const corp = createAgent('corp', 'normal') as HeuristicCorpAI;
        let seen: { values: number[]; actions: GameAction[] } | null = null;
        plannerStats.onCandidates = (side, values, actions) => {
          if (side === 'corp') seen = { values, actions };
        };
        const state = s;
        const pick = asSide('corp', () => {
          decisionContext(state, 'corp');
          const ranked = corp.rankMainActions(state);
          return (corp as unknown as { plan(x: GameState, r: typeof ranked): GameAction | null }).plan(state, ranked);
        });
        plannerStats.onCandidates = undefined;
        // PIN=turn: every candidate and the rule ranking's top at that turn's draw decisions, to stderr
        if (process.env.PIN && Number(process.env.PIN) === state.turnNumber) {
          const shown = seen as { values: number[]; actions: GameAction[] } | null;
          const name = (x: GameAction) => `${classOf(state, x)} ${'cardInstanceId' in x ? cardDef(findCardAnywhere(state, (x as { cardInstanceId: string }).cardInstanceId)!).title : ''} ${JSON.stringify(x).slice(0, 120)}`;
          console.error(`T${state.turnNumber} clicks ${state.corp.clicks} credits ${state.corp.credits} HQ ${state.corp.hq.map(h => cardDef(h).title).join(', ')}`);
          shown?.actions.forEach((x, j) => console.error(`  candidate ${shown.values[j].toFixed(2)} ${name(x)}`));
          const ranked = asSide('corp', () => corp.rankMainActions(state));
          ranked.slice(0, 12).forEach(r => console.error(`  ranked ${r.score.toFixed(2)} ${name(r.action)}`));
        }
        const c = seen as { values: number[]; actions: GameAction[] } | null;
        let draw: number | null = null;
        let other: { cls: string; value: number } | null = null;
        c?.actions.forEach((x, j) => {
          const cls = classOf(state, x);
          if (cls === 'draw') draw = Math.max(draw ?? -Infinity, c.values[j]);
          else if (!other || c.values[j] > other.value) other = { cls, value: c.values[j] };
        });
        out.push({ index: i, turn: state.turnNumber, clicks: state.corp.clicks, credits: state.corp.credits, pick: pick ? classOf(state, pick) : null, draw, other });
      }
      s = executeAction(s, move);
    }
    console.log(JSON.stringify({ game: rec.game, seed: rec.seed, draws: out }));
  }
}
