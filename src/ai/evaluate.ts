import { CardInstance, GameState, SideCode, cardDef } from '../core';
import { breakerScript, iceSubtypes, isIcebreaker } from '../core/engine/ice';
import { counters, turnFlag } from '../core/engine/cardEffects';
import { abilityUsedKey } from '../core/engine/actions/ability';
import { cardSynergy } from './synergyTags';
import { tuning } from './synergy';
import { corpKeepValue, runnerCardValue } from './cardValues';
import { countersWorth } from './counterValues';
import { boardPlansWorth } from './cardPlans';
import { AI_BREAKER_SHARE, breakerTypeWorth, flatIceWorth, iceWorth } from './iceValues';
import { payoutWait, payoutWorth, profileOf, turnsLeft } from './cardProfiles';
import { HAND_FLOOR, clickPrice, handByCard, heldWorth, ownHandValue, playedWorth } from './handValues';
import { CLICK, RATES, cardRate, creditValue, flatRate, flatlineWorth, handFilter, memo, pointValue, sideCreditValue } from './valueModel';
import { PACE, STEAL, coreSlotWorth, flatlineOdds, runSuccess, stealOdds } from './effectValues';
import { trashedCardCost } from './runs';

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
 * the limit next to nothing (they will be discarded; with plan.handFilter the
 * first one over lets the worst card go). With plan.drawValue a card
 * up to the limit is worth what a credit is to a short side.
 */
export function handValue(size: number, limit: number, viewer?: SideCode): number {
  const card = viewer && tuning.plan.drawValue?.[viewer] ? DRAWN_CARD : RATES.drawnCardOff;
  let value = 0;
  for (let i = 0; i < size; i++) value += i < RATES.handCoreCards ? RATES.handCore : i < limit ? card : i === limit ? handFilter() : 0;
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

/** A breaker trashed when its run ends (Mayfly): it saves one stop, not the three a lasting breaker is counted for. */
export const isOneUse = (card: CardInstance): boolean => /when (?:the|this) run ends, trash this program/i.test(cardDef(card).stripped_text ?? '');

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

export function runnerRigValue(state: GameState, aware: boolean, viewer: SideCode): number {
  const rig = state.runner.rig;
  const cards = [...rig.programs, ...rig.hardware, ...rig.resources];
  const { covered, anyBreakers } = rigCoverage(rig.programs);
  let value: number;
  if (tuning.plan.breakerCredits?.[viewer]) {
    // Step 5b: each ice type by the stops it saves; an AI breaker covers the rest at a discount
    const aiShare = anyBreakers === 0 ? 0 : tuning.plan.cardFixes ? Math.max(...rig.programs.filter(p => breakerScript(p)?.breaks === 'any').map(p => (isOneUse(p) ? AI_BREAKER_SHARE / 3 : AI_BREAKER_SHARE))) : AI_BREAKER_SHARE;
    value = ICE_TYPES.reduce((n, t) => n + (covered.has(t) ? 1 : aiShare) * breakerTypeWorth(state, t), 0);
  } else value = [...covered].reduce((n, t) => n + coverageValue(state, t, aware), 0) + (anyBreakers > 0 ? RATES.anyBreaker : 0);
  for (const card of cards) {
    // Step 4: a card that pays out money is worth what it will still pay
    const profile = profileOf(card.cardCode);
    if (profile) {
      value += payoutWorth(profile, turnsLeft(state), counters(card, 'credit'), payoutWait(state, profile, 'runner'), cardRate(state, 'runner'));
      continue;
    }
    // A breaker is worth its coverage above (plan.flatRates.breakers: no flat extra for having one)
    value += isIcebreaker(card) ? (flatRate('breakers') && tuning.plan.breakerCredits?.[viewer] ? 0 : RATES.icebreaker) : RATES.rigCardScale * runnerCardValue(card.cardCode, state, card);
    // Counters by what they do on this card (step 3), or the step-1 rates
    value += countersWorth(state, card, 'credit', viewer) + countersWorth(state, card, 'virus', viewer) + countersWorth(state, card, 'power', viewer);
    // Bling, Madani: cards to play later, worth what they would be in the grip (plan.flatRates.hosted).
    // Corp cards hosted on Detente are not the Runner's to play: Detente's own value covers them
    const hosted = (card.hostedCards ?? []).filter(h => cardDef(h).side_code === 'runner');
    value += hosted.reduce((n, h) => n + (flatRate('hosted') ? heldWorth(state, h, 'runner') : RATES.hostedCard), 0);
  }
  // Combos in play (Knickknack burning Principia, Baker on stealth credits): plan.cardPlans
  return value + boardPlansWorth(state, 'runner');
}


/** Worth of an installed Corp root card (assets and upgrades). */
export function corpCardValue(card: CardInstance, state?: GameState, viewer: SideCode = 'corp'): number {
  const hosted = counters(card, 'credit');
  const power = state && card.isRezzed ? countersWorth(state, card, 'power', viewer) : 0;
  const profile = state ? profileOf(card.cardCode) : undefined;
  if (state && profile) return card.isRezzed ? payoutWorth(profile, turnsLeft(state), hosted, payoutWait(state, profile, 'corp', inIcedServer(state, card)), cardRate(state, 'corp')) : corpKeepValue(card.cardCode, state);
  if (card.isRezzed && hosted > 0) return 1 + (state ? countersWorth(state, card, 'credit', viewer) : hosted * RATES.counters.hostedCredit) + power;
  return corpKeepValue(card.cardCode, state) + power;
}

/** Whether a Corp root card sits in a server with ice in front of it. */
function inIcedServer(state: GameState, card: CardInstance): boolean {
  return Object.values(state.corp.servers).some(s => s.ice.length > 0 && s.root.some(c => c.instanceId === card.instanceId));
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
export function hiddenCardOdds(state: GameState): { agenda: number; agendaCost: number; agendaPoints: number; other: number } {
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
    agendaPoints: mean(agendas.map(def => def.agenda_points ?? 2), 2),
    other: mean(others.map(def => corpKeepValue(def.code, state)), 1),
  };
}

export const agendaBoardValue = (counters: number, cost: number) => counters * RATES.advancement + (counters >= cost ? RATES.scoreableAgenda : 0);

/** Chance the Runner runs a remote holding an advanced agenda on its turn (measured, scripts/pace.ts at b72eb3d: 40% of 6,689 turns). */
export const AGENDA_RUN = 0.4;

/**
 * An installed agenda (Jeff, 2026-10-28; plan.agendaBoard): its points on
 * the clock, if it survives the Runner's turns until it can be scored, less
 * the clicks and credits still needed to advance it. Safe only once it can
 * be scored on the Corp's own turn (a free action, rule 7.1); otherwise each
 * Runner turn it waits is a run on its server that may get through (run
 * openness: the ice there against the rig).
 */
export function agendaWorth(state: GameState, counters: number, cost: number, points: number, serverId?: string, success?: number, inHand = false): number {
  if (!tuning.plan.agendaBoard) return agendaBoardValue(counters, cost);
  const gain = pointValue(state.corp.score + points) - pointValue(state.corp.score);
  const need = Math.max(0, cost - counters);
  const steal =
    tuning.plan.stealOdds && success === undefined && serverId
      ? stealOdds(state, serverId)
      : (tuning.plan.stealOdds ? STEAL.run : AGENDA_RUN) * (success ?? (serverId ? runSuccess(state, serverId) : PACE.success));
  if (!tuning.plan.agendaTempo) {
    const runnerTurns = need === 0 && state.activePlayer === 'corp' ? 0 : Math.max(1, Math.ceil(need / 3));
    return gain * (1 - steal) ** runnerTurns - need * (CLICK + 1);
  }
  // plan.agendaTempo: the Runner turns until the Corp has the clicks to finish it (installing from hand is one more),
  // each a run that may get in and a turn closer to the end of the game (about 1 in turnsLeft)
  const clicks = need + (inHand ? 1 : 0);
  // On the Runner's turn it is exposed now, then the Corp's next turn has 3 clicks
  const runnerTurns =
    state.activePlayer === 'corp' ? Math.ceil(Math.max(0, clicks - state.corp.clicks) / 3) : 1 + Math.ceil(Math.max(0, clicks - 3) / 3);
  const late = 1 - 1 / turnsLeft(state);
  return gain * ((1 - steal) * late) ** runnerTurns - need * (CLICK + 1);
}

/**
 * An agenda in Archives (plan.agendaBoard): a breach of Archives turns its
 * facedown cards faceup and the Runner accesses them all (rules 7.3.2,
 * 7.4), so a discarded agenda is a likely steal: its points to the Runner,
 * by the odds of a successful Archives run (as often as the Runner runs
 * Archives, scripts/pace.ts) on one of the turns left.
 */
export function archivedAgendaLoss(state: GameState, points: number): number {
  const gain = pointValue(state.runner.score + points) - pointValue(state.runner.score);
  const perTurn = Math.min(1, PACE.runs * PACE.archivesShare) * runSuccess(state, 'archives');
  return gain * (1 - (1 - perTurn) ** turnsLeft(state));
}

/** Agendas in Archives as `viewer` can see them: the Corp knows its facedown cards, the Runner only the faceup ones. */
function archivedAgendasValue(state: GameState, viewer: SideCode): number {
  if (!tuning.plan.agendaBoard) return 0;
  const archives = viewer === 'corp' ? [...state.corp.archives.faceUp, ...state.corp.archives.faceDown] : state.corp.archives.faceUp;
  return -archives.filter(c => cardDef(c).type_code === 'agenda').reduce((n, c) => n + archivedAgendaLoss(state, cardDef(c).agenda_points ?? 1), 0);
}

/** The Corp's installed cards, as `viewer` can judge them: the Runner values facedown cards by the odds, not by what they are. */
function corpBoardValue(state: GameState, viewer: SideCode): number {
  let value = 0;
  let odds: ReturnType<typeof hiddenCardOdds> | undefined;
  for (const server of Object.values(state.corp.servers)) {
    for (const ice of server.ice) value += tuning.plan.iceInCredits?.[viewer] ? iceWorth(state, ice, viewer) : flatIceWorth(ice);
    for (const card of server.root) {
      if (viewer === 'runner' && isHidden(card)) {
        odds ??= hiddenCardOdds(state);
        value += odds.agenda * agendaWorth(state, card.advancementCounters, odds.agendaCost, odds.agendaPoints, server.id) + (1 - odds.agenda) * odds.other;
        continue;
      }
      const def = cardDef(card);
      if (def.type_code === 'agenda') value += agendaWorth(state, card.advancementCounters, def.advancement_cost ?? 0, def.agenda_points ?? 1, server.id);
      else value += corpCardValue(card, state, viewer);
    }
  }
  return value + archivedAgendasValue(state, viewer);
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

/**
 * The tag clock (Jeff, 2026-10-28; plan.tagClock): what tags on the Runner
 * are worth, to the Corp and against the Runner. Each Corp turn a tagged
 * Runner can lose its best resource (the Corp's basic trash action: a click
 * and 2 credits, rule 4.4.1) or a card to a tag punisher (Retribution) the
 * Corp holds, as far as `viewer` knows. The Runner clears a tag for a click
 * and 2 credits when keeping it costs more, so tags are worth the cheaper.
 */
export function tagsWorth(state: GameState, viewer: SideCode, tags = state.runner.tags): number {
  if (tags <= 0) return 0;
  const perTurn = memo(state, 'tagLoss:' + viewer, () => tagLossPerTurn(state, viewer));
  const clear = CLICK + 2;
  // Kept, a tag costs this turn's loss and maybe the next; the Runner clears the ones that cost more than clearing
  const worth = Math.min(tags * clear, 1.5 * perTurn + 0.1 * (tags - 1));
  return tuning.plan.vicTags && state.runner.identity.cardCode === VIC ? Math.min(worth, vicTagsWorth(state, tags, perTurn)) : worth;
}

/** Virtual Intelligence, P.I.: "Once per turn → [click], 1[credit]: Draw 1 card and remove 1 tag." */
export const VIC = '36009';

/**
 * Tags on Vic (Jeff, 2026-10-30; plan.vicTags): her ability clears a tag for
 * a click and a credit less the card it draws. The first tag costs that
 * while she can still use it this turn (the Runner's turn, ability unused,
 * a click and a credit left); otherwise it sits through a Corp turn first
 * (this turn's loss, as the Corp's punishers see it). The second waits a
 * turn for her (two Corp turns if the first waits too) or is cleared the
 * usual way; the rest cost as usual.
 */
function vicTagsWorth(state: GameState, tags: number, perTurn: number): number {
  const clear = CLICK + 2;
  const vic = Math.max(0.5, CLICK + 1 - RATES.drawnCard);
  const runner = state.runner;
  const ability = abilityUsedKey(runner.identity.instanceId, 0);
  const now = state.activePlayer === 'runner' && turnFlag(state, ability) === 0 && runner.clicks >= 1 && runner.credits >= 1;
  const later = Math.min(clear, vic + perTurn);
  const second = now ? later : Math.min(clear, vic + 2 * perTurn);
  return (now ? vic : later) + (tags >= 2 ? second : 0) + Math.max(0, tags - 2) * clear;
}

/** What a tagged Runner stands to lose each Corp turn, as `viewer` sees it. */
function tagLossPerTurn(state: GameState, viewer: SideCode): number {
  const corp = state.corp;
  // The best resource the Corp would trash, net of what trashing costs it
  const rig = runnerRigValue(state, true, viewer);
  const resources = state.runner.rig.resources.map(r => rig - runnerRigValue({ ...state, runner: { ...state.runner, rig: { ...state.runner.rig, resources: state.runner.rig.resources.filter(c => c !== r) } } }, true, viewer));
  const trash = Math.max(0, ...resources) - (corp.credits >= 2 ? CLICK + 2 : Infinity);
  // A tag punisher in HQ: known to the Corp, the decklist's odds to the Runner
  const punishes = (c: CardInstance) => cardSynergy(cardDef(c)).when?.includes('ifTagged') ?? false;
  let held: number;
  if (viewer === 'corp') held = corp.hq.some(punishes) ? 1 : 0;
  else {
    const unseen = [...corp.hq, ...corp.rd];
    const share = unseen.length ? unseen.filter(punishes).length / unseen.length : 0;
    held = 1 - (1 - share) ** corp.hq.length;
  }
  const punish = held * trashedCardCost(state);
  return Math.max(trash, 0) + punish + (punishes(corp.identity) ? 1 : 0);
}

/** A side's clicks left and its hand, each on its own. */
function handAndClicks(state: GameState, side: SideCode, viewer: SideCode): number {
  const player = side === 'corp' ? state.corp : state.runner;
  const hand = side === 'corp' ? state.corp.hq : state.runner.grip;
  const own = side === viewer && handByCard(side) ? ownHandValue(state, side) : handValue(hand.length, player.handSizeLimit, viewer);
  return clickPrice(state, side, viewer) * player.clicks + own;
}

/** The flat worth of the first cards in hand as life against damage, which the damage clock replaces. */
const lifeCards = (size: number): number => Math.min(size, RATES.handCoreCards) * (RATES.handCore - RATES.drawnCard);

export function sideStrength(state: GameState, side: SideCode, viewer: SideCode = side, aware = false): number {
  const threat = aware && tuning.plan.tagThreat?.[viewer] && state.runner.tags > 0 ? tagThreat(state, viewer) : 0;
  if (side === 'corp') {
    const corp = state.corp;
    return (
      sideCreditValue(state, 'corp', viewer) +
      handAndClicks(state, 'corp', viewer) +
      pointValue(corp.score) +
      corpBoardValue(state, viewer) +
      (tuning.plan.tagClock ? tagsWorth(state, viewer) : (RATES.tagForCorp + threat) * state.runner.tags) +
      // Dividends and Next Big Thing counters, AU Co. power counters
      corp.scoreArea.reduce((n, a) => n + countersWorth(state, a, 'agenda', viewer), 0) +
      countersWorth(state, corp.identity, 'power', viewer)
    );
  }
  const runner = state.runner;
  return (
    sideCreditValue(state, 'runner', viewer) +
    handAndClicks(state, 'runner', viewer) +
    pointValue(runner.score) -
    (tuning.plan.tagClock ? tagsWorth(state, viewer) : (RATES.tagAgainstRunner + threat) * runner.tags) -
    coreSlotWorth(state) * runner.coreDamage -
    // The damage clock: a small grip against the Corp's damage is a step toward a flatline
    (tuning.plan.damageClock ? flatlineWorth(state) * flatlineOdds(state, Math.min(runner.grip.length, runner.handSizeLimit ?? 5)) + lifeCards(runner.grip.length) : 0) +
    runnerRigValue(state, aware, viewer)
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
  // Jeff, 2026-10-28 (plan.keepByModel): what the card adds once played, before its click (at least the hand floor)
  if (tuning.plan.keepByModel) {
    // An agenda let go goes to Archives, where the Runner likely steals it (plan.agendaBoard)
    const loss = tuning.plan.agendaBoard && cardDef(card).type_code === 'agenda' ? archivedAgendaLoss(state, cardDef(card).agenda_points ?? 1) : 0;
    return Math.max(HAND_FLOOR, playedWorth(state, card) + CLICK) + loss;
  }
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
        return corpKeepValue(card.cardCode, state) > 1 ? 2.5 : 1.5;
      default:
        return 1.2;
    }
  }
  if (isIcebreaker(card)) {
    const { covered } = rigCoverage(state.runner.rig.programs);
    const breaks = breakerScript(card)?.breaks;
    if (!breaks || breaks === 'any' || covered.has(breaks)) return 1.5;
    if (tuning.plan.breakerCredits?.runner) return (5 / RATES.iceTypeCoverage) * breakerTypeWorth(state, breaks);
    return aware && tuning.plan.breakerFocus ? 5 * (0.4 + 1.8 * shownIceShare(state)[breaks]) : 5;
  }
  if (def.uniqueness && [...state.runner.rig.programs, ...state.runner.rig.hardware, ...state.runner.rig.resources].some(c => c.cardCode === card.cardCode)) {
    return 0.2;
  }
  if (def.type_code === 'event') return /gain \d+/i.test(def.stripped_text ?? '') ? 3 : 2;
  return 2 + runnerCardValue(card.cardCode, state) * 0.3;
}
