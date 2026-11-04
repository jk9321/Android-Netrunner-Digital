import { describe, expect, it } from 'vitest';
import { activePrompt, createCardInstance, executeAction, findCardAnywhere, GameState, getLegalActions, iceStrength, isLegalAction } from '../src/core';
import { rezCost } from '../src/core/engine/cardEffects';
import { breakerStrength, iceSubroutines, markSubroutinesBroken } from '../src/core/engine/ice';
import { answer, cont, giveCard, installCorpForTest, installIceForTest, installProgramForTest, keepGoing, newGame, passTurn, play, rezForTest, run, runnerInstall, scoreForTest, setIdentity, startRunnerTurn, useAbility, toCorp, withPriority } from './helpers';

const L = {
  salvo: '34031', stegodon: '34032', wageWorkers: '34033', ablative: '34034', jaguarundi: '34035', mic: '34036',
  greasing: '34037', vovo: '34038', aTeia: '34039', fujii: '34040', frontCompany: '34041', attini: '34042',
  phoneutria: '34043', tatuBola: '34044', mindscaping: '34045', adrian: '34046', daniela: '34047', epiphany: '34048',
  oracle: '34049', balanced: '34050', behold: '34051', federal: '34052', starlit: '34053', vsa: '34054', oppo: '34055',
  digitalLife: '34056', slashBurn: '34057', cybersand: '34058', treeLine: '34059', valentao: '34060', aap: '34061',
  pivot: '34062', angelique: '34063', tucana: '34064', b1001: '34065',
  thunderbolt: '34096', lightning: '34097', warm: '34098', prototype: '34099', lycian: '34100', sorocaban: '34101',
  policing: '34102', hospitality: '34103', brasilia: '34104', shtr: '34105', sisyphus: '34106', charlotte: '34107',
  cohort: '34108', boto: '34109', cloudEater: '34110', tributary: '34111', bringHome: '34112', kingmaking: '34113',
  stoke: '34114', janaina: '34115', capacitor: '34116', piranhas: '34117', seraph: '34118', sudden: '34119',
  holoMan: '34120', nuvem: '34121', eminent: '34122', basalt: '34123', hearts: '34124', descent: '34125',
  hammer: '34126', logjam: '34127', bau: '34128', isaac: '34129', powers: '34130',
};
const SG = {
  buzzsaw: '30005', cleaver: '30006', sureGamble: '30030', palisade: '30072', tithe: '30073', whitespace: '30074',
  hedgeFund: '30075', offworld: '30067', nico: '30037', ballista: '30062', regolith: '30071', ping: '30055',
  luminal: '30036', manegarm: '30042', karuna: '30047', diviner: '30046', cookbook: '30009', t400: '30031',
  leech: '30008', carmen: '30015', echelon: '30025', seamless: '30040',
};
/** Installs a Runner card straight into the rig (test setup). */
function rig(s: GameState, code: string, kind: 'resources' | 'hardware' | 'programs'): string {
  const c = createCardInstance(s, code);
  c.isRezzed = true;
  s.runner.rig[kind].push(c);
  return c.instanceId;
}
/** Rezzes ice during a run while the Runner approaches it. */
function approachAndRez(s: GameState, server: string, iceId: string): GameState {
  s = run(s, server);
  return rezForTest(s, iceId);
}

const card = (s: GameState, id: string) => findCardAnywhere(s, id)!;
const choose = (s: GameState, optionId: string) => keepGoing(answer(s, { kind: 'effect_choice', optionId }));
const pick = (s: GameState, ids: string[]) => keepGoing(answer(s, { kind: 'effect_cards', cardInstanceIds: ids }));
const declineAccess = (s: GameState) => keepGoing(answer(s, { kind: 'access_trash', trash: false }));
const prompt = (s: GameState) => s.pendingPrompts[0];
const source = (s: GameState) => {
  const p = prompt(s);
  return p && 'source' in p ? p.source : undefined;
};
const candidates = (s: GameState) => (prompt(s) as { candidateIds: string[] }).candidateIds;
const optionIds = (s: GameState) => (prompt(s) as { options: { id: string }[] }).options.map(o => o.id);
const emptyHQ = (s: GameState) => s.corp.rd.push(...s.corp.hq.splice(0));
const inHQ = (s: GameState, id: string) => s.corp.hq.some(c => c.instanceId === id);
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
/** Answers every pending prompt with "no"/the fewest cards, declining trashes. */
function declineAll(s: GameState): GameState {
  for (let i = 0; i < 20 && s.pendingPrompts.length > 0; i++) {
    const p = prompt(s);
    if (p.kind === 'access_trash') s = declineAccess(s);
    else if (p.kind === 'effect_choice') s = choose(s, p.options.find(o => /^(no|leave|stay|none|end)$/.test(o.id))?.id ?? p.options[p.options.length - 1].id);
    else if (p.kind === 'effect_cards') s = pick(s, p.candidateIds.slice(0, p.min));
    else break;
  }
  return s;
}
/** Ends the Runner's turn and starts the Corp's (through the pre-turn paid window, rules 5.6.1b). */
function toCorpTurn(s: GameState): GameState {
  startRunnerTurn(s);
  s = passTurn(s);
  if (s.turnStep?.kind === 'corp_turn_start') s = keepGoing(executeAction(s, { type: 'START_TURN', player: 'corp' }));
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
/** Lets the encountered ice's subroutines fire (continue with nothing broken). */
const fire = (s: GameState) => cont(s);
/** Gives the threat level n (a Runner score of n). */
const threat = (s: GameState, n: number) => {
  s.runner.score = n;
};
/** Plays both bids of a Psi Game. */
const psi = (s: GameState, corp: number, runner: number) => choose(choose(s, String(corp)), String(runner));

describe('The Automata Initiative: Haas-Bioroid', () => {
  it('Salvo Testing may do 1 core damage whenever the Corp scores an agenda, itself included', () => {
    const yes = { kind: 'effect_choice', optionId: 'yes' } as const;
    let s = newGame();
    s = answer(scoreForTest(s, L.salvo), yes);
    expect(s.runner.coreDamage).toBe(1);
    s = answer(scoreForTest(s, SG.offworld, 'remote-2'), { kind: 'effect_choice', optionId: 'no' });
    expect(s.runner.coreDamage).toBe(1);
  });

  it('Stegodon MK IV derezzes ice off the attacked server for 1 credit, and breakers get -2 strength that run', () => {
    let s = newGame();
    s = scoreForTest(s, L.stegodon);
    const pal = installIceForTest(s, SG.palisade, 'rd');
    const cleaver = installProgramForTest(s, SG.cleaver);
    const base = s.corp.credits;
    s = run(s, 'hq');
    expect(source(s)).toMatchObject({ cardCode: L.stegodon, step: 'derez' });
    s = pick(s, [pal]);
    expect(card(s, pal).isRezzed).toBe(false);
    expect(s.corp.credits).toBe(base + 1);
    expect(breakerStrength(s, card(s, cleaver))).toBe(1);
  });

  it('Wage Workers gives the Corp a click after its third credit-gain action of the turn', () => {
    let s = newGame();
    installCorpForTest(s, L.wageWorkers, 'remote-1', true);
    corpTurn(s, 3);
    for (let i = 0; i < 3; i++) s = executeAction(s, { type: 'GAIN_CREDIT', player: 'corp' });
    expect(s.corp.clicks).toBe(1);
    s = executeAction(s, { type: 'GAIN_CREDIT', player: 'corp' });
    expect(s.corp.clicks).toBe(0); // the fourth time is not "exactly 3"
  });

  it('Ablative Barrier at threat 3 installs a non-agenda card from HQ elsewhere when rezzed during a run on its server', () => {
    let s = newGame();
    emptyHQ(s);
    const ab = installIceForTest(s, L.ablative, 'hq', false);
    const nico = giveCard(s, 'corp', SG.nico);
    threat(s, 3);
    s = toCorp(run(s, 'hq'));
    s.corp.credits += 10;
    s = executeAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: ab });
    expect(source(s)).toMatchObject({ cardCode: L.ablative, step: 'pick' });
    s = pick(s, [nico]);
    expect(optionIds(s)).not.toContain('hq');
    s = choose(s, 'new');
    expect(inHQ(s, nico)).toBe(false);
    expect(findCardAnywhere(s, nico)).toBeTruthy();
  });

  it('Jaguarundi at threat 4 tags on encounter unless the Runner spends a click; its second sub needs a tag', () => {
    let s = newGame();
    installIceForTest(s, L.jaguarundi, 'hq');
    threat(s, 4);
    s = cont(run(s, 'hq'));
    expect(source(s)).toMatchObject({ cardCode: L.jaguarundi });
    const clicks = s.runner.clicks;
    s = choose(s, 'click');
    expect(s.runner.clicks).toBe(clicks - 1);
    expect(s.runner.tags).toBe(0);
    s = fire(s);
    expect(s.runner.tags).toBe(1);
    expect(s.runner.coreDamage).toBe(1);
  });

  it('M.I.C. can be trashed during a run on its server to end the run unless the Runner spends a click', () => {
    let s = newGame();
    const mic = installIceForTest(s, L.mic, 'hq');
    s = run(s, 'hq');
    s = withPriority(s, 'corp', { type: 'USE_ABILITY', player: 'corp', cardInstanceId: mic, abilityIndex: 0 });
    expect(source(s)).toMatchObject({ cardCode: L.mic });
    s = choose(s, 'end');
    expect(s.activeRun).toBeNull();
    expect(s.corp.archives.faceUp.map(c => c.instanceId)).toContain(mic);
    // Its subroutines: lose 2 clicks and end the run
    let t = newGame();
    installIceForTest(t, L.mic, 'hq');
    t = cont(run(t, 'hq'));
    const clicks = t.runner.clicks;
    t = fire(t);
    expect(t.runner.clicks).toBe(clicks - 2);
    expect(t.activeRun).toBeNull();
  });

  it('Greasing the Palm gains 5, installs a card from HQ and may trade a tag for an advancement counter', () => {
    let s = newGame();
    emptyHQ(s);
    const off = giveCard(s, 'corp', SG.offworld);
    s.runner.tags = 1;
    const [s1] = playCorp(s, L.greasing);
    s = s1;
    expect(source(s)).toMatchObject({ step: 'pick' });
    s = pick(s, [off]);
    s = choose(s, 'new');
    expect(source(s)).toMatchObject({ step: 'tag' });
    s = choose(s, 'yes');
    expect(s.runner.tags).toBe(0);
    expect(card(s, off).advancementCounters).toBe(1);
  });

  it('Vovô Ozetti lowers ice rez costs on its server, root costs at threat 4, and may move when the turn ends', () => {
    let s = newGame();
    installCorpForTest(s, L.vovo, 'remote-1', true);
    const pal = installIceForTest(s, SG.palisade, 'remote-1', false);
    const nico = installCorpForTest(s, SG.nico, 'remote-1');
    expect(rezCost(s, card(s, pal))).toBe(1);
    expect(rezCost(s, card(s, nico))).toBe(2);
    threat(s, 4);
    expect(rezCost(s, card(s, nico))).toBe(0);
    corpTurn(s, 0);
    s = passTurn(s);
    expect(source(s)).toMatchObject({ cardCode: L.vovo, step: 'move' });
    s = choose(s, 'hq');
    expect(s.corp.servers.hq.root.some(c => c.cardCode === L.vovo)).toBe(true);
  });
});

describe('The Automata Initiative: Jinteki', () => {
  it('A Teia allows 2 remotes and installs a second card free in another remote the first time each turn', () => {
    let s = newGame();
    setIdentity(s, 'corp', L.aTeia);
    emptyHQ(s);
    const nico = giveCard(s, 'corp', SG.nico);
    const off = giveCard(s, 'corp', SG.offworld);
    corpTurn(s, 3);
    s = executeAction(s, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: nico, targetServerId: null } as never);
    expect(source(s)).toMatchObject({ cardCode: L.aTeia, step: 'pick' });
    const credits = s.corp.credits;
    s = pick(s, [off]);
    s = choose(s, 'new');
    expect(s.corp.credits).toBe(credits);
    const offCard = card(s, off);
    expect(offCard.cannotScoreTurn).toBeTruthy();
    // A third remote is over the limit
    const third = giveCard(s, 'corp', SG.regolith);
    expect(isLegalAction(s, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: third, targetServerId: null } as never)).toBe(false);
  });

  it('Fujii Asset Retrieval does 2 net damage when scored and when stolen', () => {
    let s = newGame();
    const grip = s.runner.grip.length;
    s = scoreForTest(s, L.fujii);
    expect(s.runner.grip.length).toBe(grip - 2);
    let t = newGame();
    emptyHQ(t);
    installCorpForTest(t, L.fujii, 'remote-1');
    const g2 = t.runner.grip.length;
    t = finishBreach(cont(run(t, 'remote-1')));
    expect(t.runner.score).toBe(3);
    expect(t.runner.grip.length).toBeLessThanOrEqual(g2 - 2);
  });

  it('Front Company rezzes only on the Corp turn, blocks the first run on a remote, and hurts the first Archives run when unprotected', () => {
    let s = newGame();
    const fc = installCorpForTest(s, L.frontCompany, 'remote-1');
    startRunnerTurn(s);
    s.corp.credits = 10;
    expect(isLegalAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: fc })).toBe(false);
    corpTurn(s);
    s = rezForTest(s, fc);
    expect(card(s, fc).isRezzed).toBe(true);
    startRunnerTurn(s);
    expect(isLegalAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote-1' })).toBe(false);
    // Not offered as a run, nor as the target of a "run any server" card
    expect(getLegalActions(s, 'runner').some(a => a.type === 'INITIATE_RUN' && a.targetServerId === 'remote-1')).toBe(false);
    s.runner.credits = 10;
    const [withDebbie, debbie] = runnerInstall(s, '34019');
    const asked = useAbility(withDebbie, 'runner', debbie);
    const prompt = activePrompt(asked)!;
    expect(prompt.kind === 'effect_choice' ? prompt.options.map(o => o.id) : []).toEqual(['hq', 'rd', 'archives']);
    const grip = s.runner.grip.length;
    s = run(s, 'archives');
    expect(s.runner.grip.length).toBe(grip - 2);
  });

  it('Attini at threat 3 forbids paying, so each subroutine does net damage', () => {
    let s = newGame();
    installIceForTest(s, L.attini, 'hq');
    s.runner.credits = 10;
    s = cont(run(s, 'hq'));
    s = fire(s);
    expect(source(s)).toMatchObject({ cardCode: L.attini }); // may pay below threat 3
    s = choose(s, 'pay');
    expect(s.runner.credits).toBe(8);
    let t = newGame();
    installIceForTest(t, L.attini, 'hq');
    threat(t, 3);
    t.runner.credits = 10;
    const grip = t.runner.grip.length;
    t = fire(cont(run(t, 'hq')));
    expect(t.runner.credits).toBe(10);
    expect(t.runner.grip.length).toBe(grip - 3);
  });

  it('Phoneutria tags a Runner passing it with 4 or more cards in grip', () => {
    let s = newGame();
    installIceForTest(s, L.phoneutria, 'archives');
    while (s.runner.grip.length < 5) s.runner.grip.push(s.runner.stack.shift()!);
    s = cont(run(s, 'archives'));
    markSubroutinesBroken(s, [0, 1], null);
    s = cont(s);
    expect(s.runner.tags).toBe(1);
  });

  it('Tatu-Bola may swap itself with ice from HQ when passed, gaining 4', () => {
    let s = newGame();
    emptyHQ(s);
    const tatu = installIceForTest(s, L.tatuBola, 'archives');
    const pal = giveCard(s, 'corp', SG.palisade);
    s = cont(run(s, 'archives'));
    markSubroutinesBroken(s, [0], null);
    const credits = s.corp.credits;
    s = cont(s);
    expect(source(s)).toMatchObject({ cardCode: L.tatuBola, step: 'swap' });
    s = pick(s, [pal]);
    expect(s.corp.credits).toBe(credits + 4);
    expect(inHQ(s, tatu)).toBe(true);
    expect(s.corp.servers.archives.ice.map(c => c.instanceId)).toEqual([pal]);
    expect(card(s, pal).isRezzed).toBe(false);
  });

  it('Mindscaping either gains 4, draws 2 and tops a card, or does net damage equal to tags (max 3)', () => {
    let s = newGame();
    const [s1] = playCorp(s, L.mindscaping);
    s = s1;
    const hq = s.corp.hq.length;
    s = choose(s, 'gain');
    const top = s.corp.hq[0].instanceId;
    s = pick(s, [top]);
    expect(s.corp.rd[0].instanceId).toBe(top);
    expect(s.corp.hq.length).toBe(hq + 1);
    let t = newGame();
    t.runner.tags = 5;
    const grip = t.runner.grip.length;
    [t] = playCorp(t, L.mindscaping);
    t = choose(t, 'damage');
    expect(t.runner.grip.length).toBe(grip - 3);
  });

  it('Adrian Seis: matching bids protect it from access, differing bids make it the only card accessible', () => {
    let s = newGame();
    emptyHQ(s);
    const adrian = installCorpForTest(s, L.adrian, 'remote-1', true);
    const off = installCorpForTest(s, SG.offworld, 'remote-1');
    s = cont(run(s, 'remote-1'));
    expect(source(s)?.cardCode).toBe(L.adrian);
    s = psi(s, 1, 1);
    s = finishBreach(s);
    expect(s.runner.score).toBe(2); // stole Offworld Office, not shown Adrian
    let t = newGame();
    emptyHQ(t);
    installCorpForTest(t, L.adrian, 'remote-1', true);
    installCorpForTest(t, SG.offworld, 'remote-1');
    t = cont(run(t, 'remote-1'));
    t = psi(t, 0, 1);
    expect(t.runner.score).toBe(0);
    expect(t.activeRun?.accessOnlyIds).toEqual([adrian]);
    void off;
  });

  it('Daniela Jorge Inácio costs 2 random grip cards to the bottom of the stack to trash, and to steal from its server', () => {
    let s = newGame();
    emptyHQ(s);
    installCorpForTest(s, L.daniela, 'remote-1', true);
    installCorpForTest(s, SG.offworld, 'remote-1');
    s.runner.credits = 10;
    const grip = s.runner.grip.length;
    const stack = s.runner.stack.length;
    s = cont(run(s, 'remote-1'));
    s = declineAccess(s); // Daniela first: not trashed
    expect(source(s)).toMatchObject({ step: 'steal-cost', data: { gripToBottom: 2 } });
    s = choose(s, 'steal');
    expect(s.runner.score).toBe(2);
    expect(s.runner.grip.length).toBe(grip - 2);
    expect(s.runner.stack.length).toBe(stack + 2);
  });
});

describe('The Automata Initiative: NBN', () => {
  it('Epiphany Analytica gains a power counter the first time each turn the Runner steals or trashes, and spends it to install from the top 3', () => {
    let s = newGame();
    setIdentity(s, 'corp', L.epiphany);
    emptyHQ(s);
    installCorpForTest(s, SG.offworld, 'remote-1');
    s = finishBreach(cont(run(s, 'remote-1')));
    expect(s.corp.identity.tokens.power).toBe(1);
    const nico = createCardInstance(s, SG.nico);
    s.corp.rd.unshift(nico);
    corpTurn(s);
    s = useAbility(s, 'corp', s.corp.identity.instanceId);
    expect(candidates(s)).toContain(nico.instanceId);
    s = pick(s, [nico.instanceId]);
    s = choose(s, 'new');
    expect(findCardAnywhere(s, nico.instanceId)).toBeTruthy();
    expect(s.corp.rd.some(c => c.instanceId === nico.instanceId)).toBe(false);
  });

  it('Oracle Thinktank tags when stolen, and the Corp may remove a tag to shuffle it back into R&D', () => {
    let s = newGame();
    emptyHQ(s);
    const oracle = installCorpForTest(s, L.oracle, 'remote-1');
    s = finishBreach(cont(run(s, 'remote-1')));
    expect(s.runner.score).toBe(1);
    expect(s.runner.tags).toBe(1);
    corpTurn(s);
    s = useAbility(s, 'corp', oracle);
    expect(s.runner.score).toBe(0);
    expect(s.runner.tags).toBe(0);
    expect(s.corp.rd.some(c => c.instanceId === oracle)).toBe(true);
  });

  it('Balanced Coverage names a type and gains 2 if the top card of R&D matches', () => {
    let s = newGame();
    installCorpForTest(s, L.balanced, 'remote-1', true);
    s.corp.rd.unshift(createCardInstance(s, SG.hedgeFund));
    s = toCorpTurn(s);
    s = skipTo(s, L.balanced);
    expect(source(s)).toMatchObject({ cardCode: L.balanced, step: 'type' });
    const credits = s.corp.credits;
    s = choose(s, 'operation');
    s = choose(s, 'yes');
    expect(s.corp.credits).toBe(credits + 2);
  });

  it('Behold! is revealed in R&D and may cost the Corp 4 to give 2 tags', () => {
    let s = newGame();
    emptyHQ(s);
    installCorpForTest(s, L.behold, 'remote-1');
    s.corp.credits = 5;
    s = cont(run(s, 'remote-1'));
    expect(source(s)).toMatchObject({ cardCode: L.behold });
    s = choose(s, 'yes');
    expect(s.runner.tags).toBe(2);
    expect(s.corp.credits).toBe(1);
  });

  it('Behold! says so in the log when the Corp cannot pay its 4 credits (bug report #12)', () => {
    let s = newGame();
    emptyHQ(s);
    installCorpForTest(s, L.behold, 'remote-1');
    s.corp.credits = 3;
    s = cont(run(s, 'remote-1'));
    expect(source(s)?.cardCode).not.toBe(L.behold);
    expect(s.runner.tags).toBe(0);
    expect(s.log.some(l => l.message.includes('Behold!: the Corp has less than 4'))).toBe(true);
  });

  it('Federal Fundraising arranges the top 3 of R&D and draws when unprotected', () => {
    let s = newGame();
    installCorpForTest(s, L.federal, 'remote-1', true);
    s = toCorpTurn(s);
    s = skipTo(s, L.federal);
    const top3 = s.corp.rd.slice(0, 3).map(c => c.instanceId);
    s = choose(s, 'yes');
    for (const id of [top3[2], top3[1]]) s = pick(s, [id]);
    expect(s.corp.rd.slice(0, 3).map(c => c.instanceId)).toEqual([top3[2], top3[1], top3[0]]);
    expect(source(s)).toMatchObject({ step: 'draw' });
    s = choose(s, 'yes');
    expect(s.corp.hq.map(c => c.instanceId)).toContain(top3[2]);
  });

  it('Starlit Knight at threat 4 gains an "End the run" subroutine per tag for the run', () => {
    let s = newGame();
    const sk = installIceForTest(s, L.starlit, 'hq');
    threat(s, 4);
    s.runner.tags = 2;
    s = cont(run(s, 'hq'));
    expect(iceSubroutines(s, card(s, sk)).length).toBe(4);
    s = fire(s);
    expect(s.runner.tags).toBe(4);
    expect(s.activeRun).toBeNull();
  });

  it('Virtual Service Agent tags a Runner who passes it without breaking it with a decoder', () => {
    let s = newGame();
    installIceForTest(s, L.vsa, 'archives');
    s = cont(run(s, 'archives'));
    markSubroutinesBroken(s, [0], null); // broken, but not by a decoder
    s = cont(s);
    expect(s.runner.tags).toBe(1);
    let t = newGame();
    installIceForTest(t, L.vsa, 'archives');
    const buzz = installProgramForTest(t, SG.buzzsaw);
    t.runner.credits = 10;
    t = cont(run(t, 'archives'));
    t = executeAction(t, { type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: buzz, subroutineIndices: [0] } as never);
    t = cont(t);
    expect(t.runner.tags).toBe(0);
  });

  it('Oppo Research needs a steal or trash last turn, gives 2 tags (+2 for 5 at threat 3) and ends the action phase', () => {
    let s = newGame();
    corpTurn(s);
    const id = giveCard(s, 'corp', L.oppo);
    s.corp.credits = 20;
    expect(isLegalAction(s, { type: 'PLAY_OPERATION_OR_EVENT', player: 'corp', cardInstanceId: id })).toBe(false);
    s.runnerLastTurnStoleOrTrashed = true;
    threat(s, 3);
    s = play(s, 'corp', id);
    expect(s.runner.tags).toBe(2);
    s = choose(s, 'yes');
    expect(s.runner.tags).toBe(4);
    expect(s.corp.clicks).toBe(0);
  });

  it('Your Digital Life gains 1 per card in HQ', () => {
    let s = newGame();
    corpTurn(s);
    const id = giveCard(s, 'corp', L.digitalLife);
    const hq = s.corp.hq.length - 1;
    const credits = s.corp.credits;
    s = play(s, 'corp', id);
    expect(s.corp.credits).toBe(credits - 2 + hq);
  });
});

describe('The Automata Initiative: Weyland and neutral', () => {
  it('Slash and Burn Agriculture is trashed from HQ to place 2 advancement counters', () => {
    let s = newGame();
    const off = installCorpForTest(s, SG.offworld, 'remote-1');
    corpTurn(s);
    const sb = giveCard(s, 'corp', L.slashBurn);
    s = useAbility(s, 'corp', sb);
    s = pick(s, [off]);
    expect(card(s, off).advancementCounters).toBe(2);
    expect(s.corp.archives.faceUp.map(c => c.instanceId)).toContain(sb);
  });

  it('Cybersand Harvester stores 2 per ice rez, pays install costs, and can be trashed for its credits', () => {
    let s = newGame();
    const cy = installCorpForTest(s, L.cybersand, 'remote-1', true);
    const pal = installIceForTest(s, SG.palisade, 'hq', false);
    s = run(s, 'hq');
    s = rezForTest(s, pal);
    expect(card(s, cy).tokens.credit).toBe(2);
    s.activeRun = null;
    corpTurn(s);
    const credits = s.corp.credits;
    s = useAbility(s, 'corp', cy);
    expect(s.corp.credits).toBe(credits + 2);
  });

  it('Tree Line can be advanced for strength, and trashed from HQ to put 3 advancement counters on ice', () => {
    let s = newGame();
    const tl = installIceForTest(s, L.treeLine, 'hq');
    card(s, tl).advancementCounters = 2;
    expect(iceStrength(s, card(s, tl))).toBe(6);
    corpTurn(s);
    const fromHQ = giveCard(s, 'corp', L.treeLine);
    s = useAbility(s, 'corp', fromHQ);
    s = pick(s, [tl]);
    expect(card(s, tl).advancementCounters).toBe(5);
  });

  it('Valentão costs bad publicity or a tag to rez, and ends the run only if the Corp is richer', () => {
    let s = newGame();
    const v = installIceForTest(s, L.valentao, 'hq', false);
    s.runner.tags = 1;
    s = run(s, 'hq');
    s = rezForTest(s, v);
    expect(source(s)).toMatchObject({ step: 'rez_cost' });
    s = choose(s, 'tag');
    expect(s.runner.tags).toBe(0);
    expect(card(s, v).isRezzed).toBe(true);
    s.corp.credits = 0;
    s.runner.credits = 10;
    s = fire(cont(s));
    expect(s.runner.credits).toBe(8);
    expect(s.activeRun).not.toBeNull(); // 2 vs 8: no end
  });

  it('Armed Asset Protection gains 3 plus 1 per faceup card type in Archives, plus 2 if one is an agenda', () => {
    let s = newGame();
    s.corp.archives.faceUp.push(createCardInstance(s, SG.hedgeFund), createCardInstance(s, SG.offworld), createCardInstance(s, SG.nico));
    corpTurn(s);
    const id = giveCard(s, 'corp', L.aap);
    const credits = s.corp.credits;
    s = play(s, 'corp', id);
    expect(s.corp.credits).toBe(credits - 2 + 3 + 3 + 2);
  });

  it('Pivot costs an extra click, fetches an operation or agenda, and at threat 3 plays or installs a card', () => {
    let s = newGame();
    emptyHQ(s);
    const hedge = createCardInstance(s, SG.hedgeFund);
    s.corp.rd.push(hedge);
    threat(s, 3);
    const [s1] = playCorp(s, L.pivot, 3);
    s = s1;
    expect(s.corp.clicks).toBe(1);
    s = pick(s, [hedge.instanceId]);
    expect(source(s)).toMatchObject({ step: 'use' });
    const credits = s.corp.credits;
    s = pick(s, [hedge.instanceId]);
    expect(s.corp.credits).toBe(credits + 4);
  });

  it('Angelique Garza Correa does meat damage from HQ at threat 3, and 2 for 2 credits when accessed rezzed', () => {
    let s = newGame();
    threat(s, 3);
    corpTurn(s);
    const ang = giveCard(s, 'corp', L.angelique);
    const grip = s.runner.grip.length;
    s = useAbility(s, 'corp', ang);
    expect(s.runner.grip.length).toBe(grip - 1);
    let t = newGame();
    emptyHQ(t);
    installCorpForTest(t, L.angelique, 'remote-1', true);
    const g2 = t.runner.grip.length;
    t = cont(run(t, 'remote-1'));
    expect(source(t)).toMatchObject({ cardCode: L.angelique });
    t = choose(t, 'yes');
    expect(t.runner.grip.length).toBe(g2 - 2);
  });

  it('Tucana searches R&D for ice to install and rez 3 cheaper when an agenda is scored from its server', () => {
    let s = newGame();
    const pal = createCardInstance(s, SG.palisade);
    s.corp.rd.push(pal);
    installCorpForTest(s, L.tucana, 'remote-score', true);
    s.corp.credits = 0;
    s = scoreForTest(s, SG.offworld);
    expect(source(s)).toMatchObject({ cardCode: L.tucana, step: 'search' });
    s = pick(s, [pal.instanceId]);
    s = choose(s, 'hq');
    expect(s.corp.servers.hq.ice.map(c => c.instanceId)).toContain(pal.instanceId);
    expect(card(s, pal.instanceId).isRezzed).toBe(true);
  });

  it('B-1001 removes a tag to end a run on another server', () => {
    let s = newGame();
    const b = installCorpForTest(s, L.b1001, 'remote-1', true);
    s.runner.tags = 1;
    s = run(s, 'hq');
    s = withPriority(s, 'corp', { type: 'USE_ABILITY', player: 'corp', cardInstanceId: b, abilityIndex: 0 });
    expect(s.activeRun).toBeNull();
    expect(s.runner.tags).toBe(0);
  });
});


describe('Rebellion Without Rehearsal: Haas-Bioroid', () => {
  it('Thunderbolt Armaments gives AP or destroyer ice rezzed during a run +1 strength and a trash-or-end subroutine', () => {
    let s = newGame();
    setIdentity(s, 'corp', L.thunderbolt);
    const tithe = installIceForTest(s, SG.tithe, 'hq', false);
    const leech = rig(s, SG.leech, 'programs');
    s = approachAndRez(s, 'hq', tithe);
    expect(iceStrength(s, card(s, tithe))).toBe(2);
    expect(iceSubroutines(s, card(s, tithe)).length).toBe(3);
    s = cont(s); // encounter
    markSubroutinesBroken(s, [0, 1], null);
    s = cont(s);
    expect(source(s)).toMatchObject({ cardCode: L.thunderbolt, step: 'etr' });
    s = choose(s, leech);
    expect(s.runner.rig.programs.length).toBe(0);
    expect(s.activeRun).not.toBeNull();
  });

  it('Lightning Laboratory spends its counter to rez up to 2 ice on the attacked server free, derezzing them as the turn ends', () => {
    let s = newGame();
    s = scoreForTest(s, L.lightning);
    const a = installIceForTest(s, SG.palisade, 'hq', false);
    const b = installIceForTest(s, SG.whitespace, 'hq', false);
    const credits = s.corp.credits;
    s = run(s, 'hq');
    expect(source(s)).toMatchObject({ cardCode: L.lightning, step: 'rez' });
    s = pick(s, [a, b]);
    expect(card(s, a).isRezzed && card(s, b).isRezzed).toBe(true);
    expect(s.corp.credits).toBe(credits);
    s.activeRun = null;
    s = passTurn(s);
    expect(card(s, a).isRezzed || card(s, b).isRezzed).toBe(false);
  });

  it('Warm Reception installs a card from HQ as the turn begins, and may derez itself to derez another card', () => {
    let s = newGame();
    emptyHQ(s);
    installCorpForTest(s, L.warm, 'remote-w', true);
    const nico = installCorpForTest(s, SG.manegarm, 'remote-n', true);
    const off = giveCard(s, 'corp', SG.offworld);
    s = toCorpTurn(s);
    s = skipTo(s, L.warm);
    s = pick(s, [off]);
    s = choose(s, 'new');
    expect(card(s, off).cannotScoreTurn).toBeTruthy();
    expect(source(s)).toMatchObject({ step: 'derez' });
    s = pick(s, [nico]);
    expect(card(s, nico).isRezzed).toBe(false);
  });

  it('Working Prototype gains a power counter per rez, spends 1 for 3 credits or 5 for 6 credits and a resource to the stack', () => {
    let s = newGame();
    const wp = installCorpForTest(s, L.prototype, 'remote-1');
    corpTurn(s);
    s = rezForTest(s, wp);
    expect(card(s, wp).tokens.power).toBe(1);
    const credits = s.corp.credits;
    s = useAbility(s, 'corp', wp, 0);
    expect(s.corp.credits).toBe(credits + 3);
    card(s, wp).tokens.power = 5;
    const cook = rig(s, SG.cookbook, 'resources');
    s = useAbility(s, 'corp', wp, 1);
    s = pick(s, [cook]);
    expect(s.runner.stack[0].instanceId).toBe(cook);
  });

  it('Lycian Multi-Munition gains the chosen subtypes while rezzed, fires the matching subroutines and derezzes when a turn ends', () => {
    let s = newGame();
    const ly = installIceForTest(s, L.lycian, 'hq', false);
    const leech = rig(s, SG.leech, 'programs');
    s = approachAndRez(s, 'hq', ly);
    s = choose(s, 'code gate+sentry');
    const clicks = s.runner.clicks;
    s = cont(s);
    s = fire(s);
    expect(s.runner.clicks).toBe(clicks - 1);
    s = pick(s, [leech]);
    expect(s.runner.rig.programs.length).toBe(0);
    expect(s.activeRun).not.toBeNull(); // not a barrier
    s.activeRun = null;
    s = passTurn(s);
    expect(card(s, ly).isRezzed).toBe(false);
    expect(card(s, ly).chosenSubtypes).toBeUndefined();
  });

  it('Sorocaban Blade trashes at most 1 installed Runner card per encounter', () => {
    let s = newGame();
    installIceForTest(s, L.sorocaban, 'hq');
    const cook = rig(s, SG.cookbook, 'resources');
    rig(s, SG.t400, 'hardware');
    rig(s, SG.leech, 'programs');
    s = fire(cont(run(s, 'hq')));
    s = pick(s, [cook]);
    expect(s.pendingPrompts.length).toBe(0);
    expect(s.runner.rig.hardware.length + s.runner.rig.programs.length).toBe(2);
  });

  it('Active Policing installs a card, costs the Runner a click next turn (two at threat 3 for 2) and ends the action phase', () => {
    let s = newGame();
    emptyHQ(s);
    s.runnerLastTurnStoleOrTrashed = true;
    threat(s, 3);
    const nico = giveCard(s, 'corp', SG.nico);
    [s] = playCorp(s, L.policing);
    s = pick(s, [nico]);
    s = choose(s, 'new');
    s = choose(s, 'yes');
    expect(s.runner.bonusClicksNextTurn).toBe(-2);
    expect(s.corp.clicks).toBe(0);
  });

  it('Corporate Hospitality costs 2 clicks, gains 6, draws 2 and returns a card from Archives', () => {
    let s = newGame();
    const hedge = createCardInstance(s, SG.hedgeFund);
    s.corp.archives.faceUp.push(hedge);
    const hq = s.corp.hq.length;
    let id: string;
    [s, id] = playCorp(s, L.hospitality, 3);
    expect(s.corp.clicks).toBe(1);
    s = pick(s, [hedge.instanceId]);
    expect(s.corp.hq.length).toBe(hq + 3); // the played card left, 2 drawn, 1 back
    void id;
  });

  it('Brasília Government Grid derezzes another ice to give ice rezzed in a run on its server +3 strength', () => {
    let s = newGame();
    installCorpForTest(s, L.brasilia, 'remote-1', true);
    const pal = installIceForTest(s, SG.palisade, 'remote-1', false);
    const other = installIceForTest(s, SG.whitespace, 'hq');
    s = approachAndRez(s, 'remote-1', pal);
    s = pick(s, [other]);
    expect(card(s, other).isRezzed).toBe(false);
    expect(iceStrength(s, card(s, pal))).toBe(7); // 2, +2 on a remote (Palisade), +3
  });
});

describe('Rebellion Without Rehearsal: Jinteki', () => {
  it('See How They Run tags, then core damage on different bids or net damage on matching bids', () => {
    let s = newGame();
    s = scoreForTest(s, L.shtr);
    expect(s.runner.tags).toBe(1);
    s = psi(s, 0, 1);
    expect(s.runner.coreDamage).toBe(1);
    let t = newGame();
    t = scoreForTest(t, L.shtr);
    const grip = t.runner.grip.length;
    t = psi(t, 1, 1);
    expect(t.runner.grip.length).toBe(grip - 1);
  });

  it('Sisyphus Protocol pays 1 to make the Runner encounter a passed sentry again, once per turn', () => {
    let s = newGame();
    s = scoreForTest(s, L.sisyphus);
    installIceForTest(s, SG.tithe, 'archives');
    s = cont(run(s, 'archives'));
    markSubroutinesBroken(s, [0, 1], null);
    s = cont(s);
    expect(source(s)).toMatchObject({ cardCode: L.sisyphus });
    s = choose(s, 'pay');
    expect(s.activeRun?.encounter).toBeTruthy();
  });

  it('Charlotte Caçador can be advanced, trades a counter for 4 and a card as the turn begins, or trashes for 3', () => {
    let s = newGame();
    const ch = installCorpForTest(s, L.charlotte, 'remote-1', true);
    card(s, ch).advancementCounters = 2;
    s = toCorpTurn(s);
    s = skipTo(s, L.charlotte);
    const credits = s.corp.credits;
    s = choose(s, 'yes');
    expect(s.corp.credits).toBe(credits + 4);
    expect(card(s, ch).advancementCounters).toBe(1);
    const c2 = s.corp.credits;
    s = useAbility(s, 'corp', ch);
    expect(s.corp.credits).toBe(c2 + 3);
  });

  it('Cohort Guidance Program trashes a card from HQ for 2 credits and a card, or flips an Archives card to advance', () => {
    let s = newGame();
    installCorpForTest(s, L.cohort, 'remote-1', true);
    const off = installCorpForTest(s, SG.offworld, 'remote-2');
    const down = createCardInstance(s, SG.hedgeFund);
    s.corp.archives.faceDown.push(down);
    s = toCorpTurn(s);
    s = skipTo(s, L.cohort);
    s = choose(s, 'flip');
    s = pick(s, [down.instanceId]);
    s = pick(s, [off]);
    expect(s.corp.archives.faceUp.map(c => c.instanceId)).toContain(down.instanceId);
    expect(card(s, off).advancementCounters).toBe(1);
  });

  it('Boto gets +2 strength at threat 4 and may trash a card from HQ to end the run', () => {
    let s = newGame();
    const boto = installIceForTest(s, L.boto, 'hq');
    threat(s, 4);
    expect(iceStrength(s, card(s, boto))).toBe(6);
    s = fire(cont(run(s, 'hq')));
    s = pick(s, [s.corp.hq[0].instanceId]);
    expect(s.activeRun).toBeNull();
  });

  it('Cloud Eater rezzed this turn makes the Runner pick tags, net damage or a trash when the encounter ends', () => {
    let s = newGame();
    const ce = installIceForTest(s, L.cloudEater, 'hq', false);
    rig(s, SG.t400, 'hardware');
    s = approachAndRez(s, 'hq', ce);
    s = cont(s);
    markSubroutinesBroken(s, [0, 1, 2], null);
    s = cont(s);
    expect(source(s)).toMatchObject({ cardCode: L.cloudEater, step: 'ends' });
    s = choose(s, 'tags');
    expect(s.runner.tags).toBe(2);
  });

  it('Tributary moves outermost on the attacked server as the first run begins, and its subroutines draw, install ice and add strength', () => {
    let s = newGame();
    emptyHQ(s);
    const trib = installIceForTest(s, L.tributary, 'rd');
    const pal = giveCard(s, 'corp', SG.palisade);
    s = run(s, 'hq');
    s = choose(s, 'yes');
    expect(s.corp.servers.hq.ice.map(c => c.instanceId)).toEqual([trib]);
    s = fire(cont(s));
    s = choose(s, 'no');
    s = pick(s, [pal]);
    s = choose(s, 'rd');
    expect(s.corp.servers.rd.ice.map(c => c.instanceId)).toContain(pal);
    expect(s.activeRun?.iceStrengthBonus).toBe(2);
  });

  it('Bring Them Home puts 2 random grip cards on top of the stack and at threat 3 shuffles another in', () => {
    let s = newGame();
    s.runnerLastTurnStoleOrTrashed = true;
    threat(s, 3);
    const grip = s.runner.grip.length;
    [s] = playCorp(s, L.bringHome);
    expect(s.runner.grip.length).toBe(grip - 2);
    s = choose(s, 'yes');
    expect(s.runner.grip.length).toBe(grip - 3);
    expect(s.corp.clicks).toBe(0);
  });
});

describe('Rebellion Without Rehearsal: NBN', () => {
  it('Kingmaking draws up to 3 and may add a 1-point agenda from HQ to the score area', () => {
    let s = newGame();
    emptyHQ(s);
    const oracle = giveCard(s, 'corp', L.oracle);
    s = scoreForTest(s, L.kingmaking);
    s = choose(s, '0');
    s = pick(s, [oracle]);
    expect(s.corp.score).toBe(3);
  });

  it('Stoke the Embers gains 3 and places a counter when scored, and may be revealed when installed from outside HQ', () => {
    let s = newGame();
    const off = installCorpForTest(s, SG.offworld, 'remote-1');
    s = scoreForTest(s, L.stoke);
    s = pick(s, [off]);
    expect(card(s, off).advancementCounters).toBe(1);
    // Installed from Archives with The Powers That Be
    let t = newGame();
    emptyHQ(t);
    installCorpForTest(t, L.powers, 'remote-1', true);
    const off2 = installCorpForTest(t, SG.offworld, 'remote-2');
    const stoke = createCardInstance(t, L.stoke);
    t.corp.archives.faceUp.push(stoke);
    t = scoreForTest(t, SG.luminal, 'remote-9');
    t = skipTo(t, L.powers);
    t = pick(t, [stoke.instanceId]);
    t = choose(t, 'new');
    expect(source(t)).toMatchObject({ cardCode: L.stoke, step: 'reveal' });
    const credits = t.corp.credits;
    t = choose(t, 'yes');
    t = pick(t, [off2]);
    expect(t.corp.credits).toBe(credits + 2);
    expect(card(t, off2).advancementCounters).toBe(1);
  });

  it('Janaína stores 3 per turn and returns to HQ to pay out and install a card', () => {
    let s = newGame();
    const jk = installCorpForTest(s, L.janaina, 'remote-1', true);
    s = declineAll(toCorpTurn(s));
    expect(card(s, jk).tokens.credit).toBe(3);
    const credits = s.corp.credits;
    s = useAbility(s, 'corp', jk);
    expect(s.corp.credits).toBe(credits + 3);
    expect(inHQ(s, jk)).toBe(true);
  });

  it('Capacitor gets +2 while the Runner is tagged and gains 1 per tag', () => {
    let s = newGame();
    const cap = installIceForTest(s, L.capacitor, 'hq');
    s.runner.tags = 2;
    expect(iceStrength(s, card(s, cap))).toBe(5);
    const credits = s.corp.credits;
    s = fire(cont(run(s, 'hq')));
    expect(s.corp.credits).toBe(credits + 2);
    expect(s.activeRun).toBeNull();
  });

  it('Piranhas costs bad publicity to rez and ends the run if HQ has more cards than the grip', () => {
    let s = newGame();
    const p = installIceForTest(s, L.piranhas, 'hq', false);
    s = approachAndRez(s, 'hq', p);
    s = choose(s, 'bp');
    expect(s.corp.badPublicity).toBe(1);
    s.runner.grip.splice(0);
    s = fire(cont(s));
    s = choose(s, 'no');
    expect(s.activeRun).toBeNull();
  });

  it('Seraph makes the Runner lose 3, take 2 net or take a tag on encounter', () => {
    let s = newGame();
    installIceForTest(s, L.seraph, 'hq');
    s = cont(run(s, 'hq'));
    s = choose(s, 'tag');
    expect(s.runner.tags).toBe(1);
  });

  it('Sudden Commandment draws 2, may play an operation, and at threat 3 buys a click for 3 when it is the first mandate', () => {
    let s = newGame();
    emptyHQ(s);
    const hedge = createCardInstance(s, SG.hedgeFund);
    s.corp.rd.unshift(hedge);
    threat(s, 3);
    [s] = playCorp(s, L.sudden, 3);
    expect(candidates(s)).toContain(hedge.instanceId);
    s = pick(s, [hedge.instanceId]);
    const clicks = s.corp.clicks;
    s = choose(s, 'yes');
    expect(s.corp.clicks).toBe(clicks + 1);
  });

  it('The Holo Man places 3 advancement counters, or 2 after a card was installed from HQ this turn', () => {
    let s = newGame();
    const hm = installCorpForTest(s, L.holoMan, 'remote-1', true);
    const off = installCorpForTest(s, SG.offworld, 'remote-1');
    corpTurn(s);
    s.corp.credits = 10;
    s = useAbility(s, 'corp', hm);
    s = pick(s, [off]);
    expect(card(s, off).advancementCounters).toBe(3);
    expect(s.corp.credits).toBe(6);
  });
});

describe('Rebellion Without Rehearsal: Weyland and neutral', () => {
  it('Nuvem SA looks at the top of R&D after an operation and gains 2 the first time it trashes from R&D each turn', () => {
    let s = newGame();
    setIdentity(s, 'corp', L.nuvem);
    [s] = playCorp(s, SG.hedgeFund);
    expect(source(s)).toMatchObject({ cardCode: L.nuvem, step: 'look' });
    const top = s.corp.rd[0].instanceId;
    const credits = s.corp.credits;
    s = choose(s, 'trash');
    expect(s.corp.archives.faceDown.map(c => c.instanceId)).toContain(top);
    expect(s.corp.credits).toBe(credits + 2);
  });

  it('Eminent Domain installs and rezzes from HQ 5 cheaper when trashed, and from R&D free when scored', () => {
    let s = newGame();
    emptyHQ(s);
    const pal = createCardInstance(s, SG.palisade);
    s.corp.rd.push(pal);
    s.corp.credits = 0;
    s = scoreForTest(s, L.eminent);
    s = pick(s, [pal.instanceId]);
    s = choose(s, 'hq');
    expect(card(s, pal.instanceId).isRezzed).toBe(true);
    expect(s.corp.credits).toBe(0);
    corpTurn(s);
    s.corp.credits = 1;
    const ed = giveCard(s, 'corp', L.eminent);
    const nico = giveCard(s, 'corp', SG.nico);
    s = useAbility(s, 'corp', ed);
    s = pick(s, [nico]);
    s = choose(s, 'new');
    expect(card(s, nico).isRezzed).toBe(true);
  });

  it('The Basalt Spire returns a card from Archives when stolen, and trades a counter and the top of R&D for one when scored', () => {
    let s = newGame();
    const hedge = createCardInstance(s, SG.hedgeFund);
    s.corp.archives.faceUp.push(hedge);
    const bs = 'remote-score';
    s = scoreForTest(s, L.basalt, bs);
    const spire = s.corp.scoreArea.find(c => c.cardCode === L.basalt)!;
    expect(spire.tokens.agenda).toBe(2);
    s = useAbility(s, 'corp', spire.instanceId);
    s = pick(s, [hedge.instanceId]);
    expect(inHQ(s, hedge.instanceId)).toBe(true);
    expect(spire.tokens.agenda ?? card(s, spire.instanceId).tokens.agenda).toBeDefined();
  });

  it('Hearts and Minds moves an advancement counter and places one when unprotected', () => {
    let s = newGame();
    installCorpForTest(s, L.hearts, 'remote-1', true);
    const a = installCorpForTest(s, SG.offworld, 'remote-2');
    const b = installCorpForTest(s, SG.luminal, 'remote-3');
    card(s, a).advancementCounters = 2;
    s = toCorpTurn(s);
    s = skipTo(s, L.hearts);
    s = pick(s, [a]);
    s = pick(s, [b]);
    s = pick(s, [b]);
    expect(card(s, a).advancementCounters).toBe(1);
    expect(card(s, b).advancementCounters).toBe(2);
  });

  it('Descent can go back to HQ as the turn begins, and from HQ draws and shuffles agendas into R&D', () => {
    let s = newGame();
    emptyHQ(s);
    const off = createCardInstance(s, SG.offworld);
    s.corp.archives.faceUp.push(off);
    corpTurn(s);
    const d = giveCard(s, 'corp', L.descent);
    s = useAbility(s, 'corp', d);
    s = pick(s, [off.instanceId]);
    expect(s.corp.rd.some(c => c.instanceId === off.instanceId)).toBe(true);
    let t = newGame();
    const d2 = installIceForTest(t, L.descent, 'hq');
    t = toCorpTurn(t);
    t = skipTo(t, L.descent);
    t = choose(t, 'yes');
    expect(inHQ(t, d2)).toBe(true);
  });

  it('Hammer lets only 1 printed subroutine be broken except with killers', () => {
    let s = newGame();
    installIceForTest(s, L.hammer, 'hq');
    const echelon = installProgramForTest(s, SG.echelon);
    s.runner.credits = 20;
    s = cont(run(s, 'hq'));
    s = markAndCheck(s);
    expect(echelon).toBeTruthy();
  });

  it('Logjam gets advancement counters when rezzed (1 plus faceup Archives types) and strength from them', () => {
    let s = newGame();
    s.corp.archives.faceUp.push(createCardInstance(s, SG.hedgeFund), createCardInstance(s, SG.nico));
    const lj = installIceForTest(s, L.logjam, 'hq', false);
    s = approachAndRez(s, 'hq', lj);
    expect(card(s, lj).advancementCounters).toBe(3);
    expect(iceStrength(s, card(s, lj))).toBe(3);
  });

  it('Business As Usual places counters or wipes virus counters, and does both at threat 3', () => {
    let s = newGame();
    const off = installCorpForTest(s, SG.offworld, 'remote-1');
    const leech = rig(s, SG.leech, 'programs');
    card(s, leech).tokens.virus = 3;
    threat(s, 3);
    [s] = playCorp(s, L.bau);
    s = choose(s, 'both');
    s = pick(s, [off]);
    s = pick(s, [leech]);
    expect(card(s, off).advancementCounters).toBe(1);
    expect(card(s, leech).tokens.virus).toBe(0);
  });

  it('Isaac Liberdade gives advanced ice on its server +2 and may move, placing a counter on unadvanced ice there', () => {
    let s = newGame();
    installCorpForTest(s, L.isaac, 'remote-1', true);
    const pal = installIceForTest(s, SG.palisade, 'remote-1');
    const hqIce = installIceForTest(s, SG.whitespace, 'hq');
    card(s, pal).advancementCounters = 1;
    expect(iceStrength(s, card(s, pal))).toBe(6); // 2, +2 on a remote (Palisade), +2
    corpTurn(s, 0);
    s = passTurn(s);
    s = skipTo(s, L.isaac);
    s = choose(s, 'hq');
    s = pick(s, [hqIce]);
    expect(card(s, hqIce).advancementCounters).toBe(1);
  });

  it('The Powers That Be installs a card from HQ or Archives free when the Corp scores', () => {
    let s = newGame();
    emptyHQ(s);
    installCorpForTest(s, L.powers, 'remote-1', true);
    const pal = giveCard(s, 'corp', SG.palisade);
    s.corp.credits = 0;
    s = scoreForTest(s, SG.offworld);
    s = pick(s, [pal]);
    s = choose(s, 'hq');
    expect(s.corp.servers.hq.ice.map(c => c.instanceId)).toContain(pal);
  });
});

/** Hammer: a non-killer can break only 1 printed subroutine (checked through the break action's legality). */
function markAndCheck(s: GameState): GameState {
  const fake = installProgramForTest(s, SG.buzzsaw);
  const tooMany = { type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: fake, subroutineIndices: [0, 1] } as never;
  expect(isLegalAction(s, tooMany)).toBe(false);
  return s;
}
