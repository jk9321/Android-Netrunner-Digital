import { describe, expect, it } from "vitest";
import {
  GameAction,
  GameState,
  Prompt,
  actingSide,
  createCardInstance,
  executeAction,
  findCardAnywhere,
} from "../src/core";
import { createAgent } from "../src/ai";
import { GameRunner } from "../src/ai/playout";
import { HeuristicRunnerAI } from "../src/ai/runnerAI";
import { serverValue } from "../src/ai/runs";
import { dealState } from "../scripts/stage-a/harness";
import {
  answer,
  cont,
  giveCard,
  installCorpForTest,
  keepGoing,
  newGame,
  play,
  run,
  startRunnerTurn,
} from "./helpers";

/**
 * Runner AI pins (Runner rework R0 count 1, /mnt/project-files/netrunner-ai/runner-rework/r0/count1-audit-map/; known
 * failing until their fix). Each asserts the right behaviour; the fix turns the pin over (it.fails -> it).
 */
const BURNER = "34085";
const MALAPERT = "30066"; // Malapert Data Vault (upgrade, trash 4)
const ANOETIC = "30050"; // Anoetic Void (upgrade, trash 1)

/**
 * The Runner plays Burner (34085: "Run HQ. If successful, instead of breaching HQ, reveal 3 cards in HQ at random. Add 2
 * of the revealed cards to the top and/or bottom of R&D.") with an unrezzed upgrade `inRoot` in the root of HQ; a card
 * `inRd` sits in R&D, so the two boards built with the codes swapped hold the same hidden cards.
 */
function afterBurner(
  inRoot: string,
  inRd: string,
): { s: GameState; upgrade: string } {
  let s = newGame();
  const upgrade = installCorpForTest(s, inRoot, "hq");
  s.corp.rd.push(createCardInstance(s, inRd));
  startRunnerTurn(s);
  const id = giveCard(s, "runner", BURNER);
  s.runner.credits += 10;
  s = cont(play(s, "runner", id));
  const [a, b] = (s.pendingPrompts[0] as { candidateIds: string[] })
    .candidateIds;
  s = keepGoing(answer(s, { kind: "effect_cards", cardInstanceIds: [a, b] }));
  s = keepGoing(answer(s, { kind: "effect_choice", optionId: "top" }));
  s = keepGoing(answer(s, { kind: "effect_choice", optionId: "bottom" }));
  return { s, upgrade };
}

describe("Runner AI pins (known-failing until the Runner rework fixes them)", () => {
  // R0 count 1, D1 (runnerAI.ts `remember`): after any successful run the Runner's private memory takes every card in that
  // server's root as seen. Burner replaces the breach (rule 6.9.5b: the Runner breaches the attacked server in the Success
  // Phase; the card's "instead of breaching" replaces it), so no candidate is compiled (7.4.1a: each card in the root of
  // the BREACHED server is a candidate) and the upgrade is never accessed (7.2.1). The Runner learns no hidden information
  // without a game effect or rule (10.2.2b): the facedown upgrade stays unknown (the engine agrees: runnerKnows unset).
  // The memory holds its identity anyway, and serverValue reads it (runs.ts serverWorth, the "seen it" branch), so the HQ
  // price moves with which upgrade it really is. Expected: the memory does not hold it, and the price is the same on two
  // boards that differ only by which hidden card is the upgrade.
  it.fails(
    "D1: after Burner, the HQ price does not depend on the unaccessed upgrade in the root of HQ",
    () => {
      const prices = [
        [MALAPERT, ANOETIC],
        [ANOETIC, MALAPERT],
      ].map(([inRoot, inRd]) => {
        const { s, upgrade } = afterBurner(inRoot, inRd);
        expect(s.runsThisTurn).toEqual([{ server: "hq", successful: true }]);
        expect(findCardAnywhere(s, upgrade)?.runnerKnows).toBeFalsy();
        const ai = new HeuristicRunnerAI();
        ai.observe(s);
        expect(ai.knownCards().has(upgrade)).toBe(false);
        return serverValue(s, "hq", 0, ai.knownCards(), true);
      });
      expect(prices[0]).toBeCloseTo(prices[1], 6);
    },
  );

  // R0 count 1, D1 `recycled` (ruling r0/count1-audit-map/ruling.md): the memory is keyed by instance id and never
  // forgets. Rule 1.12.3: "A card that moves from its location to a hidden or secret location becomes a new object, even
  // if the new location is in the same zone." The engine forgets by the rules (forgetHiddenCards,
  // src/core/engine/helpers.ts:222; the install's own test, src/core/engine/actions/install.ts:178-179 with
  // runnerSawBeforeInstall), so a card the Runner accessed in a remote, returned to HQ and installed again facedown is
  // unknown (runnerKnows unset); the memory still holds it and serverWorth's "seen it" branch prices it by identity
  // (65 changed decisions of 953 asked in self-play, 24 of 221 games; report-33's Anthill is the human-game case).
  // Expected: the memory does not hold it, and the new server's price is the same on two boards that differ only by
  // which hidden card it is.
  it("D1 recycled (setup): the engine forgets the reinstalled card (rule 1.12.3)", () => {
    const { afterRun, s, card } = recycled(MALAPERT, ANOETIC);
    expect(findCardAnywhere(afterRun, card)?.runnerKnows).toBe(true); // accessed in the run (7.2.1)
    expect(findCardAnywhere(s, card)?.runnerKnows).toBeFalsy();
  });
  it.fails(
    "D1 recycled: a card accessed, returned to HQ and installed again facedown is not priced by its identity",
    () => {
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
    },
  );

  // R0 count 1, D2 (ruling: pinned): promptAnswer (src/ai/runnerAI.ts:283) answers on the real state when the prompt
  // names a stack card or a Corp card the Runner cannot see, so the answer moves with cards the Runner cannot know
  // (rule 10.2.2b). Boards from the g1 base deals (44381468776), replayed by GameRunner, Normal v Normal. NOT turned by
  // the memory fix above: their fix is R-B's honest prompt view (the Runner answers on its own view with the named
  // cards in place).
  it("D2 (setup): the two deal boards are reached and the control answer is the one played", () => {
    for (const d of [topanBoard(), mutualFavorBoard()])
      expect(ask(d.s, d.memory)).toBe(d.played);
    const t = topanBoard();
    const ids = (t.prompt as { options: { id: string }[] }).options.map(
      (o) => o.id,
    );
    expect(ids).toEqual(expect.arrayContaining([TOPAN_PICK, TOPAN_OTHER]));
    const [a, b] = [TOPAN_PICK, TOPAN_OTHER].map(
      (id) => findCardAnywhere(t.s, id)!,
    );
    expect([a.isRezzed, b.isRezzed]).toEqual([false, false]);
    expect(a.cardCode).not.toBe(b.cardCode);
  }, 120_000);
  // Deal 1581 T4: Topan installs Botulus and asks which ice hosts it; the options are unrezzed ice. Swapping the codes of
  // two named unrezzed ice (the Runner sees the same board) changes the pick: it reads the facedown ice's identity.
  it.fails(
    "D2 Topan host (deal 1581 T4): the pick does not move when two facedown ice swap identities",
    () => {
      const d = topanBoard();
      const b = structuredClone(d.s);
      const [x, y] = [TOPAN_PICK, TOPAN_OTHER].map(
        (id) => findCardAnywhere(b, id)!,
      );
      [x.cardCode, y.cardCode] = [y.cardCode, x.cardCode];
      expect(ask(b, d.memory)).toBe(ask(d.s, d.memory));
    },
    120_000,
  );
  // Deal 2061 T4: Mutual Favor searches the stack for an icebreaker. After the search the stack is shuffled (rule 8.7.3:
  // "the deck is always shuffled upon completion of the search"), so its order is unknowable; reversing the order of the
  // cards the prompt does not name changes the pick.
  it.fails(
    "D2 Mutual Favor search (deal 2061 T4): the pick does not move with the stack order",
    () => {
      const d = mutualFavorBoard();
      const named = new Set(
        (d.prompt as { candidateIds: string[] }).candidateIds,
      );
      const b = structuredClone(d.s);
      const free = b.runner.stack
        .map((_, i) => i)
        .filter((i) => !named.has(b.runner.stack[i].instanceId));
      const cards = free.map((i) => b.runner.stack[i]).reverse();
      free.forEach((i, k) => (b.runner.stack[i] = cards[k]));
      expect(ask(b, d.memory)).toBe(ask(d.s, d.memory));
    },
    120_000,
  );
});

/**
 * The Runner runs a remote holding `inRoot` (unrezzed upgrade) and accesses it without trashing; the Corp then returns it
 * to HQ (test setup standing in for a bounce effect) and installs it again facedown in a new remote with the install
 * action. `inRd` sits in R&D so the two boards built with the codes swapped hold the same hidden cards.
 */
function recycled(
  inRoot: string,
  inRd: string,
): { afterRun: GameState; s: GameState; card: string; server: string } {
  let s = newGame();
  const card = installCorpForTest(s, inRoot, "remote-1");
  s.corp.rd.push(createCardInstance(s, inRd));
  startRunnerTurn(s);
  s = cont(run(s, "remote-1"));
  for (let i = 0; i < 10 && s.pendingPrompts.length > 0; i++)
    s =
      s.pendingPrompts[0].kind === "access_trash"
        ? answer(s, { kind: "access_trash", trash: false })
        : cont(s);
  expect(s.runsThisTurn).toEqual([{ server: "remote-1", successful: true }]);
  const b = structuredClone(s);
  const root = b.corp.servers["remote-1"].root;
  b.corp.hq.push(
    ...root.splice(
      root.findIndex((c) => c.instanceId === card),
      1,
    ),
  );
  b.activePlayer = "corp";
  b.phase = "corp_turn";
  b.corp.clicks = 3;
  b.corp.credits = 20;
  b.runsThisTurn = [];
  const after = executeAction(b, {
    type: "INSTALL_CARD",
    player: "corp",
    cardInstanceId: card,
    asNewRemote: true,
  });
  const server = Object.entries(after.corp.servers).find(([, v]) =>
    v.root.some((c) => c.instanceId === card),
  )![0];
  return { afterRun: s, s: after, card, server };
}

const TOPAN_PICK = "inst-36"; // the pick played (Funhouse, unrezzed)
const TOPAN_OTHER = "inst-45"; // another named unrezzed ice of another title
interface DealBoard {
  s: GameState;
  memory: Map<string, string>;
  played: string;
  prompt: Prompt;
}
const boards = new Map<string, DealBoard>();
/** Plays deal `seed` to the first Runner prompt of `code` (at `step`) in turn `turn`; the copy, memory and the move played. */
function dealBoard(
  seed: number,
  turn: number,
  code: string,
  step: string,
): DealBoard {
  const k = `${seed}|${turn}|${code}|${step}`;
  const kept = boards.get(k);
  if (kept) return kept;
  const agents = {
    corp: createAgent("corp", "normal"),
    runner: createAgent("runner", "normal"),
  };
  const g = new GameRunner(dealState(seed), agents);
  for (let n = 0; n < 4000; n++) {
    const s = g.state;
    const p = s.pendingPrompts[0] as
      | (Prompt & { source?: { cardCode?: string; step?: string } })
      | undefined;
    if (
      s.turnNumber === turn &&
      actingSide(s) === "runner" &&
      p?.side === "runner" &&
      p.source?.cardCode === code &&
      p.source.step === step
    ) {
      const copy = structuredClone(s);
      const memory = new Map(memoryOf(agents.runner));
      g.step();
      const board = {
        s: copy,
        memory,
        played: JSON.stringify(g.last),
        prompt: p,
      };
      boards.set(k, board);
      return board;
    }
    if (!g.step()) break;
  }
  throw new Error(`deal ${seed}: no ${code} ${step} prompt in turn ${turn}`);
}
const topanBoard = () => dealBoard(1581, 4, "35002", "host");
const mutualFavorBoard = () => dealBoard(2061, 4, "30011", "search");
const memoryOf = (agent: unknown) =>
  (agent as { memory: Map<string, string> }).memory;
/** A fresh Normal Runner with the deal Runner's memory answers a copy of `s`. */
function ask(s: GameState, memory: Map<string, string>): string {
  const runner = createAgent("runner", "normal");
  (runner as unknown as { memory: Map<string, string> }).memory = new Map(
    memory,
  );
  const action: GameAction = runner.chooseAction(structuredClone(s));
  return JSON.stringify(action);
}
