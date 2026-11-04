import { describe, expect, it } from 'vitest';
import { createCardInstance, executeAction, findCardAnywhere, GameState, iceStrength, isLegalAction } from '../src/core';
import { breakerStrength, markSubroutinesBroken } from '../src/core/engine/ice';
import { purgeVirusCounters } from '../src/core/engine/cardEffects';
import { dealNetDamage, giveTags } from '../src/core/engine/damage';
import {
  answer,
  cont,
  runIntoFirstIce,
  giveCard,
  installCorpForTest,
  installIceForTest,
  installProgramForTest,
  keepGoing,
  newGame,
  passTurn,
  play,
  run,
  runnerInstall,
  scoreForTest,
  setIdentity,
  startRunnerTurn,
  useAbility,
} from './helpers';

const L = {
  strikeFund: '34001', price: '34002', badge: '34003', audrey: '34004', banner: '34005', monkeywrench: '34006', eru: '34007',
  hannah: '34008', lago: '34009', mercury: '34010', skimming: '34011', sDobrado: '34012', capybara: '34013', hermes: '34014',
  curupira: '34015', laser: '34016', saci: '34017', shibboleth: '34018', debbie: '34019', arissana: '34020', joyRide: '34021',
  airblade: '34022', lilypad: '34023', mural: '34024', pichacao: '34025', slap: '34026', umbrella: '34027', beatriz: '34028',
  urbanArt: '34029', bahia: '34030', sebastiao: '34066', eye: '34067', privileged: '34068', amanuensis: '34069', chest: '34070',
  boi: '34071', helia: '34072', arruaceiras: '34073', fof: '34074', manuel: '34075', meeting: '34076', window: '34077',
  alarm: '34078', jeitinho: '34079', cupellation: '34080', malandragem: '34081', physarum: '34082', amelia: '34083',
  juli: '34084', burner: '34085', spree: '34086', trickShot: '34087', cataloguer: '34088', coalescence: '34089',
  lobisomem: '34090', muse: '34091', spike: '34092', mary: '34093', ashen: '34094', valentina: '34095',
  // Corp cards from the set used as targets
  jaguarundi: '34035', tributary: '34111',
};
const SG = {
  buzzsaw: '30005', cleaver: '30006', leech: '30008', cookbook: '30009', carmen: '30015', sureGamble: '30030', t400: '30031',
  smartware: '30033', palisade: '30072', tithe: '30073', whitespace: '30074', hedgeFund: '30075', offworld: '30067',
  nico: '30037', regolith: '30071', pharos: '30063', ballista: '30062', funhouse: '30054', karuna: '30047', diviner: '30046',
  manegarm: '30042', urtica: '30045', telework: '30027', tranquilizer: '30017', botulus: '30004', docklands: '30013',
};

const card = (s: GameState, id: string) => findCardAnywhere(s, id)!;
const choose = (s: GameState, optionId: string) => keepGoing(answer(s, { kind: 'effect_choice', optionId }));
const pick = (s: GameState, ids: string[]) => keepGoing(answer(s, { kind: 'effect_cards', cardInstanceIds: ids }));
const declineAccess = (s: GameState) => keepGoing(answer(s, { kind: 'access_trash', trash: false }));
const prompt = (s: GameState) => s.pendingPrompts[0];
const source = (s: GameState) => {
  const p = prompt(s);
  return p && 'source' in p ? p.source : undefined;
};
const emptyHQ = (s: GameState) => s.corp.rd.push(...s.corp.hq.splice(0));
const inGrip = (s: GameState, id: string) => s.runner.grip.some(c => c.instanceId === id);
const inHeap = (s: GameState, id: string) => s.runner.heap.some(c => c.instanceId === id);
/** Gives the Runner a card and plays it (with clicks and credits to spare). */
function playRunner(s: GameState, code: string, clicks = 1): [GameState, string] {
  if (s.activePlayer !== 'runner') startRunnerTurn(s);
  const id = giveCard(s, 'runner', code);
  s.runner.clicks = Math.max(s.runner.clicks, clicks);
  s.runner.credits += 10;
  return [play(s, 'runner', id), id];
}
/** Puts a Runner card (by code) in the rig, bypassing costs. */
function rig(s: GameState, code: string, zone: 'hardware' | 'resources' | 'programs'): string {
  const c = createCardInstance(s, code);
  c.isRezzed = true;
  s.runner.rig[zone].push(c);
  return c.instanceId;
}
/** Hosts a program on a piece of ice (test setup). */
function trojanOn(s: GameState, code: string, iceId: string): string {
  const p = rig(s, code, 'programs');
  card(s, p).hostedOnId = iceId;
  card(s, iceId).hostedCardIds.push(p);
  return p;
}
/** Declines every access prompt until the breach is over. */
function finishBreach(s: GameState): GameState {
  for (let i = 0; i < 20 && prompt(s)?.kind === 'access_trash'; i++) s = declineAccess(s);
  return s;
}
/** Declines prompts one at a time until one from this card is first. */
function skipTo(s: GameState, code: string): GameState {
  for (let i = 0; i < 20 && s.pendingPrompts.length > 0 && source(s)?.cardCode !== code; i++) {
    const p = prompt(s);
    if (p.kind === 'access_trash') s = declineAccess(s);
    else if (p.kind === 'effect_choice') s = choose(s, p.options.find(o => /^(no|leave|stay|none|end)$/.test(o.id))?.id ?? p.options[p.options.length - 1].id);
    else if (p.kind === 'effect_cards') s = pick(s, p.candidateIds.slice(0, p.min));
    else break;
  }
  return s;
}
/** Ends the Corp's turn and starts the Runner's. */
function toRunnerTurn(s: GameState): GameState {
  s.activePlayer = 'corp';
  s.phase = 'corp_turn';
  s.turnStep = null;
  s = passTurn(s);
  return s;
}
/** Cards the Runner may access in this breach of HQ or R&D (call at the first access prompt). */
const breachTotal = (s: GameState) => {
  const b = s.activeRun?.breach;
  return b ? b.zoneLeft + b.chosen.length : 0;
};
/** Puts n Nico Campaigns (trash cost 2, so each access asks) on top of R&D. */
const nicosOnRD = (s: GameState, n = 4) => s.corp.rd.unshift(...Array.from({ length: n }, () => createCardInstance(s, SG.nico)));
/** The encounter was bypassed or passed: the Runner is past the ice. */
const pastIce = (s: GameState) => !s.activeRun?.encounter && (s.activeRun?.icePassed ?? 0) >= 1;
const threat = (s: GameState, n: number) => {
  s.corp.score = n;
};
const breakWith = (s: GameState, breaker: string, indices: number[]) =>
  keepGoing(executeAction(s, { type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: breaker, subroutineIndices: indices } as never));
const boost = (s: GameState, breaker: string) => keepGoing(executeAction(s, { type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: breaker } as never));

describe('The Automata Initiative: Anarch', () => {
  it('Strike Fund gains 4, and may gain 2 more when trashed from the grip', () => {
    let s = newGame();
    const credits = s.runner.credits;
    [s] = playRunner(s, L.strikeFund);
    expect(s.runner.credits).toBe(credits + 10 - 1 + 4);
    const t = newGame();
    giveCard(t, 'runner', L.strikeFund);
    t.runner.grip.splice(0, t.runner.grip.length - 1);
    const c2 = t.runner.credits;
    dealNetDamage(t, 1);
    expect(t.runner.credits).toBe(c2);
    expect(choose(t, 'yes').runner.credits).toBe(c2 + 2);
    expect(choose(t, 'no').runner.credits).toBe(c2);
  });

  it('The Price trashes the top 4 of the stack and installs one of them 3 cheaper', () => {
    let s = newGame();
    const t400 = createCardInstance(s, SG.t400);
    s.runner.stack.unshift(t400);
    [s] = playRunner(s, L.price);
    expect(s.runner.heap.length).toBeGreaterThanOrEqual(4);
    const credits = s.runner.credits;
    s = pick(s, [t400.instanceId]);
    expect(s.runner.rig.hardware.map(c => c.instanceId)).toContain(t400.instanceId);
    expect(s.runner.credits).toBe(credits); // cost 2, 3 less
  });

  it('Solidarity Badge gains a counter on the first Corp trash each turn and spends it as the turn begins', () => {
    let s = newGame();
    emptyHQ(s);
    const badge = rig(s, L.badge, 'hardware');
    installCorpForTest(s, SG.nico, 'remote-1');
    s.runner.credits = 10;
    s = cont(run(s, 'remote-1'));
    s = keepGoing(answer(s, { kind: 'access_trash', trash: true }));
    expect(card(s, badge).tokens.power).toBe(1);
    s = toRunnerTurn(s);
    s = skipTo(s, L.badge);
    const grip = s.runner.grip.length;
    s = choose(s, 'draw');
    expect(s.runner.grip.length).toBe(grip + 1);
  });

  it('Audrey v2 gains virus counters by trashing accessed cards, breaks with them and boosts by discarding', () => {
    let s = newGame();
    emptyHQ(s);
    const audrey = installProgramForTest(s, L.audrey);
    installCorpForTest(s, SG.nico, 'remote-1');
    s.runner.credits = 10;
    s = cont(run(s, 'remote-1'));
    s = keepGoing(answer(s, { kind: 'access_trash', trash: true }));
    expect(card(s, audrey).tokens.virus).toBe(1);
    installIceForTest(s, SG.whitespace, 'hq');
    s = cont(run(s, 'hq'));
    const grip = s.runner.grip.length;
    s = boost(s, audrey);
    s = pick(s, [s.runner.grip[0].instanceId]);
    expect(s.runner.grip.length).toBe(grip - 1);
    expect(breakerStrength(s, card(s, audrey))).toBe(3);
    s = breakWith(s, audrey, [0, 1]);
    expect(card(s, audrey).tokens.virus ?? 0).toBe(0);
    expect(s.activeRun?.encounter?.broken.every(Boolean)).toBe(true);
  });

  it('Banner stops a barrier\'s subroutines ending the run for 2 credits', () => {
    let s = newGame();
    installIceForTest(s, SG.palisade, 'hq');
    const banner = installProgramForTest(s, L.banner);
    s.runner.credits = 5;
    s = cont(run(s, 'hq'));
    s = useAbility(s, 'runner', banner);
    expect(s.runner.credits).toBe(3);
    s = cont(s);
    expect(s.activeRun).not.toBeNull();
  });

  it('Monkeywrench gives its host -2 strength and other ice on that server -1', () => {
    const s = newGame();
    const outer = installIceForTest(s, SG.palisade, 'hq');
    const inner = installIceForTest(s, SG.whitespace, 'hq');
    const other = installIceForTest(s, SG.whitespace, 'rd');
    trojanOn(s, L.monkeywrench, outer);
    expect(iceStrength(s, card(s, outer))).toBe(0);
    expect(iceStrength(s, card(s, inner))).toBe(-1 + 0);
    expect(iceStrength(s, card(s, other))).toBe(0);
  });

  it('Eru Ayase-Pessoa takes a tag to run Archives and breach R&D instead (an extra card at threat 3)', () => {
    let s = newGame();
    const eru = rig(s, L.eru, 'resources');
    threat(s, 3);
    nicosOnRD(s);
    startRunnerTurn(s);
    s = useAbility(s, 'runner', eru);
    expect(s.runner.tags).toBe(1);
    s = cont(s);
    expect(s.activeRun?.breach?.zone).toBe('rd');
    expect(breachTotal(s)).toBe(2);
  });

  it('Hannah "Wheels" Pilintra gains a click to run a remote and tags if the run fails; or trashes for 2 clicks and a tag off', () => {
    let s = newGame();
    emptyHQ(s);
    const h = rig(s, L.hannah, 'resources');
    installIceForTest(s, SG.palisade, 'remote-1');
    installCorpForTest(s, SG.nico, 'remote-1');
    startRunnerTurn(s);
    const clicks = s.runner.clicks;
    s = useAbility(s, 'runner', h, 0);
    s = choose(s, 'remote-1');
    expect(s.runner.clicks).toBe(clicks);
    s = cont(cont(s)); // Palisade ends the run
    expect(s.activeRun).toBeNull();
    expect(s.runner.tags).toBe(1);
    s = useAbility(s, 'runner', h, 1);
    expect(s.runner.tags).toBe(0);
    expect(s.runner.clicks).toBe(clicks + 1); // [click] spent, [click][click] gained
  });

  it('Lago Paranoá Shelter trashes the top of the stack to draw the first time each turn the Corp installs in a root', () => {
    let s = newGame();
    rig(s, L.lago, 'resources');
    s.activePlayer = 'corp';
    s.phase = 'corp_turn';
    s.corp.clicks = 3;
    const nico = giveCard(s, 'corp', SG.nico);
    s = executeAction(s, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: nico, targetServerId: null } as never);
    expect(source(s)).toMatchObject({ cardCode: L.lago });
    const grip = s.runner.grip.length;
    const heap = s.runner.heap.length;
    s = choose(s, 'yes');
    expect(s.runner.grip.length).toBe(grip + 1);
    expect(s.runner.heap.length).toBe(heap + 1);
  });
});

describe('The Automata Initiative: Criminal', () => {
  it('Mercury accesses 1 more card on HQ or R&D when no subroutine was broken that run', () => {
    let s = newGame();
    setIdentity(s, 'runner', L.mercury);
    nicosOnRD(s);
    s = cont(run(s, 'rd'));
    expect(source(s)).toMatchObject({ cardCode: L.mercury });
    s = choose(s, 'yes');
    expect(breachTotal(s)).toBe(2);
  });

  it('Chrysopoeian Skimming gives a click and a card if the Corp reveals an agenda, else shows the top 3 of R&D', () => {
    let s = newGame();
    emptyHQ(s);
    const off = giveCard(s, 'corp', SG.offworld);
    let id: string;
    [s, id] = playRunner(s, L.skimming);
    const clicks = s.runner.clicks;
    s = pick(s, [off]);
    expect(s.runner.clicks).toBe(clicks + 1);
    let t = newGame();
    emptyHQ(t);
    [t] = playRunner(t, L.skimming);
    expect(t.log.some(l => /looked at the top 3 cards of R&D/.test(l.message))).toBe(true);
    void id;
  });

  it('S-Dobrado bypasses the first ice encountered on a central run', () => {
    let s = newGame();
    installIceForTest(s, SG.palisade, 'hq');
    [s] = playRunner(s, L.sDobrado);
    s = choose(s, 'hq');
    s = cont(s);
    expect(pastIce(s)).toBe(true);
    expect(s.activeRun?.icePassed).toBe(1);
  });

  it('Capybara is removed from the game to derez bypassed ice', () => {
    let s = newGame();
    const pal = installIceForTest(s, SG.palisade, 'hq');
    const capy = rig(s, L.capybara, 'hardware');
    [s] = playRunner(s, L.sDobrado);
    s = choose(s, 'hq');
    s = cont(s);
    s = choose(s, 'yes');
    expect(card(s, pal).isRezzed).toBe(false);
    expect(s.removedFromGame.map(c => c.instanceId)).toContain(capy);
  });

  it('Hermes adds an unrezzed installed card to HQ when an agenda is scored', () => {
    let s = newGame();
    rig(s, L.hermes, 'hardware');
    const nico = installCorpForTest(s, SG.nico, 'remote-1');
    s = scoreForTest(s, SG.offworld);
    s = pick(s, [nico]);
    expect(s.corp.hq.map(c => c.instanceId)).toContain(nico);
  });

  it('Curupira collects power counters by fully breaking ice and spends 3 to bypass a barrier', () => {
    let s = newGame();
    installIceForTest(s, SG.palisade, 'archives');
    const cu = installProgramForTest(s, L.curupira);
    s.runner.credits = 10;
    s = cont(run(s, 'archives'));
    s = boost(s, cu);
    s = breakWith(s, cu, [0]);
    expect(card(s, cu).tokens.power).toBe(1);
    card(s, cu).tokens.power = 3;
    s = cont(s);
    s = finishBreach(cont(s));
    s.activeRun = null;
    s = cont(run(s, 'archives'));
    s = choose(s, 'yes');
    expect(card(s, cu).tokens.power).toBe(0);
    expect(pastIce(s)).toBe(true);
  });

  it('Laser Pointer is trashed to bypass AP, destroyer or observer ice', () => {
    let s = newGame();
    installIceForTest(s, SG.tithe, 'hq');
    const lp = installProgramForTest(s, L.laser);
    s = cont(run(s, 'hq'));
    s = choose(s, 'yes');
    expect(inHeap(s, lp)).toBe(true);
    expect(pastIce(s)).toBe(true);
  });

  it('Saci gains 3 whenever its host is rezzed or derezzed', () => {
    let s = newGame();
    const pal = installIceForTest(s, SG.palisade, 'hq', false);
    trojanOn(s, L.saci, pal);
    s = run(s, 'hq');
    const credits = s.runner.credits;
    s.corp.credits += 10;
    s = executeAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: pal });
    expect(s.runner.credits).toBe(credits + 3);
  });

  it('Shibboleth gets -2 strength at threat 4', () => {
    const s = newGame();
    const sh = installProgramForTest(s, L.shibboleth);
    expect(breakerStrength(s, card(s, sh))).toBe(3);
    threat(s, 4);
    expect(breakerStrength(s, card(s, sh))).toBe(1);
  });

  it('Debbie "Downtown" Moreira collects a credit per run event and runs any server spending them', () => {
    let s = newGame();
    const d = rig(s, L.debbie, 'resources');
    [s] = playRunner(s, L.sDobrado);
    expect(card(s, d).tokens.credit).toBe(1);
    s.activeRun = null;
    s.pendingPrompts = [];
    s.runner.clicks = 1;
    s = useAbility(s, 'runner', d);
    s = choose(s, 'hq');
    expect(s.activeRun?.creditHosts).toContain(d);
  });
});

describe('The Automata Initiative: Shaper and neutral', () => {
  it('Arissana installs a program from the grip during a run; non-trojans are trashed when it ends', () => {
    let s = newGame();
    setIdentity(s, 'runner', L.arissana);
    const cleaver = giveCard(s, 'runner', SG.cleaver);
    s.runner.credits = 10;
    s = run(s, 'archives');
    s = useAbility(s, 'runner', s.runner.identity.instanceId);
    s = pick(s, [cleaver]);
    expect(s.runner.rig.programs.map(c => c.instanceId)).toContain(cleaver);
    s = finishBreach(cont(s));
    expect(inHeap(s, cleaver)).toBe(true);
  });

  it('Joy Ride draws 5 on a successful R&D run', () => {
    let s = newGame();
    let id: string;
    [s, id] = playRunner(s, L.joyRide);
    const grip = s.runner.grip.length;
    s = cont(s);
    expect(s.runner.grip.length).toBe(grip + 5);
    void id;
  });

  it('AirbladeX prevents net damage during runs and "when encountered" abilities, from 3 counters', () => {
    let s = newGame();
    const [s1, ab] = runnerInstall(s, L.airblade);
    s = s1;
    expect(card(s, ab).tokens.power).toBe(3);
    installIceForTest(s, L.jaguarundi, 'hq');
    threat(s, 4);
    s = cont(run(s, 'hq'));
    s = choose(s, 'yes');
    expect(card(s, ab).tokens.power).toBe(2);
    expect(s.pendingPrompts.length).toBe(0); // no Jaguarundi tag-or-click
  });

  it('AirbladeX asks how much net damage to prevent, before the damage resolves (Diviner still reads the trashed card)', () => {
    const go = (preventId: string) => {
      let s = newGame();
      const ab = rig(s, L.airblade, 'hardware');
      card(s, ab).tokens.power = 3;
      installIceForTest(s, SG.diviner, 'hq');
      s = runIntoFirstIce(s, 'hq');
      s.runner.grip = [];
      giveCard(s, 'runner', '30030'); // Sure Gamble, cost 5: Diviner ends the run if it is trashed
      s = cont(s);
      expect(source(s)).toMatchObject({ cardCode: L.airblade, step: 'prevent_damage' });
      expect(s.runner.grip.length).toBe(1); // nothing trashed until the Runner answers
      return [choose(s, preventId), ab] as const;
    };
    const [saved, ab1] = go('1');
    expect(card(saved, ab1).tokens.power).toBe(2);
    expect(saved.runner.grip.length).toBe(1);
    expect(saved.activeRun).not.toBeNull();
    const [taken, ab2] = go('0');
    expect(card(taken, ab2).tokens.power).toBe(3);
    expect(taken.runner.grip.length).toBe(0);
    expect(taken.activeRun).toBeNull();
    // Outside a run it does not ask
    const s = newGame();
    const ab = rig(s, L.airblade, 'hardware');
    card(s, ab).tokens.power = 3;
    dealNetDamage(s, 1);
    expect(s.pendingPrompts.length).toBe(0);
  });

  it('LilyPAD gives 2 MU and a draw the first time each turn a program is installed', () => {
    let s = newGame();
    rig(s, L.lilypad, 'hardware');
    const [s1] = runnerInstall(s, SG.leech);
    s = s1;
    const grip = s.runner.grip.length;
    s = choose(s, 'yes');
    expect(s.runner.grip.length).toBe(grip + 1);
  });

  it('Living Mural breaks only sentries on its host\'s server and gets +3 strength the turn it is installed at threat 4', () => {
    let s = newGame();
    const host = installIceForTest(s, SG.palisade, 'hq');
    installIceForTest(s, SG.tithe, 'hq');
    threat(s, 4);
    const [s1, mural] = runnerInstall(s, L.mural, host);
    s = s1;
    expect(breakerStrength(s, card(s, mural))).toBe(4);
    s.runner.credits = 10;
    s = cont(run(s, 'hq'));
    s = breakWith(s, mural, [0]);
    expect(s.activeRun?.encounter?.broken[0]).toBe(true);
  });

  it('Pichação gains a click when its host is passed, and goes back to the grip after the second click of the turn', () => {
    let s = newGame();
    const pal = installIceForTest(s, SG.whitespace, 'hq');
    const p = trojanOn(s, L.pichacao, pal);
    s = cont(run(s, 'hq'));
    markSubroutinesBroken(s, [0, 1], null);
    const clicks = s.runner.clicks;
    s = cont(s);
    s = choose(s, 'yes');
    expect(s.runner.clicks).toBe(clicks + 1);
    s = finishBreach(cont(s));
    s.activeRun = null;
    s = cont(run(s, 'hq'));
    markSubroutinesBroken(s, [0, 1], null);
    s = cont(s);
    s = choose(s, 'yes');
    expect(inGrip(s, p)).toBe(true);
  });

  it('Slap Vandal breaks 1 subroutine on its host, once per encounter', () => {
    let s = newGame();
    const pal = installIceForTest(s, SG.palisade, 'hq');
    const sv = trojanOn(s, L.slap, pal);
    s.runner.credits = 10;
    s = cont(run(s, 'hq'));
    s = breakWith(s, sv, [0]);
    expect(s.activeRun?.encounter?.broken[0]).toBe(true);
  });

  it('Umbrella breaks code gates hosting a trojan and lets each player draw', () => {
    let s = newGame();
    const div = installIceForTest(s, SG.diviner, 'hq');
    trojanOn(s, SG.tranquilizer, div);
    const um = installProgramForTest(s, L.umbrella);
    s.runner.credits = 10;
    s = cont(run(s, 'hq'));
    s = breakWith(s, um, [0]);
    const grip = s.runner.grip.length;
    s = choose(s, 'yes');
    expect(s.runner.grip.length).toBe(grip + 1);
    expect(source(s)).toMatchObject({ step: 'draw-corp' });
  });

  it('Beatriz Friere Gonzalez runs HQ for 2 clicks and breaches R&D with 1 more access', () => {
    let s = newGame();
    const b = rig(s, L.beatriz, 'resources');
    nicosOnRD(s);
    startRunnerTurn(s);
    s = useAbility(s, 'runner', b);
    s = cont(s);
    expect(s.activeRun?.breach?.zone).toBe('rd');
    expect(breachTotal(s)).toBe(2);
  });

  it('Urban Art Vernissage returns a non-virus trojan to the grip for 2 hosted credits that pay installs', () => {
    let s = newGame();
    const ua = rig(s, L.urbanArt, 'resources');
    const pal = installIceForTest(s, SG.palisade, 'hq');
    const sv = trojanOn(s, L.slap, pal);
    s = toRunnerTurn(s);
    s = skipTo(s, L.urbanArt);
    s = pick(s, [sv]);
    expect(inGrip(s, sv)).toBe(true);
    expect(card(s, ua).tokens.credit).toBe(2);
  });

  it('Bahia Bands resolves 2 of its 4 effects after a successful run', () => {
    let s = newGame();
    s.runner.tags = 1;
    [s] = playRunner(s, L.bahia);
    s = choose(s, 'archives');
    s = cont(s);
    const grip = s.runner.grip.length;
    s = choose(s, 'draw');
    s = choose(s, 'tag');
    expect(s.runner.grip.length).toBe(grip + 2);
    expect(s.runner.tags).toBe(0);
  });
});

describe('Rebellion Without Rehearsal: Anarch', () => {
  it('Sebastião installs a connection 2 cheaper on the first tag, and makes the Corp trash from HQ to trash connections', () => {
    let s = newGame();
    setIdentity(s, 'runner', L.sebastiao);
    const fof = giveCard(s, 'runner', L.fof);
    s.runner.credits = 1;
    startRunnerTurn(s);
    giveTags(s, 1);
    s = keepGoing(s);
    s = skipTo(s, L.sebastiao);
    s = pick(s, [fof]);
    expect(s.runner.rig.resources.map(c => c.instanceId)).toContain(fof);
    expect(s.runner.credits).toBe(0);
  });

  it('Eye for an Eye takes a tag for an extra HQ access, and trashes accessed cards for a grip card', () => {
    let s = newGame();
    emptyHQ(s);
    const nico = giveCard(s, 'corp', SG.nico);
    giveCard(s, 'corp', SG.nico);
    giveCard(s, 'corp', SG.nico);
    let ev: string;
    [s, ev] = playRunner(s, L.eye);
    s = cont(s);
    expect(s.runner.tags).toBe(1);
    expect(breachTotal(s)).toBe(2);
    const p = prompt(s) as { cardInstanceId: string };
    const grip = s.runner.grip.length;
    s = keepGoing(answer(s, { kind: 'access_trash', trash: false, alternativeId: ev } as never));
    s = pick(s, [s.runner.grip[0].instanceId]);
    expect(s.runner.grip.length).toBe(grip - 1);
    expect(s.corp.archives.faceUp.map(c => c.instanceId)).toContain(p.cardInstanceId);
    void nico;
  });

  it('Privileged Access takes a tag instead of breaching Archives and installs a resource from the heap 2 cheaper', () => {
    let s = newGame();
    const cook = createCardInstance(s, SG.cookbook);
    s.runner.heap.push(cook);
    [s] = playRunner(s, L.privileged);
    s.runner.credits = 0;
    s = cont(s);
    expect(s.runner.tags).toBe(1);
    s = pick(s, [cook.instanceId]);
    expect(s.runner.rig.resources.map(c => c.instanceId)).toContain(cook.instanceId);
  });

  it('Amanuensis gains a counter at turn end while tagged and spends it to draw 2 when tags are removed', () => {
    let s = newGame();
    const am = rig(s, L.amanuensis, 'hardware');
    startRunnerTurn(s);
    s.runner.tags = 1;
    s = passTurn(s);
    expect(card(s, am).tokens.power).toBe(1);
    startRunnerTurn(s);
    s.runner.credits = 5;
    s = keepGoing(executeAction(s, { type: 'REMOVE_TAG', player: 'runner' }));
    const grip = s.runner.grip.length;
    s = choose(s, 'yes');
    expect(s.runner.grip.length).toBe(grip + 2);
  });

  it("The Wizard's Chest, after runs on all centrals, sets aside cards to install one of 2 of a type free", () => {
    let s = newGame();
    const wc = rig(s, L.chest, 'hardware');
    startRunnerTurn(s);
    expect(isLegalAction(s, { type: 'USE_ABILITY', player: 'runner', cardInstanceId: wc, abilityIndex: 0 })).toBe(false);
    s.runsThisTurn = ['hq', 'rd', 'archives'].map(server => ({ server, successful: true }));
    const a = createCardInstance(s, SG.t400);
    const b = createCardInstance(s, SG.docklands);
    s.runner.stack.unshift(a, b);
    s = useAbility(s, 'runner', wc);
    s = choose(s, 'hardware');
    s = pick(s, [b.instanceId]);
    expect(s.runner.rig.hardware.map(c => c.instanceId)).toContain(b.instanceId);
  });

  it('Boi-tatá costs 1 less after the Runner trashed one of their installed cards this turn', () => {
    let s = newGame();
    installIceForTest(s, SG.tithe, 'hq');
    const boi = installProgramForTest(s, L.boi);
    s.runner.credits = 10;
    startRunnerTurn(s);
    s.turnFlags.runner_trashed_own_installed = 1;
    s = cont(run(s, 'hq'));
    s = breakWith(s, boi, [0, 1]);
    expect(s.runner.credits).toBe(9);
  });

  it('Heliamphora hosts an Archives card instead of accessing it, and purging trashes 2 HQ cards and itself', () => {
    let s = newGame();
    const h = installProgramForTest(s, L.helia);
    const off = createCardInstance(s, SG.offworld);
    s.corp.archives.faceUp.push(off);
    s = cont(run(s, 'archives'));
    s = pick(s, [off.instanceId]);
    expect(card(s, h).hostedCards?.map(c => c.instanceId)).toContain(off.instanceId);
    expect(s.runner.score).toBe(0);
    s.activeRun = null;
    const hq = s.corp.hq.length;
    purgeVirusCounters(s);
    expect(s.corp.hq.length).toBe(hq - 2);
    expect(inHeap(s, h)).toBe(true);
  });

  it('Arruaceiras Crew takes a tag for -2 strength, then trashes ice at 0 strength for 2 credits', () => {
    let s = newGame();
    const pal = installIceForTest(s, SG.palisade, 'hq');
    const ac = rig(s, L.arruaceiras, 'resources');
    s.runner.credits = 5;
    s = cont(run(s, 'hq'));
    s = useAbility(s, 'runner', ac, 0);
    expect(s.runner.tags).toBe(1);
    expect(iceStrength(s, card(s, pal))).toBe(0);
    s = useAbility(s, 'runner', ac, 1);
    expect(s.corp.archives.faceUp.map(c => c.instanceId)).toContain(pal);
    expect(pastIce(s)).toBe(true);
  });

  it('Friend of a Friend gains 5 and removes a tag, or 9 and a tag when untagged', () => {
    let s = newGame();
    const f = rig(s, L.fof, 'resources');
    startRunnerTurn(s);
    const credits = s.runner.credits;
    s = useAbility(s, 'runner', f, 1);
    expect(s.runner.credits).toBe(credits + 9);
    expect(s.runner.tags).toBe(1);
  });

  it('Manuel Lattes de Moura gives tagged Runners an extra HQ or R&D access', () => {
    let s = newGame();
    rig(s, L.manuel, 'resources');
    nicosOnRD(s);
    s.runner.tags = 1;
    s = cont(run(s, 'rd'));
    expect(breachTotal(s)).toBe(2);
  });
});

describe('Rebellion Without Rehearsal: Criminal', () => {
  it('Meeting of Minds fetches a connection and gains 1 per connection revealed in the grip', () => {
    let s = newGame();
    const fof = createCardInstance(s, L.fof);
    s.runner.stack.push(fof);
    giveCard(s, 'runner', L.hannah);
    [s] = playRunner(s, L.meeting);
    const credits = s.runner.credits;
    s = choose(s, 'connection');
    s = pick(s, [fof.instanceId]);
    expect(inGrip(s, fof.instanceId)).toBe(true);
    // Reveal any number of the connections in the grip: one of the two here
    const hannah = s.runner.grip.find(c => c.cardCode === L.hannah)!;
    s = pick(s, [hannah.instanceId]);
    expect(s.runner.credits).toBe(credits + 1);
  });

  it('Window of Opportunity derezzes ice as the run begins and the Corp may rez it free when it ends', () => {
    let s = newGame();
    const pal = installIceForTest(s, SG.palisade, 'hq');
    s.runner.grip = [];
    [s] = playRunner(s, L.window);
    s = choose(s, 'hq');
    s = pick(s, [pal]);
    expect(card(s, pal).isRezzed).toBe(false);
    s = cont(s); // passes the unrezzed ice
    s = finishBreach(cont(s));
    expect(source(s)).toMatchObject({ cardCode: L.window, step: 'rez' });
    s = choose(s, 'yes');
    expect(card(s, pal).isRezzed).toBe(true);
  });

  it('Alarm Clock runs HQ as the turn begins and may spend 2 clicks to bypass the first ice', () => {
    let s = newGame();
    rig(s, L.alarm, 'hardware');
    installIceForTest(s, SG.palisade, 'hq');
    s = toRunnerTurn(s);
    s = skipTo(s, L.alarm);
    s = choose(s, 'yes');
    expect(s.activeRun?.server).toBe('hq');
    s = cont(s);
    s = choose(s, 'yes');
    expect(pastIce(s)).toBe(true);
  });

  it('Jeitinho scores as an assassination agenda after runs on all centrals; 3 of them win', () => {
    let s = newGame();
    for (let i = 0; i < 2; i++) {
      const j = createCardInstance(s, L.jeitinho);
      j.asAgendaPoints = 0;
      s.runner.scoreArea.push(j);
    }
    rig(s, L.jeitinho, 'hardware');
    startRunnerTurn(s);
    s.runsThisTurn = ['hq', 'rd', 'archives'].map(server => ({ server, successful: true }));
    s = passTurn(s);
    s = skipTo(s, L.jeitinho);
    s = choose(s, 'yes');
    expect(s.winner).toBe('runner');
  });

  it('Cupellation hosts an accessed card for 1, then trashes itself on an HQ breach for 2 more accesses', () => {
    let s = newGame();
    emptyHQ(s);
    const cu = installProgramForTest(s, L.cupellation);
    const nico = installCorpForTest(s, SG.nico, 'remote-1');
    s.runner.credits = 5;
    s = cont(run(s, 'remote-1'));
    s = keepGoing(answer(s, { kind: 'access_trash', trash: false, alternativeId: cu } as never));
    expect(card(s, cu).hostedCards?.map(c => c.instanceId)).toContain(nico);
    giveCard(s, 'corp', SG.hedgeFund);
    s.activeRun = null;
    s = cont(run(s, 'hq'));
    s = choose(s, 'yes');
    expect(inHeap(s, cu)).toBe(true);
  });

  it('Malandragem spends a counter to bypass ice of strength 3 or less', () => {
    let s = newGame();
    installIceForTest(s, SG.palisade, 'archives');
    const [s1, m] = runnerInstall(s, L.malandragem);
    s = s1;
    expect(card(s, m).tokens.power).toBe(2);
    s = cont(run(s, 'archives'));
    s = choose(s, 'counter');
    expect(card(s, m).tokens.power).toBe(1);
    expect(pastIce(s)).toBe(true);
  });

  it('Physarum Entangler pays 1 per subroutine to bypass its non-barrier host, and is trashed by a purge', () => {
    let s = newGame();
    const tithe = installIceForTest(s, SG.tithe, 'hq');
    const ph = trojanOn(s, L.physarum, tithe);
    s.runner.credits = 5;
    s = cont(run(s, 'hq'));
    s = choose(s, 'yes');
    expect(s.runner.credits).toBe(3);
    expect(pastIce(s)).toBe(true);
    purgeVirusCounters(s);
    expect(inHeap(s, ph)).toBe(true);
  });

  it('Amelia Earhart counts runs with 3+ accesses and trashes for the Corp to lose 10', () => {
    let s = newGame();
    const am = rig(s, L.amelia, 'resources');
    card(s, am).tokens.power = 3;
    s.corp.credits = 12;
    s = toRunnerTurn(s);
    s = skipTo(s, L.amelia);
    s = choose(s, 'yes');
    expect(s.corp.credits).toBe(2);
  });

  it('Juli Moreira Lee gives a click the first time each turn the Runner uses a click ability on a resource', () => {
    let s = newGame();
    const [s1, juli] = runnerInstall(s, L.juli);
    s = s1;
    const b = rig(s, L.beatriz, 'resources');
    s.runner.clicks = 3;
    s = useAbility(s, 'runner', b);
    expect(s.runner.clicks).toBe(2);
    expect(card(s, juli).tokens.power).toBe(3);
  });
});

describe('Rebellion Without Rehearsal: Shaper and neutral', () => {
  it('Burner reveals 3 HQ cards instead of breaching and puts 2 of them on R&D', () => {
    let s = newGame();
    [s] = playRunner(s, L.burner);
    const hq = s.corp.hq.length;
    s = cont(s);
    const [a, b] = (prompt(s) as { candidateIds: string[] }).candidateIds;
    s = pick(s, [a, b]);
    s = choose(s, 'top');
    s = choose(s, 'bottom');
    expect(s.corp.hq.length).toBe(hq - 2);
    expect(s.corp.rd[0].instanceId).toBe(a);
    expect(s.corp.rd[s.corp.rd.length - 1].instanceId).toBe(b);
  });

  it('Spree moves an installed trojan onto ice protecting the attacked server', () => {
    let s = newGame();
    const away = installIceForTest(s, SG.palisade, 'rd');
    const here = installIceForTest(s, SG.whitespace, 'hq');
    const sv = trojanOn(s, L.slap, away);
    let ev: string;
    [s, ev] = playRunner(s, L.spree);
    s = choose(s, 'hq');
    s = useAbility(s, 'runner', ev);
    s = pick(s, [sv]);
    s = choose(s, here);
    expect(card(s, sv).hostedOnId).toBe(here);
  });

  it('Trick Shot pays with hosted credits, accesses an extra R&D card and may then run a remote', () => {
    let s = newGame();
    emptyHQ(s);
    installCorpForTest(s, SG.nico, 'remote-1');
    nicosOnRD(s);
    let ev: string;
    [s, ev] = playRunner(s, L.trickShot);
    expect(card(s, ev).tokens.credit).toBe(4);
    s = cont(s);
    expect(card(s, ev).tokens.credit).toBe(6);
    expect(breachTotal(s)).toBe(2);
    s = finishBreach(s);
    expect(source(s)).toMatchObject({ cardCode: L.trickShot, step: 'remote' });
    s = choose(s, 'remote-1');
    expect(s.activeRun?.server).toBe('remote-1');
  });

  it('Cataloguer arranges the top 4 of R&D instead of breaching, and breaches R&D for a click later', () => {
    let s = newGame();
    const [s1, cat] = runnerInstall(s, L.cataloguer);
    s = s1;
    nicosOnRD(s, 5);
    s = cont(run(s, 'rd'));
    s = choose(s, 'yes');
    const top = s.corp.rd.slice(0, 4).map(c => c.instanceId);
    s = pick(s, [top[3]]);
    s = pick(s, [top[2]]);
    s = pick(s, [top[1]]);
    expect(s.corp.rd[0].instanceId).toBe(top[3]);
    expect(s.activeRun).toBeNull();
    s.runner.clicks = 1;
    s = useAbility(s, 'runner', cat);
    expect(s.pendingPrompts[0]?.kind).toBe('access_trash');
  });

  it('Coalescence gains 2 per counter on the Runner\'s turn', () => {
    let s = newGame();
    const [s1, co] = runnerInstall(s, L.coalescence);
    s = s1;
    const credits = s.runner.credits;
    s = useAbility(s, 'runner', co);
    expect(s.runner.credits).toBe(credits + 2);
  });

  it('Lobisomem breaks code gates for 1 and spends a counter to break X barrier subroutines for X', () => {
    let s = newGame();
    installIceForTest(s, SG.palisade, 'archives');
    const [s1, lob] = runnerInstall(s, L.lobisomem);
    s = s1;
    expect(card(s, lob).tokens.power).toBe(1);
    s.runner.credits = 10;
    s = cont(run(s, 'archives'));
    s = boost(s, lob);
    s = useAbility(s, 'runner', lob);
    s = choose(s, '1');
    expect(s.activeRun?.encounter?.broken.every(Boolean)).toBe(true);
    expect(card(s, lob).tokens.power ?? 0).toBe(0);
  });

  it('Muse installs a found trojan on ice', () => {
    let s = newGame();
    const pal = installIceForTest(s, SG.palisade, 'hq');
    const sv = createCardInstance(s, L.slap);
    s.runner.stack.push(sv);
    const [s1] = runnerInstall(s, L.muse);
    s = s1;
    s.runner.credits += 5;
    s = pick(s, [sv.instanceId]);
    s = choose(s, pal);
    expect(card(s, sv.instanceId).hostedOnId).toBe(pal);
  });

  it('Pressure Spike gets +9 strength once per run at threat 4', () => {
    let s = newGame();
    installIceForTest(s, SG.pharos, 'hq');
    const ps = installProgramForTest(s, L.spike);
    threat(s, 4);
    s.runner.credits = 10;
    s = cont(run(s, 'hq'));
    s = useAbility(s, 'runner', ps);
    expect(breakerStrength(s, card(s, ps))).toBe(10);
    expect(isLegalAction(s, { type: 'USE_ABILITY', player: 'runner', cardInstanceId: ps, abilityIndex: 0 })).toBe(false);
  });

  it('"Pretty" Mary da Silva may add an R&D access when 2 or more are allowed', () => {
    let s = newGame();
    rig(s, L.mary, 'resources');
    nicosOnRD(s);
    s = cont(run(s, 'rd'));
    expect(breachTotal(s)).toBe(1);
    let t = newGame();
    rig(t, L.mary, 'resources');
    rig(t, L.manuel, 'resources');
    nicosOnRD(t);
    t.runner.tags = 1;
    t = cont(run(t, 'rd'));
    expect(breachTotal(choose(t, 'no'))).toBe(2);
    expect(breachTotal(choose(t, 'yes'))).toBe(3);
  });

  it('Ashen Epilogue recycles grip and heap, removes 5 from the game and draws 5', () => {
    let s = newGame();
    const heapCard = createCardInstance(s, SG.sureGamble);
    s.runner.heap.push(heapCard);
    const total = s.runner.grip.length + s.runner.heap.length + s.runner.stack.length;
    let ev: string;
    [s, ev] = playRunner(s, L.ashen);
    expect(s.runner.grip.length).toBe(5);
    expect(s.runner.heap.length).toBe(0);
    expect(s.removedFromGame.map(c => c.instanceId)).toContain(ev);
    expect(s.runner.grip.length + s.runner.stack.length).toBe(total + 1 - 1 - 5);
  });

  it('Valentina Ferreira Carvalho gains 1 whenever tags are removed, and offers a tag or 2 credits on install at threat 3', () => {
    let s = newGame();
    threat(s, 3);
    s.runner.tags = 2;
    const [s1] = runnerInstall(s, L.valentina);
    s = s1;
    const credits = s.runner.credits;
    s = choose(s, 'tag');
    expect(s.runner.tags).toBe(1);
    expect(s.runner.credits).toBe(credits + 1);
  });
});

void SG;
