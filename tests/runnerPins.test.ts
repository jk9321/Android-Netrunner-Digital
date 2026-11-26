import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { GameAction, GameState, createCardInstance, executeAction, findCardAnywhere } from '../src/core';
import { createAgent } from '../src/ai';
import { HeuristicRunnerAI } from '../src/ai/runnerAI';
import { serverValue } from '../src/ai/runs';
import { answer, cont, giveCard, installCorpForTest, keepGoing, newGame, play, run, startRunnerTurn } from './helpers';

/**
 * Runner AI pins (Runner rework R0 count 1, /mnt/project-files/netrunner-ai/runner-rework/r0/count1-audit-map/; known
 * failing until after main is pushed, when the Runner rework builds their fix). Each asserts the right behaviour; the fix turns the pin over (it.fails -> it).
 */
const BURNER = '34085';
const MALAPERT = '30066'; // Malapert Data Vault (upgrade, trash 4)
const ANOETIC = '30050'; // Anoetic Void (upgrade, trash 1)

/**
 * The Runner plays Burner (34085: "Run HQ. If successful, instead of breaching HQ, reveal 3 cards in HQ at random. Add 2
 * of the revealed cards to the top and/or bottom of R&D.") with an unrezzed upgrade `inRoot` in the root of HQ; a card
 * `inRd` sits in R&D, so the two boards built with the codes swapped hold the same hidden cards.
 */
function afterBurner(inRoot: string, inRd: string): { s: GameState; upgrade: string } {
  let s = newGame();
  const upgrade = installCorpForTest(s, inRoot, 'hq');
  s.corp.rd.push(createCardInstance(s, inRd));
  startRunnerTurn(s);
  const id = giveCard(s, 'runner', BURNER);
  s.runner.credits += 10;
  s = cont(play(s, 'runner', id));
  const [a, b] = (s.pendingPrompts[0] as { candidateIds: string[] }).candidateIds;
  s = keepGoing(answer(s, { kind: 'effect_cards', cardInstanceIds: [a, b] }));
  s = keepGoing(answer(s, { kind: 'effect_choice', optionId: 'top' }));
  s = keepGoing(answer(s, { kind: 'effect_choice', optionId: 'bottom' }));
  return { s, upgrade };
}

describe('Runner AI pins (known-failing until after main is pushed: the Runner rework fixes them)', () => {
  // R0 count 1, D1 (runnerAI.ts `remember`): after any successful run the Runner's private memory takes every card in that
  // server's root as seen. Burner replaces the breach (rule 6.9.5b: the Runner breaches the attacked server in the Success
  // Phase; the card's "instead of breaching" replaces it), so no candidate is compiled (7.4.1a: each card in the root of
  // the BREACHED server is a candidate) and the upgrade is never accessed (7.2.1). The Runner learns no hidden information
  // without a game effect or rule (10.2.2b): the facedown upgrade stays unknown (the engine agrees: runnerKnows unset).
  // The memory holds its identity anyway, and serverValue reads it (runs.ts serverWorth, the "seen it" branch), so the HQ
  // price moves with which upgrade it really is. Expected: the memory does not hold it, and the price is the same on two
  // boards that differ only by which hidden card is the upgrade.
  it('D1: after Burner, the HQ price does not depend on the unaccessed upgrade in the root of HQ', () => {
    const prices = [
      [MALAPERT, ANOETIC],
      [ANOETIC, MALAPERT],
    ].map(([inRoot, inRd]) => {
      const { s, upgrade } = afterBurner(inRoot, inRd);
      expect(s.runsThisTurn).toEqual([{ server: 'hq', successful: true }]);
      expect(findCardAnywhere(s, upgrade)?.runnerKnows).toBeFalsy();
      const ai = new HeuristicRunnerAI();
      ai.observe(s);
      expect(ai.knownCards().has(upgrade)).toBe(false);
      return serverValue(s, 'hq', 0, ai.knownCards(), true);
    });
    expect(prices[0]).toBeCloseTo(prices[1], 6);
  });

  // R0 count 1, D1 `recycled` (ruling r0/count1-audit-map/ruling.md): the memory is keyed by instance id and never
  // forgets. Rule 1.12.3: "A card that moves from its location to a hidden or secret location becomes a new object, even
  // if the new location is in the same zone." The engine forgets by the rules (forgetHiddenCards,
  // src/core/engine/helpers.ts:222; the install's own test, src/core/engine/actions/install.ts:178-179 with
  // runnerSawBeforeInstall), so a card the Runner accessed in a remote, returned to HQ and installed again facedown is
  // unknown (runnerKnows unset); the memory still holds it and serverWorth's "seen it" branch prices it by identity
  // (65 changed decisions of 953 asked in self-play, 24 of 221 games; report-33's Anthill is the human-game case).
  // Expected: the memory does not hold it, and the new server's price is the same on two boards that differ only by
  // which hidden card it is.
  it('D1 recycled (setup): the engine forgets the reinstalled card (rule 1.12.3)', () => {
    const { afterRun, s, card } = recycled(MALAPERT, ANOETIC);
    expect(findCardAnywhere(afterRun, card)?.runnerKnows).toBe(true); // accessed in the run (7.2.1)
    expect(findCardAnywhere(s, card)?.runnerKnows).toBeFalsy();
  });
  it('D1 recycled: a card accessed, returned to HQ and installed again facedown is not priced by its identity', () => {
    const prices = [
      [MALAPERT, ANOETIC],
      [ANOETIC, MALAPERT],
    ].map(([inRoot, inRd]) => {
      const { afterRun, s, card, server } = recycled(inRoot, inRd);
      const ai = new HeuristicRunnerAI();
      ai.observe(afterRun);
      ai.observe(s);
      expect(ai.knownCards().has(card)).toBe(false);
      return serverValue(s, server, 0, ai.knownCards(), true);
    });
    expect(prices[0]).toBeCloseTo(prices[1], 6);
  });

  // R0 count 1, D2 (ruling: pinned): promptAnswer (src/ai/runnerAI.ts:283) answers on the real state when the prompt
  // names a stack card or a Corp card the Runner cannot see, so the answer moves with cards the Runner cannot know
  // (rule 10.2.2b). Boards saved from the g1 base deals (44381468776, Normal v Normal by GameRunner at beta 33c3511) in
  // tests/fixtures/runner-pins/: the GameState at the prompt, the deal Runner's memory entries and the move it played.
  // NOT turned by the memory fix above: their fix is R-B's honest prompt view (the Runner answers on its own view with
  // the named cards in place).
  it("D2 (setup): each fixture's control answer is the one recorded in the fixture", () => {
    for (const d of [TOPAN, MUTUAL_FAVOR]) expect(ask(d.state, d.memory)).toBe(JSON.stringify(d.played));
    const options = (TOPAN.state.pendingPrompts[0] as unknown as { options: { id: string }[] }).options.map(o => o.id);
    expect(options).toEqual(expect.arrayContaining([TOPAN_PICK, TOPAN_OTHER]));
    const [a, b] = [TOPAN_PICK, TOPAN_OTHER].map(id => findCardAnywhere(TOPAN.state, id)!);
    expect([a.isRezzed, b.isRezzed]).toEqual([false, false]);
    expect(a.cardCode).not.toBe(b.cardCode);
  });
  // Deal 1581 T4: Topan installs Botulus and asks which ice hosts it; the options are unrezzed ice. Swapping the codes of
  // two named unrezzed ice (the Runner sees the same board) changed the pick: it read the facedown ice's identity. Turned by
  // B3b's input 1 (an unknown facedown host is worth the unseen pool's mean, the same on every deal of the same knowledge).
  it('D2 Topan host (deal 1581 T4): the pick does not move when two facedown ice swap identities', () => {
    const b = structuredClone(TOPAN.state);
    const [x, y] = [TOPAN_PICK, TOPAN_OTHER].map(id => findCardAnywhere(b, id)!);
    [x.cardCode, y.cardCode] = [y.cardCode, x.cardCode];
    expect(ask(b, TOPAN.memory)).toBe(ask(TOPAN.state, TOPAN.memory));
    // B3 commit 2, bar 3: a named answer, the host Funhouse (inst-36), as played; the same on 12 deals of the same
    // knowledge in tests/runnerPromptView.test.ts
    expect(JSON.parse(ask(TOPAN.state, TOPAN.memory))).toMatchObject({ choice: { optionId: TOPAN_PICK } });
  });
  // Deal 2061 T4: Mutual Favor searches the stack for an icebreaker. After the search the stack is shuffled (rule 8.7.3:
  // "the deck is always shuffled upon completion of the search"), so its order is unknowable; reversing the order of the
  // cards the prompt does not name changes the pick.
  it.fails('D2 Mutual Favor search (deal 2061 T4): the pick does not move with the stack order', () => {
    const named = new Set((MUTUAL_FAVOR.state.pendingPrompts[0] as unknown as { candidateIds: string[] }).candidateIds);
    const b = structuredClone(MUTUAL_FAVOR.state);
    const free = b.runner.stack.map((_, i) => i).filter(i => !named.has(b.runner.stack[i].instanceId));
    const cards = free.map(i => b.runner.stack[i]).reverse();
    free.forEach((i, k) => (b.runner.stack[i] = cards[k]));
    expect(ask(b, MUTUAL_FAVOR.memory)).toBe(ask(MUTUAL_FAVOR.state, MUTUAL_FAVOR.memory));
  });
});

/**
 * The Runner runs a remote holding `inRoot` (unrezzed upgrade) and accesses it without trashing; the Corp then returns it
 * to HQ (test setup standing in for a bounce effect) and installs it again facedown in a new remote with the install
 * action. `inRd` sits in R&D so the two boards built with the codes swapped hold the same hidden cards.
 */
function recycled(inRoot: string, inRd: string): { afterRun: GameState; s: GameState; card: string; server: string } {
  let s = newGame();
  const card = installCorpForTest(s, inRoot, 'remote-1');
  s.corp.rd.push(createCardInstance(s, inRd));
  startRunnerTurn(s);
  s = cont(run(s, 'remote-1'));
  for (let i = 0; i < 10 && s.pendingPrompts.length > 0; i++)
    s = s.pendingPrompts[0].kind === 'access_trash' ? answer(s, { kind: 'access_trash', trash: false }) : cont(s);
  expect(s.runsThisTurn).toEqual([{ server: 'remote-1', successful: true }]);
  const b = structuredClone(s);
  const root = b.corp.servers['remote-1'].root;
  b.corp.hq.push(
    ...root.splice(
      root.findIndex(c => c.instanceId === card),
      1,
    ),
  );
  b.activePlayer = 'corp';
  b.phase = 'corp_turn';
  b.corp.clicks = 3;
  b.corp.credits = 20;
  b.runsThisTurn = [];
  const after = executeAction(b, {
    type: 'INSTALL_CARD',
    player: 'corp',
    cardInstanceId: card,
    asNewRemote: true,
  });
  const server = Object.entries(after.corp.servers).find(([, v]) => v.root.some(c => c.instanceId === card))![0];
  return { afterRun: s, s: after, card, server };
}

const TOPAN_PICK = 'inst-36'; // the pick played (Funhouse, unrezzed)
const TOPAN_OTHER = 'inst-45'; // another named unrezzed ice of another title
interface PinFixture {
  source: string;
  played: GameAction;
  memory: [string, string][];
  state: GameState;
}
function fixture(file: string): { state: GameState; memory: Map<string, string>; played: GameAction } {
  const fx: PinFixture = JSON.parse(readFileSync(new URL(`./fixtures/runner-pins/${file}`, import.meta.url), 'utf8'));
  return { state: fx.state, memory: new Map(fx.memory), played: fx.played };
}
const TOPAN = fixture('deal-1581-t4-topan-host.json');
const MUTUAL_FAVOR = fixture('deal-2061-t4-mutual-favor-search.json');
/** A fresh Normal Runner holding the deal Runner's memory answers a copy of `s`. */
function ask(s: GameState, memory: Map<string, string>): string {
  const runner = createAgent('runner', 'normal');
  (runner as unknown as { memory: Map<string, string> }).memory = new Map(memory);
  return JSON.stringify(runner.chooseAction(structuredClone(s)));
}
