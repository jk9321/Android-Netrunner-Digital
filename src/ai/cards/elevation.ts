import { cardDef, CardInstance, GameState } from '../../core';
import { counters } from '../../core/engine/cardEffects';
import { isIcebreaker } from '../../core/engine/ice';
import { PAYOUT_RISK } from '../payoutRisk';
import { corpKeepValue } from '../cardValues';
import { mean, PAID_OUT, paidOut, recurring } from '../counterValues';
import { actingSide } from '../synergy';
import { cardRate, CLICK, handFilter, pointValue, printedGain, RATES, sideCards } from '../valueModel';
import { PRINCIPIA } from '../cardPlans';
import { accessWorth, anySuccess, counterWorthOf, damageWorth, lock, muWorth, PACE, perTurn, PETTY_CASH_REPLAY } from '../effectValues';
import type { RunOptions } from '../runs';
import { runClick } from '../runs';
import { tagCost } from '../runs';
import { CardAI } from './types';

/**
 * What the AI knows about each Elevation card's worth, one entry per card
 * (see ./types.ts). Adding a set: a file like this one, joined in ./index.ts.
 */

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

/** Side Hustle: one a run until 6, then all taken with a card; each waits for the rest. */
function sideHustleCredit(state: GameState, card: CardInstance): number {
  const turnsToFill = Math.max(0, 6 - counters(card, 'credit')) / PACE.runs;
  return PAYOUT_RISK.clickWait ** turnsToFill + cardRate(state, 'runner') / 6;
}

/** Hantu: +2 strength when a sentry is stronger than it, else spare. */
function hantuVirus(state: GameState, card: CardInstance): number {
  const strength = cardDef(card).strength ?? 0;
  const sentries = Object.values(state.corp.servers).flatMap(s => s.ice).filter(i => i.isRezzed && /sentry/i.test(cardDef(i).keywords ?? ''));
  return sentries.some(i => (cardDef(i).strength ?? 0) > strength) ? 2 * 0.5 : 0.5; // A boost of 2, at about half a credit per point (rig average)
}

/** Phật Gioan Baotixita: a net damage when an agenda is scored or stolen, most turns. */
const gioanPower = (state: GameState): number => Math.min(1, 2 * PACE.agendaEvents) * damageWorth(state, 1);

/** AU Co.: 2 counters look at 3 cards, keep 2: two cards drawn and a filter. */
const auCoPower = (state: GameState): number => (2 * cardRate(state, 'corp') + handFilter()) / 2;

/** Facedown Archives as the pricing side sees it: the Runner can't see those cards (Gemini audit 2.2a). */
const corpArchivesHidden = (state: GameState): CardInstance[] => (actingSide() === 'runner' ? [] : state.corp.archives.faceDown);

/** Project Ingatan: install the best card in Archives for nothing (a click and its install cost saved). */
function ingatanAgenda(state: GameState): number {
  const archived = [...state.corp.archives.faceUp, ...corpArchivesHidden(state)].filter(c => cardDef(c).type_code !== 'operation' && cardDef(c).type_code !== 'agenda');
  const worth = archived.map(c => (cardDef(c).type_code === 'ice' ? RATES.ice : corpKeepValue(c.cardCode, state)));
  return CLICK * (archived.length ? 1 : 0.5) + (worth.length ? Math.max(...worth) : 0);
}

/** Sericulture Expansion: 2 advancement counters, each a click and a credit. */
const sericultureAgenda = (): number => 2 * (CLICK + 1);

/** Embedded Reporting: the best money operation left in R&D as the next draw, over an average draw. */
function embeddedAgenda(state: GameState): number {
  const gains = state.corp.rd.map(c => {
    const gain = printedGain(cardDef(c).stripped_text);
    return cardDef(c).type_code === 'operation' && gain !== undefined ? gain - (cardDef(c).cost ?? 0) : 0;
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

/** Average net credits of a transaction operation in the Corp's deck (Plutus replays them). */
function transactionGain(state: GameState): number {
  const ops = state.corp.archives.faceUp.concat(corpArchivesHidden(state)).filter(c => /transaction/i.test(cardDef(c).keywords ?? ''));
  const gains = ops.map(c => {
    const gain = (cardDef(c).stripped_text ?? '').match(/Gain (\d+) credits/i);
    return gain ? Number(gain[1]) - (cardDef(c).cost ?? 0) : 0;
  });
  return gains.length ? gains.reduce((a, b) => a + b, 0) / gains.length : 0;
}

export const ELEVATION: Record<string, CardAI> = {
  // Ryō "Phoenix" Ōno
  '35001': { synergy: { gives: { denial: 0.5 }, wants: { runs: 1, hq: 0.5 } } },
  // Topan
  '35002': { synergy: { gives: { install: 2 } } },
  // Charm Offensive
  '35003': {
    synergy: { gives: { runs: 1, archives: 1, trash: 0.5 } },
    // A plain Archives run: trashing a rezzed copy of a card accessed there needs a copy to be both rezzed and in Archives (rare)
    run: (): RunOptions => ({}),
  },
  // Scrounge
  '35004': { synergy: { wants: { discard: 1.5 } } },
  // Shred
  '35005': {
    synergy: { gives: { runs: 1, denial: 0.5 } },
    // Shred
    run: (): RunOptions => {
      return { shred: true };
    },
  },
  // Bling
  '35006': {
    synergy: { gives: { draw: 0.5 }, wants: { install: 2 } },
    value: { rig: 3.5 },
    // +1 MU; a free install now and then lets it host the top card to play
    runner: state => muWorth(state) + perTurn(state, 0.3, 'runner'),
  },
  // Gourmand
  '35007': {
    synergy: { gives: { trash: 1.5, draw: 0.5 } },
    value: { rig: 2.5, draws: 1 }, // Trash and draw, once
    // Once, trash a non-agenda card accessed (about 4 to the Corp) and draw 1
    runner: state => 0.7 * (4 + cardRate(state, 'runner')),
  },
  // Hantu
  '35008': {
    synergy: { gives: { breakers: 1, virus: 1 } },
    counters: { virus: () => 1 }, // +2 strength for a boost
    counterFormulas: { virus: hantuVirus },
  },
  // Rising Tide
  '35009': { synergy: { gives: { breakers: 1 }, wants: { discard: 1 } } },
  // Cacophony
  '35010': {
    synergy: { gives: { denial: 1 }, wants: { trash: 2 } },
    value: { rig: 4 },
    // A power counter the first time each turn it steals or trashes a Corp card
    runner: (state, code) => {
      return perTurn(state, PACE.stealOrTrash * (anySuccess(state) / PACE.success) * counterWorthOf(state, code, 'power'), 'runner', 0, Infinity, 1, lock());
    },
    counters: { power: () => 1.2 }, // 2 counters sabotage 3
    counterFormulas: { power: cacophonyPower },
  },
  // Rent Rioters
  '35011': {
    synergy: { gives: { econ: 1.5 } },
    value: { rig: 3 }, // 9 credits waiting
    // 3 clicks for 9 credits
    runner: () => 9 - 3 * CLICK,
  },
  // Baz Wong
  '35012': { synergy: { gives: { install: 1.5 } } },
  // MuslihaT
  '35013': { synergy: { gives: { draw: 1, breakers: 0.5 }, wants: { runs: 1 } } },
  // Clean Getaway
  '35014': {
    synergy: { gives: { runs: 1, econ: 1 } },
    // 6 credits
    run: (): RunOptions => {
      return { successCredits: 6 };
    },
  },
  // Lie Low
  '35015': { synergy: { gives: { draw: 1 } } },
  // Maintenance Access
  '35016': {
    synergy: { gives: { runs: 1, hq: 1 } },
    // Archives' ice, then HQ is breached instead; the extra click it costs
    run: (state?: GameState): RunOptions => {
      return { breachAs: 'hq', successBonus: -(state ? runClick(state) : 1) };
    },
  },
  // Transfer of Wealth
  '35017': {
    synergy: { gives: { runs: 1, hq: 1, econ: 1, denial: 1.5 } },
    // A tag, the Corp loses up to 3 credits, the Runner gains twice that (plan.transferOfWealth)
    run: (state?: GameState): RunOptions => {
      // The Corp's loss counts flat, the Runner's gain on its credit slide
      return state ? { successBonus: Math.min(3, state.corp.credits) - tagCost(state), successCredits: 2 * Math.min(3, state.corp.credits) } : { successBonus: 6 };
    },
  },
  // Detente
  '35018': {
    synergy: { wants: { hq: 1.5 }, when: ['successfulRun'] },
    value: { rig: 3.5 },
    // +1 MU; parks an HQ card each HQ run, and can trade 2 back for a random access
    runner: state => muWorth(state) + perTurn(state, PACE.runs * PACE.hqShare * 0.5 * accessWorth(state), 'runner'),
  },
  // Maglectric Rapid (748 Mod)
  '35019': {
    synergy: { wants: { hq: 1 }, when: ['successfulRun'] },
    value: { rig: 1.5 }, // One derez
    // Maglectric Rapid: once, derez a Corp card (about its rez cost)
    runner: state => {
      const rezzed = Object.values(state.corp.servers).flatMap(s => s.ice).filter(i => i.isRezzed).map(i => cardDef(i).cost ?? 0);
      return 0.8 * (rezzed.length ? Math.max(...rezzed) : 3);
    },
  },
  // Sang Kancil
  '35020': { synergy: { gives: { breakers: 1 }, wants: { runs: 1 } } },
  // Fransofia Ward
  '35021': {
    synergy: { gives: { denial: 1 } },
    value: { rig: 2 }, // Taxes every rez
    // Each rez costs the Corp a credit more; bypass an ice once the Corp is rich
    runner: state => perTurn(state, PACE.rezzes, 'runner') + (state.corp.credits >= 15 ? 3 : 0.5),
  },
  // Open Market
  '35022': {
    synergy: { gives: { econ: 1 } },
    value: { rig: 2.5 },
    profile: { load: 6, pay: 1, every: 'turn', perTurn: 1 }, // Open Market
  },
  // Dewi Subrotoputri
  '35023': { synergy: { wants: { runs: 1.5, breakers: 0.5 }, when: ['successfulRun'] } },
  // Magdalene Keino-Chemutai
  '35024': { synergy: { gives: { install: 1 }, wants: { discard: 2, draw: 1 } } },
  // Illumination
  '35025': { synergy: { gives: { runs: 1, rd: 1, install: 1 } } },
  // Ritual
  '35026': { synergy: { gives: { draw: 1 } } },
  // GAMEDRAGON™ Pro
  '35027': {
    synergy: { wants: { breakers: 1 } },
    value: { rig: 2 }, // A breaker boost that lasts the run
    // GAMEDRAGON Pro: +1 strength and boosts last the run, about a credit a run with a host
    runner: state => {
      const hosts = state.runner.rig.programs.some(p => /icebreaker/i.test(cardDef(p).keywords ?? '') && !/\bAI\b/.test(cardDef(p).keywords ?? ''));
      return perTurn(state, PACE.runs * (hosts ? 1 : 0.5), 'runner');
    },
  },
  // Madani
  '35028': {
    synergy: { gives: { install: 1 }, wants: { breakers: 0.5 } },
    value: { rig: 2.5 }, // Free program installs (hosted cards count too)
    // A hosted program installed each turn without a click
    runner: (state, _code, card) => {
      // Like DZMZ Optimizer: a click for each program still to install (hosted ones too, so hosting doesn't use up
      // This worth; their own saved click is on them, evaluate.ts), over the turns left. It installs on the Runner's
      // Turn and again on the Corp's (rules 9.5.2), so 2 a round; a click to host about every 3 installs.
      const hosted = card?.hostedCards ?? [];
      const programs = [...state.runner.grip, ...state.runner.stack, ...hosted].filter(c => cardDef(c).type_code === 'program').length;
      return CLICK * (2 / 3) * 0.6 * perTurn(state, 2, 'runner', 0, Math.ceil(programs / 2));
    },
  },
  // Azimat
  '35029': {
    synergy: { gives: { econ: 0.5 }, wants: { trash: 1 } },
    value: { rig: 2.5 }, // 2 recurring credits for trashing
    // Its 2 credits refill each turn it has a trash cost to pay
    runner: (state, code) => perTurn(state, PACE.paidTrashes * 2 * counterWorthOf(state, code, 'credit'), 'runner'),
    counters: { credit: () => 0.8 }, // Recurring, only for trash costs
    counterFormulas: { credit: azimatCredit },
  },
  // Chromatophores
  '35030': {
    synergy: { gives: { breakers: 0.5 } },
    value: { rig: 2 }, // Any breaker can break its host ice
    // The host ice can be broken by any breaker
    runner: (state, _code, card) => {
      const host = card?.hostedOnId ? Object.values(state.corp.servers).flatMap(s => s.ice).find(i => i.instanceId === card.hostedOnId) : undefined;
      return host?.isRezzed ? 1 + 0.3 * Math.min(8, cardDef(host).cost ?? 0) : 1.5;
    },
  },
  // Devadatta Drone
  '35031': {
    synergy: { wants: { rd: 1.5 } },
    value: { rig: 2.5 }, // 2 extra R&D accesses
    // All its worth is its 2 power counters
    runner: () => 0,
    counters: { power: () => 1.2 }, // 1 more card accessed on an R&D breach
    counterFormulas: { power: devadattaPower },
  },
  // Principia
  '35032': { synergy: { gives: { breakers: 1 }, wants: { breakers: 1 } } },
  // “Knickknack” O’Brian
  '35033': {
    synergy: { gives: { draw: 0.5, econ: 0.5, discard: 0.5 }, wants: { runs: 0.5 } },
    value: { rig: 2, draws: 0.5 }, // Credits and a card for spent installs
    // Now and then, an empty card turned into its install cost and a card
    runner: state => {
      const spent = 0.25 * (2 + cardRate(state, 'runner') - 1);
      // The Sourdough loop (Jeff, 2026-10-30): Principia pays its printed 4 but reinstalls for 1 less per other
      // Breaker installed (from the grip, or the heap with Scrounge), so trashing a spare copy is credits and a card most turns
      const principia = [...state.runner.grip, ...state.runner.stack, ...state.runner.heap, ...state.runner.rig.programs].some(c => c.cardCode === PRINCIPIA);
      if (!principia) return perTurn(state, spent, 'runner');
      const breakers = state.runner.rig.programs.filter(c => isIcebreaker(c) && c.cardCode !== PRINCIPIA).length;
      const loop = 4 + cardRate(state, 'runner') - Math.max(0, 4 - Math.max(1, breakers)) - CLICK;
      return perTurn(state, Math.max(spent, 0.6 * loop), 'runner');
    },
  },
  // Side Hustle
  '35034': {
    synergy: { gives: { econ: 0.5 }, wants: { runs: 1.5 } },
    value: { rig: 2.5 },
    // A credit for each run until it holds 6, then a card
    runner: (state, code, card) => {
      const left = Math.max(0, 6 - (card ? counters(card, 'credit') : 1));
      return perTurn(state, PACE.runs * counterWorthOf(state, code, 'credit'), 'runner', 0, Math.ceil(left / PACE.runs)) + 0.85 ** Math.ceil(left / PACE.runs) * cardRate(state, 'runner');
    },
    counters: { credit: () => 0.9 }, // All taken (and a card drawn) once it holds 6
    counterFormulas: { credit: (s, card) => sideHustleCredit(s, card) },
  },
  // LEO Construction
  '35035': { synergy: { wants: { bioroid: 2 } } },
  // Poétrï Luxury Brands
  '35036': { synergy: { gives: { install: 1 }, wants: { advance: 0.5 }, when: ['onScore'] } },
  // Aggressive Trendsetting
  '35037': { synergy: {} },
  // Project Ingatan
  '35038': {
    synergy: { wants: { advance: 1, discard: 0.5 }, when: ['onScore'] },
    // Agenda counters in the score area, by what spending one does
    counters: { agenda: () => 3 }, // Install a card from Archives for free
    counterFormulas: { agenda: ingatanAgenda },
  },
  // Humanoid Resources
  '35039': {
    synergy: { gives: { econ: 1, draw: 1, install: 1 } },
    value: { keep: 3, econ: 2, draws: 3 },
    // 3 clicks for 4 credits, 3 cards and 3 free actions (2 installs, 1 operation)
    corp: (_state, _code, { cost, card }) => {
      const keep = 0.9 * (4 + 3 * card + 3 * CLICK - 3 * CLICK) - cost;
      return { keep, econ: keep };
    },
  },
  // Otto Campaign
  '35040': {
    synergy: { gives: { econ: 1.5 } },
    value: { keep: 4, econ: 3.5 },
    profile: { load: 6, pay: 2, every: 'turn', perTurn: 1, clicksAtEnd: 2 }, // Otto Campaign
    counters: { credit: () => PAID_OUT }, // 2 a turn, no click
    counterFormulas: { credit: () => paidOut() },
  },
  // Bumi 1.0
  '35041': { synergy: { gives: { ice: 1, bioroid: 1, damage: 0.5 } } },
  // Scatter Field
  '35042': { synergy: { gives: { ice: 1, install: 0.5 } } },
  // Nanomanagement
  '35043': { synergy: { gives: { advance: 1 } } },
  // Top-Down Solutions
  '35044': { synergy: { gives: { draw: 1, install: 1 } } },
  // Mercia B4LL4RD
  '35045': {
    synergy: { gives: { ice: 1, install: 0.5, bioroid: 1 } },
    value: { keep: 2, upgrade: [1, 1] },
    // One ice a turn installed for no click and 1 credit less
    corp: state => {
      const value = perTurn(state, PACE.iceInHand * (CLICK + 1), 'corp', 3) * 0.5; // It moves with the ice, so it helps only while ice keeps coming
      return { keep: value, upgrade: [value, value] };
    },
  },
  // AU Co.: The Gold Standard in Clones
  '35046': {
    synergy: { wants: { damage: 2, discard: 1.5 } },
    counters: { power: () => 1.5 }, // AU Co.: 2 counters look at 3, keep 2 of them
    counterFormulas: { power: auCoPower },
  },
  // PT Untaian
  '35047': { synergy: { gives: { advance: 1.5 } } },
  // Proprionegation
  '35048': {
    synergy: { when: ['onScore'] },
    counters: { agenda: () => 3 }, // Sends a run back to Archives once
    counterFormulas: { agenda: proprionegationAgenda },
  },
  // Sericulture Expansion
  '35049': {
    synergy: { gives: { advance: 1 }, wants: { advance: 1 }, when: ['onScore'] },
    counters: { agenda: () => 4 }, // 2 advancement counters (2 clicks and 2 credits)
    counterFormulas: { agenda: sericultureAgenda },
  },
  // Byte!
  '35050': {
    synergy: { gives: { damage: 1.5, tags: 0.5 } },
    value: { keep: 1.5 }, // A trap, but costs 4 to fire
    // Pay 4 on access for 1 tag and 3 net damage; accessed about half the time
    corp: (state, _code, { tag }) => {
      const fire = tag + damageWorth(state, 3) - 4;
      return { keep: Math.max(0.3, 0.5 * fire) };
    },
  },
  // Phật Gioan Baotixita
  '35051': {
    synergy: { gives: { damage: 1 }, when: ['onScore'] },
    value: { keep: 2 },
    // A power counter a turn (1 net damage each, priced in counterValues.ts), used up within about 3 turns
    corp: (state, code) => ({ keep: perTurn(state, counterWorthOf(state, code, 'power'), 'corp', 0, 3) }),
    counters: { power: () => 1.5 }, // 1 net damage each, when an agenda is scored or stolen
    counterFormulas: { power: gioanPower },
  },
  // Empiricist
  '35052': { synergy: { gives: { ice: 1, damage: 1, tags: 0.5, draw: 0.5 } } },
  // Mycoweb
  '35053': { synergy: { gives: { ice: 1 }, wants: { discard: 1 } } },
  // Semak-samun
  '35054': { synergy: { gives: { ice: 1, damage: 1 } } },
  // Peer Review
  '35055': { synergy: { gives: { econ: 1.5 } } },
  // Mitra Aman
  '35056': {
    synergy: { gives: { econ: 0.5, ice: 0.5 } },
    value: { keep: 2, upgrade: [1.5, 1.2] },
    // Once, 3 credits and a swap of the approached ice
    corp: () => {
      const value = 3 + 2;
      return { keep: value, upgrade: [value, value] };
    },
  },
  // Nebula Talent Management
  '35057': { synergy: { wants: { operations: 2 }, when: ['successfulRun'] } },
  // Synapse Global
  '35058': { synergy: { gives: { econ: 0.5 }, wants: { tags: 1.5 }, when: ['ifTagged'] } },
  // Embedded Reporting
  '35059': {
    synergy: { wants: { advance: 1.5, operations: 0.5 }, when: ['onScore'] },
    counters: { agenda: () => 1.5 }, // An operation to the top of R&D
    counterFormulas: { agenda: embeddedAgenda },
  },
  // Next Big Thing
  '35060': {
    synergy: { gives: { draw: 1 }, when: ['onScore'] },
    counters: { agenda: () => 3 }, // A click for 4 cards and a reshuffle
    counterFormulas: { agenda: nextBigThingAgenda },
  },
  // Idiosyncresis
  '35061': {
    synergy: { gives: { econ: 1, denial: 1.5 }, wants: { advance: 1 } },
    value: { keep: 2.5 }, // 3 credits for the Corp and -2 for the Runner per counter
    // Each advancement is 3 credits to the Corp and 2 off the Runner, for a click and a credit
    corp: () => ({ keep: 0.6 * 2 * (3 + 2 - (CLICK + 1)) }),
    // Each counter is 3 credits and 2 off the Runner when it fires
    rezzed: (_state, card, rezCost) => card.advancementCounters * 5 - rezCost,
  },
  // Public Access Plaza
  '35062': {
    synergy: { gives: { econ: 1 }, when: ['threat'] },
    value: { keep: 3, econ: 2.5 },
    // 1 credit each turn
    corp: (state, _code, { cost }) => {
      const keep = perTurn(state, 1, 'corp') - cost;
      return { keep, econ: keep };
    },
  },
  // Doomscroll
  '35063': { synergy: { gives: { ice: 1, tags: 1, damage: 1 }, wants: { tags: 0.5 }, when: ['ifTagged'] } },
  // N-Pot
  '35064': { synergy: { gives: { ice: 1, denial: 0.5 }, when: ['threat'] } },
  // Bigger Picture
  '35065': { synergy: { gives: { denial: 1.5 }, wants: { tags: 1.5 }, when: ['ifTagged'] } },
  // IP Enforcement
  '35066': { synergy: { wants: { tags: 1 }, when: ['ifTagged'] } },
  // Touch-ups
  '35067': { synergy: { gives: { advance: 2 } } },
  // BANGUN
  '35068': { synergy: { gives: { damage: 1, tags: 0.5 } } },
  // The Zwicky Group
  '35069': { synergy: { wants: { operations: 1.5 } } },
  // Greenmail
  '35070': { synergy: { gives: { econ: 1 }, when: ['onScore'] } },
  // Off the Books
  '35071': {
    synergy: { gives: { install: 0.5 }, wants: { advance: 1 }, when: ['onScore'] },
    counters: { agenda: () => 3.5 }, // Fetch any card, installed for free
    counterFormulas: { agenda: offTheBooksAgenda },
  },
  // Anthill Excavation Contract
  '35072': {
    synergy: { gives: { econ: 2, draw: 0.5 } },
    value: { keep: 5, econ: 4 },
    profile: { load: 8, pay: 4, every: 'turn', perTurn: 1, drawEach: 1 }, // Anthill Excavation Contract
    counters: { credit: () => PAID_OUT }, // 4 a turn and a card
    counterFormulas: { credit: () => paidOut() },
  },
  // Plutus
  '35073': {
    synergy: { wants: { operations: 1.5, discard: 0.5 } },
    value: { keep: 1.5 }, // Replays transactions, but costly to rez
    // A transaction replayed each turn from Archives; to rez, trash 3 cards from HQ
    corp: (state, _code, { card }) => {
      const keep = perTurn(state, transactionGain(state), 'corp') - 3 * card;
      return { keep: Math.max(0.3, keep) };
    },
  },
  // Biawak
  '35074': { synergy: { gives: { ice: 1 } } },
  // Kessleroid
  '35075': { synergy: { gives: { ice: 1 } } },
  // Syailendra
  '35076': { synergy: { gives: { ice: 1, advance: 1, denial: 0.5, damage: 0.5 } } },
  // Key Performance Indicators
  '35077': { synergy: { gives: { advance: 1, econ: 0.5, ice: 0.5 } } },
  // Measured Response
  '35078': { synergy: { gives: { damage: 1.5, denial: 0.5 }, when: ['successfulRun', 'threat'] } },
  // Flyswatter
  '35079': { synergy: { gives: { ice: 1 } } },
  // Lamplighter
  '35080': { synergy: { gives: { ice: 1, tags: 1 }, wants: { tags: 0.5 }, when: ['ifTagged', 'onScore'] } },
  // Petty Cash
  // Petty Cash: from Archives, a click plays it again (net 2 credits and the click back), then it is removed from the game
  '35081': { synergy: { gives: { econ: 1 } }, archived: () => PETTY_CASH_REPLAY },
  // Mahkota Langit Grid
  '35082': {
    synergy: { gives: { econ: 1 } },
    value: { keep: 3, upgrade: [2, 0.5] },
    // 2 credits back each turn it gets to pay for a rez here; assets here cost 2 more to trash
    corp: (state, code) => {
      const refills = perTurn(state, 0.4 * 2 * counterWorthOf(state, code, 'credit'), 'corp') + 0.5;
      return { keep: refills, upgrade: [refills, 0.8 * refills] };
    },
    counters: { credit: () => 0.8 }, // Recurring, only for rezzes in its server
    counterFormulas: { credit: mahkotaCredit },
  },
};
