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
});
