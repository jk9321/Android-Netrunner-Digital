import { CardInstance, GameState, SideCode, cardDef } from '../core';
import { breakerScript, iceSubtypes, isIcebreaker } from '../core/engine/ice';
import { counters } from '../core/engine/cardEffects';
import { cardSynergy } from './synergyTags';
import { corpKeepValue, runnerCardValue } from './cardValues';
import { countersWorth } from './counterValues';
import { boardPlansWorth, hasBoardPlan } from './cardPlans';
import { AI_BREAKER_SHARE, breakerTypeWorth, iceTypeOdds, iceWorth } from './iceValues';
import { inIcedServer, payoutWait, payoutWorth, profileOf, turnsLeft } from './cardProfiles';
import { resourceTrashHqCost } from '../core/engine/actions/basic';
import { HAND_FLOOR, clickPrice, handByCard, heldWorth, ownHandValue, playedWorth } from './handValues';
import { CLICK, KNOBS, RATES, cardRate, flatlineWorth, guardLoop, handFilter, logValue, mean, memo, payoutSlide, pointValue, reachCard, setRunnerAgendaOdds, sideCreditValue, creditsLessCost } from './valueModel';
import { PACE, STEAL, coreSlotWorth, flatlineOdds, lifeGrip, runSuccess, stealOdds } from './effectValues';
import { remoteAgendaOdds, trapOdds, trashedCardCost } from './runs';
import { plan, pricing, withPricing } from './pricing';
import { corpDrawPool, oracleSteal } from './oracle';
import { CARDS } from './cards';


/**
 * Board evaluation shared by both AIs, in "credit" units: a credit is worth
 * 1, a click about 1, a card in hand about 1.5 while the hand is small.
 * Scores compare positions one action apart, so only differences matter.
 *
 * The deck-aware AI's terms (tag threat, ice-type coverage) are in every
 * evaluation since plan.tagClock and plan.breakerCredits were folded.
 */

/**
 * Value of a hand of `size` cards: the first few matter most, cards over
 * the limit next to nothing (they will be discarded; with plan.handFilter the
 * first one over lets the worst card go). With plan.drawValue a card
 * up to the limit is worth what a credit is to a short side.
 */
export function handValue(size: number, limit: number, viewer: SideCode): number {
  const card = DRAWN_CARD;
  let value = 0;
  for (let i = 0; i < size; i++) value += i < RATES.handCoreCards ? RATES.handCore : i < limit ? card : i === limit ? handFilter() : 0;
  return logValue('hand', 'handValue', undefined, value, size, limit, viewer);
}

/** Worth of a card in hand beyond the first three, up to the limit (plan.drawValue). */
export const DRAWN_CARD = RATES.drawnCard;

const isEcon = (card: CardInstance) => (cardSynergy(cardDef(card)).gives?.econ ?? 0) >= 0.5;

/**
 * Extra worth of drawing a card (plan.dig, Jeff): for each problem the hand
 * can't answer but the deck still can (no money, no ice for the Corp, no
 * breaker for an ice type the Runner faces), the chance the next card is an
 * answer, more while the opponent is close to winning or about to score.
 * Each side only looks at its own deck's contents, never its order. Owner of digging for an answer (registry V17).
 */
export function digValue(state: GameState, side: SideCode): number {
  const odds = (deck: CardInstance[], answers: (c: CardInstance) => boolean) => (deck.length > 0 ? deck.filter(answers).length / deck.length : 0);
  let value = 0;
  if (side === 'corp') {
    const corp = state.corp;
    const pressure = state.runner.score >= 5 ? 1 : state.runner.score >= 3 ? 0.5 : 0;
    const iced = (id: string) => (corp.servers[id]?.ice.length ?? 0) > 0;
    // plan.digPastLimit: ice too dear to rez soon (its cost past the credits and a turn's clicks) is no answer either
    const usableIce = (c: CardInstance) => cardDef(c).type_code === 'ice' && ((cardDef(c).cost ?? 0) <= corp.credits + 3);
    const needIce = !corp.hq.some(usableIce) && (!iced('rd') || !iced('hq') || corp.hq.some(c => cardDef(c).type_code === 'agenda'));
    const needMoney = corp.credits < 5 && !corp.hq.some(isEcon);
    // plan.oracle.rd: the next card itself
    const deck = corpDrawPool(state);
    if (needIce) value += Math.min(1.2, 3 * odds(deck, c => cardDef(c).type_code === 'ice') * (1 + pressure));
    if (needMoney) value += Math.min(1.2, 3 * odds(deck, isEcon) * (1 + pressure));
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

export function runnerRigValue(state: GameState): number {
  const rig = state.runner.rig;
  const cards = [...rig.programs, ...rig.hardware, ...rig.resources];
  const { covered, anyBreakers } = rigCoverage(rig.programs);
  // Step 5b: each ice type by the stops it saves; an AI breaker covers the rest at a discount
  const aiShare = anyBreakers === 0 ? 0 : Math.max(...rig.programs.filter(p => breakerScript(p)?.breaks === 'any').map(p => (isOneUse(p) ? AI_BREAKER_SHARE / 3 : AI_BREAKER_SHARE)));
  const odds = iceTypeOdds(state);
  let value = ICE_TYPES.reduce((n, t) => n + (covered.has(t) ? 1 : aiShare) * breakerTypeWorth(state, t, odds), 0);
  for (const card of cards) value = addRigCard(state, card, value);
  // Combos in play (Knickknack burning Principia, Baker on stealth credits): plan.cardPlans
  return value + boardPlansWorth(state, 'runner');
}


/**
 * One rig card's term in runnerRigValue, added to `value` (the running total) and returned: the loop's own body, so the
 * rig's sum keeps its order bit for bit. From 0 it is the card's own term, which the tag clock reads (tagLoss).
 */
function addRigCard(state: GameState, card: CardInstance, value: number): number {
  // Step 4: a card that pays out money is worth what it will still pay
  const profile = profileOf(card.cardCode);
  if (profile) return value + payoutWorth(profile, turnsLeft(state), counters(card, 'credit'), payoutWait(state, profile, 'runner'), cardRate(state, 'runner', 'later')) * payoutSlide(state, 'runner', counters(card, 'credit'));
  // A breaker is worth its coverage above (plan.flatRates.breakers: no flat extra for having one)
  value += isIcebreaker(card) ? 0 : RATES.rigCardScale * runnerCardValue(card.cardCode, state, card);
  // Counters by what they do on this card (step 3), or the step-1 rates
  value += countersWorth(state, card, 'credit') + countersWorth(state, card, 'virus') + countersWorth(state, card, 'power');
  // Bling, Madani: cards to play later, worth what they would be in the grip (plan.flatRates.hosted);
  // Madani's install takes no click, so its programs keep the click they will save (plan.madaniClick).
  // Corp cards hosted on Detente are not the Runner's to play: Detente's own value covers them
  const hosted = (card.hostedCards ?? []).filter(h => cardDef(h).side_code === 'runner');
  const freeInstall = !!CARDS[card.cardCode]?.freeInstallHosted;
  value += hosted.reduce((n, h) => n + heldWorth(state, h, 'runner', freeInstall), 0);
  return value;
}

/**
 * Worth of an installed Corp root card (assets and upgrades). `left` (the Runner's trash-or-leave reader only, runs.ts
 * serverWorth): what the card still pays the Corp if it is left alone, its payouts not discounted by the chance the
 * Runner trashes it (RUNNER-ASSET-TRASH; Stage D's D9 reads the default, the expected worth). Owner of a Corp card's
 * worth on the board (docs/ai-priced-quantities.md, valuation table).
 */
export function corpCardValue(card: CardInstance, state?: GameState, viewer: SideCode = 'corp', left = false): number {
  const flat = () => logValue('boardCard', 'corpCardValue flat (loop)', state, corpKeepValue(card.cardCode), card, viewer, left);
  return logValue('boardCard', 'corpCardValue', state, guardLoop(state, `corp card ${cardDef(card).title} ${card.instanceId}${left ? ' left' : ''}`, flat, () => corpCardWorth(card, state, viewer, left)), card, viewer, left);
}

function corpCardWorth(card: CardInstance, state: GameState | undefined, viewer: SideCode, left = false): number {
  const spent = state && card.isRezzed ? CARDS[card.cardCode]?.spent : undefined;
  if (spent) return spent(state!, viewer, card); // a rezzed card whose rez effect is done (Spin Doctor), as `viewer` knows it (V-B B6)
  const hosted = counters(card, 'credit');
  const power = state && card.isRezzed ? countersWorth(state, card, 'power') : 0;
  const profile = state ? profileOf(card.cardCode) : undefined;
  if (state && profile && !(card.isRezzed && hosted > 0)) return card.isRezzed ? payoutWorth(profile, turnsLeft(state), hosted, payoutWait(state, profile, 'corp', inIcedServer(state, card), left), cardRate(state, 'corp', 'later')) : corpKeepValue(card.cardCode, state); // hosted credits: the owner's, below (V-B B6 item 33)
  if (card.isRezzed && hosted > 0) {
    return 1 + (state ? countersWorth(state, card, 'credit') : hosted * RATES.counters.hostedCredit) + power;
  }
  return corpKeepValue(card.cardCode, state, card.isRezzed) + power;
}

/** A Corp card the Runner can't see: installed, unrezzed and facedown. */
// A card the Runner has accessed or been shown in place (runnerKnows) isn't hidden from it (Gemini audit 2.2b)
const isHidden = (card: CardInstance) => !card.isRezzed && !card.faceUp && !(card.runnerKnows);

/**
 * What the Runner can expect of a facedown installed Corp card, worked out
 * from the cards it hasn't seen: the Corp's decklist minus everything
 * public. It never looks at the card itself. `agenda` is the chance it's an
 * agenda, `agendaCost` the typical advancement those agendas need, and
 * `other` the average worth of the assets and upgrades it could be instead.
 */
export function hiddenCardOdds(state: GameState): { agenda: number; agendaCost: number; agendaPoints: number; other: number } {
  // Memoised per position and pricing context: plan.oneAgendaGuess reads it once per remote card inside the threat
  // model's run scoring (review-2 R5: +18% time per decision unmemoised)
  return memo(state, 'hiddenCardOdds', () => hiddenCardOddsOf(state));
}

/**
 * The Corp's cards the Runner can't see, unfiltered: HQ, R&D, facedown Archives and facedown installed root cards (the
 * pool hiddenCardOdds and the tag-punisher share read; ai-honest-runner-view, red team 11).
 */
export function unseenCorpPool(state: GameState): CardInstance[] {
  const corp = state.corp;
  const installed = Object.values(corp.servers).flatMap(server => server.root.filter(isHidden));
  return [...corp.hq, ...corp.rd, ...corp.archives.faceDown, ...installed];
}

// valueModel.ts boardNeed (the Runner's estimate of the Corp's need, ai-honest-runner-view) reads the run model's agenda
// odds for a facedown root card through this port, its trap input at the no-memory value
setRunnerAgendaOdds((state, server, card) => remoteAgendaOdds(state, server, card, card.advancementCounters > 0 ? trapOdds(state) : 0));

function hiddenCardOddsOf(state: GameState): { agenda: number; agendaCost: number; agendaPoints: number; other: number } {
  const unseen = unseenCorpPool(state)
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

/** What a Corp click spent advancing could have built instead (plan.agendaClicks). Owner of a Corp click spent advancing (registry V16). */
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
 * openness: the ice there against the rig). Owner of an installed agenda (registry, valuation table).
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
  budget: { clicks: number; credits: number } = state.corp,
  /** The Runner's chance a turn to steal it, when known otherwise (an agenda to go into a new, bare remote: 1). */
  stealChance?: number
): number {
  const gain = pointValue(state.corp.score + points, KNOBS.corpPoints) - pointValue(state.corp.score, KNOBS.corpPoints);
  const need = Math.max(0, cost - counters);
  // Jeff's open-remote rule (2026-10-29, plan.openSteal): an agenda going into a new remote with no ice (no server yet,
  // success 1: handValues' hand price) sits in an open remote the Runner can see, as good as stolen; the same rule for a
  // remote that exists is in stealOdds
  const openNew = plan().openSteal && !serverId && success === 1 ? 1 : undefined;
  const steal = stealChance ?? openNew ?? (
    success === undefined && serverId
      ? oracleSteal(state, serverId) ?? stealOdds(state, serverId) // plan.oracle.safestRemote: told the Runner's next turn
      : STEAL.run * (success ?? (serverId ? runSuccess(state, serverId) : PACE.success)));
  // Agenda tempo (Jeff, 2026-10-28): the Runner turns until the Corp has the clicks to finish it (installing from hand is one more),
  // each a run that may get in and a turn closer to the end of the game (about 1 in turnsLeft)
  // plan.agendaCredits (Jeff's bug report, 2026-10-31): each advancement costs a credit (rule 5.2.6 basic actions: [click], 1[credit]: advance), so a Corp short of
  // credits needs a click to gain each missing one first ([click]: gain 1[credit]); at 0 credits an agenda can't be finished "this turn" on clicks alone
  const runnerTurns = agendaRunnerTurns(state, need, inHand, budget);
  const late = 1 - 1 / turnsLeft(state);
  const waited = (turns: number) => late ** turns;
  // plan.agendaClicks (Jeff's Corp game 2, bug report #18): the clicks still needed are clicks a later turn can't spend
  // building; priced at the flat click rate, building now and scoring next turn always beat scoring now and building next
  const click = AGENDA_CLICK;
  const standing = (1 - steal) ** runnerTurns;
  return logValue('agenda', 'agendaWorth', state, gain * standing * waited(runnerTurns) - need * (click + 1), counters, cost, points, serverId, success, inHand, budget, stealChance);
}

/**
 * The Runner turns an agenda waits before the Corp has the clicks (and the credits, a click each short: plan.agendaCredits)
 * to finish it: on the Runner's turn it is exposed now, then the Corp's next turn has 3 clicks.
 */
function agendaRunnerTurns(state: GameState, need: number, inHand: boolean, budget: { clicks: number; credits: number }): number {
  const short = Math.max(0, need - budget.credits);
  const clicks = need + (inHand ? 1 : 0) + short;
  return state.activePlayer === 'corp' ? Math.ceil(Math.max(0, clicks - budget.clicks) / 3) : 1 + Math.ceil(Math.max(0, clicks - 3) / 3);
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
  // The measured breach rate, not the Runner's scorer: it prices a facedown Archives card as one the Corp rarely chose to
  // discard (runs.ts ARCHIVES_CHOSEN_ODDS), so the threat model (deleted 2026-11-16) read Archives as almost never run (0.10
  // on Jeff's games against 0.31 breached): read as safety, the Corp would discard agendas into the Runner AI's blind
  // spot, the first thing a person checks
  const perTurn = PACE.facedownBreach;
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
  if (viewer !== 'corp' || state.activePlayer !== 'corp') return undefined;
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
    const short = Math.max(0, need - credits);
    if (need + short <= clicks) {
      clicks -= need + short;
      credits = Math.max(0, credits - need);
    }
  }
  return budgets;
}

/** The Corp's installed cards, as `viewer` can judge them: the Runner values facedown cards by the odds, not by what they are. */
export function corpBoardValue(state: GameState, viewer: SideCode): number {
  let value = 0;
  let odds: ReturnType<typeof hiddenCardOdds> | undefined;
  const budgets = agendaBudgets(state, viewer);
  for (const server of Object.values(state.corp.servers)) {
    for (const ice of server.ice) value += iceWorth(state, ice, viewer);
    for (const card of server.root) {
      if (viewer === 'runner' && isHidden(card)) {
        odds ??= hiddenCardOdds(state);
        // plan.oneAgendaGuess (code audit cleanup item 9): the odds the run choice uses (runs.ts remoteAgendaOdds: more
        // likely an agenda behind ice, and an advanced card one unless it's a trap), so a run doesn't look worth making
        // while the board says the card isn't worth stealing, or the other way round
        const agenda = plan().oneAgendaGuess && server.isRemote ? remoteAgendaOdds(state, server, card, 1 / 3) : odds.agenda;
        value += agenda * agendaWorth(state, card.advancementCounters, odds.agendaCost, odds.agendaPoints, server.id) + (1 - agenda) * odds.other;
        continue;
      }
      const def = cardDef(card);
      if (def.type_code === 'agenda') value += agendaWorth(state, card.advancementCounters, def.advancement_cost ?? 0, def.agenda_points ?? 1, server.id, undefined, false, budgets?.get(card.instanceId));
      else value += corpCardValue(card, state, viewer);
    }
  }
  return value + archivedAgendasValue(state, viewer);
}

/**
 * The tag clock (Jeff, 2026-10-28; plan.tagClock): what tags on the Runner
 * are worth, to the Corp and against the Runner. Each Corp turn a tagged
 * Runner can lose its best resource (the Corp's basic trash action: a click
 * and 2 credits, rule 4.4.1) or a card to a tag punisher (Retribution) the
 * Corp holds, as far as `viewer` knows. The Runner clears a tag for a click
 * and 2 credits when keeping it costs more, so tags are worth the cheaper. Owner of a tag, both views (registry).
 * Enters evaluate once (the Runner's strength); no other reader discounts a Runner card for a tag (F108, 2026-11-25).
 */
export function tagsWorth(state: GameState, viewer: SideCode, count?: number, memoHome?: GameState): number {
  // Tags the Runner has now, or a count priced as if given (an ice subroutine, an operation)
  const actual = count === undefined;
  const tags = count ?? state.runner.tags;
  if (tags <= 0) return 0;
  // Inside the tag clock's own pricing of the rig, a tag is the flat rate (a resource's worth can depend on tags)
  if (pricing().pricingTagLoss) return logValue('tag', 'tagsWorth flat (tag clock)', state, tags * RATES.tagAgainstRunner, viewer, count);
  const flat = () => logValue('tag', 'tagsWorth flat (loop)', state, tags * RATES.tagAgainstRunner, viewer, count);
  return logValue('tag', 'tagsWorth', state, guardLoop(state, `tags ${viewer}`, flat, () => tagClock(state, viewer, tags, actual, memoHome)), viewer, count, memoHome);
}
/** One tag the Runner takes, and one it removes, as the Runner sees it: the owner's own difference (V-B B5; tagCost's). */
export const tagTaken = (state: GameState, home?: GameState): number => tagsWorth(state, 'runner', state.runner.tags + 1, home) - tagsWorth(state, 'runner', state.runner.tags, home);
export const tagRemoved = (state: GameState): number => tagsWorth(state, 'runner', state.runner.tags) - tagsWorth(state, 'runner', state.runner.tags - 1);
/** A card's own tag (B5 arm F): the owner's difference for a card on the board; drawn, in the deck's average or in the hand, the flat rate (as Vic's drawn card). */
export const cardTag = (state: GameState, code: string, removed = false): number =>
  pricing().averaging || ![state.runner.rig.programs, state.runner.rig.hardware, state.runner.rig.resources].some(cs => cs.some(c => c.cardCode === code)) ? RATES.tagAgainstRunner : removed ? tagRemoved(state) : tagTaken(state);

/**
 * `memoHome` (ai-value-time step 1): the state `state` was copied from with only the Runner's clicks changed (tagCost's
 * one-click-fewer copy). The clock's per-turn loss is then kept on that original, keyed with the copy's clicks, so it
 * is worked out once per original board and not once per copy; the work still runs on the copy.
 */
function tagClock(state: GameState, viewer: SideCode, tags: number, actual: boolean, memoHome?: GameState): number {
  // plan.tagTrashNow: on the Corp's turn, with the Runner tagged and a click and 2 credits to trash, the Corp takes the
  // best resource now (the trash action is scored by it), so the clock after this turn runs on the next best
  const corp = state.corp;
  const trashNow = plan().tagTrashNow && state.activePlayer === 'corp' && !state.activeRun && state.runner.tags > 0 && corp.clicks >= 1 && corp.credits >= 2;
  const skip = trashNow ? 1 : 0;
  const perTurn = memoHome
    ? memo(memoHome, `tagLoss:${viewer}:${skip}:c${state.runner.clicks}`, () => tagLossPerTurn(state, viewer, skip))
    : memo(state, `tagLoss:${viewer}:${skip}`, () => tagLossPerTurn(state, viewer, skip));
  const clear = CLICK + 2;
  // plan.tagNoClear (Gemini audit, 2026-11-01): a Runner that can't clear before the Corp's next turn (the Corp's turn
  // now, or its last click or 2 credits spent) sits through that turn first
  const runner = state.runner;
  const stuck = !(state.activePlayer === 'runner' && runner.clicks >= 1 && runner.credits >= 2);
  // Kept, a tag costs this turn's loss and maybe the next; the Runner clears the ones that cost more than clearing
  // plan.tagTrashNow (Jeff, 2026-11-04): on the Corp's turn, this turn's loss is what its trash action takes, and the
  // action is scored by that; counted in the tag as well, keeping the tag looked as good as using it, so the Corp
  // never trashed. Only the turns after count (the Runner may keep the tag through its turn). Tags priced as if
  // given (by ice during a run, by an operation) keep the full clock: the Corp trashes with them on a later turn.
  const corpTurn = plan().tagTrashNow && actual && state.activePlayer === 'corp' && !state.activeRun;
  const worth = corpTurn
    ? Math.min(tags * clear, 0.5 * perTurn + 0.1 * (tags - 1))
    : Math.min((stuck ? perTurn : 0) + tags * clear, 1.5 * perTurn + 0.1 * (tags - 1));
  const clearing = CARDS[state.runner.identity.cardCode]?.tagClear;
  return clearing ? Math.min(worth, clearing(state, tags, perTurn)) : worth;
}

/** What a tagged Runner stands to lose each Corp turn, as `viewer` sees it (exported for tests/tagLossTime.test.ts). */
export function tagLossPerTurn(state: GameState, viewer: SideCode, skip = 0): number {
  // The tag clock is pricing the rig: tags are the flat rate in there (a copy of the position, so it is not a value loop).
  // The trash's cost (part C) is read in here too, inside the frame: read outside it, its need (creditNeed -> the keep
  // -> the hold walk -> tagCost -> tagsWorth) re-entered the clock on new boards without end (F110 step 9, NRDB deal
  // 1281; tests/tagClockInput.test.ts). Inside, tagsWorth is the flat rate and the walk ends
  return withPricing({ pricingTagLoss: true }, () => tagLoss({ ...state }, viewer, skip));
}

function tagLoss(state: GameState, viewer: SideCode, skip: number): number {
  const corp = state.corp;
  const owned = state.runner.rig.resources;
  // The best resource the Corp would trash, net of what trashing costs it (the basic action "[click], 2[credit]: Trash 1
  // resource", rule 5.2.6g). No rig is priced when no resource could be the answer (ai-tag-loss-time arm 0, exact: the
  // loss is the same number): the Runner has none; none is left past `skip` (the one tagTrashNow takes this turn); or
  // the Corp has under the 2 credits the action costs. The trash part is then 0, as max(trash, 0) below made it
  let trash = 0;
  if (owned.length > skip && corp.credits >= 2) {
    // A resource is priced by its own term in the rig (addRigCard, no new board) plus its share of the combo plans (only the
    // plans priced without it). Left out, as a stated approximation (ai-tag-loss-bp; registry V7): what its leaving does
    // to the other cards' terms (the deck average, credit sources, breaker coverage); 0.23% of clocks, measured
    const plans = hasBoardPlan(state, 'runner') ? boardPlansWorth(state, 'runner') : undefined;
    const share = (r: CardInstance) => (plans === undefined ? 0 : plans - boardPlansWorth({ ...state, runner: { ...state.runner, rig: { ...state.runner.rig, resources: owned.filter(c => c !== r) } } }, 'runner'));
    const resources = owned.map(r => addRigCard(state, r, 0) + share(r));
    // plan.hqTrashCost: a resource that also costs cards from HQ to trash is worth that much less to trash
    const extra = (r: CardInstance) => (plan().hqTrashCost ? hqTrashCardsLoss(state, r) : 0);
    const nets = resources.map((v, i) => v - extra(owned[i])).sort((a, b) => b - a);
    // plan.tagTrashNow: a Corp that can trash now takes the best one this turn; the turns after lose the next best.
    // The basic action's cost is its owners' price as `viewer` prices it (F110 part C, rule 5.2.6g): the click's owner
    // and the 2 credits on the credit's owner's slide, read on this board (a stated approximation: the board's own
    // change for the click and the credits is not read; registry). N1 (ruling 3, the ai-hold-reentry precedent): inside an
    // open hold count the cost is the flat CLICK + 2, so the credit's need (the keep's own hold count) is not asked there
    const cost = pricing().countingHold ? CLICK + 2 : clickPrice(state, 'corp', viewer) + creditsLessCost(state, 'corp', viewer, 2);
    trash = Math.max(0, nets[skip] ?? 0) - cost;
  }
  // A tag punisher in HQ: known to the Corp, the decklist's odds to the Runner. Which card is one, by view (F114 part P),
  // the one place the two views differ (Runner rework coordinator, 2026-11-27). The Corp's view: a flagged card the
  // Corp plays from HQ on its own turn, an operation; an ice, an agenda, an asset or an identity with the flag is no
  // card to play (Orbital Superiority's damage is the damage clock's, effectValues.ts ownTurnDamage). The Runner's view
  // keeps the flag alone, as its tagCost has no other reader of Orbital's kill; the split goes when F119 carries that
  // damage in both views (tracker, F119)
  const flagged = (c: CardInstance) => cardSynergy(cardDef(c)).when?.includes('ifTagged') ?? false;
  const punisherByView: Record<SideCode, (c: CardInstance) => boolean> = { corp: c => flagged(c) && cardDef(c).type_code === 'operation', runner: flagged };
  const punishes = punisherByView[viewer];
  let held: number;
  if (viewer === 'corp') held = corp.hq.some(punishes) ? 1 : 0;
  else {
    // ai-honest-runner-view (valuation audit VAL-RUNNER-TAG-POOL): the one unseen pool, facedown Archives included, so
    // the share doesn't tell where an unseen punisher went
    const unseen = unseenCorpPool(state);
    const share = unseen.length ? unseen.filter(punishes).length / unseen.length : 0;
    held = 1 - (1 - share) ** corp.hq.length;
  }
  const punish = held * trashedCardCost(state);
  return Math.max(trash, 0) + punish + (punishes(corp.identity) ? 1 : 0);
}

/** A side's clicks left and its hand, each on its own. */
export function handAndClicks(state: GameState, side: SideCode, viewer: SideCode): number {
  const player = side === 'corp' ? state.corp : state.runner;
  const hand = side === 'corp' ? state.corp.hq : state.runner.grip;
  // plan.heldMoney: the money operation moneyReach puts on the Corp's credit slide is worth its credits there, not
  // a card in HQ as well (held, Hedge Fund was counted twice and playing it scored below a click for a credit)
  const reached = side === 'corp' && viewer === 'corp' && reachCard(state) ? 1 : 0;
  const own =
    side === viewer && handByCard(side)
      ? ownHandValue(state, side)
      : handValue(hand.length - reached, player.handSizeLimit, viewer);
  logValue('hand', 'handAndClicks', state, own, side, viewer);
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
  return logValue('hand', 'hqTrashCardsLoss', state, losses.length < k ? Infinity : losses.slice(0, k).reduce((n, v) => n + v, 0), resource);
}

/** The flat worth of the first cards in hand as life against damage, which the damage clock replaces. */
const lifeCards = (size: number): number => logValue('hand', 'lifeCards', undefined, Math.min(size, RATES.handCoreCards) * (RATES.handCore - RATES.drawnCard), size);

export function sideStrength(state: GameState, side: SideCode, viewer: SideCode = side): number {
  if (side === 'corp') {
    const corp = state.corp;
    return (
      sideCreditValue(state, 'corp', viewer) +
      handAndClicks(state, 'corp', viewer) +
      pointValue(corp.score, viewer === 'corp' ? KNOBS.corpPoints : 1) +
      corpBoardValue(state, viewer) +
      // No tag line: the Runner's side holds the clock, once (F108, 2026-11-25; a Corp line read each tag twice in evaluate)
      // Dividends and Next Big Thing counters, AU Co. power counters
      corp.scoreArea.reduce((n, a) => n + countersWorth(state, a, 'agenda'), 0) +
      countersWorth(state, corp.identity, 'power')
    );
  }
  const runner = state.runner;
  return (
    sideCreditValue(state, 'runner', viewer) +
    handAndClicks(state, 'runner', viewer) +
    pointValue(runner.score) -
    tagsWorth(state, viewer) -
    coreSlotWorth(state) * runner.coreDamage -
    // The damage clock: a small grip against the Corp's damage is a step toward a flatline
    logValue('damage', 'board clock', state, flatlineWorth(state) * flatlineOdds(state, lifeGrip(state), true) + lifeCards(runner.grip.length)) +
    runnerRigValue(state)
  );
}

/** How good the position is for `side` (mine minus theirs; a win is decisive). */
export function evaluate(state: GameState, side: SideCode): number {
  if (state.winner) return logValue('gameEnd', 'evaluate', state, state.winner === side ? 1000 : -1000, side);
  const other: SideCode = side === 'corp' ? 'runner' : 'corp';
  return sideStrength(state, side, side) - sideStrength(state, other, side);
}

/**
 * How much a side would like to keep each card in hand (for discards and
 * for effects that trash, shuffle away or fetch cards).
 */
export function keepValue(state: GameState, card: CardInstance): number {
  // Jeff, 2026-10-28: what the card adds once played, before its click (at least the hand floor); an agenda let go goes
  // to Archives, where the Runner likely steals it. (The old flat keep table, plan.keepByModel off, deleted 2026-11-06.)
  const loss = cardDef(card).type_code === 'agenda' ? archivedAgendaLoss(state, cardDef(card).agenda_points ?? 1) : 0;
  return logValue('hand', 'keepValue', state, Math.max(HAND_FLOOR, playedWorth(state, card) + CLICK) + loss, card);
}

