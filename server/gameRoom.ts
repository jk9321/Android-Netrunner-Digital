/**
 * The Durable Object for one online game (class GameRoom, SQLite-backed).
 * A thin wrapper: RoomCore (server/room.ts) decides everything; this stores
 * its snapshot after every change, before anything is sent (spec rule 4),
 * keeps one WebSocket per seat (Hibernation API: the room can sleep between
 * moves without dropping the sockets) and sets the clean-up alarm.
 *
 * Reached only from the game Worker (server/index.ts) on these paths:
 *   POST /create, POST /join, GET /lobby, GET /ws?token=, POST /report?token=
 */
import { PING, PONG, SOCKET_ERROR_TEXT, parseClientMessage } from '../src/net/protocol';
import type { ServerMessage } from '../src/net/protocol';
import type { SideCode } from '../src/core';
import { RoomCore, RoomSnapshot, Outbox, STORAGE_KEYS, storageWrites } from './room';
import type { StoredRefs } from './room';
import type { CreateInput, JoinInput, RoomMeta } from './room';
import { hashToken } from './tokens';
import { CfWebSocket, DurableObjectState, upgradeResponse } from './cf';
import { json } from './http';

const SIDES: SideCode[] = ['corp', 'runner'];
/** Close code for a socket replaced by a newer one on the same seat (spec rule 5). */
export const CLOSE_REPLACED = 4000;
export const CLOSE_ROOM_DELETED = 4001;

export class GameRoom {
  private room: RoomCore | null = null;
  /** What storage holds now (by reference), so a save writes only what changed. */
  private stored: StoredRefs | null = null;
  /** When the alarm is set for, once known (undefined: not read yet). */
  private alarmAt: number | null | undefined = undefined;

  /** The runtime also passes the Worker's env; the room needs none of it. */
  constructor(private ctx: DurableObjectState) {
    void ctx.blockConcurrencyWhile(async () => {
      const got = await ctx.storage.get<unknown>([...STORAGE_KEYS]);
      const meta = got.get('meta') as RoomMeta | undefined;
      if (!meta) return;
      const snapshot: RoomSnapshot = {
        meta,
        state: (got.get('state') as RoomSnapshot['state']) ?? null,
        moves: (got.get('moves') as RoomSnapshot['moves']) ?? [],
        last: { corp: (got.get('last:corp') as string | undefined) ?? null, runner: (got.get('last:runner') as string | undefined) ?? null },
      };
      this.room = RoomCore.load(snapshot, Date.now());
      this.stored = { state: snapshot.state, moves: snapshot.moves, last: snapshot.last! };
      // A state that no longer loads ended the game as a draw: keep that
      if (this.room.errors.length) {
        console.error('GameRoom load', meta.code, this.room.errors.join('; '));
        await this.save();
      }
    });
    // Keep-alive pings are answered without waking the room
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  private async save() {
    const room = this.room!;
    const { put, refs } = storageWrites(this.stored, room.snapshot());
    await this.ctx.storage.put(put);
    this.stored = refs;
    // The alarm is a write too: set only when there is none or the room now expires sooner (the game ended).
    // A later expiry (another move) is handled when the alarm fires: alarm() sets it again for then.
    const at = room.expiresAt();
    if (this.alarmAt === undefined) this.alarmAt = await this.ctx.storage.getAlarm();
    if (this.alarmAt === null || at < this.alarmAt) {
      await this.ctx.storage.setAlarm(at);
      this.alarmAt = at;
    }
  }

  private send(out: Outbox) {
    for (const { to, msg, text } of out) for (const ws of this.ctx.getWebSockets(to)) trySend(ws, text ?? JSON.stringify(msg));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      switch (`${request.method} ${url.pathname}`) {
        case 'POST /create':
          return await this.create((await request.json()) as CreateInput);
        case 'POST /join':
          return await this.join((await request.json()) as JoinInput);
        case 'GET /lobby':
          return this.room ? json(this.room.lobby()) : json({ error: 'not_found' }, 404);
        case 'GET /ws':
          return await this.connect(request, url.searchParams.get('token') ?? '');
        case 'POST /report':
          return await this.report(url.searchParams.get('token') ?? '');
        default:
          return json({ error: 'not_found' }, 404);
      }
    } catch (err) {
      console.error('GameRoom', url.pathname, err);
      return json({ error: 'server' }, 500);
    }
  }

  private async create(input: CreateInput): Promise<Response> {
    // The code is taken (a collision): the Worker picks another
    if (this.room) return json({ error: 'full' }, 409);
    const made = RoomCore.create({ ...input, now: Date.now() });
    if (!(made instanceof RoomCore)) return json(made, made.error === 'illegal_deck' ? 422 : 400);
    this.room = made;
    await this.save();
    return json({ ok: true }, 201);
  }

  private async join(input: JoinInput): Promise<Response> {
    const room = this.room;
    if (!room) return json({ error: 'not_found' }, 404);
    const res = room.join({ ...input, now: Date.now() });
    if ('error' in res) return json(res, res.error === 'full' ? 409 : res.error === 'illegal_deck' ? 422 : 400);
    await this.save();
    this.send(res.out);
    return json({ seat: res.seat });
  }

  private async seatFor(token: string): Promise<SideCode | null> {
    if (!this.room || !token) return null;
    return this.room.seatOf(await hashToken(token));
  }

  private async connect(request: Request, token: string): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'bad_request' }, 426);
    if (!this.room) return json({ error: 'not_found' }, 404);
    const side = await this.seatFor(token);
    if (!side) return json({ error: 'unauthorized' }, 401);
    // A second socket on the same seat replaces the first (spec rule 5)
    for (const old of this.ctx.getWebSockets(side)) {
      try {
        old.close(CLOSE_REPLACED, 'replaced');
      } catch {
        // already closed
      }
    }
    const pair = new WebSocketPair();
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [side]);
    server.serializeAttachment({ side });
    for (const text of this.room.connectTexts(side)) trySend(server, text);
    const opp = side === 'corp' ? 'runner' : 'corp';
    trySend(server, encode({ type: 'opponent', connected: this.ctx.getWebSockets(opp).length > 0 }));
    for (const ws of this.ctx.getWebSockets(opp)) trySend(ws, encode({ type: 'opponent', connected: true }));
    return upgradeResponse(pair[0]);
  }

  async webSocketMessage(ws: CfWebSocket, message: string | ArrayBuffer): Promise<void> {
    const side = sideOf(ws);
    if (!side || !this.room) return;
    const before = this.room.errors.length;
    let res;
    try {
      res = this.room.receive(side, parseClientMessage(typeof message === 'string' ? message : null), Date.now());
    } catch (err) {
      // A state the engine can't work with any more: the seat hears a generic error, the log keeps the cause
      console.error('GameRoom receive', this.room.meta.code, err);
      trySend(ws, encode({ type: 'error', code: 'server', message: SOCKET_ERROR_TEXT.server }));
      return;
    }
    if (this.room.errors.length > before) console.warn('GameRoom', this.room.meta.code, this.room.errors.slice(before).join('; '));
    if (res.persist) await this.save();
    this.send(res.out);
  }

  async webSocketClose(ws: CfWebSocket): Promise<void> {
    const side = sideOf(ws);
    if (!side) return;
    const still = this.ctx.getWebSockets(side).filter(s => s !== ws).length > 0;
    if (still) return;
    const opp = side === 'corp' ? 'runner' : 'corp';
    for (const s of this.ctx.getWebSockets(opp)) trySend(s, encode({ type: 'opponent', connected: false }));
  }

  async webSocketError(ws: CfWebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  /** The report attachment, for the site Worker only (it never reaches the browser). */
  private async report(token: string): Promise<Response> {
    if (!this.room) return json({ error: 'not_found' }, 404);
    const side = await this.seatFor(token);
    if (!side) return json({ error: 'unauthorized' }, 401);
    return json(this.room.reportFor(side));
  }

  /** Deletes the room once it has expired (spec rule 7). */
  async alarm(): Promise<void> {
    const room = this.room;
    if (room && Date.now() < room.expiresAt()) {
      await this.ctx.storage.setAlarm(room.expiresAt());
      this.alarmAt = room.expiresAt();
      return;
    }
    for (const side of SIDES) {
      for (const ws of this.ctx.getWebSockets(side)) {
        try {
          ws.close(CLOSE_ROOM_DELETED, 'room deleted');
        } catch {
          // already closed
        }
      }
    }
    this.room = null;
    this.stored = null;
    this.alarmAt = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
}

function sideOf(ws: CfWebSocket): SideCode | null {
  const att = ws.deserializeAttachment() as { side?: SideCode } | null;
  return att?.side === 'corp' || att?.side === 'runner' ? att.side : null;
}

const encode = (msg: ServerMessage) => JSON.stringify(msg);

function trySend(ws: CfWebSocket, text: string) {
  try {
    ws.send(text);
  } catch {
    // The socket closed; the player gets the current state when they reconnect
  }
}
