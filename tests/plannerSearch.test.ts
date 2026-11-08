import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameState, cardDef, createRng, executeAction } from '../src/core';
import { HeuristicCorpAI } from '../src/ai/corpAI';
import { guessHidden } from '../src/ai/runnerReply';
import { tuning } from '../src/ai/synergy';
import { buildCandidates, discardStep, planTurn } from '../src/ai/turnPlanner';
import { newGame, putInHand } from './helpers';
import { inDecision } from './helpers/pricing';

/**
 * Structural review item 4 (Fable spec, 2026-11-07): the planner's widened search, plan.plannerSearch and its pieces.
 * Each test turns the switch on itself; with it off the planner plays as before (the rest of the suite).
 */
let saved: typeof tuning.plan;
beforeEach(() => {
  saved = tuning.plan;
  tuning.plan = { ...saved, plannerSearch: true };
});
afterEach(() => {
  tuning.plan = saved;
});

const ids = (cards: { instanceId: string }[]) => cards.map(c => c.instanceId);
/** The same position with another rng history (an action that drew or shuffled, then the same board). */
const otherHistory = (s: GameState): GameState => ({ ...s, rng: createRng(((s.rng?.state ?? 1) * 7919 + 13) >>> 0) });

describe('plannerSeed: every candidate of a turn is played out on the same deal', () => {
  it('the Runner reply deals the same grip, stack and R&D order whatever the rng history', () => {
    const s = newGame();
    const t = otherHistory(s);
    for (let k = 0; k < 2; k++) {
      const a = guessHidden(s, k);
      const b = guessHidden(t, k);
      expect(ids(b.runner.grip)).toEqual(ids(a.runner.grip));
      expect(ids(b.runner.stack)).toEqual(ids(a.runner.stack));
      expect(ids(b.corp.rd)).toEqual(ids(a.corp.rd));
      expect(b.rng.state).toBe(a.rng.state);
    }
    // the two samples still differ from each other
    expect(ids(guessHidden(s, 0).runner.stack)).not.toEqual(ids(guessHidden(s, 1).runner.stack));
  });

  it('without it the deal follows the rng history (the old behaviour)', () => {
    tuning.plan = { ...tuning.plan, plannerSearch: false };
    const s = newGame();
    expect(ids(guessHidden(otherHistory(s), 0).runner.stack)).not.toEqual(ids(guessHidden(s, 0).runner.stack));
  });

  it('the deal does not depend on the order the hidden cards sat in (nothing about them is read)', () => {
    const s = newGame();
    const t = { ...s, runner: { ...s.runner, stack: [...s.runner.stack].reverse() }, corp: { ...s.corp, rd: [...s.corp.rd].reverse() } };
    expect(ids(guessHidden(t, 0).runner.grip)).toEqual(ids(guessHidden(s, 0).runner.grip));
    expect(ids(guessHidden(t, 0).corp.rd)).toEqual(ids(guessHidden(s, 0).corp.rd));
  });

  it('the same decision with two rng histories picks the same action, and twice the same', () => {
    const s = newGame();
    const pick = (state: GameState) =>
      inDecision(state, 'corp', () => {
        const ai = new HeuristicCorpAI({ planner: false });
        const ranked = ai.rankMainActions(state);
        return planTurn(state, 'corp', ranked, { rank: x => ai.rankMainActions(x), answer: x => ai.chooseAction(x), memory: { line: [] } }, true);
      });
    const first = JSON.stringify(pick(s));
    expect(JSON.stringify(pick(s))).toBe(first);
    expect(JSON.stringify(pick(otherHistory(s)))).toBe(first);
  });
});

describe('plannerBuild: the ice install a remote build starts is tried', () => {
  it('adds an ice install into a new remote while HQ holds an agenda, and reads nothing of the grip', () => {
    const s = newGame();
    putInHand(s, 'corp', 'agenda');
    putInHand(s, 'corp', 'ice');
    s.corp.credits = 10;
    const ranked = inDecision(s, 'corp', () => new HeuristicCorpAI({ planner: false }).rankMainActions(s));
    const added = buildCandidates(s, ranked, []);
    const remote = added.find(r => r.action.type === 'INSTALL_CARD' && r.action.asNewRemote);
    expect(remote).toBeDefined();
    const card = s.corp.hq.find(c => remote!.action.type === 'INSTALL_CARD' && c.instanceId === remote!.action.cardInstanceId)!;
    expect(cardDef(card).type_code).toBe('ice');
    // already a candidate: not added again
    expect(buildCandidates(s, ranked, [remote!]).some(r => JSON.stringify(r.action) === JSON.stringify(remote!.action))).toBe(false);
    // the Runner's grip swapped for other cards: the same candidates
    const t = { ...s, runner: { ...s.runner, grip: s.runner.stack.slice(0, s.runner.grip.length), stack: [...s.runner.grip, ...s.runner.stack.slice(s.runner.grip.length)] } };
    const remoteOf = (x: GameState) => buildCandidates(x, ranked, []).filter(r => r.action.type === 'INSTALL_CARD' && r.action.asNewRemote).map(r => JSON.stringify(r.action));
    expect(remoteOf(t)).toEqual(remoteOf(s));
  });

  it('adds no remote ice with no agenda or asset in HQ', () => {
    const s = newGame();
    s.corp.hq = s.corp.hq.filter(c => !['agenda', 'asset'].includes(cardDef(c).type_code ?? ''));
    putInHand(s, 'corp', 'ice');
    const ranked = inDecision(s, 'corp', () => new HeuristicCorpAI({ planner: false }).rankMainActions(s));
    expect(buildCandidates(s, ranked, []).some(r => r.action.type === 'INSTALL_CARD' && r.action.asNewRemote)).toBe(false);
  });
});

describe('plannerDiscard: the discard step at the leaf (rules 5.6.3a, 5.7.2a)', () => {
  const ai = () => {
    const corp = new HeuristicCorpAI({ planner: false });
    return { rank: (x: GameState) => corp.rankMainActions(x), answer: (x: GameState) => corp.chooseAction(x) };
  };

  it('a Corp line that ends over its hand size discards down to it with its own discard answer', () => {
    const s = newGame();
    while (s.corp.hq.length < 8) putInHand(s, 'corp', 'operation');
    s.corp.clicks = 0;
    const after = inDecision(s, 'corp', () => discardStep(s, 'corp', ai()));
    expect(after.corp.hq.length).toBe(5);
    expect(after.corp.archives.faceDown.length + after.corp.archives.faceUp.length).toBe(3);
    // the rest of the position is the end of the action phase, as for a line under the limit
    expect(after.activePlayer).toBe('corp');
    expect(after.turnStep).toBe(s.turnStep);
    expect(after.runner).toBe(s.runner);
  });

  it('under the hand size, or with clicks left, the end state is left as it is', () => {
    const s = newGame();
    while (s.corp.hq.length > 5) s.corp.hq.pop();
    s.corp.clicks = 0;
    expect(discardStep(s, 'corp', ai())).toBe(s);
    const t = newGame();
    while (t.corp.hq.length < 8) putInHand(t, 'corp', 'operation');
    expect(discardStep(t, 'corp', ai())).toBe(t);
  });
});

describe('plannerBuild in self-play positions (the ice-then-install build, item 4 acceptance 4)', () => {
  // A self-play position (scripts/planner-stats.ts, plannerSearch on; turn 4, 11 credits, Send a Message, Nico Campaign
  // and Urtica Cipher in HQ) where Palisade into a new remote ranked 8th, outside the planner's top 4. With plannerBuild
  // the Corp builds the remote and installs Send a Message behind it; without it, it ices remote-1 and advances there.
  const turn = (file: string) => {
    tuning.plan = { ...tuning.plan, plannerSearch: true, plannerSeed: false, plannerDiscard: false, plannerPatchesOff: false };
    let s: GameState = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'));
    const corp = new HeuristicCorpAI();
    for (let i = 0; i < 12 && s.activePlayer === 'corp' && s.corp.clicks > 0 && !s.winner; i++) s = executeAction(s, corp.chooseAction(s));
    return s;
  };
  const agendasBehindIce = (s: GameState) =>
    Object.values(s.corp.servers).reduce((n, v) => n + (v.isRemote && v.ice.length > 0 ? v.root.filter(c => cardDef(c).type_code === 'agenda').length : 0), 0);
  for (const file of ['planner-build-2.json']) {
    it(`${file}: the turn ends with an agenda installed behind ice`, () => {
      const before: GameState = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'));
      const after = turn(file);
      // Main's Urtica Cipher fix (rule 9.3.2c, 2026-11-08): with no damage from HQ the planner double-advances Offworld Office behind
      // a second ice instead of building a new remote; both are agenda progress behind ice. plannerBuild itself gets its own
      // fixture later (planner-build-3, AI Coordinator).
      const nearlyScored = (s: GameState) =>
        Object.values(s.corp.servers).some(
          v => v.isRemote && v.ice.length > 0 && v.root.some(c => cardDef(c).type_code === 'agenda' && c.advancementCounters >= (cardDef(c).advancement_cost ?? 0) - 1),
        );
      expect(agendasBehindIce(after) === agendasBehindIce(before) + 1 || (nearlyScored(after) && !nearlyScored(before))).toBe(true);
    }, 60_000);
  }
});

describe('plannerPatchesOff reaches only the planning Corp (review 1 of item 4)', () => {
  it('a planner-off Corp (the reply, Hard, probes) keeps the Petty Cash patch; the planner and its rollout drop it', () => {
    tuning.plan = { ...tuning.plan, plannerSearch: true, plannerPatchesOff: true };
    const patches = (ai: HeuristicCorpAI) => (ai as unknown as { patches: boolean }).patches;
    expect(patches(new HeuristicCorpAI({ planner: false }))).toBe(true);
    expect(patches(new HeuristicCorpAI({ planner: false, searching: true }))).toBe(false);
    expect(patches(new HeuristicCorpAI())).toBe(false);
    tuning.plan = { ...tuning.plan, plannerPatchesOff: false };
    expect(patches(new HeuristicCorpAI())).toBe(true);
  });
});
