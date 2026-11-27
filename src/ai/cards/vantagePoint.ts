import { CardInstance, cardDef, getCardScript } from '../../core';
import { stealthCredits, turnFlag } from '../../core/engine/cardEffects';
import { cardRate, CLICK, RATES } from '../valueModel';
import { abilityUsedKey } from '../../core/engine/actions/ability';
import { accessWorth, centralSuccess, counterWorthOf, damageWorth, deckCount, deckShare, lock, muWorth, PACE, perTurn, priceIce, pricingIce, runSuccess } from '../effectValues';
import type { RunOptions } from '../runs';
import { serverValue, spendCost, tagCost } from '../runs';
import { keepValue, tagTaken } from '../evaluate';
import { bakerWantsFuel } from '../cardPlans';
import { tuning } from '../synergy';
import { badPublicityWorth } from '../prompts';
import type { GameState } from '../../core';
import { CardAI } from './types';
import { cardsPick, promptCards } from './answers';

/** Virtual Intelligence, P.I.: "Once per turn → [click], 1[credit]: Draw 1 card and remove 1 tag." */
const VIC = '36009';

/**
 * What the AI knows about each Vantage Point card's worth, one entry per card
 * (see ./types.ts). Adding a set: a file like this one, joined in ./index.ts.
 */

export const VANTAGE_POINT: Record<string, CardAI> = {
  // Chain Reaction
  // Chain Reaction: needs a successful Archives run. "Play only if you made a successful run on HQ, R&D, and Archives this turn."
  '36001': {
    synergy: { gives: { trash: 2 }, wants: { runs: 2, hq: 1, rd: 1, archives: 1 }, when: ['successfulRun'] },
    archivesPayoff: true,
    runFacts: { playsAfterSuccessfulRuns: ['hq', 'rd', 'archives'] },
  },
  // Take a Dive
  '36002': {
    synergy: { gives: { runs: 1, hq: 0.5, rd: 0.5 } },
    // A bad publicity on success, if a subroutine resolved (about half the time)
    run: (state?: GameState): RunOptions => {
      return { successBonus: 0.5 * (state ? badPublicityWorth(state) : 2) };
    },
  },
  // The Tungsten Tailor
  '36003': {
    synergy: { gives: { econ: 0.5 }, wants: { breakers: 1 } },
    value: { rig: 2 },
    // -1 strength on every ice, about half a credit of boosting saved a run
    runner: state => perTurn(state, PACE.runs * 0.5, 'runner'),
  },
  // Corsair
  // "1 credit: The barrier you are encountering gets -3 strength ... Spend credits only from stealth cards to use this ability."
  '36004': { synergy: { gives: { breakers: 1 } }, runFacts: { breaker: { lowerPerStealthCredit: { strength: 3 } } } },
  // Lampades
  '36005': {
    synergy: { gives: { trash: 1.5 }, wants: { runs: 1 } },
    value: { rig: 1.5 }, // Three paid trashes, with stealth credits
    // 3 counters, each a paid trash of an accessed card (stealth credits only)
    runner: (state, code) => 3 * counterWorthOf(state, code, 'power'),
    counters: { power: state => (stealthCredits(state) > 0 ? 2 : 0.5) }, // A paid trash of an accessed card, with stealth credits only
  },
  // Hackerspace
  '36006': {
    synergy: { gives: { install: 1 } },
    value: { rig: 1.5 },
    // Companions and connections a credit cheaper, +2 hand size with one of each
    runner: state => {
      const hosts = deckCount(state, 'runner', c => cardDef(c).type_code === 'resource' && !!cardDef(c).uniqueness && /companion|connection/i.test(cardDef(c).keywords ?? ''));
      return Math.min(3, hosts) * 0.8 + (hosts >= 2 ? 0.6 * cardRate(state, 'runner', 'now') : 0);
    },
  },
  // Nurse Hạnh
  '36007': {
    archivesPayoff: true, // Nurse Hạnh: draws when Archives cards turn faceup
    synergy: { gives: { draw: 1 }, wants: { archives: 1.5 } },
    value: { rig: 1 },
    // 2 cards when an Archives breach turns 2 or more cards faceup
    runner: state => {
      const facedown = state.corp.archives.faceDown.length >= 2 ? 1 : 0.4;
      return perTurn(state, PACE.runs * PACE.archivesShare * runSuccess(state, 'archives') * facedown * 2 * cardRate(state, 'runner', 'later'), 'runner');
    },
  },
  // Stick and Poke
  '36008': {
    synergy: { gives: { draw: 1 } },
    value: { rig: 0.5 },
    // A card drawn for a net damage on the first encounter each turn: a filter at best
    runner: state => perTurn(state, 0.1, 'runner'),
  },
  // Vic
  '36009': {
    synergy: { gives: { draw: 1 }, wants: { tags: 0.5 } },
    // Tags on Vic (Jeff, 2026-10-30; plan.vicTags): her ability clears a tag for a click and a credit less the card it
    // draws (RATES.drawnCard: the loop guard, V-B B5). The first tag costs that while she can use it this turn (the
    // Runner's turn, ability unused, a click and a credit left), else it sits through a Corp turn first; the second waits
    // a turn for her (two if the first waits too) or is cleared the usual way; the rest cost as usual.
    tagClear: (state, tags, turnLoss) => {
      const clear = CLICK + 2;
      const vic = Math.max(0.5, CLICK + 1 - RATES.drawnCard);
      const runner = state.runner;
      const ability = abilityUsedKey(runner.identity.instanceId, 0);
      const now = state.activePlayer === 'runner' && turnFlag(state, ability) === 0 && runner.clicks >= 1 && runner.credits >= 1;
      const later = Math.min(clear, vic + turnLoss);
      const second = now ? later : Math.min(clear, vic + 2 * turnLoss);
      return (now ? vic : later) + (tags >= 2 ? second : 0) + Math.max(0, tags - 2) * clear;
    },
  },
  // Kompromat
  '36010': {
    synergy: { gives: { runs: 1 } },
    // A bad publicity (or a derezzed ice) on success
    run: (state?: GameState): RunOptions => {
      return { successBonus: state ? badPublicityWorth(state) : 2 };
    },
  },
  // Sell Out
  '36011': { synergy: { gives: { econ: 1.5, draw: 1 } } },
  // Tailgate
  '36012': {
    synergy: { gives: { runs: 1, hq: 2 } },
    // 2 more HQ accesses
    run: (): RunOptions => {
      return { extraAccesses: 2 };
    },
  },
  // Borrowed Goods
  '36013': {
    synergy: { wants: { tags: 0.5 } },
    value: { rig: 1 }, // +1 MU for a tag
    // +1 MU for a tag when untagged (inside the tag clock the owner serves the flat rate, so the loop is cut there)
    runner: state => muWorth(state) - (state.runner.tags > 0 ? 0 : tagTaken(state)),
  },
  // Rotary
  '36014': {
    // The board score doesn't see the extra access the tag buys, so weigh it here: take the tag when one more random
    // access is worth more than what the tag costs (cheap for Vic; prompts.ts before B3 commit 1)
    promptAnswer: ({ state, side, prompt }) => (side === 'runner' && prompt.kind === 'effect_choice' && prompt.source.step === 'breach' ? { kind: 'effect_choice', optionId: accessWorth(state) > tagCost(state) ? 'tag' : 'no' } : undefined),
    synergy: { gives: { hq: 1, rd: 1 }, wants: { runs: 1 }, when: ['ifTagged'] },
    value: { rig: 2.5 },
    // +1 MU; a tag for one more access on HQ and R&D breaches, now and then (most breaches for Vic, who clears a tag a turn cheaply)
    runner: state => {
      const takes = state.runner.identity.cardCode === VIC ? 0.8 : 0.3;
      return muWorth(state) + perTurn(state, PACE.runs * centralSuccess(state) * takes * accessWorth(state), 'runner');
    },
  },
  // Baker
  '36015': {
    // Turn the run on Archives to whichever of HQ and R&D is worth more, if either beats Archives by the credit (prompts.ts
    // before B3 commit 1)
    promptAnswer: ({ state, side, prompt, memory, synergy }) => {
      if (side !== 'runner' || prompt.kind !== 'effect_choice' || prompt.source.step !== 'redirect') return undefined;
      const value = (id: string) => serverValue(state, id, 0, memory, synergy && tuning.wary) - (id === 'archives' ? 0 : spendCost(state, 1));
      const best = ['hq', 'rd'].sort((a, b) => value(b) - value(a))[0];
      return { kind: 'effect_choice', optionId: value(best) > value('archives') ? best : 'no' };
    },
    archivesPayoff: true, // Baker: run Archives, pay 1 to approach HQ or R&D instead
    synergy: { gives: { runs: 1.5, hq: 1, rd: 1, archives: 0.5 } },
    value: { rig: 2 },
    // Once a turn, an HQ or R&D breach past Archives' ice instead of theirs, for a stealth credit
    runner: state => {
      const stealth = deckCount(state, 'runner', c => /stealth/i.test(cardDef(c).keywords ?? '')) > 0;
      // Pricing the ice can price the rig (a subroutine that trashes a card), which comes back here: count each rezzed ice as 2 then
      const ice = (id: string) => (state.corp.servers[id]?.ice ?? []).reduce((n, c) => n + (!c.isRezzed ? 1 : pricingIce() ? 2 : Math.min(4, priceIce(state, c))), 0);
      const saved = Math.max(0, Math.min(4, Math.max(ice('hq'), ice('rd'))) - ice('archives'));
      return perTurn(state, (stealth ? 0.5 : 0.1) * (saved + accessWorth(state)), 'runner');
    },
    // Baker
    run: (): RunOptions => {
      return { baker: true };
    },
  },
  // Underdome Irregulars
  '36016': {
    synergy: { gives: { draw: 1 } },
    value: { rig: 1.5, draws: 1 },
    // 2 cards each turn the Corp rezzes ice, trashed the first turn it doesn't
    runner: state => {
      const p = PACE.rezzes;
      return (2 * cardRate(state, 'runner', 'later') * p) / (1 - p);
    },
  },
  // Hiram
  '36017': { synergy: { gives: { rd: 0.5 }, wants: { install: 1 } } },
  // Aircheck
  '36018': {
    synergy: { gives: { runs: 1, hq: 0.5, rd: 0.5, econ: 0.5 } },
    // 4 credits of its own, the pool locked
    run: (): RunOptions => {
      return { bonusCredits: 4, poolLocked: true };
    },
  },
  // Beta Build
  '36019': { synergy: { gives: { runs: 1, install: 1.5 } } },
  // Methuselah
  '36020': {
    // Sourdough Starter: feed it only dead hardware: a copy of one installed (or a second console), or one it can't afford
    // (prompts.ts before B3 commit 1)
    promptAnswer: ({ state, side, prompt }) => {
      if (side !== 'runner' || prompt.kind !== 'effect_cards' || prompt.source.step !== 'trash') return undefined;
      const cards = promptCards(state, prompt.candidateIds);
      const weakest = (list: CardInstance[]) => [...list].sort((a, b) => keepValue(state, a) - keepValue(state, b))[0];
      const rig = state.runner.rig.hardware;
      const dead = cards.filter(c => {
        const def = cardDef(c);
        const console = /console/i.test(def.keywords ?? '');
        return rig.some(h => cardDef(h).title === def.title || (console && /console/i.test(cardDef(h).keywords ?? ''))) || (def.cost ?? 0) > state.runner.credits;
      });
      if (dead.length) return cardsPick(weakest(dead));
      // With Baker out and no stealth credit for it, the weakest hardware is worth turning into its fuel
      // (2 stealth credits, the first a Baker run worth about 2.5: cardPlans.ts)
      const spare = weakest(cards);
      return cardsPick(bakerWantsFuel(state) && spare && keepValue(state, spare) < 2 * 0.9 + 1.6 ? spare : undefined);
    },
    synergy: { gives: { econ: 1.5 }, wants: { runs: 1 } },
    value: { rig: 2.5 },
    // +1 MU; a dead hardware in the grip (a copy of one installed, or one it can't afford) turns into 2 run credits now and then
    runner: (state, code) => {
      const hardware = [...state.runner.grip, ...state.runner.stack].filter(c => cardDef(c).type_code === 'hardware');
      const titles = new Set(hardware.map(c => cardDef(c).title));
      const spare = (hardware.length - titles.size) / Math.max(1, state.runner.grip.length + state.runner.stack.length);
      return muWorth(state) + perTurn(state, Math.min(1, 3 * spare) * 2 * counterWorthOf(state, code, 'credit'), 'runner');
    },
    counters: { credit: () => 0.9 }, // Run credits only (Baker's fuel: cardPlans.ts)
  },
  // Touchstone
  '36021': {
    synergy: { gives: { econ: 1 }, wants: { runs: 0.5 } },
    value: { rig: 1.5 },
    // A run credit the first time each turn it plays an event
    runner: (state, code) => perTurn(state, Math.min(1, 3 * deckShare(state, 'runner', null, 'event')) * counterWorthOf(state, code, 'credit'), 'runner'),
    counters: { credit: () => 0.9 }, // Run credits only (Baker's fuel: cardPlans.ts)
  },
  // Read-Write Share
  '36022': {
    // Sourdough Starter (Jeff, 2026-10-30, plan.sourdough). Jeff: park the weakest card in the grip, or one it can't afford
    // soon (more than about two turns of credit clicks away), for a fresh draw (prompts.ts before B3 commit 1)
    promptAnswer: ({ state, side, prompt }) => {
      if (side !== 'runner' || prompt.kind !== 'effect_cards' || prompt.source.step !== 'host') return undefined;
      const cards = promptCards(state, prompt.candidateIds);
      const farOff = (c: CardInstance) => (cardDef(c).cost ?? 0) > state.runner.credits + 4;
      return cardsPick([...cards].sort((a, b) => keepValue(state, a) * (farOff(a) ? 0.5 : 1) - keepValue(state, b) * (farOff(b) ? 0.5 : 1))[0]);
    },
    synergy: { gives: { draw: 1 } },
    value: { rig: 1, draws: 1 },
    // A card in the grip parked for a fresh draw each turn, 4 at most
    runner: state => perTurn(state, 0.3 * cardRate(state, 'runner', 'later'), 'runner', 0, 4),
  },
  // Sipa
  '36023': {
    synergy: { wants: { runs: 1, breakers: 1 } },
    value: { rig: 1 },
    // A swap of fully broken outer ice, now and then
    runner: state => perTurn(state, 0.2, 'runner'),
  },
  // Stowaway
  '36024': {
    synergy: { gives: { econ: 1 }, wants: { runs: 1.5 }, when: ['successfulRun'] },
    value: { rig: 1.5 },
    // 2 credits on each successful run on its host's server
    runner: (state, _code, card) => {
      const server = card?.hostedOnId ? Object.values(state.corp.servers).find(s => s.ice.some(i => i.instanceId === card.hostedOnId)) : undefined;
      const share = !server ? 0.25 : server.id === 'hq' ? PACE.hqShare : server.id === 'rd' ? PACE.rdShare : server.id === 'archives' ? PACE.archivesShare : PACE.remoteShare;
      return perTurn(state, PACE.runs * share * runSuccess(state, server?.id ?? 'hq') * 2, 'runner', 0, Infinity, 1, lock());
    },
  },
  // Word on the Street
  '36025': {
    synergy: { gives: { econ: 1, draw: 0.5 }, when: ['notInstalledThisTurn'] },
    value: { rig: 2 },
    // A tax on fast advances, then 4 credits and a card when the Corp scores a card it installed earlier
    runner: state => 0.6 * (4 + cardRate(state, 'runner', 'later')) + 0.5,
  },
  // Méliès City Luxury Line
  '36026': { synergy: { when: ['onScore'] } },
  // Synchrocyclotron
  '36027': {
    synergy: { wants: { operations: 1.5 } },
    value: { keep: 1.5 }, // A click back on the first double each turn
    // A click back on the first double each turn, as often as the deck holds doubles
    corp: (state, _code, { cost, risk }) => ({ keep: Math.max(0.3, perTurn(state, Math.min(1, 4 * deckShare(state, 'corp', /double/i)) * CLICK, risk) - cost) }),
  },
  // Ansel 2.0
  '36028': { synergy: { gives: { ice: 1, bioroid: 1.5, install: 0.5 } } },
  // Reverb
  '36029': { synergy: { gives: { ice: 1.5 } } },
  // Sleipnir
  '36030': { synergy: { gives: { ice: 1, bioroid: 0.5, draw: 0.5 } } },
  // Vertigo
  '36031': { synergy: { gives: { ice: 1, bioroid: 0.5 } } },
  // Caveat Emptor
  '36032': { synergy: { gives: { econ: 2 } } },
  // realloc()
  '36033': { synergy: { gives: { econ: 1.5 }, wants: { ice: 1 } } },
  // Retirement Plan
  '36034': { synergy: { gives: { install: 1, ice: 0.5 }, wants: { discard: 1 } } },
  // Perfect Recall
  '36035': {
    synergy: { gives: { denial: 0.5 }, when: ['onScore'] },
    value: { keep: 2, upgrade: [2, 1] }, // Power counters that protect a card for a run
    // A counter when rezzed and on each score here; each keeps the Runner off one card for a run
    corp: (state, code, { cost }) => {
      const counter = counterWorthOf(state, code, 'power');
      const remote = counter + perTurn(state, 0.5 * PACE.agendaEvents * counter, 'corp') - cost;
      return { keep: remote, upgrade: [remote, counter - cost] };
    },
    counters: { power: () => 1.5 }, // Keeps the Runner off copies of one card for a run
  },
  // Méliès U
  '36036': { synergy: { gives: { econ: 1, draw: 0.5 }, wants: { discard: 0.5 }, when: ['successfulRun'] } },
  // Lotus Haze
  '36037': {
    synergy: { when: ['onScore'] },
    counters: { agenda: () => 1 }, // Moves a rezzed upgrade to another server
  },
  // Esca
  '36038': {
    // plan.corpTurnDamageOwn: on access only
    corpTurnDamage: 0,
    synergy: { gives: { denial: 0.5, damage: 0.5 }, when: ['ifTagged'] },
    value: { keep: 1 }, // A credit and a net damage on a tagged Runner, on access
    // On access (about half the time), 1 credit off the Runner and 1 net damage if tagged
    corp: state => ({ keep: 0.5 * (1 + (state.runner.tags > 0 ? damageWorth(state, 1) : 0.2 * damageWorth(state, 1))) }),
  },
  // ezaM
  '36039': { synergy: { gives: { ice: 1 } } },
  // Knowledge Seeker
  '36040': { synergy: { gives: { ice: 1 } } },
  // Lionsmane
  '36041': { synergy: { gives: { ice: 1, damage: 2 } } },
  // Vicsek
  '36042': { synergy: { gives: { ice: 1, damage: 1, tags: 1 }, wants: { tags: 1 }, when: ['ifTagged'] } },
  // Cultivate
  '36043': { synergy: { gives: { draw: 1, discard: 0.5 } } },
  // Unleash
  '36044': { synergy: { wants: { tags: 1.5, ice: 1 }, when: ['ifTagged'] } },
  // The Red Room
  '36045': {
    synergy: { when: ['onScore'] },
    value: { keep: 2, upgrade: [0, 2] }, // Central only, ends runs elsewhere after agendas
    // Central only; a counter on the first agenda each turn, each ending a run elsewhere
    corp: (state, code, { cost }) => {
      const value = perTurn(state, PACE.agendaEvents * counterWorthOf(state, code, 'power'), 'corp');
      return { keep: value - cost, upgrade: [-cost, value - cost] };
    },
    counters: { power: () => 2 }, // Ends a run on another server
  },
  // Editorial Division
  '36046': { synergy: { gives: { draw: 0.5 } } },
  // Witch Hunt
  '36047': { synergy: { gives: { tags: 2 }, when: ['onScore'] } },
  // Magistrate Revontulet
  '36048': {
    synergy: { gives: { denial: 1.5 }, when: ['onScore'] },
    value: { keep: 3 }, // 3 more to steal, and 3 off the Runner on each score
    // 3 credits more for each steal, 3 off the Runner on each score
    corp: (state, _code, { cost, risk }) => ({ keep: Math.max(0.3, perTurn(state, PACE.agendaEvents * 3, risk) - cost) }),
  },
  // Nihilo Agent
  '36049': {
    synergy: { gives: { tags: 1.5 } },
    value: { keep: 2 }, // A tag each turn for 3 turns
    // A tag at the end of each Corp turn for 3 turns, and a bad publicity the Runner spends meanwhile
    corp: (state, _code, { cost, tag, risk }) => ({ keep: Math.max(0.3, perTurn(state, tag - PACE.runs * 0.5, risk, 0, 3) - cost) }),
  },
  // Grubber
  '36050': { synergy: { gives: { ice: 1, denial: 1 } }, rezEffect: true },
  // Lethe
  '36051': { synergy: { gives: { ice: 1, tags: 1, discard: 0.5 } } },
  // Paywall
  // "When the Runner encounters this ice, they lose 1 [credit]" (6.9.3a)
  // holdFacts Corp-only (the walk): the Runner's price reads no encounter toll but Funhouse's (A-log L3, a B5 item)
  '36052': { synergy: { gives: { ice: 1, denial: 1 } }, holdFacts: { encounter: { loses: 1 } } },
  // Flood the Market
  // "Place 1 advancement counter on that card for each remote server that has a card in its root and is protected by ice."
  '36053': {
    synergy: { gives: { advance: 2 } },
    placesCounters: state => Object.values(state.corp.servers).filter(s => s.isRemote && s.root.length > 0 && s.ice.length > 0).length,
  },
  // Scapegoat
  '36054': { synergy: {} },
  // Hype Machine
  '36055': {
    synergy: { gives: { advance: 1 }, when: ['onScore'] },
    value: { keep: 1.5, upgrade: [1.5, 0] }, // A free advancement counter after an agenda
    // Free to rez after an agenda; trash for an advancement counter in this root
    corp: () => {
      const counter = CLICK + 1;
      return { keep: 0.6 * counter, upgrade: [0.8 * counter, 0] };
    },
  },
  // Sacrifice Zone Expansion
  '36056': { corpTurnDamage: 0 /* plan.corpTurnDamageOwn: on the Runner's successful runs only */, synergy: { gives: { econ: 1, damage: 0.5 }, wants: { advance: 1 }, when: ['successfulRun'] } },
  // Luana Campos
  '36057': {
    synergy: { gives: { econ: 1.5, draw: 1 } },
    value: { keep: 3, econ: 2 }, // 3 credits and a card for each bad publicity it hosts
    // Each bad publicity hosted is 3 credits and a card, taken back if it is trashed
    corp: (state, _code, { cost, card, risk }) => {
      const hosts = Math.max(state.corp.badPublicity ?? 0, deckShare(state, 'corp', /liability/i) > 0.1 ? 2 : 0.5);
      const keep = perTurn(state, 3 + card, risk, 0, Math.max(1, hosts)) - cost;
      return { keep, econ: keep };
    },
  },
  // Event Horizon
  '36058': { synergy: { gives: { ice: 1 } } },
  // Flywheel
  '36059': { synergy: { gives: { ice: 1, econ: 1, draw: 1 } } },
  // Tocsin
  '36060': { synergy: { gives: { ice: 1.5, denial: 0.5 } } },
  // Myōshu
  '36061': { synergy: { when: ['notInstalledThisTurn'] } },
  // Reanimation Protocol
  '36062': { synergy: { gives: { ice: 1.5 }, wants: { discard: 1 } } },
  // Vulture Fund
  '36063': { synergy: { gives: { econ: 2 } } },
  // Flagship
  '36064': {
    synergy: { gives: { denial: 0.5 } },
    value: { keep: 2, upgrade: [0, 2] }, // HQ or R&D only, 1 access and no successful runs there
    // On HQ or R&D, one access a run and no successful-run payoffs
    corp: (state, _code, { cost }) => {
      const central = perTurn(state, PACE.runs * (PACE.hqShare + PACE.rdShare) * 0.5 * (accessWorth(state) + 0.5), 'corp') - cost;
      return { keep: Math.max(0.3, central), upgrade: [0, Math.max(0.3, central)] };
    },
  },
  // Shackleton Grid
  '36065': {
    // plan.corpTurnDamageOwn: during a run against its server only
    corpTurnDamage: 0,
    synergy: { gives: { damage: 1.5 } },
    value: { keep: 1.5, upgrade: [1.5, 1] }, // 4 meat damage when the Runner spends hosted credits
    // 4 meat damage when the Runner spends credits from outside its pool here
    corp: (state, _code, { cost }) => {
      const hosted = state.runner.rig.hardware.concat(state.runner.rig.programs, state.runner.rig.resources).some(c => (c.tokens.credit ?? 0) > 0 || !!getCardScript(c.cardCode)?.paysDuringRuns);
      const value = perTurn(state, PACE.runs * PACE.remoteShare * (hosted ? 0.3 : 0.05) * damageWorth(state, 4), 'corp');
      return { keep: value - cost, upgrade: [value - cost, 0.6 * value - cost] };
    },
  },
  // Let Them Dream
  '36066': { synergy: { gives: { draw: 0.5 }, when: ['onScore'] } },
};
