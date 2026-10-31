import { describe, expect, it } from 'vitest';
import { GameState, findCardAnywhere } from '../src/core';
import { GameRunner, HeuristicCorpAI, HeuristicRunnerAI } from '../src/ai';
import { runnerOffTurnWindow } from '../src/ui/viewer';
import { giveCard, newGame, passTurn, runnerInstall } from './helpers';

const MADANI = '35028';
const CLEAVER = '30006';

/** A Corp turn with Madani in the rig hosting a Cleaver the Runner can afford. */
function corpTurnWithHostedCleaver(): { s: GameState; cleaver: string } {
  let [s, madani] = runnerInstall(newGame(), MADANI);
  const cleaver = giveCard(s, 'runner', CLEAVER);
  const card = s.runner.grip.find(c => c.instanceId === cleaver)!;
  s.runner.grip = s.runner.grip.filter(c => c !== card);
  findCardAnywhere(s, madani)!.hostedCards = [card];
  s = passTurn(s);
  s.runner.credits = 5;
  return { s, cleaver };
}

describe('Runner AI on the Corp turn', () => {
  it('opens its window only once the Corp has spent its clicks (rules 5.6.2a-b)', () => {
    const { s } = corpTurnWithHostedCleaver();
    expect(s.activePlayer).toBe('corp');
    expect(runnerOffTurnWindow(s)).toBeNull();
    s.corp.clicks = 0;
    expect(runnerOffTurnWindow(s)).toBe(`off|${s.turnNumber}`);
  });

  it('installs a hosted program with Madani at the end of the Corp action phase', () => {
    const { s, cleaver } = corpTurnWithHostedCleaver();
    s.corp.clicks = 0;
    const gr = new GameRunner(s, { corp: new HeuristicCorpAI(), runner: new HeuristicRunnerAI() });
    gr.step();
    expect(gr.last).toMatchObject({ type: 'USE_ABILITY', player: 'runner', abilityIndex: 1 });
    for (let i = 0; i < 5 && gr.state.activePlayer === 'corp'; i++) gr.step();
    expect(gr.state.runner.rig.programs.map(c => c.instanceId)).toContain(cleaver);
  });
});
