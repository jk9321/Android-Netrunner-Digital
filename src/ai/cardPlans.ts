import { CardInstance, GameState, SideCode, cardDef } from '../core';
import { threatLevel } from '../core/engine/cardEffects';
import { turnKey } from '../core/engine/helpers';
import { corpCardValue, tagsWorth } from './evaluate';
import { damageWorth } from './effectValues';
import { runStealthCredits, trashedCardCost } from './runs';
import { tuning } from './synergy';
import { CLICK, cardRate, pointGain } from './valueModel';

/**
 * Card plans (Jeff, 2026-10-30; plan.cardPlans): cards that pay off only
 * once something is set up, often over more than one turn.
 *
 * A hand plan prices a conditional event or operation in hand as its payoff
 * scaled by how ready its condition is (0 to 1), instead of the deck's
 * average card. The whole-turn planner scores the hand at the end of each
 * turn it plays out, so a turn that moves a condition along (credits saved
 * for Myōshu, a tag on the Runner before Retribution) scores higher.
 *
 * A board plan is an installed card whose worth depends on others in play
 * (Knickknack O'Brian burning Principia, Baker running on stealth credits):
 * it adds what the combo is worth on top of each card's own worth.
 *
 * Adding a set: scan its conditional cards ("play only if", "as an
 * additional cost", combos the generic value misses) and add a plan here,
 * with a test in tests/cardPlans.test.ts.
 */
export interface CardPlan {
  /** Whose card it is. */
  side: SideCode;
  /** In hand: worth in credits once the condition holds (net of its cost and click), and how ready it is now (0 to 1). */
  hand?: { payoff(state: GameState, card: CardInstance): number; ready(state: GameState, card: CardInstance): number };
  /** Installed: what the combo adds to the board while this card is in play. */
  board?(state: GameState, card: CardInstance): number;
}

export const PRINCIPIA = '35032';
export const KNICKKNACK = '35033';
export const BAKER = '36015';
const MYOSHU = '36061';

const tagged = (state: GameState) => state.runner.tags > 0;
const corpHas = (state: GameState, codes: string[]) => state.corp.hq.some(c => codes.includes(c.cardCode));
/** Corp cards in HQ that tag the Runner: the setup for tag punishers. */
const TAGGERS = ['30057', '35065', '36047'];
const ranLastTurn = (state: GameState) => state.runnerLastTurnRuns.some(r => r.successful);
const installedCorp = (state: GameState) => Object.values(state.corp.servers).flatMap(s => [...s.ice, ...s.root]);
const net = (_state: GameState, card: CardInstance, worth: number) => worth - (cardDef(card).cost ?? 0) - CLICK;
/** A tag punisher is ready when the Runner is tagged, half ready with a tagger in HQ, else a long shot. */
const tagReady = (state: GameState) => (tagged(state) ? 1 : corpHas(state, TAGGERS) ? 0.5 : 0.2);

export const CARD_PLANS: Record<string, CardPlan> = {
  // ---- Corp ----
  // Myōshu: play only after scoring an agenda installed on an earlier turn; 10 credits for 2 points
  [MYOSHU]: {
    side: 'corp',
    hand: {
      payoff: (state, card) => net(state, card, pointGain(state.corp.score, 2)),
      ready: state => {
        const now = turnKey(state);
        const agendas = Object.values(state.corp.servers).filter(s => s.isRemote).flatMap(s => s.root).filter(c => cardDef(c).type_code === 'agenda');
        const older = agendas.some(c => c.installedTurn !== now) ? 1 : agendas.length > 0 ? 0.6 : 0.3;
        return older * Math.min(1, state.corp.credits / 10);
      },
    },
  },
  // Retribution: play only if the Runner is tagged; trash a program or hardware
  '30065': { side: 'corp', hand: { payoff: (state, card) => net(state, card, trashedCardCost(state)), ready: tagReady } },
  // Bigger Picture: play only if the Runner is tagged; each tag removed is 5 credits from the Runner to the Corp
  '35065': {
    side: 'corp',
    hand: { payoff: (state, card) => net(state, card, 2 * Math.min(state.runner.credits, 5 * Math.max(1, state.runner.tags))), ready: tagReady },
  },
  // Public Trail: play only if the Runner made a successful run last turn; a tag unless they pay 8
  '30057': {
    side: 'corp',
    hand: { payoff: (state, card) => net(state, card, Math.min(8, tagsWorth(state, 'corp', state.runner.tags + 1) - tagsWorth(state, 'corp'))), ready: state => (ranLastTurn(state) ? 1 : 0.7) },
  },
  // Measured Response: play only at threat level 4 or more after a successful run; 4 meat damage unless the Runner pays 8
  '35078': {
    side: 'corp',
    hand: {
      payoff: (state, card) => net(state, card, Math.min(8, damageWorth(state, 4))),
      ready: state => Math.min(1, threatLevel(state) / 4) * (ranLastTurn(state) ? 1 : 0.7),
    },
  },

  // ---- Runner ----
  // Chain Reaction: play only after successful runs on HQ, R&D and Archives this turn; 2 Corp cards trashed for 1 of ours
  '36001': {
    side: 'runner',
    hand: {
      payoff: (state, card) => {
        const corp = installedCorp(state).map(c => corpCardValue(c, state, 'runner')).sort((a, b) => b - a);
        return net(state, card, (corp[0] ?? 0) + (corp[1] ?? 0) - trashedCardCost(state) / 2);
      },
      // Runs aren't played out in a planned turn: the centrals already run this turn, else a share for a later turn
      ready: state => Math.max(0.25, new Set(state.runsThisTurn.filter(r => r.successful && ['hq', 'rd', 'archives'].includes(r.server)).map(r => r.server)).size / 3),
    },
  },
  // Illumination: run R&D; if successful, install up to 3 cards from the grip for 1 less each
  '35025': {
    side: 'runner',
    hand: {
      payoff: (state, card) => net(state, card, Math.min(3, installable(state, card)) * (1 + CLICK)),
      ready: (state, card) => Math.min(1, installable(state, card) / 2),
    },
  },
  // Sell Out: trash an installed resource as a cost; 4 credits and 2 cards
  '36011': {
    side: 'runner',
    hand: { payoff: (state, card) => net(state, card, 4 + 2 * cardRate(state, 'runner')), ready: state => (state.runner.rig.resources.length > 0 ? 1 : 0) },
  },
  // Scrounge: install a program from the heap
  '35004': {
    side: 'runner',
    hand: {
      payoff: (state, card) => net(state, card, CLICK + 2),
      ready: state => (state.runner.heap.some(c => cardDef(c).type_code === 'program') ? 1 : 0),
    },
  },
  // Knickknack O'Brian: Principia pays its printed 4 but reinstalls for 1 less per other breaker, so an installed
  // Principia is fuel (a credit-and-card payout waiting for the next run) on top of the barriers it covers
  [KNICKKNACK]: { side: 'runner', board: state => state.runner.rig.programs.filter(c => c.cardCode === PRINCIPIA).reduce((n, c) => n + principiaFuel(state, c), 0) },
  // Baker: the first stealth credit each turn is a Baker run past HQ's or R&D's ice instead of run money
  [BAKER]: { side: 'runner', board: state => (runStealthCredits(state) >= 1 ? 1.6 : 0) },
};

/** Grip cards Illumination could install (not events, not itself). */
const installable = (state: GameState, card: CardInstance) => state.runner.grip.filter(c => c !== card && cardDef(c).type_code !== 'event').length;

/** An installed Principia's worth as Knickknack fuel. */
export function principiaFuel(state: GameState, card: CardInstance): number {
  if (!plansOn() || card.cardCode !== PRINCIPIA || !state.runner.rig.resources.some(r => r.cardCode === KNICKKNACK)) return 0;
  return 0.6 * ((cardDef(card).cost ?? 0) + cardRate(state, 'runner'));
}

export const plansOn = (): boolean => !!tuning.plan.cardPlans;

/** A card's worth in hand by its plan (before the wait), or undefined if it has none. */
export function handPlanWorth(state: GameState, card: CardInstance): number | undefined {
  const plan = plansOn() ? CARD_PLANS[card.cardCode]?.hand : undefined;
  if (!plan) return undefined;
  const ready = Math.max(0, Math.min(1, plan.ready(state, card)));
  // No floor here: a card whose setup is far off is worth little (heldWorth keeps the hand floor)
  return ready * plan.payoff(state, card);
}

/** What the installed board plans of `side` add to its board. */
export function boardPlansWorth(state: GameState, side: SideCode): number {
  if (!plansOn()) return 0;
  const cards = side === 'runner' ? [...state.runner.rig.programs, ...state.runner.rig.hardware, ...state.runner.rig.resources, state.runner.identity] : [...installedCorp(state), state.corp.identity];
  let worth = 0;
  for (const card of cards) {
    const plan = card && CARD_PLANS[card.cardCode];
    if (plan?.board && plan.side === side) worth += plan.board(state, card);
  }
  return worth;
}

/** Baker installed and no stealth credit to run it on: worth feeding Methuselah for. */
export const bakerWantsFuel = (state: GameState): boolean => plansOn() && state.runner.rig.programs.some(c => c.cardCode === BAKER) && runStealthCredits(state) < 1;

