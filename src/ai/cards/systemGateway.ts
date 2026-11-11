import { cardDef, CardInstance, GameState } from '../../core';
import { counters, rezCost } from '../../core/engine/cardEffects';
import { boostCostOf, breakerScript, isIcebreaker } from '../../core/engine/ice';
import { turnsLeft } from '../cardProfiles';
import { PAYOUT_RISK } from '../payoutRisk';
import { counterWorth, PAID_OUT, paidOneATurn, paidOut, trojanHostWorth } from '../counterValues';
import { cardRate, CLICK, payoutClick, payoutSlide, RATES } from '../valueModel';
import { tagsWorth } from '../evaluate';
import { bestBreakPlan } from '../runs';
import { accessWorth, anySuccess, centralSuccess, conduitCounterWorth, counterWorthOf, damageWorth, lock, muWorth, PACE, perTurn, runSuccess, VIRUS_WAIT, virusWait } from '../effectValues';
import type { RunOptions } from '../runs';
import { CardAI } from './types';

/**
 * What the AI knows about each System Gateway card's worth, one entry per card
 * (see ./types.ts). Adding a set: a file like this one, joined in ./index.ts.
 */

/** Red Team: 3 credits per successful click-run, the click shared with the access it also gets. */
function redTeamCredit(state: GameState): number {
  // A successful central run takes 3; a failed one waits for the next (plan.runOpenness: as open as HQ and R&D are)
  const success = Math.max(runSuccess(state, 'hq'), runSuccess(state, 'rd'));
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
  // Loup
  '30001': { synergy: { gives: { draw: 1, econ: 0.5 }, wants: { trash: 2 } } },
  // Wildcat Strike
  '30002': { synergy: { gives: { econ: 1, draw: 1 } } },
  // Carnivore
  '30003': {
    synergy: { gives: { trash: 2, discard: 1 }, wants: { draw: 1 } },
    value: { rig: 3 },
    // +1 MU; trash an accessed card for 2 cards from the grip (its trash cost and the Corp's loss, about 4)
    runner: state => muWorth(state) + perTurn(state, 0.25 * Math.max(0, 4 + 2 - 2 * cardRate(state, 'runner')), 'runner'),
  },
  // Botulus
  '30004': {
    synergy: { gives: { virus: 1, breakers: 0.5 } },
    value: { rig: 2 },
    // A virus counter a turn, each breaking a subroutine on its host; useful for about 3 turns
    runner: (state, _code, card) => perTurn(state, card ? counterWorth(state, card, 'virus') : 1, 'runner', 0, 3, virusWait()),
    // Each counter breaks 1 subroutine on its host, worth what breaking one costs (3 if nothing breaks it)
    counters: { virus: (state, card) => trojanHostWorth(state, card, host => Math.min(3, bestBreakPlan(state, host, 1)?.credits ?? 3)) },
  },
  // Buzzsaw
  '30005': { synergy: { gives: { breakers: 1 } } },
  // Cleaver
  '30006': { synergy: { gives: { breakers: 1 } } },
  // Fermenter
  '30007': {
    clickMoney: { clicks: 1, credits: 0, perVirus: { credits: 2, turnStart: 1 }, once: true }, // [click], trash: 2 per virus counter; +1 counter as the turn begins,
    synergy: { gives: { virus: 1, econ: 1 } },
    value: { rig: 1 },
    // A virus counter a turn (2 credits each when cashed), banked until cashed within about 4 turns, and lost to a purge.
    // plan.fermenterBank (Jeff, 2026-11-05, his Corp game 1: the Runner clicked for credits on 0 credits beside 15
    // banked counters): a purge takes the whole bank, so each turn held risks 8% of it against the 1 counter it adds;
    // past 12 counters holding on gains nothing
    runner: (state, code, card) =>
      perTurn(state, counterWorthOf(state, code, 'virus'), 'runner', 0, 4, virusWait()) *
      (card ? Math.max(0, 1 - 0.08 * counters(card, 'virus')) : 1),
    // 2 credits each, for a click and the card (cashed at about 4). plan.fermenterBank: the credits as the Runner's
    // credit slide prices them (flat, a bank of 10 outweighed 20 credits to a broke Runner), the whole bank on one
    // stretch of the slide (each Fermenter priced as the first credits counted every bank at the broke end), the
    // click shared by the counters on this card, and 2% off each for every counter banked: a purge takes the lot,
    // and the bigger the bank the likelier the Corp spends its turn on one
    counters: {
      virus: (state, card) => {
        const n = Math.max(1, counters(card, 'virus'));
        const bank = state.runner.rig.programs.reduce((t, p) => t + (p.cardCode === '30007' ? counters(p, 'virus') : 0), 0);
        return 2 * payoutSlide(state, 'runner', 2 * Math.max(n, bank)) * Math.max(0.4, 1 - 0.02 * bank) - payoutClick() / n;
      },
    },
  },
  // Leech
  '30008': {
    synergy: { gives: { virus: 1 }, wants: { runs: 1 }, when: ['successfulRun'] },
    value: { rig: 2.5 },
    // A virus counter for each successful central run, spent on an encounter soon after: each waits about a turn, not from now
    runner: (state, code) => {
      return virusWait() * perTurn(state, PACE.runs * centralSuccess(state) * counterWorthOf(state, code, 'virus'), 'runner', 0, Infinity, 1, lock());
    },
    counters: { virus: () => 0.9 }, // -1 strength on an encounter, about a credit of boosting
    counterFormulas: { virus: leechVirus },
  },
  // Cookbook
  '30009': {
    synergy: { wants: { virus: 2 } },
    value: { rig: 0.5 },
    // A virus counter on each virus program installed later
    runner: state => {
      const viruses = [...state.runner.grip, ...state.runner.stack].filter(c => /virus/i.test(cardDef(c).keywords ?? '')).length;
      return viruses * RATES.counters.virus;
    },
  },
  // Zahya
  '30010': { synergy: { gives: { econ: 0.5 }, wants: { hq: 1.5, rd: 1.5 } } },
  // Mutual Favor
  '30011': { synergy: { gives: { breakers: 1 }, wants: { runs: 0.5 }, when: ['successfulRun'] } },
  // Tread Lightly
  '30012': {
    synergy: { gives: { runs: 1 } },
    // Tread Lightly
    run: (): RunOptions => {
      return { rezTax: true };
    },
  },
  // Docklands Pass
  '30013': {
    synergy: { wants: { hq: 2 } },
    value: { rig: 2.5 },
    // One more HQ access the first time each turn, on a successful HQ run
    runner: state => {
      return perTurn(state, PACE.runs * PACE.hqShare * runSuccess(state, 'hq') * accessWorth(state), 'runner', 0, Infinity, 1, lock());
    },
  },
  // Pennyshaver
  '30014': {
    clickMoney: { clicks: 1, credits: 1, hosted: 'add', once: true }, // [click]: place 1, then take all (a second use pays 1, as a click for a credit),
    synergy: { gives: { econ: 1 }, wants: { runs: 2 }, when: ['successfulRun'] },
    value: { rig: 3.5 },
    // +1 MU; a credit on it for each successful run
    runner: (state, code) => {
      return muWorth(state) + perTurn(state, PACE.runs * anySuccess(state) * counterWorthOf(state, code, 'credit'), 'runner', 0, Infinity, 1, lock());
    },
    counters: { credit: () => PAID_OUT }, // All taken with a click, which adds 1 more
    counterFormulas: { credit: (_s, card) => pennyshaverCredit(card) },
  },
  // Carmen
  '30015': { synergy: { gives: { breakers: 1 }, wants: { runs: 0.5 }, when: ['successfulRun'] } },
  // Marjanah
  '30016': { synergy: { gives: { breakers: 1 }, wants: { runs: 0.5 }, when: ['successfulRun'] } },
  // Tranquilizer
  '30017': {
    synergy: { gives: { virus: 1 } },
    value: { rig: 2.5 },
    // A virus counter a turn; 3 derez its host
    runner: (state, _code, card) => perTurn(state, card ? counterWorth(state, card, 'virus') : 1, 'runner', 0, 3, virusWait()),
    // 3 counters derez its host, a third of the rez cost each
    counters: { virus: (state, card) => trojanHostWorth(state, card, host => (host.isRezzed ? rezCost(state, host) / 3 : 0.3)) },
  },
  // Red Team
  '30018': {
    synergy: { gives: { runs: 1, econ: 1, hq: 0.5, rd: 0.5, archives: 0.5 } },
    value: { rig: 1 },
    // All its worth is the 12 credits on it (counterValues.ts)
    runner: () => 0,
    counters: { credit: () => 0.7 }, // 3 per successful click-run on a central not yet run this turn
    counterFormulas: { credit: redTeamCredit },
    run: (state?: GameState): RunOptions => {
      // Red Team: if successful, take 3 credits from it (they leave its hosted credits, which count on the board)
      const team = state?.runner.rig.resources.find(c => c.cardCode === '30018');
      const take = team ? Math.min(3, team.tokens.credit ?? 0) : 3;
      return state ? { successCredits: take, successBonus: -take * counterWorthOf(state, '30018', 'credit') } : { successBonus: 1 };
    },
  },
  // Tāo Salonga
  '30019': { synergy: { when: ['onScore'] } },
  // Creative Commission
  '30020': { synergy: { gives: { econ: 1 } } },
  // VRcation
  '30021': { synergy: { gives: { draw: 1.5 } } },
  // DZMZ Optimizer
  '30022': {
    synergy: { gives: { install: 1 }, wants: { breakers: 0.5 } },
    value: { rig: 2.5 },
    // +1 MU; first program each turn 1 credit cheaper: a credit for each program still to install, over the turns left (Jeff, 2026-10-30: early it saves a ton)
    runner: state => {
      const programs = [...state.runner.grip, ...state.runner.stack].filter(c => cardDef(c).type_code === 'program').length;
      return muWorth(state) + 0.6 * perTurn(state, 1, 'runner', 0, programs);
    },
  },
  // Pantograph
  '30023': {
    synergy: { gives: { install: 0.5, econ: 0.5 }, wants: { runs: 0.5 }, when: ['onScore'] },
    value: { rig: 2.5 },
    // +1 MU; 1 credit and a free install (when there is one to make, about half the time) each time an agenda is scored or stolen
    runner: state => muWorth(state) + perTurn(state, PACE.agendaEvents * (1 + 0.5 * CLICK), 'runner'),
  },
  // Conduit
  '30024': {
    synergy: { gives: { rd: 2, runs: 1, virus: 1 }, wants: { rd: 1 }, when: ['successfulRun'] },
    value: { rig: 4 },
    runner: state => {
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
    counters: { virus: state => conduitCounterWorth(state) }, // 1 more card accessed on each Conduit run still to come
    run: (state?: GameState): RunOptions => {
      // Conduit: if successful, X more R&D cards accessed, X its virus counters
      const conduit = state?.runner.rig.programs.find(c => c.cardCode === '30024');
      return { extraAccesses: conduit?.tokens.virus ?? 0 };
    },
  },
  // Echelon
  '30025': { synergy: { gives: { breakers: 1 }, wants: { breakers: 1 } } },
  // Unity
  '30026': { synergy: { gives: { breakers: 1 }, wants: { breakers: 1 } } },
  // Telework Contract
  '30027': {
    clickMoney: { clicks: 1, credits: 3, hosted: 'cap', once: true }, // once per turn, [click]: take 3 of the 9 loaded,
    synergy: { gives: { econ: 1.5 } },
    value: { rig: 1.5 },
    profile: { load: 9, pay: 3, every: 'click', perTurn: 1 }, // Once per turn
  },
  // Jailbreak
  '30028': {
    synergy: { gives: { runs: 1, hq: 1, rd: 1, draw: 0.5 } },
    // Jailbreak
    run: (): RunOptions => {
      return { extraAccesses: 1 };
    },
  },
  // Overclock
  '30029': {
    synergy: { gives: { runs: 1 } },
    // Overclock
    run: (): RunOptions => {
      return { bonusCredits: 5 };
    },
  },
  // Sure Gamble
  '30030': { synergy: { gives: { econ: 1.5 } } },
  // T400 Memory Diamond
  '30031': {
    synergy: { wants: { draw: 1 } },
    value: { rig: 2 },
    // +1 MU and one more card in hand (and one more point of life against damage)
    runner: state => muWorth(state) + cardRate(state, 'runner') * 0.6,
  },
  // Mayfly
  '30032': { synergy: { gives: { breakers: 0.5 } } },
  // Smartware Distributor
  '30033': {
    turnIncome: { credits: 1, hosted: true }, // when your turn begins, take 1 from it,
    synergy: { gives: { econ: 1 } },
    value: { rig: 2.5 },
    // A spare click turns into 3 credits paid out over 3 turns, about every other turn
    runner: state => perTurn(state, 0.5 * Math.max(0, 3 * 0.9 - CLICK), 'runner'),
    // 1 a turn, so the k-th hosted credit waits k turns (stacking more is worth less and less)
    counters: { credit: (_state, card) => paidOneATurn(counters(card, 'credit')) },
  },
  // Verbal Plasticity
  '30034': {
    synergy: { gives: { draw: 1 }, wants: { draw: 1 } },
    value: { rig: 3.5, draws: 1 },
    // One more card the first time each turn it clicks to draw
    runner: state => perTurn(state, PACE.drawTurns * cardRate(state, 'runner'), 'runner'),
  },
  // HB: Precision Design
  '30035': { synergy: { gives: { draw: 0.5 }, wants: { discard: 0.5 }, when: ['onScore'] } },
  // Luminal Transubstantiation
  '30036': { synergy: { gives: { advance: 0.5 }, when: ['onScore'] } },
  // Nico Campaign
  '30037': {
    turnIncome: { credits: 3, hosted: true }, // When your turn begins, take 3 credits from this asset
    synergy: { gives: { econ: 2 } },
    value: { keep: 5, econ: 3.5, draws: 1 },
    profile: { load: 9, pay: 3, every: 'turn', perTurn: 1, drawAtEnd: 1 }, // Nico Campaign
    counters: { credit: () => PAID_OUT }, // 3 a turn, no click
    counterFormulas: { credit: () => paidOut() },
  },
  // Ansel 1.0
  '30038': { synergy: { gives: { bioroid: 1, ice: 1 } } },
  // Brân 1.0
  '30039': { synergy: { gives: { bioroid: 1, ice: 1 } } },
  // Seamless Launch
  '30040': { synergy: { gives: { advance: 2 }, when: ['notInstalledThisTurn'] } },
  // Sprint
  '30041': { synergy: { gives: { draw: 1.5 } } },
  // Manegarm Skunkworks
  '30042': {
    synergy: { gives: { denial: 1, ice: 0.5 } },
    value: { keep: 4, upgrade: [2.5, 2] },
    // Each run here costs the Runner 2 clicks or 5 credits
    corp: state => {
      const tax = Math.min(2 * CLICK, 5);
      const remote = perTurn(state, PACE.runs * PACE.remoteShare * tax, 'corp');
      const central = perTurn(state, PACE.runs * PACE.rdShare * tax, 'corp');
      return { keep: remote, upgrade: [remote, central] };
    },
  },
  // Jinteki: Restoring Humanity
  '30043': { synergy: { gives: { econ: 0.5 }, wants: { discard: 1.5 } } },
  // Longevity Serum
  '30044': { synergy: { gives: { discard: 1 }, when: ['onScore'] } },
  // Urtica Cipher
  '30045': {
    // plan.corpTurnDamageOwn: its damage lands on access, in the Runner's runs only (rules 7.1.3, 7.2.1)
    corpTurnDamage: 0,
    synergy: { gives: { damage: 1.5 }, wants: { advance: 1 } },
    value: { keep: 2 }, // A trap, worth keeping for trap decks
    // 2 net damage plus 1 per advancement, accessed about half the time
    corp: state => ({ keep: 0.5 * damageWorth(state, 3) }),
  },
  // Diviner
  '30046': { synergy: { gives: { ice: 1, damage: 0.5 } } },
  // Karunā
  '30047': { synergy: { gives: { ice: 1, damage: 1 } } },
  // Hansei Review
  '30048': { synergy: { gives: { econ: 2, discard: 1 } } },
  // Neurospike
  '30049': { synergy: { gives: { damage: 1.5 }, wants: { advance: 0.5 }, when: ['scoredThisTurn'] } },
  // Anoetic Void
  '30050': {
    synergy: { gives: { discard: 1, ice: 0.5 } },
    value: { keep: 3, upgrade: [1.5, 0.8] },
    // Pay 2 and 2 cards from HQ to end a run; worth it on a server holding an agenda
    corp: (state, _code, { agenda, card }) => {
      const use = 2 + 2 * card;
      return { keep: 0.5 * agenda - use, upgrade: [Math.max(0, 0.5 * agenda - use), Math.max(0.3, 2 * accessWorth(state) - use)] };
    },
  },
  // NBN: Reality Plus
  '30051': { synergy: { wants: { tags: 2 }, when: ['ifTagged'] } },
  // Tomorrowʼs Headline
  '30052': { synergy: { gives: { tags: 1 }, when: ['onScore'] } },
  // Spin Doctor
  '30053': {
    synergy: { gives: { draw: 1 } },
    value: { keep: 2, econ: 1.5, draws: 2 },
    // Draw 2 when rezzed; later 2 cards back from Archives
    corp: (_state, _code, { cost, card }) => {
      const keep = 2 * card + 0.5 - cost;
      return { keep, econ: keep };
    },
  },
  // Funhouse
  '30054': { synergy: { gives: { ice: 1, tags: 1, denial: 0.5 } } },
  // Ping
  '30055': { synergy: { gives: { ice: 1, tags: 1 } } },
  // Predictive Planogram
  '30056': { synergy: { gives: { econ: 1, draw: 1 }, wants: { tags: 1 }, when: ['ifTagged'] } },
  // Public Trail
  '30057': { synergy: { gives: { tags: 1, denial: 0.5 }, when: ['successfulRun'] } },
  // AMAZE Amusements
  '30058': {
    synergy: { gives: { tags: 1 } },
    value: { keep: 2, upgrade: [1.5, 0] },
    // 2 tags whenever the Runner steals from this server
    corp: state => {
      const tags = tagsWorth(state, 'corp', 2);
      return { keep: 0.3 * tags, upgrade: [0.3 * tags, 0.15 * tags] };
    },
  },
  // Weyland: Built to Last
  '30059': { synergy: { wants: { advance: 2 } } },
  // Above the Law
  '30060': { synergy: { gives: { denial: 0.5 }, when: ['onScore'] } },
  // Clearinghouse
  '30061': {
    synergy: { gives: { damage: 1 }, wants: { advance: 1 } },
    value: { keep: 2 }, // Meat damage once advanced
    // About 2 advances (a click and a credit each) for 2 meat damage, if it survives a turn
    corp: state => {
      const advance = 2 * (CLICK + 1);
      return { keep: Math.max(0.5, 0.6 * damageWorth(state, 2) - 0.5 * advance) };
    },
    // 1 meat damage per counter when it fires
    rezzed: (state, card, rezCost) => (card.advancementCounters > 0 ? damageWorth(state, card.advancementCounters) - rezCost : -1),
  },
  // Ballista
  '30062': { synergy: { gives: { ice: 1 } } },
  // Pharos
  '30063': { synergy: { gives: { ice: 1, tags: 0.5 }, wants: { advance: 0.5 } } },
  // Government Subsidy
  '30064': { synergy: { gives: { econ: 2 } } },
  // Retribution
  '30065': { synergy: { wants: { tags: 1.5 }, when: ['ifTagged'] } },
  // Malapert Data Vault
  '30066': {
    synergy: { gives: { draw: 0.5 }, when: ['onScore'] },
    value: { keep: 2, upgrade: [1.5, 0] },
    // Fetch a card of choice from R&D on each score here
    corp: (_state, _code, { card }) => {
      const tutor = 1.5 * card;
      return { keep: 1.2 * tutor, upgrade: [1.2 * tutor, 0] };
    },
  },
  // Offworld Office
  '30067': { synergy: { gives: { econ: 1 }, when: ['onScore'] }, scoreCredits: 7 },
  // Orbital Superiority
  '30068': { corpTurnDamage: state => (state.runner.tags > 0 ? 4 : 0) /* plan.corpTurnDamageOwn: 4 meat only if the Runner is tagged */, synergy: { gives: { tags: 1, damage: 1 }, wants: { tags: 1 }, when: ['ifTagged', 'onScore'] } },
  // Send a Message
  '30069': { synergy: { gives: { ice: 0.5 }, when: ['onScore'] } },
  // Superconducting Hub
  '30070': { synergy: { gives: { draw: 1 }, when: ['onScore'] } },
  // Regolith Mining License
  '30071': {
    synergy: { gives: { econ: 2 } },
    value: { keep: 6, econ: 4 },
    profile: { load: 15, pay: 3, every: 'click', perTurn: 2 }, // Regolith Mining License
    counters: { credit: () => 1 - payoutClick() / 3 }, // 3 credits per click
  },
  // Palisade
  '30072': { synergy: { gives: { ice: 1 } } },
  // Tithe
  '30073': { synergy: { gives: { ice: 1, damage: 0.5, econ: 0.5 } } },
  // Whitespace
  '30074': { synergy: { gives: { ice: 1, denial: 1.5 } } },
  // Hedge Fund
  '30075': { synergy: { gives: { econ: 1.5 } } },
  // The Catalyst
  '30076': { synergy: {} },
  // The Syndicate
  '30077': { synergy: {} },
};
