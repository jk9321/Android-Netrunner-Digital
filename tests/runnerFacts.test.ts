/**
 * R-A A-move (spec netrunner-ai/runner-rework/specs/r-a.md, bar 1c and 6): the Runner's card facts moved into the card
 * entries change no reader. Every golden board (tests/fixtures/runner-facts/golden.json, captured by A-log on the base
 * src tree fd7831eb, read only here) is built again and every reader must give the golden number, on the board and on its
 * twin; the L11 checks (entry against engine) must read as they did. Then every moved fact is read back from its entry.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { L11, golden, stops } from '../scripts/runner-rework/facts-golden-lib';
import { CARDS } from '../src/ai/cards';
import { runEventOptions } from '../src/ai/prompts';
import { counterWorthOf } from '../src/ai/effectValues';
import { runBypasses } from '../src/ai/runs';
import { createCardInstance } from '../src/core/engine/gameState';
import { onceKey, spikeKey } from '../src/core/scripts/liberation/runner/helpers';
import { newGame, startRunnerTurn } from './helpers';

const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/runner-facts/golden.json', import.meta.url), 'utf8'));
// The rounding and Infinity encoding of the file: compare as the file was written
const asFile = (x: unknown) => JSON.parse(JSON.stringify(x));

describe('the golden boards (leg 1c)', () => {
  it('builds the same 60 boards, each with a live twin', () => {
    expect(golden.length).toBe(GOLDEN.boards.length);
    expect(stops).toEqual([]);
    expect(golden.map(g => `${g.case} / ${g.branch}`)).toEqual(GOLDEN.boards.map((g: any) => `${g.case} / ${g.branch}`));
  });

  // The one recorded reader whose output is the moved fact itself: Jailbreak's run options now carry its draw
  // (successDraws, read only by scoreMain, which the golden ranked list checks); every number is compared as recorded
  const lessDraws = (r: any) => {
    if (r?.runEventOptions?.successDraws === undefined) return r;
    expect(r.runEventOptions.successDraws).toBe(1);
    const rest = { ...r.runEventOptions };
    delete rest.successDraws;
    return { ...r, runEventOptions: rest };
  };
  // F108 (2026-11-25, Jeff's yes in the build thread): one golden number moves, nothing else; the file is not edited. On
  // "Funhouse / rezzed, tagged" the run's click was priced through a card's worth at the tagged rate (clickPrice, clickWorth,
  // cardRate: VRcation's playedWorth and the deck's average card 1.2499 tagged against 1.9694 untagged). F108 waits every
  // Runner card at the untagged rate, tagged or not, so the click costs 1.9694 on this board and runScore goes 1.6284 to
  // 0.9018. Breach, the ice's price, credits, approach and tagsWorth (3.25) are unchanged; so are the twin and every other board.
  const F108: Record<string, Record<string, number>> = { 'Funhouse / rezzed, tagged': { runScore: 0.9018 } };
  // B3b (2026-11-26, brief b3-prompt-view rev 2 S2; the Runner rework coordinator's ruling in runner-rework/b3/
  // b3b-cap-question.md): trojanHostValue left the install action (the host's worth is counterValues.ts trojanHostWorth's,
  // which the outcome already reads). On the six in-grip trojan boards (and their twins) each install on a rezzed host scores
  // the recorded number less the recorded trojanHostValue of its host (the same on every rezzed host of these boards: 3.7;
  // an unrezzed host recorded none and keeps the -3, now RUNNER_TERMS.facedownTrojanHost) and the list sorts again. The extra
  // itself has no reader left, so it leaves the readers and the live list. Every other recorded number compares as recorded;
  // the file is not edited.
  const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
  const B3B = (readers: Record<string, any>) => {
    if (!('trojanHostValue' in readers)) return readers;
    const { trojanHostValue, ...rest } = readers;
    const term = [...new Set(trojanHostValue as number[])];
    if (term.length > 1) throw new Error('a board whose hosts differ in trojanHostValue: name each host');
    if (!term.length) return rest;
    const trojan = /^INSTALL_CARD:(Botulus|Tranquilizer)@/;
    const ranked = (rest.rankMainActions as { a: string; score: number }[]).map(r => (trojan.test(r.a) ? { ...r, score: r4(r.score - term[0]) } : r));
    return { ...rest, rankMainActions: [...ranked].sort((x, y) => y.score - x.score) };
  };
  const B3BLive = (live: string[]) => live.filter(k => k !== 'trojanHostValue');
  for (const [i, want] of (GOLDEN.boards as any[]).entries()) {
    it(`${want.case} / ${want.branch}: every reader gives the golden number`, () => {
      const got = asFile(golden[i]);
      got.readers = lessDraws(got.readers);
      got.twin = lessDraws(got.twin);
      expect(got.board).toEqual(want.board);
      expect(got.readers).toEqual({ ...B3B(want.readers), ...F108[`${want.case} / ${want.branch}`] });
      expect(got.twin).toEqual(B3B(want.twin));
      expect(got.live).toEqual(B3BLive(want.live));
    });
  }

  it('reads every L11 entry against the engine as before', () => {
    expect(asFile(L11)).toEqual(GOLDEN.l11);
  });
});

// ------------------------------------------------------------------------------------------------ the moved facts (bar 6)

/** The codes whose entry has the field, sorted: a new card with it fails here until someone looks (ruling A). */
const carrying = (has: (e: (typeof CARDS)[string]) => unknown) =>
  Object.keys(CARDS)
    .filter(code => has(CARDS[code]))
    .sort();

describe('the facts read from the card entries (R-A A-move)', () => {
  it('names the cards each generic reader reads today', () => {
    // holdFacts, now read by both sides
    expect(carrying(e => e.holdFacts?.breaksHostSubroutine)).toEqual(['30004']); // Botulus: botulusBreaks, the encounter's use
    expect(carrying(e => e.holdFacts?.hostBypass)).toEqual(['34082']); // Physarum Entangler: physarumCost
    // plainIcePrice reads one encounter shape: the run ends unless N tags, no threat line (Funhouse)
    expect(carrying(e => e.holdFacts?.encounter?.toll?.endRun && e.holdFacts.encounter.unless?.tags && e.holdFacts.encounter.threatAtLeast === undefined)).toEqual(['30054']);
    // runFacts, by field
    const breaker = (k: string) => carrying(e => (e.runFacts?.breaker as Record<string, unknown> | undefined)?.[k]);
    expect(breaker('trashedWhenRunEnds')).toEqual(['30032']); // Mayfly
    expect(breaker('breaksPerEncounter')).toEqual(['34026']); // Slap Vandal
    expect(breaker('boostPerCounter')).toEqual(['35008']); // Hantu
    expect(breaker('boostPerGripCard')).toEqual(['34004']); // Audrey v2
    expect(breaker('breakByCounter')).toEqual(['34004', '34090']); // Audrey v2, Lobisomem
    expect(breaker('boostOnce')).toEqual(['34092']); // Pressure Spike
    expect(breaker('lowerPerStealthCredit')).toEqual(['36004']); // Corsair
    expect(breaker('noEndRun')).toEqual(['34005']); // Banner
    expect(carrying(e => e.runFacts?.bypass)).toEqual(['34015', '34016', '34081', '35021']); // Curupira, Laser Pointer, Malandragem, Fransofia Ward
    expect(carrying(e => e.runFacts?.firstIce)).toEqual(['34012', '34078']); // S-Dobrado, Alarm Clock
    expect(carrying(e => e.runFacts?.trojan)).toEqual(['30004', '30017']); // Botulus, Tranquilizer
    expect(carrying(e => e.runFacts?.faceupAgendaAccess)).toEqual(['35068']); // BANGUN
    expect(carrying(e => e.runFacts?.hostileNotTrap)).toEqual(['35061']); // Idiosyncresis
    expect(carrying(e => e.runFacts?.playsAfterSuccessfulRuns)).toEqual(['36001']); // Chain Reaction
    expect(carrying(e => e.run?.().successDraws)).toEqual(['30028']); // Jailbreak
  });

  it('reads back every moved fact from its entry', () => {
    const f = (code: string) => CARDS[code].runFacts;
    expect(f('30032')?.breaker?.trashedWhenRunEnds).toBe(true);
    expect(f('35068')?.faceupAgendaAccess).toEqual({ meatDamage: 2, tags: 1 });
    expect(f('35008')?.breaker?.boostPerCounter).toEqual({ kind: 'virus', strength: 2 });
    expect(CARDS['30004'].holdFacts?.breaksHostSubroutine).toEqual({ counter: 'virus' });
    expect(f('30004')?.trojan).toEqual({ second: 'adds' });
    expect(f('30017')?.trojan).toEqual({ second: 'idle' });
    expect(f('34004')?.breaker).toEqual({ breakByCounter: { kind: 'virus' }, boostPerGripCard: { strength: 3 } });
    expect(f('34005')?.breaker?.noEndRun).toEqual({ credits: 2, fits: { subtype: 'barrier', allSubsEndTheRun: true } });
    expect(f('34090')?.breaker?.breakByCounter).toEqual({ kind: 'power', fits: { subtype: 'barrier' }, creditsPerSubroutine: 1 });
    expect(f('34092')?.breaker?.boostOnce).toEqual({ strength: 9, credits: 2, when: { threatAtLeast: 4 }, once: { per: 'run', flag: 'pressure-spike:<instance>' } });
    expect(f('36004')?.breaker?.lowerPerStealthCredit).toEqual({ strength: 3 });
    expect(f('34026')?.breaker?.breaksPerEncounter).toBe(1);
    expect(CARDS['34082'].holdFacts?.hostBypass).toEqual({ creditsPerSubroutine: 1, unlessSubtype: 'barrier' });
    expect(CARDS['30054'].holdFacts?.encounter).toEqual({ toll: { endRun: true }, unless: { tags: 1 } });
    // S-Dobrado's first ice is free: its branch charges nothing (its policy), so its entry must say 0 clicks
    expect(f('34012')?.firstIce).toEqual({ option: 'bypassFirst', clicks: 0, next: { when: { threatAtLeast: 4 }, clicks: 1 } });
    expect(f('34078')?.firstIce).toEqual({ option: 'alarmClock', clicks: 2 });
    expect(f('35061')?.hostileNotTrap).toBe(true);
    expect(f('34081')?.bypass).toEqual([
      { fits: { strengthAtMost: 3 }, cost: { counter: { kind: 'power', n: 1 }, once: { per: 'turn', flag: 'once:<instance>:0' } } },
      { when: { threatAtLeast: 4 }, cost: { removed: true } },
    ]);
    expect(f('34016')?.bypass).toEqual([{ fits: { keywordAny: ['ap', 'destroyer', 'observer'] }, cost: { trashed: true } }]);
    expect(f('34015')?.bypass).toEqual([{ fits: { subtype: 'barrier' }, cost: { counter: { kind: 'power', n: 3 } } }]);
    expect(f('35021')?.bypass).toEqual([{ when: { corpCreditsAtLeast: 15 }, cost: { trashed: true } }]);
    expect(f('36001')?.playsAfterSuccessfulRuns).toEqual(['hq', 'rd', 'archives']);
    expect(runEventOptions('30028')).toEqual({ extraAccesses: 1, successDraws: 1 });
  });

  it('has one entry for each first-ice option, a runner formula for every bypass used up on use, and a grip boost for every counter break without credits', () => {
    const options = Object.values(CARDS).flatMap(e => (e.runFacts?.firstIce ? [e.runFacts.firstIce.option] : []));
    expect(options.sort()).toEqual(['alarmClock', 'bypassFirst']);
    for (const [code, e] of Object.entries(CARDS))
      for (const mode of e.runFacts?.bypass ?? []) if (mode.cost.trashed || mode.cost.removed) expect(e.runner, `${code}: priced by runnerEffect`).toBeTypeOf('function');
    for (const [code, e] of Object.entries(CARDS)) {
      const b = e.runFacts?.breaker;
      if (b?.breakByCounter && b.breakByCounter.creditsPerSubroutine === undefined) expect(b.boostPerGripCard, `${code}: Audrey's plan`).toBeDefined();
    }
  });

  it("states the engine's own flag names (A-log L10)", () => {
    const s = newGame(1);
    const spike = createCardInstance(s, '34092');
    const mal = createCardInstance(s, '34081');
    const flag = (code: string, card: typeof spike, i: number) => {
      const breakerOnce = CARDS[code].runFacts?.breaker?.boostOnce?.once.flag;
      return (breakerOnce ?? CARDS[code].runFacts!.bypass![i].cost.once!.flag).replace('<instance>', card.instanceId);
    };
    expect(flag('34092', spike, 0)).toBe(spikeKey(spike));
    expect(flag('34081', mal, 0)).toBe(onceKey(mal));
  });

  it("gives Malandragem's counter mode one use a turn with two counters and two fitting ice (ruling B)", () => {
    const s = structuredClone(newGame(1));
    startRunnerTurn(s);
    s.runner.credits = 10;
    s.corp.credits = 10;
    for (const code of ['30047', '30047']) {
      const ice = createCardInstance(s, code); // Karuna: strength 3, fits
      ice.isRezzed = true;
      ice.runnerKnows = true;
      s.corp.servers.hq.ice.push(ice);
    }
    const mal = createCardInstance(s, '34081');
    mal.isRezzed = true;
    mal.tokens = { ...mal.tokens, power: 2 };
    s.runner.rig.programs.push(mal);
    const b = runBypasses(s, 'hq');
    expect(b.ids.size).toBe(1);
    expect(b.price).toBe(counterWorthOf(s, '34081', 'power'));
  });
});
