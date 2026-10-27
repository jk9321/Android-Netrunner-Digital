import { CardInstance, GameState, SideCode, cardDef } from '../core';
import { breakerScript, iceSubtypes, isIcebreaker } from '../core/engine/ice';
import { counters } from '../core/engine/cardEffects';
import { cardSynergy } from './synergyTags';
import { tuning } from './synergy';
import { corpKeepValue, runnerCardValue } from './cardValues';
import { RATES, creditValue } from './valueModel';

export { creditValue };

/**
 * Board evaluation shared by both AIs, in "credit" units: a credit is worth
 * 1, a click about 1, a card in hand about 1.5 while the hand is small.
 * Scores compare positions one action apart, so only differences matter.
 *
 * `aware` (the deck-aware AI) turns on the planning terms: tags are worth
 * more while the Corp holds cards that punish them, and icebreakers for
 * the ice types the Corp has shown are worth more than the rest.
 */

/**
 * Value of a hand of `size` cards: the first few matter most, cards over
 * the limit not at all (they will be discarded). With plan.drawValue a card
 * up to the limit is worth what a credit is to a short side.
 */
export function handValue(size: number, limit: number, viewer?: SideCode): number {
  const card = viewer && tuning.plan.drawValue?.[viewer] ? DRAWN_CARD : RATES.drawnCardOff;
  let value = 0;
  for (let i = 0; i < size; i++) value += i < RATES.handCoreCards ? RATES.handCore : i < limit ? card : 0;
  return value;
}

/** Worth of a card in hand beyond the first three, up to the limit (plan.drawValue). */
export const DRAWN_CARD = RATES.drawnCard;

const isEcon = (card: CardInstance) => (cardSynergy(cardDef(card)).gives?.econ ?? 0) >= 0.5;

/**
 * Extra worth of drawing a card (plan.dig, Jeff): for each problem the hand
 * can't answer but the deck still can (no money, no ice for the Corp, no
 * breaker for an ice type the Runner faces), the chance the next card is an
 * answer, more while the opponent is close to winning or about to score.
 * Each side only looks at its own deck's contents, never its order.
 */
export function digValue(state: GameState, side: SideCode): number {
  const odds = (deck: CardInstance[], answers: (c: CardInstance) => boolean) => (deck.length > 0 ? deck.filter(answers).length / deck.length : 0);
  let value = 0;
  if (side === 'corp') {
    const corp = state.corp;
    const pressure = state.runner.score >= 5 ? 1 : state.runner.score >= 3 ? 0.5 : 0;
    const iced = (id: string) => (corp.servers[id]?.ice.length ?? 0) > 0;
    const needIce = !corp.hq.some(c => cardDef(c).type_code === 'ice') && (!iced('rd') || !iced('hq') || corp.hq.some(c => cardDef(c).type_code === 'agenda'));
    const needMoney = corp.credits < 5 && !corp.hq.some(isEcon);
    if (needIce) value += Math.min(1.2, 3 * odds(corp.rd, c => cardDef(c).type_code === 'ice') * (1 + pressure));
    if (needMoney) value += Math.min(1.2, 3 * odds(corp.rd, isEcon) * (1 + pressure));
    return value;
  }
  const runner = state.runner;
  const remotes = Object.values(state.corp.servers).filter(s => s.isRemote);
  const scoring = remotes.some(s => s.root.some(c => !c.isRezzed && c.advancementCounters > 0));
  const pressure = (state.corp.score >= 5 ? 1 : state.corp.score >= 3 ? 0.5 : 0) + (scoring ? 0.5 : 0);
  // Ice types the Corp has shown that nothing installed or in the grip breaks
  const covered = rigCoverage([...runner.rig.programs, ...runner.grip]);
  if (covered.anyBreakers === 0) {
    const faced = new Set(Object.values(state.corp.servers).flatMap(s => s.ice.filter(i => i.isRezzed).flatMap(i => iceSubtypes(i, state))));
    for (const type of ICE_TYPES) {
      if (!faced.has(type) || covered.covered.has(type)) continue;
      value += Math.min(1.2, 3 * odds(runner.stack, c => { const b = breakerScript(c); return !!b && (b.breaks === type || b.breaks === 'any'); }) * (1 + pressure));
    }
  }
  if (runner.credits < 4 && !runner.grip.some(isEcon)) value += Math.min(1.2, 3 * odds(runner.stack, isEcon) * (1 + pressure));
  return Math.min(2.5, value);
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
  if (!aware || !tuning.plan.breakerFocus) return RATES.iceTypeCoverage;
  return RATES.iceTypeCoverage * (0.4 + 1.8 * shownIceShare(state)[type]);
}

function runnerRigValue(state: GameState, aware = false): number {
  const rig = state.runner.rig;
  const cards = [...rig.programs, ...rig.hardware, ...rig.resources];
  const { covered, anyBreakers } = rigCoverage(rig.programs);
  let value = [...covered].reduce((n, t) => n + coverageValue(state, t, aware), 0) + (anyBreakers > 0 ? RATES.anyBreaker : 0);
  for (const card of cards) {
    value += isIcebreaker(card) ? RATES.icebreaker : RATES.rigCardScale * runnerCardValue(card.cardCode);
    value += counters(card, 'credit') * (card.cardCode === '30033' ? RATES.counters.smartwareCredit : RATES.counters.hostedCredit); // Smartware pays out 1 a turn
    value += counters(card, 'virus') * (card.cardCode === '30007' ? RATES.counters.fermenterVirus : RATES.counters.virus);
    value += (card.hostedCards?.length ?? 0) * RATES.hostedCard; // Bling, Madani: cards to play later
  }
  return value;
}


/** Worth of an installed Corp root card (assets and upgrades). */
export function corpCardValue(card: CardInstance): number {
  const hosted = counters(card, 'credit');
  if (card.isRezzed && hosted > 0) return 1 + hosted * RATES.counters.hostedCredit;
  return corpKeepValue(card.cardCode);
}

/** A Corp card the Runner can't see: installed, unrezzed and facedown. */
const isHidden = (card: CardInstance) => !card.isRezzed && !card.faceUp;

/**
 * What the Runner can expect of a facedown installed Corp card, worked out
 * from the cards it hasn't seen: the Corp's decklist minus everything
 * public. It never looks at the card itself. `agenda` is the chance it's an
 * agenda, `agendaCost` the typical advancement those agendas need, and
 * `other` the average worth of the assets and upgrades it could be instead.
 */
export function hiddenCardOdds(state: GameState): { agenda: number; agendaCost: number; other: number } {
  const corp = state.corp;
  const installed = Object.values(corp.servers).flatMap(server => server.root.filter(isHidden));
  const unseen = [...corp.hq, ...corp.rd, ...corp.archives.faceDown, ...installed]
    .map(card => cardDef(card))
    .filter(def => def.type_code === 'agenda' || def.type_code === 'asset' || def.type_code === 'upgrade');
  const agendas = unseen.filter(def => def.type_code === 'agenda');
  const others = unseen.filter(def => def.type_code !== 'agenda');
  const mean = (values: number[], fallback: number) => (values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : fallback);
  return {
    agenda: unseen.length > 0 ? agendas.length / unseen.length : 0,
    agendaCost: Math.round(mean(agendas.map(def => def.advancement_cost ?? 3), 3)),
    other: mean(others.map(def => corpKeepValue(def.code)), 1),
  };
}

const agendaBoardValue = (counters: number, cost: number) => counters * RATES.advancement + (counters >= cost ? RATES.scoreableAgenda : 0);

/** The Corp's installed cards, as `viewer` can judge them: the Runner values facedown cards by the odds, not by what they are. */
function corpBoardValue(state: GameState, viewer: SideCode): number {
  let value = 0;
  let odds: ReturnType<typeof hiddenCardOdds> | undefined;
  for (const server of Object.values(state.corp.servers)) {
    for (const ice of server.ice) value += ice.isRezzed ? RATES.ice + RATES.rezzedIceCostShare * (cardDef(ice).cost ?? 0) : RATES.ice;
    for (const card of server.root) {
      if (viewer === 'runner' && isHidden(card)) {
        odds ??= hiddenCardOdds(state);
        value += odds.agenda * agendaBoardValue(card.advancementCounters, odds.agendaCost) + (1 - odds.agenda) * odds.other;
        continue;
      }
      const def = cardDef(card);
      if (def.type_code === 'agenda') value += agendaBoardValue(card.advancementCounters, def.advancement_cost ?? 0);
      else value += corpCardValue(card);
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
      RATES.click * corp.clicks +
      handValue(corp.hq.length, corp.handSizeLimit, viewer) +
      RATES.point * corp.score +
      corpBoardValue(state, viewer) +
      (RATES.tagForCorp + threat) * state.runner.tags +
      // Dividends and Next Big Thing counters, AU Co. power counters
      RATES.counters.scoredAgenda * corp.scoreArea.reduce((n, a) => n + counters(a, 'agenda'), 0) +
      RATES.counters.identityPower * counters(corp.identity, 'power')
    );
  }
  const runner = state.runner;
  return (
    creditValue(runner.credits) +
    RATES.click * runner.clicks +
    handValue(runner.grip.length, runner.handSizeLimit, viewer) +
    RATES.point * runner.score -
    (RATES.tagAgainstRunner + threat) * runner.tags -
    RATES.coreDamage * runner.coreDamage +
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
