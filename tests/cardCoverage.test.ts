import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import '../src/core';
import { ALL_CARDS } from '../src/core/cards';
import { getCardScript, mergeScriptGroups, scriptedCardCodes } from '../src/core/scripts';

/**
 * New-set guards: every card the game ships has a script and is named in a test, and no card is
 * scripted twice. A new set fails here until each of its cards is done (new-set process step 3).
 */

/** Cards that need no script: the starter identities have no abilities ("Starter game only."). */
const NEEDS_NO_SCRIPT = new Set(['30076', '30077']);

/**
 * Tests that name cards without testing their rules: AI values and plans, deck lists, live values. A card named
 * only there has no rules test (audit 2026-11-15 TEST-COVERAGE-MENTION), so they don't count.
 */
const NOT_RULES_TESTS = /^ai|AI\.test|Values\.test|^(betaDefault|custom|sample)Decks|^decks?(Import|Playability|Prefs)?\.test|^(planner|pricing|synergy|threat|rootDeckAverage)/;

function testFilesText(dir: string): string {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) {
        // Recorded games name every card they saw; they don't test any of them
        if (f !== 'fixtures') walk(p);
      } else if (/\.tsx?$/.test(f) && f !== 'cardCoverage.test.ts' && !NOT_RULES_TESTS.test(f)) out.push(fs.readFileSync(p, 'utf8'));
    }
  };
  walk(dir);
  return out.join('\n');
}

describe('card coverage', () => {
  it('every card has a script, except those listed as needing none', () => {
    const scripted = new Set(scriptedCardCodes());
    const missing = ALL_CARDS.filter(c => !scripted.has(c.code) && !NEEDS_NO_SCRIPT.has(c.code)).map(c => `${c.code} ${c.title}`);
    expect(missing).toEqual([]);
  });

  it('no card is still a set scaffold stub (scripts/new-set.ts)', () => {
    const stubs = ALL_CARDS.filter(c => getCardScript(c.code)?.unfinished).map(c => `${c.code} ${c.title}`);
    expect(stubs).toEqual([]);
  });

  it('the cards listed as needing no script really have no text to script', () => {
    for (const code of NEEDS_NO_SCRIPT) {
      const card = ALL_CARDS.find(c => c.code === code);
      expect(card?.text).toBe('Starter game only.');
    }
  });

  it('every card is named by its code in at least one rules test', () => {
    const text = testFilesText(path.resolve(__dirname));
    const untested = ALL_CARDS.filter(c => !NEEDS_NO_SCRIPT.has(c.code) && !text.includes(`'${c.code}'`) && !text.includes(`"${c.code}"`));
    expect(untested.map(c => `${c.code} ${c.title}`)).toEqual([]);
  });

  it('a card scripted in two files is an error, not a silent override', () => {
    const script = {};
    expect(() => mergeScriptGroups({ a: { '99001': script }, b: { '99001': script } })).toThrow(/99001.*a.*b/);
    expect(Object.keys(mergeScriptGroups({ a: { '99001': script }, b: { '99002': script } }))).toEqual(['99001', '99002']);
  });
});
