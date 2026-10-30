import { CardInstance, GameState, cardDef, getCardDefinition, getCardScript } from '../core';
import { counters } from '../core/engine/cardEffects';
import { PAYOUT_RISK, turnsLeft } from './cardProfiles';
import { COUNTER_WORTH, counterWorth } from './counterValues';
import { tuning } from './synergy';
import { CLICK, RATES, cardRate, flatRate, flatlineWorth, memo, pointGain, pointValue, sideCards } from './valueModel';
import { tagsWorth } from './evaluate';
import { iceCost } from './runs';

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

/**
 * How often things happen, per Runner turn, in self-play. Measured averages,
 * not guesses (Jeff, 2026-10-28): runs, shares, success, agenda events and
 * rezzes from scripts/pace.ts (re-measured with Vantage Point: 1,980 games over
 * every deck at 974c6b6, 27,128 Runner turns; before, 2,210 games at b72eb3d);
 * the rest from the behaviour logs. Re-measure after every Corp or Runner AI change.
 */
export const PACE = {
  /** Runs a turn, and the share of them on HQ, R&D, Archives and a remote. */
  runs: 1.2,
  hqShare: 0.27,
  rdShare: 0.2,
  archivesShare: 0.15,
  remoteShare: 0.39,
  /** Share of runs on R&D while Conduit is installed (844 runs measured, 2026-10-28). */
  conduitRdShare: 0.19,
  /** Share of runs that succeed. */
  success: 0.8,
  /** Turns the Runner steals or trashes a Corp card, and trashes something it pays for. */
  stealOrTrash: 0.35,
  paidTrashes: 0.3,
  /** Agendas scored or stolen a turn, both sides together. */
  agendaEvents: 0.34,
  /** Ice rezzed a turn. */
  rezzes: 0.39,
  /** Turns the Runner installs a program, and has ice in hand (Corp). */
  programInstalls: 0.3,
  iceInHand: 0.6,
  /** Times the Runner clicks to draw on a turn it draws at all. */
  drawTurns: 0.7,
};

/**
 * Virus counters sit until the Runner cashes them and a purge wipes them
 * all: banked like a clicked payout (PAYOUT_RISK.clickWait) and 10% a turn
 * at risk of a purge (Jeff, 2026-10-28: Fermenter was overvalued without it).
 */
export const VIRUS_WAIT = PAYOUT_RISK.clickWait * 0.9;

/** The virus wait while plan.cardFixes is on. */
const virusWait = (): number => (tuning.plan.cardFixes ? VIRUS_WAIT : 1);

/**
 * Conduit (Jeff, 2026-10-28): each counter is one more card accessed on
 * every Conduit run still to come, so a counter is worth an access times
 * the successful Conduit runs left.
 */
export function conduitCounterWorth(state: GameState): number {
  let runsLeft = PACE.runs * PACE.conduitRdShare * PACE.success * Math.max(1, turnsLeft(state) - 1);
  if (tuning.plan.runOpenness) {
    runsLeft = 0;
    for (let t = 1; t < Math.max(2, turnsLeft(state)); t++) runsLeft += PACE.runs * PACE.conduitRdShare * runSuccess(state, 'rd') * LOCKDOWN ** (t - 1);
  }
  return accessWorth(state) * Math.min(4, runsLeft) * VIRUS_WAIT;
}

/** A memory unit: room for one more program. */
export const MU = 1.5;

/** Base memory before any console or chip (rules 1.20.2: 4 MU unless the identity says otherwise). */
const BASE_MU = 4;

/**
 * Worth of the memory a card adds (plan.muNeed): MU, and as much again while
 * the programs installed and in the grip need more than the base 4 MU, so a
 * console is worth installing when it lets the programs in. Counted against
 * the base, not the current total, so the worth doesn't drop once installed.
 */
export function muWorth(state: GameState): number {
  if (!tuning.plan.muNeed) return MU;
  const grip = state.runner.grip.filter(c => cardDef(c).type_code === 'program').reduce((n, c) => n + (cardDef(c).memory_cost ?? 0), 0);
  return state.runner.memoryUnitsUsed + grip > BASE_MU ? 2 * MU : MU;
}

/** Worth of `x` each turn for the turns left, less the risk of losing the card each turn. */
function perTurn(state: GameState, x: number, owner: 'corp' | 'runner', minTurns = 0, maxTurns = Infinity, wait = 1, lock = 1): number {
  const risk = owner === 'corp' ? PAYOUT_RISK.corpBare : state.runner.tags > 0 ? PAYOUT_RISK.runnerTagged : PAYOUT_RISK.runnerUntagged;
  const turns = Math.min(maxTurns, Math.max(minTurns, turnsLeft(state)));
  let value = 0;
  for (let t = 1; t <= turns; t++) value += x * (wait * (1 - risk)) ** t * lock ** (t - 1);
  return value;
}

/*
 * Run openness (Jeff, 2026-10-28; plan.runOpenness): cards that pay off on
 * successful runs (Leech, Conduit, Pennyshaver, Docklands Pass, Red Team,
 * Cacophony) are worth what the servers they need allow. A run succeeds as
 * often as the rig can pay its way through the ice there now, and the Corp
 * ices its servers as the game goes on, so later turns are less open:
 * strong early or with cheap breakers, fading as servers lock down.
 */

/** Share of a server's openness left each turn as the Corp adds ice (a guess: about one ice in ten turns per server). */
export const LOCKDOWN = 0.9;
/** A rezzed ice the rig can't afford to get past: the run mostly ends there. */
const BLOCKED_PASS = 0.1;
/** Unrezzed ice: the Corp rezzes it when it can afford to, about half the time. */
const UNREZZED_PASS = { rich: 0.55, broke: 0.9 };

/** Chance a run on `serverId` succeeds now, from its ice against the rig and the Runner's credits (PACE.success while plan.runOpenness is off). */
let pricingIce = false;

export function runSuccess(state: GameState, serverId: string): number {
  const server = state.corp.servers[serverId];
  // Pricing the ice can come back here (a subroutine that trashes a card prices the rig): the guess, inside
  if (!tuning.plan.runOpenness || !server || pricingIce) return PACE.success;
  return memo(state, 'runSuccess:' + serverId, () => {
    pricingIce = true;
    try {
      return passOdds(state, server.ice);
    } finally {
      pricingIce = false;
    }
  });
}

/** iceCost behind the re-entry guard. */
function priceIce(state: GameState, ice: CardInstance): number {
  pricingIce = true;
  try {
    return iceCost(state, ice);
  } finally {
    pricingIce = false;
  }
}

function passOdds(state: GameState, ices: CardInstance[], income = 0): number {
  let credits = state.runner.credits + income;
  let pass = 1;
  for (const ice of [...ices].reverse()) {
    if (!ice.isRezzed) {
      pass *= state.corp.credits >= 3 ? UNREZZED_PASS.rich : UNREZZED_PASS.broke;
      continue;
    }
    const cost = iceCost(state, ice);
    if (cost <= credits) {
      credits -= cost;
      pass *= 0.95;
    } else pass *= BLOCKED_PASS;
  }
  return pass;
}

/**
 * Chance the Runner steals an agenda installed in `serverId` on its next
 * turn (plan.stealOdds, Jeff 2026-10-28). Measured with scripts/steal-odds.ts:
 * the share of agenda turns behind ice the Runner can afford that end in a
 * steal (STEAL.run), against the credits it holds (STEAL.income: credits it
 * raises first). Re-measured 2026-10-29 at 8e09d10 (12,100 agenda turns):
 * the Runner AI now steals about half as often as the first measure (0.84,
 * 2 income) said (1/1 rezzed: 10% stolen, predicted 21%), so 0.45 and no
 * income. Open remotes stay a sure steal (plan.openSteal; 86% measured).
 */
export const STEAL = { run: 0.45, income: 0 };

export function stealOdds(state: GameState, serverId: string, run = STEAL.run, income = STEAL.income): number {
  const server = state.corp.servers[serverId];
  if (!server || pricingIce) return run * PACE.success;
  // On the Runner's own turn: the clicks it has left, one kept for the run
  const coming = state.activePlayer === 'runner' ? Math.max(0, Math.min(income, state.runner.clicks - 1)) : income;
  return memo(state, `stealOdds:${serverId}:${run}:${coming}`, () => {
    pricingIce = true;
    try {
      // Jeff: nothing stops the Runner checking an open remote, so an agenda there is as good as stolen (plan.openSteal)
      if (tuning.plan.openSteal && server.isRemote && server.ice.length === 0) return 1;
      return run * passOdds(state, server.ice, coming);
    } finally {
      pricingIce = false;
    }
  });
}

/** Successful runs a turn on the centrals, by the share of runs each gets. */
const centralSuccess = (state: GameState): number => PACE.hqShare * runSuccess(state, 'hq') + PACE.rdShare * runSuccess(state, 'rd');

/** Average success of a run anywhere (remotes at their typical share). */
function anySuccess(state: GameState): number {
  const remotes = Object.values(state.corp.servers).filter(s => s.isRemote);
  const remote = remotes.length ? Math.max(...remotes.map(s => runSuccess(state, s.id))) : runSuccess(state, 'hq');
  return centralSuccess(state) + PACE.remoteShare * remote;
}

/** The lock-down per turn while plan.runOpenness is on. */
const lock = (): number => (tuning.plan.runOpenness ? LOCKDOWN : 1);

/** Chance a Corp card the Runner hasn't seen is an agenda, and the points of a typical agenda (decklist). */
export function agendaOdds(state: GameState): { odds: number; points: number } {
  return memo(state, 'agendaOdds', () => countAgendaOdds(state));
}

function countAgendaOdds(state: GameState): { odds: number; points: number } {
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
  return odds * pointGain(state.runner.score, points);
}

/** Worth of n net or meat damage to the Runner: the cards lost, or the game if it flatlines. */
export function damageWorth(state: GameState, n: number): number {
  if (n > state.runner.grip.length) return flatlineWorth(state);
  const card = cardRate(state, 'runner');
  if (!tuning.plan.damageClock) return n * card;
  // The damage clock: the cards, and the step closer to a flatline the smaller grip leaves
  // Cards over the hand limit are discarded before the Corp's turn: they are no life against its damage
  const limit = state.runner.handSizeLimit ?? 5;
  const grip = state.runner.grip.length;
  return n * card + flatlineWorth(state) * (flatlineOdds(state, Math.min(limit, grip - n)) - flatlineOdds(state, Math.min(limit, grip)));
}

/** Damage a Corp card can deal in one go, from its text ("plus 1 ... for each" counts 2 more). */
function cardDamage(code: string): number {
  const text = getCardDefinition(code).stripped_text ?? '';
  let most = 0;
  for (const m of text.matchAll(/[Dd]o (\d+) (?:net|meat|core) damage( plus 1 (?:net |meat )?damage for each)?/g)) most = Math.max(most, Number(m[1]) + (m[2] ? 2 : 0));
  return most;
}

const threats = new Map<string, { burst: number; share: number }>();

/**
 * The Corp's damage threat (the damage clock, Jeff 2026-10-28): the biggest
 * hit one of its cards can still deal, and the share of its cards that deal
 * damage, from the decklist less what is scored or trashed faceup.
 */
export function damageThreat(state: GameState): { burst: number; share: number } {
  const key = `${state.id}:${state.corp.archives.faceUp.length}:${state.corp.scoreArea.length}:${state.runner.scoreArea.length}`;
  const cached = threats.get(key);
  if (cached) return cached;
  const gone = new Set([...state.corp.archives.faceUp, ...state.corp.scoreArea, ...state.runner.scoreArea].map(c => c.instanceId));
  const live = sideCards(state, 'corp').filter(c => !gone.has(c.instanceId));
  const hits = live.map(c => cardDamage(c.cardCode)).filter(n => n > 0);
  const threat = { burst: hits.length ? Math.max(...hits) : 0, share: live.length ? hits.length / live.length : 0 };
  if (threats.size > 200) threats.clear();
  threats.set(key, threat);
  return threat;
}

/**
 * Chance the Corp flatlines a Runner holding `grip` cards before it can
 * draw back up: near 1 once the grip is below the Corp's biggest hit,
 * falling off over a card or two above it, and only as likely as the Corp
 * is to have a damage card to hand (rule 10.4.4: flatlined on damage beyond the grip).
 */
/** Share of damage threats the Corp gets to land. */
export const FLATLINE_LANDS = 0.5;

export function flatlineOdds(state: GameState, grip: number): number {
  const { burst, share } = damageThreat(state);
  if (burst === 0) return 0;
  // The Corp has to draw the card and land the hit (the Runner has to access or encounter it): about half the time when it holds one
  const presence = Math.min(1, 4 * share) * FLATLINE_LANDS;
  return presence / (1 + Math.exp((grip + 0.5 - burst) / 1.2));
}

/** Share of turns a hand slot lost to core damage holds a card the Runner would have kept (a named guess). */
export const CORE_SLOT_USE = 0.5;

/** Worth of a hand slot already lost to core damage (plan.flatRates.coreDamage; the damage clock already reads the lower limit). */
export function coreSlotWorth(state: GameState): number {
  return flatRate('coreDamage') ? CORE_SLOT_USE * cardRate(state, 'runner') : RATES.coreDamage;
}

/**
 * Worth of one more core damage beyond the card it discards (rule 5.5.3b:
 * core damage also lowers the Runner's hand size for the rest of the game):
 * the slot, and the damage clock at a full hand with the limit one lower.
 */
export function coreDamageWorth(state: GameState): number {
  if (!flatRate('coreDamage')) return RATES.coreDamage;
  const limit = state.runner.handSizeLimit ?? 5;
  const clock = tuning.plan.damageClock ? Math.max(0, flatlineOdds(state, limit - 1) - flatlineOdds(state, limit)) : 0;
  return coreSlotWorth(state) + flatlineWorth(state) * clock;
}

/** A flatline ends the game: priced like half of a whole game of agenda points (plan.flatRates.flatline off; valueModel flatlineWorth). */
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
  const agenda = pointGain(state.corp.score, agendaOdds(state).points);
  const card = cardRate(state, 'corp');
  const tag = flatRate('tags') && tuning.plan.tagClock ? tagsWorth(state, 'corp', 1) : RATES.tagAgainstRunner;
  switch (code) {
    case '35050': { // Byte!: pay 4 on access for 1 tag and 3 net damage; accessed about half the time
      const fire = tag + damageWorth(state, 3) - 4;
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
      const keep = perTurn(state, transactionGain(state), 'corp') - 3 * card;
      return { keep: Math.max(0.3, keep) };
    }
    case '35062': { // Public Access Plaza: 1 credit each turn
      const keep = perTurn(state, 1, 'corp') - cost;
      return { keep, econ: keep };
    }
    case '30053': { // Spin Doctor: draw 2 when rezzed; later 2 cards back from Archives
      const keep = 2 * card + 0.5 - cost;
      return { keep, econ: keep };
    }
    case '35039': { // Humanoid Resources: 3 clicks for 4 credits, 3 cards and 3 free actions (2 installs, 1 operation)
      const keep = 0.9 * (4 + 3 * card + 3 * CLICK - 3 * CLICK) - cost;
      return { keep, econ: keep };
    }
    case '30058': { // AMAZE Amusements: 2 tags whenever the Runner steals from this server
      const tags = flatRate('tags') && tuning.plan.tagClock ? tagsWorth(state, 'corp', 2) : 2 * RATES.tagAgainstRunner;
      return { keep: 0.3 * tags, upgrade: [0.3 * tags, 0.15 * tags] };
    }
    case '30050': { // Anoetic Void: pay 2 and 2 cards from HQ to end a run; worth it on a server holding an agenda
      const use = 2 + 2 * card;
      return { keep: 0.5 * agenda - use, upgrade: [Math.max(0, 0.5 * agenda - use), Math.max(0.3, 2 * accessWorth(state) - use)] };
    }
    case '30066': { // Malapert Data Vault: fetch a card of choice from R&D on each score here
      const tutor = 1.5 * card;
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
    // ---- Vantage Point ----
    case '36027': // Synchrocyclotron: a click back on the first double each turn, as often as the deck holds doubles
      return { keep: Math.max(0.3, perTurn(state, Math.min(1, 4 * deckShare(state, 'corp', /double/i)) * CLICK, 'corp') - cost) };
    case '36035': { // Perfect Recall: a counter when rezzed and on each score here; each keeps the Runner off one card for a run
      const counter = counterWorthOf(state, code, 'power');
      const remote = counter + perTurn(state, 0.5 * PACE.agendaEvents * counter, 'corp');
      return { keep: remote, upgrade: [remote, counter] };
    }
    case '36038': // Esca: on access (about half the time), 1 credit off the Runner and 1 net damage if tagged
      return { keep: 0.5 * (1 + (state.runner.tags > 0 ? damageWorth(state, 1) : 0.2 * damageWorth(state, 1))) };
    case '36045': { // The Red Room: central only; a counter on the first agenda each turn, each ending a run elsewhere
      const value = perTurn(state, PACE.agendaEvents * counterWorthOf(state, code, 'power'), 'corp');
      return { keep: value, upgrade: [0, value] };
    }
    case '36048': // Magistrate Revontulet: 3 credits more for each steal, 3 off the Runner on each score
      return { keep: Math.max(0.3, perTurn(state, PACE.agendaEvents * 3, 'corp') - cost) };
    case '36049': // Nihilo Agent: a tag at the end of each Corp turn for 3 turns, and a bad publicity the Runner spends meanwhile
      return { keep: Math.max(0.3, perTurn(state, tag - PACE.runs * 0.5, 'corp', 0, 3) - cost) };
    case '36055': { // Hype Machine: free to rez after an agenda; trash for an advancement counter in this root
      const counter = CLICK + 1;
      return { keep: 0.6 * counter, upgrade: [0.8 * counter, 0] };
    }
    case '36057': { // Luana Campos: each bad publicity hosted is 3 credits and a card, taken back if it is trashed
      const hosts = Math.max(state.corp.badPublicity ?? 0, deckShare(state, 'corp', /liability/i) > 0.1 ? 2 : 0.5);
      const keep = perTurn(state, 3 + card, 'corp', 0, Math.max(1, hosts)) - cost;
      return { keep, econ: keep };
    }
    case '36064': { // Flagship: on HQ or R&D, one access a run and no successful-run payoffs
      const central = perTurn(state, PACE.runs * (PACE.hqShare + PACE.rdShare) * 0.5 * (accessWorth(state) + 0.5), 'corp') - cost;
      return { keep: Math.max(0.3, central), upgrade: [0, Math.max(0.3, central)] };
    }
    case '36065': { // Shackleton Grid: 4 meat damage when the Runner spends credits from outside its pool here
      const hosted = state.runner.rig.hardware.concat(state.runner.rig.programs, state.runner.rig.resources).some(c => (c.tokens.credit ?? 0) > 0 || !!getCardScript(c.cardCode)?.paysDuringRuns);
      const value = perTurn(state, PACE.runs * PACE.remoteShare * (hosted ? 0.3 : 0.05) * damageWorth(state, 4), 'corp');
      return { keep: value, upgrade: [value, 0.6 * value] };
    }
  }
  return undefined;
}

/** Runner rig cards that aren't icebreakers, in credits, installed. */
export function runnerEffect(state: GameState, code: string, card?: CardInstance): number | undefined {
  switch (code) {
    case '35006': // Bling: +1 MU; a free install now and then lets it host the top card to play
      return muWorth(state) + perTurn(state, 0.3, 'runner');
    case '30003': // Carnivore: +1 MU; trash an accessed card for 2 cards from the grip (its trash cost and the Corp's loss, about 4)
      return muWorth(state) + perTurn(state, 0.25 * Math.max(0, 4 + 2 - 2 * cardRate(state, 'runner')), 'runner');
    case '35018': // Detente: +1 MU; parks an HQ card each HQ run, and can trade 2 back for a random access
      return muWorth(state) + perTurn(state, PACE.runs * PACE.hqShare * 0.5 * accessWorth(state), 'runner');
    case '30013': // Docklands Pass: one more HQ access the first time each turn, on a successful HQ run
      if (tuning.plan.runOpenness) return perTurn(state, PACE.runs * PACE.hqShare * runSuccess(state, 'hq') * accessWorth(state), 'runner', 0, Infinity, 1, lock());
      return perTurn(state, PACE.runs * PACE.hqShare * accessWorth(state), 'runner');
    case '30022': // DZMZ Optimizer: +1 MU; first program each turn 1 credit cheaper
      return muWorth(state) + perTurn(state, PACE.programInstalls, 'runner');
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
      return muWorth(state) + perTurn(state, PACE.agendaEvents * (1 + 0.5 * CLICK), 'runner');
    case '30031': // T400 Memory Diamond: +1 MU and one more card in hand (and one more point of life against damage)
      return muWorth(state) + cardRate(state, 'runner') * 0.6;
    case '35030': { // Chromatophores: the host ice can be broken by any breaker
      const host = card?.hostedOnId ? Object.values(state.corp.servers).flatMap(s => s.ice).find(i => i.instanceId === card.hostedOnId) : undefined;
      return host?.isRezzed ? 1 + 0.3 * Math.min(8, cardDef(host).cost ?? 0) : 1.5;
    }
    case '35007': // Gourmand: once, trash a non-agenda card accessed (about 4 to the Corp) and draw 1
      return 0.7 * (4 + cardRate(state, 'runner'));
    case '35033': // Knickknack O'Brian: now and then, an empty card turned into its install cost and a card
      return perTurn(state, 0.25 * (2 + cardRate(state, 'runner') - 1), 'runner');
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
      return perTurn(state, card ? counterWorth(state, card, 'virus', 'runner') : 1, 'runner', 0, 3, virusWait());
    case '30007': // Fermenter: a virus counter a turn (2 credits each when cashed), banked until cashed within about 4 turns, and lost to a purge
      return perTurn(state, counterWorthOf(state, code, 'virus'), 'runner', 0, 4, virusWait());
    case '30008': // Leech: a virus counter for each successful central run, spent on an encounter soon after: each waits about a turn, not from now
      if (tuning.plan.runOpenness) return virusWait() * perTurn(state, PACE.runs * centralSuccess(state) * counterWorthOf(state, code, 'virus'), 'runner', 0, Infinity, 1, lock());
      return virusWait() * perTurn(state, PACE.runs * (PACE.hqShare + PACE.rdShare) * PACE.success * counterWorthOf(state, code, 'virus'), 'runner');
    case '30014': // Pennyshaver: +1 MU; a credit on it for each successful run
      if (tuning.plan.runOpenness) return muWorth(state) + perTurn(state, PACE.runs * anySuccess(state) * counterWorthOf(state, code, 'credit'), 'runner', 0, Infinity, 1, lock());
      return muWorth(state) + perTurn(state, PACE.runs * PACE.success * counterWorthOf(state, code, 'credit'), 'runner');
    case '30024': {
      if (!tuning.plan.cardFixes) return perTurn(state, PACE.runs * PACE.conduitRdShare * PACE.success * counterWorthOf(state, code, 'virus'), 'runner');
      // Conduit: a counter for each successful R&D run, each one more card on every Conduit run after it; counters gained later have fewer runs left
      const success = (t: number) => PACE.runs * PACE.conduitRdShare * runSuccess(state, 'rd') * lock() ** (t - 1);
      let value = 0;
      for (let t = 1; t < turnsLeft(state); t++) {
        let later = 0;
        for (let u = t + 1; u <= turnsLeft(state); u++) later += success(u);
        value += success(t) * accessWorth(state) * Math.min(4, later) * VIRUS_WAIT ** t;
      }
      return value;
    }
    case '30033': // Smartware Distributor: a spare click turns into 3 credits paid out over 3 turns, about every other turn
      return perTurn(state, 0.5 * Math.max(0, 3 * 0.9 - CLICK), 'runner');
    case '35010': // Cacophony: a power counter the first time each turn it steals or trashes a Corp card
      if (tuning.plan.runOpenness) return perTurn(state, PACE.stealOrTrash * (anySuccess(state) / PACE.success) * counterWorthOf(state, code, 'power'), 'runner', 0, Infinity, 1, lock());
      return perTurn(state, PACE.stealOrTrash * counterWorthOf(state, code, 'power'), 'runner');
    case '35029': // Azimat: its 2 credits refill each turn it has a trash cost to pay
      return perTurn(state, PACE.paidTrashes * 2 * counterWorthOf(state, code, 'credit'), 'runner');
    case '35034': { // Side Hustle: a credit for each run until it holds 6, then a card
      const left = Math.max(0, 6 - (card ? counters(card, 'credit') : 1));
      return perTurn(state, PACE.runs * counterWorthOf(state, code, 'credit'), 'runner', 0, Math.ceil(left / PACE.runs)) + 0.85 ** Math.ceil(left / PACE.runs) * cardRate(state, 'runner');
    }
    case '30018': // Red Team: all its worth is the 12 credits on it (counterValues.ts)
    case '35031': // Devadatta Drone: all its worth is its 2 power counters
      return 0;
    case '30034': // Verbal Plasticity: one more card the first time each turn it clicks to draw
      return perTurn(state, PACE.drawTurns * cardRate(state, 'runner'), 'runner');
    // ---- Vantage Point ----
    case '36003': // The Tungsten Tailor: -1 strength on every ice, about half a credit of boosting saved a run
      return perTurn(state, PACE.runs * 0.5, 'runner');
    case '36005': // Lampades: 3 counters, each a paid trash of an accessed card (stealth credits only)
      return 3 * counterWorthOf(state, code, 'power');
    case '36006': { // Hackerspace: companions and connections a credit cheaper, +2 hand size with one of each
      const hosts = deckCount(state, 'runner', c => cardDef(c).type_code === 'resource' && !!cardDef(c).uniqueness && /companion|connection/i.test(cardDef(c).keywords ?? ''));
      return Math.min(3, hosts) * 0.8 + (hosts >= 2 ? 0.6 * cardRate(state, 'runner') : 0);
    }
    case '36007': { // Nurse Hạnh: 2 cards when an Archives breach turns 2 or more cards faceup
      const facedown = state.corp.archives.faceDown.length >= 2 ? 1 : 0.4;
      return perTurn(state, PACE.runs * PACE.archivesShare * runSuccess(state, 'archives') * facedown * 2 * cardRate(state, 'runner'), 'runner');
    }
    case '36008': // Stick and Poke: a card drawn for a net damage on the first encounter each turn: a filter at best
      return perTurn(state, 0.1, 'runner');
    case '36013': // Borrowed Goods: +1 MU for a tag when untagged (the flat tag rate: the tag clock prices the rig, which would come back here)
      return muWorth(state) - (state.runner.tags > 0 ? 0 : RATES.tagAgainstRunner);
    case '36014': // Rotary: +1 MU; a tag for one more access on HQ and R&D breaches, now and then
      return muWorth(state) + perTurn(state, PACE.runs * centralSuccess(state) * 0.3 * accessWorth(state), 'runner');
    case '36015': { // Baker: once a turn, an HQ or R&D breach past Archives' ice instead of theirs, for a stealth credit
      const stealth = deckCount(state, 'runner', c => /stealth/i.test(cardDef(c).keywords ?? '')) > 0;
      // Pricing the ice can price the rig (a subroutine that trashes a card), which comes back here: count each rezzed ice as 2 then
      const ice = (id: string) => (state.corp.servers[id]?.ice ?? []).reduce((n, c) => n + (!c.isRezzed ? 1 : pricingIce ? 2 : Math.min(4, priceIce(state, c))), 0);
      const saved = Math.max(0, Math.min(4, Math.max(ice('hq'), ice('rd'))) - ice('archives'));
      return perTurn(state, (stealth ? 0.5 : 0.1) * (saved + accessWorth(state)), 'runner');
    }
    case '36016': { // Underdome Irregulars: 2 cards each turn the Corp rezzes ice, trashed the first turn it doesn't
      const p = PACE.rezzes;
      return (2 * cardRate(state, 'runner') * p) / (1 - p);
    }
    case '36020': // Methuselah: +1 MU; a hardware from the grip turns into 2 run credits now and then
      return muWorth(state) + perTurn(state, Math.min(1, 3 * deckShare(state, 'runner', null, 'hardware')) * 0.5 * Math.max(0, 2 * counterWorthOf(state, code, 'credit') - cardRate(state, 'runner')), 'runner');
    case '36021': // Touchstone: a run credit the first time each turn it plays an event
      return perTurn(state, Math.min(1, 3 * deckShare(state, 'runner', null, 'event')) * counterWorthOf(state, code, 'credit'), 'runner');
    case '36022': // Read-Write Share: a card in the grip parked for a fresh draw each turn, 4 at most
      return perTurn(state, 0.3 * cardRate(state, 'runner'), 'runner', 0, 4);
    case '36023': // Sipa: a swap of fully broken outer ice, now and then
      return perTurn(state, 0.2, 'runner');
    case '36024': { // Stowaway: 2 credits on each successful run on its host's server
      const server = card?.hostedOnId ? Object.values(state.corp.servers).find(s => s.ice.some(i => i.instanceId === card.hostedOnId)) : undefined;
      const share = !server ? 0.25 : server.id === 'hq' ? PACE.hqShare : server.id === 'rd' ? PACE.rdShare : server.id === 'archives' ? PACE.archivesShare : PACE.remoteShare;
      return perTurn(state, PACE.runs * share * runSuccess(state, server?.id ?? 'hq') * 2, 'runner', 0, Infinity, 1, lock());
    }
    case '36025': // Word on the Street: a tax on fast advances, then 4 credits and a card when the Corp scores a card it installed earlier
      return 0.6 * (4 + cardRate(state, 'runner')) + 0.5;
  }
  return undefined;
}

/** Share of a side's decklist matching a keyword (null: any), and a card type. */
function deckShare(state: GameState, side: 'corp' | 'runner', keywords: RegExp | null, type?: string): number {
  const cards = sideCards(state, side);
  const hits = cards.filter(c => (!type || cardDef(c).type_code === type) && (!keywords || keywords.test(cardDef(c).keywords ?? ''))).length;
  return cards.length ? hits / cards.length : 0;
}

/** Copies in a side's decklist matching a test. */
const deckCount = (state: GameState, side: 'corp' | 'runner', test: (c: CardInstance) => boolean): number => sideCards(state, side).filter(test).length;

/** Worth of one counter of a type on a card, priced against the board (counterValues.ts), for a card not installed yet. */
function counterWorthOf(state: GameState, code: string, type: 'credit' | 'virus' | 'power'): number {
  return COUNTER_WORTH[code]?.[type]?.(state, { cardCode: code, instanceId: 'probe', tokens: {} } as unknown as CardInstance) ?? 1;
}

/** The cards priced by the formulas above (for the audit). */
export const EFFECT_CODES = [
  '35051', '35082', '30004', '30017', '30007', '30008', '30014', '30024', '30033', '35010', '35029', '35034', '30018', '35031',
  '35050', '30045', '30061', '35061', '35073', '35062', '30053', '35039', '30058', '30050', '30066', '30042', '35045', '35056',
  '35006', '30003', '35018', '30013', '30022', '35027', '35028', '35019', '30023', '30031', '35030', '35007', '35033', '30009', '35021', '35011', '30034',
  '36027', '36035', '36038', '36045', '36048', '36049', '36055', '36057', '36064', '36065',
  '36003', '36005', '36006', '36007', '36008', '36013', '36014', '36015', '36016', '36020', '36021', '36022', '36023', '36024', '36025',
];

/** Whether the effect formulas price cards (plan.effectValues). */
export const effectsOn = (): boolean => !!tuning.plan.effectValues;

/**
 * Value hacks replaced by the model (Jeff, 2026-10-28; plan.modelHacks).
 * Each returns credits.
 */

/** Worth of a Corp root card once rezzed, less its rez cost (rez decisions on the Corp's own turn). */
export function rezzedWorth(state: GameState, card: CardInstance, rezCost: number): number {
  switch (card.cardCode) {
    case '35061': // Idiosyncresis: each counter is 3 credits and 2 off the Runner when it fires
      return card.advancementCounters * 5 - rezCost;
    case '30061': // Clearinghouse: 1 meat damage per counter when it fires
      return card.advancementCounters > 0 ? damageWorth(state, card.advancementCounters) - rezCost : -1;
  }
  const fx = corpEffect(state, card.cardCode);
  return fx ? fx.keep - rezCost : -1;
}

/**
 * Cards that do their work during a run (Manegarm, Anoetic Void, AMAZE, Mitra
 * Aman): the Corp can rez them in a paid ability window of the run itself
 * (rules 3.3.2, 3.6.3; paid ability windows of the run, 6.9.2–6.9.4), so rezzing them sooner only spends the money
 * and shows them to the Runner.
 */
export function runTimed(card: CardInstance): boolean {
  return /Whenever (?:the Runner (?:approaches|passes|encounters|steals|accesses|breaches)|a run on this server)|When the Runner (?:approaches|breaches|accesses)/i.test(cardDef(card).stripped_text ?? '');
}

/** Worth of an ice's "when rezzed during a run" effect (Ping: a tag). */
export function rezEffectWorth(card: CardInstance, tagWorth: number): number {
  const tags = (cardDef(card).stripped_text ?? '').match(/When you rez this ice during a run[^.]*give the Runner (\d+) tag/i);
  return tags ? Number(tags[1]) * tagWorth : 0;
}

/** Worth of one more advancement counter on a piece of ice that grows with them (Pharos, Syailendra). */
export function iceAdvanceWorth(state: GameState, card: CardInstance, iceCostAt: (counters: number) => number): number {
  const left = 3 - card.advancementCounters;
  if (left <= 0) return 0;
  if (card.cardCode === '35076') {
    // Syailendra at 3: each encounter places a counter (a click and a credit) on a card we can advance
    return perTurn(state, 0.3 * (CLICK + 1), 'corp') / left;
  }
  return Math.max(0, iceCostAt(3) - iceCostAt(card.advancementCounters)) / left;
}

/** Worth of an advancement counter placed by an effect (Sericulture, Syailendra) on this card. */
export function placedCounterWorth(state: GameState, card: CardInstance, iced: boolean): number {
  const def = cardDef(card);
  if (def.type_code === 'agenda') {
    const points = def.agenda_points ?? 1;
    const share = (pointValue(state.corp.score + points) - pointValue(state.corp.score)) / Math.max(1, def.advancement_cost ?? 3);
    return iced ? share : 0.3 * share;
  }
  // Traps: an advanced card reads as an agenda and draws a run (about a third of the time, a click and 2 credits wasted)
  const bluff = /ambush|hostile/i.test(def.keywords ?? '') ? 0.3 * (CLICK + 2) : 0;
  if (card.cardCode === '30045') return bluff + 0.5 * (damageWorth(state, 3 + card.advancementCounters) - damageWorth(state, 2 + card.advancementCounters)); // Urtica: 1 more net damage
  if (card.cardCode === '35061') return 0.6 * 5; // Idiosyncresis
  if (card.cardCode === '30061') return bluff + 0.6 * damageWorth(state, 1); // Clearinghouse
  return 0.3;
}

/** Petty Cash comes back from Archives for its 5 credits and the click back: worth its net 2 credits again, a turn later. */
export const PETTY_CASH_REPLAY = 2 * 0.85;

/** Top-Down Solutions: 2 cards and up to 2 installs that cost no click, for its click. */
export function topDownWorth(installable: number, state?: GameState): number {
  return 2 * cardRate(state, 'corp') + Math.min(2, installable) * CLICK - CLICK;
}
