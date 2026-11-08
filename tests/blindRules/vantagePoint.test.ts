// Blind rules tests: written from the card text and the Comprehensive Rules v26.03 only. See README.md.
import { describe, expect, it } from 'vitest';
import { createCardInstance, executeAction, GameState, isLegalAction, rezCostOf } from '../../src/core';
import { giveCard, installCorpForTest, installIceForTest, newGame, run, scoreForTest, startRunnerTurn } from '../helpers';
import { accessedSince, drive, Handler, pick } from './util';

const MCLL = '36026';
const MAGISTRATE = '36048';
const FLAGSHIP = '36064';
const VERTIGO = '36031';
const LET_THEM_DREAM = '36066';
const WORD_ON_THE_STREET = '36025';
const MYOSHU = '36061';
const OFFWORLD = '30067';
const JAILBREAK = '30028';
const REVERB = '36029';
const VICSEK = '36042';
const PALISADE = '30072';

const payToSteal: Handler = p => (p.side === 'runner' && p.kind === 'effect_choice' && /steal/i.test(p.message) ? pick(p, /^steal$|pay/i) : undefined);

describe('Méliès City Luxury Line ("As an additional cost to steal this agenda, the Runner must spend [click]")', () => {
  // Rules 1.17.3d + 1.16.10a: the Runner cannot steal it without paying, and may decline to pay.
  function runOn(clicksBefore: number, handle?: Handler) {
    const s0 = newGame();
    installCorpForTest(s0, MCLL, 'remote-1');
    startRunnerTurn(s0);
    s0.runner.clicks = clicksBefore;
    return drive(run(s0, 'remote-1'), handle);
  }

  it('cannot be stolen with no click left after the run', () => {
    const s = runOn(1);
    expect(s.runner.scoreArea).toHaveLength(0);
    expect(s.corp.servers['remote-1'].root.map(c => c.cardCode)).toContain(MCLL);
  });

  it('is stolen by spending the click', () => {
    const s = runOn(2, payToSteal);
    expect(s.runner.scoreArea.map(c => c.cardCode)).toContain(MCLL);
    expect(s.runner.clicks).toBe(0);
  });

  it('the Runner may decline to pay and leave it', () => {
    const s = runOn(2, p => (p.side === 'runner' && p.kind === 'effect_choice' ? pick(p, /no|not|decline/i) : undefined));
    expect(s.runner.scoreArea).toHaveLength(0);
    expect(s.runner.clicks).toBe(1);
  });
});

describe('Magistrate Revontulet with Méliès City Luxury Line (two additional costs to steal)', () => {
  // Rules 1.16.10b: all additional costs are paid together; if one cannot be paid, none can.
  function runOn(credits: number) {
    const s0 = newGame();
    installCorpForTest(s0, MAGISTRATE, 'remote-2', true);
    installCorpForTest(s0, MCLL, 'remote-1');
    startRunnerTurn(s0);
    s0.runner.clicks = 2;
    s0.runner.credits = credits;
    return drive(run(s0, 'remote-1'), payToSteal);
  }

  it('cannot steal with the click but only 2 credits', () => {
    const s = runOn(2);
    expect(s.runner.scoreArea).toHaveLength(0);
    expect(s.runner.clicks).toBe(1);
    expect(s.runner.credits).toBe(2);
  });

  it('steals by paying the click and 3 credits', () => {
    const s = runOn(3);
    expect(s.runner.scoreArea.map(c => c.cardCode)).toContain(MCLL);
    expect(s.runner.clicks).toBe(0);
    expect(s.runner.credits).toBe(0);
  });
});

describe('Flagship ("Runs against this server cannot be declared successful")', () => {
  // Rules 6.9.5a-b + 6.8.4a: the run still reaches the Success Phase and the Runner still breaches,
  // but "if successful" effects (Jailbreak) do not happen. Persistent access limit 9.12.5.
  it('Jailbreak on HQ: not successful, no draw, at most 1 card besides Flagship accessed', () => {
    const s0 = newGame();
    const flag = createCardInstance(s0, FLAGSHIP);
    flag.isRezzed = true;
    s0.corp.servers.hq.root.push(flag);
    expect(s0.corp.hq.length).toBeGreaterThanOrEqual(3);
    startRunnerTurn(s0);
    s0.runner.grip = [];
    const jb = giveCard(s0, 'runner', JAILBREAK);
    const from = s0.log.length;
    let s = executeAction(s0, { type: 'PLAY_OPERATION_OR_EVENT', player: 'runner', cardInstanceId: jb });
    s = drive(s, p => (p.side === 'runner' && p.kind === 'effect_choice' && /hq|r&d|server/i.test(p.message + JSON.stringify(p.options)) ? pick(p, /hq/i) : undefined));
    expect(s.runsThisTurn[0].server).toBe('hq');
    expect(s.runsThisTurn[0].successful).toBe(false);
    expect(s.runner.grip).toHaveLength(0); // Jailbreak's "draw 1 card" needs a successful run
    const others = accessedSince(s, from).filter(t => t !== 'Flagship');
    expect(others).toHaveLength(1);
  });
});

describe('Vertigo ("When the Runner passes this ice, if they have no [click] remaining")', () => {
  // Rules 9.3.2b-c: trigger on passing, condition checked then; 6.9.4a passing ice.
  function runOn(clicksBefore: number) {
    const s0 = newGame();
    installIceForTest(s0, VERTIGO, 'remote-1');
    installCorpForTest(s0, OFFWORLD, 'remote-1');
    startRunnerTurn(s0);
    s0.runner.clicks = clicksBefore;
    return drive(run(s0, 'remote-1'));
  }

  it('with no click left after its subroutine, the Runner cannot steal', () => {
    const s = runOn(2); // run: 1 left; "loses [click]": 0 left as it is passed
    expect(s.runner.scoreArea).toHaveLength(0);
  });

  it('with a click left, the Runner steals', () => {
    const s = runOn(3);
    expect(s.runner.scoreArea.map(c => c.cardCode)).toContain(OFFWORLD);
  });
});

describe('Let Them Dream ("While this agenda is in the Runner\'s score area, it is worth 1 less agenda point")', () => {
  // Rules 4.5.4: agendas in the Runner's score area are inactive, but 9.1.8b: this ability names that zone.
  it('is worth 1 point to the Runner', () => {
    const s0 = newGame();
    installCorpForTest(s0, LET_THEM_DREAM, 'remote-1');
    startRunnerTurn(s0);
    const s = drive(run(s0, 'remote-1'));
    expect(s.runner.scoreArea.map(c => c.cardCode)).toContain(LET_THEM_DREAM);
    expect(s.runner.score).toBe(1);
  });

  it('is worth 2 points to the Corp', () => {
    const s = drive(scoreForTest(newGame(), LET_THEM_DREAM));
    expect(s.corp.score).toBe(2);
  });
});

describe('Word on the Street', () => {
  // Rules 1.16.10: an additional cost to score; 1.17.3f: a card added "as an agenda" is not scored.
  function withWord(): GameState {
    const s = newGame();
    const w = createCardInstance(s, WORD_ON_THE_STREET);
    w.isRezzed = true;
    s.runner.rig.resources.push(w);
    s.corp.credits = 10;
    return s;
  }

  it('an agenda installed this turn: Word goes to the Corp score area as -1 point', () => {
    let s = withWord();
    s.corp.clicks = 3;
    const id = giveCard(s, 'corp', OFFWORLD);
    s = executeAction(s, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: id, asNewRemote: true });
    const server = Object.values(s.corp.servers).find(v => v.root.some(c => c.instanceId === id))!;
    server.root.find(c => c.instanceId === id)!.advancementCounters = 4;
    s = executeAction(s, { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: id });
    s = drive(s, p => (p.side === 'corp' && p.kind === 'effect_choice' ? pick(p, /add|pay|score|yes/i) : undefined));
    expect(s.corp.scoreArea.map(c => c.cardCode).sort()).toEqual([OFFWORLD, WORD_ON_THE_STREET].sort());
    expect(s.corp.score).toBe(1);
    expect(s.runner.rig.resources).toHaveLength(0);
  });

  it('an agenda installed on an earlier turn: Word is trashed, the Runner gains 4 and draws 1', () => {
    const s0 = withWord();
    const credits = s0.runner.credits;
    const grip = s0.runner.grip.length;
    const s = drive(scoreForTest(s0, OFFWORLD));
    expect(s.corp.score).toBe(2);
    expect(s.runner.rig.resources).toHaveLength(0);
    expect(s.runner.heap.map(c => c.cardCode)).toContain(WORD_ON_THE_STREET);
    expect(s.runner.credits).toBe(credits + 4);
    expect(s.runner.grip).toHaveLength(grip + 1);
  });
});

describe('Myōshu ("Play only if you scored an agenda this turn that you did not install this turn")', () => {
  // Rules 9.3.3b play restriction; 1.17.3f: added "as an agenda", not scored.
  const playMyoshu = (id: string) => ({ type: 'PLAY_OPERATION_OR_EVENT', player: 'corp', cardInstanceId: id }) as const;

  it('cannot be played before an agenda is scored', () => {
    const s = newGame();
    s.corp.credits = 20;
    const m = giveCard(s, 'corp', MYOSHU);
    expect(isLegalAction(s, playMyoshu(m))).toBe(false);
  });

  it('after scoring an agenda installed earlier: becomes a 2-point agenda', () => {
    let s = drive(scoreForTest(newGame(), OFFWORLD));
    s.corp.credits = 20;
    s.corp.clicks = Math.max(s.corp.clicks, 1);
    const m = giveCard(s, 'corp', MYOSHU);
    expect(isLegalAction(s, playMyoshu(m))).toBe(true);
    s = drive(executeAction(s, playMyoshu(m)));
    expect(s.corp.scoreArea.map(c => c.cardCode)).toContain(MYOSHU);
    expect(s.corp.score).toBe(4);
  });

  it('cannot be played when the only agenda scored was installed this turn', () => {
    let s = newGame();
    s.corp.credits = 20;
    s.corp.clicks = 3;
    const id = giveCard(s, 'corp', OFFWORLD);
    s = executeAction(s, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: id, asNewRemote: true });
    const server = Object.values(s.corp.servers).find(v => v.root.some(c => c.instanceId === id))!;
    server.root.find(c => c.instanceId === id)!.advancementCounters = 4;
    s = drive(executeAction(s, { type: 'SCORE_AGENDA', player: 'corp', cardInstanceId: id }));
    expect(s.corp.score).toBe(2);
    const m = giveCard(s, 'corp', MYOSHU);
    expect(isLegalAction(s, playMyoshu(m))).toBe(false);
  });
});

describe('Reverb ("rez cost ... lowered by 1 credit for each other unrezzed piece of ice")', () => {
  // Rules 1.16.8 rez cost; 9.4.5 static cost modifiers; only other unrezzed ice counts.
  it('costs 4 minus the other unrezzed ice, rezzed ice not counted', () => {
    const s = newGame();
    const id = installIceForTest(s, REVERB, 'remote-1', false);
    const reverb = s.corp.servers['remote-1'].ice.find(c => c.instanceId === id)!;
    expect(rezCostOf(s, reverb)).toBe(4);
    installIceForTest(s, PALISADE, 'hq', false);
    installIceForTest(s, PALISADE, 'rd', false);
    installIceForTest(s, PALISADE, 'archives', true);
    expect(rezCostOf(s, reverb)).toBe(2);
  });
});

describe('Vicsek ("Do X net damage and give the Runner X tags. X is equal to the number of tags the Runner has.")', () => {
  // Rules 9.9.7 / 9.3.3f: X is fixed as the subroutine resolves (2), not recounted after the tags are given.
  it('with 2 tags: 2 net damage and 2 more tags, then 1 tag and Vicsek is trashed', () => {
    const s0 = newGame();
    const v = installIceForTest(s0, VICSEK, 'hq');
    startRunnerTurn(s0);
    s0.runner.tags = 2;
    s0.runner.grip = [];
    for (let i = 0; i < 6; i++) giveCard(s0, 'runner', JAILBREAK);
    const s = drive(run(s0, 'hq'));
    expect(s.runner.grip).toHaveLength(4);
    expect(s.runner.tags).toBe(5);
    expect(s.corp.servers.hq.ice.map(c => c.instanceId)).not.toContain(v);
  });
});
