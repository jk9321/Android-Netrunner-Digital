import { CardInstance, GameState, activePrompt, cardDef, getCardDefinition, getCardScript, knownInHand, knownInRd } from '../core';
import {
  boostCostOf,
  breakerScript,
  breakerStrength,
  canBreakSubroutinesWith,
  iceScript,
  iceStrength,
  iceSubroutines,
  iceSubtypes,
  installedIcebreakers,
  isBioroid,
} from '../core/engine/ice';
import { availableCredits, counters, rezCost, stealthCredits, threatLevel, turnFlag } from '../core/engine/cardEffects';
import { stealCost } from '../core/engine/actions/run';
import { spikeKey } from '../core/scripts/liberation/runner/helpers';
import { corpCardValue, hiddenCardOdds, tagsWorth } from './evaluate';
import { accessDamage, agendaOdds, coreDamageWorth, counterWorthOf, damageWorth, flatlineOdds, runnerEffect, stealDamage } from './effectValues';
import { clickPrice } from './handValues';
import { clickRate, creditNeed, creditSlide, flatlineWorth, memo, payoutSlide, pointValue } from './valueModel';
import { plan } from './pricing';
import { actingSide } from './synergy';
import { CARDS, breachAccessOf } from './cards';
import { counterWorth } from './counterValues';
import type { Subroutine } from '../core/scripts/types';

/**
 * What the Runner AI knows about runs. It only reads public information:
 * rezzed ice, rezzed cards and advancement counters. Unrezzed ice and
 * unrezzed root cards are guesses.
 */

export const BLOCK = Infinity;

/**
 * The subroutines the Runner plans a run against: the ones the ice has now, plus any it would gain when the
 * encounter begins by the state now (CardAI gainsOnEncounter: Starlit Knight's X "End the run." at threat 4,
 * rules 9.8.3e after its other subroutines). The engine adds those only once the encounter starts, so without
 * this the Runner chose the run and its price against the printed subroutines alone.
 */
export function plannedSubroutines(state: GameState, ice: CardInstance): Subroutine[] {
  const subs = iceSubroutines(state, ice);
  if (!ice.isRezzed) return subs;
  const gains = CARDS[ice.cardCode]?.gainsOnEncounter?.(state, ice) ?? [];
  return gains.length ? [...subs, ...gains] : subs;
}
const MAYFLY = '30032';
const BANGUN = '35068';
const HANTU = '35008'; // boosts by spending hosted virus counters (+2 each), not credits
export const BOTULUS = '30004';
export const TRANQUILIZER = '30017';

/** The Runner's trojans of one kind (Botulus, Tranquilizer) hosted on this ice. */
export function hostedTrojans(state: GameState, ice: CardInstance, code: string): CardInstance[] {
  return state.runner.rig.programs.filter(c => c.cardCode === code && c.hostedOnId === ice.instanceId);
}

/** Subroutines Botulus breaks on this ice for free: the virus counters on the Botulus programs it hosts. */
export function botulusBreaks(state: GameState, ice: CardInstance): number {
  return hostedTrojans(state, ice, BOTULUS).reduce((n, c) => n + counters(c, 'virus'), 0);
}

/** Credits-equivalent cost of letting one subroutine resolve (Infinity: it ends the run). */
export function subroutineCost(state: GameState, label: string): number {
  return knownSubroutineCost(state, label) ?? 2;
}

/**
 * Damage the Runner takes in its own run, priced by the Runner on its own turn (RUNNER-DAMAGE-NO-DRAWBACK,
 * RM-DRAWBACK-RUN-START): damageWorth's draw-back input, whether the run is under way or being chosen (the clicks it
 * will have left after the run's own click; drawBackClicks). The Corp's view of the same subroutine leaves it off.
 */
const ownRun = (state: GameState): boolean => state.activePlayer === 'runner' && actingSide() === 'runner';

/** A rule's answer that passes to the next rule (the trash-a-type rule with no card of that type). */
const NEXT = Symbol('next');
/**
 * A pattern, its price, and the price's own condition for BLOCK (Stage D item 1, brief 4.3a): `blocks` is true exactly
 * when the price is BLOCK on the same board (NEXT where the price passes), so "does this subroutine end the run" can be
 * asked without working out a worth (tests/subroutineFacts.test.ts checks the two agree). Registry debt: two encodings
 * of "this subroutine ends the run" (this condition and subroutineFacts' literal text), closed when the Runner rework
 * makes the price read the facts.
 */
type SubRule = [RegExp, (state: GameState, m: RegExpMatchArray) => number | undefined | typeof NEXT, (state: GameState, m: RegExpMatchArray) => boolean | typeof NEXT];
const never = () => false;
const always = () => true;
/** The prices' damage test (`n > grip`, 10.4.4): below it damageWorth is finite (a flatline is flatlineWorth, not BLOCK). */
const lethal = (state: GameState, n: number) => n > state.runner.grip.length;

/**
 * knownSubroutineCost's patterns, in order: the first that matches the label (and doesn't pass) prices it. Which
 * patterns match depends on the label alone, so it is worked out once per label (planner speed 2026-11-12: the
 * regex chain was ~4% of the Corp's decision time); the prices still read the board each time.
 */
const SUB_RULES: SubRule[] = [
  [/cannot steal or trash/i, () => BLOCK, always],
  // Mycoweb: as bad as the worst subroutine on a rezzed ice of that type
  [/resolve 1 subroutine on (?:a|another) rezzed (barrier|code gate|sentry)/i, (state, borrowed) => {
    const costs = borrowedSubroutines(state, borrowed[1]).map(sub => subroutineCost(state, sub.label));
    return costs.length > 0 ? Math.max(...costs) : 0;
  }, (state, borrowed) => borrowedSubroutines(state, borrowed[1]).some(sub => subroutineBlocks(state, sub.label))],
  // Elevation conditions. Damage that only equals the grip is survived: the Runner is flatlined by more damage than the
  // cards in its grip (rule 10.4.4), so each lethal test below is `>`, as in damageWorth
  // The Runner chooses the damage when it can survive it (else the run ends): priced as that damage (RM-SUBDAMAGE-TEXT; was a flat 2 a point)
  [/end the run unless the runner suffers (\d+) net damage/i, (state, unless) => (Number(unless[1]) > state.runner.grip.length ? BLOCK : damageWorth(state, Number(unless[1]), ownRun(state))), (state, unless) => lethal(state, Number(unless[1]))],
  [/threat level is (\d+) or greater, end the run/i, (state, threat) => (Math.max(state.corp.score, state.runner.score) >= Number(threat[1]) ? BLOCK : 0), (state, threat) => Math.max(state.corp.score, state.runner.score) >= Number(threat[1])],
  [/end the run if the runner is tagged/i, state => (state.runner.tags > 0 ? BLOCK : 1), state => state.runner.tags > 0],
  [/if the runner has at least 2 tags/i, state => (state.runner.tags >= 2 ? (2 > state.runner.grip.length ? BLOCK : damageWorth(state, 2, ownRun(state))) : 0), state => state.runner.tags >= 2 && lethal(state, 2)],
  // Vantage Point: "... unless the Runner pays N credits": the cheaper of paying and letting the rest resolve
  [/^(.*?)\s*unless the runner pays (\d+) (?:\[credit\]|credits?)\.?$/i, (state, pays) => {
    const n = Number(pays[2]);
    const rest = /^end the run$/i.test(pays[1]) ? BLOCK : knownSubroutineCost(state, pays[1]) ?? 2;
    return state.runner.credits >= n ? Math.min(creditCost(state, n), rest) : rest;
  }, (state, pays) => state.runner.credits < Number(pays[2]) && (/^end the run$/i.test(pays[1]) || subroutineBlocks(state, pays[1]))],
  [/^(.*?)\s*unless the runner jacks out\.?$/i, (state, jacks) => knownSubroutineCost(state, jacks[1]), (state, jacks) => subroutineBlocks(state, jacks[1])],
  [/do x net damage and give the runner x tags/i, state => {
    // Vicsek: X is the Runner's tags
    const x = state.runner.tags;
    if (x === 0) return 0;
    return x > state.runner.grip.length ? BLOCK : damageWorth(state, x, ownRun(state)) + tagCost(state) * x;
  }, state => state.runner.tags > 0 && lethal(state, state.runner.tags)],
  [/loses? \[click\]/i, () => clickRate(), never],
  [/gets \+1 strength for the remainder of this run/i, () => 1.5, never], // ezaM: every ice after it costs more to break
  [/each piece of ice gets \+2 strength for the remainder of this run/i, () => 2.5, never], // Tributary: every ice costs more to break
  [/installed runner card to the grip/i, state => 0.5 * trashedCardCost(state) + 1, never], // Lethe: a reinstall, not a loss
  [/remove 1 card in the heap from the game/i, () => 0.3, never],
  [/place 1 virus counter on this ice/i, () => 0, never], // Knowledge Seeker: counts down to its own derez
  [/look at the top \d+ cards? of r&d|arrange|to the (?:top or )?bottom of r&d|shuffle 1 card from hq or archives into r&d/i, () => 0.4, never], // Corp card selection
  // Each point of core damage trashes a card and takes a hand size (rule 10.4.2b): "do 2 core damage" is 2 of each
  [/(?:(\d+) )?core damage/i, (state, core) => {
    // "If the Runner is tagged" is priced as if tagged: an earlier subroutine may tag it first (Jaguarundi), which a
    // price per subroutine can't see; tankDamage, which walks them in order, can
    const n = Number(core[1] ?? 1);
    return n > state.runner.grip.length ? BLOCK : n * coreDamageWorth(state) + damageWorth(state, n);
  }, (state, core) => lethal(state, Number(core[1] ?? 1))],
  [/unless they pay 3 credits/i, state => creditCost(state, 3), never],
  [/loses? (\d+) (?:\[credit\]|credits?)/i, (state, loses) => creditCost(state, Math.min(Number(loses[1]), state.runner.credits)), never],
  [/or end the run/i, state => (state.runner.rig.programs.length > 0 ? 5 : BLOCK), state => state.runner.rig.programs.length === 0],
  [/odd cost/i, state => (state.runner.grip.length <= 1 ? BLOCK : 4), state => state.runner.grip.length <= 1], // Diviner: half the time it ends the run
  [/6 credits or less/i, state => (state.runner.credits - 3 <= 6 ? BLOCK : 0), state => state.runner.credits - 3 <= 6],
  // Liberation conditions
  [/end the run if you have more credits than the runner/i, state => (state.corp.credits > state.runner.credits ? BLOCK : 1), state => state.corp.credits > state.runner.credits], // Valentão
  [/end the run if there are more cards in hq than in the grip/i, state => (state.corp.hq.length > state.runner.grip.length ? BLOCK : 0), state => state.corp.hq.length > state.runner.grip.length], // Piranhas
  [/trash 1 card from hq to end the run/i, state => (state.corp.hq.length > 0 ? BLOCK : 0), state => state.corp.hq.length > 0], // Boto
  [/end the run/i, () => BLOCK, always],
  [/(\d+) (net|meat) damage/i, (state, damage) => {
    const n = Number(damage[1]);
    return n > state.runner.grip.length ? BLOCK : damageWorth(state, n, ownRun(state));
  }, (state, damage) => lethal(state, Number(damage[1]))],
  [/gain 1 \[credit\] for each tag/i, state => 0.3 * state.runner.tags, never], // Capacitor: Corp credits
  [/tag/i, state => tagCost(state), never],
  [/trash 1 installed runner card/i, state => trashedCardCost(state), never],
  [/gain 1 credit/i, () => 0.3, never],
  [/gain 1 \[credit\]/i, () => 0.8, never], // Flywheel: a credit and maybe a card
  [/^gain (\d+) \[credit\]/i, (_state, gains) => 0.4 * Number(gains[1]), never], // Valentão: Corp credits
  // Sorocaban Blade, Hammer, Lycian: a rig card lost, when there is one of that type (with none, the old flat 1.5 below)
  [/trash 1 installed (resource|piece of hardware|program)/i, (state, trashType) => (trashZone(state, trashType[1]).length > 0 ? trashedCardCost(state) : NEXT), (state, trashType) => (trashZone(state, trashType[1]).length > 0 ? false : NEXT)],
  [/^(?:you may )?draw 1 card/i, () => 0.5, never], // Empiricist: helps the Corp a little
  [/install/i, () => 1.5, never],
];

/** Mycoweb's borrowed subroutines: those of the rezzed ice of that type, its own borrowing ones left out. */
function borrowedSubroutines(state: GameState, type: string): Subroutine[] {
  const t = type.toLowerCase();
  return Object.values(state.corp.servers)
    .flatMap(server => server.ice)
    .filter(ice => ice.isRezzed && iceSubtypes(ice, state).some(x => x === t))
    .flatMap(ice => iceSubroutines(state, ice).filter(sub => !/resolve 1 subroutine on/i.test(sub.label)));
}

/** The rig zone a "trash 1 installed <type>" subroutine takes from. */
function trashZone(state: GameState, type: string): CardInstance[] {
  const rig = state.runner.rig;
  return { resource: rig.resources, 'piece of hardware': rig.hardware, program: rig.programs }[type.toLowerCase() as 'resource'];
}

/** The rules whose pattern matches each label seen, in order, with their matches. */
const labelRules = new Map<string, [SubRule[1], SubRule[2], RegExpMatchArray][]>();
function rulesFor(label: string): [SubRule[1], SubRule[2], RegExpMatchArray][] {
  let rules = labelRules.get(label);
  if (!rules) {
    rules = [];
    for (const [re, price, blocks] of SUB_RULES) {
      const m = label.match(re);
      if (m) rules.push([price, blocks, m]);
    }
    labelRules.set(label, rules);
  }
  return rules;
}

/**
 * The cost of a subroutine whose wording one of the patterns above
 * recognises, or undefined for wording none of them knows (counted as 2).
 * A test checks every subroutine in the card pool is recognised.
 */
export function knownSubroutineCost(state: GameState, label: string): number | undefined {
  for (const [price, , m] of rulesFor(label)) {
    const cost = price(state, m);
    if (cost !== NEXT) return cost;
  }
  return undefined;
}

/**
 * Does letting this subroutine resolve end the run, as its price says (subroutineCost(...) === BLOCK), without working
 * out the price (Stage D item 1, brief 4.5: the hold count priced a tag's worth only to learn this). Same rules, same
 * order; a label no rule knows is priced 2, so it does not block.
 */
export function subroutineBlocks(state: GameState, label: string): boolean {
  for (const [, blocks, m] of rulesFor(label)) {
    const b = blocks(state, m);
    if (b !== NEXT) return b;
  }
  return false;
}

/**
 * The literal facts of a subroutine, from its card text (Stage D item 1, brief 4.3b): what it does, on what literal
 * condition, what paying through it costs. The hold count's walk reads them against the state it carries (the
 * Runner's credits, clicks, tags and grip, the Corp's credits) as the subroutine resolves (9.8.7b); no worth is here.
 * A condition is the card's own ("6 or less"), not a price's look-ahead ("credits - 3 <= 6": the walk applies the loss
 * of the subroutine before it itself). Parsed sentence by sentence, so a label the first-match price rules catch whole
 * (Tree Line's "Gain 1 [credit]. End the run." under "end the run") keeps every effect.
 * tests/subroutineFacts.test.ts checks every subroutine in the pool parses with no unknown sentence.
 */
export type SubCondition =
  | { kind: 'iceIs'; subtype: 'barrier' | 'code gate' | 'sentry' }
  | { kind: 'runnerTagsAtLeast'; n: number }
  | { kind: 'runnerCreditsAtMost'; n: number }
  | { kind: 'threatAtLeast'; n: number }
  | { kind: 'corpCreditsMoreThanRunner' }
  | { kind: 'hqMoreThanGrip' }
  /** Diviner: the card its damage trashed has an odd printed cost (a fact of the grip the walk can't read: unknown). */
  | { kind: 'trashedOddCost' };

export type SubEffect =
  | { kind: 'endRun'; if?: SubCondition }
  | { kind: 'runnerLosesCredits'; n: number }
  | { kind: 'runnerLosesClicks'; n: number }
  /** n: a number, or 'runnerTags' (Vicsek's X). */
  | { kind: 'tags'; n: number | 'runnerTags' }
  | { kind: 'damage'; type: 'net' | 'meat' | 'core'; n: number | 'runnerTags' }
  | { kind: 'corpGainsCredits'; n: number | 'perRunnerTag' }
  | { kind: 'trashInstalled'; what: 'card' | 'program' | 'resource' | 'hardware' | 'resourceOrHardware' | 'nonBreakerProgram' }
  | { kind: 'toGrip' }
  | { kind: 'cannotStealOrTrash' }
  | { kind: 'iceStrengthThisRun'; n: number }
  | { kind: 'trashThisIce' }
  /** The Runner may jack out (Karunā): its choice, never needed to get in. */
  | { kind: 'mayJackOut' }
  /** Boto: the Corp may trash a card from HQ to end the run. */
  | { kind: 'corpMayTrashHqToEndRun' }
  /** Mycoweb: resolves a subroutine of another rezzed ice of the subtype. */
  | { kind: 'borrow'; subtype: 'barrier' | 'code gate' | 'sentry' }
  /** What only the Corp's own cards feel (installs, draws, card selection, counters on the ice): nothing the walk reads. */
  | { kind: 'corpSide'; text: string }
  | { kind: 'unknown'; text: string };

export interface SubFacts {
  /** The subroutine does anything only while this holds ("If this ice is a barrier, ..."; "If the Runner is tagged, ..."). */
  when?: SubCondition;
  /** What it does, in printed order. */
  does: SubEffect[];
  /** A nested cost the Runner may pay instead of `does` (1.16.11b: "... unless the Runner pays 3 [credit]"). */
  unless?: { credits?: number; netDamage?: number; jackOut?: true };
  /** "X or end the run": the Corp chooses between `does` and ending the run (ruling 6: the walk takes the end). */
  orEndRun?: true;
}

const ICE_TYPE = '(barrier|code gate|sentry)';
const TRASH_WHAT: Record<string, Extract<SubEffect, { kind: 'trashInstalled' }>['what']> = {
  'runner card': 'card',
  program: 'program',
  resource: 'resource',
  'piece of hardware': 'hardware',
  'resource or piece of hardware': 'resourceOrHardware',
  'program that is not a decoder, fracter, or killer': 'nonBreakerProgram',
};
const num = (x: string) => (x === 'x' ? 'runnerTags' : Number(x));

/** One clause's effects (lower case, no final period), or an unknown. */
function clauseEffects(c: string): SubEffect[] {
  let m: RegExpMatchArray | null;
  if ((m = c.match(/^(.*?) and (end the run|1 \[credit\])$/))) {
    // "gain 1 [credit] and end the run"; "the runner loses [click] and 1 [credit]"
    if (m[2] === 'end the run') return [...clauseEffects(m[1]), { kind: 'endRun' }];
    return [...clauseEffects(m[1]), { kind: 'runnerLosesCredits', n: 1 }];
  }
  if (c === 'end the run') return [{ kind: 'endRun' }];
  if ((m = c.match(/^if the threat level is (\d+) or greater, end the run$/))) return [{ kind: 'endRun', if: { kind: 'threatAtLeast', n: Number(m[1]) } }];
  if ((m = c.match(/^if the runner has (\d+) credits or less, end the run$/))) return [{ kind: 'endRun', if: { kind: 'runnerCreditsAtMost', n: Number(m[1]) } }];
  if (c === 'if the trashed card has an odd cost, end the run') return [{ kind: 'endRun', if: { kind: 'trashedOddCost' } }];
  if (c === 'end the run if the runner is tagged') return [{ kind: 'endRun', if: { kind: 'runnerTagsAtLeast', n: 1 } }];
  if (c === 'end the run if you have more credits than the runner') return [{ kind: 'endRun', if: { kind: 'corpCreditsMoreThanRunner' } }];
  if (c === 'end the run if there are more cards in hq than in the grip') return [{ kind: 'endRun', if: { kind: 'hqMoreThanGrip' } }];
  if (c === 'you may trash 1 card from hq to end the run') return [{ kind: 'corpMayTrashHqToEndRun' }];
  if ((m = c.match(/^do (\d+|x) (net|meat|core) damage$/))) return [{ kind: 'damage', type: m[2] as 'net', n: num(m[1]) }];
  if (c === "do x net damage and give the runner x tags (x = the runner's tags)") {
    return [{ kind: 'damage', type: 'net', n: 'runnerTags' }, { kind: 'tags', n: 'runnerTags' }];
  }
  if ((m = c.match(/^give the runner (\d+) tags?$/))) return [{ kind: 'tags', n: Number(m[1]) }];
  if ((m = c.match(/^the runner loses (\d+) (?:credits?|\[credit\])$/))) return [{ kind: 'runnerLosesCredits', n: Number(m[1]) }];
  if (c === 'the runner loses [click]') return [{ kind: 'runnerLosesClicks', n: 1 }];
  if (c === 'gain 1 [credit] for each tag the runner has') return [{ kind: 'corpGainsCredits', n: 'perRunnerTag' }];
  if ((m = c.match(/^gain (\d+) (?:credits?|\[credit\])$/))) return [{ kind: 'corpGainsCredits', n: Number(m[1]) }];
  if ((m = c.match(/^trash 1 installed (.+)$/)) && TRASH_WHAT[m[1]]) return [{ kind: 'trashInstalled', what: TRASH_WHAT[m[1]] }];
  if (c === 'trash this ice') return [{ kind: 'trashThisIce' }];
  if (c === 'the runner may jack out') return [{ kind: 'mayJackOut' }];
  if (c === 'the runner cannot steal or trash corp cards for the remainder of this run') return [{ kind: 'cannotStealOrTrash' }];
  if ((m = c.match(/^each piece of ice gets \+(\d+) strength for the remainder of this run$/))) return [{ kind: 'iceStrengthThisRun', n: Number(m[1]) }];
  if (c === 'add 1 installed runner card to the grip') return [{ kind: 'toGrip' }];
  if ((m = c.match(new RegExp(`^resolve 1 subroutine on (?:a|another) rezzed ${ICE_TYPE}$`)))) return [{ kind: 'borrow', subtype: m[1] as 'barrier' }];
  if (/^(?:you may )?(?:install|draw|rez|look at|shuffle|place 1|add 1 card from|add that card|remove 1 card in the heap|arrange)/.test(c)) return [{ kind: 'corpSide', text: c }];
  return [{ kind: 'unknown', text: c }];
}

const factsCache = new Map<string, SubFacts>();

/** The literal facts of a subroutine label (see SubFacts). Worked out once per label. */
export function subroutineFacts(label: string): SubFacts {
  const hit = factsCache.get(label);
  if (hit) return hit;
  const facts: SubFacts = { does: [] };
  // Sentences; "(X = the Runner's tags)" and "1 [credit]." stay with theirs
  const sentences = label
    .trim()
    .replace(/\.$/, '')
    .split(/\.\s+(?=[A-Z])/)
    .map(x => x.trim().replace(/\.$/, '').toLowerCase());
  for (let c of sentences) {
    let m: RegExpMatchArray | null;
    if ((m = c.match(new RegExp(`^if this ice is an? ${ICE_TYPE}, (.*)$`)))) {
      facts.when = { kind: 'iceIs', subtype: m[1] as 'barrier' };
      c = m[2];
    } else if ((m = c.match(/^if the runner is tagged, (.*)$/))) {
      facts.when = { kind: 'runnerTagsAtLeast', n: 1 };
      c = m[1];
    }
    if ((m = c.match(/^do (\d+) net damage if the runner has at least (\d+) tags$/))) {
      facts.when = { kind: 'runnerTagsAtLeast', n: Number(m[2]) };
      facts.does.push({ kind: 'damage', type: 'net', n: Number(m[1]) });
      continue;
    }
    if ((m = c.match(/^end the run unless the runner suffers (\d+) net damage$/))) {
      facts.does.push({ kind: 'endRun' });
      facts.unless = { netDamage: Number(m[1]) };
      continue;
    }
    if ((m = c.match(/^(.*?) unless (?:the runner pays|they pay) (\d+) (?:credits?|\[credit\])$/))) {
      facts.does.push(...clauseEffects(m[1]));
      facts.unless = { credits: Number(m[2]) };
      continue;
    }
    if ((m = c.match(/^(.*?) unless the runner jacks out$/))) {
      facts.does.push(...clauseEffects(m[1]));
      facts.unless = { jackOut: true };
      continue;
    }
    if ((m = c.match(/^(.*?) or end the run$/))) {
      facts.does.push(...clauseEffects(m[1]));
      facts.orEndRun = true;
      continue;
    }
    facts.does.push(...clauseEffects(c));
  }
  factsCache.set(label, facts);
  return facts;
}

/**
 * Worth to the Runner of spending `credits` now, on the credit slide its
 * board score uses.
 */
export function creditCost(state: GameState, credits: number): number {
  if (credits <= 0) return 0;
  const have = state.runner.credits;
  const need = creditNeed(state, 'runner');
  return creditSlide(have, need) - creditSlide(have - credits, need);
}

/** Credits spent on a run, in runScore's units (the credit slide). */
export const spendCost = (state: GameState, credits: number): number => creditCost(state, credits);

/** A click spent on a run, in runScore's units. */
export const runClick = (state?: GameState): number => (state ? clickPrice(state, 'runner', 'runner') : clickRate());

/** A tag taken (Jeff): the cheaper of clearing it (a click and 2 credits) and what it costs to keep it. */
export function tagCost(state: GameState): number {
  // A run still to start takes its click first (plan.tagNoClear: what's left to clear the tag with)
  const s = !state.activeRun ? { ...state, runner: { ...state.runner, clicks: state.runner.clicks - 1 } } : state;
  // The clock's loss is kept on the original board (keyed with the copy's clicks), so a copy per call costs no re-pricing
  const home = s === state ? undefined : state;
  return tagsWorth(s, 'runner', s.runner.tags + 1, home) - tagsWorth(s, 'runner', s.runner.tags, home); // both priced as given (plan.tagTrashNow)
}

/** An installed card the Corp gets to trash: about the Runner's best, a breaker at its install cost and the time to replace it. */
export function trashedCardCost(state: GameState): number {
  const rig = [...state.runner.rig.programs, ...state.runner.rig.hardware, ...state.runner.rig.resources];
  if (rig.length === 0) return 0;
  return Math.min(8, Math.max(...rig.map(c => (cardDef(c).cost ?? 0) + clickRate() + 1)));
}

export interface BreakPlan {
  breaker: CardInstance;
  /** Credits paid to break every subroutine in `indices`, boosts included: real credits, the only part checked against the Runner's credits. */
  credits: number;
  /**
   * What the plan costs besides credits, in credits' worth (RUNNER-BUDGET-UNITS): counters spent (Lobisomem's power
   * counter, Audrey's and Hantu's virus counters), cards discarded (Audrey) and the breaker trashed (Mayfly). Priced
   * once, never compared with the credits the Runner has.
   */
  value: number;
  boostsNeeded: number;
  /** Boost with the breaker's card ability (Hantu's virus counters) instead of BOOST_BREAKER. */
  boostByAbility?: boolean;
  /** Break with the card's ability instead of BREAK_SUBROUTINE (Lobisomem on barriers, Banner). */
  breakByAbility?: boolean;
}

/** A break plan's whole price: its credits and the rest of what it spends, in credits' worth. */
export const planCost = (plan: BreakPlan): number => plan.credits + plan.value;

/** Liberation breakers the generic plan can't price. */
export const AUDREY = '34004';
export const BANNER = '34005';
export const LOBISOMEM = '34090';
export const PRESSURE_SPIKE = '34092';
/** A card trashed from the grip for Audrey's +3 strength, in credits. */
const AUDREY_DISCARD = 1.5;
/** Each of Audrey's virus counters, in credits (it gains them only on trashes). */
const AUDREY_COUNTER = 1;

const CORSAIR = '36004';
const SLAP_VANDAL = '34026';

/**
 * Credits for `boosts` strength boosts: none cost nothing, also for a breaker that cannot boost (Slap Vandal, Umbrella:
 * boostCost Infinity, where 0 * Infinity was NaN and made the Corp's whole board value NaN, issue #47).
 */
function boostCredits(state: GameState, breaker: CardInstance, boosts: number): number {
  return boosts > 0 ? boosts * boostCostOf(state, breaker) : 0;
}

/**
 * Credits the Runner can spend on a run it is planning: what it can spend
 * now, plus, before the run starts, the credits on cards that pay only
 * during runs (Methuselah, Touchstone), which availableCredits leaves out then.
 */
export function runBudget(state: GameState): number {
  const now = availableCredits(state, 'runner');
  if (state.activeRun) return now;
  const rig = [...state.runner.rig.hardware, ...state.runner.rig.programs, ...state.runner.rig.resources];
  return now + rig.filter(c => getCardScript(c.cardCode)?.paysDuringRuns).reduce((n, c) => n + counters(c, 'credit'), 0);
}

/** Credits from stealth cards the Runner can spend on a run: now, during one, or what its stealth cards hold before it starts. */
export function runStealthCredits(state: GameState): number {
  if (state.activeRun) return stealthCredits(state);
  const rig = [...state.runner.rig.hardware, ...state.runner.rig.programs, ...state.runner.rig.resources];
  return rig.filter(c => /stealth/i.test(cardDef(c).keywords ?? '')).reduce((n, c) => n + counters(c, 'credit'), 0);
}

/**
 * What a break plan spends besides credits, as quantities (Stage D item 1, brief 4.3: the hold count's walk shares them
 * along a server; their worth stays in BreakPlan.value): the counters of which card, grip cards, Mayfly's trash, a once
 * per run use, stealth credits.
 */
export interface PlanSpends {
  counters?: { cardId: string; kind: 'virus' | 'power'; n: number };
  gripCards?: number;
  /** The breaker is trashed when the run ends (Mayfly). */
  trashesBreaker?: true;
  /** A run flag the plan sets (Pressure Spike's +9, once per run). */
  oncePerRun?: string;
  /** Credits that must come from stealth cards (Corsair's strength lowering). */
  stealthCredits?: number;
}

/**
 * The cheapest installed icebreaker that can break the given subroutines of
 * this ice, counting strength boosts already bought this encounter: the first of
 * breakPlans' list with the least planCost.
 */
export function bestBreakPlan(state: GameState, ice: CardInstance, subCount: number): BreakPlan | null {
  let best: BreakPlan | null = null;
  for (const { plan } of breakPlans(state, ice, subCount)) if (!best || planCost(plan) < planCost(best)) best = plan;
  return best;
}

/**
 * Every installed icebreaker's plan for breaking `subCount` subroutines of this ice (one per breaker, two for Pressure
 * Spike at threat 4: its +9 and its plain boosts), in rig order, each with what it spends besides credits. The owner of
 * "cost to get past one ice" by breaker; bestBreakPlan reads it (Stage D item 1, brief 4.3, red team F1: the walk picks
 * among the plans, as one plan per ice can spend a counter the ice further in needs).
 */
export function breakPlans(state: GameState, ice: CardInstance, subCount: number): { plan: BreakPlan; spends: PlanSpends }[] {
  if (subCount === 0) return [];
  const types = iceSubtypes(ice, state);
  const iceStr = iceStrength(state, ice);
  const plans: { plan: BreakPlan; spends: PlanSpends }[] = [];
  for (const breaker of installedIcebreakers(state)) {
    const script = breakerScript(breaker);
    const strength = breakerStrength(state, breaker);
    // Banner (no break ability): 2 credits and a barrier's subroutines can't end the run; only for barriers whose every subroutine just ends the run
    if (breaker.cardCode === BANNER) {
      const subs = plannedSubroutines(state, ice);
      if (types.includes('barrier') && strength >= iceStr && subs.length > 0 && subs.every(sub => /^end the run\.?$/i.test(sub.label.trim()))) {
        plans.push({ plan: { breaker, credits: 2, value: 0, boostsNeeded: 0, breakByAbility: true }, spends: {} });
      }
      continue;
    }
    // Lobisomem on a barrier: X credits and a power counter break X subroutines (rules: its second interface ability)
    if (breaker.cardCode === LOBISOMEM && script && types.includes('barrier') && counters(breaker, 'power') > 0 && canBreakSubroutinesWith(ice, breaker)) {
      const boosts = Math.max(0, Math.ceil((iceStr - strength) / Math.max(1, script.boostAmount(state, breaker))));
      const credits = boostCredits(state, breaker, boosts) + subCount;
      const value = 1; // the counter is worth about a credit
      plans.push({ plan: { breaker, credits, value, boostsNeeded: boosts, breakByAbility: true }, spends: { counters: { cardId: breaker.instanceId, kind: 'power', n: 1 } } });
      continue;
    }
    if (!script || (script.breaks !== 'any' && !types.includes(script.breaks))) continue;
    if (!canBreakSubroutinesWith(ice, breaker)) continue; // Semak-samun: fracters only
    if (script.canInterface?.(state, breaker, ice)) continue; // Slap Vandal, Living Mural, Umbrella
    // Slap Vandal: "Interface -> 1 credit: Break 1 subroutine on host ice. Use this ability only once per encounter." One
    // subroutine is all it breaks; a plan for more is another breaker's (the Runner tanks the rest, iceCreditNeed BLOCKs)
    if (breaker.cardCode === SLAP_VANDAL && subCount > 1) continue;
    if (breaker.cardCode === AUDREY) {
      // Audrey v2: a virus counter breaks up to 2; a card from the grip is +3 strength
      const uses = Math.ceil(subCount / script.breakMax);
      const boosts = Math.max(0, Math.ceil((iceStr - strength) / 3));
      if (uses > counters(breaker, 'virus') || boosts > state.runner.grip.length) continue;
      // Counters and discards, no credits
      const value = uses * AUDREY_COUNTER + boosts * AUDREY_DISCARD;
      plans.push({ plan: { breaker, credits: 0, value, boostsNeeded: boosts }, spends: { counters: { cardId: breaker.instanceId, kind: 'virus', n: uses }, gripCards: boosts } });
      continue;
    }
    if (breaker.cardCode === PRESSURE_SPIKE && strength < iceStr && Math.max(state.corp.score, state.runner.score) >= 4 && !state.activeRun?.runFlags?.[spikeKey(breaker)]) {
      // Pressure Spike at threat 4: +9 for 2 credits once a run
      const boosts = Math.ceil((iceStr - strength) / 9);
      if (boosts === 1) {
        const credits = 2 + Math.ceil(subCount / script.breakMax) * script.breakCost(state, breaker);
        plans.push({ plan: { breaker, credits, value: 0, boostsNeeded: 1, boostByAbility: true }, spends: { oncePerRun: spikeKey(breaker) } });
      }
    }
    if (breaker.cardCode === HANTU) {
      const boosts = Math.max(0, Math.ceil((iceStr - strength) / 2));
      if (boosts > counters(breaker, 'virus')) continue;
      // Its boosts spend virus counters (a counter about 1.5 credits' worth), its breaks credits
      const credits = Math.ceil(subCount / script.breakMax) * script.breakCost(state, breaker);
      const value = boosts * 1.5;
      plans.push({ plan: { breaker, credits, value, boostsNeeded: boosts, boostByAbility: true }, spends: { counters: { cardId: breaker.instanceId, kind: 'virus', n: boosts } } });
      continue;
    }
    if (breaker.cardCode === CORSAIR) {
      // Corsair: -3 strength on the barrier per stealth credit (its own ability), then 1 credit a subroutine
      const lowers = Math.max(0, Math.ceil((iceStr - strength) / 3));
      if (lowers > runStealthCredits(state)) continue;
      const credits = lowers + Math.ceil(subCount / script.breakMax) * script.breakCost(state, breaker);
      plans.push({ plan: { breaker, credits, value: 0, boostsNeeded: lowers, boostByAbility: true }, spends: { stealthCredits: lowers } });
      continue;
    }
    const amount = script.boostAmount(state, breaker);
    if (strength < iceStr && amount <= 0) continue;
    const boostsNeeded = Math.max(0, Math.ceil((iceStr - strength) / Math.max(amount, 1)));
    const credits = boostCredits(state, breaker, boostsNeeded) + Math.ceil(subCount / script.breakMax) * script.breakCost(state, breaker);
    const value = breaker.cardCode === MAYFLY ? 2 : 0; // Mayfly is trashed after the run
    plans.push({ plan: { breaker, credits, value, boostsNeeded }, spends: breaker.cardCode === MAYFLY ? { trashesBreaker: true } : {} });
  }
  return plans;
}

/**
 * What getting past one piece of ice costs the Runner, as two numbers (RUNNER-BUDGET-UNITS; the owner of "cost to get
 * past one ice", docs/ai-priced-quantities.md): `credits`, the credits it pays (the only part a budget compares with its
 * credits), and `value`, the rest in credits' worth (subroutines let through, a bioroid's clicks, counters and cards a
 * break spends), priced once. The way past is the cheapest in total. BLOCK in both: no way past.
 */
export interface IcePrice {
  credits: number;
  value: number;
  /** Cards the Runner loses to the damage it lets resolve on the way past (for what a steal's damage meets after it); 0 when broken. */
  damage?: number;
  /** When the tank is the cheaper way past: the cheapest way that lets no damage through (break it), for a run whose tanks together are more damage than the grip. */
  noDamage?: IcePrice;
}
const BLOCKED: IcePrice = { credits: BLOCK, value: BLOCK };
const total = (p: IcePrice): number => p.credits + p.value;
const cheaper = (a: IcePrice, b: IcePrice): IcePrice => (total(b) < total(a) ? b : a);

export function icePrice(state: GameState, ice: CardInstance): IcePrice {
  // Unrezzed: a guess at the credits it will take (rezzed on approach, 6.9.2c); its damage risk is the run's (unrezzedDamageRisk)
  if (!ice.isRezzed) return { credits: state.corp.credits >= 3 ? 1.5 : 0.5, value: 0 };
  const plain = plainIcePrice(state, ice);
  const physarum = physarumCost(state, ice);
  return physarum !== undefined ? cheaper(plain, { credits: physarum, value: 0 }) : plain;
}

/**
 * The damage an unrezzed ice may do: each ice still unseen in the Corp's decklist (HQ, R&D, facedown Archives and
 * installed ice the Runner hasn't seen; no hand or order read), as if it were this one rezzed on approach (6.9.2c) by a
 * Corp that can pay its rez cost, does the damage its subroutines let through in order (tankDamage) when the Runner
 * can't pay to break them; priced by damageWorth at the grip, averaged over the pool. Rules 9.8.7b, 10.4.4. Replaces
 * the 0 the flat guess gave (RUNNER-UNREZZED-FLAT: Karunā's 2 net on 1 card, Empiricist and Doomscroll on 2). Read by
 * the Runner's run prices (runScore, runRestWorth), not by icePrice, which the Corp's own ice valuations also read.
 * Priced once per state: the first unrezzed ice asked about stands for the position (strength bonuses by server aside).
 */
export function unrezzedDamageRisk(state: GameState, ice: CardInstance): number {
  const damages = memo(state, 'unrezzedIceDamage', () => {
    const corp = state.corp;
    const hidden = Object.values(corp.servers).flatMap(server => server.ice.filter(c => !c.isRezzed && !c.runnerKnows));
    const pool = [...corp.hq, ...corp.rd, ...corp.archives.faceDown, ...hidden].filter(c => getCardDefinition(c.cardCode).type_code === 'ice');
    const byCode = new Map<string, number>();
    return pool.map(c => {
      const known = byCode.get(c.cardCode);
      if (known !== undefined) return known;
      // its own id: the subroutine and strength caches are keyed by instance, and this card is not the installed one
      const as: CardInstance = { ...ice, instanceId: `${ice.instanceId}~${c.cardCode}`, cardCode: c.cardCode, isRezzed: true };
      const subs = plannedSubroutines(state, as).map((sub, i) => ({ label: sub.label, i }));
      const plan = bestBreakPlan(state, as, subs.length);
      const rezzable = (getCardDefinition(c.cardCode).cost ?? 0) <= corp.credits;
      const damage = !rezzable || (plan && plan.credits <= state.runner.credits) ? 0 : tankDamage(state, subs).damage;
      byCode.set(c.cardCode, damage);
      return damage;
    });
  });
  if (damages.length === 0) return 0;
  return damages.reduce((n, d) => n + (d > 0 ? damageWorth(state, d, false) : 0), 0) / damages.length;
}

/** Estimated cost to get past one piece of ice, as the Runner sees it: icePrice's credits and value together. */
export function iceCost(state: GameState, ice: CardInstance): number {
  return total(icePrice(state, ice));
}

const PHYSARUM = '34082';

/**
 * Physarum Entangler on this ice: a credit a subroutine bypasses it on every
 * encounter (rules 6.5.8a), unless it is a barrier. Undefined when none is hosted
 * or the Runner can't pay.
 */
export function physarumCost(state: GameState, ice: CardInstance): number | undefined {
  if (!plan().bypass || !ice.isRezzed || iceSubtypes(ice, state).includes('barrier')) return undefined;
  if (!state.runner.rig.programs.some(p => p.cardCode === PHYSARUM && p.hostedOnId === ice.instanceId)) return undefined;
  const credits = plannedSubroutines(state, ice).length;
  return credits <= runBudget(state) ? credits : undefined;
}

/**
 * Cards a subroutine's damage takes from the grip when it resolves (net, meat or core; Vicsek's X is the Runner's tags),
 * with `tags` the Runner's tags by then (Doomscroll: "Do 2 net damage if the Runner has at least 2 tags", after its own tag).
 */
function subroutineDamage(label: string, tags: number): number {
  if (/do x net damage/i.test(label)) return tags;
  // Core damage trashes a card a point, as net and meat do (rule 10.4.2b)
  if (/if the runner is tagged/i.test(label) && tags === 0) return 0;
  const core = label.match(/(?:(\d+) )?core damage/i);
  if (core) return Number(core[1] ?? 1);
  const needs = label.match(/if the runner has at least (\d+) tags/i);
  if (needs && tags < Number(needs[1])) return 0;
  // "End the run unless the Runner suffers N net damage": a tank takes the damage (the run going on is why it tanks)
  const unless = label.match(/unless the runner suffers (\d+) (?:net|meat) damage/i);
  if (unless) return Number(unless[1]);
  const m = label.match(/(\d+) (?:net|meat) damage/i);
  return m && !/unless/i.test(label) ? Number(m[1]) : 0;
}
const subroutineTags = (label: string): number => Number(label.match(/give the runner (\d+) tags?/i)?.[1] ?? 0);

/**
 * The damage letting these subroutines resolve does, one at a time in printed order (rule 9.8.7b) with the tags given on
 * the way, and the first one (by index `i`) at which the total is more than the grip: a flatline (10.4.4). The owner
 * of "can the tank get through": the run's price (plainIcePrice) and the encounter's break choice (runnerAI) both read it.
 */
export function tankDamage(state: GameState, subs: readonly { label: string; i: number }[]): { damage: number; lethal?: number } {
  let tags = state.runner.tags;
  let damage = 0;
  let lethal: number | undefined;
  for (const p of [...subs].sort((a, b) => a.i - b.i)) {
    damage += subroutineDamage(p.label, tags);
    tags += subroutineTags(p.label);
    if (lethal === undefined && damage > state.runner.grip.length) lethal = p.i;
  }
  return { damage, lethal };
}

function plainIcePrice(state: GameState, ice: CardInstance): IcePrice {
  // Botulus breaks the worst subroutines for free; the rest are tanked or broken
  const priced = plannedSubroutines(state, ice).map((s, i) => ({ cost: subroutineCost(state, s.label), label: s.label, i })).sort((a, b) => b.cost - a.cost);
  const kept = priced.slice(botulusBreaks(state, ice));
  const subs = kept.map(p => p.cost);
  const funhouse = ice.cardCode === '30054' ? tagCost(state) : 0; // Funhouse: take a tag or the run ends
  if (subs.length === 0) return { credits: 0, value: funhouse };
  // The damage the tank lets through, subroutine by subroutine in printed order (rule 9.8.7b: they resolve 1 at a time in order),
  // with the tags given on the way. Each subroutine's own price tests its damage against the grip as it stands, so
  // Empiricist's 1 net then 2 net on 2 cards passed both tests; together they are more damage than the grip, a flatline
  // (10.4.4), and the tank is no way past
  const { damage, lethal } = tankDamage(state, kept);
  // Letting them resolve costs no credits: what they do is value lost
  const tankValue = subs.reduce((sum, cost) => sum + cost, 0) + funhouse;
  const tank: IcePrice = tankValue === BLOCK || lethal !== undefined ? BLOCKED : { credits: 0, value: tankValue, damage };
  const plan = bestBreakPlan(state, ice, subs.length);
  const broken: IcePrice = plan ? { credits: plan.credits, value: plan.value + funhouse } : BLOCKED;
  const noDamage = cheaper(broken, selfBreakPrice(state, ice, subs.length));
  const best = cheaper(tank, noDamage);
  return best === tank && damage > 0 && total(noDamage) < BLOCK ? { ...tank, noDamage } : best;
}

/**
 * Credits the Runner must spend to get past this rezzed ice without the
 * run ending: breaking its run-ending subroutines (0 when it has none, or
 * when a bioroid can be broken with the clicks left). Subroutines already
 * broken in `broken` don't count. BLOCK when it can't be got past.
 */
export function iceCreditNeed(state: GameState, ice: CardInstance, broken: boolean[] = []): number {
  const need = plainCreditNeed(state, ice, broken);
  // Physarum Entangler: bypassing costs its credits, before any subroutine is broken
  const physarum = need > 0 && !broken.some(Boolean) ? physarumCost(state, ice) : undefined;
  return physarum !== undefined ? Math.min(need, physarum) : need;
}

// Which subroutines end the run is read from the price rules' own condition (subroutineBlocks), not from the price:
// the hold count asked a tag's worth here only to learn it (Stage D item 1, brief 4.5; red team F7: 4.5 s of the
// count's 6.6 s on the seed-104 game). Same answers by construction (tests/subroutineFacts.test.ts)
function plainCreditNeed(state: GameState, ice: CardInstance, broken: boolean[] = []): number {
  const subs = plannedSubroutines(state, ice);
  const blocking = Math.max(0, subs.filter((s, i) => !broken[i] && subroutineBlocks(state, s.label)).length - botulusBreaks(state, ice));
  if (blocking === 0) return 0;
  const plan = bestBreakPlan(state, ice, blocking);
  const self = iceScript(ice)?.runnerBreakCost;
  if (self !== undefined) return Math.min(plan?.credits ?? BLOCK, blocking * self);
  if (isBioroid(ice) && state.runner.clicks >= bioroidBreakClicks(ice, blocking)) return 0;
  return plan ? plan.credits : BLOCK;
}

/**
 * Credits to keep for the rezzed ice the Runner still has to pass further
 * in on this run, from the position it is at now (BLOCK: some of it can't
 * be got past). Breaker boosts bought for the current encounter don't
 * carry over, so the ice ahead is costed without them.
 */
export function creditsAhead(state: GameState): number {
  const run = state.activeRun;
  const server = run ? state.corp.servers[run.server] : undefined;
  if (!run || !server || run.icePosition === null) return 0;
  const ice = iceCreditsAhead(state);
  // Manegarm Skunkworks: 5 credits on approach unless the clicks cover it
  const approach = approachCost(state, run.server, state.runner.clicks - bioroidClicks(state, server.ice.slice(0, run.icePosition)), Infinity);
  return ice + (approach?.credits ?? 0);
}

/** creditsAhead without the server's approach costs: just the rezzed ice further in. */
export function iceCreditsAhead(state: GameState): number {
  const run = state.activeRun;
  const server = run ? state.corp.servers[run.server] : undefined;
  if (!run || !server || run.icePosition === null) return 0;
  const outside: GameState = { ...state, activeRun: { ...run, encounter: null } };
  const inner = server.ice.slice(0, run.icePosition);
  const skip = bypassesAhead(outside, inner, !!run.encounter);
  return inner.reduce((sum, ice) => sum + (ice.isRezzed && !skip.has(ice.instanceId) ? iceCreditNeed(outside, ice) : 0), 0);
}

const S_DOBRADO = '34012';
export const ALARM_CLOCK = '34078';

/**
 * During a run, the ice further in that the Runner's bypasses will skip (plan.bypass;
 * rules 6.5.8a): the run's S-Dobrado or Alarm Clock while their encounter is still to
 * come, and rig bypasses not used yet. The current ice, if rezzed and not yet
 * encountered, counts as the next encounter (it is approached first, 6.9.2c).
 */
export function bypassesAhead(state: GameState, inner: CardInstance[], encountering: boolean): Set<string> {
  const run = state.activeRun;
  if (!plan().bypass || !run || run.icePosition === null) return new Set();
  const current = state.corp.servers[run.server]?.ice[run.icePosition];
  // Approaching (or just past) rezzed ice not being encountered: counted as encountered, to be safe
  const encounters = (run.runFlags?.encounters ?? 0) + (current?.isRezzed && !encountering ? 1 : 0);
  const options: RunOptions = {
    bypassFirst: run.eventCode === S_DOBRADO,
    alarmClock: run.runEffects.some(r => findRigCard(state, r.instanceId)?.cardCode === ALARM_CLOCK),
  };
  return runBypasses(state, run.server, options, { ice: [...inner].reverse(), encounters }).ids;
}

function findRigCard(state: GameState, id: string): CardInstance | undefined {
  return [...state.runner.rig.hardware, ...state.runner.rig.programs, ...state.runner.rig.resources].find(c => c.instanceId === id);
}

export const MANEGARM = '30042';

/**
 * What the rezzed upgrades in this server's root charge the Runner on
 * approaching it (rules 6.9.4g). Manegarm Skunkworks: "end the run unless
 * they either spend 2 clicks or pay 5 credits", a nested cost (rules
 * 1.16.11b) the Runner pays to keep the run going. `clicks` and `credits`
 * are what the Runner will have left by then. The cheaper way in, in
 * runScore's units (a click 1, a credit 0.6), and the credits it takes;
 * null when the Runner can pay neither.
 */
export function approachCost(state: GameState, serverId: string, clicks: number, credits: number): { cost: number; credits: number } | null {
  let cost = 0;
  let paid = 0;
  for (const card of state.corp.servers[serverId]?.root ?? []) {
    if (!card.isRezzed || card.cardCode !== MANEGARM) continue;
    const byClicks = clicks >= 2 ? 2 * runClick(state) : Infinity;
    const byCredits = credits - paid >= 5 ? spendCost(state, paid + 5) - spendCost(state, paid) : Infinity;
    if (byClicks === Infinity && byCredits === Infinity) return null;
    if (byClicks <= byCredits) clicks -= 2;
    else paid += 5;
    cost += Math.min(byClicks, byCredits);
  }
  return { cost, credits: paid };
}

/** Clicks the Runner must spend on these rezzed bioroids' run-ending subroutines, having no breaker for them. */
export function bioroidClicks(state: GameState, ice: CardInstance[]): number {
  let clicks = 0;
  for (const card of ice) {
    if (!card.isRezzed || !isBioroid(card)) continue;
    const blocking = plannedSubroutines(state, card).filter(s => subroutineBlocks(state, s.label)).length - botulusBreaks(state, card);
    if (blocking > 0 && !bestBreakPlan(state, card, blocking)) clicks += bioroidBreakClicks(card, blocking);
  }
  return clicks;
}

/** Clicks a bioroid's own ability takes to break `subCount` subroutines: one each, or the ice's own rate (Ansel 2.0: 2 clicks for up to 2). */
export function bioroidBreakClicks(ice: CardInstance, subCount: number): number {
  const own = iceScript(ice)?.clickBreak;
  return own ? Math.ceil(subCount / own.max) * own.clicks : subCount;
}

/**
 * Breaking the ice with its own ability: credits (N-Pot), or a click per subroutine (bioroids) at 1.5 a click as on
 * the base (not runClick: the click's worth reads the grip's draws, which read this price, a value loop; registry debt). A cost that can't be paid in full can't be used (rule 1.16.1): on the Runner's
 * own turn the bioroid's clicks must be clicks it still has (after the run's own click, before a run), so with the last
 * click gone there is no click-break (Gemini audit AI-RUNNER-BIOROID-LAST-CLICK). On the Corp's turn the Runner's
 * next turn is priced, so its clicks are not counted.
 */
function selfBreakPrice(state: GameState, ice: CardInstance, subCount: number): IcePrice {
  const credits = iceScript(ice)?.runnerBreakCost;
  if (credits !== undefined) return { credits: subCount * credits, value: 0 };
  if (!isBioroid(ice)) return BLOCKED;
  const clicks = bioroidBreakClicks(ice, subCount);
  if (state.activePlayer === 'runner' && clicks > (state.activeRun ? state.runner.clicks : state.runner.clicks - 1)) return BLOCKED;
  return { credits: 0, value: clicks * 1.5 };
}

/** Cards the Runner has already accessed (instance id -> card code), so it doesn't keep checking them. */
export type RunnerMemory = Map<string, string>;

/** Corp assets that punish the Runner for accessing or leaving them (the cards an empty-looking remote bluffs with). */
export function isTrap(code: string): boolean {
  const def = getCardDefinition(code);
  return def.type_code === 'asset' && /ambush|hostile/i.test(def.keywords ?? '') && code !== '35061'; // Idiosyncresis isn't sprung by access
}

/**
 * A trap that springs when the Runner accesses it (Urtica Cipher, Byte!, Esca), not one that fires on the Corp's turn
 * (Clearinghouse): once seen, never worth coming back to access (Gemini audit, 2026-11-01).
 */
export const accessTrap = (code: string): boolean => isTrap(code) && /when the runner accesses this/i.test(getCardDefinition(code).stripped_text ?? '');

/**
 * How likely an unknown installed Corp card is a trap rather than an
 * agenda, counted from the Corp's decklist: the traps still unaccounted for
 * against the traps and agendas still unaccounted for. Unaccounted for
 * means in HQ, R&D, facedown in Archives or installed facedown, and not
 * already accessed by the Runner. Cards that come back to HQ or R&D count
 * again; once every trap is accounted for the odds are 0.
 */
export function trapOdds(state: GameState, memory?: RunnerMemory): number {
  const { traps, agendas } = unseenTraps(state, memory);
  return traps.length + agendas > 0 ? traps.length / (traps.length + agendas) : 0;
}

/** The traps (codes) and agendas (count) still unaccounted for, as trapOdds counts them: the decklist less what is public or seen. */
function unseenTraps(state: GameState, memory?: RunnerMemory): { traps: string[]; agendas: number } {
  const corp = state.corp;
  const installed = Object.values(corp.servers).flatMap(server => server.root.filter(c => !c.isRezzed && !c.faceUp));
  const hidden = [...corp.hq, ...corp.rd, ...corp.archives.faceDown, ...installed];
  // The cards it has seen come out by the code it saw, not by whichever code their instance holds now: a planner deal
  // re-deals the hidden cards among their instances (the threat's on-hit audit read the re-dealt code)
  const codes = hidden.map(c => c.cardCode);
  for (const card of hidden) {
    const seen = memory?.get(card.instanceId);
    if (seen === undefined) continue;
    const at = codes.indexOf(seen);
    if (at >= 0) codes.splice(at, 1);
  }
  const traps = codes.filter(isTrap);
  const agendas = codes.filter(c => getCardDefinition(c).type_code === 'agenda').length;
  return { traps, agendas };
}

/**
 * What accessing an unknown installed card costs the Runner if it is a trap: the access damage (accessDamage, card
 * text) of each trap still unseen in the decklist, priced by damageWorth at the grip at the access, averaged. With
 * advancement counters on it, only the traps that can be advanced fit. Rules 10.4.4 (more damage than the grip
 * flatlines). Replaces the flat 2 + advancements guess (Byte! does 3, ai-runner-fixes round 2).
 */
export function trapHit(state: GameState, advancements: number, grip: number, memory?: RunnerMemory): number {
  const pool = fittingTraps(state, advancements, memory);
  if (pool.length === 0) return 0;
  return pool.reduce((n, c) => n + damageWorth(state, accessDamage(state, c, advancements), false, grip), 0) / pool.length;
}

const fittingTraps = (state: GameState, advancements: number, memory?: RunnerMemory): string[] =>
  unseenTraps(state, memory).traps.filter(c => advancements === 0 || /you can advance this/i.test(getCardDefinition(c).stripped_text ?? ''));

/** The most an unknown installed card with `advancements` counters could do on access, from the same unseen traps. */
export function trapDamageMax(state: GameState, advancements: number, memory?: RunnerMemory): number {
  return fittingTraps(state, advancements, memory).reduce((n, c) => Math.max(n, accessDamage(state, c, advancements)), 0);
}

/**
 * Run scoring in the model's units (Jeff, 2026-10-28): stealing p points is
 * worth what they add to the Runner's score on the point clock, plus a share
 * of what they would have added to the Corp's (an agenda stolen is one the
 * Corp doesn't score). The share is larger in a remote, where the Corp is
 * about to score it.
 */
export const DENY = { remote: 0.6, central: 0.3 };

function stealWorth(state: GameState, points: number, deny: number): number {
  const runner = pointValue(state.runner.score + points) - pointValue(state.runner.score);
  const corp = pointValue(state.corp.score + points) - pointValue(state.corp.score);
  return runner + deny * corp;
}

/** Chance an unseen card in a remote's root is an agenda (Jeff: higher the more the Corp has put into the server). */
export function remoteAgendaOdds(state: GameState, server: { ice: CardInstance[] }, card: CardInstance, trap: number): number {
  if (card.advancementCounters > 0) return Math.max(0, 1 - trap);
  // plan.oneAgendaGuess (code audit cleanup item 9): the board's own odds for a facedown card (evaluate hiddenCardOdds,
  // the same unseen pool), so the Runner's run choice and its board score start from one guess
  if (plan().oneAgendaGuess) return iceBump(hiddenCardOdds(state).agenda, server);
  const corp = [...state.corp.hq, ...state.corp.rd, ...state.corp.archives.faceDown, ...Object.values(state.corp.servers).flatMap(s => s.root.filter(c => !c.isRezzed && !c.faceUp && !c.runnerKnows))];
  const kinds = corp.map(c => cardDef(c).type_code);
  const agendas = kinds.filter(t => t === 'agenda').length;
  const roots = kinds.filter(t => t === 'agenda' || t === 'asset' || t === 'upgrade').length;
  return iceBump(roots > 0 ? agendas / roots : 0, server);
}

/** Ice in front of it: the Corp guards agendas more than assets. */
const iceBump = (base: number, server: { ice: CardInstance[] }) => Math.min(0.9, base + (1 - base) * Math.min(0.45, 0.15 * server.ice.length));

/**
 * The R&D accesses priced card by card from what the Runner remembers (rules
 * 7.4.7a: R&D is accessed from the top down): a remembered card counts by
 * the share of its possible places this position is, the rest of each place
 * by the odds for an unseen card. Remembered non-agendas are worth nothing
 * here, so a second run on the same top cards is not worth making.
 */
function rdWorth(state: GameState, accesses: number, odds: number, central: number, from = 0, grip = state.runner.grip.length): number {
  const known = knownInRd(state);
  let value = 0;
  for (let i = from; i < Math.min(from + accesses, state.corp.rd.length); i++) {
    let seen = 0;
    for (const e of known) {
      if (i < e.lo || i > e.hi) continue;
      const share = 1 / (e.hi - e.lo + 1);
      seen += share;
      const def = getCardDefinition(e.code);
      if (def.type_code === 'agenda') value += share * (stealWorth(state, def.agenda_points ?? 1, DENY.central) - knownStealHit(state, e.code, grip));
    }
    value += Math.max(0, 1 - seen) * odds * central;
  }
  return value;
}

/**
 * Share of the deck's agenda odds a facedown card in an Archives with no ice keeps (plan.archivesChosen).
 * Jeff (2026-11-04): Vic still ran Archives far too often against Startup Regards. Measured in self-play
 * (Vic vs Startup Regards 6 games, Kessleroid vs Big Brain 4): 33 Archives runs for 0 steals, 0 agendas
 * among the 57 facedown cards there. 0.3 -> 0.05: a Corp flooded with agendas still discards one now and then.
 */
const ARCHIVES_CHOSEN_ODDS = 0.05;
/**
 * The same with ice on Archives: the AI Corp discards the same way behind ice (the 57 included cards behind
 * ice, which the Runner still valued at the deck's full agenda odds); a human Corp may trust ice a little more.
 */
const ARCHIVES_CHOSEN_ODDS_ICED = 0.1;

/** serverValue in credits. */
/** Stands in for an agenda the Runner can't see: only other cards' additional costs to steal count (Magistrate Revontulet). */
const UNSEEN_AGENDA = { instanceId: '', cardCode: '' } as CardInstance;

/**
 * The additional costs to steal an agenda on this server (rules 1.16.10a-b;
 * the engine's stealCost: Méliès City Luxury Line's click, only once the
 * Runner knows the card, and Magistrate Revontulet's 3 credits), priced for
 * what the Runner will have left at the access: its clicks after the run's
 * own, and its credits after the rezzed ice. Null: it can't pay them all, so
 * it can't steal (plan.stealCosts; Gemini audit, 2026-11-01).
 */
export function stealTax(state: GameState, serverId: string, agenda: CardInstance = UNSEEN_AGENDA): number | null {
  const cost = stealCost(state, agenda);
  if (!cost.clicks && !cost.credits) return 0;
  const server = state.corp.servers[serverId];
  const clicks = state.activeRun ? state.runner.clicks : state.runner.clicks - 1 - bioroidClicks(state, server?.ice ?? []);
  const ice = state.activeRun || !server ? 0 : server.ice.reduce((n, c) => n + (c.isRezzed ? icePrice(state, c).credits : 0), 0);
  const credits = (state.activeRun ? availableCredits(state, 'runner') : runBudget(state)) - ice;
  if (clicks < cost.clicks || credits < cost.credits) return null;
  return cost.clicks * clickRate() + creditCost(state, cost.credits);
}

/**
 * plan.knownHq (Jeff, 2026-11-04: against a Teia with an open HQ the Runner kept running it for nothing):
 * the chance a random HQ access is an agenda, counting the cards the Runner knows are in HQ (accessed there,
 * or revealed) at what they are and only the rest at the deck's odds. Without it every HQ card was a
 * random unseen card however often the Runner had looked.
 */
export function hqAgendaOdds(state: GameState, odds: number): number {
  const size = state.corp.hq.length;
  if (size === 0) return odds;
  const known = knownInHand(state, 'corp').slice(-size);
  const agendas = known.filter(k => getCardDefinition(k.code).type_code === 'agenda').length;
  return (agendas + (size - known.length) * odds) / size;
}

/** A steal's worth less its additional costs (0 when they can't be paid). */
const taxedSteal = (worth: number, tax: number | null) => (tax === null ? 0 : Math.max(0, worth - tax));

/**
 * What is still to come in a breach under way (rules 7.3.4: candidates are chosen one at a time until none is left),
 * as counts and the cards the Runner has seen, never which unseen card comes next: the root cards not chosen yet, how
 * many more cards the zone gives (7.3.5: the random access limit is set when the breach begins; 7.3.5c: a chosen
 * candidate counts toward it) and, for R&D, how far down the next one is (7.4.1c, 7.4.7: top down).
 */
interface BreachRest {
  root: Set<string>;
  zoneLeft: number;
  chosen: Set<string>;
}

function breachRest(state: GameState): BreachRest | undefined {
  const run = state.activeRun;
  if (!run?.breached || !run.breach) return undefined;
  // The card a prompt is about is being accessed now: not still to come
  const prompt = activePrompt(state);
  const current = prompt && 'cardInstanceId' in prompt ? prompt.cardInstanceId : undefined;
  return {
    root: new Set(run.breach.root.filter(id => id !== current)),
    zoneLeft: run.breach.zoneLeft,
    chosen: new Set([...run.breach.chosen, ...(current ? [current] : [])]),
  };
}

/**
 * What an agenda's own damage on being stolen costs the Runner (Fujii Asset Retrieval: "When this agenda is scored or
 * stolen, do 2 net damage"), at the grip it holds then: an accessed agenda must be stolen (rule 1.17.3d), and damage more
 * than the grip flatlines (10.4.4). An unseen agenda is any one still to find (agendaOdds `onSteal`, from the decklist).
 * Priced by damageWorth, with no draw-back: no click comes between the ice and the access.
 */
function stealHit(state: GameState, grip: number): number {
  const { onSteal } = agendaOdds(state);
  if (onSteal.length === 0) return 0;
  return onSteal.reduce((n, d) => n + (d > 0 ? damageWorth(state, d, false, grip) : 0), 0) / onSteal.length;
}
function knownStealHit(state: GameState, code: string, grip: number): number {
  const d = stealDamage(code);
  return d > 0 ? damageWorth(state, d, false, grip) : 0;
}
/** A steal less its own damage: none when it can't be stolen (an additional cost it can't pay, `tax` null). */
const stealNet = (worth: number, tax: number | null, hit: number) => (tax === null ? 0 : taxedSteal(worth, tax) - hit);

function serverWorth(state: GameState, serverId: string, extraAccesses: number, memory: RunnerMemory | undefined, wary: boolean, repeat: number, rest?: BreachRest, grip = state.runner.grip.length): number {
  const server = state.corp.servers[serverId];
  const { odds, points } = agendaOdds(state);
  const unseenTax = stealTax(state, serverId);
  const hit = stealHit(state, grip);
  const central = stealNet(stealWorth(state, points, DENY.central), unseenTax, hit);
  let value = 0;
  if (serverId === 'rd') {
    // In a breach: the cards left to the random access limit, from below the ones already chosen (a count only)
    value = rest ? rdWorth(state, rest.zoneLeft, odds, central, state.corp.rd.filter(c => rest.chosen.has(c.instanceId)).length, grip) : rdWorth(state, 1 + extraAccesses, odds, central, 0, grip);
  }
  else if (serverId === 'hq') {
    const unchosen = rest ? state.corp.hq.filter(c => !rest.chosen.has(c.instanceId)).length : state.corp.hq.length;
    const accesses = rest ? rest.zoneLeft : 1 + extraAccesses;
    value = unchosen === 0 ? 0 : Math.min(accesses, unchosen) * hqAgendaOdds(state, odds) * central * 0.5 ** repeat;
  }
  else if (serverId === 'archives') {
    if (repeat > 0) return 0;
    const faceUp = state.corp.archives.faceUp.filter(c => cardDef(c).type_code === 'agenda' && !rest?.chosen.has(c.instanceId));
    // plan.archivesChosen (Jeff, bug report #5): facedown cards are ones the Corp chose to put there (discards,
    // Hansei Review); a Corp rarely chooses an agenda, with or without ice there
    const chosen = state.corp.servers.archives.ice.length === 0 ? ARCHIVES_CHOSEN_ODDS : ARCHIVES_CHOSEN_ODDS_ICED;
    value = faceUp.reduce((n, c) => n + stealNet(stealWorth(state, cardDef(c).agenda_points ?? 1, 0), stealTax(state, serverId, c), knownStealHit(state, c.cardCode, grip)), 0) + Math.min(3, state.corp.archives.faceDown.length) * odds * chosen * stealNet(stealWorth(state, points, 0), unseenTax, hit);
  }
  if (repeat > 0 && server.isRemote) return 0;
  const trap = wary ? trapOdds(state, memory) : 1 / 3;
  for (const card of server.root) {
    if (rest && !rest.root.has(card.instanceId)) continue;
    if (card.faceUp && cardDef(card).type_code === 'agenda') {
      // A faceup agenda: a sure steal, public to both sides. Under BANGUN it costs 2 meat damage and a tag;
      // installed faceup by its own text (Sacrifice Zone Expansion, rules 3.2.3a) it costs nothing extra
      const bangun = state.corp.identity.cardCode === BANGUN;
      if (bangun && state.runner.grip.length < 2) return 0;
      const tax = stealTax(state, serverId, card);
      if (tax === null) continue;
      value += stealWorth(state, cardDef(card).agenda_points ?? 1, DENY.remote) - tax - knownStealHit(state, card.cardCode, grip) - (bangun ? damageWorth(state, 2, false, grip) + tagCost(state) : 0);
      continue;
    }
    if (!card.isRezzed && memory?.has(card.instanceId)) {
      // Seen it: only worth coming back to trash it, and never into a known trap
      if (accessTrap(card.cardCode)) return 0;
      // An agenda left behind (its additional cost to steal unpaid, Méliès City Luxury Line): back for it when it can pay
      if (cardDef(card).type_code === 'agenda') {
        value += stealNet(stealWorth(state, cardDef(card).agenda_points ?? 1, DENY.remote), stealTax(state, serverId, card), knownStealHit(state, card.cardCode, grip));
        continue;
      }
      const trash = cardDef(card).trash_cost;
      if (trash != null && trash <= state.runner.credits) value += Math.max(0, corpCardValue(card, state, 'runner', true) - creditCost(state, trash));
    } else if (!card.isRezzed) {
      const agenda = remoteAgendaOdds(state, server, card, trap);
      // Not an agenda: a trap (Urtica: 2 net damage plus its counters) or an asset to trash
      const trapShare = Math.min(1 - agenda, trap);
      // plan.oneAgendaGuess: the points of the agendas still unseen, as the board counts them (not the whole decklist's)
      const hiddenPoints = plan().oneAgendaGuess ? hiddenCardOdds(state).agendaPoints : points;
      value += agenda * stealNet(stealWorth(state, hiddenPoints, card.advancementCounters > 0 ? DENY.remote : DENY.central), unseenTax, hit) - trapShare * trapHit(state, card.advancementCounters, grip, memory) + (1 - agenda - trapShare) * 1;
    } else {
      const trash = cardDef(card).trash_cost;
      // Trashing it denies the Corp what it would still pay if left (RUNNER-ASSET-TRASH: the worth as left, corpCardValue's
      // `left`, not discounted by the Runner's own chance of trashing it, which is this choice; rule 1.19.2: an accessed
      // card with a trash cost may be trashed by paying it)
      if (trash != null && trash <= state.runner.credits) value += Math.max(0.5, corpCardValue(card, state, 'runner', true) - creditCost(state, trash));
    }
  }
  return value;
}

/** What accessing this server is worth to the Runner right now. */
export function serverValue(state: GameState, serverId: string, extraAccesses = 0, memory?: RunnerMemory, wary = false, rest?: BreachRest, grip?: number): number {
  const server = state.corp.servers[serverId];
  if (!server) return 0;
  // The run in progress is already listed (as not yet successful): only earlier runs count
  const earlier = state.activeRun ? state.runsThisTurn.slice(0, -1) : state.runsThisTurn;
  const priorRuns = earlier.filter(r => r.server === serverId);
  if (priorRuns.some(r => !r.successful)) return 0; // it stopped us once already this turn
  const repeat = priorRuns.length;
  // Priced in credits on the point clock (plan.runModel, 2026-10-28; the older flat table was deleted 2026-11-06)
  return serverWorth(state, serverId, extraAccesses, memory, wary, repeat, rest, grip);
}

/** A remote worth running that the Runner's hand is too small to risk (draw first). */
export function needsBiggerHand(state: GameState, memory?: RunnerMemory): boolean {
  return Object.values(state.corp.servers).some(server =>
    server.root.some(
      c => !c.isRezzed && !memory?.has(c.instanceId) && c.advancementCounters > 0 && trapDamageMax(state, c.advancementCounters, memory) > state.runner.grip.length
    )
  );
}

export interface RunOptions {
  bonusCredits?: number;
  extraAccesses?: number;
  /** Tread Lightly: unrezzed ice costs 3 more to rez, so it's less likely to be rezzed. */
  rezTax?: boolean;
  /** Worth (in credits) the run's card adds if the run is successful, beyond the breach. */
  successBonus?: number;
  /**
   * Credits the Runner gains if the run is successful (Clean Getaway, Transfer of Wealth, Red Team), priced on the
   * credit slide like the credits the run costs (plan.runCreditsSlide; Jeff, 2026-11-05): a broke Runner's 6 credits
   * from Clean Getaway are worth more than 6, a rich one's less. With the flag off they count flat.
   */
  successCredits?: number;
  /** Shred: the first "end the run" is prevented unless the Corp trashes cards from HQ. */
  shred?: boolean;
  /** Aircheck: only the run's own credits can be spent, not the pool. */
  poolLocked?: boolean;
  /** Baker: with a stealth credit, the run on Archives can approach HQ or R&D instead after its ice. */
  baker?: boolean;
  /** Eru, Beatriz, Maintenance Access: a successful run breaches this server instead (with extraAccesses there). */
  breachAs?: string;
  /** S-Dobrado: the first ice encountered is bypassed (plan.bypass). */
  bypassFirst?: boolean;
  /** Alarm Clock's run: the first ice encountered can be bypassed for 2 clicks (plan.bypass). */
  alarmClock?: boolean;
  /** Window of Opportunity: a rezzed ice is derezzed as the run begins (plan.bypass). */
  derezOne?: boolean;
  /** Privileged Access, Burner: a successful run breaches nothing (its worth is successBonus). */
  noBreach?: boolean;
  /** Deck-aware AI: weigh trap risk by the traps this Corp may still have (see trapOdds). */
  wary?: boolean;
  memory?: RunnerMemory;
}

const MALANDRAGEM = '34081';
const LASER_POINTER = '34016';
const CURUPIRA = '34015';
const FRANSOFIA_WARD = '35021';

/** The ice on a run the Runner bypasses (rules 6.5.8a: no subroutines resolve), and what the bypasses cost it in credits' worth. */
export interface Bypasses {
  ids: Set<string>;
  price: number;
}

/**
 * The bypasses the Runner would use on a run on this server (plan.bypass):
 * S-Dobrado's on the first ice encountered, which is the outermost rezzed
 * ice (unrezzed ice is only encountered if rezzed on approach, 6.9.2c), and
 * at threat 4 a click for the next; then each bypass card in the rig on the
 * rezzed ice it fits where it saves more than it costs, greediest first.
 * Rig bypasses fit only rezzed ice: the Runner can't see what unrezzed ice is.
 * Physarum Entangler is in iceCost (it bypasses its host on every encounter).
 */
export function runBypasses(state: GameState, serverId: string, options: RunOptions = {}, ahead?: { ice: CardInstance[]; encounters: number }): Bypasses {
  const out: Bypasses = { ids: new Set(), price: 0 };
  const server = state.corp.servers[serverId];
  if (!plan().bypass || !server) return out;
  // Before the run: all of its ice; during it, the ice still ahead (outermost first) after the encounters so far
  const outward = ahead?.ice ?? [...server.ice].reverse();
  const done = ahead?.encounters ?? 0;
  const rezzed = outward.filter(ice => ice.isRezzed);
  // The click S-Dobrado or Alarm Clock spends; before the run the play's click is spent too
  const clicks = state.runner.clicks - (ahead ? 0 : 1);
  if (options.bypassFirst) {
    if (done === 0) {
      const first = rezzed[0] ?? (ahead ? undefined : outward[0]);
      if (first) out.ids.add(first.instanceId);
    }
    // Threat 4: the second ice encountered, for a click
    const second = done === 0 ? rezzed[1] : done === 1 ? rezzed[0] : undefined;
    if (second && (done === 1 || rezzed[0]) && threatLevel(state) >= 4 && clicks >= 1 && iceCost(state, second) > runClick(state)) {
      out.ids.add(second.instanceId);
      out.price += runClick(state);
    }
  }
  // Alarm Clock's run: the first ice encountered, for 2 clicks
  if (options.alarmClock && done === 0 && rezzed[0] && clicks >= 2 && iceCost(state, rezzed[0]) > 2 * runClick(state)) {
    out.ids.add(rezzed[0].instanceId);
    out.price += 2 * runClick(state);
  }
  const uses: { fits: (ice: CardInstance) => boolean; price: number; uses: number }[] = [];
  for (const card of [...state.runner.rig.programs, ...state.runner.rig.resources]) {
    if (card.cardCode === MALANDRAGEM && counters(card, 'power') > 0 && turnFlag(state, `once:${card.instanceId}:0`) === 0) {
      uses.push({ fits: ice => iceStrength(state, ice) <= 3, price: counterWorthOf(state, MALANDRAGEM, 'power'), uses: 1 });
    } else if (card.cardCode === MALANDRAGEM && threatLevel(state) >= 4) {
      uses.push({ fits: () => true, price: runnerEffect(state, MALANDRAGEM, card) ?? 1, uses: 1 });
    }
    if (card.cardCode === LASER_POINTER) {
      uses.push({ fits: ice => /\b(ap|destroyer|observer)\b/i.test(cardDef(ice).keywords ?? ''), price: runnerEffect(state, LASER_POINTER, card) ?? 2, uses: 1 });
    }
    if (card.cardCode === CURUPIRA && counters(card, 'power') >= 3) {
      uses.push({ fits: ice => iceSubtypes(ice, state).includes('barrier'), price: 3 * counterWorthOf(state, CURUPIRA, 'power'), uses: Math.floor(counters(card, 'power') / 3) });
    }
    if (card.cardCode === FRANSOFIA_WARD && state.corp.credits >= 15) {
      uses.push({ fits: () => true, price: runnerEffect(state, FRANSOFIA_WARD, card) ?? 3, uses: 1 });
    }
  }
  for (const use of uses) {
    for (let n = 0; n < use.uses; n++) {
      let best: { ice: CardInstance; saving: number } | undefined;
      for (const ice of outward) {
        if (!ice.isRezzed || out.ids.has(ice.instanceId) || !use.fits(ice)) continue;
        const cost = iceCost(state, ice);
        const saving = (cost === BLOCK ? 100 : cost) - use.price;
        if (saving > 0 && (!best || saving > best.saving)) best = { ice, saving };
      }
      if (!best) break;
      out.ids.add(best.ice.instanceId);
      out.price += use.price;
    }
  }
  return out;
}

/**
 * Window of Opportunity: the rezzed ice it derezzes as the run begins (6.9.1c), the
 * one costing the Runner most. Ice the Corp can't pay to rez again is not
 * encountered (6.9.2c); ice it can rez again costs the Corp its rez cost.
 */
export function windowDerez(state: GameState, serverId: string): { ice: CardInstance; rerez: boolean } | undefined {
  const rezzed = (state.corp.servers[serverId]?.ice ?? []).filter(ice => ice.isRezzed);
  const ranked = rezzed.map(ice => ({ ice, cost: iceCost(state, ice) })).sort((a, b) => b.cost - a.cost);
  const top = ranked[0];
  if (!top) return undefined;
  return { ice: top.ice, rerez: state.corp.credits >= rezCost(state, top.ice) };
}

/**
 * Credits the Runner is short of getting past the rezzed ice on this
 * server (0 or less: it can afford it now). Null when some rezzed ice
 * can't be got past at any price (no breaker for an end-the-run).
 */
export function runShortfall(state: GameState, serverId: string): number | null {
  const server = state.corp.servers[serverId];
  if (!server) return null;
  let known = 0;
  const bypassed = runBypasses(state, serverId);
  for (const ice of server.ice) {
    if (!ice.isRezzed || bypassed.ids.has(ice.instanceId)) continue;
    // Credits only: what the ice costs in other forms is not short of any credits (RUNNER-BUDGET-UNITS)
    const { credits } = icePrice(state, ice);
    if (credits === BLOCK) return null;
    known += credits;
  }
  // Manegarm Skunkworks: 5 credits too when a run won't leave 2 clicks for it
  if (state.runner.clicks - 1 - bioroidClicks(state, server.ice) < 2) known += 5 * server.root.filter(c => c.isRezzed && c.cardCode === MANEGARM).length;
  return known - runBudget(state);
}

/**
 * Credits a run on this server is expected to spend getting in (plan.plannerRunCredits): what the rezzed ice it
 * doesn't bypass needs to be got past, less the run's own credits, and Manegarm's toll when paid in credits.
 */
export function runCreditSpend(state: GameState, serverId: string, options: RunOptions = {}): number {
  const server = state.corp.servers[serverId];
  if (!server) return 0;
  const bypassed = runBypasses(state, serverId, options);
  let need = 0;
  for (const ice of server.ice) {
    if (!ice.isRezzed || bypassed.ids.has(ice.instanceId)) continue;
    const n = iceCreditNeed(state, ice);
    if (n !== BLOCK) need += n;
  }
  need = Math.max(0, need - (options.bonusCredits ?? 0));
  const approach = approachCost(state, serverId, state.runner.clicks - 1 - bioroidClicks(state, server.ice), runBudget(state) - need);
  return need + (approach?.credits ?? 0);
}

/**
 * The accesses the Runner's rig can add when it breaches `serverId`, and what they spend: one per card whose entry has a
 * breachAccess for that server and a counter left to spend (rules 7.3.5b: an ability that lets the Runner access
 * additional cards raises the breach's access limit; R&D is accessed from the top down, 7.4.7), the counter priced at its worth.
 */
export function breachAccesses(state: GameState, serverId: string): { accesses: number; cost: number } {
  let accesses = 0;
  let cost = 0;
  for (const card of [...state.runner.rig.programs, ...state.runner.rig.hardware, ...state.runner.rig.resources]) {
    const use = breachAccessOf(card.cardCode);
    if (!use || use.server !== serverId || counters(card, use.counter) <= 0) continue;
    accesses++;
    cost += counterWorth(state, card, use.counter);
  }
  return { accesses, cost };
}

/**
 * How good a run on this server is now, net of the click and expected costs.
 * -Infinity when the Runner can't get in.
 */
/**
 * Each ice's way past on one run, with the tanks together survived (rules 9.8.7b, 10.4.4): icePrice, and while the
 * rezzed ice's tank damage adds up to more than the grip, the tank whose break costs least more per card saved is
 * broken instead (its `noDamage` price). Null when no choice leaves the damage within the grip.
 */
function runPrices(state: GameState, ices: CardInstance[]): Map<string, IcePrice> | null {
  const prices = new Map(ices.map(ice => [ice.instanceId, icePrice(state, ice)] as const));
  const damageOf = () => ices.reduce((n, ice) => n + (ice.isRezzed ? prices.get(ice.instanceId)!.damage ?? 0 : 0), 0);
  for (let damage = damageOf(); damage > state.runner.grip.length; damage = damageOf()) {
    const options = ices
      .filter(ice => ice.isRezzed && prices.get(ice.instanceId)!.noDamage)
      .map(ice => {
        const p = prices.get(ice.instanceId)!;
        return { ice, alt: p.noDamage!, extra: (total(p.noDamage!) - total(p)) / (p.damage ?? 1) };
      })
      .sort((a, b) => a.extra - b.extra);
    if (options.length === 0) return null;
    prices.set(options[0].ice.instanceId, options[0].alt);
  }
  return prices;
}

export function runScore(state: GameState, serverId: string, options: RunOptions = {}): number {
  const server = state.corp.servers[serverId];
  if (!server) return -Infinity;
  const breachId = options.breachAs ?? serverId;
  // Extra accesses the rig can add at the breach (Devadatta Drone on R&D; RUNNER-BREACH-EXTRA-ACCESS), each charged the counter it spends
  const rigAccess = options.noBreach ? { accesses: 0, cost: 0 } : breachAccesses(state, breachId);
  // Bypassed ice costs nothing to pass (rules 6.5.8a); Window of Opportunity's derezzed ice is
  // passed unencountered unless the Corp rezzes it again (6.9.2b-c), which costs it the rez
  const bypassed = runBypasses(state, serverId, options);
  const derez = options.derezOne && plan().bypass ? windowDerez(state, serverId) : undefined;
  if (derez && !derez.rerez) bypassed.ids.add(derez.ice.instanceId);
  // The way past each ice, and the grip at the access: less the damage of the rezzed ice it lets resolve (a steal's own
  // damage meets that grip). More damage over the whole way in than the grip holds is a flatline before the access
  // (10.4.4), however each ice reads alone: the Runner breaks instead of tanking where that costs least, until the rest
  // is survived, and only with no such choice is the run barred (review note on ai-runner-fixes)
  const prices = runPrices(state, server.ice.filter(ice => !bypassed.ids.has(ice.instanceId)));
  if (!prices) return -Infinity;
  const iceDamage = [...prices.values()].reduce((n, p) => n + (p.damage ?? 0), 0);
  const grip = state.runner.grip.length - iceDamage;
  const breached = options.noBreach ? 0 : serverValue(state, breachId, (options.extraAccesses ?? 0) + rigAccess.accesses, options.memory, options.wary, undefined, grip) - rigAccess.cost;
  const gained = options.successCredits ?? 0;
  const credits = gained > 0 && plan().runCreditsSlide ? gained * payoutSlide(state, 'runner', gained) : gained;
  let value = breached + ((options.successBonus ?? 0) + credits);
  if (options.baker && serverId === 'archives' && runStealthCredits(state) >= 1) {
    // Baker: after Archives' ice, a stealth credit turns the run on HQ or R&D, whose ice it skipped
    const redirect = Math.max(...['hq', 'rd'].map(id => serverValue(state, id, 0, options.memory, options.wary, undefined, grip)));
    value = Math.max(value, redirect - spendCost(state, 1));
  }
  // One net damage from flatlining. plan.emptyGripRuns (2026-11-06, thread "Find why self-play games end decked"): with an
  // empty grip that damage is a flatline only as often as the Corp has a hit to land (flatlineOdds), not every time; priced as
  // a sure flatline, every run scored below zero, and a Runner with no cards left in grip or Stack never ran again while the
  // Corp decked out (rules 4.2.7b, 10.4.4)
  if (state.runner.grip.length === 0) value -= 0.25 * flatlineWorth(state) * flatlineOdds(state, 0);
  else if (state.runner.grip.length <= 1) value -= 0.25 * damageWorth(state, 1);
  if (value <= 0) return -Infinity;
  let known = 0;
  let expected = 0;
  let shredLeft = !!options.shred && server.root.length > 0;
  const budget = (options.poolLocked ? runBudget(state) - availableCredits(state, 'runner') : runBudget(state)) + (options.bonusCredits ?? 0);
  // Runner (rez allowance): credits paid on the way in are lost if unrezzed ice further in is rezzed and can't be paid for
  let paidOutside = 0;
  let waste = 0;
  const canRez = state.corp.credits >= (options.rezTax ? 4 : 1);
  if (derez?.rerez) value += 0.5 * rezCost(state, derez.ice); // the Corp pays it about half the time
  for (const ice of [...server.ice].reverse()) {
    if (bypassed.ids.has(ice.instanceId)) continue;
    if (ice.isRezzed) paidOutside += Math.min(iceCreditNeed(state, ice), budget);
    else if (canRez && paidOutside > 0) {
      const spare = budget - paidOutside;
      waste += paidOutside * (spare < 2 ? 0.5 : spare < 4 ? 0.25 : 0.1);
    }
  }
  // RUNNER-BUDGET-UNITS: the credits the ice takes are checked against the budget and priced on the credit slide; what
  // it costs in other forms (subroutines let through, a bioroid's clicks, counters) is priced once, beside them
  let lost = 0;
  for (const ice of server.ice) {
    if (bypassed.ids.has(ice.instanceId)) continue;
    let price = prices.get(ice.instanceId) ?? icePrice(state, ice);
    if (total(price) === BLOCK && shredLeft) {
      // The Corp either lets the run go on or trashes HQ cards: worth it either way
      shredLeft = false;
      price = { credits: 0, value: 1 };
    }
    if (total(price) === BLOCK) return -Infinity;
    const share = !ice.isRezzed && options.rezTax ? 0.3 : 1;
    if (ice.isRezzed) known += price.credits;
    expected += share * price.credits;
    lost += share * (price.value + (ice.isRezzed ? 0 : unrezzedDamageRisk(state, ice)));
  }
  if (known > budget) return -Infinity;
  // Known costs of approaching the server, after the ice (Manegarm Skunkworks)
  const approach = approachCost(state, serverId, state.runner.clicks - 1 - bioroidClicks(state, server.ice), budget - known);
  if (!approach) return -Infinity;
  const paid = Math.max(0, expected - (options.bonusCredits ?? 0));
  return value - spendCost(state, paid) - lost - spendCost(state, waste) - approach.cost - runClick(state) - bypassed.price;
}

/**
 * What the rest of a run in progress is still worth to the Runner (plan.runRest; Jeff, 2026-11-05, thread
 * "Find why AI card valuation misses cards"): the breach, less what the ice still ahead will cost to get past
 * (none if some of it can't be). A choice made during a run (pay or end the run, gain credits, derez or skip
 * an ice further in) changes this; the board alone never saw it, only that the run was still going.
 */
export function runRestWorth(state: GameState, memory?: RunnerMemory, wary?: boolean): number {
  const run = state.activeRun;
  if (!run || run.isJackedOut) return 0;
  const server = state.corp.servers[run.server];
  if (!server) return 0;
  const pos = run.icePosition;
  // Ice not yet passed: further in, and the one being approached (an encounter in progress is priced by its own answer)
  const ahead = server.ice.filter((_, i) => pos === null || i < pos || (i === pos && run.phase === 'approach_ice'));
  let credits = 0;
  let lost = 0;
  let damage = 0;
  const prices = runPrices(state, ahead);
  if (!prices) return 0; // a flatline on the way in whatever is broken (10.4.4)
  for (const ice of ahead) {
    const price = prices.get(ice.instanceId)!;
    if (total(price) === BLOCK) return 0;
    credits += price.credits;
    lost += price.value + (ice.isRezzed ? 0 : unrezzedDamageRisk(state, ice));
    if (ice.isRezzed) damage += price.damage ?? 0;
  }
  // Once the breach has begun, only what is still to come (the cards already accessed, and the one a prompt is about, are
  // priced by their own answers: counted here too they were a double count, the 0.8 in scoreOutcome partly hiding it)
  if (damage > state.runner.grip.length) return 0; // a flatline on the way in (10.4.4)
  return Math.max(0, serverValue(state, run.server, run.extraAccesses, memory, wary, breachRest(state), state.runner.grip.length - damage) - spendCost(state, credits) - lost);
}

const CHAIN_REACTION = '36001';
const CENTRALS = ['hq', 'rd', 'archives'];

/**
 * Chain Reaction (plays only after successful runs on HQ, R&D and Archives
 * this turn): the share of its worth a run on one of the centrals still
 * needed earns, while the clicks left cover the other runs and the play.
 * Its worth: the 2 Corp cards it trashes (rezzed ice at its rez cost and the install to replace it, other
 * cards as the Runner prices them), less the cheapest Runner card the Corp trashes back.
 */
export function chainReactionBonus(state: GameState, serverId: string): number {
  if (!state.runner.grip.some(c => c.cardCode === CHAIN_REACTION) || !CENTRALS.includes(serverId)) return 0;
  const needed = CENTRALS.filter(id => !state.runsThisTurn.some(r => r.server === id && r.successful));
  if (!needed.includes(serverId) || state.runner.clicks < needed.length + 1 || state.runner.credits < 1) return 0;
  const installed = Object.values(state.corp.servers).flatMap(s => [...s.ice, ...s.root]);
  const worth = installed
    // Rezzed ice: the Corp pays its rez cost, a click and an install again to replace it
    .map(c => (!c.isRezzed ? 1.5 : cardDef(c).type_code === 'ice' ? (cardDef(c).cost ?? 0) + 2 : corpCardValue(c, state, 'runner', true)))
    .sort((a, b) => b - a);
  const mine = [...state.runner.rig.programs, ...state.runner.rig.hardware, ...state.runner.rig.resources].map(c => cardDef(c).cost ?? 0);
  const value = (worth[0] ?? 0) + (worth[1] ?? 0) - (mine.length ? Math.min(...mine) + 0.5 : 0) - 1;
  return value > 0 ? value / needed.length : 0;
}

/** Rezzed ice the Runner gets through for this much or less is worth trashing to make room. */
const WEAK_ICE = 2;

/** The rezzed ice on a server that is cheapest for the Runner to get through, if it is weak enough to trash. */
export function weakestIce(state: GameState, serverId: string): CardInstance | undefined {
  const rezzed = (state.corp.servers[serverId]?.ice ?? []).filter(ice => ice.isRezzed).map(ice => ({ ice, cost: iceCost(state, ice) }));
  rezzed.sort((a, b) => a.cost - b.cost);
  return rezzed[0] && rezzed[0].cost <= WEAK_ICE ? rezzed[0].ice : undefined;
}
