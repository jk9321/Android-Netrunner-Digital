import { cardDef, CardInstance, GameState } from '../../core';
import { counters, rezCost } from '../../core/engine/cardEffects';
import { boostCostOf, breakerScript, isIcebreaker } from '../../core/engine/ice';
import { turnsLeft } from '../cardProfiles';
import { PAYOUT_RISK } from '../payoutRisk';
import { counterWorth, PAID_OUT, paidOneATurn, paidOut, trojanHostWorth } from '../counterValues';
import { tuning } from '../synergy';
import { cardRate, CLICK, flatRate, RATES } from '../valueModel';
import { tagsWorth } from '../evaluate';
import { bestBreakPlan } from '../runs';
import { accessWorth, anySuccess, centralSuccess, conduitCounterWorth, counterWorthOf, damageWorth, lock, muWorth, PACE, perTurn, runSuccess, VIRUS_WAIT, virusWait } from '../effectValues';
import { CardAI } from './types';

/**
 * What the AI knows about each System Gateway card's worth, one entry per card
 * (see ./types.ts). Adding a set: a file like this one, joined in ./index.ts.
 */

/** Red Team: 3 credits per successful click-run, the click shared with the access it also gets. */
function redTeamCredit(state: GameState): number {
  // A successful central run takes 3; a failed one waits for the next (plan.runOpenness: as open as HQ and R&D are)
  const success = tuning.plan.runOpenness ? Math.max(runSuccess(state, 'hq'), runSuccess(state, 'rd')) : PACE.success;
  return success * (1 - CLICK / 3 / 2) + (1 - success) * PAYOUT_RISK.clickWait * (1 - CLICK / 6);
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

export const SYSTEM_GATEWAY: Record<string, CardAI> = {
  // Carnivore
  '30003': {
    value: { rig: 3 },
    // +1 MU; trash an accessed card for 2 cards from the grip (its trash cost and the Corp's loss, about 4)
    runner: state => muWorth(state) + perTurn(state, 0.25 * Math.max(0, 4 + 2 - 2 * cardRate(state, 'runner')), 'runner'),
  },
  // Botulus
  '30004': {
    value: { rig: 2 },
    // A virus counter a turn, each breaking a subroutine on its host; useful for about 3 turns
    runner: (state, _code, card) => perTurn(state, card ? counterWorth(state, card, 'virus', 'runner') : 1, 'runner', 0, 3, virusWait()),
    // Each counter breaks 1 subroutine on its host, worth what breaking one costs (3 if nothing breaks it)
    counters: { virus: (state, card) => trojanHostWorth(state, card, host => Math.min(3, bestBreakPlan(state, host, 1)?.credits ?? 3)) },
  },
  // Fermenter
  '30007': {
    value: { rig: 1 },
    // A virus counter a turn (2 credits each when cashed), banked until cashed within about 4 turns, and lost to a purge
    runner: (state, code) => perTurn(state, counterWorthOf(state, code, 'virus'), 'runner', 0, 4, virusWait()),
    counters: { virus: () => 2 - RATES.click / 4 }, // 2 credits each, for a click and the card (cashed at about 4)
  },
  // Leech
  '30008': {
    value: { rig: 2.5 },
    // A virus counter for each successful central run, spent on an encounter soon after: each waits about a turn, not from now
    runner: (state, code) => {
      if (tuning.plan.runOpenness) return virusWait() * perTurn(state, PACE.runs * centralSuccess(state) * counterWorthOf(state, code, 'virus'), 'runner', 0, Infinity, 1, lock());
      return virusWait() * perTurn(state, PACE.runs * (PACE.hqShare + PACE.rdShare) * PACE.success * counterWorthOf(state, code, 'virus'), 'runner');
    },
    counters: { virus: () => 0.9 }, // -1 strength on an encounter, about a credit of boosting
    counterFormulas: { virus: leechVirus },
  },
  // Cookbook
  '30009': {
    value: { rig: 0.5 },
    // A virus counter on each virus program installed later
    runner: state => {
      const viruses = [...state.runner.grip, ...state.runner.stack].filter(c => /virus/i.test(cardDef(c).keywords ?? '')).length;
      return viruses * RATES.counters.virus;
    },
  },
  // Docklands Pass
  '30013': {
    value: { rig: 2.5 },
    // One more HQ access the first time each turn, on a successful HQ run
    runner: state => {
      if (tuning.plan.runOpenness) return perTurn(state, PACE.runs * PACE.hqShare * runSuccess(state, 'hq') * accessWorth(state), 'runner', 0, Infinity, 1, lock());
      return perTurn(state, PACE.runs * PACE.hqShare * accessWorth(state), 'runner');
    },
  },
  // Pennyshaver
  '30014': {
    value: { rig: 3.5 },
    // +1 MU; a credit on it for each successful run
    runner: (state, code) => {
      if (tuning.plan.runOpenness) return muWorth(state) + perTurn(state, PACE.runs * anySuccess(state) * counterWorthOf(state, code, 'credit'), 'runner', 0, Infinity, 1, lock());
      return muWorth(state) + perTurn(state, PACE.runs * PACE.success * counterWorthOf(state, code, 'credit'), 'runner');
    },
    counters: { credit: () => 0.85 }, // All taken with a click, which adds 1 more
    counterFormulas: { credit: (_s, card) => pennyshaverCredit(card) },
  },
  // Tranquilizer
  '30017': {
    value: { rig: 2.5 },
    // A virus counter a turn; 3 derez its host
    runner: (state, _code, card) => perTurn(state, card ? counterWorth(state, card, 'virus', 'runner') : 1, 'runner', 0, 3, virusWait()),
    // 3 counters derez its host, a third of the rez cost each
    counters: { virus: (state, card) => trojanHostWorth(state, card, host => (host.isRezzed ? rezCost(state, host) / 3 : 0.3)) },
  },
  // Red Team
  '30018': {
    value: { rig: 1 },
    // All its worth is the 12 credits on it (counterValues.ts)
    runner: () => 0,
    counters: { credit: () => 0.7 }, // 3 per successful click-run on a central not yet run this turn
    counterFormulas: { credit: redTeamCredit },
  },
  // DZMZ Optimizer
  '30022': {
    value: { rig: 2.5 },
    // +1 MU; first program each turn 1 credit cheaper: a credit for each program still to install, over the turns left (Jeff, 2026-10-30: early it saves a ton)
    runner: state => {
      if (!tuning.plan.sourdough) return muWorth(state) + perTurn(state, PACE.programInstalls, 'runner');
      const programs = [...state.runner.grip, ...state.runner.stack].filter(c => cardDef(c).type_code === 'program').length;
      return muWorth(state) + 0.6 * perTurn(state, 1, 'runner', 0, programs);
    },
  },
  // Pantograph
  '30023': {
    value: { rig: 2.5 },
    // +1 MU; 1 credit and a free install (when there is one to make, about half the time) each time an agenda is scored or stolen
    runner: state => muWorth(state) + perTurn(state, PACE.agendaEvents * (1 + 0.5 * CLICK), 'runner'),
  },
  // Conduit
  '30024': {
    value: { rig: 4 },
    runner: (state, code) => {
      if (!tuning.plan.cardFixes) return perTurn(state, PACE.runs * PACE.conduitRdShare * PACE.success * counterWorthOf(state, code, 'virus'), 'runner');
      // A counter for each successful R&D run, each one more card on every Conduit run after it; counters gained later have fewer runs left
      const success = (t: number) => PACE.runs * PACE.conduitRdShare * runSuccess(state, 'rd') * lock() ** (t - 1);
      let value = 0;
      for (let t = 1; t < turnsLeft(state); t++) {
        let later = 0;
        for (let u = t + 1; u <= turnsLeft(state); u++) later += success(u);
        value += success(t) * accessWorth(state) * Math.min(4, later) * VIRUS_WAIT ** t;
      }
      return value;
    },
    counters: { virus: state => (tuning.plan.cardFixes ? conduitCounterWorth(state) : 1.2) }, // 1 more card accessed on each Conduit run still to come
  },
  // Telework Contract
  '30027': {
    value: { rig: 1.5 },
    profile: { load: 9, pay: 3, every: 'click', perTurn: 1 }, // Once per turn
  },
  // T400 Memory Diamond
  '30031': {
    value: { rig: 2 },
    // +1 MU and one more card in hand (and one more point of life against damage)
    runner: state => muWorth(state) + cardRate(state, 'runner') * 0.6,
  },
  // Smartware Distributor
  '30033': {
    value: { rig: 2.5 },
    // A spare click turns into 3 credits paid out over 3 turns, about every other turn
    runner: state => perTurn(state, 0.5 * Math.max(0, 3 * 0.9 - CLICK), 'runner'),
    // 1 a turn, so the k-th hosted credit waits k turns (stacking more is worth less and less)
    counters: { credit: (_state, card) => paidOneATurn(counters(card, 'credit')) },
  },
  // Verbal Plasticity
  '30034': {
    value: { rig: 3.5, draws: 1 },
    // One more card the first time each turn it clicks to draw
    runner: state => perTurn(state, PACE.drawTurns * cardRate(state, 'runner'), 'runner'),
  },
  // Nico Campaign
  '30037': {
    value: { keep: 5, econ: 3.5, draws: 1 },
    profile: { load: 9, pay: 3, every: 'turn', perTurn: 1, drawAtEnd: 1 }, // Nico Campaign
    counters: { credit: () => PAID_OUT }, // 3 a turn, no click
    counterFormulas: { credit: () => paidOut() },
  },
  // Manegarm Skunkworks
  '30042': {
    value: { keep: 4, upgrade: [2.5, 2] },
    // Each run here costs the Runner 2 clicks or 5 credits
    corp: state => {
      const tax = Math.min(2 * CLICK, 5);
      const remote = perTurn(state, PACE.runs * PACE.remoteShare * tax, 'corp');
      const central = perTurn(state, PACE.runs * PACE.rdShare * tax, 'corp');
      return { keep: remote, upgrade: [remote, central] };
    },
  },
  // Urtica Cipher
  '30045': {
    value: { keep: 2 }, // A trap, worth keeping for trap decks
    // 2 net damage plus 1 per advancement, accessed about half the time
    corp: state => ({ keep: 0.5 * damageWorth(state, 3) }),
  },
  // Anoetic Void
  '30050': {
    value: { keep: 3, upgrade: [1.5, 0.8] },
    // Pay 2 and 2 cards from HQ to end a run; worth it on a server holding an agenda
    corp: (state, _code, { agenda, card }) => {
      const use = 2 + 2 * card;
      return { keep: 0.5 * agenda - use, upgrade: [Math.max(0, 0.5 * agenda - use), Math.max(0.3, 2 * accessWorth(state) - use)] };
    },
  },
  // Spin Doctor
  '30053': {
    value: { keep: 2, econ: 1.5, draws: 2 },
    // Draw 2 when rezzed; later 2 cards back from Archives
    corp: (_state, _code, { cost, card }) => {
      const keep = 2 * card + 0.5 - cost;
      return { keep, econ: keep };
    },
  },
  // AMAZE Amusements
  '30058': {
    value: { keep: 2, upgrade: [1.5, 0] },
    // 2 tags whenever the Runner steals from this server
    corp: state => {
      const tags = flatRate('tags') && tuning.plan.tagClock ? tagsWorth(state, 'corp', 2) : 2 * RATES.tagAgainstRunner;
      return { keep: 0.3 * tags, upgrade: [0.3 * tags, 0.15 * tags] };
    },
  },
  // Clearinghouse
  '30061': {
    value: { keep: 2 }, // Meat damage once advanced
    // About 2 advances (a click and a credit each) for 2 meat damage, if it survives a turn
    corp: state => {
      const advance = 2 * (CLICK + 1);
      return { keep: Math.max(0.5, 0.6 * damageWorth(state, 2) - 0.5 * advance) };
    },
    // 1 meat damage per counter when it fires
    rezzed: (state, card, rezCost) => (card.advancementCounters > 0 ? damageWorth(state, card.advancementCounters) - rezCost : -1),
  },
  // Malapert Data Vault
  '30066': {
    value: { keep: 2, upgrade: [1.5, 0] },
    // Fetch a card of choice from R&D on each score here
    corp: (_state, _code, { card }) => {
      const tutor = 1.5 * card;
      return { keep: 1.2 * tutor, upgrade: [1.2 * tutor, 0] };
    },
  },
  // Regolith Mining License
  '30071': {
    value: { keep: 6, econ: 4 },
    profile: { load: 15, pay: 3, every: 'click', perTurn: 2 }, // Regolith Mining License
    counters: { credit: () => 1 - RATES.click / 3 }, // 3 credits per click
  },
};
