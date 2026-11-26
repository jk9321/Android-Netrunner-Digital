import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import '../src/core';
import { getCardScript, scriptedCardCodes } from '../src/core/scripts';

/**
 * The AI answers some card prompts by card code and step name (src/ai/prompts.ts). Renaming a step in a
 * card script would drop the AI to its default answer with no error, so every pair it names must be a
 * step that card declares with prompts() (src/core/scripts/steps.ts). Every card declares its steps now
 * (tests/steps.test.ts), so a card that declares none fails here too.
 */

const AI_PROMPTS = path.resolve(__dirname, '../src/ai/prompts.ts');
/** B3 commit 1: the Runner's per-card answers live in the card entries (`promptAnswer`), so their steps are read there. */
const CARD_DIR = path.resolve(__dirname, '../src/ai/cards');
const CARD_FILES = fs.readdirSync(CARD_DIR).filter(f => f.endsWith('.ts')).map(f => path.join(CARD_DIR, f));

/** The (card code, step) pairs an entry's promptAnswer compares against: each step check inside a `'<code>': {` entry. */
function entryStepPairs(file: string): { code: string; step: string; line: number; file: string }[] {
  const pairs: { code: string; step: string; line: number; file: string }[] = [];
  let code: string | null = null;
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const open = line.match(/^ {2}'(\d{5})': \{/);
    if (open) code = open[1];
    else if (/^\S/.test(line)) code = null;
    if (code) for (const m of line.matchAll(/source\.step [!=]== '([^']+)'/g)) pairs.push({ code, step: m[1], line: i + 1, file: path.basename(file) });
  });
  return pairs;
}

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
  const pairs = [...aiStepPairs(fs.readFileSync(AI_PROMPTS, 'utf8')).map(p => ({ ...p, file: 'prompts.ts' })), ...CARD_FILES.flatMap(entryStepPairs)];

  it('finds the card and step pairs the AI answers (so the parse has not silently broken)', () => {
    expect(pairs.length).toBeGreaterThanOrEqual(25);
    expect(pairs).toContainEqual(expect.objectContaining({ code: '34050', step: 'type' }));
    expect(pairs).toContainEqual(expect.objectContaining({ code: '35055', step: 'hide' }));
    // an entry's answer (B3 commit 1)
    expect(pairs).toContainEqual(expect.objectContaining({ code: '36014', step: 'breach', file: 'vantagePoint.ts' }));
  });

  it('every step the AI answers is one its card declares', () => {
    const wrong = pairs.filter(p => {
      const declared = getCardScript(p.code)?.promptSteps;
      return !declared?.includes(p.step);
    });
    expect(wrong.map(p => `src/ai/${p.file === 'prompts.ts' ? '' : 'cards/'}${p.file}:${p.line} card ${p.code} step '${p.step}'`)).toEqual([]);
  });

  // Audit 2026-11-15 TEST-AISTEP-GENERIC: some steps the AI reads by name alone, for any card ('prevent_damage',
  // 'bypass'); a step no card declares any more would drop those answers to the default with no error.
  it('every step the AI reads by name is declared by at least one card', () => {
    const source = [AI_PROMPTS, ...CARD_FILES].map(f => fs.readFileSync(f, 'utf8')).join('\n');
    const named = new Set([...source.matchAll(/source\.step [!=]== '([^']+)'/g)].map(m => m[1]));
    expect(named).toContain('prevent_damage');
    expect(named).toContain('bypass');
    const declared = new Set(scriptedCardCodes().flatMap(code => getCardScript(code)?.promptSteps ?? []));
    expect([...named].filter(step => !declared.has(step))).toEqual([]);
  });
});
