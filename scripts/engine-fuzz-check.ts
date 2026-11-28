/**
 * Engine-invariant fuzzer: plays games with seeded random legal moves and,
 * after every action, checks that the game state is one the Comprehensive
 * Rules (v26.03) allow. Shared by tests/engineFuzz.test.ts (tier 1, fixed
 * seeds in npm test), scripts/engine-fuzz.ts (tiers 2 and 3, nightly and deep
 * GitHub Actions runs) and scripts/engine-fuzz-replay.ts (reproduce a seed).
 *
 * Checks only read the state; nothing here mutates a state after a legality
 * call (legality is cached per state).
 *
 * A game is fully decided by (seed, corp deck id, runner deck id): the seed
 * drives the deal, the stop levels and the move picker, so a failure is
 * reproduced from those three alone. The action list is saved as well, as a
 * cross-check that the engine itself is deterministic.
 */
import {
  CardInstance,
  GameAction,
  GameState,
  IllegalActionError,
  SideCode,
  StopLevel,
  actingSide,
  createInitialGameState,
  createRng,
  executeAction,
  getCardDefinition,
  getLegalActions,
  maxHandSize,
  nextInt,
} from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { getCardScript } from '../src/core/scripts';
import { NOTHING_QUALIFIES_STEP } from '../src/core/scripts/types';
import { STEAL_COST_STEP } from '../src/core/engine/actions/run';
import { RESOURCE_TRASH_STEP } from '../src/core/engine/actions/basic';
import { MEMORY_LIMIT_STEP } from '../src/core/engine/checkpoint';
import type { DeckList } from '../src/data/decks';
import { ALL_DECKS } from './nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../src/data/testDecks/nrdb';
import { IDENTITY_TEST_DECKS } from '../src/data/testDecks/identityDecks';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { frameChecks } from '../src/ai/pricing';
import { rdShuffleProbe } from '../src/core/engine/rdKnowledge';
import { certainCounts, dealTripwire, handUpkeepCheck } from '../src/core/engine/helpers';
import type { KnownHandCard } from '../src/core/types/state';

/**
 * Counts the fuzzer prints but does not fail on. `idCertainShort`: states where fewer of the listed ids are in their zone
 * than the count calls certain (known-hidden-certain's id form before B4c; the by-code form is the check).
 * `byCopyChecked`: actions run twice by known-by-copy.
 */
export const fuzzDiagnostics = { idCertainShort: 0, byCopyChecked: 0 };

/** Every deck we have (starters, NSG samples, NRDB lists, one per identity: the beta picker draws from these). */
// The tests' checks are on in the fuzzer too (tests/setup.ts): frames frozen, and the Runner's deal keeps its tripwire
// (R-109: a slot with no code throws, an ai-crash, where play falls back to an unkept guess)
frameChecks.on = true;

export const FUZZ_DECKS: DeckList[] = [...new Map([...ALL_DECKS, ...NRDB_TEST_DECKS, ...IDENTITY_TEST_DECKS].map(d => [d.id, d])).values()];
export const FUZZ_CORPS = FUZZ_DECKS.filter(d => d.side === 'corp');
export const FUZZ_RUNNERS = FUZZ_DECKS.filter(d => d.side === 'runner');

/** Game g of a sweep: walks the pairings so every deck is played on both sides of the table often. */
export function pairing(g: number): { corp: DeckList; runner: DeckList } {
  return { corp: FUZZ_CORPS[g % FUZZ_CORPS.length], runner: FUZZ_RUNNERS[(g * 7 + Math.floor(g / FUZZ_CORPS.length)) % FUZZ_RUNNERS.length] };
}

export interface InvariantFailure {
  /** Short id of the broken invariant. */
  check: string;
  /** The rule it comes from (Comprehensive Rules v26.03). */
  rule: string;
  detail: string;
}

export interface FuzzFailure extends InvariantFailure {
  step: number;
  /** The action just taken (null for the starting state). */
  action: GameAction | null;
}

export interface EngineFuzzResult {
  seed: number;
  players: 'random' | 'ai';
  corp: string;
  runner: string;
  stops: Record<SideCode, StopLevel>;
  steps: number;
  turns: number;
  winner: SideCode | null;
  winReason: string | null;
  /** Failures, in order; the first is the one to look at (later ones often follow from it). */
  failures: FuzzFailure[];
  /** Every action taken, for replay. */
  actions: GameAction[];
  /** Number of invariant checks that passed silently (for the summary). */
  checks: number;
  /** The last state, with FuzzOptions.keepState. */
  finalState?: GameState;
}

const SIDES: SideCode[] = ['corp', 'runner'];
const PURITY_EVERY = 20;
const STOP_LEVELS: StopLevel[] = ['ai', 'auto', 'full'];

const withHosted = (c: CardInstance): CardInstance[] => [c, ...(c.hostedCards ?? []).flatMap(withHosted)];

/** Every card in every zone (rule 4.1.1a), hosted cards included, with the zone it sits in. */
export function cardsByZone(state: GameState): { zone: string; card: CardInstance }[] {
  const c = state.corp;
  const r = state.runner;
  const zones: [string, CardInstance[]][] = [
    ['corp identity', [c.identity]],
    ['HQ', c.hq],
    ['R&D', c.rd],
    ['Archives faceup', c.archives.faceUp],
    ['Archives facedown', c.archives.faceDown],
    ['Corp score area', c.scoreArea],
    ...Object.values(c.servers).flatMap((s): [string, CardInstance[]][] => [
      [`${s.id} ice`, s.ice],
      [`${s.id} root`, s.root],
    ]),
    ['runner identity', [r.identity]],
    ['grip', r.grip],
    ['stack', r.stack],
    ['heap', r.heap],
    ['programs', r.rig.programs],
    ['hardware', r.rig.hardware],
    ['resources', r.rig.resources],
    ['Runner score area', r.scoreArea],
    ['removed from game', state.removedFromGame],
    ['set aside', state.setAside ?? []],
  ];
  return zones.flatMap(([zone, list]) => list.flatMap(withHosted).map(card => ({ zone, card })));
}

const def = (c: CardInstance) => getCardDefinition(c.cardCode);
const agendaPoints = (c: CardInstance) => c.asAgendaPoints ?? def(c).agenda_points ?? 0;

/** The R&D shuffle count when each checked state was made (the Corp's memory check above). */
const shufflesAt = new WeakMap<GameState, number>();

/**
 * The invariants. `prev` is the state before the action (null at the start), `ids` the instance ids dealt at
 * the start of the game. Each check names its rule.
 */
export function checkInvariants(state: GameState, prev: GameState | null, ids: Set<string>): { failures: InvariantFailure[]; checks: number } {
  const failures: InvariantFailure[] = [];
  let checks = 0;
  const check = (ok: boolean, check: string, rule: string, detail: () => string) => {
    checks++;
    if (!ok) failures.push({ check, rule, detail: detail() });
  };
  const settled = state.pendingPrompts.length === 0;
  const over = !!state.winner;

  // --- Zones: each card in exactly one zone (4.1.1c); cards are never created or lost (4.1.2b, 4.1.3) ---
  const where = new Map<string, string[]>();
  for (const { zone, card } of cardsByZone(state)) where.set(card.instanceId, [...(where.get(card.instanceId) ?? []), zone]);
  for (const [id, zones] of where) check(zones.length === 1, 'card-in-one-zone', '4.1.1c', () => `${id} (${titleOf(state, id)}) is in ${zones.join(' and ')}`);
  for (const id of ids) check(where.has(id), 'card-lost', '4.1.2b', () => `${id} is in no zone`);
  for (const id of where.keys()) check(ids.has(id), 'card-created', '4.1.2', () => `${id} (${titleOf(state, id)}) appeared from nowhere`);
  // A set-aside card waits only while the effect that set it aside is still resolving (4.8.1, 8.7.4): some pending prompt
  // names it in its data, or the card is out of every visible zone for the rest of the game
  if (!over) {
    for (const c of state.setAside ?? []) {
      const named = new RegExp(`\\b${c.instanceId}\\b`);
      const held = state.pendingPrompts.some(p => 'source' in p && named.test(JSON.stringify(p.source.data ?? {})));
      check(held, 'set-aside-held', '4.8.1, 8.7.4', () => `${c.instanceId} (${title(c)}) is set aside with no pending prompt that names it`);
    }
  }
  check(!state.setAside || state.setAside.length > 0, 'set-aside-tidy', '4.8.1', () => 'an empty set-aside zone was left in the state');
  const origins = Object.keys(state.setAsideFrom ?? {}).sort().join(',');
  const asideIds = (state.setAside ?? []).map(c => c.instanceId).sort().join(',');
  check(origins === asideIds, 'set-aside-origin', '4.8.3', () => `set-aside cards [${asideIds}] but origins for [${origins}]`);

  // --- Counters: credits, clicks, tags, bad publicity, advancement and hosted counters are physical pieces (1.9.1, 1.10.2) ---
  for (const side of SIDES) {
    const p = state[side];
    check(Number.isInteger(p.credits) && p.credits >= 0, 'credits-nonnegative', '1.10.2, 1.10.3b', () => `${side} has ${p.credits} credits`);
    check(Number.isInteger(p.clicks) && p.clicks >= 0, 'clicks-nonnegative', '1.11.3b', () => `${side} has ${p.clicks} clicks`);
    // A turn starts with the allotted clicks (1.11.2); more than a few extra is a runaway gain
    check(p.clicks <= p.maxClicks + 6, 'clicks-in-range', '1.11.2', () => `${side} has ${p.clicks} clicks (allotment ${p.maxClicks})`);
  }
  check(state.runner.tags >= 0, 'tags-nonnegative', '10.5.1', () => `Runner has ${state.runner.tags} tags`);
  check(state.corp.badPublicity >= 0, 'bad-publicity-nonnegative', '10.6.1', () => `Corp has ${state.corp.badPublicity} bad publicity`);
  check(state.runner.coreDamage >= 0, 'core-damage-nonnegative', '5.5.3b', () => `Runner has ${state.runner.coreDamage} core damage`);
  for (const { zone, card } of cardsByZone(state)) {
    check(card.advancementCounters >= 0, 'advancement-nonnegative', '1.18.1', () => `${title(card)} in ${zone} has ${card.advancementCounters} advancement counters`);
    for (const [k, n] of Object.entries(card.tokens ?? {})) check(n >= 0, 'counters-nonnegative', '1.9.1', () => `${title(card)} in ${zone} has ${n} ${k} counters`);
  }

  // --- Score: the sum of agenda points in the score area (1.17.1); 7 wins at the next checkpoint (1.17.2, 10.3.1c) ---
  for (const side of SIDES) {
    const sum = state[side].scoreArea.reduce((n, c) => n + agendaPoints(c), 0);
    check(state[side].score === sum, 'score-is-agenda-sum', '1.17.1', () => `${side} score ${state[side].score} but its score area holds ${sum} agenda points`);
    if (settled && !over) check(state[side].score < 7, 'seven-points-wins', '1.17.2, 10.3.1c', () => `${side} has ${state[side].score} points and the game goes on`);
  }

  // --- Memory: used mu is the installed programs' memory cost (3.9.3), within the limit once settled (3.9.3b-c, 10.3.1e) ---
  const r = state.runner;
  const programMu = r.rig.programs.reduce((n, c) => n + (def(c).memory_cost ?? 0), 0);
  check(r.memoryUnitsUsed === programMu, 'mu-used-is-program-cost', '1.20.3, 3.9.3a', () => `memoryUnitsUsed ${r.memoryUnitsUsed} but installed programs cost ${programMu} mu (${r.rig.programs.map(title).join(', ')})`);
  if (settled) check(r.memoryUnitsUsed <= r.memoryUnitsTotal, 'mu-within-limit', '3.9.3c, 10.3.1e', () => `${r.memoryUnitsUsed} mu used of ${r.memoryUnitsTotal}`);

  // --- Uniqueness and consoles (10.3.1d): no two active copies of a unique card, at most one console per player ---
  if (settled) {
    const corpActive = [...Object.values(state.corp.servers).flatMap(s => [...s.ice, ...s.root]).filter(c => c.isRezzed)];
    const runnerActive = [...r.rig.programs, ...r.rig.hardware, ...r.rig.resources];
    for (const active of [corpActive, runnerActive]) {
      const titles = new Map<string, number>();
      for (const c of active) if (def(c).uniqueness) titles.set(def(c).title, (titles.get(def(c).title) ?? 0) + 1);
      for (const [t, n] of titles) check(n === 1, 'unique-once', '10.3.1d', () => `${n} active copies of unique ${t}`);
    }
    const consoles = r.rig.hardware.filter(c => /\bconsole\b/i.test(def(c).keywords ?? ''));
    check(consoles.length <= 1, 'one-console', '10.3.1d', () => `${consoles.length} consoles installed: ${consoles.map(title).join(', ')}`);
  }

  // --- Hosting: a hosted program's host is an installed card (1.13.1a, 1.13.13: a host leaving takes its hosted cards with it) ---
  const installedIds = new Set([...Object.values(state.corp.servers).flatMap(s => [...s.ice, ...s.root]), ...r.rig.programs, ...r.rig.hardware, ...r.rig.resources].map(c => c.instanceId));
  for (const c of [...r.rig.programs, ...r.rig.hardware, ...r.rig.resources]) {
    if (c.hostedOnId) check(installedIds.has(c.hostedOnId), 'host-installed', '1.13.13', () => `${title(c)} is hosted on ${c.hostedOnId}, which is not installed`);
  }

  // --- Runs: a run is open only during the Runner's turn, in phase 'run', on a server that exists (6.1, 6.8) ---
  const run = state.activeRun;
  if (!over) {
    // A breach outside a run (Detente, Cataloguer: rule 7.1.1) rides on activeRun with accessOnly set and is not a run
    const realRun = run && !run.accessOnly;
    check(!!realRun === (state.phase === 'run') || (!!run && run.accessOnly), 'run-phase-matches', '6.1.1', () => `phase ${state.phase} with ${run ? `a run on ${run.server}` : 'no run'}`);
    if (run) {
      // Not for a breach outside a run: Detente's "Any player can use this ability" lets the Corp give the Runner an HQ access on the Corp's turn
      check(state.activePlayer === 'runner' || run.accessOnly, 'run-on-runner-turn', '5.2.7, 6.1.1', () => `a run on ${run.server} during the Corp's turn`);
      check(!!state.corp.servers[run.server] || run.isSuccessful, 'run-server-exists', '6.1.2, 4.6.8e', () => `the run's server ${run.server} no longer exists`);
      const server = state.corp.servers[run.server];
      if (server && run.icePosition !== null && settled) {
        check(run.icePosition >= -1 && run.icePosition <= server.ice.length, 'run-position-valid', '6.2.1, 6.2.6', () => `position ${run.icePosition} on ${run.server} with ${server.ice.length} ice`);
      }
    }
    if (prev && prev.activePlayer !== state.activePlayer) check(!run, 'run-closed-at-turn-end', '6.8, 5.7.2', () => `the turn passed with a run on ${run!.server} open`);
  }

  // --- Turn handover: the non-active player has no clicks (5.6.3c, 5.7.2c); hand size was enforced (5.5.4) ---
  if (!over && settled && !state.turnStep) {
    const other: SideCode = state.activePlayer === 'corp' ? 'runner' : 'corp';
    check(state[other].clicks === 0, 'no-clicks-off-turn', '5.6.3c, 5.7.2c', () => `${other} holds ${state[other].clicks} clicks during the ${state.activePlayer}'s turn`);
  }
  // The discard step (5.5.4) is checked as it finishes: the end-of-turn step moves on to the paid ability window that
  // follows it (5.6.3b, 5.7.2b), or the turn passes in one go. Cards drawn in that later window (rezzing Spin Doctor)
  // may legally stay over the limit, so the hand is not checked again when the turn finally passes.
  const prevStage = prev?.turnStep?.kind === 'end_turn' ? prev.turnStep.stage : null;
  const stage = state.turnStep?.kind === 'end_turn' ? state.turnStep.stage : null;
  const pastDiscard = (st: string | null) => st === 'discard_window' || st === 'handover';
  const turnPassed = !!prev && prev.activePlayer !== state.activePlayer;
  if (prev && !over && settled && !pastDiscard(prevStage) && (pastDiscard(stage) || turnPassed)) {
    const ended = prev.activePlayer;
    const hand = ended === 'corp' ? state.corp.hq : state.runner.grip;
    const limit = maxHandSize(state, ended);
    check(hand.length <= Math.max(0, limit), 'hand-size-at-discard-step', '5.5.4, 5.5.4c', () => `${ended} finished its discard step with ${hand.length} cards, max hand size ${limit}`);
    if (ended === 'runner') check(limit >= 0, 'flatline-negative-hand-size', '1.7.2b, 5.5.4a', () => `the Runner reached its discard step with max hand size ${limit} and was not flatlined`);
  }

  // --- Card prompts: a pending effect prompt's step is one its card declares with prompts() (steps.ts) ---
  for (const p of state.pendingPrompts) {
    if (p.kind !== 'effect_choice' && p.kind !== 'effect_cards') continue;
    const declared = getCardScript(p.source.cardCode)?.promptSteps;
    if (!declared || ENGINE_STEPS.has(p.source.step)) continue;
    const step = p.source.step.replace(/^psi-(corp|runner):/, '');
    check(declared.includes(step), 'prompt-step-declared', '-', () => `${p.source.cardCode} asked under step '${p.source.step}', not one of ${declared.join(', ')}`);
  }

  // --- The Corp's memory of R&D (engine/rdKnowledge.ts): each entry names the card at that place (4.2.3); after an
  // action that shuffled R&D it holds only cards the Corp looked at after the shuffle (4.2.2, 8.7.3) ---
  const corpRd = state.corp.rdKnownToCorp ?? [];
  for (const e of corpRd) check(state.corp.rd[e.at]?.instanceId === e.id, 'corp-rd-memory-in-place', '4.2.3', () => `the Corp remembers ${e.id} at R&D ${e.at}, which holds ${state.corp.rd[e.at]?.instanceId ?? 'nothing'}`);
  check(new Set(corpRd.map(e => e.id)).size === corpRd.length, 'corp-rd-memory-once', '4.1.1c', () => 'a card is in the Corp\'s R&D memory twice');
  const shuffledBefore = prev ? shufflesAt.get(prev) : undefined;
  if (shuffledBefore !== undefined && rdShuffleProbe.shuffles !== shuffledBefore) {
    const stale = corpRd.filter(e => !rdShuffleProbe.corpSeenSince.has(e.id));
    check(stale.length === 0, 'corp-rd-memory-forgets-shuffle', '4.2.2, 8.7.3', () => `after a shuffle the Corp still remembers ${stale.map(e => e.id).join(', ')}`);
  }
  shufflesAt.set(state, rdShuffleProbe.shuffles);

  // --- What each side knows of the other's hidden zones (engine/helpers.ts certainCounts; engine/rdKnowledge.ts): a card
  // the count calls certain is there (10.2.2b). A departure counts only against the kinds its place allows (where a card
  // is installed is open: 4.6.6a, d, e, f, 10.2.3a), so a wrong kind or a missed departure shows here. The engine's ids
  // are read only by this check. ---
  const hidden: [string, KnownHandCard[] | undefined, CardInstance[]][] = [
    ['HQ', state.corp.knownToRunner, state.corp.hq],
    ['the grip', state.runner.knownToCorp, state.runner.grip],
    ['facedown Archives', state.corp.archKnownToRunner, state.corp.archives.faceDown],
  ];
  for (const [zone, list, cards] of hidden) {
    const inZone = new Set(cards.map(c => c.instanceId));
    // By code (B4c part 4, red team finding 5): which copy of a title was seen is not the viewer's to know (10.2.2b), so
    // n certain is wrong only if fewer than n cards of that code are there. The entry ids name the copy last seen; the
    // id form (fewer of the listed ids there than n) stays a diagnostic only, counted in fuzzDiagnostics.
    for (const [code, n] of certainCounts(list ?? [])) {
      const there = cards.filter(c => c.cardCode === code).length;
      check(there >= n, 'known-hidden-certain', '10.2.2b, 4.6.6e, 10.2.3a', () => `${zone}: ${n} of ${code} counted certain, ${there} of that code are there`);
      if ((list ?? []).filter(e => e.code === code && inZone.has(e.id)).length < n) fuzzDiagnostics.idCertainShort++;
    }
    const ids = (list ?? []).map(e => e.id);
    check(new Set(ids).size === ids.length, 'known-ids-once', '1.12.1', () => `${zone}: an entry id is listed twice (${ids.join(', ')})`);
  }
  // The Runner's R&D marks: a placed mark that cannot have left is its card, in R&D within its places (4.2.3, 10.2.2b)
  const rdMarks = state.corp.rdKnownToRunner ?? [];
  for (const e of rdMarks) {
    if (e.left || e.n0) continue;
    const at = state.corp.rd.findIndex(c => c.instanceId === e.id);
    check(at >= e.lo && at <= e.hi, 'runner-rd-memory-in-place', '4.2.3, 10.2.2b', () => `the Runner places ${e.id} (${e.code}) at R&D ${e.lo}-${e.hi}, it is at ${at}`);
  }
  // A shuffle's share names no copy (B4d (b); rd-fuzz-fixes class 1): it says only that a card of its title is in R&D
  // (rules 4.2.2, 10.2.2b), so the shares still certain are read by code and count. Each needs its own copy of its code in
  // R&D within its places, one no placed mark names (a placed mark is its own card): a matching, earliest `hi` first.
  const placed = new Set(rdMarks.filter(e => !e.n0).map(e => e.id));
  const sharesByCode = new Map<string, { lo: number; hi: number }[]>();
  for (const e of rdMarks) if (e.n0 && !e.left) sharesByCode.set(e.code, [...(sharesByCode.get(e.code) ?? []), e]);
  for (const [code, shares] of sharesByCode) {
    const free = state.corp.rd.flatMap((c, at) => (c.cardCode === code && !placed.has(c.instanceId) ? [at] : []));
    const used = new Set<number>();
    const unmatched = [...shares].sort((a, b) => a.hi - b.hi).filter(e => {
      const at = free.find(q => q >= e.lo && q <= e.hi && !used.has(q));
      if (at === undefined) return true;
      used.add(at);
      return false;
    });
    check(unmatched.length === 0, 'runner-rd-memory-in-place', '4.2.2, 4.2.3, 10.2.2b', () => `the Runner's shares of ${code} (${shares.map(e => `${e.lo}-${e.hi}`).join(', ')}): ${unmatched.length} with no copy of that code in R&D within its places (copies at ${free.join(', ') || 'none'})`);
  }

  // The root cards the Runner knows are upgrades (B4b): each is one, facedown, in a root (3.2.1, 3.3.1, 4.6.6e, 1.12.3)
  const roots = new Map(Object.values(state.corp.servers).flatMap(sv => sv.root.map(c => [c.instanceId, c] as const)));
  for (const id of state.corp.rootUpgradesKnownToRunner ?? []) {
    const c = roots.get(id);
    check(!!c && getCardDefinition(c.cardCode).type_code === 'upgrade', 'runner-root-upgrade-known', '3.2.1, 3.3.1, 4.6.6e, 1.12.3', () => `the Runner knows ${id} is an upgrade: ${c ? getCardDefinition(c.cardCode).type_code : 'not in a root'}`);
  }

  // --- Turn number never goes back ---
  if (prev) check(state.turnNumber >= prev.turnNumber, 'turn-number-grows', '5.1.1', () => `turn ${prev.turnNumber} -> ${state.turnNumber}`);

  // --- Decisions: someone can always move until there is a winner (1.7.1); the pending decision can be answered ---
  if (!over) {
    const side = actingSide(state);
    check(!!side, 'someone-acts', '1.7.1', () => 'no player can act and there is no winner');
    if (side) {
      let legal: GameAction[] = [];
      let otherLegal: GameAction[] = [];
      const other: SideCode = side === 'corp' ? 'runner' : 'corp';
      try {
        legal = getLegalActions(state, side);
        otherLegal = getLegalActions(state, other).filter(a => a.type !== 'CONCEDE' && a.type !== 'SET_STOPS');
      } catch (e) {
        check(false, 'legal-actions-crash', '-', () => `getLegalActions threw: ${e instanceof Error ? e.message : e}`);
      }
      check(legal.length > 0, 'legal-action-exists', '1.7.1', () => `${side} has no legal action (${describeWait(state)})`);
      const p = state.pendingPrompts[0];
      if (p) {
        check(p.side === side, 'prompt-side-acts', '9.2', () => `prompt for ${p.side} but ${side} acts`);
        check(legal.some(a => a.type === 'RESOLVE_PROMPT' && a.promptId === p.id), 'prompt-answerable', '1.14.5', () => `no legal answer to ${p.kind} prompt "${p.message}"`);
      }
      check(otherLegal.length === 0, 'one-side-acts', '9.2.1', () => `${other} may also ${otherLegal[0]?.type} while ${side} acts`);
    }
  } else {
    check(!!state.winReason, 'win-has-reason', '1.7.2', () => `winner ${state.winner} with no win reason`);
  }
  return { failures, checks };
}

/** Steps the engine answers itself before any card script sees them (actions/prompt.ts). */
const ENGINE_STEPS = new Set([NOTHING_QUALIFIES_STEP, STEAL_COST_STEP, RESOURCE_TRASH_STEP, MEMORY_LIMIT_STEP]);

const title = (c: CardInstance) => {
  try {
    return def(c).title;
  } catch {
    return c.cardCode;
  }
};
const titleOf = (state: GameState, id: string) => {
  const found = cardsByZone(state).find(x => x.card.instanceId === id);
  return found ? title(found.card) : '?';
};
const describeWait = (state: GameState) =>
  state.pendingPrompts[0] ? `prompt ${state.pendingPrompts[0].kind}` : state.priority ? `window ${state.priority.step} held by ${state.priority.holder}` : `phase ${state.phase}`;

/** The path of the first value JSON would lose or change (NaN, Infinity, a function, a Map or class instance), or null. */
function notPlain(v: unknown, path: string): string | null {
  if (v === null || typeof v === 'string' || typeof v === 'boolean' || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? null : `${path} = ${v}`;
  if (typeof v !== 'object') return `${path} (${typeof v})`;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const b = notPlain(v[i], `${path}[${i}]`);
      if (b) return b;
    }
    return null;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return `${path} (${proto?.constructor?.name ?? 'object'})`;
  for (const [k, x] of Object.entries(v)) {
    const b = notPlain(x, `${path}.${k}`);
    if (b) return b;
  }
  return null;
}

/** Picks a move: random legal action, preferring doing things to passing so games get somewhere. Never concedes. */
export function pickAction(legal: GameAction[], rng: ReturnType<typeof createRng>): GameAction | null {
  const pool = legal.filter(a => a.type !== 'CONCEDE' && a.type !== 'SET_STOPS');
  if (pool.length === 0) return null;
  const busy = pool.filter(a => a.type !== 'END_TURN' && a.type !== 'PASS');
  const from = busy.length > 0 && nextInt(rng, 4) > 0 ? busy : pool;
  return from[nextInt(rng, from.length)];
}

export interface FuzzOptions {
  maxSteps?: number;
  /** Stop at the first failing step (the default); false keeps going to collect more. */
  stopAtFirst?: boolean;
  /** Replay these actions instead of picking (replay script cross-check). */
  actions?: GameAction[];
  /**
   * 'random' (the default): seeded random legal moves, stops picked from the seed. 'ai': the shipped Normal AI on
   * both sides (stops 'ai'), which reaches the states random play rarely does (scored agendas, deep runs, money).
   */
  players?: 'random' | 'ai';
  /** Stop levels to play with (a replay of an AI game passes the saved ones); default picked from the seed. */
  stops?: Record<SideCode, StopLevel>;
  /** Return the last state too (scripts/trace-hash.ts compares it before and after a refactor). */
  keepState?: boolean;
}

/**
 * Plays one game with every invariant checked after every action. The upkeep skip's checked walk (R-105,
 * handUpkeepCheck) is on for the game, the AI's look-ahead included: a skip the walk disagrees with is a failure
 * (`hand-upkeep-skip`), read from the seam's record, since the look-ahead swallows the throw.
 */
export function fuzzEngineGame(seed: number, corp: DeckList, runner: DeckList, opts: FuzzOptions = {}): EngineFuzzResult {
  const was = handUpkeepCheck.on;
  handUpkeepCheck.on = true;
  try {
    return fuzzOneGame(seed, corp, runner, opts);
  } finally {
    handUpkeepCheck.on = was;
  }
}

/**
 * The three lists of what one side knows of the other's hidden cards, as a multiset of code and losses (ids stripped),
 * and (B4d (b)) the Runner's R&D shares, as a multiset of code, places, n0 and `left` (ids stripped).
 */
export function knownByCopy(s: GameState): string {
  const strip = (l: KnownHandCard[] | undefined) =>
    (l ?? [])
      .map(e => `${e.code}:${['any', 'ice', 'root', 'upgrade'].map(k => e.lost?.[k as keyof typeof e.lost] ?? 0).join('/')}`)
      .sort()
      .join(',');
  const shares = (s.corp.rdKnownToRunner ?? [])
    .filter(e => e.n0)
    .map(e => `${e.code}:${e.lo}-${e.hi}/${e.n0}${e.left ? `/${e.left}` : ''}`)
    .sort()
    .join(',');
  return `HQ ${strip(s.corp.knownToRunner)} | grip ${strip(s.runner.knownToCorp)} | Archives ${strip(s.corp.archKnownToRunner)} | R&D shares ${shares}`;
}

/**
 * known-by-copy (B4c part 4, red team finding 3; brief rev 1 item 3): `state` with one listed id moved to an unlisted
 * copy of the same title in the same zone (HQ, the grip, facedown Archives), or null if no zone has one. The copy is
 * made before any legality call on it (RULE-NO-MUTATE-AFTER-LEGALITY). A card accessed this run is left as it is (its
 * id marks the breach's sightings, 7.4.3). R&D marks are not relabelled: a known gap (brief rev 1 item 4).
 */
/**
 * known-by-copy for R&D (B4d (b), the audit's LEAK-RD-SHARE-FOLLOWS-LABEL): `state` with one R&D share (a mark a shuffle
 * left, n0) moved to another copy of its title in R&D that no mark names and that is inside the share's places, or null
 * if there is none. A share says only that a card of that title is in R&D (rules 4.2.2, 10.2.2b), so which copy its id
 * names must change nothing. Exact and interval marks are not relabelled: their places say which card it is.
 */
export function relabelledRdCopy(state: GameState): GameState | null {
  const marks = state.corp.rdKnownToRunner ?? [];
  const named = new Set(marks.map(e => e.id));
  for (const [i, e] of marks.entries()) {
    if (!e.n0) continue;
    const other = state.corp.rd.find((c, at) => c.cardCode === e.code && !named.has(c.instanceId) && at >= e.lo && at <= e.hi);
    if (!other) continue;
    const copy = structuredClone(state);
    copy.corp.rdKnownToRunner![i] = { ...copy.corp.rdKnownToRunner![i], id: other.instanceId };
    return copy;
  }
  return null;
}

export function relabelledCopy(state: GameState): GameState | null {
  const accessed = new Set((state.activeRun?.accessed ?? []).map(a => a.id));
  const zones: [KnownHandCard[] | undefined, CardInstance[], (s: GameState) => KnownHandCard[]][] = [
    [state.corp.knownToRunner, state.corp.hq, s => s.corp.knownToRunner!],
    [state.runner.knownToCorp, state.runner.grip, s => s.runner.knownToCorp!],
    [state.corp.archKnownToRunner, state.corp.archives.faceDown, s => s.corp.archKnownToRunner!],
  ];
  for (const [list, cards, of] of zones) {
    if (!list?.length) continue;
    const listed = new Set(list.map(e => e.id));
    for (const [i, e] of list.entries()) {
      if (typeof e !== 'object' || !cards.some(c => c.instanceId === e.id) || accessed.has(e.id)) continue;
      const other = cards.find(c => c.cardCode === e.code && !listed.has(c.instanceId) && !accessed.has(c.instanceId));
      if (!other) continue;
      const copy = structuredClone(state);
      of(copy)[i] = { ...of(copy)[i], id: other.instanceId };
      return copy;
    }
  }
  return null;
}

function fuzzOneGame(seed: number, corp: DeckList, runner: DeckList, opts: FuzzOptions): EngineFuzzResult {
  let upkeepSeen = handUpkeepCheck.failures.length;
  let dealSeen = dealTripwire.failures.length;
  const maxSteps = opts.maxSteps ?? 1500;
  const stopAtFirst = opts.stopAtFirst ?? true;
  const rng = createRng(seed ^ 0x5eed);
  const ai = opts.players === 'ai';
  const picked = { corp: STOP_LEVELS[nextInt(rng, 3)], runner: STOP_LEVELS[nextInt(rng, 3)] };
  const stops: Record<SideCode, StopLevel> = opts.stops ?? (ai ? { corp: 'ai', runner: 'ai' } : picked);
  let state: GameState = { ...createInitialGameState(deckGameSetup(seed, corp, runner)), stops };
  const ids = new Set(cardsByZone(state).map(x => x.card.instanceId));
  const failures: FuzzFailure[] = [];
  const actions: GameAction[] = [];
  let checks = 0;
  const record = (step: number, action: GameAction | null, fs: InvariantFailure[]) => failures.push(...fs.map(f => ({ ...f, step, action })));
  const first = checkInvariants(state, null, ids);
  checks += first.checks;
  record(0, null, first.failures);
  // The AI picks through GameRunner (its off-turn and rez-window choices), on a copy of the same state
  const game = ai && !opts.actions ? new GameRunner(state, { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') }) : null;
  let step = 0;
  while (step < maxSteps && !state.winner && !(stopAtFirst && failures.length)) {
    const side = actingSide(state);
    if (!side) break;
    let action: GameAction | null;
    let next: GameState | null = null;
    // Every PURITY_EVERY steps: the move must leave the state it was given untouched (the UI, the AI's look-ahead
    // and the legality cache all keep old states), and the new state must survive a JSON round trip (saved games,
    // bug reports and the multiplayer server store it as JSON).
    const before = (step + 1) % PURITY_EVERY === 0 ? JSON.stringify(state) : null;
    // The AI's look-ahead plays moves on copies with executeAction, shuffles included: the R&D shuffle probe is put
    // back after it and the AI's real move is run once more below, so only that move counts (the engine is deterministic)
    const probeBefore = game ? { shuffles: rdShuffleProbe.shuffles, seen: [...rdShuffleProbe.corpSeenSince] } : null;
    if (game) {
      const lastBefore = game.last;
      try {
        game.step();
        next = game.state;
      } catch (e) {
        if (game.last === lastBefore) {
          // The AI itself threw while choosing: not an engine invariant, but worth seeing
          record(step + 1, null, [{ check: 'ai-crash', rule: '-', detail: `${e instanceof Error ? e.message : e}`.slice(0, 300) }]);
          break;
        }
        // The engine refused the AI's move: executeAction below runs it again and reports it
      }
      action = game.last;
      rdShuffleProbe.shuffles = probeBefore!.shuffles;
      rdShuffleProbe.corpSeenSince = new Set(probeBefore!.seen);
      if (next && action) executeAction(state, action); // same move, same shuffles; the copy is not kept
    } else action = opts.actions ? opts.actions[step] : pickAction(getLegalActions(state, side), rng);
    if (!action) break; // no legal action: already reported by the invariants
    step++;
    actions.push(action);
    try {
      next ??= executeAction(state, action);
    } catch (e) {
      const illegal = e instanceof IllegalActionError;
      record(step, action, [
        {
          check: illegal ? 'legal-action-rejected' : 'engine-crash',
          rule: illegal ? (game ? '- (the AI picked a move the engine refused)' : '- (offered as legal, then refused)') : '-',
          detail: `${e instanceof Error ? e.message : e}`.slice(0, 300) + (illegal ? '' : `\n${e instanceof Error ? e.stack?.split('\n').slice(1, 6).join('\n') : ''}`),
        },
      ]);
      break;
    }
    if (before !== null) {
      const fs: InvariantFailure[] = [];
      if (JSON.stringify(state) !== before) fs.push({ check: 'action-mutated-old-state', rule: '-', detail: `${game ? 'the AI or ' : ''}executeAction changed the state it was given (${action.type})` });
      const bad = notPlain(next, 'state');
      if (bad) fs.push({ check: 'state-not-plain-json', rule: '-', detail: `${bad} would not survive a JSON round trip` });
      record(step, action, fs);
    }
    const res = checkInvariants(next, state, ids);
    checks += res.checks;
    record(step, action, res.failures);
    // known-by-copy: the same move from the same state with the list naming the other copy must leave the same lists,
    // ids aside (10.2.2b). The shuffle probe is put back after the extra run, as for the AI's look-ahead
    for (const relabelled of [relabelledCopy(state), relabelledRdCopy(state)]) {
      if (!relabelled) continue;
      const probe = { shuffles: rdShuffleProbe.shuffles, seen: new Set(rdShuffleProbe.corpSeenSince) };
      let other: GameState | null = null;
      try {
        other = executeAction(relabelled, action);
      } catch {
        // refused or crashed only on the copy: the real move is checked above
      }
      rdShuffleProbe.shuffles = probe.shuffles;
      rdShuffleProbe.corpSeenSince = probe.seen;
      fuzzDiagnostics.byCopyChecked++;
      checks++;
      if (other && knownByCopy(other) !== knownByCopy(next)) {
        record(step, action, [{ check: 'known-by-copy', rule: '10.2.2b', detail: `the list naming the other copy ends ${knownByCopy(other)}; as played ${knownByCopy(next)}` }]);
      }
    }
    if (dealTripwire.failures.length > dealSeen) {
      const fs = dealTripwire.failures.slice(dealSeen).map(f => ({ check: 'deal-no-code', rule: '- (R-109: the Runner\'s deal found no code for a slot)', detail: f.slice(0, 300) }));
      dealSeen = dealTripwire.failures.length;
      record(step, action, fs);
    }
    if (handUpkeepCheck.failures.length > upkeepSeen) {
      const fs = handUpkeepCheck.failures.slice(upkeepSeen).map(f => ({ check: 'hand-upkeep-skip', rule: '1.12.3, 10.2.2 (R-105: the skip and the walk disagree)', detail: `skips ${f.skips}, ${f.field}: skipped ${f.skipped.slice(0, 120)} / walked ${f.walked.slice(0, 120)}` }));
      upkeepSeen = handUpkeepCheck.failures.length;
      record(step, action, fs);
    }
    state = next;
  }
  return {
    seed,
    players: ai ? 'ai' : 'random',
    corp: corp.id,
    runner: runner.id,
    stops,
    steps: step,
    turns: state.turnNumber,
    winner: state.winner,
    winReason: state.winReason,
    failures,
    actions,
    checks,
    ...(opts.keepState && { finalState: state }),
  };
}

/** One line per game for the logs. */
export function summaryLine(res: EngineFuzzResult): string {
  const f = res.failures[0];
  return `${res.seed}${res.players === 'ai' ? ' (AI)' : ''} ${res.corp} vs ${res.runner} stops ${res.stops.corp}/${res.stops.runner}: ${res.steps} steps, turn ${res.turns}, ${res.winner ?? 'no winner'}${
    f ? ` FAIL ${f.check} (rule ${f.rule}) at step ${f.step}: ${f.detail.split('\n')[0]}` : ' ok'
  }`;
}
