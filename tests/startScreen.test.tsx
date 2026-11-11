/**
 * The start screen (multiplayer phase 2, chunk 2c): how to play first, then
 * only the settings and decks that choice needs; online decks not legal in
 * the game's format are greyed out with the reasons (the server's own test,
 * checkDeck: rules 1.4.1a for Casual); and the lobby calls against a stubbed
 * fetch, with each error the server can give.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeckPicker } from '../src/ui/components/DeckPicker';
import type { OnlineRole, PlayMode } from '../src/ui/components/DeckPicker';
import { STARTER_DECKS, DeckList } from '../src/data/decks';
import { LOBBY_ERROR_TEXT, codeFromPath, createGame, inviteLink, joinGame, lookupGame, onlineDeckProblems, roomPresence, submission } from '../src/net/lobby';
import { PROTOCOL_VERSION } from '../src/net/protocol';
import type { LobbyInfo } from '../src/net/protocol';
import type { FormatId, SideCode } from '../src/core';

const corpStarter = STARTER_DECKS.find(d => d.side === 'corp')!;
const runnerStarter = STARTER_DECKS.find(d => d.side === 'runner')!;
/** The Corp starter with one Hedge Fund less: a fine deck, but not a starter as it comes (rules 1.4.1a). */
const tweaked: DeckList = { ...corpStarter, id: 'custom-tweaked', name: 'Tweaked starter', source: 'custom', cards: { ...corpStarter.cards, 'Hedge Fund': 2 } };

function stubStorage(entries: Record<string, string> = {}) {
  const store = new Map(Object.entries(entries));
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    },
    location: { origin: 'https://example.test', pathname: '/' },
  });
}

beforeEach(() => stubStorage({ 'netrunner.customDecks.v1': JSON.stringify([tweaked]) }));
afterEach(() => vi.unstubAllGlobals());

const lobby = (over: Partial<LobbyInfo> = {}): LobbyInfo => ({
  code: 'K7QM2X',
  format: 'casual',
  hostSide: 'corp',
  hostIdentity: '30035',
  open: true,
  over: false,
  build: 'test',
  protocol: PROTOCOL_VERSION,
  ...over,
});

function render(mode: PlayMode, opts: { role?: OnlineRole; lobby?: LobbyInfo; host?: { side: SideCode; format: FormatId }; joinCode?: string } = {}) {
  return renderToStaticMarkup(
    <DeckPicker
      initialCorpDeckId={corpStarter.id}
      initialRunnerDeckId={runnerStarter.id}
      onStart={() => {}}
      onOnline={() => {}}
      initialMode={mode}
      initialRole={opts.role}
      initialLobby={opts.lobby}
      initialHost={opts.host}
      joinCode={opts.joinCode ?? null}
    />,
  );
}

/** The deck column headings, in order. */
const columns = (html: string) => [...html.matchAll(/<h2 class="font-cyber[^"]*">([^<]*)<\/h2>/g)].map(m => m[1].replace(/&#x27;/g, "'"));
const has = (html: string, testId: string) => html.includes(`data-testid="${testId}"`);

/** The deck entry's opening tag. */
function deckTag(html: string, id: string): string {
  const at = html.indexOf(`data-testid="deck-${id}"`);
  expect(at).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<button', at), html.indexOf('>', at) + 1);
}

describe('Start screen: each way of playing shows what it needs', () => {
  it('Play the computer: side and difficulty, your deck first, the other labelled as the computer\'s', () => {
    stubStorage({ 'netrunner.opponent': 'ai-corp' });
    const html = render('computer');
    expect(has(html, 'opponent-ai-corp') && has(html, 'opponent-ai-runner') && has(html, 'difficulty-hard')).toBe(true);
    expect(columns(html)).toEqual(["COMPUTER'S CORP DECK", 'YOUR RUNNER DECK']);
    expect(has(html, 'start-game')).toBe(true);
    stubStorage({ 'netrunner.opponent': 'ai-runner' });
    expect(columns(render('computer'))).toEqual(['YOUR CORP DECK', "COMPUTER'S RUNNER DECK"]); // Corp left either way
  });

  it('Pass and play: no settings, both decks as before', () => {
    const html = render('hotseat');
    expect(has(html, 'difficulty-normal') || has(html, 'opponent-ai-corp')).toBe(false);
    expect(columns(html)).toEqual(['CORP DECK', 'RUNNER DECK']);
    expect(has(html, 'start-game')).toBe(true);
  });

  it('Host a game: side, format, your own deck only, Create game', () => {
    const html = render('online', { role: 'host', host: { side: 'runner', format: 'startup' } });
    for (const id of ['online-host', 'online-join', 'host-side-corp', 'host-side-runner', 'host-format-startup', 'host-format-standard', 'host-format-casual', 'create-game']) {
      expect(has(html, id), id).toBe(true);
    }
    expect(columns(html)).toEqual(['YOUR RUNNER DECK']);
    expect(has(html, 'start-game')).toBe(false);
  });

  it('Join with a code: the code field; no decks until the game is found', () => {
    const html = render('online', { role: 'join' });
    expect(has(html, 'join-code') && has(html, 'find-game')).toBe(true);
    expect(columns(html)).toEqual([]);
    expect(has(html, 'join-game')).toBe(false);
  });

  it("Join, game found: the host's side, identity and format, your side, then your decks for that side", () => {
    const html = render('online', { role: 'join', lobby: lobby({ hostSide: 'corp', hostIdentity: submission(corpStarter).identity, format: 'casual' }) });
    expect(html).toContain('data-testid="lobby-identity">The Syndicate: Profit over Principle<');
    expect(html).toContain('data-testid="lobby-format">Casual<');
    expect(html).toContain('data-testid="lobby-your-side">Runner<');
    expect(columns(html)).toEqual(['YOUR RUNNER DECK']);
    expect(has(html, 'join-game')).toBe(true);
  });

  it('an invite link opens Join with the code filled in', () => {
    const html = render('online', { joinCode: 'K7QM2X' });
    expect(html).toMatch(/data-testid="join-code"|id="join-code"/);
    expect(html).toContain('value="K7QM-2X"');
  });
});

describe('Start screen: online decks not legal in the format are greyed out', () => {
  it('Casual: a starter identity only with its starter deck as it comes (rules 1.4.1a); a tweaked starter is disabled with the reason', () => {
    const html = render('online', { role: 'host', host: { side: 'corp', format: 'casual' } });
    expect(deckTag(html, corpStarter.id)).not.toContain('aria-disabled');
    const tag = deckTag(html, tweaked.id);
    expect(tag).toContain('aria-disabled="true"');
    expect(tag).toContain('only be played with its System Gateway starter deck');
    expect(has(html, `online-illegal-${tweaked.id}`)).toBe(true);
    expect(has(html, `online-legal-${corpStarter.id}`)).toBe(true);
  });

  it('the legality follows the format: the same tweaked deck in Startup and Standard is judged by validateDeck', () => {
    for (const format of ['startup', 'standard'] as FormatId[]) {
      const html = render('online', { role: 'host', host: { side: 'corp', format } });
      const problems = onlineDeckProblems(tweaked, format, 'corp');
      expect(deckTag(html, tweaked.id).includes('aria-disabled'), format).toBe(problems.length > 0);
    }
  });

  it('the selected deck not legal: Create game is disabled and says why', () => {
    stubStorage({ 'netrunner.customDecks.v1': JSON.stringify([tweaked]) });
    const html = renderToStaticMarkup(
      <DeckPicker initialCorpDeckId={tweaked.id} initialRunnerDeckId={runnerStarter.id} onStart={() => {}} initialMode="online" initialRole="host" initialHost={{ side: 'corp', format: 'casual' }} />,
    );
    expect(has(html, 'host-deck-illegal')).toBe(true);
    expect(html).toMatch(/disabled=""[^>]*data-testid="create-game"/);
  });

  it('the side matters too: a Corp deck is not a Runner deck', () => {
    expect(onlineDeckProblems(corpStarter, 'casual', 'runner')).toEqual(['That deck is not a Runner deck.']);
    expect(onlineDeckProblems(runnerStarter, 'casual', 'runner')).toEqual([]);
  });
});

describe('Lobby calls against a stubbed fetch', () => {
  type Call = { url: string; init?: RequestInit };
  const stub = (status: number, body: unknown, calls: Call[] = []) => async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };

  it('Create game posts side, deck, format and player id, and returns the session', async () => {
    const calls: Call[] = [];
    const res = await createGame({ side: 'corp', deck: corpStarter, format: 'casual', playerId: 'abcdefghijklmnopqrstuv' }, stub(201, { code: 'K7QM2X', seat: 'corp', token: 'secret-token-123' }, calls));
    expect(res).toEqual({ ok: true, session: { code: 'K7QM2X', seat: 'corp', token: 'secret-token-123' } });
    expect(calls[0].url).toBe('/api/games');
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body).toMatchObject({ side: 'corp', format: 'casual', visibility: 'invite', playerId: 'abcdefghijklmnopqrstuv', deck: submission(corpStarter) });
  });

  it('Find game: the lobby; 404, 429, a full or finished game, and another protocol', async () => {
    expect(await lookupGame('K7QM2X', stub(200, lobby()))).toEqual({ ok: true, lobby: lobby() });
    expect(await lookupGame('K7QM2X', stub(404, { error: 'not_found' }))).toMatchObject({ ok: false, message: 'No game with that code' });
    expect(await lookupGame('K7QM2X', stub(429, { error: 'rate_limited' }))).toMatchObject({ ok: false, message: 'Too many tries, wait a minute' });
    expect(await lookupGame('K7QM2X', stub(200, lobby({ open: false })))).toMatchObject({ ok: false, message: 'That game already has two players' });
    expect(await lookupGame('K7QM2X', stub(200, lobby({ open: false, over: true })))).toMatchObject({ ok: false, message: LOBBY_ERROR_TEXT.over });
    expect(await lookupGame('K7QM2X', stub(200, lobby({ protocol: PROTOCOL_VERSION + 1 })))).toMatchObject({ ok: false, refresh: true, message: 'A new version is available' });
  });

  it("Join game: the session; 404, 409, 422 with the server's reasons, 429, no network", async () => {
    const calls: Call[] = [];
    expect(await joinGame('K7QM2X', { deck: runnerStarter, playerId: 'abcdefghijklmnopqrstuv' }, stub(200, { seat: 'runner', token: 'tok-runner-1234' }, calls))).toEqual({
      ok: true,
      session: { code: 'K7QM2X', seat: 'runner', token: 'tok-runner-1234' },
    });
    expect(calls[0].url).toBe('/api/games/K7QM2X/join');
    expect(await joinGame('K7QM2X', { deck: runnerStarter, playerId: 'x'.repeat(22) }, stub(404, { error: 'not_found' }))).toMatchObject({ message: 'No game with that code' });
    expect(await joinGame('K7QM2X', { deck: runnerStarter, playerId: 'x'.repeat(22) }, stub(409, { error: 'full' }))).toMatchObject({ message: 'That game already has two players' });
    expect(await joinGame('K7QM2X', { deck: runnerStarter, playerId: 'x'.repeat(22) }, stub(422, { error: 'illegal_deck', reasons: ['Too few cards.'] }))).toMatchObject({
      ok: false,
      reasons: ['Too few cards.'],
    });
    expect(await joinGame('K7QM2X', { deck: runnerStarter, playerId: 'x'.repeat(22) }, stub(429, { error: 'rate_limited' }))).toMatchObject({ message: 'Too many tries, wait a minute' });
    const offline = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await joinGame('K7QM2X', { deck: runnerStarter, playerId: 'x'.repeat(22) }, offline)).toMatchObject({ message: LOBBY_ERROR_TEXT.network });
  });

  it('a room is gone only on a 404', async () => {
    expect(await roomPresence('K7QM2X', stub(404, { error: 'not_found' }))).toBe('gone');
    expect(await roomPresence('K7QM2X', stub(200, lobby()))).toBe('there');
    expect(await roomPresence('K7QM2X', stub(500, {}))).toBe('unknown');
    expect(await roomPresence('K7QM2X', stub(429, { error: 'rate_limited' }))).toBe('unknown');
    expect(await roomPresence('K7QM2X', () => Promise.reject(new Error('offline')))).toBe('unknown');
  });

  it('invite links carry only the code', () => {
    expect(inviteLink('K7QM2X', 'https://stackheap.run')).toBe('https://stackheap.run/play/K7QM-2X');
    expect(codeFromPath('/play/K7QM-2X')).toBe('K7QM2X');
    expect(codeFromPath('/play/k7qm2x/')).toBe('K7QM2X');
    expect(codeFromPath('/play/K7QM-20')).toBeNull();
    expect(codeFromPath('/')).toBeNull();
  });
});
