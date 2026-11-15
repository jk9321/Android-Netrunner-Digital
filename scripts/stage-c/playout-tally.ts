/**
 * Stage C8 (AI Coordinator 2026-11-15 22:51Z, review A1): what the planner's own playouts play. A playout's Corp step
 * is the first eligible entry of `rank` (turnPlanner.ts playout: rollout.rankMainActions, the candidates) and never
 * goes through corpDecide, so Q5 (the held line's step or veto) is not asked there; corpDecide is reached in a playout
 * only at a prompt (rollout.chooseAction, which returns at Q0). This tallies, over whole games played by the Normal AI
 * on both sides:
 *  - rankMainActions calls made directly by a playout, against those made inside a corpDecide (a pipeline: the
 *    agent itself, the reply's Corp), told apart by the call stack;
 *  - in a playout, the line of the first eligible entry (score above -Infinity, not END_TURN; the playout also skips
 *    dominated moves and, in 'hold' mode, agenda installs, which this does not repeat): line 8, line 9 or the behind group;
 *  - Corp chooseAction calls by caller (the game's Corp, the reply's Corp, a playout's prompt) at a main-phase state and
 *    at a prompt; a playout's own step never calls it at a main-phase state (expected 0);
 *  - the diagnostics' scoreInTwo counters, by the same caller (vetoed: a pick vetoed by the held line; rolloutDecisions
 *    and rolloutTaken: corpDecide calls without the counted questions, and those where Q4/Q5 changed the pick).
 * Observation only: the patched methods return what they returned.
 *   SHARD=k/n npx vite-node scripts/stage-c/playout-tally.ts -- [games per pairing, default 1]
 */
import { createInitialGameState } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { ALL_DECKS } from '../nsg-sample-decks';
import { createAgent } from '../../src/ai';
import { HeuristicCorpAI } from '../../src/ai/corpAI';
import type { RankedCandidate } from '../../src/ai/corp/candidates';
import { isCorpMain } from '../../src/ai/corp/lines';
import { installDiagnostics } from '../../src/ai/diagnostics';
import { GameRunner } from '../../src/ai/playout';
import { valueLoops } from '../../src/ai/valueModel';

const games = Number(process.argv.slice(2).filter(a => a !== '--')[0] ?? 1);
const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const diag = installDiagnostics();
// Deep enough to reach corpDecide or playout from a nested reply (V8 keeps 10 frames by default)
Error.stackTraceLimit = 200;
const t = { playoutRank: 0, pipelineRank: 0, line: {} as Record<string, number>, line8: 0, line9: 0, behind: 0, playoutChooseMain: 0, playoutChoosePrompt: 0 };

// The nearest of the three frames decides who asked: the playout's own step (turnPlanner.ts playout), the reply
// (runnerReply.ts, which plays the next turns with a GameRunner, so its Corp goes through corpDecide) or a pipeline
// (corpDecide). Function frames only: the file src/ai/playout.ts (GameRunner) must not match
type Who = 'playout' | 'reply' | 'pipeline' | 'other';
const caller = (): Who => {
  for (const f of (new Error().stack ?? '').split('\n').slice(2)) {
    if (/^\s*at (?:[\w$.]+\.)?corpDecide \(/.test(f)) return 'pipeline';
    if (/^\s*at (?:[\w$.]+\.)?runnerReply \(/.test(f)) return 'reply';
    if (/^\s*at (?:[\w$.]+\.)?playout \(/.test(f)) return 'playout';
  }
  return 'other';
};
const proto = HeuristicCorpAI.prototype as unknown as {
  rankMainActions: (...a: unknown[]) => RankedCandidate[];
  chooseAction: (...a: unknown[]) => unknown;
};
const rank0 = proto.rankMainActions;
proto.rankMainActions = function (this: unknown, ...a: unknown[]) {
  const out = rank0.apply(this, a);
  const who = caller();
  if (who === 'playout') {
    t.playoutRank++;
    const first = out.find(r => r.score > -Infinity && r.action.type !== 'END_TURN');
    if (first) {
      const k = first.behind ? 'behind' : String(first.line);
      t.line[k] = (t.line[k] ?? 0) + 1;
      if (first.line === 8 && !first.behind) t.line8++;
      if (first.line === 9 && !first.behind) t.line9++;
      if (first.behind) t.behind++;
    }
  } else if (who === 'pipeline') t.pipelineRank++;
  return out;
};
const choose0 = proto.chooseAction;
// The scoreInTwo counters each chooseAction adds itself (its nested calls' counts taken out), by who called it:
// 'other' is the game's own Corp, 'reply' the reply's Corp, 'playout' a prompt answered inside a playout
type S2 = typeof diag.scoreInTwo;
const KEYS = Object.keys(diag.scoreInTwo) as (keyof S2)[];
const s2: Record<string, Record<string, number>> = {};
const choose: Record<string, { main: number; prompt: number }> = {};
const frames: { child: Record<string, number> }[] = [];
proto.chooseAction = function (this: unknown, ...a: unknown[]) {
  const who = caller();
  const main = isCorpMain(a[0] as Parameters<typeof isCorpMain>[0]);
  const c = (choose[who] ??= { main: 0, prompt: 0 });
  if (main) c.main++;
  else c.prompt++;
  if (who === 'playout') {
    if (main) t.playoutChooseMain++;
    else t.playoutChoosePrompt++;
  }
  const before = Object.fromEntries(KEYS.map(k => [k, diag.scoreInTwo[k]]));
  const frame = { child: Object.fromEntries(KEYS.map(k => [k, 0])) };
  frames.push(frame);
  try {
    return choose0.apply(this, a);
  } finally {
    frames.pop();
    const mine = (s2[who] ??= Object.fromEntries(KEYS.map(k => [k, 0])));
    for (const k of KEYS) {
      const incl = diag.scoreInTwo[k] - before[k];
      mine[k] += incl - frame.child[k];
      if (frames.length) frames[frames.length - 1].child[k] += incl;
    }
  }
};

const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
let pairing = 0;
let deal = 0;
for (const c of corpDecks) {
  for (const r of runnerDecks) {
    pairing++;
    for (let g = 0; g < games; g++) {
      const seed = 1000 + (pairing - 1) * Math.max(10, games) + g + 1;
      if (deal++ % shards !== shard) continue;
      valueLoops.clear();
      const game = new GameRunner(createInitialGameState(deckGameSetup(seed, c, r)), { corp: createAgent('corp', 'normal', {}), runner: createAgent('runner', 'normal', {}) });
      for (let i = 0; i < 5000 && game.step(); i++);
    }
  }
}
console.log(JSON.stringify({ shard, ...t, choose, scoreInTwoBy: s2, scoreInTwo: diag.scoreInTwo }));
