/**
 * The game server's room (multiplayer phase 2, chunk 2b: server/room.ts),
 * without the Workers runtime: create and join, seats, seq, the held choice,
 * concede and the end, reconnects, persistence and errors.
 */
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, SideCode, executeAction } from '../src/core';
import { STARTER_DECKS } from '../src/data/decks';
import { RoomCore, checkDeck, settledFor, storageWrites, ENDED_LIFETIME_MS, IDLE_LIFETIME_MS } from '../server/room';
import type { Outbox, RoomSnapshot, StoredRefs } from '../server/room';
import { MAX_GAME_MOVES, SOCKET_BUDGET, STOPS_BUDGET, TOO_LONG_REASON, lifetimeOverride, take } from '../server/limits';
import type { Bucket } from '../server/limits';
import type { ClientMessage } from '../src/net/protocol';
import { SOCKET_ERROR_TEXT, displayRoomCode, parseClientMessage, parseRoomCode } from '../src/net/protocol';
import type { ServerMessage } from '../src/net/protocol';
import { submission } from '../scripts/leak-check-room';
import { giveCard, newGame, startRunnerTurn } from './helpers';

const corpStarter = submission(STARTER_DECKS[0]);
const runnerStarter = submission(STARTER_DECKS[1]);
const JAILBREAK = '30028';
type StateMsg = ServerMessage & { type: 'state' };

function newRoom(side: SideCode = 'corp', format: 'casual' | 'standard' = 'casual'): RoomCore {
  const made = RoomCore.create({ code: 'K7QM2X', side, deck: side === 'corp' ? corpStarter : runnerStarter, format, playerId: 'host-player', tokenHash: 'host-hash', build: 'test', seed: 7, now: 1000 });
  if (!(made instanceof RoomCore)) throw new Error(JSON.stringify(made));
  return made;
}

function started(): { room: RoomCore; out: Outbox } {
  const room = newRoom();
  const res = room.join({ deck: runnerStarter, playerId: 'guest-player', tokenHash: 'guest-hash', now: 2000 });
  if ('error' in res) throw new Error(JSON.stringify(res));
  return { room, out: res.out };
}

const statesTo = (out: Outbox, side: SideCode) => out.filter(o => o.to === side && o.msg.type === 'state').map(o => o.msg as StateMsg);
const errorsTo = (out: Outbox, side: SideCode) => out.filter(o => o.to === side && o.msg.type === 'error').map(o => (o.msg as ServerMessage & { type: 'error' }).code);
const lastState = (room: RoomCore, side: SideCode) => room.connect(side).find(m => m.type === 'state') as StateMsg;

/** Plays the seat's first legal action of a type (or any). */
function act(room: RoomCore, side: SideCode, pick: (a: GameAction) => boolean = () => true, now = 3000) {
  const s = lastState(room, side);
  const action = s.legal.find(pick);
  if (!action) throw new Error(`no legal action for ${side}: ${JSON.stringify(s.legal.map(a => a.type))}`);
  return room.receive(side, { type: 'act', seq: s.seq, action }, now);
}

/** Both players keep their hands. */
function pastMulligans(room: RoomCore) {
  for (let i = 0; i < 4 && room.realState!.pendingPrompts.some(p => p.kind === 'mulligan'); i++) {
    const side = room.realState!.pendingPrompts[0].side;
    act(room, side, a => a.type === 'RESOLVE_PROMPT' && a.choice.kind === 'mulligan' && !a.choice.mulligan);
  }
}

/** A room loaded around a state made for the test (the meta of a started room). */
function roomWith(state: GameState): RoomCore {
  const { room } = started();
  const snap: RoomSnapshot = { meta: { ...structuredClone(room.meta), ids: null }, state, moves: [] };
  return RoomCore.load(snap, 5000);
}

describe('Room codes and client messages', () => {
  it('codes use no 0/O/1/I and show as K7QM-2X', () => {
    expect(displayRoomCode('K7QM2X')).toBe('K7QM-2X');
    expect(parseRoomCode('k7qm-2x')).toBe('K7QM2X');
    expect(parseRoomCode('K7QM-20')).toBeNull();
    expect(parseRoomCode('KOQM2X')).toBeNull();
    expect(parseRoomCode('K7QM2')).toBeNull();
  });

  it('client messages are checked for shape', () => {
    expect(parseClientMessage('{"type":"ping"}')).toEqual({ type: 'ping' });
    expect(parseClientMessage('{"type":"cancel","seq":3}')).toEqual({ type: 'cancel', seq: 3 });
    expect(parseClientMessage('{"type":"act","seq":-1,"action":{"type":"PASS","player":"corp"}}')).toBeNull();
    expect(parseClientMessage('{"type":"act","seq":1,"action":{"type":"PASS","player":"spectator"}}')).toBeNull();
    expect(parseClientMessage('{"type":"chat","text":"hi"}')).toBeNull();
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage('x'.repeat(20_000))).toBeNull();
  });
});

describe('Client actions are rebuilt and checked (review R2: no free text anywhere)', () => {
  const act = (action: unknown) => parseClientMessage(JSON.stringify({ type: 'act', seq: 1, action }));
  it('stops only auto, full or none; no free text', () => {
    expect(act({ type: 'SET_STOPS', player: 'corp', level: 'full' })).toEqual({ type: 'act', seq: 1, action: { type: 'SET_STOPS', player: 'corp', level: 'full' } });
    expect(act({ type: 'SET_STOPS', player: 'corp', level: 'hello runner, this is chat' })).toBeNull();
    expect(act({ type: 'SET_STOPS', player: 'corp', level: 'ai' })).toBeNull();
  });
  it('extra keys are dropped; ids, servers, prompt ids and numbers must have their shape', () => {
    expect(act({ type: 'GAIN_CREDIT', player: 'corp', note: 'hi' })).toEqual({ type: 'act', seq: 1, action: { type: 'GAIN_CREDIT', player: 'corp' } });
    expect(act({ type: 'INSTALL_CARD', player: 'corp', cardInstanceId: 'c4', targetServerId: 'remote-2', trashFirst: ['c1'], x: 1 })).toMatchObject({ action: { type: 'INSTALL_CARD', cardInstanceId: 'c4', targetServerId: 'remote-2', trashFirst: ['c1'] } });
    expect(act({ type: 'INSTALL_CARD', player: 'corp', cardInstanceId: 'inst-4' })).toBeNull();
    expect(act({ type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq; chat' })).toBeNull();
    expect(act({ type: 'USE_ABILITY', player: 'runner', cardInstanceId: 'r3', abilityIndex: 1.5 })).toBeNull();
    expect(act({ type: 'RESOLVE_PROMPT', player: 'runner', promptId: 'prompt-3', choice: { kind: 'effect_choice', optionId: 'a long free text message' } })).toBeNull();
    expect(act({ type: 'RESOLVE_PROMPT', player: 'runner', promptId: 'prompt-3', choice: { kind: 'effect_cards', cardInstanceIds: ['r1', 'r2'], note: 'x' } })).toMatchObject({ action: { choice: { kind: 'effect_cards', cardInstanceIds: ['r1', 'r2'] } } });
    expect(act({ type: 'CHAT', player: 'corp' })).toBeNull();
  });
  it('the room takes only what the seat was offered, and stores nothing it did not check', () => {
    const { room } = started();
    pastMulligans(room);
    const s = lastState(room, 'corp');
    // Well-formed but not offered (a server the Corp can't run on)
    const res = room.receive('corp', { type: 'act', seq: s.seq, action: { type: 'INITIATE_RUN', player: 'corp', targetServerId: 'hq' } }, 0);
    expect(errorsTo(res.out, 'corp')).toEqual(['illegal']);
    const credit = parseClientMessage(JSON.stringify({ type: 'act', seq: s.seq, action: { type: 'GAIN_CREDIT', player: 'corp', note: 'chat' } }));
    room.receive('corp', credit, 0);
    expect(JSON.stringify(room.moves)).not.toContain('chat');
    expect(room.moves.at(-1)).toEqual({ type: 'GAIN_CREDIT', player: 'corp' });
  });

  it('cards discarded down to hand size count as a set: any order of an offered set is taken (rules 4.3.6, 5.5.3)', () => {
    const s = newGame(7);
    startRunnerTurn(s);
    s.pendingPrompts = [{ id: 'prompt-1', kind: 'discard', side: 'runner', message: 'Discard down to hand size.', cards: [], count: 2 }] as never;
    const room = roomWith(s);
    const st = lastState(room, 'runner');
    const offered = st.legal.find(a => a.type === 'RESOLVE_PROMPT' && a.choice.kind === 'discard')!;
    expect(offered).toBeDefined();
    const ids = (offered as GameAction & { choice: { cardInstanceIds: string[] } }).choice.cardInstanceIds;
    const reversed = { ...offered, choice: { kind: 'discard', cardInstanceIds: [...ids].reverse() } } as GameAction;
    const res = room.receive('runner', { type: 'act', seq: st.seq, action: reversed }, 0);
    expect(errorsTo(res.out, 'runner')).toEqual([]);
    expect(room.moves.length).toBe(1);
  });
});

describe('Creating and joining (rules 1.4.1a, deck legality)', () => {
  it('creates a room with the host seated and nothing started', () => {
    const room = newRoom('runner');
    expect(room.started).toBe(false);
    expect(room.lobby()).toEqual({ code: 'K7QM2X', format: 'casual', hostSide: 'runner', hostIdentity: runnerStarter.identity, open: true, over: false, build: 'test', protocol: 1 });
    // The lobby never carries a decklist
    expect(JSON.stringify(room.lobby())).not.toContain(runnerStarter.cards[0]);
    expect(room.connect('runner')).toEqual([{ type: 'hello', seat: 'runner', build: 'test', protocol: 1 }]);
    expect(errorsTo(room.receive('runner', { type: 'act', seq: 0, action: { type: 'PASS', player: 'runner' } }, 0).out, 'runner')).toEqual(['not_started']);
  });

  it('casual online is for the starter decks only (rules 1.4.1a); Startup and Standard use validateDeck', () => {
    expect(checkDeck(corpStarter, 'casual', 'corp')).toEqual({ ok: true });
    const changed = { ...corpStarter, cards: corpStarter.cards.slice(1) };
    expect(checkDeck(changed, 'casual', 'corp').ok).toBe(false);
    // The starter identities are not legal under full deck construction (1.4.1a)
    const res = checkDeck(corpStarter, 'standard', 'corp');
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reasons.join(' ')).toMatch(/starter-only/);
    expect(checkDeck(corpStarter, 'casual', 'runner').ok).toBe(false);
    expect(checkDeck({ identity: 5, cards: [] }, 'standard', 'corp').ok).toBe(false);
  });

  it('refuses an illegal host deck and an unknown format', () => {
    const base = { code: 'K7QM2X', side: 'corp' as const, playerId: 'host-player', tokenHash: 'h', build: 'test', seed: 1, now: 0 };
    expect(RoomCore.create({ ...base, deck: corpStarter, format: 'standard' })).toMatchObject({ error: 'illegal_deck' });
    expect(RoomCore.create({ ...base, deck: corpStarter, format: 'eternal' as never })).toMatchObject({ error: 'bad_request' });
    expect(RoomCore.create({ ...base, deck: corpStarter, format: 'casual', playerId: 'x' })).toMatchObject({ error: 'bad_request' });
  });

  it('the guest takes the other seat, the game starts and both seats get their first state', () => {
    const { room, out } = started();
    expect(room.started).toBe(true);
    expect(room.lobby().open).toBe(false);
    expect(statesTo(out, 'corp')).toHaveLength(1);
    expect(statesTo(out, 'runner')).toHaveLength(1);
    expect(statesTo(out, 'corp')[0]).toMatchObject({ seq: 1, view: { viewer: 'corp' } });
    expect(statesTo(out, 'runner')[0]).toMatchObject({ seq: 1, view: { viewer: 'runner' } });
  });

  it('refuses an illegal guest deck with its reasons, and a full room', () => {
    const room = newRoom();
    expect(room.join({ deck: corpStarter, playerId: 'guest-player', tokenHash: 'g', now: 0 })).toMatchObject({ error: 'illegal_deck', reasons: [expect.any(String)] });
    expect(room.started).toBe(false);
    expect('seat' in room.join({ deck: runnerStarter, playerId: 'guest-player', tokenHash: 'g', now: 0 })).toBe(true);
    expect(room.join({ deck: runnerStarter, playerId: 'third-player', tokenHash: 'x', now: 0 })).toEqual({ error: 'full' });
  });

  it('seats are found by token hash only', () => {
    const { room } = started();
    expect(room.seatOf('host-hash')).toBe('corp');
    expect(room.seatOf('guest-hash')).toBe('runner');
    expect(room.seatOf('host-player')).toBeNull();
  });
});

describe('Acting (spec rules 1 and 2)', () => {
  it('only the acting seat acts; a stale seq is refused, so a double tap plays once', () => {
    const { room } = started();
    pastMulligans(room);
    const corp = lastState(room, 'corp');
    expect(corp.waitingOn).toBe('corp');
    expect(lastState(room, 'runner').legal).toEqual([]);
    const credit = corp.legal.find(a => a.type === 'GAIN_CREDIT')!;
    const moves = room.moves.length;
    const first = room.receive('corp', { type: 'act', seq: corp.seq, action: credit }, 3000);
    expect(statesTo(first.out, 'corp')).toHaveLength(1);
    expect(first.persist).toBe(true);
    const again = room.receive('corp', { type: 'act', seq: corp.seq, action: credit }, 3001);
    expect(errorsTo(again.out, 'corp')).toEqual(['stale']);
    expect(again.persist).toBe(false);
    expect(room.moves.length).toBe(moves + 1);
    // The Runner may not act for the Corp, nor act out of turn
    const r = lastState(room, 'runner');
    expect(errorsTo(room.receive('runner', { type: 'act', seq: r.seq, action: credit }, 0).out, 'runner')).toEqual(['not_your_turn']);
    expect(errorsTo(room.receive('runner', { type: 'act', seq: r.seq, action: { type: 'GAIN_CREDIT', player: 'runner' } }, 0).out, 'runner')).toEqual(['not_your_turn']);
  });

  it("each seat's seq counts its own states, one by one", () => {
    const { room } = started();
    pastMulligans(room);
    const before = { corp: lastState(room, 'corp').seq, runner: lastState(room, 'runner').seq };
    const out = act(room, 'corp', a => a.type === 'GAIN_CREDIT').out;
    expect(statesTo(out, 'corp')[0].seq).toBe(before.corp + 1);
    // The Runner sees the credit too (public, 1.10.2), and its count goes up by one
    expect(statesTo(out, 'runner')[0].seq).toBe(before.runner + 1);
  });

  it('an unchanged view is not sent again to the other seat', () => {
    const { room } = started();
    pastMulligans(room);
    const r = lastState(room, 'runner');
    // The Runner's own stops: the Corp's view shows stops (public) so it hears; setting the same level again changes nothing
    const first = room.receive('runner', { type: 'act', seq: r.seq, action: { type: 'SET_STOPS', player: 'runner', level: 'full' } }, 0);
    expect(statesTo(first.out, 'runner')).toHaveLength(1);
    expect(statesTo(first.out, 'corp')).toHaveLength(1);
    // Chunk 2e: the same level again is no move at all, so neither seat hears anything (it used to send the mover its state)
    const again = room.receive('runner', { type: 'act', seq: r.seq + 1, action: { type: 'SET_STOPS', player: 'runner', level: 'full' } }, 0);
    expect(again).toEqual({ out: [], persist: false });
  });

  it('errors are fixed wording, never the engine text (which can name a hidden card)', () => {
    const { room } = started();
    pastMulligans(room);
    const s = lastState(room, 'corp');
    // A card id the Corp can't see
    const res = room.receive('corp', { type: 'act', seq: s.seq, action: { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: 'c999', targetServerId: 'new' } as GameAction }, 0);
    expect(res.out).toEqual([{ to: 'corp', msg: { type: 'error', code: 'illegal', message: SOCKET_ERROR_TEXT.illegal } }]);
    // An action the engine refuses: its message stays in the server's log
    const end = room.receive('corp', { type: 'act', seq: s.seq, action: { type: 'END_TURN', player: 'corp' } }, 0);
    expect(end.out).toEqual([{ to: 'corp', msg: { type: 'error', code: 'illegal', message: SOCKET_ERROR_TEXT.illegal } }]);
    expect(room.errors.at(-1)).toMatch(/corp: /);
    expect(room.receive('corp', null, 0).out[0].msg).toMatchObject({ type: 'error', code: 'bad_message' });
    expect(room.receive('corp', { type: 'ping' }, 0).out).toEqual([{ to: 'corp', msg: { type: 'pong' } }]);
  });
});

describe('The held choice (spec rule 3)', () => {
  function jailbreakRoom() {
    const s = newGame(3);
    startRunnerTurn(s);
    const id = giveCard(s, 'runner', JAILBREAK);
    const room = roomWith(s);
    const r = lastState(room, 'runner');
    const play = r.legal.find(a => a.type === 'PLAY_OPERATION_OR_EVENT' && room.inspect('runner')!.ids.real[a.cardInstanceId] === id)!;
    return { room, play, seq: r.seq };
  }

  it("the actor sees the held choice; the other seat hears nothing until it commits", () => {
    const { room, play, seq } = jailbreakRoom();
    const corpBefore = lastState(room, 'corp');
    const held = room.receive('runner', { type: 'act', seq, action: play }, 0);
    expect(statesTo(held.out, 'corp')).toEqual([]);
    const rs = statesTo(held.out, 'runner')[0];
    expect(rs.held).toBe(true);
    expect(rs.view.pendingPrompts[0]).toMatchObject({ kind: 'effect_choice' });
    expect(room.moves).toEqual([]);
    // The Corp's reconnect shows the committed game, not the held one
    expect(lastState(room, 'corp').view).toEqual(corpBefore.view);
    // Answering commits the play and the answer as one move; the Corp hears once
    const pick = rs.legal.find(a => a.type === 'RESOLVE_PROMPT')!;
    const done = room.receive('runner', { type: 'act', seq: rs.seq, action: pick }, 0);
    expect(room.moves.map(m => m.type)).toEqual(['PLAY_OPERATION_OR_EVENT', 'RESOLVE_PROMPT']);
    expect(statesTo(done.out, 'runner')[0].held).toBe(false);
    expect(statesTo(done.out, 'corp')).toHaveLength(1);
  });

  it('cancel drops it: the game is as it was and the other seat heard nothing', () => {
    const { room, play, seq } = jailbreakRoom();
    const before = lastState(room, 'runner').view;
    const held = statesTo(room.receive('runner', { type: 'act', seq, action: play }, 0).out, 'runner')[0];
    expect(errorsTo(room.receive('runner', { type: 'cancel', seq: held.seq - 1 }, 0).out, 'runner')).toEqual(['stale']);
    expect(errorsTo(room.receive('corp', { type: 'cancel', seq: lastState(room, 'corp').seq }, 0).out, 'corp')).toEqual(['nothing_held']);
    const res = room.receive('runner', { type: 'cancel', seq: held.seq }, 0);
    expect(res.out.map(o => o.to)).toEqual(['runner']);
    expect(statesTo(res.out, 'runner')[0]).toMatchObject({ held: false, view: before });
    expect(room.moves).toEqual([]);
  });

  it('the other seat changing its stops keeps the held choice, and neither seat sees the other one', () => {
    const { room, play, seq } = jailbreakRoom();
    room.receive('runner', { type: 'act', seq, action: play }, 0);
    const c = lastState(room, 'corp');
    // (At 'full' the Corp would get priority before Jailbreak's choice, so the choice could no longer be held, and is dropped)
    const res = room.receive('corp', { type: 'act', seq: c.seq, action: { type: 'SET_STOPS', player: 'corp', level: 'none' } }, 0);
    const corp = statesTo(res.out, 'corp')[0];
    expect(corp.view.pendingPrompts).toEqual([]);
    expect(corp.held).toBe(false);
    const runner = statesTo(res.out, 'runner')[0];
    expect(runner.held).toBe(true);
    expect(runner.view.pendingPrompts[0]).toMatchObject({ kind: 'effect_choice' });
    expect(room.moves.map(m => m.type)).toEqual(['SET_STOPS']);
    // A level under which the choice can't be held any more drops it: nothing of it was applied
    const c2 = lastState(room, 'corp');
    const res2 = room.receive('corp', { type: 'act', seq: c2.seq, action: { type: 'SET_STOPS', player: 'corp', level: 'full' } }, 0);
    expect(statesTo(res2.out, 'runner')[0]).toMatchObject({ held: false, view: { pendingPrompts: [] } });
    expect(room.moves.map(m => m.type)).toEqual(['SET_STOPS', 'SET_STOPS']);
  });

  it('a held choice survives a reload (worked out again from the stored action)', () => {
    const { room, play, seq } = jailbreakRoom();
    room.receive('runner', { type: 'act', seq, action: play }, 0);
    const again = RoomCore.load(structuredClone(room.snapshot()), 0);
    expect(again.connect('runner')).toEqual(room.connect('runner'));
    expect(again.connect('corp')).toEqual(room.connect('corp'));
  });
});

describe('Storage writes (rows written are the free plan\'s daily limit)', () => {
  it('a save writes meta, and the rest only when it changed', () => {
    const { room } = started();
    pastMulligans(room);
    let { put, refs } = storageWrites(null, room.snapshot());
    expect(Object.keys(put).sort()).toEqual(['last:corp', 'last:runner', 'meta', 'moves', 'state']);
    // A committed move: the state, the moves, and the last state of each seat that was sent one
    const res = act(room, 'corp', a => a.type === 'GAIN_CREDIT');
    ({ put, refs } = storageWrites(refs, room.snapshot()));
    const sent = (['corp', 'runner'] as SideCode[]).filter(x => statesTo(res.out, x).length > 0);
    expect(sent).toContain('corp');
    expect(Object.keys(put).sort()).toEqual([...sent.map(x => `last:${x}`), 'meta', 'moves', 'state'].sort());
    // Nothing changed: meta only
    expect(Object.keys(storageWrites(refs, room.snapshot()).put)).toEqual(['meta']);
  });

  it('creating a room writes meta only (a missing key loads as empty); joining then writes the game (chunk 2e)', () => {
    const room = newRoom();
    const created = storageWrites(null, room.snapshot());
    expect(Object.keys(created.put)).toEqual(['meta']);
    const res = room.join({ deck: runnerStarter, playerId: 'guest-player', tokenHash: 'guest-hash', now: 2000 });
    expect('error' in res).toBe(false);
    expect(Object.keys(storageWrites(created.refs, room.snapshot()).put).sort()).toEqual(['last:corp', 'last:runner', 'meta', 'state']);
    // What the Durable Object would load from meta alone is the room as created
    const loaded = RoomCore.load({ meta: newRoom().meta, state: null, moves: [], last: { corp: null, runner: null } }, 0);
    expect(loaded.snapshot()).toEqual(newRoom().snapshot());
  });

  it('a held choice writes meta and the holder\'s last state only', () => {
    const s = newGame(3);
    startRunnerTurn(s);
    const id = giveCard(s, 'runner', JAILBREAK);
    const room = roomWith(s);
    const r = lastState(room, 'runner');
    const play = r.legal.find(a => a.type === 'PLAY_OPERATION_OR_EVENT' && room.inspect('runner')!.ids.real[a.cardInstanceId] === id)!;
    const { refs } = storageWrites(null, room.snapshot());
    const res = room.receive('runner', { type: 'act', seq: r.seq, action: play }, 0);
    expect(statesTo(res.out, 'runner')[0].held).toBe(true);
    expect(Object.keys(storageWrites(refs, room.snapshot()).put).sort()).toEqual(['last:runner', 'meta']);
  });
});

describe('Concede, the end and lifetime (spec rules 7 and 8)', () => {
  it('concede works any time for one\'s own side and ends the game for both', () => {
    const { room } = started();
    pastMulligans(room);
    const r = lastState(room, 'runner');
    expect(r.waitingOn).toBe('corp');
    const res = room.receive('runner', { type: 'act', seq: r.seq, action: { type: 'CONCEDE', player: 'runner' } }, 9000);
    // Chunk 2d: a concession ends the game like any other end, so both seats get the final table (rule 1.7.1)
    const final = room.realState!;
    expect(res.out.filter(o => o.msg.type === 'over').map(o => ({ to: o.to, msg: o.msg }))).toEqual([
      { to: 'corp', msg: { type: 'over', winner: 'corp', reason: 'Runner conceded', final } },
      { to: 'runner', msg: { type: 'over', winner: 'corp', reason: 'Runner conceded', final } },
    ]);
    expect(statesTo(res.out, 'corp')).toHaveLength(1);
    expect(room.lobby()).toMatchObject({ over: true, open: false });
    expect(room.expiresAt()).toBe(9000 + ENDED_LIFETIME_MS);
    expect(errorsTo(room.receive('corp', { type: 'act', seq: lastState(room, 'corp').seq, action: { type: 'PASS', player: 'corp' } }, 0).out, 'corp')).toEqual(['over']);
    // A reconnect after the end gets hello, the last state and the result
    expect(room.connect('corp').map(m => m.type)).toEqual(['hello', 'state', 'over']);
  });

  it('a room is deleted 7 days after its last move', () => {
    const { room } = started();
    expect(room.expiresAt()).toBe(2000 + IDLE_LIFETIME_MS);
    pastMulligans(room);
    act(room, 'corp', a => a.type === 'GAIN_CREDIT', 50_000);
    expect(room.expiresAt()).toBe(50_000 + IDLE_LIFETIME_MS);
  });

  it('a stored state that no longer loads ends the game as a draw instead of throwing', () => {
    const { room } = started();
    const snap = structuredClone(room.snapshot());
    (snap.state as unknown as Record<string, unknown>).corp = null;
    const broken = RoomCore.load(snap, 7000);
    expect(broken.meta.over).toEqual({ winner: null, reason: 'server update' });
    expect(broken.connect('runner')).toEqual([{ type: 'hello', seat: 'runner', build: 'test', protocol: 1 }, { type: 'over', winner: null, reason: 'server update' }]);
    expect(broken.errors[0]).toMatch(/load failed/);
  });
});

/** Every message of a game played out with random legal moves (no conceding), in the order sent. */
function playOut(seed: number, maxMoves = 4000): { room: RoomCore; sent: Outbox } {
  const { room, out } = started();
  const sent: Outbox = [...out];
  let x = seed;
  const rand = (n: number) => {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    return (x >>> 8) % n;
  };
  for (let i = 0; i < maxMoves && !room.meta.over; i++) {
    const side = (['corp', 'runner'] as SideCode[]).find(s => lastState(room, s).waitingOn === s && lastState(room, s).legal.length > 0);
    if (!side) break;
    const s = lastState(room, side);
    const legal = s.legal.filter(a => a.type !== 'CONCEDE' && a.type !== 'SET_STOPS');
    const busy = legal.filter(a => a.type !== 'END_TURN' && a.type !== 'PASS');
    const pool = busy.length > 0 && rand(4) > 0 ? busy : legal;
    sent.push(...room.receive(side, { type: 'act', seq: s.seq, action: pool[rand(pool.length)] }, 3000 + i).out);
  }
  return { room, sent };
}

describe('The final table (chunk 2d; rule 1.7.1)', () => {
  it('a game won at the table sends both seats the whole final state with `over`, and no message before it carries one', () => {
    const { room, sent } = playOut(11);
    expect(room.meta.over?.winner).toBeTruthy();
    expect(room.meta.over?.reason).not.toMatch(/conceded/);
    const firstOver = sent.findIndex(o => o.msg.type === 'over');
    expect(firstOver).toBeGreaterThan(0);
    // Nothing before the end carries the real state, by key or by its JSON
    for (const o of sent.slice(0, firstOver)) {
      expect('final' in o.msg).toBe(false);
      expect(o.text ?? JSON.stringify(o.msg)).not.toContain('"final"');
    }
    const overs = sent.slice(firstOver);
    expect(overs.map(o => [o.to, o.msg.type])).toEqual([
      ['corp', 'over'],
      ['runner', 'over'],
    ]);
    for (const o of overs) {
      expect(o.msg).toEqual({ type: 'over', ...room.meta.over, final: room.realState });
      // Sent as JSON, and the JSON reads back as the same state (both hands, R&D, everything)
      expect(JSON.parse(o.text!)).toEqual(JSON.parse(JSON.stringify(o.msg)));
    }
    const final = (overs[0].msg as ServerMessage & { type: 'over' }).final!;
    expect(final.winner).toBe(room.meta.over!.winner);
    expect(final.corp.hq.length + final.runner.grip.length).toBeGreaterThan(0);
  });

  it('a reconnect to a finished room, live or reloaded from storage, gets the final table again', () => {
    const { room } = started();
    pastMulligans(room);
    room.receive('corp', { type: 'act', seq: lastState(room, 'corp').seq, action: { type: 'CONCEDE', player: 'corp' } }, 9000);
    const final = room.realState!;
    for (const r of [room, RoomCore.load(JSON.parse(JSON.stringify(room.snapshot())) as RoomSnapshot, 10_000)]) {
      for (const side of ['corp', 'runner'] as SideCode[]) {
        const msgs = r.connect(side);
        expect(msgs.map(m => m.type)).toEqual(['hello', 'state', 'over']);
        expect(msgs[2]).toEqual({ type: 'over', winner: 'runner', reason: 'Corp conceded', final: JSON.parse(JSON.stringify(final)) });
      }
    }
  });

  it('not for a game the room could not read ("server update": nothing trustworthy to show)', () => {
    const { room } = started();
    const snap = structuredClone(room.snapshot());
    (snap.state as unknown as Record<string, unknown>).corp = null;
    const broken = RoomCore.load(snap, 7000);
    const over = broken.connect('corp').find(m => m.type === 'over')!;
    expect(over).toEqual({ type: 'over', winner: null, reason: 'server update' });
    expect('final' in over).toBe(false);
  });

  it('bug reports are unchanged by it', () => {
    const { room } = started();
    pastMulligans(room);
    room.receive('runner', { type: 'act', seq: lastState(room, 'runner').seq, action: { type: 'CONCEDE', player: 'runner' } }, 9000);
    expect(room.reportFor('corp')).toMatchObject({ full: true, state: room.realState, over: { winner: 'corp', reason: 'Runner conceded' } });
    expect(Object.keys(room.reportFor('corp')).sort()).toEqual(['build', 'code', 'decks', 'format', 'full', 'moveCount', 'moves', 'over', 'seat', 'seed', 'state', 'view']);
  });
});

describe('Reconnect and persistence (spec rules 4 and 5)', () => {
  it('a reconnect gets hello and the same state the seat was last sent', () => {
    const { room } = started();
    pastMulligans(room);
    const out = act(room, 'corp', a => a.type === 'GAIN_CREDIT').out;
    const sent = statesTo(out, 'runner')[0];
    const again = room.connect('runner');
    expect(again[0]).toEqual({ type: 'hello', seat: 'runner', build: 'test', protocol: 1 });
    expect(again[1]).toEqual(sent);
  });

  it('a stored room greets both seats exactly as the live one', () => {
    const { room } = started();
    pastMulligans(room);
    act(room, 'corp', a => a.type === 'GAIN_CREDIT');
    const loaded = RoomCore.load(JSON.parse(JSON.stringify(room.snapshot())), 0);
    for (const side of ['corp', 'runner'] as SideCode[]) expect(loaded.connect(side)).toEqual(room.connect(side));
  });
});

describe('Reconnect at an unsettled point (review R1; rules 4.2.2, 7.1.2)', () => {
  it('a Corp that reconnects while the Runner decides on an R&D card gets the state it was last sent, not the withheld moment', () => {
    const s = newGame(5);
    s.stops = { corp: 'ai', runner: 'auto' };
    startRunnerTurn(s);
    s.runner.credits = 10;
    const nico = s.corp.rd.findIndex(c => c.cardCode === '30037');
    s.corp.rd.unshift(nico >= 0 ? s.corp.rd.splice(nico, 1)[0] : giveCardTo(s));
    const room = roomWith(s);
    const got: Record<SideCode, StateMsg> = { corp: lastState(room, 'corp'), runner: lastState(room, 'runner') };
    const play = (side: SideCode, action: GameAction) => {
      for (const o of room.receive(side, { type: 'act', seq: got[side].seq, action }, 0).out) if (o.msg.type === 'state') got[o.to] = o.msg;
    };
    play('runner', got.runner.legal.find(a => a.type === 'INITIATE_RUN' && a.targetServerId === 'rd')!);
    for (let i = 0; i < 30 && !room.realState!.pendingPrompts.some(p => p.kind === 'access_trash'); i++) {
      const side = (['corp', 'runner'] as SideCode[]).find(x => got[x].waitingOn === x && got[x].legal.length > 0)!;
      play(side, got[side].legal.find(a => a.type === 'PASS' || a.type === 'CONTINUE_RUN') ?? got[side].legal[0]);
    }
    expect(room.realState!.pendingPrompts[0]).toMatchObject({ kind: 'access_trash', side: 'runner' });
    expect(settledFor(room.realState!, 'corp')).toBe(false);
    // The Corp's reconnect is the last thing it was sent, and a reloaded room says the same
    const again = room.connect('corp').find(m => m.type === 'state');
    expect(again).toEqual(got.corp);
    expect(RoomCore.load(JSON.parse(JSON.stringify(room.snapshot())), 0).connect('corp').find(m => m.type === 'state')).toEqual(got.corp);
    expect(JSON.stringify(again)).not.toContain('access_trash');
  });
});

describe('Bug reports (spec rule 9)', () => {
  it('attach the real state, moves, seed and decks, also mid-game (Jeff 2026-11-09)', () => {
    const { room } = started();
    pastMulligans(room);
    const att = room.reportFor('runner');
    expect(att).toMatchObject({ full: true, seat: 'runner', seed: 7, over: null, moveCount: room.moves.length });
    expect(att.state).toBe(room.realState);
    expect(att.decks).toEqual({ corp: corpStarter, runner: runnerStarter });
    expect(newRoom().reportFor('corp')).toMatchObject({ full: false, state: null });
  });
});

describe('Settled points (audit LEAK-ACCESS-PAUSE; rules 4.2.2, 7.1.2)', () => {
  it('the Corp is not sent the moment the Runner decides inside an access of a card from R&D', () => {
    let s = newGame(5);
    s.stops = { corp: 'ai', runner: 'auto' };
    startRunnerTurn(s);
    s.runner.credits = 10;
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'rd' });
    // A trashable asset on top of R&D: the Runner gets an access_trash prompt for it
    const nico = s.corp.rd.findIndex(c => c.cardCode === '30037');
    const card = nico >= 0 ? s.corp.rd.splice(nico, 1)[0] : giveCardTo(s);
    s.corp.rd.unshift(card);
    for (let i = 0; i < 30 && s.pendingPrompts.length === 0 && s.activeRun; i++) {
      const side = s.priority?.holder ?? 'runner';
      s = executeAction(s, side === 'runner' && s.activeRun?.phase !== 'access' ? { type: 'CONTINUE_RUN', player: 'runner' } : { type: 'PASS', player: side });
    }
    expect(s.pendingPrompts[0]).toMatchObject({ kind: 'access_trash', side: 'runner' });
    expect(settledFor(s, 'corp')).toBe(false);
    expect(settledFor(s, 'runner')).toBe(true);
  });
});

function giveCardTo(s: GameState) {
  const id = giveCard(s, 'corp', '30037');
  const i = s.corp.hq.findIndex(c => c.instanceId === id);
  return s.corp.hq.splice(i, 1)[0];
}

/** Counts the rows a room writes for each message, as the Durable Object would save them (server/gameRoom.ts save). */
function rowCounter(room: RoomCore) {
  let refs: StoredRefs = storageWrites(null, room.snapshot()).refs;
  let rows = 0;
  return {
    send(side: SideCode, msg: ClientMessage | null, now: number) {
      const res = room.receive(side, msg, now);
      if (res.persist) {
        const w = storageWrites(refs, room.snapshot());
        rows += Object.keys(w.put).length;
        refs = w.refs;
      }
      return res;
    },
    get rows() {
      return rows;
    },
  };
}

const stops = (side: SideCode, level: 'auto' | 'full' | 'none', seq = 0): ClientMessage => ({ type: 'act', seq, action: { type: 'SET_STOPS', player: side, level } });

describe('Server limits (chunk 2e; audit MP-STOPS-WRITE-FLOOD)', () => {
  it('a stops change to the level the seat already has is nothing: no move, no write, no message', () => {
    const { room } = started();
    pastMulligans(room);
    expect(room.receive('runner', stops('runner', 'full'), 10_000).persist).toBe(true);
    const moves = room.moves.length;
    const res = room.receive('runner', stops('runner', 'full'), 10_001);
    expect(res).toEqual({ out: [], persist: false });
    expect(room.moves.length).toBe(moves);
  });

  it('stops changes are budgeted per seat: 5 at once, one back every 60 s; past it the fixed wording, nothing applied or written', () => {
    const { room } = started();
    pastMulligans(room);
    // The ruling on review (2026-11-11): one back every 60 s, about 7,200 rows a day per seat at most
    expect(STOPS_BUDGET).toEqual({ burst: 5, refillMs: 60_000 });
    const levels = ['full', 'auto'] as const;
    for (let i = 0; i < STOPS_BUDGET.burst; i++) expect(room.receive('runner', stops('runner', levels[i % 2]), 10_000).persist).toBe(true);
    const moves = room.moves.length;
    const level = room.realState!.stops!.runner as 'auto' | 'full';
    const res = room.receive('runner', stops('runner', level === 'full' ? 'auto' : 'full'), 10_000);
    expect(res.persist).toBe(false);
    expect(res.out).toEqual([{ to: 'runner', msg: { type: 'error', code: 'too_many', message: 'Too many changes, wait a moment' } }]);
    expect(SOCKET_ERROR_TEXT.too_many).toBe('Too many changes, wait a moment');
    expect(room.moves.length).toBe(moves);
    expect(room.realState!.stops!.runner).toBe(level);
    // The other seat has its own budget
    expect(room.receive('corp', stops('corp', 'full'), 10_000).persist).toBe(true);
    // One back after 60 s, and it survives the room going to sleep (kept in meta, written with the allowed change)
    const slept = RoomCore.load(JSON.parse(JSON.stringify(room.snapshot())) as RoomSnapshot, 0);
    expect(slept.receive('runner', stops('runner', level === 'full' ? 'auto' : 'full'), 10_000 + STOPS_BUDGET.refillMs - 1).persist).toBe(false);
    expect(slept.receive('runner', stops('runner', level === 'full' ? 'auto' : 'full'), 10_000 + STOPS_BUDGET.refillMs).persist).toBe(true);
    const again = RoomCore.load(JSON.parse(JSON.stringify(slept.snapshot())) as RoomSnapshot, 0);
    expect(again.receive('runner', stops('runner', level), 10_000 + STOPS_BUDGET.refillMs).persist).toBe(false);
  });

  it('a room stored before the budget existed starts with a full one', () => {
    const { room } = started();
    pastMulligans(room);
    const snap = JSON.parse(JSON.stringify(room.snapshot())) as RoomSnapshot;
    delete snap.meta.stopsBudget;
    const old = RoomCore.load(snap, 0);
    expect(old.receive('runner', stops('runner', 'full'), 10_000).persist).toBe(true);
  });

  it('guard: 1,000 messages of each kind a seat can send out of turn write a small, bounded number of rows', () => {
    const kinds: Record<string, (room: RoomCore, i: number) => ClientMessage | null> = {
      'repeated stops': () => stops('runner', 'full'),
      'alternating stops': (_, i) => stops('runner', i % 2 ? 'full' : 'auto'),
      'stale act': () => ({ type: 'act', seq: 0, action: { type: 'PASS', player: 'runner' } }),
      'act out of turn': room => ({ type: 'act', seq: lastState(room, 'runner').seq, action: { type: 'GAIN_CREDIT', player: 'runner' } }),
      'cancel with nothing held': room => ({ type: 'cancel', seq: lastState(room, 'runner').seq }),
      ping: () => ({ type: 'ping' }),
      junk: () => parseClientMessage('{"type":"act","seq":1,"action":{"type":"CHAT","text":"x"}}'),
    };
    const rows: Record<string, number> = {};
    for (const [kind, make] of Object.entries(kinds)) {
      const { room } = started();
      pastMulligans(room);
      // The Runner is the one out of turn (the Corp's first turn), at 'full' already for the repeated ones
      room.receive('runner', stops('runner', 'full'), 0);
      const moves = room.moves.length;
      const count = rowCounter(room);
      // From a full stops budget again (the setup change took one)
      const t0 = STOPS_BUDGET.refillMs * STOPS_BUDGET.burst;
      for (let i = 0; i < 1000; i++) count.send('runner', make(room, i), t0 + i);
      rows[kind] = count.rows;
      expect(room.moves.length - moves, kind).toBeLessThanOrEqual(STOPS_BUDGET.burst);
    }
    // Alternating stops: the burst of 5 changes (one second of messages refills a sixtieth), 5 rows each (meta, state, moves,
    // both seats' last state: stops are public); everything else writes nothing (it was 5,000 rows on beta 22277c4)
    expect(rows).toEqual({ 'repeated stops': 0, 'alternating stops': 25, 'stale act': 0, 'act out of turn': 0, 'cancel with nothing held': 0, ping: 0, junk: 0 });
  });

  it('the socket budget: 40 at once, 5 a second back; take() never goes below empty and a stored clock from the future is full', () => {
    let b: Bucket | undefined;
    for (let i = 0; i < SOCKET_BUDGET.burst; i++) {
      const next = take(b, SOCKET_BUDGET, 1000);
      expect(next).not.toBeNull();
      b = next!;
    }
    expect(take(b!, SOCKET_BUDGET, 1000)).toBeNull();
    expect(take(b!, SOCKET_BUDGET, 1000 + SOCKET_BUDGET.refillMs)).not.toBeNull();
    expect(take({ tokens: 0, at: 5000 }, SOCKET_BUDGET, 1000)).toEqual({ tokens: SOCKET_BUDGET.burst - 1, at: 1000 });
  });

  it(`a game that reaches ${MAX_GAME_MOVES} moves ends as a draw ("game too long"), with no final table`, () => {
    const { room } = started();
    const snap = room.snapshot();
    const filler: GameAction = { type: 'SET_STOPS', player: 'corp', level: 'auto' };
    const long = RoomCore.load({ ...structuredClone(snap), moves: Array.from({ length: MAX_GAME_MOVES - 1 }, () => filler) }, 0);
    const res = act(long, long.realState!.pendingPrompts[0].side, a => a.type === 'RESOLVE_PROMPT', 7000);
    expect(long.moves.length).toBe(MAX_GAME_MOVES);
    expect(long.meta.over).toEqual({ winner: null, reason: TOO_LONG_REASON });
    expect(long.meta.endedAt).toBe(7000);
    expect(res.out.filter(o => o.msg.type === 'over').map(o => ({ to: o.to, msg: o.msg }))).toEqual([
      { to: 'corp', msg: { type: 'over', winner: null, reason: 'game too long' } },
      { to: 'runner', msg: { type: 'over', winner: null, reason: 'game too long' } },
    ]);
    expect(long.lobby()).toMatchObject({ over: true, open: false });
    expect(errorsTo(long.receive('corp', stops('corp', 'full'), 8000).out, 'corp')).toEqual(['over']);
    expect(long.moves.length).toBe(MAX_GAME_MOVES);
  });

  it('lifetime overrides are used only when they are a positive number (production keeps 7 days / 1 day)', () => {
    expect(lifetimeOverride(undefined, 7)).toBe(7);
    expect(lifetimeOverride('', 7)).toBe(7);
    expect(lifetimeOverride('0', 7)).toBe(7);
    expect(lifetimeOverride('-5', 7)).toBe(7);
    expect(lifetimeOverride('soon', 7)).toBe(7);
    expect(lifetimeOverride('Infinity', 7)).toBe(7);
    expect(lifetimeOverride('3000', 7)).toBe(3000);
    const { room } = started();
    expect(room.expiresAt()).toBe(2000 + IDLE_LIFETIME_MS);
    expect(room.expiresAt({ idle: 10, ended: 5 })).toBe(2010);
  });
});

describe('The seed never reaches a seat (chunk 2f)', () => {
  it('no message before a won game\'s final table carries the room seed (the seed predicts every shuffle, 1.12 / 4.2.2)', () => {
    const SEED = 987654321;
    const made = RoomCore.create({ code: 'K7QM2X', side: 'corp', deck: corpStarter, format: 'casual', playerId: 'host-player', tokenHash: 'host-hash', build: 'test', seed: SEED, now: 1000 });
    if (!(made instanceof RoomCore)) throw new Error(JSON.stringify(made));
    const room = made;
    const joined = room.join({ deck: runnerStarter, playerId: 'guest-player', tokenHash: 'guest-hash', now: 2000 });
    if ('error' in joined) throw new Error(JSON.stringify(joined));
    const sent: Outbox = [...joined.out];
    let x = 3;
    for (let i = 0; i < 400 && !room.meta.over; i++) {
      const side = (['corp', 'runner'] as SideCode[]).find(s => lastState(room, s).waitingOn === s && lastState(room, s).legal.length > 0);
      if (!side) break;
      const s = lastState(room, side);
      const legal = s.legal.filter(a => a.type !== 'CONCEDE' && a.type !== 'SET_STOPS');
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      sent.push(...room.receive(side, { type: 'act', seq: s.seq, action: legal[(x >>> 8) % legal.length] }, 3000 + i).out);
    }
    for (const side of ['corp', 'runner'] as SideCode[]) sent.push(...room.connect(side).map(msg => ({ to: side, msg })));
    expect(sent.filter(o => o.msg.type === 'state').length).toBeGreaterThan(50);
    for (const { to, msg } of sent) {
      if (msg.type === 'over' && msg.final) continue; // the real final state, by design (chunk 2d)
      expect(JSON.stringify(msg), `${msg.type} to ${to}`).not.toContain(String(SEED));
    }
    // The real state does hold it (the game id and the rng), so the check above is not vacuous
    expect(JSON.stringify(room.inspect('corp')!.state)).toContain(String(SEED));
  });
});
