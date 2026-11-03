import { cardDef, getCardScript } from '../../core';
import { stealthCredits } from '../../core/engine/cardEffects';
import { tuning } from '../synergy';
import { cardRate, CLICK, RATES } from '../valueModel';
import { VIC } from '../evaluate';
import { accessWorth, centralSuccess, counterWorthOf, damageWorth, deckCount, deckShare, lock, muWorth, PACE, perTurn, priceIce, pricingIce, runSuccess } from '../effectValues';
import { CardAI } from './types';

/**
 * What the AI knows about each Vantage Point card's worth, one entry per card
 * (see ./types.ts). Adding a set: a file like this one, joined in ./index.ts.
 */

export const VANTAGE_POINT: Record<string, CardAI> = {
  // The Tungsten Tailor
  '36003': {
    value: { rig: 2 },
    // -1 strength on every ice, about half a credit of boosting saved a run
    runner: state => perTurn(state, PACE.runs * 0.5, 'runner'),
  },
  // Lampades
  '36005': {
    value: { rig: 1.5 }, // Three paid trashes, with stealth credits
    // 3 counters, each a paid trash of an accessed card (stealth credits only)
    runner: (state, code) => 3 * counterWorthOf(state, code, 'power'),
    counters: { power: state => (stealthCredits(state) > 0 ? 2 : 0.5) }, // A paid trash of an accessed card, with stealth credits only
  },
  // Hackerspace
  '36006': {
    value: { rig: 1.5 },
    // Companions and connections a credit cheaper, +2 hand size with one of each
    runner: state => {
      const hosts = deckCount(state, 'runner', c => cardDef(c).type_code === 'resource' && !!cardDef(c).uniqueness && /companion|connection/i.test(cardDef(c).keywords ?? ''));
      return Math.min(3, hosts) * 0.8 + (hosts >= 2 ? 0.6 * cardRate(state, 'runner') : 0);
    },
  },
  // Nurse Hạnh
  '36007': {
    value: { rig: 1 },
    // 2 cards when an Archives breach turns 2 or more cards faceup
    runner: state => {
      const facedown = state.corp.archives.faceDown.length >= 2 ? 1 : 0.4;
      return perTurn(state, PACE.runs * PACE.archivesShare * runSuccess(state, 'archives') * facedown * 2 * cardRate(state, 'runner'), 'runner');
    },
  },
  // Stick and Poke
  '36008': {
    value: { rig: 0.5 },
    // A card drawn for a net damage on the first encounter each turn: a filter at best
    runner: state => perTurn(state, 0.1, 'runner'),
  },
  // Borrowed Goods
  '36013': {
    value: { rig: 1 }, // +1 MU for a tag
    // +1 MU for a tag when untagged (the flat tag rate: the tag clock prices the rig, which would come back here)
    runner: state => muWorth(state) - (state.runner.tags > 0 ? 0 : RATES.tagAgainstRunner),
  },
  // Rotary
  '36014': {
    value: { rig: 2.5 },
    // +1 MU; a tag for one more access on HQ and R&D breaches, now and then (most breaches for Vic, who clears a tag a turn cheaply)
    runner: state => {
      const takes = tuning.plan.vicTags && state.runner.identity.cardCode === VIC ? 0.8 : 0.3;
      return muWorth(state) + perTurn(state, PACE.runs * centralSuccess(state) * takes * accessWorth(state), 'runner');
    },
  },
  // Baker
  '36015': {
    value: { rig: 2 },
    // Once a turn, an HQ or R&D breach past Archives' ice instead of theirs, for a stealth credit
    runner: state => {
      const stealth = deckCount(state, 'runner', c => /stealth/i.test(cardDef(c).keywords ?? '')) > 0;
      // Pricing the ice can price the rig (a subroutine that trashes a card), which comes back here: count each rezzed ice as 2 then
      const ice = (id: string) => (state.corp.servers[id]?.ice ?? []).reduce((n, c) => n + (!c.isRezzed ? 1 : pricingIce ? 2 : Math.min(4, priceIce(state, c))), 0);
      const saved = Math.max(0, Math.min(4, Math.max(ice('hq'), ice('rd'))) - ice('archives'));
      return perTurn(state, (stealth ? 0.5 : 0.1) * (saved + accessWorth(state)), 'runner');
    },
  },
  // Underdome Irregulars
  '36016': {
    value: { rig: 1.5, draws: 1 },
    // 2 cards each turn the Corp rezzes ice, trashed the first turn it doesn't
    runner: state => {
      const p = PACE.rezzes;
      return (2 * cardRate(state, 'runner') * p) / (1 - p);
    },
  },
  // Methuselah
  '36020': {
    value: { rig: 2.5 },
    // +1 MU; a dead hardware in the grip (a copy of one installed, or one it can't afford) turns into 2 run credits now and then
    runner: (state, code) => {
      if (tuning.plan.sourdough) {
        const hardware = [...state.runner.grip, ...state.runner.stack].filter(c => cardDef(c).type_code === 'hardware');
        const titles = new Set(hardware.map(c => cardDef(c).title));
        const spare = (hardware.length - titles.size) / Math.max(1, state.runner.grip.length + state.runner.stack.length);
        return muWorth(state) + perTurn(state, Math.min(1, 3 * spare) * 2 * counterWorthOf(state, code, 'credit'), 'runner');
      }
      return muWorth(state) + perTurn(state, Math.min(1, 3 * deckShare(state, 'runner', null, 'hardware')) * 0.5 * Math.max(0, 2 * counterWorthOf(state, code, 'credit') - cardRate(state, 'runner')), 'runner');
    },
    counters: { credit: () => 0.9 }, // Run credits only (Baker's fuel: cardPlans.ts)
  },
  // Touchstone
  '36021': {
    value: { rig: 1.5 },
    // A run credit the first time each turn it plays an event
    runner: (state, code) => perTurn(state, Math.min(1, 3 * deckShare(state, 'runner', null, 'event')) * counterWorthOf(state, code, 'credit'), 'runner'),
    counters: { credit: () => 0.9 }, // Run credits only (Baker's fuel: cardPlans.ts)
  },
  // Read-Write Share
  '36022': {
    value: { rig: 1, draws: 1 },
    // A card in the grip parked for a fresh draw each turn, 4 at most
    runner: state => perTurn(state, 0.3 * cardRate(state, 'runner'), 'runner', 0, 4),
  },
  // Sipa
  '36023': {
    value: { rig: 1 },
    // A swap of fully broken outer ice, now and then
    runner: state => perTurn(state, 0.2, 'runner'),
  },
  // Stowaway
  '36024': {
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
    value: { rig: 2 },
    // A tax on fast advances, then 4 credits and a card when the Corp scores a card it installed earlier
    runner: state => 0.6 * (4 + cardRate(state, 'runner')) + 0.5,
  },
  // Synchrocyclotron
  '36027': {
    value: { keep: 1.5 }, // A click back on the first double each turn
    // A click back on the first double each turn, as often as the deck holds doubles
    corp: (state, _code, { cost }) => ({ keep: Math.max(0.3, perTurn(state, Math.min(1, 4 * deckShare(state, 'corp', /double/i)) * CLICK, 'corp') - cost) }),
  },
  // Perfect Recall
  '36035': {
    value: { keep: 2, upgrade: [2, 1] }, // Power counters that protect a card for a run
    // A counter when rezzed and on each score here; each keeps the Runner off one card for a run
    corp: (state, code) => {
      const counter = counterWorthOf(state, code, 'power');
      const remote = counter + perTurn(state, 0.5 * PACE.agendaEvents * counter, 'corp');
      return { keep: remote, upgrade: [remote, counter] };
    },
    counters: { power: () => 1.5 }, // Keeps the Runner off copies of one card for a run
  },
  // Lotus Haze
  '36037': {
    counters: { agenda: () => 1 }, // Moves a rezzed upgrade to another server
  },
  // Esca
  '36038': {
    value: { keep: 1 }, // A credit and a net damage on a tagged Runner, on access
    // On access (about half the time), 1 credit off the Runner and 1 net damage if tagged
    corp: state => ({ keep: 0.5 * (1 + (state.runner.tags > 0 ? damageWorth(state, 1) : 0.2 * damageWorth(state, 1))) }),
  },
  // The Red Room
  '36045': {
    value: { keep: 2, upgrade: [0, 2] }, // Central only, ends runs elsewhere after agendas
    // Central only; a counter on the first agenda each turn, each ending a run elsewhere
    corp: (state, code) => {
      const value = perTurn(state, PACE.agendaEvents * counterWorthOf(state, code, 'power'), 'corp');
      return { keep: value, upgrade: [0, value] };
    },
    counters: { power: () => 2 }, // Ends a run on another server
  },
  // Magistrate Revontulet
  '36048': {
    value: { keep: 3 }, // 3 more to steal, and 3 off the Runner on each score
    // 3 credits more for each steal, 3 off the Runner on each score
    corp: (state, _code, { cost }) => ({ keep: Math.max(0.3, perTurn(state, PACE.agendaEvents * 3, 'corp') - cost) }),
  },
  // Nihilo Agent
  '36049': {
    value: { keep: 2 }, // A tag each turn for 3 turns
    // A tag at the end of each Corp turn for 3 turns, and a bad publicity the Runner spends meanwhile
    corp: (state, _code, { cost, tag }) => ({ keep: Math.max(0.3, perTurn(state, tag - PACE.runs * 0.5, 'corp', 0, 3) - cost) }),
  },
  // Hype Machine
  '36055': {
    value: { keep: 1.5, upgrade: [1.5, 0] }, // A free advancement counter after an agenda
    // Free to rez after an agenda; trash for an advancement counter in this root
    corp: () => {
      const counter = CLICK + 1;
      return { keep: 0.6 * counter, upgrade: [0.8 * counter, 0] };
    },
  },
  // Luana Campos
  '36057': {
    value: { keep: 3, econ: 2 }, // 3 credits and a card for each bad publicity it hosts
    // Each bad publicity hosted is 3 credits and a card, taken back if it is trashed
    corp: (state, _code, { cost, card }) => {
      const hosts = Math.max(state.corp.badPublicity ?? 0, deckShare(state, 'corp', /liability/i) > 0.1 ? 2 : 0.5);
      const keep = perTurn(state, 3 + card, 'corp', 0, Math.max(1, hosts)) - cost;
      return { keep, econ: keep };
    },
  },
  // Flagship
  '36064': {
    value: { keep: 2, upgrade: [0, 2] }, // HQ or R&D only, 1 access and no successful runs there
    // On HQ or R&D, one access a run and no successful-run payoffs
    corp: (state, _code, { cost }) => {
      const central = perTurn(state, PACE.runs * (PACE.hqShare + PACE.rdShare) * 0.5 * (accessWorth(state) + 0.5), 'corp') - cost;
      return { keep: Math.max(0.3, central), upgrade: [0, Math.max(0.3, central)] };
    },
  },
  // Shackleton Grid
  '36065': {
    value: { keep: 1.5, upgrade: [1.5, 1] }, // 4 meat damage when the Runner spends hosted credits
    // 4 meat damage when the Runner spends credits from outside its pool here
    corp: state => {
      const hosted = state.runner.rig.hardware.concat(state.runner.rig.programs, state.runner.rig.resources).some(c => (c.tokens.credit ?? 0) > 0 || !!getCardScript(c.cardCode)?.paysDuringRuns);
      const value = perTurn(state, PACE.runs * PACE.remoteShare * (hosted ? 0.3 : 0.05) * damageWorth(state, 4), 'corp');
      return { keep: value, upgrade: [value, 0.6 * value] };
    },
  },
};
