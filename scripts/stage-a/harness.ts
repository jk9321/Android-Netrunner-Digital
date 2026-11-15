/**
 * Step 4 Stage A: the recorded states every identity table is read on (spec-step4-corp-core.md section 4 and 9).
 *
 *  - The 56 local deals: seeds 1001 + 40k (k = 0..55), batch pairings (seed 1001 + 10 * pairing, the shipped decks),
 *    Normal v Normal, each played out by the AI. DEALS=1001,1041 picks some; DEALS=none skips them.
 *  - Every game in tests/fixtures/human-games/: the recorded moves replayed; at each state where the Corp acts (its
 *    main phase, its prompts, a rez window of a run) a fresh Normal Corp is asked what it would do. HUMAN=report-49
 *    (comma list, prefix match) picks some; HUMAN=none skips them.
 *
 * The three hand-value caches (handValues clickWorth and drawWorth, effectValues damageThreat) are cleared before every
 * decision of either side (spec section 9, finding 1): their keys omit part of the board, so a value served from a
 * different call order shows a flip that is not real. Clearing is the same on both trees, so it changes nothing in what
 * the comparison means, only that the deals here are not the batch's games move for move.
 *
 * Only APIs present on beta 92f5c96 as well are read here, so this file runs unchanged in a checkout of the base.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CardInstance, GameAction, GameState, actingSide, createInitialGameState, executeAction, wantsStop } from '../../src/core';
import { deckGameSetup } from '../../src/data/decks';
import { ALL_DECKS } from '../nsg-sample-decks';
import { createAgent } from '../../src/ai';
import { Agent } from '../../src/ai/agent';
import { GameRunner, rezCandidates } from '../../src/ai/playout';
import { valueLoops } from '../../src/ai/valueModel';
import { clearHandCaches } from '../../src/ai/handValues';
import { clearDamageThreats } from '../../src/ai/effectValues';

export const clearCaches = () => {
  clearHandCaches();
  clearDamageThreats();
};

export type DecisionKind = 'action' | 'rez';
export interface Decision {
  /** 'deal:1001' or 'human:report-49.json' */
  src: string;
  /** Decision index inside its source (Corp decisions only). */
  i: number;
  kind: DecisionKind;
  turn: number;
  state: GameState;
  action: GameAction | null;
  ms: number;
  /** The Corp agent that decided (the deal's own, or the fresh one asked at a human-game state). */
  agent: Agent;
  /** The rez window's candidates (kind 'rez'). */
  cards?: CardInstance[];
  /** Corp agent fields read before the decision (heldLine), for the placement table. */
  before?: Record<string, unknown>;
}

export interface Hooks {
  /** Called once per Corp decision, after it is made. */
  decision?(d: Decision): void;
  /** Called on the Corp agent just before it decides (patch its methods to watch its internals). */
  arm?(agent: Agent, state: GameState, kind: DecisionKind): void;
  /** Called after each deal ends. */
  dealEnd?(src: string, state: GameState): void;
}

export const DEFAULT_DEALS = Array.from({ length: 56 }, (_, k) => 1001 + 40 * k);

export function deals(): number[] {
  const env = (process.env.DEALS ?? '').split(',').filter(Boolean);
  if (env.includes('none')) return [];
  return env.length ? env.map(Number) : DEFAULT_DEALS;
}

export function dealState(seed: number): GameState {
  const corpDecks = ALL_DECKS.filter(d => d.side === 'corp');
  const runnerDecks = ALL_DECKS.filter(d => d.side === 'runner');
  const p = Math.floor((seed - 1001) / 10);
  return createInitialGameState(deckGameSetup(seed, corpDecks[Math.floor(p / runnerDecks.length)], runnerDecks[p % runnerDecks.length]));
}

// The Corp's held line: in its memory since Stage B1 (corp/core.ts CorpMemory), a field before
const heldOf = (agent: Agent) => {
  const a = agent as unknown as { heldLine?: unknown; memory?: { heldLine?: unknown } };
  return { heldLine: structuredClone(a.memory?.heldLine ?? a.heldLine ?? null) };
};

/** A Corp agent that clears the caches, reports each decision and passes it on. */
function watchedCorp(src: string, inner: Agent, hooks: Hooks, counter: { i: number }): Agent {
  return {
    side: 'corp',
    chooseAction(state: GameState) {
      clearCaches();
      hooks.arm?.(inner, state, 'action');
      const before = heldOf(inner);
      const t = performance.now();
      const action = inner.chooseAction(state);
      const ms = performance.now() - t;
      hooks.decision?.({ src, i: counter.i++, kind: 'action', turn: state.turnNumber, state, action, ms, agent: inner, before });
      return action;
    },
    chooseRez(state: GameState, cards: CardInstance[]) {
      clearCaches();
      hooks.arm?.(inner, state, 'rez');
      const t = performance.now();
      const action = inner.chooseRez?.(state, cards) ?? null;
      const ms = performance.now() - t;
      hooks.decision?.({ src, i: counter.i++, kind: 'rez', turn: state.turnNumber, state, action, ms, agent: inner, cards });
      return action;
    },
  } as Agent;
}

function watchedRunner(inner: Agent): Agent {
  return {
    side: 'runner',
    chooseAction(state: GameState) {
      clearCaches();
      return inner.chooseAction(state);
    },
    chooseOffTurn(state: GameState) {
      clearCaches();
      return inner.chooseOffTurn?.(state) ?? null;
    },
  } as Agent;
}

/** Plays one local deal out, Normal v Normal, reporting every Corp decision. */
export function playDeal(seed: number, hooks: Hooks): GameState {
  valueLoops.clear();
  const src = `deal:${seed}`;
  const counter = { i: 0 };
  const game = new GameRunner(dealState(seed), { corp: watchedCorp(src, createAgent('corp', 'normal'), hooks, counter), runner: watchedRunner(createAgent('runner', 'normal')) });
  for (let n = 0; n < 4000 && game.step(); n++);
  hooks.dealEnd?.(src, game.state);
  return game.state;
}

export function humanFiles(): string[] {
  const dir = 'tests/fixtures/human-games';
  const want = (process.env.HUMAN ?? '').split(',').filter(Boolean);
  if (want.includes('none')) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .filter(f => !want.length || want.some(w => f.startsWith(w)))
    .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')))
    .map(f => join(dir, f));
}

/**
 * Replays one human game's recorded moves; at each state where the Corp acts, a fresh Normal Corp is asked (main phase
 * and prompts: chooseAction; the approach-ice and approach-server windows: chooseRez). The replay follows the recorded
 * moves, never the AI's answer.
 */
export function replayHuman(file: string, hooks: Hooks): void {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const src = `human:${file.split('/').pop()}`;
  if (!report.moves?.length) return;
  valueLoops.clear();
  let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  const counter = { i: 0 };
  for (const move of report.moves as GameAction[]) {
    const side = actingSide(s);
    const window = s.priority;
    const rezWindow = s.pendingPrompts.length === 0 && window && window.holder === 'corp' && s.activePlayer === 'runner' && (window.step === 'approach_ice' || window.step === 'approach_server');
    if (side === 'corp' && !s.winner) {
      const agent = watchedCorp(src, createAgent('corp', 'normal'), hooks, counter);
      try {
        if (rezWindow) {
          if (wantsStop({ ...s, stops: { corp: 'ai', runner: 'ai' } }, 'corp', window)) agent.chooseRez?.(s, rezCandidates(s, window.step as 'approach_ice' | 'approach_server'));
        } else if (!(window && window.holder === 'corp' && s.activePlayer === 'runner')) agent.chooseAction(s);
      } catch (e) {
        console.error(`${src} #${counter.i}: ${(e as Error).message}`);
      }
    }
    try {
      s = executeAction(s, move);
    } catch {
      // A fixture recorded on an older engine can stop replaying after a rules fix: the game is read up to here
      break;
    }
  }
}

/** Every recorded state: the deals, then the human games. SHARD=i/n takes every n-th source. */
export function forEachRecorded(hooks: Hooks): void {
  const [shard, shards] = (process.env.SHARD ?? '0/1').split('/').map(Number);
  const sources: (() => void)[] = [...deals().map(seed => () => void playDeal(seed, hooks)), ...humanFiles().map(f => () => replayHuman(f, hooks))];
  sources.forEach((run, k) => {
    if (k % shards === shard) run();
  });
}
