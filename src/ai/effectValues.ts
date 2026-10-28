import { CardInstance, GameState, cardDef, getCardDefinition } from '../core';
import { counters } from '../core/engine/cardEffects';
import { PAYOUT_RISK, turnsLeft } from './cardProfiles';
import { COUNTER_WORTH, counterWorth } from './counterValues';
import { tuning } from './synergy';
import { CLICK, RATES, sideCards } from './valueModel';

/**
 * The every-card audit's last 31 cards (Jeff, 2026-10-28): assets, upgrades
 * and Runner rig cards whose worth was a hand-set number, now worked out in
 * the model's units (credits) from what each card does: credits, cards and
 * clicks it gains or saves, tags and damage it deals, accesses it adds,
 * spread over the turns left. Guesses about how often something happens
 * (runs on HQ a turn, agendas scored or stolen a turn) are named constants
 * from self-play logs. tests/effectValues.test.ts works each card through.
 * Behind plan.effectValues; the hand-set numbers in cardValues.ts stay for
 * when it is off.
 */

/** How often things happen, per Runner turn, in self-play (behaviour logs, 2026-10-28). */
export const PACE = {
  /** Runs a turn, and the share of them on HQ, R&D and a remote. */
  runs: 0.9,
  hqShare: 0.3,
  rdShare: 0.35,
  remoteShare: 0.35,
  /** Share of runs on R&D while Conduit is installed. */
  conduitRdShare: 0.6,
  /** Share of runs that succeed. */
  success: 0.6,
  /** Turns the Runner steals or trashes a Corp card, and trashes something it pays for. */
  stealOrTrash: 0.35,
  paidTrashes: 0.3,
  /** Agendas scored or stolen a turn, both sides together. */
  agendaEvents: 0.5,
  /** Ice rezzed a turn. */
  rezzes: 0.7,
  /** Turns the Runner installs a program, and has ice in hand (Corp). */
  programInstalls: 0.3,
  iceInHand: 0.6,
  /** Times the Runner clicks to draw on a turn it draws at all. */
  drawTurns: 0.7,
};

/** A memory unit: room for one more program. */
export const MU = 1.5;

/** Worth of `x` each turn for the turns left, less the risk of losing the card each turn. */
function perTurn(state: GameState, x: number, owner: 'corp' | 'runner', minTurns = 0, maxTurns = Infinity): number {
  const risk = owner === 'corp' ? PAYOUT_RISK.corpBare : state.runner.tags > 0 ? PAYOUT_RISK.runnerTagged : PAYOUT_RISK.runnerUntagged;
  const turns = Math.min(maxTurns, Math.max(minTurns, turnsLeft(state)));
  let value = 0;
  for (let t = 1; t <= turns; t++) value += x * (1 - risk) ** t;
  return value;
}

/** Chance a Corp card the Runner hasn't seen is an agenda, and the points of a typical agenda (decklist). */
export function agendaOdds(state: GameState): { odds: number; points: number } {
  const corp = sideCards(state, 'corp');
  const agendas = corp.filter(c => cardDef(c).type_code === 'agenda');
  const unseen = corp.length - state.corp.scoreArea.length - state.runner.scoreArea.length - state.corp.archives.faceUp.length;
  const left = agendas.length - state.corp.scoreArea.length - state.runner.scoreArea.filter(c => cardDef(c).side_code === 'corp').length;
  const points = agendas.length ? agendas.reduce((n, c) => n + (cardDef(c).agenda_points ?? 0), 0) / agendas.length : 2;
  return { odds: unseen > 0 ? Math.max(0, left) / unseen : 0, points };
}

/** Worth to the Runner of one more random access to an unseen Corp card. */
export function accessWorth(state: GameState): number {
  const { odds, points } = agendaOdds(state);
  return odds * points * RATES.point;
}

/** Worth of n net or meat damage to the Runner: the cards lost, or the game if it flatlines. */
export function damageWorth(state: GameState, n: number): number {
  if (n > state.runner.grip.length) return FLATLINE;
  return n * RATES.drawnCard;
}

/** A flatline ends the game: priced like half of a whole game of agenda points. */
export const FLATLINE = 4 * RATES.point;

/** Average net credits of a transaction operation in the Corp's deck (Plutus replays them). */
function transactionGain(state: GameState): number {
  const ops = state.corp.archives.faceUp.concat(state.corp.archives.faceDown).filter(c => /transaction/i.test(cardDef(c).keywords ?? ''));
  const gains = ops.map(c => {
    const gain = (cardDef(c).stripped_text ?? '').match(/Gain (\d+) credits/i);
    return gain ? Number(gain[1]) - (cardDef(c).cost ?? 0) : 0;
  });
  return gains.length ? gains.reduce((a, b) => a + b, 0) / gains.length : 0;
}

export interface CorpEffect {
  /** Worth to the Corp once installed (and the Runner's gain from trashing it). */
  keep: number;
  /** Worth of installing it in its own remote for money or cards (econ assets only). */
  econ?: number;
  /** Upgrades: [in a scoring remote, on HQ or R&D]. */
  upgrade?: [number, number];
}

/** Corp assets and upgrades, in credits. */
export function corpEffect(state: GameState, code: string): CorpEffect | undefined {
  const cost = getCardDefinition(code).cost ?? 0;
  const agenda = agendaOdds(state).points * RATES.point;
  switch (code) {
    case '35050': { // Byte!: pay 4 on access for 1 tag and 3 net damage; accessed about half the time
      const fire = RATES.tagAgainstRunner + damageWorth(state, 3) - 4;
      return { keep: Math.max(0.3, 0.5 * fire) };
    }
    case '30045': // Urtica Cipher: 2 net damage plus 1 per advancement, accessed about half the time
      return { keep: 0.5 * damageWorth(state, 3) };
    case '30061': { // Clearinghouse: about 2 advances (a click and a credit each) for 2 meat damage, if it survives a turn
      const advance = 2 * (CLICK + 1);
      return { keep: Math.max(0.5, 0.6 * damageWorth(state, 2) - 0.5 * advance) };
    }
    case '35061': // Idiosyncresis: each advancement is 3 credits to the Corp and 2 off the Runner, for a click and a credit
      return { keep: 0.6 * 2 * (3 + 2 - (CLICK + 1)) };
    case '35073': { // Plutus: a transaction replayed each turn from Archives; to rez, trash 3 cards from HQ
      const keep = perTurn(state, transactionGain(state), 'corp') - 3 * RATES.drawnCard;
      return { keep: Math.max(0.3, keep) };
    }
    case '35062': { // Public Access Plaza: 1 credit each turn
      const keep = perTurn(state, 1, 'corp') - cost;
      return { keep, econ: keep };
    }
    case '30053': { // Spin Doctor: draw 2 when rezzed; later 2 cards back from Archives
      const keep = 2 * RATES.drawnCard + 0.5 - cost;
      return { keep, econ: keep };
    }
    case '35039': { // Humanoid Resources: 3 clicks for 4 credits, 3 cards and 3 free actions (2 installs, 1 operation)
      const keep = 0.9 * (4 + 3 * RATES.drawnCard + 3 * CLICK - 3 * CLICK) - cost;
      return { keep, econ: keep };
    }
    case '30058': { // AMAZE Amusements: 2 tags whenever the Runner steals from this server
      const tags = 2 * RATES.tagAgainstRunner;
      return { keep: 0.3 * tags, upgrade: [0.3 * tags, 0.15 * tags] };
    }
    case '30050': { // Anoetic Void: pay 2 and 2 cards from HQ to end a run; worth it on a server holding an agenda
      const use = 2 + 2 * RATES.drawnCard;
      return { keep: 0.5 * agenda - use, upgrade: [Math.max(0, 0.5 * agenda - use), Math.max(0.3, 2 * accessWorth(state) - use)] };
    }
    case '30066': { // Malapert Data Vault: fetch a card of choice from R&D on each score here
      const tutor = 1.5 * RATES.drawnCard;
      return { keep: 1.2 * tutor, upgrade: [1.2 * tutor, 0] };
    }
    case '30042': { // Manegarm Skunkworks: each run here costs the Runner 2 clicks or 5 credits
      const tax = Math.min(2 * CLICK, 5);
      const remote = perTurn(state, PACE.runs * PACE.remoteShare * tax, 'corp');
      const central = perTurn(state, PACE.runs * PACE.rdShare * tax, 'corp');
      return { keep: remote, upgrade: [remote, central] };
    }
    case '35045': { // Mercia B4LL4RD: one ice a turn installed for no click and 1 credit less
      const value = perTurn(state, PACE.iceInHand * (CLICK + 1), 'corp', 3) * 0.5; // it moves with the ice, so it helps only while ice keeps coming
      return { keep: value, upgrade: [value, value] };
    }
    case '35051': // Phật Gioan Baotixita: a power counter a turn (1 net damage each, priced in counterValues.ts), used up within about 3 turns
      return { keep: perTurn(state, counterWorthOf(state, code, 'power'), 'corp', 0, 3) };
    case '35082': { // Mahkota Langit Grid: 2 credits back each turn it gets to pay for a rez here; assets here cost 2 more to trash
      const refills = perTurn(state, 0.4 * 2 * counterWorthOf(state, code, 'credit'), 'corp') + 0.5;
      return { keep: refills, upgrade: [refills, 0.8 * refills] };
    }
    case '35056': { // Mitra Aman: once, 3 credits and a swap of the approached ice
      const value = 3 + 2;
      return { keep: value, upgrade: [value, value] };
    }
  }
  return undefined;
}

/** Runner rig cards that aren't icebreakers, in credits, installed. */
export function runnerEffect(state: GameState, code: string, card?: CardInstance): number | undefined {
  switch (code) {
    case '35006': // Bling: +1 MU; a free install now and then lets it host the top card to play
      return MU + perTurn(state, 0.3, 'runner');
    case '30003': // Carnivore: +1 MU; trash an accessed card for 2 cards from the grip (its trash cost and the Corp's loss, about 4)
      return MU + perTurn(state, 0.25 * Math.max(0, 4 + 2 - 2 * RATES.drawnCard), 'runner');
    case '35018': // Detente: +1 MU; parks an HQ card each HQ run, and can trade 2 back for a random access
      return MU + perTurn(state, PACE.runs * PACE.hqShare * 0.5 * accessWorth(state), 'runner');
    case '30013': // Docklands Pass: one more HQ access the first time each turn
      return perTurn(state, PACE.runs * PACE.hqShare * accessWorth(state), 'runner');
    case '30022': // DZMZ Optimizer: +1 MU; first program each turn 1 credit cheaper
      return MU + perTurn(state, PACE.programInstalls, 'runner');
    case '35027': { // GAMEDRAGON Pro: +1 strength and boosts last the run, about a credit a run with a host
      const hosts = state.runner.rig.programs.some(p => /icebreaker/i.test(cardDef(p).keywords ?? '') && !/\bAI\b/.test(cardDef(p).keywords ?? ''));
      return perTurn(state, PACE.runs * (hosts ? 1 : 0.5), 'runner');
    }
    case '35028': { // Madani: a hosted program installed each turn without a click
      const programs = [...state.runner.grip, ...state.runner.stack].filter(c => cardDef(c).type_code === 'program').length;
      return CLICK * Math.min(3, programs * 0.5);
    }
    case '35019': { // Maglectric Rapid: once, derez a Corp card (about its rez cost)
      const rezzed = Object.values(state.corp.servers).flatMap(s => s.ice).filter(i => i.isRezzed).map(i => cardDef(i).cost ?? 0);
      return 0.8 * (rezzed.length ? Math.max(...rezzed) : 3);
    }
    case '30023': // Pantograph: +1 MU; 1 credit and a free install (when there is one to make, about half the time) each time an agenda is scored or stolen
      return MU + perTurn(state, PACE.agendaEvents * (1 + 0.5 * CLICK), 'runner');
    case '30031': // T400 Memory Diamond: +1 MU and one more card in hand (and one more point of life against damage)
      return MU + RATES.drawnCard * 0.6;
    case '35030': { // Chromatophores: the host ice can be broken by any breaker
      const host = card?.hostedOnId ? Object.values(state.corp.servers).flatMap(s => s.ice).find(i => i.instanceId === card.hostedOnId) : undefined;
      return host?.isRezzed ? 1 + 0.3 * Math.min(8, cardDef(host).cost ?? 0) : 1.5;
    }
    case '35007': // Gourmand: once, trash a non-agenda card accessed (about 4 to the Corp) and draw 1
      return 0.7 * (4 + RATES.drawnCard);
    case '35033': // Knickknack O'Brian: now and then, an empty card turned into its install cost and a card
      return perTurn(state, 0.25 * (2 + RATES.drawnCard - 1), 'runner');
    case '30009': { // Cookbook: a virus counter on each virus program installed later
      const viruses = [...state.runner.grip, ...state.runner.stack].filter(c => /virus/i.test(cardDef(c).keywords ?? '')).length;
      return viruses * RATES.counters.virus;
    }
    case '35021': // Fransofia Ward: each rez costs the Corp a credit more; bypass an ice once the Corp is rich
      return perTurn(state, PACE.rezzes, 'runner') + (state.corp.credits >= 15 ? 3 : 0.5);
    case '35011': // Rent Rioters: 3 clicks for 9 credits
      return 9 - 3 * CLICK;
    // Cards whose counters are priced in counterValues.ts: what they are worth is the counters still to come
    case '30004': // Botulus: a virus counter a turn, each breaking a subroutine on its host; useful for about 3 turns
    case '30017': // Tranquilizer: a virus counter a turn; 3 derez its host
      return perTurn(state, card ? counterWorth(state, card, 'virus', 'runner') : 1, 'runner', 0, 3);
    case '30007': // Fermenter: a virus counter a turn (2 credits each when cashed), cashed within about 4 turns
      return perTurn(state, counterWorthOf(state, code, 'virus'), 'runner', 0, 4);
    case '30008': // Leech: a virus counter for each successful central run
      return perTurn(state, PACE.runs * (PACE.hqShare + PACE.rdShare) * PACE.success * counterWorthOf(state, code, 'virus'), 'runner');
    case '30014': // Pennyshaver: +1 MU; a credit on it for each successful run
      return MU + perTurn(state, PACE.runs * PACE.success * counterWorthOf(state, code, 'credit'), 'runner');
    case '30024': // Conduit: a counter (1 more card accessed) for each successful R&D run; with Conduit out, most runs go to R&D
      return perTurn(state, PACE.runs * PACE.conduitRdShare * PACE.success * counterWorthOf(state, code, 'virus'), 'runner');
    case '30033': // Smartware Distributor: a spare click turns into 3 credits paid out over 3 turns, about every other turn
      return perTurn(state, 0.5 * Math.max(0, 3 * 0.9 - CLICK), 'runner');
    case '35010': // Cacophony: a power counter the first time each turn it steals or trashes a Corp card
      return perTurn(state, PACE.stealOrTrash * counterWorthOf(state, code, 'power'), 'runner');
    case '35029': // Azimat: its 2 credits refill each turn it has a trash cost to pay
      return perTurn(state, PACE.paidTrashes * 2 * counterWorthOf(state, code, 'credit'), 'runner');
    case '35034': { // Side Hustle: a credit for each run until it holds 6, then a card
      const left = Math.max(0, 6 - (card ? counters(card, 'credit') : 1));
      return perTurn(state, PACE.runs * counterWorthOf(state, code, 'credit'), 'runner', 0, Math.ceil(left / PACE.runs)) + 0.85 ** Math.ceil(left / PACE.runs) * RATES.drawnCard;
    }
    case '30018': // Red Team: all its worth is the 12 credits on it (counterValues.ts)
    case '35031': // Devadatta Drone: all its worth is its 2 power counters
      return 0;
    case '30034': // Verbal Plasticity: one more card the first time each turn it clicks to draw
      return perTurn(state, PACE.drawTurns * RATES.drawnCard, 'runner');
  }
  return undefined;
}

/** Worth of one counter of a type on a card, priced against the board (counterValues.ts), for a card not installed yet. */
function counterWorthOf(state: GameState, code: string, type: 'credit' | 'virus' | 'power'): number {
  return COUNTER_WORTH[code]?.[type]?.(state, { cardCode: code, instanceId: 'probe', tokens: {} } as unknown as CardInstance) ?? 1;
}

/** The cards priced by the formulas above (for the audit). */
export const EFFECT_CODES = [
  '35051', '35082', '30004', '30017', '30007', '30008', '30014', '30024', '30033', '35010', '35029', '35034', '30018', '35031',
  '35050', '30045', '30061', '35061', '35073', '35062', '30053', '35039', '30058', '30050', '30066', '30042', '35045', '35056',
  '35006', '30003', '35018', '30013', '30022', '35027', '35028', '35019', '30023', '30031', '35030', '35007', '35033', '30009', '35021', '35011', '30034',
];

/** Whether the effect formulas price cards (plan.effectValues). */
export const effectsOn = (): boolean => !!tuning.plan.effectValues;
