import { describe, expect, it } from 'vitest';
import '../src/core';
import { createCardInstance } from '../src/core';
import { EffectSource } from '../src/core/types/prompts';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getCardScript, scriptedCardCodes } from '../src/core/scripts';
import { cards, choice, declaredSteps, prompts } from '../src/core/scripts/steps';
import { EffectContext } from '../src/core/scripts/types';
import { newGame } from './helpers';

/** Typed card prompts (src/core/scripts/steps.ts): the dispatcher, and what the compiler rejects. */

function ctxFor(): EffectContext {
  const state = newGame();
  const card = createCardInstance(state, '30075');
  return { state, card, side: 'corp' };
}
const src = (ctx: EffectContext, step: string, data?: EffectSource['data']): EffectSource => ({ cardCode: ctx.card.cardCode, instanceId: ctx.card.instanceId, step, data });

describe('prompts()', () => {
  it('sends each answer to its step, with that step\'s data', () => {
    const seen: string[] = [];
    const flow = prompts({
      pick: cards((_ctx, a) => seen.push(`pick ${a.ids.join(',')}`)),
      server: choice<{ cardId: string }>((_ctx, a, d) => seen.push(`server ${a.optionId} ${d.cardId}`)),
    });
    const ctx = ctxFor();
    flow.script.onPromptAnswer(ctx, src(ctx, 'pick'), { kind: 'effect_cards', cardInstanceIds: ['a', 'b'] });
    flow.script.onPromptAnswer(ctx, src(ctx, 'server', { cardId: 'c' }), { kind: 'effect_choice', optionId: 'new' });
    expect(seen).toEqual(['pick a,b', 'server new c']);
    expect(flow.script.promptSteps).toEqual(['pick', 'server']);
  });

  it('gives a cards step no cards when the player declined a question asked though nothing qualified (rules 4.2.2, 4.6.3)', () => {
    let ids: string[] | undefined;
    const flow = prompts({ pick: cards((_ctx, a) => (ids = a.ids)) });
    const ctx = ctxFor();
    flow.script.onPromptAnswer(ctx, src(ctx, 'pick'), { kind: 'effect_choice', optionId: 'no' });
    expect(ids).toEqual([]);
  });

  it('throws on a step the card does not declare, instead of passing it as a decline', () => {
    const flow = prompts({ pick: cards(() => undefined) });
    const ctx = ctxFor();
    expect(() => flow.script.onPromptAnswer(ctx, src(ctx, 'pik'), { kind: 'effect_cards', cardInstanceIds: [] })).toThrow(/no step 'pik'/);
  });

  it('throws on an answer of the wrong kind', () => {
    const flow = prompts({ pick: cards(() => undefined), mode: choice(() => undefined) });
    const ctx = ctxFor();
    expect(() => flow.script.onPromptAnswer(ctx, src(ctx, 'mode'), { kind: 'effect_cards', cardInstanceIds: [] })).toThrow(/choice step/);
    expect(() => flow.script.onPromptAnswer(ctx, src(ctx, 'pick'), { kind: 'effect_choice', optionId: 'yes' })).toThrow(/cards step/);
  });

  it('asks under the step it names, with the step data stored as plain JSON', () => {
    const flow = prompts({ server: choice<{ cardId: string }>(() => undefined) });
    const ctx = ctxFor();
    flow.choice(ctx, 'server', { side: 'corp', message: 'Where?', options: [{ id: 'new', label: 'New remote' }] }, { cardId: 'x' });
    const p = ctx.state.pendingPrompts.at(-1)!;
    expect(p.kind === 'effect_choice' && p.source).toEqual({ cardCode: '30075', instanceId: ctx.card.instanceId, step: 'server', data: { cardId: 'x' } });
  });

  // Never called: these lines are checked by `npm run typecheck`, which fails if any @ts-expect-error has no error under it.
  function compileTimeChecks(ctx: EffectContext) {
    const flow = prompts({
      pick: cards(() => undefined),
      server: choice<{ cardId: string }>(() => undefined),
    });
    const q = { side: 'corp' as const, message: '', candidateIds: [], min: 0, max: 1 };
    const o = { side: 'corp' as const, message: '', options: [] };
    flow.cards(ctx, 'pick', q);
    flow.choice(ctx, 'server', o, { cardId: 'a' });
    // @ts-expect-error a step the card never declared
    flow.cards(ctx, 'pik', q);
    // @ts-expect-error a choice step asked as a card pick
    flow.cards(ctx, 'server', q, { cardId: 'a' });
    // @ts-expect-error the step's data left out
    flow.choice(ctx, 'server', o);
    // @ts-expect-error the step's data of the wrong type
    flow.choice(ctx, 'server', o, { cardId: 1 });
    // @ts-expect-error data a step doesn't carry
    flow.cards(ctx, 'pick', q, { cardId: 'a' });
  }
  void compileTimeChecks;
});

/** The card script files: everything under src/core/scripts but the prompt machinery and the registry. */
const MACHINERY = new Set(['steps.ts', 'effects.ts', 'types.ts', 'index.ts']);
function cardScriptFiles(dir = 'src/core/scripts'): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cardScriptFiles(path);
    return name.endsWith('.ts') && !(dir === 'src/core/scripts' && MACHINERY.has(name)) ? [path] : [];
  });
}

describe('every card uses prompts()', () => {
  it('declares its steps: no card answers its prompts with a hand-written onPromptAnswer', () => {
    const handWritten = scriptedCardCodes().filter(code => getCardScript(code)?.onPromptAnswer && !declaredSteps(getCardScript(code)));
    expect(handWritten).toEqual([]);
  });

  // Audit 2026-11-15 TEST-STEPS-RAW-ASK: the compiler checks only questions asked through a Flow, so a card file that
  // calls a step-string helper itself could ask an undeclared step and fail only at run time. Phase 3 audit
  // TEST-STEPS-GUARD-GAPS: checked by what a card file imports, so an alias (import { askChoice as ask }) or a
  // namespace import (E.askChoice) is caught too, as are source() and pushPrompt(), which build a prompt by hand.
  it('asks only through its flow: no card file imports a helper that takes a step string', () => {
    const RAW_ASKS = new Set(['askCards', 'askChoice', 'askRunnerInstall', 'askCorpInstall', 'arrangeTop', 'arrangeNext', 'askEvenIfNone', 'installRunnerChoice', 'playPsiGame', 'source', 'pushPrompt']);
    const found = cardScriptFiles().flatMap(file => {
      const text = readFileSync(file, 'utf8');
      // import or re-export, single or double quotes, with or without a default import beside the names
      const clauses = [...text.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:\w+\s*,\s*)?(\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s*from\s*['"]([^'"]+)['"]/g)];
      const named = clauses.flatMap(([, what, from]) =>
        what.startsWith('*')
          ? [`${file}: imports * from '${from}'`]
          : what
              .slice(1, -1)
              .split(',')
              .map(n => n.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])
              .filter(n => RAW_ASKS.has(n))
              .map(n => `${file}: imports ${n} from '${from}'`),
      );
      const handWritten = text.split('\n').flatMap((line, i) => (/\bonPromptAnswer\b/.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : []));
      return [...named, ...handWritten];
    });
    expect(found, 'ask through the card\'s flow (flow.cards / choice / ask / runnerInstall / corpInstall / arrangeTop / evenIfNone / psiGame)').toEqual([]);
  });
});
