import { describe, expect, it } from 'vitest';
import { HeuristicRunnerAI } from '../src/ai';
import { evaluate, tagsWorth } from '../src/ai/evaluate';
import { createCardInstance } from '../src/core';
import { newGame, runnerInstall } from './helpers';

const DETENTE = '35018';
const PHAROS = '30063'; // "[subroutine] Give the Runner 1 tag."

describe('Corp cards hosted on Detente', () => {
  it('are not priced as Runner cards to play, so a tag-giving ice there does not loop the AI (Detente: "host 1 card from HQ ... It is not installed")', () => {
    let s = newGame();
    let detente: string;
    [s, detente] = runnerInstall(s, DETENTE);
    const host = s.runner.rig.hardware.find(c => c.instanceId === detente)!;
    s.runner.tags = 1;
    s.corp.credits = 20; // enough to rez it, so the AI prices its subroutines
    const pharos = createCardInstance(s, PHAROS);
    pharos.isRezzed = true; // Detente hosts it faceup
    host.hostedCards = [pharos];
    // Pricing the hosted ice used to price its tag subroutine, which priced tags by the rig, which priced the ice again
    expect(Number.isFinite(tagsWorth(s, 'corp'))).toBe(true);
    expect(Number.isFinite(evaluate(s, 'corp', true))).toBe(true);
    expect(() => new HeuristicRunnerAI().chooseAction(s)).not.toThrow();
  });
});
