import { describe, expect, it } from 'vitest';
import { createCardInstance, executeAction, findCardAnywhere, GameState, iceStrength, isLegalAction } from '../src/core';
import { availableCredits } from '../src/core/engine/cardEffects';
import { iceSubroutines } from '../src/core/engine/ice';
import { dealDamage } from '../src/core/engine/damage';
import {
  answer,
  cont,
  giveCard,
  installCorpForTest,
  installIceForTest,
  installProgramForTest,
  keepGoing,
  newGame,
  passTurn,
  play,
  rezForTest,
  run,
  runnerInstall,
  scoreForTest,
  setIdentity,
  startRunnerTurn,
  useAbility,
} from './helpers';

const V = {
  chainReaction: '36001', takeADive: '36002', tailor: '36003', corsair: '36004', lampades: '36005', hackerspace: '36006',
  nurseHanh: '36007', stickAndPoke: '36008', vic: '36009', kompromat: '36010', sellOut: '36011', tailgate: '36012',
  borrowedGoods: '36013', rotary: '36014', baker: '36015', underdome: '36016', hiram: '36017', aircheck: '36018',
  betaBuild: '36019', methuselah: '36020', touchstone: '36021', readWrite: '36022', sipa: '36023', stowaway: '36024',
  wordOnTheStreet: '36025', paywall: '36052', grubber: '36050', esca: '36038',
};
const SG = {
  cleaver: '30006', leech: '30008', telework: '30027', sureGamble: '30030', mayfly: '30032', palisade: '30072',
  tithe: '30073', hedgeFund: '30075', regolith: '30071', nico: '30037', offworld: '30067', t400: '30031', smartware: '30033',
};

const card = (s: GameState, id: string) => findCardAnywhere(s, id)!;
const choose = (s: GameState, optionId: string) => keepGoing(answer(s, { kind: 'effect_choice', optionId }));
const pick = (s: GameState, ids: string[]) => keepGoing(answer(s, { kind: 'effect_cards', cardInstanceIds: ids }));
const declineAccess = (s: GameState) => keepGoing(answer(s, { kind: 'access_trash', trash: false }));
const prompt = (s: GameState) => s.pendingPrompts[0];
const emptyHQ = (s: GameState) => s.corp.rd.push(...s.corp.hq.splice(0));
/** Gives the Runner a card and plays it (with clicks and credits to spare). */
function playRunner(s: GameState, code: string, clicks = 1): [GameState, string] {
  if (s.activePlayer !== 'runner') startRunnerTurn(s);
  const id = giveCard(s, 'runner', code);
  s.runner.clicks = Math.max(s.runner.clicks, clicks);
  s.runner.credits += 10;
  return [play(s, 'runner', id), id];
}
/** Puts a Runner card (by code) in the rig, bypassing costs. */
function rig(s: GameState, code: string, zone: 'hardware' | 'resources'): string {
  const c = createCardInstance(s, code);
  c.isRezzed = true;
  s.runner.rig[zone].push(c);
  return c.instanceId;
}
/** Declines every access prompt until the breach is over (other prompts are left waiting). */
function finishBreach(s: GameState): GameState {
  for (let i = 0; i < 20 && prompt(s)?.kind === 'access_trash'; i++) s = declineAccess(s);
  return s;
}
/** Answers every pending prompt with "no"/the fewest cards, declining trashes. */
function declineAll(s: GameState): GameState {
  for (let i = 0; i < 20 && s.pendingPrompts.length > 0; i++) {
    const p = prompt(s);
    if (p.kind === 'access_trash') s = declineAccess(s);
    else if (p.kind === 'effect_choice') s = choose(s, p.options.find(o => /^(no|leave|stay|none)$/.test(o.id))?.id ?? p.options[p.options.length - 1].id);
    else if (p.kind === 'effect_cards') s = pick(s, p.candidateIds.slice(0, p.min));
    else break;
  }
  return s;
}

describe('Vantage Point Runner identities', () => {
  it('Virtual Intelligence, P.I. draws 1 and removes 1 tag for a click and a credit, once per turn', () => {
    let s = newGame();
    setIdentity(s, 'runner', V.vic);
    startRunnerTurn(s);
    s.runner.tags = 2;
    const grip = s.runner.grip.length;
    const credits = s.runner.credits;
    s = useAbility(s, 'runner', s.runner.identity.instanceId);
    expect(s.runner.grip.length).toBe(grip + 1);
    expect(s.runner.tags).toBe(1);
    expect(s.runner.credits).toBe(credits - 1);
    expect(isLegalAction(s, { type: 'USE_ABILITY', player: 'runner', cardInstanceId: s.runner.identity.instanceId, abilityIndex: 0 })).toBe(false);
  });

  it('Hiram looks at the top card of R&D when hardware is installed or trashed, hidden from the Corp', () => {
    let s = newGame();
    setIdentity(s, 'runner', V.hiram);
    const top = s.corp.rd[0];
    [s] = runnerInstall(s, SG.t400);
    const lines = () => s.log.filter(l => /Hiram/.test(l.message));
    expect(lines().length).toBe(1);
    expect(lines()[0].cardCode).toBe(top.cardCode);
    expect(lines()[0].secret?.from).toBe('corp');
    // Trashed from the grip by damage counts too
    s.runner.grip = [createCardInstance(s, SG.t400)];
    dealDamage(s, 'net', 1);
    expect(lines().length).toBe(2);
  });
});

describe('Vantage Point Runner events', () => {
  it('Chain Reaction needs successful runs on all three centrals, trashes 2 Corp cards and the Corp trashes 1 Runner card', () => {
    let s = newGame();
    startRunnerTurn(s);
    const id = giveCard(s, 'runner', V.chainReaction);
    s.runner.credits = 5;
    expect(isLegalAction(s, { type: 'PLAY_OPERATION_OR_EVENT', player: 'runner', cardInstanceId: id })).toBe(false);
    s.runsThisTurn = ['hq', 'rd', 'archives'].map(server => ({ server, successful: true }));
    const ice = installIceForTest(s, SG.palisade, 'hq');
    const asset = installCorpForTest(s, SG.regolith, 'remote-1');
    const telework = rig(s, SG.telework, 'resources');
    s = play(s, 'runner', id);
    s = pick(s, [ice, asset]);
    expect(s.corp.archives.faceUp.map(c => c.instanceId)).toEqual(expect.arrayContaining([ice, asset]));
    expect(prompt(s)?.side).toBe('corp');
    s = pick(s, [telework]);
    expect(s.runner.heap.map(c => c.instanceId)).toContain(telework);
  });

  it('Take a Dive gives bad publicity only if a subroutine resolved, then leaves the game', () => {
    let s = newGame();
    emptyHQ(s);
    installIceForTest(s, SG.tithe, 'hq'); // 1 net damage, gain 1
    s.runner.grip.push(...s.runner.stack.splice(0, 5));
    let id: string;
    [s, id] = playRunner(s, V.takeADive);
    s = choose(s, 'hq');
    s = cont(cont(s)); // encounter Tithe, let both subroutines fire
    s = declineAll(cont(s));
    expect(s.corp.badPublicity).toBe(1);
    expect(s.removedFromGame.map(c => c.instanceId)).toContain(id);

    let t = newGame();
    emptyHQ(t);
    [t] = playRunner(t, V.takeADive);
    t = declineAll(cont(choose(t, 'hq')));
    expect(t.corp.badPublicity).toBe(0);
  });

  it('Kompromat: after a successful run the Corp derezzes a piece of ice there or takes 1 bad publicity', () => {
    let s = newGame();
    emptyHQ(s);
    const ice = installIceForTest(s, SG.tithe, 'hq');
    s.runner.grip.push(...s.runner.stack.splice(0, 5));
    let id: string;
    [s, id] = playRunner(s, V.kompromat);
    s = choose(s, 'hq');
    s = cont(cont(s));
    s = cont(s);
    expect(prompt(s)?.side).toBe('corp');
    expect(s.removedFromGame.map(c => c.instanceId)).toContain(id);
    const derezzed = choose(s, ice);
    expect(card(derezzed, ice).isRezzed).toBe(false);
    expect(derezzed.corp.badPublicity).toBe(0);
    const bp = choose(s, 'bp');
    expect(bp.corp.badPublicity).toBe(1);
  });

  it('Kompromat can only be played with a server protected by ice', () => {
    const s = newGame();
    startRunnerTurn(s);
    const id = giveCard(s, 'runner', V.kompromat);
    s.runner.credits = 5;
    expect(isLegalAction(s, { type: 'PLAY_OPERATION_OR_EVENT', player: 'runner', cardInstanceId: id })).toBe(false);
  });

  it('Sell Out trashes a resource as a cost, then gains 4 and draws 2', () => {
    let s = newGame();
    startRunnerTurn(s);
    const id = giveCard(s, 'runner', V.sellOut);
    s.runner.credits = 1;
    expect(isLegalAction(s, { type: 'PLAY_OPERATION_OR_EVENT', player: 'runner', cardInstanceId: id })).toBe(false);
    const telework = rig(s, SG.telework, 'resources');
    const grip = s.runner.grip.length;
    s = play(s, 'runner', id);
    s = pick(s, [telework]);
    expect(s.runner.credits).toBe(4);
    expect(s.runner.grip.length).toBe(grip - 1 + 2);
    expect(s.runner.heap.map(c => c.instanceId)).toContain(telework);
  });

  it('Tailgate costs 1 less for each ice protecting HQ and accesses 2 more cards from HQ', () => {
    let s = newGame();
    installIceForTest(s, SG.palisade, 'hq', false);
    installIceForTest(s, SG.palisade, 'hq', false);
    startRunnerTurn(s);
    const id = giveCard(s, 'runner', V.tailgate);
    s.runner.credits = 1;
    s = play(s, 'runner', id);
    expect(s.runner.credits).toBe(0);
    s = cont(cont(s)); // pass both unrezzed ice
    s = cont(s);
    let accessed = 0;
    for (let i = 0; i < 10 && s.activeRun; i++) {
      if (prompt(s)?.kind === 'access_trash') s = declineAccess(s);
      else if (prompt(s)) s = declineAll(s);
      else s = cont(s);
    }
    accessed = s.log.filter(l => l.event === 'access').length;
    expect(accessed).toBe(3);
  });

  it('Aircheck: only its 4 hosted credits can be spent, then the Runner may run a remote', () => {
    let s = newGame();
    emptyHQ(s);
    installCorpForTest(s, SG.regolith, 'remote-1');
    let id: string;
    [s, id] = playRunner(s, V.aircheck);
    s = choose(s, 'hq');
    expect(card(s, id).tokens.credit).toBe(4);
    expect(s.runner.credits).toBeGreaterThan(4);
    expect(availableCredits(s, 'runner')).toBe(4);
    s = finishBreach(cont(s));
    expect(prompt(s)?.source).toMatchObject({ cardCode: V.aircheck, step: 'remote' });
    s = choose(s, 'remote-1');
    expect(s.activeRun?.server).toBe('remote-1');
    expect(availableCredits(s, 'runner')).toBe(4);
    s = finishBreach(cont(s));
    expect(s.activeRun).toBeNull();
    expect(card(s, id).tokens.credit ?? 0).toBe(0);
  });

  it('Beta Build installs a program from the stack for free and puts it back on top when the run ends', () => {
    let s = newGame();
    emptyHQ(s);
    const cleaver = createCardInstance(s, SG.cleaver);
    s.runner.stack.push(cleaver);
    let id: string;
    [s, id] = playRunner(s, V.betaBuild);
    const credits = s.runner.credits;
    s = pick(s, [cleaver.instanceId]);
    expect(s.runner.rig.programs.map(c => c.instanceId)).toContain(cleaver.instanceId);
    expect(s.runner.credits).toBe(credits);
    s = choose(s, 'hq');
    s = declineAll(cont(s));
    expect(s.activeRun).toBeNull();
    expect(s.runner.stack[0].instanceId).toBe(cleaver.instanceId);
    expect(s.runner.memoryUnitsUsed).toBe(0);
    expect(id).toBeTruthy();
  });
});

describe('Vantage Point Runner hardware', () => {
  it('The Tungsten Tailor lowers ice strength (even below 0) and pays 1 the first time a subroutine on 0-strength ice is broken', () => {
    let s = newGame();
    rig(s, V.tailor, 'hardware');
    const paywall = installIceForTest(s, V.paywall, 'remote-1'); // strength 1
    expect(iceStrength(s, card(s, paywall))).toBe(0);
    const tithe = installIceForTest(s, SG.tithe, 'remote-2');
    expect(iceStrength(s, card(s, tithe))).toBe(0);
    const cleaverId = installProgramForTest(s, SG.cleaver);
    s = run(s, 'remote-1');
    s.runner.credits = 5;
    s = cont(s); // encounter Paywall (loses 1)
    const credits = s.runner.credits;
    s = executeAction(s, { type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: cleaverId, subroutineIndices: [0] });
    expect(s.runner.credits).toBe(credits - 1 + 1);
  });

  it('Borrowed Goods gives +1 MU and a tag only if the Runner is not tagged', () => {
    let s = newGame();
    [s] = runnerInstall(s, V.borrowedGoods);
    expect(s.runner.tags).toBe(1);
    expect(s.runner.memoryUnitsTotal).toBe(5);
    [s] = runnerInstall(s, V.borrowedGoods);
    expect(s.runner.tags).toBe(1);
  });

  it('Rotary: take a tag to access 1 more card from HQ; the Corp can trash it while the Runner is tagged', () => {
    let s = newGame();
    emptyHQ(s);
    s.corp.hq.push(createCardInstance(s, SG.hedgeFund), createCardInstance(s, SG.hedgeFund));
    let rotary: string;
    [s, rotary] = runnerInstall(s, V.rotary);
    s = cont(run(s, 'hq'));
    expect(prompt(s)?.source).toMatchObject({ cardCode: V.rotary });
    s = choose(s, 'tag');
    expect(s.runner.tags).toBe(1);
    s = declineAll(s);
    expect(s.log.filter(l => l.event === 'access').length).toBe(2);
    // The Corp: click, 2 credits, only while the Runner is tagged
    s.activePlayer = 'corp';
    s.phase = 'corp_turn';
    s.corp.clicks = 1;
    s.corp.credits = 2;
    const use = { type: 'USE_ABILITY' as const, player: 'corp' as const, cardInstanceId: rotary, abilityIndex: 0 };
    expect(isLegalAction(s, use)).toBe(true);
    expect(isLegalAction(s, { ...use, player: 'runner' })).toBe(false);
    s = executeAction(s, use);
    expect(s.runner.heap.map(c => c.instanceId)).toContain(rotary);
  });

  it('Methuselah turns a hardware card from the grip into 2 credits it can spend during runs', () => {
    let s = newGame();
    const meth = rig(s, V.methuselah, 'hardware');
    const t400 = giveCard(s, 'runner', SG.t400);
    s.runner.credits = 0;
    s = run(s, 'archives');
    expect(prompt(s)?.source).toMatchObject({ cardCode: V.methuselah });
    s = pick(s, [t400]);
    expect(card(s, meth).tokens.credit).toBe(2);
    expect(availableCredits(s, 'runner')).toBe(2);
    s = declineAll(cont(s));
    expect(availableCredits(s, 'runner')).toBe(0); // only during runs
  });

  it('Touchstone gets 1 credit the first time each turn the Runner plays an event', () => {
    let s = newGame();
    const touch = rig(s, V.touchstone, 'hardware');
    [s] = playRunner(s, SG.sureGamble);
    [s] = playRunner(s, SG.sureGamble);
    expect(card(s, touch).tokens.credit).toBe(1);
  });
});

describe('Vantage Point Runner programs', () => {
  it('Corsair breaks a barrier once its stealth ability lowers the barrier\'s strength', () => {
    let s = newGame();
    const touch = rig(s, V.touchstone, 'hardware');
    card(s, touch).tokens.credit = 1;
    const corsair = installProgramForTest(s, V.corsair);
    installIceForTest(s, V.paywall, 'remote-1');
    s = run(s, 'remote-1');
    s.runner.credits = 5;
    s = cont(s);
    const brk = { type: 'BREAK_SUBROUTINE' as const, player: 'runner' as const, breakerInstanceId: corsair, subroutineIndices: [0] };
    expect(isLegalAction(s, brk)).toBe(false); // strength 0 vs 1
    expect(isLegalAction(s, { type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: corsair })).toBe(false);
    const credits = s.runner.credits;
    s = useAbility(s, 'runner', corsair);
    expect(card(s, touch).tokens.credit).toBe(0); // paid with stealth credits, not the pool
    expect(s.runner.credits).toBe(credits);
    s = executeAction(s, brk);
    expect(s.activeRun?.encounter?.broken).toEqual([true]);
  });

  it('Corsair\'s strength ability cannot be paid from the credit pool', () => {
    let s = newGame();
    const corsair = installProgramForTest(s, V.corsair);
    installIceForTest(s, V.paywall, 'remote-1');
    s = run(s, 'remote-1');
    s.runner.credits = 5;
    s = cont(s);
    expect(isLegalAction(s, { type: 'USE_ABILITY', player: 'runner', cardInstanceId: corsair, abilityIndex: 0 })).toBe(false);
  });

  it('Lampades spends a power counter and the printed cost in stealth credits to trash an accessed card', () => {
    let s = newGame();
    const meth = rig(s, V.touchstone, 'hardware');
    card(s, meth).tokens.credit = 3;
    let lamp: string;
    [s, lamp] = runnerInstall(s, V.lampades);
    expect(card(s, lamp).tokens.power).toBe(3);
    const nico = installCorpForTest(s, SG.nico, 'remote-1'); // printed rez cost 2
    s.runner.credits = 0;
    s = cont(run(s, 'remote-1'));
    expect(prompt(s)).toMatchObject({ kind: 'access_trash' });
    const p = prompt(s) as { alternatives?: { id: string }[] };
    expect(p.alternatives?.map(a => a.id)).toContain(lamp);
    s = keepGoing(answer(s, { kind: 'access_trash', trash: false, alternativeId: lamp }));
    expect(s.corp.archives.faceUp.map(c => c.instanceId)).toContain(nico);
    expect(card(s, lamp).tokens.power).toBe(2);
    expect(card(s, meth).tokens.credit).toBe(1);
  });

  it('Baker runs Archives and may pay 1 stealth credit to approach R&D instead', () => {
    let s = newGame();
    const touch = rig(s, V.touchstone, 'hardware');
    card(s, touch).tokens.credit = 1;
    let baker: string;
    [s, baker] = runnerInstall(s, V.baker);
    s.runner.clicks = 2;
    s = useAbility(s, 'runner', baker);
    expect(s.activeRun?.server).toBe('archives');
    s = cont(s);
    expect(prompt(s)?.source).toMatchObject({ cardCode: V.baker });
    s = choose(s, 'rd');
    expect(card(s, touch).tokens.credit).toBe(0);
    expect(s.log.some(l => /attacked server changed to R&D/.test(l.message))).toBe(true);
    s = declineAll(s);
    expect(s.runsThisTurn[0]).toMatchObject({ server: 'rd', successful: true });
    expect(isLegalAction(s, { type: 'USE_ABILITY', player: 'runner', cardInstanceId: baker, abilityIndex: 0 })).toBe(false);
  });

  it('Read-Write Share hosts a card from the grip facedown to draw, and shuffles them back when trashed', () => {
    let s = newGame();
    startRunnerTurn(s);
    const first = s.runner.grip[0].instanceId;
    let rws: string;
    [s, rws] = runnerInstall(s, V.readWrite);
    const grip = s.runner.grip.length;
    s = pick(s, [first]);
    expect(card(s, rws).hostedCards?.map(c => c.instanceId)).toEqual([first]);
    expect(s.runner.grip.length).toBe(grip); // one hosted, one drawn
    const stack = s.runner.stack.length;
    s = useAbility(s, 'runner', rws);
    expect(s.runner.stack.length).toBe(stack + 1);
    expect(s.runner.heap.map(c => c.instanceId)).toContain(rws);
  });

  it('Sipa may swap the outermost ice after the Runner fully broke and passed it', () => {
    let s = newGame();
    const cleaver = installProgramForTest(s, SG.cleaver);
    installProgramForTest(s, V.sipa);
    const outer = installIceForTest(s, V.paywall, 'remote-1');
    const other = installIceForTest(s, SG.tithe, 'hq');
    s = run(s, 'remote-1');
    s.runner.credits = 5;
    s = cont(s);
    s = executeAction(s, { type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: cleaver, subroutineIndices: [0] });
    s = executeAction(s, { type: 'CONTINUE_RUN', player: 'runner' }); // pass it
    expect(prompt(s)?.source).toMatchObject({ cardCode: V.sipa });
    s = answer(s, { kind: 'effect_choice', optionId: other });
    expect(s.corp.servers['remote-1'].ice[0].instanceId).toBe(other);
    expect(s.corp.servers.hq.ice[0].instanceId).toBe(outer);
  });

  it('Stowaway pays 2 for each successful run on its host ice\'s server', () => {
    let s = newGame();
    emptyHQ(s);
    const ice = installIceForTest(s, SG.palisade, 'hq', false);
    [s] = runnerInstall(s, V.stowaway, ice);
    const credits = s.runner.credits;
    s = declineAll(cont(cont(run(s, 'hq'))));
    expect(s.runner.credits).toBe(credits + 2);
  });
});

describe('Vantage Point Runner resources', () => {
  it('Hackerspace hosts unique companions and connections for 1 less and gives +2 hand size with both', () => {
    let s = newGame();
    let host: string;
    [s, host] = runnerInstall(s, V.hackerspace);
    startRunnerTurn(s);
    s.runner.clicks = 2;
    const nurse = giveCard(s, 'runner', V.nurseHanh); // cost 1
    const poke = giveCard(s, 'runner', V.stickAndPoke); // cost 0
    s.runner.credits = 0;
    s = executeAction(s, { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: nurse, hostInstanceId: host });
    s = executeAction(s, { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: poke, hostInstanceId: host });
    expect(card(s, nurse).hostedOnId).toBe(host);
    expect(s.runner.handSizeLimit).toBe(7);
    // Not a unique companion or connection
    const telework = giveCard(s, 'runner', SG.telework);
    s.runner.clicks = 1;
    s.runner.credits = 5;
    expect(isLegalAction(s, { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: telework, hostInstanceId: host })).toBe(false);
  });

  it('Nurse Hạnh draws 2 when 2 or more facedown cards in Archives turn faceup', () => {
    let s = newGame();
    rig(s, V.nurseHanh, 'resources');
    s.corp.archives.faceDown.push(createCardInstance(s, SG.hedgeFund), createCardInstance(s, SG.hedgeFund));
    const grip = s.runner.grip.length;
    s = cont(run(s, 'archives'));
    expect(s.runner.grip.length).toBe(grip + 2);
  });

  it('Stick and Poke gives the first ice encountered each turn a leading "1 net damage, draw 1" subroutine', () => {
    let s = newGame();
    rig(s, V.stickAndPoke, 'resources');
    const ice = installIceForTest(s, SG.palisade, 'remote-1');
    s.runner.grip.push(...s.runner.stack.splice(0, 3));
    s = run(s, 'remote-1');
    s = executeAction(s, { type: 'CONTINUE_RUN', player: 'runner' }); // encounter
    const subs = iceSubroutines(s, card(s, ice));
    expect(subs.length).toBe(2);
    expect(subs[0].label).toMatch(/1 net damage/);
    const grip = s.runner.grip.length;
    s = executeAction(s, { type: 'CONTINUE_RUN', player: 'runner' }); // subroutines fire
    expect(s.runner.grip.length).toBe(grip - 1 + 1);
    expect(s.activeRun).toBeNull(); // Palisade ended the run
  });

  it('Underdome Irregulars draws 2 if ice was rezzed this turn, and is trashed otherwise', () => {
    let s = newGame();
    const ud = rig(s, V.underdome, 'resources');
    startRunnerTurn(s);
    const ice = installIceForTest(s, SG.palisade, 'hq', false);
    s = run(s, 'hq');
    s = rezForTest(s, ice);
    s = cont(cont(s)); // Palisade ends the run
    const grip = s.runner.grip.length;
    s.runner.clicks = 0;
    s = executeAction(s, { type: 'END_TURN', player: 'runner' });
    expect(s.runner.grip.length).toBe(grip + 2);
    expect(s.runner.rig.resources.map(c => c.instanceId)).toContain(ud);

    let t = newGame();
    const ud2 = rig(t, V.underdome, 'resources');
    startRunnerTurn(t);
    t = passTurn(t);
    expect(t.runner.heap.map(c => c.instanceId)).toContain(ud2);
  });

  it('Word on the Street: scoring an agenda installed this turn puts it in the Corp\'s score area at -1', () => {
    let s = newGame();
    const word = rig(s, V.wordOnTheStreet, 'resources');
    const id = installCorpForTest(s, SG.offworld, 'remote-1');
    const agenda = card(s, id);
    agenda.advancementCounters = 4;
    agenda.installedTurn = `${s.turnNumber}-corp`;
    s = executeAction(s, { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: id });
    expect(s.corp.scoreArea.map(c => c.instanceId)).toContain(word);
    expect(s.corp.score).toBe(2 - 1);
  });

  it('Word on the Street pays 4 and a card when the Corp scores an agenda installed earlier', () => {
    let s = newGame();
    const word = rig(s, V.wordOnTheStreet, 'resources');
    const credits = s.runner.credits;
    const grip = s.runner.grip.length;
    s = scoreForTest(s, SG.offworld);
    expect(s.runner.heap.map(c => c.instanceId)).toContain(word);
    expect(s.runner.credits).toBe(credits + 4);
    expect(s.runner.grip.length).toBe(grip + 1);
    expect(s.corp.score).toBe(2);
  });
});

describe('Bad publicity', () => {
  it('fills the bad publicity fund at the start of each run, for that run only (rules 10.6.3)', () => {
    let s = newGame();
    s.corp.badPublicity = 2;
    s.runner.credits = 1;
    installIceForTest(s, SG.palisade, 'remote-1');
    s = run(s, 'remote-1');
    expect(s.activeRun?.badPublicityCredits).toBe(2);
    expect(availableCredits(s, 'runner')).toBe(3);
    s = cont(cont(s)); // Palisade ends the run
    expect(s.activeRun).toBeNull();
    expect(availableCredits(s, 'runner')).toBe(1);
  });
});
