import { describe, expect, it } from 'vitest';
import { cardDef, executeAction, findCardAnywhere, isLegalAction } from '../src/core';
import { installCorpCardFrom } from '../src/core/engine/actions/install';
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

describe('Breach order (rules 7.3.4)', () => {
  it('the Runner chooses between root cards and the central zone, and may take HQ first', () => {
    let s = newGame();
    const upgrade = installCorpForTest(s, '30042', 'hq'); // Manegarm Skunkworks, unrezzed
    s.runner.credits = 0;
    s = run(s, 'hq'); // declines to jack out; the breach asks before the first access
    s = executeAction(s, { type: 'CONTINUE_RUN', player: 'runner' });
    const p = s.pendingPrompts[0];
    expect(p.kind).toBe('access_order');
    if (p.kind !== 'access_order') return;
    expect(p.options.map(o => o.id)).toEqual([`root:${upgrade}`, 'hq']);
    expect(p.options[0].label).not.toContain('Manegarm'); // unrezzed: not named
    const before = s.log.length;
    s = executeAction(s, { type: 'RESOLVE_PROMPT', player: 'runner', promptId: p.id, choice: { kind: 'access_order', optionId: 'hq' } });
    // The HQ card is accessed first, then the upgrade (the only candidate left, so no more asking)
    const accessed = s.log.slice(before).filter(l => l.event === 'access');
    expect(accessed.map(l => l.cardCode === '30042')).toEqual([false, true]);
  });

  it('R&D gives its cards top first, up to the random access limit', () => {
    let s = newGame();
    s = run(s, 'rd');
    s.activeRun!.extraAccesses = 1;
    const top = s.corp.rd.slice(0, 3).map(c => c.instanceId);
    s = executeAction(s, { type: 'CONTINUE_RUN', player: 'runner' });
    while (s.pendingPrompts[0]?.kind === 'access_trash') s = executeAction(s, { type: 'RESOLVE_PROMPT', player: 'runner', promptId: s.pendingPrompts[0].id, choice: { kind: 'access_trash', trash: false } });
    const ids = s.log.filter(l => l.event === 'access').length;
    expect(ids).toBe(2);
    expect(s.corp.rd.slice(0, 3).map(c => c.instanceId).filter(id => top.includes(id)).length).toBeGreaterThan(0);
  });
});

describe('Cards accessed and then installed in the same breach (rules 7.3.1a)', () => {
  it('stay known to the Runner until they leave play', () => {
    const s = newGame();
    const card = s.corp.hq.find(c => cardDef(c).type_code === 'asset') ?? s.corp.hq[0];
    s.activeRun = { ...(run(newGame(), 'hq').activeRun!), breached: true, accessed: [{ id: card.instanceId, inArchives: false }] };
    installCorpCardFrom(s, card, s.corp.hq, null, true);
    expect(card.runnerKnows).toBe(true);
    trashInstalledCard(s, card);
    expect(card.runnerKnows).toBeUndefined();
  });

  it('a card installed outside a breach is not known', () => {
    const s = newGame();
    const card = s.corp.hq[0];
    installCorpCardFrom(s, card, s.corp.hq, null, true);
    expect(card.runnerKnows).toBeUndefined();
  });
});
