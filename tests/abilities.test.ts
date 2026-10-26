import { describe, expect, it } from 'vitest';
import { cardDef, executeAction, findCardAnywhere, getLegalActions, GameState, iceStrength, isLegalAction } from '../src/core';
import { availableCredits, trashInstalledCard } from '../src/core/engine/cardEffects';
import {
  answer,
  cont,
  giveCard,
  installCorpForTest,
  keepGoing,
  installIceForTest,
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

const C = {
  rene: '30001', carnivore: '30003', botulus: '30004', fermenter: '30007', leech: '30008', cookbook: '30009',
  zahya: '30010', treadLightly: '30012', docklands: '30013', pennyshaver: '30014', tranquilizer: '30017',
  redTeam: '30018', tao: '30019', dzmz: '30022', pantograph: '30023', conduit: '30024', telework: '30027',
  jailbreak: '30028', overclock: '30029', t400: '30031', smartware: '30033', verbal: '30034',
  precisionDesign: '30035', luminal: '30036', nico: '30037', manegarm: '30042', restoringHumanity: '30043',
  longevity: '30044', anoetic: '30050', realityPlus: '30051', headline: '30052', spinDoctor: '30053',
  amaze: '30058', builtToLast: '30059', aboveTheLaw: '30060', malapert: '30066', offworld: '30067',
  sendAMessage: '30069', hub: '30070', regolith: '30071',
  mayfly: '30032', palisade: '30072', tithe: '30073', pharos: '30063', cleaver: '30006', sureGamble: '30030', hedgeFund: '30075',
};

const card = (s: GameState, id: string) => findCardAnywhere(s, id)!;
const tokens = (s: GameState, id: string, t: string) => card(s, id).tokens[t] ?? 0;
const choose = (s: GameState, optionId: string) => keepGoing(answer(s, { kind: 'effect_choice', optionId }));
const pick = (s: GameState, ids: string[]) => answer(s, { kind: 'effect_cards', cardInstanceIds: ids });
const declineAccess = (s: GameState) => answer(s, { kind: 'access_trash', trash: false });
/** Number of cards accessed so far in the game (from the log). */
const accesses = (s: GameState) => s.log.filter(l => /^Runner accessed (?!and stole)/.test(l.message)).length;

/** Clears both hands of agendas etc. so breaches are predictable. */
function emptyHQ(s: GameState): void {
  s.corp.rd.push(...s.corp.hq.splice(0));
}

describe('Loaded credits and click abilities', () => {
  it('Telework Contract loads 9, pays 3 once per turn, and is trashed when empty', () => {
    let [s, id] = runnerInstall(newGame(), C.telework);
    expect(tokens(s, id, 'credit')).toBe(9);
    const credits = s.runner.credits;
    s = useAbility(s, 'runner', id);
    expect(s.runner.credits).toBe(credits + 3);
    expect(isLegalAction(s, { type: 'USE_ABILITY', player: 'runner', cardInstanceId: id, abilityIndex: 0 })).toBe(false);
    for (let i = 0; i < 2; i++) {
      s.turnFlags = {}; // a new turn
      s.runner.clicks = 1;
      s = useAbility(s, 'runner', id);
    }
    expect(s.runner.rig.resources.map(c => c.instanceId)).not.toContain(id);
    expect(s.runner.heap.map(c => c.instanceId)).toContain(id);
  });

  it('Regolith Mining License loads 15 when rezzed and pays 3 per click', () => {
    let s = newGame();
    const id = installCorpForTest(s, C.regolith, 'remote-1');
    s = rezForTest(s, id);
    expect(tokens(s, id, 'credit')).toBe(15);
    const credits = s.corp.credits;
    s = useAbility(s, 'corp', id);
    expect(s.corp.credits).toBe(credits + 3);
    expect(tokens(s, id, 'credit')).toBe(12);
  });

  it('Nico Campaign pays 3 each Corp turn, then is trashed and draws a card', () => {
    let s = newGame();
    const id = installCorpForTest(s, C.nico, 'remote-1');
    s = rezForTest(s, id);
    for (let turn = 0; turn < 3; turn++) {
      s = passTurn(passTurn(s)); // Corp then Runner: a new Corp turn begins
    }
    expect(s.corp.archives.faceUp.map(c => c.instanceId)).toContain(id);
    expect(s.log.some(l => /drew 1 card\(s\) \(Nico Campaign\)/.test(l.message))).toBe(true);
  });

  it('Smartware Distributor stores 3 credits and releases 1 at the start of each Runner turn', () => {
    let [s, id] = runnerInstall(newGame(), C.smartware);
    s.runner.clicks = 1;
    s = useAbility(s, 'runner', id);
    expect(tokens(s, id, 'credit')).toBe(3);
    const credits = s.runner.credits;
    s = passTurn(passTurn(s)); // Runner, then Corp; the Runner's turn begins
    expect(s.runner.credits).toBe(credits + 1);
    expect(tokens(s, id, 'credit')).toBe(2);
  });

  it('Pennyshaver collects a credit per successful run and pays them all out', () => {
    let [s, id] = runnerInstall(newGame(), C.pennyshaver);
    emptyHQ(s);
    s = cont(run(s, 'archives'));
    expect(tokens(s, id, 'credit')).toBe(1);
    const credits = s.runner.credits;
    s.runner.clicks = 1;
    s = useAbility(s, 'runner', id);
    expect(s.runner.credits).toBe(credits + 2);
    expect(tokens(s, id, 'credit')).toBe(0);
  });

  it('click abilities need the action phase, and the ability list comes from getLegalActions', () => {
    let [s, id] = runnerInstall(newGame(), C.telework);
    expect(getLegalActions(s, 'runner')).toContainEqual({ type: 'USE_ABILITY', player: 'runner', cardInstanceId: id, abilityIndex: 0 });
    // A changed copy: legality answers are cached per state object, so a state isn't edited after it is asked about
    s = structuredClone(s);
    s.runner.clicks = 0;
    expect(isLegalAction(s, { type: 'USE_ABILITY', player: 'runner', cardInstanceId: id, abilityIndex: 0 })).toBe(false);
  });
});

describe('Lasting modifiers and install limits', () => {
  it('T400 Memory Diamond gives +1 MU and +1 hand size', () => {
    const [s] = runnerInstall(newGame(), C.t400);
    expect(s.runner.memoryUnitsTotal).toBe(5);
    expect(s.runner.handSizeLimit).toBe(6);
  });

  it('DZMZ Optimizer discounts only the first program each turn', () => {
    let [s] = runnerInstall(newGame(), C.dzmz);
    s.runner.credits = 10;
    const a = giveCard(s, 'runner', C.leech);
    const b = giveCard(s, 'runner', C.leech);
    s.runner.clicks = 2;
    s = executeAction(s, { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: a });
    expect(s.runner.credits).toBe(10); // Leech costs 1, minus 1
    s = executeAction(s, { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: b });
    expect(s.runner.credits).toBe(9);
  });

  it('a second console trashes the first', () => {
    let [s, penny] = runnerInstall(newGame(), C.pennyshaver);
    [s] = runnerInstall(s, C.carnivore);
    expect(s.runner.heap.map(c => c.instanceId)).toContain(penny);
    expect(s.runner.rig.hardware.map(c => cardDef(c).title)).toEqual(['Carnivore']);
    expect(s.runner.memoryUnitsTotal).toBe(5);
  });

  it('Precision Design and Superconducting Hub raise the Corp hand size', () => {
    let s = newGame();
    setIdentity(s, 'corp', C.precisionDesign);
    s = scoreForTest(s, C.hub);
    // Hub asks whether to draw; Precision Design then offers a card from Archives (none here).
    s = choose(s, 'no');
    expect(s.corp.handSizeLimit).toBe(8);
  });

  it('Verbal Plasticity makes the first basic draw each turn draw 2', () => {
    let [s] = runnerInstall(newGame(), C.verbal);
    s.runner.clicks = 2;
    const grip = s.runner.grip.length;
    s = executeAction(s, { type: 'DRAW_CARD', player: 'runner' });
    expect(s.runner.grip.length).toBe(grip + 2);
    s = executeAction(s, { type: 'DRAW_CARD', player: 'runner' });
    expect(s.runner.grip.length).toBe(grip + 3);
  });
});

describe('Virus programs and hosting', () => {
  it('Botulus installs only on ice, grows a counter, and breaks a host subroutine', () => {
    let s = newGame();
    const ice = installIceForTest(s, C.palisade, 'hq');
    startRunnerTurn(s);
    const loose = giveCard(s, 'runner', C.botulus);
    expect(isLegalAction(s, { type: 'INSTALL_CARD', player: 'runner', cardInstanceId: loose })).toBe(false);
    let id: string;
    [s, id] = runnerInstall(s, C.botulus, ice);
    expect(card(s, id).hostedOnId).toBe(ice);
    expect(card(s, ice).hostedCardIds).toContain(id);
    expect(tokens(s, id, 'virus')).toBe(1);
    s = cont(run(s, 'hq')); // encounter Palisade
    s = useAbility(s, 'runner', id);
    expect(s.activeRun!.encounter!.broken).toEqual([true]);
    expect(tokens(s, id, 'virus')).toBe(0);
  });

  it('a hosted program is trashed with its host', () => {
    let s = newGame();
    const ice = installIceForTest(s, C.palisade, 'remote-1');
    let id: string;
    [s, id] = runnerInstall(s, C.botulus, ice);
    expect(s.runner.memoryUnitsUsed).toBe(1);
    trashInstalledCard(s, card(s, ice));
    expect(s.runner.heap.map(c => c.instanceId)).toContain(id);
    expect(s.runner.memoryUnitsUsed).toBe(0);
  });

  it('Tranquilizer derezzes its host at 3 virus counters', () => {
    let s = newGame();
    const ice = installIceForTest(s, C.palisade, 'hq');
    let id: string;
    [s, id] = runnerInstall(s, C.tranquilizer, ice);
    expect(tokens(s, id, 'virus')).toBe(1);
    s = passTurn(passTurn(s));
    s = passTurn(passTurn(s));
    expect(tokens(s, id, 'virus')).toBe(3);
    expect(card(s, ice).isRezzed).toBe(false);
  });

  it('Cookbook adds a counter to installed viruses; Fermenter cashes them in', () => {
    let [s] = runnerInstall(newGame(), C.cookbook);
    let id: string;
    [s, id] = runnerInstall(s, C.fermenter);
    expect(tokens(s, id, 'virus')).toBe(2);
    const credits = s.runner.credits;
    s.runner.clicks = 1;
    s = useAbility(s, 'runner', id);
    expect(s.runner.credits).toBe(credits + 4);
    expect(s.runner.heap.map(c => c.instanceId)).toContain(id);
  });

  it('Leech gains counters on central runs and lowers encountered ice strength', () => {
    let [s, id] = runnerInstall(newGame(), C.leech);
    emptyHQ(s);
    s = cont(run(s, 'archives'));
    expect(tokens(s, id, 'virus')).toBe(1);
    const ice = installIceForTest(s, C.palisade, 'hq');
    s = cont(run(s, 'hq'));
    expect(iceStrength(s, card(s, ice))).toBe(2);
    s = useAbility(s, 'runner', id);
    expect(iceStrength(s, card(s, ice))).toBe(1);
  });

  it('Conduit runs R&D and accesses extra cards per counter', () => {
    let [s, id] = runnerInstall(newGame(), C.conduit);
    card(s, id).tokens.virus = 2;
    s.runner.clicks = 1;
    s = useAbility(s, 'runner', id);
    s = cont(s); // approach server -> breach R&D
    while (s.pendingPrompts.length > 0) {
      s = s.pendingPrompts[0].kind === 'access_trash' ? declineAccess(s) : answer(s, { kind: 'effect_cards', cardInstanceIds: [] });
    }
    expect(accesses(s)).toBe(3);
    expect(tokens(s, id, 'virus')).toBe(3); // successful R&D run ended
  });
});

describe('Runs from cards and extra accesses', () => {
  it('Red Team runs an unrun central and pays 3 on success', () => {
    let [s, id] = runnerInstall(newGame(), C.redTeam);
    expect(tokens(s, id, 'credit')).toBe(12);
    s.runner.clicks = 1;
    s = useAbility(s, 'runner', id);
    const credits = s.runner.credits;
    s = choose(s, 'archives');
    s = cont(s);
    expect(s.runner.credits).toBe(credits + 3);
    expect(tokens(s, id, 'credit')).toBe(9);
    s.runner.clicks = 1;
    s = useAbility(s, 'runner', id);
    expect(s.pendingPrompts[0].kind === 'effect_choice' && s.pendingPrompts[0].options.map(o => o.id)).toEqual(['hq', 'rd']);
  });

  it('Jailbreak draws a card and accesses an extra card from HQ', () => {
    let s = newGame();
    startRunnerTurn(s);
    const jb = giveCard(s, 'runner', C.jailbreak);
    s = choose(play(s, 'runner', jb), 'hq');
    const grip = s.runner.grip.length;
    s = cont(s);
    while (s.pendingPrompts.length > 0) s = declineAccess(s);
    expect(s.runner.grip.length).toBe(grip + 1);
    expect(accesses(s)).toBe(2);
  });

  it('Docklands Pass adds an HQ access only on the first HQ breach each turn', () => {
    let [s] = runnerInstall(newGame(), C.docklands);
    const count = () => accesses(s);
    s = cont(run(s, 'hq'));
    while (s.pendingPrompts.length > 0) s = declineAccess(s);
    expect(count()).toBe(2);
    s = cont(run(s, 'hq'));
    while (s.pendingPrompts.length > 0) s = declineAccess(s);
    expect(count()).toBe(3);
  });

  it('Tread Lightly raises ice rez costs by 3 during the run', () => {
    let s = newGame();
    const ice = installIceForTest(s, C.palisade, 'hq', false);
    startRunnerTurn(s);
    const tl = giveCard(s, 'runner', C.treadLightly);
    s = choose(play(s, 'runner', tl), 'hq');
    s.corp.credits = 5; // Palisade costs 3, +3 = 6
    expect(isLegalAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: ice })).toBe(false);
    s.corp.credits = 6;
    s = executeAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: ice });
    expect(s.corp.credits).toBe(0);
  });

  it('Overclock credits are spent first during the run and vanish after it', () => {
    let s = newGame();
    installIceForTest(s, C.tithe, 'hq');
    let mayfly: string;
    [s, mayfly] = runnerInstall(s, C.mayfly);
    const oc = giveCard(s, 'runner', C.overclock);
    s.runner.credits = 1;
    s.runner.clicks = 1;
    s = choose(play(s, 'runner', oc), 'hq');
    s.runner.credits = 0;
    expect(availableCredits(s, 'runner')).toBe(5);
    s = cont(s); // encounter Tithe (strength 1)
    s = executeAction(s, { type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: mayfly, subroutineIndices: [0] });
    s = executeAction(s, { type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: mayfly, subroutineIndices: [1] });
    expect(s.activeRun!.bonusCredits).toBe(3);
    expect(s.runner.credits).toBe(0);
    s = cont(cont(s));
    while (s.pendingPrompts.length > 0) s = declineAccess(s);
    expect(s.activeRun).toBeNull();
    expect(availableCredits(s, 'runner')).toBe(0);
  });
});

describe('Access abilities and access triggers', () => {
  it('Carnivore trashes an accessed agenda instead of stealing it', () => {
    let [s] = runnerInstall(newGame(), C.carnivore);
    const agenda = installCorpForTest(s, C.offworld, 'remote-9');
    giveCard(s, 'runner', C.sureGamble);
    giveCard(s, 'runner', C.sureGamble);
    s = cont(run(s, 'remote-9'));
    const p = s.pendingPrompts[0];
    expect(p.kind === 'access_trash' && p.trashCost).toBe(null);
    expect(p.kind === 'access_trash' && p.alternatives?.length).toBe(1);
    const carn = s.runner.rig.hardware[0].instanceId;
    s = answer(s, { kind: 'access_trash', trash: false, alternativeId: carn });
    s = pick(s, s.runner.grip.slice(0, 2).map(c => c.instanceId));
    expect(s.corp.archives.faceUp.map(c => c.instanceId)).toContain(agenda);
    expect(s.runner.score).toBe(0);
    expect(s.activeRun).toBeNull();
  });

  it('René Arcemont gains 1 and draws 1 on the first trash while accessing each turn', () => {
    let s = newGame();
    setIdentity(s, 'runner', C.rene);
    installCorpForTest(s, C.regolith, 'remote-9');
    s = cont(run(s, 'remote-9'));
    s.runner.credits = 10;
    const grip = s.runner.grip.length;
    s = answer(s, { kind: 'access_trash', trash: true });
    expect(s.runner.credits).toBe(10 - 3 + 1);
    expect(s.runner.grip.length).toBe(grip + 1);
  });

  it('Zahya gains a credit per card accessed on an HQ run', () => {
    let s = newGame();
    setIdentity(s, 'runner', C.zahya);
    const before = s.runner.credits;
    s = cont(run(s, 'hq'));
    while (s.pendingPrompts.length > 0) s = declineAccess(s);
    expect(s.runner.credits).toBe(before + 1);
  });
});

describe('Score and steal triggers', () => {
  it('Offworld Office gains 7; Luminal gains 3 clicks and blocks more scoring', () => {
    let s = newGame();
    const credits = s.corp.credits;
    s = scoreForTest(s, C.offworld);
    expect(s.corp.credits).toBe(credits + 7);
    const clicks = s.corp.clicks;
    s = scoreForTest(s, C.luminal, 'remote-l');
    expect(s.corp.clicks).toBe(clicks + 3);
    expect(() => scoreForTest(s, C.offworld, 'remote-x')).toThrow(/cannot score/);
  });

  it("Tomorrow's Headline tags the Runner when stolen; NBN gains on the first tag each turn", () => {
    let s = newGame();
    setIdentity(s, 'corp', C.realityPlus);
    installCorpForTest(s, C.headline, 'remote-9');
    s = cont(run(s, 'remote-9'));
    expect(s.runner.tags).toBe(1);
    const credits = s.corp.credits;
    s = choose(s, 'credits');
    expect(s.corp.credits).toBe(credits + 2);
  });

  it('Above the Law trashes a resource; Send a Message rezzes ice for free', () => {
    let [s, res] = runnerInstall(newGame(), C.smartware);
    s = scoreForTest(s, C.aboveTheLaw);
    s = pick(s, [res]);
    expect(s.runner.heap.map(c => c.instanceId)).toContain(res);
    const ice = installIceForTest(s, C.pharos, 'hq', false);
    const credits = s.corp.credits;
    s = scoreForTest(s, C.sendAMessage, 'remote-s');
    s = pick(s, [ice]);
    expect(card(s, ice).isRezzed).toBe(true);
    expect(s.corp.credits).toBe(credits);
  });

  it('Longevity Serum trashes from HQ then shuffles Archives into R&D', () => {
    let s = newGame();
    const hq = s.corp.hq.map(c => c.instanceId);
    s = scoreForTest(s, C.longevity);
    s = pick(s, hq.slice(0, 2));
    expect(s.corp.archives.faceDown.length).toBe(2);
    s = pick(s, s.corp.archives.faceDown.map(c => c.instanceId));
    expect(s.corp.archives.faceDown.length).toBe(0);
  });

  it('Tāo Salonga may swap two pieces of ice when an agenda is scored', () => {
    let s = newGame();
    setIdentity(s, 'runner', C.tao);
    const a = installIceForTest(s, C.palisade, 'hq');
    const b = installIceForTest(s, C.tithe, 'rd');
    s = scoreForTest(s, C.offworld);
    s = pick(s, [a, b]);
    expect(s.corp.servers.hq.ice[0].instanceId).toBe(b);
    expect(s.corp.servers.rd.ice[0].instanceId).toBe(a);
  });

  it('Pantograph gains 1 and may install a card when an agenda is stolen', () => {
    let [s] = runnerInstall(newGame(), C.pantograph);
    installCorpForTest(s, C.offworld, 'remote-9');
    const t400 = giveCard(s, 'runner', C.t400);
    s.runner.credits = 3;
    s = cont(run(s, 'remote-9'));
    s = pick(s, [t400]);
    expect(s.runner.rig.hardware.map(c => c.instanceId)).toContain(t400);
    expect(s.runner.credits).toBe(3 + 1 - 2);
  });

  it('Malapert Data Vault searches R&D when an agenda is scored from its server', () => {
    let s = newGame();
    installCorpForTest(s, C.malapert, 'remote-m', true);
    const target = s.corp.rd.find(c => cardDef(c).type_code !== 'agenda')!.instanceId;
    s = scoreForTest(s, C.offworld, 'remote-m');
    s = pick(s, [target]);
    expect(s.corp.hq.map(c => c.instanceId)).toContain(target);
  });
});

describe('Corp identities and assets', () => {
  it('Built to Last gains 2 when advancing a card with no counters', () => {
    let s = newGame();
    setIdentity(s, 'corp', C.builtToLast);
    const id = installCorpForTest(s, C.offworld, 'remote-1');
    const credits = s.corp.credits;
    s = executeAction(s, { type: 'ADVANCE_CARD', player: 'corp', cardInstanceId: id, serverId: 'remote-1' });
    expect(s.corp.credits).toBe(credits - 1 + 2);
    s = executeAction(s, { type: 'ADVANCE_CARD', player: 'corp', cardInstanceId: id, serverId: 'remote-1' });
    expect(s.corp.credits).toBe(credits - 2 + 2);
  });

  it('Restoring Humanity gains 1 at the end of the discard phase with a facedown card in Archives', () => {
    let s = newGame();
    setIdentity(s, 'corp', C.restoringHumanity);
    s.corp.archives.faceDown.push(s.corp.hq.pop()!);
    const credits = s.corp.credits;
    s = passTurn(s);
    expect(s.corp.credits).toBe(credits + 1);
  });

  it('Spin Doctor draws 2 when rezzed and can be removed from the game to recycle Archives', () => {
    let s = newGame();
    const id = installCorpForTest(s, C.spinDoctor, 'remote-1');
    const hq = s.corp.hq.length;
    s = rezForTest(s, id);
    expect(s.corp.hq.length).toBe(hq + 2);
    s.corp.archives.faceDown.push(s.corp.hq.pop()!);
    s = useAbility(s, 'corp', id);
    s = pick(s, s.corp.archives.faceDown.map(c => c.instanceId));
    expect(s.removedFromGame.map(c => c.instanceId)).toContain(id);
    expect(s.corp.archives.faceDown.length).toBe(0);
  });
});

describe('Upgrades', () => {
  it('Manegarm Skunkworks ends the run unless the Runner pays', () => {
    let s = newGame();
    installCorpForTest(s, C.manegarm, 'remote-1', true);
    s = run(s, 'remote-1');
    expect(s.pendingPrompts).toHaveLength(0); // the Corp's rez window comes before the approach
    s = cont(s);
    const p = s.pendingPrompts[0];
    expect(p.kind === 'effect_choice' && p.options.map(o => o.id)).toEqual(['clicks', 'pay', 'end']);
    s = choose(s, 'end');
    expect(s.activeRun).toBeNull();
    s.runner.clicks = 1;
    s.runner.credits = 5;
    s = cont(run(s, 'remote-1'));
    s = choose(s, 'pay');
    expect(s.runner.credits).toBe(0);
    expect(s.runsThisTurn[s.runsThisTurn.length - 1].successful).toBe(true); // the run went on to the server
  });

  it('Manegarm Skunkworks rezzed during the run, before the approach, still triggers (rules 6.9.4e)', () => {
    let s = newGame();
    const id = installCorpForTest(s, C.manegarm, 'remote-1');
    s = run(s, 'remote-1');
    expect(s.activeRun?.phase).toBe('approach_server');
    s = rezForTest(s, id);
    s = cont(s);
    expect(s.pendingPrompts[0]?.kind).toBe('effect_choice');
  });

  it('Anoetic Void lets the Corp pay 2 and trash 2 from HQ to end the run', () => {
    let s = newGame();
    installCorpForTest(s, C.anoetic, 'remote-1', true);
    s = cont(run(s, 'remote-1'));
    s = choose(s, 'yes');
    s = pick(s, s.corp.hq.slice(0, 2).map(c => c.instanceId));
    expect(s.activeRun).toBeNull();
  });

  it('AMAZE Amusements gives 2 tags after an agenda is stolen, even if it was trashed', () => {
    let s = newGame();
    installCorpForTest(s, C.amaze, 'remote-1', true);
    installCorpForTest(s, C.offworld, 'remote-1');
    s = cont(run(s, 'remote-1'));
    s.runner.credits = 10;
    // AMAZE is accessed first: trash it; the agenda is stolen afterwards.
    s = answer(s, { kind: 'access_trash', trash: true });
    expect(s.activeRun).toBeNull();
    expect(s.runner.score).toBe(2);
    expect(s.runner.tags).toBe(2);
  });
});
