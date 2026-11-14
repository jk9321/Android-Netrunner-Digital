// The batch entry's import order (scripts/corp-losses.ts imports threatModel first): threatModel reaches runnerAI.ts
// through evaluate > ... > runs.ts > ... > runnerReply while runs.ts is still evaluating. Keep this import first.
import '../src/ai/threatModel';
import { describe, expect, it } from 'vitest';
import { GameAction, createCardInstance } from '../src/core';
import { HeuristicRunnerAI } from '../src/ai/runnerAI';
import { newGame, startRunnerTurn } from './helpers';

/**
 * ai-trojans-load (audit Step 3 known gap): runnerAI's trojan list was built at load from runs.ts's BOTULUS and
 * TRANQUILIZER. Under the batch entry's order those were not set yet, so the list was [undefined, undefined] and a
 * Botulus install never got its host term (trojanHostValue on rezzed ice, -3 on unrezzed ice), while the browser
 * worker, which loads runs.ts first, did. Botulus is installed hosted on a piece of ice (its card text; hosting, rule
 * 1.13); this pins that the Runner prefers rezzed ice to host it, whatever the import order.
 */
describe('Botulus host term under the batch import order', () => {
  it('prices Botulus on rezzed ice well above Botulus on unrezzed ice', () => {
    const s = newGame();
    startRunnerTurn(s);
    s.runner.credits = 10;
    const rezzed = createCardInstance(s, '30047'); // Whitespace
    rezzed.isRezzed = true;
    const unrezzed = createCardInstance(s, '30046'); // Diviner
    s.corp.servers.hq.ice = [rezzed];
    s.corp.servers.rd.ice = [unrezzed];
    const botulus = createCardInstance(s, '30004');
    s.runner.grip.push(botulus);
    const ranked = new HeuristicRunnerAI({ synergy: true, planner: false }).rankMainActions(s);
    const on = (host: string) =>
      ranked.find(r => {
        const a = r.action as GameAction & { cardInstanceId?: string; hostInstanceId?: string };
        return a.type === 'INSTALL_CARD' && a.cardInstanceId === botulus.instanceId && a.hostInstanceId === host;
      })!.score;
    // With the host term: at least 1 on the rezzed ice and -3 on the unrezzed; without it the two are within a point
    expect(on(rezzed.instanceId) - on(unrezzed.instanceId)).toBeGreaterThan(3);
  });
});
