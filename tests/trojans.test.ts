import { describe, expect, it } from 'vitest';
import { HeuristicRunnerAI } from '../src/ai';
import { answerPrompt } from '../src/ai/prompts';
import { iceCost } from '../src/ai/runs';
import { counterWorth } from '../src/ai/counterValues';
import { GameState, activePrompt, executeAction } from '../src/core';
import { addCounters } from '../src/core/engine/cardEffects';
import { answer, giveCard, installIceForTest, installProgramForTest, keepGoing, newGame, run, runIntoFirstIce, runnerInstall, setIdentity, useAbility } from './helpers';

const BOTULUS = '30004';
const TRANQUILIZER = '30017';
const ANSEL = '30038'; // bioroid sentry: trash a Runner card / Corp installs / no steal or trash
const PALISADE = '30072';
const CLEAVER = '30006';
const ARISSANA = '34020';

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

  // B3b (issue #68): the host's worth has one owner, counterValues.ts trojanHostWorth (input 2: a host's subroutines take
  // so many counters in one encounter; a later 'idle' copy is worth 0)
  it("prefers a fresh host over doubling up, and never doubles Tranquilizer", () => {
    let s = newGame();
    const first = installIceForTest(s, ANSEL, 'hq');
    const second = installIceForTest(s, ANSEL, 'rd');
    let one: string, two: string, fresh: string;
    [s, one] = runnerInstall(s, BOTULUS, first);
    addCounters(find(s, one), 'virus', 3); // Ansel's 3 subroutines, all taken
    [s, two] = runnerInstall(s, BOTULUS, first);
    [s, fresh] = runnerInstall(s, BOTULUS, second);
    addCounters(find(s, two), 'virus', 1);
    addCounters(find(s, fresh), 'virus', 1);
    expect(counterWorth(s, find(s, two), 'virus')).toBe(0);
    expect(counterWorth(s, find(s, fresh), 'virus')).toBeGreaterThan(0);
    // Tranquilizer, on its own board (memory)
    let t = newGame();
    const host = installIceForTest(t, ANSEL, 'hq');
    let tranq: string, tranq2: string;
    [t, tranq] = runnerInstall(t, TRANQUILIZER, host);
    [t, tranq2] = runnerInstall(t, TRANQUILIZER, host);
    expect(counterWorth(t, find(t, tranq), 'virus')).toBeGreaterThan(0);
    expect(counterWorth(t, find(t, tranq2), 'virus')).toBe(0);
  });

  it('values a trojan more on ice that is costly to get past', () => {
    let s = newGame();
    const ansel = installIceForTest(s, ANSEL, 'hq');
    const palisade = installIceForTest(s, PALISADE, 'rd');
    let onAnsel: string, onPalisade: string;
    [s, onAnsel] = runnerInstall(s, BOTULUS, ansel);
    [s, onPalisade] = runnerInstall(s, BOTULUS, palisade);
    const noFracter = counterWorth(s, find(s, onPalisade), 'virus');
    const t = structuredClone(s);
    installProgramForTest(t, CLEAVER); // Palisade now costs a few credits; Ansel still 3 clicks
    expect(counterWorth(t, find(t, onPalisade), 'virus')).toBeLessThan(noFracter);
    expect(counterWorth(t, find(t, onAnsel), 'virus')).toBeGreaterThan(counterWorth(t, find(t, onPalisade), 'virus'));
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

// B3b (brief b3-prompt-view rev 2, bar 4): which host a second copy takes is its entry's fact (runFacts.trojan.second),
// read through the owner (counterValues.ts trojanHostWorth), not a flat in the install action
describe('a second trojan: the host its entry says', () => {
  /** The Runner's best click install of `code` from the grip, by host: the ranked list (the click action's own path). */
  const bestHost = (s: GameState, code: string) => {
    const t = structuredClone(s);
    const ranked = new HeuristicRunnerAI({ planner: false }).rankMainActions(t);
    const installs = ranked.filter(r => r.action.type === 'INSTALL_CARD' && r.action.hostInstanceId && t.runner.grip.some(c => c.instanceId === (r.action as { cardInstanceId: string }).cardInstanceId && c.cardCode === code));
    return installs.map(r => ({ host: (r.action as { hostInstanceId: string }).hostInstanceId, score: r.score }));
  };

  // 'idle' (Tranquilizer derezzes at its own 3 counters; a second copy does nothing the first doesn't): the empty host
  it("'idle': a second Tranquilizer goes to the empty host, not onto the one that hosts the first", () => {
    let s = newGame();
    const held = installIceForTest(s, ANSEL, 'hq');
    const empty = installIceForTest(s, ANSEL, 'rd');
    [s] = runnerInstall(s, TRANQUILIZER, held);
    giveCard(s, 'runner', TRANQUILIZER);
    s.runner.clicks = 3;
    const hosts = bestHost(s, TRANQUILIZER);
    expect(hosts.map(h => h.host).sort()).toEqual([held, empty].sort());
    expect(hosts[0].host).toBe(empty);
  });

  // 'adds' (Botulus: each copy's counters break the host's subroutines): the reverse when the first leaves room. Ansel's
  // 3 subroutines hold a Botulus with 1 counter (room for 2 more), and the other host is a Palisade Cleaver breaks cheaply
  it("'adds': a second Botulus goes onto the host whose first copy leaves room, over a cheap empty host", () => {
    let s = newGame();
    const held = installIceForTest(s, ANSEL, 'hq');
    const empty = installIceForTest(s, PALISADE, 'rd');
    installProgramForTest(s, CLEAVER);
    let first: string;
    [s, first] = runnerInstall(s, BOTULUS, held);
    expect(find(s, first).tokens.virus).toBe(1);
    giveCard(s, 'runner', BOTULUS);
    s.runner.clicks = 3;
    const hosts = bestHost(s, BOTULUS);
    expect(hosts.map(h => h.host).sort()).toEqual([held, empty].sort());
    expect(hosts[0].host).toBe(held);
  });

  // R-C1 (brief S6, red team finding 5): a host asked during a run is the ice about to be encountered, which the run can
  // spend the copy's counter on now. The owner prices a host over future turns only, so Arissana's in-run Botulus goes to
  // the costlier ice elsewhere (Ansel on R&D, over the Palisade ahead that Cleaver breaks). Known-failing until R-C1's run-aware pick.
  it.fails("R-C1: Arissana's Botulus during a run on HQ is hosted on HQ's ice, the ice ahead", () => {
    let s = newGame();
    setIdentity(s, 'runner', ARISSANA);
    const ahead = installIceForTest(s, PALISADE, 'hq');
    installIceForTest(s, ANSEL, 'rd');
    installProgramForTest(s, CLEAVER); // Palisade, the ice ahead, is cheap to break; Ansel on R&D is not
    const botulus = giveCard(s, 'runner', BOTULUS);
    s.runner.credits = 10;
    s = run(s, 'hq');
    s = useAbility(s, 'runner', s.runner.identity.instanceId);
    s = keepGoing(answer(s, { kind: 'effect_cards', cardInstanceIds: [botulus] }));
    const p = activePrompt(s);
    expect(p?.kind).toBe('effect_choice');
    expect(s.activeRun?.server).toBe('hq');
    const a = new HeuristicRunnerAI().chooseAction(s);
    expect(a).toMatchObject({ type: 'RESOLVE_PROMPT', choice: { kind: 'effect_choice', optionId: ahead } });
  });
});
