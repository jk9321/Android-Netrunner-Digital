import { describe, expect, it } from 'vitest';
import { cardDef, createCardInstance, executeAction, findCardAnywhere, GameState, iceStrength, isLegalAction } from '../src/core';
import { counters } from '../src/core/engine/cardEffects';
import { answerPrompt } from '../src/ai/prompts';
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
  scoreForTest,
  setIdentity,
  startRunnerTurn,
  useAbility,
} from './helpers';

const C = {
  leo: '35035', poetri: '35036', trendsetting: '35037', ingatan: '35038', humanoid: '35039', otto: '35040', bumi: '35041',
  scatter: '35042', nano: '35043', topDown: '35044', mercia: '35045', auCo: '35046', untaian: '35047', proprionegation: '35048',
  sericulture: '35049', byte: '35050', phat: '35051', empiricist: '35052', mycoweb: '35053', semak: '35054', peerReview: '35055',
  mitra: '35056', nebula: '35057', synapse: '35058', embedded: '35059', nbt: '35060', idio: '35061', plaza: '35062',
  doomscroll: '35063', nPot: '35064', bigger: '35065', ip: '35066', touchUps: '35067', bangun: '35068', zwicky: '35069',
  greenmail: '35070', offBooks: '35071', anthill: '35072', plutus: '35073', biawak: '35074', kessleroid: '35075',
  syailendra: '35076', kpi: '35077', measured: '35078', flyswatter: '35079', lamplighter: '35080', pettyCash: '35081', mahkota: '35082',
};
const SG = {
  hedgeFund: '30075', palisade: '30072', whitespace: '30074', regolith: '30071', ping: '30055', leech: '30008', cleaver: '30006',
  mayfly: '30032', sureGamble: '30030', smartware: '30033', funhouse: '30054', tithe: '30073',
};

const card = (s: GameState, id: string) => findCardAnywhere(s, id)!;
const choose = (s: GameState, optionId: string) => answer(s, { kind: 'effect_choice', optionId });
const pick = (s: GameState, ids: string[]) => answer(s, { kind: 'effect_cards', cardInstanceIds: ids });
const prompt = (s: GameState) => s.pendingPrompts[0];
const optionIds = (s: GameState) => {
  const p = prompt(s);
  return p?.kind === 'effect_choice' ? p.options.map(o => o.id) : [];
};
const candidates = (s: GameState) => {
  const p = prompt(s);
  return p?.kind === 'effect_cards' ? p.candidateIds : [];
};
/** Makes it the Corp's turn with 3 clicks (test setup only). */
function corpTurn(s: GameState): void {
  s.activePlayer = 'corp';
  s.phase = 'corp_turn';
  s.corp.clicks = 3;
}
/** Plays a Corp operation from HQ with spare credits. */
function playCorp(s: GameState, code: string, clicks = 3): [GameState, string] {
  corpTurn(s);
  s.corp.clicks = clicks;
  const id = giveCard(s, 'corp', code);
  s.corp.credits += 10;
  return [play(s, 'corp', id), id];
}
/** Puts a fresh copy of a card on top of R&D. */
function topOfRD(s: GameState, code: string): string {
  const c = createCardInstance(s, code);
  s.corp.rd.unshift(c);
  return c.instanceId;
}
/** Passes the Corp's turn and the Runner's, so the next Corp turn begins. */
function toNextCorpTurn(s: GameState): GameState {
  if (s.activePlayer === 'corp') s = passTurn(s);
  return passTurn(s);
}

describe('Elevation Corp identities', () => {
  it('LEO Construction trashes a rezzed bioroid on the attacked server to end the run', () => {
    let s = newGame();
    setIdentity(s, 'corp', C.leo);
    const bumi = installIceForTest(s, C.bumi, 'hq');
    s = run(s, 'hq');
    expect(isLegalAction(s, { type: 'USE_ABILITY', player: 'corp', cardInstanceId: s.corp.identity.instanceId, abilityIndex: 0 })).toBe(true);
    s = useAbility(s, 'corp', s.corp.identity.instanceId);
    s = pick(s, [bumi]);
    expect(s.activeRun).toBeNull();
    expect(s.corp.servers.hq.ice).toHaveLength(0);
  });

  it('Poétrï installs a non-agenda card from the top of R&D when scoring', () => {
    let s = newGame();
    setIdentity(s, 'corp', C.poetri);
    const plaza = topOfRD(s, C.plaza);
    s = scoreForTest(s, C.greenmail);
    expect(candidates(s)).toContain(plaza);
    s = pick(s, [plaza]);
    s = choose(s, 'new');
    expect(Object.values(s.corp.servers).some(sv => sv.root.some(c => c.instanceId === plaza))).toBe(true);
  });

  it('AU Co. gains power counters from damage and spends 2 to filter R&D', () => {
    let s = newGame();
    setIdentity(s, 'corp', C.auCo);
    installIceForTest(s, C.doomscroll, 'hq');
    s = cont(cont(run(s, 'hq'))); // give a tag, 1 net damage
    expect(counters(s.corp.identity, 'power')).toBe(1);
    s.corp.identity.tokens.power = 2;
    if (s.activeRun) s = cont(s);
    while (s.pendingPrompts.length > 0 && prompt(s).side === 'runner') s = answer(s, { kind: 'access_trash', trash: false });
    s = toNextCorpTurn(s);
    expect(optionIds(s)).toContain('use');
    s = choose(s, 'use');
    const top = candidates(s);
    expect(top).toHaveLength(3);
    const hq = s.corp.hq.length;
    s = pick(s, [top[0]]);
    expect(s.corp.hq.length).toBe(hq + 3); // 2 kept, then the mandatory draw
    expect(counters(s.corp.identity, 'power')).toBe(0);
  });

  it('PT Untaian places an advancement counter when HQ is small', () => {
    let s = newGame();
    setIdentity(s, 'corp', C.untaian);
    const plaza = installCorpForTest(s, C.idio, 'remote1');
    s.corp.rd.push(...s.corp.hq.splice(0));
    const credits = s.corp.credits;
    s = passTurn(s);
    expect(candidates(s)).toContain(plaza);
    s = pick(s, [plaza]);
    expect(card(s, plaza).advancementCounters).toBe(1);
    expect(s.corp.credits).toBe(credits - 1);
  });

  it('Nebula flips after an operation turn, then gains a click on the first operation', () => {
    let s = newGame();
    setIdentity(s, 'corp', C.nebula);
    [s] = playCorp(s, SG.hedgeFund, 1);
    const credits = s.corp.credits;
    s = passTurn(s);
    expect(s.corp.identity.flipped).toBe(true);
    expect(s.corp.credits).toBe(credits + 1);
    [s] = playCorp(s, SG.hedgeFund, 2);
    expect(s.corp.clicks).toBe(2);
  });

  it('Synapse Global removes a tag for 2 credits and installs from HQ for free', () => {
    let s = newGame();
    setIdentity(s, 'corp', C.synapse);
    corpTurn(s);
    s.runner.tags = 1;
    const asset = giveCard(s, 'corp', C.anthill);
    const credits = s.corp.credits;
    s = useAbility(s, 'corp', s.corp.identity.instanceId);
    expect(s.runner.tags).toBe(0);
    expect(s.corp.credits).toBe(credits + 2);
    s = pick(s, [asset]);
    s = choose(s, 'new');
    expect(s.corp.credits).toBe(credits + 2);
    expect(s.corp.hq.some(c => c.instanceId === asset)).toBe(false);
  });

  it('Synapse Global: the Runner knows the revealed card once it is installed (rules 1.21.3)', () => {
    let s = newGame();
    setIdentity(s, 'corp', C.synapse);
    corpTurn(s);
    s.runner.tags = 1;
    const ice = giveCard(s, 'corp', SG.funhouse);
    s = useAbility(s, 'corp', s.corp.identity.instanceId);
    s = pick(s, [ice]);
    s = choose(s, 'new');
    expect(card(s, ice).isRezzed).toBe(false);
    expect(card(s, ice).runnerKnows).toBe(true);
  });

  it('BANGUN punishes accessing a faceup agenda', () => {
    let s = newGame();
    setIdentity(s, 'corp', C.bangun);
    const agenda = installCorpForTest(s, C.greenmail, 'remote1');
    card(s, agenda).faceUp = true;
    s.runner.grip.push(...s.runner.stack.splice(0, 5));
    const grip = s.runner.grip.length;
    s = cont(run(s, 'remote1'));
    expect(s.runner.grip.length).toBe(grip - 2);
    expect(s.runner.tags).toBe(1);
  });

  it('The Zwicky Group draws when an operation gains credits', () => {
    let s = newGame();
    setIdentity(s, 'corp', C.zwicky);
    s.corp.hq = [];
    [s] = playCorp(s, C.peerReview);
    while (prompt(s)?.kind === 'effect_cards') s = pick(s, []);
    expect(optionIds(s)).toContain('draw');
    s = choose(s, 'draw');
    expect(s.corp.hq.length).toBe(1);
  });
});

describe('Elevation agendas', () => {
  it('Greenmail gains 2 when scored and 4 when forfeited (to Biawak)', () => {
    let s = newGame();
    const credits = s.corp.credits;
    s = scoreForTest(s, C.greenmail);
    expect(s.corp.credits).toBe(credits + 2);
    const biawak = installIceForTest(s, C.biawak, 'hq', false);
    s = run(s, 'hq');
    s.corp.credits = 4;
    s = executeAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: biawak });
    s = choose(s, optionIds(s).find(id => id !== 'pay')!);
    expect(card(s, biawak).isRezzed).toBe(true);
    expect(s.corp.scoreArea).toHaveLength(0);
    expect(s.corp.credits).toBe(4);
  });

  it('Project Ingatan gets dividends and installs a card from Archives for free', () => {
    let s = newGame();
    const id = installCorpForTest(s, C.ingatan, 'remote-score');
    card(s, id).advancementCounters = 4;
    corpTurn(s);
    s = executeAction(s, { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: id });
    expect(counters(card(s, id), 'agenda')).toBe(1);
    const ice = createCardInstance(s, SG.palisade);
    s.corp.archives.faceUp.push(ice);
    s = passTurn(s);
    s = choose(s, 'use');
    s = pick(s, [ice.instanceId]);
    s = choose(s, 'hq');
    expect(s.corp.servers.hq.ice.map(c => c.instanceId)).toContain(ice.instanceId);
    expect(counters(card(s, id), 'agenda')).toBe(0);
  });

  it('Sericulture Expansion places 2 advancement counters', () => {
    let s = newGame();
    const id = installCorpForTest(s, C.sericulture, 'remote-score');
    card(s, id).advancementCounters = 4;
    corpTurn(s);
    s = executeAction(s, { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: id });
    const target = installCorpForTest(s, C.idio, 'remote1');
    s = passTurn(s);
    s = choose(s, 'use');
    s = pick(s, [target]);
    expect(card(s, target).advancementCounters).toBe(2);
  });

  it('Embedded Reporting puts an operation from R&D on top', () => {
    let s = newGame();
    const id = installCorpForTest(s, C.embedded, 'remote-score');
    card(s, id).advancementCounters = 4;
    corpTurn(s);
    s = executeAction(s, { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: id });
    expect(counters(card(s, id), 'agenda')).toBe(2);
    const op = createCardInstance(s, C.kpi);
    s.corp.rd.push(op);
    s = passTurn(s);
    s = choose(s, 'use');
    s = pick(s, [op.instanceId]);
    expect(s.corp.rd[0].instanceId).toBe(op.instanceId);
  });

  it('Off the Books installs a card from R&D ignoring all costs', () => {
    let s = newGame();
    const id = installCorpForTest(s, C.offBooks, 'remote-score');
    card(s, id).advancementCounters = 4;
    corpTurn(s);
    s = executeAction(s, { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: id });
    const ice = createCardInstance(s, C.biawak);
    s.corp.rd.push(ice);
    s.corp.credits = 0;
    s = passTurn(s);
    s = choose(s, 'use');
    s = pick(s, [ice.instanceId]);
    s = choose(s, 'rd');
    expect(s.corp.servers.rd.ice.map(c => c.instanceId)).toContain(ice.instanceId);
  });

  it('Proprionegation moves the Runner to Archives', () => {
    let s = newGame();
    s = scoreForTest(s, C.proprionegation);
    const agenda = s.corp.scoreArea[0].instanceId;
    installIceForTest(s, SG.palisade, 'hq');
    s = run(s, 'hq');
    s = useAbility(s, 'corp', agenda);
    expect(s.activeRun?.server).toBe('archives');
    expect(counters(card(s, agenda), 'agenda')).toBe(0);
  });

  it('Next Big Thing can be used from the Runner score area', () => {
    let s = newGame();
    const nbt = createCardInstance(s, C.nbt);
    nbt.tokens.agenda = 1;
    s.runner.scoreArea.push(nbt);
    corpTurn(s);
    const hq = s.corp.hq.length;
    s = useAbility(s, 'corp', nbt.instanceId);
    expect(s.corp.hq.length).toBe(hq + 4);
    s = pick(s, s.corp.hq.slice(0, 2).map(c => c.instanceId));
    expect(s.corp.hq.length).toBe(hq + 2);
  });

  it('Aggressive Trendsetting gives the Corp an extra click if the Runner does not spend one', () => {
    let s = newGame();
    s = scoreForTest(s, C.trendsetting);
    installCorpForTest(s, C.plaza, 'remote1', true);
    startRunnerTurn(s);
    s.runner.credits = 10;
    s = cont(run(s, 'remote1'));
    s = answer(s, { kind: 'access_trash', trash: true });
    expect(prompt(s)?.side).toBe('runner');
    s = choose(s, 'no');
    expect(s.corp.bonusClicksNextTurn).toBe(1);
  });
});

describe('Elevation assets', () => {
  it('Humanoid Resources gains 4, draws 3 and installs from HQ', () => {
    let s = newGame();
    const hr = installCorpForTest(s, C.humanoid, 'remote1', true);
    corpTurn(s);
    const credits = s.corp.credits;
    const hq = s.corp.hq.length;
    s = useAbility(s, 'corp', hr);
    expect(s.corp.credits).toBe(credits + 4);
    expect(s.corp.hq.length).toBe(hq + 3);
    expect(s.corp.archives.faceUp.map(c => c.instanceId)).toContain(hr);
    expect(prompt(s)?.side).toBe('corp');
  });

  it('Otto Campaign loads 6, pays out 2 per turn and gives 2 clicks when empty', () => {
    let s = newGame();
    const otto = installCorpForTest(s, C.otto, 'remote1');
    s = rezForTest(s, otto);
    expect(counters(card(s, otto), 'credit')).toBe(6);
    card(s, otto).tokens.credit = 2;
    const credits = s.corp.credits;
    s = toNextCorpTurn(s);
    expect(s.corp.credits).toBe(credits + 2);
    expect(s.corp.clicks).toBe(5);
    expect(s.corp.archives.faceUp.map(c => c.instanceId)).toContain(otto);
  });

  it('Byte! tags and does 3 net damage when the Corp pays 4', () => {
    let s = newGame();
    installCorpForTest(s, C.byte, 'remote1');
    s.runner.grip.push(...s.runner.stack.splice(0, 5));
    s.corp.credits = 5;
    const grip = s.runner.grip.length;
    s = cont(run(s, 'remote1'));
    s = choose(s, 'pay');
    expect(s.runner.tags).toBe(1);
    expect(s.runner.grip.length).toBe(grip - 3);
    expect(s.corp.credits).toBe(1);
  });

  it('Phật Gioan Baotixita does extra net damage for power counters', () => {
    let s = newGame();
    const phat = installCorpForTest(s, C.phat, 'remote1', true);
    card(s, phat).tokens.power = 2;
    s.runner.grip.push(...s.runner.stack.splice(0, 5));
    const grip = s.runner.grip.length;
    s = scoreForTest(s, C.greenmail);
    s = choose(s, '2');
    expect(s.runner.grip.length).toBe(grip - 3);
    s = passTurn(s);
    expect(counters(card(s, phat), 'power')).toBe(1);
  });

  it('Idiosyncresis trashes itself for 3 credits per counter; the Runner loses 2 each', () => {
    let s = newGame();
    const idio = installCorpForTest(s, C.idio, 'remote1', true);
    card(s, idio).advancementCounters = 2;
    s = passTurn(s);
    s.runner.credits = 10;
    s = passTurn(s);
    const credits = s.corp.credits;
    s = choose(s, 'trash');
    expect(s.corp.credits).toBe(credits + 6);
    expect(s.runner.credits).toBe(6);
  });

  it('Public Access Plaza gains 1 each turn and tags at threat 2 when trashed', () => {
    let s = newGame();
    const plaza = installCorpForTest(s, C.plaza, 'remote1', true);
    const credits = s.corp.credits;
    s = toNextCorpTurn(s);
    expect(s.corp.credits).toBe(credits + 1);
    s.corp.score = 2;
    startRunnerTurn(s);
    s.runner.credits = 10;
    s = cont(run(s, 'remote1'));
    s = answer(s, { kind: 'access_trash', trash: true });
    expect(s.runner.tags).toBe(1);
    expect(plaza).toBeTruthy();
  });

  it('Anthill Excavation Contract loads 8 and takes 4 plus a card each turn', () => {
    let s = newGame();
    const anthill = installCorpForTest(s, C.anthill, 'remote1');
    s = rezForTest(s, anthill);
    expect(counters(card(s, anthill), 'credit')).toBe(8);
    const credits = s.corp.credits;
    s = toNextCorpTurn(s);
    expect(s.corp.credits).toBe(credits + 4);
    expect(counters(card(s, anthill), 'credit')).toBe(4);
  });

  it('Plutus needs 3 HQ cards trashed to rez, then replays transactions from Archives', () => {
    let s = newGame();
    const plutus = installCorpForTest(s, C.plutus, 'remote1');
    corpTurn(s);
    s = executeAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: plutus });
    s = choose(s, 'hq');
    s = pick(s, s.corp.hq.slice(0, 3).map(c => c.instanceId));
    expect(card(s, plutus).isRezzed).toBe(true);
    const hedge = createCardInstance(s, C.kpi);
    s.corp.archives.faceUp.push(hedge);
    s = toNextCorpTurn(s);
    s = pick(s, [hedge.instanceId]);
    expect(optionIds(s)).toContain('credits');
  });
});

describe('Elevation ice', () => {
  it('Bumi 1.0 trashes a program and does core damage', () => {
    let s = newGame();
    installIceForTest(s, C.bumi, 'hq');
    const leech = installProgramForTest(s, SG.leech);
    s = cont(cont(run(s, 'hq')));
    s = pick(s, [leech]);
    expect(s.runner.rig.programs).toHaveLength(0);
    expect(s.runner.coreDamage).toBe(1);
  });

  it('Scatter Field is +4 strength while alone', () => {
    const s = newGame();
    const sf = installIceForTest(s, C.scatter, 'hq');
    expect(iceStrength(s, card(s, sf))).toBe(4);
    installIceForTest(s, SG.palisade, 'hq');
    expect(iceStrength(s, card(s, sf))).toBe(0);
  });

  it('Empiricist draws and tops a card, then net damage and a tag', () => {
    let s = newGame();
    installIceForTest(s, C.empiricist, 'hq');
    s.runner.grip.push(...s.runner.stack.splice(0, 5));
    s = cont(cont(run(s, 'hq')));
    const top = s.corp.hq[0].instanceId;
    s = pick(s, [top]);
    expect(s.corp.rd[0].instanceId).toBe(top);
    expect(s.runner.tags).toBe(1);
  });

  it('Mycoweb rezzes an ice for 2 less', () => {
    let s = newGame();
    const inner = installIceForTest(s, SG.palisade, 'hq', false);
    installIceForTest(s, C.mycoweb, 'hq');
    s = cont(cont(run(s, 'hq')));
    s.corp.credits = 10;
    const cost = cardDef(card(s, inner)).cost ?? 0;
    s = pick(s, [inner]);
    expect(card(s, inner).isRezzed).toBe(true);
    expect(s.corp.credits).toBe(10 - Math.max(0, cost - 2));
  });

  it('N-Pot can be broken for 3 credits and ends the run at threat 2+', () => {
    let s = newGame();
    const npot = installIceForTest(s, C.nPot, 'hq');
    s.runner.credits = 3;
    s = cont(run(s, 'hq'));
    s = executeAction(s, { type: 'BIOROID_BREAK', player: 'runner', subroutineIndex: 0 });
    expect(s.runner.credits).toBe(0);
    expect(npot).toBeTruthy();
    expect(s.activeRun?.encounter?.broken[0]).toBe(true);
    s = cont(s);
    expect(s.activeRun).not.toBeNull();
    let t = newGame();
    t.runner.score = 2;
    installIceForTest(t, C.nPot, 'hq');
    t = cont(run(t, 'hq'));
    t.activeRun!.encounter!.broken[0] = true;
    t = cont(t);
    expect(t.activeRun).toBeNull();
  });

  it('Syailendra advances a card when it has 3 counters', () => {
    let s = newGame();
    const sy = installIceForTest(s, C.syailendra, 'hq');
    card(s, sy).advancementCounters = 3;
    const target = installCorpForTest(s, C.idio, 'remote1');
    s = cont(run(s, 'hq'));
    expect(candidates(s)).toContain(target);
    s = pick(s, [target]);
    expect(card(s, target).advancementCounters).toBe(1);
  });

  it('Flyswatter purges virus counters when rezzed during a run on its server', () => {
    let s = newGame();
    const fly = installIceForTest(s, C.flyswatter, 'hq', false);
    const leech = installProgramForTest(s, SG.leech);
    card(s, leech).tokens.virus = 2;
    s = run(s, 'hq');
    s = rezForTest(s, fly);
    expect(counters(card(s, leech), 'virus')).toBe(0);
  });

  it('Lamplighter tags a broke Runner and ends the run; it is trashed when an agenda is scored from its server', () => {
    let s = newGame();
    const lamp = installIceForTest(s, C.lamplighter, 'remote-score');
    s.runner.credits = 0;
    s = cont(cont(run(s, 'remote-score')));
    expect(s.runner.tags).toBe(1);
    expect(s.activeRun).toBeNull();
    s = scoreForTest(s, C.greenmail);
    expect(s.corp.archives.faceUp.map(c => c.instanceId)).toContain(lamp);
  });
});

describe('Elevation operations', () => {
  it('Nanomanagement gains 2 clicks', () => {
    const [s] = playCorp(newGame(), C.nano, 1);
    expect(s.corp.clicks).toBe(2);
  });

  it('Top-Down Solutions draws 2 and offers installs', () => {
    const s0 = newGame();
    const hq = s0.corp.hq.length;
    const [s] = playCorp(s0, C.topDown, 1);
    expect(s.corp.hq.length).toBe(hq + 2);
    expect(prompt(s)?.kind).toBe('effect_cards');
  });

  it('Peer Review gains 7', () => {
    const s0 = newGame();
    s0.corp.hq = [];
    const credits = s0.corp.credits + 10;
    const [s] = playCorp(s0, C.peerReview, 1);
    expect(s.corp.credits).toBe(credits - 4 + 7);
  });

  it('Bigger Picture removes tags for 5 credits each', () => {
    const s0 = newGame();
    s0.runner.tags = 2;
    s0.runner.credits = 12;
    let [s] = playCorp(s0, C.bigger, 1);
    const credits = s.corp.credits;
    s = choose(s, '2');
    expect(s.runner.tags).toBe(0);
    expect(s.runner.credits).toBe(2);
    expect(s.corp.credits).toBe(credits + 10);
  });

  it('IP Enforcement takes back a stolen agenda', () => {
    const s0 = newGame();
    const agenda = createCardInstance(s0, C.greenmail);
    s0.runner.scoreArea.push(agenda);
    s0.runner.score = 1;
    s0.runner.tags = 2;
    let [s] = playCorp(s0, C.ip, 1);
    s = choose(s, agenda.instanceId);
    s = choose(s, 'new');
    expect(s.runner.score).toBe(0);
    expect(s.runner.tags).toBe(1);
    expect(card(s, agenda.instanceId).advancementCounters).toBe(1);
  });

  it('IP Enforcement lets the Corp choose X (rule 1.16.6c), one option per agenda worth X', () => {
    const s0 = newGame();
    const one = createCardInstance(s0, C.greenmail);
    const two = createCardInstance(s0, C.ingatan);
    const three = createCardInstance(s0, C.nbt);
    s0.runner.scoreArea.push(one, two, three);
    s0.runner.score = 6;
    s0.runner.tags = 2;
    let [s] = playCorp(s0, C.ip, 1);
    const prompt = s.pendingPrompts[0];
    expect(prompt.kind).toBe('effect_choice');
    if (prompt.kind !== 'effect_choice') return;
    // X = 3 costs more tags than the Runner has, so only X = 1 and X = 2
    expect(prompt.options.map(o => o.id)).toEqual([one.instanceId, two.instanceId]);
    expect(prompt.options[0].label).toContain('X = 1: remove 1 of 2 tag(s)');
    expect(prompt.options[1].label).toContain('X = 2: remove 2 of 2 tag(s)');
    s = choose(s, two.instanceId);
    s = choose(s, 'new');
    expect(s.runner.tags).toBe(0);
    expect(s.runner.score).toBe(4);
    expect(card(s, two.instanceId).advancementCounters).toBe(0); // no tags left, no counter
  });

  it('IP Enforcement: the AI Corp takes back the agenda worth the most points', () => {
    const s0 = newGame();
    const one = createCardInstance(s0, C.greenmail);
    const two = createCardInstance(s0, C.ingatan);
    s0.runner.scoreArea.push(one, two);
    s0.runner.score = 3;
    s0.runner.tags = 3;
    const [s] = playCorp(s0, C.ip, 1);
    for (const synergy of [false, true]) {
      const action = answerPrompt(s, 'corp', undefined, synergy);
      expect(action.type === 'RESOLVE_PROMPT' && action.choice).toEqual({ kind: 'effect_choice', optionId: two.instanceId });
    }
  });

  it('Touch-ups advances twice and shuffles grip cards back', () => {
    const s0 = newGame();
    const target = installCorpForTest(s0, C.idio, 'remote1');
    s0.runner.grip = [createCardInstance(s0, SG.sureGamble), createCardInstance(s0, SG.sureGamble)];
    let [s] = playCorp(s0, C.touchUps, 2);
    expect(s.corp.clicks).toBe(0);
    s = pick(s, [target]);
    s = choose(s, 'event');
    s = pick(s, s.runner.grip.map(c => c.instanceId));
    expect(card(s, target).advancementCounters).toBe(2);
    expect(s.runner.grip).toHaveLength(0);
  });

  it('Key Performance Indicators resolves two effects', () => {
    const s0 = newGame();
    const target = installCorpForTest(s0, C.idio, 'remote1');
    let [s] = playCorp(s0, C.kpi, 1);
    const credits = s.corp.credits;
    s = choose(s, 'credits');
    s = choose(s, 'advance');
    s = pick(s, [target]);
    expect(s.corp.credits).toBe(credits + 2);
    expect(card(s, target).advancementCounters).toBe(1);
    expect(s.pendingPrompts).toHaveLength(0);
  });

  it('Measured Response needs threat 4 and a successful run last turn', () => {
    const s = newGame();
    corpTurn(s);
    s.corp.credits = 10;
    const id = giveCard(s, 'corp', C.measured);
    expect(isLegalAction(s, { type: 'PLAY_OPERATION_OR_EVENT', player: 'corp', cardInstanceId: id })).toBe(false);
    s.corp.score = 4;
    s.runnerLastTurnRuns = [{ server: 'hq', successful: true } as never];
    s.runner.credits = 3;
    s.runner.grip.push(...s.runner.stack.splice(0, 5));
    const grip = s.runner.grip.length;
    const t = play(s, 'corp', id);
    expect(t.runner.grip.length).toBe(grip - 4);
  });

  it('Petty Cash gains 5, and from Archives gains a click and is removed', () => {
    let s = newGame();
    corpTurn(s);
    const pc = createCardInstance(s, C.pettyCash);
    s.corp.archives.faceUp.push(pc);
    s.corp.credits = 3;
    s = useAbility(s, 'corp', pc.instanceId);
    expect(s.corp.credits).toBe(5);
    expect(s.corp.clicks).toBe(3);
    expect(s.removedFromGame.map(c => c.instanceId)).toContain(pc.instanceId);
    const id = giveCard(s, 'corp', C.pettyCash);
    expect(isLegalAction(s, { type: 'PLAY_OPERATION_OR_EVENT', player: 'corp', cardInstanceId: id })).toBe(false);
  });
});

describe('Elevation upgrades', () => {
  it('Mercia B4LL4RD installs ice for 1 less and moves with it', () => {
    let s = newGame();
    const mercia = installCorpForTest(s, C.mercia, 'remote1', true);
    s.corp.hq = [];
    const ice = giveCard(s, 'corp', SG.palisade);
    s = passTurn(s);
    s = pick(s, [ice]);
    s = choose(s, 'hq');
    expect(s.corp.servers.hq.ice.map(c => c.instanceId)).toContain(ice);
    expect(s.corp.servers.hq.root.map(c => c.instanceId)).toContain(mercia);
  });

  it('Mercia B4LL4RD pays 1 less than the ice install cost and shows the cost (rules 1.16.6b)', () => {
    let s = newGame();
    installCorpForTest(s, C.mercia, 'remote1', true);
    installIceForTest(s, SG.palisade, 'hq');
    installIceForTest(s, SG.palisade, 'hq');
    installIceForTest(s, SG.palisade, 'rd');
    s.corp.hq = [];
    const ice = giveCard(s, 'corp', SG.palisade);
    s.corp.credits = 5;
    s = passTurn(s);
    s = pick(s, [ice]);
    const labels = prompt(s)?.kind === 'effect_choice' ? Object.fromEntries((prompt(s) as { options: { id: string; label: string }[] }).options.map(o => [o.id, o.label])) : {};
    expect(labels.hq).toMatch(/\(1c\)/); // 2 ice, 1 less
    expect(labels.rd).not.toMatch(/c\)/); // 1 ice, free
    expect(labels.remote1).not.toMatch(/c\)/); // no ice, never below 0
    s = choose(s, 'hq');
    expect(s.corp.credits).toBe(4);
    expect(s.corp.servers.hq.ice.length).toBe(3);
  });

  it('Mercia B4LL4RD offers trashing ice first when the Corp can not afford the server otherwise (rules 8.5.6b)', () => {
    let s = newGame();
    installCorpForTest(s, C.mercia, 'remote1', true);
    const old = [installIceForTest(s, SG.palisade, 'hq'), installIceForTest(s, SG.palisade, 'hq')];
    s.corp.hq = [];
    const ice = giveCard(s, 'corp', SG.palisade);
    s.corp.credits = 0;
    s = passTurn(s);
    s = pick(s, [ice]);
    const p = prompt(s);
    expect(p?.kind === 'effect_choice' && p.options.find(o => o.id === 'hq')?.label).toMatch(/trash ice/);
    // Not without trashing: nothing is installed
    const plain = choose(s, 'hq');
    expect(plain.corp.servers.hq.ice.map(c => c.instanceId)).not.toContain(ice);
    // Trash 1: 1 ice left to pay for, less Mercia's 1
    s = answer(s, { kind: 'effect_choice', optionId: 'hq', trashFirst: [old[0]] });
    expect(s.corp.servers.hq.ice.map(c => c.instanceId)).toEqual([old[1], ice]);
    expect(s.corp.archives.faceUp.map(c => c.instanceId)).toContain(old[0]);
    expect(s.corp.credits).toBe(0);
  });

  it('only accepts cards to trash first on prompts that install a card', () => {
    let s = newGame();
    const outer = installIceForTest(s, SG.palisade, 'remote1');
    installCorpForTest(s, C.mitra, 'remote1', true);
    s = run(s, 'remote1');
    const p = prompt(s)!;
    expect(isLegalAction(s, { type: 'RESOLVE_PROMPT', player: 'corp', promptId: p.id, choice: { kind: 'effect_choice', optionId: 'trash', trashFirst: [outer] } })).toBe(false);
    expect(isLegalAction(s, { type: 'RESOLVE_PROMPT', player: 'corp', promptId: p.id, choice: { kind: 'effect_choice', optionId: 'trash' } })).toBe(true);
  });

  it('Mitra Aman gains 3 and swaps the approached ice', () => {
    let s = newGame();
    const outer = installIceForTest(s, SG.palisade, 'remote1');
    installCorpForTest(s, C.mitra, 'remote1', true);
    const swap = createCardInstance(s, C.kessleroid);
    s.corp.archives.faceUp.push(swap);
    const credits = s.corp.credits;
    s = run(s, 'remote1');
    s = choose(s, 'trash');
    s = pick(s, [swap.instanceId]);
    expect(s.corp.credits).toBe(credits + 3);
    expect(s.corp.servers.remote1.ice[0].instanceId).toBe(swap.instanceId);
    expect(s.corp.archives.faceUp.map(c => c.instanceId)).toContain(outer);
  });

  it('Mahkota Langit Grid pays for rezzes in its server and raises asset trash costs', () => {
    let s = newGame();
    const grid = installCorpForTest(s, C.mahkota, 'remote1');
    s = rezForTest(s, grid);
    expect(counters(card(s, grid), 'credit')).toBe(2);
    const otto = installCorpForTest(s, C.otto, 'remote1');
    corpTurn(s);
    s.corp.credits = 0;
    s = executeAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: otto });
    expect(card(s, otto).isRezzed).toBe(true);
    expect(counters(card(s, grid), 'credit')).toBe(0);
    startRunnerTurn(s);
    s.runner.credits = 3;
    s = cont(run(s, 'remote1'));
    const p = s.pendingPrompts.find(x => x.kind === 'access_trash');
    expect(p && 'cost' in p ? (p as { cost: number }).cost : 4).toBe(4);
  });
});

describe('Corp AI uses identity abilities that ask a second question (plan.promptChains)', () => {
  const ai = (s: GameState) => answerPrompt(s, 'corp', undefined, true);
  const chosen = (s: GameState) => {
    const a = ai(s);
    if (a.type !== 'RESOLVE_PROMPT') return null;
    return a.choice.kind === 'effect_choice' ? a.choice.optionId : a.choice.kind === 'effect_cards' ? a.choice.cardInstanceIds : null;
  };

  it('Poétrï installs a money asset from the top of R&D when scoring', () => {
    let s = newGame();
    setIdentity(s, 'corp', C.poetri);
    const anthill = topOfRD(s, C.anthill);
    s = scoreForTest(s, C.greenmail);
    expect(chosen(s)).toEqual([anthill]);
  });

  it('Synapse Global installs a card from HQ for free when a tag is removed', () => {
    let s = newGame();
    setIdentity(s, 'corp', C.synapse);
    corpTurn(s);
    s.runner.tags = 1;
    giveCard(s, 'corp', C.anthill);
    s = useAbility(s, 'corp', s.corp.identity.instanceId);
    expect(chosen(s)).toHaveLength(1); // the best card in HQ, ignoring all costs
  });

  it('AU Co. spends its power counters to see 3 cards of R&D', () => {
    let s = newGame();
    setIdentity(s, 'corp', C.auCo);
    s.corp.identity.tokens.power = 2;
    s = toNextCorpTurn(s);
    expect(optionIds(s)).toContain('use');
    expect(chosen(s)).toBe('use');
  });
});

describe('Corp AI: LEO Construction weighs the bioroid against the run (Jeff, plan.leoValue)', () => {
  const atServer = (s: GameState, server: string) => {
    s = run(s, server);
    s.activeRun!.phase = 'approach_server';
    s.activeRun!.icePosition = null;
    return s;
  };

  it('trashes a bioroid to stop the steal of an agenda in the remote', async () => {
    const { createAgent } = await import('../src/ai');
    const s = newGame();
    setIdentity(s, 'corp', C.leo);
    installIceForTest(s, C.bumi, 'remote-1');
    installCorpForTest(s, C.greenmail, 'remote-1');
    const at = atServer(s, 'remote-1');
    // With clicks left the Runner just runs the remote again once it is bare: not worth a bioroid
    expect(createAgent('corp', 'normal').chooseRez!(at, [])).toBeNull();
    at.runner.clicks = 0; // the Runner's last click
    expect(createAgent('corp', 'normal').chooseRez!(at, [])?.type).toBe('USE_ABILITY');
  });

  it('lets the Runner into HQ when HQ holds no agenda', async () => {
    const { createAgent } = await import('../src/ai');
    const s = newGame();
    setIdentity(s, 'corp', C.leo);
    installIceForTest(s, C.bumi, 'hq');
    s.corp.hq = s.corp.hq.filter(c => cardDef(c).type_code !== 'agenda');
    expect(createAgent('corp', 'normal').chooseRez!(atServer(s, 'hq'), [])).toBeNull();
  });
});
