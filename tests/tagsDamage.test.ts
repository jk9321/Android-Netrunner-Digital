import { describe, expect, it } from 'vitest';
import { executeAction, findCardAnywhere, GameState, getLegalActions, isLegalAction, virusCountersInPlay } from '../src/core';
import { dealCoreDamage, dealMeatDamage } from '../src/core/engine/damage';
import {
  answer,
  cont,
  giveCard,
  installCorpForTest,
  newGame,
  passTurn,
  play,
  rezForTest,
  run,
  runnerInstall,
  scoreForTest,
  startRunnerTurn,
} from './helpers';

const C = {
  urtica: '30045', clearinghouse: '30061', orbital: '30068', offworld: '30067', neurospike: '30049',
  publicTrail: '30057', retribution: '30065', fermenter: '30007', telework: '30027', t400: '30031',
};

const choose = (s: GameState, optionId: string) => answer(s, { kind: 'effect_choice', optionId });

describe('Tags', () => {
  it('the Runner can pay [click] + 2 credits to remove a tag', () => {
    const s = newGame();
    startRunnerTurn(s);
    expect(isLegalAction(s, { type: 'REMOVE_TAG', player: 'runner' })).toBe(false);
    s.runner.tags = 2;
    s.runner.credits = 2;
    const next = executeAction(s, { type: 'REMOVE_TAG', player: 'runner' });
    expect(next.runner.tags).toBe(1);
    expect(next.runner.credits).toBe(0);
    expect(next.runner.clicks).toBe(3);
  });

  it('the Corp can trash a resource for [click] + 2 credits only while the Runner is tagged', () => {
    let [s, res] = runnerInstall(newGame(), C.telework);
    s = passTurn(s); // back to the Corp
    expect(isLegalAction(s, { type: 'TRASH_RESOURCE', player: 'corp', cardInstanceId: res })).toBe(false);
    s.runner.tags = 1;
    s.corp.credits = 2;
    s = executeAction(s, { type: 'TRASH_RESOURCE', player: 'corp', cardInstanceId: res });
    expect(s.runner.heap.map(c => c.instanceId)).toContain(res);
    expect(s.corp.credits).toBe(0);
  });

  it('the 2-credit tag actions are neither offered nor allowed with only 1 credit', () => {
    let [s, res] = runnerInstall(newGame(), C.telework);
    s = passTurn(s);
    s.runner.tags = 1;
    s.corp.credits = 1;
    const trash = { type: 'TRASH_RESOURCE', player: 'corp', cardInstanceId: res } as const;
    expect(getLegalActions(s, 'corp').some(a => a.type === 'TRASH_RESOURCE')).toBe(false);
    expect(() => executeAction(s, trash)).toThrow(/2 credits/);

    const r = newGame();
    startRunnerTurn(r);
    r.runner.tags = 1;
    r.runner.credits = 1;
    expect(getLegalActions(r, 'runner').some(a => a.type === 'REMOVE_TAG')).toBe(false);
    expect(() => executeAction(r, { type: 'REMOVE_TAG', player: 'runner' })).toThrow(/2 credits/);
  });
});

describe('Damage', () => {
  it('meat damage trashes random cards and flatlines on an empty grip', () => {
    const s = newGame();
    s.runner.grip = s.runner.grip.slice(0, 2);
    dealMeatDamage(s, 2);
    expect(s.runner.grip).toHaveLength(0);
    expect(s.winner).toBeNull();
    dealMeatDamage(s, 1);
    expect(s.winner).toBe('corp');
  });

  it('core damage lowers maximum hand size; below 0 at the discard step flatlines', () => {
    let s = newGame();
    startRunnerTurn(s);
    dealCoreDamage(s, 1);
    s = executeAction(s, { type: 'GAIN_CREDIT', player: 'runner' });
    expect(s.runner.handSizeLimit).toBe(4);
    s.runner.coreDamage = 6;
    s.runner.grip = [];
    s.runner.clicks = 0;
    s = executeAction(s, { type: 'END_TURN', player: 'runner' });
    expect(s.winner).toBe('corp');
  });
});

describe('Purge', () => {
  it('purging costs 3 clicks and removes every virus counter', () => {
    let [s, id] = runnerInstall(newGame(), C.fermenter);
    s = passTurn(s);
    expect(findCardAnywhere(s, id)!.tokens.virus).toBe(1);
    expect(virusCountersInPlay(s)).toBe(1);
    s.corp.clicks = 3;
    s = executeAction(s, { type: 'PURGE_VIRUS', player: 'corp' });
    expect(findCardAnywhere(s, id)!.tokens.virus).toBe(0);
    expect(virusCountersInPlay(s)).toBe(0);
    expect(s.corp.clicks).toBe(0);
  });

  it('purging with no virus counters is still legal (rule 10.1.2); the UI only asks to confirm', () => {
    const s = newGame();
    s.corp.clicks = 3;
    expect(virusCountersInPlay(s)).toBe(0);
    expect(isLegalAction(s, { type: 'PURGE_VIRUS', player: 'corp' })).toBe(true);
  });
});

describe('Tag and damage cards', () => {
  it('Urtica Cipher does 2 net damage plus 1 per advancement counter when accessed, even unrezzed', () => {
    let s = newGame();
    const id = installCorpForTest(s, C.urtica, 'remote-1');
    findCardAnywhere(s, id)!.advancementCounters = 1;
    const grip = s.runner.grip.length;
    s = cont(run(s, 'remote-1'));
    expect(s.runner.grip.length).toBe(grip - 3);
  });

  it('Clearinghouse may be trashed at the start of the Corp turn for meat damage', () => {
    let s = newGame();
    const id = installCorpForTest(s, C.clearinghouse, 'remote-1');
    s = rezForTest(s, id);
    findCardAnywhere(s, id)!.advancementCounters = 2;
    s = passTurn(passTurn(s));
    const grip = s.runner.grip.length;
    s = choose(s, 'yes');
    expect(s.runner.grip.length).toBe(grip - 2);
    expect(s.corp.archives.faceUp.map(c => c.instanceId)).toContain(id);
  });

  it('Orbital Superiority tags an untagged Runner, and does 4 meat damage to a tagged one', () => {
    let s = newGame();
    s = scoreForTest(s, C.orbital);
    expect(s.runner.tags).toBe(1);
    const grip = s.runner.grip.length;
    s = scoreForTest(s, C.orbital, 'remote-2');
    expect(s.runner.grip.length).toBe(Math.max(0, grip - 4));
  });

  it('Neurospike does net damage equal to agenda points scored this turn', () => {
    let s = newGame();
    s = scoreForTest(s, C.offworld);
    s.corp.credits = 3;
    s.corp.clicks = 1;
    const grip = s.runner.grip.length;
    s = play(s, 'corp', giveCard(s, 'corp', C.neurospike));
    expect(s.runner.grip.length).toBe(grip - 2);
  });

  it('Public Trail needs a successful run last turn, then tags unless the Runner pays 8', () => {
    let s = newGame();
    s.corp.credits = 10;
    expect(() => play(s, 'corp', giveCard(s, 'corp', C.publicTrail))).toThrow(/successful run/);
    s = passTurn(s);
    s.corp.hq.splice(0); // nothing to access, so the run just succeeds
    s = cont(run(s, 'hq'));
    s = passTurn(s);
    s.runner.credits = 8;
    s = play(s, 'corp', giveCard(s, 'corp', C.publicTrail));
    s = choose(s, 'pay');
    expect(s.runner.credits).toBe(0);
    expect(s.runner.tags).toBe(0);
  });

  it('Retribution trashes a program or hardware while the Runner is tagged', () => {
    let [s, hw] = runnerInstall(newGame(), C.t400);
    s = passTurn(s);
    s.corp.credits = 1;
    const ret = giveCard(s, 'corp', C.retribution);
    expect(() => play(s, 'corp', ret)).toThrow(/tagged/);
    s.runner.tags = 1;
    s = play(s, 'corp', ret);
    s = answer(s, { kind: 'effect_cards', cardInstanceIds: [hw] });
    expect(s.runner.heap.map(c => c.instanceId)).toContain(hw);
    expect(s.runner.memoryUnitsTotal).toBe(4);
  });
});
