import { describe, expect, it } from 'vitest';
import {
  GameState,
  HIDDEN_CORP,
  HIDDEN_RUNNER,
  cardDef,
  createCardInstance,
  findCardAnywhere,
  newViewIds,
  stateFromView,
  viewFor,
} from '../src/core';
import { LocalTable } from '../src/ui/table';
import { cardFates } from '../src/ui/cardFates';
import { LeakChecker } from '../scripts/leak-check';
import { reconChecks } from '../scripts/leak-check-recon';
import { cont, installCorpForTest, newGame, run, startRunnerTurn } from './helpers';

// Multiplayer phase 1, chunk 2: the screen draws a GameState rebuilt from the viewer's view
// (src/core/view/reconstruct.ts) and asks the viewer's seat what is legal (src/ui/table.ts).
// Rules: Comprehensive Rules v26.03.

const OFFWORLD = '30067'; // agenda
const NICO = '30037'; // Nico Campaign: an asset with a trash cost
const quiet = { confirm: async () => true, alert: (m: string) => { throw new Error(m); } };

const recon = (s: GameState, side: 'corp' | 'runner') => stateFromView(viewFor(s, side, newViewIds(), 'g').view);
const codesIn = (s: GameState) => new Set(JSON.stringify(s).match(/"cardCode":"([^"]+)"/g)?.map(m => m.slice(12, -1)));

describe('stateFromView', () => {
  it('the opponent\'s hand and both decks are placeholders, own cards exact (4.2.2, 4.3.2)', () => {
    const s = newGame();
    const r = recon(s, 'runner');
    expect(r.corp.hq).toHaveLength(s.corp.hq.length);
    expect(r.corp.hq.every(c => c.cardCode === HIDDEN_CORP && c.instanceId.startsWith('hidden-hq-'))).toBe(true);
    expect(r.corp.rd).toHaveLength(s.corp.rd.length);
    expect(r.runner.stack.every(c => c.cardCode === HIDDEN_RUNNER)).toBe(true);
    expect(r.runner.grip.map(c => c.cardCode)).toEqual(s.runner.grip.map(c => c.cardCode));
    expect(r.runner.grip.every(c => /^r\d+$/.test(c.instanceId))).toBe(true);
    // A placeholder has a definition, so drawing it never throws; its face is nobody's business
    expect(cardDef(r.corp.hq[0])).toMatchObject({ title: 'Facedown card', side_code: 'corp' });
    for (const c of s.corp.hq) expect(codesIn(r).has(c.cardCode) && !s.runner.grip.some(g => g.cardCode === c.cardCode) && c.cardCode !== s.corp.identity.cardCode).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/inst-|game-/);
    expect(r.rng).toEqual({ seed: 0, state: 0 });
    // The Corp's own reconstruction has its hand
    expect(recon(s, 'corp').corp.hq.map(c => c.cardCode)).toEqual(s.corp.hq.map(c => c.cardCode));
  });

  it('a facedown installed card keeps its id on the Runner\'s screen and loses its face (4.6.2)', () => {
    const s = newGame();
    installCorpForTest(s, OFFWORLD, 'remote-1');
    const ids = newViewIds();
    const { view } = viewFor(s, 'runner', ids, 'g');
    const r = stateFromView(view);
    const [card] = r.corp.servers['remote-1'].root;
    expect(card.cardCode).toBe(HIDDEN_CORP);
    expect(card.instanceId).toBe(view.corp.servers['remote-1'].root[0].instanceId);
    expect(recon(s, 'corp').corp.servers['remote-1'].root[0].cardCode).toBe(OFFWORLD);
  });

  it('the card the Runner is accessing from R&D is on its screen (in R&D, from its prompt), not on the Corp\'s (7.1.2)', () => {
    let s = newGame();
    s.corp.rd.unshift(createCardInstance(s, NICO));
    s.runner.credits = 10;
    s = cont(run(s, 'rd'));
    expect(s.pendingPrompts[0]?.kind).toBe('access_trash');
    const r = recon(s, 'runner');
    const p = r.pendingPrompts[0];
    expect(p.kind === 'access_trash' && findCardAnywhere(r, p.cardInstanceId)?.cardCode).toBe(NICO);
    expect(r.corp.rd).toHaveLength(s.corp.rd.length);
    const c = recon(s, 'corp');
    expect(c.pendingPrompts).toEqual([]);
    expect(codesIn(c).has(NICO)).toBe(false);
  });
});

describe('Seat', () => {
  it('pass and play: after the Corp installs an agenda facedown, the Runner\'s seat holds no HQ or agenda code', async () => {
    const s = newGame();
    const table = new LocalTable(s, null, quiet);
    const corp = table.seatFor('corp');
    const card = corp.state.corp.hq.find(c => cardDef(c).type_code === 'agenda') ?? corp.state.corp.hq[0];
    const install = corp.legal.find(a => a.type === 'INSTALL_CARD' && a.cardInstanceId === card.instanceId && a.asNewRemote && !a.faceUp);
    expect(install).toBeDefined();
    expect(card.instanceId).toMatch(/^c\d+$/);
    await corp.act(install!);
    const runner = table.seatFor('runner');
    const installed = Object.values(runner.state.corp.servers).flatMap(x => x.root);
    expect(installed).toHaveLength(1);
    expect(installed[0].cardCode).toBe(HIDDEN_CORP);
    const json = JSON.stringify(runner);
    for (const c of table.state.corp.hq) expect(json).not.toContain(`"${c.cardCode}"`);
    expect(json).not.toContain(`"${card.cardCode}"`);
    expect(json).not.toContain('inst-');
    // The Runner is not acting: nothing is legal for it, and it cannot act for the Corp
    expect(runner.legal).toEqual([]);
    expect(runner.can({ type: 'GAIN_CREDIT', player: 'corp' })).toBe(false);
  });

  it('legal actions come in the viewer\'s ids, and act maps them back to the engine\'s', async () => {
    const s = newGame();
    startRunnerTurn(s);
    const table = new LocalTable(s, null, quiet);
    const seat = table.seatFor('runner');
    expect(seat.legal.length).toBeGreaterThan(0);
    expect(JSON.stringify(seat.legal)).not.toContain('inst-');
    expect(seat.can({ type: 'GAIN_CREDIT', player: 'runner' })).toBe(true);
    expect(seat.can({ type: 'PURGE_VIRUS', player: 'runner' } as never)).toBe(false);
    const credits = table.state.runner.credits;
    await seat.act({ type: 'GAIN_CREDIT', player: 'runner' });
    expect(table.state.runner.credits).toBe(credits + 1);
    expect(table.moves).toEqual([{ type: 'GAIN_CREDIT', player: 'runner' }]);
  });

  it('the open table gets the real state and both sides\' moves', () => {
    const s = newGame();
    const seat = new LocalTable(s, null, quiet).seatFor('both');
    expect(seat.state).toBe(s);
    expect(seat.view).toBeNull();
  });
});

describe('Card fates from one screen', () => {
  it('a facedown card trashed into Archives shows to the Runner as a card back (4.4.6c)', () => {
    const s = newGame();
    const id = installCorpForTest(s, OFFWORLD, 'remote-1');
    const ids = newViewIds();
    const before = viewFor(s, 'runner', ids, 'g');
    const after = structuredClone(s);
    const card = after.corp.servers['remote-1'].root.pop()!;
    after.corp.archives.faceDown.push(card);
    const next = viewFor(after, 'runner', before.ids, 'g');
    const fates = cardFates(stateFromView(before.view), stateFromView(next.view));
    expect(fates).toHaveLength(1);
    expect(fates[0]).toMatchObject({ kind: 'trashed', corpSecret: true });
    expect(fates[0].card.cardCode).toBe(HIDDEN_CORP);
    expect(id).toMatch(/^inst-/);
  });
});

describe('Leak fuzzer, chunk 2 checks', () => {
  it('pass on a clean game state and catch a planted leak in the reconstruction', () => {
    const s = newGame();
    const real = installCorpForTest(s, OFFWORLD, 'remote-1');
    const checker = new LeakChecker(1, true);
    checker.check(s, 0);
    expect(checker.failures).toEqual([]);
    // Plant a leak: the Runner's view carries the facedown agenda's face
    const { view, ids } = viewFor(s, 'runner', newViewIds(), 'g');
    view.corp.servers['remote-1'].root[0].cardCode = OFFWORLD;
    const planted = new LeakChecker(2, true);
    reconChecks(planted, { state: s, side: 'runner', view, ids, hiddenIds: new Set([real]), leakedCodes: new Set([OFFWORLD]), step: 0 });
    expect(planted.failures.map(f => f.check)).toEqual(expect.arrayContaining(['hidden-card', 'hidden-code']));
  });
});
