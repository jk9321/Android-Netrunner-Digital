import { describe, expect, it } from 'vitest';
import { executeAction, GameAction, GameState, uncommittedChoice } from '../src/core';
import { giveCard, newGame, runnerInstall, startRunnerTurn } from './helpers';

const RED_TEAM = '30018';
const JAILBREAK = '30028';
const MUTUAL_FAVOR = '30011';
const HANSEI_REVIEW = '30048';
const WILDCAT_STRIKE = '30002';
const CONDUIT = '30024';

const runnerPlay = (code: string): [GameState, GameAction] => {
  const s = newGame();
  startRunnerTurn(s);
  const id = giveCard(s, 'runner', code);
  return [s, { type: 'PLAY_OPERATION_OR_EVENT', player: 'runner', cardInstanceId: id }];
};

describe('Choices that come before anything resolves (Cancel in the UI)', () => {
  it("Red Team's server choice comes right after its click is paid, so it can be cancelled", () => {
    const [s, id] = runnerInstall(newGame(), RED_TEAM);
    s.runner.clicks = 3;
    const action: GameAction = { type: 'USE_ABILITY', player: 'runner', cardInstanceId: id, abilityIndex: 0 };
    const found = uncommittedChoice(s, action);
    expect(found?.prompt).toMatchObject({ kind: 'effect_choice', side: 'runner' });
    // The held state is exactly what the action produces, and the given state is untouched
    expect(found!.next).toEqual(executeAction(s, action));
    expect(s.runner.clicks).toBe(3);
    expect(found!.next.runner.clicks).toBe(2);
  });

  it("a run event's server choice can be cancelled", () => {
    const [s, action] = runnerPlay(JAILBREAK);
    expect(uncommittedChoice(s, action)?.prompt.kind).toBe('effect_choice');
  });

  it('not once part of the card has resolved (Hansei Review gains 10 before the trash)', () => {
    const s = newGame();
    const id = giveCard(s, 'corp', HANSEI_REVIEW);
    const action: GameAction = { type: 'PLAY_OPERATION_OR_EVENT', player: 'corp', cardInstanceId: id };
    expect(executeAction(s, action).pendingPrompts).toHaveLength(1);
    expect(uncommittedChoice(s, action)).toBeNull();
  });

  it('not when the choice shows hidden cards (Mutual Favor searches the stack)', () => {
    const [s, action] = runnerPlay(MUTUAL_FAVOR);
    expect(executeAction(s, action).pendingPrompts[0]?.kind).toBe('effect_cards');
    expect(uncommittedChoice(s, action)).toBeNull();
  });

  it("not when the other player makes the choice (Wildcat Strike is the Corp's call)", () => {
    const [s, action] = runnerPlay(WILDCAT_STRIKE);
    expect(executeAction(s, action).pendingPrompts[0]?.side).toBe('corp');
    expect(uncommittedChoice(s, action)).toBeNull();
  });

  it('not when the action asks nothing (Conduit runs R&D at once)', () => {
    const [s, id] = runnerInstall(newGame(), CONDUIT);
    s.runner.clicks = 3;
    expect(uncommittedChoice(s, { type: 'USE_ABILITY', player: 'runner', cardInstanceId: id, abilityIndex: 0 })).toBeNull();
  });

  it('not for an illegal action', () => {
    const [s, id] = runnerInstall(newGame(), RED_TEAM);
    s.runner.clicks = 0;
    expect(uncommittedChoice(s, { type: 'USE_ABILITY', player: 'runner', cardInstanceId: id, abilityIndex: 0 })).toBeNull();
  });
});
