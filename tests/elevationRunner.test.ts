import { describe, expect, it } from 'vitest';
import { cardDef, createCardInstance, executeAction, findCardAnywhere, GameState, iceStrength, isLegalAction, breakerStrength } from '../src/core';
import { availableCredits } from '../src/core/engine/cardEffects';
import {
  answer,
  cont,
  giveCard,
  installCorpForTest,
  installIceForTest,
  installProgramForTest,
  newGame,
  passTurn,
  play,
  rezForTest,
  run,
  runnerInstall,
  setIdentity,
  startRunnerTurn,
  useAbility,
} from './helpers';

const E = {
  ryo: '35001', topan: '35002', charm: '35003', scrounge: '35004', shred: '35005', bling: '35006', gourmand: '35007',
  hantu: '35008', risingTide: '35009', cacophony: '35010', rentRioters: '35011', baz: '35012', muslihat: '35013',
  cleanGetaway: '35014', lieLow: '35015', maintenance: '35016', transfer: '35017', detente: '35018', maglectric: '35019',
  sangKancil: '35020', fransofia: '35021', openMarket: '35022', dewi: '35023', magdalene: '35024', illumination: '35025',
  ritual: '35026', gamedragon: '35027', madani: '35028', azimat: '35029', chromatophores: '35030', devadatta: '35031',
  principia: '35032', knickknack: '35033', sideHustle: '35034',
};
const SG = {
  cleaver: '30006', leech: '30008', telework: '30027', jailbreak: '30028', sureGamble: '30030', mayfly: '30032',
  palisade: '30072', tithe: '30073', whitespace: '30074', regolith: '30071', hedgeFund: '30075', ping: '30055',
  karuna: '30047', unity: '30026', echelon: '30025', smartware: '30033', funhouse: '30054',
};

const card = (s: GameState, id: string) => findCardAnywhere(s, id)!;
const tokens = (s: GameState, id: string, t: string) => card(s, id).tokens[t] ?? 0;
const choose = (s: GameState, optionId: string) => answer(s, { kind: 'effect_choice', optionId });
const pick = (s: GameState, ids: string[]) => answer(s, { kind: 'effect_cards', cardInstanceIds: ids });
const declineAccess = (s: GameState) => answer(s, { kind: 'access_trash', trash: false });
const prompt = (s: GameState) => s.pendingPrompts[0];
/** Moves every HQ card to R&D so breaches of HQ are predictable. */
const emptyHQ = (s: GameState) => s.corp.rd.push(...s.corp.hq.splice(0));
/** Plays a card from the grip with enough clicks and credits (test shorthand). */
function playRunner(s: GameState, code: string, clicks = 1): [GameState, string] {
  if (s.activePlayer !== 'runner') startRunnerTurn(s);
  const id = giveCard(s, 'runner', code);
  s.runner.clicks = Math.max(s.runner.clicks, clicks);
  s.runner.credits += 10;
  return [play(s, 'runner', id), id];
}
/** Answers every prompt with its first option / fewest cards until none is pending or a different side must answer. */
function declineAll(s: GameState): GameState {
  for (let i = 0; i < 20 && s.pendingPrompts.length > 0; i++) {
    const p = prompt(s);
    if (p.kind === 'access_trash') s = declineAccess(s);
    else if (p.kind === 'effect_choice') s = choose(s, p.options.find(o => /^(no|leave|stay)$/.test(o.id))?.id ?? p.options[p.options.length - 1].id);
    else if (p.kind === 'effect_cards') s = pick(s, p.candidateIds.slice(0, p.min));
    else break;
  }
  return s;
}

describe('Elevation Runner identities', () => {
  it('Ryō gains 1 and makes the Corp trash from HQ after a subroutine resolved during a successful run', () => {
    let s = newGame();
    setIdentity(s, 'runner', E.ryo);
    installIceForTest(s, SG.tithe, 'hq'); // do 1 net damage / gain 1
    s.runner.grip.push(...s.runner.stack.splice(0, 5));
    s = cont(cont(run(s, 'hq'))); // approach, encounter, let both subs fire
    expect(s.activeRun?.subroutineResolved).toBe(true);
    const credits = s.runner.credits;
    const hqBefore = s.corp.hq.length;
    s = cont(s); // approach server -> successful
    expect(s.runner.credits).toBe(credits + 1);
    expect(prompt(s)?.side).toBe('corp');
    s = pick(s, [prompt(s).kind === 'effect_cards' ? (prompt(s) as { candidateIds: string[] }).candidateIds[0] : '']);
    expect(s.corp.hq.length).toBe(hqBefore - 1);
  });

  it('Topan installs from the grip for 2 less once per turn, then deals 1 meat damage to the Runner', () => {
    let s = newGame();
    setIdentity(s, 'runner', E.topan);
    startRunnerTurn(s);
    const telework = giveCard(s, 'runner', SG.telework); // cost 1
    s.runner.credits = 0;
    const grip = s.runner.grip.length;
    s = useAbility(s, 'runner', s.runner.identity.instanceId);
    s = pick(s, [telework]);
    expect(s.runner.rig.resources.map(c => c.instanceId)).toContain(telework);
    expect(s.runner.grip.length).toBe(grip - 2); // installed one, lost one to meat damage
    expect(isLegalAction(s, { type: 'USE_ABILITY', player: 'runner', cardInstanceId: s.runner.identity.instanceId, abilityIndex: 0 })).toBe(false);
  });

  it('Baz Wong may install a resource when the Corp rezzes ice', () => {
    let s = newGame();
    setIdentity(s, 'runner', E.baz);
    const telework = giveCard(s, 'runner', SG.telework);
    const ice = installIceForTest(s, SG.palisade, 'hq', false);
    startRunnerTurn(s);
    s = run(s, 'hq');
    s = rezForTest(s, ice);
    expect(prompt(s)?.side).toBe('runner');
    s = pick(s, [telework]);
    expect(s.runner.rig.resources.map(c => c.instanceId)).toContain(telework);
  });

  it('MuslihaT may take an icebreaker from the top of the stack when the turn begins', () => {
    let s = newGame();
    setIdentity(s, 'runner', E.muslihat);
    const cleaver = createCardInstance(s, SG.cleaver);
    s.runner.stack.unshift(cleaver);
    s = passTurn(s); // Corp ends: Runner's turn begins
    expect(prompt(s)?.side).toBe('runner');
    s = choose(s, 'take');
    expect(s.runner.grip.map(c => c.instanceId)).toContain(cleaver.instanceId);
  });

  it('Dewi flips for a credit with full MU, then flips back for a card with free MU', () => {
    let s = newGame();
    setIdentity(s, 'runner', E.dewi);
    emptyHQ(s);
    s.runner.memoryUnitsUsed = 4;
    s = cont(run(s, 'archives'));
    const credits = s.runner.credits;
    s = choose(s, 'flip');
    expect(s.runner.identity.flipped).toBe(true);
    expect(s.runner.credits).toBe(credits + 1);
    s = declineAll(s);
    s.runner.memoryUnitsUsed = 0;
    const grip = s.runner.grip.length;
    s = cont(run(s, 'archives'));
    s = choose(s, 'flip');
    expect(s.runner.identity.flipped).toBe(false);
    expect(s.runner.grip.length).toBe(grip + 1);
  });

  it('Magdalene may install a program discarded to hand size', () => {
    let s = newGame();
    setIdentity(s, 'runner', E.magdalene);
    startRunnerTurn(s);
    s.runner.grip = [];
    const cleaver = giveCard(s, 'runner', SG.cleaver);
    for (let i = 0; i < 5; i++) giveCard(s, 'runner', SG.sureGamble);
    s.runner.credits = 10;
    s.runner.clicks = 0;
    s = executeAction(s, { type: 'END_TURN', player: 'runner' });
    s = answer(s, { kind: 'discard', cardInstanceIds: [cleaver] });
    expect(prompt(s)?.side).toBe('runner');
    s = pick(s, [cleaver]);
    expect(s.runner.rig.programs.map(c => c.instanceId)).toContain(cleaver);
    // The turn then passes to the Corp
    expect(s.activePlayer).toBe('corp');
  });
});

describe('Elevation Runner events', () => {
  it('Charm Offensive runs Archives and may trash a rezzed copy of an accessed card', () => {
    let s = newGame();
    const regolith = installCorpForTest(s, SG.regolith, 'remote-1', true);
    s.corp.archives.faceUp.push(createCardInstance(s, SG.regolith));
    startRunnerTurn(s);
    [s] = playRunner(s, E.charm);
    s = cont(s);
    expect(s.activeRun).toBeNull();
    s = pick(s, [regolith]);
    expect(s.corp.archives.faceUp.map(c => c.instanceId)).toContain(regolith);
  });

  it('Charm Offensive cannot trash Kessleroid', () => {
    let s = newGame();
    installIceForTest(s, '35075', 'hq', true);
    s.corp.archives.faceUp.push(createCardInstance(s, '35075'));
    [s] = playRunner(s, E.charm);
    s = cont(s);
    expect(s.pendingPrompts.length).toBe(0);
  });

  it('Scrounge costs an extra click and installs a program from the heap', () => {
    let s = newGame();
    startRunnerTurn(s);
    const cleaver = createCardInstance(s, SG.cleaver);
    const leech = createCardInstance(s, SG.leech);
    s.runner.heap.push(cleaver, leech);
    s.runner.clicks = 2;
    let id: string;
    [s, id] = playRunner(s, E.scrounge, 2);
    expect(s.runner.clicks).toBe(0);
    s = pick(s, [cleaver.instanceId]);
    expect(s.runner.rig.programs.map(c => c.instanceId)).toContain(cleaver.instanceId);
    s = pick(s, [leech.instanceId]);
    expect(s.runner.stack[s.runner.stack.length - 1].instanceId).toBe(leech.instanceId);
    expect(id).toBeTruthy();
  });

  it('Scrounge needs two clicks', () => {
    const s = newGame();
    startRunnerTurn(s);
    s.runner.clicks = 1;
    const id = giveCard(s, 'runner', E.scrounge);
    expect(isLegalAction(s, { type: 'PLAY_OPERATION_OR_EVENT', player: 'runner', cardInstanceId: id })).toBe(false);
  });

  it('Shred: the first end the run only happens if the Corp trashes cards from HQ', () => {
    let s = newGame();
    installIceForTest(s, SG.palisade, 'remote-1');
    installCorpForTest(s, SG.regolith, 'remote-1');
    [s] = playRunner(s, E.shred);
    s = choose(s, 'remote-1');
    s = cont(cont(s)); // encounter Palisade, let it fire
    expect(prompt(s)?.side).toBe('corp');
    s = choose(s, 'no');
    expect(s.activeRun).not.toBeNull(); // the run continues
    expect(s.activeRun?.phase).toBe('approach_server');
  });

  it('Shred: the Corp can pay by trashing X random cards from HQ', () => {
    let s = newGame();
    installIceForTest(s, SG.palisade, 'remote-1');
    installCorpForTest(s, SG.regolith, 'remote-1');
    [s] = playRunner(s, E.shred);
    s = choose(s, 'remote-1');
    s = cont(cont(s));
    const hq = s.corp.hq.length;
    s = choose(s, 'trash');
    expect(s.activeRun).toBeNull();
    expect(s.corp.hq.length).toBe(hq - 1);
    // Revealed before it was trashed, so it goes to Archives faceup (rules 4.4.6b)
    expect(s.corp.archives.faceUp.length).toBe(1);
    expect(s.corp.archives.faceDown.length).toBe(0);
  });

  it('Clean Getaway gains 6 on a successful run', () => {
    let s = newGame();
    emptyHQ(s);
    [s] = playRunner(s, E.cleanGetaway);
    const credits = s.runner.credits;
    s = cont(choose(s, 'archives'));
    expect(s.runner.credits).toBe(credits + 6);
  });

  it('Lie Low draws 4 or removes up to 2 tags', () => {
    let s = newGame();
    s.runner.tags = 3;
    [s] = playRunner(s, E.lieLow, 2);
    s = choose(s, 'tags');
    expect(s.runner.tags).toBe(1);
    const grip = s.runner.grip.length;
    [s] = playRunner(s, E.lieLow, 2);
    s = choose(s, 'draw');
    expect(s.runner.grip.length).toBe(grip + 4);
  });

  it('Maintenance Access runs Archives but approaches and breaches HQ', () => {
    let s = newGame();
    installIceForTest(s, SG.palisade, 'archives', false);
    [s] = playRunner(s, E.maintenance, 2);
    expect(s.activeRun?.server).toBe('archives');
    s = cont(s); // pass the unrezzed ice
    expect(s.activeRun?.server).toBe('hq');
    expect(s.activeRun?.phase).toBe('approach_server');
    s = cont(s);
    expect(s.runsThisTurn[0]).toEqual({ server: 'hq', successful: true });
  });

  it('Transfer of Wealth: tag, Corp loses 3, Runner gains 6', () => {
    let s = newGame();
    emptyHQ(s);
    s.corp.credits = 5;
    [s] = playRunner(s, E.transfer);
    const credits = s.runner.credits;
    s = cont(s);
    expect(s.runner.tags).toBe(1);
    expect(s.corp.credits).toBe(2);
    expect(s.runner.credits).toBe(credits + 6);
  });

  it('Illumination installs up to 3 cards for 1 less each after a successful R&D run', () => {
    let s = newGame();
    s.corp.rd.splice(1); // keep the top card only
    s.corp.rd[0].cardCode = SG.hedgeFund;
    [s] = playRunner(s, E.illumination);
    const a = giveCard(s, 'runner', SG.telework); // cost 1 -> 0
    const b = giveCard(s, 'runner', SG.cleaver); // cost 3 -> 2
    s.runner.credits = 2;
    s = cont(s);
    s = pick(s, [a]);
    s = pick(s, [b]);
    expect(s.runner.credits).toBe(0);
    expect(s.runner.rig.programs.map(c => c.instanceId)).toContain(b);
    expect(s.runner.rig.resources.map(c => c.instanceId)).toContain(a);
  });

  it('Ritual draws 1 card per remaining click', () => {
    let s = newGame();
    startRunnerTurn(s);
    s.runner.clicks = 4;
    const grip = s.runner.grip.length;
    [s] = playRunner(s, E.ritual);
    expect(s.runner.grip.length).toBe(grip + 3);
  });
});

describe('Elevation Runner hardware', () => {
  it('Bling hosts the top card after a free install; it can be installed from Bling; hosted cards go at end of turn', () => {
    let [s, bling] = runnerInstall(newGame(), E.bling);
    const top = createCardInstance(s, SG.telework);
    s.runner.stack.unshift(top);
    [s] = runnerInstall(s, E.gourmand); // costs 0
    s = choose(s, 'host');
    expect(card(s, bling).hostedCards?.map(c => c.instanceId)).toEqual([top.instanceId]);
    s.runner.clicks = 1;
    s.runner.credits = 5;
    s = executeAction(s, { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: top.instanceId });
    expect(s.runner.rig.resources.map(c => c.instanceId)).toContain(top.instanceId);
    // Another hosted card is trashed when the discard phase ends
    const other = createCardInstance(s, SG.sureGamble);
    card(s, bling).hostedCards = [other];
    s = passTurn(s);
    expect(s.runner.heap.map(c => c.instanceId)).toContain(other.instanceId);
  });

  it('Detente hosts a random HQ card after an HQ run, and either player can return 2 for a random access', () => {
    let [s, detente] = runnerInstall(newGame(), E.detente);
    s.corp.hq = s.corp.hq.slice(0, 3).map(c => ({ ...c, cardCode: SG.hedgeFund }));
    s = cont(run(s, 'hq'));
    s = choose(s, 'host');
    s = declineAll(s);
    expect(card(s, detente).hostedCards?.length).toBe(1);
    // A second HQ run the same turn does not host again
    s = cont(run(s, 'hq'));
    expect(prompt(s)?.kind).not.toBe('effect_choice');
    s = declineAll(s);
    card(s, detente).hostedCards!.push(createCardInstance(s, SG.hedgeFund));
    s.runner.clicks = 1;
    s = useAbility(s, 'runner', detente);
    s = choose(s, 'access');
    expect(s.log.some(l => /Runner accessed Hedge Fund/.test(l.message))).toBe(true);
    expect(s.activeRun).toBeNull();
    expect(s.phase).toBe('runner_turn');
  });

  it('Maglectric Rapid can be trashed after an HQ run to derez a card', () => {
    let [s, mag] = runnerInstall(newGame(), E.maglectric);
    emptyHQ(s);
    const regolith = installCorpForTest(s, SG.regolith, 'remote-1', true);
    s = cont(run(s, 'hq'));
    s = pick(s, [regolith]);
    expect(card(s, regolith).isRezzed).toBe(false);
    expect(s.runner.heap.map(c => c.instanceId)).toContain(mag);
  });

  it('GAMEDRAGON™ Pro gives its host +1 strength and boosts last the whole run', () => {
    let s = newGame();
    const cleaver = installProgramForTest(s, SG.cleaver);
    let gd: string;
    [s, gd] = runnerInstall(s, E.gamedragon);
    s = choose(s, cleaver);
    expect(card(s, gd).hostedOnId).toBe(cleaver);
    installIceForTest(s, SG.palisade, 'remote-1'); // strength 3 on a remote
    installIceForTest(s, SG.palisade, 'remote-1');
    s.runner.credits = 10;
    s = cont(run(s, 'remote-1'));
    expect(breakerStrength(s, card(s, cleaver))).toBe(4); // 3 + 1
    s = executeAction(s, { type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: cleaver });
    s = executeAction(s, { type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: cleaver, subroutineIndices: [0] });
    s = cont(cont(s)); // pass, approach and encounter the second Palisade
    expect(breakerStrength(s, card(s, cleaver))).toBe(5);
  });

  it('Madani hosts programs from the grip and installs one per turn for free action', () => {
    let [s, madani] = runnerInstall(newGame(), E.madani);
    const cleaver = giveCard(s, 'runner', SG.cleaver);
    s.runner.clicks = 1;
    s = useAbility(s, 'runner', madani, 0);
    s = pick(s, [cleaver]);
    expect(card(s, madani).hostedCards?.map(c => c.instanceId)).toEqual([cleaver]);
    s.runner.credits = 3;
    s = useAbility(s, 'runner', madani, 1);
    s = pick(s, [cleaver]);
    expect(s.runner.rig.programs.map(c => c.instanceId)).toContain(cleaver);
    expect(s.runner.credits).toBe(0);
  });
});

describe('Elevation Runner programs', () => {
  it('Gourmand trashes itself and a non-agenda card being accessed, and draws', () => {
    let [s, gourmand] = runnerInstall(newGame(), E.gourmand);
    const regolith = installCorpForTest(s, SG.regolith, 'remote-1');
    const grip = s.runner.grip.length;
    s = cont(run(s, 'remote-1'));
    s = answer(s, { kind: 'access_trash', trash: false, alternativeId: gourmand });
    expect(s.corp.archives.faceUp.map(c => c.instanceId)).toContain(regolith);
    expect(s.runner.heap.map(c => c.instanceId)).toContain(gourmand);
    expect(s.runner.grip.length).toBe(grip + 1);
  });

  it('Hantu gets 2 virus counters and spends them for +2 strength', () => {
    let [s, hantu] = runnerInstall(newGame(), E.hantu);
    expect(tokens(s, hantu, 'virus')).toBe(2);
    installIceForTest(s, '35063', 'hq'); // Doomscroll, strength 3
    s = cont(run(s, 'hq'));
    s = useAbility(s, 'runner', hantu);
    expect(breakerStrength(s, card(s, hantu))).toBe(4);
    s = executeAction(s, { type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: hantu, subroutineIndices: [0] });
    expect(s.activeRun?.encounter?.broken[0]).toBe(true);
  });

  it('Rising Tide gets +1 strength per fracter in the heap', () => {
    const [s, tide] = runnerInstall(newGame(), E.risingTide);
    s.runner.heap.push(createCardInstance(s, SG.cleaver), createCardInstance(s, E.principia));
    expect(breakerStrength(s, card(s, tide))).toBe(3);
  });

  it('Sang Kancil boosts for 1 during a run event, 3 otherwise', () => {
    let [s, sk] = runnerInstall(newGame(), E.sangKancil);
    installIceForTest(s, SG.whitespace, 'hq');
    s.runner.credits = 10;
    s = cont(run(s, 'hq'));
    s = executeAction(s, { type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: sk });
    expect(s.runner.credits).toBe(7);
    let t = newGame();
    [t, sk] = runnerInstall(t, E.sangKancil);
    installIceForTest(t, SG.whitespace, 'hq');
    [t] = playRunner(t, SG.jailbreak);
    t = cont(choose(t, 'hq'));
    const before = t.runner.credits;
    t = executeAction(t, { type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: sk });
    expect(t.runner.credits).toBe(before - 1);
  });

  it('Principia costs 1 less per other icebreaker', () => {
    let s = newGame();
    installProgramForTest(s, SG.cleaver);
    installProgramForTest(s, SG.unity);
    startRunnerTurn(s);
    const id = giveCard(s, 'runner', E.principia);
    s.runner.credits = 2;
    s = executeAction(s, { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: id });
    expect(s.runner.credits).toBe(0);
  });

  it('Azimat has 2 recurring credits that pay trash costs, refilled each turn', () => {
    let [s, azimat] = runnerInstall(newGame(), E.azimat);
    expect(tokens(s, azimat, 'credit')).toBe(2);
    const regolith = installCorpForTest(s, SG.regolith, 'remote-1'); // trash cost 3
    s.runner.credits = 1;
    expect(availableCredits(s, 'runner')).toBe(1);
    s = cont(run(s, 'remote-1'));
    expect(prompt(s)).toMatchObject({ kind: 'access_trash', trashCost: 3 });
    s = answer(s, { kind: 'access_trash', trash: true });
    expect(s.corp.archives.faceUp.map(c => c.instanceId)).toContain(regolith);
    expect(s.runner.credits).toBe(0);
    expect(tokens(s, azimat, 'credit')).toBe(0);
    s = passTurn(passTurn(s));
    expect(tokens(s, azimat, 'credit')).toBe(2);
  });

  it('Chromatophores makes its host every subtype, so any breaker interfaces with it', () => {
    let s = newGame();
    const ice = installIceForTest(s, SG.palisade, 'hq'); // barrier
    let chroma: string;
    [s, chroma] = runnerInstall(s, E.chromatophores, ice);
    const unity = installProgramForTest(s, SG.unity); // decoder
    s.runner.credits = 10;
    s = cont(run(s, 'hq'));
    s = executeAction(s, { type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: unity });
    s = executeAction(s, { type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: unity, subroutineIndices: [0] });
    expect(s.activeRun?.encounter?.broken[0]).toBe(true);
    expect(chroma).toBeTruthy();
  });

  it('Devadatta Drone spends a power counter for an extra R&D access', () => {
    let [s, drone] = runnerInstall(newGame(), E.devadatta);
    expect(tokens(s, drone, 'power')).toBe(2);
    s.corp.rd.forEach(c => (c.cardCode = SG.hedgeFund));
    s = cont(run(s, 'rd'));
    s = choose(s, 'use');
    s = declineAll(s);
    expect(s.log.filter(l => /Runner accessed Hedge Fund/.test(l.message)).length).toBe(2);
    expect(tokens(s, drone, 'power')).toBe(1);
  });
});

describe('Elevation Runner resources', () => {
  it('Cacophony gets a counter per turn for trashing, and sabotages 3 for 2 counters', () => {
    let [s, caco] = runnerInstall(newGame(), E.cacophony);
    card(s, caco).tokens.power = 1;
    s.runner.credits = 5;
    installCorpForTest(s, SG.regolith, 'remote-1');
    s = cont(run(s, 'remote-1'));
    s = answer(s, { kind: 'access_trash', trash: true });
    expect(tokens(s, caco, 'power')).toBe(2);
    s.runner.clicks = 0;
    s = executeAction(s, { type: 'END_TURN', player: 'runner' });
    s = choose(s, 'sabotage');
    expect(prompt(s)).toMatchObject({ kind: 'effect_cards', side: 'corp' });
    const hq = s.corp.hq.length;
    const rd = s.corp.rd.length;
    s = pick(s, [s.corp.hq[0].instanceId]);
    // 1 from HQ and 2 from R&D, then the Corp's turn begins with its mandatory draw
    expect(s.corp.hq.length).toBe(hq - 1 + 1);
    expect(s.corp.rd.length).toBe(rd - 2 - 1);
    expect(s.activePlayer).toBe('corp');
  });

  it('Rent Rioters: 3 clicks and trash for 9 credits', () => {
    let [s, rr] = runnerInstall(newGame(), E.rentRioters);
    s.runner.clicks = 3;
    const credits = s.runner.credits;
    s = useAbility(s, 'runner', rr);
    expect(s.runner.credits).toBe(credits + 9);
    expect(s.runner.heap.map(c => c.instanceId)).toContain(rr);
  });

  it('Fransofia Ward raises ice rez costs and can be trashed to bypass when the Corp is rich', () => {
    let [s, fw] = runnerInstall(newGame(), E.fransofia);
    const ice = installIceForTest(s, SG.palisade, 'hq', false);
    s = run(s, 'hq');
    s.corp.credits = 16;
    s = executeAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: ice });
    expect(s.corp.credits).toBe(16 - 4); // 3 + 1
    s.corp.credits = 15;
    s = cont(s);
    s = choose(s, 'bypass');
    expect(s.activeRun?.phase).toBe('approach_server');
    expect(s.runner.heap.map(c => c.instanceId)).toContain(fw);
  });

  it('Fransofia Ward resolves before the ice\'s own encounter ability, and bypassing skips it', () => {
    let s = newGame();
    [s] = runnerInstall(s, E.fransofia);
    installIceForTest(s, SG.funhouse, 'hq');
    s.corp.credits = 20;
    s = cont(run(s, 'hq'));
    expect(prompt(s)?.message).toMatch(/Fransofia/);
    s = choose(s, 'bypass');
    expect(s.pendingPrompts.length).toBe(0); // Funhouse never asked
    expect(s.runner.tags).toBe(0);
  });

  it('Open Market loads 6, pays for connection installs and gives 1 per turn', () => {
    let [s, om] = runnerInstall(newGame(), E.openMarket);
    expect(tokens(s, om, 'credit')).toBe(6);
    s.runner.credits = 0;
    s.runner.clicks = 1;
    const knick = giveCard(s, 'runner', E.knickknack); // Connection, cost 2
    s = executeAction(s, { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: knick });
    expect(tokens(s, om, 'credit')).toBe(4);
    s = passTurn(passTurn(s));
    expect(s.runner.credits).toBe(1);
    expect(tokens(s, om, 'credit')).toBe(3);
  });

  it('Knickknack trashes another card on the first run each turn for its cost and a card', () => {
    let s = newGame();
    let tele: string;
    [s, tele] = runnerInstall(s, SG.telework);
    [s] = runnerInstall(s, E.knickknack);
    emptyHQ(s);
    const credits = s.runner.credits;
    const grip = s.runner.grip.length;
    s = run(s, 'archives');
    s = pick(s, [tele]);
    expect(s.runner.credits).toBe(credits + 1); // Telework costs 1
    expect(s.runner.grip.length).toBe(grip + 1);
    s = declineAll(cont(s));
    s = run(s, 'archives');
    expect(s.pendingPrompts.length).toBe(0);
  });

  it('Side Hustle pays out at 6 credits, trashes itself and draws', () => {
    let [s, sh] = runnerInstall(newGame(), E.sideHustle);
    expect(tokens(s, sh, 'credit')).toBe(1);
    emptyHQ(s);
    const credits = s.runner.credits;
    for (let i = 0; i < 5; i++) s = declineAll(cont(run(s, 'archives')));
    expect(s.runner.credits).toBe(credits + 6);
    expect(s.runner.heap.map(c => c.instanceId)).toContain(sh);
  });

  it('Semak-samun can only be broken by fracters', () => {
    let s = newGame();
    installIceForTest(s, '35054', 'hq');
    const mayfly = installProgramForTest(s, SG.mayfly);
    const cleaver = installProgramForTest(s, SG.cleaver);
    s.runner.credits = 10;
    s = cont(run(s, 'hq'));
    expect(iceStrength(s, card(s, s.activeRun!.encounter!.iceId))).toBe(3);
    s = executeAction(s, { type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: mayfly });
    s = executeAction(s, { type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: mayfly });
    expect(isLegalAction(s, { type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: mayfly, subroutineIndices: [0] })).toBe(false);
    s = executeAction(s, { type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: cleaver });
    expect(isLegalAction(s, { type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: cleaver, subroutineIndices: [0] })).toBe(true);
    expect(cardDef(card(s, cleaver)).title).toBe('Cleaver');
  });
});
