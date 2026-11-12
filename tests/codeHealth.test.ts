import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sideOff, tuning } from '../src/ai/synergy';

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
  // TEMPORARY ice-redirect arms (folded or deleted at hand-off)
  iceRedirectMoney: 'ice redirect arm being measured: only when the Corp keeps the holding rez',
  iceRedirectNarrow: 'ice redirect arm being measured: skip only a held line\'s own ice',
  iceRedirectRoot: 'ice redirect arm being measured: keep the first ice on a server with a root card',
  rigEffects: 'experiment, off until a batch says so',
  icePosition: "Jeff's ice-at-its-position model (Scatter Field); lost its batch, kept with its test for re-testing",
  'clickByPlay.corp': 'Corp side lost its batch; kept for re-testing',
  runCreditsSlide: 'breaks castWhileAble; retest once Runner income has one slide helper (cleanup item 4)',
  'handByCard.corp': 'used by the planner leaf; off in the rule ranking, kept for re-testing',
  'handByCard.runner': 'used by the planner leaf; off in the rule ranking, kept for re-testing',
  // Turning it on needs plan.pettyCashFirst kept on: with oneCurrency on and pettyCashFirst off, the plannerSearch
  // Corp clicks for a credit over Petty Cash (item 4 hand-off, 2026-11-07)
  oneCurrency: 'missed its paired batch (stop rule, 2026-11-07); kept switchable for the next round',
  rdTurnsLeft: 'missed its paired batch (2026-11-07: decked 186 vs 173); the honest clock, kept for when urgency is priced by points',
  // Tuning pass 1 (2026-11-08, review-1 R4): measured reasons, paired vs base run 42403086049
  replyContenders: 'install-worth probe P2: extra reply samples for the top two; -0.6 ± 2.2 (run 42498949422) for +19% time',
  oneAgendaGuess: 'Runner-view consistency (runs.ts remoteAgendaOdds in corpBoardValue); -0.6 ± 0.7 alone (run 42403914400); carried broke +1.3 ± 1.0 alone and the set\'s +4.0 ± 2.0 (run 42463624862); +7% time; on when a human hole needs it',
  hqHeld: 'tuning pass 1: carried the decking bundle\'s broke +5.7 ± 2.4 (run 42403919890, with unseenOdds); not re-tried apart',
  unseenOdds: 'tuning pass 1: carried the decking bundle\'s broke +5.7 ± 2.4 (run 42403919890, with hqHeld); not re-tried apart',
  threatLeaf: 'item 3: the threat as the planner leaf charge; lost to the played-out reply (-8.2 ± 1.3 alone, 2026-11-07), the leaf goes to item 4',
  plannerPatchesOff: 'item 4: dropping the ordering patches under the planner search cost "tag not used" +2.3 ± 1.1 (2026-11-07); patches go with item 6',
  measuredPass: 'item 3 round 2: the measured unrezzed pass rate; neutral in its paired batch (+0.0 ± 0.6, 2026-11-07), kept off with the threat it was measured for',
  threatSpend: 'item 3 round 3: the Runner spend at the threat leaf; read only with threatLeaf (off)',
  // Tuning pass round 2 (spec-round2.md): oracles measure headroom; they can never ship on
  'oracle.grip': 'measurement oracle, never a default',
  'oracle.safestRemote': 'measurement oracle, never a default',
  'oracle.rd': 'measurement oracle, never a default',
  'oracle.think': 'measurement oracle (decision-quality ceiling), never a default',
  'oracle.gripThreat': 'measurement oracle (Phase 2 K0: grip in the threat and search deals only), never a default',
  reach: 'Phase 2 K1: +0.3 +/- 0.7 at 10 games (run 42549985741) but stayed broke +1.5 +/- 0.7, over the 2 SE line',
  reachStrength: 'Phase 2 K2: -0.9 +/- 1.4 at 3 games (run 42538399856), opening unchanged',
  threatKeyPricing: 'Phase 2 K4b: threat key without the pricing context; moved 4 of 221 deals (run 42537621348)',
  reachTime: 'Phase 2 K3: +0.6 +/- 0.8 at 10 games (run 42543840540), stayed broke +2.8 +/- 0.9',
  'oracle.gripReply': 'measurement oracle (Phase 2 K0: grip in the Runner reply only), never a default',
  calibratedRun: 'item 3 round 3: the threat read at measured hit rates; did not help (-9.9 vs -10.6), kept as measurement',
  icePacingPriced: 'bug report #43: about -7 points through over-icing (batch 3 42715002281 vs batch 4 42720370875: went-broke +22, stayed-broke +14); off until the leaf prices the rezzes an ice install commits to',
  searchSamples: 'Phase 3 S3 (spec-search.md): PARKED OFF, -4.2 ± 1.8 vs searchLines ON (run 42697176557; searchLines deleted in step 2); re-measure after corpTurnDamageOwn lands on beta, against #45',
};

/**
 * Module-level `let` in src/ai (review item 6): what a position is worth reads the pricing context (pricing.ts), not
 * flags flipped around calls. These are the ones left, each with why it is not pricing state. May only shrink.
 */
const MODULE_LETS: Record<string, string> = {
  'pricing:version': 'the context itself: bumped on every change so pricingKey is rebuilt only then',
  'pricing:basePlan': "the context itself: the outermost decision's base plan, which nested asSide builds on",
  'pricing:keyVersion': 'the context itself: the version pricingKey was last built at',
  'pricing:key': 'the context itself: the last pricingKey',
  'worker:agent': 'the web worker holds its one agent',
  'synergyTags:SYNERGY': 'the card tag table, filled once from src/ai/cards at load',
  'synergy:debug': 'a debug print switch',
  'evaluate:AGENDA_CLICK': 'a measured rate a script sets (setAgendaClick), not per call',
  'threatModel:planSig': "a cache of the plan's JSON for the threat key, rebuilt when the plan changes",
  'valueModel:deckCard': 'the deck-average hook handValues registers once (an import cycle otherwise)',
  'valueModel:nextStateId': "guardLoop's id counter for positions",
};

describe('AI code health (audit guards)', () => {
  it('keeps pricing state in the pricing context: no new module-level let in src/ai', () => {
    const dir = new URL('../src/ai/', import.meta.url);
    const found = (readdirSync(dir, { recursive: true }) as string[]).filter(f => f.endsWith('.ts')).flatMap(file =>
      [...readFileSync(new URL(file, dir), 'utf8').matchAll(/^(?:export )?let (\w+)/gm)].map(m => `${file.replace(/\.ts$/, '')}:${m[1]}`),
    );
    expect(found.filter(key => !(key in MODULE_LETS)), 'a flag that changes what a position is worth goes in pricing.ts (withPricing)').toEqual([]);
    expect(Object.keys(MODULE_LETS).filter(key => !found.includes(key))).toEqual([]);
  });

  it('names no new card codes in the shared value files', () => {
    const found = VALUE_FILES.flatMap(file =>
      [...readFileSync(new URL(`../src/ai/${file}.ts`, import.meta.url), 'utf8').matchAll(/'(3\d{4})'/g)].map(m => `${file}:${m[1]}`),
    );
    const unlisted = found.filter(key => !(key in CODES_IN_VALUE_FILES));
    expect(unlisted, 'move the card logic to its entry in src/ai/cards/').toEqual([]);
    // A listed code that's gone: take it off the list
    expect(Object.keys(CODES_IN_VALUE_FILES).filter(key => !found.includes(key))).toEqual([]);
  });

  it('keeps every measurement oracle off and off for the Runner (spec-round2.md: an oracle never ships on)', () => {
    expect(Object.values(tuning.plan.oracle).every(v => v === false)).toBe(true);
    expect(sideOff.runner).toContain('oracle');
  });

  it('has no off switch without a reason', () => {
    const off = Object.entries(tuning.plan).flatMap(([name, value]) =>
      value === false ? [name] : value && typeof value === 'object' ? Object.entries(value).filter(([, v]) => v === false).map(([side]) => `${name}.${side}`) : [],
    );
    expect(off.filter(name => !(name in OFF_SWITCHES)), 'an off switch: delete its path, or give the reason here').toEqual([]);
    expect(Object.keys(OFF_SWITCHES).filter(name => !off.includes(name))).toEqual([]);
  });
});
