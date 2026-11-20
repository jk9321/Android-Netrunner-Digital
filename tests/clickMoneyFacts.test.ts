import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CardInstance, GameState, cardDef, createCardInstance, executeAction, getCardScript, getLegalActions } from '../src/core';
import { CARDS } from '../src/ai/cards';
import { restOfTurn, runnerEarnings, serverHold } from '../src/ai/corp/hold';
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { READ_OR_IRRELEVANT } from '../scripts/stage-d/runner-money-inventory';
import { newGame, passTurn } from './helpers';
import { inDecision } from './helpers/pricing';

/**
 * The hold count's click money (CardAI clickMoney, read by runnerEarnings in src/ai/corp/hold.ts) against the cards and
 * the engine (V-C checkpoint exploit hunt finding 1, found row 101 a; brief netrunner-ai/stage-vc/checkpoint/foaf-fix/
 * brief.md rev 1). Friend of a Friend (34074) had no entry, so its click for 9 was counted as a click for 1, and the
 * Stage D inventory said it was read. These tests close the class: every click-for-credits ability has an entry or a
 * named reason, every entry pays what the engine pays, and the inventory's "read already" claims are true.
 *
 * Rules: a paid ability whose cost begins with a click is an action (Comprehensive Rules v26.03, 5.2.1); its trigger cost
 * is the text before the colon (1.16.9); a restriction on the ability gates the cost (1.16.1c: Friend of a Friend's 9 only
 * while untagged); the other clicks make 1 credit each (5.2.7a, runnerEarnings).
 */

interface CardData { code: string; title: string; side_code: string; type_code: string; stripped_text?: string }
const cards: CardData[] = readdirSync(new URL('../src/data/', import.meta.url))
  .filter(f => f.endsWith('-cards.json'))
  .flatMap(f => JSON.parse(readFileSync(new URL(`../src/data/${f}`, import.meta.url), 'utf8')) as CardData[]);
const rigCards = cards.filter(c => c.side_code === 'runner' && ['program', 'hardware', 'resource'].includes(c.type_code));

/**
 * The card's abilities: a sentence with a colon (a trigger cost, 1.16.9) starts one, a "When"/"Whenever" sentence starts
 * a conditional one, and any other sentence belongs to the ability before it (Red Team: "[click]: Run a central server ...
 * If successful, take 3 credits from this resource.").
 */
function abilities(text: string): string[] {
  const out: string[] = [];
  for (const sentence of text.replace(/\s+/g, ' ').split(/(?<=\.)\s+/)) {
    if (!out.length || sentence.includes(':') || /^(When|Whenever)\b/.test(sentence)) out.push(sentence);
    else out[out.length - 1] += ' ' + sentence;
  }
  return out;
}
/** A click in the trigger cost, and credits gained, taken or placed in the effect ("gain 9", "take all", "for each"). */
const CLICK_COST = /(?:\[click\]|\bclick\b)[^:]*$/i;
const PAYS = /\b(?:gain|take|place)\s+(?:\d+|X|all)\b[^.]{0,20}?(?:\[credit\]|\bcredits?\b)/i;
const clickPays = (c: CardData) => abilities(c.stripped_text ?? '').some(a => {
  const at = a.indexOf(':');
  return at > 0 && CLICK_COST.test(a.slice(0, at)) && PAYS.test(a.slice(at + 1));
});

/** Click-for-credits abilities the count needs no entry for, each with its reason. */
const EXCEPTIONS: Record<string, string> = {
  '30018': 'Red Team: its 3 credits need a successful run on a central (money for a later run of the turn); known, row 61, pinned in tests/exploitPins.test.ts',
  '30033': 'Smartware Distributor: its click places 3 credits and pays nothing this turn (turnIncome reads the turn-start take)',
};
const withEntry = Object.keys(CARDS).filter(code => CARDS[code]?.clickMoney).sort();

describe('click money facts: every click-for-credits ability is counted', () => {
  const flagged = rigCards.filter(clickPays).map(c => c.code).sort();

  it('every Runner program, hardware and resource with a click-for-credits ability has a clickMoney entry or a named reason', () => {
    const missing = flagged.filter(code => !CARDS[code]?.clickMoney && !(code in EXCEPTIONS));
    expect(missing.map(code => `${code} ${cards.find(c => c.code === code)?.title}`), 'add the card\'s clickMoney (and its line in the engine check below) or a named reason').toEqual([]);
  });

  it('the pattern finds every card that has an entry today, and every named exception (or it is too narrow, or a reason is stale)', () => {
    expect(withEntry).toEqual(['30007', '30014', '30027', '34074', '35011']);
    expect(withEntry.filter(code => !flagged.includes(code))).toEqual([]);
    expect(Object.keys(EXCEPTIONS).filter(code => !flagged.includes(code) || CARDS[code]?.clickMoney)).toEqual([]);
    expect(flagged).toEqual([...withEntry, ...Object.keys(EXCEPTIONS)].sort());
  });

  it('leaves a click-less paid ability unflagged ("Interface -> 1 credit: Break ...")', () => {
    expect(clickPays({ code: 'x', title: 'x', side_code: 'runner', type_code: 'program', stripped_text: 'Interface -> 1 credit: Break up to 2 barrier subroutines. 2 credits: +1 strength.' })).toBe(false);
  });
});

/** An empty rig with `code` installed (hosted counters as stated), the Runner untagged on 0 credits, on the Corp's turn. */
function rigWith(code: string, tokens: Record<string, number>, tags = 0): { s: GameState; card: CardInstance } {
  const s = newGame(3);
  s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
  s.runner.credits = 0;
  s.runner.tags = tags;
  const card = Object.assign(createCardInstance(s, code), { isRezzed: true, tokens: { ...tokens } });
  const type = cardDef(card).type_code;
  (type === 'program' ? s.runner.rig.programs : type === 'hardware' ? s.runner.rig.hardware : s.runner.rig.resources).push(card);
  return { s, card };
}
/** The engine's best use of the card's click abilities as the Runner's turn begins: credits from before the turn, clicks spent. */
function enginePays(s: GameState, card: CardInstance): { credits: number; clicks: number } {
  const before = s.runner.credits;
  const turn = passTurn(structuredClone(s));
  expect([turn.activePlayer, turn.runner.clicks]).toEqual(['runner', turn.runner.maxClicks]);
  const uses = getLegalActions(turn, 'runner').filter(a => a.type === 'USE_ABILITY' && a.cardInstanceId === card.instanceId);
  expect(uses.length).toBeGreaterThan(0);
  return uses
    .map(a => executeAction(structuredClone(turn), a))
    .map(r => ({ credits: r.runner.credits - before, clicks: turn.runner.clicks - r.runner.clicks }))
    .reduce((a, b) => (b.credits > a.credits ? b : a));
}

describe('click money facts: every entry pays what the engine pays', () => {
  // Hosted credits and counters set to a stated number for each card (a new entry needs its line here)
  // (pairs, not an object: card-code keys would be iterated in numeric order)
  const CASES: [string, Record<string, number>[]][] = [
    ['34074', [{}]], // Friend of a Friend: 9 for 1 click (untagged)
    ['35011', [{}]], // Rent Rioters: 9 for 3 clicks
    ['30027', [{ credit: 9 }, { credit: 2 }]], // Telework Contract: 3, capped by what it holds
    ['30014', [{ credit: 2 }, { credit: 0 }]], // Pennyshaver: 1 plus what it holds
    ['30007', [{ virus: 2 }, { virus: 0 }]], // Fermenter: 2 a counter, plus the turn-start counter
  ];

  it('has a stated case for every clickMoney entry', () => {
    expect(CASES.map(([code]) => code).sort()).toEqual(withEntry);
  });

  for (const [code, setups] of CASES) for (const tokens of setups) {
    it(`${code} ${JSON.stringify(tokens)}: runnerEarnings for the entry's clicks = the engine's credits for the ability`, () => {
      const { s, card } = rigWith(code, tokens);
      const m = CARDS[code]!.clickMoney!;
      const engine = enginePays(s, card);
      expect(engine.clicks).toBe(m.clicks);
      expect(runnerEarnings(s)[m.clicks]).toBe(engine.credits);
    });
  }

  it('the stated numbers: Friend of a Friend 9, Rent Rioters 9, Telework 3 then 2, Pennyshaver 3 then 1, Fermenter 6 then 2', () => {
    const got = CASES.flatMap(([code, setups]) => setups.map(t => runnerEarnings(rigWith(code, t).s)[CARDS[code]!.clickMoney!.clicks]));
    expect(got).toEqual([9, 9, 3, 2, 3, 1, 6, 2]);
  });
});

describe('click money facts: the rest of a turn after a once-per-turn use', () => {
  // Audit 2026-11-20 AI-HOLD-ONCE-FLAG-NAMES (found row 99 a), read in the code there and reproduced here. Telework
  // Contract 30027: "Once per turn -> [click]: Take 3 credits from this resource." After its use this turn the engine
  // offers the ability no more (the use is recorded under `ability:<id>:<n>`), but runnerEarnings from the rest of the
  // turn reads no use flag: one more earning click reads 3 where the engine pays 1 (5.2.7a). It overstates the Runner's
  // money, which leans to "does not hold". Known-failing; the fix goes with the Runner rework's shared card facts.
  const used = () => {
    const { s, card } = rigWith('30027', { credit: 9 });
    const turn = passTurn(structuredClone(s));
    const mine = (st: GameState) => getLegalActions(st, 'runner').filter(a => a.type === 'USE_ABILITY' && a.cardInstanceId === card.instanceId);
    const after = executeAction(structuredClone(turn), mine(turn)[0]);
    return { turn, after, mine };
  };

  it('twin: before the use, one more earning click reads 3 and the engine pays 3', () => {
    const { turn, after } = used();
    expect(runnerEarnings(turn, restOfTurn(turn))[1]).toBe(3);
    expect(after.runner.credits - turn.runner.credits).toBe(3);
  });

  it('engine: after the use the ability is not offered again this turn', () => {
    const { after, mine } = used();
    expect(after.runner.clicks).toBeGreaterThan(0);
    expect(mine(after)).toEqual([]);
  });

  it.fails('after the use, one more earning click reads 1 (today: 3 again)', () => {
    const { after } = used();
    expect(runnerEarnings(after, restOfTurn(after))[1]).toBe(1);
  });
});

describe("click money facts: the inventory's field claims are true", () => {
  it('every READ_OR_IRRELEVANT line in scripts/stage-d/runner-money-inventory.ts that names a field has it on the card', () => {
    const fields = ['clickMoney', 'turnIncome', 'holdFacts', 'paysDuringRuns'] as const;
    const has = (code: string, field: (typeof fields)[number], sub?: string): boolean => {
      if (field === 'paysDuringRuns') return !!getCardScript(code)?.paysDuringRuns;
      const v = CARDS[code]?.[field] as Record<string, unknown> | undefined;
      return !!v && (!sub || v[sub] !== undefined);
    };
    const false_ = Object.entries(READ_OR_IRRELEVANT).flatMap(([code, claim]) =>
      fields.flatMap(f => [...claim.matchAll(new RegExp(`\\b${f}(?:\\.(\\w+))?`, 'g'))].filter(m => !has(code, f, m[1])).map(m => `${code} ${claim}: no ${m[0]}`)),
    );
    expect(false_).toEqual([]);
    expect(READ_OR_IRRELEVANT['34074']).toContain('clickMoney');
  });
});

describe('click money facts: Friend of a Friend in the count', () => {
  /**
   * The V-C checkpoint hunt's board (adversarial/2026-11-20-vc-checkpoint/states/f1-friend-of-a-friend-corp-t10.json),
   * with the Runner's grip emptied of money events (Creative Commission x2 and Overclock out: a person steals the twin
   * through F2, a known hole that must not decide this test; red team M6). Corp turn 10, 3 clicks, 5 credits, HQ Send a
   * Message and Hedge Fund; remote-1: two rezzed Palisades (barrier, strength 2, +2 on a remote, "End the run"), empty
   * root. Runner 0 credits, untagged, Cleaver (30006: "Interface -> 1 credit: Break up to 2 barrier subroutines. 2 credits:
   * +1 strength.") and Friend of a Friend installed; grip Tread Lightly and Smartware Distributor.
   * The Runner's line: Friend of a Friend for 9, run remote-1, Cleaver boosts 2 and breaks 1 at each Palisade (6).
   *
   * Recorded play (GameRunner, Normal against Normal, beta 85972cee plus the entry), not asserted: with the entry the Corp
   * plays Hedge Fund and draws twice, Send a Message stays in HQ; the Runner uses Friend of a Friend for 9 and runs R&D
   * (Offworld Office stolen there, off the top of R&D). Without the entry the Corp installed Send a Message in remote-1
   * and advanced it twice (the hunt's steal). The twin (no Friend of a Friend): the same install and two advances; the
   * Runner clicks for 1, draws twice and installs Smartware, nothing stolen.
   */
  const board = (foaf: boolean): GameState => {
    const s: GameState = JSON.parse(readFileSync(new URL('./fixtures/click-money/foaf-corp-t10.json', import.meta.url), 'utf8'));
    expect([s.turnNumber, s.activePlayer, s.corp.clicks, s.corp.credits, s.runner.credits, s.runner.tags]).toEqual([10, 'corp', 3, 5, 0, 0]);
    expect(s.corp.servers['remote-1'].ice.map(c => [c.cardCode, c.isRezzed])).toEqual([['30072', true], ['30072', true]]);
    expect(s.runner.rig.programs.map(c => c.cardCode)).toEqual(['30006']);
    expect(s.runner.grip.map(c => c.cardCode)).toEqual(['30012', '30033']);
    if (!foaf) s.runner.rig.resources = s.runner.rig.resources.filter(c => c.cardCode !== '34074');
    expect(s.runner.rig.resources.map(c => c.cardCode)).toEqual(foaf ? ['34074'] : []);
    return s;
  };
  const hold = (s: GameState) => inDecision(s, 'corp', () => serverHold(s, 'remote-1', { when: 'runnerTurn', corpCredits: s.corp.credits }));

  it('remote-1 does not hold against Friend of a Friend (need 6; budget 9 for its click, 1 each for the other two earning clicks)', () => {
    const h = hold(board(true));
    expect(h.holds).toBe(false);
    expect([h.need, h.budget]).toEqual([6, 11]);
  });

  it('twin: without Friend of a Friend remote-1 holds (need 6, budget 3)', () => {
    const h = hold(board(false));
    expect(h.holds).toBe(true);
    expect([h.need, h.budget]).toEqual([6, 3]);
  });

  it('twin: without Friend of a Friend the Corp commits Send a Message to remote-1 and nothing is stolen on the Runner\'s turn', { timeout: 120_000 }, () => {
    const s = board(false);
    const g = new GameRunner(s, { corp: createAgent('corp', 'normal'), runner: createAgent('runner', 'normal') });
    for (let i = 0; i < 800 && !g.state.winner && !(g.state.activePlayer === 'corp' && g.state.turnNumber > s.turnNumber); i++) if (!g.step()) break;
    expect(g.state.corp.servers['remote-1'].root.map(c => c.cardCode)).toEqual(['30069']);
    expect(g.state.runner.scoreArea).toEqual([]);
  });
});

describe('click money facts: runnerEarnings with Friend of a Friend', () => {
  it('one earning click gives 9, two give 10', () => {
    const { s } = rigWith('34074', {});
    expect(runnerEarnings(s).slice(0, 3)).toEqual([0, 9, 10]);
  });

  it('with Rent Rioters beside it the best set is taken: 3 clicks 11 (Friend of a Friend and two clicks), 4 clicks 18 (both)', () => {
    const { s } = rigWith('34074', {});
    s.runner.rig.resources.push(Object.assign(createCardInstance(s, '35011'), { isRezzed: true }));
    expect(runnerEarnings(s)).toEqual([0, 9, 10, 11, 18]);
  });

  it('tagged: the count reads 9 for the click where the engine pays 5 (the known overstatement by 4, named in the entry)', () => {
    // The entry is one number; the card pays 5 while tagged (its 9 is "only if you are not tagged", 1.16.1c). The error
    // is toward "does not hold", which can still cost the Corp (rez money kept, the remote's reservation, agenda commits):
    // the count note's tagged-board count is what the flat 9 rests on.
    const { s, card } = rigWith('34074', {}, 1);
    expect(runnerEarnings(s)[1]).toBe(9);
    expect(enginePays(s, card).credits).toBe(5);
  });
});
