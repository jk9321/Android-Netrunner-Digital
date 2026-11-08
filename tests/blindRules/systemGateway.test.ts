// Blind rules tests: written from the card text (src/data/*-cards.json) and the
// Comprehensive Rules v26.03 only, without reading the card scripts. See README.md.
import { describe, expect, it } from 'vitest';
import { cardDef, executeAction, iceStrength, isLegalAction } from '../../src/core';
import {
  giveCard,
  installCorpForTest,
  installIceForTest,
  installProgramForTest,
  newGame,
  passTurn,
  play,
  run,
  runnerInstall,
  scoreForTest,
  startRunnerTurn,
  toCorp,
  corpPasses,
} from '../helpers';
import { accessedSince, chooseCard, drive, pick } from './util';

const VERBAL_PLASTICITY = '30034';
const DOCKLANDS_PASS = '30013';
const MAYFLY = '30032';
const LUMINAL = '30036';
const SEAMLESS_LAUNCH = '30040';
const PING = '30055';
const PALISADE = '30072';
const DIVINER = '30046';
const URTICA = '30045';
const AMAZE = '30058';
const HEADLINE = '30052';
const FUNHOUSE = '30054';
const HANSEI = '30048';
const OFFWORLD = '30067';
const SURE_GAMBLE = '30030';
const JAILBREAK = '30028';
const HEDGE_FUND = '30075';
const SEND_A_MESSAGE = '30069';
const MANEGARM = '30042';
const PHAROS = '30063';
const KARUNA = '30047';
const TRANQUILIZER = '30017';

const draw = { type: 'DRAW_CARD', player: 'runner' } as const;

describe('Verbal Plasticity (replacement "instead", "the first time each turn")', () => {
  // Rules 9.9.8: "instead" is a replacement effect that applies automatically.
  // Rules 9.3.2b: "the first time each turn" is a trigger condition met once per turn.
  it('the first basic draw draws 2, the second draws 1', () => {
    let [s] = runnerInstall(newGame(), VERBAL_PLASTICITY);
    s.runner.clicks = 3;
    const g = s.runner.grip.length;
    s = executeAction(s, draw);
    expect(s.runner.grip.length).toBe(g + 2);
    s = executeAction(s, draw);
    expect(s.runner.grip.length).toBe(g + 3);
  });
});

describe('Docklands Pass ("the first time each turn you breach HQ")', () => {
  // Rules 9.3.2b + 7.4.1: one additional access on the first HQ breach only.
  it('accesses 2 cards on the first HQ breach and 1 on the second', () => {
    let [s] = runnerInstall(newGame(), DOCKLANDS_PASS);
    s.runner.clicks = 2;
    expect(s.corp.hq.length).toBeGreaterThanOrEqual(3);
    let from = s.log.length;
    s = drive(run(s, 'hq'));
    expect(accessedSince(s, from)).toHaveLength(2);
    from = s.log.length;
    s = drive(run(s, 'hq'));
    expect(accessedSince(s, from)).toHaveLength(1);
  });
});

describe('Mayfly ("When this run ends, trash this program" is part of the break ability)', () => {
  // Rules 9.6.13: the break ability creates a delayed conditional ability; without using it nothing is created.
  it('stays installed after a run in which it was not used', () => {
    const s0 = newGame();
    startRunnerTurn(s0);
    installProgramForTest(s0, MAYFLY);
    const s = drive(run(s0, 'hq'));
    expect(s.runner.rig.programs.map(c => c.cardCode)).toContain(MAYFLY);
  });

  it('is trashed when the run ends after it broke a subroutine', () => {
    const s0 = newGame();
    startRunnerTurn(s0);
    const fly = installProgramForTest(s0, MAYFLY);
    installIceForTest(s0, PALISADE, 'hq'); // strength 2 on a central (no remote bonus)
    s0.runner.credits = 10;
    let s = run(s0, 'hq');
    s = drive(s, undefined, x => x.activeRun?.phase === 'encounter_ice');
    s = executeAction(s, { type: 'BOOST_BREAKER', player: 'runner', breakerInstanceId: fly });
    s = executeAction(s, { type: 'BREAK_SUBROUTINE', player: 'runner', breakerInstanceId: fly, subroutineIndices: [0] });
    expect(s.runner.rig.programs.map(c => c.instanceId)).toContain(fly); // not until the run ends
    s = drive(s);
    expect(s.runner.rig.programs.map(c => c.instanceId)).not.toContain(fly);
    expect(s.runner.heap.map(c => c.cardCode)).toContain(MAYFLY);
  });
});

describe('Luminal Transubstantiation ("cannot score agendas for the remainder of the turn")', () => {
  // Rules 9.10 lingering effect; 1.17.3: scoring is allowed only when nothing forbids it.
  it('gains 3 clicks and stops any further scoring this turn', () => {
    let s = newGame();
    const clicks = s.corp.clicks;
    s = scoreForTest(s, LUMINAL, 'remote-a');
    expect(s.corp.clicks).toBe(clicks + 3);
    const id = installCorpForTest(s, OFFWORLD, 'remote-b');
    s.corp.servers['remote-b'].root[0].advancementCounters = 4;
    expect(isLegalAction(s, { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: id })).toBe(false);
  });
});

describe('Seamless Launch ("1 installed card that you did not install this turn")', () => {
  // Rules 9.3.3 restriction on targets; 1.15 targets must be legal when chosen.
  it('cannot target a card installed this turn, can target an older one', () => {
    let s = newGame();
    s.corp.credits = 10;
    s.corp.clicks = 3;
    const old = installCorpForTest(s, OFFWORLD, 'remote-old');
    const fresh = giveCard(s, 'corp', URTICA);
    s = executeAction(s, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: fresh, asNewRemote: true });
    const launch = giveCard(s, 'corp', SEAMLESS_LAUNCH);
    s = executeAction(s, { type: 'PLAY_OPERATION_OR_EVENT', player: 'corp', cardInstanceId: launch });
    const p = s.pendingPrompts[0];
    if (p?.kind === 'effect_cards') {
      expect(p.candidateIds).toContain(old);
      expect(p.candidateIds).not.toContain(fresh);
    } else if (p?.kind === 'effect_choice') {
      const ids = p.options.map(o => o.id).join(' ');
      expect(ids).toContain(old);
      expect(ids).not.toContain(fresh);
    } else {
      // Only one legal target: placed automatically on the old card.
      expect(s.corp.servers['remote-old'].root[0].advancementCounters).toBe(2);
    }
  });
});

describe('Ping ("When you rez this ice during a run against this server")', () => {
  // Rules 9.3.2b trigger condition with a static condition (9.3.2c): both must hold.
  it('tags the Runner when rezzed as it is approached during a run on its server', () => {
    const s0 = newGame();
    const ping = installIceForTest(s0, PING, 'hq', false);
    s0.corp.credits = 10;
    startRunnerTurn(s0);
    let s = executeAction(s0, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' });
    s = toCorp(s); // the Corp's rez window as the Runner approaches Ping (6.9.2b)
    s = executeAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: ping });
    s = corpPasses(s);
    expect(s.runner.tags).toBe(1);
  });

  // Ice is normally rezzed only as it is approached (8.1.2a); Send a Message rezzes it at another time (8.1.2b).
  it('does not tag the Runner when rezzed by Send a Message outside a run', () => {
    const s0 = newGame();
    const ping = installIceForTest(s0, PING, 'hq', false);
    let s = scoreForTest(s0, SEND_A_MESSAGE);
    s = drive(s, p => (p.side === 'corp' && (p.kind === 'effect_cards' || p.kind === 'effect_choice') ? chooseCard(p, ping) : undefined));
    expect(s.corp.servers.hq.ice[0].isRezzed).toBe(true);
    expect(s.runner.tags).toBe(0);
  });
});

describe('Palisade ("While this ice is protecting a remote server")', () => {
  // Rules 9.4.2 static ability with a static condition; 4.6.8 remote servers.
  it('is strength 4 on a remote and 2 on a central', () => {
    const s = newGame();
    const r = installIceForTest(s, PALISADE, 'remote-1');
    const h = installIceForTest(s, PALISADE, 'hq');
    expect(iceStrength(s, s.corp.servers['remote-1'].ice.find(c => c.instanceId === r)!)).toBe(4);
    expect(iceStrength(s, s.corp.servers.hq.ice.find(c => c.instanceId === h)!)).toBe(2);
  });
});

describe('Diviner ("printed play or install cost that is an odd number ... (0 is not odd.)")', () => {
  // Rules 10.4.3 damage trashes at random; 2.3 printed cost.
  function divinerRun(gripCode: string) {
    const s0 = newGame();
    installIceForTest(s0, DIVINER, 'hq');
    startRunnerTurn(s0);
    s0.runner.grip = [];
    giveCard(s0, 'runner', gripCode);
    return drive(run(s0, 'hq'), undefined, x => !x.activeRun || x.activeRun.phase === 'movement' || x.activeRun.phase === 'approach_server' || x.activeRun.phase === 'access');
  }

  it('ends the run when it trashes Sure Gamble (cost 5)', () => {
    const s = divinerRun(SURE_GAMBLE);
    expect(s.runner.heap.map(c => c.cardCode)).toContain(SURE_GAMBLE);
    expect(s.activeRun).toBeNull();
    expect(s.runsThisTurn[0].successful).toBe(false);
  });

  it('does not end the run when it trashes Jailbreak (cost 0)', () => {
    const s = divinerRun(JAILBREAK);
    expect(s.runner.heap.map(c => c.cardCode)).toContain(JAILBREAK);
    expect(s.activeRun).not.toBeNull();
  });
});

describe('Urtica Cipher ("When the Runner accesses this asset while it is installed")', () => {
  // Rules 9.3.2c static condition: accessing it in HQ does nothing; 1.18 advancement counters.
  it('does 2 net damage plus 1 per advancement counter when accessed installed', () => {
    const s0 = newGame();
    const u = installCorpForTest(s0, URTICA, 'remote-1');
    s0.corp.servers['remote-1'].root.find(c => c.instanceId === u)!.advancementCounters = 2;
    startRunnerTurn(s0);
    s0.runner.grip = [];
    for (let i = 0; i < 6; i++) giveCard(s0, 'runner', SURE_GAMBLE);
    const s = drive(run(s0, 'remote-1'));
    expect(s.runner.grip).toHaveLength(2);
    expect(s.winner).toBeNull();
  });

  // Fixed 2026-11-08 (main 61abd52): the damage only applies while Urtica is installed.
  it('does nothing when accessed in HQ', () => {
    const s0 = newGame();
    s0.corp.hq = [];
    giveCard(s0, 'corp', URTICA);
    startRunnerTurn(s0);
    const g = s0.runner.grip.length;
    const from = s0.log.length;
    const s = drive(run(s0, 'hq'));
    expect(accessedSince(s, from)).toEqual(['Urtica Cipher']);
    expect(s.runner.grip).toHaveLength(g);
  });
});

describe('AMAZE Amusements (Persistent)', () => {
  // Rules 9.12.5a-c: a trashed persistent card's ability still applies for the rest of that run.
  it('gives 2 tags when the Runner trashed it and then stole an agenda from its server', () => {
    const s0 = newGame();
    const amaze = installCorpForTest(s0, AMAZE, 'remote-1', true);
    installCorpForTest(s0, OFFWORLD, 'remote-1');
    startRunnerTurn(s0);
    s0.runner.credits = 10;
    const s = drive(run(s0, 'remote-1'), p => {
      if (p.kind === 'access_order') {
        const o = p.options.find(o => o.id === `root:${amaze}`);
        return { kind: 'access_order', optionId: (o ?? p.options[0]).id };
      }
      if (p.kind === 'access_trash' && p.cardInstanceId === amaze) return { kind: 'access_trash', trash: true };
      return undefined;
    });
    expect(s.runner.scoreArea.map(c => c.cardCode)).toContain(OFFWORLD);
    expect(s.corp.archives.faceUp.map(c => c.cardCode)).toContain(AMAZE);
    expect(s.runner.tags).toBe(2);
  });

  it('gives no tags when no agenda was stolen', () => {
    const s0 = newGame();
    installCorpForTest(s0, AMAZE, 'remote-1', true);
    startRunnerTurn(s0);
    const s = drive(run(s0, 'remote-1'));
    expect(s.runner.tags).toBe(0);
  });
});

describe("Tomorrow's Headline (\"When this agenda is scored or stolen\")", () => {
  // Rules 1.17.7: a "stolen" trigger becomes pending once the agenda is in the Runner's score area.
  it('tags the Runner when stolen', () => {
    const s0 = newGame();
    installCorpForTest(s0, HEADLINE, 'remote-1');
    startRunnerTurn(s0);
    const s = drive(run(s0, 'remote-1'));
    expect(s.runner.scoreArea.map(c => c.cardCode)).toContain(HEADLINE);
    expect(s.runner.tags).toBe(1);
  });

  it('tags the Runner when scored', () => {
    const s = scoreForTest(newGame(), HEADLINE);
    expect(s.corp.scoreArea.map(c => c.cardCode)).toContain(HEADLINE);
    expect(s.runner.tags).toBe(1);
  });
});

describe('Funhouse ("end the run unless the Runner takes 1 tag")', () => {
  // Rules 1.16.4 nested cost ("unless"): the Runner chooses whether to pay it.
  function funhouseEncounter() {
    const s0 = newGame();
    installIceForTest(s0, FUNHOUSE, 'hq');
    startRunnerTurn(s0);
    return run(s0, 'hq');
  }

  it('the run continues into the encounter when the Runner takes the tag', () => {
    const s = drive(funhouseEncounter(), p => (p.kind === 'effect_choice' && p.side === 'runner' && !/pay/i.test(p.message) ? pick(p, /tag/i) : undefined), x => x.runner.tags > 0);
    expect(s.runner.tags).toBe(1);
    expect(s.activeRun).not.toBeNull();
    expect(s.activeRun!.phase).toBe('encounter_ice');
  });

  it('the run ends when the Runner refuses the tag', () => {
    const s = drive(funhouseEncounter(), p => (p.kind === 'effect_choice' && p.side === 'runner' ? pick(p, /end|refuse|no|decline/i) : undefined), x => !x.activeRun);
    expect(s.runner.tags).toBe(0);
    expect(s.activeRun).toBeNull();
  });
});

describe('Hansei Review ("If there are any cards in HQ, trash 1 of them")', () => {
  // Rules 8.6.7: the operation leaves HQ as it is played, so with no other card in HQ nothing is trashed.
  it('still gains 10 credits when it was the only card in HQ', () => {
    let s = newGame();
    s.corp.hq = [];
    const h = giveCard(s, 'corp', HANSEI);
    s.corp.credits = 5;
    s = play(s, 'corp', h);
    expect(s.pendingPrompts).toHaveLength(0);
    expect(s.corp.credits).toBe(10);
  });

  it('trashes 1 card from HQ when there is one', () => {
    let s = newGame();
    s.corp.hq = [];
    const h = giveCard(s, 'corp', HANSEI);
    giveCard(s, 'corp', HEDGE_FUND);
    s.corp.credits = 5;
    s = play(s, 'corp', h);
    s = drive(s);
    expect(s.corp.hq).toHaveLength(0);
    expect(s.corp.archives.faceUp.concat(s.corp.archives.faceDown).map(c => cardDef(c).title)).toContain('Hedge Fund');
    expect(s.corp.credits).toBe(10);
  });
});

describe('Manegarm Skunkworks ("end the run unless they either spend [click][click] or pay 5 credits")', () => {
  // Rules 1.16.4 nested cost: the Runner picks a payable option or the run ends; 6.9.4g approaching the server.
  function runOn(clicksBefore: number, credits: number, handle?: import('./util').Handler) {
    const s0 = newGame();
    installCorpForTest(s0, MANEGARM, 'remote-1', true);
    startRunnerTurn(s0);
    s0.runner.clicks = clicksBefore;
    s0.runner.credits = credits;
    return drive(run(s0, 'remote-1'), handle);
  }
  const runnerPicks = (re: RegExp) => (p: import('../../src/core').Prompt) => (p.side === 'runner' && p.kind === 'effect_choice' ? pick(p, re) : undefined);

  it('ends the run when the Runner can pay neither', () => {
    const s = runOn(2, 4, runnerPicks(/end|no|decline|neither/i));
    expect(s.runsThisTurn[0].successful).toBe(false);
    expect(s.runner.credits).toBe(4);
  });

  it('the Runner pays 5 credits and the run goes on', () => {
    const s = runOn(2, 5, runnerPicks(/5|credit/i));
    expect(s.runner.credits).toBe(0);
    expect(s.runsThisTurn[0].successful).toBe(true);
  });

  it('the Runner spends 2 clicks and the run goes on', () => {
    const s = runOn(3, 0, runnerPicks(/click/i));
    expect(s.runner.clicks).toBe(0);
    expect(s.runsThisTurn[0].successful).toBe(true);
  });
});

describe('Pharos ("+5 strength while there are 3 or more hosted advancement counters")', () => {
  // Rules 9.4.2 static condition.
  it('is strength 5 with 2 counters and 10 with 3', () => {
    const s = newGame();
    const id = installIceForTest(s, PHAROS, 'remote-1');
    const ice = s.corp.servers['remote-1'].ice.find(c => c.instanceId === id)!;
    ice.advancementCounters = 2;
    expect(iceStrength(s, ice)).toBe(5);
    ice.advancementCounters = 3;
    expect(iceStrength(s, ice)).toBe(10);
  });
});

describe('Karunā ("Do 2 net damage. The Runner may jack out.")', () => {
  // Rules 6.9.4c normally limits jacking out to the Movement Phase; the subroutine allows it mid-encounter.
  function encounterKaruna(jack: boolean) {
    const s0 = newGame();
    installIceForTest(s0, KARUNA, 'hq');
    startRunnerTurn(s0);
    s0.runner.grip = [];
    for (let i = 0; i < 6; i++) giveCard(s0, 'runner', SURE_GAMBLE);
    return drive(run(s0, 'hq'), p => (p.side === 'runner' && p.kind === 'effect_choice' && /jack/i.test(p.message + JSON.stringify(p.options)) ? pick(p, jack ? /jack/i : /no|continue|stay|don/i) : undefined));
  }

  it('jacking out after the first subroutine skips the second', () => {
    const s = encounterKaruna(true);
    expect(s.runner.grip).toHaveLength(4);
    expect(s.runsThisTurn[0].successful).toBe(false);
  });

  it('staying in takes both subroutines', () => {
    const s = encounterKaruna(false);
    expect(s.runner.grip).toHaveLength(2);
    expect(s.runsThisTurn[0].successful).toBe(true);
  });
});

describe('Tranquilizer ("Then, if there are 3 or more hosted virus counters, derez host ice")', () => {
  // Rules 9.6 conditional ability on install and at turn start; the count check follows the counter.
  it('derezzes the host ice at the start of the second Runner turn after install', () => {
    let s = newGame();
    const ice = installIceForTest(s, PALISADE, 'hq');
    let t: string;
    [s, t] = runnerInstall(s, TRANQUILIZER, ice);
    const host = () => s.corp.servers.hq.ice.find(c => c.instanceId === ice)!;
    const tranq = () => s.runner.rig.programs.find(c => c.instanceId === t)!;
    const virus = () => Object.values(tranq().tokens).reduce((a, b) => a + b, 0);
    expect(virus()).toBe(1);
    for (let turn = 2; turn <= 3; turn++) {
      s = passTurn(s); // Runner -> Corp
      s = drive(s);
      if (s.activePlayer === 'corp' && s.corp.clicks === 0) s = passTurn(s);
      s = passTurn(s); // Corp -> Runner
      s = drive(s);
      expect(s.activePlayer).toBe('runner');
      expect(virus()).toBe(turn);
      expect(host().isRezzed).toBe(turn < 3);
    }
  });
});

describe('Ping and Send a Message during a run ("during a run against this server")', () => {
  // Send a Message: "When this agenda is ... stolen, you may rez 1 installed piece of ice" (8.1.2b).
  // Ping's trigger needs the run to be against Ping's server (9.3.2c), wherever the Runner is in it.
  function stealSaMWithPingOn(pingServer: string) {
    const s0 = newGame();
    const ping = installIceForTest(s0, PING, pingServer, false);
    installCorpForTest(s0, SEND_A_MESSAGE, 'remote-1');
    s0.corp.credits = 10;
    startRunnerTurn(s0);
    // The Runner passes the unrezzed Ping (or there is none on remote-1) and steals Send a Message.
    const s = drive(run(s0, 'remote-1'), p => (p.side === 'corp' && (p.kind === 'effect_cards' || p.kind === 'effect_choice') ? chooseCard(p, ping) : undefined));
    return { s, ping };
  }

  // Fixed 2026-11-08 (main 61abd52): free rezzes by card abilities (Send a Message, Lightning
  // Laboratory, Tucana) meet "when you rez this ice during a run against this server" too.
  it('Ping on the attacked server, rezzed after it was passed: tag', () => {
    const { s, ping } = stealSaMWithPingOn('remote-1');
    expect(s.runner.scoreArea.map(c => c.cardCode)).toContain(SEND_A_MESSAGE);
    expect(s.corp.servers['remote-1'].ice.find(c => c.instanceId === ping)!.isRezzed).toBe(true);
    expect(s.runner.tags).toBe(1);
  });

  it('Ping on another server: no tag', () => {
    const { s, ping } = stealSaMWithPingOn('hq');
    expect(s.corp.servers.hq.ice.find(c => c.instanceId === ping)!.isRezzed).toBe(true);
    expect(s.runner.tags).toBe(0);
  });
});

describe('Urtica Cipher accessed in R&D', () => {
  // Same static condition "while it is installed" (9.3.2c).
  it('does nothing', () => {
    const s0 = newGame();
    const u = giveCard(s0, 'corp', URTICA);
    s0.corp.rd.unshift(s0.corp.hq.splice(s0.corp.hq.findIndex(c => c.instanceId === u), 1)[0]);
    startRunnerTurn(s0);
    const g = s0.runner.grip.length;
    const s = drive(run(s0, 'rd'));
    expect(s.runner.grip).toHaveLength(g);
  });
});

describe('Docklands Pass with Jailbreak', () => {
  // Rules 7.4.1 + 9.12.1: additional accesses from different sources add up.
  it('accesses 3 cards from HQ', () => {
    let [s] = runnerInstall(newGame(), DOCKLANDS_PASS);
    s.runner.clicks = 2;
    const jb = giveCard(s, 'runner', JAILBREAK);
    const from = s.log.length;
    s = executeAction(s, { type: 'PLAY_OPERATION_OR_EVENT', player: 'runner', cardInstanceId: jb });
    s = drive(s, p => (p.side === 'runner' && p.kind === 'effect_choice' && /hq/i.test(JSON.stringify(p.options)) ? pick(p, /hq/i) : undefined));
    expect(accessedSince(s, from)).toHaveLength(3);
  });
});
