import { describe, expect, it } from 'vitest';
import { cardDef, createCardInstance, executeAction, findCardAnywhere, GameState, getLegalActions, iceStrength, isLegalAction } from '../src/core';
import { availableCredits, rezCost } from '../src/core/engine/cardEffects';
import { markSubroutinesBroken } from '../src/core/engine/ice';
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
  scoreForTest,
  setIdentity,
  startRunnerTurn,
  useAbility,
} from './helpers';

const V = {
  meliesCity: '36026', synchro: '36027', ansel2: '36028', reverb: '36029', sleipnir: '36030', vertigo: '36031',
  caveat: '36032', realloc: '36033', retirement: '36034', perfectRecall: '36035', melies: '36036', lotusHaze: '36037',
  esca: '36038', ezam: '36039', seeker: '36040', lionsmane: '36041', vicsek: '36042', cultivate: '36043', unleash: '36044',
  redRoom: '36045', editorial: '36046', witchHunt: '36047', magistrate: '36048', nihilo: '36049', grubber: '36050',
  lethe: '36051', paywall: '36052', flood: '36053', scapegoat: '36054', hype: '36055', sze: '36056', luana: '36057',
  eventHorizon: '36058', flywheel: '36059', tocsin: '36060', myoshu: '36061', reanimation: '36062', vulture: '36063',
  flagship: '36064', shackleton: '36065', letThemDream: '36066', touchstone: '36021',
};
const SG = {
  cleaver: '30006', leech: '30008', telework: '30027', sureGamble: '30030', palisade: '30072', tithe: '30073',
  hedgeFund: '30075', regolith: '30071', nico: '30037', offworld: '30067', t400: '30031', whitespace: '30074',
  ballista: '30062', manegarm: '30042', publicTrail: '30057', headline: '30052',
};

const card = (s: GameState, id: string) => findCardAnywhere(s, id)!;
const choose = (s: GameState, optionId: string) => keepGoing(answer(s, { kind: 'effect_choice', optionId }));
const pick = (s: GameState, ids: string[]) => keepGoing(answer(s, { kind: 'effect_cards', cardInstanceIds: ids }));
const declineAccess = (s: GameState) => keepGoing(answer(s, { kind: 'access_trash', trash: false }));
const prompt = (s: GameState) => s.pendingPrompts[0];
const source = (s: GameState) => { const p = prompt(s); return p && 'source' in p ? p.source : undefined; };
const emptyHQ = (s: GameState) => s.corp.rd.push(...s.corp.hq.splice(0));
/** Back to the Corp's action phase (test setup). */
function corpTurn(s: GameState, clicks = 3): void {
  s.activePlayer = 'corp';
  s.phase = 'corp_turn';
  s.turnStep = null;
  s.corp.clicks = clicks;
}
/** Gives the Corp an operation and plays it with clicks and credits to spare. */
function playCorp(s: GameState, code: string, clicks = 3): [GameState, string] {
  corpTurn(s, clicks);
  const id = giveCard(s, 'corp', code);
  s.corp.credits += 15;
  return [play(s, 'corp', id), id];
}
/** Declines every access prompt until the breach is over. */
function finishBreach(s: GameState): GameState {
  for (let i = 0; i < 20 && prompt(s)?.kind === 'access_trash'; i++) s = declineAccess(s);
  return s;
}
const rezzed = (s: GameState, code: string, server: string) => installCorpForTest(s, code, server, true);

describe('Vantage Point Corp identities', () => {
  it('Méliès U: secretly set, flips on a successful central run, and its matching side trashes the top of R&D for a card from Archives', () => {
    let s = newGame();
    setIdentity(s, 'corp', V.melies);
    s.corp.rd.push(...s.corp.hq.splice(3));
    const hedge = createCardInstance(s, SG.hedgeFund);
    s.corp.archives.faceUp.push(hedge);
    corpTurn(s, 0);
    s = executeAction(s, { type: 'END_TURN', player: 'corp' });
    expect(source(s)).toMatchObject({ cardCode: V.melies, step: 'set' });
    s = choose(s, 'rd');
    expect(s.corp.meliesServer).toBe('rd');
    // The Runner's turn: a successful run on R&D flips it to the matching side
    emptyHQ(s);
    const top = s.corp.rd[0];
    s = cont(run(s, 'rd'));
    expect(s.corp.identity.flipped).toBe(true);
    expect(source(s)).toMatchObject({ step: 'top' });
    s = choose(s, 'trash');
    expect(s.corp.archives.faceDown.map(c => c.instanceId)).toContain(top.instanceId);
    s = pick(s, [hedge.instanceId]);
    expect(s.corp.hq.map(c => c.instanceId)).toContain(hedge.instanceId);
  });

  it('Méliès U gains 1 when the Runner\'s action phase ends unflipped, and flips back after their discard phase', () => {
    let s = newGame();
    setIdentity(s, 'corp', V.melies);
    s.corp.meliesServer = 'hq';
    startRunnerTurn(s);
    s = declineAll(cont(run(s, 'archives'))); // flips (Archives isn't its side: no look)
    expect(s.corp.identity.flipped).toBe(true);
    const credits = s.corp.credits;
    s = passTurn(s);
    expect(s.corp.credits).toBe(credits); // flipped: no credit
    expect(s.corp.identity.flipped).toBe(false);

    let t = newGame();
    setIdentity(t, 'corp', V.melies);
    startRunnerTurn(t);
    const c2 = t.corp.credits;
    t = passTurn(t);
    expect(t.corp.credits).toBeGreaterThanOrEqual(c2 + 1);
  });

  it('Editorial Division searches R&D for a gray ops, black ops or liability card the first time each turn it takes bad publicity', () => {
    let s = newGame();
    setIdentity(s, 'corp', V.editorial);
    const scapegoat = createCardInstance(s, V.scapegoat);
    s.corp.rd.push(scapegoat);
    [s] = playCorp(s, V.vulture);
    expect(s.corp.badPublicity).toBe(1);
    expect(source(s)).toMatchObject({ cardCode: V.editorial });
    expect((prompt(s) as { candidateIds: string[] }).candidateIds).toContain(scapegoat.instanceId);
    s = pick(s, [scapegoat.instanceId]);
    expect(s.corp.hq.map(c => c.instanceId)).toContain(scapegoat.instanceId);
    [s] = playCorp(s, V.vulture);
    expect(s.pendingPrompts.length).toBe(0); // only the first time each turn
  });
});

describe('Vantage Point agendas', () => {
  it('Méliès City Luxury Line costs the Runner a click to steal and gives the Corp a click when scored', () => {
    let s = newGame();
    emptyHQ(s);
    const id = installCorpForTest(s, V.meliesCity, 'remote-1');
    startRunnerTurn(s);
    s = cont(run(s, 'remote-1'));
    expect(source(s)).toMatchObject({ step: 'steal-cost' });
    const clicks = s.runner.clicks;
    s = choose(s, 'steal');
    expect(s.runner.score).toBe(3);
    expect(s.runner.clicks).toBe(clicks - 1);

    let t = newGame();
    const id2 = installCorpForTest(t, V.meliesCity, 'remote-1');
    startRunnerTurn(t);
    t = run(t, 'remote-1');
    t.runner.clicks = 0;
    t = cont(t);
    expect(t.runner.score).toBe(0); // no click to pay with
    expect(findCardAnywhere(t, id2)).toBeTruthy();

    let u = newGame();
    corpTurn(u, 1);
    u = scoreForTest(u, V.meliesCity);
    expect(u.corp.clicks).toBe(2);
    expect(id).toBeTruthy();
  });

  it('Lotus Haze moves a rezzed upgrade to another server for an agenda counter', () => {
    let s = newGame();
    corpTurn(s);
    s = scoreForTest(s, V.lotusHaze);
    const haze = s.corp.scoreArea[0];
    expect(haze.tokens.agenda).toBe(3);
    const manegarm = rezzed(s, SG.manegarm, 'remote-1');
    installCorpForTest(s, SG.regolith, 'remote-2');
    s = useAbility(s, 'corp', haze.instanceId);
    s = pick(s, [manegarm]);
    s = choose(s, 'remote-2');
    expect(s.corp.servers['remote-2'].root.map(c => c.instanceId)).toContain(manegarm);
    expect(card(s, haze.instanceId).tokens.agenda).toBe(2);
  });

  it('Witch Hunt: 1 bad publicity when scored or stolen, and the Runner ends the Corp\'s action phase with exactly 3 tags', () => {
    let s = newGame();
    corpTurn(s);
    s.runner.tags = 5;
    s = scoreForTest(s, V.witchHunt);
    expect(s.corp.badPublicity).toBe(1);
    s.corp.clicks = 0;
    s = executeAction(s, { type: 'END_TURN', player: 'corp' });
    expect(s.runner.tags).toBe(3);

    let t = newGame();
    emptyHQ(t);
    installCorpForTest(t, V.witchHunt, 'remote-1');
    t = cont(run(t, 'remote-1'));
    expect(t.runner.score).toBe(2);
    expect(t.corp.badPublicity).toBe(1);
  });

  it('Sacrifice Zone Expansion installs faceup, pays 3 the first time each turn it is advanced, and turns counters into meat damage', () => {
    let s = newGame();
    corpTurn(s);
    const id = giveCard(s, 'corp', V.sze);
    // Only faceup install options are offered (no duplicate facedown buttons)
    const installs = getLegalActions(s, 'corp').filter(a => a.type === 'INSTALL_CARD' && a.cardInstanceId === id);
    expect(installs.length).toBeGreaterThan(0);
    expect(installs.every(a => a.type === 'INSTALL_CARD' && a.faceUp)).toBe(true);
    s = executeAction(s, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: id, asNewRemote: true });
    const sze = card(s, id);
    expect(sze.faceUp).toBe(true);
    const server = Object.values(s.corp.servers).find(v => v.root.includes(sze))!.id;
    s.corp.credits = 2;
    s = executeAction(s, { type: 'ADVANCE_CARD', player: 'corp', cardInstanceId: id, serverId: server });
    expect(s.corp.credits).toBe(2 - 1 + 3);
    s = executeAction(s, { type: 'ADVANCE_CARD', player: 'corp', cardInstanceId: id, serverId: server });
    expect(s.corp.credits).toBe(4 - 1);
    // The Runner runs Archives (another server): remove a counter for 1 meat damage
    startRunnerTurn(s);
    s.runner.grip.push(...s.runner.stack.splice(0, 3));
    const grip = s.runner.grip.length;
    s = cont(run(s, 'archives'));
    expect(source(s)).toMatchObject({ cardCode: V.sze });
    s = choose(s, 'yes');
    expect(s.runner.grip.length).toBe(grip - 1);
    expect(card(s, id).advancementCounters).toBe(1);
  });

  it('Let Them Dream fetches an agenda and is worth 1 less in the Runner\'s score area', () => {
    let s = newGame();
    corpTurn(s);
    const off = createCardInstance(s, SG.offworld);
    s.corp.archives.faceUp.push(off);
    s = scoreForTest(s, V.letThemDream);
    s = choose(s, 'archives');
    s = pick(s, [off.instanceId]);
    s = choose(s, 'bottom');
    expect(s.corp.rd[s.corp.rd.length - 1].instanceId).toBe(off.instanceId);

    let t = newGame();
    emptyHQ(t);
    installCorpForTest(t, V.letThemDream, 'remote-1');
    t = cont(run(t, 'remote-1'));
    expect(t.runner.score).toBe(1);
  });
});

describe('Vantage Point assets', () => {
  it('Synchrocyclotron makes the first double operation each turn cost a click less', () => {
    let s = newGame();
    rezzed(s, V.synchro, 'remote-1');
    installIceForTest(s, SG.palisade, 'hq');
    corpTurn(s, 1);
    const id = giveCard(s, 'corp', V.realloc);
    expect(isLegalAction(s, { type: 'PLAY_OPERATION_OR_EVENT', player: 'corp', cardInstanceId: id })).toBe(true);
    s = play(s, 'corp', id);
    expect(s.corp.clicks).toBe(0);
  });

  it('Esca must be revealed in R&D, takes 1 credit, and does 1 net damage to a tagged Runner', () => {
    let s = newGame();
    const esca = createCardInstance(s, V.esca);
    s.corp.rd.unshift(esca);
    s.runner.tags = 1;
    s.runner.credits = 3;
    s.runner.grip.push(...s.runner.stack.splice(0, 3));
    const grip = s.runner.grip.length;
    s = finishBreach(cont(run(s, 'rd')));
    expect(s.runner.credits).toBe(2);
    expect(s.runner.grip.length).toBe(grip - 1);
    const line = s.log.find(l => l.message === 'Runner accessed Esca.');
    expect(line?.secret).toBeUndefined();
  });

  it('Magistrate Revontulet makes stealing cost 3 credits and takes 3 when the Corp scores', () => {
    let s = newGame();
    emptyHQ(s);
    rezzed(s, V.magistrate, 'remote-2');
    installCorpForTest(s, SG.offworld, 'remote-1');
    s.runner.credits = 2;
    s = cont(run(s, 'remote-1'));
    expect(s.runner.score).toBe(0); // can't pay 3
    s.runner.credits = 5;
    s.runner.clicks = 1;
    s = cont(run(s, 'remote-1'));
    s = choose(s, 'steal');
    expect(s.runner.score).toBe(2);
    expect(s.runner.credits).toBe(2);
    corpTurn(s);
    s = scoreForTest(s, SG.offworld, 'remote-9');
    expect(s.runner.credits).toBe(0);
  });

  it('Nihilo Agent gives a tag and bad publicity each Corp discard phase, removes one of each when the Corp turn begins, and leaves after 3', () => {
    let s = newGame();
    const id = installCorpForTest(s, V.nihilo, 'remote-1');
    s.corp.rd.push(...s.corp.hq.splice(3));
    corpTurn(s, 0);
    s = rezForTest(s, id);
    expect(card(s, id).tokens.power).toBe(3);
    s = executeAction(s, { type: 'END_TURN', player: 'corp' });
    expect(s.runner.tags).toBe(1);
    expect(s.corp.badPublicity).toBe(1);
    expect(card(s, id).tokens.power).toBe(2);
    s = passTurn(s); // Runner's turn ends; Corp turn begins
    if (s.turnStep?.kind === 'corp_turn_start') s = executeAction(s, { type: 'START_TURN', player: 'corp' });
    expect(s.runner.tags).toBe(0);
    expect(s.corp.badPublicity).toBe(0);
  });

  it('Luana Campos hosts bad publicity for 3 credits and a card, and the Corp takes it back when it leaves play', () => {
    let s = newGame();
    const id = rezzed(s, V.luana, 'remote-1');
    s.corp.badPublicity = 1;
    startRunnerTurn(s);
    s = passTurn(s);
    if (s.turnStep?.kind === 'corp_turn_start') s = executeAction(s, { type: 'START_TURN', player: 'corp' });
    expect(source(s)).toMatchObject({ cardCode: V.luana });
    const credits = s.corp.credits;
    s = choose(s, 'host');
    expect(s.corp.badPublicity).toBe(0);
    expect(s.corp.credits).toBe(credits + 3);
    // The Runner trashes it on access: the hosted bad publicity comes back
    startRunnerTurn(s);
    s.runner.credits = 5;
    s = cont(run(s, 'remote-1'));
    s = keepGoing(answer(s, { kind: 'access_trash', trash: true }));
    expect(s.corp.archives.faceUp.map(c => c.instanceId)).toContain(id);
    expect(s.corp.badPublicity).toBe(1);
  });
});

describe('Vantage Point ice', () => {
  it('Ansel 2.0 lets the Runner lose 2 clicks to break up to 2 subroutines', () => {
    let s = newGame();
    installIceForTest(s, V.ansel2, 'remote-1');
    s = run(s, 'remote-1');
    s = cont(s);
    s.runner.clicks = 2;
    expect(isLegalAction(s, { type: 'BIOROID_BREAK', player: 'runner', subroutineIndex: 0, subroutineIndices: [0, 1, 2] })).toBe(false);
    s = executeAction(s, { type: 'BIOROID_BREAK', player: 'runner', subroutineIndex: 2, subroutineIndices: [2, 3] });
    expect(s.runner.clicks).toBe(0);
    expect(s.activeRun?.encounter?.broken).toEqual([false, false, true, true]);
  });

  it('Ansel 2.0\'s subroutines trash a Runner card, remove a heap card from the game and may install from Archives', () => {
    let s = newGame();
    installIceForTest(s, V.ansel2, 'remote-1');
    const cleaver = installProgramForTest(s, SG.cleaver);
    const heapCard = createCardInstance(s, SG.sureGamble);
    s.runner.heap.push(heapCard);
    const ice = createCardInstance(s, SG.palisade);
    s.corp.archives.faceUp.push(ice);
    s = cont(cont(run(s, 'remote-1')));
    s = pick(s, [cleaver]);
    s = pick(s, [heapCard.instanceId]);
    s = pick(s, [ice.instanceId]);
    s = choose(s, 'hq');
    expect(s.runner.heap.map(c => c.instanceId)).toContain(cleaver);
    expect(s.removedFromGame.map(c => c.instanceId)).toContain(heapCard.instanceId);
    expect(s.corp.servers.hq.ice.map(c => c.instanceId)).toContain(ice.instanceId);
    expect(s.activeRun).toBeNull();
  });

  it('Reverb costs 1 less to rez for each other unrezzed ice', () => {
    const s = newGame();
    const reverb = installIceForTest(s, V.reverb, 'hq', false);
    installIceForTest(s, SG.palisade, 'rd', false);
    installIceForTest(s, SG.palisade, 'archives', false);
    expect(rezCost(s, card(s, reverb))).toBe(2);
  });

  it('Sleipnir may draw and may shuffle a card from Archives into R&D, then ends the run', () => {
    let s = newGame();
    installIceForTest(s, V.sleipnir, 'hq');
    const hedge = createCardInstance(s, SG.hedgeFund);
    s.corp.archives.faceUp.push(hedge);
    const hq = s.corp.hq.length;
    s = cont(cont(run(s, 'hq')));
    s = choose(s, 'draw');
    s = pick(s, [hedge.instanceId]);
    expect(s.corp.hq.length).toBe(hq + 1);
    expect(s.corp.rd.map(c => c.instanceId)).toContain(hedge.instanceId);
    expect(s.activeRun).toBeNull();
  });

  it('Vertigo takes a click, and a Runner with no clicks left past it cannot steal', () => {
    let s = newGame();
    emptyHQ(s);
    installCorpForTest(s, SG.offworld, 'remote-1');
    installIceForTest(s, V.vertigo, 'remote-1');
    s = run(s, 'remote-1');
    s.runner.clicks = 1;
    s = cont(cont(s)); // encounter, lose the last click, pass
    expect(s.runner.clicks).toBe(0);
    expect(s.activeRun?.cannotStealOrTrash).toBe(true);
    s = cont(s);
    expect(s.runner.score).toBe(0);
  });

  it('ezaM swaps itself with another ice, and its subroutines bottom the top of R&D and add 1 strength to all ice', () => {
    let s = newGame();
    const ezam = installIceForTest(s, V.ezam, 'hq');
    const pal = installIceForTest(s, SG.palisade, 'rd');
    corpTurn(s);
    s = useAbility(s, 'corp', ezam);
    s = pick(s, [pal]);
    expect(s.corp.servers.rd.ice[0].instanceId).toBe(ezam);
    const top = s.corp.rd[0];
    s = cont(run(s, 'rd'));
    s = executeAction(s, { type: 'CONTINUE_RUN', player: 'runner' });
    s = choose(s, 'bottom');
    expect(s.corp.rd[s.corp.rd.length - 1].instanceId).toBe(top.instanceId);
    expect(iceStrength(s, card(s, pal))).toBe(2 + 1);
  });

  it('Knowledge Seeker arranges the top of R&D, and purges and derezzes itself at 3 virus counters', () => {
    let s = newGame();
    const seeker = installIceForTest(s, V.seeker, 'hq');
    card(s, seeker).tokens.virus = 2;
    const leech = installProgramForTest(s, SG.leech);
    card(s, leech).tokens.virus = 2;
    const top4 = s.corp.rd.slice(0, 4).map(c => c.instanceId);
    s = cont(cont(run(s, 'hq')));
    s = pick(s, [top4[3]]);
    s = pick(s, [top4[2]]);
    s = pick(s, [top4[1]]);
    expect(s.corp.rd.slice(0, 4).map(c => c.instanceId)).toEqual([top4[3], top4[2], top4[1], top4[0]]);
    expect(s.activeRun).toBeNull();
    expect(card(s, seeker).isRezzed).toBe(false);
    expect(card(s, leech).tokens.virus ?? 0).toBe(0);
  });

  it('Lionsmane: 2 net, 2 net unless paid, 2 net unless the Runner jacks out', () => {
    let s = newGame();
    installIceForTest(s, V.lionsmane, 'remote-1');
    s.runner.grip.push(...s.runner.stack.splice(0, 8));
    s.runner.credits = 3;
    const grip = s.runner.grip.length;
    s = cont(cont(run(s, 'remote-1')));
    s = choose(s, 'pay');
    s = choose(s, 'jack');
    expect(s.runner.grip.length).toBe(grip - 2);
    expect(s.runner.credits).toBe(0);
    expect(s.activeRun).toBeNull();
  });

  it('Vicsek does X net damage and gives X tags, then tags and trashes itself', () => {
    let s = newGame();
    const vicsek = installIceForTest(s, V.vicsek, 'remote-1');
    s.runner.grip.push(...s.runner.stack.splice(0, 5));
    s.runner.tags = 2;
    const grip = s.runner.grip.length;
    s = cont(cont(run(s, 'remote-1')));
    expect(s.runner.grip.length).toBe(grip - 2);
    expect(s.runner.tags).toBe(5);
    expect(s.corp.archives.faceUp.map(c => c.instanceId)).toContain(vicsek);
  });

  it('Grubber gives bad publicity when rezzed on a central server, and ends the run unless the Runner pays 3 twice', () => {
    let s = newGame();
    const grubber = installIceForTest(s, V.grubber, 'hq', false);
    s.runner.credits = 3;
    s = run(s, 'hq');
    s = rezForTest(s, grubber);
    expect(s.corp.badPublicity).toBe(1);
    s = cont(cont(s));
    expect(s.activeRun?.badPublicityCredits ?? 0).toBe(0); // the fund was filled when the run began
    s = choose(s, 'pay');
    // The second subroutine: 0 credits left, so the run ends
    expect(s.runner.credits).toBe(0);
    expect(s.activeRun).toBeNull();
  });

  it('Lethe tags a Runner who fully breaks it, and its subroutines move Archives to R&D and an installed card to the grip', () => {
    let s = newGame();
    installIceForTest(s, V.lethe, 'remote-1');
    const hedge = createCardInstance(s, SG.hedgeFund);
    s.corp.archives.faceUp.push(hedge);
    const cleaver = installProgramForTest(s, SG.cleaver);
    s = cont(cont(run(s, 'remote-1')));
    s = pick(s, [hedge.instanceId]);
    s = choose(s, 'top');
    expect(s.corp.rd[0].instanceId).toBe(hedge.instanceId);
    s = pick(s, [cleaver]);
    expect(s.runner.grip.map(c => c.instanceId)).toContain(cleaver);
    expect(s.runner.memoryUnitsUsed).toBe(0);

    let t = newGame();
    const lethe = installIceForTest(t, V.lethe, 'remote-1');
    t = cont(run(t, 'remote-1'));
    const encounter = t.activeRun!.encounter!;
    expect(encounter.iceId).toBe(lethe);
    // Breaking every subroutine fully breaks it: 1 tag
    markSubroutinesBroken(t, [0, 1], null);
    expect(t.runner.tags).toBe(1);
  });

  it('Paywall takes 1 credit on encounter and ends the run unless the Runner pays 1', () => {
    let s = newGame();
    installIceForTest(s, V.paywall, 'remote-1');
    s.runner.credits = 2;
    s = cont(run(s, 'remote-1'));
    expect(s.runner.credits).toBe(1);
    s = cont(s);
    s = choose(s, 'pay');
    expect(s.runner.credits).toBe(0);
    expect(s.activeRun).not.toBeNull();
  });

  it('Event Horizon can be trashed to end a run on its server, and its subroutines cost the Runner 3 credits each', () => {
    let s = newGame();
    const eh = installIceForTest(s, V.eventHorizon, 'remote-1');
    const outer = installIceForTest(s, SG.palisade, 'remote-1', false);
    s = run(s, 'remote-1');
    expect(isLegalAction(s, { type: 'USE_ABILITY', player: 'corp', cardInstanceId: eh, abilityIndex: 0 })).toBe(true);
    s = executeAction(s, { type: 'USE_ABILITY', player: 'corp', cardInstanceId: eh, abilityIndex: 0 });
    expect(s.activeRun).toBeNull();
    expect(s.corp.archives.faceUp.map(c => c.instanceId)).toContain(eh);
    expect(outer).toBeTruthy();

    let t = newGame();
    installIceForTest(t, V.eventHorizon, 'remote-1');
    const cleaver = installProgramForTest(t, SG.cleaver);
    t.runner.credits = 3;
    t = cont(cont(run(t, 'remote-1')));
    t = choose(t, 'no'); // the Corp trashes a program
    t = pick(t, [cleaver]);
    expect(t.runner.heap.map(c => c.instanceId)).toContain(cleaver);
    t = choose(t, 'pay');
    expect(t.runner.credits).toBe(0);
    expect(t.activeRun).not.toBeNull();
  });

  it('Flywheel gains 1 credit per subroutine and may draw', () => {
    let s = newGame();
    installIceForTest(s, V.flywheel, 'remote-1');
    const credits = s.corp.credits;
    const hq = s.corp.hq.length;
    s = cont(cont(run(s, 'remote-1')));
    s = choose(s, 'draw');
    s = choose(s, 'no');
    expect(s.corp.credits).toBe(credits + 2);
    expect(s.corp.hq.length).toBe(hq + 1);
  });

  it('Tocsin can be trashed from HQ to fetch a barrier and a sentry', () => {
    let s = newGame();
    corpTurn(s);
    const tocsin = giveCard(s, 'corp', V.tocsin);
    const barrier = createCardInstance(s, SG.palisade);
    const sentry = createCardInstance(s, SG.tithe);
    s.corp.rd.push(barrier, sentry);
    s.corp.credits = 1;
    s = useAbility(s, 'corp', tocsin);
    expect(s.corp.archives.faceUp.map(c => c.instanceId)).toContain(tocsin);
    s = pick(s, [barrier.instanceId]);
    s = pick(s, [sentry.instanceId]);
    expect(s.corp.hq.map(c => c.instanceId)).toEqual(expect.arrayContaining([barrier.instanceId, sentry.instanceId]));
    expect(s.corp.credits).toBe(0);
  });

  it('Tocsin\'s subroutines take 2 credits and end the run', () => {
    let s = newGame();
    installIceForTest(s, V.tocsin, 'remote-1');
    s.runner.credits = 5;
    s = cont(cont(run(s, 'remote-1')));
    expect(s.runner.credits).toBe(3);
    expect(s.activeRun).toBeNull();
  });
});

describe('Vantage Point operations', () => {
  it('Caveat Emptor: 6 credits and the Runner gets 1 fewer click next turn, or 10 and 1 more', () => {
    let s = newGame();
    let credits: number;
    [s] = playCorp(s, V.caveat);
    credits = s.corp.credits;
    s = choose(s, 'six');
    expect(s.corp.credits).toBe(credits + 6);
    s = passTurn(s);
    expect(s.runner.clicks).toBe(3);
    let t = newGame();
    [t] = playCorp(t, V.caveat);
    credits = t.corp.credits;
    t = choose(t, 'ten');
    expect(t.corp.credits).toBe(credits + 10);
    t = passTurn(t);
    expect(t.runner.clicks).toBe(5);
  });

  it('realloc() gains the printed rez cost of 2 rezzed ice and derezzes them', () => {
    let s = newGame();
    const a = installIceForTest(s, SG.palisade, 'hq'); // 3
    const b = installIceForTest(s, SG.tithe, 'rd'); // 1
    let credits = 0;
    corpTurn(s, 2);
    const id = giveCard(s, 'corp', V.realloc);
    credits = s.corp.credits;
    s = play(s, 'corp', id);
    expect(s.corp.clicks).toBe(0);
    s = pick(s, [a, b]);
    expect(s.corp.credits).toBe(credits + 4);
    expect(card(s, a).isRezzed).toBe(false);
    expect(card(s, b).isRezzed).toBe(false);
  });

  it('Retirement Plan installs an agenda, asset or ice from Archives', () => {
    let s = newGame();
    const regolith = createCardInstance(s, SG.regolith);
    s.corp.archives.faceDown.push(regolith);
    [s] = playCorp(s, V.retirement);
    s = pick(s, [regolith.instanceId]);
    s = choose(s, 'new');
    expect(Object.values(s.corp.servers).some(v => v.root.some(c => c.instanceId === regolith.instanceId))).toBe(true);
  });

  it('Cultivate trashes 1 of the top 5, adds 1 to HQ and arranges the rest', () => {
    let s = newGame();
    const top5 = s.corp.rd.slice(0, 5).map(c => c.instanceId);
    [s] = playCorp(s, V.cultivate);
    s = pick(s, [top5[0]]);
    s = pick(s, [top5[1]]);
    s = pick(s, [top5[4]]);
    s = pick(s, [top5[3]]);
    expect(s.corp.archives.faceDown.map(c => c.instanceId)).toContain(top5[0]);
    expect(s.corp.hq.map(c => c.instanceId)).toContain(top5[1]);
    expect(s.corp.rd.slice(0, 3).map(c => c.instanceId)).toEqual([top5[4], top5[3], top5[2]]);
  });

  it('Unleash removes a tag to rez ice for free and resolve 1 of its subroutines', () => {
    let s = newGame();
    const tithe = installIceForTest(s, SG.tithe, 'hq', false);
    s.runner.grip.push(...s.runner.stack.splice(0, 3));
    const id = giveCard(s, 'corp', V.unleash);
    corpTurn(s);
    expect(isLegalAction(s, { type: 'PLAY_OPERATION_OR_EVENT', player: 'corp', cardInstanceId: id })).toBe(false); // no tag
    s.runner.tags = 1;
    const grip = s.runner.grip.length;
    s = play(s, 'corp', id);
    expect(s.runner.tags).toBe(0);
    s = pick(s, [tithe]);
    expect(card(s, tithe).isRezzed).toBe(true);
    s = choose(s, '0'); // Do 1 net damage
    expect(s.runner.grip.length).toBe(grip - 1);
  });

  it('Flood the Market places 1 counter for each iced remote with a card in its root', () => {
    let s = newGame();
    const target = installCorpForTest(s, SG.offworld, 'remote-1');
    installIceForTest(s, SG.palisade, 'remote-1', false);
    installCorpForTest(s, SG.regolith, 'remote-2');
    installIceForTest(s, SG.palisade, 'remote-2', false);
    installCorpForTest(s, SG.regolith, 'remote-3'); // no ice
    [s] = playCorp(s, V.flood);
    s = pick(s, [target]);
    expect(card(s, target).advancementCounters).toBe(2);
  });

  it('Scapegoat: the Runner chooses between 2 bad publicity off and a card shuffled into their stack', () => {
    let s = newGame();
    s.corp.badPublicity = 3;
    const cleaver = installProgramForTest(s, SG.cleaver);
    [s] = playCorp(s, V.scapegoat);
    expect(prompt(s)?.side).toBe('runner');
    const bp = choose(s, 'bp');
    expect(bp.corp.badPublicity).toBe(1);
    let shuffle = choose(s, 'shuffle');
    shuffle = pick(shuffle, [cleaver]);
    expect(shuffle.runner.stack.map(c => c.instanceId)).toContain(cleaver);
  });

  it('Myōshu can only follow scoring an agenda installed before this turn, and is worth 2 points', () => {
    let s = newGame();
    corpTurn(s);
    const id = giveCard(s, 'corp', V.myoshu);
    s.corp.credits = 10;
    expect(isLegalAction(s, { type: 'PLAY_OPERATION_OR_EVENT', player: 'corp', cardInstanceId: id })).toBe(false);
    s = scoreForTest(s, SG.offworld);
    s.corp.credits = 10;
    s = play(s, 'corp', id);
    expect(s.corp.scoreArea.map(c => c.instanceId)).toContain(id);
    expect(s.corp.score).toBe(4);
  });

  it('Reanimation Protocol installs and rezzes ice from Archives for 10 less, with bad publicity for non-liability ice', () => {
    let s = newGame();
    const ice = createCardInstance(s, '30063'); // Pharos, rez 7
    s.corp.archives.faceUp.push(ice);
    corpTurn(s);
    const id = giveCard(s, 'corp', V.reanimation);
    s.corp.credits = 2;
    s = play(s, 'corp', id);
    s = pick(s, [ice.instanceId]);
    s = choose(s, 'hq');
    expect(card(s, ice.instanceId).isRezzed).toBe(true);
    expect(s.corp.credits).toBe(0);
    expect(s.corp.badPublicity).toBe(1);
  });

  it('Vulture Fund gains 14 and gives the Corp 1 bad publicity', () => {
    let s = newGame();
    corpTurn(s);
    const id = giveCard(s, 'corp', V.vulture);
    s.corp.credits = 7;
    s = play(s, 'corp', id);
    expect(s.corp.credits).toBe(14);
    expect(s.corp.badPublicity).toBe(1);
  });
});

describe('Vantage Point upgrades', () => {
  it('Perfect Recall reveals a card from HQ so the Runner cannot steal copies of it this run', () => {
    let s = newGame();
    emptyHQ(s);
    const pr = installCorpForTest(s, V.perfectRecall, 'remote-1');
    s = rezForTest(s, pr);
    expect(card(s, pr).tokens.power).toBe(1);
    installCorpForTest(s, SG.offworld, 'remote-1');
    s.corp.hq.push(createCardInstance(s, SG.offworld));
    s = run(s, 'remote-1');
    s = useAbility(s, 'corp', pr);
    s = pick(s, [s.corp.hq[0].instanceId]);
    expect(s.activeRun?.protectedTitles).toEqual(['Offworld Office']);
    s = cont(s);
    for (let i = 0; i < 5 && s.activeRun; i++) {
      const p = prompt(s);
      if (p?.kind === 'access_order') s = keepGoing(answer(s, { kind: 'access_order', optionId: p.options[p.options.length - 1].id }));
      else if (p?.kind === 'access_trash') s = declineAccess(s);
      else break;
    }
    expect(s.runner.score).toBe(0);
  });

  it('The Red Room is central only, gets a counter when an agenda is scored, and ends a run on another server', () => {
    let s = newGame();
    corpTurn(s);
    const id = giveCard(s, 'corp', V.redRoom);
    expect(isLegalAction(s, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: id, asNewRemote: true })).toBe(false);
    expect(isLegalAction(s, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: id, targetServerId: 'hq' })).toBe(true);
    const room = rezzed(s, V.redRoom, 'hq');
    s = scoreForTest(s, SG.offworld);
    expect(card(s, room).tokens.power).toBe(1);
    installIceForTest(s, SG.palisade, 'remote-1', false);
    s = run(s, 'remote-1');
    s = useAbility(s, 'corp', room);
    expect(s.activeRun).toBeNull();
  });

  it('Hype Machine rezzes for free after an agenda is scored and trashes itself to advance a card in its root', () => {
    let s = newGame();
    corpTurn(s);
    const hype = installCorpForTest(s, V.hype, 'remote-1');
    const agenda = installCorpForTest(s, SG.offworld, 'remote-1');
    expect(rezCost(s, card(s, hype))).toBe(6);
    s = scoreForTest(s, SG.offworld, 'remote-9');
    expect(rezCost(s, card(s, hype))).toBe(0);
    s.corp.credits = 0;
    s = executeAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: hype });
    s = useAbility(s, 'corp', hype);
    s = pick(s, [agenda]);
    expect(card(s, agenda).advancementCounters).toBe(1);
    expect(s.corp.archives.faceUp.map(c => c.instanceId)).toContain(hype);
  });

  it('Flagship: HQ or R&D only; runs there are not successful and the Runner accesses at most 1 other card', () => {
    let s = newGame();
    corpTurn(s);
    const id = giveCard(s, 'corp', V.flagship);
    expect(isLegalAction(s, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: id, targetServerId: 'archives' })).toBe(false);
    expect(isLegalAction(s, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: id, targetServerId: 'rd' })).toBe(true);
    const flag = rezzed(s, V.flagship, 'hq');
    startRunnerTurn(s);
    s.runner.rig.hardware.push(Object.assign(createCardInstance(s, '30013'), { isRezzed: true })); // Docklands Pass: +1 HQ access
    s = cont(run(s, 'hq'));
    expect(s.runsThisTurn[0].successful).toBe(false);
    expect(s.activeRun?.notDeclaredSuccessful).toBe(true);
    // Flagship is accessed first (the test helper takes root cards first), then 1 card from HQ;
    // Docklands Pass's second HQ access never happens (rules 7.4.2b)
    expect(prompt(s)).toMatchObject({ kind: 'access_trash', cardInstanceId: flag });
    s = finishBreach(s);
    expect(s.activeRun).toBeNull();
    expect(s.log.filter(l => l.event === 'access').length).toBe(2);
  });

  it('Shackleton Grid does 4 meat damage when the Runner spends credits from outside their pool', () => {
    let s = newGame();
    const grid = installCorpForTest(s, V.shackleton, 'remote-1');
    s = rezForTest(s, grid);
    installIceForTest(s, V.paywall, 'remote-1');
    s.corp.badPublicity = 1;
    s.runner.credits = 0;
    s.runner.grip.push(...s.runner.stack.splice(0, 5));
    const grip = s.runner.grip.length;
    s = cont(run(s, 'remote-1'));
    s = cont(s);
    s = choose(s, 'pay'); // the bad publicity credit pays Paywall's subroutine
    expect(source(s)).toMatchObject({ cardCode: V.shackleton });
    s = choose(s, 'yes');
    expect(s.runner.grip.length).toBe(grip - 4);
  });

  it('Shackleton Grid makes the Runner spend from their pool first', () => {
    let s = newGame();
    const grid = installCorpForTest(s, V.shackleton, 'remote-1');
    s = rezForTest(s, grid);
    installIceForTest(s, V.paywall, 'remote-1');
    s.corp.badPublicity = 1;
    s.runner.credits = 2;
    s = cont(run(s, 'remote-1')); // Paywall: lose 1 from the pool
    s = cont(s);
    s = choose(s, 'pay');
    expect(s.pendingPrompts.length).toBe(0);
    expect(s.activeRun?.badPublicityCredits).toBe(1);
    expect(availableCredits(s, 'runner')).toBe(1);
  });
});

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

void cardDef;
void SG;
void V.touchstone;
