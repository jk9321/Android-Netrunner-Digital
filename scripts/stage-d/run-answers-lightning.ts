/**
 * Follow-up 3, inventory of the per-card blocks (AI Coordinator amendment 2026-11-18, design-answer.md 7.4): is Lightning
 * Laboratory's block ("Whenever a run begins, you may remove 1 hosted agenda counter to rez up to 2 pieces of ice
 * protecting the attacked server, ignoring all costs") a second block, beside Lycian's subtypes, that answers a Corp prompt
 * during a run before the fallback where the walk's verdict separates the answers? The block rezzes the two dearest ice
 * when their rez costs sum to 3 or more on HQ, R&D or a remote with cards in it, else none. Board: one unrezzed
 * 2-cost ETR ice (Kessleroid 35075) on HQ or on a remote with an agenda, the Corp at $0 (it cannot rez it itself),
 * a Runner with no breakers, an agenda in HQ. Reports, at the run_begins prompt: the Normal Corp's answer, answerPrompt's,
 * each option's walk verdict (run-answers.ts judge), the board keys, and the priced pick.
 *   npx vite-node scripts/stage-d/run-answers-lightning.ts
 */
process.env.DEALS = 'none';
process.env.HUMAN = 'none';
const ra = await import('./run-answers');
const { createCardInstance } = await import('../../src/core/engine/gameState');
const { activePrompt, executeAction } = await import('../../src/core');
const { createAgent } = await import('../../src/ai');
const { scoreOutcome, freeRezSaving } = await import('../../src/ai/prompts');
const { runLoss } = await import('../../src/ai/corp/pools');
const { installIceForTest, newGame, scoreForTest, startRunnerTurn } = await import('../../tests/helpers');
import type { GameState } from '../../src/core';

for (const server of ['hq', 'remote1']) {
  for (const corpCredits of [0, 5]) {
    let s: GameState = scoreForTest(newGame(3), '34097');
    for (const sv of Object.values(s.corp.servers)) sv.ice = [];
    s.runner.rig = { ...s.runner.rig, programs: [], hardware: [], resources: [] };
    s.corp.hq = [createCardInstance(s, '30036')];
    s.turnNumber = 7;
    installIceForTest(s, '35075', server, false);
    if (server !== 'hq') s.corp.servers[server].root.push(createCardInstance(s, '30036'));
    startRunnerTurn(s);
    s.corp.credits = corpCredits;
    s.runner.credits = 5;
    s = executeAction(s, { type: 'INITIATE_RUN', player: 'runner', targetServerId: server });
    const p = activePrompt(s);
    if (!p || p.side !== 'corp' || !('source' in p) || p.source.cardCode !== '34097') {
      console.log(JSON.stringify({ server, corpCredits, error: 'no Lightning Laboratory prompt', prompt: p && ('source' in p ? p.source.cardCode : p.kind) }));
      continue;
    }
    const given = createAgent('corp', 'normal').chooseAction(structuredClone(s));
    const opts = ra.judgeOptions(s, 'corp', 2);
    const loss = runLoss(s);
    const priced = (o: (typeof opts)[number]) => scoreOutcome(s, o.after, 'corp', undefined, true) + freeRezSaving(s, o.after) - (o.out === 'in' ? loss : 0);
    const best = opts.reduce((x, y) => (priced(y) > priced(x) ? y : x));
    console.log(JSON.stringify({
      server, corpCredits, given: ra.label(s, given), answerPrompt: ra.label(s, ra.today(s)),
      oneStepDiffers: new Set(opts.map(o => !!o.after.activeRun)).size > 1,
      boardKeys: new Set(opts.map(o => ra.walkInputs(o.after))).size,
      options: opts.map(o => `${o.id}:${o.out}`).join(' '),
      runLoss: Math.round(loss * 10) / 10, pricedPick: best.id,
    }));
  }
}
