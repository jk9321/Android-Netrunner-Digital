/**
 * ai-honest-corp-decision (AI Coordinator 06:13Z (3)): for each dumped money-step change (fire-count.ts DUMP_CHANGED
 * files given as arguments), what R&D's order moved: each legal econ operation's play is simulated on the real state
 * and on the view (incomeLine.ts moneyPick plays it and answers its prompts as the Corp would), and its net credits and
 * the cards it drew are printed for both.
 *   npx vite-node scripts/honest-corp-decision/money-trace.ts -- dump-1.json dump-2.json
 */
import { readFileSync } from 'node:fs';
import { GameAction, GameState, activePrompt, cardDef, executeAction, getLegalActions } from '../../src/core';
import { asSide } from '../../src/ai/pricing';
import { answerPrompt } from '../../src/ai/prompts';
import { moneyPick } from '../../src/ai/incomeLine';
import { knownIncome } from '../../src/ai/nextTurnMoney';
import { corpDecisionView } from '../../src/ai/turnPlanner';
import { cardSynergy } from '../../src/ai/synergyTags';

const title = (s: GameState, id: string) => {
  const c = [...s.corp.hq, ...s.corp.rd].find(x => x.instanceId === id);
  return c ? cardDef(c).title : id;
};
function sim(s: GameState, a: GameAction) {
  const answers: string[] = [];
  try {
    let n = executeAction(s, a);
    for (let i = 0; i < 20 && activePrompt(n); i++) {
      const ans = answerPrompt(n, activePrompt(n)!.side, undefined, true);
      const p = activePrompt(n)!;
      answers.push(`${'source' in p ? cardDef({ cardCode: p.source.cardCode } as never).title : p.kind}: ${JSON.stringify((ans as { choice?: unknown }).choice)}`);
      n = executeAction(n, ans);
    }
    const drew = n.corp.hq.filter(c => !s.corp.hq.some(x => x.instanceId === c.instanceId)).map(c => cardDef(c).title);
    return { net: n.corp.credits + knownIncome(n) - (s.corp.credits + knownIncome(s)), drew, answers };
  } catch (e) {
    return { net: NaN, drew: [], answers: [(e as Error).message] };
  }
}
for (const f of process.argv.slice(2).filter(x => x !== '--')) {
  const { state: s } = JSON.parse(readFileSync(f, 'utf8')) as { state: GameState };
  asSide('corp', () => {
    const v = corpDecisionView(s);
    console.log(`\n${f}: T${s.turnNumber} clicks ${s.corp.clicks} credits ${s.corp.credits}; top of R&D real ${s.corp.rd.slice(0, 3).map(c => cardDef(c).title).join(', ')} | view ${v.corp.rd.slice(0, 3).map(c => cardDef(c).title).join(', ')}`);
    for (const a of getLegalActions(s, 'corp')) {
      if (a.type !== 'PLAY_OPERATION_OR_EVENT') continue;
      const card = s.corp.hq.find(c => c.instanceId === a.cardInstanceId)!;
      if (!((cardSynergy(cardDef(card)).gives?.econ ?? 0) > 0)) continue;
      const r = sim(s, a), w = sim(v, a);
      console.log(`  ${cardDef(card).title}: real net ${r.net} drew [${r.drew.join(', ')}] ${r.answers.join('; ')} | view net ${w.net} drew [${w.drew.join(', ')}] ${w.answers.join('; ')}`);
    }
    const pick = (x: GameAction | null) => (x && 'cardInstanceId' in x ? `${x.type} ${title(s, (x as { cardInstanceId: string }).cardInstanceId)}` : JSON.stringify(x));
    console.log(`  moneyPick real: ${pick(moneyPick(s))} | view: ${pick(moneyPick(v))}`);
  });
}
