/**
 * The online table (multiplayer phase 2, chunk 2c: src/net/client.ts) against
 * the game server's room (server/room.ts) through an in-memory socket pair,
 * with no browser and no Workers runtime: full games played by picking from
 * seat.legal, reconnects (also at a withheld moment), stale actions, a
 * replaced socket, a protocol mismatch, and the saved session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameAction, SideCode, createRng, nextInt, stateFromView } from '../src/core';
import { isHiddenCode } from '../src/core/cards';
import type { RngState } from '../src/core';
import { STARTER_DECKS } from '../src/data/decks';
import { RoomCore, settledFor } from '../server/room';
import type { Outbox } from '../server/room';
import { PING, PONG, PROTOCOL_VERSION, parseClientMessage } from '../src/net/protocol';
import type { ServerMessage } from '../src/net/protocol';
import {
  CLOSE_REPLACED,
  CLOSE_ROOM_GONE,
  KEEPALIVE_MS,
  OnlineSession,
  OnlineTable,
  PLAYER_ID_KEY,
  REFUSED_LIMIT,
  SESSION_KEY,
  SocketLike,
  Timers,
  clearSession,
  leavingForgetsSeat,
  loadSession,
  playerId,
  saveSession,
} from '../src/net/client';
import { submission } from '../src/net/lobby';

const SIDES: SideCode[] = ['corp', 'runner'];
type StateMsg = ServerMessage & { type: 'state' };

/** Timers run by hand: `advance(ms)` fires what is due. */
class FakeTimers implements Timers {
  now = 0;
  private next = 1;
  private items = new Map<number, { at: number; fn: () => void; every?: number }>();
  setTimeout(fn: () => void, ms: number) {
    const id = this.next++;
    this.items.set(id, { at: this.now + ms, fn });
    return id;
  }
  clearTimeout(h: unknown) {
    this.items.delete(h as number);
  }
  setInterval(fn: () => void, ms: number) {
    const id = this.next++;
    this.items.set(id, { at: this.now + ms, fn, every: ms });
    return id;
  }
  clearInterval(h: unknown) {
    this.items.delete(h as number);
  }
  pending(): number[] {
    return [...this.items.values()].map(i => i.at - this.now).sort((a, b) => a - b);
  }
  advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      const due = [...this.items.entries()].filter(([, i]) => i.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, item] = due;
      this.now = item.at;
      if (item.every) item.at += item.every;
      else this.items.delete(id);
      item.fn();
    }
    this.now = end;
  }
}

/** One end of an in-memory socket: what the client sends goes to the hub, the hub's messages arrive on flush. */
class FakeSocket implements SocketLike {
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  open = true;
  sent: string[] = [];
  constructor(
    readonly hub: Hub,
    readonly side: SideCode,
  ) {}
  send(text: string) {
    if (!this.open) throw new Error('closed');
    this.sent.push(text);
    this.hub.fromClient(this, text);
  }
  close(code = 1000) {
    if (!this.open) return;
    this.open = false;
    this.hub.closed(this, code, false);
  }
}

/**
 * The room as the Durable Object runs it (server/gameRoom.ts): sockets per
 * seat, a second socket replaces the first (4000), PING answered without the
 * room, opponent presence. Delivery is queued, so nothing re-enters a client
 * while it is sending; flush() delivers everything.
 */
class Hub {
  sockets: Record<SideCode, FakeSocket | null> = { corp: null, runner: null };
  queue: (() => void)[] = [];
  /** Every state message each seat was sent, in order. */
  states: Record<SideCode, StateMsg[]> = { corp: [], runner: [] };
  /** Refuse new sockets (the room or the network is down). */
  down = false;
  hello: { protocol: number } = { protocol: PROTOCOL_VERSION };
  constructor(readonly room: RoomCore) {}

  connect(session: OnlineSession): FakeSocket {
    const side = session.seat;
    const ws = new FakeSocket(this, side);
    if (this.down) {
      ws.open = false;
      this.queue.push(() => ws.onclose?.({ code: 1006 }));
      return ws;
    }
    const old = this.sockets[side];
    if (old?.open) {
      old.open = false;
      this.queue.push(() => old.onclose?.({ code: CLOSE_REPLACED }));
    }
    this.sockets[side] = ws;
    const texts = this.room.connectTexts(side).map(t => (JSON.parse(t).type === 'hello' ? JSON.stringify({ ...JSON.parse(t), ...this.hello }) : t));
    const opp = side === 'corp' ? 'runner' : 'corp';
    for (const t of texts) this.toSocket(ws, t);
    this.toSocket(ws, JSON.stringify({ type: 'opponent', connected: !!this.sockets[opp]?.open }));
    const o = this.sockets[opp];
    if (o?.open) this.toSocket(o, JSON.stringify({ type: 'opponent', connected: true }));
    return ws;
  }

  private toSocket(ws: FakeSocket, text: string) {
    this.queue.push(() => {
      if (ws.open) ws.onmessage?.({ data: text });
    });
  }

  fromClient(ws: FakeSocket, text: string) {
    if (text === PING) return this.toSocket(ws, PONG);
    const res = this.room.receive(ws.side, parseClientMessage(text), 1000);
    this.deliver(res.out);
  }

  deliver(out: Outbox) {
    for (const { to, msg, text } of out) {
      if (msg.type === 'state') this.states[to].push(msg);
      const ws = this.sockets[to];
      if (ws) this.toSocket(ws, text ?? JSON.stringify(msg));
    }
  }

  /** The client closed, or the network dropped it (`dropped`: the client hears a 1006 close). */
  closed(ws: FakeSocket, code: number, dropped: boolean) {
    if (this.sockets[ws.side] === ws) this.sockets[ws.side] = null;
    const opp = ws.side === 'corp' ? 'runner' : 'corp';
    const o = this.sockets[opp];
    if (o?.open) this.toSocket(o, JSON.stringify({ type: 'opponent', connected: false }));
    if (dropped) this.queue.push(() => ws.onclose?.({ code }));
  }

  /** The network drops a seat's socket. */
  drop(side: SideCode, code = 1006) {
    const ws = this.sockets[side];
    if (!ws) return;
    ws.open = false;
    this.closed(ws, code, true);
  }

  flush() {
    for (let i = 0; i < 100_000 && this.queue.length; i++) this.queue.shift()!();
  }
}

const corpStarter = submission(STARTER_DECKS.find(d => d.side === 'corp')!);
const runnerStarter = submission(STARTER_DECKS.find(d => d.side === 'runner')!);

interface Setup {
  hub: Hub;
  timers: FakeTimers;
  tables: Record<SideCode, OnlineTable>;
  alerts: Record<SideCode, string[]>;
  sessions: Record<SideCode, OnlineSession>;
  make: (side: SideCode) => OnlineTable;
}

function setup(seed: number, host: SideCode = 'corp'): Setup {
  const made = RoomCore.create({ code: 'K7QM2X', side: host, deck: host === 'corp' ? corpStarter : runnerStarter, format: 'casual', playerId: `player-${host}-000`, tokenHash: `tok-${host}`, build: 'test', seed, now: 0 });
  if (!(made instanceof RoomCore)) throw new Error(JSON.stringify(made));
  const room = made;
  const hub = new Hub(room);
  const timers = new FakeTimers();
  const alerts: Setup['alerts'] = { corp: [], runner: [] };
  const sessions: Setup['sessions'] = { corp: { code: 'K7QM2X', seat: 'corp', token: 'tok-corp' }, runner: { code: 'K7QM2X', seat: 'runner', token: 'tok-runner' } };
  const make = (side: SideCode) => {
    const t = new OnlineTable(sessions[side], { connect: s => hub.connect(s), alert: m => alerts[side].push(m), timers });
    t.start();
    return t;
  };
  const hostTable = make(host);
  hub.flush();
  const guest: SideCode = host === 'corp' ? 'runner' : 'corp';
  const joined = room.join({ deck: guest === 'corp' ? corpStarter : runnerStarter, playerId: `player-${guest}-000`, tokenHash: `tok-${guest}`, now: 0 });
  if ('error' in joined) throw new Error(JSON.stringify(joined));
  hub.deliver(joined.out);
  const guestTable = make(guest);
  hub.flush();
  const tables = { [host]: hostTable, [guest]: guestTable } as Record<SideCode, OnlineTable>;
  return { hub, timers, tables, alerts, sessions, make };
}

/** Every seat shows exactly what the room last sent it. */
function expectInSync(s: Setup) {
  for (const side of SIDES) {
    const t = s.tables[side];
    const sent = s.hub.states[side][s.hub.states[side].length - 1];
    expect(t.lastState?.seq).toBe(sent.seq);
    const seat = t.seatFor(side);
    // After the end the seat shows the final table the room sent with `over` (chunk 2d)
    if (t.final) {
      expect(seat.view).toBeNull();
      expect(seat.state).toEqual(JSON.parse(JSON.stringify(s.hub.room.realState)));
      expect(seat.waitingOn).toBeNull();
      continue;
    }
    expect(seat.view).toEqual(sent.view);
    expect(seat.state).toEqual(stateFromView(sent.view));
    expect(seat.waitingOn).toBe(t.over ? null : sent.waitingOn);
  }
}

/** A random legal move for whichever seat is acting (like the room fuzzer's random clients). */
function randomMove(s: Setup, rng: RngState): SideCode | null {
  const side = SIDES.find(x => s.tables[x].acting === x && !s.tables[x].waiting && s.tables[x].seatFor(x).legal.length > 0);
  if (!side) return null;
  const seat = s.tables[side].seatFor(side);
  if (seat.cancel && nextInt(rng, 6) === 0) {
    seat.cancel();
    return side;
  }
  const legal = seat.legal.filter(a => a.type !== 'CONCEDE' && a.type !== 'SET_STOPS');
  const busy = legal.filter(a => a.type !== 'END_TURN' && a.type !== 'PASS');
  const pool = busy.length > 0 && nextInt(rng, 4) > 0 ? busy : legal;
  void seat.act(pool[nextInt(rng, pool.length)]);
  return side;
}

// No DOM here: a localStorage of our own
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('Online table: full games against the room', () => {
  for (const seed of [11, 12, 13, 14]) {
    it(`seed ${seed}: plays to the end picking from seat.legal; every seat shows what the room sent`, () => {
      const s = setup(seed, seed % 2 ? 'runner' : 'corp');
      const rng = createRng(seed);
      let moves = 0;
      for (; moves < 6000 && !s.tables.corp.over; moves++) {
        const mover = randomMove(s, rng);
        expect(mover, 'a seat is told it is acting').not.toBeNull();
        // The mover waits: no second action goes out until the room answers
        expect(s.tables[mover!].waiting).toBe(true);
        s.hub.flush();
        expect(s.tables[mover!].waiting).toBe(false);
        expectInSync(s);
        // Halfway, the Runner's socket drops and comes back
        if (moves === 200) {
          s.hub.drop('runner');
          s.hub.flush();
          expect(s.tables.runner.status).toBe('reconnecting');
          expect(s.tables.corp.opponentConnected).toBe(false);
          s.timers.advance(1000);
          s.hub.flush();
          expect(s.tables.runner.status).toBe('open');
          expect(s.tables.corp.opponentConnected).toBe(true);
          expectInSync(s);
        }
      }
      expect(s.tables.corp.over, `game over within ${moves} moves`).not.toBeNull();
      expect(s.tables.runner.over).toEqual(s.tables.corp.over);
      expect(s.tables.corp.winner).toBe(s.hub.room.realState!.winner);
      expect(s.alerts).toEqual({ corp: [], runner: [] });
      // After the end nothing is offered, and both seats show the whole final table (chunk 2d)
      for (const side of SIDES) expect(s.tables[side].seatFor(side).legal).toEqual([]);
      for (const side of SIDES) expect(s.tables[side].seatFor(side)).toMatchObject({ side: 'both', view: null, state: JSON.parse(JSON.stringify(s.hub.room.realState)) });
    }, 60_000);
  }
});

describe('Online table: waiting, errors and reconnects', () => {
  it('a second click while waiting sends nothing; a click on an old seat gets stale, quietly', () => {
    const s = setup(21);
    const side = s.tables.corp.acting!;
    const t = s.tables[side];
    const seat = t.seatFor(side);
    const ws = s.hub.sockets[side]!;
    const before = ws.sent.length;
    void seat.act(seat.legal[0]);
    void seat.act(seat.legal[0]);
    expect(ws.sent.length).toBe(before + 1);
    expect(t.seatFor(side).legal).toEqual([]);
    s.hub.flush();
    expect(t.waiting).toBe(false);
    // The old seat object still carries the old seq: the room says stale, the table shows nothing
    const now = t.acting === side ? t.seatFor(side) : null;
    void seat.act(seat.legal[0]);
    s.hub.flush();
    expect(t.waiting).toBe(false);
    expect(s.alerts[side]).toEqual([]);
    if (now) expect(t.seatFor(side).legal.length).toBeGreaterThan(0);
    expectInSync(s);
  });

  it('an illegal action shows the fixed text and ends the wait', () => {
    const s = setup(22);
    const side = s.tables.corp.acting!;
    const t = s.tables[side];
    const bogus: GameAction = { type: 'INITIATE_RUN', player: side, targetServerId: 'remote-9' };
    void t.seatFor(side).act(bogus);
    s.hub.flush();
    expect(t.waiting).toBe(false);
    expect(s.alerts[side]).toEqual(["That isn't possible right now."]);
  });

  it('reconnects after 1, 2, 4, 8 s, then every 15 s, and comes back where it was', () => {
    const s = setup(23);
    const before = s.tables.runner.lastState;
    s.hub.down = true;
    s.hub.drop('runner');
    s.hub.flush();
    const delays: number[] = [];
    for (let i = 0; i < 6; i++) {
      // The keep-alive interval is cleared while closed: the next timer is the retry
      const next = s.timers.pending()[0];
      delays.push(next);
      s.timers.advance(next);
      s.hub.flush();
      expect(s.tables.runner.status).toBe('reconnecting');
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
    s.hub.down = false;
    s.timers.advance(15000);
    s.hub.flush();
    expect(s.tables.runner.status).toBe('open');
    expect(s.tables.runner.lastState).toEqual(before);
    expectInSync(s);
  });

  it('keeps the socket alive with PING every 30 s', () => {
    const s = setup(24);
    const ws = s.hub.sockets.corp!;
    const pings = () => ws.sent.filter(t => t === PING).length;
    s.timers.advance(KEEPALIVE_MS * 3);
    expect(pings()).toBe(3);
  });

  it('a reconnect during a withheld moment: the old state says it is to act, its act gets not_your_turn, the seat waits with no alert', () => {
    // Find a moment where the mover's own state is held back (its move led into a decision of the other side
    // inside an R&D access, docs/multiplayer-server.md): random play until one comes up
    for (const seed of [31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42]) {
      const s = setup(seed);
      // At ALL stops the Corp gets the run's windows, so its passes during an R&D access lead into the Runner's decisions
      for (const side of SIDES) void s.tables[side].seatFor(side).act({ type: 'SET_STOPS', player: side, level: 'full' });
      s.hub.flush();
      const rng = createRng(seed);
      for (let moves = 0; moves < 3000 && !s.tables.corp.over; moves++) {
        const mover = randomMove(s, rng);
        if (!mover) break;
        s.hub.flush();
        const t = s.tables[mover];
        if (!t.waiting) continue;
        // Withheld: the room didn't answer the mover
        expect(settledFor(s.hub.room.realState!, mover)).toBe(false);
        s.hub.drop(mover);
        s.hub.flush();
        s.timers.advance(1000);
        s.hub.flush();
        expect(t.status).toBe('open');
        expect(t.waiting).toBe(false);
        // The state before its move: it still says this seat is to act
        const seat = t.seatFor(mover);
        expect(seat.waitingOn).toBe(mover);
        void seat.act(seat.legal[0]);
        s.hub.flush();
        expect(t.waiting).toBe(true);
        expect(s.alerts[mover]).toEqual([]);
        // The other side answers; the waiting seat hears at the settled point
        const other = mover === 'corp' ? 'runner' : 'corp';
        for (let i = 0; i < 50 && t.waiting; i++) {
          const o = s.tables[other];
          if (o.acting !== other) break;
          const os = o.seatFor(other);
          void os.act(os.legal.find(a => a.type !== 'CONCEDE') ?? os.legal[0]);
          s.hub.flush();
        }
        expect(t.waiting).toBe(false);
        expectInSync(s);
        return;
      }
    }
    throw new Error('no withheld moment found in the seeds tried');
  }, 60_000);

  it('close code 4000: another tab took the seat; no retry until "Play here instead"', () => {
    const s = setup(25);
    const second = s.make('corp');
    s.hub.flush();
    expect(s.tables.corp.status).toBe('replaced');
    expect(second.status).toBe('open');
    s.timers.advance(60_000);
    s.hub.flush();
    expect(s.tables.corp.status).toBe('replaced');
    s.tables.corp.takeOver();
    s.hub.flush();
    expect(s.tables.corp.status).toBe('open');
    expect(second.status).toBe('replaced');
    second.dispose();
  });

  it('leaving the "open somewhere else" notice keeps the saved session the playing tab of this browser needs', () => {
    const s = setup(30);
    saveSession(s.sessions.corp);
    const second = s.make('corp');
    s.hub.flush();
    expect(s.tables.corp.status).toBe('replaced');
    // What App does on "Back to the start screen": forget the seat only if leaving gives it up
    if (leavingForgetsSeat(s.tables.corp.status)) clearSession();
    s.tables.corp.dispose();
    expect(loadSession()).toEqual(s.sessions.corp);
    // The playing tab reloads and comes back to its seat
    second.dispose();
    const reloaded = new OnlineTable(loadSession()!, { connect: x => s.hub.connect(x), alert: () => {}, timers: s.timers });
    reloaded.start();
    s.hub.flush();
    expect(reloaded.status).toBe('open');
    expect(reloaded.started).toBe(true);
    reloaded.dispose();
    // Every other way out gives the seat up
    for (const st of ['connecting', 'open', 'reconnecting', 'gone', 'unseated', 'refresh'] as const) expect(leavingForgetsSeat(st)).toBe(true);
  });

  it('a socket refused again and again while the lobby says the room is there: the seat is lost, and it stops trying', async () => {
    const s = setup(31);
    s.hub.down = true;
    let tries = 0;
    const t = new OnlineTable(s.sessions.runner, {
      connect: x => {
        tries++;
        return s.hub.connect(x);
      },
      alert: () => {},
      timers: s.timers,
      roomPresence: async () => 'there' as const,
    });
    t.start();
    for (let i = 0; i < REFUSED_LIMIT + 2; i++) {
      s.hub.flush();
      await Promise.resolve();
      await Promise.resolve();
      s.timers.advance(16_000);
    }
    expect(t.status).toBe('unseated');
    expect(tries).toBe(REFUSED_LIMIT);
    s.timers.advance(120_000);
    s.hub.flush();
    expect(tries).toBe(REFUSED_LIMIT);
    t.dispose();
  });

  it('a refusal now and then (the room there) keeps trying: a hello resets the count', async () => {
    const s = setup(32);
    s.tables.runner.dispose();
    const t = new OnlineTable(s.sessions.runner, { connect: x => s.hub.connect(x), alert: () => {}, timers: s.timers, roomPresence: async () => 'there' as const });
    const refuseFor = async (times: number) => {
      s.hub.down = true;
      for (let i = 0; i < times; i++) {
        s.hub.flush();
        await Promise.resolve();
        await Promise.resolve();
        if (i < times - 1) s.timers.advance(16_000);
      }
      s.hub.down = false;
      s.timers.advance(16_000);
      s.hub.flush();
    };
    s.hub.down = true;
    t.start();
    await refuseFor(REFUSED_LIMIT - 1);
    expect(t.status).toBe('open');
    s.hub.drop('runner');
    await refuseFor(REFUSED_LIMIT - 1);
    expect(t.status).toBe('open');
    t.dispose();
  });

  it('offline (the lobby unreachable too): retries go on, still reconnecting, and it recovers when the network is back', async () => {
    const s = setup(34);
    s.tables.runner.dispose();
    let asked = 0;
    const t = new OnlineTable(s.sessions.runner, {
      connect: x => s.hub.connect(x),
      alert: () => {},
      timers: s.timers,
      roomPresence: () => {
        asked++;
        return Promise.reject(new Error('offline')).catch(() => 'unknown' as const);
      },
    });
    s.hub.down = true;
    t.start();
    for (let i = 0; i < REFUSED_LIMIT * 3; i++) {
      s.hub.flush();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      s.timers.advance(16_000);
    }
    expect(asked).toBeGreaterThanOrEqual(REFUSED_LIMIT * 2);
    s.hub.flush();
    await Promise.resolve();
    expect(t.status).toBe('reconnecting');
    s.hub.down = false;
    s.timers.advance(16_000);
    s.hub.flush();
    expect(t.status).toBe('open');
    t.dispose();
  });

  it("the host's invite shows until the first state; after that a reload connects without it", () => {
    const s = setup(33);
    const inviting = { ...s.sessions.corp, inviting: true };
    saveSession(inviting);
    expect(loadSession()).toEqual(inviting);
    const t = new OnlineTable(loadSession()!, { connect: x => s.hub.connect(x), alert: () => {}, timers: s.timers });
    t.start();
    s.hub.flush();
    expect(t.started).toBe(true);
    expect(loadSession()).toEqual(s.sessions.corp);
    expect(loadSession()?.inviting).toBeUndefined();
    t.dispose();
  });

  it('close code 4001: the room is gone', () => {
    const s = setup(26);
    s.hub.drop('runner', CLOSE_ROOM_GONE);
    s.hub.flush();
    expect(s.tables.runner.status).toBe('gone');
    s.timers.advance(60_000);
    expect(s.tables.runner.status).toBe('gone');
  });

  it('a socket refused before hello asks the lobby; a 404 means the room is gone', async () => {
    const s = setup(27);
    s.hub.down = true;
    const t = new OnlineTable(s.sessions.runner, { connect: x => s.hub.connect(x), alert: () => {}, timers: s.timers, roomPresence: async () => 'gone' as const });
    t.start();
    s.hub.flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(t.status).toBe('gone');
    expect(s.timers.pending().length).toBeGreaterThan(0); // the other tables' keep-alives only
    t.dispose();
  });

  it('a hello with another protocol asks for a refresh and sends nothing', () => {
    const s = setup(28);
    s.hub.hello = { protocol: PROTOCOL_VERSION + 1 };
    let ws: FakeSocket | null = null;
    const t = new OnlineTable(s.sessions.corp, { connect: x => (ws = s.hub.connect(x)), alert: () => {}, timers: s.timers });
    t.start();
    s.hub.flush();
    expect(t.status).toBe('refresh');
    if (!ws) throw new Error('no socket');
    const seat = t.started ? t.seatFor('corp') : null;
    if (seat) void seat.act({ type: 'END_TURN', player: 'corp' });
    s.timers.advance(120_000);
    expect((ws as FakeSocket).open).toBe(false);
    expect((ws as FakeSocket).sent).toEqual([]);
  });

  it('conceding works while waiting and ends the game for both; the session is cleared', () => {
    const s = setup(29);
    saveSession(s.sessions.corp);
    const corp = s.tables.corp.seatFor('corp');
    void corp.act({ type: 'CONCEDE', player: 'corp' });
    s.hub.flush();
    expect(s.tables.corp.over).toMatchObject({ winner: 'runner' });
    expect(s.tables.runner.over).toMatchObject({ winner: 'runner' });
    expect(loadSession()).toBeNull();
  });
});

describe('Online table: the final table (chunk 2d; rule 1.7.1)', () => {
  it('after `over` with the final state: the seat shows it (both hands), offers nothing, sends nothing, and no move listener fires', () => {
    const s = setup(31);
    const moves: Record<SideCode, number> = { corp: 0, runner: 0 };
    for (const side of SIDES) s.tables[side].onMove(() => moves[side]++);
    const before = { corp: s.tables.corp.seatFor('corp').state, runner: s.tables.runner.seatFor('runner').state };
    // Before the end each seat sees the other's hand face down only
    expect(before.corp.runner.grip.every(c => isHiddenCode(c.cardCode))).toBe(true);
    expect(before.runner.corp.hq.every(c => isHiddenCode(c.cardCode))).toBe(true);
    void s.tables.runner.seatFor('runner').act({ type: 'CONCEDE', player: 'runner' });
    s.hub.flush();
    const final = JSON.parse(JSON.stringify(s.hub.room.realState));
    const movesAtEnd = { ...moves };
    for (const side of SIDES) {
      const t = s.tables[side];
      expect(t.over).toEqual({ winner: 'corp', reason: 'Runner conceded' });
      expect(t.final).toEqual(final);
      const seat = t.seatFor(side);
      expect(seat).toMatchObject({ side: 'both', view: null, legal: [], waitingOn: null });
      expect(seat.state).toEqual(final);
      expect(seat.state.runner.grip.length).toBeGreaterThan(0);
      expect(seat.state.runner.grip.some(c => isHiddenCode(c.cardCode))).toBe(false);
      expect(seat.state.corp.hq.some(c => isHiddenCode(c.cardCode))).toBe(false);
      expect(seat.can({ type: 'GAIN_CREDIT', player: 'corp' })).toBe(false);
      expect(t.acting).toBeNull();
      expect(t.winner).toBe('corp');
    }
    // The switch to the final table is not a move (its ids are the engine's): no sounds, fates or accesses for it
    expect(moves).toEqual(movesAtEnd);
    // Acting after the end sends nothing
    const ws = s.hub.sockets.corp!;
    const sentBefore = ws.sent.length;
    void s.tables.corp.seatFor('corp').act({ type: 'GAIN_CREDIT', player: 'corp' });
    expect(ws.sent.length).toBe(sentBefore);
    // A reconnect after the end brings the same final table again, and still no move
    s.hub.drop('corp');
    s.hub.flush();
    s.timers.advance(1000);
    s.hub.flush();
    expect(s.tables.corp.seatFor('corp').state).toEqual(final);
    expect(moves).toEqual(movesAtEnd);
  });

  it('after `over` without it (an older server, or a game the room could not read): the seat is as today', () => {
    const s = setup(32);
    const t = s.tables.corp;
    const last = t.seatFor('corp');
    // What an older server sends (no `final`)
    const ws = s.hub.sockets.corp!;
    ws.onmessage?.({ data: JSON.stringify({ type: 'over', winner: null, reason: 'server update' }) });
    expect(t.over).toEqual({ winner: null, reason: 'server update' });
    expect(t.final).toBeNull();
    const seat = t.seatFor('corp');
    expect(seat.side).toBe('corp');
    expect(seat.view).toEqual(last.view);
    expect(seat.state).toEqual(last.state);
    expect(seat.legal).toEqual([]);
    expect(seat.waitingOn).toBeNull();
  });
});

describe('Online session and player id', () => {
  it('the session is kept under one key and read back; junk is ignored', () => {
    const session = { code: 'K7QM2X', seat: 'runner' as const, token: 'abcdefghijklmnop' };
    saveSession(session);
    expect(JSON.parse(window.localStorage.getItem(SESSION_KEY)!)).toEqual(session);
    expect(loadSession()).toEqual(session);
    clearSession();
    expect(loadSession()).toBeNull();
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, code: 'K7QM20' }));
    expect(loadSession()).toBeNull();
    window.localStorage.setItem(SESSION_KEY, '{not json');
    expect(loadSession()).toBeNull();
  });

  it('the player id is 22 URL-safe characters, made once', () => {
    const id = playerId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(playerId()).toBe(id);
    expect(window.localStorage.getItem(PLAYER_ID_KEY)).toBe(id);
  });
});

describe('Online bug report', () => {
  it('posts only the description, screen, version and website to the room, with the token in the query; sent or failed only', async () => {
    const { sendOnlineReport } = await import('../src/ui/bugReport');
    const calls: { url: string; body: unknown }[] = [];
    const f = async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(init!.body as string) });
      return new Response(null, { status: 204 });
    };
    expect(await sendOnlineReport({ code: 'K7QM2X', token: 'tok/+1' }, { description: '  The run panel froze  ', website: '' }, f)).toBe(true);
    expect(calls[0].url).toBe('/api/games/K7QM2X/report?token=tok%2F%2B1');
    expect(Object.keys(calls[0].body as object).sort()).toEqual(['description', 'screen', 'version', 'website']);
    expect(calls[0].body).toMatchObject({ description: 'The run panel froze', screen: 'game' });
    expect(await sendOnlineReport({ code: 'K7QM2X', token: 't' }, { description: 'x'.repeat(20) }, async () => new Response(null, { status: 429 }))).toBe(false);
    expect(
      await sendOnlineReport({ code: 'K7QM2X', token: 't' }, { description: 'x'.repeat(20) }, async () => {
        throw new TypeError('offline');
      }),
    ).toBe(false);
  });
});
