/**
 * R-B O1b (brief /mnt/project-files/netrunner-ai/runner-rework/briefs/o1b-trash-owner.md rev 2, step 0.3; tracker R-14f):
 * issue #58's pin read turn by turn. The saved game (tests/fixtures/runner-facts/issues/issue-58.json) is replayed to the
 * Runner's first run of T3, by a Normal Runner that watched every board (observe, as tests/runnerDecidedTwice.test.ts
 * boardAt), and played forward by GameRunner with a Normal Corp to the end of T6, as the pin plays it. Each Runner action is
 * printed with the board before it; at each Runner main decision outside a run, the Plaza's server's price on the Runner's
 * view (serverValue, the Plaza's term when it is alone in its root), its inputs (worth as left, the engine's trash cost on
 * the slide, tagCost before and after the trash is paid) and the server's runScore. Run it on this checkout and on a
 * checkout of the base (same file) to compare: TURN_FROM=3 TURN_TO=6 by default.
 *
 *   npx vite-node scripts/runner-rework/trash-owner-pins.ts
 *
 * Reads only the Runner's view (runnerDecisionView) for the prices; the play is the pin's own.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { GameAction, GameState, activePrompt, createInitialGameState, executeAction } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { createAgent } from '../../src/ai';
import { GameRunner } from '../../src/ai/playout';
import { runScore, serverValue, tagCost, creditCost } from '../../src/ai/runs';
import { corpCardValue } from '../../src/ai/evaluate';
import { runnerDecisionView } from '../../src/ai/turnPlanner';
import { asSide } from '../../src/ai/synergy';
import { threatLevel, trashCost } from '../../src/core/engine/cardEffects';

const PLAZA = '35062';
const FROM = Number(process.env.TURN_FROM ?? 3);
const TO = Number(process.env.TURN_TO ?? 6);
const r = JSON.parse(readFileSync('tests/fixtures/runner-facts/issues/issue-58.json', 'utf8'));
const r3 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x);

let s: GameState = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
if (r.startStops) s = { ...s, stops: r.startStops };
const runner = createAgent('runner', 'normal') as any;
let board: GameState | null = null;
for (const move of r.moves as GameAction[]) {
  if (s.turnNumber === FROM && s.activePlayer === 'runner' && move.type === 'INITIATE_RUN') {
    board = structuredClone(s);
    break;
  }
  runner.observe?.(s);
  s = executeAction(s, move);
}
if (!board) throw new Error(`no Runner run in T${FROM}`);

const plazasOf = (st: GameState) => Object.values(st.corp.servers).flatMap(v => v.root.filter(c => c.cardCode === PLAZA).map(card => ({ server: v, card })));
function price(st: GameState) {
  const view = runnerDecisionView(st);
  const ps = plazasOf(view);
  if (!ps.length) return null;
  return ps.map(p => asSide('runner', () => {
    const cost = trashCost(view, p.card) ?? 0;
    const paid = { ...view, runner: { ...view.runner, credits: view.runner.credits - cost } };
    return {
      server: p.server.id,
      root: p.server.root.length,
      rezzed: p.card.isRezzed,
      threat: threatLevel(view),
      worth: r3(corpCardValue(p.card, view, 'runner', true) - creditCost(view, cost)),
      tag: r3(tagCost(view)),
      tagPaid: r3(tagCost(paid)),
      serverValue: r3(serverValue(view, p.server.id)),
      runScore: r3(runScore(view, p.server.id) as number),
    };
  }));
}

const g = new GameRunner(board, { runner, corp: createAgent('corp', 'normal') });
let lastPriced = '';
for (let k = 0; k < 4000 && g.state.turnNumber <= TO && !g.state.winner; k++) {
  const before = g.state;
  const main = before.activePlayer === 'runner' && !before.activeRun && before.pendingPrompts.length === 0 && !before.priority;
  const key = `${before.turnNumber}:${before.runner.clicks}:${before.runner.credits}`;
  const priced = main && key !== lastPriced ? price(before) : null;
  if (main) lastPriced = key;
  g.step();
  const a: any = g.last;
  if (a?.player !== 'runner') continue;
  const p = activePrompt(before);
  const what =
    a.type === 'RESOLVE_PROMPT' ? `${p?.kind}:${JSON.stringify(a.choice)}` : a.type === 'INITIATE_RUN' ? `RUN ${a.targetServerId}` : a.type === 'PASS' ? null : a.type + (a.cardInstanceId ? ` ${a.cardInstanceId}` : '');
  if (!what) continue;
  const line: Record<string, unknown> = { T: before.turnNumber, clicks: before.runner.clicks, credits: before.runner.credits, tags: before.runner.tags, inRun: before.activeRun?.server ?? null, action: what };
  if (priced) line.plaza = priced;
  if (p && p.kind === 'access_trash') line.accessed = plazasOf(before).some(x => x.card.instanceId === p.cardInstanceId) ? 'Plaza' : p.cardInstanceId;
  console.log(JSON.stringify(line));
}
console.log(JSON.stringify({ end: { T: g.state.turnNumber, tags: g.state.runner.tags, plazas: plazasOf(g.state).map(x => x.server.id), corpScore: g.state.corp.score, runnerScore: g.state.runner.score } }));
