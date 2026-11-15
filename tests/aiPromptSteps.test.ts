import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import '../src/core';
import { getCardScript } from '../src/core/scripts';

/**
 * The AI answers some card prompts by card code and step name (src/ai/prompts.ts). Renaming a step in a
 * card script would drop the AI to its default answer with no error, so every pair it names must be a
 * step that card declares with prompts() (src/core/scripts/steps.ts). Cards not yet moved to prompts()
 * declare nothing and are skipped.
 */

const AI_PROMPTS = path.resolve(__dirname, '../src/ai/prompts.ts');

/** The (card code, step) pairs src/ai/prompts.ts compares against, read from its source. */
function aiStepPairs(source: string): { code: string; step: string; line: number }[] {
  const constants = new Map<string, string>();
  for (const m of source.matchAll(/const ([A-Z_]+) = '(\d{5})'/g)) constants.set(m[1], m[2]);
  const codesOn = (line: string): string[] => {
    if (!/cardCode|\bcode\b/.test(line)) return [];
    const literal = [...line.matchAll(/'(\d{5})'/g)].map(m => m[1]);
    const named = [...line.matchAll(/(?:cardCode|code) === ([A-Z_]+)/g)].flatMap(m => constants.get(m[1]) ?? []);
    return [...literal, ...named];
  };
  const pairs: { code: string; step: string; line: number }[] = [];
  let current: string[] = [];
  source.split('\n').forEach((line, i) => {
    // Several cards on one line, each with its own step: (cardCode === 'X' && prompt.source.step === 'y') || ...
    const direct = [...line.matchAll(/cardCode === '(\d{5})' && prompt\.source\.step === '([^']+)'/g)];
    if (direct.length > 1) {
      for (const m of direct) pairs.push({ code: m[1], step: m[2], line: i + 1 });
      return;
    }
    const codes = codesOn(line);
    // A branch for one card: the card code is on its `if` line, its step checks on that line or the next few
    if (codes.length > 0) current = codes;
    else if (/^ {2}(if|\/\/)/.test(line)) current = [];
    for (const m of line.matchAll(/source\.step === '([^']+)'/g)) for (const code of current) pairs.push({ code, step: m[1], line: i + 1 });
  });
  return pairs;
}

describe('AI prompt answers name real steps', () => {
  const pairs = aiStepPairs(fs.readFileSync(AI_PROMPTS, 'utf8'));

  it('finds the card and step pairs the AI answers (so the parse has not silently broken)', () => {
    expect(pairs.length).toBeGreaterThanOrEqual(25);
    expect(pairs).toContainEqual(expect.objectContaining({ code: '34050', step: 'type' }));
    expect(pairs).toContainEqual(expect.objectContaining({ code: '35055', step: 'hide' }));
  });

  it('every step the AI answers is one its card declares', () => {
    const wrong = pairs.filter(p => {
      const declared = getCardScript(p.code)?.promptSteps;
      return declared && !declared.includes(p.step);
    });
    expect(wrong.map(p => `src/ai/prompts.ts:${p.line} card ${p.code} step '${p.step}'`)).toEqual([]);
  });
});
