import { describe, expect, it } from 'vitest';
import { GameState, createCardInstance, findCardAnywhere } from '../src/core';
import { HeuristicRunnerAI } from '../src/ai/runnerAI';
import { serverValue } from '../src/ai/runs';
import { answer, cont, giveCard, installCorpForTest, keepGoing, newGame, play, startRunnerTurn } from './helpers';

/**
 * Runner AI pins (Runner rework R0 count 1, /mnt/project-files/netrunner-ai/runner-rework/r0/count1-audit-map/; known
 * failing until their fix). Each asserts the right behaviour; the fix turns the pin over (it.fails -> it).
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

describe('Runner AI pins (known-failing until the Runner rework fixes them)', () => {
  // R0 count 1, D1 (runnerAI.ts `remember`): after any successful run the Runner's private memory takes every card in that
  // server's root as seen. Burner replaces the breach (rule 6.9.5b: the Runner breaches the attacked server in the Success
  // Phase; the card's "instead of breaching" replaces it), so no candidate is compiled (7.4.1a: each card in the root of
  // the BREACHED server is a candidate) and the upgrade is never accessed (7.2.1). The Runner learns no hidden information
  // without a game effect or rule (10.2.2b): the facedown upgrade stays unknown (the engine agrees: runnerKnows unset).
  // The memory holds its identity anyway, and serverValue reads it (runs.ts serverWorth, the "seen it" branch), so the HQ
  // price moves with which upgrade it really is. Expected: the memory does not hold it, and the price is the same on two
  // boards that differ only by which hidden card is the upgrade.
  it.fails('D1: after Burner, the HQ price does not depend on the unaccessed upgrade in the root of HQ', () => {
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
});
