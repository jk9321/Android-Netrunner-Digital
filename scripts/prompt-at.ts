/**
 * The Corp AI's answer to the prompt open before move N of a report-format game (moves replayed from its config), and
 * the move the game made there. Measurement for spec jeff-games-48-50 Part B.
 *   FIX=report.json AT=219 [PLAN_OFF=...] npx vite-node scripts/prompt-at.ts
 */
import { readFileSync } from 'node:fs';
import { GameAction, GameState, activePrompt, cardDef, createInitialGameState, executeAction, findCardAnywhere } from '../src/core';
import { deckGameSetup } from '../src/data/decks';
import { answerPrompt } from '../src/ai/prompts';
import { applyPlanOff, asSide } from '../src/ai/synergy';
import { decisionContext } from '../src/ai/handValues';

applyPlanOff(process.env.PLAN_OFF ?? '');
const report = JSON.parse(readFileSync(process.env.FIX!, 'utf8'));
let s: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
if (report.startStops) s = { ...s, stops: report.startStops };
const name = (id: string) => { const c = findCardAnywhere(s, id); return c ? cardDef(c).title : id; };
for (const at of process.env.AT!.split(',').map(Number)) {
  const replay = (): GameState => {
    let t: GameState = createInitialGameState(deckGameSetup(report.config.seed, report.config.corpDeck, report.config.runnerDeck));
    if (report.startStops) t = { ...t, stops: report.startStops };
    for (const [i, move] of (report.moves as GameAction[]).entries()) { if (i === at) break; t = executeAction(t, move); }
    return t;
  };
  s = replay();
  const p = activePrompt(s);
  const ans = asSide('corp', () => { decisionContext(s, 'corp'); return answerPrompt(s, 'corp', undefined, true); }) as GameAction & { choice?: { cardInstanceIds?: string[]; optionId?: string } };
  const show = (a: { choice?: { cardInstanceIds?: string[]; optionId?: string } }) => a.choice?.cardInstanceIds ? `[${a.choice.cardInstanceIds.map(name).join(', ')}]` : a.choice?.optionId;
  let t: GameState | null = s;
  let a: GameAction = ans;
  const steps: string[] = [];
  for (let k = 0; k < 4 && t; k++) {
    t = executeAction(t, a);
    const q = activePrompt(t);
    if (!q || q.side !== 'corp' || !('source' in q) || !('source' in p!) || q.source.instanceId !== p.source.instanceId) break;
    const u = t;
    a = asSide('corp', () => { decisionContext(u, 'corp'); return answerPrompt(u, 'corp', undefined, true); });
    steps.push(`${q.source.step}: ${show(a as never)}`);
  }
  console.log(`#${at} prompt ${p ? `${p.kind} ${'source' in p ? cardDef({ cardCode: p.source.cardCode } as never).title + '/' + p.source.step : ''}` : 'none'}: AI ${show(ans)}; game ${show(report.moves[at])}; then ${steps.join(' / ')}`);
}
