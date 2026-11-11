/**
 * The game server's limits (multiplayer phase 2, chunk 2e; audit finding
 * MP-STOPS-WRITE-FLOOD): what one seat can make the room do, and how long a
 * game may get. Rows written a day are the free plan's tightest allowance
 * (docs/multiplayer-server.md, "Daily ceiling"), and they are shared by every
 * room on the account, so no seat may write without limit.
 */

/** A token bucket: `tokens` left at time `at` (ms). Refills continuously. */
export interface Bucket {
  tokens: number;
  at: number;
}

export interface BucketRule {
  /** Taken at once from a full bucket. */
  burst: number;
  /** One token back every this many ms. */
  refillMs: number;
}

/**
 * Stops changes per seat (a stops change is a stored move: replays need it).
 * Measured by hand: the stops menu takes about a second a change, so a person
 * trying every level in turn makes 2-3 in a few seconds and then stops;
 * 5 at once with one back every 5 s never gets in their way.
 */
export const STOPS_BUDGET: BucketRule = { burst: 5, refillMs: 5000 };

/**
 * Messages per seat's socket, of any kind (acts, stale acts, cancels, pings
 * that reach the room, junk). An honest client sends one message per click,
 * one automatic answer per state and a keep-alive ping every 25 s (answered
 * by the runtime without waking the room): the full-game client test peaks
 * far below this (see the hand-off).
 */
export const SOCKET_BUDGET: BucketRule = { burst: 40, refillMs: 200 };

/**
 * The longest game the room plays: at this many committed moves it ends as a
 * draw ("game too long"). More than five times the longest game measured in
 * `room-fuzz.ts -- 200 9000 both`, stops at ALL (docs/multiplayer-server.md).
 */
export const MAX_GAME_MOVES = 10_000;
export const TOO_LONG_REASON = 'game too long';

/**
 * Takes one token. Returns the bucket after taking it, or null when it is
 * empty (then nothing changes). A missing bucket is a full one, and so is a
 * clock that went backwards (a stored bucket from another machine).
 */
export function take(bucket: Bucket | undefined, rule: BucketRule, now: number): Bucket | null {
  const refilled = !bucket || now < bucket.at ? rule.burst : Math.min(rule.burst, bucket.tokens + (now - bucket.at) / rule.refillMs);
  if (refilled < 1) return null;
  return { tokens: refilled - 1, at: now };
}

/** A lifetime override from the environment (wrangler dev only): used only when it is a positive number of ms. */
export function lifetimeOverride(raw: unknown, fallback: number): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
