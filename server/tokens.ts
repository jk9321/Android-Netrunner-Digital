/**
 * Seat tokens, room codes and seeds. WebCrypto only (crypto.getRandomValues,
 * crypto.subtle), which both the Workers runtime and Node have.
 */
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../src/net/protocol';

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A seat token: 32 random bytes, base64url. Given to the player once; only its hash is stored. */
export function newToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`seat:${token}`));
  return base64url(new Uint8Array(digest));
}

/** A random room code from the unambiguous alphabet (32 letters, so no modulo bias). */
export function newRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  return [...bytes].map(b => ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length]).join('');
}

/** A game seed: never sent to a client (view.ts drops the rng). */
export function newSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] >>> 1;
}
