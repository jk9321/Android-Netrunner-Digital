import { describe, expect, it } from 'vitest';
// The AI's entry first, as lossLog.ts loads it
import { createAgent } from '../src/ai';
import { GameRunner } from '../src/ai/playout';
import { AlarmTracker } from '../scripts/alarms';
import { GameState, executeAction } from '../src/core';
import { installCorpForTest, newGame, startRunnerTurn } from './helpers';

/**
 * 'known remote run for nothing' (scripts/alarms.ts; R-C1 Part 0, tracker R-119): a successful run on a remote whose root
 * the Runner fully knew when the run began, that gained nothing (no points, no Corp card trashed or stolen, no net
 * credits). The alarm reads the engine state only. Each board is a remote with no ice; the Runner's run is started and
 * the Normal agents play it out, every step fed to the tracker.
 */
const REGOLITH = '30071'; // Regolith Mining License, asset, trash cost 3
const LUMINAL = '30036'; // Luminal Transubstantiation, agenda

function runRemote(set: (s: GameState) => void): AlarmTracker {
  const s = newGame();
  startRunnerTurn(s);
  set(s);
  const tracker = new AlarmTracker(() => 0);
  const start = executeAction(structuredClone(s), { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote-9' });
  tracker.step(s, start, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote-9' });
  const g = new GameRunner(start, { runner: createAgent('runner', 'normal'), corp: createAgent('corp', 'normal') });
  for (let k = 0; k < 100 && g.state.activeRun; k++) {
    const before = g.state;
    if (!g.step()) break;
    tracker.step(before, g.state, g.last ?? undefined);
  }
  expect(g.state.activeRun).toBeFalsy();
  return tracker;
}
const fired = (t: AlarmTracker) => t.alarms.filter(a => a.kind === 'known remote run for nothing');

describe("'known remote run for nothing' alarm", () => {
  it('fires for a successful run on a rezzed Regolith the Runner cannot pay to trash (0 credits)', () => {
    const t = runRemote(s => {
      installCorpForTest(s, REGOLITH, 'remote-9', true);
      s.runner.credits = 0;
    });
    expect(fired(t)).toEqual([{ kind: 'known remote run for nothing', turn: 1, side: 'runner', note: 'remote-9: known root, nothing gained', detail: 'known root' }]);
  });

  it('does not fire when the root held a card the Runner did not know (a facedown Regolith)', () => {
    const t = runRemote(s => {
      installCorpForTest(s, REGOLITH, 'remote-9', false);
      s.runner.credits = 0;
    });
    expect(fired(t)).toEqual([]);
  });

  it('does not fire when the run gains something (a known agenda, stolen)', () => {
    const t = runRemote(s => {
      const id = installCorpForTest(s, LUMINAL, 'remote-9', false);
      s.corp.servers['remote-9'].root.find(c => c.instanceId === id)!.runnerKnows = true;
    });
    expect(fired(t)).toEqual([]);
  });
});
