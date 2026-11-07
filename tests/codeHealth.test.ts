import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tuning } from '../src/ai/synergy';

/**
 * Guards from the AI code audit (2026-11-05, thread "Audit AI code for overlaps and conflicts", cleanup item 1).
 * Both lists below may only shrink: a new entry means new card data or a new dead switch, which the audit is
 * there to stop.
 */

/**
 * The shared value files price kinds of things, not cards: a card's own worth goes in its entry in
 * src/ai/cards/ (the Nov 3 refactor). These are the card codes still named in them, each waiting for a home.
 */
const VALUE_FILES = ['valueModel', 'evaluate', 'effectValues', 'counterValues', 'handValues', 'iceValues'];
const CODES_IN_VALUE_FILES: Record<string, string> = {
  'evaluate:35028': 'Madani: to its card entry',
  'evaluate:30053': 'Spin Doctor (spent): to its card entry',
  'evaluate:36009': 'Vic: an identity, fine for now',
  'effectValues:35076': 'Syailendra: a placed-counter field in CardAI',
  'effectValues:30045': 'Urtica Cipher: a placed-counter field in CardAI',
  'effectValues:35061': 'Idiosyncresis: a placed-counter field in CardAI',
  'effectValues:30061': 'Clearinghouse: a placed-counter field in CardAI',
  'counterValues:30033': 'Smartware Distributor: the step-1 rate when counterEffects is off (tested)',
  'counterValues:30007': 'Fermenter: the step-1 rate when counterEffects is off (tested)',
};

/** Plan switches that are off, each with why it stays in the code. */
const OFF_SWITCHES: Record<string, string> = {
  rigEffects: 'experiment, off until a batch says so',
  icePosition: "Jeff's ice-at-its-position model (Scatter Field); lost its batch, kept with its test for re-testing",
  'clickByPlay.corp': 'Corp side lost its batch; kept for re-testing',
  runCreditsSlide: 'breaks castWhileAble; retest once Runner income has one slide helper (cleanup item 4)',
  'handByCard.corp': 'used by the planner leaf; off in the rule ranking, kept for re-testing',
  'handByCard.runner': 'used by the planner leaf; off in the rule ranking, kept for re-testing',
  oneCurrency: 'missed its paired batch (stop rule, 2026-11-07); kept switchable for the next round',
  rdTurnsLeft: 'missed its paired batch (2026-11-07: decked 186 vs 173); the honest clock, kept for when urgency is priced by points',
  threatModel: 'structural review item 3; missed its paired batch (-11.0 ± 1.2, 2026-11-07), merged off so items 4-6 batch both ways',
};

describe('AI code health (audit guards)', () => {
  it('names no new card codes in the shared value files', () => {
    const found = VALUE_FILES.flatMap(file =>
      [...readFileSync(new URL(`../src/ai/${file}.ts`, import.meta.url), 'utf8').matchAll(/'(3\d{4})'/g)].map(m => `${file}:${m[1]}`),
    );
    const unlisted = found.filter(key => !(key in CODES_IN_VALUE_FILES));
    expect(unlisted, 'move the card logic to its entry in src/ai/cards/').toEqual([]);
    // A listed code that's gone: take it off the list
    expect(Object.keys(CODES_IN_VALUE_FILES).filter(key => !found.includes(key))).toEqual([]);
  });

  it('has no off switch without a reason', () => {
    const off = Object.entries(tuning.plan).flatMap(([name, value]) =>
      value === false ? [name] : value && typeof value === 'object' ? Object.entries(value).filter(([, v]) => v === false).map(([side]) => `${name}.${side}`) : [],
    );
    expect(off.filter(name => !(name in OFF_SWITCHES)), 'an off switch: delete its path, or give the reason here').toEqual([]);
    expect(Object.keys(OFF_SWITCHES).filter(name => !off.includes(name))).toEqual([]);
  });
});
