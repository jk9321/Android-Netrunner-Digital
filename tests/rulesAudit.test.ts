import { describe, expect, it } from 'vitest';
import { cardDef, findCardAnywhere, isLegalAction } from '../src/core';
import { trashInstalledCard } from '../src/core/engine/cardEffects';
import { askCorpInstall } from '../src/core/scripts/effects';
import { cont, installCorpForTest, installIceForTest, newGame, putInHand, run } from './helpers';

// Findings from the 2026-10-26 rules audit (visibility and turn flow)

describe('Rez timing during a run', () => {
  it('the Corp cannot rez an upgrade while the Runner is encountering ice (rules 6.9.3b)', () => {
    let s = newGame();
    installIceForTest(s, '30072', 'remote-1'); // rezzed Palisade
    const upgrade = installCorpForTest(s, '30042', 'remote-1'); // Manegarm Skunkworks
    s.corp.credits = 20;
    s = cont(run(s, 'remote-1'));
    expect(s.activeRun?.phase).toBe('encounter_ice');
    expect(isLegalAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: upgrade })).toBe(false);
  });

  it('the Corp can still rez an upgrade as the Runner approaches ice', () => {
    let s = newGame();
    installIceForTest(s, '30072', 'remote-1', false);
    const upgrade = installCorpForTest(s, '30042', 'remote-1');
    s.corp.credits = 20;
    s = run(s, 'remote-1');
    expect(s.activeRun?.phase).toBe('approach_ice');
    expect(isLegalAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: upgrade })).toBe(true);
  });
});

describe('Archives face up or face down (rules 4.4.6b)', () => {
  it('an agenda installed faceup goes to Archives faceup when the Corp trashes it', () => {
    const s = newGame();
    const id = installCorpForTest(s, '30067', 'remote-1'); // Offworld Office
    const agenda = s.corp.servers['remote-1'].root.find(c => c.instanceId === id)!;
    agenda.faceUp = true;
    trashInstalledCard(s, agenda);
    expect(s.corp.archives.faceUp.map(c => c.instanceId)).toContain(id);
    expect(agenda.faceUp).toBeUndefined();
  });

  it('an unrezzed card the Corp trashes still goes facedown', () => {
    const s = newGame();
    const id = installCorpForTest(s, '30071', 'remote-1'); // Regolith Mining License
    trashInstalledCard(s, s.corp.servers['remote-1'].root[0]);
    expect(s.corp.archives.faceDown.map(c => c.instanceId)).toContain(id);
  });
});

describe('Log keeps hidden cards hidden', () => {
  it('a card the Corp cannot install is not named in the log', () => {
    const s = newGame();
    const id = putInHand(s, 'corp', 'operation'); // an operation can't be installed anywhere
    const title = cardDef(findCardAnywhere(s, id)!).title;
    expect(askCorpInstall({ state: s, card: s.corp.identity, side: 'corp' }, id, 'install')).toBe(false);
    expect(s.log[s.log.length - 1].message).toMatch(/could not install/);
    expect(s.log[s.log.length - 1].message).not.toContain(title);
  });
});
