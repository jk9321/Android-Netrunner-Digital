/**
 * Planner speed P1 split (spec-planner-speed.md; temporary, with plan.plannerSkip): plays deals with the switch OFF (as
 * beta) and, at every decision the skip would have made, compares the skip's action with what was played:
 *  (a) the planner's pick was kept (it keeps the score, winNow keepsScore) and differs from the skip's (the ranking's pick
 *      or the line's first);
 *  (b) the planner's pick dropped the score line (the line's first was played) while the skip plays the ranking's pick;
 *  other.
 * With SKIP=1 it plays the switch ON instead and prints only the winners, for the outcome by deal.
 *
 *   SEEDS=1001,1011 npx vite-node scripts/p1-split.ts
 */
import { GameAction, GameState, cardDef, createInitialGameState, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { valueLoops } from '../src/ai/valueModel';
import { tuning } from '../src/ai/synergy';
import { plannerSkipProbe } from '../src/ai/corpAI';

const skip = process.env.SKIP === '1';
(tuning.plan as Record<string, unknown>).plannerSkip = skip;
(tuning.plan as Record<string, unknown>).threatHqKey = false;
(tuning.plan as Record<string, unknown>).threatCacheCap = false;
(tuning.plan as Record<string, unknown>).threatRdKey = 0;

const same = (a: GameAction | null, b: GameAction | null) => JSON.stringify(a) === JSON.stringify(b);
const say = (s: GameState, a: GameAction | null) => {
  if (!a) return '-';
  const x = a as unknown as { cardInstanceId?: string; targetServerId?: string; asNewRemote?: boolean };
  const c = x.cardInstanceId ? findCardAnywhere(s, x.cardInstanceId) : null;
  return `${a.type.toLowerCase()}${c ? ' ' + cardDef(c).title : ''}${x.targetServerId ? ' > ' + x.targetServerId : x.asNewRemote ? ' > new remote' : ''}`;
};

const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
for (const seed of (process.env.SEEDS ?? '').split(',').filter(Boolean).map(Number)) {
  const p = Math.floor((seed - 1001) / 10);
  valueLoops.clear();
  const diffs: { turn: number; kind: string; cls: string; played: string; skip: string; planned: string; first: string | null }[] = [];
  let probes = 0;
  plannerSkipProbe.on = r => {
    probes++;
    if (same(r.skip, r.picked)) return;
    const cls = same(r.picked, r.planned) ? 'a' : r.scoreFirst && same(r.picked, r.scoreFirst) && !same(r.planned, r.scoreFirst) ? 'b' : 'other';
    diffs.push({ turn: r.state.turnNumber, kind: r.kind, cls, played: say(r.state, r.picked), skip: say(r.state, r.skip), planned: say(r.state, r.planned), first: r.scoreFirst ? say(r.state, r.scoreFirst) : null });
  };
  const game = new GameRunner(createInitialGameState(deckGameSetup(seed, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length])), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
  for (let i = 0; i < 6000 && game.step(); i++);
  console.log(JSON.stringify({ seed, skip, winner: game.state.winner ?? null, turns: game.state.turnNumber, probes, diffs }));
}
