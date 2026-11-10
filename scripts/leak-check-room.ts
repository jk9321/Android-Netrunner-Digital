/**
 * The room fuzzer's checks (multiplayer phase 2, chunk 2b), shared by
 * scripts/room-fuzz.ts and tests/roomFuzz.test.ts: two scripted clients play
 * full games through the game server's room logic (server/room.ts, RoomCore,
 * no Workers runtime), seeing only the messages the room sends them. On every
 * message a client receives:
 *
 * - the phase 1 content checks (scripts/leak-check.ts, checkContent): no
 *   engine internals, no hidden card's face, code or title;
 * - the room's own rules: each seat's `seq` goes up by one per state, the
 *   seat that did not act is sent a state only at a settled point
 *   (settledFor), errors are fixed wording, `legal` is empty unless acting;
 * - every 50 moves the stored snapshot is loaded again and must greet both
 *   seats exactly as the live room does (spec rule 4, persistence).
 *
 * And the twin check (scripts/leak-check-twin.ts) at the message level: from
 * time to time the room is forked into two copies that differ only in two
 * cards hidden from one side; the same client messages go to both, and the
 * blind side's message sequences must be byte-identical until one of the
 * cards is shown to it.
 *
 * 'random' clients pick any legal move from the `legal` they receive (stops at
 * 'full', as the twin check needs); 'ai' clients are the shipped normal AI
 * deciding on the real state, for longer, more natural games (stops at 'ai').
 */
import { ALL_DECKS } from './nsg-sample-decks';
import { NRDB_TEST_DECKS } from '../src/data/testDecks/nrdb';
import { IDENTITY_TEST_DECKS } from '../src/data/testDecks/identityDecks';
import { STARTER_DECKS, deckCodes } from '../src/data/decks';
import type { DeckList } from '../src/data/decks';
import { GameAction, SideCode, createRng, fromEngineAction, nextInt, validateDeck } from '../src/core';
import type { FormatId, RngState, StopLevel } from '../src/core';
import { createAgent } from '../src/ai';
import type { Agent } from '../src/ai/agent';
import { GameRunner } from '../src/ai/playout';
import { RoomCore, settledFor } from '../server/room';
import type { Outbox } from '../server/room';
import { SOCKET_ERROR_TEXT, parseClientMessage } from '../src/net/protocol';
import type { ClientMessage, DeckSubmission, ServerMessage } from '../src/net/protocol';
import { LeakChecker, type LeakFailure } from './leak-check';
import { firstDiff, pickPair, shown, twinOf } from './leak-check-twin';

const SIDES: SideCode[] = ['corp', 'runner'];
const other = (s: SideCode): SideCode => (s === 'corp' ? 'runner' : 'corp');
type StateMsg = ServerMessage & { type: 'state' };

export interface RoomTwinStats {
  forks: number;
  compared: number;
  revealed: number;
  illegal: number;
}

export interface RoomFuzzResult {
  seed: number;
  corp: string;
  runner: string;
  format: FormatId | null;
  players: 'random' | 'ai';
  moves: number;
  winner: SideCode | null;
  failures: LeakFailure[];
  /** Sizes of every `state` message (bytes of JSON). */
  sizes: number[];
  /** Milliseconds per receive() call that applied a move. */
  times: number[];
  /** With opts.wake, sampled: milliseconds for a whole wake (read the stored values, load, receive, write them back, the sent texts). */
  wakes: number[];
  /** Largest stored values seen (bytes of JSON): meta, state, moves. */
  stored: { meta: number; state: number; moves: number };
  twin: RoomTwinStats;
}

/** The format both decks are legal in online, or null (casual only for two starter decks, rules 1.4.1a). */
export function onlineFormat(corp: DeckList, runner: DeckList): FormatId | null {
  const starters = new Set(STARTER_DECKS.map(d => d.id));
  if (starters.has(corp.id) && starters.has(runner.id)) return 'casual';
  for (const format of ['standard', 'startup'] as FormatId[]) {
    if ([corp, runner].every(d => validateDeck({ ...deckCodes(d), format }).length === 0)) return format;
  }
  return null;
}

export const submission = (deck: DeckList): DeckSubmission => {
  const spec = deckCodes(deck);
  return { identity: spec.identity, cards: spec.cards };
};

/** One seat's client: everything it knows is what the room sent it. */
class Client {
  seq = 0;
  last: StateMsg | null = null;
  over = false;
  /** Sent a move and heard nothing back yet (the room may hold the answer until a settled point): waits. */
  waiting = false;
  constructor(readonly side: SideCode) {}
}

/** Picks a client message from what the client was sent (random legal play, like leak-check's RandomAgent). */
function randomMessage(client: Client, rng: RngState): ClientMessage | null {
  const s = client.last;
  if (!s || s.waitingOn !== client.side) return null;
  if (s.held && nextInt(rng, 6) === 0) return { type: 'cancel', seq: s.seq };
  const legal = s.legal.filter(a => a.type !== 'CONCEDE' && a.type !== 'SET_STOPS');
  const busy = legal.filter(a => a.type !== 'END_TURN' && a.type !== 'PASS');
  const pool = busy.length > 0 && nextInt(rng, 4) > 0 ? busy : legal;
  const action: GameAction = pool.length ? pool[nextInt(rng, pool.length)] : { type: 'PASS', player: client.side };
  return { type: 'act', seq: s.seq, action };
}

/** The AI's move on the real state the seat is shown, in the seat's ids (what a client driven by a bot would send). */
function aiMessage(room: RoomCore, client: Client, agents: Record<SideCode, Agent>, rng: RngState): ClientMessage | null {
  const s = client.last;
  if (!s || s.waitingOn !== client.side) return null;
  const seen = room.inspect(client.side)!;
  let chosen: GameAction | null = null;
  const runner = new GameRunner(seen.state, agents);
  runner.apply = (a: GameAction) => {
    chosen = a;
  };
  runner.step();
  const mine = chosen ? fromEngineAction(chosen, seen.ids) : null;
  if (mine) return { type: 'act', seq: s.seq, action: mine };
  return randomMessage(client, rng);
}

export function fuzzRoomGame(seed: number, corp: DeckList, runner: DeckList, players: 'random' | 'ai', opts: { maxMoves?: number; twinEvery?: number; wake?: boolean } = {}): RoomFuzzResult {
  const maxMoves = opts.maxMoves ?? (players === 'ai' ? 4000 : 1500);
  const twinEvery = opts.twinEvery ?? 8;
  const checker = new LeakChecker(seed);
  const rng = createRng(seed * 13 + 5);
  const result: RoomFuzzResult = {
    seed,
    corp: corp.id,
    runner: runner.id,
    format: onlineFormat(corp, runner),
    players,
    moves: 0,
    winner: null,
    failures: checker.failures,
    sizes: [],
    times: [],
    wakes: [],
    stored: { meta: 0, state: 0, moves: 0 },
    twin: { forks: 0, compared: 0, revealed: 0, illegal: 0 },
  };
  if (!result.format) return result;
  const host: SideCode = seed % 2 === 0 ? 'corp' : 'runner';
  const decks = { corp: submission(corp), runner: submission(runner) };
  const made = RoomCore.create({ code: 'FUZZ22', side: host, deck: decks[host], format: result.format, playerId: `player-${host}`, tokenHash: `hash-${host}`, build: 'fuzz', seed, now: 0 });
  if (!(made instanceof RoomCore)) {
    checker.fail(0, host, 'seat', `create refused: ${JSON.stringify(made)}`);
    return result;
  }
  const room = made;
  const clients = { corp: new Client('corp'), runner: new Client('runner') };
  let step = 0;

  const deliver = (out: Outbox, mover: SideCode | null) => {
    for (const { to, msg } of out) {
      const client = clients[to];
      if (msg.type === 'state') {
        result.sizes.push(JSON.stringify(msg).length);
        if (msg.seq !== client.seq + 1) checker.fail(step, to, 'seat', `seq ${msg.seq} after ${client.seq}`);
        client.seq = msg.seq;
        const seen = room.inspect(to)!;
        checker.checkContent(seen.state, to, msg, seen.ids, step);
        if (msg.legal.length > 0 && msg.waitingOn !== to) checker.fail(step, to, 'seat', 'legal actions sent to a seat that is not acting');
        // The seat that did not act hears only at settled points (or when the game ends, or its held choice was dropped)
        if (mover && to !== mover && !settledFor(seen.state, to) && !seen.state.winner) checker.fail(step, to, 'seat', 'state sent to the other seat at an unsettled point');
        client.last = msg;
        client.waiting = false;
      } else if (msg.type === 'error') {
        if (msg.message !== SOCKET_ERROR_TEXT[msg.code]) checker.fail(step, to, 'seat', `error text is not the fixed wording: ${msg.message}`);
      } else if (msg.type === 'over') {
        client.over = true;
        overCheck(room, msg, checker, step, to);
      }
      // The one place full information may go to a seat is `over.final`, once the game is over (chunk 2d, rule 1.7.1)
      if (msg.type !== 'over' && 'final' in msg) checker.fail(step, to, 'seat', `a ${msg.type} message carries a final table`);
    }
  };

  const joined = room.join({ deck: decks[other(host)], playerId: `player-${other(host)}`, tokenHash: `hash-${other(host)}`, now: 0 });
  if ('error' in joined) {
    checker.fail(0, other(host), 'seat', `join refused: ${JSON.stringify(joined)}`);
    return result;
  }
  deliver(joined.out, null);
  // Random clients play at 'full' (the twin check's level, leak-check-twin.ts); AI clients where the AI stops
  // Odd seeds of random play: the Runner at 'auto', where an R&D access pauses only on cards the Runner may do
  // something with; the room's settled rule must keep that from the Corp (twins: R&D pairs, Corp blind only)
  const rdOnly = players === 'random' && seed % 2 === 1;
  // (AI clients keep the engine's default, 'ai': online seats can't choose it, review R2)
  const levels: Record<SideCode, StopLevel> | null = players === 'ai' ? null : { corp: 'full', runner: rdOnly ? 'auto' : 'full' };
  if (levels) for (const side of SIDES) deliver(room.receive(side, { type: 'act', seq: clients[side].seq, action: { type: 'SET_STOPS', player: side, level: levels[side] } }, 0).out, side);

  const agents = players === 'ai' ? { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') } : null;
  let stuck = 0;
  try {
    while (step < maxMoves && !room.meta.over) {
      const acting = SIDES.find(s => clients[s].last?.waitingOn === s && !clients[s].waiting);
      if (!acting) {
        checker.fail(step, 'corp', 'seat', 'no seat is told it is acting');
        break;
      }
      const msg = agents ? aiMessage(room, clients[acting], agents, rng) : randomMessage(clients[acting], rng);
      if (!msg) break;
      if (players === 'random' && !room.meta.held && step > 0 && nextInt(rng, twinEvery) === 0) twinFork(room, clients, msg, checker, step, rng, result.twin, rdOnly);
      if (opts.wake && nextInt(rng, 4) === 0) result.wakes.push(timeWake(room, acting, msg, step + 1));
      const t0 = performance.now();
      const res = room.receive(acting, msg, step + 1);
      const ms = performance.now() - t0;
      step++;
      const refused = res.out.some(o => o.to === acting && o.msg.type === 'error');
      const accepted = !refused;
      // A move the room took but answered nothing yet (an R&D access of the other side's): the client waits for its next state
      if (accepted && !res.out.some(o => o.to === acting && o.msg.type === 'state')) clients[acting].waiting = true;
      if (accepted) result.times.push(ms);
      else if (++stuck > 50) {
        checker.fail(step, acting, 'seat', `50 refused messages in a row (last ${JSON.stringify(res.out[0]?.msg).slice(0, 160)})`);
        break;
      }
      if (accepted) stuck = 0;
      deliver(res.out, acting);
      if (step % 50 === 0) persistenceCheck(room, checker, step, result.stored);
      // A seat reconnects now and then: it must get exactly the last state it was sent (review R1)
      if (nextInt(rng, 20) === 0) reconnectCheck(room, clients, checker, step, SIDES[nextInt(rng, 2)]);
      // Junk from a client now and then: refused, or cleaned before it reaches a view or the moves (review R2)
      if (nextInt(rng, 15) === 0) junkCheck(room, clients, checker, step, rng, deliver);
    }
  } catch (e) {
    checker.failures.push({ seed, step, viewer: 'corp', check: 'crash', detail: `${e instanceof Error ? e.stack : e}`.slice(0, 400) });
  }
  persistenceCheck(room, checker, step, result.stored);
  // A reconnect to the finished room greets each seat with the final table again
  if (room.meta.over) for (const side of SIDES) for (const m of room.connect(side)) if (m.type === 'over') overCheck(room, m, checker, step, side);
  result.moves = room.moves.length;
  result.winner = room.realState?.winner ?? null;
  return result;
}

/**
 * One Durable Object wake for a move, on a copy: the stored values read back
 * (JSON here; the runtime's structured clone is of the same order), the room
 * loaded, the move received, every stored value and sent message serialised.
 */
function timeWake(room: RoomCore, side: SideCode, msg: ClientMessage, now: number): number {
  const snap = room.snapshot();
  const stored = { meta: JSON.stringify(snap.meta), state: JSON.stringify(snap.state), moves: JSON.stringify(snap.moves), last: JSON.stringify(snap.last) };
  const t0 = performance.now();
  const copy = RoomCore.load({ meta: JSON.parse(stored.meta), state: JSON.parse(stored.state), moves: JSON.parse(stored.moves), last: JSON.parse(stored.last) }, now);
  const res = copy.receive(side, msg, now);
  if (res.persist) {
    const out = copy.snapshot();
    JSON.stringify(out.meta);
    JSON.stringify(out.state);
    JSON.stringify(out.moves);
  }
  for (const o of res.out) if (!o.text) JSON.stringify(o.msg);
  return performance.now() - t0;
}

/**
 * `over` is the only message that may carry the real state (chunk 2d): only
 * once the room's game is over with a winner, and then exactly the real final
 * state (as JSON, as sent). No winner (the room could not read its game): no
 * final table.
 */
function overCheck(room: RoomCore, msg: ServerMessage & { type: 'over' }, checker: LeakChecker, step: number, to: SideCode) {
  const real = room.realState;
  if (!room.meta.over) return checker.fail(step, to, 'seat', '`over` sent before the room ended the game');
  if (msg.winner === null || !real?.winner) {
    if (msg.final !== undefined) checker.fail(step, to, 'seat', 'a final table sent for a game with no winner');
    return;
  }
  if (!msg.final) return checker.fail(step, to, 'seat', 'a won game ended without the final table');
  const d = firstDiff(JSON.parse(JSON.stringify(msg.final)), JSON.parse(JSON.stringify(real)));
  if (d) checker.fail(step, to, 'seat', 'the final table is not the real final state', d);
}

/** A message as the twin check compares it: the final table is full information by design (both twins' real states), so it is left out. */
const comparable = (msg: ServerMessage): ServerMessage => (msg.type === 'over' && msg.final ? { type: 'over', winner: msg.winner, reason: msg.reason } : msg);

function reconnectCheck(room: RoomCore, clients: Record<SideCode, Client>, checker: LeakChecker, step: number, side: SideCode) {
  const got = room.connect(side).find(m => m.type === 'state');
  const d = firstDiff(got ?? null, clients[side].last);
  if (d) checker.fail(step, side, 'seat', 'a reconnect is not the last state the seat was sent', d);
}

const JUNK = 'JUNK chat text';

/** Sends a junk variant of a legal move (or of nothing); whatever happens, the junk text reaches no message and no stored move. */
function junkCheck(room: RoomCore, clients: Record<SideCode, Client>, checker: LeakChecker, step: number, rng: RngState, deliver: (out: Outbox, mover: SideCode | null) => void) {
  const side = SIDES[nextInt(rng, 2)];
  const client = clients[side];
  const base = client.last?.legal[nextInt(rng, Math.max(1, client.last.legal.length))];
  const variants: unknown[] = [
    { type: 'SET_STOPS', player: side, level: JUNK },
    { type: 'SET_STOPS', player: side, level: 'ai' },
    { type: 'CHAT', player: side, text: JUNK },
    ...(base ? [{ ...base, note: JUNK }, { ...base, cardInstanceId: JUNK }, { ...base, targetServerId: JUNK }, { ...base, choice: { kind: 'effect_choice', optionId: JUNK } }] : []),
  ];
  const raw = JSON.stringify({ type: 'act', seq: client.seq, action: variants[nextInt(rng, variants.length)] });
  const res = room.receive(side, parseClientMessage(raw), step);
  for (const o of res.out) if (JSON.stringify(o.msg).includes(JUNK)) checker.fail(step, o.to, 'seat', 'junk from a client reached a message');
  if (JSON.stringify(room.moves).includes(JUNK)) checker.fail(step, side, 'seat', 'junk from a client reached the stored moves');
  // Junk that cleans up into a legal move is a move: a deferred answer leaves the client waiting, as in the main loop
  const accepted = res.persist && !res.out.some(o => o.to === side && o.msg.type === 'error');
  if (accepted && !res.out.some(o => o.to === side && o.msg.type === 'state')) client.waiting = true;
  deliver(res.out, res.out.some(o => o.to === side && o.msg.type === 'state') ? side : null);
}

/** The stored snapshot, loaded again, greets both seats exactly like the live room. */
function persistenceCheck(room: RoomCore, checker: LeakChecker, step: number, stored: RoomFuzzResult['stored']) {
  const snap = room.snapshot();
  const json = { meta: JSON.stringify(snap.meta), state: JSON.stringify(snap.state), moves: JSON.stringify(snap.moves) };
  stored.meta = Math.max(stored.meta, json.meta.length);
  stored.state = Math.max(stored.state, json.state.length);
  stored.moves = Math.max(stored.moves, json.moves.length);
  const loaded = RoomCore.load({ meta: JSON.parse(json.meta), state: JSON.parse(json.state), moves: JSON.parse(json.moves), last: snap.last }, 0);
  for (const side of SIDES) {
    const d = firstDiff(room.connect(side), loaded.connect(side));
    if (d) checker.fail(step, side, 'seat', 'a reloaded room greets the seat differently', d);
  }
}

/**
 * Forks the room into a copy and a twin that differs in two cards hidden from
 * one side, and plays the same messages into both for a while: the blind
 * side's messages must be byte-identical (twin check, at the message level).
 */
function twinFork(room: RoomCore, clients: Record<SideCode, Client>, first: ClientMessage, checker: LeakChecker, step: number, rng: RngState, stats: RoomTwinStats, rdOnly: boolean) {
  const real = room.realState!;
  const blind: SideCode = rdOnly || nextInt(rng, 2) === 0 ? 'corp' : 'runner';
  const inRd = (p: ReturnType<typeof pickPair>) => !!p && p.every(c => real.corp.rd.includes(c));
  let pair = pickPair(real, blind, rng);
  for (let k = 0; rdOnly && k < 10 && pair && !inRd(pair); k++) pair = pickPair(real, blind, rng);
  if (rdOnly && !inRd(pair)) return;
  if (!pair) return;
  stats.forks++;
  const [a, b] = pair!.map(c => c.instanceId);
  const snap = structuredClone(room.snapshot());
  const copy = RoomCore.load(structuredClone(snap), 0);
  const twin = RoomCore.load({ ...structuredClone(snap), state: twinOf(snap.state!, a, b) }, 0);
  const label = `${pair![0].cardCode} <-> ${pair![1].cardCode}`;
  // The seeing side's next move acts on one of the cards: nothing to compare (see below)
  const firstBy = first.type === 'act' ? first.action.player : null;
  if (first.type === 'act' && firstBy !== blind && touches(copy, firstBy!, first.action, [a, b])) return;
  if (firstBy !== blind && [a, b].some(id => JSON.stringify(real.pendingPrompts).includes(`"${id}"`))) return;
  const d0 = firstDiff(copy.connect(blind).map(comparable), twin.connect(blind).map(comparable));
  if (d0) {
    checker.fail(step, blind, 'twin', `greeting differs before any move (${label})`, d0);
    return;
  }
  // The copy's clients, as far as the fork is concerned: the latest state each was sent
  const last: Record<SideCode, StateMsg | null> = { corp: clients.corp.last, runner: clients.runner.last };
  const local = createRng(nextInt(rng, 1 << 30));
  let msg: ClientMessage | null = first;
  const seqs: ServerMessage[][] = [[], []];
  const waiting = new Set<SideCode>((['corp', 'runner'] as SideCode[]).filter(x => clients[x].waiting));
  for (let i = 0; i < 25 && msg && !copy.meta.over; i++) {
    const acting = SIDES.find(s => last[s]?.waitingOn === s && !waiting.has(s));
    if (!acting) return;
    const before = { copy: copy.realState!, twin: twin.realState! };
    const r1 = copy.receive(acting, msg, step + i).out;
    const r2 = twin.receive(acting, msg, step + i).out;
    const after = { copy: copy.realState!, twin: twin.realState! };
    const okIn = (out: Outbox) => out.some(o => o.to === acting && o.msg.type === 'state');
    if (okIn(r1) !== okIn(r2)) {
      stats.illegal++;
      return;
    }
    // Shown to the blind side by the move itself (drawn, revealed, accessed by it): the twins may differ from here
    if (shown(before.copy, after.copy, blind, [a, b]) || shown(before.twin, after.twin, blind, [a, b])) {
      stats.revealed++;
      return;
    }
    // A prompt the seeing side gets for one of the cards (an R&D access) is not a stop: it must not show in the blind seat's messages.
    // At 'full' each move must send the blind seat the same messages. With the Runner at 'auto' only the sequence must be the
    // same: a pause on an R&D access may hold the Corp's next state back for a move (a timing tell Jeff accepted for AUTO).
    const toBlind = (out: Outbox) => out.filter(o => o.to === blind).map(o => comparable(o.msg));
    seqs[0].push(...toBlind(r1));
    seqs[1].push(...toBlind(r2));
    const n = rdOnly ? Math.min(seqs[0].length, seqs[1].length) : Math.max(seqs[0].length, seqs[1].length);
    const d = firstDiff(seqs[0].slice(0, n), seqs[1].slice(0, n));
    stats.compared++;
    if (d) {
      checker.fail(step + i, blind, 'twin', `${msg.type === 'act' ? `${msg.action.type} by ${msg.action.player}` : msg.type}: the blind seat's messages differ (${label})`, d);
      return;
    }
    // Both twins greet a reconnecting blind seat alike (review R1)
    if (nextInt(local, 5) === 0) {
      const dc = firstDiff(copy.connect(blind).map(comparable), twin.connect(blind).map(comparable));
      if (dc) {
        checker.fail(step + i, blind, 'twin', `a reconnect differs between the twins (${label})`, dc);
        return;
      }
    }
    for (const { to, msg: m } of r1) {
      if (m.type !== 'state') continue;
      last[to] = m;
      waiting.delete(to);
    }
    if (!r1.some(o => o.to === acting)) waiting.add(acting);
    const next = SIDES.find(s => last[s]?.waitingOn === s && !waiting.has(s));
    if (!next) return;
    const fake = new Client(next);
    fake.last = last[next];
    msg = randomMessage(fake, local);
    // The seeing side acting on one of the cards (installing it, declaring it), or answering a prompt of its own that
    // names one (it looks at the top of R&D): its answer means something else in the twin, and what follows is the
    // card's own doing. Compared up to here; the blind seat's messages of the move that raised the prompt were.
    const named = (room: RoomCore) => JSON.stringify(room.realState!.pendingPrompts.filter(p => p.side === next));
    if (msg?.type === 'act' && next !== blind && (touches(copy, next, msg.action, [a, b]) || [copy, twin].some(r => [a, b].some(id => named(r).includes(`"${id}"`))))) {
      stats.revealed++;
      return;
    }
  }
}

/** Does a seat's action (in its ids) name one of these real cards? */
function touches(room: RoomCore, side: SideCode, action: GameAction, real: string[]): boolean {
  const ids = room.inspect(side)!.ids;
  const named = JSON.stringify(action).match(/\b[cr]\d+\b/g) ?? [];
  return named.some(v => real.includes(ids.real[v]));
}

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

export function summarize(results: RoomFuzzResult[]): string {
  const sizes = results.flatMap(r => r.sizes);
  const times = results.flatMap(r => r.times);
  const wakes = results.flatMap(r => r.wakes);
  const stored = results.reduce((m, r) => ({ meta: Math.max(m.meta, r.stored.meta), state: Math.max(m.state, r.stored.state), moves: Math.max(m.moves, r.stored.moves) }), { meta: 0, state: 0, moves: 0 });
  const twin = results.reduce((t, r) => ({ forks: t.forks + r.twin.forks, compared: t.compared + r.twin.compared, revealed: t.revealed + r.twin.revealed, illegal: t.illegal + r.twin.illegal }), { forks: 0, compared: 0, revealed: 0, illegal: 0 });
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  return [
    `state messages: ${sizes.length}, size p50 ${kb(quantile(sizes, 0.5))}, p99 ${kb(quantile(sizes, 0.99))}, max ${kb(Math.max(0, ...sizes))}`,
    `time per accepted move (receive, incl. both views and legal actions): p50 ${quantile(times, 0.5).toFixed(2)} ms, p99 ${quantile(times, 0.99).toFixed(2)} ms, max ${Math.max(0, ...times).toFixed(2)} ms`,
    ...(wakes.length ? [`whole wake (sampled ${wakes.length}): p50 ${quantile(wakes, 0.5).toFixed(2)} ms, p99 ${quantile(wakes, 0.99).toFixed(2)} ms, max ${Math.max(...wakes).toFixed(2)} ms`] : []),
    `largest stored values: meta ${kb(stored.meta)}, state ${kb(stored.state)}, moves ${kb(stored.moves)}`,
    `twin: ${twin.forks} forks, ${twin.compared} moves compared, ${twin.revealed} ended as revealed, ${twin.illegal} ended as illegal in the twin`,
  ].join('\n');
}

/** Every deck we have, paired like leak-fuzz.ts. */
export function roomPairing(g: number): [DeckList, DeckList] {
  const pool = [...new Map([...ALL_DECKS, ...NRDB_TEST_DECKS, ...IDENTITY_TEST_DECKS].map(d => [d.id, d])).values()];
  const corps = pool.filter(d => d.side === 'corp');
  const runners = pool.filter(d => d.side === 'runner');
  // Walk until both decks share an online format
  for (let k = 0; k < corps.length * runners.length; k++) {
    const c = corps[(g * 7 + k) % corps.length];
    const r = runners[(g * 5 + 3 + k * 3) % runners.length];
    if (onlineFormat(c, r)) return [c, r];
  }
  throw new Error('no deck pair shares an online format');
}
