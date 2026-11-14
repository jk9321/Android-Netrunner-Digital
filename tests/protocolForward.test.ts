/**
 * The site Worker's side of the game server (server/forward.ts) and the game
 * Worker's router (server/index.ts), with fake bindings: which game Worker a
 * host reaches, and that a bug report's attachment never reaches the browser.
 */
import { describe, expect, it } from 'vitest';
import { forwardGames, gamesBinding, isGamesPath, onlineReportBody } from '../server/forward';
import type { Fetcher } from '../server/cf';
import type { RoomReport } from '../server/room';
import { handleGames } from '../server/index';
import type { GamesEnv } from '../server/index';
import { MAX_BODY_BYTES, readBody, readJson } from '../server/http';

const fake = (name: string, seen: string[], answer: (req: Request) => Response = () => new Response('{}')): Fetcher => ({
  fetch: async (req: Request) => {
    seen.push(`${name} ${req.method} ${new URL(req.url).pathname}`);
    return answer(req);
  },
});

const finished: RoomReport = {
  code: 'K7QM2X', format: 'standard', build: 'b', seat: 'runner', moveCount: 3, over: { winner: 'corp', reason: 'x' },
  full: true, view: null, seed: 42, state: null, moves: [], decks: { corp: { identity: 'c', cards: ['1'] }, runner: { identity: 'r', cards: ['2'] } },
};

describe('Site forwarding to the game Worker', () => {
  it('production hosts use GAMES, every other host GAMES_STAGING', () => {
    const env = { GAMES: fake('prod', []), GAMES_STAGING: fake('staging', []) };
    expect(gamesBinding(env, 'stackheap.run')).toBe(env.GAMES);
    expect(gamesBinding(env, 'android-netrunner-digital.jk9321.workers.dev')).toBe(env.GAMES);
    expect(gamesBinding(env, 'beta-android-netrunner-digital.jk9321.workers.dev')).toBe(env.GAMES_STAGING);
    expect(gamesBinding(env, 'mp-online-android-netrunner-digital.jk9321.workers.dev')).toBe(env.GAMES_STAGING);
    expect(isGamesPath('/api/games')).toBe(true);
    expect(isGamesPath('/api/games/K7QM2X/ws')).toBe(true);
    expect(isGamesPath('/api/gamesx')).toBe(false);
  });

  it('forwards game requests as they are, and answers 503 before the Workers are bound', async () => {
    const seen: string[] = [];
    const env = { GAMES_STAGING: fake('staging', seen) };
    await forwardGames(new Request('https://beta-android-netrunner-digital.jk9321.workers.dev/api/games/K7QM2X'), env);
    expect(seen).toEqual(['staging GET /api/games/K7QM2X']);
    expect((await forwardGames(new Request('https://stackheap.run/api/games'), env)).status).toBe(503);
  });

  it("a bug report asks the room on the internal path, and the browser gets only a status (spec rule 9)", async () => {
    const seen: string[] = [];
    const env = { GAMES_STAGING: fake('staging', seen, () => new Response(JSON.stringify(finished))) };
    const res = await forwardGames(
      new Request('https://beta-android-netrunner-digital.jk9321.workers.dev/api/games/K7QM2X/report?token=abc', {
        method: 'POST',
        headers: { Origin: 'https://beta-android-netrunner-digital.jk9321.workers.dev' },
        body: JSON.stringify({ description: 'The run did not end.', screen: 'game', version: 'test' }),
      }),
      env,
    );
    expect(seen).toEqual(['staging POST /internal/games/K7QM2X/report']);
    // No GitHub token in this test: the bug-report path refuses with 503, and nothing else comes back
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('');
  });

  it('a report carries the real game: log, both decks, seed (Jeff 2026-11-09)', async () => {
    const live: RoomReport = { ...finished, over: null, state: { log: [{ id: 'log-1', turnNumber: 1, player: 'corp', message: 'Corp drew Hedge Fund.' }] } as never };
    const body = (await onlineReportBody({ description: 'x' }, live)) as { game: Record<string, unknown> };
    expect(body.game).toMatchObject({ seed: 42, corpDeck: 'c\n1', runnerDeck: 'r\n2', log: '1 corp: Corp drew Hedge Fund.' });
    expect(body.game.snapshot).toEqual(expect.any(String));
  });
});

describe('Game Worker routes', () => {
  const env = (seen: string[]): GamesEnv => ({
    ROOMS: { idFromName: (name: string) => ({ toString: () => name }), get: id => fake(`room ${id}`, seen, req => new Response(JSON.stringify({ path: new URL(req.url).pathname }))) },
  });

  it('routes by room code and refuses codes that cannot be one', async () => {
    const seen: string[] = [];
    await handleGames(new Request('https://x/api/games/k7qm-2x'), env(seen));
    expect(seen).toEqual(['room K7QM2X GET /lobby']);
    expect((await handleGames(new Request('https://x/api/games/K0QM2X'), env(seen))).status).toBe(404);
    expect((await handleGames(new Request('https://x/api/games/K7QM2X/spectate'), env(seen))).status).toBe(404);
    expect((await handleGames(new Request('https://x/api/games', { method: 'POST', body: '{"visibility":"public"}' }), env(seen))).status).toBe(400);
  });

  it('the room gets a token hash, never the token, and the browser gets the token once', async () => {
    const bodies: unknown[] = [];
    const e: GamesEnv = {
      ROOMS: {
        idFromName: (name: string) => ({ toString: () => name }),
        get: () => ({
          fetch: async (req: Request) => {
            bodies.push(await req.json());
            return new Response(JSON.stringify({ ok: true }), { status: 201 });
          },
        }),
      },
      BUILD_ID: 'abc1234',
    };
    const res = await handleGames(new Request('https://x/api/games', { method: 'POST', body: JSON.stringify({ side: 'corp', deck: { identity: 'i', cards: [] }, format: 'casual' }) }), e);
    const out = (await res.json()) as { code: string; seat: string; token: string };
    expect(res.status).toBe(201);
    expect(out.seat).toBe('corp');
    const sent = bodies[0] as Record<string, unknown>;
    expect(sent.tokenHash).toEqual(expect.any(String));
    expect(JSON.stringify(sent)).not.toContain(out.token);
    expect(sent.code).toBe(out.code);
    expect(sent.build).toBe('abc1234');
  });

  it('request bodies are read as a stream with a byte cap: 413 past 64 KB, also with no Content-Length (audit MP-BODY-READ)', async () => {
    // A chunked body (a stream: no Content-Length), sent in 8 KB pieces, 100 KB in all, that never ends on its own
    let pulled = 0;
    const endless = () =>
      new ReadableStream<Uint8Array>({
        pull(c) {
          pulled += 8192;
          c.enqueue(new Uint8Array(8192).fill(32));
        },
      });
    const big = new Request('https://x/api/games', { method: 'POST', body: endless(), duplex: 'half' } as RequestInit);
    expect(big.headers.get('Content-Length')).toBeNull();
    expect(await readBody(big)).toEqual({ ok: false, tooBig: true });
    // It stopped just past the cap instead of reading on
    expect(pulled).toBeLessThan(MAX_BODY_BYTES + 3 * 8192);
    const seen: string[] = [];
    pulled = 0;
    const res = await handleGames(new Request('https://x/api/games', { method: 'POST', body: endless(), duplex: 'half' } as RequestInit), env(seen));
    expect(res.status).toBe(413);
    expect(seen).toEqual([]);
    const join = await handleGames(new Request('https://x/api/games/K7QM2X/join', { method: 'POST', body: endless(), duplex: 'half' } as RequestInit), env(seen));
    expect(join.status).toBe(413);
    // A declared length past the cap is refused before reading
    expect(await readBody(new Request('https://x', { method: 'POST', body: 'x', headers: { 'Content-Length': String(MAX_BODY_BYTES + 1) } }))).toEqual({ ok: false, tooBig: true });
    // A small chunked body is read; junk and no body are a 400, not a 413
    const small = new Request('https://x', { method: 'POST', body: new Blob(['{"a":1}']).stream(), duplex: 'half' } as RequestInit);
    expect(await readBody(small)).toEqual({ ok: true, value: { a: 1 } });
    expect(await readBody(new Request('https://x', { method: 'POST', body: 'not json' }))).toEqual({ ok: false, tooBig: false });
    expect(await readBody(new Request('https://x', { method: 'POST' }))).toEqual({ ok: false, tooBig: false });
    expect(await readJson(new Request('https://x', { method: 'POST', body: '"\u00e9t\u00e9"' }))).toBe('été');
    expect((await handleGames(new Request('https://x/api/games', { method: 'POST', body: 'not json' }), env(seen))).status).toBe(400);
  });
});
