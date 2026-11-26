import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { GameAction, GameState, actingSide, createInitialGameState, isLegalAction } from '../src/core';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { answerPrompt } from '../src/ai/prompts';
import { guessRunnerView, runnerUnknownSlots } from '../src/ai/runnerReply';
import { decisionSeedFor, runnerDecisionView } from '../src/ai/turnPlanner';
import { withPricing } from '../src/ai/pricing';
import { asSide } from '../src/ai/synergy';
import { decisionContext } from '../src/ai/handValues';
import * as prompt from '../src/ai/runner/prompt';
import { deckGameSetup } from '../src/data/decks';
import { ALL_DECKS } from '../scripts/nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../scripts/nrdb-test-decks';

// Counts the deciding Runner's honest answers, so a Corp decision can be shown to build none (Corp side condition 2)
const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock('../src/ai/runner/prompt', async importOriginal => {
  const real = await importOriginal<typeof import('../src/ai/runner/prompt')>();
  return {
    ...real,
    honestPromptAnswer: (...args: Parameters<typeof real.honestPromptAnswer>) => {
      calls.n++;
      return real.honestPromptAnswer(...args);
    },
  };
});

/**
 * B3 commit 2 (brief runner-rework/briefs/b3-prompt-view.md rev 2, bar 3): the deciding Normal Runner answers its prompts
 * on the honest view (src/ai/runner/prompt.ts), one board per prompt kind step 0.2 found answered on the real state
 * (tests/fixtures/runner-prompt-view, saved by scripts/runner-rework/b3/prompt-fixtures.ts). Rule 10.2.2a: the Runner
 * sees what its prompt shows face up, and no more.
 */
interface Fixture {
  source: string;
  played: GameAction;
  memory: [string, string][];
  state: GameState;
}
const KINDS = ['muslihat-top', 'tao-swap', 'tao-swap-access', 'topan-host', 'scrounge-host', 'magdalene-host', 'hermes-bounce', 'hermes-bounce-access', 'cataloguer-arrange', 'burner-where'];
const TODAY = { 'bahia-host-run': 'host', 'muse-install': 'fetch' } as const;
const path = (k: string) => new URL(k.startsWith('deal-') ? `./fixtures/runner-pins/${k}.json` : `./fixtures/runner-prompt-view/${k}.json`, import.meta.url);
const load = (k: string): Fixture => JSON.parse(readFileSync(path(k), 'utf8'));

/** The ports runnerAI.ts promptAnswer hands runner/prompt.ts, for a fresh Normal Runner holding `memory`. */
function portsOf(s: GameState, memory: [string, string][]): prompt.PromptViewPorts {
  const runner = createAgent('runner', 'normal') as unknown as { memory: Map<string, string>; synergy: boolean };
  const mem = new Map(memory);
  runner.memory = mem;
  return { view: runnerDecisionView(s, mem), slots: x => runnerUnknownSlots(x, mem), memory: mem, synergy: runner.synergy, answer: x => answerPrompt(x, 'runner', mem, runner.synergy) };
}
const answerOf = (s: GameState, memory: [string, string][]) => JSON.stringify(prompt.honestPromptAnswer(s, portsOf(s, memory)));

/**
 * The answer on 12 other deals of the same knowledge (runnerReply.ts guessRunnerView samples 4096..4107, as step 0.2
 * read them), counted by answer.
 */
function onTwelveDeals(fx: Fixture): Record<string, number> {
  const s = fx.state;
  return asSide('runner', () => {
    decisionContext(s, 'runner');
    const out: Record<string, number> = {};
    for (let k = 4096; k < 4108; k++) {
      const view = withPricing({ decisionSeed: decisionSeedFor(s, 'runner') }, () => guessRunnerView(s, k, new Map(fx.memory)));
      const a = JSON.stringify(prompt.honestPromptAnswer(s, { ...portsOf(s, fx.memory), view }).action);
      out[a] = (out[a] ?? 0) + 1;
    }
    return out;
  });
}

/**
 * The board with what the Runner can't see moved: two Corp cards it doesn't know and the prompt doesn't show swap codes
 * (the options' own cards first), and the stack's cards the prompt neither shows nor keeps in place are reversed.
 */
function hiddenMoved(fx: Fixture): GameState {
  const b = structuredClone(fx.state);
  const shown = new Set([...prompt.promptShownIds(fx.state), ...prompt.promptInPlaceIds(fx.state)]);
  const slots = runnerUnknownSlots(b, new Map(fx.memory));
  const named = JSON.stringify(b.pendingPrompts[0]);
  const hidden = [...slots.ice, ...slots.root, ...slots.loose].filter(c => !shown.has(c.instanceId)).sort((x, y) => Number(named.includes(`"${y.instanceId}"`)) - Number(named.includes(`"${x.instanceId}"`)));
  const x = hidden[0];
  const y = x && hidden.find(c => c.cardCode !== x.cardCode && (slots.ice.includes(c) === slots.ice.includes(x)));
  if (x && y) [x.cardCode, y.cardCode] = [y.cardCode, x.cardCode];
  const free = b.runner.stack.map((_, i) => i).filter(i => !shown.has(b.runner.stack[i].instanceId));
  const cards = free.map(i => b.runner.stack[i]).reverse();
  free.forEach((i, k) => (b.runner.stack[i] = cards[k]));
  return b;
}

describe('the Runner answers its prompts on the honest view (B3 commit 2)', () => {
  for (const kind of KINDS) {
    describe(kind, () => {
      const fx = existsSync(path(kind)) ? load(kind) : null;
      it('is a board of its kind', () => {
        expect(fx, `fixture ${kind}`).not.toBeNull();
        expect(prompt.todayPathKind(fx!.state)).toBeNull();
      });
      it("keeps real exactly the cards the engine shows face up and the entry's in-place ones (the classes)", () => {
        const { view, kept, unkept } = prompt.honestPromptView(fx!.state, portsOf(fx!.state, fx!.memory));
        const slots = runnerUnknownSlots(fx!.state, new Map(fx!.memory));
        const hiddenOrStack = new Set([...slots.ice, ...slots.root, ...slots.loose, ...fx!.state.runner.stack].map(c => c.instanceId));
        const want = [...prompt.promptShownIds(fx!.state), ...prompt.promptInPlaceIds(fx!.state)].filter(id => hiddenOrStack.has(id));
        expect(unkept).toEqual([]);
        expect([...kept].sort()).toEqual([...new Set(want)].sort());
        const code = (s: GameState, id: string) => JSON.stringify(s).match(new RegExp(`"instanceId":"${id}","cardCode":"(\\d+)"`))?.[1];
        for (const id of kept) expect(code(view, id), id).toBe(code(fx!.state, id));
        for (const id of prompt.promptInPlaceIds(fx!.state)) expect(view.runner.stack.findIndex(c => c.instanceId === id)).toBe(fx!.state.runner.stack.findIndex(c => c.instanceId === id));
      });
      it('answers on the view, legal on the real state, and the same when what the Runner cannot see moves', () => {
        const ans = prompt.honestPromptAnswer(fx!.state, portsOf(fx!.state, fx!.memory));
        expect(ans.path).toBe('view');
        expect(isLegalAction(fx!.state, ans.action)).toBe(true);
        const moved = hiddenMoved(fx!);
        expect(JSON.stringify(moved), 'something hidden moved').not.toBe(JSON.stringify(fx!.state));
        expect(answerOf(moved, fx!.memory)).toBe(answerOf(fx!.state, fx!.memory));
      });
      it('gives the same answer on 12 other deals of the same knowledge', () => {
        expect(Object.values(onTwelveDeals(fx!))).toEqual([12]);
      });
    });
  }

  // Bar 3: the D2 Topan pin's board (tests/runnerPins.test.ts) answers Funhouse, inst-36, on every deal of the same knowledge
  it('D2 Topan host (deal 1581 T4) names its host, the same on 12 deals', () => {
    const fx = load('deal-1581-t4-topan-host');
    expect(onTwelveDeals(fx)).toEqual({ [JSON.stringify(prompt.honestPromptAnswer(fx.state, portsOf(fx.state, fx.memory)).action)]: 12 });
    expect(prompt.honestPromptAnswer(fx.state, portsOf(fx.state, fx.memory)).action).toMatchObject({ choice: { kind: 'effect_choice', optionId: 'inst-36' } });
  });

  it("MuslihaT's top card is the in-place class (its entry's promptShows)", () => {
    const fx = load('muslihat-top');
    expect(prompt.promptInPlaceIds(fx.state).size).toBe(1);
    expect([...prompt.promptInPlaceIds(fx.state)][0]).toBe(fx.state.runner.stack[0].instanceId);
  });

  for (const [kind, why] of Object.entries(TODAY)) {
    it(`${kind} keeps today's path ('${why}')`, () => {
      expect(existsSync(path(kind)), `fixture ${kind}`).toBe(true);
      const fx = load(kind);
      expect(prompt.todayPathKind(fx.state)).toBe(why);
      expect(prompt.honestPromptAnswer(fx.state, portsOf(fx.state, fx.memory)).path).toBe('today');
    });
  }

  it('a Corp decision never builds the honest view (Corp side condition 2)', { timeout: 120_000 }, () => {
    const fx = load('muslihat-top');
    const [, record, seed] = fx.source.match(/^\w+ base (\d+) deal (\d+)/)!;
    const deals: { seed: number; corpDeck: string; runnerDeck: string }[] = JSON.parse(readFileSync(new URL(`../scripts/runner-rework/b3/deals-${record}.json`, import.meta.url), 'utf8'));
    const d = deals.find(x => x.seed === Number(seed))!;
    const decks = [...ALL_DECKS, ...NRDB_TEST_DECKS];
    const corp = decks.find(x => x.side === 'corp' && x.name === d.corpDeck)!;
    const runner = decks.find(x => x.side === 'runner' && x.name === d.runnerDeck)!;
    const g = new GameRunner(createInitialGameState(deckGameSetup(d.seed, corp, runner)), { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
    let corpDecisions = 0;
    let runnerAnswers = 0;
    for (let i = 0; i < 2000 && !g.state.winner && g.state.turnNumber <= fx.state.turnNumber; i++) {
      const side = actingSide(g.state);
      const before = calls.n;
      if (!g.step()) break;
      if (side === 'corp') {
        corpDecisions++;
        expect(calls.n, `Corp decision at step ${i}`).toBe(before);
      } else runnerAnswers += calls.n - before;
    }
    expect(corpDecisions).toBeGreaterThan(10);
    expect(runnerAnswers).toBeGreaterThan(0);
  });
});
