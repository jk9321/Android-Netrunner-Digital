// Blind rules tests: written from the card text and the Comprehensive Rules v26.03 only. See README.md.
import { describe, expect, it } from 'vitest';
import { executeAction, GameAction, iceStrength, isLegalAction } from '../../src/core';
import { giveCard, installCorpForTest, installIceForTest, installProgramForTest, newGame, run, scoreForTest, setIdentity, startRunnerTurn, toCorp } from '../helpers';
import { chooseCard, drive, pick } from './util';

const FUJII = '34040';
const HAMMER = '34126';
const WAGE_WORKERS = '34033';
const DANIELA = '34047';
const SALVO = '34031';
const SACRIFICE_ZONE = '36056';
const BUILT_TO_LAST = '30059';
const OFFWORLD = '30067';
const MAYFLY = '30032';
const CARMEN = '30015';
const SURE_GAMBLE = '30030';
const CAPACITOR = '34116';
const PHONEUTRIA = '34043';
const BIAWAK = '35074';
const GREENMAIL = '35070';

describe('Fujii Asset Retrieval ("When this agenda is scored or stolen, do 2 net damage")', () => {
  // Rules 1.17.7 stolen trigger; 10.4.3 damage trashes cards at random from the grip.
  it('does 2 net damage when stolen', () => {
    const s0 = newGame();
    installCorpForTest(s0, FUJII, 'remote-1');
    startRunnerTurn(s0);
    s0.runner.grip = [];
    for (let i = 0; i < 4; i++) giveCard(s0, 'runner', SURE_GAMBLE);
    const s = drive(run(s0, 'remote-1'));
    expect(s.runner.scoreArea.map(c => c.cardCode)).toContain(FUJII);
    expect(s.runner.grip).toHaveLength(2);
  });

  it('does 2 net damage when scored', () => {
    const s0 = newGame();
    s0.runner.grip = [];
    for (let i = 0; i < 4; i++) giveCard(s0, 'runner', SURE_GAMBLE);
    const s = drive(scoreForTest(s0, FUJII));
    expect(s.runner.grip).toHaveLength(2);
  });
});

describe('Hammer ("cannot break more than 1 of its printed subroutines except using killers")', () => {
  // Rules 9.3.3c restriction on breaking, for the whole encounter.
  function encounter(breakerCode: string, boosts: number) {
    const s0 = newGame();
    installIceForTest(s0, HAMMER, 'hq');
    startRunnerTurn(s0);
    const b = installProgramForTest(s0, breakerCode);
    s0.runner.credits = 30;
    let s = drive(run(s0, 'hq'), undefined, x => x.activeRun?.phase === 'encounter_ice');
    for (let i = 0; i < boosts; i++) s = executeAction(s, { type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: b });
    return { s, b };
  }
  const brk = (b: string, i: number): GameAction => ({ type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: b, subroutineIndices: [i] });

  it('an AI breaker breaks one subroutine, then no more', () => {
    let { s, b } = encounter(MAYFLY, 3); // strength 1 + 3 = 4
    expect(isLegalAction(s, brk(b, 0))).toBe(true);
    s = executeAction(s, brk(b, 0));
    expect(isLegalAction(s, brk(b, 1))).toBe(false);
  });

  it('a killer breaks all three', () => {
    let { s, b } = encounter(CARMEN, 1); // strength 2 + 3 = 5
    for (const i of [0, 1, 2]) {
      expect(isLegalAction(s, brk(b, i))).toBe(true);
      s = executeAction(s, brk(b, i));
    }
  });
});

describe('Wage Workers ("if you have taken that action exactly 3 times this turn, gain [click]")', () => {
  // Rules 5.2 actions; 9.3.2b trigger "whenever you finish taking an action".
  it('the third credit action gives a click back, the fourth does not', () => {
    let s = newGame();
    installCorpForTest(s, WAGE_WORKERS, 'remote-1', true);
    s.corp.clicks = 4;
    const credits = s.corp.credits;
    const gain = { type: 'GAIN_CREDIT', player: 'corp' } as const;
    s = executeAction(s, gain);
    s = executeAction(s, gain);
    expect(s.corp.clicks).toBe(2);
    s = executeAction(s, gain);
    expect(s.corp.clicks).toBe(2); // 1 left + 1 gained
    s = executeAction(s, gain);
    expect(s.corp.clicks).toBe(1);
    expect(s.corp.credits).toBe(credits + 4);
  });
});

describe('Daniela Jorge Inácio (Persistent additional cost to steal)', () => {
  // Rules 1.16.10a-b additional costs; 1.17.3d the Runner can steal only by paying.
  function runOn(gripSize: number) {
    const s0 = newGame();
    installCorpForTest(s0, DANIELA, 'remote-1', true);
    const agenda = installCorpForTest(s0, OFFWORLD, 'remote-1');
    startRunnerTurn(s0);
    s0.runner.grip = [];
    for (let i = 0; i < gripSize; i++) giveCard(s0, 'runner', SURE_GAMBLE);
    const s = drive(run(s0, 'remote-1'), p => {
      if (p.kind === 'access_order') return { kind: 'access_order', optionId: (p.options.find(o => o.id === `root:${agenda}`) ?? p.options[0]).id };
      if (p.side === 'runner' && p.kind === 'effect_choice' && /steal/i.test(p.message)) return pick(p, /^steal$|pay|add/i);
      return undefined;
    });
    return s;
  }

  it('the Runner steals by adding 2 random grip cards to the bottom of the stack', () => {
    const s = runOn(3);
    expect(s.runner.scoreArea.map(c => c.cardCode)).toContain(OFFWORLD);
    expect(s.runner.grip).toHaveLength(1);
    expect(s.runner.stack.slice(-2).map(c => c.cardCode)).toEqual([SURE_GAMBLE, SURE_GAMBLE]);
  });

  it('with only 1 card in the grip the Runner cannot steal', () => {
    const s = runOn(1);
    expect(s.runner.scoreArea).toHaveLength(0);
    expect(s.runner.grip).toHaveLength(1);
  });
});

describe('Salvo Testing ("Whenever you score an agenda (including this one), you may do 1 core damage")', () => {
  // Rules 1.17.6: scored triggers become pending once the agenda is in the score area, so it sees itself.
  const yes = (p: import('../../src/core').Prompt) => (p.side === 'corp' && p.kind === 'effect_choice' ? pick(p, /yes|do|damage/i) : undefined);

  it('fires on its own scoring and on a later one', () => {
    let s = drive(scoreForTest(newGame(), SALVO, 'remote-a'), yes);
    expect(s.runner.coreDamage).toBe(1);
    s = drive(scoreForTest(s, OFFWORLD, 'remote-b'), yes);
    expect(s.runner.coreDamage).toBe(2);
  });

  it('is optional', () => {
    const s = drive(scoreForTest(newGame(), SALVO));
    expect(s.runner.coreDamage).toBe(0);
  });
});

describe('Sacrifice Zone Expansion ("The first time each turn you advance this agenda, gain 3 credits")', () => {
  // Rules 9.3.2b "the first time each turn"; 1.18 advancing (1 click + 1 credit).
  function setup(identity?: string) {
    const s = newGame();
    if (identity) setIdentity(s, 'corp', identity);
    const id = installCorpForTest(s, SACRIFICE_ZONE, 'remote-1');
    s.corp.servers['remote-1'].root[0].faceUp = true;
    s.corp.clicks = 3;
    s.corp.credits = 5;
    return { s, id };
  }
  const adv = (id: string) => ({ type: 'ADVANCE_CARD', player: 'corp', cardInstanceId: id, serverId: 'remote-1' }) as const;

  it('gains 3 on the first advance only', () => {
    let { s, id } = setup();
    s = drive(executeAction(s, adv(id)));
    expect(s.corp.credits).toBe(5 - 1 + 3);
    s = drive(executeAction(s, adv(id)));
    expect(s.corp.credits).toBe(5 - 1 + 3 - 1);
  });

  // Weyland Consortium: Built to Last: "gain 2 credits if it had no advancement counters". Both trigger on the first advance.
  it('with Built to Last, the first advance gains 2 + 3', () => {
    let { s, id } = setup(BUILT_TO_LAST);
    s = drive(executeAction(s, adv(id)));
    expect(s.corp.credits).toBe(5 - 1 + 2 + 3);
    s = drive(executeAction(s, adv(id)));
    expect(s.corp.credits).toBe(5 - 1 + 2 + 3 - 1);
  });
});

describe('Capacitor ("While the Runner is tagged, this ice gets +2 strength")', () => {
  // Rules 9.4.2 static condition; 10.5.2 tagged.
  it('is strength 3, or 5 while the Runner is tagged', () => {
    const s = newGame();
    const id = installIceForTest(s, CAPACITOR, 'remote-1');
    const ice = s.corp.servers['remote-1'].ice.find(c => c.instanceId === id)!;
    expect(iceStrength(s, ice)).toBe(3);
    s.runner.tags = 1;
    expect(iceStrength(s, ice)).toBe(5);
  });
});

describe('Phoneutria ("When the Runner passes this ice, if there are 4 or more cards in the grip")', () => {
  // Rules 9.3.2c: the grip is counted as the ice is passed, after the subroutines' net damage (10.4).
  function runWithGrip(n: number) {
    const s0 = newGame();
    installIceForTest(s0, PHONEUTRIA, 'hq');
    startRunnerTurn(s0);
    s0.runner.grip = [];
    for (let i = 0; i < n; i++) giveCard(s0, 'runner', SURE_GAMBLE);
    return drive(run(s0, 'hq'));
  }

  it('6 cards, 2 net damage, 4 left as it is passed: 1 tag', () => {
    const s = runWithGrip(6);
    expect(s.runner.grip.length).toBeLessThanOrEqual(4); // accessing HQ adds nothing to the grip
    expect(s.runner.tags).toBe(1);
  });

  it('5 cards, 2 net damage, 3 left as it is passed: no tag', () => {
    const s = runWithGrip(5);
    expect(s.runner.tags).toBe(0);
  });
});

describe('Biawak ("You can forfeit 1 agenda as you rez this ice to pay for 10 credits of its rez cost") with Greenmail', () => {
  // Rules 1.16 costs; Greenmail: "When you forfeit this agenda, gain 4 credits".
  it('the Corp rezzes Biawak with 4 credits by forfeiting Greenmail, then gains 4', () => {
    const s0 = newGame();
    const gm = giveCard(s0, 'corp', GREENMAIL);
    const card = s0.corp.hq.splice(s0.corp.hq.findIndex(c => c.instanceId === gm), 1)[0];
    s0.corp.scoreArea.push(card);
    s0.corp.score = 1;
    const b = installIceForTest(s0, BIAWAK, 'hq', false);
    s0.corp.credits = 4;
    startRunnerTurn(s0);
    let s = executeAction(s0, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    s = toCorp(s);
    s = executeAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: b });
    s = drive(s, p => (p.side === 'corp' && (p.kind === 'effect_cards' || p.kind === 'effect_choice') ? chooseCard(p, gm) : undefined), x => x.corp.servers.hq.ice[0].isRezzed && x.pendingPrompts.length === 0);
    expect(s.corp.servers.hq.ice[0].isRezzed).toBe(true);
    expect(s.corp.scoreArea).toHaveLength(0);
    expect(s.corp.score).toBe(0);
    expect(s.corp.credits).toBe(4);
  });
});

describe('Hammer: a killer still breaks after another breaker broke one', () => {
  // The restriction counts subroutines broken by non-killers only (9.3.3c).
  it('Mayfly breaks 1, then Carmen breaks the other 2', () => {
    const s0 = newGame();
    installIceForTest(s0, HAMMER, 'hq');
    startRunnerTurn(s0);
    const fly = installProgramForTest(s0, MAYFLY);
    const carmen = installProgramForTest(s0, CARMEN);
    s0.runner.credits = 30;
    let s = drive(run(s0, 'hq'), undefined, x => x.activeRun?.phase === 'encounter_ice');
    for (let i = 0; i < 3; i++) s = executeAction(s, { type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: fly });
    s = executeAction(s, { type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: carmen });
    s = executeAction(s, { type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: fly, subroutineIndices: [0] });
    for (const i of [1, 2]) {
      expect(isLegalAction(s, { type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: carmen, subroutineIndices: [i] })).toBe(true);
      s = executeAction(s, { type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: carmen, subroutineIndices: [i] });
    }
    expect(s.activeRun!.encounter!.broken.every(Boolean)).toBe(true);
  });
});
