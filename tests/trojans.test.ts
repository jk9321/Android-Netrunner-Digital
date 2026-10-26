import { describe, expect, it } from 'vitest';
import { HeuristicRunnerAI } from '../src/ai';
import { answerPrompt } from '../src/ai/prompts';
import { iceCost } from '../src/ai/runs';
import { trojanHostValue } from '../src/ai/runnerAI';
import { executeAction } from '../src/core';
import { addCounters } from '../src/core/engine/cardEffects';
import { installIceForTest, installProgramForTest, newGame, runIntoFirstIce, runnerInstall } from './helpers';

const BOTULUS = '30004';
const TRANQUILIZER = '30017';
const ANSEL = '30038'; // bioroid sentry: trash a Runner card / Corp installs / no steal or trash
const PALISADE = '30072';
const CLEAVER = '30006';

function find(state: ReturnType<typeof newGame>, id: string) {
  return state.runner.rig.programs.find(c => c.instanceId === id)!;
}

describe('Runner AI trojans', () => {
  it('spends Botulus counters on the worst subroutine of its host (rules 6.5.4, 9.5.6a: only while encountering it)', () => {
    let s = newGame();
    const ansel = installIceForTest(s, ANSEL, 'remote-9');
    let botulus: string;
    [s, botulus] = runnerInstall(s, BOTULUS, ansel);
    s = runIntoFirstIce(s, 'remote-9');
    expect(s.activeRun?.encounter?.iceId).toBe(ansel);
    const action = new HeuristicRunnerAI().chooseAction(s);
    expect(action).toMatchObject({ type: 'USE_ABILITY', cardInstanceId: botulus });
    s = executeAction(s, action);
    // Ansel's third subroutine stops the steal: that one goes first
    s = executeAction(s, answerPrompt(s, 'runner'));
    expect(s.activeRun!.encounter!.broken).toEqual([false, false, true]);
  });

  it('counts Botulus counters as free breaks when costing ice', () => {
    let s = newGame();
    const ansel = installIceForTest(s, ANSEL, 'remote-9');
    const ice = s.corp.servers['remote-9'].ice[0];
    const bare = iceCost(s, ice);
    let botulus: string;
    [s, botulus] = runnerInstall(s, BOTULUS, ansel);
    const one = iceCost(s, s.corp.servers['remote-9'].ice[0]);
    expect(one).toBeLessThan(bare);
    addCounters(find(s, botulus), 'virus', 2);
    expect(iceCost(s, s.corp.servers['remote-9'].ice[0])).toBe(0);
  });

  it("prefers a fresh host over doubling up, and never doubles Tranquilizer", () => {
    let s = newGame();
    const first = installIceForTest(s, ANSEL, 'hq');
    installIceForTest(s, ANSEL, 'rd');
    [s] = runnerInstall(s, BOTULUS, first);
    [s] = runnerInstall(s, TRANQUILIZER, first);
    const [doubled, fresh] = [s.corp.servers.hq.ice[0], s.corp.servers.rd.ice[0]];
    expect(trojanHostValue(s, BOTULUS, doubled)).toBeLessThan(trojanHostValue(s, BOTULUS, fresh));
    expect(trojanHostValue(s, TRANQUILIZER, doubled)).toBeLessThan(0);
  });

  it('values a trojan more on ice that is costly to get past', () => {
    const s = newGame();
    installIceForTest(s, ANSEL, 'hq');
    installIceForTest(s, PALISADE, 'rd');
    const noFracter = trojanHostValue(s, BOTULUS, s.corp.servers.rd.ice[0]);
    installProgramForTest(s, CLEAVER); // Palisade now costs a few credits; Ansel still 3 clicks
    expect(trojanHostValue(s, BOTULUS, s.corp.servers.rd.ice[0])).toBeLessThan(noFracter);
    expect(trojanHostValue(s, BOTULUS, s.corp.servers.hq.ice[0])).toBeGreaterThan(trojanHostValue(s, BOTULUS, s.corp.servers.rd.ice[0]));
  });

  it('spends spare clicks on bioroid ice, worst subroutine first, not only the run-ending one (Ansel 1.0: "Lose [click]: Break 1 subroutine")', () => {
    let s = newGame();
    installIceForTest(s, ANSEL, 'remote-9');
    installProgramForTest(s, CLEAVER); // something for "Trash 1 installed Runner card" to hit
    s = runIntoFirstIce(s, 'remote-9');
    const ai = new HeuristicRunnerAI();
    let action = ai.chooseAction(s);
    expect(action).toMatchObject({ type: 'BIOROID_BREAK', subroutineIndex: 2 }); // cannot steal or trash
    s = executeAction(s, action);
    action = ai.chooseAction(s);
    expect(action).toMatchObject({ type: 'BIOROID_BREAK', subroutineIndex: 0 }); // trash an installed card
    s = executeAction(s, action);
    expect(s.activeRun!.encounter!.broken).toEqual([true, false, true]);
  });
});
