import { CardInstance, GameState, cardDef, createRng, knownInHand, shuffleInPlace } from '../core';
import { corpCardValue } from './evaluate';
import { runSuccess, runSuccessBypassing } from './effectValues';
import { unseenInHand } from './handValues';
import { ALARM_CLOCK, BLOCK, RunOptions, RunnerMemory, iceCost, runBypasses, runClick, runCreditSpend, runScore, serverValue } from './runs';
import { asSide, sideOff, tuning } from './synergy';
import { fingerprint, memo, pointGain, sideCreditValue } from './valueModel';
import { effectivePlan, plan, pricing, pricingKey, withPricing } from './pricing';
import { corpSeenGrip } from './oracle';

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

/** The threat is read only by the Corp, with the switch on, and never from inside its own computation. */
export const threatOn = (): boolean => !!plan().threatModel && plan().threatValues !== false && pricing().computingThreat === 0;

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
  const known = corpSeenGrip(state, 'threat'); // plan.oracle.grip: the whole grip
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
    if (plan().oneCurrency) return 0;
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
  // plan.threatKey (K4b): the grip as the threat reads it (the dealt grip's cards: its size and what is in it, Chain
  // Reaction included) instead of the real grip's ids; with plan.threatKeyPricing also the outer pricing context left out
  // (games=1 check 42537621348: 4 of 221 deals moved with both, so some outer flag reaches the budget)
  const coarse = !!plan().threatKey;
  const grip = coarse ? guessedGrip(state).grip.map(c => c.cardCode).sort().join(',') : state.runner.grip.map(c => c.instanceId).join(',');
  const roots = Object.values(state.corp.servers).map(v => v.root.map(c => `${c.advancementCounters}${c.runnerKnows ? 'k' : ''}${c.faceUp ? 'u' : ''}`).join('.')).join(';');
  return [
    state.id, boardPrint(state), roots, hqKey(state), rdKey(state), grip,
    state.runsThisTurn.map(r => r.server + (r.successful ? '+' : '-')).join(','), JSON.stringify(state.corp.rdKnownToRunner ?? []),
    knownInHand(state, 'runner').map(k => k.id).join(','), knownInHand(state, 'corp').map(k => k.id).join(','), state.runner.bonusClicksNextTurn ?? 0,
    planKey(),
    // the pricing context as the budget runs in it (budgetPricing: outside deck averaging)
    coarse && plan().threatKeyPricing ? '' : budgetPricing(pricingKey),
  ].join('|');
}
/**
 * HQ as the threat reads it (planner speed P2): the cards the Corp drew in a look-ahead (unseenInHand) only by their
 * number, since centralAccess prices them at R&D's density whatever they are; the planner's playouts deal different such
 * cards per candidate. The cards the Runner can know of are there by id.
 */
function hqKey(state: GameState): string {
  const unseen = new Set(unseenInHand(state, 'corp').map(c => c.instanceId));
  // probedState copies the first agenda of HQ, then R&D: which one that is can depend on the draw
  const like = [...state.corp.hq, ...state.corp.rd, ...state.corp.scoreArea].find(c => cardDef(c).type_code === 'agenda');
  return state.corp.hq.filter(c => !unseen.has(c.instanceId)).map(c => c.instanceId).join(',') + '#' + unseen.size + '~' + (like?.cardCode ?? '');
}
/**
 * R&D as the threat reads it (planner speed P2): what it holds, by card code, not its order (the on-hit audit found no
 * order dependence). fingerprint has only its size, so a cached threat was served for a board whose R&D the planner's
 * playouts had re-dealt (plan.hiddenDraws): 179 wrong values in 5,397 hits on deal 1421.
 */
function rdKey(state: GameState): string {
  return state.corp.rd.map(c => c.cardCode).sort().join(',');
}
/**
 * fingerprint as the threat reads it (planner speed P2): without the Corp's clicks (nothing the Runner's next turn reads
 * them), with Archives by what it holds (runs.ts serverValue reads its face-up agendas and the face-down cards' pool,
 * trapOdds), and with the counters on installed cards (advanced ice, Regolith Mining License's credits, virus counters:
 * fingerprint has the cards but not their counters; 74 wrong values in 835 hits on deal 1001).
 */
function boardPrint(state: GameState): string {
  const parts = fingerprint(state).split('|');
  parts[3] = '';
  const codes = (cards: CardInstance[]) => cards.map(c => c.cardCode).sort().join(',');
  const counted = (cards: CardInstance[]): string => cards.filter(c => c.advancementCounters || c.tokens && Object.keys(c.tokens).length || c.hostedCards?.length).map(c => `${c.instanceId}:${c.advancementCounters}:${JSON.stringify(c.tokens ?? {})}[${counted(c.hostedCards ?? [])}]`).join(',');
  const { rig } = state.runner;
  const installed = [...Object.values(state.corp.servers).flatMap(v => [...v.ice, ...v.root]), ...rig.programs, ...rig.hardware, ...rig.resources, state.runner.identity, state.corp.identity];
  return parts.join('|') + '~' + codes(state.corp.archives.faceUp) + '/' + codes(state.corp.archives.faceDown) + '~' + counted(installed);
}
let planSig: { plan: unknown; json: string } | null = null;
const planKey = (): string => {
  // The Corp's plan as it is now (tests flip switches in place, so the object alone won't do), with the Runner's own list
  const json = JSON.stringify(effectivePlan()) + JSON.stringify(sideOff.runner) + tuning.wary;
  if (planSig?.json !== json) planSig = { plan: effectivePlan(), json };
  return planSig.json;
};
const threatCache = new Map<string, Threat>();
const probeCache = new Map<string, number>();
/**
 * The threat cache's on-hit audit (test-only, tests/threatCacheAudit.test.ts, scripts/cache-history.ts): with `on`, every
 * hit is budgeted again and compared with the value served. A key that leaves out something budgetTurn reads shows as a
 * mismatch. 'near': the same values but for the last bits of a float sum taken in another order (R&D re-dealt).
 */
export const threatAudit = { on: false, checked: 0, mismatches: 0, near: 0, examples: [] as { turn: number; active: string; cached: string; fresh: string }[] };
/** Empties the threat's board caches (tests and scripts that play several games in one process). */
export function clearThreatCaches(): void {
  threatCache.clear();
  probeCache.clear();
}
const remember = <T>(cache: Map<string, T>, key: string, work: () => T): T => {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const value = work();
  // A cap one planner decision does not reach (the turn-17 fixture budgets 8,854 boards in one decision; a cap of 4000
  // lost 1,226 of them to the clear)
  if (cache.size > 40000) cache.clear();
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
    // The audit (test-only): a cached board recomputed must give the same threat
    if (threatAudit.on && threatCache.has(key)) {
      const fresh = budgetIn(state);
      // A server's success is read only where the Runner runs it (corpLoss: run * success); runChance, the planner and
      // probeRun read run, score and order. Where run is 0 it is left out of the comparison: HQ's unseen draws, keyed by
      // their number (hqKey), can change the guessed ice's pass odds there and nothing reads it.
      const read = (t: Threat) => JSON.stringify({ ...t, servers: Object.fromEntries(Object.entries(t.servers).map(([id, v]) => [id, v.run ? v : { ...v, success: 0 }])) });
      const a = read(fresh);
      const b = read(threatCache.get(key)!);
      threatAudit.checked++;
      // Float sums taken in another order (R&D re-dealt) differ in the last bits: counted apart, as 'near'
      const near = a !== b && a.replace(/\d+\.\d{9,}/g, m => Number(m).toPrecision(9)) === b.replace(/\d+\.\d{9,}/g, m => Number(m).toPrecision(9));
      if (near) threatAudit.near++;
      if (a !== b && !near) {
        threatAudit.mismatches++;
        if (threatAudit.examples.length < 3) threatAudit.examples.push({ turn: state.turnNumber, active: state.activePlayer, cached: b.slice(0, 400), fresh: a.slice(0, 400) });
      }
    }
    return withRecord(remember(threatCache, key, () => {
      threatStats.budgeted++;
      if (threatStats.timing) countRepeats(key, state);
      const t1 = threatStats.timing ? performance.now() : 0;
      try {
        const value = budgetIn(state);
        return value;
      } finally {
        if (threatStats.timing) {
          const ms = performance.now() - t1;
          threatStats.budgetMs += ms;
          if (threatStats.inReply) {
            threatStats.replyBudgeted++;
            threatStats.replyBudgetMs += ms;
          }
        }
      }
    }));
  });
}

/**
 * plan.runRecord (#34b, bug report #34: Jeff's Alarm Clock ran HQ every turn T8-T14 while the budget, our Runner AI's
 * arithmetic, read HQ as never run). The threat is a model of our Runner; a human runs where it would not. So the runs
 * the Runner actually made (public: it announces the attacked server, rules 6.1.2a, 6.9.1a), noted by the deciding Corp
 * turn by turn (pricing().runRecord, corpAI noteRuns), are blended into each server's run chance: the share of its last
 * RECORD.turns turns that ran the server, recent turns weighing more (RECORD.decay), scaled by the evidence (full at
 * RECORD.full turns noted). Three straight HQ runs read as an HQ run next turn; one as a third of one. The budget's own
 * read stands where it is higher. Corp only.
 */
export const RECORD = { turns: 4, decay: 0.6, full: 3 };

/** The record's run chance for `serverId` (0 without a record or with the switch off). */
export function recordRun(serverId: string): number {
  const record = pricing().runRecord;
  if (!plan().runRecord || !record?.length) return 0;
  let weight = 1;
  let all = 0;
  let ran = 0;
  for (const turn of record.slice(0, RECORD.turns)) {
    all += weight;
    if (turn.includes(serverId)) ran += weight;
    weight *= RECORD.decay;
  }
  return (Math.min(1, record.length / RECORD.full) * ran) / all;
}

function withRecord(t: Threat): Threat {
  if (!plan().runRecord || !pricing().runRecord?.length) return t;
  let changed = false;
  const servers: Record<string, ServerThreat> = {};
  for (const [id, s] of Object.entries(t.servers)) {
    const run = Math.max(s.run, recordRun(id));
    if (run !== s.run) changed = true;
    servers[id] = run === s.run ? s : { ...s, run };
  }
  return changed ? { ...t, servers } : t;
}

/**
 * Diagnostics (scripts/threat-profile.ts): threat() calls, how many missed the state memo (keyed) and the board cache
 * (budgeted), their time, and the budgets made inside the Corp planner's played-out Runner reply.
 */
export const threatStats = { calls: 0, keyed: 0, budgeted: 0, keyMs: 0, budgetMs: 0, timing: false, inReply: false, replyBudgeted: 0, replyBudgetMs: 0, fullRepeats: 0, coarseRepeats: 0, bothRepeats: 0, dropRepeats: [] as number[] };

/**
 * K4(a) diagnostics (scripts/threat-profile.ts): budgets of a key already budgeted once (lost to the cache's clear), and
 * budgets whose key with the grip read as its size only (the threat reads the dealt grip by its size, K0) was.
 */
const seenFull = new Set<string>();
const seenCoarse = new Set<string>();
function countRepeats(key: string, state: GameState): void {
  if (seenFull.has(key)) threatStats.fullRepeats++;
  seenFull.add(key);
  const coarse = key.replace(state.runner.grip.map(c => c.instanceId).join(','), `#${state.runner.grip.length}`);
  const both = coarse.split('|').slice(0, -1).join('|');
  if (seenBoth.has(both)) threatStats.bothRepeats++;
  seenBoth.add(both);
  if (seenCoarse.has(coarse)) threatStats.coarseRepeats++;
  seenCoarse.add(coarse);
  // Upper bound: the key's parts one at a time left out (which part tells budgets apart)
  const parts = key.split('|');
  parts.forEach((_, i) => {
    const k = i + ':' + parts.filter((__, j) => j !== i).join('|');
    if (seenDrop.has(k)) threatStats.dropRepeats[i] = (threatStats.dropRepeats[i] ?? 0) + 1;
    seenDrop.add(k);
  });
}
const seenDrop = new Set<string>();
const seenBoth = new Set<string>();

/**
 * The Runner's next turn does not depend on
 * whether the Corp is averaging over its deck when it asks (handValues deckAverage sets pricing.averaging, which reaches
 * the budget through the hand prices of damage and breakers: handValues heldWorth). The budget runs with it off, and the
 * key leaves it out: on the turn-17 fixture 3,001 of 4,566 boards were budgeted twice, once in each context.
 */
function budgetPricing<T>(fn: () => T): T {
  return pricing().averaging ? withPricing({ averaging: false }, fn) : fn();
}
function budgetIn(state: GameState): Threat {
  return budgetPricing(() => withPricing({ computingThreat: pricing().computingThreat + 1 }, () => asSide('runner', () => budgetTurn(state))));
}
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
  // plan.alarmClockThreat: Alarm Clock's HQ run when the Runner's turn begins, before its first click
  const alarm = done.has('hq') ? null : alarmClockRun(state, view, memory, wary);
  if (alarm) {
    servers.hq = { run: 1, score: alarm.score, success: alarm.success };
    order.push('hq');
    done.add('hq');
    view = alarm.after;
  }
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
 * plan.alarmClockThreat (bug report #34, Jeff's Runner game 2: HQ read as never run while Alarm Clock ran it every turn).
 * Alarm Clock: "When your turn begins, you may run HQ. The first time you encounter a piece of ice during that run, you
 * may spend [click][click] to bypass it." A "when your turn begins" ability triggers at step 5.7.1d, before the Runner
 * takes its first action (5.7.1f), so the run costs no click: it comes before the click-by-click budget. It is made the
 * way the Runner AI answers the prompt (prompts.ts: runScore with the 2-click bypass, its click given back, run when
 * above 0); the bypass, when taken, spends 2 of the turn's clicks and its ice is passed (rule 6.5.8a). Only for the
 * Runner's next turn: on its own turn the turn has begun.
 */
function alarmClockRun(state: GameState, view: GameState, memory: RunnerMemory, wary: boolean): { score: number; success: number; after: GameState } | null {
  if (!plan().alarmClockThreat || state.activePlayer === 'runner' || !view.corp.servers.hq) return null;
  if (!view.runner.rig.hardware.some(card => card.cardCode === ALARM_CLOCK)) return null;
  const options: RunOptions = { alarmClock: true, memory, wary };
  const score = runScore(view, 'hq', options) + runClick(view);
  if (!(score > 0)) return null;
  const bypassed = runBypasses(view, 'hq', options);
  const clicks = bypassed.ids.size > runBypasses(view, 'hq', { memory, wary }).ids.size ? 2 : 0;
  const spent = runCreditSpend(view, 'hq', options);
  const after: GameState = {
    ...view,
    runner: { ...view.runner, clicks: view.runner.clicks - clicks, credits: Math.max(0, view.runner.credits - spent) },
    runsThisTurn: [...view.runsThisTurn, { server: 'hq', successful: true } as GameState['runsThisTurn'][number]],
  };
  return { score, success: runSuccessBypassing(state, 'hq', bypassed.ids), after };
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
  if (!plan().calibratedRun) return crisp;
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
  return calibrated(serverId, Math.max(probeRun(state, serverId, server), recordRun(serverId)));
}

/**
 * `state` with remoteRunChance's stand-in agenda in remote `serverId` when it holds no facedown card (state itself
 * otherwise, or when the Corp has no agenda to copy).
 */
export function probedState(state: GameState, serverId: string): GameState {
  const server = state.corp.servers[serverId];
  if (!server?.isRemote || server.root.some(c => !c.isRezzed && !c.faceUp)) return state;
  const like = [...state.corp.hq, ...state.corp.rd, ...state.corp.scoreArea].find(c => cardDef(c).type_code === 'agenda');
  if (!like) return state;
  const probe: CardInstance = { ...like, instanceId: 'threat-probe', isRezzed: false, faceUp: false, advancementCounters: 0, runnerKnows: false, tokens: {} };
  const servers = { ...state.corp.servers, [serverId]: { ...server, root: [...server.root, probe] } };
  return { ...state, corp: { ...state.corp, servers } };
}

/**
 * plan.reach (reach.ts): whether the Runner AI would run `serverId` on its next turn from `view` (a board reach has
 * given breakers it may find): the server's score at the turn's start against its always-there click, as the probe
 * reads it. 1 or 0.
 */
export function wouldRun(view: GameState, serverId: string, options: RunOptions = {}): number {
  return withPricing({ computingThreat: pricing().computingThreat + 1 }, () =>
    asSide('runner', () => {
      const v = runnerView(view);
      return runScore(v, serverId, { ...options, memory: runnerMemory(view), wary: !!tuning.wary }) > fallbackClick(v).score ? 1 : 0;
    })
  );
}

/** The probe's 0/1 (remoteRunChance). */
function probeRun(state: GameState, serverId: string, server: GameState['corp']['servers'][string]): number {
  return memo(state, `remoteRunChance:${serverId}`, () => remember(probeCache, serverId + '|' + threatKey(state), () => {
    const probed = probedState(state, serverId);
    if (probed === state || probed.corp.servers[serverId] === server) return threat(state).servers[serverId]?.run ?? 0;
    // Not a whole budget per probe (handValues asks for every remote, for every agenda in HQ): the probed server's
    // score at the turn's start against the base turn's runs. It is run when it beats the fallback click and fewer of
    // the base turn's runs outscore it than the Runner has clicks (the credits each run spends are not re-counted)
    const base = threat(state);
    return budgetPricing(() => withPricing({ computingThreat: pricing().computingThreat + 1 }, () =>
      asSide('runner', () => {
        const view = runnerView(probed);
        const score = runScore(view, serverId, { memory: runnerMemory(probed), wary: !!tuning.wary });
        if (!(score > fallbackClick(view).score)) return 0;
        const ahead = base.order.filter(id => id !== serverId && base.servers[id].score > score).length;
        return ahead < view.runner.clicks ? 1 : 0;
      })
    ));
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
  if (plan().threatSpend && t.endCredits !== state.runner.credits) {
    const end = { ...state, runner: { ...state.runner, credits: t.endCredits } };
    loss += sideCreditValue(end, 'runner', 'corp') - sideCreditValue(state, 'runner', 'corp');
  }
  return loss;
}
