/**
 * The few Cloudflare Workers runtime types the game server uses, declared
 * here instead of adding @cloudflare/workers-types (whose globals clash with
 * the DOM types the rest of the project compiles against). Names and shapes
 * follow the Workers runtime API (Durable Objects, WebSocket Hibernation).
 */

export interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  put(entries: Record<string, unknown>): Promise<void>;
  put(key: string, value: unknown): Promise<void>;
  deleteAll(): Promise<void>;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

/** A server-side WebSocket as the Workers runtime has it (accept is done by the Durable Object state). */
export interface CfWebSocket {
  send(message: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

export interface DurableObjectState {
  storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
  acceptWebSocket(ws: CfWebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): CfWebSocket[];
  setWebSocketAutoResponse(pair?: unknown): void;
}

export interface DurableObjectId {
  toString(): string;
}

export interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** A service binding to another Worker. */
export interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

declare global {
  /** Workers runtime: a connected pair of WebSockets, [client, server]. */
  var WebSocketPair: { new (): { 0: WebSocket; 1: CfWebSocket } };
  var WebSocketRequestResponsePair: { new (request: string, response: string): unknown };
}

/** Workers runtime: a Response that upgrades to a WebSocket carries the client end. */
export function upgradeResponse(client: WebSocket): Response {
  return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: WebSocket });
}
