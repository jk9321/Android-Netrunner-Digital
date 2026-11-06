import { cardDef, GameState } from '../../core';
import { counters } from '../../core/engine/cardEffects';
import { PAID_OUT, paidOneATurn } from '../counterValues';
import { cardRate, CLICK, RATES } from '../valueModel';
import { accessWorth, centralSuccess, counterWorthOf, damageWorth, deckCount, deckShare, lock, muWorth, PACE, perTurn, runSuccess } from '../effectValues';
import type { RunOptions } from '../runs';
import { runClick } from '../runs';
import { tagCost } from '../runs';
import { tuning } from '../synergy';
import { CardAI } from './types';

/**
 * What the AI knows about each Liberation card's worth, one entry per card
 * (see ./types.ts). Adding a set: a file like this one, joined in ./index.ts.
 */

/** Share of the Runner's deck (stack and grip) that are cards of this type or with these subtypes. */
const runnerShare = (state: GameState, keywords: RegExp | null, type?: string): number => deckShare(state, 'runner', keywords, type);

/** The Runner's tags, now or soon: a tag-me deck plans around being tagged. */
const tagged = (state: GameState): number => (state.runner.tags > 0 ? 1 : 0.3);

/** Threat level: the higher score of the two sides (rules 1.16.4). */
const threat = (state: GameState): number => Math.max(state.corp.score, state.runner.score);

/** A run on all three centrals in one turn: rare (Wizard's Chest, Jeitinho). */
const allCentrals = (state: GameState): number => Math.min(0.25, 0.4 * runSuccess(state, 'hq') * runSuccess(state, 'rd') * runSuccess(state, 'archives'));

export const LIBERATION: Record<string, CardAI> = {
  // Strike Fund
  '34001': { synergy: { gives: { econ: 1.5, discard: 0.5 } } },
  // The Price
  '34002': { synergy: { gives: { discard: 1.5, install: 1 } } },
  // Solidarity Badge
  '34003': {
    synergy: { gives: { draw: 1 }, wants: { trash: 1.5, tags: 0.5 } },
    value: { rig: 1.5, draws: 0.5 },
    // A counter on turns it trashes a Corp card, each a card or a tag gone
    runner: (state, code) => perTurn(state, PACE.paidTrashes * counterWorthOf(state, code, 'power'), 'runner'),
    counters: { power: state => (state.runner.tags > 0 ? Math.max(cardRate(state, 'runner'), RATES.tagAgainstRunner * 0.5) : cardRate(state, 'runner')) }, // A card or a tag removed
  },
  // Audrey v2 (icebreaker)
  '34004': {
    synergy: { gives: { breakers: 1.5, virus: 1 }, wants: { trash: 1.5, discard: 0.5 } },
    counters: { virus: () => 1.5 }, // Breaks up to 2 subroutines
  },
  // Banner
  '34005': { synergy: { gives: { breakers: 1 } } },
  // Monkeywrench
  '34006': {
    synergy: { gives: { breakers: 0.5 }, wants: { breakers: 1 } },
    value: { rig: 1.5 },
    // -2 strength on its host and -1 on the rest of the server's ice: boosting saved on runs there
    runner: state => perTurn(state, PACE.runs * 0.4 * 1.5, 'runner', 0, Infinity, 1, lock()),
  },
  // Eru Ayase-Pessoa
  '34007': {
    synergy: { gives: { runs: 1, rd: 1.5, archives: 0.5 }, wants: { tags: 0.5 }, when: ['threat'] },
    value: { rig: 2 },
    // Once a turn, a tag for an R&D breach past Archives' ice (and 1 more card at threat 3)
    runner: state => {
      const extra = threat(state) >= 3 ? accessWorth(state) : 0;
      return perTurn(state, 0.4 * runSuccess(state, 'archives') * (accessWorth(state) + extra - 0.5 * RATES.tagAgainstRunner), 'runner');
    },
    // A tag, then Archives breaches R&D instead (1 more card at threat 3)
    run: (state?: GameState): RunOptions => {
      return { breachAs: 'rd', extraAccesses: state && Math.max(state.corp.score, state.runner.score) >= 3 ? 1 : 0, successBonus: state ? -tagCost(state) : -3 };
    },
  },
  // Hannah "Wheels" Pilintra
  '34008': {
    synergy: { gives: { runs: 1 }, wants: { tags: 0.5 } },
    value: { rig: 1.5 },
    // A free click-run on a remote once a turn (a tag if it fails), or 2 clicks and a tag gone when trashed
    runner: state => Math.max(2 * CLICK + 0.5 * RATES.tagAgainstRunner * tagged(state), perTurn(state, 0.3 * (CLICK - (1 - PACE.success) * RATES.tagAgainstRunner * 0.5), 'runner')),
    // Hannah: the click comes back
    run: (state?: GameState): RunOptions => {
      return { successBonus: state ? runClick(state) : 1 };
    },
  },
  // Lago Paranoá Shelter
  '34009': {
    synergy: { gives: { draw: 1, discard: 0.5 } },
    value: { rig: 1, draws: 1 },
    // A card off the top of the stack for a fresh draw when the Corp installs in a root
    runner: state => perTurn(state, 0.6 * 0.5 * cardRate(state, 'runner'), 'runner'),
  },
  // Mercury: Chrome Libertador
  '34010': { synergy: { gives: { hq: 1, rd: 1 }, wants: { runs: 1 } } },
  // Chrysopoeian Skimming
  '34011': { synergy: { gives: { draw: 0.5, rd: 0.5 } } },
  // S-Dobrado
  '34012': {
    synergy: { gives: { runs: 1.5, hq: 1, rd: 1 }, when: ['threat'] },
    // The first ice encountered is bypassed (rules 6.5.8a), a second for a click at threat 4
    run: (): RunOptions => {
      return tuning.plan.bypass ? { bypassFirst: true } : {};
    },
  },
  // Capybara
  '34013': {
    synergy: { gives: { denial: 1 } },
    value: { rig: 1.5 },
    // Once, a bypassed ice derezzed: the Corp pays its rez cost again
    runner: state => (deckCount(state, 'runner', c => /bypass/i.test(cardDef(c).stripped_text ?? '')) > 1 ? 3 : 1),
  },
  // Hermes
  '34014': {
    synergy: { gives: { denial: 1 }, when: ['onScore'] },
    value: { rig: 2 },
    // +1 MU; an unrezzed card bounced to HQ on each agenda scored or stolen
    runner: state => muWorth(state) + perTurn(state, PACE.agendaEvents * 2, 'runner'),
  },
  // Curupira (icebreaker)
  '34015': {
    synergy: { gives: { breakers: 1 } },
    counters: { power: () => 1 }, // 3 bypass a barrier
  },
  // Laser Pointer
  '34016': {
    synergy: { gives: { runs: 0.5 } },
    value: { rig: 1 },
    // Once, a bypass of an AP, destroyer or observer ice
    runner: () => 2,
  },
  // Saci
  '34017': {
    synergy: { gives: { econ: 1 } },
    value: { rig: 1.5 },
    // 3 credits each time its host is rezzed or derezzed (the Corp avoids it: about once)
    runner: () => 2,
  },
  // Shibboleth
  '34018': { synergy: { gives: { breakers: 1 }, when: ['threat'] } },
  // Debbie "Downtown" Moreira
  '34019': {
    synergy: { gives: { econ: 1, runs: 1 }, wants: { runs: 1 }, when: ['threat'] },
    value: { rig: 1.5 },
    // A credit on each run event (2 at threat 4), spent on click-runs
    runner: (state, code) => {
      const events = Math.min(1, 3 * runnerShare(state, /\brun\b/i, 'event'));
      return (threat(state) >= 4 ? 2 * counterWorthOf(state, code, 'credit') : 0) + perTurn(state, events * counterWorthOf(state, code, 'credit'), 'runner');
    },
    counters: { credit: () => PAID_OUT }, // Run credits, with a click-run
    // Its click-run can spend its hosted credits
    run: (state?: GameState): RunOptions => ({ bonusCredits: state?.runner.rig.resources.find(c => c.cardCode === '34019')?.tokens.credit ?? 0 }),
  },
  // Arissana Rocha Nahu: Street Artist
  '34020': { synergy: { gives: { install: 1.5, breakers: 0.5 } } },
  // Joy Ride
  '34021': {
    synergy: { gives: { runs: 1, rd: 1, draw: 2 } },
    // 5 cards
    run: (state?: GameState): RunOptions => {
      return { successBonus: state ? Math.min(5, Math.max(1, state.runner.handSizeLimit - state.runner.grip.length + 1)) * cardRate(state, 'runner') : 4 };
    },
  },
  // AirbladeX (JSRF Ed.)
  '34022': {
    synergy: {},
    value: { rig: 1 },
    // Its counters prevent net damage or an end-the-run during runs
    runner: (state, code, card) => (card ? counters(card, 'power') : 3) * counterWorthOf(state, code, 'power'),
    counters: { power: state => Math.max(0.5, Math.min(2, damageWorth(state, 1))) }, // A net damage prevented (or a run kept going)
  },
  // LilyPAD
  '34023': {
    synergy: { gives: { draw: 1 }, wants: { install: 1 } },
    value: { rig: 2.5, draws: 1 },
    // +2 MU; a card the first time each turn it installs a program
    runner: state => 2 * muWorth(state) * 0.6 + perTurn(state, PACE.programInstalls * cardRate(state, 'runner'), 'runner'),
  },
  // Living Mural
  '34024': { synergy: { gives: { breakers: 1 }, when: ['threat'] } },
  // Pichação
  '34025': {
    synergy: { gives: { runs: 1 } },
    value: { rig: 1 },
    // A click back the first time each turn it passes its host
    runner: state => perTurn(state, 0.4 * CLICK, 'runner', 0, Infinity, 1, lock()),
  },
  // Slap Vandal
  '34026': { synergy: { gives: { breakers: 1 } } },
  // Umbrella
  '34027': { synergy: { gives: { breakers: 1, draw: 0.5 } } },
  // Beatriz Friere Gonzalez
  '34028': {
    synergy: { gives: { runs: 1, rd: 1.5 } },
    value: { rig: 1.5 },
    // A click more for an R&D breach of 2 cards past HQ's ice, now and then
    runner: state => perTurn(state, 0.3 * runSuccess(state, 'hq') * (2 * accessWorth(state) - CLICK), 'runner'),
    // An extra click, then HQ breaches R&D with 1 more card
    run: (state?: GameState): RunOptions => {
      return { breachAs: 'rd', extraAccesses: 1, successBonus: -(state ? runClick(state) : 1) };
    },
  },
  // Urban Art Vernissage
  '34029': {
    synergy: { gives: { econ: 1, install: 0.5 } },
    value: { rig: 1 },
    // 2 install credits for each trojan picked back up
    runner: (state, code) => perTurn(state, Math.min(1, 4 * runnerShare(state, /trojan/i)) * 0.5 * 2 * counterWorthOf(state, code, 'credit'), 'runner'),
    counters: { credit: () => PAID_OUT }, // Install credits
  },
  // Bahia Bands (event)
  '34030': {
    synergy: { gives: { runs: 1, draw: 1, econ: 1, install: 0.5 } },
    counters: { credit: () => 0.9 }, // Trash-cost credits
    // Two of 2 cards, a cheaper install, a tag gone, 4 credits
    run: (): RunOptions => {
      return { successBonus: 4 };
    },
  },
  // Salvo Testing
  '34031': { synergy: { gives: { damage: 1 }, when: ['onScore'] } },
  // Stegodon MK IV
  '34032': { synergy: { gives: { denial: 0.5, econ: 0.5 } } },
  // Wage Workers
  '34033': {
    synergy: { gives: { econ: 0.5, bioroid: 0.5 } },
    value: { keep: 1.5, econ: 1 },
    // A click back on turns it takes one action 3 times
    corp: (state, _code, { cost }) => {
      const keep = Math.max(0.3, perTurn(state, 0.5 * CLICK, 'corp') - cost);
      return { keep, econ: keep };
    },
  },
  // Ablative Barrier
  '34034': { synergy: { gives: { ice: 1, install: 0.5 }, when: ['threat'] } },
  // Jaguarundi
  '34035': { synergy: { gives: { ice: 1, tags: 1, damage: 1 }, wants: { tags: 0.5 }, when: ['ifTagged', 'threat'] } },
  // M.I.C.
  '34036': { synergy: { gives: { ice: 1, denial: 1 } } },
  // Greasing the Palm
  '34037': { synergy: { gives: { econ: 1.5, install: 0.5, advance: 0.5 }, wants: { tags: 0.5 } } },
  // Vovô Ozetti
  '34038': {
    synergy: { gives: { econ: 1 }, wants: { ice: 1 }, when: ['threat'] },
    value: { keep: 2, upgrade: [2, 2] },
    // 2 credits off each ice rezzed here (and root cards at threat 4)
    corp: (state, _code, { cost }) => {
      const value = Math.max(0.3, perTurn(state, PACE.rezzes * 0.4 * 2, 'corp', 0, 4) + (threat(state) >= 4 ? 1 : 0) - cost);
      return { keep: value, upgrade: [value, value] };
    },
  },
  // A Teia: IP Recovery
  '34039': { synergy: { gives: { install: 2 } } },
  // Fujii Asset Retrieval
  '34040': { synergy: { gives: { damage: 1.5 }, when: ['onScore'] } },
  // Front Company
  '34041': {
    synergy: { gives: { damage: 1 } },
    value: { keep: 1.5 },
    // No first run on a remote each turn; 2 net damage on an Archives run past no ice
    corp: (state, _code, { cost }) => {
      const archivesBare = (state.corp.servers.archives?.ice.length ?? 0) === 0 ? 0.3 * damageWorth(state, 2) : 0;
      return { keep: Math.max(0.3, perTurn(state, 0.5 + archivesBare, 'corp', 0, 4) - cost) };
    },
  },
  // Attini
  '34042': { synergy: { gives: { ice: 1, damage: 1 }, when: ['threat'] } },
  // Phoneutria
  '34043': { synergy: { gives: { ice: 1, damage: 1, tags: 0.5 } } },
  // Tatu-Bola
  '34044': { synergy: { gives: { ice: 1, econ: 0.5 } } },
  // Mindscaping
  '34045': { synergy: { gives: { econ: 1, draw: 1, damage: 0.5 }, wants: { tags: 0.5 } } },
  // Adrian Seis
  '34046': {
    synergy: { gives: { denial: 1 }, when: ['successfulRun'] },
    value: { keep: 2, upgrade: [2.5, 2] },
    // A psi game on each successful run here: half the time the Runner only gets this card
    corp: (state, _code, { cost, agenda }) => {
      const remote = Math.max(0.3, 0.5 * 0.5 * agenda - cost);
      const central = Math.max(0.3, perTurn(state, PACE.runs * 0.25 * 0.5 * accessWorth(state), 'corp') - cost);
      return { keep: Math.max(remote, central), upgrade: [remote, central] };
    },
  },
  // Daniela Jorge Inácio
  '34047': {
    synergy: { gives: { denial: 1 } },
    value: { keep: 2, upgrade: [2, 1.5] },
    // Steals here cost 2 cards from the grip, and so does trashing it
    corp: (state, _code, { cost, agenda }) => {
      const tax = 2 * cardRate(state, 'runner') * 0.6;
      return { keep: Math.max(0.3, tax - cost + 0.1 * agenda), upgrade: [Math.max(0.3, tax + 0.1 * agenda - cost), Math.max(0.3, tax * 0.7 - cost)] };
    },
  },
  // Epiphany Analytica: Nations Undivided (identity)
  '34048': {
    synergy: { gives: { install: 1, draw: 0.5 } },
    counters: { power: state => 0.5 * cardRate(state, 'corp') + 0.5 }, // A click for a look at 3 and a free install
  },
  // Oracle Thinktank
  '34049': { synergy: { gives: { tags: 1 }, wants: { tags: 0.5 } } },
  // Balanced Coverage
  '34050': {
    synergy: { gives: { econ: 1 } },
    value: { keep: 2, econ: 1.5 },
    // 2 credits on turns it names the top card's type (about half)
    corp: (state, _code, { cost }) => {
      const keep = Math.max(0.3, perTurn(state, 0.5 * 2, 'corp') - cost);
      return { keep, econ: keep };
    },
  },
  // Behold!
  '34051': {
    synergy: { gives: { tags: 1.5 } },
    value: { keep: 2 },
    // A trap: 4 credits for 2 tags on access (R&D accesses reveal it)
    corp: (_state, _code, { tag }) => ({ keep: Math.max(0.3, 0.5 * (2 * tag - 4)) }),
  },
  // Federal Fundraising
  '34052': {
    synergy: { gives: { draw: 0.5 } },
    value: { keep: 1.5, draws: 0.5 },
    // The top 3 of R&D arranged each turn, and a card if unprotected
    corp: (state, code, { card }) => {
      const bare = Object.values(state.corp.servers).some(s => s.root.some(c => c.cardCode === code) && s.ice.length === 0) ? 0.5 : 0.2;
      return { keep: perTurn(state, 0.4 + bare * card, 'corp') };
    },
  },
  // Starlit Knight
  '34053': { synergy: { gives: { ice: 1, tags: 1 }, wants: { tags: 1 }, when: ['threat'] } },
  // Virtual Service Agent
  '34054': { synergy: { gives: { ice: 1, tags: 1, denial: 0.5 } } },
  // Oppo Research
  '34055': { synergy: { gives: { tags: 2 }, when: ['threat'] } },
  // Your Digital Life
  '34056': { synergy: { gives: { econ: 1.5 } } },
  // Slash and Burn Agriculture
  '34057': { synergy: { gives: { advance: 1.5 } } },
  // Cybersand Harvester
  '34058': {
    synergy: { gives: { econ: 1.5 }, wants: { ice: 1 } },
    value: { keep: 2, econ: 1.5 },
    // 2 install credits each time it rezzes ice
    corp: (state, code, { cost }) => {
      const keep = Math.max(0.3, perTurn(state, PACE.rezzes * 2 * counterWorthOf(state, code, 'credit'), 'corp') - cost);
      return { keep, econ: keep };
    },
    counters: { credit: () => PAID_OUT }, // Install credits, or all taken when trashed
  },
  // Tree Line
  '34059': { synergy: { gives: { ice: 1, advance: 1.5 } } },
  // Valentão
  '34060': { synergy: { gives: { ice: 1, econ: 0.5, denial: 1 } } },
  // Armed Asset Protection
  '34061': { synergy: { gives: { econ: 1.5 }, wants: { discard: 0.5 } } },
  // Pivot
  '34062': { synergy: { gives: { draw: 0.5, operations: 0.5 }, when: ['threat'] } },
  // Angelique Garza Correa
  '34063': {
    synergy: { gives: { damage: 1 }, when: ['threat'] },
    value: { keep: 1, upgrade: [1, 1] },
    // A trap: pay 2 on access for meat damage
    corp: state => {
      const value = Math.max(0.3, 0.5 * (damageWorth(state, 2) - 2));
      return { keep: value, upgrade: [value, value] };
    },
  },
  // Tucana
  '34064': {
    synergy: { gives: { ice: 1 }, when: ['onScore'] },
    value: { keep: 1.5, upgrade: [2, 0] },
    // Remote only: an ice found and rezzed cheaply when an agenda leaves its root
    corp: (_state, _code, { cost }) => {
      const value = Math.max(0.3, 3 - cost);
      return { keep: value, upgrade: [value, 0] };
    },
  },
  // B-1001
  '34065': {
    synergy: { wants: { tags: 1.5 } },
    value: { keep: 1.5 },
    // A tag spent to end a run elsewhere
    corp: (state, _code, { cost, tag }) => ({ keep: Math.max(0.3, (state.runner.tags > 0 ? tag + 2 : 0.5) - cost) }),
  },
  // Sebastião Souza Pessoa: Activist Organizer
  '34066': { synergy: { gives: { install: 1 }, wants: { tags: 1 } } },
  // Eye for an Eye
  '34067': {
    synergy: { gives: { runs: 1, hq: 1.5, trash: 1, tags: 0.5 } },
    // A tag, 1 more HQ card
    run: (state?: GameState): RunOptions => {
      return { extraAccesses: 1, successBonus: state ? -tagCost(state) : -3 };
    },
  },
  // Privileged Access
  '34068': {
    synergy: { gives: { runs: 0.5, install: 1, tags: 0.5 }, wants: { discard: 1 }, when: ['threat'] },
    // No breach, a tag and a cheap resource from the heap
    run: (state?: GameState): RunOptions => {
      return { noBreach: true, successBonus: state ? (state.runner.heap.some(c => cardDef(c).type_code === 'resource') ? 3 : 0) - tagCost(state) : 0 };
    },
  },
  // Amanuensis
  '34069': {
    synergy: { gives: { draw: 1 }, wants: { tags: 1.5 } },
    value: { rig: 1.5, draws: 1 },
    // +1 MU; 2 cards when it removes a tag, after a turn ended tagged
    runner: (state, code) => muWorth(state) + perTurn(state, 0.4 * tagged(state) * counterWorthOf(state, code, 'power'), 'runner'),
    counters: { power: state => 2 * cardRate(state, 'runner') }, // 2 cards when a tag is removed
  },
  // The Wizard's Chest
  '34070': {
    synergy: { gives: { install: 1 }, wants: { runs: 1.5, hq: 1, rd: 1, archives: 1 }, when: ['successfulRun'] },
    value: { rig: 0.5 },
    // Once, after all three centrals in a turn: a free install of a set-aside card
    runner: state => 4 * Math.min(1, 3 * allCentrals(state)),
  },
  // Boi-tatá
  '34071': { synergy: { gives: { breakers: 1 } } },
  // Heliamphora
  '34072': {
    synergy: { gives: { virus: 1 }, wants: { archives: 1.5 } },
    value: { rig: 1 },
    // Archives cards hosted, so the Corp can't get them back
    runner: state => perTurn(state, PACE.runs * PACE.archivesShare * runSuccess(state, 'archives') * 0.5, 'runner'),
  },
  // Arruaceiras Crew
  '34073': {
    synergy: { gives: { trash: 1 }, wants: { tags: 0.5 } },
    value: { rig: 2 },
    // A tag for -2 strength once a turn; later, a weak ice trashed outright
    runner: state => perTurn(state, 0.3 * (2 - 0.3 * RATES.tagAgainstRunner * (1 - tagged(state))), 'runner') + 1.5,
  },
  // Friend of a Friend
  '34074': {
    synergy: { gives: { econ: 2 } },
    value: { rig: 2 },
    // A click for 5 credits and a tag gone, or 9 credits for a tag
    runner: state => (state.runner.tags > 0 ? 5 + RATES.tagAgainstRunner : 9 - RATES.tagAgainstRunner * 0.7) - CLICK,
  },
  // Manuel Lattes de Moura
  '34075': {
    synergy: { gives: { hq: 1, rd: 1 }, wants: { tags: 1.5 }, when: ['threat'] },
    value: { rig: 2 },
    // One more card on each HQ or R&D breach while tagged
    runner: state => perTurn(state, PACE.runs * centralSuccess(state) * tagged(state) * accessWorth(state), 'runner', 0, Infinity, 1, lock()),
  },
  // Meeting of Minds
  '34076': { synergy: { gives: { econ: 1, draw: 0.5 } } },
  // Window of Opportunity
  '34077': {
    synergy: { gives: { runs: 1, install: 0.5 } },
    // A rezzed ice derezzed as the run begins, and a free-click install
    run: (): RunOptions => {
      return tuning.plan.bypass ? { derezOne: true, successBonus: 0 } : {};
    },
  },
  // Alarm Clock
  '34078': {
    synergy: { gives: { runs: 1, hq: 1 } },
    value: { rig: 1.5 },
    // A free HQ run each turn, with a bypass for 2 clicks
    runner: state => perTurn(state, 0.5 * runSuccess(state, 'hq') * accessWorth(state), 'runner', 0, Infinity, 1, lock()),
  },
  // Jeitinho
  '34079': {
    synergy: { wants: { runs: 1.5, hq: 1, rd: 1, archives: 1 }, when: ['successfulRun', 'threat'] },
    value: { rig: 0.5 },
    // Three of these scored win the game: rare
    runner: state => 2 * allCentrals(state),
  },
  // Cupellation
  '34080': {
    synergy: { gives: { trash: 1 }, wants: { hq: 1 } },
    value: { rig: 1.5 },
    // An accessed card hosted for a credit, trashed later from HQ breaches
    runner: state => perTurn(state, PACE.runs * PACE.hqShare * runSuccess(state, 'hq') * 0.5, 'runner'),
  },
  // Malandragem
  '34081': {
    synergy: { gives: { runs: 1 }, when: ['threat'] },
    value: { rig: 2 },
    // Two bypasses of small ice (or one removal at threat 4)
    runner: (state, code, card) => (card ? counters(card, 'power') : 2) * counterWorthOf(state, code, 'power'),
    counters: { power: () => 2 }, // A bypass of an ice of strength 3 or less
  },
  // Physarum Entangler
  '34082': {
    synergy: { gives: { runs: 1 }, wants: { econ: 0.5 } },
    value: { rig: 1.5 },
    // Its host bypassed for a credit a subroutine (not barriers)
    runner: state => perTurn(state, PACE.runs * 0.3 * 1.5, 'runner', 0, 4),
  },
  // Amelia Earhart
  '34083': {
    synergy: { wants: { hq: 1, rd: 1 } },
    value: { rig: 1 },
    // After three big central runs, the Corp shuffles back (or loses) cards from Archives
    runner: (state, code) => 3 * counterWorthOf(state, code, 'power') * 0.5,
    counters: { power: () => 0.8 }, // A third of a disruption
  },
  // Juli Moreira Lee
  '34084': {
    synergy: { gives: { econ: 0.5 } },
    value: { rig: 1.5 },
    // A click back on 4 turns it uses a resource
    runner: (state, code, card) => perTurn(state, 0.5 * counterWorthOf(state, code, 'power'), 'runner', 0, card ? counters(card, 'power') : 4),
    counters: { power: () => CLICK }, // A click back
  },
  // Burner
  '34085': {
    synergy: { gives: { runs: 1, hq: 1, denial: 0.5 } },
    // No breach, 2 HQ cards sent back to R&D
    run: (state?: GameState): RunOptions => {
      return { noBreach: true, successBonus: state && state.corp.hq.length > 0 ? 3 : 0 };
    },
  },
  // Spree (event)
  '34086': {
    synergy: { gives: { runs: 1 }, wants: { breakers: 0.5 } },
    counters: { power: () => 0.8 }, // Moves a trojan to the attacked server
    // A plain run: moving a trojan to the attacked server is priced by its power counters
    run: (): RunOptions => ({}),
  },
  // Trick Shot (event)
  '34087': {
    synergy: { gives: { runs: 1.5, rd: 1.5, econ: 0.5 } },
    counters: { credit: () => 0.9 }, // Run credits
    // 4 credits for the run, 1 more R&D card, 2 credits after
    run: (): RunOptions => {
      return { bonusCredits: 4, extraAccesses: 1, successBonus: 1.5 };
    },
  },
  // Cataloguer
  '34088': {
    synergy: { gives: { rd: 1 }, wants: { runs: 1 }, when: ['successfulRun'] },
    value: { rig: 1 },
    // Twice, an R&D run arranges the top 4 instead of breaching
    runner: (state, code, card) => (card ? counters(card, 'power') : 2) * counterWorthOf(state, code, 'power'),
    counters: { power: () => 1.2 }, // The top 4 of R&D arranged
  },
  // Coalescence
  '34089': {
    synergy: { gives: { econ: 1 } },
    value: { rig: 1.5 },
    // 2 counters of 2 credits each, for a memory unit
    runner: (state, code, card) => (card ? counters(card, 'power') : 2) * counterWorthOf(state, code, 'power') - 0.3 * muWorth(state),
    counters: { power: () => 2 * PAID_OUT }, // 2 credits, no click
  },
  // Lobisomem (icebreaker)
  '34090': {
    synergy: { gives: { breakers: 1 } },
    counters: { power: () => 1.5 }, // Breaks barrier subroutines
  },
  // Muse
  '34091': {
    synergy: { gives: { install: 1.5, breakers: 0.5 } },
    value: { rig: 1 },
    // The program it fetched is priced on its own; this is a memory unit
    runner: state => -0.3 * muWorth(state) + 1,
  },
  // Pressure Spike
  '34092': { synergy: { gives: { breakers: 1 }, when: ['threat'] } },
  // "Pretty" Mary da Silva
  '34093': {
    synergy: { gives: { rd: 1 }, wants: { rd: 1 } },
    value: { rig: 2 },
    // One more R&D card when it breaches for 2 or more
    runner: state => perTurn(state, PACE.runs * PACE.rdShare * runSuccess(state, 'rd') * 0.4 * accessWorth(state), 'runner', 0, Infinity, 1, lock()),
  },
  // Ashen Epilogue
  '34094': { synergy: { gives: { draw: 1.5 } } },
  // Valentina Ferreira Carvalho
  '34095': {
    synergy: { gives: { econ: 0.5 }, wants: { tags: 1 }, when: ['threat'] },
    value: { rig: 1 },
    // A credit when it removes tags; at threat 3, a tag or 2 credits on install
    runner: state => perTurn(state, 0.3 * tagged(state), 'runner') + (threat(state) >= 3 ? 2 : 0),
  },
  // Thunderbolt Armaments: Peace Through Power
  '34096': { synergy: { gives: { damage: 0.5 }, wants: { ice: 1 } } },
  // Lightning Laboratory (agenda)
  '34097': {
    synergy: { gives: { econ: 0.5 }, when: ['onScore'] },
    counters: { agenda: () => 3 }, // Two ice rezzed free for a turn
  },
  // Warm Reception
  '34098': {
    synergy: { gives: { install: 1 } },
    value: { keep: 2 },
    // A free install each turn
    corp: (state, _code, { cost }) => ({ keep: Math.max(0.3, perTurn(state, 0.6 * CLICK, 'corp') - cost) }),
  },
  // Working Prototype
  '34099': {
    synergy: { gives: { econ: 1.5 } },
    value: { keep: 2, econ: 1.5 },
    // A counter on each rez, 3 credits a counter for a click
    corp: (state, code, { cost }) => {
      const keep = Math.max(0.3, 1 * counterWorthOf(state, code, 'power') + perTurn(state, PACE.rezzes * counterWorthOf(state, code, 'power'), 'corp') - cost);
      return { keep, econ: keep };
    },
    counters: { power: () => 3 - CLICK }, // 3 credits for a click
  },
  // Lycian Multi-Munition
  '34100': { synergy: { gives: { ice: 1 } } },
  // Sorocaban Blade
  '34101': { synergy: { gives: { ice: 1 } } },
  // Active Policing
  '34102': { synergy: { gives: { install: 0.5, denial: 1 }, when: ['threat'] } },
  // Corporate Hospitality
  '34103': { synergy: { gives: { econ: 1.5, draw: 1 }, wants: { discard: 0.5 } } },
  // Brasília Government Grid
  '34104': {
    synergy: { wants: { ice: 1 } },
    value: { keep: 1.5, upgrade: [1.5, 1.5] },
    // +3 strength on an ice rezzed during a run here, for a derez elsewhere
    corp: state => {
      const value = perTurn(state, PACE.rezzes * 0.3 * 1.5, 'corp');
      return { keep: value, upgrade: [value, value] };
    },
  },
  // See How They Run
  '34105': { synergy: { gives: { tags: 1, damage: 1 }, when: ['onScore'] } },
  // Sisyphus Protocol
  '34106': { synergy: { wants: { ice: 1 } } },
  // Charlotte Caçador
  '34107': {
    synergy: { gives: { econ: 1.5, draw: 0.5 }, wants: { advance: 1 } },
    value: { keep: 2, econ: 1.5, draws: 1 },
    // Each advancement counter is 4 credits and a card at the start of a turn
    corp: (_state, _code, { cost, card }) => {
      const keep = Math.max(0.3, 0.6 * (4 + card - CLICK - 1) - cost);
      return { keep, econ: keep };
    },
  },
  // Cohort Guidance Program
  '34108': {
    synergy: { gives: { econ: 0.5, draw: 0.5, advance: 0.5 }, wants: { discard: 0.5 } },
    value: { keep: 2, econ: 1.5, draws: 0.5 },
    // A card swapped for 2 credits and a fresh draw each turn
    corp: (state, _code, { cost }) => {
      const keep = Math.max(0.3, perTurn(state, 0.7 * 2, 'corp') - cost);
      return { keep, econ: keep };
    },
  },
  // Boto
  '34109': { synergy: { gives: { ice: 1, damage: 1 }, when: ['threat'] } },
  // Cloud Eater
  '34110': { synergy: { gives: { ice: 1, tags: 1, damage: 1 } } },
  // Tributary
  '34111': { synergy: { gives: { ice: 1.5, draw: 0.5 } } },
  // Bring Them Home
  '34112': { synergy: { gives: { denial: 1 }, when: ['threat'] } },
  // Kingmaking
  '34113': { synergy: { gives: { draw: 1 }, when: ['onScore'] } },
  // Stoke the Embers
  '34114': { synergy: { gives: { econ: 1, advance: 1 }, when: ['onScore'] } },
  // Janaína "JK" Dumont Kindelán
  '34115': {
    synergy: { gives: { econ: 1.5, install: 0.5 } },
    value: { keep: 3, econ: 2.5 },
    // 3 credits a turn, taken with a click and a free install
    corp: (state, code, { cost }) => {
      const keep = Math.max(0.3, perTurn(state, 3 * counterWorthOf(state, code, 'credit'), 'corp', 0, 3) - cost);
      return { keep, econ: keep };
    },
    counters: { credit: (_state, card) => paidOneATurn(counters(card, 'credit')) }, // Taken all at once
  },
  // Capacitor
  '34116': { synergy: { gives: { ice: 1, econ: 0.5 }, wants: { tags: 1 }, when: ['ifTagged'] } },
  // Piranhas
  '34117': { synergy: { gives: { ice: 1, damage: 0.5, draw: 0.5 }, wants: { tags: 0.5 } } },
  // Seraph
  '34118': { synergy: { gives: { ice: 1, damage: 1, tags: 1, denial: 1 } } },
  // Sudden Commandment
  '34119': { synergy: { gives: { draw: 1, operations: 1 }, when: ['threat'] } },
  // The Holo Man
  '34120': {
    synergy: { gives: { advance: 1.5 } },
    value: { keep: 2, upgrade: [3, 1] },
    // 2 advancement counters for a click and 4 credits; moves each turn
    corp: (_state, _code, { cost }) => {
      const remote = Math.max(0.3, 2 * (CLICK + 1) - 4 + 2 - cost);
      return { keep: remote, upgrade: [remote, 0.5] };
    },
  },
  // Nuvem SA: Law of the Land
  '34121': { synergy: { gives: { econ: 1 }, wants: { operations: 1 } } },
  // Eminent Domain
  '34122': { synergy: { gives: { install: 1 }, when: ['onScore'] } },
  // The Basalt Spire (agenda)
  '34123': {
    synergy: { wants: { discard: 1 }, when: ['onScore'] },
    counters: { agenda: state => 0.6 * cardRate(state, 'corp') + 0.5 }, // A card back from Archives
  },
  // Hearts and Minds
  '34124': {
    synergy: { gives: { advance: 1 } },
    value: { keep: 1.5 },
    // Advancement counters moved each turn, one more if unprotected
    corp: (state, code, { cost }) => {
      const bare = Object.values(state.corp.servers).some(s => s.root.some(c => c.cardCode === code) && s.ice.length === 0) ? 0.5 : 0.1;
      return { keep: Math.max(0.3, perTurn(state, 0.3 + bare * RATES.advancement, 'corp') - cost) };
    },
  },
  // Descent
  '34125': { synergy: { gives: { ice: 1, draw: 0.5 } } },
  // Hammer
  '34126': { synergy: { gives: { ice: 1, tags: 0.5 } } },
  // Logjam
  '34127': { synergy: { gives: { ice: 1, econ: 0.5 }, wants: { advance: 1, discard: 0.5 } } },
  // Business As Usual
  '34128': { synergy: { gives: { advance: 1 }, when: ['threat'] } },
  // Isaac Liberdade
  '34129': {
    synergy: { gives: { ice: 0.5 }, wants: { advance: 1 } },
    value: { keep: 1.5, upgrade: [1.5, 1.5] },
    // +2 strength on advanced ice here
    corp: (state, _code, { cost }) => {
      const advanced = Math.min(1, 4 * deckShare(state, 'corp', /advance/i));
      const value = Math.max(0.3, 1 + 2 * advanced - cost);
      return { keep: value, upgrade: [value, value] };
    },
  },
  // The Powers That Be
  '34130': {
    synergy: { gives: { install: 1 }, when: ['onScore'] },
    value: { keep: 2 },
    // A free install on each agenda scored
    corp: (state, _code, { cost }) => ({ keep: Math.max(0.3, perTurn(state, 0.17 * (CLICK + 2), 'corp') - cost) }),
  },
};
