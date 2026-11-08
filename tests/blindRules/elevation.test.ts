// Blind rules tests: written from the card text and the Comprehensive Rules v26.03 only. See README.md.
import { describe, expect, it } from 'vitest';
import { executeAction, iceStrength, isLegalAction } from '../../src/core';
import { giveCard, installCorpForTest, installIceForTest, installProgramForTest, newGame, run, setIdentity, startRunnerTurn } from '../helpers';
import { drive, pick } from './util';

const SHRED = '35005';
const SCATTER_FIELD = '35042';
const BYTE = '35050';
const LAMPLIGHTER = '35080';
const SEMAK_SAMUN = '35054';
const MAGDALENE = '35024';
const PALISADE = '30072';
const NICO = '30037';
const OFFWORLD = '30067';
const MAYFLY = '30032';
const CLEAVER = '30006';
const SURE_GAMBLE = '30030';
const TITHE = '30073';
const INGATAN = '35038';

/** Plays Shred from the grip and picks the server it runs. */
function playShred(s: ReturnType<typeof newGame>, server: string) {
  startRunnerTurn(s);
  const id = giveCard(s, 'runner', SHRED);
  s.runner.credits = 10;
  let next = executeAction(s, { type: 'PLAY_OPERATION_OR_EVENT', player: 'runner', cardInstanceId: id });
  const p = next.pendingPrompts[0];
  if (p?.kind === 'effect_choice' && p.side === 'runner') next = executeAction(next, { type: 'RESOLVE_PROMPT', player: 'runner', promptId: p.id, choice: pick(p, new RegExp(server)) });
  return next;
}

describe('Shred ("The first time the Corp would end that run, prevent the run from ending unless ...")', () => {
  // Rules 9.9.5: prevention; 9.9.5a: "the first time ... would" counts the instance even if prevented.
  function shredSetup(iceCount: number) {
    const s = newGame();
    for (let i = 0; i < iceCount; i++) installIceForTest(s, PALISADE, 'remote-1');
    installCorpForTest(s, NICO, 'remote-1'); // X = 1 card in the root
    return s;
  }
  const corpAnswer = (re: RegExp) => (p: import('../../src/core').Prompt) => (p.side === 'corp' && p.kind === 'effect_choice' ? pick(p, re) : undefined);

  it('the run goes on when the Corp does not trash a card from HQ', () => {
    const s0 = shredSetup(1);
    const hq = s0.corp.hq.length;
    const s = drive(playShred(s0, 'remote-1'), corpAnswer(/no|decline|don|let/i));
    expect(s.corp.hq).toHaveLength(hq);
    expect(s.runsThisTurn[0].successful).toBe(true);
  });

  it('the run ends when the Corp reveals and trashes X = 1 card from HQ', () => {
    const s0 = shredSetup(1);
    const hq = s0.corp.hq.length;
    const s = drive(playShred(s0, 'remote-1'), (p, st) => {
      if (p.side === 'corp' && p.kind === 'effect_cards') return { kind: 'effect_cards', cardInstanceIds: p.candidateIds.slice(0, 1) };
      if (p.side === 'corp' && p.kind === 'effect_choice') return pick(p, /trash|reveal|yes|end/i);
      void st;
      return undefined;
    });
    expect(s.corp.hq).toHaveLength(hq - 1);
    expect(s.runsThisTurn[0].successful).toBe(false);
  });

  it('only the first "end the run" is affected: the second one ends the run', () => {
    const s0 = shredSetup(2);
    const s = drive(playShred(s0, 'remote-1'), corpAnswer(/no|decline|don|let/i));
    expect(s.runsThisTurn[0].successful).toBe(false);
  });
});

describe('Scatter Field ("While this ice is the only piece of ice protecting this server")', () => {
  // Rules 9.4.2 static condition, checked continuously.
  it('is strength 4 alone and 0 with another ice', () => {
    const s = newGame();
    const id = installIceForTest(s, SCATTER_FIELD, 'remote-1');
    const sf = () => s.corp.servers['remote-1'].ice.find(c => c.instanceId === id)!;
    expect(iceStrength(s, sf())).toBe(4);
    installIceForTest(s, PALISADE, 'remote-1', false); // unrezzed ice still protects the server (4.6.9)
    expect(iceStrength(s, sf())).toBe(0);
  });
});

describe('Byte! ("anywhere except in Archives")', () => {
  // Rules 9.3.2c static condition on where it is accessed.
  it('does nothing when accessed in Archives', () => {
    const s0 = newGame();
    s0.corp.archives.faceDown.push(...[giveCard(s0, 'corp', BYTE)].map(id => s0.corp.hq.splice(s0.corp.hq.findIndex(c => c.instanceId === id), 1)[0]));
    s0.corp.credits = 10;
    startRunnerTurn(s0);
    const g = s0.runner.grip.length;
    const s = drive(run(s0, 'archives'), p => {
      if (p.side === 'corp') throw new Error(`Corp was asked: ${p.message}`);
      return undefined;
    });
    expect(s.runner.tags).toBe(0);
    expect(s.runner.grip).toHaveLength(g);
    expect(s.corp.credits).toBe(10);
  });

  it('when accessed installed, the Corp may pay 4 to tag the Runner and do 3 net damage', () => {
    const s0 = newGame();
    installCorpForTest(s0, BYTE, 'remote-1');
    s0.corp.credits = 10;
    startRunnerTurn(s0);
    s0.runner.grip = [];
    for (let i = 0; i < 5; i++) giveCard(s0, 'runner', SURE_GAMBLE);
    const s = drive(run(s0, 'remote-1'), p => (p.side === 'corp' && p.kind === 'effect_choice' ? pick(p, /pay|yes|4/i) : undefined));
    expect(s.corp.credits).toBe(6);
    expect(s.runner.tags).toBe(1);
    expect(s.runner.grip).toHaveLength(2);
  });
});

describe('Lamplighter ("When an agenda is scored or stolen from this server or its root")', () => {
  // Rules 1.17.6 + 1.17.8: the trigger looks at where the agenda was scored from.
  function score(serverOfAgenda: string) {
    let s = newGame();
    installIceForTest(s, LAMPLIGHTER, 'remote-1');
    const id = installCorpForTest(s, OFFWORLD, serverOfAgenda);
    s.corp.servers[serverOfAgenda].root.find(c => c.instanceId === id)!.advancementCounters = 4;
    s = executeAction(s, { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: id });
    return drive(s);
  }

  it('is trashed when an agenda is scored from its server', () => {
    const s = score('remote-1');
    expect(s.corp.servers['remote-1']?.ice ?? []).toHaveLength(0);
    expect(s.corp.archives.faceUp.map(c => c.cardCode)).toContain(LAMPLIGHTER);
  });

  it('stays when an agenda is scored from another server', () => {
    const s = score('remote-2');
    expect(s.corp.servers['remote-1'].ice).toHaveLength(1);
  });

  it('is trashed when an agenda is stolen from its server', () => {
    const s0 = newGame();
    const l = installIceForTest(s0, LAMPLIGHTER, 'remote-1');
    installCorpForTest(s0, OFFWORLD, 'remote-1');
    startRunnerTurn(s0);
    s0.runner.credits = 10;
    // The Runner pays 3 for the first subroutine, so is not tagged for the second.
    const s = drive(run(s0, 'remote-1'), p => (p.side === 'runner' && p.kind === 'effect_choice' ? pick(p, /pay/i) : undefined));
    expect(s.runner.scoreArea.map(c => c.cardCode)).toContain(OFFWORLD);
    expect(s.corp.servers['remote-1']?.ice.map(c => c.instanceId) ?? []).not.toContain(l);
  });

  // Rules 3.4.3 / 9.1.7: unrezzed ice is inactive, so its trigger does not fire.
  it('stays when unrezzed', () => {
    const s0 = newGame();
    const l = installIceForTest(s0, LAMPLIGHTER, 'remote-1', false);
    installCorpForTest(s0, OFFWORLD, 'remote-1');
    startRunnerTurn(s0);
    const s = drive(run(s0, 'remote-1'));
    expect(s.runner.scoreArea.map(c => c.cardCode)).toContain(OFFWORLD);
    expect(s.corp.servers['remote-1'].ice.map(c => c.instanceId)).toContain(l);
  });
});

describe('Semak-samun ("cannot break the printed subroutine on this ice except using a fracter")', () => {
  // Rules 9.3.3 restriction on how subroutines can be broken; 3.9 icebreaker subtypes.
  function encounter(breakerCode: string) {
    const s0 = newGame();
    installIceForTest(s0, SEMAK_SAMUN, 'hq');
    startRunnerTurn(s0);
    const b = installProgramForTest(s0, breakerCode);
    s0.runner.credits = 20;
    let s = drive(run(s0, 'hq'), undefined, x => x.activeRun?.phase === 'encounter_ice');
    // Match the ice's strength 3.
    for (let i = 0; i < 2 && breakerCode === MAYFLY; i++) s = executeAction(s, { type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: b });
    return { s, b };
  }

  it('an AI breaker at equal strength cannot break it', () => {
    const { s, b } = encounter(MAYFLY);
    expect(isLegalAction(s, { type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: b, subroutineIndices: [0] })).toBe(false);
  });

  it('a fracter can', () => {
    const { s, b } = encounter(CLEAVER);
    expect(isLegalAction(s, { type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: b, subroutineIndices: [0] })).toBe(true);
  });
});

describe('Magdalene Keino-Chemutai ("discard cards to reach your maximum hand size")', () => {
  // Rules 5.5.2 discard phase; 1.19.3: a trashed card is not discarded.
  it('offers to install a program discarded at the end of the turn', () => {
    let s = newGame();
    setIdentity(s, 'runner', MAGDALENE);
    startRunnerTurn(s);
    s.runner.grip = [];
    for (let i = 0; i < 5; i++) giveCard(s, 'runner', SURE_GAMBLE);
    const fly = giveCard(s, 'runner', MAYFLY);
    s.runner.credits = 5;
    s.runner.clicks = 0;
    s = executeAction(s, { type: 'END_TURN', player: 'runner' });
    const p = s.pendingPrompts[0];
    expect(p?.kind).toBe('discard');
    s = executeAction(s, { type: 'RESOLVE_PROMPT', player: 'runner', promptId: p.id, choice: { kind: 'discard', cardInstanceIds: [fly] } });
    const q = s.pendingPrompts[0];
    expect(q?.side).toBe('runner');
    expect(JSON.stringify(q)).toContain(fly);
  });

  it('does not trigger when net damage trashes a program from the grip', () => {
    const s0 = newGame();
    setIdentity(s0, 'runner', MAGDALENE);
    installIceForTest(s0, TITHE, 'hq');
    startRunnerTurn(s0);
    s0.runner.grip = [];
    giveCard(s0, 'runner', MAYFLY);
    giveCard(s0, 'runner', MAYFLY);
    const s = drive(run(s0, 'hq'), p => {
      if (p.side === 'runner' && p.kind !== 'access_trash' && p.kind !== 'access_order') throw new Error(`Runner was asked: ${p.message}`);
      return undefined;
    });
    expect(s.runner.heap.map(c => c.cardCode)).toContain(MAYFLY);
    expect(s.runner.rig.programs).toHaveLength(0);
  });
});

describe('Project Ingatan (Dividends 1)', () => {
  // Rules 10.13 Dividends: 1 agenda counter per excess advancement counter; 1.17.8 last known counters.
  it('scored with 2 excess advancement counters gets 2 agenda counters', () => {
    let s = newGame();
    const id = installCorpForTest(s, INGATAN, 'remote-1');
    s.corp.servers['remote-1'].root[0].advancementCounters = 5;
    s = drive(executeAction(s, { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: id }));
    const scored = s.corp.scoreArea.find(c => c.instanceId === id)!;
    expect(Object.values(scored.tokens).reduce((a, b) => a + b, 0)).toBe(2);
    expect(scored.advancementCounters).toBe(0); // 1.17.5: advancement counters return to the bank
  });

  it('scored with exactly 3 gets none', () => {
    let s = newGame();
    const id = installCorpForTest(s, INGATAN, 'remote-1');
    s.corp.servers['remote-1'].root[0].advancementCounters = 3;
    s = drive(executeAction(s, { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: id }));
    const scored = s.corp.scoreArea.find(c => c.instanceId === id)!;
    expect(Object.values(scored.tokens).reduce((a, b) => a + b, 0)).toBe(0);
  });
});
