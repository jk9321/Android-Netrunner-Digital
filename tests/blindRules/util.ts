// Shared drivers for the blind rules tests (tests/blindRules/README.md).
// They only use the engine's public API and tests/helpers.ts.
import { executeAction, GameState, Prompt, PromptChoice } from '../../src/core';
import { step } from '../helpers';

export type Handler = (p: Prompt, s: GameState) => PromptChoice | undefined;

/** The answer a test takes when it does not care: no trash, root first, the fewest cards. */
export function defaultChoice(p: Prompt): PromptChoice {
  switch (p.kind) {
    case 'access_trash':
      return { kind: 'access_trash', trash: false };
    case 'access_order':
      return { kind: 'access_order', optionId: p.options[0].id };
    case 'effect_cards':
      return { kind: 'effect_cards', cardInstanceIds: p.candidateIds.slice(0, p.min) };
    case 'discard':
      return { kind: 'discard', cardInstanceIds: [] };
    case 'effect_choice': {
      // An optional effect the test does not care about: decline it.
      const no = p.options.find(o => o.id === 'no');
      if (no) return { kind: 'effect_choice', optionId: no.id };
      break;
    }
  }
  throw new Error(`Unhandled prompt ${p.kind}: ${p.message} ${JSON.stringify((p as { options?: unknown }).options ?? '')}`);
}

export function answerPrompt(s: GameState, choice: PromptChoice): GameState {
  const p = s.pendingPrompts[0];
  if (!p) throw new Error('No prompt pending');
  return executeAction(s, { type: 'RESOLVE_PROMPT', player: p.side, promptId: p.id, choice });
}

/** Picks the option of an effect_choice prompt whose id or label matches. */
export function pick(p: Prompt, re: RegExp): PromptChoice {
  if (p.kind !== 'effect_choice') throw new Error(`Expected effect_choice, got ${p.kind}: ${p.message}`);
  const o = p.options.find(o => re.test(o.id) || re.test(o.label));
  if (!o) throw new Error(`No option matching ${re} in ${JSON.stringify(p.options)} (${p.message})`);
  return { kind: 'effect_choice', optionId: o.id };
}

/**
 * Plays the run in progress out to its end: the Runner breaks nothing and
 * keeps going, prompts are answered by `handle` (or defaultChoice).
 * Stops early when `until` holds.
 */
export function drive(s: GameState, handle: Handler = () => undefined, until?: (s: GameState) => boolean): GameState {
  for (let i = 0; i < 200; i++) {
    if (until?.(s)) return s;
    const p = s.pendingPrompts[0];
    if (p) {
      s = answerPrompt(s, handle(p, s) ?? defaultChoice(p));
      continue;
    }
    if (!s.activeRun) return s;
    const before = s;
    s = step(s);
    if (s === before) throw new Error(`Run stuck in phase ${s.activeRun?.phase}`);
  }
  throw new Error('drive: too many steps');
}

/** Titles of the cards the Runner accessed since log index `from`. */
export function accessedSince(s: GameState, from: number): string[] {
  return s.log.slice(from).filter(l => l.event === 'access').map(l => l.message.replace(/^Runner accessed (.*)\.$/, '$1'));
}

/** Chooses one card on an effect_cards prompt, or the option naming it on an effect_choice prompt. */
export function chooseCard(p: Prompt, instanceId: string): PromptChoice {
  if (p.kind === 'effect_cards') return { kind: 'effect_cards', cardInstanceIds: [instanceId] };
  if (p.kind === 'effect_choice') {
    const o = p.options.find(o => o.id.includes(instanceId));
    if (!o) throw new Error(`No option for ${instanceId} in ${JSON.stringify(p.options)} (${p.message})`);
    return { kind: 'effect_choice', optionId: o.id };
  }
  throw new Error(`Cannot choose a card on a ${p.kind} prompt`);
}
