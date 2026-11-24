import { describe, expect, it } from 'vitest';
import { GameState, createCardInstance, executeAction, findCardAnywhere } from '../src/core';
import { installCorpCardFrom } from '../src/core/engine/actions/install';
import { derez } from '../src/core/engine/cardEffects';
import { HeuristicRunnerAI } from '../src/ai/runnerAI';
import { answer, cont, installCorpForTest, keepGoing, newGame, passTurn, rezForTest, run, startRunnerTurn } from './helpers';

/**
 * The Runner AI's private map of Corp cards it has seen (`memory`, runnerAI.ts `remember`) holds an installed root card
 * exactly while the engine marks it (rezzed, faceup, `runnerKnows`), the same test as the Runner's view (core/view.ts).
 * Runner rework, brief /mnt/project-files/netrunner-ai/runner-rework/fixes/runner-seen/brief.md (ai-runner-seen).
 * Rules: Comprehensive Rules v26.03.
 */
const MALAPERT = '30066'; // Malapert Data Vault (upgrade)
const ANOETIC = '30050'; // Anoetic Void (upgrade)
const NICO = '30037'; // Nico Campaign (asset)
const OFFWORLD = '30067'; // Offworld Office (agenda)
const ADRIAN = '34046'; // Adrian Seis (upgrade): psi game on a successful run; differing bids, only it can be accessed

const prompt = (s: GameState) => s.pendingPrompts[0];
const choose = (s: GameState, optionId: string) => keepGoing(answer(s, { kind: 'effect_choice', optionId }));
const decline = (s: GameState) => keepGoing(answer(s, { kind: 'access_trash', trash: false }));
function finishBreach(s: GameState): GameState {
  for (let i = 0; i < 20 && s.pendingPrompts.length > 0; i++) s = prompt(s).kind === 'access_trash' ? decline(s) : cont(s);
  return s;
}
function seen(...states: GameState[]): Set<string> {
  const ai = new HeuristicRunnerAI();
  for (const s of states) ai.observe(s);
  return new Set(ai.knownCards().keys());
}
/** The Corp's turn, with clicks and credits (test setup). */
function corpTurn(s: GameState): void {
  s.activePlayer = 'corp';
  s.phase = 'corp_turn';
  s.turnStep = null;
  s.corp.clicks = 3;
  s.corp.credits = 20;
  s.runsThisTurn = [];
}

/** A run on remote-1 holding `inRoot` (unrezzed), the card accessed and left installed. */
function accessedInRemote(inRoot: string): { s: GameState; card: string } {
  let s = newGame();
  const card = installCorpForTest(s, inRoot, 'remote-1');
  startRunnerTurn(s);
  s = finishBreach(cont(run(s, 'remote-1')));
  expect(s.runsThisTurn).toEqual([{ server: 'remote-1', successful: true }]);
  return { s, card };
}

describe('Runner AI: what it has seen of the Corp installed cards is the engine marks', () => {
  // Rule 1.12.3: "A card that moves from its location to a hidden or secret location becomes a new object"; 1.12.1.
  it('a card accessed, returned to HQ and installed again facedown is not known (rules 1.12.1, 1.12.3)', () => {
    const { s: afterRun, card } = accessedInRemote(MALAPERT);
    const s = structuredClone(afterRun);
    const root = s.corp.servers['remote-1'].root;
    s.corp.hq.push(...root.splice(root.findIndex(c => c.instanceId === card), 1));
    corpTurn(s);
    const after = executeAction(s, { type: 'INSTALL_CARD', player: 'corp', cardInstanceId: card, asNewRemote: true });
    expect(findCardAnywhere(after, card)?.runnerKnows).toBeFalsy();
    expect(seen(afterRun).has(card)).toBe(true);
    expect(seen(afterRun, after).has(card)).toBe(false);
  });

  // The boundary (brief, fix point 3): an entry whose card is no longer installed is left as it was. Part of it is
  // knowledge the rules allow (a known card returned to HQ: the Runner saw which installed card went back), part a read
  // by instance identity; sorting them needs an engine mark (Runner rework R-B). Rules 1.12.3, 10.2.2b.
  it('an entry for a card now in HQ is kept as before (the hidden-zone boundary, rule 1.12.3)', () => {
    const { s: afterRun, card } = accessedInRemote(ANOETIC);
    const s = structuredClone(afterRun);
    const root = s.corp.servers['remote-1'].root;
    s.corp.hq.push(...root.splice(root.findIndex(c => c.instanceId === card), 1));
    expect(seen(afterRun, s).has(card)).toBe(true);
  });

  // Rule 7.2.1: the card is accessed (seen) at its access; under an access limit a candidate that is never accessed is
  // never seen (Adrian Seis, differing bids: "the Runner cannot access cards other than this upgrade"; rule 10.2.2b).
  it('a root card left unaccessed by an access limit is not known after the successful run (rule 7.2.1)', () => {
    let s = newGame();
    const adrian = installCorpForTest(s, ADRIAN, 'remote-1', true);
    const off = installCorpForTest(s, OFFWORLD, 'remote-1');
    startRunnerTurn(s);
    s = cont(run(s, 'remote-1'));
    s = choose(choose(s, '0'), '1');
    expect(s.activeRun?.accessOnlyIds).toEqual([adrian]);
    s = finishBreach(s);
    expect(s.runsThisTurn).toEqual([{ server: 'remote-1', successful: true }]);
    expect(s.runner.score).toBe(0);
    expect(findCardAnywhere(s, off)?.runnerKnows).toBeFalsy();
    const known = seen(s);
    expect(known.has(off)).toBe(false);
    expect(known.has(adrian)).toBe(true); // rezzed: public
  });

  // Rule 7.4.1a: each root card of the breached server is a candidate; it is seen when it is accessed (7.2.1), not
  // before. At the trash decision on the first candidate, the second is unknown, and the answer does not move with
  // which card it is (the two boards swap it with a card in R&D, so they hold the same hidden cards).
  it('at a trash decision in a breach, a candidate not yet accessed is not known (rules 7.4.1a, 7.2.1)', () => {
    const boards = [
      [ANOETIC, MALAPERT],
      [MALAPERT, ANOETIC],
    ].map(([second, inRd]) => {
      let s = newGame();
      const first = installCorpForTest(s, NICO, 'remote-1');
      const other = installCorpForTest(s, second, 'remote-1');
      s.corp.rd.push(createCardInstance(s, inRd));
      startRunnerTurn(s);
      s.runner.credits = 10;
      s = cont(run(s, 'remote-1'));
      expect(prompt(s)).toMatchObject({ kind: 'access_trash', cardInstanceId: first });
      return { s, first, other };
    });
    const answers = boards.map(({ s, first, other }) => {
      const ai = new HeuristicRunnerAI();
      const action = ai.chooseAction(structuredClone(s));
      expect(ai.knownCards().has(first)).toBe(true);
      expect(ai.knownCards().has(other)).toBe(false);
      return JSON.stringify(action);
    });
    expect(answers[0]).toBe(answers[1]);
  });

  // Rule 7.2.1 and 10.2.2b: an accessed card left installed stays known (runnerKnows) on later turns; rule 1.12.5: "A
  // card that is turned faceup or facedown is still the same object", so a derez keeps it known.
  it('an accessed card that stays installed is known on later turns, also after a derez (rules 7.2.1, 1.12.5)', () => {
    const { s: afterRun, card } = accessedInRemote(NICO);
    const ai = new HeuristicRunnerAI();
    ai.observe(afterRun);
    let s = passTurn(afterRun);
    ai.observe(s);
    expect(ai.knownCards().has(card)).toBe(true);
    corpTurn(s);
    s = rezForTest(s, card);
    expect(findCardAnywhere(s, card)?.isRezzed).toBe(true);
    ai.observe(s);
    const d = structuredClone(s);
    derez(d, findCardAnywhere(d, card)!);
    expect(findCardAnywhere(d, card)?.isRezzed).toBe(false);
    ai.observe(d);
    expect(ai.knownCards().get(card)).toBe(NICO);
  });

  // Rule 7.3.1a: "After the Runner accesses a card during a breach, that object remains visible to the Runner for the
  // remainder of the breach" (the Poétrï example). A card accessed in HQ and installed during the same breach stays
  // known (the engine's runnerSawBeforeInstall); a card from HQ the Runner did not access is not.
  it('a card accessed in this breach and then installed stays known (rule 7.3.1a, Poétrï)', () => {
    let s = newGame();
    s.corp.rd.push(...s.corp.hq.splice(0));
    const x = createCardInstance(s, NICO);
    s.corp.hq.push(x);
    startRunnerTurn(s);
    s = cont(run(s, 'hq'));
    expect(prompt(s)).toMatchObject({ kind: 'access_trash', cardInstanceId: x.instanceId });
    const y = createCardInstance(s, MALAPERT); // in HQ, never accessed
    s.corp.hq.push(y);
    installCorpCardFrom(s, findCardAnywhere(s, x.instanceId)!, s.corp.hq, null, true);
    installCorpCardFrom(s, findCardAnywhere(s, y.instanceId)!, s.corp.hq, null, true);
    const known = seen(s);
    expect(known.has(x.instanceId)).toBe(true);
    expect(known.has(y.instanceId)).toBe(false);
  });
});
