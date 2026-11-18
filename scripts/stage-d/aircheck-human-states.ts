// ai-hold-audit-fixes (audit AI-RUN-POOL-LOCKED): the recorded human games' Corp decision points during a run that locks
// the Runner's pool (Aircheck 36018), as run-answers-fire.ts replays them, with this tree's 'thisRun' answer for the run's
// server and the same question with the pool unlocked (the old budget's reading). Read-only.
//   npx vite-node scripts/stage-d/aircheck-human-states.ts
import { readFileSync, readdirSync } from 'node:fs';
import { GameAction, GameState, actingSide, createInitialGameState, executeAction, wantsStop } from '../../src/core';
import { serverHold } from '../../src/ai/corp/hold';
import { asSide } from '../../src/ai/pricing';
import { decisionContext } from '../../src/ai/handValues';
import '../../src/ai';
import { deckGameSetup as setup } from '../../src/data/decks';
for (const f of readdirSync('tests/fixtures/human-games').filter(f => f.endsWith('.json'))) {
  const report = JSON.parse(readFileSync(`tests/fixtures/human-games/${f}`, 'utf8'));
  if (!report.moves?.length) continue;
  let s: GameState = createInitialGameState(setup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
  if (report.startStops) s = { ...s, stops: report.startStops };
  let locked = 0;
  for (const [k, move] of (report.moves as GameAction[]).entries()) {
    const side = actingSide(s);
    const w = s.priority;
    const run = s.activeRun;
    if (side === 'corp' && !s.winner && run?.poolLocked) {
      const ai = { ...s, stops: { corp: 'ai', runner: 'ai' } } as GameState;
      const corpDecides = s.pendingPrompts.length > 0 || !w || w.holder === s.activePlayer || wantsStop(ai, side, w);
      if (corpDecides) {
        locked++;
        const ask = (st: GameState) => asSide('corp', () => (decisionContext(st, 'corp'), serverHold(st, run.server, { when: 'thisRun' })));
        const h = ask(s);
        const open = structuredClone(s);
        open.activeRun!.poolLocked = false;
        const o = ask(open);
        console.log(`${f} move ${k} T${s.turnNumber} ${run.server} ${run.phase} pos ${run.icePosition} pool ${s.runner.credits}: locked holds=${h.holds} need=${h.need} budget=${h.budget} | unlocked holds=${o.holds} budget=${o.budget}`);
      }
    }
    try {
      s = executeAction(s, move);
    } catch {
      break;
    }
  }
  if (locked) console.log(`${f}: ${locked} Corp decision points with the pool locked`);
}
