import { CardInstance, GameState, SideCode, cardDef } from '../core';
import { breakerScript, iceSubtypes, isIcebreaker } from '../core/engine/ice';
import { counters } from '../core/engine/cardEffects';
import { cardSynergy } from './synergyTags';
import { tuning } from './synergy';
import { corpKeepValue, runnerCardValue } from './cardValues';

/**
 * Board evaluation shared by both AIs, in "credit" units: a credit is worth
 * 1, a click about 1, a card in hand about 1.5 while the hand is small.
 * Scores compare positions one action apart, so only differences matter.
 *
 * `aware` (the deck-aware AI) turns on the planning terms: tags are worth
 * more while the Corp holds cards that punish them, and icebreakers for
 * the ice types the Corp has shown are worth more than the rest.
 */

/** Credits are worth more while a side is short of them. */
export function creditValue(credits: number): number {
  return credits + 0.6 * Math.min(Math.max(credits, 0), 6);
}

/** Value of a hand of `size` cards: the first few matter most, cards over the limit not at all. */
export function handValue(size: number, limit: number): number {
  let value = 0;
  for (let i = 0; i < size; i++) value += i < 3 ? 2 : i < limit ? 0.8 : 0;
  return value;
}


/** Icebreaker coverage: each ice subtype the rig can break is worth a lot. */
export function rigCoverage(cards: CardInstance[]): { covered: Set<string>; anyBreakers: number } {
  const covered = new Set<string>();
  let anyBreakers = 0;
  for (const card of cards) {
    const script = breakerScript(card);
    if (!script) continue;
    if (script.breaks === 'any') anyBreakers++;
    else covered.add(script.breaks);
  }
  return { covered, anyBreakers };
}

const ICE_TYPES = ['barrier', 'code gate', 'sentry'] as const;

/**
 * Share of each ice type among the ice the Corp has shown (rezzed, or
 * trashed faceup to Archives), with a prior of one of each so it starts
 * even. Sums to 1.
 */
export function shownIceShare(state: GameState): Record<string, number> {
  const count: Record<string, number> = { barrier: 1, 'code gate': 1, sentry: 1 };
  const shown = [
    ...Object.values(state.corp.servers).flatMap(s => s.ice).filter(c => c.isRezzed),
    ...state.corp.archives.faceUp.filter(c => cardDef(c).type_code === 'ice'),
  ];
  for (const ice of shown) for (const t of iceSubtypes(ice, state)) count[t]++;
  const total = ICE_TYPES.reduce((n, t) => n + count[t], 0);
  return Object.fromEntries(ICE_TYPES.map(t => [t, count[t] / total]));
}

/** Worth of being able to break an ice type: 8 on average, more for the types the Corp plays. */
function coverageValue(state: GameState, type: string, aware: boolean): number {
  if (!aware || !tuning.plan.breakerFocus) return 8;
  return 8 * (0.4 + 1.8 * shownIceShare(state)[type]);
}

function runnerRigValue(state: GameState, aware = false): number {
  const rig = state.runner.rig;
  const cards = [...rig.programs, ...rig.hardware, ...rig.resources];
  const { covered, anyBreakers } = rigCoverage(rig.programs);
  let value = [...covered].reduce((n, t) => n + coverageValue(state, t, aware), 0) + (anyBreakers > 0 ? 2 : 0);
  for (const card of cards) {
    value += isIcebreaker(card) ? 2 : 2 * runnerCardValue(card.cardCode);
    value += counters(card, 'credit') * (card.cardCode === '30033' ? 0.25 : 0.6); // Smartware pays out 1 a turn
    value += counters(card, 'virus') * (card.cardCode === '30007' ? 1.5 : 0.7);
    value += (card.hostedCards?.length ?? 0) * 0.8; // Bling, Madani: cards to play later
  }
  return value;
}


/** Worth of an installed Corp root card (assets and upgrades). */
export function corpCardValue(card: CardInstance): number {
  const hosted = counters(card, 'credit');
  if (card.isRezzed && hosted > 0) return 1 + hosted * 0.6;
  return corpKeepValue(card.cardCode);
}

function corpBoardValue(state: GameState): number {
  let value = 0;
  for (const server of Object.values(state.corp.servers)) {
    for (const ice of server.ice) value += ice.isRezzed ? 1 + 0.6 * (cardDef(ice).cost ?? 0) : 1;
    for (const card of server.root) {
      const def = cardDef(card);
      if (def.type_code === 'agenda') {
        const cost = def.advancement_cost ?? 0;
        value += card.advancementCounters * 1.5 + (card.advancementCounters >= cost ? 6 : 0);
      } else {
        value += corpCardValue(card);
      }
    }
  }
  return value;
}

/**
 * Extra worth of each tag on the Runner (deck-aware AI): the Corp's cards
 * that punish tags, as far as `viewer` can see them, and the Runner's
 * resources a tagged Runner can lose. 0 to about 2.5.
 */
export function tagThreat(state: GameState, viewer: SideCode): number {
  const punishes = (c: CardInstance) => cardSynergy(cardDef(c)).when?.includes('ifTagged') ?? false;
  const corp = state.corp;
  let threat = punishes(corp.identity) ? 1 : 0;
  const installed = Object.values(corp.servers).flatMap(s => [...s.root, ...s.ice]);
  const visible = viewer === 'corp' ? [...corp.hq, ...installed] : installed.filter(c => c.isRezzed || c.faceUp);
  threat += 0.5 * Math.min(3, [...visible, ...corp.archives.faceUp].filter(punishes).length);
  threat += 0.25 * Math.min(2, state.runner.rig.resources.length);
  return Math.min(2.5, threat);
}

export function sideStrength(state: GameState, side: SideCode, viewer: SideCode = side, aware = false): number {
  const threat = aware && tuning.plan.tagThreat?.[viewer] && state.runner.tags > 0 ? tagThreat(state, viewer) : 0;
  if (side === 'corp') {
    const corp = state.corp;
    return (
      creditValue(corp.credits) +
      corp.clicks +
      handValue(corp.hq.length, corp.handSizeLimit) +
      8 * corp.score +
      corpBoardValue(state) +
      (1.5 + threat) * state.runner.tags +
      // Dividends and Next Big Thing counters, AU Co. power counters
      1.5 * corp.scoreArea.reduce((n, a) => n + counters(a, 'agenda'), 0) +
      0.8 * counters(corp.identity, 'power')
    );
  }
  const runner = state.runner;
  return (
    creditValue(runner.credits) +
    runner.clicks +
    handValue(runner.grip.length, runner.handSizeLimit) +
    8 * runner.score -
    (3 + threat) * runner.tags -
    4 * runner.coreDamage +
    runnerRigValue(state, aware)
  );
}

/** How good the position is for `side` (mine minus theirs; a win is decisive). */
export function evaluate(state: GameState, side: SideCode, aware = false): number {
  if (state.winner) return state.winner === side ? 1000 : -1000;
  const other: SideCode = side === 'corp' ? 'runner' : 'corp';
  return sideStrength(state, side, side, aware) - sideStrength(state, other, side, aware);
}

/**
 * How much a side would like to keep each card in hand (for discards and
 * for effects that trash, shuffle away or fetch cards).
 */
export function keepValue(state: GameState, card: CardInstance, aware = false): number {
  const def = cardDef(card);
  if (def.side_code === 'corp') {
    switch (def.type_code) {
      case 'agenda':
        return 4;
      case 'ice': {
        const iceCount = Object.values(state.corp.servers).reduce((n, s) => n + s.ice.length, 0);
        return iceCount < 4 ? 3.5 : 2;
      }
      case 'operation':
        return /gain \d+/i.test(def.stripped_text ?? '') ? 2.5 : 1.5;
      case 'asset':
        return corpKeepValue(card.cardCode) > 1 ? 2.5 : 1.5;
      default:
        return 1.2;
    }
  }
  if (isIcebreaker(card)) {
    const { covered } = rigCoverage(state.runner.rig.programs);
    const breaks = breakerScript(card)?.breaks;
    if (!breaks || breaks === 'any' || covered.has(breaks)) return 1.5;
    return aware && tuning.plan.breakerFocus ? 5 * (0.4 + 1.8 * shownIceShare(state)[breaks]) : 5;
  }
  if (def.uniqueness && [...state.runner.rig.programs, ...state.runner.rig.hardware, ...state.runner.rig.resources].some(c => c.cardCode === card.cardCode)) {
    return 0.2;
  }
  if (def.type_code === 'event') return /gain \d+/i.test(def.stripped_text ?? '') ? 3 : 2;
  return 2 + runnerCardValue(card.cardCode) * 0.3;
}
