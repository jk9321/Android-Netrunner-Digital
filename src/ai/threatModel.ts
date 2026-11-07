import { CardInstance, GameState, cardDef, createRng, knownInHand, shuffleInPlace } from '../core';
import { corpCardValue } from './evaluate';
import { runSuccess } from './effectValues';
import { unseenInHand } from './handValues';
import { BLOCK, RunnerMemory, iceCost, runClick, runCreditSpend, runScore, serverValue } from './runs';
import { asSide, sideOff, tuning } from './synergy';
import { fingerprint, memo, pointGain, sideCreditValue } from './valueModel';

/**
 * The Corp's threat model (structural review item 3, 2026-11-07; plan.threatModel): where the Runner will run on its
 * next turn, read from the Runner AI's own run scorer on the board as the Runner sees it, instead of the self-play
 * constants (PACE shares, STEAL.run) and the two-sample Runner reply at the planner leaf.
 *
 * Jeff's 13 Corp games showed the rates are the Runner's answer to the Corp's board, not properties of the Runner: the
 * same Runner AI ran 1.35 times a turn against him (1.01 in self-play), 40% of them at R&D (21%), and never stole from
 * his HQ (scripts/human-pace.ts). So the Corp asks the Runner's question for every server and budgets the Runner's turn:
 *
 * - The turn: the clicks it will have (rule 5.7.1a: its allotted clicks; a Caveat Emptor change counts) and its
 *   credits now.
 * - Click by click, the Runner AI's arithmetic: the best run by runScore (its breach worth less the ice it expects to
 *   pay and the click) against its always-there click (rule 5.2.7b: a click for a credit) as the Runner AI scores it; a
 *   run that beats it is made and its credits charged (runCreditSpend), else that click is taken (a broke Runner clicks
 *   for credits, then runs). Each server once: a second run on it is what serverValue's repeat discounts, and without
 *   the first breach's accesses the Corp can't see more. Installs and events from the grip are not foreseen (the
 *   grip is hidden): the calibration's largest gap.
 * - Two servers within a credit of each other: the Runner could go either way, so the Corp counts the one that costs it
 *   more (its own cards: what it stands to lose, never what the Runner can see).
 *
 * The output is a chance per server: 1 for the servers the budget runs, 0 for the rest. Deterministic: the same board
 * gives the same threat, so the planner's candidates are compared on the board, not on sampling noise.
 *
 * No peeking (the spec's first review check). The scorer runs with the Runner's plan (asSide), on a view of the board:
 * unrezzed ice is iceCost's guess (1.5 or 0.5 by the Corp's credits), facedown root cards are agendaOdds/
 * remoteAgendaOdds, both pooled over every card the Runner hasn't seen; what the Runner remembers is what it accessed
 * (card.runnerKnows: rule 7.1.2, the Corp may look at accessed cards outside R&D). The Runner's grip is hidden
 * from the Corp (rule 10.2.2a hidden information; its size is open, 10.2.3a): the view deals it from the Runner's unseen cards (grip and stack
 * together, in a fixed order) with a seed fixed for the turn, keeping the cards the Corp has seen, so the hand count
 * is right and nothing in it is real. tests/threatModel.test.ts pins both swaps.
 */

export interface ServerThreat {
  /** Chance the Runner runs this server on its next turn (0 or 1 by the budget). */
  run: number;
  /** The Runner's own score for the run at the turn's start (runScore, credits; -Infinity when it can't get in or there is nothing to take). */
  score: number;
  /** Chance the run gets in (runSuccess: its ice against the rig, as the Corp prices it). */
  success: number;
}

export interface Threat {
  servers: Record<string, ServerThreat>;
  /** Runs the budget makes in the turn. */
  runs: number;
  /** The order the budget ran them in. */
  order: string[];
  /** The Runner's credits at the budgeted turn's end: after the runs it paid into and the credit clicks it took. */
  endCredits: number;
}

/** A credit within which the Runner's choice between two servers is a coin the Corp can't see. */
const TIE = 1;

/** True while the threat is being worked out: the Runner's scorer must not ask for the threat again. */
let computing = 0;

/** The threat is read only by the Corp, with the switch on, and never from inside its own computation. */
export const threatOn = (): boolean => !!tuning.plan.threatModel && tuning.plan.threatValues !== false && computing === 0;

/** What the Runner remembers of the Corp's installed cards: the ones it accessed and that stayed installed (rule 7.1.2: the Corp saw the access). */
export function runnerMemory(state: GameState): RunnerMemory {
  const memory: RunnerMemory = new Map();
  for (const server of Object.values(state.corp.servers)) for (const card of server.root) if (card.runnerKnows) memory.set(card.instanceId, card.cardCode);
  return memory;
}

/** A seed fixed for the game and turn: every candidate of one decision sees the same guessed grip. */
export function turnSeed(state: GameState): number {
  let h = 2166136261 ^ state.turnNumber;
  for (let i = 0; i < state.id.length; i++) h = Math.imul(h ^ state.id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The Runner's grip as the Corp can know it: the cards it has seen there (knownInHand) where they are, the rest dealt
 * from the Runner's unseen cards in a fixed order (by instance id, so which unseen card sat in the grip can't matter).
 */
function guessedGrip(state: GameState): { grip: CardInstance[]; stack: CardInstance[] } {
  const known = new Set(knownInHand(state, 'runner').map(k => k.id));
  const seen = state.runner.grip.filter(c => known.has(c.instanceId));
  const pool = [...state.runner.grip.filter(c => !known.has(c.instanceId)), ...state.runner.stack].sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));
  const unseen = shuffleInPlace(createRng(turnSeed(state)), pool);
  const n = state.runner.grip.length - seen.length;
  return { grip: [...seen, ...unseen.slice(0, n)], stack: unseen.slice(n) };
}

/** The board at the start of the Runner's next turn (or now, on its turn with clicks left), with its hidden cards as the Corp guesses them. */
export function runnerView(state: GameState): GameState {
  const { grip, stack } = guessedGrip(state);
  const runner = { ...state.runner, grip, stack };
  // On the Runner's turn, the clicks it has left; with none left (or the turn being over) its next turn is the threat
  if (state.activePlayer === 'runner' && state.runner.clicks > 0) return { ...state, runner, activeRun: null, pendingPrompts: [] };
  runner.clicks = Math.max(0, state.runner.maxClicks + (state.runner.bonusClicksNextTurn ?? 0));
  return { ...state, runner, activePlayer: 'runner', phase: 'runner_turn', runsThisTurn: [], turnFlags: {}, activeRun: null, pendingPrompts: [] };
}

/**
 * What a successful run on `serverId` costs the Corp on the next Runner turn, in the Runner's points on the clock (the
 * evaluate scale), for the pieces evaluate does not already price: HQ and R&D accesses (one each, rule 7.4.1b-c)
 * unless plan.oneCurrency's centralExposure prices them, and the remote cards the Runner can afford to trash (rule
 * 7.1.5: the trash cost paid on access). Remote agendas are agendaWorth's (its steal chance reads this threat) and
 * Archives agendas archivedAgendaLoss's.
 */
export function accessLoss(state: GameState, serverId: string): number {
  const corp = state.corp;
  const server = corp.servers[serverId];
  if (!server) return 0;
  if (serverId === 'hq' || serverId === 'rd') {
    if (tuning.plan.oneCurrency) return 0;
    const { hqNow, density } = centralAccess(state);
    return serverId === 'hq' ? hqNow : density;
  }
  if (!server.isRemote) return 0;
  // The credits left once the rezzed ice is paid for
  const toll = server.ice.reduce((n, ice) => n + (ice.isRezzed ? Math.min(iceCost(state, ice), BLOCK) : 0), 0);
  let credits = state.runner.credits - toll;
  let loss = 0;
  for (const card of server.root) {
    if (cardDef(card).type_code === 'agenda') continue;
    const trash = cardDef(card).trash_cost;
    if (trash == null || trash > credits) continue;
    credits -= trash;
    loss += Math.max(0, corpCardValue(card, state, 'corp'));
  }
  return loss;
}

/**
 * One access to HQ as it is and to a card the Corp can't place (R&D, or a card drawn in a look-ahead), in the Runner's
 * points on the clock: the agendas over the cards (centralExposure's pool, shared: the Corp knows what R&D holds but
 * not its order, and nothing about a card it drew in a look-ahead).
 */
export function centralAccess(state: GameState): { hqNow: number; density: number } {
  const unseen = unseenInHand(state, 'corp');
  return memo(state, `centralAccess:${unseen.map(c => c.instanceId).join(',')}`, () => {
    const corp = state.corp;
    const gain = (c: CardInstance) => (cardDef(c).type_code === 'agenda' ? pointGain(state.runner.score, cardDef(c).agenda_points ?? 1) : 0);
    const ids = new Set(unseen.map(c => c.instanceId));
    const pool = [...corp.rd, ...unseen];
    const density = pool.length ? pool.reduce((n, c) => n + gain(c), 0) / pool.length : 0;
    const known = corp.hq.filter(c => !ids.has(c.instanceId));
    const hqNow = corp.hq.length ? (known.reduce((n, c) => n + gain(c), 0) + unseen.length * density) / corp.hq.length : 0;
    return { hqNow, density };
  });
}

/**
 * Everything the threat reads, as a key: the same board met again in another look-ahead (the deck's average card prices
 * each agenda in R&D on every board a playout reaches, and the Hard AI re-deals hidden cards) is not budgeted again.
 * fingerprint covers credits, clicks, scores, sizes, rigs and installed cards; the rest is what it leaves out that the
 * Runner's scorer or the tie-break reads, and the plans (tests change them in place).
 */
function threatKey(state: GameState): string {
  const roots = Object.values(state.corp.servers).map(v => v.root.map(c => `${c.advancementCounters}${c.runnerKnows ? 'k' : ''}${c.faceUp ? 'u' : ''}`).join('.')).join(';');
  return [
    state.id, fingerprint(state), roots, state.corp.hq.map(c => c.instanceId).join(','), state.runner.grip.map(c => c.instanceId).join(','),
    state.runsThisTurn.map(r => r.server + (r.successful ? '+' : '-')).join(','), JSON.stringify(state.corp.rdKnownToRunner ?? []),
    knownInHand(state, 'runner').map(k => k.id).join(','), knownInHand(state, 'corp').map(k => k.id).join(','), state.runner.bonusClicksNextTurn ?? 0,
    planKey(),
  ].join('|');
}
let planSig: { plan: unknown; json: string } | null = null;
const planKey = (): string => {
  // The Corp's plan as it is now (tests flip switches in place, so the object alone won't do), with the Runner's own list
  const json = JSON.stringify(tuning.plan) + JSON.stringify(sideOff.runner) + tuning.wary;
  if (planSig?.json !== json) planSig = { plan: tuning.plan, json };
  return planSig.json;
};
const threatCache = new Map<string, Threat>();
const probeCache = new Map<string, number>();
const remember = <T>(cache: Map<string, T>, key: string, work: () => T): T => {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const value = work();
  if (cache.size > 4000) cache.clear();
  cache.set(key, value);
  return value;
};

/** The Runner's next turn as the Corp foresees it. */
export function threat(state: GameState): Threat {
  threatStats.calls++;
  return memo(state, 'threat', () => {
    threatStats.keyed++;
    const t0 = threatStats.timing ? performance.now() : 0;
    const key = threatKey(state);
    if (threatStats.timing) threatStats.keyMs += performance.now() - t0;
    return remember(threatCache, key, () => {
      threatStats.budgeted++;
      const t1 = threatStats.timing ? performance.now() : 0;
      computing++;
      try {
        return asSide('runner', () => budgetTurn(state));
      } finally {
        computing--;
        if (threatStats.timing) {
          const ms = performance.now() - t1;
          threatStats.budgetMs += ms;
          if (threatStats.inReply) {
            threatStats.replyBudgeted++;
            threatStats.replyBudgetMs += ms;
          }
        }
      }
    });
  });
}

/**
 * Diagnostics (scripts/threat-profile.ts): threat() calls, how many missed the state memo (keyed) and the board cache
 * (budgeted), their time, and the budgets made inside the Corp planner's played-out Runner reply.
 */
export const threatStats = { calls: 0, keyed: 0, budgeted: 0, keyMs: 0, budgetMs: 0, timing: false, inReply: false, replyBudgeted: 0, replyBudgetMs: 0 };

function budgetTurn(state: GameState): Threat {
  const memory = runnerMemory(state);
  const wary = !!tuning.wary;
  let view = runnerView(state);
  const servers: Record<string, ServerThreat> = {};
  for (const id of Object.keys(state.corp.servers)) servers[id] = { run: 0, score: -Infinity, success: runSuccess(state, id) };
  const order: string[] = [];
  const done = new Set<string>(view.runsThisTurn.map(r => r.server));
  // Nothing there for the Runner (an empty remote, an Archives with nothing to take): runScore can't rise above
  // -Infinity this turn (its breach worth is the same before any run), so it is not scored again each click
  for (const id of Object.keys(view.corp.servers)) if (!done.has(id) && serverValue(view, id, 0, memory, wary) <= 0) done.add(id);
  for (let step = 0; view.runner.clicks >= 1 && step < 8; step++) {
    const scored = Object.keys(view.corp.servers)
      .filter(id => !done.has(id))
      .map(id => ({ id, score: runScore(view, id, { memory, wary }) }));
    // The turn's first look (diagnostics: scripts/threat-calibration.ts)
    if (step === 0) for (const o of scored) servers[o.id].score = o.score;
    // Each click: the best run against the Runner's always-there click, both as the Runner AI scores them
    const fallback = fallbackClick(view);
    const options = scored.filter(o => o.score > fallback.score).sort((a, b) => b.score - a.score);
    if (!options.length) {
      if (!fallback.after) break;
      view = fallback.after;
      continue;
    }
    // Within a credit of the best, the Corp can't tell which the Runner takes: it counts its worst
    const close = options.filter(o => o.score >= options[0].score - TIE);
    const pick = close.length > 1 ? close.map(o => ({ o, loss: corpLoss(state, o.id) })).sort((a, b) => b.loss - a.loss)[0].o : options[0];
    servers[pick.id].run = 1;
    order.push(pick.id);
    done.add(pick.id);
    // The run's click and the credits it spends getting in
    const spent = runCreditSpend(view, pick.id);
    view = {
      ...view,
      runner: { ...view.runner, clicks: view.runner.clicks - 1, credits: Math.max(0, view.runner.credits - spent) },
      runsThisTurn: [...view.runsThisTurn, { server: pick.id, successful: true } as GameState['runsThisTurn'][number]],
    };
  }
  return { servers, runs: order.length, order, endCredits: view.runner.credits };
}

/**
 * The Runner's always-there click (rule 5.2.7b basic action: [click]: gain 1[credit]), scored the way the Runner AI's
 * evaluate prices it: the credit on its credit slide less the click (runClick: what its hand would do with the click).
 * A run is made when it beats that click, not when it beats nothing: a broke Runner clicks for credits first and runs
 * after, and late in a turn, rich, a credit click scores below 0 and the Runner AI runs on a run that does too
 * (scripts/threat-calibration.ts on Jeff's games: HQ and R&D runs at -0.5). The draw click is left out: its worth is
 * the deck's average card, which the Corp would price on the guessed stack, and it cost most of the threat's time.
 */
function fallbackClick(view: GameState): { score: number; after: GameState | null } {
  const credit = sideCreditValue({ ...view, runner: { ...view.runner, credits: view.runner.credits + 1 } }, 'runner', 'runner') - sideCreditValue(view, 'runner', 'runner');
  const after = { ...view, runner: { ...view.runner, clicks: view.runner.clicks - 1, credits: view.runner.credits + 1 } };
  return { score: credit - runClick(view), after };
}

/** What the Corp stands to lose on a run on `serverId`, its own cards known: for the tie between two servers only. */
function corpLoss(state: GameState, serverId: string): number {
  const server = state.corp.servers[serverId];
  if (!server) return 0;
  const agendas = server.root.filter(c => cardDef(c).type_code === 'agenda').reduce((n, c) => n + pointGain(state.runner.score, cardDef(c).agenda_points ?? 1), 0);
  const central = serverId === 'hq' || serverId === 'rd' ? centralAccess(state)[serverId === 'hq' ? 'hqNow' : 'density'] : 0;
  const archives = serverId === 'archives' ? state.corp.archives.faceDown.filter(c => cardDef(c).type_code === 'agenda').reduce((n, c) => n + pointGain(state.runner.score, cardDef(c).agenda_points ?? 1), 0) : 0;
  return runSuccess(state, serverId) * (agendas + central + archives);
}

/**
 * plan.calibratedRun (item 3 round 3, Fable review 2026-11-07): the budget's 0/1 read as the measured hit rate. Self-play,
 * 884 games, 12,416 Runner turns (runs 42337257360 threat on, 42337259763 off; scripts/threat-calibration.ts): when the
 * budget runs a server the Runner AI ran it this often, and when it doesn't, this often (it installs a breaker or plays
 * money from the grip the Corp can't see, then runs). Jeff's 13 Corp games for comparison: HQ 0.68 / 0.09, R&D 0.78 /
 * 0.17, a remote 0.94 / 0.09. A crisp 0 made an agenda held in HQ free whenever the budget ran elsewhere (HQ reads 0 on
 * 77% of turns, run on 8% of those).
 */
export const CALIBRATED_RUN = {
  hq: { picked: 0.62, not: 0.08 },
  rd: { picked: 0.56, not: 0.085 },
  archives: { picked: 0.33, not: 0.05 },
  remote: { picked: 0.92, not: 0.12 },
};
/** The budget's 0/1 for `serverId`, as the measured rate while plan.calibratedRun is on. */
export function calibrated(serverId: string, crisp: number): number {
  if (!tuning.plan.calibratedRun) return crisp;
  const rate = CALIBRATED_RUN[serverId === 'hq' || serverId === 'rd' || serverId === 'archives' ? serverId : 'remote'];
  return crisp >= 0.5 ? rate.picked : rate.not;
}

/** Chance the Runner runs `serverId` on its next turn. */
export const runChance = (state: GameState, serverId: string): number => calibrated(serverId, threat(state).servers[serverId]?.run ?? 0);

/**
 * Chance the Runner runs a remote that holds an installed card it can't see (stealOdds for an agenda there): the remote
 * as it is when it already holds one, else with one more facedown card in its root, as an agenda to be installed there
 * would put it (installScore and the hand's agendas price an agenda before it is installed). The stand-in is a copy of
 * one of the Corp's agendas: the Runner's odds pool every card it hasn't seen, so it counts one agenda more than the
 * deck holds, about the share the real card would add. A central is read as it is.
 */
export function remoteRunChance(state: GameState, serverId: string): number {
  const server = state.corp.servers[serverId];
  if (!server?.isRemote || server.root.some(c => !c.isRezzed && !c.faceUp)) return runChance(state, serverId);
  return calibrated(serverId, probeRun(state, serverId, server));
}

/** The probe's 0/1 (remoteRunChance). */
function probeRun(state: GameState, serverId: string, server: GameState['corp']['servers'][string]): number {
  return memo(state, `remoteRunChance:${serverId}`, () => remember(probeCache, serverId + '|' + threatKey(state), () => {
    const like = [...state.corp.hq, ...state.corp.rd, ...state.corp.scoreArea].find(c => cardDef(c).type_code === 'agenda');
    if (!like) return threat(state).servers[serverId]?.run ?? 0;
    const probe: CardInstance = { ...like, instanceId: 'threat-probe', isRezzed: false, faceUp: false, advancementCounters: 0, runnerKnows: false, tokens: {} };
    const servers = { ...state.corp.servers, [serverId]: { ...server, root: [...server.root, probe] } };
    const probed = { ...state, corp: { ...state.corp, servers } };
    // Not a whole budget per probe (handValues asks for every remote, for every agenda in HQ): the probed server's
    // score at the turn's start against the base turn's runs. It is run when it beats the fallback click and fewer of
    // the base turn's runs outscore it than the Runner has clicks (the credits each run spends are not re-counted)
    const base = threat(state);
    computing++;
    try {
      return asSide('runner', () => {
        const view = runnerView(probed);
        const score = runScore(view, serverId, { memory: runnerMemory(probed), wary: !!tuning.wary });
        if (!(score > fallbackClick(view).score)) return 0;
        const ahead = base.order.filter(id => id !== serverId && base.servers[id].score > score).length;
        return ahead < view.runner.clicks ? 1 : 0;
      });
    } finally {
      computing--;
    }
  }));
}

/**
 * The planner leaf's charge for the Runner's next turn (in place of runnerReply): each server it runs, by the run's
 * success, times what the Corp loses there that evaluate doesn't price (accessLoss).
 *
 * plan.threatSpend (item 3 round 3, Fable review 2026-11-07): less what the Runner's turn costs it. runnerReply's leaf
 * was evaluate after the Runner's played-out turn, the Runner poorer by every run it paid into and richer by its credit
 * clicks; the threat charged the accesses and dropped the spend the budget had worked out (runCreditSpend), so an iced
 * remote earned the Corp no tax and holding the agenda looked free. The Runner's credits are moved to the budget's end
 * on its credit slide (the evaluate scale, as the Corp sees the Runner's money: sideStrength), not the whole board
 * re-evaluated: a re-read of the threat on the poorer Runner would count the remote it just paid into as safe.
 */
export function threatLoss(state: GameState): number {
  if (state.winner) return 0;
  const t = threat(state);
  let loss = 0;
  for (const [id, s] of Object.entries(t.servers)) {
    const run = calibrated(id, s.run);
    if (run > 0) loss += run * s.success * accessLoss(state, id);
  }
  if (tuning.plan.threatSpend && t.endCredits !== state.runner.credits) {
    const end = { ...state, runner: { ...state.runner, credits: t.endCredits } };
    loss += sideCreditValue(end, 'runner', 'corp') - sideCreditValue(state, 'runner', 'corp');
  }
  return loss;
}
