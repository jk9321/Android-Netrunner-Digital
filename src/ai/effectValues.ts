import { CardInstance, GameState, cardDef, getCardDefinition, knownInHand } from '../core';
import { turnsLeft } from './cardProfiles';
import { PAYOUT_RISK } from './payoutRisk';
import { COUNTER_WORTH } from './counterValues';
import { CARDS, advancePayloadOf, corpFormula, runnerFormula } from './cards';
import { actingSide } from './synergy';
import { CLICK, RATES, cardRate, flatlineWorth, memo, pointGain, pointValue, scopeToGame, sideCards } from './valueModel';
import { tagsWorth } from './evaluate';
import { BLOCK, iceCost, iceCreditNeed, isTrap, plannedSubroutines, subroutineCost } from './runs';
import { remoteRunChance, threatOn } from './threatModel';
import { plan, pricing, withPricing } from './pricing';
import { REZ_NOW_SHARE, rezBudget } from './iceValues';

/**
 * The every-card audit's last 31 cards (Jeff, 2026-10-28): assets, upgrades
 * and Runner rig cards whose worth was a hand-set number, now worked out in
 * the model's units (credits) from what each card does: credits, cards and
 * clicks it gains or saves, tags and damage it deals, accesses it adds,
 * spread over the turns left. Guesses about how often something happens
 * (runs on HQ a turn, agendas scored or stolen a turn) are named constants
 * from self-play logs. tests/effectValues.test.ts works each card through.
 * Behind plan.effectValues; the hand-set numbers in cardValues.ts stay for
 * when it is off. Each card's formula is its `corp` or `runner` entry in its
 * set's file in src/ai/cards/ (2026-11-03); the shared pieces stay here.
 */

/**
 * How often things happen, per Runner turn, in self-play. Measured averages,
 * not guesses (Jeff, 2026-10-28): runs, shares, success, agenda events and
 * rezzes from scripts/pace.ts (re-measured with Vantage Point: 1,980 games over
 * every deck at 974c6b6, 27,128 Runner turns; before, 2,210 games at b72eb3d);
 * the rest from the behaviour logs. Re-measure after every Corp or Runner AI change.
 */
export const PACE = {
  /**
   * Runs a turn (1.01) and the share of them on HQ, R&D, Archives and a remote. Runs: beta 34391e2 with scripts/pace.ts,
   * 2,210 games, 31,878 Runner turns (docs/batch-logs/2026-11-06-pace-report-beta-34391e2.txt). Shares: where the AI's
   * runs really go, 23,039 runs in 1,280 self-play games over every deck (scripts/run-odds.ts,
   * docs/batch-logs/2026-11-05-run-odds-report-v2-run-log.txt).
   */
  runs: 1.01,
  hqShare: 0.18,
  rdShare: 0.21,
  archivesShare: 0.05,
  remoteShare: 0.56,
  /** Share of runs on R&D while Conduit is installed (844 runs measured, 2026-10-28). */
  conduitRdShare: 0.19,
  /** Share of runs that succeed (beta 34391e2, as runs). */
  success: 0.77,
  /**
   * Runner turns that breach Archives while it holds facedown cards (10.4% of 1,471 such turns in 221 games at beta
   * 34391e2, scripts/pace.ts): twice the average Archives run rate, as the Runner goes where cards are. An agenda
   * discarded to Archives is priced on this, not the average Archives run (evaluate.ts archivedAgendaLoss).
   */
  facedownBreach: 0.1,
  /** Turns the Runner steals or trashes a Corp card, and trashes something it pays for. */
  stealOrTrash: 0.35,
  paidTrashes: 0.3,
  /** Agendas scored or stolen a Runner turn, both sides together (beta 34391e2, as runs). */
  agendaEvents: 0.31,
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
export const virusWait = (): number => VIRUS_WAIT;

/**
 * Conduit (Jeff, 2026-10-28): each counter is one more card accessed on
 * every Conduit run still to come, so a counter is worth an access times
 * the successful Conduit runs left.
 */
export function conduitCounterWorth(state: GameState): number {
  let runsLeft = 0;
  for (let t = 1; t < Math.max(2, turnsLeft(state)); t++) runsLeft += PACE.runs * PACE.conduitRdShare * runSuccess(state, 'rd') * LOCKDOWN ** (t - 1);
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
  // Hidden information (rules 10.2.2a): deciding for the Corp, only the grip programs it has been shown count (knownInHand,
  // as oracle.ts corpSeenGrip reads it with the oracles off; read here directly so effectValues gains no AI import edge)
  const seen = actingSide() === 'corp' ? new Set(knownInHand(state, 'runner').map(k => k.id)) : undefined;
  const grip = state.runner.grip
    .filter(c => cardDef(c).type_code === 'program' && (!seen || seen.has(c.instanceId)))
    .reduce((n, c) => n + (cardDef(c).memory_cost ?? 0), 0);
  return state.runner.memoryUnitsUsed + grip > BASE_MU ? 2 * MU : MU;
}

/** Worth of `x` each turn for the turns left, less the risk of losing the card each turn. */
export function perTurn(state: GameState, x: number, owner: 'corp' | 'runner', minTurns = 0, maxTurns = Infinity, wait = 1, lock = 1): number {
  // plan.ownTrashRisk: the Corp's own trash action is no risk the Corp prices (it decides it)
  const tagRisk = state.runner.tags > 0 && !(plan().ownTrashRisk && actingSide() === 'corp');
  const risk = owner === 'corp' ? PAYOUT_RISK.corpBare : tagRisk ? PAYOUT_RISK.runnerTagged : PAYOUT_RISK.runnerUntagged;
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
/** Rezzed ice the Runner walks through, taking its subroutines (it has none that end the run, or it breaks those). */
const TANKED_PASS = 0.85;
/**
 * The Runner tanks an ice's subroutines on the way to an agenda when it can pay to break the ones
 * that end the run and the rest cost it less than half the agenda is worth to it (net damage
 * priced on the damage clock, so a small grip won't take it).
 */
function canTank(state: GameState, ice: CardInstance, credits: number): boolean {
  if (iceCreditNeed(state, ice) > credits) return false;
  const tank = plannedSubroutines(state, ice).map(s => subroutineCost(state, s.label)).filter(c => c < BLOCK).reduce((n, c) => n + c, 0);
  return tank < 0.5 * pointGain(state.runner.score, agendaOdds(state).points);
}

/** Unrezzed ice: the Corp rezzes it when it can afford to, about half the time. */
const UNREZZED_PASS = { rich: 0.55, broke: 0.9 };

/** Ice is being priced against the rig (pricing context): run odds are the flat guesses inside. */
export const pricingIce = (): boolean => pricing().pricingIce;

/** Chance a run on `serverId` succeeds now, from its ice against the rig and the Runner's credits (PACE.success while plan.runOpenness is off). */
export function runSuccess(state: GameState, serverId: string): number {
  const server = state.corp.servers[serverId];
  // Pricing the ice can come back here (a subroutine that trashes a card prices the rig): the guess, inside
  if (!server || pricingIce()) return PACE.success;
  return memo(state, 'runSuccess:' + serverId, () => {
    // The rez budget outside the guard: the same memo entry the leaf's ice pricing already filled
    const ice = ownIce(state, server);
    return withPricing({ pricingIce: true }, () => passOdds(state, ice));
  });
}

/**
 * runSuccess with some of the server's ice bypassed (rules 6.5.8a: bypassed ice is passed, its subroutines never
 * resolve): Alarm Clock's free HQ run in the threat (plan.alarmClockThreat).
 */
export function runSuccessBypassing(state: GameState, serverId: string, bypassed: ReadonlySet<string>): number {
  const server = state.corp.servers[serverId];
  if (!server || pricingIce()) return PACE.success;
  return withPricing({ pricingIce: true }, () => passOdds(state, server.ice.filter(ice => !bypassed.has(ice.instanceId))));
}

/**
 * plan.ownIceKnown (bug reports #39 and #41, Jeff's Runner test games 7 and 9, 2026-11-09; Corp only): the Corp prices its
 * OWN unrezzed ice as it knows it, not by the Runner-side pass rates (UNREZZED_PASS: what a Runner meets
 * when it can't see the ice). Ice its rez budget covers now (iceValues rezBudget: one pool, best stop first) is priced as
 * the real ice against the rig, since the Corp can rez it as it is approached (rules 3.4.3a, 6.9.2b); ice the budget
 * doesn't cover stays unrezzed and is passed (6.9.2c). (Moved here from reach.ts knownIce, its one live reader, when
 * plan.reach and its K2/K3 pieces were deleted in audit Step 3.)
 */
function ownIce(state: GameState, server: GameState['corp']['servers'][string]): CardInstance[] {
  if (!plan().ownIceKnown || !server.ice.some(ice => !ice.isRezzed)) return server.ice;
  const budget = rezBudget(state, true);
  return server.ice.flatMap(ice => {
    if (ice.isRezzed) return [ice];
    const share = budget.get(ice.instanceId);
    return share !== undefined && share >= REZ_NOW_SHARE ? [{ ...ice, isRezzed: true }] : [];
  });
}

/** iceCost behind the re-entry guard. */
export function priceIce(state: GameState, ice: CardInstance): number {
  return withPricing({ pricingIce: true }, () => iceCost(state, ice));
}

/** passOdds for a server's ice, behind the re-entry guard (scripts/threat-calibration.ts). */
export function passOddsOf(state: GameState, serverId: string): number {
  const server = state.corp.servers[serverId];
  if (!server) return 0;
  return withPricing({ pricingIce: true }, () => passOdds(state, server.ice));
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
    } else if (canTank(state, ice, credits)) {
      // Ice that can't end the run (Doomscroll) doesn't stop a Runner who can take what it does (Jeff, 2026-10-30)
      credits -= iceCreditNeed(state, ice);
      pass *= TANKED_PASS;
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
  if (!server || pricingIce()) return run * PACE.success;
  // On the Runner's own turn: the clicks it has left, one kept for the run
  const coming = state.activePlayer === 'runner' ? Math.max(0, Math.min(income, state.runner.clicks - 1)) : income;
  return memo(state, `stealOdds:${serverId}:${run}:${coming}`, () => {
    // Outside the ice-pricing guard: the threat prices runs with the ice priced in full
    const chance = threatOn() ? remoteRunChance(state, serverId) : undefined;
    const ice = ownIce(state, server);
    return withPricing({ pricingIce: true }, () => {
      // plan.threatModel (structural review item 3): the chance the Runner runs it next turn is the Runner's own run
      // scorer budgeted over its turn (threatModel.ts), times its ice against the rig; an open remote it can see is run
      // by construction, so openSteal falls out
      if (chance !== undefined) return chance * passOdds(state, ice, coming);
      // Jeff: nothing stops the Runner checking an open remote, so an agenda there is as good as stolen (plan.openSteal)
      if (plan().openSteal && server.isRemote && server.ice.length === 0) return 1;
      return run * passOdds(state, ice, coming);
    });
  });
}

/** Successful runs a turn on the centrals, by the share of runs each gets. */
export const centralSuccess = (state: GameState): number => PACE.hqShare * runSuccess(state, 'hq') + PACE.rdShare * runSuccess(state, 'rd');

/** Average success of a run anywhere (remotes at their typical share). */
export function anySuccess(state: GameState): number {
  const remotes = Object.values(state.corp.servers).filter(s => s.isRemote);
  const remote = remotes.length ? Math.max(...remotes.map(s => runSuccess(state, s.id))) : runSuccess(state, 'hq');
  return centralSuccess(state) + PACE.remoteShare * remote;
}

/** The lock-down per turn while plan.runOpenness is on. */
export const lock = (): number => LOCKDOWN;

/** Chance a Corp card the Runner hasn't seen is an agenda, and the points of a typical agenda (decklist). */
export function agendaOdds(state: GameState): { odds: number; points: number } {
  return memo(state, 'agendaOdds', () => countAgendaOdds(state));
}

function countAgendaOdds(state: GameState): { odds: number; points: number } {
  const corp = sideCards(state, 'corp');
  const agendas = corp.filter(c => cardDef(c).type_code === 'agenda');
  // plan.unseenOdds (Gemini's decking analysis, 2026-11-06): installed ice (faceup or not, its position shows it is ice)
  // and rezzed root cards are seen not to be agendas, so they leave the pool too; counted in, they cut late-game odds
  // to about two thirds (0.16 against 0.22 with 18 cards still hidden)
  const board = Object.values(state.corp.servers).flatMap(s => [...s.ice, ...s.root.filter(c => c.isRezzed)]);
  const seen = plan().unseenOdds ? board.length : 0;
  const unseen = corp.length - state.corp.scoreArea.length - state.runner.scoreArea.length - state.corp.archives.faceUp.length - seen;
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
  // plan.spareLastClick: with no click left the Runner can't run again this turn, so cards over its hand size are
  // discarded before they can soak up any damage (it drew to 6 with its last click and discarded, for +6)
  const spent = state.activePlayer === 'runner' && !state.activeRun && state.runner.clicks === 0;
  const held = spent ? Math.min(state.runner.handSizeLimit ?? 5, state.runner.grip.length) : state.runner.grip.length;
  if (n > held) return flatlineWorth(state);
  const card = cardRate(state, 'runner');
  // The damage clock: the cards, and the step closer to a flatline the smaller grip leaves
  // Cards over the hand limit are discarded before the Corp's turn: they are no life against its damage
  const grip = held;
  return n * card + flatlineWorth(state) * (flatlineOdds(state, lifeGrip(state, grip - n, false)) - flatlineOdds(state, lifeGrip(state, grip, false)));
}

/**
 * The grip that will stand against the Corp's damage on its turn: at most the hand size limit (the rest is discarded
 * first). plan.drawBackLife (Jeff, 2026-11-04: the Runner hoarded Sure Gamble): on the Runner's own turn, outside a run,
 * each click left can draw a card back, so a card played now isn't a card less against the next Corp turn yet.
 * Not for damage taken in a run (damageWorth): counting clicks there made every click spent cost life (a click for a
 * credit at 2 cards scored -5.8 against a damage deck).
 */
export function lifeGrip(state: GameState, grip = state.runner.grip.length, drawBack = true): number {
  const limit = state.runner.handSizeLimit ?? 5;
  const back = drawBack && state.activePlayer === 'runner' && !state.activeRun ? state.runner.clicks : 0;
  return Math.min(limit, grip + back);
}

/** Damage a Corp card can deal in one go, from its text ("plus 1 ... for each" counts 2 more). */
function cardDamage(code: string): number {
  const text = getCardDefinition(code).stripped_text ?? '';
  let most = 0;
  for (const m of text.matchAll(/[Dd]o (\d+) (?:net|meat|core) damage( plus 1 (?:net |meat )?damage for each)?/g)) most = Math.max(most, Number(m[1]) + (m[2] ? 2 : 0));
  return most;
}

const threats = new Map<string, { burst: number; share: number }>();
/** damageThreat's on-hit audit (test-only): with `on`, every value served from the map is worked out again and compared. */
export const threatsAudit = { on: false, checked: 0, mismatches: 0, errors: [] as number[], burstErrors: 0 };
/** Empties damageThreat's map (test-only: scripts/cache-bisect.ts). */
export const clearDamageThreats = (): void => threats.clear();

/**
 * The Corp's damage threat (the damage clock, Jeff 2026-10-28): the biggest
 * hit one of its cards can still deal, and the share of its cards that deal
 * damage, from the decklist less what is scored or trashed faceup.
 */
export function damageThreat(state: GameState, corpTurn = false): { burst: number; share: number } {
  // plan.corpTurnDamage (Jeff, 2026-11-06, his Teia game: the Runner held Sure Gamble at 7 credits): on the Corp's turn
  // ice deals no damage (it hits only in the Runner's own runs, rule 6.9, which damageWorth prices when they happen), so
  // the clock left after the Runner's turn counts the Corp's other cards only. With ice, Attini, Boto, Cloud Eater and
  // Empiricist made a 3-damage threat out of a fifth of the deck: playing Sure Gamble from 4 cards cost 6 of flatline odds.
  const skipIce = corpTurn;
  // plan.corpTurnDamageOwn: on the Corp's turn only damage the Corp deals itself (see ownTurnHit)
  const own = corpTurn && plan().corpTurnDamageOwn;
  const tagged = state.runner.tags > 0;
  const key = `${state.id}:${state.corp.archives.faceUp.length}:${state.corp.scoreArea.length}:${state.runner.scoreArea.length}:${skipIce}:${own}:${own && tagged}`;
  // Audit Step 2 (AI-CACHE-HIDDEN-STATE): keyed by how many cards are out of the pool, not which (nor a look-ahead's added
  // or doubled card), so some hits are another board's value (about a third: threatsAudit); an exact (per-position)
  // version cost decision time, so the map is kept to one game and never depends on the games played before it
  scopeToGame(threats, state);
  const cached = threats.get(key);
  if (cached && !threatsAudit.on) return cached;
  const gone = new Set([...state.corp.archives.faceUp, ...state.corp.scoreArea, ...state.runner.scoreArea].map(c => c.instanceId));
  const live = sideCards(state, 'corp').filter(c => !gone.has(c.instanceId));
  const hits = live
    .filter(c => !skipIce || cardDef(c).type_code !== 'ice')
    .map(c => (own ? ownTurnDamage(state, c.cardCode) : cardDamage(c.cardCode)))
    .filter(n => n > 0);
  const threat = { burst: hits.length ? Math.max(...hits) : 0, share: live.length ? hits.length / live.length : 0 };
  if (cached) {
    // The audit (test-only, tests/handCacheAudit.test.ts): a value served from the map, worked out again on the asking board
    threatsAudit.checked++;
    if (cached.burst !== threat.burst || cached.share !== threat.share) {
      threatsAudit.mismatches++;
      threatsAudit.errors.push(Math.abs(cached.share - threat.share));
      if (cached.burst !== threat.burst) threatsAudit.burstErrors++;
    }
    return cached;
  }
  if (threats.size > 200) threats.clear();
  threats.set(key, threat);
  return threat;
}

/**
 * plan.corpTurnDamageOwn (bug report #44, Jeff's Runner test game 12, 2026-11-09): the damage a card can deal on the Corp's
 * own turn, from its card entry (CardAI corpTurnDamage: 0 for damage on access, rules 7.1.3 and 7.2.1, or during the
 * Runner's runs; Orbital Superiority's 4 meat only while the Runner is tagged), else from its text. Counted from the text,
 * Urtica Cipher and an untagged Runner's Orbital Superiority made a 4-damage burst: a Runner left on 1 card in grip was
 * worth 33 points of flatline to the Corp.
 */
function ownTurnDamage(state: GameState, code: string): number {
  const own = CARDS[code]?.corpTurnDamage;
  if (own === undefined) return cardDamage(code);
  return typeof own === 'function' ? own(state) : own;
}

/**
 * Chance the Corp flatlines a Runner holding `grip` cards before it can
 * draw back up: near 1 once the grip is below the Corp's biggest hit,
 * falling off over a card or two above it, and only as likely as the Corp
 * is to have a damage card to hand (rule 10.4.4: flatlined on damage beyond the grip).
 */
/** Share of damage threats the Corp gets to land. */
export const FLATLINE_LANDS = 0.5;

export function flatlineOdds(state: GameState, grip: number, corpTurn = false): number {
  const { burst, share } = damageThreat(state, corpTurn);
  if (burst === 0) return 0;
  // The Corp has to draw the card and land the hit (the Runner has to access or encounter it): about half the time when it holds one
  const presence = Math.min(1, 4 * share) * FLATLINE_LANDS;
  return presence / (1 + Math.exp((grip + 0.5 - burst) / 1.2));
}

/** Share of turns a hand slot lost to core damage holds a card the Runner would have kept (a named guess). */
export const CORE_SLOT_USE = 0.5;

/** Worth of a hand slot already lost to core damage (plan.flatRates.coreDamage; the damage clock already reads the lower limit). */
export function coreSlotWorth(state: GameState): number {
  return CORE_SLOT_USE * cardRate(state, 'runner');
}

/**
 * Worth of one more core damage beyond the card it discards (rule 5.5.3b:
 * core damage also lowers the Runner's hand size for the rest of the game):
 * the slot, and the damage clock at a full hand with the limit one lower.
 */
export function coreDamageWorth(state: GameState): number {
  const limit = state.runner.handSizeLimit ?? 5;
  const clock = Math.max(0, flatlineOdds(state, limit - 1, true) - flatlineOdds(state, limit, true));
  return coreSlotWorth(state) + flatlineWorth(state) * clock;
}

/** A flatline ends the game: priced like half of a whole game of agenda points (plan.flatRates.flatline off; valueModel flatlineWorth). */
export const FLATLINE = 4 * RATES.point;

export interface CorpEffect {
  /** Worth to the Corp once installed (and the Runner's gain from trashing it). */
  keep: number;
  /** Worth of installing it in its own remote for money or cards (econ assets only). */
  econ?: number;
  /** Upgrades: [in a scoring remote, on HQ or R&D]. */
  upgrade?: [number, number];
}

/** Corp assets and upgrades, in credits: each card's formula is its `corp` entry in src/ai/cards/. */
export function corpEffect(state: GameState, code: string, rezzed = false): CorpEffect | undefined {
  // A rezzed card's rez cost is paid already (plan.rezPaid; Gemini audit, 2026-11-01: rezzedWorth took it off twice)
  const cost = rezzed ? 0 : getCardDefinition(code).cost ?? 0;
  const agenda = pointGain(state.corp.score, agendaOdds(state).points);
  const card = cardRate(state, 'corp');
  const tag = tagsWorth(state, 'corp', 1);
  return corpFormula(state, code, { cost, agenda, card, tag });
}

/** Runner rig cards that aren't icebreakers, in credits, installed: each card's `runner` entry in src/ai/cards/. */
export function runnerEffect(state: GameState, code: string, card?: CardInstance): number | undefined {
  return runnerFormula(state, code, card);
}

/** Share of a side's decklist matching a keyword (null: any), and a card type. */
export function deckShare(state: GameState, side: 'corp' | 'runner', keywords: RegExp | null, type?: string): number {
  const cards = sideCards(state, side);
  const hits = cards.filter(c => (!type || cardDef(c).type_code === type) && (!keywords || keywords.test(cardDef(c).keywords ?? ''))).length;
  return cards.length ? hits / cards.length : 0;
}

/** Copies in a side's decklist matching a test. */
export const deckCount = (state: GameState, side: 'corp' | 'runner', test: (c: CardInstance) => boolean): number => sideCards(state, side).filter(test).length;

/** Worth of one counter of a type on a card, priced against the board (counterValues.ts), for a card not installed yet. */
export function counterWorthOf(state: GameState, code: string, type: 'credit' | 'virus' | 'power'): number {
  return COUNTER_WORTH[code]?.[type]?.(state, { cardCode: code, instanceId: 'probe', tokens: {} } as unknown as CardInstance) ?? 1;
}

/** The cards priced by the formulas (for the audit): built from src/ai/cards/. */
export { EFFECT_CODES } from './cards';

/** Whether the effect formulas price cards (plan.effectValues). */
export const effectsOn = (): boolean => true;

/**
 * What replaced the old value hacks (Jeff, 2026-10-28; the hacks were deleted 2026-11-06).
 * Each returns credits.
 */

/** Worth of a Corp root card once rezzed, less its rez cost (rez decisions on the Corp's own turn). */
export function rezzedWorth(state: GameState, card: CardInstance, rezCost: number): number {
  const own = CARDS[card.cardCode]?.rezzed;
  if (own) return own(state, card, rezCost);
  const fx = corpEffect(state, card.cardCode, true);
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

/**
 * A trap the Runner has accessed (spec-jeff-games-48-50.md Part D; card.runnerKnows): the Runner saw it (7.1.2) and
 * learned it through a rule (10.2.2b), and the Corp saw that access too, so it knows the Runner knows. Advancing it no
 * longer reads as an agenda, and the Runner has no reason to access it again. Read by placedCounterWorth and corpAI's
 * install scoring (trap roots).
 */
export const knownTrap = (card: CardInstance): boolean => !!card.runnerKnows && isTrap(card.cardCode);

/** Worth of an advancement counter placed by an effect (Sericulture, Syailendra) on this card. */
export function placedCounterWorth(state: GameState, card: CardInstance, iced: boolean): number {
  const def = cardDef(card);
  if (def.type_code === 'agenda') {
    const points = def.agenda_points ?? 1;
    const share = (pointValue(state.corp.score + points) - pointValue(state.corp.score)) / Math.max(1, def.advancement_cost ?? 3);
    return iced ? share : 0.3 * share;
  }
  // Traps: an advanced card reads as an agenda and draws a run (about a third of the time, a click and 2 credits wasted)
  // A known trap (knownTrap: 7.1.2, 10.2.2b) draws no run: no bluff, and nothing from being accessed again (Urtica's
  // damage). A trap whose counters are its turn-start effect (advancePayload: Clearinghouse) keeps that effect.
  const known = knownTrap(card);
  const bluff = /ambush|hostile/i.test(def.keywords ?? '') && !known ? 0.3 * (CLICK + 2) : 0;
  if (known && !advancePayloadOf(card.cardCode)) return 0;
  if (card.cardCode === '30045') return bluff + 0.5 * (damageWorth(state, 3 + card.advancementCounters) - damageWorth(state, 2 + card.advancementCounters)); // Urtica: 1 more net damage
  if (card.cardCode === '35061') return 0.6 * 5; // Idiosyncresis
  // Clearinghouse: the counter's step in damage
  if (card.cardCode === '30061') return bluff + 0.6 * damageWorth(state, 1);
  return 0.3;
}

/** Petty Cash comes back from Archives for its 5 credits and the click back: worth its net 2 credits again, a turn later. */
export const PETTY_CASH_REPLAY = 2 * PAYOUT_RISK.wait;

/** Top-Down Solutions: 2 cards and up to 2 installs that cost no click, for its click. */
export function topDownWorth(installable: number, state?: GameState): number {
  return 2 * cardRate(state, 'corp') + Math.min(2, installable) * CLICK - CLICK;
}
