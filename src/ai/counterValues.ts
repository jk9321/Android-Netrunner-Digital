import { CardInstance, GameState, SideCode, cardDef } from '../core';
import { findCardAnywhere } from '../core';
import { counters, rezCost, stealthCredits } from '../core/engine/cardEffects';
import { tuning } from './synergy';
import { CLICK, RATES, cardRate, handFilter, pointValue, sideCards } from './valueModel';
import { bestBreakPlan } from './runs';
import { PACE, accessWorth, conduitCounterWorth, damageWorth, runSuccess } from './effectValues';
import { PAYOUT_RISK } from './cardProfiles';
import { corpKeepValue } from './cardValues';
import { boostCostOf, breakerScript, isIcebreaker } from '../core/engine/ice';

/**
 * Value model step 3 (docs/ai-value-model-plan.md): a counter is worth
 * what it does on the card it sits on (Jeff), never a flat rate for its
 * type. Each entry prices one counter of one type on one card, in credits,
 * against the board it is on now. Cards not listed keep the step-1 rates.
 * tests/counterValues.test.ts checks each entry with a worked example.
 */
type CounterType = 'credit' | 'virus' | 'power' | 'agenda';
type CounterWorth = (state: GameState, card: CardInstance) => number;

/** Credits paid out a few at a time on the Corp's turn: a little under face value, since the Runner can trash the asset first. */
const PAID_OUT = 0.85;

export const COUNTER_WORTH: Record<string, Partial<Record<CounterType, CounterWorth>>> = {
  // ---- Corp ----
  '30037': { credit: () => PAID_OUT }, // Nico Campaign: 3 a turn, no click
  '35040': { credit: () => PAID_OUT }, // Otto Campaign: 2 a turn, no click
  '35072': { credit: () => PAID_OUT }, // Anthill Excavation Contract: 4 a turn and a card
  '30071': { credit: () => 1 - RATES.click / 3 }, // Regolith Mining License: 3 credits per click
  '35082': { credit: () => 0.8 }, // Mahkota Langit Grid: recurring, only for rezzes in its server
  '35051': { power: () => 1.5 }, // Phật Gioan Baotixita: 1 net damage each, when an agenda is scored or stolen
  '35046': { power: () => 1.5 }, // AU Co.: 2 counters look at 3, keep 2 of them
  // Agenda counters in the score area, by what spending one does
  '35038': { agenda: () => 3 }, // Project Ingatan: install a card from Archives for free
  '35049': { agenda: () => 4 }, // Sericulture Expansion: 2 advancement counters (2 clicks and 2 credits)
  '35059': { agenda: () => 1.5 }, // Embedded Reporting: an operation to the top of R&D
  '35071': { agenda: () => 3.5 }, // Off the Books: fetch any card, installed for free
  '35060': { agenda: () => 3 }, // Next Big Thing: a click for 4 cards and a reshuffle
  '35048': { agenda: () => 3 }, // Proprionegation: sends a run back to Archives once
  '36037': { agenda: () => 1 }, // Lotus Haze: moves a rezzed upgrade to another server
  '36035': { power: () => 1.5 }, // Perfect Recall: keeps the Runner off copies of one card for a run
  '36045': { power: () => 2 }, // The Red Room: ends a run on another server
  // ---- Runner ----
  // Smartware Distributor: 1 a turn, so the k-th hosted credit waits k turns (stacking more is worth less and less)
  '30033': { credit: (_state, card) => paidOneATurn(counters(card, 'credit')) },
  '35029': { credit: () => 0.8 }, // Azimat: recurring, only for trash costs
  '30018': { credit: () => 0.7 }, // Red Team: 3 per successful click-run on a central not yet run this turn
  '35034': { credit: () => 0.9 }, // Side Hustle: all taken (and a card drawn) once it holds 6
  '30014': { credit: () => 0.85 }, // Pennyshaver: all taken with a click, which adds 1 more
  '30007': { virus: () => 2 - RATES.click / 4 }, // Fermenter: 2 credits each, for a click and the card (cashed at about 4)
  '30008': { virus: () => 0.9 }, // Leech: -1 strength on an encounter, about a credit of boosting
  '35008': { virus: () => 1 }, // Hantu: +2 strength for a boost
  '30024': { virus: state => (tuning.plan.cardFixes ? conduitCounterWorth(state) : 1.2) }, // Conduit: 1 more card accessed on each Conduit run still to come
  '35031': { power: () => 1.2 }, // Devadatta Drone: 1 more card accessed on an R&D breach
  '35010': { power: () => 1.2 }, // Cacophony: 2 counters sabotage 3
  '36005': { power: state => (stealthCredits(state) > 0 ? 2 : 0.5) }, // Lampades: a paid trash of an accessed card, with stealth credits only
  '36020': { credit: () => 0.9 }, // Methuselah: run credits only (Baker's fuel: cardPlans.ts)
  '36021': { credit: () => 0.9 }, // Touchstone: run credits only (Baker's fuel: cardPlans.ts)
  // Botulus: each counter breaks 1 subroutine on its host, worth what breaking one costs (3 if nothing breaks it)
  '30004': { virus: (state, card) => trojanHostWorth(state, card, host => Math.min(3, bestBreakPlan(state, host, 1)?.credits ?? 3)) },
  // Tranquilizer: 3 counters derez its host, a third of the rez cost each
  '30017': { virus: (state, card) => trojanHostWorth(state, card, host => (host.isRezzed ? rezCost(state, host) / 3 : 0.3)) },
};

/*
 * The last hand-set counter rates (Jeff, 2026-10-28; plan.counterFormulas):
 * each one worked out from what the counter turns into, in the model's
 * units, from the board and decklists. The old numbers stay for when the
 * switch is off. tests/counterValues.test.ts works each one through.
 */

/** Free credits paid out on the Corp's turn: each turn's payout survives the Runner trashing the asset first. */
const paidOut = (): number => 1 - 2 * PAYOUT_RISK.corpBare;

/** Average of a list, or a fallback for an empty one. */
const mean = (xs: number[], fallback: number): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : fallback);

/** A recurring credit spent only on some costs: worth a credit if those costs come up before it refills (a turn). */
const recurring = (uses: number): number => Math.min(1, uses / 2);

/** Mahkota Langit Grid: the rez costs still to pay in its server. */
function mahkotaCredit(state: GameState, card: CardInstance): number {
  const server = Object.values(state.corp.servers).find(s => s.root.some(c => c.instanceId === card.instanceId));
  const unrezzed = server ? [...server.ice, ...server.root].filter(c => !c.isRezzed && c.instanceId !== card.instanceId) : [];
  const owed = unrezzed.reduce((n, c) => n + (cardDef(c).cost ?? 0), 0);
  // No server yet (in hand): the ice and assets the deck puts behind a scoring remote
  return recurring(server ? owed : 2);
}

/** Azimat: the trash costs the Runner pays in a turn, from the Corp's decklist. */
function azimatCredit(state: GameState): number {
  const costs = sideCards(state, 'corp').map(c => cardDef(c).trash_cost).filter((t): t is number => typeof t === 'number');
  return recurring(PACE.paidTrashes * mean(costs, 3));
}

/** Red Team: 3 credits per successful click-run, the click shared with the access it also gets. */
function redTeamCredit(state: GameState): number {
  // A successful central run takes 3; a failed one waits for the next (plan.runOpenness: as open as HQ and R&D are)
  const success = tuning.plan.runOpenness ? Math.max(runSuccess(state, 'hq'), runSuccess(state, 'rd')) : PACE.success;
  return success * (1 - CLICK / 3 / 2) + (1 - success) * PAYOUT_RISK.clickWait * (1 - CLICK / 6);
}

/** Side Hustle: one a run until 6, then all taken with a card; each waits for the rest. */
function sideHustleCredit(state: GameState, card: CardInstance): number {
  const turnsToFill = Math.max(0, 6 - counters(card, 'credit')) / PACE.runs;
  return PAYOUT_RISK.clickWait ** turnsToFill + cardRate(state, 'runner') / 6;
}

/** Pennyshaver: all taken with a click that adds 1 more, about every few turns. */
function pennyshaverCredit(card: CardInstance): number {
  const batch = Math.max(2, counters(card, 'credit'));
  return PAYOUT_RISK.clickWait * (1 - Math.max(0, CLICK - 1) / batch);
}

/** Leech: -1 strength on an encounter, what boosting a breaker by 1 costs (cheapest in the rig). */
function leechVirus(state: GameState): number {
  const perStrength = state.runner.rig.programs
    .filter(isIcebreaker)
    .map(b => {
      const amount = breakerScript(b)?.boostAmount(state, b) ?? 0;
      return amount > 0 ? boostCostOf(state, b) / amount : Infinity;
    })
    .filter(Number.isFinite);
  return PAYOUT_RISK.clickWait * (perStrength.length ? Math.min(2, Math.min(...perStrength)) : 0.5);
}

/** Hantu: +2 strength when a sentry is stronger than it, else spare. */
function hantuVirus(state: GameState, card: CardInstance): number {
  const strength = cardDef(card).strength ?? 0;
  const sentries = Object.values(state.corp.servers).flatMap(s => s.ice).filter(i => i.isRezzed && /sentry/i.test(cardDef(i).keywords ?? ''));
  return sentries.some(i => (cardDef(i).strength ?? 0) > strength) ? 2 * 0.5 : 0.5; // a boost of 2, at about half a credit per point (rig average)
}

/** Phật Gioan Baotixita: a net damage when an agenda is scored or stolen, most turns. */
const gioanPower = (state: GameState): number => Math.min(1, 2 * PACE.agendaEvents) * damageWorth(state, 1);

/** AU Co.: 2 counters look at 3 cards, keep 2: two cards drawn and a filter. */
const auCoPower = (state: GameState): number => (2 * cardRate(state, 'corp') + handFilter()) / 2;

/** Project Ingatan: install the best card in Archives for nothing (a click and its install cost saved). */
function ingatanAgenda(state: GameState): number {
  const archived = [...state.corp.archives.faceUp, ...state.corp.archives.faceDown].filter(c => cardDef(c).type_code !== 'operation' && cardDef(c).type_code !== 'agenda');
  const worth = archived.map(c => (cardDef(c).type_code === 'ice' ? RATES.ice : corpKeepValue(c.cardCode, state)));
  return CLICK * (archived.length ? 1 : 0.5) + (worth.length ? Math.max(...worth) : 0);
}

/** Sericulture Expansion: 2 advancement counters, each a click and a credit. */
const sericultureAgenda = (): number => 2 * (CLICK + 1);

/** Embedded Reporting: the best money operation left in R&D as the next draw, over an average draw. */
function embeddedAgenda(state: GameState): number {
  const gains = state.corp.rd.map(c => {
    const gain = (cardDef(c).stripped_text ?? '').match(/(?:^|\. )Gain (\d+) credits/);
    return cardDef(c).type_code === 'operation' && gain ? Number(gain[1]) - (cardDef(c).cost ?? 0) : 0;
  });
  return Math.max(0, Math.max(0, ...gains) - cardRate(state, 'corp'));
}

/** Off the Books: any card from R&D, installed for nothing: a card, a click, and the install it saves. */
function offTheBooksAgenda(state: GameState): number {
  const installs = state.corp.rd.filter(c => ['asset', 'upgrade', 'ice'].includes(cardDef(c).type_code ?? ''));
  return cardRate(state, 'corp') + CLICK + mean(installs.map(c => (cardDef(c).type_code === 'ice' ? 1 : 0)), 0.5);
}

/** Next Big Thing: a click for 4 cards, any shuffled back: new cards in the hand's free space, the rest swapped for its worst cards. */
function nextBigThingAgenda(state: GameState): number {
  const space = Math.min(4, Math.max(0, state.corp.handSizeLimit - state.corp.hq.length));
  const card = cardRate(state, 'corp');
  return space * card + (4 - space) * 0.5 * card - CLICK;
}

/** Proprionegation: once, a run on a scoring server sent to Archives: the steal it stops. */
function proprionegationAgenda(state: GameState): number {
  const typical = 2;
  return PACE.remoteShare * (pointValue(state.runner.score + typical) - pointValue(state.runner.score)) * 0.5;
}

/** Devadatta Drone: one more card on an R&D breach. */
const devadattaPower = (state: GameState): number => PAYOUT_RISK.clickWait * accessWorth(state);

/** Cacophony: 2 counters sabotage 3, the Corp picking its worst cards. */
const cacophonyPower = (state: GameState): number => (3 * 0.5 * cardRate(state, 'corp')) / 2;

/** The formulas, by card, while plan.counterFormulas is on. */
const COUNTER_FORMULAS: Record<string, Partial<Record<CounterType, CounterWorth>>> = {
  '30037': { credit: paidOut },
  '35040': { credit: paidOut },
  '35072': { credit: paidOut },
  '35082': { credit: mahkotaCredit },
  '35051': { power: gioanPower },
  '35046': { power: auCoPower },
  '35038': { agenda: ingatanAgenda },
  '35049': { agenda: sericultureAgenda },
  '35059': { agenda: embeddedAgenda },
  '35071': { agenda: offTheBooksAgenda },
  '35060': { agenda: nextBigThingAgenda },
  '35048': { agenda: proprionegationAgenda },
  '35029': { credit: azimatCredit },
  '30018': { credit: redTeamCredit },
  '35034': { credit: (s, card) => sideHustleCredit(s, card) },
  '30014': { credit: (_s, card) => pennyshaverCredit(card) },
  '30008': { virus: leechVirus },
  '35008': { virus: hantuVirus },
  '35031': { power: devadattaPower },
  '35010': { power: cacophonyPower },
};

/** Average worth of `n` hosted credits taken 1 a turn: each turn of waiting costs 15%. */
function paidOneATurn(n: number): number {
  let total = 0;
  for (let k = 1; k <= n; k++) total += 0.85 ** k;
  return n > 0 ? total / n : 0.85;
}

function trojanHostWorth(state: GameState, card: CardInstance, worth: (host: CardInstance) => number): number {
  const host = card.hostedOnId ? findCardAnywhere(state, card.hostedOnId) : undefined;
  if (host) return worth(host);
  // Not installed yet (in hand): on the best rezzed ice it could go on
  const rezzed = Object.values(state.corp.servers).flatMap(s => s.ice).filter(i => i.isRezzed);
  return rezzed.length ? Math.max(...rezzed.map(worth)) : 0.5;
}

/** Step-1 rates, for cards without an entry. */
function defaultWorth(card: CardInstance, type: CounterType): number {
  switch (type) {
    case 'credit':
      return card.cardCode === '30033' ? RATES.counters.smartwareCredit : RATES.counters.hostedCredit;
    case 'virus':
      return card.cardCode === '30007' ? RATES.counters.fermenterVirus : RATES.counters.virus;
    case 'agenda':
      return RATES.counters.scoredAgenda;
    case 'power':
      return cardDef(card).type_code === 'identity' ? RATES.counters.identityPower : 0;
  }
}

/** Worth of one counter of `type` on `card`, as `viewer` prices it. */
export function counterWorth(state: GameState, card: CardInstance, type: CounterType, viewer: SideCode): number {
  const entry = tuning.plan.counterEffects?.[viewer] ? ((tuning.plan.counterFormulas ? COUNTER_FORMULAS[card.cardCode]?.[type] : undefined) ?? COUNTER_WORTH[card.cardCode]?.[type]) : undefined;
  return entry ? entry(state, card) : defaultWorth(card, type);
}

/** Worth of all the counters of `type` on `card`. */
export const countersWorth = (state: GameState, card: CardInstance, type: CounterType, viewer: SideCode): number => {
  const n = counters(card, type);
  return n > 0 ? n * counterWorth(state, card, type, viewer) : 0;
};
