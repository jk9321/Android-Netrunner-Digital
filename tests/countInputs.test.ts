/**
 * Count inputs (spec /mnt/project-files/netrunner-ai/redesign/spec-count-inputs.md): two inputs to counted scoring's
 * two-turn count (countedScore.ts scoreInTwo), fixed as inputs, not value terms.
 *
 * F1 afterLine: a two-turn line counts only if, once it has scored, the Corp keeps the rez money R&D, HQ (while an
 * agenda stays there) and other agenda remotes need for the Runner's turn after it (holdCost on each).
 * F2 runnerMoney: the Runner's budget for a run counts its installed money cards (card entries), never its grip.
 *
 * Rules (Comprehensive Rules v26.03):
 *  - 3.4.3a ice is rezzed when the Corp chooses, 6.9.2b as it is approached; 6.9.2c unrezzed ice is passed: what holds
 *    a server is the rez money the Corp keeps.
 *  - 1.17.3a an agenda is scored once its advancement counters reach its requirement; 5.2.6f "[click], 1[credit]:
 *    Advance 1 installed card".
 *  - 5.2.7a the Runner's basic action "[click]: Gain 1[credit]".
 *  - Card text (NetrunnerDB): Telework Contract "Once per turn -> [click]: Take 3[credit] from this resource" (9 loaded);
 *    Pennyshaver "[click]: Place 1[credit] on this hardware, then take all credits from it"; Fermenter "When ... your turn
 *    begins, place 1 virus counter ... [click], trash: Gain 2[credit] for each hosted virus counter"; Rent Rioters
 *    "[click][click][click], trash: Gain 9[credit]"; Smartware Distributor and Open Market "When your turn begins, take
 *    1[credit] from this resource"; Offworld Office "When you score this agenda, gain 7[credit]".
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CardInstance, GameState, cardDef, createCardInstance } from '../src/core';
import { tuning } from '../src/ai/synergy';
import { afterLineFloor, runnerBudget, runnerMoney, scoreInTwo } from '../src/ai/countedScore';
import { giveCard, installCorpForTest, installIceForTest, installProgramForTest, newGame } from './helpers';
import { inDecision } from './helpers/pricing';

const SEND_A_MESSAGE = '30069'; // agenda 5/3
const OFFWORLD_OFFICE = '30067'; // agenda 4/2, gain 7 credits when scored
const PALISADE = '30072'; // barrier, rez 3, strength 2 (+2 protecting a remote); End the run
const CLEAVER = '30006'; // fracter, strength 3: 1 credit breaks up to 2 barrier subroutines, 2 credits +1 strength
const TELEWORK = '30027';
const PENNYSHAVER = '30014';
const FERMENTER = '30007';
const SMARTWARE = '30033';
const RENT_RIOTERS = '35011';
const OPEN_MARKET = '35022';
const SURE_GAMBLE = '30030';

const was = tuning.plan.scoreInTwo;
afterEach(() => {
  tuning.plan.scoreInTwo = was;
});

/** Corp turn 1 of a starter game with an empty HQ and the given credits (a copy). */
function corpMain(credits: number, clicks = 3): GameState {
  const s = structuredClone(newGame(1));
  s.corp.rd.push(...s.corp.hq.splice(0));
  s.corp.credits = credits;
  s.corp.clicks = clicks;
  return s;
}

/** Puts a Runner card into the rig with the given hosted counters (test setup only). */
function rig(s: GameState, code: string, tokens: CardInstance['tokens'] = {}): CardInstance {
  const card = createCardInstance(s, code);
  card.isRezzed = true;
  card.tokens = { ...tokens };
  const type = cardDef(card).type_code;
  (type === 'program' ? s.runner.rig.programs : type === 'hardware' ? s.runner.rig.hardware : s.runner.rig.resources).push(card);
  return card;
}

describe("F2 runnerMoney: the Runner's installed money cards, from the card entries (5.2.7a)", () => {
  it('each card pays through its entry; clicks left over are a credit each, one kept for the run', () => {
    const at = (build: (s: GameState) => void) => {
      const s = corpMain(5);
      s.runner.maxClicks = 4;
      build(s);
      return runnerMoney(s);
    };
    expect(at(() => {})).toBe(3); // 3 clicks for 3 credits
    expect(at(s => void rig(s, TELEWORK, { credit: 9 }))).toBe(5); // once: 3, then 2 clicks
    expect(at(s => void rig(s, TELEWORK, { credit: 2 }))).toBe(4); // no more than it holds
    expect(at(s => void rig(s, PENNYSHAVER, { credit: 2 }))).toBe(5); // 1 + 2 hosted, then 2 clicks
    expect(at(s => void rig(s, FERMENTER, { virus: 2 }))).toBe(8); // 3 counters at its turn's start: 6, then 2 clicks
    expect(at(s => void rig(s, RENT_RIOTERS))).toBe(9); // all three clicks for 9
    expect(at(s => void rig(s, SMARTWARE, { credit: 3 }))).toBe(4); // 1 at its turn's start
    expect(at(s => void rig(s, SMARTWARE))).toBe(3); // empty: pays nothing
    expect(at(s => void rig(s, OPEN_MARKET, { credit: 6 }))).toBe(4);
    // Two that need the same clicks: the better set (Rent Rioters' 9 beats Telework 3 + 2)
    expect(at(s => (rig(s, TELEWORK, { credit: 9 }), rig(s, RENT_RIOTERS)))).toBe(9);
    // The grip is never read: a Sure Gamble in hand adds nothing
    expect(at(s => void giveCard(s, 'runner', SURE_GAMBLE))).toBe(3);
  });

  it("runnerBudget: the Runner's credits plus what its cards and clicks make", () => {
    const s = corpMain(5);
    s.runner.maxClicks = 4;
    s.runner.credits = 2;
    expect(runnerBudget(s)).toBe(5);
    rig(s, TELEWORK, { credit: 9 });
    expect(runnerBudget(s)).toBe(7);
  });

  it('pin: a new remote that holds against 1 credit a click does not hold against a loaded Telework Contract; the line is not started', () => {
    // Palisade protecting a remote is strength 4: Cleaver needs 2 credits (+1) and 1 to break, 3 in all. The Runner on
    // 0 credits with 3 clicks (2 spare): 2 credits by clicking, 4 with Telework's 3 for one of them
    const build = (telework: boolean) => {
      const s = corpMain(8);
      giveCard(s, 'corp', OFFWORLD_OFFICE);
      giveCard(s, 'corp', PALISADE);
      installProgramForTest(s, CLEAVER);
      s.runner.credits = 0;
      s.runner.maxClicks = 3;
      if (telework) rig(s, TELEWORK, { credit: 9 });
      return s;
    };
    tuning.plan.scoreInTwo = true;
    const off = build(false);
    expect(inDecision(off, 'corp', () => scoreInTwo(off))).toMatchObject({ agenda: 'Offworld Office', server: 'new remote', form: 'install+ice' });
    const on = build(true);
    expect(inDecision(on, 'corp', () => scoreInTwo(on))).toBeNull();
  });
});

describe('F1 afterLine: the money left once a two-turn line scores holds R&D, HQ and other agenda remotes (3.4.3a, 6.9.2b-c)', () => {
  /** Send a Message +2 in remote-1 behind a rezzed Palisade (the Runner has no breaker: it holds for nothing); 0 credits, 3 clicks. */
  const build = () => {
    const s = corpMain(0);
    const id = installCorpForTest(s, SEND_A_MESSAGE, 'remote-1');
    s.corp.servers['remote-1'].root[0].advancementCounters = 2;
    installIceForTest(s, PALISADE, 'remote-1', true);
    s.runner.credits = 3;
    s.runner.maxClicks = 4;
    return { s, id };
  };

  it("an unrezzed Palisade on R&D needs its 3 rez credits after the score: a line that ends on 0 is refused", () => {
    tuning.plan.scoreInTwo = true;
    // R&D bare: three clicks for credits now, three advances next turn, scored on 0 credits
    const bare = build().s;
    expect(inDecision(bare, 'corp', () => scoreInTwo(bare))).toMatchObject({ agenda: 'Send a Message', form: 'installed', advanceNow: 0, advanceNext: 3 });
    const { s: on, id } = build();
    installIceForTest(on, PALISADE, 'rd', false);
    expect(afterLineFloor(on, id)).toBe(3);
    expect(inDecision(on, 'corp', () => scoreInTwo(on))).toBeNull();
    // Rezzed, it holds for nothing: the line counts again
    on.corp.servers.rd.ice[0].isRezzed = true;
    expect(afterLineFloor(on, id)).toBe(0);
    expect(inDecision(on, 'corp', () => scoreInTwo(on))).toMatchObject({ agenda: 'Send a Message' });
  });

  it('a server no rez set holds (R&D bare) costs nothing: it does not veto the line', () => {
    tuning.plan.scoreInTwo = true;
    const { s, id } = build();
    expect(afterLineFloor(s, id)).toBe(0);
    expect(inDecision(s, 'corp', () => scoreInTwo(s))).toMatchObject({ agenda: 'Send a Message' });
  });

  it('HQ counts only while an agenda stays there; another agenda remote counts too', () => {
    tuning.plan.scoreInTwo = true;
    const { s, id } = build();
    installIceForTest(s, PALISADE, 'hq', false);
    expect(afterLineFloor(s, id)).toBe(0);
    giveCard(s, 'corp', OFFWORLD_OFFICE);
    expect(afterLineFloor(s, id)).toBe(3);
    s.corp.hq.splice(0);
    installCorpForTest(s, OFFWORLD_OFFICE, 'remote-2');
    installIceForTest(s, PALISADE, 'remote-2', false);
    expect(afterLineFloor(s, id)).toBe(3);
  });

  it("the agenda's own score money counts: Offworld Office's 7 credits pay the floor", () => {
    tuning.plan.scoreInTwo = true;
    const s = corpMain(0);
    const id = installCorpForTest(s, OFFWORLD_OFFICE, 'remote-1');
    s.corp.servers['remote-1'].root[0].advancementCounters = 1;
    installIceForTest(s, PALISADE, 'remote-1', true);
    installIceForTest(s, PALISADE, 'rd', false);
    s.runner.credits = 3;
    expect(afterLineFloor(s, id)).toBe(3);
    expect(inDecision(s, 'corp', () => scoreInTwo(s))).toMatchObject({ agenda: 'Offworld Office' });
  });
});
