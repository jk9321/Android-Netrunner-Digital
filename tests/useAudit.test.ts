import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_CARDS, CardDefinition } from '../src/core';
import { isIcebreaker } from '../src/core/engine/ice';
import { CARD_PLANS } from '../src/ai/cardPlans';
import { CARDS } from '../src/ai/cards';

/**
 * The every-card USE audit (Jeff, 2026-11-05, thread "Find why AI card valuation misses cards").
 * tests/valueAudit.test.ts checks each card has a worth; this checks the cards whose effect
 * happens inside a run are also known to the logic that plays the run. A card missing here
 * gets a worth (so it is installed or held) but no run is ever priced with it: Maintenance
 * Access, S-Dobrado, Window of Opportunity and the bypass programs were all found that way.
 *
 * A new card that fails: teach the run logic (a `run` entry in its src/ai/cards/ file for its
 * rider, or a case in runs.ts / prompts.ts / runnerAI.ts / corpAI.ts that names its code),
 * or list it below with the reason it needs nothing. KNOWN_GAPS is the backlog of cards
 * still missing that logic: it may only shrink.
 */

/** Wording that makes a run. */
const MAKES_A_RUN = /\bRun (?:any|HQ|R&D|Archives|a |the )|make a run/i;
/** Wording whose effect happens during a run (bypass, derez, encounters, run-only credits). */
const IN_RUN = /bypass|derez|when you encounter|whenever you encounter|during (?:that|a|the|this) run|hosted credits during|when (?:that|the) run (?:begins|ends)|jack out|approach/i;

/** Cards that need no run logic, each with the reason. */
export const PRICED_ELSEWHERE: Record<string, string> = {
  '35025': 'Illumination: its installs after the run are priced by its card plan (cardPlans.ts)',
  '30050': 'Anoetic Void: the Corp rezzes upgrades in runs by what they do there (corpAI decideRez, upgradeValue); its code only appeared in the old rez table, deleted 2026-11-06',
  '35056': 'Mitra Aman: rezzed by its worth once rezzed (corpAI rezScore, rezzedWorth); its code only appeared in the old rez table, deleted 2026-11-06',
};

/** Cards that still need run logic (the backlog, 2026-11-05). Remove a card once it has it; never add one. */
const KNOWN_GAPS: Record<string, string> = {
  '36019': 'Beta Build: the program it installs goes back to the stack when the run ends, but the board prices it as kept',
  '30058': 'AMAZE Amusements: tags when an agenda is stolen from its server',
  '35019': 'Maglectric Rapid: derez a Corp card after an HQ run',
  '36021': 'Touchstone: its run ability',
  '36033': 'realloc(): its run timing',
  '36065': 'Shackleton Grid: its effect on runs',
  '34013': 'Capybara: derez a bypassed ice',
  '34017': 'Saci: credits when its host is rezzed or derezzed',
  '34022': 'AirbladeX: its run use',
  '34025': 'Pichação: its run use',
  '34032': 'Stegodon MK IV: its run effect',
  '34065': 'B-1001: its run effect',
  '34079': 'Jeitinho: runs on all three centrals',
  '34083': 'Amelia Earhart: its run effect',
  '34104': 'Brasília Government Grid: its effect on runs',
};

const files = readdirSync('src/ai').filter(f => f.endsWith('.ts'));
const read = (list: string[]) => list.map(f => readFileSync(`src/ai/${f}`, 'utf8')).join('\n');
/** The decision logic each side's cards can be named in: a Runner card only the Corp AI names (Conduit) is not played by the Runner AI. */
const logic = { runner: read(files.filter(f => f !== 'corpAI.ts')), corp: read(files.filter(f => f !== 'runnerAI.ts')) };
/** The card's code is named by its own side's decision logic (not just its own entry in src/ai/cards/). */
const named = (def: CardDefinition) => logic[def.side_code as 'corp' | 'runner'].includes(`'${def.code}'`);
/** The card says what it adds to the run it starts: its `run` entry in src/ai/cards/ (a plain run says so with `run: () => ({})`). */
const hasRider = (def: CardDefinition) => !!CARDS[def.code]?.run;

function uncovered(def: CardDefinition): string | null {
  const text = def.stripped_text ?? '';
  if (['ice', 'identity'].includes(def.type_code)) return null; // ice: subroutine costs (aiSubroutines test); identities: later
  if (def.side_code === 'runner' && isIcebreaker({ cardCode: def.code } as never)) return null; // breakers: bestBreakPlan
  if (PRICED_ELSEWHERE[def.code]) return null;
  if (def.side_code === 'runner' && MAKES_A_RUN.test(text) && !hasRider(def) && !CARD_PLANS[def.code] && !named(def)) return 'makes a run, priced as a plain run';
  if (IN_RUN.test(text) && !named(def) && !hasRider(def)) return 'acts during runs, no run logic names it';
  return null;
}

describe('every-card use audit (Jeff, 2026-11-05)', () => {
  it('every card that makes a run or acts in one is known to the run logic', () => {
    const missing = ALL_CARDS.filter(def => uncovered(def) && !KNOWN_GAPS[def.code]).map(def => `${def.code} ${def.title}: ${uncovered(def)}`);
    expect(missing).toEqual([]);
  });

  it('the backlog only lists cards still missing run logic (remove fixed ones)', () => {
    const fixed = Object.keys(KNOWN_GAPS).filter(code => {
      const def = ALL_CARDS.find(d => d.code === code);
      return !def || !uncovered(def);
    });
    expect(fixed).toEqual([]);
  });
});
