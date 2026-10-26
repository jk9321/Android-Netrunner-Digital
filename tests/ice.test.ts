import { describe, it, expect } from 'vitest';
import { cardDef, executeAction, getLegalActions, IllegalActionError, GameState, GameAction } from '../src/core';
import { breakerStrength, iceStrength } from '../src/core/engine/ice';
import {
  answer,
  cont,
  keepGoing,
  step,
  giveCard,
  installForTest,
  installIceForTest,
  installProgramForTest,
  newGame,
  runIntoFirstIce,
  startRunnerTurn,
} from './helpers';

const ICE = {
  ansel: '30038', bran: '30039', diviner: '30046', karuna: '30047', funhouse: '30054', ping: '30055',
  ballista: '30062', pharos: '30063', palisade: '30072', tithe: '30073', whitespace: '30074',
};
const BREAKER = {
  buzzsaw: '30005', cleaver: '30006', carmen: '30015', marjanah: '30016', echelon: '30025', unity: '30026', mayfly: '30032',
};
const SURE_GAMBLE = '30030'; // event, cost 5 (odd)
const VRCATION = '30021'; // event, cost 1 (odd)
const CREATIVE_COMMISSION = '30020'; // cost 1

const breakAct = (breakerInstanceId: string, subroutineIndices: number[]): GameAction => ({
  type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId, subroutineIndices,
});
const boost = (breakerInstanceId: string): GameAction => ({ type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId });
const findIce = (s: GameState, id: string) => Object.values(s.corp.servers).flatMap(x => x.ice).find(c => c.instanceId === id)!;

describe('Encounters', () => {
  it('starts an encounter with rezzed ice and lists its subroutines', () => {
    const state = newGame();
    installIceForTest(state, ICE.palisade, 'hq');
    const s = runIntoFirstIce(state, 'hq');
    expect(s.activeRun?.phase).toBe('encounter_ice');
    expect(s.activeRun?.encounter?.broken).toEqual([false]);
  });

  it('unbroken "end the run" ends the run without a breach', () => {
    let s = newGame();
    installIceForTest(s, ICE.palisade, 'hq');
    const hq = s.corp.hq.length;
    s = cont(runIntoFirstIce(s, 'hq'));
    expect(s.activeRun).toBeNull();
    expect(s.corp.hq).toHaveLength(hq);
    expect(s.runsThisTurn[0].successful).toBe(false);
  });

  it('unrezzed ice is passed without an encounter', () => {
    let s = newGame();
    installIceForTest(s, ICE.palisade, 'archives', false);
    s = runIntoFirstIce(s, 'archives');
    expect(s.activeRun?.phase).toBe('approach_server');
    expect(s.activeRun?.icePassed).toBe(1);
  });

  it('jacking out needs at least one passed ice', () => {
    let s = newGame();
    installIceForTest(s, ICE.palisade, 'archives', false);
    startRunnerTurn(s);
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'archives' });
    expect(() => executeAction(s, { type: 'JACK_OUT', player: 'runner' })).toThrow(/after passing/);
    s = step(s); // pass unrezzed ice: the Movement Phase
    s = executeAction(s, { type: 'JACK_OUT', player: 'runner' });
    expect(s.activeRun).toBeNull();
  });

  it('cannot jack out or end the turn mid-encounter', () => {
    const state = newGame();
    installIceForTest(state, ICE.palisade, 'hq');
    const s = runIntoFirstIce(state, 'hq');
    expect(() => executeAction(s, { type: 'JACK_OUT', player: 'runner' })).toThrow(IllegalActionError);
    expect(() => executeAction(s, { type: 'END_TURN', player: 'runner' })).toThrow(IllegalActionError);
  });
});

describe('Ice strength', () => {
  it('Palisade gets +2 on remote servers', () => {
    const s = newGame();
    const central = installIceForTest(s, ICE.palisade, 'hq');
    const remote = installIceForTest(s, ICE.palisade, 'remote-9');
    expect(iceStrength(s, findIce(s, central))).toBe(2);
    expect(iceStrength(s, findIce(s, remote))).toBe(4);
  });

  it('Pharos gets +5 with 3 or more advancement counters', () => {
    const s = newGame();
    const id = installIceForTest(s, ICE.pharos, 'hq');
    expect(iceStrength(s, findIce(s, id))).toBe(5);
    findIce(s, id).advancementCounters = 3;
    expect(iceStrength(s, findIce(s, id))).toBe(10);
  });
});

describe('Breaking subroutines', () => {
  it('Cleaver breaks Palisade and the run reaches the server', () => {
    let s = newGame();
    installIceForTest(s, ICE.palisade, 'hq');
    const cleaver = installProgramForTest(s, BREAKER.cleaver);
    s = runIntoFirstIce(s, 'hq');
    s = executeAction(s, breakAct(cleaver, [0]));
    expect(s.runner.credits).toBe(4);
    s = cont(s);
    expect(s.activeRun?.phase).toBe('approach_server');
  });

  it('needs enough strength, and boosts last only for the encounter', () => {
    let s = newGame();
    installIceForTest(s, ICE.pharos, 'hq');
    const cleaver = installProgramForTest(s, BREAKER.cleaver);
    s.runner.credits = 10;
    s = runIntoFirstIce(s, 'hq');
    expect(() => executeAction(s, breakAct(cleaver, [0]))).toThrow(/needs strength 5/);
    s = executeAction(s, boost(cleaver));
    s = executeAction(s, boost(cleaver));
    expect(breakerStrength(s, s.runner.rig.programs[0])).toBe(5);
    s = executeAction(s, breakAct(cleaver, [0, 1]));
    s = executeAction(s, breakAct(cleaver, [2]));
    expect(s.runner.credits).toBe(10 - 4 - 2);
    s = cont(s);
    expect(s.activeRun?.phase).toBe('approach_server');
    expect(breakerStrength(s, s.runner.rig.programs[0])).toBe(3);
  });

  it('breaks only matching ice subtypes, up to the breaker limit', () => {
    let s = newGame();
    installIceForTest(s, ICE.whitespace, 'hq');
    const cleaver = installProgramForTest(s, BREAKER.cleaver);
    const unity = installProgramForTest(s, BREAKER.unity);
    s = runIntoFirstIce(s, 'hq');
    expect(() => executeAction(s, breakAct(cleaver, [0]))).toThrow(/barrier/);
    expect(() => executeAction(s, breakAct(unity, [0, 1]))).toThrow(/per use/);
    s = executeAction(s, breakAct(unity, [0]));
    expect(() => executeAction(s, breakAct(unity, [0]))).toThrow(/already broken/);
  });

  it('Mayfly breaks anything and is trashed when the run ends', () => {
    let s = newGame();
    installIceForTest(s, ICE.palisade, 'hq');
    const mayfly = installProgramForTest(s, BREAKER.mayfly);
    s = runIntoFirstIce(s, 'hq');
    s = executeAction(s, boost(mayfly)); // Palisade is strength 2
    s = executeAction(s, breakAct(mayfly, [0]));
    s = cont(cont(s)); // pass ice, breach HQ
    expect(s.activeRun).toBeNull();
    expect(s.runner.rig.programs).toHaveLength(0);
    expect(s.runner.heap.map(c => c.instanceId)).toContain(mayfly);
    expect(s.runner.memoryUnitsUsed).toBe(0);
  });

  it('Echelon gains strength per icebreaker; Unity boosts by the icebreaker count', () => {
    let s = newGame();
    const echelon = installProgramForTest(s, BREAKER.echelon);
    installProgramForTest(s, BREAKER.cleaver);
    const unity = installProgramForTest(s, BREAKER.unity);
    const prog = (id: string) => s.runner.rig.programs.find(c => c.instanceId === id)!;
    expect(breakerStrength(s, prog(echelon))).toBe(3);
    installIceForTest(s, ICE.whitespace, 'hq');
    s = runIntoFirstIce(s, 'hq');
    s = executeAction(s, boost(unity));
    expect(breakerStrength(s, prog(unity))).toBe(1 + 3);
  });

  it('Marjanah costs 1 less after a successful run; Carmen installs for 2 less', () => {
    let s = newGame();
    s.corp.servers.archives.ice = [];
    installIceForTest(s, ICE.palisade, 'hq');
    const marjanah = installProgramForTest(s, BREAKER.marjanah);
    startRunnerTurn(s);
    s.runner.credits = 20;
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'archives' });
    s = cont(keepGoing(s)); // successful run on empty Archives
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    s = cont(s);
    s = executeAction(s, boost(marjanah)); // 1 -> 2 strength
    const before = s.runner.credits;
    s = executeAction(s, breakAct(marjanah, [0]));
    expect(before - s.runner.credits).toBe(1);
    s = cont(cont(s));

    const carmen = giveCard(s, 'runner', BREAKER.carmen);
    const credits = s.runner.credits;
    s = executeAction(s, { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: carmen });
    expect(credits - s.runner.credits).toBe(5 - 2);
  });

  it('lists every legal break option, and each one executes', () => {
    let s = newGame();
    installIceForTest(s, ICE.pharos, 'hq');
    installProgramForTest(s, BREAKER.mayfly);
    s.runner.credits = 20;
    s = runIntoFirstIce(s, 'hq');
    s = executeAction(s, boost(s.runner.rig.programs[0].instanceId));
    s = executeAction(s, boost(s.runner.rig.programs[0].instanceId));
    s = executeAction(s, boost(s.runner.rig.programs[0].instanceId));
    s = executeAction(s, boost(s.runner.rig.programs[0].instanceId)); // Mayfly 5 vs Pharos 5
    const legal = getLegalActions(s, 'runner');
    expect(legal.filter(a => a.type === 'BREAK_SUBROUTINE')).toHaveLength(3);
    for (const a of legal) expect(() => executeAction(s, a)).not.toThrow();
  });
});

describe('Bioroid ice', () => {
  it('the Runner can lose clicks to break Brân 1.0 subroutines', () => {
    let s = newGame();
    installIceForTest(s, ICE.bran, 'hq');
    s = runIntoFirstIce(s, 'hq'); // 3 clicks left
    s = executeAction(s, { type: 'BIOROID_BREAK', player: 'runner', subroutineIndex: 1 });
    s = executeAction(s, { type: 'BIOROID_BREAK', player: 'runner', subroutineIndex: 2 });
    expect(s.runner.clicks).toBe(1);
    s.corp.hq = s.corp.hq.filter(c => cardDef(c).type_code !== 'ice'); // nothing to install
    s.corp.archives.faceDown = [];
    s = cont(s);
    expect(s.activeRun?.phase).toBe('approach_server');
  });

  it('Brân 1.0 installs ice inward, which the Runner then approaches', () => {
    let s = newGame();
    installIceForTest(s, ICE.bran, 'hq');
    const tithe = giveCard(s, 'corp', ICE.tithe);
    s = runIntoFirstIce(s, 'hq');
    s = executeAction(s, { type: 'BIOROID_BREAK', player: 'runner', subroutineIndex: 1 });
    s = executeAction(s, { type: 'BIOROID_BREAK', player: 'runner', subroutineIndex: 2 });
    s = cont(s);
    expect(s.pendingPrompts[0]).toMatchObject({ kind: 'effect_cards', side: 'corp', min: 0, max: 1 });
    s = answer(s, { kind: 'effect_cards', cardInstanceIds: [tithe] });
    expect(s.corp.servers.hq.ice.map(c => c.cardCode)).toEqual([ICE.tithe, ICE.bran]);
    expect(s.corp.credits).toBe(5); // ignoring all costs
    // Brân's other subroutines were broken: the Runner passes Brân, then approaches the new ice inward
    expect(s.activeRun?.phase).toBe('movement');
    s = step(s);
    expect(s.activeRun?.phase).toBe('approach_ice');
    expect(s.activeRun?.icePosition).toBe(0);
  });
});

describe('Subroutine effects', () => {
  it('Whitespace: lose 3, then end the run at 6 credits or less', () => {
    let s = newGame();
    installIceForTest(s, ICE.whitespace, 'hq');
    s = runIntoFirstIce(s, 'hq');
    s.runner.credits = 8;
    s = cont(s);
    expect(s.runner.credits).toBe(5);
    expect(s.activeRun).toBeNull();
  });

  it('Tithe: 1 net damage and the Corp gains 1', () => {
    let s = newGame();
    installIceForTest(s, ICE.tithe, 'hq');
    s = runIntoFirstIce(s, 'hq');
    const grip = s.runner.grip.length;
    s = cont(s);
    expect(s.runner.grip).toHaveLength(grip - 1);
    expect(s.runner.heap).toHaveLength(1);
    expect(s.corp.credits).toBe(6);
    expect(s.activeRun?.phase).toBe('approach_server');
  });

  it('net damage beyond the grip flatlines the Runner', () => {
    let s = newGame();
    installIceForTest(s, ICE.karuna, 'hq');
    s = runIntoFirstIce(s, 'hq');
    s.runner.grip = s.runner.grip.slice(0, 1);
    s = cont(s);
    expect(s.winner).toBe('corp');
    expect(s.winReason).toMatch(/flatlined/);
  });

  it('Karunā lets the Runner jack out between subroutines', () => {
    let s = newGame();
    installIceForTest(s, ICE.karuna, 'hq');
    s = cont(runIntoFirstIce(s, 'hq'));
    expect(s.pendingPrompts[0]).toMatchObject({ kind: 'effect_choice', side: 'runner' });
    const stayed = answer(s, { kind: 'effect_choice', optionId: 'stay' });
    expect(stayed.runner.heap).toHaveLength(4);
    expect(stayed.activeRun?.phase).toBe('movement');
    const jacked = answer(s, { kind: 'effect_choice', optionId: 'jack' });
    expect(jacked.runner.heap).toHaveLength(2);
    expect(jacked.activeRun).toBeNull();
  });

  it('Diviner ends the run when the trashed card has an odd cost', () => {
    const run = (code: string) => {
      let s = newGame();
      installIceForTest(s, ICE.diviner, 'hq');
      s = runIntoFirstIce(s, 'hq');
      s.runner.grip = [];
      giveCard(s, 'runner', code);
      giveCard(s, 'runner', code);
      return cont(s);
    };
    expect(run(SURE_GAMBLE).activeRun).toBeNull(); // cost 5
    expect(run(BREAKER.marjanah).activeRun?.phase).toBe('approach_server'); // cost 0
    void VRCATION;
    void CREATIVE_COMMISSION;
  });

  it('Funhouse: on encounter take a tag or end the run; subroutine is pay 4 or tag', () => {
    let s = newGame();
    installIceForTest(s, ICE.funhouse, 'hq');
    s = runIntoFirstIce(s, 'hq');
    const ended = answer(s, { kind: 'effect_choice', optionId: 'end' });
    expect(ended.activeRun).toBeNull();

    s = answer(s, { kind: 'effect_choice', optionId: 'tag' });
    expect(s.runner.tags).toBe(1);
    s = cont(s);
    s = answer(s, { kind: 'effect_choice', optionId: 'pay' });
    expect(s.runner.credits).toBe(1);
    expect(s.runner.tags).toBe(1);
    expect(s.activeRun?.phase).toBe('movement');
  });

  it('Ping gives a tag when rezzed during a run on its server', () => {
    let s = newGame();
    const ping = installIceForTest(s, ICE.ping, 'hq', false);
    startRunnerTurn(s);
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    s = executeAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: ping });
    expect(s.runner.tags).toBe(1);
  });

  it('Ballista: the Corp trashes a program, or ends the run if there are none', () => {
    let s = newGame();
    installIceForTest(s, ICE.ballista, 'hq');
    const cleaver = installProgramForTest(s, BREAKER.cleaver);
    s = cont(runIntoFirstIce(s, 'hq'));
    expect(s.pendingPrompts[0]).toMatchObject({ kind: 'effect_choice', side: 'corp' });
    s = answer(s, { kind: 'effect_choice', optionId: cleaver });
    expect(s.runner.rig.programs).toHaveLength(0);
    expect(s.runner.memoryUnitsUsed).toBe(0);
    expect(s.activeRun?.phase).toBe('movement');

    let empty = newGame();
    installIceForTest(empty, ICE.ballista, 'hq');
    empty = cont(runIntoFirstIce(empty, 'hq'));
    expect(empty.activeRun).toBeNull();
  });

  it('Ansel 1.0: trash a Runner card, optional install, and no stealing this run', () => {
    let s = newGame();
    installIceForTest(s, ICE.ansel, 'remote-9');
    const agenda = installForTest(s, 'agenda', 'remote-9');
    const cleaver = installProgramForTest(s, BREAKER.cleaver);
    s = cont(runIntoFirstIce(s, 'remote-9'));
    s = answer(s, { kind: 'effect_cards', cardInstanceIds: [cleaver] });
    expect(s.runner.rig.programs).toHaveLength(0);
    s = answer(s, { kind: 'effect_cards', cardInstanceIds: [] }); // decline install
    expect(s.activeRun?.cannotStealOrTrash).toBe(true);
    s = cont(s); // breach
    expect(s.runner.scoreArea).toHaveLength(0);
    expect(s.corp.servers['remote-9'].root.map(c => c.instanceId)).toEqual([agenda]);
  });

  it('Ansel 1.0 can install a card from HQ into a chosen server', () => {
    let s = newGame();
    installIceForTest(s, ICE.ansel, 'hq');
    const ice = giveCard(s, 'corp', ICE.tithe);
    s = cont(runIntoFirstIce(s, 'hq')); // no Runner cards to trash
    s = answer(s, { kind: 'effect_cards', cardInstanceIds: [ice] });
    s = answer(s, { kind: 'effect_choice', optionId: 'rd' });
    expect(s.corp.servers.rd.ice.map(c => c.instanceId)).toEqual([ice]);
  });
});
