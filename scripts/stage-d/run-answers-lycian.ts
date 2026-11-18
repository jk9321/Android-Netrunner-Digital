/**
 * Follow-up 3, the AI Coordinator's question (2026-11-18; red team adversarial/2026-11-18-hold-trash-condition finding 1):
 * the board Carmen + Marjanah at $0 or $1 (and at the run of a turn that earned first: $3 to $5 with 1 click) against Tatu-Bola inside Lycian Multi-Munition (an agenda in the root). The
 * Runner runs, the Corp rezzes Lycian on approach (6.9.2; its rez prompt: "When you rez this ice, choose 1 or more
 * subtypes"), and at that prompt: the Normal Corp's answer, answerPrompt's, each option's walk verdict (run-answers.ts
 * judge: the walk from the approached Lycian), the board key, the one-step run-over test, and the priced variant's pick.
 *   npx vite-node scripts/stage-d/run-answers-lycian.ts
 */
process.env.DEALS = 'none';
process.env.HUMAN = 'none';
const ra = await import('./run-answers');
const { createCardInstance } = await import('../../src/core/engine/gameState');
const { activePrompt, executeAction, getLegalActions } = await import('../../src/core');
const { createAgent } = await import('../../src/ai');
const { scoreOutcome, freeRezSaving } = await import('../../src/ai/prompts');
const { runLoss } = await import('../../src/ai/corp/pools');
const { installIceForTest, installProgramForTest, newGame, startRunnerTurn } = await import('../../tests/helpers');
import type { GameState } from '../../src/core';

const RIGS: Record<string, string[]> = { 'Carmen+Marjanah': ['30015', '30016'], 'Mayfly+Marjanah': ['30032', '30016'], 'Carmen+Cleaver': ['30015', '30006'] };
for (const [name, rig] of Object.entries(RIGS)) {
  for (const [credits, clicks] of [[0, 4], [1, 4], [3, 1], [4, 1], [5, 1]]) {
    let s: GameState = newGame(3);
    s.corp.hq = [];
    s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
    s.corp.credits = 12;
    s.turnNumber = 7;
    installIceForTest(s, '34044', 'remote1', false); // Tatu-Bola, innermost
    const lycian = installIceForTest(s, '34100', 'remote1', false); // Lycian, outermost
    for (const c of rig) installProgramForTest(s, c);
    s.corp.servers.remote1.root.push(createCardInstance(s, '30036'));
    startRunnerTurn(s);
    s.runner.credits = credits;
    s.runner.clicks = clicks;
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: 'remote1' });
    // To the approach of Lycian with the Corp holding the rez window
    for (let k = 0; k < 6 && !(s.priority?.holder === 'corp' && s.activeRun?.phase === 'approach_ice'); k++) {
      const go = getLegalActions(s, 'runner').find(a => a.type === 'CONTINUE_RUN') ?? getLegalActions(s, 'runner').find(a => a.type === 'PASS');
      if (!go) break;
      s = executeAction(s, go);
    }
    const rezzed = executeAction(s, { type: 'REZ_CARD', player: 'corp', cardInstanceId: lycian });
    const p = activePrompt(rezzed);
    if (!p || p.side !== 'corp') {
      console.log(JSON.stringify({ rig: name, credits, error: 'no subtype prompt', phase: rezzed.activeRun?.phase }));
      continue;
    }
    const given = createAgent('corp', 'normal').chooseAction(structuredClone(rezzed));
    const opts = ra.judgeOptions(rezzed, 'corp', 2);
    const loss = runLoss(rezzed);
    const priced = (o: (typeof opts)[number]) => scoreOutcome(rezzed, o.after, 'corp', undefined, true) + freeRezSaving(rezzed, o.after) - (o.out === 'in' ? loss : 0);
    const best = opts.reduce((x, y) => (priced(y) > priced(x) ? y : x));
    console.log(JSON.stringify({
      rig: name, credits, clicks, step: 'source' in p ? `${p.source.cardCode}:${p.source.step}` : p.kind,
      given: ra.label(rezzed, given), answerPrompt: ra.label(rezzed, ra.today(rezzed)),
      oneStepDiffers: new Set(opts.map(o => !!o.after.activeRun)).size > 1,
      boardKeys: new Set(opts.map(o => ra.walkInputs(o.after))).size,
      options: opts.map(o => `${o.id}:${o.out}`).join(' '),
      runLoss: Math.round(loss * 10) / 10, pricedPick: best.id,
    }));
  }
}
