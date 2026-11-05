import { afterEach, describe, expect, it, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';
import {
  DAILY_LIMIT_PER_REPORTER,
  DAILY_LIMIT_TOTAL,
  TITLE_PREFIX,
  countRecent,
  fence,
  handleBugReport,
  issueBody,
  issueTitle,
  parseReport,
  reporterId,
} from '../worker/bugReport';
import { buildReport, deckText, noteMoves, replayQuery } from '../src/ui/bugReport';
import { createInitialGameState } from '../src/core';
import { DECKS, deckGameSetup } from '../src/data/decks';
import type { GameConfig } from '../src/ui/savedGame';

const corpDeck = DECKS.find(d => d.side === 'corp')!;
const runnerDeck = DECKS.find(d => d.side === 'runner')!;
const config: GameConfig = { seed: 4242, corpDeck, runnerDeck, ai: 'corp', difficulty: 'hard' };
const state = createInitialGameState(deckGameSetup(config.seed, corpDeck, runnerDeck));

const SITE = 'https://beta-android-netrunner-digital.example.workers.dev';
const LIVE = 'https://android-netrunner-digital.example.workers.dev';
const env = { GITHUB_TOKEN: 'secret-token', BUG_REPORT_REPO: 'owner/repo' };

function post(body: unknown, headers: Record<string, string> = {}, site = SITE) {
  return new Request(`${site}/api/bug-report`, {
    method: 'POST',
    headers: { Origin: site, 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9', 'User-Agent': 'TestBrowser/1.0', ...headers },
    body: JSON.stringify(body),
  });
}

/** A fake GitHub: answers the issue list with `issues` and records what was posted. */
function fakeGithub(issues: unknown[] = []) {
  const posted: { url: string; body: Record<string, unknown> }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posted.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ number: 77 }), { status: 201 });
    }
    return new Response(JSON.stringify(issues), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { posted, fetchMock };
}

afterEach(() => vi.unstubAllGlobals());

describe('bug report payload (client)', () => {
  it('sends only description, screen and version outside a game', async () => {
    const payload = await buildReport({ description: '  The deck picker froze  ', screen: 'deck picker' });
    expect(payload).toEqual({ description: 'The deck picker froze', screen: 'deck picker', version: expect.any(String), website: '' });
  });

  it('attaches deck lists, log, seed, format and a snapshot from a game', async () => {
    const payload = await buildReport({ description: 'Rez button missing on ice', screen: 'game', game: { config, state } });
    const game = payload.game!;
    expect(game.seed).toBe(4242);
    expect(game.replay).toBe(replayQuery(config));
    expect(game.replay).toContain('&ai=corp&difficulty=hard');
    expect(game.format).toBe(`Corp deck ${corpDeck.format ?? 'casual'}, Runner deck ${runnerDeck.format ?? 'casual'}`);
    expect(game.corpDeck).toBe(deckText(corpDeck));
    expect(game.corpDeck).toContain(corpDeck.identity);
    expect(game.log.split('\n')).toHaveLength(state.log.length);
    // The snapshot decodes back to the game
    const decoded = JSON.parse(gunzipSync(Buffer.from(game.snapshot!, 'base64')).toString('utf8'));
    expect(decoded.state.rng).toEqual(state.rng);
    expect(decoded.config.seed).toBe(4242);
  });

  it("carries the game's moves, so the game replays move by move", async () => {
    const moves = [{ type: 'GAIN_CREDIT', player: 'corp' }] as const;
    noteMoves(4242, [...moves]);
    const game = (await buildReport({ description: 'Replay this game please', screen: 'game', game: { config, state } })).game!;
    expect(JSON.parse(gunzipSync(Buffer.from(game.snapshot!, 'base64')).toString('utf8')).moves).toEqual(moves);
  });
});

describe('bug report endpoint (worker)', () => {
  it('checks the description length', () => {
    expect(parseReport({ description: 'short' })).toMatch(/at least/);
    expect(parseReport({ description: 'x'.repeat(1001) })).toMatch(/under/);
    expect(typeof parseReport({ description: 'long enough text' })).toBe('object');
  });

  it('fences text so it cannot break out or mention anyone', () => {
    expect(fence('a ``` b')).toBe('````\na ``` b\n````');
    expect(issueTitle('@someone broke\nsecond line')).toBe(`${TITLE_PREFIX} @\u200bsomeone broke`);
  });

  it('cuts the oldest log lines so the issue fits on GitHub', () => {
    const report = parseReport({
      description: 'Long game went wrong',
      screen: 'game',
      version: 'abc1234',
      game: { seed: 1, corpDeck: 'c', runnerDeck: 'r', log: Array.from({ length: 5000 }, (_, i) => `T1 corp: line ${i} ${'x'.repeat(30)}`).join('\n') },
    });
    if (typeof report === 'string') throw new Error(report);
    const body = issueBody(report, { reporter: 'abc', site: 'beta preview', userAgent: 'UA' });
    expect(body.length).toBeLessThan(65_536);
    expect(body).toContain('oldest lines cut');
    expect(body).toContain('line 4999');
  });

  it('counts recent reports overall and per reporter', () => {
    const now = Date.parse('2026-10-31T12:00:00Z');
    const issues = [
      { title: `${TITLE_PREFIX} a`, body: 'Reporter: `me`', created_at: '2026-10-31T11:00:00Z' },
      { title: `${TITLE_PREFIX} b`, body: 'Reporter: `other`', created_at: '2026-10-31T10:00:00Z' },
      { title: `${TITLE_PREFIX} old`, body: 'Reporter: `me`', created_at: '2026-10-29T10:00:00Z' },
      { title: 'Some other issue', body: '`me`', created_at: '2026-10-31T10:00:00Z' },
    ];
    expect(countRecent(issues, 'me', now)).toEqual({ total: 2, mine: 1 });
  });

  it('opens an issue with the report and posts the snapshot as a comment', async () => {
    const { posted } = fakeGithub();
    const payload = await buildReport({ description: 'Rez button missing on ice', screen: 'game', game: { config, state } });
    const response = await handleBugReport(post(payload), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(posted).toHaveLength(2);
    expect(posted[0].url).toBe('https://api.github.com/repos/owner/repo/issues');
    const body = String(posted[0].body.body);
    expect(posted[0].body.title).toBe(`${TITLE_PREFIX} Rez button missing on ice`);
    expect(body).toContain('**Seed:** 4242');
    expect(body).toContain('TestBrowser/1.0');
    expect(body).toContain('beta preview');
    expect(body).not.toContain('203.0.113.9');
    expect(body).toContain(await reporterId('203.0.113.9', env.GITHUB_TOKEN));
    expect(posted[1].url).toBe('https://api.github.com/repos/owner/repo/issues/77/comments');
  });

  it('refuses requests from other sites', async () => {
    fakeGithub();
    const response = await handleBugReport(post({ description: 'from somewhere else' }, { Origin: 'https://evil.example' }), env);
    expect(response.status).toBe(403);
  });

  it('drops reports with the hidden field filled, without telling the bot', async () => {
    const { fetchMock } = fakeGithub();
    const response = await handleBugReport(post({ description: 'buy cheap stuff now', website: 'http://spam' }), env);
    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says reports are off until the token is set', async () => {
    fakeGithub();
    const response = await handleBugReport(post({ description: 'something broke here' }), { BUG_REPORT_REPO: 'owner/repo' });
    expect(response.status).toBe(503);
  });

  it('stops a reporter after the daily limit, and everyone after the total limit', async () => {
    const me = await reporterId('203.0.113.9', env.GITHUB_TOKEN);
    const recent = (n: number, who: string) =>
      Array.from({ length: n }, () => ({ title: `${TITLE_PREFIX} x`, body: `Reporter: \`${who}\``, created_at: new Date().toISOString() }));

    let gh = fakeGithub(recent(DAILY_LIMIT_PER_REPORTER, me));
    let response = await handleBugReport(post({ description: 'one more report please' }, {}, LIVE), env);
    expect(response.status).toBe(429);
    expect(gh.posted).toHaveLength(0);

    gh = fakeGithub(recent(DAILY_LIMIT_TOTAL, 'someone'));
    response = await handleBugReport(post({ description: 'one more report please' }, {}, LIVE), env);
    expect(response.status).toBe(429);
    expect(gh.posted).toHaveLength(0);
  });

  it('uses the burst limiter when it is bound', async () => {
    const gh = fakeGithub();
    const limiter = { limit: vi.fn(async () => ({ success: false })) };
    const response = await handleBugReport(post({ description: 'too fast reporting' }, {}, LIVE), { ...env, BUG_RATE_LIMITER: limiter });
    expect(response.status).toBe(429);
    expect(gh.posted).toHaveLength(0);
  });

  it('has no limits on the beta preview (Jeff, 2026-11-05: only he tests there), and beta reports leave the live caps alone', async () => {
    const me = await reporterId('203.0.113.9', env.GITHUB_TOKEN);
    const full = Array.from({ length: DAILY_LIMIT_TOTAL }, () => ({ title: `${TITLE_PREFIX} x`, body: `Reporter: \`${me}\`\n**Version:** v (beta preview)`, created_at: new Date().toISOString() }));
    const limiter = { limit: vi.fn(async () => ({ success: false })) };
    let gh = fakeGithub(full);
    let response = await handleBugReport(post({ description: 'beta report number 31' }), { ...env, BUG_RATE_LIMITER: limiter });
    expect(response.status).toBe(200);
    expect(gh.posted.length).toBeGreaterThan(0);

    gh = fakeGithub(full);
    response = await handleBugReport(post({ description: 'a live site report' }, {}, LIVE), env);
    expect(response.status).toBe(200);
  });
});
