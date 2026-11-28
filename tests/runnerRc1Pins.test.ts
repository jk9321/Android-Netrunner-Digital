import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GameAction, GameState, activePrompt, cardDef, createInitialGameState, executeAction, getCardDefinition, getLegalActions } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { createAgent } from '../src/ai';
import { Agent } from '../src/ai/agent';
import { GameRunner } from '../src/ai/playout';
import { asSide } from '../src/ai/pricing';
import { answerPrompt } from '../src/ai/prompts';
import { RunnerMemory, iceCreditNeed, iceCreditsAhead, runRestWorth, runScore } from '../src/ai/runs';
import { giveCard, installCorpForTest, installIceForTest, installProgramForTest, newGame, runIntoFirstIce, startRunnerTurn } from './helpers';

/**
 * R-C1 Part 0 pins (plan netrunner-ai/runner-rework/r-c1/plan-draft-1.md section 5 Part 0 item 1; tracker R-14j, R-14k,
 * R-14m, R-73, R-119). Written on beta 0b9d44a, before B4d merges; re-checked on the tree B4d leaves (plan section 8b).
 *
 * Each pin states the right behaviour, not a score. A fault that happens today is a known failure (`it.fails`) beside a
 * setup test that checks the board apart from the pin (an `it.fails` also passes on a thrown error) and a twin that
 * passes today. A board whose answer is right today is a guard (plain `it`) that the walk must keep (the O2 red team's
 * boards). The status of each pin on 0b9d44a is in its comment. Boards are edited only before any AI reads them, or on a
 * structuredClone (RULE-NO-MUTATE-AFTER-LEGALITY).
 *
 * Rules: 1.14.5 (the Corp makes the choices of its ice's subroutines), 6.9.2 (approach), 6.9.3 (encounter), 6.9.4
 * (Movement: the Runner may jack out), 10.4.4 (flatline: more damage than cards in the grip), 10.2.2 (hidden information).
 */

type Observer = Agent & { observe?: (s: GameState) => void; memory?: RunnerMemory };
const R = <T,>(fn: () => T): T => asSide('runner', fn);

interface TurnLog {
  end: GameState;
  runs: { server: string; successful: boolean }[];
}

/**
 * Plays from the board to the end of the Runner's turn with the Normal Runner and Corp. The runs are the last
 * runsThisTurn before the turn's end clears it (it only grows within a turn; a run's success is set on a later state).
 */
function playTurn(state: GameState, runner: Observer = createAgent('runner', 'normal') as Observer): TurnLog {
  const turn = state.turnNumber;
  const g = new GameRunner(structuredClone(state), { runner, corp: createAgent('corp', 'normal') });
  let runs = g.state.runsThisTurn;
  for (let k = 0; k < 3000 && g.state.turnNumber === turn && !g.state.winner; k++) {
    runner.observe?.(g.state);
    if (!g.step()) break;
    if (g.state.runsThisTurn.length >= runs.length) runs = g.state.runsThisTurn;
  }
  return { end: g.state, runs };
}

/** The board with the Runner's run on `server` started (its click spent), then played to the turn's end. */
const forcedRun = (s: GameState, server: string): TurnLog => playTurn(executeAction(structuredClone(s), { type: 'INITIATE_RUN', player: 'runner', targetServerId: server }));

const titles = (cards: GameState['corp']['servers'][string]['ice']) => cards.map(c => [cardDef(c).title, c.isRezzed]);
const BRAN = '30039', BUMI = '35041', ANSEL2 = '36028', CARMEN = '30015', CLEAVER = '30006', MANEGARM = '30042', TITHE = '30073';
const LUMINAL = '30036', PALISADE = '30072', HUB = '30070', CURUPIRA = '34015', JAILBREAK = '30028', REGOLITH = '30071';

// ------------------------------------------------------------------------------------------------ R-14j: the O3 boards
// /mnt/project-files/adversarial/2026-11-25-runner-o3/ findings 1 to 5 (probe/boards.ts). remote-9 holds the ice listed
// (inner first, all rezzed) and a facedown Luminal Transubstantiation (30036) in the root; the Corp's HQ holds no ice;
// the starter deck's Runner has 4 clicks, a grip of 5 and the credits named. Each in-run pin starts the run on remote-9 and lets the Normal Runner play
// it: the red team's fault is in the run, whatever the Runner would have chosen to run.
function o3Board(ice: string[], set: (s: GameState) => void): GameState {
  const s = newGame();
  // No ice in HQ (Archives is empty at the start): Brân 1.0's "install 1 piece of ice from HQ or Archives directly
  // inward" then installs nothing, so its two "End the run" are all that stops the Runner
  const hqIce = s.corp.hq.filter(c => cardDef(c).type_code === 'ice');
  s.corp.hq = s.corp.hq.filter(c => cardDef(c).type_code !== 'ice');
  s.corp.rd.push(...hqIce);
  for (const code of ice) installIceForTest(s, code, 'remote-9');
  installCorpForTest(s, LUMINAL, 'remote-9');
  startRunnerTurn(s);
  set(s);
  return s;
}
const into9 = (log: TurnLog) => log.runs.filter(r => r.server === 'remote-9');
const gotIn = (log: TurnLog) => into9(log).some(r => r.successful);

describe('R-14j, the O3 red team boards (each fails on 0b9d44a as the red team found it on 11-25)', () => {
  // manegarmBran (finding 1): Brân 1.0, Manegarm Skunkworks rezzed in the root ("Whenever the Runner approaches this
  // server, end the run unless they either spend [click][click] or pay 5[credit]"), Cleaver, 4 credits. Brân's two
  // "End the run" take 2 of the 3 clicks left after the run's own (Cleaver cannot break a bioroid), so at the approach the
  // Runner has 1 click and 4 credits: neither toll can be paid and no remote-9 run gets in this turn. Today the price
  // reads the toll outside the ice's clicks (runScore +7.5), the Runner's first action is a remote-9 run, it clicks Brân
  // twice and jacks out at the approach.
  const manegarmBran = (credits = 4) =>
    o3Board([BRAN], s => {
      installCorpForTest(s, MANEGARM, 'remote-9', true);
      installProgramForTest(s, CLEAVER);
      s.runner.credits = credits;
    });

  it('manegarmBran setup: Brân rezzed, Manegarm rezzed in the root, Cleaver, 4 clicks, 4 credits', () => {
    const s = manegarmBran();
    expect(titles(s.corp.servers['remote-9'].ice)).toEqual([['Brân 1.0', true]]);
    expect(s.corp.hq.some(c => cardDef(c).type_code === 'ice')).toBe(false);
    expect(titles(s.corp.servers['remote-9'].root)).toEqual([['Luminal Transubstantiation', false], ['Manegarm Skunkworks', true]]);
    expect(s.runner.rig.programs.map(c => cardDef(c).title)).toEqual(['Cleaver']);
    expect([s.runner.clicks, s.runner.credits]).toEqual([4, 4]);
  });

  it.fails('manegarmBran: the Normal Runner does not choose a remote-9 run it cannot finish', () => {
    const pick = createAgent('runner', 'normal').chooseAction(structuredClone(manegarmBran()));
    expect(pick).not.toMatchObject({ type: 'INITIATE_RUN', targetServerId: 'remote-9' });
  });

  it('manegarmBran twin: with 9 credits the toll is paid with credits after Brân\'s clicks, and the run gets in', { timeout: 60_000 }, () => {
    expect(gotIn(forcedRun(manegarmBran(9), 'remote-9'))).toBe(true);
  });

  // ansel2Bran (finding 2): Brân 1.0 inner, Ansel 2.0 outer; Carmen and 20 credits. The line: Carmen breaks Ansel 2.0 for
  // credits (a sentry), then Brân's two "End the run" by 2 of the 3 clicks left. Today the Runner clicks Ansel 2.0's own
  // pair break (2 clicks) for its "End the run" and jacks out at Brân with 1 click and 20 credits.
  const ansel2Bran = (ice = [BRAN, ANSEL2]) =>
    o3Board(ice, s => {
      installProgramForTest(s, CARMEN);
      s.runner.credits = 20;
    });

  it('ansel2Bran setup: Brân inner, Ansel 2.0 outer, Carmen, 20 credits, 4 clicks', () => {
    const s = ansel2Bran();
    expect(titles(s.corp.servers['remote-9'].ice)).toEqual([['Brân 1.0', true], ['Ansel 2.0', true]]);
    expect(s.runner.rig.programs.map(c => cardDef(c).title)).toEqual(['Carmen']);
    expect([s.runner.clicks, s.runner.credits]).toEqual([4, 20]);
  });

  it.fails('ansel2Bran: a remote-9 run gets in', { timeout: 60_000 }, () => {
    expect(gotIn(forcedRun(ansel2Bran(), 'remote-9'))).toBe(true);
  });

  it('ansel2Bran twin: Ansel 2.0 alone, the run gets in', { timeout: 60_000 }, () => {
    expect(gotIn(forcedRun(ansel2Bran([ANSEL2]), 'remote-9'))).toBe(true);
  });

  // jointBound (findings 4 and 5): Tithe outer, Bumi 1.0 middle, Brân 1.0 inner; no programs, 5 credits, a grip of 1. The
  // line within both the click and the damage bound: Tithe's 1 net damage taken (grip 1 -> 0; 10.4.4), Bumi's "Do 1 core
  // damage" clicked and its "Trash 1 installed program" left to resolve (no programs), Brân's two "End the run" clicked:
  // 3 clicks after the run's own, no core damage. Today the Runner clicks both of Bumi's subroutines and jacks out at Brân
  // with 1 click.
  const jointBound = () =>
    o3Board([BRAN, BUMI, TITHE], s => {
      s.runner.credits = 5;
      s.runner.stack.unshift(...s.runner.grip.splice(1));
    });

  it('jointBound setup: Brân inner, Bumi 1.0, Tithe outer, no programs, grip 1, 5 credits', () => {
    const s = jointBound();
    expect(titles(s.corp.servers['remote-9'].ice)).toEqual([['Brân 1.0', true], ['Bumi 1.0', true], ['Tithe', true]]);
    expect(s.runner.rig.programs).toEqual([]);
    expect([s.runner.clicks, s.runner.credits, s.runner.grip.length]).toEqual([4, 5, 1]);
  });

  it.fails('jointBound: a remote-9 run gets in, with no flatline', { timeout: 60_000 }, () => {
    const log = forcedRun(jointBound(), 'remote-9');
    expect(log.end.winner).toBeFalsy();
    expect(gotIn(log)).toBe(true);
  });

  // bumiBran (finding 3; the best line written first, as R-14j asks). Bumi 1.0 outer, Brân 1.0 inner, no programs, 5
  // credits, a grip of 5. The best line: Bumi's "Trash 1 installed program" resolves for nothing (no programs) and its
  // "Do 1 core damage" is clicked (1 click); Brân needs only its two "End the run" clicked (2 clicks). With the run's own
  // click that is all 4 clicks and no damage, and the run gets in. (Taking the core damage instead keeps a click for a
  // hand size lost for the game; the pin asks only for the entry.) Today the Runner clicks both of Bumi's subroutines and
  // jacks out at Brân with 1 click. The grip-0 twin of finding 3 (Bumi's core damage must be clicked) fails the same way.
  const bumiBran = (grip = 5) =>
    o3Board([BRAN, BUMI], s => {
      s.runner.credits = 5;
      s.runner.stack.unshift(...s.runner.grip.splice(grip));
    });

  it('bumiBran setup: Brân inner, Bumi 1.0 outer, no programs, grip 5, 5 credits', () => {
    const s = bumiBran();
    expect(titles(s.corp.servers['remote-9'].ice)).toEqual([['Brân 1.0', true], ['Bumi 1.0', true]]);
    expect(s.runner.rig.programs).toEqual([]);
    expect([s.runner.clicks, s.runner.credits, s.runner.grip.length]).toEqual([4, 5, 5]);
  });

  it.fails('bumiBran: a remote-9 run gets in (Bumi\'s core damage clicked, its program trash let resolve, Brân\'s two run-enders clicked)', { timeout: 60_000 }, () => {
    expect(gotIn(forcedRun(bumiBran(), 'remote-9'))).toBe(true);
  });

  it.fails('bumiBran at grip 0: a remote-9 run gets in, with no flatline', { timeout: 60_000 }, () => {
    const log = forcedRun(bumiBran(0), 'remote-9');
    expect(log.end.winner).toBeFalsy();
    expect(gotIn(log)).toBe(true);
  });

  it('bumiBran twin: Brân alone, the run gets in by its two run-enders', { timeout: 60_000 }, () => {
    expect(gotIn(forcedRun(o3Board([BRAN], s => void (s.runner.credits = 5)), 'remote-9'))).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------ R-14j: the O2 boards
// /mnt/project-files/adversarial/2026-11-26-runner-o2/ findings 1, 2 and 4 (probe-flat.ts, probe64.ts). Guards: each
// answer is right on 0b9d44a and the walk must keep it.
interface Saved {
  config: { seed: number; corpDeck: never; runnerDeck: never };
  startStops?: GameState['stops'];
  moves: GameAction[];
}
const savedGame = (path: string): Saved => JSON.parse(readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf8'));

/** The saved game before the first move `stop` accepts, and a Normal Runner that watched every board up to it. */
function replayTo(path: string, stop: (s: GameState, move: GameAction, i: number) => boolean): { state: GameState; runner: Observer } {
  const r = savedGame(path);
  let s = createInitialGameState(deckGameSetup(r.config.seed, r.config.corpDeck, r.config.runnerDeck));
  if (r.startStops) s = { ...s, stops: r.startStops };
  const runner = createAgent('runner', 'normal') as Observer;
  for (let i = 0; i < r.moves.length; i++) {
    runner.observe?.(s);
    if (stop(s, r.moves[i], i)) return { state: structuredClone(s), runner };
    s = executeAction(s, r.moves[i]);
  }
  throw new Error(`${path}: the stop was not reached`);
}
const runnerAnswer = (s: GameState, memory?: RunnerMemory): string | undefined => {
  const a = R(() => answerPrompt(s, 'runner', memory, false));
  return a?.type === 'RESOLVE_PROMPT' && a.choice.kind === 'effect_choice' ? a.choice.optionId : undefined;
};

describe('R-14j, the O2 red team boards (guards: right on 0b9d44a)', () => {
  // Karunā (finding 1): #72's saved game at move 124 (T8), Karunā's "Do 2 net damage. The Runner may jack out." prompt
  // after the first 2 damage, its second "Do 2 net damage" still to resolve. Edited: the grip cut to 1 and the root card
  // made an Offworld Office the Runner knows. Staying is a flatline (2 net damage on 1 card, 10.4.4), however much the
  // agenda is worth. Today: "jack".
  const karuna = () => {
    const { state, runner } = replayTo('runner-issues/issue-72.json', (_s, _m, i) => i === 124);
    const b = structuredClone(state);
    b.runner.stack.unshift(...b.runner.grip.splice(1));
    const root = b.corp.servers[b.activeRun!.server].root[0];
    const offworld = [...b.corp.rd, ...b.corp.hq].find(c => getCardDefinition(c.cardCode).title === 'Offworld Office')!;
    root.cardCode = offworld.cardCode;
    root.runnerKnows = true;
    const memory: RunnerMemory = new Map(runner.memory ?? []);
    memory.set(root.instanceId, root.cardCode);
    return { b, memory };
  };

  it('Karunā setup: the jack-out prompt of a rezzed Karunā, grip 1, a known Offworld Office in the root', () => {
    const { b } = karuna();
    const p = activePrompt(b)!;
    expect('source' in p && p.source.cardCode).toBe('30047');
    expect(p.kind === 'effect_choice' && p.options.map(o => o.id)).toEqual(['jack', 'stay']);
    expect(b.runner.grip.length).toBe(1);
    expect(cardDef(b.corp.servers[b.activeRun!.server].root[0]).title).toBe('Offworld Office');
  });

  it('Karunā guard: at grip 1 with a known agenda the Runner jacks out (staying flatlines)', { timeout: 30_000 }, () => {
    const { b, memory } = karuna();
    expect(runnerAnswer(b, memory)).toBe('jack');
  });

  // Semak-samun (findings 2 and 4): #64's saved game at the start of the T4 run on remote-2 (Semak-samun, "End the run
  // unless the Runner suffers 3 net damage"; grip 3), played to Semak-samun's prompt by the Normal agents.
  const toSemak = (edit: (s: GameState) => void): { at: GameState | null; runner: Observer } => {
    const { state, runner } = replayTo('runner-issues/issue-64.json', (s, m) => s.turnNumber === 4 && s.activePlayer === 'runner' && m.type === 'INITIATE_RUN');
    edit(state);
    runner.observe?.(state);
    const g = new GameRunner(executeAction(state, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote-2' }), { runner: createAgent('runner', 'normal'), corp: createAgent('corp', 'normal') });
    for (let k = 0; k < 60 && g.state.activeRun; k++) {
      const p = activePrompt(g.state);
      if (p && 'source' in p && p.source.cardCode === '35054') return { at: g.state, runner };
      g.step();
    }
    return { at: null, runner };
  };
  const inwardBran = (s: GameState) => {
    const semak = s.corp.servers['remote-2'].ice[0];
    s.corp.servers['remote-2'].ice.unshift({ ...structuredClone(semak), instanceId: 'inst-9001', cardCode: BRAN, isRezzed: true });
  };
  const airbladeX = (s: GameState) => {
    const like = s.runner.rig.programs[0];
    s.runner.rig.hardware.push({ ...structuredClone(like), instanceId: 'inst-9002', cardCode: '34022', hostedOnId: undefined, tokens: { power: 3 } });
    s.runner.stack.unshift(s.runner.grip.pop()!);
  };

  // Semak-samun outside a rezzed Brân 1.0: taking the 3 damage leaves the clicks to Brân, not to drawing back; played on
  // (O2 probe B) the Runner ends the turn on 1 card. Today: "end".
  it('Semak-samun outside a rezzed Brân 1.0 guard: the Runner ends the run', { timeout: 60_000 }, () => {
    const { at, runner } = toSemak(inwardBran);
    expect(at && titles(at.corp.servers['remote-2'].ice).map(t => t[0])).toEqual(['Brân 1.0', 'Semak-samun']);
    expect(at!.runner.grip.length).toBe(3);
    expect(runnerAnswer(at!, runner.memory)).toBe('end');
  });

  // Semak-samun with an empty stack: the 3 damage cannot be drawn back (drawBackClicks does not read the stack); played on
  // (O2 probe A) the Runner ends the turn on 0 cards. Today: "end".
  it('Semak-samun with an empty stack guard: the Runner ends the run', { timeout: 60_000 }, () => {
    const { at, runner } = toSemak(s => void (s.runner.stack.length = 0));
    expect(at!.runner.stack.length).toBe(0);
    expect(at!.runner.grip.length).toBe(3);
    expect(runnerAnswer(at!, runner.memory)).toBe('end');
  });

  // AirbladeX (finding 4): AirbladeX with 3 hosted power counters ("Prevent 1 net damage. Use this ability only during a
  // run") and a grip of 2: all 3 damage is prevented (O2 probe C2: run successful, grip 5 at the turn's end). Today:
  // "damage". Prevention is an input of the walk's damage count (O2 coordinator's answer 4).
  it('Semak-samun with AirbladeX at grip 2 guard: the Runner takes the damage (it continues)', { timeout: 60_000 }, () => {
    const { at, runner } = toSemak(airbladeX);
    expect(at!.runner.grip.length).toBe(2);
    expect(at!.runner.rig.hardware.some(c => c.cardCode === '34022' && c.tokens.power === 3)).toBe(true);
    expect(runnerAnswer(at!, runner.memory)).toBe('damage');
  });
});

// ------------------------------------------------------------------------------------------------ R-14j: Gemini's boards
// The R-22 checkpoint's Gemini audit (/mnt/project-files/audits/2026-11-27-rb-checkpoint/gemini-report.md,
// AI-RUN-REST-WORTH-STALE-ENCOUNTER). runRestWorth (src/ai/runs.ts) is the worth of the rest of the run that every
// mid-run Runner prompt reads (prompts.ts scoreOutcome).
describe('R-14j, Gemini\'s two runRestWorth boards', () => {
  // Board 1: two Palisades on remote-9 (strength 4 there), a Superconducting Hub the Runner knows in the root, Cleaver
  // (strength 3) and 10 credits, at the outer Palisade's encounter. A boost bought for this encounter does not carry to
  // the inner Palisade (boosts last for the encounter, Cleaver's "+1 strength"), so the rest of the run is worth the same
  // with or without it. Today the boost is read for the inner ice too: 0.18 becomes 3.01.
  const palisades = (): { s: GameState; cleaver: string } => {
    let s = newGame();
    installIceForTest(s, PALISADE, 'remote-9');
    installIceForTest(s, PALISADE, 'remote-9');
    installCorpForTest(s, HUB, 'remote-9');
    s.corp.servers['remote-9'].root[0].runnerKnows = true;
    const cleaver = installProgramForTest(s, CLEAVER);
    s.runner.credits = 10;
    s = runIntoFirstIce(s, 'remote-9');
    return { s, cleaver };
  };

  it('board 1 setup: the outer Palisade\'s encounter, no boost bought, the inner Palisade ahead', () => {
    const { s } = palisades();
    expect(s.activeRun).toMatchObject({ phase: 'encounter_ice', icePosition: 1 });
    expect(s.activeRun!.encounter!.boosts).toEqual({});
  });

  it.fails('board 1: a boost bought for the outer encounter does not change the worth of the rest of the run', () => {
    const { s, cleaver } = palisades();
    const boosted = structuredClone(s);
    boosted.activeRun!.encounter!.boosts = { [cleaver]: 1 };
    expect(R(() => runRestWorth(boosted))).toBeCloseTo(R(() => runRestWorth(s)), 6);
  });

  // Board 2: Tithe outer, Palisade inner (strength 4), a faceup Superconducting Hub in the root, Curupira (strength 1;
  // "1[credit]: Break 1 barrier subroutine", "1[credit]: +1 strength", and "spend 3 hosted power counters to bypass" a
  // barrier) and 0 credits, at Tithe's encounter. With no power counters the inner Palisade needs 4 credits the Runner
  // does not have (iceCreditsAhead reads 4), so the rest of the run is worth 0. Today runRestWorth reads 8.8, the same as
  // with the 3 counters that bypass it (Gemini's reading was the other way round, "0 with the bypass"; on 0b9d44a the
  // fault is that the credits are not capped, as its last sentence says).
  const titheCurupira = (power: number): GameState => {
    let s = newGame();
    installIceForTest(s, PALISADE, 'remote-9');
    installIceForTest(s, TITHE, 'remote-9');
    installCorpForTest(s, HUB, 'remote-9');
    s.corp.servers['remote-9'].root[0].faceUp = true;
    const id = installProgramForTest(s, CURUPIRA);
    const curupira = s.runner.rig.programs.find(c => c.instanceId === id)!;
    curupira.tokens = { ...curupira.tokens, power };
    s.runner.credits = 0;
    s = runIntoFirstIce(s, 'remote-9');
    return s;
  };

  it('board 2 setup: Tithe\'s encounter, 0 credits; the inner Palisade needs 4 credits without the counters and 0 with them', () => {
    expect(titheCurupira(0).activeRun).toMatchObject({ phase: 'encounter_ice', icePosition: 1 });
    expect(R(() => iceCreditsAhead(titheCurupira(0)))).toBe(4);
    expect(R(() => iceCreditsAhead(titheCurupira(3)))).toBe(0);
  });

  it.fails('board 2: with no counters and 0 credits the rest of the run is worth 0', () => {
    expect(R(() => runRestWorth(titheCurupira(0)))).toBe(0);
  });

  it('board 2 twin: with 3 counters the bypass gets in and the rest of the run is worth more than 0', () => {
    expect(R(() => runRestWorth(titheCurupira(3)))).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------------------------------------ R-14k, R-14m, R-73
describe('R-14k, a run event\'s server prompt is priced one click short', () => {
  // O3 finding 6 (probe/callers.ts): Brân 1.0 on HQ, 4 clicks, Jailbreak ("Run HQ or R&D") in the grip. The ranking's
  // view before the play prices HQ with the run's click still to spend; the prompt is answered after the event's click
  // is spent (rule 1.5: playing an event costs a click) and selfBreakPrice takes the run's click off again, so Brân reads
  // barred and HQ -Infinity. The two must agree: the clicks a run has come from the caller, not from activeRun.
  const jailbreak = () => {
    const s = newGame();
    installIceForTest(s, BRAN, 'hq');
    startRunnerTurn(s);
    const id = giveCard(s, 'runner', JAILBREAK);
    const before = structuredClone(s);
    const play = getLegalActions(s, 'runner').find(a => a.type === 'PLAY_OPERATION_OR_EVENT' && a.cardInstanceId === id)!;
    return { before, after: executeAction(s, play) };
  };

  it('setup: the Jailbreak prompt (HQ or R&D) at 3 clicks with no run, and HQ priced finite before the play', () => {
    const { before, after } = jailbreak();
    const p = activePrompt(after)!;
    expect(p.kind === 'effect_choice' && p.options.map(o => o.id)).toEqual(['hq', 'rd']);
    expect([after.runner.clicks, !!after.activeRun]).toEqual([3, false]);
    expect(Number.isFinite(R(() => runScore(before, 'hq', {})))).toBe(true);
  });

  it.fails('at the prompt, HQ is priced finite as it was before the play', () => {
    expect(Number.isFinite(R(() => runScore(jailbreak().after, 'hq', {})))).toBe(true);
  });
});

describe('R-14m, the Manegarm Skunkworks prompt weighs the server at the credits before paying', () => {
  // O1b red team finding 9 (src/ai/prompts.ts, the Manegarm block): remote-9 has no ice; its root holds Manegarm
  // Skunkworks and a rezzed Regolith Mining License (trash cost 3), both rezzed. The Runner starts with 2 clicks, so at
  // the approach (1 click left) the toll can only be paid with 5 credits. At 7 credits paying leaves 2: neither Regolith
  // nor Manegarm (trash 3 each) can then be trashed, so the access buys nothing and the right answer is "end". Today the
  // server is weighed at 7 credits and the Runner pays. Twin: at 8 credits paying leaves 3, the trash is paid, and "pay"
  // is right (today: pay).
  const toToll = (credits: number): GameState => {
    const s = newGame();
    installCorpForTest(s, MANEGARM, 'remote-9', true);
    installCorpForTest(s, REGOLITH, 'remote-9', true);
    startRunnerTurn(s);
    s.runner.clicks = 2;
    s.runner.credits = credits;
    const g = new GameRunner(executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote-9' }), { runner: createAgent('runner', 'normal'), corp: createAgent('corp', 'normal') });
    for (let k = 0; k < 20; k++) {
      const p = activePrompt(g.state);
      if (p && 'source' in p && p.source.cardCode === MANEGARM) return g.state;
      g.step();
    }
    throw new Error('no Manegarm prompt');
  };

  it('setup: the toll prompt at 1 click and 7 credits offers pay or end, Regolith rezzed in the root', () => {
    const s = toToll(7);
    const p = activePrompt(s)!;
    expect(p.kind === 'effect_choice' && p.options.map(o => o.id)).toEqual(['pay', 'end']);
    expect([s.runner.clicks, s.runner.credits]).toEqual([1, 7]);
    expect(titles(s.corp.servers['remote-9'].root)).toEqual([['Manegarm Skunkworks', true], ['Regolith Mining License', true]]);
  });

  it.fails('at 7 credits the Runner does not pay 5 to reach cards it then cannot trash', () => {
    expect(runnerAnswer(toToll(7))).not.toBe('pay');
  });

  it('twin: at 8 credits the Runner pays (3 left trashes Regolith)', () => {
    expect(runnerAnswer(toToll(8))).toBe('pay');
  });
});

describe('R-73, Ballista\'s "Trash 1 installed program or end the run" is the Corp\'s choice', () => {
  // Found row 72 a and b; tracker R-73. Rule 1.14.5: the Corp, the ice's controller, makes the choices of its
  // subroutines, so "trash a program or end the run" can always end the run. iceCreditNeed (src/ai/runs.ts) reads it as
  // ending the run only when the Runner has no programs.
  const fixture = (name: string): GameState => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
  const ballista = (s: GameState, programs: boolean) => {
    const b = structuredClone(s);
    const ice = b.corp.servers[b.activeRun!.server].ice[b.activeRun!.icePosition!];
    ice.isRezzed = true;
    if (!programs) b.runner.rig.programs = [];
    return R(() => iceCreditNeed(b, ice));
  };

  // Deal 1641 T18 (the rez-set fixture: the approach of an unrezzed Ballista on remote-1, Send a Message in the root; the
  // Runner has six programs, none a killer). Priced as rezzed, Ballista stops the run unless broken: the need is more
  // than 0 (BLOCK here, no sentry breaker). Today it reads 0 with programs installed and BLOCK without.
  it('deal 1641 T18 setup: Ballista approached on remote-1, an agenda in the root, programs installed', () => {
    const s = fixture('rez-set/deal-1641-t18-inst-42');
    const ice = s.corp.servers[s.activeRun!.server].ice[s.activeRun!.icePosition!];
    expect(cardDef(ice).title).toBe('Ballista');
    expect(s.corp.servers['remote-1'].root.some(c => cardDef(c).type_code === 'agenda')).toBe(true);
    expect(s.runner.rig.programs.length).toBeGreaterThan(0);
    expect(ballista(s, false)).toBeGreaterThan(0);
  });

  it.fails('deal 1641 T18: with programs installed, Ballista still needs breaking to get past', () => {
    expect(ballista(fixture('rez-set/deal-1641-t18-inst-42'), true)).toBeGreaterThan(0);
  });

  it.fails('deal 1601 T6: with programs installed, Ballista still needs breaking to get past', () => {
    expect(ballista(fixture('run-answers/deal-1601-t6-30062'), true)).toBeGreaterThan(0);
  });

  // Found row 72 b: at deal 1601 T6's Ballista prompt (Offworld Office in the root) the Corp once trashed a program and
  // the agenda was stolen. Since the run term (V-C item 1) the Corp ends the run: a guard.
  it('deal 1601 T6 guard: at Ballista\'s prompt with Offworld Office in the root, the Corp ends the run', () => {
    const s = fixture('run-answers/deal-1601-t6-30062');
    expect(s.corp.servers['remote-1'].root.map(c => cardDef(c).title)).toContain('Offworld Office');
    const a = createAgent('corp', 'normal').chooseAction(structuredClone(s));
    expect(a.type === 'RESOLVE_PROMPT' && a.choice.kind === 'effect_choice' && a.choice.optionId).toBe('end');
  });
});

// ------------------------------------------------------------------------------------------------ R-119: deal 1481
describe('R-119, deal 1481: three cheap HQ runs a turn for nothing', () => {
  // g3 deal 1481 (Hyper Velocity vs Professional Opportunities, seed 1481), as the B4b tree 952acd6 played it
  // (runner-rework/b4c/b4b-g3-fruitless-trace.md): on T4 and on T5 the Runner ran an unguarded HQ three times, accessing
  // one card a run, no agenda there; the third T5 run was priced 0.033 x 0.25. The fixture is that game's moves to the
  // start of the Runner's T6 (tests/fixtures/runner-rc1/deal-1481-b4b.json); each board is the saved game replayed to the
  // start of the Runner's turn with a Normal Runner that watched every board, then today's agents play the turn. The
  // pin: fewer than three HQ runs on the turn (the walk's click value, R-C1 V6, answers whether the third is worth a
  // click). On 0b9d44a the game from the seed differs (B4c), so the fixture keeps B4b's boards.
  const at = (key: 't4' | 't5') => {
    const r = savedGame('runner-rc1/deal-1481-b4b.json') as Saved & { starts: Record<string, number> };
    return replayTo('runner-rc1/deal-1481-b4b.json', (_s, _m, i) => i === r.starts[key]);
  };

  it('setup: at the start of the Runner\'s T4 and T5, HQ has no ice and holds no agenda', () => {
    for (const [key, turn] of [['t4', 4], ['t5', 5]] as const) {
      const { state } = at(key);
      expect([state.turnNumber, state.activePlayer, state.runner.clicks]).toEqual([turn, 'runner', 4]);
      expect(state.corp.servers.hq.ice).toEqual([]);
      expect(state.corp.hq.some(c => cardDef(c).type_code === 'agenda')).toBe(false);
    }
  });

  for (const key of ['t4', 't5'] as const) {
    it.fails(`deal 1481 ${key.toUpperCase()}: the Runner makes fewer than three HQ runs`, { timeout: 60_000 }, () => {
      const { state, runner } = at(key);
      expect(playTurn(state, runner).runs.filter(r => r.server === 'hq').length).toBeLessThan(3);
    });
  }
});

