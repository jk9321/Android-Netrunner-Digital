import { describe, expect, it } from 'vitest';
import { executeAction, GameState } from '../src/core';
import { runnerRootKinds } from '../src/core/engine/helpers';
import { giveCard, installCorpForTest, newGame, scoreForTest } from './helpers';

// B4b (brief b4-hidden-zones ruling 9, rev 1b (b)): the kinds a facedown root card can be, from open information. Where a
// card is installed and what the Runner saw beside it are open (rules 4.6.6e, f, 10.2.3a); a remote root holds one agenda
// or asset (3.2.1, 3.3.1, 4.6.6e) and a central root only upgrades (3.6.1).
const UPGRADE = '30066'; // Malapert Data Vault
const ASSET = '30071'; // Regolith Mining License
const AGENDA = '30070'; // Superconducting Hub (3 to advance)

/** One Corp action through the engine, so the one diff after it runs (ruling 2). */
const tick = (s: GameState) => executeAction(s, { type: 'GAIN_CREDIT', player: 'corp' });
const card = (s: GameState, id: string) => Object.values(s.corp.servers).flatMap(sv => sv.root).find(c => c.instanceId === id)!;
const kinds = (s: GameState, id: string) => runnerRootKinds(s, card(s, id))?.kinds;

describe('B4b: what the Runner knows of a facedown root card', () => {
  it('(i) a card in a central root is an upgrade (3.6.1, 4.6.6e)', () => {
    const s = newGame();
    const id = installCorpForTest(s, UPGRADE, 'archives');
    expect(kinds(tick(s), id)).toEqual(['upgrade']);
  });

  it('(ii) a card beside an agenda or asset the Runner knows is an upgrade (3.2.1, 3.3.1)', () => {
    const s = newGame();
    installCorpForTest(s, ASSET, 'remote-1', true);
    const id = installCorpForTest(s, UPGRADE, 'remote-1');
    expect(kinds(tick(s), id)).toEqual(['upgrade']);
  });

  it('(iii) it stays an upgrade once the asset beside it has left in the open, until it leaves play (1.12.3, #66b)', () => {
    const s = newGame();
    const asset = installCorpForTest(s, ASSET, 'remote-1', true);
    const id = installCorpForTest(s, UPGRADE, 'remote-1');
    let t = tick(s);
    const sv = t.corp.servers['remote-1'];
    t.corp.archives.faceUp.push(...sv.root.splice(sv.root.indexOf(card(t, asset)), 1));
    t = tick(t);
    expect(kinds(t, id)).toEqual(['upgrade']);
    expect(t.corp.rootUpgradesKnownToRunner).toEqual([id]);
    // Back in HQ it is a new object (1.12.3): installed again, the Runner knows nothing of it
    const root = t.corp.servers['remote-1'].root;
    t.corp.hq.push(...root.splice(0, 1));
    t = tick(t);
    expect(t.corp.rootUpgradesKnownToRunner).toBeUndefined();
  });

  it('(iii) a facedown agenda scored from a root shows the card that sat beside it is an upgrade (4.5.2, 10.2.3a)', () => {
    const s = newGame();
    const id = installCorpForTest(s, UPGRADE, 'remote-score');
    expect(kinds(tick(s), id)).toEqual(['agenda', 'asset', 'upgrade']);
    const t = scoreForTest(s, AGENDA);
    expect(t.corp.scoreArea.map(c => c.cardCode)).toContain(AGENDA);
    expect(kinds(t, id)).toEqual(['upgrade']);
  });

  it('(iv) two facedown cards in one remote root hold at most one agenda or asset: each names the other', () => {
    const s = newGame();
    const a = installCorpForTest(s, UPGRADE, 'remote-1');
    const b = installCorpForTest(s, AGENDA, 'remote-1');
    const t = tick(s);
    expect(runnerRootKinds(t, card(t, a))).toEqual({ kinds: ['agenda', 'asset', 'upgrade'], joint: [card(t, b)] });
    expect(runnerRootKinds(t, card(t, b))?.joint).toEqual([card(t, a)]);
  });

  it('installing an agenda trashes the known asset (8.5.6a): the new card can be anything, the old upgrade stays known', () => {
    const s = newGame();
    installCorpForTest(s, ASSET, 'remote-1', true);
    const up = installCorpForTest(s, UPGRADE, 'remote-1');
    const t = tick(s);
    const agenda = giveCard(t, 'corp', AGENDA);
    const u = executeAction(t, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: agenda, targetServerId: 'remote-1' });
    expect(u.corp.servers['remote-1'].root.map(c => c.cardCode)).toEqual([UPGRADE, AGENDA]);
    expect(kinds(u, agenda)).toEqual(['agenda', 'asset', 'upgrade']);
    expect(runnerRootKinds(u, card(u, agenda))?.joint).toEqual([]);
    expect(kinds(u, up)).toEqual(['upgrade']);
  });

  it('a card the Runner knows has no guessed kinds', () => {
    const s = newGame();
    const id = installCorpForTest(s, ASSET, 'remote-1', true);
    expect(runnerRootKinds(tick(s), card(s, id))).toBeUndefined();
  });
});
