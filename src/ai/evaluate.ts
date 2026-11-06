import { CardInstance, GameState, SideCode, activePrompt, cardDef, executeAction } from '../core';
import { answerPrompt } from './prompts';
import { breakerScript, iceSubtypes, isIcebreaker } from '../core/engine/ice';
import { counters, rezCost, turnFlag } from '../core/engine/cardEffects';
import { PAYOUT_RISK } from './payoutRisk';
import { abilityUsedKey } from '../core/engine/actions/ability';
import { cardSynergy } from './synergyTags';
import { tuning } from './synergy';
import { corpKeepValue, runnerCardValue } from './cardValues';
import { countersWorth } from './counterValues';
import { boardPlansWorth } from './cardPlans';
import { AI_BREAKER_SHARE, breakerTypeWorth, flatIceWorth, iceWorth } from './iceValues';
import { payoutWait, payoutWorth, profileOf, turnsLeft } from './cardProfiles';
import { resourceTrashHqCost } from '../core/engine/actions/basic';
import { HAND_FLOOR, clickPrice, handByCard, heldWorth, ownHandValue, playedWorth, unseenInHand } from './handValues';
import { CLICK, KNOBS, RATES, cardRate, creditValue, flatRate, flatlineWorth, guardLoop, handFilter, mean, memo, payoutSlide, pointGain, pointValue, reachCard, sideCreditValue } from './valueModel';
import { LOCKDOWN, PACE, STEAL, agendaOdds, coreSlotWorth, flatlineOdds, lifeGrip, placedCounterWorth, runSuccess, stealOdds } from './effectValues';
import { isTrap, trashedCardCost } from './runs';

const MADANI = '35028';

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
    // plan.digPastLimit: ice too dear to rez soon (its cost past the credits and a turn's clicks) is no answer either
    const usableIce = (c: CardInstance) => cardDef(c).type_code === 'ice' && (!tuning.plan.digPastLimit || (cardDef(c).cost ?? 0) <= corp.credits + 3);
    const needIce = !corp.hq.some(usableIce) && (!iced('rd') || !iced('hq') || corp.hq.some(c => cardDef(c).type_code === 'agenda'));
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
      value += payoutWorth(profile, turnsLeft(state), counters(card, 'credit'), payoutWait(state, profile, 'runner'), cardRate(state, 'runner')) * payoutSlide(state, 'runner', viewer, counters(card, 'credit'));
      continue;
    }
    // A breaker is worth its coverage above (plan.flatRates.breakers: no flat extra for having one)
    value += isIcebreaker(card) ? (flatRate('breakers') && tuning.plan.breakerCredits?.[viewer] ? 0 : RATES.icebreaker) : RATES.rigCardScale * runnerCardValue(card.cardCode, state, card);
    // Counters by what they do on this card (step 3), or the step-1 rates
    value += countersWorth(state, card, 'credit', viewer) + countersWorth(state, card, 'virus', viewer) + countersWorth(state, card, 'power', viewer);
    // Bling, Madani: cards to play later, worth what they would be in the grip (plan.flatRates.hosted);
    // Madani's install takes no click, so its programs keep the click they will save (plan.madaniClick).
    // Corp cards hosted on Detente are not the Runner's to play: Detente's own value covers them
    const hosted = (card.hostedCards ?? []).filter(h => cardDef(h).side_code === 'runner');
    const freeInstall = card.cardCode === MADANI && !!tuning.plan.madaniClick;
    value += hosted.reduce((n, h) => n + (flatRate('hosted') ? heldWorth(state, h, 'runner', freeInstall) : RATES.hostedCard), 0);
  }
  // Combos in play (Knickknack burning Principia, Baker on stealth credits): plan.cardPlans
  return value + boardPlansWorth(state, 'runner');
}


/** Worth of an installed Corp root card (assets and upgrades). */
export function corpCardValue(card: CardInstance, state?: GameState, viewer: SideCode = 'corp'): number {
  return guardLoop(state, `corp card ${cardDef(card).title} ${card.instanceId}`, () => corpKeepValue(card.cardCode), () => corpCardWorth(card, state, viewer));
}

function corpCardWorth(card: CardInstance, state: GameState | undefined, viewer: SideCode): number {
  const worth = unwaitedCardWorth(card, state, viewer);
  if (state && viewer === 'corp' && tuning.plan.oneCurrency && !card.isRezzed && cardDef(card).type_code !== 'agenda' && !isTrap(card.cardCode)) {
    const cost = rezCost(state, card);
    // Rezzed: a profiled card's payout (its unrezzed worth is that less the printed cost), else its formula for a rezzed card
    const rezzed = profileOf(card.cardCode) ? worth + (cardDef(card).cost ?? 0) : corpKeepValue(card.cardCode, state, true);
    return PAYOUT_RISK.wait * rezzed - cost;
  }
  return worth;
}

function unwaitedCardWorth(card: CardInstance, state: GameState | undefined, viewer: SideCode): number {
  if (state && viewer === 'runner' && card.isRezzed && card.cardCode === SPIN_DOCTOR && tuning.plan.spentSpinDoctor) return spentSpinDoctorWorth(state);
  const hosted = counters(card, 'credit');
  const power = state && card.isRezzed ? countersWorth(state, card, 'power', viewer) : 0;
  const profile = state ? profileOf(card.cardCode) : undefined;
  if (state && profile) return card.isRezzed ? payoutWorth(profile, turnsLeft(state), hosted, payoutWait(state, profile, 'corp', inIcedServer(state, card)), cardRate(state, 'corp')) : corpKeepValue(card.cardCode, state);
  if (card.isRezzed && hosted > 0) return 1 + (state ? countersWorth(state, card, 'credit', viewer) : hosted * RATES.counters.hostedCredit) + power;
  return corpKeepValue(card.cardCode, state, card.isRezzed) + power;
}

const SPIN_DOCTOR = '30053';

/**
 * plan.oneCurrency (corpCardWorth): an unrezzed asset or upgrade, as the Corp prices its own, is worth what it is
 * rezzed a turn later (it pays nothing until a rez window, rules 5.6.1b, 5.6.2a, and the Runner gets a turn at it),
 * less the rez. The card profiles and effect formulas price it as "rezzed worth less the cost" with no wait, so a rez
 * only swapped credits for the same worth and the delta never chose one; installScore's econValue + 1 tier did instead.
 */

/**
 * plan.spentSpinDoctor (bug report #5, Jeff 2026-11-02): a rezzed Spin Doctor has drawn its 2 cards;
 * all it can still do is shuffle up to 2 cards from Archives back into R&D. As the Runner sees it:
 * a faceup card goes back as a slightly better R&D, a facedown one may be an agenda it would
 * otherwise steal from Archives. With Archives empty, trashing it buys next to nothing.
 */
export function spentSpinDoctorWorth(state: GameState): number {
  const { agenda, agendaPoints } = hiddenCardOdds(state);
  const archives = state.corp.archives;
  const worth = [
    ...archives.faceUp.map(() => 0.3 * cardRate(state, 'corp')),
    ...archives.faceDown.map(() => agenda * archivedAgendaLoss(state, agendaPoints) + (1 - agenda) * 0.3 * cardRate(state, 'corp')),
  ].sort((a, b) => b - a);
  return 0.3 + (worth[0] ?? 0) + (worth[1] ?? 0);
}

/** Whether a Corp root card sits in a server with ice in front of it. */
function inIcedServer(state: GameState, card: CardInstance): boolean {
  return Object.values(state.corp.servers).some(s => s.ice.length > 0 && s.root.some(c => c.instanceId === card.instanceId));
}

/** A Corp card the Runner can't see: installed, unrezzed and facedown. */
// A card the Runner has accessed or been shown in place (runnerKnows) isn't hidden from it (Gemini audit 2.2b)
const isHidden = (card: CardInstance) => !card.isRezzed && !card.faceUp && !(tuning.plan.runnerKnown && card.runnerKnows);

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
  return {
    agenda: unseen.length > 0 ? agendas.length / unseen.length : 0,
    agendaCost: Math.round(mean(agendas.map(def => def.advancement_cost ?? 3), 3)),
    agendaPoints: mean(agendas.map(def => def.agenda_points ?? 2), 2),
    other: mean(others.map(def => corpKeepValue(def.code, state)), 1),
  };
}

/** Chance the Runner runs a remote holding an advanced agenda on its turn (measured, scripts/pace.ts at b72eb3d: 40% of 6,689 turns). */
export const AGENDA_RUN = 0.4;

/** What a Corp click spent advancing could have built instead (plan.agendaClicks). */
export let AGENDA_CLICK = 2;
/** scripts/human-agreement.ts sweeps it. */
export function setAgendaClick(value: number): void {
  AGENDA_CLICK = value;
}

/**
 * An installed agenda (Jeff, 2026-10-28): its points on
 * the clock, if it survives the Runner's turns until it can be scored, less
 * the clicks and credits still needed to advance it. Safe only once it can
 * be scored on the Corp's own turn (a free action, rule 7.1); otherwise each
 * Runner turn it waits is a run on its server that may get through (run
 * openness: the ice there against the rig).
 */
export function agendaWorth(
  state: GameState,
  counters: number,
  cost: number,
  points: number,
  serverId?: string,
  success?: number,
  inHand = false,
  /** The Corp's clicks and credits left for this agenda this turn, once others on the board have theirs (plan.agendaBudget). */
  budget: { clicks: number; credits: number } = state.corp
): number {
  const gain = pointValue(state.corp.score + points, KNOBS.corpPoints) - pointValue(state.corp.score, KNOBS.corpPoints);
  const need = Math.max(0, cost - counters);
  const steal =
    tuning.plan.stealOdds && success === undefined && serverId
      ? stealOdds(state, serverId)
      : (tuning.plan.stealOdds ? STEAL.run : AGENDA_RUN) * (success ?? (serverId ? runSuccess(state, serverId) : PACE.success));
  // Agenda tempo (Jeff, 2026-10-28): the Runner turns until the Corp has the clicks to finish it (installing from hand is one more),
  // each a run that may get in and a turn closer to the end of the game (about 1 in turnsLeft)
  // plan.agendaCredits (Jeff's bug report, 2026-10-31): each advancement costs a credit (rule 5.2.6 basic actions: [click], 1[credit]: advance), so a Corp short of
  // credits needs a click to gain each missing one first ([click]: gain 1[credit]); at 0 credits an agenda can't be finished "this turn" on clicks alone
  const short = tuning.plan.agendaCredits ? Math.max(0, need - budget.credits) : 0;
  const clicks = need + (inHand ? 1 : 0) + short;
  // On the Runner's turn it is exposed now, then the Corp's next turn has 3 clicks
  const runnerTurns =
    state.activePlayer === 'corp' ? Math.ceil(Math.max(0, clicks - budget.clicks) / 3) : 1 + Math.ceil(Math.max(0, clicks - 3) / 3);
  const late = 1 - 1 / turnsLeft(state);
  // plan.agendaClicks (Jeff's Corp game 2, bug report #18): the clicks still needed are clicks a later turn can't spend
  // building; priced at the flat click rate, building now and scoring next turn always beat scoring now and building next
  const click = tuning.plan.agendaClicks ? AGENDA_CLICK : CLICK;
  return gain * ((1 - steal) * late) ** runnerTurns - need * (click + 1);
}

/**
 * An agenda in Archives (Jeff, 2026-10-28): a breach of Archives turns its
 * facedown cards faceup and the Runner accesses them all (rules 7.3.2,
 * 7.4), so a discarded agenda is a likely steal: its points to the Runner,
 * by the odds of a successful Archives run (as often as the Runner runs
 * Archives, scripts/pace.ts; plan.measuredNov6: as often as it breaches an Archives
 * that holds facedown cards) on one of the turns left.
 */
export function archivedAgendaLoss(state: GameState, points: number): number {
  const gain = pointValue(state.runner.score + points) - pointValue(state.runner.score);
  // plan.measuredNov6: the breach rate measured on turns that start with facedown cards in Archives
  const perTurn = tuning.plan.measuredNov6 ? PACE.facedownBreach : Math.min(1, PACE.runs * PACE.archivesShare) * runSuccess(state, 'archives');
  return gain * (1 - (1 - perTurn) ** turnsLeft(state));
}

/** Agendas in Archives as `viewer` can see them: the Corp knows its facedown cards, the Runner only the faceup ones. */
function archivedAgendasValue(state: GameState, viewer: SideCode): number {
  const archives = viewer === 'corp' ? [...state.corp.archives.faceUp, ...state.corp.archives.faceDown] : state.corp.archives.faceUp;
  return -archives.filter(c => cardDef(c).type_code === 'agenda').reduce((n, c) => n + archivedAgendaLoss(state, cardDef(c).agenda_points ?? 1), 0);
}

/**
 * One turn's clicks and credits are shared by the agendas on the board (Jeff's bug report, 2026-10-31;
 * plan.agendaBudget): on the Corp's turn, the agendas it can finish are given the clicks and credits
 * they need, nearest to scored first, and the rest get what is left. Each agenda used to count on all
 * of them, so two agendas both looked scored this turn and every other play (Petty Cash, which must
 * be the turn's first action) looked like it threw a score away.
 */
function agendaBudgets(state: GameState, viewer: SideCode): Map<string, { clicks: number; credits: number }> | undefined {
  if (!tuning.plan.agendaBudget || viewer !== 'corp' || state.activePlayer !== 'corp') return undefined;
  const agendas = Object.values(state.corp.servers)
    .flatMap(s => s.root)
    .filter(c => cardDef(c).type_code === 'agenda')
    .map(c => ({ id: c.instanceId, need: Math.max(0, (cardDef(c).advancement_cost ?? 0) - c.advancementCounters) }))
    .sort((a, b) => a.need - b.need);
  if (agendas.length < 2) return undefined;
  const budgets = new Map<string, { clicks: number; credits: number }>();
  let clicks = state.corp.clicks;
  let credits = state.corp.credits;
  for (const { id, need } of agendas) {
    budgets.set(id, { clicks, credits });
    // Clicks to finish it now: an advance each, and a click for each credit it is short (plan.agendaCredits)
    const short = tuning.plan.agendaCredits ? Math.max(0, need - credits) : 0;
    if (need + short <= clicks) {
      clicks -= need + short;
      credits = Math.max(0, credits - need);
    }
  }
  return budgets;
}

/** The Corp's installed cards, as `viewer` can judge them: the Runner values facedown cards by the odds, not by what they are. */
function corpBoardValue(state: GameState, viewer: SideCode): number {
  let value = 0;
  let odds: ReturnType<typeof hiddenCardOdds> | undefined;
  const budgets = agendaBudgets(state, viewer);
  for (const server of Object.values(state.corp.servers)) {
    for (const ice of server.ice) value += tuning.plan.iceInCredits?.[viewer] ? iceWorth(state, ice, viewer) : flatIceWorth(ice);
    for (const card of server.root) {
      if (viewer === 'runner' && isHidden(card)) {
        odds ??= hiddenCardOdds(state);
        value += odds.agenda * agendaWorth(state, card.advancementCounters, odds.agendaCost, odds.agendaPoints, server.id) + (1 - odds.agenda) * odds.other;
        continue;
      }
      const def = cardDef(card);
      if (def.type_code === 'agenda') value += agendaWorth(state, card.advancementCounters, def.advancement_cost ?? 0, def.agenda_points ?? 1, server.id, undefined, false, budgets?.get(card.instanceId));
      else value += corpCardValue(card, state, viewer) + (tuning.plan.oneCurrency && viewer === 'corp' ? advancedAssetWorth(state, card, server.ice.length > 0) : 0);
    }
  }
  return value + archivedAgendasValue(state, viewer) - (tuning.plan.oneCurrency ? centralExposure(state, viewer) : 0);
}

/**
 * plan.oneCurrency: advancement counters on the Corp's own asset (a trap reads as an agenda, Urtica Cipher's damage,
 * Clearinghouse's), each at what placing it was worth (effectValues placedCounterWorth, the worth advanceScore and
 * trapBluff used on their own scale). The Runner's view prices a facedown advanced card by the agenda odds already.
 */
function advancedAssetWorth(state: GameState, card: CardInstance, iced: boolean): number {
  if (cardDef(card).type_code !== 'asset' || card.advancementCounters <= 0) return 0;
  let worth = 0;
  for (let k = 0; k < card.advancementCounters; k++) worth += placedCounterWorth(state, { ...card, advancementCounters: k }, iced);
  return worth;
}

/**
 * plan.oneCurrency (structural review item 1): what the Corp expects to lose from runs on HQ and R&D, in the Runner's
 * points on the clock. Ice is worth the same wherever it sits (iceWorth), so without this term evaluate can't tell ice
 * on a bare R&D from ice on an empty remote; installScore's central needs (centralsFirst, centralIce) hand-coded it.
 *
 * Each Runner turn: PACE.runs x the server's share of runs x runSuccess (its ice against the rig) x the agenda loss of
 * one access (rule 7.4.1b-c: a breach of HQ offers the cards in HQ, of R&D the top card; one access each by default). HQ: the agendas in it over its
 * size, each by its point gain to the Runner; R&D: the share of agendas in it. Summed over the turns left with the
 * lock-down fade (LOCKDOWN, as the Corp ices up). The next turn sees HQ as it is; later turns see HQ as the deck's
 * average draw, since HQ turns over (installed, drawn into) while the ice stays. Archives is archivedAgendaLoss.
 *
 * Hidden information: the Corp knows what is in R&D but not its order, and nothing about a card drawn in a look-ahead
 * (handValues unseenInHand): those are pooled with R&D, so a draw can't tell it whether an agenda came. The Runner's
 * view uses its own odds of an unseen card being an agenda (agendaOdds), for HQ and R&D alike.
 */
export function centralExposure(state: GameState, viewer: SideCode): number {
  const unseen = viewer === 'corp' ? unseenInHand(state, 'corp') : [];
  const key = `centralExposure:${viewer}:${unseen.map(c => c.instanceId).join(',')}`;
  return memo(state, key, () => {
    const corp = state.corp;
    const gain = (points: number) => pointGain(state.runner.score, points);
    let density: number; // the agenda loss of one access to a card the viewer can't see
    let hqNow: number; // the agenda loss of one access to HQ as it is
    if (viewer === 'corp') {
      const ids = new Set(unseen.map(c => c.instanceId));
      const pool = [...corp.rd, ...unseen];
      density = pool.length ? pool.reduce((n, c) => n + (cardDef(c).type_code === 'agenda' ? gain(cardDef(c).agenda_points ?? 1) : 0), 0) / pool.length : 0;
      const known = corp.hq.filter(c => !ids.has(c.instanceId));
      hqNow = corp.hq.length ? (known.reduce((n, c) => n + (cardDef(c).type_code === 'agenda' ? gain(cardDef(c).agenda_points ?? 1) : 0), 0) + unseen.length * density) / corp.hq.length : 0;
    } else {
      const { odds, points } = agendaOdds(state);
      density = odds * gain(points);
      hqNow = corp.hq.length ? density : 0;
    }
    const hqRate = PACE.runs * PACE.hqShare * runSuccess(state, 'hq');
    const rdRate = corp.rd.length ? PACE.runs * PACE.rdShare * runSuccess(state, 'rd') : 0;
    let loss = 0;
    const turns = turnsLeft(state);
    for (let t = 1; t <= turns; t++) loss += (hqRate * (t === 1 ? hqNow : density) + rdRate * density) * LOCKDOWN ** (t - 1);
    return loss;
  });
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
export function tagsWorth(state: GameState, viewer: SideCode, count?: number): number {
  // Tags the Runner has now, or a count priced as if given (an ice subroutine, an operation)
  const actual = count === undefined;
  const tags = count ?? state.runner.tags;
  if (tags <= 0) return 0;
  // Inside the tag clock's own pricing of the rig, a tag is the flat rate (a resource's worth can depend on tags)
  if (pricingTagLoss) return tags * RATES.tagAgainstRunner;
  return guardLoop(state, `tags ${viewer}`, () => tags * RATES.tagAgainstRunner, () => tagClock(state, viewer, tags, actual));
}

function tagClock(state: GameState, viewer: SideCode, tags: number, actual: boolean): number {
  // plan.tagTrashNow: on the Corp's turn, with the Runner tagged and a click and 2 credits to trash, the Corp takes the
  // best resource now (the trash action is scored by it), so the clock after this turn runs on the next best
  const corp = state.corp;
  const trashNow = tuning.plan.tagTrashNow && state.activePlayer === 'corp' && !state.activeRun && state.runner.tags > 0 && corp.clicks >= 1 && corp.credits >= 2;
  const skip = trashNow ? 1 : 0;
  const perTurn = memo(state, `tagLoss:${viewer}:${skip}`, () => tagLossPerTurn(state, viewer, skip));
  const clear = CLICK + 2;
  // plan.tagNoClear (Gemini audit, 2026-11-01): a Runner that can't clear before the Corp's next turn (the Corp's turn
  // now, or its last click or 2 credits spent) sits through that turn first
  const runner = state.runner;
  const stuck = tuning.plan.tagNoClear && !(state.activePlayer === 'runner' && runner.clicks >= 1 && runner.credits >= 2);
  // Kept, a tag costs this turn's loss and maybe the next; the Runner clears the ones that cost more than clearing
  // plan.tagTrashNow (Jeff, 2026-11-04): on the Corp's turn, this turn's loss is what its trash action takes, and the
  // action is scored by that; counted in the tag as well, keeping the tag looked as good as using it, so the Corp
  // never trashed. Only the turns after count (the Runner may keep the tag through its turn). Tags priced as if
  // given (by ice during a run, by an operation) keep the full clock: the Corp trashes with them on a later turn.
  const corpTurn = tuning.plan.tagTrashNow && actual && state.activePlayer === 'corp' && !state.activeRun;
  const worth = corpTurn
    ? Math.min(tags * clear, 0.5 * perTurn + 0.1 * (tags - 1))
    : Math.min((stuck ? perTurn : 0) + tags * clear, 1.5 * perTurn + 0.1 * (tags - 1));
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
function tagLossPerTurn(state: GameState, viewer: SideCode, skip = 0): number {
  const was = pricingTagLoss;
  pricingTagLoss = true;
  try {
    return tagLoss({ ...state }, viewer, skip);
  } finally {
    pricingTagLoss = was;
  }
}
/** The tag clock is pricing the rig: tags are the flat rate in there (a copy of the position, so it is not a value loop). */
let pricingTagLoss = false;

function tagLoss(state: GameState, viewer: SideCode, skip: number): number {
  const corp = state.corp;
  // The best resource the Corp would trash, net of what trashing costs it
  const rig = runnerRigValue(state, true, viewer);
  const resources = state.runner.rig.resources.map(r => rig - runnerRigValue({ ...state, runner: { ...state.runner, rig: { ...state.runner.rig, resources: state.runner.rig.resources.filter(c => c !== r) } } }, true, viewer));
  // plan.hqTrashCost: a resource that also costs cards from HQ to trash is worth that much less to trash
  const extra = (r: CardInstance) => (tuning.plan.hqTrashCost ? hqTrashCardsLoss(state, r) : 0);
  const nets = resources.map((v, i) => v - extra(state.runner.rig.resources[i])).sort((a, b) => b - a);
  // plan.tagTrashNow: a Corp that can trash now takes the best one this turn; the turns after lose the next best
  const trash = Math.max(0, nets[skip] ?? 0) - (corp.credits >= 2 ? CLICK + 2 : Infinity);
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
  // plan.heldMoney: the money operation moneyReach puts on the Corp's credit slide is worth its credits there, not
  // a card in HQ as well (held, Hedge Fund was counted twice and playing it scored below a click for a credit)
  const reached = side === 'corp' && viewer === 'corp' && tuning.plan.heldMoney && tuning.plan.moneyReach && reachCard(state) ? 1 : 0;
  const own = side === viewer && handByCard(side) ? ownHandValue(state, side) : handValue(hand.length - reached, player.handSizeLimit, viewer);
  return clickPrice(state, side, viewer) * player.clicks + own;
}

/**
 * plan.hqTrashCost: what the Corp gives up in the cards from HQ that trashing this resource
 * also costs (Sebastião Souza Pessoa, Manuel Lattes de Moura): its least useful cards, not the
 * flat worth of a card in hand. Zero when nothing extra is due.
 */
export function hqTrashCardsLoss(state: GameState, resource: CardInstance): number {
  const k = resourceTrashHqCost(state, resource);
  if (k <= 0) return 0;
  const losses = state.corp.hq.map(c => Math.max(HAND_FLOOR, keepValue(state, c) - CLICK)).sort((a, b) => a - b);
  return losses.length < k ? Infinity : losses.slice(0, k).reduce((n, v) => n + v, 0);
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
      pointValue(corp.score, viewer === 'corp' ? KNOBS.corpPoints : 1) +
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
    (tuning.plan.damageClock ? flatlineWorth(state) * flatlineOdds(state, lifeGrip(state), true) + lifeCards(runner.grip.length) : 0) +
    runnerRigValue(state, aware, viewer)
  );
}

/** How good the position is for `side` (mine minus theirs; a win is decisive). */
export function evaluate(state: GameState, side: SideCode, aware = false): number {
  if (state.winner) return state.winner === side ? 1000 : -1000;
  if (side === 'corp' && tuning.plan.oneCurrency) state = finishedAgendas(state) ?? state;
  const other: SideCode = side === 'corp' ? 'runner' : 'corp';
  return sideStrength(state, side, side, aware) - sideStrength(state, other, side, aware);
}

/**
 * How much a side would like to keep each card in hand (for discards and
 * for effects that trash, shuffle away or fetch cards).
 */
export function keepValue(state: GameState, card: CardInstance): number {
  // Jeff, 2026-10-28: what the card adds once played, before its click (at least the hand floor); an agenda let go goes
  // to Archives, where the Runner likely steals it. (The old flat keep table, plan.keepByModel off, deleted 2026-11-06.)
  const loss = cardDef(card).type_code === 'agenda' ? archivedAgendaLoss(state, cardDef(card).agenda_points ?? 1) : 0;
  return Math.max(HAND_FLOOR, playedWorth(state, card) + CLICK) + loss;
}

/**
 * plan.oneCurrency: on the Corp's own turn, an agenda this turn's clicks and credits can finish is priced as scored,
 * by the engine: advanced (a click and a credit each, rule 5.2.6) and scored (no click and no action, rule 1.17.3c; in the action phase's scoring window, 5.6.2a), with what scoring
 * it does (Offworld Office's 7 credits) and the Corp's own prompts answered. So the money it takes is not also rez
 * money for the ice (iceWorth, the credit slide), and the clicks are not also clicks for anything else. Without it each
 * advance paid for the rez money it used up while the agenda's worth rose only by the click it saved, and a turn that
 * could score stopped an advance short (advanceScore's 40 forced it). With it an advance toward the finish is about 0,
 * any other use of those clicks or credits shows what the finish loses, and a play that makes an agenda finishable
 * (Nanomanagement, Seamless Launch) shows the whole finish. Agendas nearest to done first; one at a time, so a second
 * agenda is finished on what the first leaves. Null: nothing to finish. Inside a projection (prompts it answers price
 * positions too) agendas are taken as they are.
 */
let projecting = false;
const projections = new WeakMap<GameState, GameState | null>();

function finishedAgendas(state: GameState): GameState | null {
  if (projecting || state.activePlayer !== 'corp' || state.activeRun || state.winner) return null;
  if (projections.has(state)) return projections.get(state)!;
  projecting = true;
  let out: GameState | null = null;
  try {
    let s = state;
    for (;;) {
      const next = finishOne(s);
      if (!next) break;
      s = next;
    }
    out = s === state ? null : s;
  } finally {
    projecting = false;
  }
  projections.set(state, out);
  return out;
}

function finishOne(state: GameState): GameState | null {
  const corp = state.corp;
  const agendas = Object.values(corp.servers)
    .flatMap(s => s.root.map(c => ({ card: c, server: s.id })))
    .filter(a => cardDef(a.card).type_code === 'agenda')
    .map(a => ({ ...a, need: Math.max(0, (cardDef(a.card).advancement_cost ?? 0) - a.card.advancementCounters) }))
    .filter(a => a.need <= corp.clicks && a.need <= corp.credits)
    .sort((a, b) => a.need - b.need);
  for (const { card, server, need } of agendas) {
    try {
      let s = state;
      for (let i = 0; i < need; i++) s = executeAction(s, { type: 'ADVANCE_CARD', player: 'corp', cardInstanceId: card.instanceId, serverId: server });
      s = executeAction(s, { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: card.instanceId });
      for (let i = 0; i < 4 && activePrompt(s)?.side === 'corp'; i++) s = executeAction(s, answerPrompt(s, 'corp', undefined, true));
      if (activePrompt(s) || s.activePlayer !== 'corp') continue; // a prompt left for the Runner: not this projection's to answer
      return s;
    } catch {
      // not legal as things stand (an agenda that can't be scored yet, a card that stops advancing): left as it is
    }
  }
  return null;
}
