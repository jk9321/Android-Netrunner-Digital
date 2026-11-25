/**
 * Runner AI price fixes (branch ai-runner-fixes; Runner audit 2026-11-14, /mnt/project-files/audits/2026-11-14-ai-runner/,
 * findings merged with Gemini's): each pin is one of report.md's guards or one of the merged report's bugs.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CardInstance, GameAction, GameState, activePrompt, cardDef, createCardInstance, createInitialGameState, executeAction, findCardAnywhere } from '../src/core';
import { HeuristicRunnerAI, createAgent } from '../src/ai';
import { BLOCK, bestBreakPlan, breachAccesses, icePrice, isTrap, runRestWorth, runScore, serverValue, subroutineCost, tagCost, tankDamage, trapDamageMax, trapHit, unrezzedDamageRisk } from '../src/ai/runs';
import { GameRunner } from '../src/ai/playout';
import { CARDS } from '../src/ai/cards';
import { deckGameSetup } from '../src/data/decks';
import { accessDamage, damageWorth } from '../src/ai/effectValues';
import { CLICK, cardRate } from '../src/ai/valueModel';
import { scoreOutcome, simulate } from '../src/ai/prompts';
import { runnerDecisionView } from '../src/ai/turnPlanner';
import { asSide } from '../src/ai/synergy';
import { corpCardValue } from '../src/ai/evaluate';
import { creditCost } from '../src/ai/runs';
import { turnsLeft } from '../src/ai/cardProfiles';
import { trashCost } from '../src/core/engine/cardEffects';
import { answer, cont, installCorpForTest, installIceForTest, installProgramForTest, newGame, run, runIntoFirstIce, startRunnerTurn } from './helpers';

const TITHE = '30073';
const REGOLITH = '30071';
const DEVADATTA = '35031';
const EMPIRICIST = '35052';
const DOOMSCROLL = '35063';
const PALISADE_CODE = '30072';
const CARMEN = '30015'; // killer, strength 2: 2 credits for +3, 1 credit breaks 1 sentry subroutine
const total = (p: { credits: number; value: number }) => p.credits + p.value;

function bareRemote(state: GameState, card: CardInstance): void {
  state.corp.servers['remote-1'] = { id: 'remote-1', name: 'Server 1', isRemote: true, ice: [], root: [card] };
}

describe('R2 damage (rules 10.4.4, 5.2.7c)', () => {
  it('damage equal to the grip is survived; one more is a flatline (10.4.4: "more damage than the number of cards in their grip")', () => {
    const s = newGame();
    startRunnerTurn(s);
    s.runner.grip = s.runner.grip.slice(0, 2);
    expect(subroutineCost(s, 'Do 2 net damage.')).toBeLessThan(BLOCK);
    expect(subroutineCost(s, 'Do 3 net damage.')).toBe(BLOCK);
    expect(subroutineCost(s, 'End the run unless the Runner suffers 2 net damage.')).toBeLessThan(BLOCK);
  });
  const inRun = (grip: number, clicks: number) => {
    const s = newGame();
    startRunnerTurn(s);
    s.runner.grip = s.runner.grip.slice(0, grip);
    const run = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'hq' } as GameAction);
    return { ...run, runner: { ...run.runner, clicks } };
  };
  it("damage taken in the Runner's own run is read with the clicks left to draw back (5.2.7c): a card, not a step toward a flatline", () => {
    const s = inRun(1, 3);
    // 1 card left: without draw-back the damage empties the grip; with it, a click draws the card back
    expect(damageWorth(s, 1, true)).toBeLessThan(damageWorth(s, 1));
    expect(damageWorth(s, 1, true)).toBeCloseTo(CLICK, 6);
    // No click left after the run: no draw-back, the flatline step counts again
    expect(damageWorth(inRun(1, 0), 1, true)).toBe(damageWorth(inRun(1, 0), 1));
  });
  it('a full grip does not make damage free: the clicks that draw back are paid (CLICK each), or the card is lost', () => {
    const s = inRun(5, 3);
    expect(damageWorth(s, 2, true)).toBeGreaterThanOrEqual(Math.min(2 * CLICK, 2 * cardRate(s, 'runner')) - 1e-9);
    expect(damageWorth(s, 2, true)).toBeLessThanOrEqual(damageWorth(s, 2));
  });
  it("only the Runner's own pricing of its run reads the draw-back: the Corp's view of the same subroutine does not", () => {
    const s = inRun(1, 3);
    const runner = asSide('runner', () => subroutineCost(s, 'Do 1 net damage.'));
    const corp = asSide('corp', () => subroutineCost(s, 'Do 1 net damage.'));
    expect(runner).toBeCloseTo(CLICK, 6);
    expect(corp).toBe(damageWorth(s, 1));
    expect(corp).toBeGreaterThan(runner);
  });
  it('a 6-card HQ behind a rezzed Tithe is worth running at ordinary credits (the audit probe: -Infinity at 0-5 credits)', () => {
    for (const credits of [0, 3, 5]) {
      const s = newGame();
      startRunnerTurn(s);
      installIceForTest(s, TITHE, 'hq');
      while (s.corp.hq.length < 6 && s.corp.rd.length) s.corp.hq.push(s.corp.rd.shift()!);
      s.runner.credits = credits;
      expect(runScore(s, 'hq')).toBeGreaterThan(-Infinity);
    }
  });
  it('the run choice reads the draw-back too: the 6-card HQ behind Tithe is worth running (RM-DRAWBACK-RUN-START, rule 5.2.7c)', () => {
    // Audit 2026-11-15 probe: before, Tithe's 1 net priced 7.2 when choosing the run (runScore -5.6 at 5 credits, -5.3 at
    // 20) against 1.25 once in it; the choice now reads the 3 clicks left after the run's own click
    for (const credits of [5, 20]) {
      const s = newGame();
      startRunnerTurn(s);
      installIceForTest(s, TITHE, 'hq');
      while (s.corp.hq.length < 6 && s.corp.rd.length) s.corp.hq.push(s.corp.rd.shift()!);
      s.runner.credits = credits;
      const out = asSide('runner', () => ({ sub: subroutineCost(s, 'Do 1 net damage.'), score: runScore(s, 'hq') }));
      expect(out.sub).toBeCloseTo(CLICK, 6);
      expect(out.score).toBeGreaterThan(0);
    }
  });
});

describe('R1 credits apart from value (RUNNER-BUDGET-UNITS)', () => {
  it('a tanked subroutine costs no credits: a broke Runner can still run through it', () => {
    const s = newGame();
    startRunnerTurn(s);
    installIceForTest(s, TITHE, 'hq');
    s.runner.credits = 0;
    const price = icePrice(s, s.corp.servers.hq.ice[0]);
    expect(price.credits).toBe(0);
    expect(price.value).toBeGreaterThan(0);
  });
  it("a bioroid's click-break is priced only with the clicks left to pay it (rule 1.16.1: a cost that can't be paid in full can't be used)", () => {
    const priceAt = (clicks: number) => {
      const s = newGame();
      startRunnerTurn(s);
      s.runner.rig.programs = [];
      const bran = createCardInstance(s, '30039'); // Brân 1.0: Barrier - Bioroid, 3 subroutines, a click each to break
      bran.isRezzed = true;
      s.corp.servers.hq.ice = [bran];
      s.runner.clicks = clicks;
      return icePrice(s, bran);
    };
    // 4 clicks: the run's own click and 3 to break
    expect(priceAt(4)).toEqual({ credits: 0, value: 4.5 });
    // 3 clicks: after the run's click only 2 are left for 3 subroutines, and no breaker: no way past
    expect(priceAt(3).credits + priceAt(3).value).toBe(BLOCK);
  });
  // Jeff's Teia game (report-28, turn 8; fixture vrcation-sure-gamble.json): 5 credits, 3 clicks, 4 cards. Remote-2 holds an
  // unseen card with 3 advancements, The Holo Man and Adrian Seis, behind a rezzed Empiricist (draw; 1 net damage and a tag;
  // 2 net damage; no end the run). Taking every subroutine costs no credits and leaves 1 card (rule 10.4.4: 3 damage
  // against 4 cards is survived). Counted as credits, the 23 of damage was over the 5-credit budget and the run was barred.
  // But the deck holds 2 Fujii Asset Retrieval ("When this agenda is scored or stolen, do 2 net damage"): an accessed agenda
  // must be stolen (1.17.3d), and 2 net damage on the 1 card left flatlines (10.4.4), so the run is not worth making
  const teia = (): GameState => JSON.parse(readFileSync(new URL('./fixtures/vrcation-sure-gamble.json', import.meta.url), 'utf8'));
  it('a 3-advanced remote behind ice that cannot end the run: no credits to pass, and a Fujii steal at 1 card is charged its flatline share', () => {
    const s = teia();
    asSide('runner', () => {
      const price = icePrice(s, s.corp.servers['remote-2'].ice[0]);
      expect(price.credits).toBe(0);
      expect(price.value).toBeCloseTo(subroutineCost(s, 'Draw 1 card.') + subroutineCost(s, 'Do 1 net damage. Give the Runner 1 tag.') + subroutineCost(s, 'Do 2 net damage.'));
      expect(price.damage).toBe(3);
      // The steal at the 1 card left is charged its flatline share: 2 of the 8 agendas still to find are Fujii. Since the
      // run choice reads the draw-back (RM-DRAWBACK-RUN-START: 2 clicks left after the run's own), the ice's 3 damage costs
      // its cards less the clicks, and the run is no longer below zero as dealt; it stays well below the run with no
      // Fujii in the deck, by the flatline share
      const noFujii = structuredClone(s);
      const strip = (zone: CardInstance[]) => zone.filter(c => c.cardCode !== '34040');
      noFujii.corp.hq = strip(noFujii.corp.hq);
      noFujii.corp.rd = strip(noFujii.corp.rd);
      noFujii.corp.archives.faceDown = strip(noFujii.corp.archives.faceDown);
      expect(serverValue(s, 'remote-2', 0, undefined, true, undefined, 1)).toBeLessThan(serverValue(s, 'remote-2', 0, undefined, true, undefined, 4) - 10);
      expect(runScore(s, 'remote-2', { wary: true })).toBeLessThan(runScore(noFujii, 'remote-2', { wary: true }) - 10);
    });
  });
  it('the same run is worth making with a grip that survives the steal, or with no Fujii left in the deck', () => {
    const bigger = teia();
    for (let i = 0; i < 2; i++) bigger.runner.grip.push(bigger.runner.stack.shift()!);
    expect(asSide('runner', () => runScore(bigger, 'remote-2', { wary: true }))).toBeGreaterThan(0);
    const noFujii = teia();
    const strip = (zone: CardInstance[]) => zone.filter(c => c.cardCode !== '34040');
    noFujii.corp.hq = strip(noFujii.corp.hq);
    noFujii.corp.rd = strip(noFujii.corp.rd);
    noFujii.corp.archives.faceDown = strip(noFujii.corp.archives.faceDown);
    expect(asSide('runner', () => runScore(noFujii, 'remote-2', { wary: true }))).toBeGreaterThan(0);
  });
});

describe('R3 bare economy assets (RUNNER-ASSET-TRASH)', () => {
  it('a fresh Regolith (15 credits) alone on a remote is worth running and trashing when the Runner can pay', () => {
    for (const credits of [3, 5, 10]) {
      const s = newGame();
      startRunnerTurn(s);
      s.runner.credits = credits;
      const c = createCardInstance(s, REGOLITH);
      c.isRezzed = true;
      c.tokens = { credit: 15 };
      bareRemote(s, c);
      expect(serverValue(s, 'remote-1')).toBeGreaterThan(0.5);
      expect(runScore(s, 'remote-1')).toBeGreaterThan(0);
    }
  });
  it('a Regolith with 15 credits left is worth more to trash than one with 6', () => {
    const at = (load: number) => {
      const s = newGame();
      startRunnerTurn(s);
      s.runner.credits = 10;
      const c = createCardInstance(s, REGOLITH);
      c.isRezzed = true;
      c.tokens = { credit: load };
      bareRemote(s, c);
      return serverValue(s, 'remote-1');
    };
    expect(at(15)).toBeGreaterThan(at(6));
  });
});

// Brief O1a (tracker R-14b; issue #67): the fixed 0.5 that `serverWorth` credited a rezzed root card worth less than its
// trash is gone. A trash is the Runner's choice (rules 1.19.2, 7.1.5), so a card under water adds nothing to the run.
// Red team 2026-11-25 findings 1, 2 and 5: the boards are on the Runner's own view, the condition is asserted from the
// board first, and the two input faults the floor was hiding are pinned as known failures beside a twin that passes.
const SPIN_DOCTOR = '30053';
const MALAPERT = '30066';
const HOLO_MAN = '34120';
const MAHKOTA = '35082';
const rezzedCard = (s: GameState, code: string, tokens?: Record<string, number>) => {
  const c = createCardInstance(s, code);
  c.isRezzed = true;
  if (tokens) c.tokens = tokens;
  return c;
};
const remoteOf = (s: GameState, cards: CardInstance[]) => {
  s.corp.servers['remote-1'] = { id: 'remote-1', name: 'Server 1', isRemote: true, ice: [], root: cards };
};
const leftWorth = (view: GameState, id: string) => {
  const card = view.corp.servers['remote-1'].root.find(c => c.instanceId === id)!;
  return asSide('runner', () => corpCardValue(card, view, 'runner', true));
};

describe('O1a a rezzed root card worth less than its trash adds nothing to the run (rules 1.19.2, 7.1.5)', () => {
  for (const [name, code] of [
    ['a rezzed Spin Doctor with Archives empty', SPIN_DOCTOR],
    ['a rezzed Malapert Data Vault', MALAPERT],
  ] as const) {
    it(`${name} alone in a bare remote: serverValue 0 and runScore at or below 0, at 3, 6 and 10 credits`, () => {
      for (const credits of [3, 6, 10]) {
        const s = newGame();
        startRunnerTurn(s);
        s.runner.credits = credits;
        s.corp.archives.faceUp = [];
        s.corp.archives.faceDown = [];
        const card = rezzedCard(s, code);
        remoteOf(s, [card]);
        const view = runnerDecisionView(s);
        const trash = cardDef(card).trash_cost!;
        // Under water on this board: the worth as left is less than what the trash costs the Runner
        expect(leftWorth(view, card.instanceId)).toBeLessThan(asSide('runner', () => creditCost(view, trash)));
        expect(asSide('runner', () => serverValue(view, 'remote-1'))).toBe(0);
        expect(asSide('runner', () => runScore(view, 'remote-1'))).toBeLessThanOrEqual(0);
      }
    });
  }
  it('twin: a Regolith with 15 hosted is above its trash on the same view and still worth the run', () => {
    for (const credits of [3, 6, 10]) {
      const s = newGame();
      startRunnerTurn(s);
      s.runner.credits = credits;
      const card = rezzedCard(s, REGOLITH, { credit: 15 });
      remoteOf(s, [card]);
      const view = runnerDecisionView(s);
      expect(leftWorth(view, card.instanceId)).toBeGreaterThan(asSide('runner', () => creditCost(view, cardDef(card).trash_cost!)));
      expect(asSide('runner', () => serverValue(view, 'remote-1'))).toBeGreaterThan(0);
      expect(asSide('runner', () => runScore(view, 'remote-1'))).toBeGreaterThan(0);
    }
  });

  // Red team finding 1, tracker R-10h (a card-entry fault, the Corp side's read): The Holo Man's text is once a turn
  // for the rest of the game, but its entry (src/ai/cards/liberation.ts '34120') prices one use on every board
  // Turns left are guessed from the score (cardProfiles.ts turnsLeft): a fresh game against one at 6 points
  const turnsBoard = (code: string, tokens: Record<string, number> | undefined, corpScore: number) => {
    const s = newGame();
    startRunnerTurn(s);
    s.runner.credits = 6;
    s.corp.score = corpScore;
    const card = rezzedCard(s, code, tokens);
    remoteOf(s, [card]);
    const view = runnerDecisionView(s);
    return { view, card };
  };
  // The input the pin reads differs between the two boards; Holo Man's worth as left is priced today, the same on both
  it('twin: the two boards differ in turns left, and The Holo Man has a worth as left on each', () => {
    const many = turnsBoard(HOLO_MAN, undefined, 0);
    const one = turnsBoard(HOLO_MAN, undefined, 6);
    expect(turnsLeft(many.view)).toBeGreaterThan(turnsLeft(one.view));
    expect(leftWorth(many.view, many.card.instanceId)).toBeGreaterThan(0);
    expect(leftWorth(one.view, one.card.instanceId)).toBeGreaterThan(0);
  });
  it.fails('R-10h: The Holo Man rezzed in a remote is worth more left with many turns left than with one turn left', () => {
    const many = turnsBoard(HOLO_MAN, undefined, 0);
    const one = turnsBoard(HOLO_MAN, undefined, 6);
    expect(turnsLeft(many.view)).toBeGreaterThan(turnsLeft(one.view));
    expect(leftWorth(many.view, many.card.instanceId)).toBeGreaterThan(leftWorth(one.view, one.card.instanceId));
  });

  // Red team finding 2 (b), tracker R-14g: the engine's trash cost of an asset beside a rezzed Mahkota Langit Grid is 2
  // more (its Persistent text; src/core/engine/cardEffects.ts trashCost), but serverWorth reads the printed cost, so it
  // prices a Regolith trash the Runner cannot pay
  const mahkotaBoard = (credits: number) => {
    const s = newGame();
    startRunnerTurn(s);
    s.runner.credits = credits;
    const mahkota = rezzedCard(s, MAHKOTA, { credit: 2 });
    const regolith = rezzedCard(s, REGOLITH, { credit: 15 });
    remoteOf(s, [mahkota, regolith]);
    const view = runnerDecisionView(s);
    const engineTrash = trashCost(view, view.corp.servers['remote-1'].root.find(c => c.instanceId === regolith.instanceId)!)!;
    return { view, engineTrash, credits };
  };
  it('twin: beside Mahkota with the engine trash cost payable (6 credits), the server is worth running', () => {
    const { view, engineTrash, credits } = mahkotaBoard(6);
    expect(engineTrash).toBeLessThanOrEqual(credits);
    expect(asSide('runner', () => serverValue(view, 'remote-1'))).toBeGreaterThan(0);
  });
  it('R-14g: beside Mahkota with 3 credits the Regolith trash (engine cost above the credits) is not in the server\'s worth', () => {
    const { view, engineTrash, credits } = mahkotaBoard(3);
    expect(engineTrash).toBeGreaterThan(credits);
    // Mahkota itself is under water (finding 2 a), so with no trash payable the server holds nothing
    expect(asSide('runner', () => serverValue(view, 'remote-1'))).toBe(0);
  });
});

// Brief O1b rev 2 (tracker R-14f; issue #58): the price of a trash reads what the trash gives the Runner, a run fact in the
// card's entry (Public Access Plaza: "Threat 2 -> When the Runner trashes this asset (while it is rezzed), give them 1
// tag", src/core/scripts/elevation/corp/assets.ts), priced by tagCost on the board after the trash is paid (red team
// second pass S1). Rules 1.19.2 and 7.1.5: a trash is the Runner's choice, so the term is never below 0. Every Plaza board
// asserts first that a tag costs this Runner something (S2: on a bare starter rig tagCost is 0 and the boards would pass
// with the fact absent). The boards are #58's saved game (tests/fixtures/runner-facts/issues/issue-58.json) at the
// Runner's first run of a turn, the Plaza alone in a bare remote, on the Runner's own view.
const PLAZA = '35062';
interface Saved58 { config: { seed: number; corpDeck: never; runnerDeck: never }; startStops?: GameState['stops']; moves: GameAction[] }
const saved58: Saved58 = JSON.parse(readFileSync(new URL('./fixtures/runner-facts/issues/issue-58.json', import.meta.url), 'utf8'));
/** #58's board at the Runner's first run of `turn` (a structuredClone, editable), with `edit` applied before the view. */
function plaza58(turn: number, edit?: (s: GameState) => void) {
  let s = createInitialGameState(deckGameSetup(saved58.config.seed, saved58.config.corpDeck, saved58.config.runnerDeck));
  if (saved58.startStops) s = { ...s, stops: saved58.startStops };
  for (const move of saved58.moves) {
    if (s.turnNumber === turn && s.activePlayer === 'runner' && move.type === 'INITIATE_RUN') {
      const state = structuredClone(s);
      edit?.(state);
      const view = runnerDecisionView(state);
      const server = Object.values(view.corp.servers).find(v => v.root.some(c => c.cardCode === PLAZA))!;
      const card = server.root.find(c => c.cardCode === PLAZA)!;
      const terms = asSide('runner', () => {
        const worth = corpCardValue(card, view, 'runner', true) - creditCost(view, trashCost(view, card)!);
        const paid = { ...view, runner: { ...view.runner, credits: view.runner.credits - trashCost(view, card)! } };
        return { worth, tag: tagCost(view), tagPaid: tagCost(paid), value: serverValue(view, server.id) };
      });
      return { state, view, server, card, ...terms, threat: Math.max(view.corp.score, view.runner.score) };
    }
    s = executeAction(s, move);
  }
  throw new Error(`issue 58: no Runner run in turn ${turn}`);
}
/** The Plaza accessed for real: the run on its server played on a clone of `state` by GameRunner (Normal agents) to the
 * access_trash prompt; the Runner's answer, or null if the run never reaches it. */
function forcedAccess(state: GameState, serverId: string): boolean | null {
  const start = executeAction(structuredClone(state), { type: 'INITIATE_RUN', player: 'runner', targetServerId: serverId } as GameAction);
  const g = new GameRunner(start, { runner: createAgent('runner', 'normal'), corp: createAgent('corp', 'normal') });
  for (let i = 0; i < 200 && g.state.activeRun && activePrompt(g.state)?.kind !== 'access_trash'; i++) g.step();
  const p = activePrompt(g.state);
  if (p?.kind !== 'access_trash') return null;
  g.step();
  const a = g.last;
  return a?.type === 'RESOLVE_PROMPT' && a.choice.kind === 'access_trash' ? a.choice.trash : null;
}
/** The board is the brief's: the Plaza rezzed, alone in a remote with no ice, and a tag costs this Runner something. */
function plazaBoard(b: ReturnType<typeof plaza58>, threatAtLeast: number) {
  expect(b.card.isRezzed).toBe(true);
  expect(b.server.ice.length).toBe(0);
  expect(b.server.root.length).toBe(1);
  expect(b.threat).toBeGreaterThanOrEqual(threatAtLeast);
  expect(b.tag).toBeGreaterThan(0);
}

describe('O1b the price of a trash holds the tag the trash gives (tracker R-14f, issue #58)', () => {
  it("the fact is the card's text, read the way the engine reads it: a trashed Plaza gives a tag only rezzed and at threat 2", () => {
    const fact = CARDS[PLAZA].runFacts?.trashedByRunner;
    expect(fact).toEqual({ tags: 1, when: { threatAtLeast: 2 }, rezzed: true });
    // The engine: a Plaza in a bare remote, accessed and trashed (the access played, the trash paid), the tags it leaves
    const engineTags = (rezzed: boolean, threat: number) => {
      const s = newGame();
      s.corp.score = threat;
      const id = installCorpForTest(s, PLAZA, 'remote1', rezzed);
      startRunnerTurn(s);
      s.runner.credits = 10;
      const x = cont(run(s, 'remote1'));
      expect(activePrompt(x)).toMatchObject({ kind: 'access_trash', cardInstanceId: id });
      expect(findCardAnywhere(x, id)?.isRezzed ?? false).toBe(rezzed);
      const before = x.runner.tags;
      const after = answer(x, { kind: 'access_trash', trash: true });
      expect(after.corp.servers.remote1?.root.some(c => c.instanceId === id) ?? false).toBe(false);
      return after.runner.tags - before;
    };
    const factTags = (rezzed: boolean, threat: number) => (fact && (!fact.rezzed || rezzed) && threat >= (fact.when?.threatAtLeast ?? 0) ? fact.tags : 0);
    for (const [rezzed, threat] of [[true, 2], [true, 1], [false, 2]] as const) expect(factTags(rezzed, threat)).toBe(engineTags(rezzed, threat));
    expect(engineTags(true, 2)).toBe(1);
  });

  it("under the tag: the worth as left less the trash is below the tag's price, so the server holds nothing (#58 T3)", () => {
    const b = plaza58(3);
    plazaBoard(b, 2);
    expect(b.worth).toBeGreaterThan(0);
    expect(b.worth).toBeLessThan(b.tagPaid);
    expect(b.value).toBe(0);
  });

  it('above the tag: the server is worth the trash less the tag, not 0 and not the trash in full (#58 T6)', () => {
    const b = plaza58(6);
    plazaBoard(b, 2);
    expect(b.worth).toBeGreaterThan(b.tagPaid);
    expect(b.value).toBeCloseTo(b.worth - b.tagPaid, 6);
    expect(b.value).toBeGreaterThan(0);
    expect(b.value).toBeLessThan(b.worth);
  });

  it('at the trash cost plus 1 the tag is priced after the trash is paid (S1): the board left cannot clear it this turn', () => {
    const b = plaza58(6, s => {
      s.runner.credits = 3;
    });
    plazaBoard(b, 2);
    // The two readings differ on this board: 2 credits for the trash leave 1, short of the 2 that clear a tag
    expect(b.tagPaid).toBeGreaterThan(b.tag);
    // Priced before the trash it would add something; priced after, it does not
    expect(b.worth - b.tag).toBeGreaterThan(0);
    expect(b.worth - b.tagPaid).toBeLessThan(0);
    expect(b.value).toBe(0);
  });

  it('twin below threat 2: no tag, the server holds the trash in full', () => {
    const b = plaza58(6, s => {
      s.corp.score = Math.min(s.corp.score, 1);
      s.runner.score = Math.min(s.runner.score, 1);
    });
    plazaBoard(b, 0);
    expect(b.threat).toBeLessThan(2);
    expect(b.worth).toBeGreaterThan(0);
    expect(b.value).toBeCloseTo(b.worth, 6);
  });

  // The Corp side's step 0.6: the Corp can rez a seen, unrezzed Plaza in the window before the access, and its credits and
  // the rez cost are public, so whether the price holds the tag there is ruled from the count, not asserted here
  it.todo('a seen, unrezzed Plaza at threat 2: tag or no tag in the price (ruled from step 0.6)');

  it("#58 T3: the price's Plaza term is 0 and the access, forced on a clone, is declined: the two agree", { timeout: 60_000 }, () => {
    const b = plaza58(3);
    plazaBoard(b, 2);
    expect(b.value).toBe(0);
    expect(forcedAccess(b.state, b.server.id)).toBe(false);
  });

  it('#58 T6 setup: the Plaza rezzed alone at threat 2, a tag costs the Runner something, and the forced access reaches the trash', { timeout: 60_000 }, () => {
    const b = plaza58(6);
    plazaBoard(b, 2);
    expect(forcedAccess(b.state, b.server.id)).not.toBeNull();
  });

  // Known failure (tracker R-14f with the Corp side's F108): the price prices the trash at about +0.75 while the access
  // decision declines it, reading the tag several times; it turns when the decision reads a tag once
  it.fails("#58 T6: the sign of the price's Plaza term is the forced access's answer", { timeout: 60_000 }, () => {
    const b = plaza58(6);
    expect(b.value > 0).toBe(forcedAccess(b.state, b.server.id));
  });
});

describe('R4 breach-time extra accesses (RUNNER-BREACH-EXTRA-ACCESS; rules 7.3.5b, 7.4.7)', () => {
  it('a charged Devadatta Drone moves runScore on R&D and nowhere else', () => {
    const s = newGame();
    startRunnerTurn(s);
    s.runner.credits = 5;
    const before = { rd: runScore(s, 'rd'), hq: runScore(s, 'hq') };
    installProgramForTest(s, DEVADATTA);
    const drone = s.runner.rig.programs.find(p => p.cardCode === DEVADATTA)!;
    drone.tokens = { ...drone.tokens, power: 2 };
    expect(breachAccesses(s, 'rd').accesses).toBe(1);
    expect(breachAccesses(s, 'hq').accesses).toBe(0);
    expect(runScore(s, 'rd')).toBeGreaterThan(before.rd);
    expect(runScore(s, 'hq')).toBe(before.hq);
  });
  it('runRestWorth counts the run\'s extraAccesses', () => {
    const s = newGame();
    startRunnerTurn(s);
    const run = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'rd' } as GameAction);
    const more = { ...run, activeRun: { ...run.activeRun!, extraAccesses: run.activeRun!.extraAccesses + 1 } };
    expect(runRestWorth(more)).toBeGreaterThan(runRestWorth(run));
  });
  it("Jeff's game #54 (report-54, move 145): on its Overclock R&D breach the Runner uses the Drone", () => {
    const s = JSON.parse(readFileSync(new URL('./fixtures/report-54-drone.json', import.meta.url), 'utf8')) as GameState;
    const prompt = activePrompt(s)!;
    expect(prompt.side).toBe('runner');
    const pick = createAgent('runner').chooseAction(structuredClone(s));
    expect(pick).toMatchObject({ type: 'RESOLVE_PROMPT', choice: { kind: 'effect_choice', optionId: 'use' } });
  });
  it('scoreOutcome counts the rest of the run in full once the breach has begun (6.9.5b), 0.8 of it while ice is ahead', () => {
    const s = JSON.parse(readFileSync(new URL('./fixtures/report-54-drone.json', import.meta.url), 'utf8')) as GameState;
    const prompt = activePrompt(s)!;
    const use = executeAction(structuredClone(s), { type: 'RESOLVE_PROMPT', player: 'runner', promptId: prompt.id, choice: { kind: 'effect_choice', optionId: 'use' } } as GameAction);
    const atBreach = asSide('runner', () => scoreOutcome(s, use, 'runner'));
    const earlier = { ...s, activeRun: { ...s.activeRun!, phase: 'movement' as const } };
    const beforeIce = asSide('runner', () => scoreOutcome(earlier, use, 'runner'));
    const rest = asSide('runner', () => runRestWorth(use));
    expect(rest).toBeGreaterThan(0);
    expect(atBreach - beforeIce).toBeCloseTo(0.2 * rest, 6);
  });
});

describe('the rest of the run once the breach has begun (rules 7.3.4, 7.3.5)', () => {
  const anoetic = () => JSON.parse(readFileSync(new URL('./fixtures/report-26-anoetic.json', import.meta.url), 'utf8')) as GameState;
  it("Jeff's game #26 (move 65): Anoetic Void for 1 credit is trashed", () => {
    const s = anoetic();
    const prompt = activePrompt(s)!;
    expect(prompt.kind).toBe('access_trash');
    const pick = createAgent('runner').chooseAction(structuredClone(s));
    expect(pick).toMatchObject({ type: 'RESOLVE_PROMPT', choice: { kind: 'access_trash', trash: true } });
  });
  it('the card a trash prompt is about is not in the rest of the run, trashed or not', () => {
    const s = anoetic();
    const prompt = activePrompt(s)!;
    const answer = (trash: boolean) => executeAction(structuredClone(s), { type: 'RESOLVE_PROMPT', player: 'runner', promptId: prompt.id, choice: { kind: 'access_trash', trash } } as GameAction);
    const left = answer(false);
    // Left in the root, the accessed card is no longer a candidate: the rest of the run does not price trashing it again
    expect(asSide('runner', () => runRestWorth(left))).toBeCloseTo(asSide('runner', () => runRestWorth(answer(true))), 6);
  });
  it('the Drone prompt (report-54 move 145) comes before the breach: no card is left out there', () => {
    const s = JSON.parse(readFileSync(new URL('./fixtures/report-54-drone.json', import.meta.url), 'utf8')) as GameState;
    // Breach abilities resolve before the breach begins (6.9.5b, 7.3.5b): the pin above ("use") reads the whole server
    expect(s.activeRun!.breached).toBe(false);
    expect(s.activeRun!.breach).toBeUndefined();
  });
});

describe('break plans keep counters out of credits (AI-RUNNER-NONCREDIT-BREAK-COST)', () => {
  it('BreakPlan.credits is real credits; counters and discards are value', () => {
    const s = newGame();
    startRunnerTurn(s);
    installIceForTest(s, '30072', 'hq'); // Palisade
    installProgramForTest(s, '30006'); // a barrier breaker
    const plan = bestBreakPlan(s, s.corp.servers.hq.ice[0], 1)!;
    expect(plan.value).toBe(0);
    expect(plan.credits).toBeGreaterThan(0);
  });
});

describe("prompts answered from the Runner's own view (rule 10.2.2a)", () => {
  // Jeff's game #22 (report-22, move 216): "Amanuensis: remove 1 power counter to draw 2 cards?"
  const amanuensis = () => JSON.parse(readFileSync(new URL('./fixtures/report-22-amanuensis.json', import.meta.url), 'utf8')) as GameState;
  it('an answer that draws scores the same with the stack reversed', () => {
    const s = amanuensis();
    const prompt = activePrompt(s)!;
    expect(prompt.message).toMatch(/^Amanuensis/);
    const draw = { type: 'RESOLVE_PROMPT', player: 'runner', promptId: prompt.id, choice: { kind: 'effect_choice', optionId: 'yes' } } as GameAction;
    const reversed = { ...s, runner: { ...s.runner, stack: [...s.runner.stack].reverse() } };
    asSide('runner', () => {
      const score = (x: GameState) => scoreOutcome(x, simulate(x, draw)!, 'runner');
      // On the real state the score reads the real next cards (the hole); the Runner's view deals the stack itself
      expect(score(s)).not.toBeCloseTo(score(reversed), 6);
      expect(score(runnerDecisionView(s))).toBeCloseTo(score(runnerDecisionView(reversed)), 9);
    });
    // The AI's answer is the same whichever way the stack lies
    const pick = (x: GameState) => createAgent('runner').chooseAction(structuredClone(x));
    expect(pick(reversed)).toEqual(pick(s));
  });
});

describe('damage over a whole ice and a whole run (rules 9.8.7b, 10.4.4)', () => {
  // Batch g3 43661965986: 8 of 16 new in-run flatlines were Empiricist's 1 net then 2 net on a 2-card grip, 5 Doomscroll's
  // tag, 1 net, then 2 net at 2 tags. Each subroutine's own lethal test passed; together they were more than the grip
  const empiricist = (grip: number) => {
    const s = newGame();
    startRunnerTurn(s);
    s.runner.rig.programs = [];
    s.runner.grip = s.runner.grip.slice(0, grip);
    const ice = createCardInstance(s, EMPIRICIST);
    ice.isRezzed = true;
    s.corp.servers.hq.ice = [ice];
    return { s, ice };
  };
  it("Empiricist's 1 + 2 net damage is no way past on 2 cards, and survived on 3", () => {
    const two = empiricist(2);
    expect(asSide('runner', () => total(icePrice(two.s, two.ice)))).toBe(BLOCK);
    expect(asSide('runner', () => runScore(two.s, 'hq'))).toBe(-Infinity);
    const three = empiricist(3);
    const price = asSide('runner', () => icePrice(three.s, three.ice));
    expect(price.damage).toBe(3);
    expect(price.credits + price.value).toBeLessThan(BLOCK);
  });
  it("Doomscroll's last 2 net damage counts once its own tag makes 2 tags", () => {
    const doomscroll = (tags: number) => {
      const s = newGame();
      startRunnerTurn(s);
      s.runner.rig.programs = [];
      s.runner.tags = tags;
      s.runner.grip = s.runner.grip.slice(0, 2);
      const ice = createCardInstance(s, DOOMSCROLL);
      ice.isRezzed = true;
      s.corp.servers.hq.ice = [ice];
      return asSide('runner', () => icePrice(s, ice));
    };
    // 1 tag, then its tag: 2 tags, so 1 + 2 net damage on 2 cards
    expect(total(doomscroll(1))).toBe(BLOCK);
    // No tag before: 1 tag after its own, so only the 1 net damage
    expect(doomscroll(0).damage).toBe(1);
  });
  it('in the encounter, breaks the subroutine whose damage together with the ones before it would flatline', () => {
    // g3 43667046417 seed 2203: Empiricist rezzed on HQ, 2 cards, 6 credits and a killer; the run's price saw the tank
    // barred and the break at 6, but the encounter tested each subroutine alone and let all three fire
    const encounter = (grip: number) => {
      const state = newGame();
      installIceForTest(state, EMPIRICIST, 'remote-9');
      installProgramForTest(state, CARMEN);
      const s = runIntoFirstIce(state, 'remote-9');
      s.runner.grip = s.runner.grip.slice(0, grip);
      s.runner.credits = 3; // a boost (2) and the 2 net damage subroutine (1); not all three (5)
      return s;
    };
    const s = encounter(2);
    expect(s.activeRun?.phase).toBe('encounter_ice');
    expect(new HeuristicRunnerAI().chooseAction(s).type).toBe('BOOST_BREAKER');
    // On 4 cards the 3 net damage is survived: letting them fire is cheaper than breaking
    expect(new HeuristicRunnerAI().chooseAction(encounter(4)).type).toBe('CONTINUE_RUN');
  });
});

describe('an unknown installed card priced as the traps still unseen (rules 10.4.4)', () => {
  // g3 43672765368: 10 of 17 new access flatlines were Byte! (a tag and 3 net damage) on a 2-card grip, priced as the flat
  // 2 + advancements guess: 2 is not more than 2, so the remote read as safe
  const BYTE = '35050';
  const URTICA = '30045';
  const withOnly = (code: string, corpCredits: number, grip: number) => {
    const s = newGame();
    startRunnerTurn(s);
    s.runner.grip = s.runner.grip.slice(0, grip);
    s.corp.credits = corpCredits;
    // the Corp's unseen cards: one trap of this kind, the rest not traps
    const pool = [...s.corp.hq, ...s.corp.rd];
    for (const c of pool) if (isTrap(c.cardCode)) c.cardCode = '30055'; // not a trap
    s.corp.rd[0] = createCardInstance(s, code);
    return s;
  };
  it('Byte! with the Corp able to pay 4 is 3 net damage, a flatline on 2 cards', () => {
    const s = withOnly(BYTE, 5, 2);
    expect(accessDamage(s, BYTE, 0)).toBe(3);
    expect(trapDamageMax(s, 0)).toBe(3);
    expect(asSide('runner', () => trapHit(s, 0, 2))).toBe(asSide('runner', () => damageWorth(s, 3, false, 2)));
    expect(asSide('runner', () => trapHit(s, 0, 2))).toBeGreaterThan(asSide('runner', () => damageWorth(s, 2, false, 2)));
  });
  it('Byte! the Corp cannot pay for does nothing', () => {
    const s = withOnly(BYTE, 3, 2);
    expect(accessDamage(s, BYTE, 0)).toBe(0);
    expect(asSide('runner', () => trapHit(s, 0, 2))).toBe(0);
  });
  it('an advanced card can only be a trap that can be advanced: Urtica Cipher, 2 plus its counters', () => {
    const s = withOnly(BYTE, 5, 3);
    s.corp.rd[1] = createCardInstance(s, URTICA);
    expect(trapDamageMax(s, 2)).toBe(4);
    expect(trapDamageMax(s, 0)).toBe(3);
  });
});

describe('an unrezzed ice priced as the ice still unseen (rules 6.9.2c, 9.8.7b, 10.4.4)', () => {
  // g3 43672765368: 17 of 22 ice flatlines above base were ice unrezzed when the run was priced (Karunā's 2 net on 1 card,
  // Empiricist and Doomscroll on 2); its price had no damage in it
  const KARUNA = '30047';
  const position = (grip: number, corpCredits: number) => {
    const s = newGame();
    startRunnerTurn(s);
    s.runner.rig.programs = [];
    s.runner.grip = s.runner.grip.slice(0, grip);
    s.corp.credits = corpCredits;
    s.corp.rd[0] = createCardInstance(s, KARUNA);
    installIceForTest(s, PALISADE_CODE, 'remote-9', false);
    return { s, ice: s.corp.servers['remote-9'].ice[0] };
  };
  it('is a damage risk the Runner holding 1 card prices, and less so on 5 cards', () => {
    const one = position(1, 10);
    const five = position(5, 10);
    const r1 = asSide('runner', () => unrezzedDamageRisk(one.s, one.ice));
    const r5 = asSide('runner', () => unrezzedDamageRisk(five.s, five.ice));
    expect(r1).toBeGreaterThan(0);
    expect(r5).toBeLessThan(r1);
  });
  it('is none when the Corp cannot pay to rez any of it', () => {
    const broke = position(1, 0);
    expect(asSide('runner', () => unrezzedDamageRisk(broke.s, broke.ice))).toBe(0);
  });
});

describe('the tank damage text and its one owner (RM-SUBDAMAGE-TEXT, RM-TANK-NOT-SINGLE; rules 10.4.2b, 10.4.4)', () => {
  const dmg = (label: string, tags = 0, grip = 5) => {
    const s = newGame();
    s.runner.tags = tags;
    s.runner.grip = s.runner.grip.slice(0, grip);
    return tankDamage(s, [{ label, i: 0 }]).damage;
  };
  it('core damage trashes a card a point, and a tagged-only one does nothing untagged', () => {
    expect(dmg('Do 2 core damage.')).toBe(2);
    expect(dmg('Do 1 core damage.')).toBe(1);
    expect(dmg('If the Runner is tagged, do 1 core damage.', 0)).toBe(0);
    expect(dmg('If the Runner is tagged, do 1 core damage.', 1)).toBe(1);
  });
  it('"end the run unless the Runner suffers N net damage": the tank takes the N', () => {
    expect(dmg('End the run unless the Runner suffers 2 net damage.')).toBe(2);
  });
});

describe('tanks over a whole run: break one, tank the other (rules 9.8.7b, 10.4.4)', () => {
  // Review note on ai-runner-fixes: runScore barred a run whose tanks together were more than the grip, though breaking
  // one of them left the rest survivable. Two rezzed Empiricists on a 4-card grip: tanking both is 6 damage
  it('breaks the one that costs least and tanks the other, instead of barring the run', () => {
    const s = newGame();
    startRunnerTurn(s);
    s.runner.rig.programs = [];
    installProgramForTest(s, CARMEN);
    s.runner.grip = s.runner.grip.slice(0, 4);
    s.runner.credits = 10;
    installIceForTest(s, EMPIRICIST, 'remote-9');
    installIceForTest(s, EMPIRICIST, 'remote-9');
    // an unseen card with 3 advancements behind them, worth the run
    const agenda = s.corp.rd.find(c => cardDef(c).type_code === 'agenda')!;
    s.corp.rd.splice(s.corp.rd.indexOf(agenda), 1);
    s.corp.servers['remote-9'].root.push({ ...agenda, advancementCounters: 3 });
    const one = asSide('runner', () => icePrice(s, s.corp.servers['remote-9'].ice[0]));
    expect(one.damage).toBe(3);
    expect(one.noDamage).toBeDefined();
    expect(asSide('runner', () => runScore(s, 'remote-9'))).toBeGreaterThan(-Infinity);
    // With nothing to break with, 6 damage on 4 cards is no way in
    s.runner.rig.programs = [];
    expect(asSide('runner', () => runScore(s, 'remote-9'))).toBe(-Infinity);
  });
});
